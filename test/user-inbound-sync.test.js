// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  INBOUND_SYNC_FAILED_RETRY_MS,
  INBOUND_SYNC_STALE_MS,
  buildInboundAutomationHealthWarnings,
  buildInboundAutomationStatus,
  buildUserInboundSyncPlan,
  classifyInboundSurfaceFreshness,
} from "../src/core/user-inbound-sync.js";

function disabledLinkedinSurfaces() {
  return [
    "linkedin-sent-invitations",
    "linkedin-received-invitations",
    "linkedin-messaging-inbox",
    "linkedin-profile-views",
    "linkedin-followers-list",
    "linkedin-following-list",
    "linkedin-comment-replies",
    "linkedin-catch-up-updates",
  ].map((surfaceKey) => ({
    surfaceKey,
    enabled: false,
    lastRunStatus: "never",
  }));
}

test("classifyInboundSurfaceFreshness backs off immediate retries after failed syncs", () => {
  const failedAt = "2026-06-03T02:00:00.000Z";

  assert.equal(
    classifyInboundSurfaceFreshness(
      { lastRunStatus: "failed", lastSyncedAt: failedAt },
      "2026-06-03T02:10:00.000Z",
    ),
    null,
  );

  assert.deepEqual(
    classifyInboundSurfaceFreshness(
      { lastRunStatus: "failed", lastSyncedAt: failedAt },
      new Date(Date.parse(failedAt) + INBOUND_SYNC_FAILED_RETRY_MS + 1000).toISOString(),
    ),
    {
      reason: "failed",
      dueAt: failedAt,
    },
  );
});

test("classifyInboundSurfaceFreshness does not immediately requeue bounded quick-pass warnings", () => {
  const observedAt = "2026-06-03T02:00:00.000Z";

  assert.equal(
    classifyInboundSurfaceFreshness(
      {
        lastRunStatus: "warning",
        lastObservedAt: observedAt,
        lastExhaustionStatus: "incomplete",
        lastExhaustionReason: "bounded_capture_stopped_early",
        lastReconcileRequired: true,
      },
      "2026-06-03T02:10:00.000Z",
    ),
    null,
  );

  assert.deepEqual(
    classifyInboundSurfaceFreshness(
      {
        lastRunStatus: "warning",
        lastObservedAt: observedAt,
        lastExhaustionStatus: "incomplete",
        lastExhaustionReason: "bounded_capture_stopped_early",
        lastReconcileRequired: true,
      },
      new Date(Date.parse(observedAt) + INBOUND_SYNC_STALE_MS + 1000).toISOString(),
    ),
    {
      reason: "warning",
      dueAt: observedAt,
    },
  );
});

test("classifyInboundSurfaceFreshness skips connector-unsupported failures", () => {
  assert.equal(
    classifyInboundSurfaceFreshness(
      {
        lastRunStatus: "failed",
        lastSyncedAt: "2026-06-03T02:00:00.000Z",
        lastExhaustionStatus: "blocked",
        lastExhaustionReason: "connector_surface_unsupported",
        lastError: "Unipile route failed with 501 errors/feature_not_implemented.",
      },
      "2026-06-03T03:00:00.000Z",
    ),
    null,
  );
});

test("buildInboundAutomationHealthWarnings reports stale autonomous surfaces and ignores manual-only surfaces", () => {
  const warnings = buildInboundAutomationHealthWarnings([
    {
      id: "user-1",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      label: "William",
      owner: "William",
      accounts: [
        {
          id: "account-1",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
          capability: "linkedin",
          handle: "omalab-main",
          label: "LinkedIn",
          sourceType: "browser-profile",
          browserProfileId: "profile-4",
          preferred: true,
          inboundSync: {
            surfaces: [
              {
                surfaceKey: "linkedin-sent-invitations",
                enabled: true,
                lastRunStatus: "success",
                lastObservedAt: "2026-06-03T11:30:00.000Z",
              },
              {
                surfaceKey: "linkedin-received-invitations",
                enabled: true,
                lastRunStatus: "success",
                lastObservedAt: "2026-06-03T11:30:00.000Z",
              },
              {
                surfaceKey: "linkedin-messaging-inbox",
                enabled: true,
                lastRunStatus: "success",
                lastObservedAt: "2026-06-03T04:00:00.000Z",
              },
              {
                surfaceKey: "linkedin-profile-views",
                enabled: true,
                lastRunStatus: "success",
                lastObservedAt: "2026-06-03T11:30:00.000Z",
              },
              {
                surfaceKey: "linkedin-followers-list",
                enabled: true,
                lastRunStatus: "warning",
                lastObservedAt: "2026-06-03T11:30:00.000Z",
              },
              {
                surfaceKey: "linkedin-following-list",
                enabled: true,
                lastRunStatus: "success",
                lastObservedAt: "2026-06-03T11:30:00.000Z",
              },
              {
                surfaceKey: "linkedin-comment-replies",
                enabled: true,
                lastRunStatus: "never",
              },
            ],
          },
        },
      ],
    },
  ], "2026-06-03T12:00:00.000Z");

  assert.deepEqual(
    warnings.map((warning) => ({
      surfaceKey: warning.surfaceKey,
      freshnessState: warning.freshnessState,
      reason: warning.reason,
      inspectCommand: warning.inspectCommand,
    })),
    [
      {
        surfaceKey: "linkedin-messaging-inbox",
        freshnessState: "stale",
        reason: "This enabled background-truth surface is stale and due for refresh.",
        inspectCommand: "exo inbound sync show user-1 --json",
      },
      {
        surfaceKey: "linkedin-followers-list",
        freshnessState: "warning",
        reason: "The last automated retrieval completed with a warning, so truth here may be partial.",
        inspectCommand: "exo inbound sync show user-1 --json",
      },
    ],
  );
});

