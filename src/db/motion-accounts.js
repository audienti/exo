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
 *   motionId: string,
 *   companyId: string,
 *   executionUserId?: string | null,
 *   queueStatus?: string,
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
      @lastResearchAt,
      @schemaVersion,
      @createdAt,
      @updatedAt,
      @payloadJson
    )
    ON CONFLICT(motion_id, company_id) DO UPDATE SET
      execution_user_id = excluded.execution_user_id,
      queue_status = excluded.queue_status,
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
 * @param {string} id
 * @param {{ workerLabel: string, claimedAt?: string }} input
 */
export function claimMotionAccountPacket(id, input) {
  const row = getLocalDatabase()
    .prepare(`
      UPDATE motion_accounts
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
  return row ? motionAccountFromRow(row) : null;
}

/**
 * @param {string} id
 */
export function releaseMotionAccountPacket(id) {
  const row = getLocalDatabase()
    .prepare(`
      UPDATE motion_accounts
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
  return row ? motionAccountFromRow(row) : null;
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
    lastResearchAt: row.last_research_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
