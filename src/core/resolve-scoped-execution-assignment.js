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
    input.capability,
    company.engagementUserAssignment?.accountRefs ?? []
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
      input.capability,
      motion.engagementUserAssignment?.accountRefs ?? []
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

  const singletonUserResolution = resolveSingletonUserAssignment(users, profiles, input.capability);
  if (singletonUserResolution) {
    return {
      source: "auto-singleton-user",
      userAssignmentRecord: null,
      profileAssignmentRecord: null,
      ...singletonUserResolution,
    };
  }

  return {
    source: "none",
    userAssignmentRecord: null,
    profileAssignmentRecord: null,
    assignedUser: null,
    assignedProfile: null,
    resolvedAccount: null,
    resolvedProfile: null,
    accountResolution: null
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type[]} users
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {string} capability
 */
function resolveSingletonUserAssignment(users, profiles, capability) {
  const candidates = users
    .map((user) => resolveUserAssignment(user.id, users, profiles, capability))
    .filter(Boolean)
    .filter((candidate) => candidate.accountResolution?.sourceType === "harness-connection");

  if (candidates.length !== 1) {
    return null;
  }

  return candidates[0];
}

/**
 * @param {string | null} userId
 * @param {import("../schema/user.js").userSchema._type[]} users
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {string} capability
 * @param {string[]} accountRefs
 */
function resolveUserAssignment(userId, users, profiles, capability, accountRefs = []) {
  if (!userId) {
    return null;
  }

  const assignedUser = users.find((user) => user.id === userId) ?? null;
  if (!assignedUser) {
    return null;
  }

  const resolution = resolveUserConnectionForScopedAccountRefs(assignedUser, profiles, capability, accountRefs);
  const resolvedAccount = resolution.resolved;
  const resolvedProfile = resolvedAccount?.browserProfile
    ? profiles.find((profile) => profile.id === resolvedAccount.browserProfile.id) ?? null
    : null;

  return {
    assignedUser,
    assignedProfile: resolvedProfile,
    resolvedAccount,
    resolvedProfile,
    accountResolution: {
      status: resolution.resolutionStatus,
      reason: resolution.reason,
      sourceType: resolution.sourceType ?? null
    }
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {string} capability
 * @param {string[]} accountRefs
 */
function resolveUserConnectionForScopedAccountRefs(user, profiles, capability, accountRefs) {
  const capabilityAccounts = user.accounts.filter((account) => account.capability === capability);
  const scopedHandles = [...new Set(
    (accountRefs ?? [])
      .filter((ref) => typeof ref === "string" && ref.startsWith(`${capability}:`))
      .map((ref) => ref.slice(capability.length + 1).trim())
      .filter(Boolean)
  )];

  if (!scopedHandles.length) {
    return resolveUserConnection(user, profiles, { capability });
  }

  if (scopedHandles.length > 1) {
    return {
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner
      },
      capability,
      resolved: null,
      candidates: capabilityAccounts,
      resolutionStatus: "identity_ambiguous",
      reason: `Multiple ${capability} account refs are pinned for ${user.label}. Keep only one exact ${capability} account on this assignment before launch.`,
      sourceType: inferAccountSourceType(capabilityAccounts)
    };
  }

  const scopedAccounts = capabilityAccounts.filter((account) => account.handle === scopedHandles[0]);
  if (!scopedAccounts.length) {
    return {
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner
      },
      capability,
      resolved: null,
      candidates: capabilityAccounts,
      resolutionStatus: "not_found",
      reason: `The pinned ${capability} account ref ${capability}:${scopedHandles[0]} is not stored on ${user.label}.`,
      sourceType: inferAccountSourceType(capabilityAccounts)
    };
  }

  return resolveUserConnection(
    {
      ...user,
      accounts: scopedAccounts
    },
    profiles,
    { capability }
  );
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type[]} accounts
 */
function inferAccountSourceType(accounts) {
  if (accounts.some((account) => account.sourceType === "harness-connection")) {
    return "harness-connection";
  }

  if (accounts.some((account) => account.sourceType === "browser-profile")) {
    return "browser-profile";
  }

  return null;
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
    resolvedProfile: assignedProfile,
    accountResolution: null
  };
}
