// @ts-check

import crypto from "node:crypto";
import { companySchema } from "../schema/company.js";
import { normalizeImageProxyFields } from "../lib/image-proxy.js";

/**
 * @param {{
 *   name: string,
 *   domain?: string | null,
 *   websiteUrl?: string | null,
 *   linkedinCompanyUrl?: string | null,
 *   logoSourceUrl?: string | null,
 *   notes?: string | null,
 *   tags?: string[],
 *   motionIds?: string[]
 * }} input
 */
export function addCompany(input) {
  const now = new Date().toISOString();
  const logo = normalizeImageProxyFields(input.logoSourceUrl);

  return companySchema.parse({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    name: input.name,
    domain: normalizeNullableString(input.domain),
    websiteUrl: normalizeNullableString(input.websiteUrl),
    linkedinCompanyUrl: normalizeNullableString(input.linkedinCompanyUrl),
    logoSourceUrl: logo.sourceUrl,
    logoUrl: logo.proxyUrl,
    notes: normalizeNullableString(input.notes),
    tags: input.tags ?? [],
    motionIds: input.motionIds ?? [],
    engagementProfileAssignment: null,
    engagementUserAssignment: null
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
