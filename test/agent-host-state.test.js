// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkoutTaskLease,
  clearRuntimeUsageLimit,
  createTaskLeaseFingerprint,
  getActiveTaskLease,
  getSendCircuitBreaker,
  getRecentMotionRunAt,
  getRecentMotionTaskRunAt,
  getRuntimeUsageLimit,
  normalizeAgentHostState,
  pruneInactiveTaskLeases,
  pruneExpiredBrowserBackoffs,
  recordMotionTaskRun,
  recordRuntimeUsageLimit,
  releaseTaskLease,
} from "../src/lib/agent-host-state.js";
import { buildAgentRunLockDir } from "../src/lib/agent-run-lock.js";

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

test("inactive task leases are pruned when no live runner lock exists", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-host-state-"));
  const task = {
    kind: "send_message",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "connection_request",
  };
  const fingerprint = createTaskLeaseFingerprint(task);

  try {
    const checkout = checkoutTaskLease(null, {
      taskKind: task.kind,
      fingerprint,
      workerLabel: "worker-1",
      acquiredAt: "2026-06-15T21:33:21.186Z",
      expiresAt: "2026-06-15T21:48:21.186Z",
      motionId: task.motionId,
      companyId: task.companyId,
      prospectId: task.prospectId,
      surface: task.surface,
      subject: "Prospect One",
      action: "send_connection_request",
    });

    const pruned = pruneInactiveTaskLeases(checkout.state, {
      stateDir,
      now: "2026-06-15T21:34:49.329Z",
    });

    assert.deepEqual(pruned.taskLeases, []);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("inactive task lease pruning preserves legacy shared-lock leases while the host runner is alive", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-host-state-"));
  const task = {
    kind: "run_inbound_sync",
    userId: "user-1",
    accountId: "account-1",
    surface: "linkedin-followers-list",
  };
  const fingerprint = createTaskLeaseFingerprint(task);
  const sharedLockDir = buildAgentRunLockDir({ stateDir });

  try {
    fs.mkdirSync(sharedLockDir, { recursive: true });
    fs.writeFileSync(path.join(sharedLockDir, "pid"), `${process.pid}\n`, "utf8");

    const checkout = checkoutTaskLease(null, {
      taskKind: task.kind,
      fingerprint,
      workerLabel: "worker-1",
      acquiredAt: "2026-06-15T21:33:21.186Z",
      expiresAt: "2026-06-15T21:48:21.186Z",
      userId: task.userId,
      accountId: task.accountId,
      surface: task.surface,
      subject: "LinkedIn inbound truth",
      action: "run_inbound_sync",
    });

    const pruned = pruneInactiveTaskLeases(checkout.state, {
      stateDir,
      now: "2026-06-15T21:34:49.329Z",
    });

    assert.equal(pruned.taskLeases.length, 1);
    assert.equal(pruned.taskLeases[0]?.fingerprint, fingerprint);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("inactive task lease pruning keeps only the newest live lease per lane", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-host-state-"));
  const sharedLockDir = buildAgentRunLockDir({ stateDir });
  const transportLockDir = buildAgentRunLockDir({ stateDir, lane: "transport" });

  try {
    fs.mkdirSync(sharedLockDir, { recursive: true });
    fs.writeFileSync(path.join(sharedLockDir, "pid"), `${process.pid}\n`, "utf8");
    fs.mkdirSync(transportLockDir, { recursive: true });
    fs.writeFileSync(path.join(transportLockDir, "pid"), `${process.pid}\n`, "utf8");

    const olderFingerprint = createTaskLeaseFingerprint({
      kind: "send_message",
      motionId: "motion-1",
      prospectId: "prospect-older",
      surface: "like_post",
    });
    const newerFingerprint = createTaskLeaseFingerprint({
      kind: "send_message",
      motionId: "motion-1",
      prospectId: "prospect-newer",
      surface: "connection_request",
    });

    const olderCheckout = checkoutTaskLease(null, {
      taskKind: "send_message",
      fingerprint: olderFingerprint,
      workerLabel: "worker-1",
      acquiredAt: "2026-06-15T21:33:21.186Z",
      expiresAt: "2026-06-15T21:48:21.186Z",
      motionId: "motion-1",
      prospectId: "prospect-older",
      surface: "like_post",
      subject: "Older transport task",
      action: "like_post",
    });
    const newerCheckout = checkoutTaskLease(olderCheckout.state, {
      taskKind: "send_message",
      fingerprint: newerFingerprint,
      workerLabel: "worker-1",
      acquiredAt: "2026-06-15T21:42:38.620Z",
      expiresAt: "2026-06-15T21:57:38.620Z",
      motionId: "motion-1",
      prospectId: "prospect-newer",
      surface: "connection_request",
      subject: "Newer transport task",
      action: "send_connection_request",
    });

    const pruned = pruneInactiveTaskLeases(newerCheckout.state, {
      stateDir,
      now: "2026-06-15T21:43:02.951Z",
    });

    assert.equal(pruned.taskLeases.length, 1);
    assert.equal(pruned.taskLeases[0]?.fingerprint, newerFingerprint);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
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

test("runtime usage limit records, reads, expires, and clears", () => {
  const recorded = recordRuntimeUsageLimit(normalizeAgentHostState(null), {
    detectedAt: "2026-06-09T16:41:00.000Z",
    unavailableUntil: "2026-06-09T19:12:00.000Z",
    reason: "Codex task failed: You're out of Codex messages.",
    runtime: "codex",
  });

  const active = getRuntimeUsageLimit(recorded, "2026-06-09T17:00:00.000Z");
  assert.equal(active.active, true);
  assert.equal(active.unavailableUntil, "2026-06-09T19:12:00.000Z");
  assert.equal(active.runtime, "codex");
  assert.match(active.reason ?? "", /out of Codex messages/);

  // Past the reset time the hold expires on its own.
  const expired = getRuntimeUsageLimit(recorded, "2026-06-09T19:12:01.000Z");
  assert.equal(expired.active, false);
  assert.equal(expired.unavailableUntil, null);

  // Pruning drops the expired entry from the persisted shape too.
  const pruned = pruneExpiredBrowserBackoffs(recorded, "2026-06-09T19:12:01.000Z");
  assert.equal(pruned.runtimeUsageLimit.unavailableUntil, null);
  assert.equal(pruned.runtimeUsageLimit.reason, null);

  const cleared = clearRuntimeUsageLimit(recorded);
  assert.equal(getRuntimeUsageLimit(cleared, "2026-06-09T17:00:00.000Z").active, false);
});

test("runtime usage limit survives normalization round trips", () => {
  const recorded = recordRuntimeUsageLimit(normalizeAgentHostState(null), {
    detectedAt: "2026-06-09T16:41:00.000Z",
    unavailableUntil: "2026-06-09T19:12:00.000Z",
    reason: "usage limit",
    runtime: "codex",
  });
  const roundTripped = normalizeAgentHostState(JSON.parse(JSON.stringify(recorded)));
  assert.equal(getRuntimeUsageLimit(roundTripped, "2026-06-09T17:00:00.000Z").active, true);
});

test("scope-local exact inbox send breakers are cleared during normalization", () => {
  const state = normalizeAgentHostState({
    sendCircuitBreaker: {
      consecutiveFailures: 2,
      unavailableUntil: "2026-06-15T17:17:50.670Z",
      reason: "Multiple Gmail inboxes are mapped for william-main. Pick one exact inbox on this motion before email work can run.",
      lastFailureAt: "2026-06-15T05:17:50.670Z",
      lastTaskFingerprint: "task-1",
      lastTaskLabel: "Jon Condouret at Prospeo",
    },
  });

  assert.equal(state.sendCircuitBreaker.unavailableUntil, null);
  assert.equal(
    getSendCircuitBreaker(state, "2026-06-15T16:00:00.000Z").active,
    false,
  );
});
