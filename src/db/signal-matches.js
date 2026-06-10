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
 *   motionAccountId: string,
 *   motionId: string,
 *   companyId: string,
 *   observedAt?: string | null,
 *   payload?: Record<string, unknown>,
 *   now?: string
 * }} input
 */
export function upsertSignalMatch(input) {
  const now = input.now ?? new Date().toISOString();
  const id = input.id ?? createEntityId("signal-match");
  const signal = {
    id,
    motionAccountId: input.motionAccountId,
    motionId: input.motionId,
    companyId: input.companyId,
    observedAt: input.observedAt ?? null,
    payload: input.payload ?? {},
    createdAt: now,
  };
  getLocalDatabase().prepare(`
    INSERT INTO signal_matches (
      id,
      motion_account_id,
      motion_id,
      company_id,
      observed_at,
      created_at,
      schema_version,
      payload_json
    )
    VALUES (
      @id,
      @motionAccountId,
      @motionId,
      @companyId,
      @observedAt,
      @createdAt,
      @schemaVersion,
      @payloadJson
    )
    ON CONFLICT(id) DO UPDATE SET
      observed_at = excluded.observed_at,
      schema_version = excluded.schema_version,
      payload_json = excluded.payload_json
  `).run({
    id: signal.id,
    motionAccountId: signal.motionAccountId,
    motionId: signal.motionId,
    companyId: signal.companyId,
    observedAt: signal.observedAt,
    createdAt: signal.createdAt,
    schemaVersion: NORMALIZED_SCHEMA_VERSION,
    payloadJson: toPayloadJson(signal),
  });
  return findSignalMatchById(id);
}

/**
 * @param {string} motionAccountId
 */
export function listSignalMatchesForMotionAccount(motionAccountId) {
  return getLocalDatabase()
    .prepare(`
      SELECT *
      FROM signal_matches
      WHERE motion_account_id = ?
      ORDER BY observed_at DESC, created_at DESC
    `)
    .all(motionAccountId)
    .map(signalMatchFromRow);
}

/**
 * @param {string} id
 */
function findSignalMatchById(id) {
  const row = getLocalDatabase()
    .prepare("SELECT * FROM signal_matches WHERE id = ?")
    .get(id);
  return row ? signalMatchFromRow(row) : null;
}

/**
 * @param {any} row
 */
function signalMatchFromRow(row) {
  const payload = parsePayload(row);
  return {
    ...payload,
    id: row.id,
    motionAccountId: row.motion_account_id,
    motionId: row.motion_id,
    companyId: row.company_id,
    observedAt: row.observed_at ?? null,
    createdAt: row.created_at,
  };
}
