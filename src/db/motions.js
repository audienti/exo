// @ts-check

import { buildMotionName } from "../core/motion-support.js";
import { rehydrateMotion } from "../core/rehydrate-motion.js";
import {
  buildLinkedinProfileUrlFromPublicId,
  mergeContactPointLists,
} from "../lib/prospect-contacts.js";
import { motionCoreSchema, motionViewSchema } from "../schema/motion.js";
import { rehydrateTargetAccount } from "../schema/target-account.js";
import { appendActivityEvent } from "./activity-events.js";
import { findNormalizedCompanyById, findOrCreateCompany } from "./companies.js";
import { getLocalDatabase } from "./database.js";
import { upsertProspectDraft } from "./drafts.js";
import { workableBranchPredicateSql } from "./lifecycle-state.js";
import { upsertMotionAccount } from "./motion-accounts.js";
import {
  findPersonById,
  listContactPointsForPerson,
  resolvePersonIdentity,
  upsertEmployment,
} from "./people.js";
import { upsertProspect } from "./prospects.js";
import { upsertSignalMatch } from "./signal-matches.js";
import {
  NORMALIZED_SCHEMA_VERSION,
  parsePayload,
  toPayloadJson,
} from "./normalized-utils.js";

export class MotionVersionConflictError extends Error {
  /**
   * @param {{ motionId: string, expectedVersion: number, actualVersion?: number | null }} input
   */
  constructor(input) {
    super(
      `Motion ${input.motionId} was updated concurrently; expected version ${input.expectedVersion}` +
      `${input.actualVersion ? ` but found ${input.actualVersion}` : ""}.`
    );
    this.name = "MotionVersionConflictError";
    this.motionId = input.motionId;
    this.expectedVersion = input.expectedVersion;
    this.actualVersion = input.actualVersion ?? null;
  }
}

/**
 * @param {unknown} motion
 * @returns {import("../schema/motion.js").motionViewSchema._type}
 */
export function insertMotion(motion) {
  const database = getLocalDatabase();
  const view = ensureUniqueGeneratedMotionName(toMotionView(motion), database);
  const core = toMotionCore(view);

  runTransaction(database, () => {
    database.prepare(`
      INSERT INTO motions (
        id,
        name,
        status,
        source_url,
        schema_version,
        created_at,
        updated_at,
        payload_json
      )
      VALUES (
        @id,
        @name,
        @status,
        @sourceUrl,
        @schemaVersion,
        @createdAt,
        @updatedAt,
        @payloadJson
      )
    `).run({
      id: core.id,
      name: core.name,
      status: core.status,
      sourceUrl: core.offer.sourceUrl,
      schemaVersion: NORMALIZED_SCHEMA_VERSION,
      createdAt: core.createdAt,
      updatedAt: core.updatedAt,
      payloadJson: toPayloadJson(core),
    });

    replaceMotionTargetMapRows(view);
  });

  return findMotionById(view.id) ?? view;
}

/**
 * @param {unknown} motion
 * @returns {import("../schema/motion.js").motionViewSchema._type}
 */
export function updateMotion(motion) {
  const database = getLocalDatabase();
  const view = ensureUniqueGeneratedMotionName(toMotionView(motion), database);
  const core = toMotionCore(view);
  const expectedVersion = core.version;
  const nextCore = {
    ...core,
    version: expectedVersion + 1,
  };

  runTransaction(database, () => {
    const result = database.prepare(`
      UPDATE motions
      SET name = @name,
          status = @status,
          source_url = @sourceUrl,
          version = @nextVersion,
          schema_version = @schemaVersion,
          updated_at = @updatedAt,
          payload_json = @payloadJson
      WHERE id = @id
        AND version = @expectedVersion
    `).run({
      id: core.id,
      name: core.name,
      status: core.status,
      sourceUrl: core.offer.sourceUrl,
      nextVersion: nextCore.version,
      expectedVersion,
      schemaVersion: NORMALIZED_SCHEMA_VERSION,
      updatedAt: core.updatedAt,
      payloadJson: toPayloadJson(nextCore),
    });

    if (result.changes === 0) {
      const current = database.prepare("SELECT version FROM motions WHERE id = ?").get(core.id);
      if (!current) {
        throw new Error(`Motion not found: ${core.id}`);
      }
      throw new MotionVersionConflictError({
        motionId: core.id,
        expectedVersion,
        actualVersion: current.version ?? null,
      });
    }
  });

  return findMotionById(view.id) ?? view;
}

/**
 * @param {string} motionId
 * @param {(motion: import("../schema/motion.js").motionViewSchema._type) => unknown} buildNextMotion
 * @param {{ attempts?: number }} [options]
 * @returns {import("../schema/motion.js").motionViewSchema._type}
 */
