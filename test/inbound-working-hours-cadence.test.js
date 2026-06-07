// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentQueue } from "../src/core/build-agent-queue.js";
import {
  classifyInboundSurfaceFreshness,
  computeInboundAutomationNextDueAt,
} from "../src/core/user-inbound-sync.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function linkedinInboundUser(surfaceOverrides = {}) {
  return {
    id: "user-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "Operator",
    owner: "operator",
    notes: null,
    workingHours: {
      mode: "scheduled",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "07:00",
      endLocalTime: "18:00",
    },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "linkedin",
        handle: "operator-linkedin",
        label: null,
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        providerAccountId: "acct-linkedin-1",
        preferred: true,
        notes: null,
        inboundSync: {
          surfaces: [
            {
              surfaceKey: "linkedin-messaging-inbox",
              enabled: true,
              lastSyncedAt: "2026-06-03T21:00:00.000Z",
              lastObservedAt: "2026-06-03T21:00:00.000Z",
              lastRunStatus: "success",
              lastItemCount: 0,
              lastVisibleTotalCount: 0,
              lastCaptureCompleteness: null,
              lastRequestedMode: null,
              lastActualMode: null,
              lastReconcileRequired: null,
              lastReconcileReason: null,
              lastExhaustionStatus: null,
              lastExhaustionReason: null,
              lastPaginationAttempted: null,
              lastTerminalSignalSeen: null,
              lastStalledPassCount: null,
              lastObservationCount: 0,
              lastItemizationGapCount: 0,
              lastCountDiscrepancyCount: 0,
              lastError: null,
              ...surfaceOverrides,
            },
          ],
        },
      },
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        runtime: "codex",
        connector: "chrome",
        label: "codex:chrome",
        status: "available",
        notes: null,
      },
    ],
  };
}

test("linkedin messaging uses a 15-minute freshness window during open working hours", () => {
  const surface = {
    key: "linkedin-messaging-inbox",
    automationCadenceMs: SIX_HOURS_MS,
    lastRunStatus: "success",
    lastObservedAt: "2026-06-03T14:00:00.000Z",
  };
  const workingHoursStatus = {
    mode: "scheduled",
    openNow: true,
    nextOpenAt: "2026-06-03T14:16:00.000Z",
    summary: "Inside working hours.",
  };

  assert.equal(
    classifyInboundSurfaceFreshness(
      surface,
      "2026-06-03T14:10:00.000Z",
      { workingHoursStatus },
    ),
    null,
  );

  assert.deepEqual(
    classifyInboundSurfaceFreshness(
      surface,
      "2026-06-03T14:16:00.000Z",
      { workingHoursStatus },
    ),
    {
      reason: "stale",
      dueAt: "2026-06-03T14:00:00.000Z",
    },
  );

  assert.equal(
    computeInboundAutomationNextDueAt(surface, { workingHoursStatus }),
    "2026-06-03T14:15:00.000Z",
  );
});

test("buildAgentQueue defers after-hours linkedin refresh to the next open window", () => {
  const queue = buildAgentQueue({
    motions: [],
    companies: [],
    users: [
      linkedinInboundUser({
        lastObservedAt: "2026-06-03T21:00:00.000Z",
        lastSyncedAt: "2026-06-03T21:00:00.000Z",
      }),
    ],
    observations: [],
    cues: [],
    now: "2026-06-03T23:30:00.000Z",
  });

  const task = queue.waiting.find((item) => item.kind === "run_inbound_sync" && item.capability === "linkedin");
  assert.ok(task);
  assert.equal(task.reason, "stale_surface");
  assert.equal(task.queueState, "waiting");
  assert.equal(task.waitingReason, "outside_working_hours");
  assert.equal(task.dueAt, "2026-06-04T11:00:00.000Z");
  assert.ok(task.surfaceKeys.includes("linkedin-sent-invitations"));
});