test("buildInboundAutomationStatus reports fresh surfaces, due surfaces, and the next retrieval horizon", () => {
  const status = buildInboundAutomationStatus([
    {
      id: "user-1",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      label: "William",
      owner: "William",
      accounts: [
        {
          id: "account-1",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
          capability: "linkedin",
          handle: "omalab-main",
          label: "LinkedIn",
          sourceType: "browser-profile",
          browserProfileId: "profile-4",
          preferred: true,
          inboundSync: {
            surfaces: [
              {
                surfaceKey: "linkedin-sent-invitations",
                enabled: true,
                lastRunStatus: "success",
                lastObservedAt: "2026-06-03T11:30:00.000Z",
              },
              {
                surfaceKey: "linkedin-received-invitations",
                enabled: true,
                lastRunStatus: "failed",
                lastSyncedAt: "2026-06-03T11:45:00.000Z",
              },
              {
                surfaceKey: "linkedin-messaging-inbox",
                enabled: true,
                lastRunStatus: "success",
                lastObservedAt: "2026-06-03T04:00:00.000Z",
              },
              {
                surfaceKey: "linkedin-profile-views",
                enabled: true,
                lastRunStatus: "success",
                lastObservedAt: "2026-06-03T11:40:00.000Z",
              },
              {
                surfaceKey: "linkedin-followers-list",
                enabled: true,
                lastRunStatus: "warning",
                lastObservedAt: "2026-06-03T11:30:00.000Z",
              },
              {
                surfaceKey: "linkedin-following-list",
                enabled: true,
                lastRunStatus: "success",
                lastObservedAt: "2026-06-03T11:35:00.000Z",
              },
              {
                surfaceKey: "linkedin-comment-replies",
                enabled: true,
                lastRunStatus: "never",
              },
            ],
          },
        },
      ],
    },
  ], "2026-06-03T12:00:00.000Z");

  assert.deepEqual(status, {
    enabledAutonomousSurfaceCount: 6,
    dueNowCount: 2,
    freshCount: 4,
    retryBackoffCount: 1,
    nextDueSurface: {
      dueAt: "2026-06-03T12:15:00.000Z",
      userId: "user-1",
      userLabel: "William",
      accountId: "account-1",
      capability: "linkedin",
      handle: "omalab-main",
      surfaceKey: "linkedin-received-invitations",
      surfaceLabel: "Received Invitations",
    },
  });
});

test("buildUserInboundSyncPlan exposes owner seam status for stale Gmail truth surfaces", () => {
  const plan = buildUserInboundSyncPlan({
    id: "user-1",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    label: "William",
    owner: "William",
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        capability: "gmail",
        handle: "omalab-main",
        label: "Gmail",
        sourceType: "harness-connection",
        harnessConnectionId: "harness-gmail",
        preferred: true,
        inboundSync: {
          surfaces: [
            {
              surfaceKey: "gmail-inbox-threads",
              enabled: true,
              lastRunStatus: "success",
              lastSyncedAt: "2026-06-03T04:00:00.000Z",
              lastObservedAt: "2026-06-03T04:00:00.000Z",
              lastItemCount: 0,
              lastCaptureCompleteness: "complete",
              lastExhaustionStatus: "complete",
            },
          ],
        },
      },
    ],
  }, {
    mode: "quick",
    now: "2026-06-03T12:00:00.000Z",
  });

  const surface = plan.accounts[0].phases[0].surfaces[0];
  assert.equal(surface.key, "gmail-inbox-threads");
  assert.equal(surface.freshnessState, "stale");
  assert.equal(surface.seamStatus.owner, "src/core/gmail-thread-reconciliation.js");
  assert.equal(surface.seamStatus.state, "stale");
  assert.equal(surface.seamStatus.requiresAction, true);
  assert.deepEqual(surface.seamStatus.proofSurfaces, ["gmail-inbox-threads"]);
});

