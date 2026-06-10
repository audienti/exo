// @ts-check

import { activityEventFromRow, appendActivityEvent } from "./activity-events.js";
import { getLocalDatabase } from "./database.js";
import { queueStatusForDisposition, workableBranchPredicateSql } from "./lifecycle-state.js";
import {
  NORMALIZED_SCHEMA_VERSION,
  createEntityId,
  parsePayload,
  toPayloadJson,
} from "./normalized-utils.js";

/**
 * @param {{
 *   id?: string,
 *   motionId: string,
 *   companyId: string,
 *   personId: string,
 *   motionAccountId: string,
 *   queueStatus?: string,
 *   disposition?: string,
 *   dispositionAt?: string | null,
 *   dispositionActor?: "operator" | "agent" | "system" | null,
 *   packetStatus?: "claimed" | "submitted" | "returned" | null,
 *   cadenceStatus?: "pending" | "ready",
 *   cadenceCurrentStep?: string | null,
 *   cadenceNextActionDueAt?: string | null,
 *   cadenceLastTouchAt?: string | null,
 *   cadenceLastTouchOutcome?: string | null,
 *   payload?: Record<string, unknown>,
 *   now?: string
 * }} input
 */
export function upsertProspect(input) {
  const now = input.now ?? new Date().toISOString();
  const database = getLocalDatabase();
  const existingById = input.id
    ? database.prepare("SELECT * FROM prospects WHERE id = ?").get(input.id)
    : null;
  const existing = existingById ?? database
    .prepare("SELECT * FROM prospects WHERE motion_id = @motionId AND person_id = @personId")
    .get({
      motionId: input.motionId,
      personId: input.personId,
    });
  const id = existing?.id ?? input.id ?? createEntityId("prospect");
  const payload = {
    ...(existing ? parsePayload(existing) : {}),
    ...(input.payload ?? {}),
    id,
    motionId: input.motionId,
    companyId: input.companyId,
    personId: input.personId,
    motionAccountId: input.motionAccountId,
  };
  const params = {
    id,
    motionId: input.motionId,
    companyId: input.companyId,
    personId: input.personId,
    motionAccountId: input.motionAccountId,
    queueStatus: input.queueStatus ?? existing?.queue_status ?? "discovered",
    packetStatus: input.packetStatus !== undefined ? input.packetStatus : existing?.packet_status ?? null,
    disposition: input.disposition ?? existing?.disposition ?? "active",
    dispositionAt: input.dispositionAt ?? existing?.disposition_at ?? null,
    dispositionActor: input.dispositionActor ?? existing?.disposition_actor ?? null,
    cadenceStatus: input.cadenceStatus ?? existing?.cadence_status ?? "pending",
    cadenceCurrentStep: input.cadenceCurrentStep ?? existing?.cadence_current_step ?? null,
    cadenceNextActionDueAt: input.cadenceNextActionDueAt ?? existing?.cadence_next_action_due_at ?? null,
    cadenceLastTouchAt: input.cadenceLastTouchAt ?? existing?.cadence_last_touch_at ?? null,
    cadenceLastTouchOutcome: input.cadenceLastTouchOutcome ?? existing?.cadence_last_touch_outcome ?? null,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
    payloadJson: toPayloadJson(payload),
  };

  if (existingById) {
    const row = database.prepare(`
      UPDATE prospects
      SET motion_id = @motionId,
          company_id = @companyId,
          person_id = @personId,
          motion_account_id = @motionAccountId,
          queue_status = @queueStatus,
          cadence_status = @cadenceStatus,
          cadence_current_step = @cadenceCurrentStep,
          cadence_next_action_due_at = @cadenceNextActionDueAt,
          cadence_last_touch_at = @cadenceLastTouchAt,
          cadence_last_touch_outcome = @cadenceLastTouchOutcome,
          packet_claimed_by = CASE
            WHEN @packetStatus = 'claimed' THEN packet_claimed_by
            ELSE NULL
          END,
          packet_claimed_at = CASE
            WHEN @packetStatus = 'claimed' THEN packet_claimed_at
            ELSE NULL
          END,
          packet_status = @packetStatus,
          disposition = @disposition,
          disposition_at = @dispositionAt,
          disposition_actor = @dispositionActor,
          schema_version = @schemaVersion,
          created_at = @createdAt,
          updated_at = @updatedAt,
          payload_json = @payloadJson
      WHERE id = @id
      RETURNING *
    `).get(params);
    return row ? prospectFromRow(row) : null;
  }

  database.prepare(`
    INSERT INTO prospects (
      id,
      motion_id,
      company_id,
      person_id,
      motion_account_id,
      queue_status,
      cadence_status,
      cadence_current_step,
      cadence_next_action_due_at,
      cadence_last_touch_at,
      cadence_last_touch_outcome,
      packet_claimed_by,
      packet_claimed_at,
      packet_status,
      disposition,
      disposition_at,
      disposition_actor,
      schema_version,
      created_at,
      updated_at,
      payload_json
    )
    VALUES (
      @id,
      @motionId,
      @companyId,
      @personId,
      @motionAccountId,
      @queueStatus,
      @cadenceStatus,
      @cadenceCurrentStep,
      @cadenceNextActionDueAt,
      @cadenceLastTouchAt,
      @cadenceLastTouchOutcome,
      NULL,
      NULL,
      @packetStatus,
      @disposition,
      @dispositionAt,
      @dispositionActor,
      @schemaVersion,
      @createdAt,
      @updatedAt,
      @payloadJson
    )
    ON CONFLICT(motion_id, person_id) DO UPDATE SET
      company_id = excluded.company_id,
      motion_account_id = excluded.motion_account_id,
      queue_status = excluded.queue_status,
      cadence_status = excluded.cadence_status,
      cadence_current_step = excluded.cadence_current_step,
      cadence_next_action_due_at = excluded.cadence_next_action_due_at,
      cadence_last_touch_at = excluded.cadence_last_touch_at,
      cadence_last_touch_outcome = excluded.cadence_last_touch_outcome,
      packet_claimed_by = CASE
        WHEN excluded.packet_status = 'claimed' THEN prospects.packet_claimed_by
        ELSE NULL
      END,
      packet_claimed_at = CASE
        WHEN excluded.packet_status = 'claimed' THEN prospects.packet_claimed_at
        ELSE NULL
      END,
      packet_status = excluded.packet_status,
      disposition = excluded.disposition,
      disposition_at = excluded.disposition_at,
      disposition_actor = excluded.disposition_actor,
      schema_version = excluded.schema_version,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run(params);

  return findProspectById(id);
}

/**
 * @param {string} id
 */
export function findProspectById(id) {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM prospects WHERE id = ?")
    .get(id);
  return row ? prospectFromRow(row) : null;
}

/**
 * @param {string} id
 * @param {{
 *   currentStep?: string | null,
 *   lastTouchChannel?: string | null,
 *   lastTouchOutcome?: string | null,
 *   lastTouchAt?: string | null,
 *   nextAction?: string | null,
 *   nextActionDueAt?: string | null,
 *   blockedChannels?: string[],
 *   requireNewHook?: boolean,
 *   notes?: string | null,
 *   now?: string
 * }} input
 */
export function updateProspectCadence(id, input) {
  const database = getLocalDatabase();
  const existing = database.prepare("SELECT * FROM prospects WHERE id = ?").get(id);
  if (!existing) return null;

  const now = input.now ?? new Date().toISOString();
  const payload = parsePayload(existing);
  const cadenceState = payload.cadenceState && typeof payload.cadenceState === "object"
    ? payload.cadenceState
    : {};
  const nextCadenceState = {
    ...cadenceState,
    status: "ready",
    currentStep: input.currentStep === undefined ? existing.cadence_current_step ?? null : input.currentStep,
    lastTouchChannel: input.lastTouchChannel === undefined ? cadenceState.lastTouchChannel ?? null : input.lastTouchChannel,
    lastTouchOutcome: input.lastTouchOutcome === undefined ? existing.cadence_last_touch_outcome ?? null : input.lastTouchOutcome,
    lastTouchAt: input.lastTouchAt === undefined ? existing.cadence_last_touch_at ?? null : input.lastTouchAt,
    nextAction: input.nextAction === undefined ? cadenceState.nextAction ?? null : input.nextAction,
    nextActionDueAt: input.nextActionDueAt === undefined ? existing.cadence_next_action_due_at ?? null : input.nextActionDueAt,
    blockedChannels: input.blockedChannels === undefined ? cadenceState.blockedChannels ?? [] : input.blockedChannels,
    requireNewHook: input.requireNewHook === undefined ? cadenceState.requireNewHook ?? false : input.requireNewHook,
    notes: input.notes === undefined ? cadenceState.notes ?? null : input.notes,
    updatedAt: now,
  };
  const nextPayload = {
    ...payload,
    cadenceState: nextCadenceState,
  };

  const row = database.prepare(`
    UPDATE prospects
    SET cadence_status = 'ready',
        cadence_current_step = @currentStep,
        cadence_next_action_due_at = @nextActionDueAt,
        cadence_last_touch_at = @lastTouchAt,
        cadence_last_touch_outcome = @lastTouchOutcome,
        updated_at = @updatedAt,
        payload_json = @payloadJson
    WHERE id = @id
    RETURNING *
  `).get({
    id,
    currentStep: nextCadenceState.currentStep,
    nextActionDueAt: nextCadenceState.nextActionDueAt,
    lastTouchAt: nextCadenceState.lastTouchAt,
    lastTouchOutcome: nextCadenceState.lastTouchOutcome,
    updatedAt: now,
    payloadJson: toPayloadJson(nextPayload),
  });
  return row ? prospectFromRow(row) : null;
}

/**
 * @param {string} id
 * @param {{ workerLabel: string, claimedAt?: string }} input
 */
export function claimProspectPacket(id, input) {
  const row = getLocalDatabase()
    .prepare(`
      UPDATE prospects
      SET packet_claimed_by = @workerLabel,
          packet_claimed_at = @claimedAt,
          packet_status = 'claimed',
          updated_at = @claimedAt
      WHERE id = @id
        AND packet_claimed_by IS NULL
      RETURNING *
    `)
    .get({
      id,
      workerLabel: input.workerLabel,
      claimedAt: input.claimedAt ?? new Date().toISOString(),
    });
  return row ? prospectFromRow(row) : null;
}

/**
 * @param {string} id
 */
export function releaseProspectPacket(id) {
  return clearProspectPacket(id);
}

/**
 * @param {string} id
 * @param {{ now?: string }} [input]
 */
export function submitProspectPacket(id, input = {}) {
  return updateProspectPacketStatus(id, "submitted", input.now);
}

/**
 * @param {string} id
 * @param {{ now?: string }} [input]
 */
export function returnProspectPacket(id, input = {}) {
  return updateProspectPacketStatus(id, "returned", input.now);
}

/**
 * @param {string} id
 * @param {{ now?: string }} [input]
 */
export function acceptProspectPacket(id, input = {}) {
  return clearProspectPacket(id, input);
}

/**
 * @param {string} id
 * @param {{ now?: string }} [input]
 */
export function clearProspectPacket(id, input = {}) {
  const row = getLocalDatabase()
    .prepare(`
      UPDATE prospects
      SET packet_claimed_by = NULL,
          packet_claimed_at = NULL,
          packet_status = NULL,
          updated_at = @updatedAt
      WHERE id = @id
      RETURNING *
    `)
    .get({
      id,
      updatedAt: input.now ?? new Date().toISOString(),
    });
  return row ? prospectFromRow(row) : null;
}

/**
 * @param {string} id
 * @param {{ disposition: string, actor: "operator" | "agent" | "system", reason?: string | null, at?: string }} input
 */
export function setProspectDisposition(id, input) {
  const database = getLocalDatabase();
  const now = input.at ?? new Date().toISOString();
  return runTransaction(() => {
    const existing = database.prepare("SELECT * FROM prospects WHERE id = ?").get(id);
    if (!existing) return null;
    const nextQueueStatus = queueStatusForDisposition(input.disposition, existing.queue_status);
    const row = database.prepare(`
      UPDATE prospects
      SET disposition = @disposition,
          disposition_at = @dispositionAt,
          disposition_actor = @dispositionActor,
          queue_status = @queueStatus,
          updated_at = @updatedAt
      WHERE id = @id
      RETURNING *
    `).get({
      id,
      disposition: input.disposition,
      dispositionAt: now,
      dispositionActor: input.actor,
      queueStatus: nextQueueStatus,
      updatedAt: now,
    });
    appendActivityEvent({
      dedupeKey: `prospect-disposition:${id}:${existing.disposition ?? "active"}:${input.disposition}:${now}`,
      kind: "system",
      personId: existing.person_id,
      prospectId: existing.id,
      motionId: existing.motion_id,
      companyId: existing.company_id,
      direction: "system",
      occurredAt: now,
      payload: {
        type: "disposition_changed",
        subject: "prospect",
        from: existing.disposition ?? "active",
        to: input.disposition,
        reason: input.reason ?? null,
        actor: input.actor,
      },
    });
    if ((existing.disposition ?? "active") === "active" && input.disposition !== "active") {
      releaseHeldCrossMotionProspects(database, {
        personId: existing.person_id,
        ownerMotionId: existing.motion_id,
        ownerProspectId: existing.id,
        actor: input.actor,
        now,
      });
    }
    return row ? prospectFromRow(row) : null;
  });
}

/**
 * @param {ReturnType<typeof getLocalDatabase>} database
 * @param {{
 *   personId: string,
 *   ownerMotionId: string,
 *   ownerProspectId: string,
 *   actor: "operator" | "agent" | "system",
 *   now: string
 * }} input
 */
function releaseHeldCrossMotionProspects(database, input) {
  const rows = database.prepare(`
    SELECT *
    FROM prospects
    WHERE person_id = @personId
      AND motion_id != @ownerMotionId
      AND queue_status = 'held_cross_motion'
      AND disposition = 'active'
  `).all({
    personId: input.personId,
    ownerMotionId: input.ownerMotionId,
  });

  for (const held of rows) {
    const payload = parsePayload(held);
    const queueState = {
      ...(payload.queueState ?? {}),
      status: "selected",
      source: "derived",
      updatedAt: input.now,
      notes: null,
    };
    delete queueState.crossMotionOwner;
    database.prepare(`
      UPDATE prospects
      SET queue_status = 'selected',
          updated_at = @updatedAt,
          payload_json = @payloadJson
      WHERE id = @id
    `).run({
      id: held.id,
      updatedAt: input.now,
      payloadJson: toPayloadJson({
        ...payload,
        queueState,
      }),
    });
    appendActivityEvent({
      dedupeKey: `prospect-cross-motion-release:${held.id}:${input.ownerProspectId}:${input.now}`,
      kind: "system",
      personId: held.person_id,
      prospectId: held.id,
      motionId: held.motion_id,
      companyId: held.company_id,
      direction: "system",
      occurredAt: input.now,
      payload: {
        type: "cross_motion_hold_released",
        ownerProspectId: input.ownerProspectId,
        ownerMotionId: input.ownerMotionId,
        actor: input.actor,
      },
    });
  }
}

/**
 * @param {{ executionUserId: string, now?: string, limit?: number }} input
 */
export function listDueProspects(input) {
  const now = input.now ?? new Date().toISOString();
  const limit = Number.isInteger(input.limit) && input.limit ? `LIMIT ${input.limit}` : "";
  return getLocalDatabase()
    .prepare(`
      SELECT prospects.*
      FROM prospects
      JOIN motion_accounts ON motion_accounts.id = prospects.motion_account_id
      WHERE motion_accounts.execution_user_id = @executionUserId
        AND prospects.cadence_status = 'ready'
        AND ${workableBranchPredicateSql}
        AND (
          prospects.cadence_next_action_due_at IS NULL
          OR prospects.cadence_next_action_due_at <= @now
        )
      ORDER BY prospects.cadence_next_action_due_at ASC, prospects.updated_at ASC
      ${limit}
    `)
    .all({
      executionUserId: input.executionUserId,
      now,
    })
    .map(prospectFromRow);
}

/**
 * @param {{
 *   prospectId: string,
 *   toMotionId: string,
 *   now?: string
 * }} input
 */
export function moveProspectToMotionRows(input) {
  const database = getLocalDatabase();
  const now = input.now ?? new Date().toISOString();
  return runTransaction(() => {
    const prospect = database.prepare("SELECT * FROM prospects WHERE id = ?").get(input.prospectId);
    if (!prospect) {
      throw new Error(`Prospect not found: ${input.prospectId}`);
    }
    if (prospect.motion_id === input.toMotionId) {
      return prospectFromRow(prospect);
    }

    const targetMotion = database.prepare("SELECT * FROM motions WHERE id = ?").get(input.toMotionId);
    if (!targetMotion) {
      throw new Error(`Destination motion not found: ${input.toMotionId}`);
    }

    const motionAccount = ensureMotionAccountForMove(database, {
      motionId: input.toMotionId,
      companyId: prospect.company_id,
      now,
    });

    const payload = parsePayload(prospect);
    const moved = database.prepare(`
      UPDATE prospects
      SET motion_id = @motionId,
          motion_account_id = @motionAccountId,
          updated_at = @updatedAt,
          payload_json = @payloadJson
      WHERE id = @id
      RETURNING *
    `).get({
      id: prospect.id,
      motionId: input.toMotionId,
      motionAccountId: motionAccount.id,
      updatedAt: now,
      payloadJson: toPayloadJson({
        ...payload,
        motionId: input.toMotionId,
        motionAccountId: motionAccount.id,
      }),
    });

    database.prepare(`
      UPDATE prospect_drafts
      SET motion_id = @motionId,
          updated_at = @updatedAt
      WHERE prospect_id = @prospectId
    `).run({
      motionId: input.toMotionId,
      prospectId: prospect.id,
      updatedAt: now,
    });

    database.prepare(`
      UPDATE activity_events
      SET motion_id = @motionId,
          company_id = @companyId
      WHERE prospect_id = @prospectId
    `).run({
      motionId: input.toMotionId,
      companyId: prospect.company_id,
      prospectId: prospect.id,
    });

    return moved ? prospectFromRow(moved) : null;
  });
}

/**
 * @param {{ personId: string, excludeMotionId?: string | null }} input
 */
export function findCrossMotionOwner(input) {
  const row = getLocalDatabase()
    .prepare(`
      SELECT prospects.*, activity_events.id AS event_id
      FROM prospects
      JOIN motion_accounts ON motion_accounts.id = prospects.motion_account_id
      JOIN activity_events ON activity_events.person_id = prospects.person_id
      WHERE prospects.person_id = @personId
        AND (@excludeMotionId IS NULL OR prospects.motion_id != @excludeMotionId)
        AND ${workableBranchPredicateSql}
        AND activity_events.direction = 'outbound'
        AND activity_events.outcome IN ('pending', 'sent', 'accepted', 'opened-no-reply')
      ORDER BY activity_events.occurred_at DESC
      LIMIT 1
    `)
    .get({
      personId: input.personId,
      excludeMotionId: input.excludeMotionId ?? null,
    });
  return row ? prospectFromRow(row) : null;
}

/**
 * @param {ReturnType<typeof getLocalDatabase>} database
 * @param {{ motionId: string, companyId: string, now: string }} input
 */
function ensureMotionAccountForMove(database, input) {
  const existing = database.prepare(`
    SELECT *
    FROM motion_accounts
    WHERE motion_id = @motionId
      AND company_id = @companyId
  `).get({
    motionId: input.motionId,
    companyId: input.companyId,
  });
  if (existing) return existing;

  const id = `motion-account-${input.motionId}-${input.companyId}`;
  database.prepare(`
    INSERT INTO motion_accounts (
      id,
      motion_id,
      company_id,
      execution_user_id,
      queue_status,
      packet_claimed_by,
      packet_claimed_at,
      packet_status,
      disposition,
      disposition_at,
      disposition_actor,
      last_research_at,
      schema_version,
      created_at,
      updated_at,
      payload_json
    )
    VALUES (
      @id,
      @motionId,
      @companyId,
      NULL,
      'selected',
      NULL,
      NULL,
      NULL,
      'active',
      NULL,
      NULL,
      @lastResearchAt,
      @schemaVersion,
      @createdAt,
      @updatedAt,
      @payloadJson
    )
  `).run({
    id,
    motionId: input.motionId,
    companyId: input.companyId,
    lastResearchAt: input.now,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    createdAt: input.now,
    updatedAt: input.now,
    payloadJson: toPayloadJson({
      id,
      motionId: input.motionId,
      companyId: input.companyId,
      queueState: {
        status: "selected",
        source: "manual",
        updatedAt: input.now,
        notes: null,
      },
      lastResearchAt: input.now,
    }),
  });
  return database.prepare("SELECT * FROM motion_accounts WHERE id = ?").get(id);
}

/**
 * @param {string} companyId
 */
export function buildAccountRelationshipMap(companyId) {
  const people = getLocalDatabase()
    .prepare(`
      SELECT
        employments.*,
        people.name AS person_name,
        people.linkedin_public_id,
        people.linkedin_member_id,
        latest_event.id AS latest_event_id,
        latest_event.dedupe_key AS latest_event_dedupe_key,
        latest_event.kind AS latest_event_kind,
        latest_event.person_id AS latest_event_person_id,
        latest_event.prospect_id AS latest_event_prospect_id,
        latest_event.motion_id AS latest_event_motion_id,
        latest_event.company_id AS latest_event_company_id,
        latest_event.user_id AS latest_event_user_id,
        latest_event.surface AS latest_event_surface,
        latest_event.direction AS latest_event_direction,
        latest_event.outcome AS latest_event_outcome,
        latest_event.occurred_at AS latest_event_occurred_at,
        latest_event.recorded_at AS latest_event_recorded_at,
        latest_event.payload_json AS latest_event_payload_json
      FROM employments
      JOIN people ON people.id = employments.person_id
      LEFT JOIN activity_events AS latest_event
        ON latest_event.id = (
          SELECT id
          FROM activity_events
          WHERE activity_events.person_id = people.id
          ORDER BY occurred_at DESC, recorded_at DESC
          LIMIT 1
        )
      WHERE employments.company_id = @companyId
        AND employments.is_current = 1
      ORDER BY people.name ASC
    `)
    .all({ companyId })
    .map((row) => ({
      personId: row.person_id,
      name: row.person_name,
      title: row.title ?? null,
      linkedinPublicId: row.linkedin_public_id ?? null,
      linkedinMemberId: row.linkedin_member_id ?? null,
      latestActivity: row.latest_event_id
        ? activityEventFromRow({
          id: row.latest_event_id,
          dedupe_key: row.latest_event_dedupe_key,
          kind: row.latest_event_kind,
          person_id: row.latest_event_person_id,
          prospect_id: row.latest_event_prospect_id,
          motion_id: row.latest_event_motion_id,
          company_id: row.latest_event_company_id,
          user_id: row.latest_event_user_id,
          surface: row.latest_event_surface,
          direction: row.latest_event_direction,
          outcome: row.latest_event_outcome,
          occurred_at: row.latest_event_occurred_at,
          recorded_at: row.latest_event_recorded_at,
          payload_json: row.latest_event_payload_json,
        })
        : null,
    }));

  return { companyId, people };
}

/**
 * @param {any} row
 */
export function prospectFromRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    motionId: row.motion_id,
    companyId: row.company_id,
    personId: row.person_id,
    motionAccountId: row.motion_account_id,
    queueStatus: row.queue_status,
    packetStatus: row.packet_status ?? null,
    disposition: row.disposition ?? "active",
    dispositionAt: row.disposition_at ?? null,
    dispositionActor: row.disposition_actor ?? null,
    cadenceStatus: row.cadence_status,
    cadenceCurrentStep: row.cadence_current_step ?? null,
    cadenceNextActionDueAt: row.cadence_next_action_due_at ?? null,
    cadenceLastTouchAt: row.cadence_last_touch_at ?? null,
    cadenceLastTouchOutcome: row.cadence_last_touch_outcome ?? null,
    packetClaimedBy: row.packet_claimed_by ?? null,
    packetClaimedAt: row.packet_claimed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {string} id
 * @param {"submitted" | "returned"} status
 * @param {string | undefined} now
 */
function updateProspectPacketStatus(id, status, now) {
  const updatedAt = now ?? new Date().toISOString();
  const row = getLocalDatabase()
    .prepare(`
      UPDATE prospects
      SET packet_status = @status,
          updated_at = @updatedAt
      WHERE id = @id
      RETURNING *
    `)
    .get({ id, status, updatedAt });
  return row ? prospectFromRow(row) : null;
}

/**
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
function runTransaction(callback) {
  const database = getLocalDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
