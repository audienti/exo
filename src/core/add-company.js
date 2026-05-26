// @ts-check

import crypto from "node:crypto";
import { companySchema } from "../schema/company.js";

/**
 * @param {{
 *   name: string,
 *   domain?: string | null,
 *   websiteUrl?: string | null,
 *   linkedinCompanyUrl?: string | null,
 *   notes?: string | null,
 *   tags?: string[],
 *   motionIds?: string[]
 * }} input
 */
export function addCompany(input) {
  const now = new Date().toISOString();

  return companySchema.parse({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    name: input.name,
    domain: normalizeNullableString(input.domain),
    websiteUrl: normalizeNullableString(input.websiteUrl),
    linkedinCompanyUrl: normalizeNullableString(input.linkedinCompanyUrl),
    notes: normalizeNullableString(input.notes),
    tags: input.tags ?? [],
    motionIds: input.motionIds ?? [],
    engagementProfileAssignment: null
  });
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
