// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  decideAgentBurstContinuation,
  DEFAULT_AGENT_BURST_MAX_RUNTIME_MS,
  DEFAULT_AGENT_BURST_SOON_WAIT_MS,
} from "../src/lib/agent-burst.js";

test("decideAgentBurstContinuation reruns immediately while due work remains", () => {
  const decision = decideAgentBurstContinuation({
    itemCount: 3,
    waitingCount: 1,
    waiting: [{ dueAt: "2026-06-15T21:30:00.000Z" }],
  }, {
    startedAtMs: 1_000,
    nowMs: 2_000,
  });

  assert.equal(decision.action, "rerun");
  assert.equal(decision.reason, "due_tasks_remain");
  assert.equal(decision.dueTaskCount, 3);
});

test("decideAgentBurstContinuation sleeps for short waits inside the burst window", () => {
  const nowMs = Date.parse("2026-06-15T21:00:00.000Z");
  const nextDueAt = "2026-06-15T21:03:00.000Z";
  const decision = decideAgentBurstContinuation({
    itemCount: 0,
    waitingCount: 1,
    waiting: [{ dueAt: nextDueAt }],
  }, {
    startedAtMs: nowMs - 60_000,
    nowMs,
  });

  assert.equal(decision.action, "sleep");
  assert.equal(decision.reason, "next_due_soon");
  assert.equal(decision.nextDueAt, nextDueAt);
  assert.equal(decision.delayMs, 180_000);
});

test("decideAgentBurstContinuation stops when the next wait is too far out", () => {
  const nowMs = Date.parse("2026-06-15T21:00:00.000Z");
  const decision = decideAgentBurstContinuation({
    itemCount: 0,
    waitingCount: 1,
    waiting: [{ dueAt: "2026-06-15T21:12:00.000Z" }],
  }, {
    startedAtMs: nowMs - 60_000,
    nowMs,
    soonWaitMs: DEFAULT_AGENT_BURST_SOON_WAIT_MS,
  });

  assert.equal(decision.action, "stop");
  assert.equal(decision.reason, "next_due_outside_burst_window");
});

test("decideAgentBurstContinuation stops once the burst window is spent", () => {
  const decision = decideAgentBurstContinuation({
    itemCount: 1,
    waitingCount: 0,
    waiting: [],
  }, {
    startedAtMs: 0,
    nowMs: DEFAULT_AGENT_BURST_MAX_RUNTIME_MS + 1,
  });

  assert.equal(decision.action, "stop");
  assert.equal(decision.reason, "burst_window_elapsed");
});
