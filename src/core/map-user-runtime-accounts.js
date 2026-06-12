// @ts-check

import { discoverRuntimeConnectorAccounts } from "./discover-runtime-account-identities.js";
import { probeUserHarnessConnections } from "./probe-user-harness-connections.js";
import { upsertUserConnectedAccount, upsertUserHarnessConnection } from "./upsert-user-harness-connection.js";
import { isManagedAccountExcluded } from "./user-account-governance.js";
import { LINKEDIN_DEFAULT_WEEKLY_INVITATIONS } from "./user-account-defaults.js";
import { userSchema } from "../schema/user.js";

const BLOCKED_LINKEDIN_QUOTA_ACTIONS = new Set([
  "connector_not_available",
  "excluded_identity",
  "session_unavailable",
  "identity_unresolved",
  "missing_handle",
]);

const CONNECTOR_CAPABILITY_MAP = {
  gmail: ["gmail"],
  hubspot: ["hubspot"],
  unipile: ["gmail", "linkedin"]
};

/**
 * @param {unknown} rawUser
 * @param {{
 *   runtime: string,
 *   connector?: string | null | undefined,
 *   apply?: boolean | undefined,
 *   preferManaged?: boolean | undefined,
 *   linkedinInvitationQuota?: number | null | undefined,
 *   codexHome?: string | null | undefined,
 *   claudeCli?: string | null | undefined,
 *   runtimeAccountHints?: unknown[] | null | undefined,
 *   httpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null | undefined
 * }} options
 */
