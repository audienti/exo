// @ts-check
//
// Execution view model (Exo UI Build Spec).
//
// "Who owns the work + which transport identity is real." A roster of execution
// users; each opens to: assigned motions (state + readiness + prospect count),
// connected accounts (LinkedIn/Gmail handle, capability, truth), and capability
// coverage. Ownership and transport are kept separate from GTM objects.
//
// Field vocabulary mirrors Audienti v10's connected-accounts surface (account
// label, service · username, status, health, capability), mapped onto Exo's
// users + connected accounts + browser profiles + harness connections.
//
// Pure data — no rendering.

import { mapUserRuntimeAccounts } from "./map-user-runtime-accounts.js";

/** harness connection status → truth axis */
const HARNESS_TRUTH = {
  available: "checked",
  unavailable: "failed",
  unknown: "unchecked",
};

/**
 * @param {{
 *   rawUsers: any[],
 *   rawMotions: any[],
 *   rawCompanies: any[],
 *   rawProfiles: any[],
 *   runtimeAccountDiscovery?: {
 *     runtime: string,
 *     connector?: string | null,
 *     codexHome?: string | null,
 *     claudeCli?: string | null,
 *     runtimeAccountHints?: unknown[] | null
 *   } | null
 * }} input
 */
export function buildExecutionViewModel(input) {
  const companiesById = new Map((input.rawCompanies ?? []).map((c) => [c.id, c]));
  const profiles = input.rawProfiles ?? [];

  const users = (input.rawUsers ?? []).map((user) => {
    // Verified capabilities available to this user across ready browser profiles
    // the user's accounts reference.
    const profileIds = new Set(
      (user.accounts ?? [])
        .map((account) => account.browserProfileId)
        .filter(Boolean),
    );
    const verifiedCapabilities = new Set();
    for (const profile of profiles) {
      if (profileIds.has(profile.id) || profileIds.size === 0) {
        for (const cap of profile.verifiedCapabilities ?? []) {
          if (profile.status === "ready") verifiedCapabilities.add(cap);
        }
      }
    }

    const accounts = (user.accounts ?? []).map((account) => ({
      capability: account.capability,
      handle: account.handle,
      label: account.label ?? null,
      sourceType: account.sourceType,
      preferred: Boolean(account.preferred),
      kind: serviceKind(account.capability),
      truth: verifiedCapabilities.has(account.capability) ? "checked" : "unchecked",
    }));

    const harness = (user.harnessConnections ?? []).map((connection) => ({
      runtime: connection.runtime,
      connector: connection.connector,
      label: connection.label ?? null,
      status: connection.status,
      truth: HARNESS_TRUTH[connection.status] ?? "unchecked",
    }));
    const unclaimedAccounts = buildRuntimeClaimRows(user, input.runtimeAccountDiscovery);

    const assignedMotions = (input.rawMotions ?? [])
      .map((motion) => shapeAssignedMotion(motion, user, companiesById))
      .filter(Boolean);

    // Capability coverage: declared (has an account) vs verified.
    const declaredCaps = new Set(accounts.map((a) => a.capability));
    const capabilityCoverage = [...declaredCaps].sort().map((cap) => ({
      capability: cap,
      truth: verifiedCapabilities.has(cap) ? "checked" : "unchecked",
    }));

    return {
      id: user.id,
      label: user.label,
      owner: user.owner ?? null,
      initials: initials(user.label),
      accountCount: accounts.length,
      harnessCount: harness.length,
      unclaimedAccountCount: unclaimedAccounts.length,
      motionCount: assignedMotions.length,
      accounts,
      harness,
      unclaimedAccounts,
      assignedMotions,
      capabilityCoverage,
      working: shapeWorkingHours(user.workingHours),
    };
  });

  return {
    counts: {
      users: users.length,
      executionCapable: users.filter((u) => u.accountCount > 0).length,
    },
    users,
  };
}

/**
 * @param {any} user
 * @param {{
 *   runtime: string,
 *   connector?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null,
 *   runtimeAccountHints?: unknown[] | null
 * } | null | undefined} options
 */
