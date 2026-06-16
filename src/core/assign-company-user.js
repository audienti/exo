// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { userSchema } from "../schema/user.js";
import { resolveAssignmentAccountRefs } from "./assignment-account-refs.js";

/**
 * @param {unknown} rawCompany
 * @param {unknown} rawUser
 * @param {unknown[]} rawProfiles
 * @param {{ assignedBy?: string | null, reason?: string | null, accountRefs?: string[] | null }} input
 */
export function assignCompanyUser(rawCompany, rawUser, rawProfiles, input) {
  const company = companySchema.parse(rawCompany);
  const user = userSchema.parse(rawUser);
  for (const profile of rawProfiles) {
    browserProfileSchema.parse(profile);
  }
  const now = new Date().toISOString();

  return companySchema.parse({
    ...company,
    updatedAt: now,
    engagementUserAssignment: {
      userId: user.id,
      label: user.label,
      owner: user.owner,
      accountRefs: resolveAssignmentAccountRefs(user, input.accountRefs),
      assignedAt: now,
      assignedBy: normalizeNullableString(input.assignedBy),
      reason: normalizeNullableString(input.reason),
      sticky: true
    },
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
