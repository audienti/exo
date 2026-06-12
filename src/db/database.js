// @ts-check

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { inboundCueSchema, inboundObservationSchema } from "../schema/inbound.js";
import { applyMigrations } from "./migrations.js";
import {
  getHomeDatabasePath,
  getHomeStateDir,
  getLocalDatabasePath,
  getLocalStateDir,
} from "./paths.js";

const databases = new Map();

/**
 * @param {"home" | "local"} [scope]
 * @returns {DatabaseSync}
 */
function getDatabase(scope = "local") {
  const { stateDir, dbPath } = scope === "home"
    ? { stateDir: getHomeStateDir(), dbPath: getHomeDatabasePath() }
    : { stateDir: getLocalStateDir(), dbPath: getLocalDatabasePath() };

  const cached = databases.get(dbPath);
  if (cached) {
    return cached;
  }

  fs.mkdirSync(stateDir, { recursive: true });

  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA busy_timeout = 5000;");
  safelyEnableWal(database);
  applyMigrations(database);
  databases.set(dbPath, database);
  return database;
}

/**
 * @returns {DatabaseSync}
 */
export function getHomeDatabase() {
  return getDatabase("home");
}

/**
 * @returns {DatabaseSync}
 */
export function getLocalDatabase() {
  return getDatabase("local");
}

/**
 * @param {DatabaseSync} database
 */
