// @ts-check

import crypto from "node:crypto";
import { userSchema } from "../schema/user.js";

/**
 * @param {{ label: string, owner?: string | null, notes?: string | null }} input
 */
export function addUser(input) {
  const now = new Date().toISOString();

  return userSchema.parse({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    label: input.label,
    owner: normalizeNullableString(input.owner),
    notes: normalizeNullableString(input.notes),
    accounts: [],
    harnessConnections: []
  });
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
