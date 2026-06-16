// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildAgentStatusReport } from "../src/core/build-agent-status.js";
import { releaseAgentRunLock, tryAcquireAgentRunLock } from "../src/lib/agent-run-lock.js";

test("agent status reports a mixed due-plus-blocked queue as partial instead of blocked", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-status-"));

  try {
    const report = buildAgentStatusReport({
      stateDir,
      queue: {
        tasks: [{ kind: "send_message", subject: "Runnable send" }],
        waiting: [],
        blockers: [{ reasonCode: "gmail_exact_inbox_required" }],
      },
      hostState: null,
      users: [],
      lastPass: { status: "completed" },
      now: "2026-06-15T16:00:00.000Z",
    });

    assert.equal(report.state, "partial");
    assert.equal(report.partial.active, true);
    assert.match(report.partial.reason ?? "", /1 due task.*1 blocker/i);
    assert.match(report.partial.nextAction ?? "", /keep draining 1 due task/i);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("agent status still reports blocker-only backlog as blocked", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-status-"));

  try {
    const report = buildAgentStatusReport({
      stateDir,
      queue: {
        tasks: [],
        waiting: [],
        blockers: [{ reasonCode: "gmail_exact_inbox_required" }],
      },
      hostState: null,
      users: [],
      lastPass: { status: "completed" },
      now: "2026-06-15T16:00:00.000Z",
    });

    assert.equal(report.state, "blocked");
    assert.equal(report.partial.active, false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("agent status normalizes deferred blocked passes into partial queue pressure", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-status-"));

  try {
    const report = buildAgentStatusReport({
      stateDir,
      queue: {
        tasks: [
          { kind: "send_message", subject: "Queued send A" },
          { kind: "send_message", subject: "Queued send B" },
        ],
        waiting: [
          {
            kind: "send_message",
            subject: "Waiting send",
            waitingReason: "randomized_spacing",
            dueAt: "2026-06-15T16:02:00.000Z",
          },
        ],
        blockers: [],
      },
      hostState: null,
      users: [],
      lastPass: {
        status: "blocked",
        reason: "LinkedIn spacing keeps this outbound action from firing immediately.",
        results: [
          {
            kind: "send_message",
            status: "blocked",
            detail: {
              waitingReason: "randomized_spacing",
              nextDueAt: "2026-06-15T16:02:00.000Z",
            },
          },
        ],
        finalQueueCounts: {
          dueTaskCount: 2,
          waitingTaskCount: 1,
          blockerCount: 0,
        },
      },
      now: "2026-06-15T16:00:00.000Z",
    });

    assert.equal(report.state, "partial");
    assert.equal(report.throughput.lastPass.status, "partial");
    assert.equal(report.partial.active, true);
    assert.equal(report.partial.status, "partial");
    assert.match(report.partial.reason ?? "", /2 due task.*remain/i);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("agent status ignores stale task leases when no live runner lock exists", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-status-"));

  try {
    const report = buildAgentStatusReport({
      stateDir,
      queue: {
        tasks: [],
        waiting: [],
        blockers: [],
      },
      hostState: {
        taskLeases: [
          {
            taskKind: "send_message",
            fingerprint: "stale-send-lease",
            workerLabel: "worker@example.local",
            acquiredAt: "2026-06-15T21:33:21.186Z",
            expiresAt: "2026-06-15T21:48:21.186Z",
            subject: "Prospect One",
            action: "send_connection_request",
            surface: "connection_request",
          },
        ],
      },
      users: [],
      lastPass: { status: "completed" },
      now: "2026-06-15T21:34:49.329Z",
    });

    assert.equal(report.current.active, false);
    assert.equal(report.current.activeTaskCount, 0);
    assert.deepEqual(report.current.tasks, []);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("agent status does not report running for a wrapper-only lock with no lane work", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-status-wrapper-lock-"));
  const stateDir = path.join(tempRoot, ".exo");
  const lockTempDir = path.join(tempRoot, "locks");
  const previousLockTempDir = process.env.EXO_AGENT_RUN_LOCK_TEMP_DIR;
  process.env.EXO_AGENT_RUN_LOCK_TEMP_DIR = lockTempDir;
  const wrapperLock = tryAcquireAgentRunLock({ stateDir, pid: process.pid });
  assert.equal(wrapperLock.acquired, true);

  try {
    const report = buildAgentStatusReport({
      stateDir,
      queue: {
        tasks: [],
        waiting: [
          {
            kind: "send_message",
            waitingReason: "randomized_spacing",
            dueAt: "2026-06-15T16:02:00.000Z",
          },
        ],
        blockers: [],
      },
      hostState: null,
      users: [],
      lastPass: { status: "completed" },
      now: "2026-06-15T16:00:00.000Z",
    });

    assert.equal(report.current.locks.agent.active, true);
    assert.equal(report.current.locks.wrapperActive, true);
    assert.equal(report.current.locks.active, false);
    assert.equal(report.current.active, false);
    assert.equal(report.state, "waiting");
  } finally {
    releaseAgentRunLock(wrapperLock);
    if (previousLockTempDir === undefined) {
      delete process.env.EXO_AGENT_RUN_LOCK_TEMP_DIR;
    } else {
      process.env.EXO_AGENT_RUN_LOCK_TEMP_DIR = previousLockTempDir;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
