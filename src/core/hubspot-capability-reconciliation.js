// @ts-check

import {
  CAPABILITY_SEAM_STATES,
  buildCapabilitySeamResult,
} from "./capability-seam-contract.js";

export const HUBSPOT_CAPABILITY_RECONCILIATION_OWNER = "src/core/hubspot-capability-reconciliation.js";

export const HUBSPOT_CAPABILITY_SUPPORT_STATUSES = Object.freeze({
  CHECKED_RUNTIME: "checked-runtime",
  FAILED_RUNTIME: "failed-runtime",
  UNSUPPORTED: "unsupported",
  UNCONFIGURED: "unconfigured",
});

const HUBSPOT_CAPABILITY = "hubspot";
const SUPPORT_STATUS_KEYS = Object.values(HUBSPOT_CAPABILITY_SUPPORT_STATUSES);

/**
 * Classify HubSpot support from local Exo state and already-recorded runtime
 * probe facts. This owner intentionally does not call the HubSpot connector.
 *
 * @param {{
 *   row?: any,
 *   accounts?: any[] | null,
 *   backendInboundSurfaces?: string[] | null,
 *   runtimeProbeFacts?: any[] | null,
 * }} [input]
 */
export function buildHubSpotCapabilityReconciliation(input = {}) {
  const row = input.row ?? buildDefaultHubSpotSupportRow();
  const backendInboundSurfaces = normalizeStringList(input.backendInboundSurfaces);
  const runtimeProbeFacts = normalizeRuntimeProbeFacts(input.runtimeProbeFacts);
  const accounts = normalizeHubSpotAccounts(input.accounts);
  const reconciledAccounts = accounts.map((account) =>
    buildAccountReconciliation({
      row,
      account,
      runtimeProbeFact: findRuntimeProbeFact(account, runtimeProbeFacts),
      backendInboundSurfaces,
    })
  );
  const summary = buildSummaryReconciliation({
    row,
    accounts: reconciledAccounts,
    backendInboundSurfaces,
  });

  return {
    capabilityKey: HUBSPOT_CAPABILITY,
    owner: HUBSPOT_CAPABILITY_RECONCILIATION_OWNER,
    backendInboundSurfaces,
    runtimeProbeFactCount: runtimeProbeFacts.length,
    summary,
    accounts: reconciledAccounts,
  };
}

/**
 * @param {{
 *   row: any,
 *   account: ReturnType<typeof normalizeHubSpotAccounts>[number],
 *   runtimeProbeFact: ReturnType<typeof normalizeRuntimeProbeFacts>[number] | null,
 *   backendInboundSurfaces: string[],
 * }} input
 */
function buildAccountReconciliation(input) {
  const support = classifyAccountSupport(input);
  const seam = buildCapabilitySeamResult({
    row: input.row,
    state: support.state,
    reason: support.reason,
    missingProofSurfaces: support.missingProofSurfaces,
    evidence: support.evidence,
    checkedAt: support.checkedAt,
    debt: support.debt,
  });

  return {
    accountId: input.account.id,
    capability: HUBSPOT_CAPABILITY,
    handle: input.account.handle,
    label: input.account.label,
    sourceType: input.account.sourceType,
    preferred: input.account.preferred,
    preference: input.account.preferred ? "preferred" : "non_preferred",
    supportStatus: support.supportStatus,
    seam,
  };
}

/**
 * @param {{
 *   row: any,
 *   accounts: ReturnType<typeof buildAccountReconciliation>[],
 *   backendInboundSurfaces: string[],
 * }} input
 */
