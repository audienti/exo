// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildNodeTestEnv } from "../scripts/node-test-runtime.js";
import { buildAgentRunLog } from "../src/core/agent-run-log.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

function makeStateDir(prefix) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    tempRoot,
    stateDir: path.join(tempRoot, ".exo"),
    cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

test("buildAgentRunLog returns an empty stable contract when artifacts are missing", () => {
  const fixture = makeStateDir("exo-agent-run-log-empty-");

  try {
    const runLog = buildAgentRunLog({
      stateDir: fixture.stateDir,
      now: "2026-06-11T12:00:00.000Z",
    });

    assert.equal(runLog.stateDir, fixture.stateDir);
    assert.equal(runLog.checkedAt, "2026-06-11T12:00:00.000Z");
    assert.deepEqual(runLog.entries, []);
    assert.equal(runLog.artifacts.hostState.exists, false);
    assert.equal(runLog.artifacts.lastPass.exists, false);
    assert.equal(runLog.artifacts.agentLog.exists, false);
    assert.deepEqual(runLog.warnings, []);
  } finally {
    fixture.cleanup();
  }
});

test("buildAgentRunLog skips malformed agent.log JSON blocks and keeps parseable run entries", () => {
  const fixture = makeStateDir("exo-agent-run-log-malformed-");

  try {
    fs.mkdirSync(fixture.stateDir, { recursive: true });
    fs.writeFileSync(path.join(fixture.stateDir, "agent.log"), [
      "started_at=2026-06-11T09:00:00-0400 EDT",
      "{ malformed json",
      JSON.stringify({
        status: "completed",
        startedAt: "2026-06-11T13:00:00.000Z",
        endedAt: "2026-06-11T13:00:02.000Z",
        lane: "transport",
        results: [
          { kind: "run_inbound_sync", status: "completed" },
        ],
        finalQueueCounts: {
          dueTaskCount: 2,
          waitingTaskCount: 1,
          blockerCount: 0,
        },
      }, null, 2),
    ].join("\n"));

    const runLog = buildAgentRunLog({
      stateDir: fixture.stateDir,
      now: "2026-06-11T13:05:00.000Z",
    });

    assert.equal(runLog.entries.length, 1);
    assert.equal(runLog.entries[0].status, "completed");
    assert.equal(runLog.entries[0].lane, "transport");
    assert.equal(runLog.entries[0].taskKind, "run_inbound_sync");
    assert.equal(runLog.entries[0].resultCounts.total, 1);
    assert.deepEqual(runLog.entries[0].queueCounts, {
      dueTaskCount: 2,
      readyTaskCount: 2,
      waitingTaskCount: 1,
      blockerCount: 0,
      partialTaskCount: 0,
      statusCounts: {
        ready: 2,
        waiting: 1,
        blocked: 0,
        partial: 0,
        readyIncludesWaiting: false,
      },
    });
    assert.equal(runLog.entries[0].sourceArtifact.kind, "agent.log");
    assert.ok(runLog.warnings.some((warning) =>
      warning.sourceArtifact.kind === "agent.log"
      && /malformed/i.test(warning.message)
    ));
  } finally {
    fixture.cleanup();
  }
});

