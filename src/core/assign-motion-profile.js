// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { motionSchema } from "../schema/motion.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawProfile
 * @param {{ assignedBy?: string | null, reason?: string | null }} input
 */
export function assignMotionProfile(rawMotion, rawProfile, input) {
  const motion = motionSchema.parse(rawMotion);
  const profile = browserProfileSchema.parse(rawProfile);
  const now = new Date().toISOString();

  return motionSchema.parse({
    ...motion,
    updatedAt: now,
    engagementUserAssignment: null,
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