export function updateMotionWithRetry(motionId, buildNextMotion, options = {}) {
  const attempts = Math.max(1, options.attempts ?? 3);
  /** @type {unknown} */
  let lastConflict = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const current = findMotionById(motionId);
    if (!current) {
      throw new Error(`Motion not found: ${motionId}`);
    }
    try {
      return updateMotion(buildNextMotion(current));
    } catch (error) {
      if (!(error instanceof MotionVersionConflictError)) {
        throw error;
      }
      lastConflict = error;
    }
  }

  throw lastConflict;
}

/**
 * @param {string} id
 * @returns {import("../schema/motion.js").motionViewSchema._type | null}
 */
export function findMotionById(id) {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM motions WHERE id = ?")
    .get(id);
  return row ? hydrateMotionRow(row) : null;
}

/**
 * @returns {import("../schema/motion.js").motionViewSchema._type[]}
 */
export function listMotions() {
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM motions
      ORDER BY created_at DESC
    `)
    .all()
    .map(hydrateMotionRow);
}

/**
 * @param {{
 *   executionUserId: string,
 *   now?: string,
 *   limit?: number | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null
 * }} input
 * @returns {Array<{
 *   motion: import("../schema/motion.js").motionViewSchema._type,
 *   account: import("../schema/target-account.js").targetAccountSchema._type,
 *   prospect: import("../schema/target-account.js").prospectSchema._type
 * }>}
 */
export function listDueProspectBranches(input) {
  return listPlannerProspectBranches({
    ...input,
    dueOnly: true,
  });
}

/**
 * @param {{
 *   executionUserId?: string | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null
 * }} [input]
 * @returns {Array<{
 *   motion: import("../schema/motion.js").motionViewSchema._type,
 *   account: import("../schema/target-account.js").targetAccountSchema._type,
 *   prospect: import("../schema/target-account.js").prospectSchema._type
 * }>}
 */
export function listAgentQueueProspectBranches(input = {}) {
  const rows = getLocalDatabase()
    .prepare(`
      SELECT
        prospects.id AS prospect_id,
        prospects.motion_id AS motion_id,
        prospects.motion_account_id AS motion_account_id
      FROM prospects
      JOIN motion_accounts ON motion_accounts.id = prospects.motion_account_id
      JOIN motions ON motions.id = prospects.motion_id
      WHERE motions.status = 'active'
        AND ${workableBranchPredicateSql}
        AND (@executionUserId IS NULL OR motion_accounts.execution_user_id = @executionUserId OR motion_accounts.execution_user_id IS NULL)
        AND (@motionId IS NULL OR prospects.motion_id = @motionId)
        AND (@companyId IS NULL OR prospects.company_id = @companyId)
        AND (@prospectId IS NULL OR prospects.id = @prospectId)
      ORDER BY motion_accounts.created_at ASC, prospects.created_at ASC
    `)
    .all({
      executionUserId: input.executionUserId ?? null,
      motionId: input.motionId ?? null,
      companyId: input.companyId ?? null,
      prospectId: input.prospectId ?? null,
    });

  return rows
    .map((row) => hydrateMotionProspectBranch(row))
    .filter(Boolean);
}

/**
 * @param {{
 *   executionUserId?: string | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null
 * }} [input]
 * @returns {Array<{
 *   motion: import("../schema/motion.js").motionViewSchema._type,
 *   account: import("../schema/target-account.js").targetAccountSchema._type
 * }>}
 */
export function listOutboundCapacityAccounts(input = {}) {
  const rows = getLocalDatabase()
    .prepare(`
      SELECT
        motion_accounts.id AS motion_account_id,
        motion_accounts.motion_id AS motion_id
      FROM motion_accounts
      JOIN motions ON motions.id = motion_accounts.motion_id
      WHERE motions.status = 'active'
        AND motion_accounts.disposition = 'active'
        AND motion_accounts.queue_status NOT IN ('suppressed', 'exhausted')
        AND (@executionUserId IS NULL OR motion_accounts.execution_user_id = @executionUserId OR motion_accounts.execution_user_id IS NULL)
        AND (@motionId IS NULL OR motion_accounts.motion_id = @motionId)
        AND (@companyId IS NULL OR motion_accounts.company_id = @companyId)
        AND (
          @prospectId IS NULL
          OR EXISTS (
            SELECT 1
            FROM prospects
            WHERE prospects.motion_account_id = motion_accounts.id
              AND prospects.id = @prospectId
              AND ${workableProspectPredicateSql}
          )
        )
      ORDER BY motion_accounts.created_at ASC
    `)
    .all({
      executionUserId: input.executionUserId ?? null,
      motionId: input.motionId ?? null,
      companyId: input.companyId ?? null,
      prospectId: input.prospectId ?? null,
    });

  return rows
    .map((row) => hydrateMotionAccountBranch(row, {
      prospectId: input.prospectId ?? null,
      workableProspectsOnly: true,
    }))
    .filter(Boolean);
}

/**
 * @param {{
 *   executionUserId: string,
 *   now?: string,
 *   limit?: number | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   dueOnly?: boolean
 * }} input
 * @returns {Array<{
 *   motion: import("../schema/motion.js").motionViewSchema._type,
 *   account: import("../schema/target-account.js").targetAccountSchema._type,
 *   prospect: import("../schema/target-account.js").prospectSchema._type
 * }>}
 */
export function listPlannerProspectBranches(input) {
  const now = input.now ?? new Date().toISOString();
  const limit = Number.isInteger(input.limit) && input.limit && input.limit > 0
    ? `LIMIT ${Math.floor(input.limit)}`
    : "";
  const rows = getLocalDatabase()
    .prepare(`
      SELECT
        prospects.id AS prospect_id,
        prospects.motion_id AS motion_id,
        prospects.motion_account_id AS motion_account_id
      FROM prospects
      JOIN motion_accounts ON motion_accounts.id = prospects.motion_account_id
      JOIN motions ON motions.id = prospects.motion_id
      WHERE (
          motion_accounts.execution_user_id = @executionUserId
          OR motion_accounts.execution_user_id IS NULL
        )
        AND motions.status = 'active'
        AND prospects.cadence_status = 'ready'
        AND ${workableBranchPredicateSql}
        AND (@motionId IS NULL OR prospects.motion_id = @motionId)
        AND (@companyId IS NULL OR prospects.company_id = @companyId)
        AND (@prospectId IS NULL OR prospects.id = @prospectId)
        AND (
          @dueOnly = 0
          OR prospects.cadence_next_action_due_at IS NULL
          OR prospects.cadence_next_action_due_at <= @now
        )
      ORDER BY
        CASE WHEN @dueOnly = 1 THEN prospects.cadence_next_action_due_at END ASC,
        CASE WHEN @dueOnly = 1 THEN prospects.updated_at END ASC,
        motion_accounts.created_at ASC,
        prospects.created_at ASC
      ${limit}
    `)
    .all({
      executionUserId: input.executionUserId,
      motionId: input.motionId ?? null,
      companyId: input.companyId ?? null,
      prospectId: input.prospectId ?? null,
      dueOnly: input.dueOnly === true ? 1 : 0,
      now,
    });

  return rows
    .map((row) => hydrateMotionProspectBranch(row))
    .filter(Boolean);
}

/**
 * @param {string} id
 */
export function deleteMotion(id) {
  getLocalDatabase()
    .prepare("DELETE FROM motions WHERE id = ?")
    .run(id);
}

/**
 * @param {unknown[]} motions
 * @returns {import("../schema/motion.js").motionViewSchema._type[]}
 */
export function hydrateMotionViews(motions) {
  return motions.map(hydrateMotionView);
}

/**
 * @param {unknown} motion
 * @returns {import("../schema/motion.js").motionViewSchema._type}
 */
export function hydrateMotionView(motion) {
  const view = toMotionView(motion);
  const accounts = buildHydratedTargetAccounts(view.id);
  if (!accounts.length) return view;
  return toMotionView({
    ...view,
    targetMap: {
      status: "ready",
      accounts,
      segments: view.targetMap?.segments ?? view.targetingProfile.segmentVariants,
    },
  });
}

/**
 * @param {unknown} motion
 * @returns {import("../schema/motion.js").motionCoreSchema._type}
 */
export function toMotionCore(motion) {
  return motionCoreSchema.parse(toMotionView(motion));
}

/**
 * @param {any} row
 * @returns {import("../schema/motion.js").motionViewSchema._type}
 */
function hydrateMotionRow(row) {
  const source = JSON.parse(row.payload_json);
  const view = toMotionView({
    ...source,
    id: row.id,
    version: row.version ?? source.version ?? 1,
    name: row.name,
    status: row.status,
    updatedAt: source.updatedAt ?? row.updated_at,
    offer: {
      ...(source.offer ?? {}),
      sourceUrl: source.offer?.sourceUrl ?? row.source_url,
    },
  });
  return hydrateMotionView(view);
}

/**
 * @param {unknown} motion
 * @returns {import("../schema/motion.js").motionViewSchema._type}
 */
function toMotionView(motion) {
  return motionViewSchema.parse(rehydrateMotion(motion).motion);
}

/**
 * @param {string} motionId
 * @returns {import("../schema/target-account.js").targetAccountSchema._type[]}
 */
function buildHydratedTargetAccounts(motionId) {
  const rows = getLocalDatabase()
    .prepare(`
      SELECT *
      FROM motion_accounts
      WHERE motion_id = ?
      ORDER BY created_at ASC
    `)
    .all(motionId);

  return rows.map((row) => hydrateTargetAccountRow(row));
}

/**
 * @param {any} row
 * @returns {import("../schema/target-account.js").targetAccountSchema._type}
 */
function hydrateTargetAccountRow(row, options = {}) {
  const payload = parsePayload(row);
  const company = findNormalizedCompanyById(row.company_id);
  const prospects = hydrateProspectsForAccount(row.id, row.company_id, options);
  const signalMatches = hydrateSignalMatchesForAccount(row.id);
  const currentPacketState = buildPacketState(row, packetKindForAccountRow(row, payload.packetState), payload.packetState);

  return rehydrateTargetAccount({
    ...payload,
    companyId: row.company_id,
    companyName: company?.name ?? payload.companyName ?? "Unknown company",
    domain: company?.domain ?? payload.domain ?? null,
    websiteUrl: company?.websiteUrl ?? payload.websiteUrl ?? null,
    linkedinCompanyUrl: company?.linkedinCompanyUrl ?? payload.linkedinCompanyUrl ?? null,
    signalMatches,
    prospects,
    queueState: {
      ...(payload.queueState ?? {}),
      status: row.queue_status,
      source: queueStateSourceForAccountRow(row, payload.queueState),
      updatedAt: row.updated_at,
    },
    disposition: row.disposition ?? "active",
    packetStatus: row.packet_status ?? null,
    packetState: currentPacketState ?? payload.packetState ?? null,
    lastResearchAt: row.last_research_at ?? null,
    notes: payload.notes ?? null,
  });
}

/**
 * @param {string} motionAccountId
 * @param {string} companyId
 */
function hydrateProspectsForAccount(motionAccountId, companyId, options = {}) {
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM prospects
      WHERE motion_account_id = @motionAccountId
        AND (@prospectId IS NULL OR id = @prospectId)
        AND (
          @workableProspectsOnly = 0
          OR ${workableProspectPredicateSql}
        )
      ORDER BY created_at ASC
    `)
    .all({
      motionAccountId,
      prospectId: options.prospectId ?? null,
      workableProspectsOnly: options.workableProspectsOnly === true ? 1 : 0,
    })
    .map((row) => hydrateProspectRow(row, companyId));
}

