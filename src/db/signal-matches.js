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
 * @param {{ motionId: string, signalId: string }} input
 * @returns {string[]} removed signal-match ids
 */
export function deleteSignalMatchesForSignal(input) {
  const database = getLocalDatabase();
  const rows = database.prepare(`
    SELECT *
    FROM signal_matches
    WHERE motion_id = @motionId
  `).all({ motionId: input.motionId });
  const removedIds = rows
    .filter((row) => signalIdFromRow(row) === input.signalId)
    .map((row) => row.id);
  if (!removedIds.length) return [];

  runTransaction(database, () => {
    for (const id of removedIds) {
      database.prepare("DELETE FROM signal_matches WHERE id = ?").run(id);
    }

    const prospects = database.prepare(`
      SELECT *
      FROM prospects
      WHERE motion_id = @motionId
    `).all({ motionId: input.motionId });
    for (const prospect of prospects) {
      const payload = parsePayload(prospect);
      const originalSignalMatchIds = Array.isArray(payload.signalMatchIds) ? payload.signalMatchIds : [];
      const signalMatchIds = originalSignalMatchIds.filter((id) => !removedIds.includes(id));
      if (signalMatchIds.length === originalSignalMatchIds.length) continue;
      database.prepare(`
        UPDATE prospects
        SET payload_json = @payloadJson,
            updated_at = @updatedAt
        WHERE id = @id
      `).run({
        id: prospect.id,
        updatedAt: new Date().toISOString(),
        payloadJson: toPayloadJson({
          ...payload,
          signalMatchIds,
        }),
      });
    }
  });

  return removedIds;
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

/**
 * @param {any} row
 */
function signalIdFromRow(row) {
  const payload = parsePayload(row);
  const view = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
    ? payload.payload
    : payload;
  return typeof view.signalId === "string" ? view.signalId : null;
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
