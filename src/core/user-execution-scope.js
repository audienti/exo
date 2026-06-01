// @ts-check

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {{ capability?: string | null | undefined }} [options]
 */
export function classifyUserExecutionScope(user, motion, company, options = {}) {
  const capability = options.capability ?? "linkedin";
  const preferredAccount = user.accounts.find((account) => account.capability === capability && account.preferred)
    ?? user.accounts.find((account) => account.capability === capability)
    ?? null;
  const scopedUserId = company.engagementUserAssignment?.userId
    ?? motion.engagementUserAssignment?.userId
    ?? null;
  const scopedProfileId = company.engagementProfileAssignment?.profileId
    ?? motion.engagementProfileAssignment?.profileId
    ?? null;
  const userProfileId = preferredAccount?.browserProfileId ?? null;
  const assignedToUser = scopedUserId === user.id
    || (!scopedUserId && Boolean(scopedProfileId) && scopedProfileId === userProfileId);

  return {
    key: buildMotionCompanyScopeKey(motion.id, company.id),
    assignedToUser,
    assignedToOtherUser: Boolean(scopedUserId) && scopedUserId !== user.id,
    blockedByOtherProfile: Boolean(!scopedUserId && scopedProfileId && scopedProfileId !== userProfileId),
    blockedByMissingAssignment: !scopedUserId && !scopedProfileId,
    scopedUserId,
    scopedProfileId
  };
}

/**
 * @param {string} motionId
 * @param {string} companyId
 */
export function buildMotionCompanyScopeKey(motionId, companyId) {
  return `${motionId}::${companyId}`;
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/motion.js").motionSchema._type[]} motions
 * @param {import("../schema/company.js").companySchema._type[]} companies
 * @param {{
 *   capability?: string | null | undefined,
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined
 * }} [options]
 */
export function buildUserAssignedExecutionScopeIndex(user, motions, companies, options = {}) {
  const assignedExecutionScopeKeys = new Set();
  const assignedMotionIds = new Set();
  const assignedCompanyIdsByMotion = new Map();

  for (const motion of motions) {
    if (options.motionId && motion.id !== options.motionId) {
      continue;
    }

    for (const company of companies) {
      if (!company.motionIds.includes(motion.id)) {
        continue;
      }

      if (options.companyId && company.id !== options.companyId) {
        continue;
      }

      const executionScope = classifyUserExecutionScope(user, motion, company, {
        capability: options.capability
      });
      if (!executionScope.assignedToUser) {
        continue;
      }

      assignedExecutionScopeKeys.add(buildMotionCompanyScopeKey(motion.id, company.id));
      assignedMotionIds.add(motion.id);
      const companyIds = assignedCompanyIdsByMotion.get(motion.id) ?? new Set();
      companyIds.add(company.id);
      assignedCompanyIdsByMotion.set(motion.id, companyIds);
    }
  }

  return {
    assignedExecutionScopeKeys,
    assignedMotionIds,
    assignedCompanyIdsByMotion
  };
}
