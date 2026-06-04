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
  const browserResolved = matches.find((candidate) => candidate.sourceType === "browser-profile") ?? null;
  const managedResolution = resolveManagedAccountResolution(matches, input.capability, user.label);
  if (managedResolution?.status === "resolved") {
    const resolved = managedResolution.resolved;
    return {
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner
      },
      capability: input.capability,
      resolved,
      candidates: matches,
      resolutionStatus: "resolved",
      reason: resolved.reason,
      sourceType: resolved.sourceType
    };
  }

  if (managedResolution) {
    return {
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner
      },
      capability: input.capability,
      resolved: managedResolution.resolved,
      candidates: matches,
      resolutionStatus: managedResolution.status,
      reason: managedResolution.reason,
      sourceType: managedResolution.sourceType
    };
  }

  if (browserResolved) {
    return {
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner
      },
      capability: input.capability,
      resolved: null,
      candidates: matches,
      resolutionStatus: "unsupported",
      reason: `Profile-backed ${input.capability} accounts are no longer supported as governed execution paths. Map a managed connector account for ${user.label} before launch.`,
      sourceType: browserResolved.sourceType
    };
  }

  const resolved = matches[0] ?? null;

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    capability: input.capability,
    resolved,
    candidates: matches,
    resolutionStatus: resolved ? "resolved" : "not_found",
    reason: resolved
      ? resolved.reason
      : `No connected ${input.capability} account is stored for ${user.label}.`,
    sourceType: resolved?.sourceType ?? null
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
    sourceType: account.sourceType,
    providerAccountId: account.providerAccountId ?? null
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
    return left.sourceType === "harness-connection" ? -1 : 1;
  }

  return left.handle.localeCompare(right.handle);
}

/**
 * @param {ReturnType<typeof buildResolvedAccount>[]} matches
 * @param {string} capability
 * @param {string} userLabel
 */
function resolveManagedAccountResolution(matches, capability, userLabel) {
  const managedMatches = matches.filter((candidate) => candidate.sourceType === "harness-connection");
  if (!managedMatches.length) {
    return null;
  }

  const explicitMatches = managedMatches.filter((candidate) => Boolean(candidate.providerAccountId));
  const preferredExplicitMatches = explicitMatches.filter((candidate) => candidate.preferred);

  if (preferredExplicitMatches.length === 1) {
    return {
      resolved: preferredExplicitMatches[0],
      status: "resolved",
      reason: preferredExplicitMatches[0].reason,
      sourceType: "harness-connection"
    };
  }

  if (preferredExplicitMatches.length > 1) {
    return {
      resolved: null,
      status: "identity_ambiguous",
      reason: `Multiple preferred managed ${capability} accounts are mapped for ${userLabel}. Keep only one preferred exact account before launch.`,
      sourceType: "harness-connection"
    };
  }

  if (explicitMatches.length === 1) {
    return {
      resolved: explicitMatches[0],
      status: "resolved",
      reason: explicitMatches[0].reason,
      sourceType: "harness-connection"
    };
  }

  if (explicitMatches.length > 1) {
    return {
      resolved: null,
      status: "identity_ambiguous",
      reason: `Multiple managed ${capability} accounts are mapped for ${userLabel}. Select one exact external account before launch.`,
      sourceType: "harness-connection"
    };
  }

  if (managedMatches.length === 1) {
    const account = managedMatches[0];
    return {
      resolved: null,
      status: "identity_unresolved",
      reason: `Managed ${capability} account ${account.handle} exists for ${describeManagedConnector(account)}, but it is not pinned to one exact external account yet. Add providerAccountId or claim the discovered account before launch.`,
      sourceType: "harness-connection"
    };
  }

  return {
    resolved: null,
    status: "identity_unresolved",
    reason: `Managed ${capability} accounts exist for ${userLabel}, but none is pinned to one exact external account yet. Claim the discovered account before launch.`,
    sourceType: "harness-connection"
  };
}

/**
 * @param {ReturnType<typeof buildResolvedAccount>} account
 */
function describeManagedConnector(account) {
  const runtime = account.harnessConnection?.runtime ?? "unknown-runtime";
  const connector = account.harnessConnection?.connector ?? "unknown-connector";
  return `${runtime}:${connector}`;
}
