// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";

/**
 * @param {unknown} rawCompany
 * @param {unknown} rawProfile
 * @param {{ assignedBy?: string | null, reason?: string | null }} input
 */
export function assignCompanyProfile(rawCompany, rawProfile, input) {
  const company = companySchema.parse(rawCompany);
  const profile = browserProfileSchema.parse(rawProfile);
  const now = new Date().toISOString();

  return companySchema.parse({
    ...company,
    updatedAt: now,
    engagementProfileAssignment: {
      profileId: profile.id,
      label: profile.label,
      browser: profile.browser,
      profileDirectory: profile.profileDirectory,
      owner: profile.identity.owner,
      workspace: profile.identity.workspace,
      accountRefs: profile.identity.accounts.map((account) => `${account.capability}:${account.handle}`),
      assignedAt: now,
      assignedBy: normalizeNullableString(input.assignedBy),
      reason: normalizeNullableString(input.reason),
      sticky: true
    }
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