function buildRuntimeClaimRows(user, options) {
  if (!options?.runtime) {
    return [];
  }

  const result = mapUserRuntimeAccounts(user, {
    runtime: options.runtime,
    connector: options.connector ?? null,
    apply: false,
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null,
    runtimeAccountHints: options.runtimeAccountHints ?? null,
  });

  return result.mappings
    .filter((mapping) => mapping.action !== "already_mapped" && mapping.action !== "mapped" && mapping.action !== "mapping_updated")
    .map((mapping) => {
      const handle = mapping.discoveredAccount?.handle ?? mapping.mappedAccount?.handle ?? mapping.existingAccount?.handle ?? null;
      const label = mapping.discoveredAccount?.label ?? mapping.mappedAccount?.label ?? mapping.existingAccount?.label ?? null;
      const canClaim = mapping.action === "ready_to_map" || mapping.action === "missing_handle";
      return {
        capability: mapping.capability,
        handle,
        label,
        handleSourceType: mapping.existingAccount?.sourceType ?? null,
        kind: serviceKind(mapping.capability),
        runtime: mapping.runtime,
        connector: mapping.connector,
        providerAccountId: mapping.discoveredAccount?.providerAccountId ?? mapping.mappedAccount?.providerAccountId ?? null,
        truth: HARNESS_TRUTH[mapping.detectedStatus] ?? "unchecked",
        status: mapping.detectedStatus,
        action: mapping.action,
        reason: mapping.reason,
        requiresHandle: mapping.action === "missing_handle",
        identityState: mapping.discoveredAccount?.identityState ?? null,
        title: buildRuntimeAccountTitle(mapping, { handle, label }),
        subtitle: buildRuntimeAccountSubtitle(mapping, { handle, label }),
        canClaim,
        claimArgs: canClaim
          ? {
              userId: user.id,
              capability: mapping.capability,
              runtime: mapping.runtime,
              connector: mapping.connector,
              preferred: true,
              ...(mapping.discoveredAccount?.providerAccountId ? { providerAccountId: mapping.discoveredAccount.providerAccountId } : {}),
              ...(mapping.discoveredAccount?.metadata ? { metadata: mapping.discoveredAccount.metadata } : {}),
              ...(label ? { label } : {}),
              ...(handle ? { handle } : {}),
            }
          : null,
      };
    });
}

/**
 * @param {any} mapping
 * @param {{ handle: string | null, label: string | null }} display
 */
function buildRuntimeAccountTitle(mapping, display) {
  if (display.label && display.handle && display.label !== display.handle) {
    return `${display.label} · ${display.handle}`;
  }
  if (display.handle) {
    return display.handle;
  }
  if (display.label) {
    return display.label;
  }
  return `${mapping.capability} via ${mapping.runtime} · ${mapping.connector}`;
}

/**
 * @param {any} mapping
 * @param {{ handle: string | null, label: string | null }} display
 */
function buildRuntimeAccountSubtitle(mapping, display) {
  const base = `${mapping.capability} via ${mapping.runtime} · ${mapping.connector}`;
  if (mapping.action === "ready_to_map" && display.handle) {
    return base;
  }
  if (mapping.action === "missing_handle") {
    return `Identity confirmed, but Exo still needs the governed ${mapping.capability} handle before this account can be claimed.`;
  }
  return mapping.reason;
}

/**
 * @param {string | null} reason
 */
/**
 * @param {any} motion
 * @param {any} user
 * @param {Map<string, any>} companiesById
 */
function shapeAssignedMotion(motion, user, companiesById) {
  const accounts = motion.targetMap?.accounts ?? [];
  const pinned = accounts.filter((account) => {
    const company = companiesById.get(account.companyId);
    const assignment = company?.engagementUserAssignment;
    return assignment?.userId === user.id || (assignment?.label && assignment.label === user.label);
  });
  // Also honor a motion-level assignment if present.
  const motionPinned = motion.engagementUserAssignment?.userId === user.id;
  if (!pinned.length && !motionPinned) return null;

  const scope = pinned.length ? pinned : accounts;
  const prospectCount = scope.reduce((sum, account) => sum + (account.prospects?.length ?? 0), 0);
  const readyAccounts = scope.filter((account) => account.queueState?.status === "ready").length;
  const readiness = scope.length ? readyAccounts / scope.length : 0;

  return {
    id: motion.id,
    name: motion.name,
    state: motion.status,
    truth: motion.premise?.status === "checked" ? "checked" : motion.premise?.status === "defined" ? "partial" : "unchecked",
    companyCount: scope.length,
    prospectCount,
    readiness,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** @param {string} capability */
function serviceKind(capability) {
  if (capability === "gmail") return "gmail";
  if (capability === "linkedin" || capability === "sales-navigator") return "linkedin";
  return "generic";
}

/** @param {any} workingHours */
function shapeWorkingHours(workingHours) {
  if (!workingHours) return null;
  if (workingHours.mode === "always") return "Always on";
  const days = (workingHours.weekdays ?? []).map((d) => d[0].toUpperCase() + d.slice(1)).join(" ");
  return `${days} · ${workingHours.startLocalTime}–${workingHours.endLocalTime} ${workingHours.timezone}`;
}

/** @param {string | null | undefined} value */
function initials(value) {
  if (!value) return "?";
  return value
    .split(/[\s-]+/)
    .map((word) => word[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
