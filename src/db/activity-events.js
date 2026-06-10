// @ts-check

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
 *   dedupeKey: string,
 *   kind?: "touch" | "timeline_note" | "system",
 *   personId?: string | null,
 *   prospectId?: string | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   userId?: string | null,
 *   surface?: string | null,
 *   direction?: "outbound" | "inbound" | "system" | null,
 *   outcome?: "pending" | "sent" | "accepted" | "ignored" | "opened-no-reply" | "replied" | "blocked" | "nurture" | null,
 *   occurredAt: string,
 *   recordedAt?: string,
 *   payload?: Record<string, unknown>
 * }} input
 */
export function appendActivityEvent(input) {
  const now = input.recordedAt ?? new Date().toISOString();
  const event = {
    id: input.id ?? createEntityId("event"),
    dedupeKey: input.dedupeKey,
    kind: input.kind ?? "touch",
    personId: input.personId ?? null,
    prospectId: input.prospectId ?? null,
    motionId: input.motionId ?? null,
    companyId: input.companyId ?? null,
    userId: input.userId ?? null,
    surface: input.surface ?? null,
    direction: input.direction ?? null,
    outcome: input.outcome ?? null,
    occurredAt: input.occurredAt,
    recordedAt: now,
    payload: input.payload ?? {},
  };

  getLocalDatabase().prepare(`
    INSERT OR IGNORE INTO activity_events (
      id,
      dedupe_key,
      kind,
      person_id,
      prospect_id,
      motion_id,
      company_id,
      user_id,
      surface,
      direction,
      outcome,
      occurred_at,
      recorded_at,
      schema_version,
      payload_json
    )
    VALUES (
      @id,
      @dedupeKey,
      @kind,
      @personId,
      @prospectId,
      @motionId,
      @companyId,
      @userId,
      @surface,
      @direction,
      @outcome,
      @occurredAt,
      @recordedAt,
      @schemaVersion,
      @payloadJson
    )
  `).run({
    id: event.id,
    dedupeKey: event.dedupeKey,
    kind: event.kind,
    personId: event.personId,
    prospectId: event.prospectId,
    motionId: event.motionId,
    companyId: event.companyId,
    userId: event.userId,
    surface: event.surface,
    direction: event.direction,
    outcome: event.outcome,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    payloadJson: toPayloadJson(event),
  });

  return findActivityEventByDedupeKey(input.dedupeKey);
}

/**
 * @param {string} dedupeKey
 */
export function findActivityEventByDedupeKey(dedupeKey) {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM activity_events WHERE dedupe_key = ?")
    .get(dedupeKey);
  return row ? activityEventFromRow(row) : null;
}

/**
 * @param {{ personId?: string, prospectId?: string, motionId?: string, companyId?: string }} [filters]
 */
export function listActivityEvents(filters = {}) {
  const where = [];
  const params = /** @type {Record<string, string>} */ ({});
  for (const [key, column] of [
    ["personId", "person_id"],
    ["prospectId", "prospect_id"],
    ["motionId", "motion_id"],
    ["companyId", "company_id"],
  ]) {
    const value = filters[key];
    if (value) {
      where.push(`${column} = @${key}`);
      params[key] = value;
    }
  }
  const clauses = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM activity_events
      ${clauses}
      ORDER BY occurred_at DESC, recorded_at DESC
    `)
    .all(params)
    .map(activityEventFromRow);
}

/**
 * @param {any} row
 */
export function activityEventFromRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    dedupeKey: row.dedupe_key,
    kind: row.kind,
    personId: row.person_id ?? null,
    prospectId: row.prospect_id ?? null,
    motionId: row.motion_id ?? null,
    companyId: row.company_id ?? null,
    userId: row.user_id ?? null,
    surface: row.surface ?? null,
    direction: row.direction ?? null,
    outcome: row.outcome ?? null,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  };
}
