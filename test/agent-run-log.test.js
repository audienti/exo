// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildAgentRunLog } from "../src/core/agent-run-log.js";

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
      waitingTaskCount: 1,
      blockerCount: 0,
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
      waitingTaskCount: 4,
      blockerCount: 1,
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
