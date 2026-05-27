// @ts-check

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { buildMotionName } from "../core/motion-support.js";
import { rehydrateMotion } from "../core/rehydrate-motion.js";
import { applyMigrations } from "./migrations.js";
import { getDatabasePath, getStateDir } from "./paths.js";

let db = null;

/**
 * @returns {DatabaseSync}
 */
function getDatabase() {
  if (db) {
    return db;
  }

  const exoDir = getStateDir();
  const dbPath = getDatabasePath();

  fs.mkdirSync(exoDir, { recursive: true });

  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000;");
  safelyEnableWal(db);
  applyMigrations(db);

  return db;
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
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @returns {import("../schema/motion.js").motionSchema._type}
 */
export function insertMotion(motion) {
  const database = getDatabase();
  const storedMotion = ensureUniqueGeneratedMotionName(motion, database);
  const statement = database.prepare(`
    INSERT INTO motions (id, status, source_url, created_at, updated_at, payload_json)
    VALUES (@id, @status, @sourceUrl, @createdAt, @updatedAt, @payloadJson)
  `);

  statement.run({
    id: storedMotion.id,
    status: storedMotion.status,
    sourceUrl: storedMotion.offer.sourceUrl,
    createdAt: storedMotion.createdAt,
    updatedAt: storedMotion.updatedAt,
    payloadJson: JSON.stringify(storedMotion, null, 2)
  });

  return storedMotion;
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @returns {import("../schema/motion.js").motionSchema._type}
 */
export function updateMotion(motion) {
  const database = getDatabase();
  const storedMotion = ensureUniqueGeneratedMotionName(motion, database);
  const statement = database.prepare(`
    UPDATE motions
    SET status = @status,
        source_url = @sourceUrl,
        updated_at = @updatedAt,
        payload_json = @payloadJson
    WHERE id = @id
  `);

  statement.run({
    id: storedMotion.id,
    status: storedMotion.status,
    sourceUrl: storedMotion.offer.sourceUrl,
    updatedAt: storedMotion.updatedAt,
    payloadJson: JSON.stringify(storedMotion, null, 2)
  });

  return storedMotion;
}

/**
 * @param {string} id
 * @returns {unknown | null}
 */
export function findMotionById(id) {
  const row = getDatabase()
    .prepare(`SELECT payload_json FROM motions WHERE id = ?`)
    .get(id);

  if (!row) return null;

  const { motion, repaired } = rehydrateMotion(JSON.parse(row.payload_json));
  if (repaired) {
    persistNormalizedMotion(motion);
  }

  return motion;
}

/**
 * @returns {unknown[]}
 */
export function listMotions() {
  const rows = getDatabase()
    .prepare(`
      SELECT payload_json
      FROM motions
      ORDER BY created_at DESC
    `)
    .all();

  return rows.map((row) => {
    const { motion, repaired } = rehydrateMotion(JSON.parse(row.payload_json));
    if (repaired) {
      persistNormalizedMotion(motion);
    }

    return motion;
  });
}

/**
 * @param {string} id
 */
export function deleteMotion(id) {
  getDatabase()
    .prepare(`DELETE FROM motions WHERE id = ?`)
    .run(id);
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 */
export function insertBrowserProfile(profile) {
  const statement = getDatabase().prepare(`
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
  const statement = getDatabase().prepare(`
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
  const row = getDatabase()
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
  const row = getDatabase()
    .prepare(`SELECT payload_json FROM browser_profiles WHERE profile_path = ?`)
    .get(profilePath);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @returns {unknown[]}
 */
export function listBrowserProfiles() {
  const rows = getDatabase()
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
  getDatabase()
    .prepare(`DELETE FROM browser_profiles WHERE id = ?`)
    .run(id);
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 */
export function insertUser(user) {
  const statement = getDatabase().prepare(`
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
  const statement = getDatabase().prepare(`
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
 * @param {string} id
 * @returns {unknown | null}
 */
export function findUserById(id) {
  const row = getDatabase()
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
  const row = getDatabase()
    .prepare(`SELECT payload_json FROM users WHERE lower(label) = lower(?)`)
    .get(label);

  if (!row) return null;
  return JSON.parse(row.payload_json);
}

/**
 * @returns {unknown[]}
 */
export function listUsers() {
  const rows = getDatabase()
    .prepare(`
      SELECT payload_json
      FROM users
      ORDER BY created_at DESC
    `)
    .all();

  return rows.map((row) => JSON.parse(row.payload_json));
}

/**
 * @param {string} id
 */
export function deleteUser(id) {
  getDatabase()
    .prepare(`DELETE FROM users WHERE id = ?`)
    .run(id);
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 */
export function insertCompany(company) {
  const statement = getDatabase().prepare(`
    INSERT INTO companies (id, name, search_name, domain, created_at, updated_at, payload_json)
    VALUES (@id, @name, @searchName, @domain, @createdAt, @updatedAt, @payloadJson)
  `);

  statement.run({
    id: company.id,
    name: company.name,
    searchName: company.name.trim().toLowerCase(),
    domain: company.domain ? company.domain.trim().toLowerCase() : null,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
    payloadJson: JSON.stringify(company, null, 2)
  });
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 */
export function updateCompany(company) {
  const statement = getDatabase().prepare(`
    UPDATE companies
    SET name = @name,
        search_name = @searchName,
        domain = @domain,
        updated_at = @updatedAt,
        payload_json = @payloadJson
    WHERE id = @id
  `);

  statement.run({
    id: company.id,
    name: company.name,
    searchName: company.name.trim().toLowerCase(),
    domain: company.domain ? company.domain.trim().toLowerCase() : null,
    updatedAt: company.updatedAt,
    payloadJson: JSON.stringify(company, null, 2)
  });
}

/**
 * @param {string} id
 * @returns {unknown | null}
 */
export function findCompanyById(id) {
  const row = getDatabase()
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

  const row = getDatabase()
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
  const rows = getDatabase()
    .prepare(`
      SELECT payload_json
      FROM companies
      ORDER BY created_at DESC
    `)
    .all();

  return rows.map((row) => JSON.parse(row.payload_json));
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 */
function persistNormalizedMotion(motion) {
  getDatabase()
    .prepare(`
      UPDATE motions
      SET status = @status,
          source_url = @sourceUrl,
          payload_json = @payloadJson
      WHERE id = @id
    `)
    .run({
      id: motion.id,
      status: motion.status,
      sourceUrl: motion.offer.sourceUrl,
      payloadJson: JSON.stringify(motion, null, 2)
    });
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {DatabaseSync} database
 * @returns {import("../schema/motion.js").motionSchema._type}
 */
function ensureUniqueGeneratedMotionName(motion, database) {
  const generatedBaseName = buildMotionName({
    seed: motion.id
  });

  if (motion.name !== generatedBaseName) {
    return motion;
  }

  let attempt = 0;
  let candidate = generatedBaseName;

  while (motionNameExists(candidate, motion.id, database)) {
    attempt += 1;
    candidate = buildMotionName({
      seed: motion.id,
      attempt
    });
  }

  if (candidate === motion.name) {
    return motion;
  }

  return {
    ...motion,
    name: candidate
  };
}

/**
 * @param {string} name
 * @param {string} motionId
 * @param {DatabaseSync} database
 * @returns {boolean}
 */
function motionNameExists(name, motionId, database) {
  const row = database
    .prepare(`
      SELECT id
      FROM motions
      WHERE id != @id
        AND json_extract(payload_json, '$.name') = @name
      LIMIT 1
    `)
    .get({
      id: motionId,
      name
    });

  return Boolean(row);
}

/**
 * @param {string} term
 * @returns {unknown[]}
 */
export function searchCompanies(term) {
  const normalizedTerm = `%${term.trim().toLowerCase()}%`;
  const rows = getDatabase()
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