export function mapUserRuntimeAccounts(rawUser, options) {
  const user = userSchema.parse(rawUser);
  const runtime = normalizeRequiredString(options.runtime, "Runtime is required.");
  const connectorFilter = normalizeNullableString(options.connector)?.toLowerCase() ?? null;
  const apply = Boolean(options.apply);
  const preferManaged = Boolean(options.preferManaged);
  const linkedinInvitationQuota = (typeof options.linkedinInvitationQuota === "number"
    && Number.isInteger(options.linkedinInvitationQuota)
    && options.linkedinInvitationQuota >= 1)
    ? options.linkedinInvitationQuota
    : null;
  const probeResult = probeUserHarnessConnections(user, {
    runtime,
    connector: connectorFilter,
    writeback: false,
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });

  let updatedUser = user;
  /** @type {Array<{
   *   runtime: string,
   *   connector: string,
   *   capability: string,
   *   detectedStatus: string,
   *   registration: string,
   *   action: string,
   *   preferredApplied: boolean,
   *   reason: string,
   *   discoveredAccount: {
   *     providerAccountId: string | null,
   *     handle: string | null,
   *     label: string | null,
   *     identityState: string,
   *     metadata: Record<string, unknown> | null
   *   } | null,
   *   existingAccount: {
   *     accountId: string,
   *     handle: string,
    *     label: string | null,
    *     sourceType: string,
    *     providerAccountId: string | null,
   *     preferred: boolean,
   *     metadata: Record<string, unknown> | null
   *   } | null,
   *   mappedAccount: {
   *     accountId: string,
   *     handle: string,
    *     label: string | null,
    *     sourceType: string,
    *     providerAccountId: string | null,
   *     preferred: boolean,
   *     metadata: Record<string, unknown> | null
   *   } | null
   * }>} */
  const mappings = [];

  for (const probe of probeResult.probes) {
    const normalizedConnector = probe.connector.trim().toLowerCase();
    const capabilities = CONNECTOR_CAPABILITY_MAP[normalizedConnector] ?? [];
    if (!capabilities.length) {
      continue;
    }

    for (const capability of capabilities) {
      const discoveredAccounts = discoverRuntimeConnectorAccounts({
        runtime: probe.runtime,
        connector: probe.connector,
        capability,
        codexHome: options.codexHome ?? null,
        hints: options.runtimeAccountHints ?? null,
        httpGetImpl: options.httpGetImpl ?? null,
      });
      const identityTargets = discoveredAccounts.length ? discoveredAccounts : [null];

      for (const discoveredAccount of identityTargets) {
        const capabilityAccounts = updatedUser.accounts.filter((account) => account.capability === capability);
        const existingManagedConnection = updatedUser.harnessConnections.find((connection) =>
          connection.runtime.trim().toLowerCase() === probe.runtime.trim().toLowerCase()
          && connection.connector.trim().toLowerCase() === probe.connector.trim().toLowerCase()
        ) ?? null;
        const existingAccount = selectCapabilityTemplateAccount(capabilityAccounts, discoveredAccount);
        const existingManagedAccount = selectExistingManagedAccount(
          capabilityAccounts,
          existingManagedConnection?.id ?? null,
          discoveredAccount,
        );
        const handle = normalizeNullableString(
          existingManagedAccount?.handle
          ?? discoveredAccount?.handle
          ?? existingAccount?.handle
          ?? null,
        );
        const label = normalizeNullableString(
          existingManagedAccount?.label
          ?? discoveredAccount?.label
          ?? existingAccount?.label
          ?? null,
        );

        let action = "ready_to_map";
        let reason = `Managed ${capability} coverage is available through ${probe.runtime}:${probe.connector}.`;
        const excludedIdentity = discoveredAccount
          ? isManagedAccountExcluded(updatedUser, {
            runtime: probe.runtime,
            connector: probe.connector,
            capability,
            providerAccountId: discoveredAccount.providerAccountId ?? null,
            handle: discoveredAccount.handle ?? null,
          })
          : false;

        if (probe.detectedStatus !== "available") {
          action = "connector_not_available";
          reason = `Managed ${capability} coverage is not currently available through ${probe.runtime}:${probe.connector}.`;
        } else if (excludedIdentity) {
          action = "excluded_identity";
          const identityLabel = discoveredAccount?.label ?? handle ?? discoveredAccount?.providerAccountId ?? `${capability} identity`;
          reason = `Managed ${capability} account ${identityLabel} is explicitly excluded for this user and will not be remapped.`;
        } else if (existingManagedAccount) {
          action = "already_mapped";
          reason = `Managed ${capability} is already mapped to this user through ${probe.runtime}:${probe.connector}.`;
        } else if (discoveredAccount?.identityState === "session_unavailable") {
          action = "session_unavailable";
          reason = discoveredAccount.reason;
        } else if (discoveredAccount && discoveredAccount.identityState !== "confirmed") {
          action = "identity_unresolved";
          reason = discoveredAccount.reason;
        } else if (!discoveredAccount) {
          action = "identity_unresolved";
          reason = `Managed ${capability} coverage exists through ${probe.runtime}:${probe.connector}, but Exo could not inspect which connected account that connector is currently bound to.`;
        } else if (!handle) {
          action = "missing_handle";
          reason = discoveredAccount?.reason
            ?? `Managed ${capability} coverage exists through ${probe.runtime}:${probe.connector}, but Exo could not resolve the actual connected account handle.`;
        } else if (discoveredAccount?.handle) {
          reason = `Resolved managed ${capability} account ${handle} through ${probe.runtime}:${probe.connector}.`;
        }

        /** @type {import("../schema/user.js").userConnectedAccountSchema._type | null} */
        let mappedAccount = existingManagedAccount ?? null;
        let preferredApplied = false;

        // Compute quotaAction BEFORE the write-branch decision. The write
        // branch uses it to decide whether to enter the writer at all.
        let quotaAction = "none";
        if (capability === "linkedin") {
          if (BLOCKED_LINKEDIN_QUOTA_ACTIONS.has(action)) {
            quotaAction = "none";
          } else {
            // Resolve the upsert match key the same way upsertUserConnectedAccount does.
            const existingAtUpsertKey = findAccountAtUpsertKey(updatedUser, {
              capability,
              providerAccountId: discoveredAccount?.providerAccountId ?? null,
              harnessConnectionId: existingManagedConnection?.id ?? null,
            });
            const existingPositiveInvitations = resolvePositiveInvitations(
              existingAtUpsertKey?.automationControls?.weeklyQuotas?.invitations ?? null,
            );

            if (linkedinInvitationQuota !== null) {
              quotaAction = "explicit_override";
            } else if (existingPositiveInvitations === null) {
              quotaAction = "defaulted";
            } else {
              quotaAction = "preserved";
            }
          }
        }

        const shouldEnterWriteBranch = apply && (
          action === "ready_to_map"
          || (action === "already_mapped"
            && capability === "linkedin"
            && quotaAction !== "preserved"
            && quotaAction !== "none")
        );

        if (shouldEnterWriteBranch) {
          updatedUser = upsertUserHarnessConnection(updatedUser, {
            runtime: probe.runtime,
            connector: probe.connector,
            label: existingManagedConnection?.label ?? null,
            status: probe.detectedStatus,
            notes: existingManagedConnection?.notes ?? null,
          });
          const persistedConnection = updatedUser.harnessConnections.find((connection) =>
            connection.runtime.trim().toLowerCase() === probe.runtime.trim().toLowerCase()
            && connection.connector.trim().toLowerCase() === probe.connector.trim().toLowerCase()
          );

          if (!persistedConnection) {
            throw new Error(`Failed to persist harness connection ${probe.runtime}:${probe.connector}.`);
          }

          /** @type {{ weeklyQuotas: { invitations: number } } | undefined} */
          let automationControlsForWrite;
          if (quotaAction === "explicit_override" && linkedinInvitationQuota !== null) {
            automationControlsForWrite = {
              weeklyQuotas: { invitations: linkedinInvitationQuota },
            };
          } else if (quotaAction === "defaulted") {
            automationControlsForWrite = {
              weeklyQuotas: { invitations: LINKEDIN_DEFAULT_WEEKLY_INVITATIONS },
            };
          }

          updatedUser = upsertUserConnectedAccount(updatedUser, {
            capability,
            handle,
            label,
            harnessConnectionId: persistedConnection.id,
            providerAccountId: discoveredAccount?.providerAccountId ?? null,
            preferred: preferManaged,
            ...(automationControlsForWrite ? { automationControls: automationControlsForWrite } : {}),
            metadata: discoveredAccount?.metadata ?? existingManagedAccount?.metadata ?? existingAccount?.metadata ?? null,
            notes: existingManagedAccount?.notes ?? existingAccount?.notes ?? null,
          });

          mappedAccount = updatedUser.accounts.find((account) =>
            account.capability === capability
            && account.sourceType === "harness-connection"
            && account.harnessConnectionId === persistedConnection.id
            && ((discoveredAccount?.providerAccountId && account.providerAccountId)
              ? account.providerAccountId === discoveredAccount.providerAccountId
              : account.handle === handle)
          ) ?? null;

          if (mappedAccount) {
            action = existingManagedAccount ? "mapping_updated" : "mapped";
            preferredApplied = preferManaged && mappedAccount.preferred;
            reason = preferManaged
              ? `Mapped managed ${capability} ${handle} onto ${probe.runtime}:${probe.connector} and marked it preferred for this user.`
              : `Mapped managed ${capability} ${handle} onto ${probe.runtime}:${probe.connector} for this user.`;
          }
        }

        mappings.push({
          runtime: probe.runtime,
          connector: probe.connector,
          capability,
          detectedStatus: probe.detectedStatus,
          registration: probe.registration,
          action,
          preferredApplied,
          quotaAction,
          reason,
          discoveredAccount: discoveredAccount
            ? {
                providerAccountId: discoveredAccount.providerAccountId,
                handle: discoveredAccount.handle,
                label: discoveredAccount.label,
                identityState: discoveredAccount.identityState,
                metadata: discoveredAccount.metadata ?? null,
              }
            : null,
          existingAccount: existingAccount ? shapeAccountRef(existingAccount) : null,
          mappedAccount: mappedAccount ? shapeAccountRef(mappedAccount) : null,
        });
      }
    }
  }

  /** @type {string[]} */
  const warnings = [];
  if (apply) {
    for (const mapping of mappings) {
      if (mapping.quotaAction === "defaulted") {
        const handleRef = mapping.discoveredAccount?.handle
          ?? mapping.mappedAccount?.handle
          ?? mapping.existingAccount?.handle
          ?? "<unknown handle>";
        warnings.push(
          `map-runtime defaulted LinkedIn quota to ${LINKEDIN_DEFAULT_WEEKLY_INVITATIONS}/week for ${mapping.runtime}:${mapping.connector} -> ${handleRef}. Re-run users accounts add ... --max-connection-requests <n> to set a different value.`,
        );
      }
    }
  }

  return {
    user: {
      id: updatedUser.id,
      label: updatedUser.label,
      owner: updatedUser.owner
    },
    runtime,
    connector: connectorFilter,
    apply,
    preferManaged,
    probe: {
      inspectedAt: probeResult.inspectedAt,
      counts: probeResult.counts
    },
    counts: {
      mappingCount: mappings.length,
      readyToMapCount: mappings.filter((mapping) => mapping.action === "ready_to_map").length,
      mappedCount: mappings.filter((mapping) => mapping.action === "mapped" || mapping.action === "mapping_updated").length,
      alreadyMappedCount: mappings.filter((mapping) => mapping.action === "already_mapped").length,
      missingHandleCount: mappings.filter((mapping) => mapping.action === "missing_handle").length,
      unavailableCount: mappings.filter((mapping) => mapping.action === "connector_not_available").length,
      identityBlockedCount: mappings.filter((mapping) =>
        mapping.action === "identity_unresolved"
        || mapping.action === "session_unavailable"
      ).length,
      excludedCount: mappings.filter((mapping) => mapping.action === "excluded_identity").length,
    },
    mappings,
    warnings,
    updatedUser
  };
}

