// @ts-check

import { activityEventFromRow } from "./activity-events.js";
import { getLocalDatabase } from "./database.js";
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
  const existing = getLocalDatabase()
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

  getLocalDatabase().prepare(`
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
      schema_version = excluded.schema_version,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    id,
    motionId: input.motionId,
    companyId: input.companyId,
    personId: input.personId,
    motionAccountId: input.motionAccountId,
    queueStatus: input.queueStatus ?? existing?.queue_status ?? "discovered",
    cadenceStatus: input.cadenceStatus ?? existing?.cadence_status ?? "pending",
    cadenceCurrentStep: input.cadenceCurrentStep ?? existing?.cadence_current_step ?? null,
    cadenceNextActionDueAt: input.cadenceNextActionDueAt ?? existing?.cadence_next_action_due_at ?? null,
    cadenceLastTouchAt: input.cadenceLastTouchAt ?? existing?.cadence_last_touch_at ?? null,
    cadenceLastTouchOutcome: input.cadenceLastTouchOutcome ?? existing?.cadence_last_touch_outcome ?? null,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
    payloadJson: toPayloadJson(payload),
  });

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
 * @param {{ workerLabel: string, claimedAt?: string }} input
 */
export function claimProspectPacket(id, input) {
  const row = getLocalDatabase()
    .prepare(`
      UPDATE prospects
      SET packet_claimed_by = @workerLabel,
          packet_claimed_at = @claimedAt,
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
  const row = getLocalDatabase()
    .prepare(`
      UPDATE prospects
      SET packet_claimed_by = NULL,
          packet_claimed_at = NULL,
          updated_at = @updatedAt
      WHERE id = @id
      RETURNING *
    `)
    .get({
      id,
      updatedAt: new Date().toISOString(),
    });
  return row ? prospectFromRow(row) : null;
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
        AND prospects.queue_status NOT IN ('suppressed', 'exhausted', 'held_cross_motion')
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
 * @param {{ personId: string, excludeMotionId?: string | null }} input
 */
export function findCrossMotionOwner(input) {
  const row = getLocalDatabase()
    .prepare(`
      SELECT prospects.*, activity_events.id AS event_id
      FROM prospects
      JOIN activity_events ON activity_events.person_id = prospects.person_id
      WHERE prospects.person_id = @personId
        AND (@excludeMotionId IS NULL OR prospects.motion_id != @excludeMotionId)
        AND prospects.queue_status NOT IN ('suppressed', 'exhausted', 'held_cross_motion')
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