test("buildInboundAutomationStatus does not keep unsupported or bounded surfaces due immediately", () => {
  const status = buildInboundAutomationStatus([
    {
      id: "user-1",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      label: "William",
      owner: "William",
      accounts: [
        {
          id: "account-1",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
          capability: "linkedin",
          handle: "omalab-main",
          label: "LinkedIn",
          sourceType: "harness-connection",
          harnessConnectionId: "hc-1",
          preferred: true,
          inboundSync: {
            surfaces: disabledLinkedinSurfaces().map((surface) => {
              if (surface.surfaceKey === "linkedin-sent-invitations") {
                return {
                  surfaceKey: "linkedin-sent-invitations",
                  enabled: true,
                  lastRunStatus: "warning",
                  lastObservedAt: "2026-06-03T11:30:00.000Z",
                  lastExhaustionStatus: "incomplete",
                  lastExhaustionReason: "bounded_capture_stopped_early",
                  lastReconcileRequired: true,
                };
              }
              if (surface.surfaceKey === "linkedin-profile-views") {
                return {
                  surfaceKey: "linkedin-profile-views",
                  enabled: true,
                  lastRunStatus: "failed",
                  lastSyncedAt: "2026-06-03T11:45:00.000Z",
                  lastExhaustionStatus: "blocked",
                  lastExhaustionReason: "connector_surface_unsupported",
                  lastError: "Exo does not yet wire Unipile's raw LinkedIn route for profile views into live sync.",
                };
              }
              return surface;
            }),
          },
        },
      ],
    },
  ], "2026-06-03T12:00:00.000Z");

  assert.deepEqual(status, {
    enabledAutonomousSurfaceCount: 2,
    dueNowCount: 0,
    freshCount: 2,
    retryBackoffCount: 0,
    nextDueSurface: {
      dueAt: "2026-06-03T17:30:00.000Z",
      userId: "user-1",
      userLabel: "William",
      accountId: "account-1",
      capability: "linkedin",
      handle: "omalab-main",
      surfaceKey: "linkedin-sent-invitations",
      surfaceLabel: "Sent Invitations",
    },
  });
});

test("buildInboundAutomationHealthWarnings ignores connector-unsupported surfaces", () => {
  const warnings = buildInboundAutomationHealthWarnings([
    {
      id: "user-1",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      label: "William",
      owner: "William",
      accounts: [
        {
          id: "account-1",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
          capability: "linkedin",
          handle: "omalab-main",
          label: "LinkedIn",
          sourceType: "harness-connection",
          harnessConnectionId: "hc-1",
          preferred: true,
          inboundSync: {
            surfaces: disabledLinkedinSurfaces().map((surface) =>
              surface.surfaceKey === "linkedin-profile-views"
                ? {
                    surfaceKey: "linkedin-profile-views",
                    enabled: true,
                    lastRunStatus: "failed",
                    lastSyncedAt: "2026-06-03T11:45:00.000Z",
                    lastExhaustionStatus: "blocked",
                    lastExhaustionReason: "connector_surface_unsupported",
                    lastError: "Exo does not yet wire Unipile's raw LinkedIn route for profile views into live sync.",
                  }
                : surface
            ),
          },
        },
      ],
    },
  ], "2026-06-03T12:00:00.000Z");

  assert.deepEqual(warnings, []);
});

test("buildInboundAutomationHealthWarnings keeps recent failed retrievals as rollout blockers during retry backoff", () => {
  const failedAt = new Date(Date.parse("2026-06-03T12:00:00.000Z") - (5 * 60 * 1000)).toISOString();
  const warnings = buildInboundAutomationHealthWarnings([
    {
      id: "user-1",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      label: "William",
      owner: "William",
      accounts: [
        {
          id: "account-1",
          createdAt: "2026-06-03T00:00:00.000Z",
          updatedAt: "2026-06-03T00:00:00.000Z",
          capability: "gmail",
          handle: "omalab-main",
          label: "Gmail",
          sourceType: "browser-profile",
          browserProfileId: "profile-4",
          preferred: true,
          inboundSync: {
            surfaces: [
              {
                surfaceKey: "gmail-inbox-threads",
                enabled: true,
                lastRunStatus: "failed",
                lastSyncedAt: failedAt,
              },
            ],
          },
        },
      ],
    },
  ], "2026-06-03T12:00:00.000Z");

  assert.deepEqual(warnings, [
    {
      userId: "user-1",
      userLabel: "William",
      accountId: "account-1",
      capability: "gmail",
      handle: "omalab-main",
      surfaceKey: "gmail-inbox-threads",
      surfaceLabel: "Inbox Threads",
      freshnessState: "failed",
      reason: "The last automated retrieval failed and is still in retry backoff, so truth here is currently untrusted.",
      inspectCommand: "exo inbound sync show user-1 --json",
    },
  ]);
});
