// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  HUBSPOT_CAPABILITY_RECONCILIATION_OWNER,
  buildHubSpotCapabilityReconciliation,
} from "../src/core/hubspot-capability-reconciliation.js";
import { buildSeamRegistryRow } from "./support/capability-seam-fixtures.js";

const timestamp = "2026-06-13T14:30:00.000Z";

test("classifies HubSpot with no managed account as unconfigured rather than unchecked", () => {
  const view = buildHubSpotCapabilityReconciliation({
    row: buildHubSpotSupportRow(),
    accounts: [],
    backendInboundSurfaces: [],
    runtimeProbeFacts: [],
  });

  assert.equal(view.summary.supportStatus, "unconfigured");
  assert.equal(view.summary.state, "missing_proof");
  assert.equal(view.summary.checked, false);
  assert.equal(view.summary.supported, true);
  assert.equal(view.summary.requiresAction, true);
  assert.equal(view.summary.accountCount, 0);
  assert.deepEqual(view.summary.missingProofSurfaces, ["hubspot-managed-account"]);
  assert.doesNotMatch(JSON.stringify(view), /unchecked/);
});

test("classifies configured HubSpot with no backend inbound surfaces as unsupported rather than unchecked", () => {
  const view = buildHubSpotCapabilityReconciliation({
    row: buildHubSpotSupportRow(),
    accounts: [
      buildHubSpotAccount({
        id: "hubspot-preferred",
        preferred: true,
      }),
    ],
    backendInboundSurfaces: [],
    runtimeProbeFacts: [],
  });

  assert.equal(view.summary.supportStatus, "unsupported");
  assert.equal(view.summary.state, "unsupported");
  assert.equal(view.summary.checked, false);
  assert.equal(view.summary.supported, false);
  assert.equal(view.summary.requiresAction, false);
  assert.equal(view.summary.accountCount, 1);
  assert.deepEqual(view.summary.counts.bySupportStatus, {
    "checked-runtime": 0,
    "failed-runtime": 0,
    unsupported: 1,
    unconfigured: 0,
  });

  assert.deepEqual(view.accounts.map((account) => ({
    accountId: account.accountId,
    preferred: account.preferred,
    preference: account.preference,
    supportStatus: account.supportStatus,
    state: account.seam.state,
    supported: account.seam.supported,
  })), [
    {
      accountId: "hubspot-preferred",
      preferred: true,
      preference: "preferred",
      supportStatus: "unsupported",
      state: "unsupported",
      supported: false,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(view), /unchecked/);
});

test("classifies runtime probe facts as checked-runtime or failed-runtime without live connector calls", () => {
  let connectorCallCount = 0;

  const view = buildHubSpotCapabilityReconciliation({
    row: buildHubSpotSupportRow(),
    accounts: [
      buildHubSpotAccount({
        id: "hubspot-preferred",
        handle: "245546701",
        providerAccountId: "hubspot-link-1",
        preferred: true,
      }),
      buildHubSpotAccount({
        id: "hubspot-secondary",
        handle: "998877665",
        providerAccountId: "hubspot-link-2",
        preferred: false,
      }),
    ],
    backendInboundSurfaces: [],
    runtimeProbeFacts: [
      {
        accountId: "hubspot-preferred",
        status: "success",
        runtime: "codex",
        connector: "hubspot",
        checkedAt: timestamp,
        providerAccountId: "hubspot-link-1",
      },
      {
        accountId: "hubspot-secondary",
        status: "failed",
        runtime: "codex",
        connector: "hubspot",
        checkedAt: timestamp,
        error: "HubSpot connector is not authenticated.",
      },
    ],
    liveConnectorProbe: () => {
      connectorCallCount += 1;
      throw new Error("live connector probe should not be called by reconciliation");
    },
  });

  assert.equal(connectorCallCount, 0);
  assert.equal(view.summary.supportStatus, "failed-runtime");
  assert.equal(view.summary.state, "contradicted");
  assert.equal(view.summary.requiresAction, true);
  assert.deepEqual(view.summary.counts.bySupportStatus, {
    "checked-runtime": 1,
    "failed-runtime": 1,
    unsupported: 0,
    unconfigured: 0,
  });

  assert.deepEqual(view.accounts.map((account) => ({
    accountId: account.accountId,
    handle: account.handle,
    preferred: account.preferred,
    preference: account.preference,
    supportStatus: account.supportStatus,
    state: account.seam.state,
    checked: account.seam.checked,
    checkedAt: account.seam.checkedAt,
    requiresAction: account.seam.requiresAction,
    evidence: account.seam.evidence,
  })), [
    {
      accountId: "hubspot-preferred",
      handle: "245546701",
      preferred: true,
      preference: "preferred",
      supportStatus: "checked-runtime",
      state: "quiet",
      checked: true,
      checkedAt: timestamp,
      requiresAction: false,
      evidence: [
        {
          accountId: "hubspot-preferred",
          connector: "hubspot",
          providerAccountId: "hubspot-link-1",
          runtime: "codex",
          status: "success",
        },
      ],
    },
    {
      accountId: "hubspot-secondary",
      handle: "998877665",
      preferred: false,
      preference: "non_preferred",
      supportStatus: "failed-runtime",
      state: "contradicted",
      checked: false,
      checkedAt: timestamp,
      requiresAction: true,
      evidence: [
        {
          accountId: "hubspot-secondary",
          connector: "hubspot",
          error: "HubSpot connector is not authenticated.",
          providerAccountId: null,
          runtime: "codex",
          status: "failed",
        },
      ],
    },
  ]);
});

function buildHubSpotSupportRow() {
  return buildSeamRegistryRow({
    id: "support:hubspot-capability",
    kind: "backend_support",
    service: "hubspot",
    capabilityKey: "hubspot",
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
  });
}

function buildHubSpotAccount(overrides = {}) {
  return {
    id: overrides.id ?? "hubspot-account",
    capability: "hubspot",
    handle: overrides.handle ?? "245546701",
    label: overrides.label ?? null,
    sourceType: "harness-connection",
    harnessConnectionId: overrides.harnessConnectionId ?? "harness-hubspot",
    providerAccountId: overrides.providerAccountId ?? "hubspot-link",
    preferred: overrides.preferred ?? false,
  };
}
