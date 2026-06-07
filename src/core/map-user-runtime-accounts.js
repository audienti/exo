// @ts-check

import { discoverRuntimeConnectorAccounts } from "./discover-runtime-account-identities.js";
import { probeUserHarnessConnections } from "./probe-user-harness-connections.js";
import { upsertUserConnectedAccount, upsertUserHarnessConnection } from "./upsert-user-harness-connection.js";
import { userSchema } from "../schema/user.js";

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

        if (probe.detectedStatus !== "available") {
          action = "connector_not_available";
          reason = `Managed ${capability} coverage is not currently available through ${probe.runtime}:${probe.connector}.`;
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

        if (apply && action === "ready_to_map") {
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

          updatedUser = upsertUserConnectedAccount(updatedUser, {
            capability,
            handle,
            label,
            harnessConnectionId: persistedConnection.id,
            providerAccountId: discoveredAccount?.providerAccountId ?? null,
            preferred: preferManaged,
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
    },
    mappings,
    updatedUser
  };
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
