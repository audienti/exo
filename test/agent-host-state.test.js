// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkoutTaskLease,
  createTaskLeaseFingerprint,
  getActiveTaskLease,
  getRecentMotionRunAt,
  getRecentMotionTaskRunAt,
  normalizeAgentHostState,
  pruneExpiredBrowserBackoffs,
  recordMotionTaskRun,
  releaseTaskLease,
} from "../src/lib/agent-host-state.js";

test("normalizeAgentHostState includes an empty task lease ledger", () => {
  const state = normalizeAgentHostState(null);
  assert.deepEqual(state.taskLeases, []);
  assert.deepEqual(state.recentMotionTaskRuns, []);
});

test("task lease checkout stores and releases a durable checkout entry", () => {
  const task = {
    kind: "send_message",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
  };
  const fingerprint = createTaskLeaseFingerprint(task);
  const checkout = checkoutTaskLease(null, {
    taskKind: task.kind,
    fingerprint,
    workerLabel: "worker-1",
    acquiredAt: "2026-06-06T21:00:00.000Z",
    expiresAt: "2026-06-06T22:00:00.000Z",
    motionId: task.motionId,
    companyId: task.companyId,
    prospectId: task.prospectId,
    surface: task.surface,
    subject: "Prospect One",
    action: "Send Direct Message",
  });

  assert.equal(checkout.ok, true);
  assert.equal(checkout.state.taskLeases.length, 1);
  assert.equal(
    getActiveTaskLease(checkout.state, fingerprint, "2026-06-06T21:30:00.000Z")?.workerLabel,
    "worker-1",
  );

  const released = releaseTaskLease(checkout.state, fingerprint);
  assert.deepEqual(released.taskLeases, []);
});

test("expired task leases are pruned from host state", () => {
  const task = {
    kind: "run_inbound_sync",
    userId: "user-1",
    accountId: "account-1",
    surface: "linkedin-following-list",
    surfaceKeys: ["linkedin-following-list"],
    mode: "full",
    resumeStartOffset: 10,
  };
  const fingerprint = createTaskLeaseFingerprint(task);
  const checkout = checkoutTaskLease(null, {
    taskKind: task.kind,
    fingerprint,
    workerLabel: "worker-1",
    acquiredAt: "2026-06-06T20:00:00.000Z",
    expiresAt: "2026-06-06T20:30:00.000Z",
    userId: task.userId,
    accountId: task.accountId,
    surface: task.surface,
    subject: "LinkedIn inbound truth",
    action: "Run Inbound Sync",
  });

  const pruned = pruneExpiredBrowserBackoffs(checkout.state, "2026-06-06T20:45:00.000Z");
  assert.deepEqual(pruned.taskLeases, []);
});

test("task lease fingerprints distinguish paginated inbound sync slices", () => {
  const first = createTaskLeaseFingerprint({
    kind: "run_inbound_sync",
    userId: "user-1",
    accountId: "account-1",
    surface: "linkedin-following-list",
    surfaceKeys: ["linkedin-following-list"],
    mode: "full",
    resumeStartOffset: 0,
  });
  const second = createTaskLeaseFingerprint({
    kind: "run_inbound_sync",
    userId: "user-1",
    accountId: "account-1",
    surface: "linkedin-following-list",
    surfaceKeys: ["linkedin-following-list"],
    mode: "full",
    resumeStartOffset: 10,
  });

  assert.notEqual(first, second);
});

test("recordMotionTaskRun keeps the latest per task kind and motion for round-robin ordering", () => {
  const afterFirst = recordMotionTaskRun(null, {
    taskKind: "company_discovery",
    motionId: "motion-1",
    recordedAt: "2026-06-06T20:00:00.000Z",
    status: "completed",
  });

  const afterSecond = recordMotionTaskRun(afterFirst, {
    taskKind: "company_discovery",
    motionId: "motion-2",
    recordedAt: "2026-06-06T21:00:00.000Z",
    status: "failed",
  });

  const updated = recordMotionTaskRun(afterSecond, {
    taskKind: "company_discovery",
    motionId: "motion-1",
    recordedAt: "2026-06-06T22:00:00.000Z",
    status: "completed",
  });

  assert.equal(updated.recentMotionTaskRuns.length, 2);
  assert.equal(getRecentMotionTaskRunAt(updated, "company_discovery", "motion-1"), "2026-06-06T22:00:00.000Z");
  assert.equal(getRecentMotionTaskRunAt(updated, "company_discovery", "motion-2"), "2026-06-06T21:00:00.000Z");
});

test("getRecentMotionRunAt returns the latest recorded motion activity across task kinds", () => {
  const state = recordMotionTaskRun(
    recordMotionTaskRun(
      recordMotionTaskRun(null, {
        taskKind: "company_discovery",
        motionId: "motion-1",
        recordedAt: "2026-06-06T20:00:00.000Z",
        status: "completed",
      }),
      {
        taskKind: "company_research",
        motionId: "motion-1",
        recordedAt: "2026-06-06T21:00:00.000Z",
        status: "completed",
      },
    ),
    {
      taskKind: "prospect_selection",
      motionId: "motion-2",
      recordedAt: "2026-06-06T22:00:00.000Z",
      status: "completed",
    },
  );

  assert.equal(getRecentMotionRunAt(state, "motion-1"), "2026-06-06T21:00:00.000Z");
  assert.equal(
    getRecentMotionRunAt(state, "motion-1", new Set(["company_discovery"])),
    "2026-06-06T20:00:00.000Z",
  );
  assert.equal(getRecentMotionRunAt(state, "motion-2"), "2026-06-06T22:00:00.000Z");
});