/**
 * @param {{ motion_id: string, motion_account_id: string }} row
 * @param {{ prospectId?: string | null, workableProspectsOnly?: boolean }} [options]
 * @returns {{
 *   motion: import("../schema/motion.js").motionViewSchema._type,
 *   account: import("../schema/target-account.js").targetAccountSchema._type
 * } | null}
 */
function hydrateMotionAccountBranch(row, options = {}) {
  const database = getLocalDatabase();
  const motionRow = database.prepare("SELECT * FROM motions WHERE id = ?").get(row.motion_id);
  const accountRow = database.prepare("SELECT * FROM motion_accounts WHERE id = ?").get(row.motion_account_id);
  if (!motionRow || !accountRow) return null;

  const source = JSON.parse(motionRow.payload_json);
  const baseMotion = toMotionView({
    ...source,
    id: motionRow.id,
    version: motionRow.version ?? source.version ?? 1,
    name: motionRow.name,
    status: motionRow.status,
    updatedAt: source.updatedAt ?? motionRow.updated_at,
    offer: {
      ...(source.offer ?? {}),
      sourceUrl: source.offer?.sourceUrl ?? motionRow.source_url,
    },
  });
  const account = hydrateTargetAccountRow(accountRow, {
    prospectId: options.prospectId ?? null,
    workableProspectsOnly: options.workableProspectsOnly === true,
  });

  if (options.prospectId && !account.prospects.some((prospect) => prospect.id === options.prospectId)) {
    return null;
  }

  const motion = toMotionView({
    ...baseMotion,
    targetMap: {
      status: "ready",
      accounts: [account],
      segments: baseMotion.targetMap?.segments ?? baseMotion.targetingProfile.segmentVariants,
    },
  });
  return { motion, account };
}

