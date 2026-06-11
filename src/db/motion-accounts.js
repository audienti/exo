// @ts-check

import { appendActivityEvent } from "./activity-events.js";
import { getLocalDatabase } from "./database.js";
import { queueStatusForDisposition } from "./lifecycle-state.js";
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
 *   executionUserId?: string | null,
 *   queueStatus?: string,
 *   disposition?: string,
 *   dispositionAt?: string | null,
 *   dispositionActor?: "operator" | "agent" | "system" | null,
 *   packetStatus?: "claimed" | "submitted" | "returned" | null,
 *   lastResearchAt?: string | null,
 *   payload?: Record<string, unknown>,
 *   now?: string
 * }} input
 */
export function upsertMotionAccount(input) {
  const now = input.now ?? new Date().toISOString();
  const existing = getLocalDatabase()
    .prepare("SELECT * FROM motion_accounts WHERE motion_id = @motionId AND company_id = @companyId")
    .get({
      motionId: input.motionId,
      companyId: input.companyId,
    });

  const id = existing?.id ?? input.id ?? createEntityId("motion-account");
  const payload = {
    ...(existing ? parsePayload(existing) : {}),
    ...(input.payload ?? {}),
    id,
    motionId: input.motionId,
    companyId: input.companyId,
  };

  getLocalDatabase().prepare(`
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
      @executionUserId,
      @queueStatus,
      NULL,
      NULL,
      @packetStatus,
      @disposition,
      @dispositionAt,
      @dispositionActor,
      @lastResearchAt,
      @schemaVersion,
      @createdAt,
      @updatedAt,
      @payloadJson
    )
    ON CONFLICT(motion_id, company_id) DO UPDATE SET
      execution_user_id = excluded.execution_user_id,
      queue_status = excluded.queue_status,
      packet_claimed_by = CASE
        WHEN excluded.packet_status = 'claimed' THEN motion_accounts.packet_claimed_by
        ELSE NULL
      END,
      packet_claimed_at = CASE
        WHEN excluded.packet_status = 'claimed' THEN motion_accounts.packet_claimed_at
        ELSE NULL
      END,
      packet_status = excluded.packet_status,
      disposition = excluded.disposition,
      disposition_at = excluded.disposition_at,
      disposition_actor = excluded.disposition_actor,
      last_research_at = excluded.last_research_at,
      schema_version = excluded.schema_version,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run({
    id,
    motionId: input.motionId,
    companyId: input.companyId,
    executionUserId: input.executionUserId ?? existing?.execution_user_id ?? null,
    queueStatus: input.queueStatus ?? existing?.queue_status ?? "discovered",
    packetStatus: input.packetStatus !== undefined ? input.packetStatus : existing?.packet_status ?? null,
    disposition: input.disposition ?? existing?.disposition ?? "active",
    dispositionAt: input.dispositionAt ?? existing?.disposition_at ?? null,
    dispositionActor: input.dispositionActor ?? existing?.disposition_actor ?? null,
    lastResearchAt: input.lastResearchAt ?? existing?.last_research_at ?? null,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    createdAt: existing?.created_at ?? now,
    updatedAt: now,
    payloadJson: toPayloadJson(payload),
  });

  return findMotionAccountById(id);
}

/**
 * @param {string} id
 */
export function findMotionAccountById(id) {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM motion_accounts WHERE id = ?")
    .get(id);
  return row ? motionAccountFromRow(row) : null;
}

/**
 * @param {string} motionId
 * @param {string} companyId
 */
export function findMotionAccountByMotionAndCompany(motionId, companyId) {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM motion_accounts WHERE motion_id = @motionId AND company_id = @companyId")
    .get({ motionId, companyId });
  return row ? motionAccountFromRow(row) : null;
}

/**
 * @param {string} id
 * @param {{ workerLabel: string, claimedAt?: string }} input
 */
export function claimMotionAccountPacket(id, input) {
  const row = getLocalDatabase()
    .prepare(`
      UPDATE motion_accounts
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
  return row ? motionAccountFromRow(row) : null;
}

/**
 * @param {string} id
 */
export function releaseMotionAccountPacket(id) {
  return clearMotionAccountPacket(id);
}

/**
 * @param {string} id
 * @param {{ now?: string }} [input]
 */
export function submitMotionAccountPacket(id, input = {}) {
  return updateMotionAccountPacketStatus(id, "submitted", input.now);
}

/**
 * @param {string} id
 * @param {{ now?: string }} [input]
 */
export function returnMotionAccountPacket(id, input = {}) {
  return updateMotionAccountPacketStatus(id, "returned", input.now);
}

/**
 * @param {string} id
 * @param {{ now?: string }} [input]
 */
export function acceptMotionAccountPacket(id, input = {}) {
  return clearMotionAccountPacket(id, input);
}

/**
 * @param {string} id
 * @param {{ now?: string }} [input]
 */
export function clearMotionAccountPacket(id, input = {}) {
  const row = getLocalDatabase()
    .prepare(`
      UPDATE motion_accounts
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
  return row ? motionAccountFromRow(row) : null;
}

/**
 * @param {string} id
 * @param {{ disposition: string, actor: "operator" | "agent" | "system", reason?: string | null, at?: string }} input
 */
export function setAccountDisposition(id, input) {
  const database = getLocalDatabase();
  const now = input.at ?? new Date().toISOString();
  return runTransaction(() => {
    const existing = database.prepare("SELECT * FROM motion_accounts WHERE id = ?").get(id);
    if (!existing) return null;
    const nextQueueStatus = queueStatusForAccountDisposition(input.disposition, existing);
    const row = database.prepare(`
      UPDATE motion_accounts
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
      dedupeKey: `account-disposition:${id}:${existing.disposition ?? "active"}:${input.disposition}:${now}`,
      kind: "system",
      motionId: existing.motion_id,
      companyId: existing.company_id,
      direction: "system",
      occurredAt: now,
      payload: {
        type: "disposition_changed",
        subject: "account",
        from: existing.disposition ?? "active",
        to: input.disposition,
        reason: input.reason ?? null,
        actor: input.actor,
      },
    });
    return row ? motionAccountFromRow(row) : null;
  });
}