function safelyEnableWal(database) {
  try {
    database.exec("PRAGMA journal_mode = WAL;");
  } catch (error) {
    if (!(error instanceof Error) || !/database is locked/i.test(error.message)) {
      throw error;
    }
  }
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 */
export function insertBrowserProfile(profile) {
  const statement = getHomeDatabase().prepare(`
    INSERT INTO browser_profiles (id, status, browser, label, profile_path, created_at, updated_at, payload_json)
    VALUES (@id, @status, @browser, @label, @profilePath, @createdAt, @updatedAt, @payloadJson)
  `);

  statement.run({
    id: profile.id,
    status: profile.status,
    browser: profile.browser,
    label: profile.label,
    profilePath: profile.profilePath,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    payloadJson: JSON.stringify(profile, null, 2)
  });
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 */
export function updateBrowserProfile(profile) {
  const statement = getHomeDatabase().prepare(`
    UPDATE browser_profiles
    SET status = @status,
        browser = @browser,
        label = @label,
        profile_path = @profilePath,
        updated_at = @updatedAt,
        payload_json = @payloadJson
    WHERE id = @id
  `);

  statement.run({
    id: profile.id,
    status: profile.status,
    browser: profile.browser,
    label: profile.label,
    profilePath: profile.profilePath,
    updatedAt: profile.updatedAt,
    payloadJson: JSON.stringify(profile, null, 2)
  });
}

/**
 * @param {string} id
 * @returns {unknown | null}
 */
export function findBrowserProfileById(id) {
  const row = getHomeDatabase()
    .prepare(`SELECT payload_json FROM browser_profiles WHERE id = ?`)
    .get(id);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @param {string} profilePath
 * @returns {unknown | null}
 */
export function findBrowserProfileByPath(profilePath) {
  const row = getHomeDatabase()
    .prepare(`SELECT payload_json FROM browser_profiles WHERE profile_path = ?`)
    .get(profilePath);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @returns {unknown[]}
 */
export function listBrowserProfiles() {
  const rows = getHomeDatabase()
    .prepare(`
      SELECT payload_json
      FROM browser_profiles
      ORDER BY created_at DESC
    `)
    .all();

  return rows.map((row) => JSON.parse(row.payload_json));
}

/**
 * @param {string} id
 */
export function deleteBrowserProfile(id) {
  getHomeDatabase()
    .prepare(`DELETE FROM browser_profiles WHERE id = ?`)
    .run(id);
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 */
export function insertUser(user) {
  const statement = getHomeDatabase().prepare(`
    INSERT INTO users (id, label, created_at, updated_at, payload_json)
    VALUES (@id, @label, @createdAt, @updatedAt, @payloadJson)
  `);

  statement.run({
    id: user.id,
    label: user.label,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    payloadJson: JSON.stringify(user, null, 2)
  });
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 */
export function updateUser(user) {
  const statement = getHomeDatabase().prepare(`
    UPDATE users
    SET label = @label,
        updated_at = @updatedAt,
        payload_json = @payloadJson
    WHERE id = @id
  `);

  statement.run({
    id: user.id,
    label: user.label,
    updatedAt: user.updatedAt,
    payloadJson: JSON.stringify(user, null, 2)
  });
}

/**
 * Serialize a read-modify-write against the embedded user JSON payload.
 *
 * Connected accounts and harness connections live inside the user's
 * `payload_json` blob, so two parallel callers that read the same starting
 * snapshot can both call `updateUser` and the last writer overwrites the
 * other writer's account list. Issue #31 captured exactly this loss while
 * adding LinkedIn and Gmail accounts in parallel.
 *
 * This helper runs the entire read-mutate-write cycle inside one
 * `BEGIN IMMEDIATE` SQLite transaction against the home database. SQLite's
 * busy_timeout queues concurrent writers, so each `mutator` sees the latest
 * stored user and merges its change on top.
 *
 * @template T
 * @param {string} userId
 * @param {(latest: unknown) => { user: import("../schema/user.js").userSchema._type, result?: T }} mutator
 * @returns {{ user: import("../schema/user.js").userSchema._type, result: T | undefined }}
 */
export function mutateUserById(userId, mutator) {
  const database = getHomeDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database
      .prepare(`SELECT payload_json FROM users WHERE id = ?`)
      .get(userId);

    if (!row) {
      throw new Error(`User not found: ${userId}`);
    }

    const latest = JSON.parse(row.payload_json);
    const outcome = mutator(latest);
    if (!outcome || !outcome.user) {
      throw new Error(`mutateUserById mutator must return { user, result? }.`);
    }

    const nextUser = outcome.user;
    database.prepare(`
      UPDATE users
      SET label = @label,
          updated_at = @updatedAt,
          payload_json = @payloadJson
      WHERE id = @id
    `).run({
      id: nextUser.id,
      label: nextUser.label,
      updatedAt: nextUser.updatedAt,
      payloadJson: JSON.stringify(nextUser, null, 2)
    });

    database.exec("COMMIT");
    return { user: nextUser, result: outcome.result };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/**
 * @param {string} id
 * @returns {unknown | null}
 */
export function findUserById(id) {
  const row = getHomeDatabase()
    .prepare(`SELECT payload_json FROM users WHERE id = ?`)
    .get(id);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @param {string} label
 * @returns {unknown | null}
 */
export function findUserByLabel(label) {
  const row = getHomeDatabase()
    .prepare(`SELECT payload_json FROM users WHERE lower(label) = lower(?)`)
    .get(label);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @returns {unknown[]}
 */
export function listUsers() {
  const rows = getHomeDatabase()
    .prepare(`
      SELECT payload_json
      FROM users
      ORDER BY created_at DESC
    `)
    .all();

  return rows.map((row) => JSON.parse(row.payload_json));
}

/**
 * Surface every motion or company whose engagementUserAssignment still points
 * at the given user id. Returns an empty array when the user is unreferenced.
 *
 * @param {string} userId
 * @returns {{
 *   motions: { id: string, name: string }[],
 *   companies: { id: string, name: string }[],
 * }}
 */
export function findActiveUserAssignmentReferences(userId) {
  const local = getLocalDatabase();
  const motions = local
    .prepare(`
      SELECT id, name, payload_json
      FROM motions
      WHERE status != 'archived'
        AND json_extract(payload_json, '$.engagementUserAssignment.userId') = ?
      ORDER BY created_at DESC
    `)
    .all(userId)
    .map((row) => ({ id: String(row.id), name: String(row.name) }));

  const companies = local
    .prepare(`
      SELECT id, name
      FROM companies
      WHERE json_extract(payload_json, '$.engagementUserAssignment.userId') = ?
      ORDER BY created_at DESC
    `)
    .all(userId)
    .map((row) => ({ id: String(row.id), name: String(row.name) }));

  return { motions, companies };
}

export class UserDeletionBlockedError extends Error {
  /**
   * @param {{
   *   userId: string,
   *   references: ReturnType<typeof findActiveUserAssignmentReferences>,
   * }} input
   */
  constructor(input) {
    const { motions, companies } = input.references;
    const parts = [];
    if (motions.length) {
      parts.push(`${motions.length} active motion${motions.length === 1 ? "" : "s"}`);
    }
    if (companies.length) {
      parts.push(`${companies.length} compan${companies.length === 1 ? "y" : "ies"}`);
    }
    const detail = parts.length ? parts.join(" and ") : "active assignments";
    super(
      `Cannot delete user ${input.userId}: still assigned to ${detail}. Reassign or archive those records first.`
    );
    this.name = "UserDeletionBlockedError";
    this.userId = input.userId;
    this.references = input.references;
  }
}

/**
 * @param {string} id
 */
export function deleteUser(id) {
  const references = findActiveUserAssignmentReferences(id);
  if (references.motions.length || references.companies.length) {
    throw new UserDeletionBlockedError({ userId: id, references });
  }
  getHomeDatabase()
    .prepare(`DELETE FROM users WHERE id = ?`)
    .run(id);
}

/**
 * @param {import("../schema/inbound.js").inboundCueSchema._type} cue
 */
export function upsertInboundCue(cue) {
  const normalized = inboundCueSchema.parse(cue);
  const statement = getHomeDatabase().prepare(`
    INSERT INTO inbound_cues (
      id,
      dedupe_key,
      user_id,
      account_id,
      capability,
      surface_key,
      cue_kind,
      cue_status,
      observed_at,
      recorded_at,
      resolved_at,
      motion_id,
      company_id,
      prospect_id,
      payload_json
    )
    VALUES (
      @id,
      @dedupeKey,
      @userId,
      @accountId,
      @capability,
      @surfaceKey,
      @kind,
      @status,
      @observedAt,
      @recordedAt,
      @resolvedAt,
      @motionId,
      @companyId,
      @prospectId,
      @payloadJson
    )
    ON CONFLICT(dedupe_key) DO UPDATE SET
      id = excluded.id,
      user_id = excluded.user_id,
      account_id = excluded.account_id,
      capability = excluded.capability,
      surface_key = excluded.surface_key,
      cue_kind = excluded.cue_kind,
      cue_status = excluded.cue_status,
      observed_at = excluded.observed_at,
      recorded_at = excluded.recorded_at,
      resolved_at = excluded.resolved_at,
      motion_id = excluded.motion_id,
      company_id = excluded.company_id,
      prospect_id = excluded.prospect_id,
      payload_json = excluded.payload_json
  `);

  statement.run({
    id: normalized.id,
    dedupeKey: normalized.dedupeKey,
    userId: normalized.userId,
    accountId: normalized.accountId,
    capability: normalized.capability,
    surfaceKey: normalized.surfaceKey,
    kind: normalized.kind,
    status: normalized.status,
    observedAt: normalized.observedAt,
    recordedAt: normalized.recordedAt,
    resolvedAt: normalized.resolvedAt,
    motionId: normalized.motionId,
    companyId: normalized.companyId,
    prospectId: normalized.prospectId,
    payloadJson: JSON.stringify(normalized, null, 2)
  });

  return normalized;
}

/**
 * @param {string} id
 * @returns {unknown | null}
 */
export function findInboundCueById(id) {
  const row = getHomeDatabase()
    .prepare(`SELECT payload_json FROM inbound_cues WHERE id = ?`)
    .get(id);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @param {string} dedupeKey
 * @returns {unknown | null}
 */
export function findInboundCueByDedupeKey(dedupeKey) {
  const row = getHomeDatabase()
    .prepare(`SELECT payload_json FROM inbound_cues WHERE dedupe_key = ?`)
    .get(dedupeKey);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @param {{
 *   userId?: string | null,
 *   accountId?: string | null,
 *   capability?: string | null,
 *   surfaceKey?: string | null,
 *   status?: string | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   limit?: number | null
 * }} [filters]
 * @returns {unknown[]}
 */
export function listInboundCues(filters = {}) {
  const where = [];
  const params = /** @type {Record<string, string | number>} */ ({});

  if (filters.userId) {
    where.push("user_id = @userId");
    params.userId = filters.userId;
  }

  if (filters.accountId) {
    where.push("account_id = @accountId");
    params.accountId = filters.accountId;
  }

  if (filters.capability) {
    where.push("capability = @capability");
    params.capability = filters.capability;
  }

  if (filters.surfaceKey) {
    where.push("surface_key = @surfaceKey");
    params.surfaceKey = filters.surfaceKey;
  }

  if (filters.status) {
    where.push("cue_status = @status");
    params.status = filters.status;
  }

  if (filters.motionId) {
    where.push("motion_id = @motionId");
    params.motionId = filters.motionId;
  }

  if (filters.companyId) {
    where.push("company_id = @companyId");
    params.companyId = filters.companyId;
  }

  if (filters.prospectId) {
    where.push("prospect_id = @prospectId");
    params.prospectId = filters.prospectId;
  }

  const clauses = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Number.isInteger(filters.limit) && filters.limit ? `LIMIT ${filters.limit}` : "";
  const rows = getHomeDatabase()
    .prepare(`
      SELECT payload_json
      FROM inbound_cues
      ${clauses}
      ORDER BY observed_at DESC, recorded_at DESC
      ${limit}
    `)
    .all(params);

  return rows.map((row) => JSON.parse(row.payload_json));
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
export function upsertInboundObservation(observation) {
  const normalized = inboundObservationSchema.parse(observation);
  const statement = getHomeDatabase().prepare(`
    INSERT INTO inbound_observations (
      id,
      dedupe_key,
      user_id,
      account_id,
      capability,
      surface_key,
      observation_kind,
      observed_at,
      recorded_at,
      motion_id,
      company_id,
      prospect_id,
      person_id,
      payload_json
    )
    VALUES (
      @id,
      @dedupeKey,
      @userId,
      @accountId,
      @capability,
      @surfaceKey,
      @kind,
      @observedAt,
      @recordedAt,
      @motionId,
      @companyId,
      @prospectId,
      @personId,
      @payloadJson
    )
    ON CONFLICT(dedupe_key) DO UPDATE SET
      id = excluded.id,
      user_id = excluded.user_id,
      account_id = excluded.account_id,
      capability = excluded.capability,
      surface_key = excluded.surface_key,
      observation_kind = excluded.observation_kind,
      observed_at = excluded.observed_at,
      recorded_at = excluded.recorded_at,
      motion_id = excluded.motion_id,
      company_id = excluded.company_id,
      prospect_id = excluded.prospect_id,
      person_id = excluded.person_id,
      payload_json = excluded.payload_json
  `);

  statement.run({
    id: normalized.id,
    dedupeKey: normalized.dedupeKey,
    userId: normalized.userId,
    accountId: normalized.accountId,
    capability: normalized.capability,
    surfaceKey: normalized.surfaceKey,
    kind: normalized.kind,
    observedAt: normalized.observedAt,
    recordedAt: normalized.recordedAt,
    motionId: normalized.motionId,
    companyId: normalized.companyId,
    prospectId: normalized.prospectId,
    personId: normalized.personId,
    payloadJson: JSON.stringify(normalized, null, 2)
  });

  return normalized;
}

/**
 * @param {string} id
 * @returns {unknown | null}
 */
export function findInboundObservationById(id) {
  const row = getHomeDatabase()
    .prepare(`SELECT payload_json FROM inbound_observations WHERE id = ?`)
    .get(id);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @param {string} dedupeKey
 * @returns {unknown | null}
 */
export function findInboundObservationByDedupeKey(dedupeKey) {
  const row = getHomeDatabase()
    .prepare(`SELECT payload_json FROM inbound_observations WHERE dedupe_key = ?`)
    .get(dedupeKey);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @param {string} id
 */
export function deleteInboundObservationById(id) {
  getHomeDatabase()
    .prepare(`DELETE FROM inbound_observations WHERE id = ?`)
    .run(id);
}

/**
 * @param {{
 *   userId?: string | null,
 *   accountId?: string | null,
 *   capability?: string | null,
 *   surfaceKey?: string | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   limit?: number | null
 * }} [filters]
 * @returns {unknown[]}
 */
export function listInboundObservations(filters = {}) {
  const where = [];
  const params = /** @type {Record<string, string | number>} */ ({});

  if (filters.userId) {
    where.push("user_id = @userId");
    params.userId = filters.userId;
  }

  if (filters.accountId) {
    where.push("account_id = @accountId");
    params.accountId = filters.accountId;
  }

  if (filters.capability) {
    where.push("capability = @capability");
    params.capability = filters.capability;
  }

  if (filters.surfaceKey) {
    where.push("surface_key = @surfaceKey");
    params.surfaceKey = filters.surfaceKey;
  }

  if (filters.motionId) {
    where.push("motion_id = @motionId");
    params.motionId = filters.motionId;
  }

  if (filters.companyId) {
    where.push("company_id = @companyId");
    params.companyId = filters.companyId;
  }

  if (filters.prospectId) {
    where.push("prospect_id = @prospectId");
    params.prospectId = filters.prospectId;
  }

  const clauses = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Number.isInteger(filters.limit) && filters.limit ? `LIMIT ${filters.limit}` : "";
  const rows = getHomeDatabase()
    .prepare(`
      SELECT payload_json
      FROM inbound_observations
      ${clauses}
      ORDER BY observed_at DESC, recorded_at DESC
      ${limit}
    `)
    .all(params);

  return rows.map((row) => JSON.parse(row.payload_json));
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 */
export function insertCompany(company) {
  const statement = getLocalDatabase().prepare(`
    INSERT INTO companies (
      id,
      name,
      search_name,
      domain,
      linkedin_company_url,
      website_url,
      schema_version,
      created_at,
      updated_at,
      payload_json
    )
    VALUES (
      @id,
      @name,
      @searchName,
      @domain,
      @linkedinCompanyUrl,
      @websiteUrl,
      @schemaVersion,
      @createdAt,
      @updatedAt,
      @payloadJson
    )
  `);

  statement.run({
    id: company.id,
    name: company.name,
    searchName: company.name.trim().toLowerCase(),
    domain: company.domain ? company.domain.trim().toLowerCase() : null,
    linkedinCompanyUrl: company.linkedinCompanyUrl ?? null,
    websiteUrl: company.websiteUrl ?? null,
    schemaVersion: 1,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
    payloadJson: JSON.stringify(company, null, 2)
  });
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @returns {import("../schema/company.js").companySchema._type} the stored company
 */
export function updateCompany(company) {
  const statement = getLocalDatabase().prepare(`
    UPDATE companies
    SET name = @name,
        search_name = @searchName,
        domain = @domain,
        linkedin_company_url = @linkedinCompanyUrl,
        website_url = @websiteUrl,
        schema_version = @schemaVersion,
        updated_at = @updatedAt,
        payload_json = @payloadJson
    WHERE id = @id
  `);

  statement.run({
    id: company.id,
    name: company.name,
    searchName: company.name.trim().toLowerCase(),
    domain: company.domain ? company.domain.trim().toLowerCase() : null,
    linkedinCompanyUrl: company.linkedinCompanyUrl ?? null,
    websiteUrl: company.websiteUrl ?? null,
    schemaVersion: 1,
    updatedAt: company.updatedAt,
    payloadJson: JSON.stringify(company, null, 2)
  });

  // Return the stored record, consistent with updateMotion — callers (e.g. the
  // action dispatcher) rely on a returned company for confirmation messages.
  return company;
}

/**
 * @param {string} id
 * @returns {unknown | null}
 */
export function findCompanyById(id) {
  const row = getLocalDatabase()
    .prepare(`SELECT payload_json FROM companies WHERE id = ?`)
    .get(id);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @param {string} name
 * @param {string | null | undefined} domain
 * @returns {unknown | null}
 */
export function findCompanyByIdentity(name, domain) {
  const normalizedName = name.trim().toLowerCase();
  const normalizedDomain = domain ? domain.trim().toLowerCase() : null;

  const row = getLocalDatabase()
    .prepare(`
      SELECT payload_json
      FROM companies
      WHERE search_name = @searchName
         OR (@domain IS NOT NULL AND domain = @domain)
      LIMIT 1
    `)
    .get({
      searchName: normalizedName,
      domain: normalizedDomain
    });

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @returns {unknown[]}
 */
export function listCompanies() {
  const rows = getLocalDatabase()
    .prepare(`
      SELECT payload_json
      FROM companies
      ORDER BY created_at DESC
    `)
    .all();

  return rows.map((row) => JSON.parse(row.payload_json));
}

/**
 * @param {string} term
 * @returns {unknown[]}
 */
export function searchCompanies(term) {
  const normalizedTerm = `%${term.trim().toLowerCase()}%`;
  const rows = getLocalDatabase()
    .prepare(`
      SELECT payload_json
      FROM companies
      WHERE search_name LIKE @term
         OR (domain IS NOT NULL AND domain LIKE @term)
      ORDER BY created_at DESC
    `)
    .all({ term: normalizedTerm });

  return rows.map((row) => JSON.parse(row.payload_json));
}

export * from "./activity-events.js";
export * from "./companies.js";
export * from "./drafts.js";
export * from "./motions.js";
export * from "./motion-accounts.js";
export * from "./people.js";
export * from "./prospects.js";
export * from "./signal-matches.js";