/**
 * @param {{ motion_id: string, motion_account_id: string, prospect_id: string }} row
 * @returns {{
 *   motion: import("../schema/motion.js").motionViewSchema._type,
 *   account: import("../schema/target-account.js").targetAccountSchema._type,
 *   prospect: import("../schema/target-account.js").prospectSchema._type
 * } | null}
 */
function hydrateMotionProspectBranch(row) {
  const database = getLocalDatabase();
  const motionRow = database.prepare("SELECT * FROM motions WHERE id = ?").get(row.motion_id);
  const accountRow = database.prepare("SELECT * FROM motion_accounts WHERE id = ?").get(row.motion_account_id);
  if (!motionRow || !accountRow) return null;

  const source = JSON.parse(motionRow.payload_json);
  const baseMotion = toMotionView({
    ...source,
    id: motionRow.id,
    version: motionRow.version ?? source.version ?? 1,
    name: motionRow.name,
    status: motionRow.status,
    updatedAt: source.updatedAt ?? motionRow.updated_at,
    offer: {
      ...(source.offer ?? {}),
      sourceUrl: source.offer?.sourceUrl ?? motionRow.source_url,
    },
  });
  const account = hydrateTargetAccountRow(accountRow, { prospectId: row.prospect_id });
  const prospect = account.prospects.find((item) => item.id === row.prospect_id) ?? null;
  if (!prospect) return null;

  const motion = toMotionView({
    ...baseMotion,
    targetMap: {
      status: "ready",
      accounts: [account],
      segments: baseMotion.targetMap?.segments ?? baseMotion.targetingProfile.segmentVariants,
    },
  });
  return { motion, account, prospect };
}

