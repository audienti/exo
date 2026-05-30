// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { resolveUserConnection } from "./resolve-user-connection.js";

/**
 * @param {{
 *   rawCompany: unknown,
 *   rawMotion?: unknown | null,
 *   rawProfiles: unknown[],
 *   rawUsers: unknown[],
 *   capability: string
 * }} input
 */
export function resolveScopedExecutionAssignment(input) {
  const company = companySchema.parse(input.rawCompany);
  const motion = input.rawMotion ? motionSchema.parse(input.rawMotion) : null;
  const profiles = input.rawProfiles.map((profile) => browserProfileSchema.parse(profile));
  const users = input.rawUsers.map((user) => userSchema.parse(user));

  const companyUserResolution = resolveUserAssignment(
    company.engagementUserAssignment?.userId ?? null,
    users,
    profiles,
    input.capability
  );
  if (companyUserResolution) {
    return {
      source: "company-user",
      userAssignmentRecord: company.engagementUserAssignment,
      profileAssignmentRecord: company.engagementProfileAssignment,
      ...companyUserResolution
    };
  }

  const companyProfileResolution = resolveProfileAssignment(
    company.engagementProfileAssignment?.profileId ?? null,
    profiles
  );
  if (companyProfileResolution) {
    return {
      source: "company-profile",
      userAssignmentRecord: null,
      profileAssignmentRecord: company.engagementProfileAssignment,
      ...companyProfileResolution
    };
  }

  if (motion) {
    const motionUserResolution = resolveUserAssignment(
      motion.engagementUserAssignment?.userId ?? null,
      users,
      profiles,
      input.capability
    );
    if (motionUserResolution) {
      return {
        source: "motion-user",
        userAssignmentRecord: motion.engagementUserAssignment,
        profileAssignmentRecord: motion.engagementProfileAssignment,
        ...motionUserResolution
      };
    }

    const motionProfileResolution = resolveProfileAssignment(
      motion.engagementProfileAssignment?.profileId ?? null,
      profiles
    );
    if (motionProfileResolution) {
      return {
        source: "motion-profile",
        userAssignmentRecord: null,
        profileAssignmentRecord: motion.engagementProfileAssignment,
        ...motionProfileResolution
      };
    }
  }

  return {
    source: "none",
    userAssignmentRecord: null,
    profileAssignmentRecord: null,
    assignedUser: null,
    assignedProfile: null,
    resolvedAccount: null,
    resolvedProfile: null
  };
}

/**
 * @param {string | null} userId
 * @param {import("../schema/user.js").userSchema._type[]} users
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {string} capability
 */
function resolveUserAssignment(userId, users, profiles, capability) {
  if (!userId) {
    return null;
  }

  const assignedUser = users.find((user) => user.id === userId) ?? null;
  if (!assignedUser) {
    return null;
  }

  const resolvedAccount = resolveUserConnection(assignedUser, profiles, { capability }).resolved;
  const resolvedProfile = resolvedAccount?.browserProfile
    ? profiles.find((profile) => profile.id === resolvedAccount.browserProfile.id) ?? null
    : null;

  return {
    assignedUser,
    assignedProfile: resolvedProfile,
    resolvedAccount,
    resolvedProfile
  };
}

/**
 * @param {string | null} profileId
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 */
function resolveProfileAssignment(profileId, profiles) {
  if (!profileId) {
    return null;
  }

  const assignedProfile = profiles.find((profile) => profile.id === profileId) ?? null;
  if (!assignedProfile) {
    return null;
  }

  return {
    assignedUser: null,
    assignedProfile,
    resolvedAccount: null,
    resolvedProfile: assignedProfile
  };
}
