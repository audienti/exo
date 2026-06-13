// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildAccountCapabilityHealth } from "../src/core/account-capability-health.js";

const BASE_TIME = "2026-06-03T12:00:00.000Z";

function buildUser(accounts) {
  return {
    id: "user-1",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    label: "William",
    owner: "William",
    accounts,
  };
}

function buildAccount(overrides) {
  return {
    id: overrides.id,
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    capability: overrides.capability,
    handle: overrides.handle ?? "operator@example.com",
    label: overrides.label ?? null,
    sourceType: "harness-connection",
    harnessConnectionId: overrides.harnessConnectionId ?? `harness-${overrides.id}`,
    preferred: overrides.preferred ?? false,
    inboundSync: {
      surfaces: overrides.surfaces ?? [],
    },
  };
}

test("buildAccountCapabilityHealth reports preferred Gmail with enabled never-run inbox as unchecked", () => {
  const view = buildAccountCapabilityHealth(buildUser([
    buildAccount({
      id: "gmail-1",
      capability: "gmail",
      handle: "operator@example.com",
      preferred: true,
      surfaces: [
        {
          surfaceKey: "gmail-inbox-threads",
          enabled: true,
          lastRunStatus: "never",
        },
      ],
    }),
  ]), { now: BASE_TIME });

  assert.deepEqual(
    view.accounts.map((account) => ({
      accountId: account.accountId,
      capability: account.capability,
      preferred: account.preferred,
      status: account.status,
      healthy: account.healthy,
      unhealthySurfaceCount: account.unhealthySurfaceCount,
      surfaces: account.surfaces.map((surface) => ({
        key: surface.key,
        status: surface.status,
        enabled: surface.enabled,
      })),
    })),
    [
      {
        accountId: "gmail-1",
        capability: "gmail",
        preferred: true,
        status: "unchecked",
        healthy: false,
        unhealthySurfaceCount: 1,
        surfaces: [
          {
            key: "gmail-inbox-threads",
            status: "unchecked",
            enabled: true,
          },
        ],
      },
    ],
  );
});

test("buildAccountCapabilityHealth reports stale Gmail inbox facts from sync timestamps", () => {
  const view = buildAccountCapabilityHealth(buildUser([
    buildAccount({
      id: "gmail-1",
      capability: "gmail",
      preferred: true,
      surfaces: [
        {
          surfaceKey: "gmail-inbox-threads",
          enabled: true,
          lastRunStatus: "success",
          lastObservedAt: "2026-06-03T04:00:00.000Z",
        },
      ],
    }),
  ]), { now: BASE_TIME });

  assert.equal(view.accounts[0].status, "stale");
  assert.equal(view.accounts[0].healthy, false);
  assert.deepEqual(view.accounts[0].surfaces.map((surface) => surface.status), ["stale"]);
});

test("buildAccountCapabilityHealth reports HubSpot with no backend surfaces as unsupported instead of unchecked", () => {
  const view = buildAccountCapabilityHealth(buildUser([
    buildAccount({
      id: "hubspot-1",
      capability: "hubspot",
      handle: "245546701",
      preferred: true,
    }),
  ]), { now: BASE_TIME });

  assert.deepEqual(
    view.accounts.map((account) => ({
      accountId: account.accountId,
      capability: account.capability,
      status: account.status,
      healthy: account.healthy,
      surfaceCount: account.surfaces.length,
      reason: account.reason,
    })),
    [
      {
        accountId: "hubspot-1",
        capability: "hubspot",
        status: "unsupported",
        healthy: true,
        surfaceCount: 0,
        reason: "No backend inbound surfaces are defined for this account capability.",
      },
    ],
  );
});

test("buildAccountCapabilityHealth treats explicitly disabled surfaces as non-unhealthy", () => {
  const view = buildAccountCapabilityHealth(buildUser([
    buildAccount({
      id: "gmail-1",
      capability: "gmail",
      preferred: true,
      surfaces: [
        {
          surfaceKey: "gmail-inbox-threads",
          enabled: false,
          lastRunStatus: "never",
        },
      ],
    }),
  ]), { now: BASE_TIME });

  assert.deepEqual(
    {
      status: view.accounts[0].status,
      healthy: view.accounts[0].healthy,
      unhealthySurfaceCount: view.accounts[0].unhealthySurfaceCount,
      surfaceStatuses: view.accounts[0].surfaces.map((surface) => surface.status),
    },
    {
      status: "disabled",
      healthy: true,
      unhealthySurfaceCount: 0,
      surfaceStatuses: ["disabled"],
    },
  );
});

test("buildAccountCapabilityHealth reports failed backend checks as unhealthy", () => {
  const view = buildAccountCapabilityHealth(buildUser([
    buildAccount({
      id: "gmail-1",
      capability: "gmail",
      preferred: true,
      surfaces: [
        {
          surfaceKey: "gmail-inbox-threads",
          enabled: true,
          lastRunStatus: "failed",
          lastSyncedAt: "2026-06-03T11:55:00.000Z",
          lastError: "Gmail connector timed out.",
        },
      ],
    }),
  ]), { now: BASE_TIME });

  assert.equal(view.accounts[0].status, "failed");
  assert.equal(view.accounts[0].healthy, false);
  assert.equal(view.accounts[0].unhealthySurfaceCount, 1);
  assert.deepEqual(view.accounts[0].surfaces.map((surface) => surface.status), ["failed"]);
});

test("buildAccountCapabilityHealth reports configured capabilities with no enabled backend surfaces as unconfigured", () => {
  const view = buildAccountCapabilityHealth(buildUser([
    buildAccount({
      id: "gmail-1",
      capability: "gmail",
      preferred: true,
    }),
  ]), {
    now: BASE_TIME,
    surfaceCatalog: [
      {
        key: "gmail-inbox-threads",
        capability: "gmail",
        platform: "gmail",
        label: "Inbox Threads",
        summary: "Email thread changes and inbound replies on previously touched prospects.",
        truthLevel: "authoritative",
        retrievalMode: "connector",
        defaultEnabled: false,
        autonomousBackgroundRetrieval: true,
        autonomousBackgroundReason: null,
        automationCadenceMs: 6 * 60 * 60 * 1000,
        observationKinds: ["email_reply_received", "email_thread_updated"],
        toolMethodId: null,
      },
    ],
  });

  assert.equal(view.accounts[0].status, "unconfigured");
  assert.equal(view.accounts[0].healthy, true);
  assert.equal(view.accounts[0].unhealthySurfaceCount, 0);
  assert.deepEqual(view.accounts[0].surfaces.map((surface) => surface.status), ["disabled"]);
});

test("buildAccountCapabilityHealth reports fresh successful backend facts as checked", () => {
  const view = buildAccountCapabilityHealth(buildUser([
    buildAccount({
      id: "gmail-1",
      capability: "gmail",
      preferred: true,
      surfaces: [
        {
          surfaceKey: "gmail-inbox-threads",
          enabled: true,
          lastRunStatus: "success",
          lastObservedAt: "2026-06-03T11:30:00.000Z",
        },
      ],
    }),
  ]), { now: BASE_TIME });

  assert.equal(view.accounts[0].status, "checked");
  assert.equal(view.accounts[0].healthy, true);
  assert.deepEqual(view.counts.byStatus, {
    checked: 1,
    unchecked: 0,
    stale: 0,
    failed: 0,
    unsupported: 0,
    disabled: 0,
    unconfigured: 0,
  });
});