/**
 * @param {any} row
 * @param {string} companyId
 */
function hydrateProspectRow(row, companyId) {
  const payload = parsePayload(row);
  const person = findPersonById(row.person_id);
  const employment = findCurrentEmployment(row.person_id, companyId);
  const normalizedContactPoints = listContactPointsForPerson(row.person_id).map(toViewContactPoint);
  const contactPoints = mergeContactPointLists(payload.contactPoints ?? [], normalizedContactPoints);
  const linkedinProfileUrl =
    payload.linkedinProfileUrl
    ?? buildLinkedinProfileUrlFromPublicId(person?.linkedinPublicId ?? null);
  const currentPacketState = buildPacketState(row, "prospect_research", payload.packetState);

  return {
    ...payload,
    id: row.id,
    name: person?.name ?? payload.name ?? "Unknown prospect",
    title: payload.title ?? employment?.title ?? "Unknown role",
    linkedinProfileUrl,
    email: payload.email ?? person?.primaryEmail ?? null,
    sourceUrl: payload.sourceUrl ?? linkedinProfileUrl ?? null,
    observedAt: payload.observedAt ?? row.created_at,
    whyRelevant: payload.whyRelevant ?? "Selected for this motion.",
    contactPoints,
    queueState: {
      ...(payload.queueState ?? {}),
      status: row.queue_status,
      updatedAt: row.updated_at,
    },
    disposition: row.disposition ?? "active",
    packetStatus: row.packet_status ?? null,
    packetState: currentPacketState ?? payload.packetState ?? null,
    cadenceState: {
      ...(payload.cadenceState ?? {}),
      status: row.cadence_status,
      currentStep: row.cadence_current_step ?? null,
      lastTouchOutcome: row.cadence_last_touch_outcome ?? null,
      lastTouchAt: row.cadence_last_touch_at ?? null,
      nextActionDueAt: row.cadence_next_action_due_at ?? null,
      updatedAt: row.updated_at,
    },
    touches: hydrateTouchesForProspect(row.id),
    drafts: hydrateDraftsForProspect(row.id),
    timelineNotes: hydrateTimelineNotesForProspect(row.id),
  };
}

/**
 * @param {string} personId
 * @param {string} companyId
 */
function findCurrentEmployment(personId, companyId) {
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM employments
      WHERE person_id = @personId
        AND company_id = @companyId
        AND is_current = 1
      ORDER BY observed_at DESC, updated_at DESC
      LIMIT 1
    `)
    .get({ personId, companyId }) ?? null;
}

/**
 * @param {string} prospectId
 */
function hydrateTouchesForProspect(prospectId) {
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM activity_events
      WHERE prospect_id = ?
        AND kind = 'touch'
      ORDER BY occurred_at ASC, recorded_at ASC
    `)
    .all(prospectId)
    .map(toViewTouch);
}

/**
 * @param {string} prospectId
 */
function hydrateTimelineNotesForProspect(prospectId) {
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM activity_events
      WHERE prospect_id = ?
        AND kind = 'timeline_note'
      ORDER BY occurred_at ASC, recorded_at ASC
    `)
    .all(prospectId)
    .map(toViewTimelineNote);
}

/**
 * @param {string} prospectId
 */
function hydrateDraftsForProspect(prospectId) {
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM prospect_drafts
      WHERE prospect_id = ?
      ORDER BY created_at ASC, updated_at ASC
    `)
    .all(prospectId)
    .map(toViewDraft);
}

/**
 * @param {string} motionAccountId
 */