function buildSummaryReconciliation(input) {
  const counts = buildSupportCounts(input.accounts);
  const support = classifySummarySupport(input.accounts, input.backendInboundSurfaces);
  const seam = buildCapabilitySeamResult({
    row: input.row,
    state: support.state,
    reason: support.reason,
    missingProofSurfaces: support.missingProofSurfaces,
    evidence: support.evidence,
    checkedAt: support.checkedAt,
    debt: support.debt,
  });

  return {
    ...seam,
    supportStatus: support.supportStatus,
    accountCount: input.accounts.length,
    preferredAccountCount: input.accounts.filter((account) => account.preferred).length,
    nonPreferredAccountCount: input.accounts.filter((account) => !account.preferred).length,
    counts,
  };
}

/**
 * @param {{
 *   account: ReturnType<typeof normalizeHubSpotAccounts>[number],
 *   runtimeProbeFact: ReturnType<typeof normalizeRuntimeProbeFacts>[number] | null,
 *   backendInboundSurfaces: string[],
 * }} input
 */
function classifyAccountSupport(input) {
  if (input.runtimeProbeFact?.status === "success") {
    return {
      supportStatus: HUBSPOT_CAPABILITY_SUPPORT_STATUSES.CHECKED_RUNTIME,
      state: CAPABILITY_SEAM_STATES.QUIET,
      reason: "hubspot_runtime_probe_checked",
      missingProofSurfaces: [],
      evidence: [buildRuntimeProbeEvidence(input.account, input.runtimeProbeFact)],
      checkedAt: input.runtimeProbeFact.checkedAt,
      debt: null,
    };
  }

  if (input.runtimeProbeFact?.status === "failed") {
    return {
      supportStatus: HUBSPOT_CAPABILITY_SUPPORT_STATUSES.FAILED_RUNTIME,
      state: CAPABILITY_SEAM_STATES.CONTRADICTED,
      reason: "hubspot_runtime_probe_failed",
      missingProofSurfaces: ["hubspot-runtime-probe"],
      evidence: [buildRuntimeProbeEvidence(input.account, input.runtimeProbeFact)],
      checkedAt: input.runtimeProbeFact.checkedAt,
      debt: {
        kind: "runtime_probe_failure",
        accountId: input.account.id,
        error: input.runtimeProbeFact.error,
      },
    };
  }

  if (input.backendInboundSurfaces.length === 0) {
    return {
      supportStatus: HUBSPOT_CAPABILITY_SUPPORT_STATUSES.UNSUPPORTED,
      state: CAPABILITY_SEAM_STATES.UNSUPPORTED,
      reason: "hubspot_has_no_backend_inbound_surfaces",
      missingProofSurfaces: [],
      evidence: [],
      checkedAt: null,
      debt: null,
    };
  }

  return {
    supportStatus: HUBSPOT_CAPABILITY_SUPPORT_STATUSES.UNCONFIGURED,
    state: CAPABILITY_SEAM_STATES.MISSING_PROOF,
    reason: "hubspot_runtime_probe_not_configured",
    missingProofSurfaces: ["hubspot-runtime-probe"],
    evidence: [],
    checkedAt: null,
    debt: {
      kind: "missing_runtime_probe_fact",
      accountId: input.account.id,
    },
  };
}

/**
 * @param {ReturnType<typeof buildAccountReconciliation>[]} accounts
 * @param {string[]} backendInboundSurfaces
 */