/**
 * Look up the account that `upsertUserConnectedAccount` would match on, using
 * the exact same key as `src/core/upsert-user-harness-connection.js:71-81`.
 *
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {{
 *   capability: string,
 *   providerAccountId: string | null,
 *   harnessConnectionId: string | null,
 * }} input
 */
function findAccountAtUpsertKey(user, input) {
  return user.accounts.find((account) => {
    if (account.capability !== input.capability) {
      return false;
    }
    if (input.providerAccountId) {
      return account.providerAccountId === input.providerAccountId;
    }
    return account.harnessConnectionId === input.harnessConnectionId;
  }) ?? null;
}

/**
 * Treats stored values that are not a positive integer (null, 0, NaN, etc.) as
 * "no quota set" so the W1/W2 default can heal legacy 0s.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function resolvePositiveInvitations(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type[]} accounts
 * @param {{ providerAccountId: string | null, handle: string | null } | null} discoveredAccount
 */
function selectCapabilityTemplateAccount(accounts, discoveredAccount = null) {
  if (!accounts.length) {
    return null;
  }

  const targeted = discoveredAccount
    ? accounts.filter((account) =>
        (discoveredAccount.providerAccountId && account.providerAccountId)
          ? account.providerAccountId === discoveredAccount.providerAccountId
          : discoveredAccount.handle
            ? account.handle === discoveredAccount.handle
            : true
      )
    : accounts;

  const pool = targeted.length ? targeted : accounts;
  return [...pool].sort((left, right) => {
    if (left.preferred !== right.preferred) {
      return left.preferred ? -1 : 1;
    }

    if (left.sourceType !== right.sourceType) {
      return left.sourceType === "harness-connection" ? -1 : 1;
    }

    return left.handle.localeCompare(right.handle);
  })[0] ?? null;
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type[]} accounts
 * @param {string | null} harnessConnectionId
 * @param {{ providerAccountId: string | null, handle: string | null } | null} discoveredAccount
 */
function selectExistingManagedAccount(accounts, harnessConnectionId, discoveredAccount) {
  return accounts.find((account) =>
    account.sourceType === "harness-connection"
    && account.harnessConnectionId === harnessConnectionId
    && (
      (discoveredAccount?.providerAccountId && account.providerAccountId)
        ? account.providerAccountId === discoveredAccount.providerAccountId
        : discoveredAccount?.handle
          ? account.handle === discoveredAccount.handle
          : true
    )
  ) ?? null;
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function shapeAccountRef(account) {
  return {
    accountId: account.id,
    handle: account.handle,
    label: account.label ?? null,
    sourceType: account.sourceType,
    providerAccountId: account.providerAccountId ?? null,
    preferred: account.preferred,
    metadata: account.metadata ?? null,
  };
}

/**
 * @param {string | null | undefined} value
 * @param {string} message
 */
function normalizeRequiredString(value, message) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