test("buildAgentRunLog normalizes last-pass and host-state facts into recent entries", () => {
  const fixture = makeStateDir("exo-agent-run-log-normal-");

  try {
    writeJson(path.join(fixture.stateDir, "agent-last-pass.json"), {
      status: "partial",
      reason: "Transport blocked after one task.",
      startedAt: "2026-06-11T14:00:00.000Z",
      endedAt: "2026-06-11T14:02:00.000Z",
      results: [
        { kind: "run_inbound_sync", status: "completed" },
        { kind: "send_message", status: "blocked" },
        { kind: "send_message", status: "failed" },
      ],
      finalQueueCounts: {
        dueTaskCount: 3,
        waitingTaskCount: 4,
        blockerCount: 1,
      },
      lanes: [
        {
          lane: "transport",
          status: "blocked",
          startedAt: "2026-06-11T14:00:00.000Z",
          endedAt: "2026-06-11T14:01:10.000Z",
          results: [
            { kind: "send_message", status: "blocked" },
          ],
          finalQueueCounts: {
            dueTaskCount: 3,
            waitingTaskCount: 4,
            blockerCount: 1,
          },
        },
        {
          lane: "research",
          status: "completed",
          startedAt: "2026-06-11T14:00:05.000Z",
          endedAt: "2026-06-11T14:02:00.000Z",
          results: [
            { kind: "company_research", status: "completed" },
          ],
          finalQueueCounts: {
            dueTaskCount: 3,
            waitingTaskCount: 4,
            blockerCount: 1,
          },
        },
      ],
    });
    writeJson(path.join(fixture.stateDir, "agent-host-state.json"), {
      recentMotionTaskRuns: [
        {
          taskKind: "company_research",
          motionId: "motion-1",
          companyId: "company-1",
          recordedAt: "2026-06-11T14:03:00.000Z",
          status: "completed",
        },
      ],
      recentTaskVerifications: [
        {
          taskKind: "send_message",
          fingerprint: "send-fingerprint-1",
          verifiedAt: "2026-06-11T14:04:00.000Z",
          expiresAt: "2026-06-11T20:04:00.000Z",
          verificationStatus: "ready_to_send",
        },
      ],
    });

    const runLog = buildAgentRunLog({
      stateDir: fixture.stateDir,
      now: "2026-06-11T14:05:00.000Z",
      limit: 10,
    });

    const mergedPass = runLog.entries.find((entry) =>
      entry.sourceArtifact.kind === "agent-last-pass"
      && entry.lane === null
    );
    assert.ok(mergedPass);
    assert.equal(mergedPass.status, "partial");
    assert.equal(mergedPass.taskKind, "multiple");
    assert.deepEqual(mergedPass.taskKinds, ["run_inbound_sync", "send_message"]);
    assert.equal(mergedPass.resultCounts.total, 3);
    assert.equal(mergedPass.resultCounts.completed, 1);
    assert.equal(mergedPass.resultCounts.blocked, 1);
    assert.equal(mergedPass.resultCounts.failed, 1);
    assert.deepEqual(mergedPass.queueCounts, {
      dueTaskCount: 3,
      readyTaskCount: 3,
      waitingTaskCount: 4,
      blockerCount: 1,
      partialTaskCount: 0,
      statusCounts: {
        ready: 3,
        waiting: 4,
        blocked: 1,
        partial: 0,
        readyIncludesWaiting: false,
      },
    });

    const transportLane = runLog.entries.find((entry) =>
      entry.sourceArtifact.kind === "agent-last-pass"
      && entry.lane === "transport"
    );
    assert.ok(transportLane);
    assert.equal(transportLane.taskKind, "send_message");
    assert.equal(transportLane.resultCounts.blocked, 1);

    const motionRun = runLog.entries.find((entry) =>
      entry.sourceArtifact.kind === "agent-host-state"
      && entry.sourceArtifact.section === "recentMotionTaskRuns"
    );
    assert.ok(motionRun);
    assert.equal(motionRun.timestamp, "2026-06-11T14:03:00.000Z");
    assert.equal(motionRun.status, "completed");
    assert.equal(motionRun.taskKind, "company_research");

    const verification = runLog.entries.find((entry) =>
      entry.sourceArtifact.kind === "agent-host-state"
      && entry.sourceArtifact.section === "recentTaskVerifications"
    );
    assert.ok(verification);
    assert.equal(verification.timestamp, "2026-06-11T14:04:00.000Z");
    assert.equal(verification.status, "ready_to_send");
    assert.equal(verification.taskKind, "send_message");
  } finally {
    fixture.cleanup();
  }
});