function classifySummarySupport(accounts, backendInboundSurfaces) {
  if (accounts.length === 0) {
    return {
      supportStatus: HUBSPOT_CAPABILITY_SUPPORT_STATUSES.UNCONFIGURED,
      state: CAPABILITY_SEAM_STATES.MISSING_PROOF,
      reason: "hubspot_managed_account_not_configured",
      missingProofSurfaces: ["hubspot-managed-account"],
      evidence: [],
      checkedAt: null,
      debt: {
        kind: "missing_hubspot_managed_account",
      },
    };
  }

  const failedAccounts = accounts.filter((account) =>
    account.supportStatus === HUBSPOT_CAPABILITY_SUPPORT_STATUSES.FAILED_RUNTIME
  );
  if (failedAccounts.length > 0) {
    return {
      supportStatus: HUBSPOT_CAPABILITY_SUPPORT_STATUSES.FAILED_RUNTIME,
      state: CAPABILITY_SEAM_STATES.CONTRADICTED,
      reason: "hubspot_runtime_probe_failed",
      missingProofSurfaces: ["hubspot-runtime-probe"],
      evidence: failedAccounts.flatMap((account) => account.seam.evidence),
      checkedAt: newestCheckedAt(failedAccounts),
      debt: {
        kind: "runtime_probe_failure",
        accountIds: failedAccounts.map((account) => account.accountId),
      },
    };
  }

  const checkedAccounts = accounts.filter((account) =>
    account.supportStatus === HUBSPOT_CAPABILITY_SUPPORT_STATUSES.CHECKED_RUNTIME
  );
  if (checkedAccounts.length > 0) {
    return {
      supportStatus: HUBSPOT_CAPABILITY_SUPPORT_STATUSES.CHECKED_RUNTIME,
      state: CAPABILITY_SEAM_STATES.QUIET,
      reason: "hubspot_runtime_probe_checked",
      missingProofSurfaces: [],
      evidence: checkedAccounts.flatMap((account) => account.seam.evidence),
      checkedAt: newestCheckedAt(checkedAccounts),
      debt: null,
    };
  }

  if (backendInboundSurfaces.length === 0) {
    return {
      supportStatus: HUBSPOT_CAPABILITY_SUPPORT_STATUSES.UNSUPPORTED,
      state: CAPABILITY_SEAM_STATES.UNSUPPORTED,
      reason: "hubspot_has_no_backend_inbound_surfaces",
      missingProofSurfaces: [],
      evidence: [],
      checkedAt: null,
      debt: null,
    };
  }

  return {
    supportStatus: HUBSPOT_CAPABILITY_SUPPORT_STATUSES.UNCONFIGURED,
    state: CAPABILITY_SEAM_STATES.MISSING_PROOF,
    reason: "hubspot_runtime_probe_not_configured",
    missingProofSurfaces: ["hubspot-runtime-probe"],
    evidence: [],
    checkedAt: null,
    debt: {
      kind: "missing_runtime_probe_fact",
      accountIds: accounts.map((account) => account.accountId),
    },
  };
}

/**
 * @param {ReturnType<typeof buildAccountReconciliation>[]} accounts
 */
function buildSupportCounts(accounts) {
  const bySupportStatus = Object.fromEntries(SUPPORT_STATUS_KEYS.map((status) => [status, 0]));

  for (const account of accounts) {
    bySupportStatus[account.supportStatus] += 1;
  }

  return {
    bySupportStatus,
    checkedRuntimeCount: bySupportStatus[HUBSPOT_CAPABILITY_SUPPORT_STATUSES.CHECKED_RUNTIME],
    failedRuntimeCount: bySupportStatus[HUBSPOT_CAPABILITY_SUPPORT_STATUSES.FAILED_RUNTIME],
    unsupportedCount: bySupportStatus[HUBSPOT_CAPABILITY_SUPPORT_STATUSES.UNSUPPORTED],
    unconfiguredCount: bySupportStatus[HUBSPOT_CAPABILITY_SUPPORT_STATUSES.UNCONFIGURED],
  };
}

/**
 * @param {ReturnType<typeof normalizeHubSpotAccounts>[number]} account
 * @param {ReturnType<typeof normalizeRuntimeProbeFacts>[number]} fact
 */
function buildRuntimeProbeEvidence(account, fact) {
  const evidence = {
    accountId: account.id,
    connector: fact.connector,
    providerAccountId: fact.providerAccountId ?? null,
    runtime: fact.runtime,
    status: fact.status,
  };

  if (fact.status === "failed" && fact.error) {
    return {
      ...evidence,
      error: fact.error,
    };
  }

  return evidence;
}