/**
 * @param {string} disposition
 * @param {any} existing
 */
function queueStatusForAccountDisposition(disposition, existing) {
  if (disposition === "active" && isTerminalQueueStatus(existing.queue_status)) {
    const restored = parsePayload(existing).queueState?.status;
    return isRestorableAccountQueueStatus(restored) ? restored : "queued_for_research";
  }
  return queueStatusForDisposition(disposition, existing.queue_status);
}

/**
 * @param {unknown} status
 */
function isRestorableAccountQueueStatus(status) {
  return typeof status === "string"
    && !["suppressed", "exhausted", "held_cross_motion"].includes(status);
}

/**
 * @param {unknown} status
 */
function isTerminalQueueStatus(status) {
  return status === "suppressed" || status === "exhausted";
}

/**
 * @param {any} row
 */
export function motionAccountFromRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    motionId: row.motion_id,
    companyId: row.company_id,
    executionUserId: row.execution_user_id ?? null,
    queueStatus: row.queue_status,
    packetClaimedBy: row.packet_claimed_by ?? null,
    packetClaimedAt: row.packet_claimed_at ?? null,
    packetStatus: row.packet_status ?? null,
    disposition: row.disposition ?? "active",
    dispositionAt: row.disposition_at ?? null,
    dispositionActor: row.disposition_actor ?? null,
    lastResearchAt: row.last_research_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {string} id
 * @param {"submitted" | "returned"} status
 * @param {string | undefined} now
 */
function updateMotionAccountPacketStatus(id, status, now) {
  const updatedAt = now ?? new Date().toISOString();
  const row = getLocalDatabase()
    .prepare(`
      UPDATE motion_accounts
      SET packet_status = @status,
          updated_at = @updatedAt
      WHERE id = @id
      RETURNING *
    `)
    .get({ id, status, updatedAt });
  return row ? motionAccountFromRow(row) : null;
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
