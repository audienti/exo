// @ts-check

import { randomUUID } from "node:crypto";

export const NORMALIZED_SCHEMA_VERSION = 1;

/**
 * @param {string} prefix
 */
export function createEntityId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

/**
 * @param {string | null | undefined} value
 */
export function normalizeOptionalString(value) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

/**
 * @param {string | null | undefined} value
 */
export function normalizeLowerString(value) {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

/**
 * @param {string | null | undefined} value
 */
export function normalizeIso(value) {
  return normalizeOptionalString(value) ?? new Date().toISOString();
}

/**
 * @param {unknown} value
 */
export function toPayloadJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

/**
 * @param {{ payload_json?: string }} row
 */
export function parsePayload(row) {
  return row.payload_json ? JSON.parse(row.payload_json) : {};
}

/**
 * @param {number | boolean | null | undefined} value
 */
export function fromSqlBoolean(value) {
  return value === 1 || value === true;
}

/**
 * @param {boolean | null | undefined} value
 */
export function toSqlBoolean(value) {
  return value ? 1 : 0;
}