/**
 * @param {ReturnType<typeof normalizeHubSpotAccounts>[number]} account
 * @param {ReturnType<typeof normalizeRuntimeProbeFacts>} facts
 */
function findRuntimeProbeFact(account, facts) {
  return facts.find((fact) =>
    (fact.accountId && fact.accountId === account.id)
    || (fact.providerAccountId && fact.providerAccountId === account.providerAccountId)
    || (fact.handle && fact.handle === account.handle)
  ) ?? null;
}

/**
 * @param {ReturnType<typeof buildAccountReconciliation>[]} accounts
 */
function newestCheckedAt(accounts) {
  return accounts
    .map((account) => account.seam.checkedAt)
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1) ?? null;
}

/**
 * @param {any[] | null | undefined} accounts
 */
function normalizeHubSpotAccounts(accounts) {
  if (!Array.isArray(accounts)) return [];

  return accounts
    .filter((account) => String(account?.capability ?? "").trim().toLowerCase() === HUBSPOT_CAPABILITY)
    .map((account) => ({
      id: normalizeNullableString(account.id) ?? normalizeNullableString(account.accountId) ?? "hubspot-account",
      handle: normalizeNullableString(account.handle) ?? normalizeNullableString(account.providerAccountId) ?? "hubspot-account",
      label: normalizeNullableString(account.label),
      sourceType: normalizeNullableString(account.sourceType),
      providerAccountId: normalizeNullableString(account.providerAccountId),
      preferred: account.preferred === true,
    }));
}

/**
 * @param {any[] | null | undefined} facts
 */
function normalizeRuntimeProbeFacts(facts) {
  if (!Array.isArray(facts)) return [];

  return facts
    .map((fact) => {
      const status = normalizeRuntimeProbeStatus(fact?.status);
      if (!status) return null;

      return {
        accountId: normalizeNullableString(fact.accountId),
        connector: normalizeNullableString(fact.connector) ?? HUBSPOT_CAPABILITY,
        error: normalizeNullableString(fact.error),
        handle: normalizeNullableString(fact.handle),
        providerAccountId: normalizeNullableString(fact.providerAccountId),
        runtime: normalizeNullableString(fact.runtime) ?? "unknown",
        status,
        checkedAt: normalizeNullableString(fact.checkedAt),
      };
    })
    .filter(Boolean);
}

/**
 * @param {unknown} status
 * @returns {"success" | "failed" | null}
 */
function normalizeRuntimeProbeStatus(status) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (["success", "checked", "available", "ok"].includes(normalized)) {
    return "success";
  }
  if (["failed", "failure", "unavailable", "error"].includes(normalized)) {
    return "failed";
  }
  return null;
}

/**
 * @param {unknown} value
 */
function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeNullableString(item))
    .filter((item) => item !== null);
}

/**
 * @param {unknown} value
 */
function normalizeNullableString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}

function buildDefaultHubSpotSupportRow() {
  return {
    id: "support:hubspot-capability",
    kind: "backend_support",
    service: HUBSPOT_CAPABILITY,
    capabilityKey: HUBSPOT_CAPABILITY,
    label: "HubSpot Capability Support",
    sync: { owner: null },
    reconcile: { owner: HUBSPOT_CAPABILITY_RECONCILIATION_OWNER },
    mutate: { owner: null },
    status: {
      sync: "n/a",
      reconcile: "working",
      mutate: "n/a",
    },
    proofSurfaces: ["hubspot-managed-account", "hubspot-runtime-probe"],
    stateKeys: [
      "hubspot.account.configured",
      "hubspot.runtime.available",
      "hubspot.runtime.failed",
    ],
    syncStrategy: "not-applicable-support-classification",
    reconciliationStrategy: "hubspot-managed-account-runtime-support",
    mutationDebtPolicy: "not-applicable",
    kanbanLane: "now",
    gap: "HubSpot managed accounts need support-state classification without pretending unsupported surfaces are unchecked.",
  };
}
