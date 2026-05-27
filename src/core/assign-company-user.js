// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { userSchema } from "../schema/user.js";
import { resolveUserConnection } from "./resolve-user-connection.js";

/**
 * @param {unknown} rawCompany
 * @param {unknown} rawUser
 * @param {unknown[]} rawProfiles
 * @param {{ assignedBy?: string | null, reason?: string | null, browserCapability?: string | null }} input
 */
export function assignCompanyUser(rawCompany, rawUser, rawProfiles, input) {
  const company = companySchema.parse(rawCompany);
  const user = userSchema.parse(rawUser);
  const profiles = rawProfiles.map((profile) => browserProfileSchema.parse(profile));
  const now = new Date().toISOString();
  const browserCapability = input.browserCapability ?? "linkedin";
  const resolvedBrowserAccount = resolveUserConnection(user, profiles, { capability: browserCapability }).resolved;
  const resolvedBrowserProfile = resolvedBrowserAccount?.browserProfile ?? null;

  return companySchema.parse({
    ...company,
    updatedAt: now,
    engagementUserAssignment: {
      userId: user.id,
      label: user.label,
      owner: user.owner,
      accountRefs: user.accounts.map((account) => `${account.capability}:${account.handle}`),
      assignedAt: now,
      assignedBy: normalizeNullableString(input.assignedBy),
      reason: normalizeNullableString(input.reason),
      sticky: true
    },
    engagementProfileAssignment: resolvedBrowserProfile
      ? {
          profileId: resolvedBrowserProfile.id,
          label: resolvedBrowserProfile.label,
          browser: resolvedBrowserProfile.browser,
          profileDirectory: resolvedBrowserProfile.profileDirectory,
          owner: user.owner,
          workspace: null,
          accountRefs: user.accounts
            .filter((account) => account.browserProfileId === resolvedBrowserProfile.id)
            .map((account) => `${account.capability}:${account.handle}`),
          assignedAt: now,
          assignedBy: normalizeNullableString(input.assignedBy),
          reason: normalizeNullableString(input.reason),
          sticky: true
        }
      : null
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
