// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { userSchema } from "../schema/user.js";

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawProfiles
 * @param {{ capability: string }} input
 */
export function resolveUserConnection(rawUser, rawProfiles, input) {
  const user = userSchema.parse(rawUser);
  const profiles = rawProfiles.map((profile) => browserProfileSchema.parse(profile));
  const matches = user.accounts
    .filter((account) => account.capability === input.capability)
    .map((account) => buildResolvedAccount(account, profiles, user))
    .sort(compareResolvedAccounts);

  const resolved = matches[0] ?? null;

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    capability: input.capability,
    resolved,
    candidates: matches
  };
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/user.js").userSchema._type} user
 */
function buildResolvedAccount(account, profiles, user) {
  const base = {
    accountId: account.id,
    capability: account.capability,
    handle: account.handle,
    label: account.label,
    preferred: account.preferred,
    sourceType: account.sourceType
  };

  if (account.sourceType === "browser-profile") {
    const profile = profiles.find((candidate) => candidate.id === account.browserProfileId) ?? null;
    const ready = Boolean(profile && profile.status === "ready" && profile.verifiedCapabilities.includes(account.capability));
    return {
      ...base,
      status: ready ? "ready" : "warning",
      reason: ready
        ? `Resolved through browser profile ${profile.label}.`
        : profile
          ? `Profile ${profile.label} is not trusted for ${account.capability}.`
          : "Referenced browser profile is missing.",
      browserProfile: profile
        ? {
            id: profile.id,
            label: profile.label,
            browser: profile.browser,
            profileDirectory: profile.profileDirectory,
            verifiedCapabilities: profile.verifiedCapabilities
          }
        : null,
      harnessConnection: null
    };
  }

  const harnessConnection = user.harnessConnections.find((connection) => connection.id === account.harnessConnectionId) ?? null;
  const ready = Boolean(harnessConnection && harnessConnection.status === "available");
  return {
    ...base,
    status: ready ? "ready" : "warning",
    reason: ready
      ? `Resolved through harness connection ${harnessConnection.runtime}:${harnessConnection.connector}.`
      : harnessConnection
        ? `Harness connection ${harnessConnection.runtime}:${harnessConnection.connector} is not currently available.`
        : "Referenced harness connection is missing.",
    browserProfile: null,
    harnessConnection: harnessConnection
      ? {
          id: harnessConnection.id,
          runtime: harnessConnection.runtime,
          connector: harnessConnection.connector,
          label: harnessConnection.label,
          status: harnessConnection.status
        }
      : null
  };
}

/**
 * @param {ReturnType<typeof buildResolvedAccount>} left
 * @param {ReturnType<typeof buildResolvedAccount>} right
 */
function compareResolvedAccounts(left, right) {
  if (left.status !== right.status) {
    return left.status === "ready" ? -1 : 1;
  }

  if (left.preferred !== right.preferred) {
    return left.preferred ? -1 : 1;
  }

  if (left.sourceType !== right.sourceType) {
    return left.sourceType === "browser-profile" ? -1 : 1;
  }

  return left.handle.localeCompare(right.handle);
}
