// @ts-check

import { companySchema } from "../schema/company.js";
import { normalizeImageProxyFields } from "../lib/image-proxy.js";

/**
 * @param {unknown} rawCompany
 * @param {{
 *   name?: string | null,
 *   domain?: string | null,
 *   websiteUrl?: string | null,
 *   linkedinCompanyUrl?: string | null,
 *   logoSourceUrl?: string | null,
 *   notes?: string | null,
 *   tags?: string[],
 *   motionIds?: string[]
 * }} patch
 */
export function updateCompanyRecord(rawCompany, patch) {
  const company = companySchema.parse(rawCompany);
  const logo = normalizeImageProxyFields(patch.logoSourceUrl);

  return companySchema.parse({
    ...company,
    updatedAt: new Date().toISOString(),
    name: patch.name !== undefined ? patch.name.trim() : company.name,
    domain: patch.domain !== undefined ? normalizeNullableString(patch.domain) : company.domain,
    websiteUrl: patch.websiteUrl !== undefined ? normalizeNullableString(patch.websiteUrl) : company.websiteUrl,
    linkedinCompanyUrl:
      patch.linkedinCompanyUrl !== undefined
        ? normalizeNullableString(patch.linkedinCompanyUrl)
        : company.linkedinCompanyUrl,
    logoSourceUrl: logo.sourceUrl === undefined ? company.logoSourceUrl : logo.sourceUrl,
    logoUrl: logo.proxyUrl === undefined ? company.logoUrl : logo.proxyUrl,
    notes: patch.notes !== undefined ? normalizeNullableString(patch.notes) : company.notes,
    tags: patch.tags !== undefined ? patch.tags : company.tags,
    motionIds: patch.motionIds !== undefined ? patch.motionIds : company.motionIds
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