test("buildAgentRunLog preserves transport and config reasons from last-pass results", () => {
  const fixture = makeStateDir("exo-agent-run-log-runtime-truth-");

  try {
    writeJson(path.join(fixture.stateDir, "agent-last-pass.json"), {
      status: "blocked",
      reason: "linkedin live sync requires a configured Unipile base URL.",
      startedAt: "2026-06-11T14:10:00.000Z",
      endedAt: "2026-06-11T14:11:00.000Z",
      lane: "transport",
      results: [
        {
          kind: "run_inbound_sync",
          status: "completed",
          detail: {
            transport: "direct_payload",
            configReason: "missing_unipile_base_url",
            surfaceStatus: "failed",
            surfaceError: "linkedin live sync requires a configured Unipile base URL.",
          },
        },
        {
          kind: "send_message",
          status: "completed",
          detail: {
            transport: "connector_native",
            fallbackFrom: "unipile_http_same_credentials",
            directUnipileFailureReason: "send_connection_request through Unipile failed (HTTP 503): Provider unavailable",
          },
        },
        {
          kind: "run_inbound_sync",
          status: "completed",
          detail: {
            transport: "direct_payload",
            surfaceError: "LinkedIn live sync requires providerAccountId on LinkedIn account account-1.",
          },
        },
      ],
      finalQueueCounts: {
        dueTaskCount: 2,
        readyTaskCount: 2,
        waitingTaskCount: 1,
        blockerCount: 0,
        partialTaskCount: 1,
        statusCounts: {
          ready: 2,
          waiting: 1,
          blocked: 0,
          partial: 1,
          readyIncludesWaiting: false,
        },
      },
    });

    const runLog = buildAgentRunLog({
      stateDir: fixture.stateDir,
      now: "2026-06-11T14:12:00.000Z",
    });

    assert.equal(runLog.entries.length, 1);
    assert.deepEqual(runLog.entries[0].queueCounts.statusCounts, {
      ready: 2,
      waiting: 1,
      blocked: 0,
      partial: 1,
      readyIncludesWaiting: false,
    });
    assert.deepEqual(runLog.entries[0].runtimeTruth.transports, [
      {
        taskKind: "run_inbound_sync",
        status: "completed",
        transport: "direct_payload",
        fallbackFrom: null,
      },
      {
        taskKind: "send_message",
        status: "completed",
        transport: "connector_native",
        fallbackFrom: "unipile_http_same_credentials",
      },
      {
        taskKind: "run_inbound_sync",
        status: "completed",
        transport: "direct_payload",
        fallbackFrom: null,
      },
    ]);
    assert.deepEqual(runLog.entries[0].runtimeTruth.configReasons, [
      {
        taskKind: "run_inbound_sync",
        status: "completed",
        reason: "missing_unipile_base_url",
        message: "linkedin live sync requires a configured Unipile base URL.",
      },
      {
        taskKind: "run_inbound_sync",
        status: "completed",
        reason: "missing_provider_account_id",
        message: "LinkedIn live sync requires providerAccountId on LinkedIn account account-1.",
      },
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("buildAgentRunLog surfaces active task leases as running entries", () => {
  const fixture = makeStateDir("exo-agent-run-log-active-");

  try {
    writeJson(path.join(fixture.stateDir, "agent-host-state.json"), {
      taskLeases: [
        {
          taskKind: "run_inbound_sync",
          fingerprint: "lease-fingerprint-1",
          workerLabel: "worker@example.local",
          acquiredAt: "2026-06-11T15:00:00.000Z",
          expiresAt: "2026-06-11T15:10:00.000Z",
          userId: "user-1",
          accountId: "account-1",
          capability: "linkedin",
          surface: "linkedin-followers-list",
          subject: "LinkedIn inbound truth",
          action: "run_inbound_sync",
        },
      ],
    });

    const runLog = buildAgentRunLog({
      stateDir: fixture.stateDir,
      now: "2026-06-11T15:02:30.000Z",
      limit: 10,
    });

    const activeEntry = runLog.entries.find((entry) =>
      entry.sourceArtifact.kind === "agent-host-state"
      && entry.sourceArtifact.section === "taskLeases"
    );
    assert.ok(activeEntry);
    assert.equal(activeEntry.status, "running");
    assert.equal(activeEntry.timestamp, "2026-06-11T15:00:00.000Z");
    assert.equal(activeEntry.startedAt, "2026-06-11T15:00:00.000Z");
    assert.equal(activeEntry.endedAt, null);
    assert.equal(activeEntry.taskKind, "run_inbound_sync");
    assert.deepEqual(activeEntry.taskKinds, ["run_inbound_sync"]);
    assert.equal(activeEntry.workerLabel, "worker@example.local");
    assert.equal(activeEntry.subject, "LinkedIn inbound truth");
    assert.equal(activeEntry.userId, "user-1");
    assert.equal(activeEntry.accountId, "account-1");
    assert.equal(activeEntry.capability, "linkedin");
    assert.equal(activeEntry.surface, "linkedin-followers-list");
    assert.equal(activeEntry.expiresAt, "2026-06-11T15:10:00.000Z");
    assert.equal(activeEntry.checkoutFingerprint, "lease-fingerprint-1");
    assert.equal(activeEntry.resultCounts.total, 1);
    assert.deepEqual(activeEntry.resultCounts.byStatus, [
      { status: "running", count: 1 },
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("agent run-log command exposes active task lease entries", () => {
  const fixture = makeStateDir("exo-agent-run-log-cli-");

  try {
    writeJson(path.join(fixture.stateDir, "agent-host-state.json"), {
      taskLeases: [
        {
          taskKind: "run_inbound_sync",
          fingerprint: "lease-fingerprint-2",
          workerLabel: "worker@example.local",
          acquiredAt: "2099-06-11T15:00:00.000Z",
          expiresAt: "2099-06-11T15:10:00.000Z",
          userId: "user-1",
          accountId: "account-1",
          capability: "linkedin",
          surface: "linkedin-sent-invitations",
          subject: "LinkedIn sent invitations",
          action: "run_inbound_sync",
        },
      ],
    });

    const output = execFileSync("node", [
      cliPath,
      "agent",
      "run-log",
      "--json",
      "--limit",
      "5",
    ], {
      cwd: repoRoot,
      env: buildNodeTestEnv({
        ...process.env,
        EXO_STATE_DIR: fixture.stateDir,
        EXO_HOME_STATE_DIR: fixture.stateDir,
      }),
      encoding: "utf8",
    });
    const runLog = JSON.parse(output);
    const activeEntry = runLog.entries.find((entry) =>
      entry.sourceArtifact.section === "taskLeases"
    );

    assert.ok(activeEntry);
    assert.equal(activeEntry.status, "running");
    assert.equal(activeEntry.taskKind, "run_inbound_sync");
    assert.equal(activeEntry.surface, "linkedin-sent-invitations");
  } finally {
    fixture.cleanup();
  }
});

test("agent run-log command stays bounded when agent.log has a large malformed history", () => {
  const fixture = makeStateDir("exo-agent-run-log-large-");

  try {
    writeJson(path.join(fixture.stateDir, "agent-host-state.json"), {
      taskLeases: [
        {
          taskKind: "run_inbound_sync",
          fingerprint: "lease-fingerprint-3",
          workerLabel: "worker@example.local",
          acquiredAt: "2099-06-11T15:00:00.000Z",
          expiresAt: "2099-06-11T15:10:00.000Z",
          userId: "user-1",
          accountId: "account-1",
          capability: "linkedin",
          surface: "linkedin-followers-list",
          subject: "LinkedIn followers",
          action: "run_inbound_sync",
        },
      ],
    });
    fs.mkdirSync(fixture.stateDir, { recursive: true });
    fs.writeFileSync(path.join(fixture.stateDir, "agent.log"), [
      "{",
      ...Array.from({ length: 12000 }, (_, index) =>
        `  "unfinished_${index}": "${"x".repeat(300)}",`
      ),
      JSON.stringify({
        status: "completed",
        startedAt: "2026-06-11T13:00:00.000Z",
        endedAt: "2026-06-11T13:00:02.000Z",
        results: [
          { kind: "run_inbound_sync", status: "completed" },
        ],
      }),
    ].join("\n"));

    const output = execFileSync("node", [
      cliPath,
      "agent",
      "run-log",
      "--json",
      "--limit",
      "5",
    ], {
      cwd: repoRoot,
      env: buildNodeTestEnv({
        ...process.env,
        EXO_STATE_DIR: fixture.stateDir,
        EXO_HOME_STATE_DIR: fixture.stateDir,
      }),
      encoding: "utf8",
      timeout: 1500,
    });
    const runLog = JSON.parse(output);
    assert.ok(runLog.entries.some((entry) =>
      entry.sourceArtifact.section === "taskLeases"
      && entry.status === "running"
      && entry.surface === "linkedin-followers-list"
    ));
  } finally {
    fixture.cleanup();
  }
});