function hydrateSignalMatchesForAccount(motionAccountId) {
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM signal_matches
      WHERE motion_account_id = ?
      ORDER BY created_at ASC
    `)
    .all(motionAccountId)
    .map(toViewSignalMatch);
}

/**
 * @param {import("../schema/motion.js").motionViewSchema._type} motion
 */
function replaceMotionTargetMapRows(motion) {
  const database = getLocalDatabase();
  database.prepare("DELETE FROM prospect_drafts WHERE motion_id = ?").run(motion.id);
  database.prepare("DELETE FROM activity_events WHERE motion_id = ?").run(motion.id);
  database.prepare("DELETE FROM signal_matches WHERE motion_id = ?").run(motion.id);
  database.prepare("DELETE FROM prospects WHERE motion_id = ?").run(motion.id);
  database.prepare("DELETE FROM motion_accounts WHERE motion_id = ?").run(motion.id);

  for (const account of motion.targetMap.accounts) {
    const company = findOrCreateCompany({
      id: account.companyId,
      name: account.companyName,
      domain: account.domain,
      websiteUrl: account.websiteUrl,
      linkedinCompanyUrl: account.linkedinCompanyUrl,
    });
    const motionAccount = upsertMotionAccount({
      id: buildMotionAccountId(motion.id, company.id),
      motionId: motion.id,
      companyId: company.id,
      executionUserId: motion.engagementUserAssignment?.userId ?? null,
      queueStatus: account.queueState?.status ?? "discovered",
      disposition: account.disposition,
      packetStatus: account.packetStatus ?? packetStatusFromPacketState(account.packetState),
      lastResearchAt: account.lastResearchAt,
      payload: {
        ...account,
        companyId: company.id,
        prospects: undefined,
        signalMatches: undefined,
      },
    });

    for (const signalMatch of account.signalMatches ?? []) {
      upsertSignalMatch({
        id: signalMatch.id,
        motionAccountId: motionAccount.id,
        motionId: motion.id,
        companyId: company.id,
        observedAt: signalMatch.observedAt,
        payload: signalMatch,
      });
    }

    for (const prospect of account.prospects ?? []) {
      syncProspectFromView({ motion, companyId: company.id, motionAccountId: motionAccount.id, prospect });
    }
  }
}

/**
 * @param {{
 *   motion: import("../schema/motion.js").motionViewSchema._type,
 *   companyId: string,
 *   motionAccountId: string,
 *   prospect: import("../schema/target-account.js").prospectSchema._type
 * }} input
 */
function syncProspectFromView(input) {
  const person = resolvePersonForViewProspect(input.prospect);
  upsertEmployment({
    personId: person.id,
    companyId: input.companyId,
    title: input.prospect.title,
    source: "motion-view",
    observedAt: input.prospect.observedAt ?? input.motion.updatedAt,
  });
  moveProspectIdIntoMotion(input.prospect.id, input.motion.id);
  const row = upsertProspect({
    id: input.prospect.id,
    motionId: input.motion.id,
    companyId: input.companyId,
    motionAccountId: input.motionAccountId,
    personId: person.id,
    queueStatus: input.prospect.queueState?.status ?? "selected",
    disposition: input.prospect.disposition,
    packetStatus: input.prospect.packetStatus ?? packetStatusFromPacketState(input.prospect.packetState),
    cadenceStatus: input.prospect.cadenceState?.status ?? "pending",
    cadenceCurrentStep: input.prospect.cadenceState?.currentStep ?? null,
    cadenceNextActionDueAt: input.prospect.cadenceState?.nextActionDueAt ?? null,
    cadenceLastTouchAt: input.prospect.cadenceState?.lastTouchAt ?? null,
    cadenceLastTouchOutcome: input.prospect.cadenceState?.lastTouchOutcome ?? null,
    payload: {
      ...input.prospect,
      personId: person.id,
      touches: undefined,
      drafts: undefined,
      timelineNotes: undefined,
    },
  });

  for (const touch of input.prospect.touches ?? []) {
    appendActivityEvent({
      id: touch.id,
      dedupeKey: `touch:${input.motion.id}:${row.id}:${touch.id}`,
      kind: "touch",
      personId: person.id,
      prospectId: row.id,
      motionId: input.motion.id,
      companyId: input.companyId,
      surface: touch.surface,
      direction: touch.direction,
      outcome: touch.outcome,
      occurredAt: touch.occurredAt,
      payload: touch,
    });
  }

  for (const note of input.prospect.timelineNotes ?? []) {
    appendActivityEvent({
      id: note.id,
      dedupeKey: `timeline-note:${input.motion.id}:${row.id}:${note.id}`,
      kind: "timeline_note",
      personId: person.id,
      prospectId: row.id,
      motionId: input.motion.id,
      companyId: input.companyId,
      surface: null,
      direction: "system",
      outcome: null,
      occurredAt: note.createdAt,
      payload: note,
    });
  }

  for (const draft of input.prospect.drafts ?? []) {
    upsertProspectDraft({
      id: draft.id,
      prospectId: row.id,
      motionId: input.motion.id,
      personId: person.id,
      surface: draft.surface,
      channel: draft.channel,
      status: draft.status,
      authoredBy: draft.authoredBy,
      subject: draft.subject,
      body: draft.body,
      editedByOperator: draft.editedByOperator,
      approvedByOperator: draft.approvedByOperator,
      approvedAt: draft.approvedAt,
      sentAt: draft.sentAt,
      payload: draft,
      now: draft.createdAt,
    });
  }
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function resolvePersonForViewProspect(prospect) {
  const personId = prospect.personId ?? `person-${prospect.id}`;
  const existing = findPersonById(personId);
  if (existing) return existing;

  const contactPoints = [...(prospect.contactPoints ?? [])].map((point) => ({
    kind: point.kind === "linkedin_profile" ? "linkedin_profile_url" : point.kind,
    value: point.value,
    verificationStatus: point.verificationStatus,
    confidence: point.confidence === "high" ? 1 : point.confidence === "moderate" ? 0.7 : point.confidence === "low" ? 0.3 : null,
    source: point.source,
    observedAt: point.observedAt,
  }));
  if (prospect.linkedinProfileUrl) {
    contactPoints.push({
      kind: "linkedin_profile_url",
      value: prospect.linkedinProfileUrl,
      verificationStatus: "observed",
      confidence: 1,
      source: "motion-view",
      observedAt: prospect.profileViewedAt ?? prospect.observedAt,
    });
  }
  if (prospect.email) {
    contactPoints.push({
      kind: "email",
      value: prospect.email,
      verificationStatus: "verified",
      confidence: 1,
      source: "motion-view",
      observedAt: prospect.observedAt,
    });
  }

  return resolvePersonIdentity({
    id: personId,
    name: prospect.name,
    contactPoints,
  }).person;
}

/**
 * @param {any} row
 */
function toViewContactPoint(row) {
  const payload = parsePayload(row);
  const kind = row.kind === "linkedin_profile_url" ? "linkedin_profile" : row.kind;
  const value = kind === "linkedin_profile" && !/^https?:\/\//i.test(row.value)
    ? buildLinkedinProfileUrlFromPublicId(row.value)
    : row.value;

  return {
    ...payload,
    id: row.id,
    kind,
    value,
    label: payload.label ?? null,
    matchStatus: row.match_status,
    verificationStatus: row.verification_status,
    confidence: mapConfidence(row.confidence),
    source: row.source ?? payload.source ?? null,
    sourceUrl: payload.sourceUrl ?? null,
    observedAt: row.observed_at ?? payload.observedAt ?? null,
    notes: payload.notes ?? null,
    evidence: payload.evidence ?? [],
    usableForOutreach: payload.usableForOutreach ?? (kind === "email" || kind === "linkedin_profile"),
    usableForResearch: payload.usableForResearch ?? true,
    usableForWarmup: payload.usableForWarmup ?? kind === "linkedin_profile",
  };
}

/**
 * @param {any} row
 */
function toViewTouch(row) {
  const payload = unwrapPayloadEnvelope(parsePayload(row));
  return {
    ...payload,
    id: row.id,
    surface: row.surface ?? payload.surface ?? "connection_request",
    direction: row.direction ?? payload.direction ?? "system",
    outcome: row.outcome ?? payload.outcome ?? "pending",
    occurredAt: row.occurred_at,
    summary: payload.summary ?? buildTouchSummary(row),
    subject: payload.subject ?? null,
    body: payload.body ?? null,
    sourceUrl: payload.sourceUrl ?? null,
    notes: payload.notes ?? null,
  };
}

/**
 * @param {any} row
 */
function toViewTimelineNote(row) {
  const payload = unwrapPayloadEnvelope(parsePayload(row));
  return {
    id: row.id,
    kind: payload.kind ?? "note",
    body: payload.body ?? payload.summary ?? "Timeline note",
    author: payload.author ?? null,
    createdAt: payload.createdAt ?? row.occurred_at,
  };
}

/**
 * @param {any} row
 */
function toViewDraft(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    surface: row.surface,
    channel: row.channel,
    subject: payload.subject ?? null,
    body: payload.body ?? "",
    status: row.status,
    authoredBy: row.authored_by,
    editedByOperator: row.edited_by_operator === 1,
    approvedByOperator: row.approved_by_operator === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at ?? null,
    sentAt: row.sent_at ?? null,
    notes: payload.notes ?? null,
  };
}

/**
 * @param {any} row
 */
function toViewSignalMatch(row) {
  const stored = parsePayload(row);
  const payload = unwrapPayloadEnvelope(stored);
  const summary = payload.summary ?? "Signal match";
  return {
    id: row.id,
    signalId: payload.signalId ?? row.id,
    signalName: payload.signalName ?? summary,
    signalScope: payload.signalScope ?? "company",
    summary,
    sourceUrl: payload.sourceUrl ?? null,
    sourceLabel: payload.sourceLabel ?? null,
    observedAt: row.observed_at ?? payload.observedAt ?? null,
    recordedAt: payload.recordedAt ?? row.created_at,
    confidence: payload.confidence ?? "unknown",
    evidenceSnippet: payload.evidenceSnippet ?? null,
    notes: payload.notes ?? null,
    subject: payload.subject ?? { type: "company", personName: null, personTitle: null },
  };
}

/**
 * @param {string} prospectId
 * @param {string} motionId
 */
function moveProspectIdIntoMotion(prospectId, motionId) {
  getLocalDatabase()
    .prepare(`
      DELETE FROM prospect_drafts
      WHERE prospect_id IN (
        SELECT id
        FROM prospects
        WHERE id = @prospectId
          AND motion_id != @motionId
      )
    `)
    .run({ prospectId, motionId });
  getLocalDatabase()
    .prepare(`
      DELETE FROM prospects
      WHERE id = @prospectId
        AND motion_id != @motionId
    `)
    .run({ prospectId, motionId });
}

const workableProspectPredicateSql = `
  prospects.disposition = 'active'
  AND prospects.queue_status NOT IN ('suppressed', 'exhausted', 'held_cross_motion')
`;

/**
 * @param {Record<string, any>} payload
 */
function unwrapPayloadEnvelope(payload) {
  return payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
    ? payload.payload
    : payload;
}

/**
 * @param {any} row
 * @param {"company_research" | "prospect_selection" | "prospect_research"} kind
 * @param {unknown} [payloadPacketState]
 */
function buildPacketState(row, kind, payloadPacketState = null) {
  if (!row.packet_status && !row.packet_claimed_by && !row.packet_claimed_at) return null;
  const payload = payloadPacketState && typeof payloadPacketState === "object" && !Array.isArray(payloadPacketState)
    ? payloadPacketState
    : {};
  return {
    kind,
    status: row.packet_status ?? payload.status ?? "claimed",
    workerLabel: row.packet_claimed_by ?? payload.workerLabel ?? null,
    claimedAt: row.packet_claimed_at ?? payload.claimedAt ?? null,
    completedAt: payload.completedAt ?? null,
    notes: payload.notes ?? null,
    proposal: payload.proposal ?? null,
    returnNotes: payload.returnNotes ?? null,
    returnedAt: payload.returnedAt ?? null,
    reviewer: payload.reviewer ?? null,
  };
}

/**
 * @param {any} row
 * @param {unknown} payloadPacketState
 * @returns {"company_research" | "prospect_selection"}
 */
function packetKindForAccountRow(row, payloadPacketState) {
  if (
    row.packet_status
    && payloadPacketState
    && typeof payloadPacketState === "object"
    && !Array.isArray(payloadPacketState)
    && (payloadPacketState.kind === "company_research" || payloadPacketState.kind === "prospect_selection")
  ) {
    return payloadPacketState.kind;
  }
  return row.queue_status === "researched" ? "prospect_selection" : "company_research";
}

/**
 * @param {any} row
 * @param {unknown} payloadQueueState
 */
function queueStateSourceForAccountRow(row, payloadQueueState) {
  if (["queued_for_research", "suppressed", "exhausted"].includes(row.queue_status)) {
    return "manual";
  }
  if (payloadQueueState && typeof payloadQueueState === "object" && !Array.isArray(payloadQueueState)) {
    const source = payloadQueueState.source;
    if (typeof source === "string" && source.length) return source;
  }
  return "derived";
}

/**
 * @param {unknown} packetState
 * @returns {"claimed" | null}
 */
function packetStatusFromPacketState(packetState) {
  if (!packetState || typeof packetState !== "object" || Array.isArray(packetState)) return null;
  if (packetState.status === "claimed" || packetState.status === "submitted" || packetState.status === "returned") {
    return packetState.status;
  }
  return null;
}

/**
 * @param {any} row
 */
function buildTouchSummary(row) {
  const surface = row.surface ? String(row.surface).replace(/_/g, " ") : "touch";
  return `${row.outcome ?? "Recorded"} ${surface}`;
}

/**
 * @param {number | null | undefined} confidence
 */
function mapConfidence(confidence) {
  if (confidence === null || confidence === undefined) return "unknown";
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "moderate";
  return "low";
}

/**
 * @param {import("../schema/motion.js").motionViewSchema._type} motion
 * @param {import("node:sqlite").DatabaseSync} database
 * @returns {import("../schema/motion.js").motionViewSchema._type}
 */
function ensureUniqueGeneratedMotionName(motion, database) {
  const generatedBaseName = buildMotionName({
    seed: motion.id,
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
      attempt,
    });
  }

  if (candidate === motion.name) {
    return motion;
  }

  return {
    ...motion,
    name: candidate,
  };
}

/**
 * @param {string} name
 * @param {string} motionId
 * @param {import("node:sqlite").DatabaseSync} database
 */
function motionNameExists(name, motionId, database) {
  const row = database
    .prepare(`
      SELECT id
      FROM motions
      WHERE id != @id
        AND name = @name
      LIMIT 1
    `)
    .get({
      id: motionId,
      name,
    });

  return Boolean(row);
}

/**
 * @param {string} motionId
 * @param {string} companyId
 */
function buildMotionAccountId(motionId, companyId) {
  return `motion-account-${motionId}-${companyId}`;
}

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {() => void} callback
 */
function runTransaction(database, callback) {
  database.exec("BEGIN IMMEDIATE");
  try {
    callback();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
