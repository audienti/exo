// @ts-check

import { getLocalDatabase } from "./database.js";
import {
  NORMALIZED_SCHEMA_VERSION,
  createEntityId,
  fromSqlBoolean,
  parsePayload,
  toPayloadJson,
  toSqlBoolean,
} from "./normalized-utils.js";

/**
 * @param {{
 *   id?: string,
 *   prospectId: string,
 *   motionId: string,
 *   personId: string,
 *   surface: string,
 *   channel: "linkedin" | "email",
 *   status?: "drafting" | "ready" | "queued" | "approved" | "sent" | "discarded",
 *   authoredBy?: "agent" | "operator",
 *   subject?: string | null,
 *   body?: string,
 *   editedByOperator?: boolean,
 *   approvedByOperator?: boolean,
 *   approvedByUserId?: string | null,
 *   approvedAt?: string | null,
 *   sentAt?: string | null,
 *   payload?: Record<string, unknown>,
 *   now?: string
 * }} input
 */
export function upsertProspectDraft(input) {
  const now = input.now ?? new Date().toISOString();
  const id = input.id ?? createEntityId("draft");
  const draft = {
    id,
    prospectId: input.prospectId,
    motionId: input.motionId,
    personId: input.personId,
    surface: input.surface,
    channel: input.channel,
    status: input.status ?? "drafting",
    authoredBy: input.authoredBy ?? "agent",
    subject: input.subject ?? null,
    body: input.body ?? "",
    editedByOperator: input.editedByOperator ?? false,
    approvedByOperator: input.approvedByOperator ?? false,
    approvedByUserId: input.approvedByUserId ?? null,
    approvedAt: input.approvedAt ?? null,
    sentAt: input.sentAt ?? null,
    payload: input.payload ?? {},
    createdAt: now,
    updatedAt: now,
  };

  getLocalDatabase().prepare(`
    INSERT INTO prospect_drafts (
      id,
      prospect_id,
      motion_id,
      person_id,
      surface,
      channel,
      status,
      authored_by,
      edited_by_operator,
      approved_by_operator,
      approved_by_user_id,
      created_at,
      updated_at,
      approved_at,
      sent_at,
      schema_version,
      payload_json
    )
    VALUES (
      @id,
      @prospectId,
      @motionId,
      @personId,
      @surface,
      @channel,
      @status,
      @authoredBy,
      @editedByOperator,
      @approvedByOperator,
      @approvedByUserId,
      @createdAt,
      @updatedAt,
      @approvedAt,
      @sentAt,
      @schemaVersion,
      @payloadJson
    )
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      authored_by = excluded.authored_by,
      edited_by_operator = excluded.edited_by_operator,
      approved_by_operator = excluded.approved_by_operator,
      approved_by_user_id = excluded.approved_by_user_id,
      updated_at = excluded.updated_at,
      approved_at = excluded.approved_at,
      sent_at = excluded.sent_at,
      schema_version = excluded.schema_version,
      payload_json = excluded.payload_json
  `).run({
    id: draft.id,
    prospectId: draft.prospectId,
    motionId: draft.motionId,
    personId: draft.personId,
    surface: draft.surface,
    channel: draft.channel,
    status: draft.status,
    authoredBy: draft.authoredBy,
    editedByOperator: toSqlBoolean(draft.editedByOperator),
    approvedByOperator: toSqlBoolean(draft.approvedByOperator),
    approvedByUserId: draft.approvedByUserId,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    approvedAt: draft.approvedAt,
    sentAt: draft.sentAt,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    payloadJson: toPayloadJson(draft),
  });

  return findProspectDraftById(draft.id);
}

/**
 * @param {string} id
 * @param {{
 *   status: "drafting" | "ready" | "queued" | "approved" | "sent" | "discarded",
 *   approvedByUserId?: string | null,
 *   approvedAt?: string | null,
 *   sentAt?: string | null,
 *   editedByOperator?: boolean
 * }} input
 */
export function transitionProspectDraftStatus(id, input) {
  const now = new Date().toISOString();
  const row = getLocalDatabase()
    .prepare(`
      UPDATE prospect_drafts
      SET status = @status,
          edited_by_operator = CASE
            WHEN @editedByOperator IS NULL THEN edited_by_operator
            ELSE @editedByOperator
          END,
          approved_by_operator = CASE
            WHEN @status = 'approved' THEN 1
            ELSE approved_by_operator
          END,
          approved_by_user_id = COALESCE(@approvedByUserId, approved_by_user_id),
          approved_at = COALESCE(@approvedAt, approved_at),
          sent_at = CASE
            WHEN @status = 'sent' THEN COALESCE(@sentAt, @updatedAt)
            ELSE sent_at
          END,
          updated_at = @updatedAt
      WHERE id = @id
      RETURNING *
    `)
    .get({
      id,
      status: input.status,
      editedByOperator: input.editedByOperator === undefined ? null : toSqlBoolean(input.editedByOperator),
      approvedByUserId: input.approvedByUserId ?? null,
      approvedAt: input.approvedAt ?? null,
      sentAt: input.sentAt ?? null,
      updatedAt: now,
    });
  return row ? prospectDraftFromRow(row) : null;
}

/**
 * @param {string} id
 */
export function findProspectDraftById(id) {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM prospect_drafts WHERE id = ?")
    .get(id);
  return row ? prospectDraftFromRow(row) : null;
}

/**
 * @param {any} row
 */
function prospectDraftFromRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    prospectId: row.prospect_id,
    motionId: row.motion_id,
    personId: row.person_id,
    surface: row.surface,
    channel: row.channel,
    status: row.status,
    authoredBy: row.authored_by,
    editedByOperator: fromSqlBoolean(row.edited_by_operator),
    approvedByOperator: fromSqlBoolean(row.approved_by_operator),
    approvedByUserId: row.approved_by_user_id ?? null,
    approvedAt: row.approved_at ?? null,
    sentAt: row.sent_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
