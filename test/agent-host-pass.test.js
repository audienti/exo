// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildInboundContractArgs,
  buildBlockedCodexTaskResult,
  buildCodexTaskArgs,
  buildCodexTaskExecOptions,
  buildCodexTaskEnv,
  buildCompanyDiscoveryPrompt,
  buildCompanyResearchPrompt,
  buildDraftOutputSchema,
  buildProspectResearchPrompt,
  buildProspectSelectionPrompt,
  createTaskVerificationFingerprint,
  buildDraftPrompt,
  buildInboundCapturePrompt,
  buildSendPrompt,
  canRunTaskInCurrentPass,
  chooseNextQueueTask,
  explainNoopPass,
  extractDraftBodyFromCodexResponse,
  extractDraftOutputFromCodexResponse,
  getPreflightTaskGate,
  normalizeInboundCaptureForWriteback,
  requiresBrowserAttachForInboundCapture,
  sanitizeCodexOutputSchema,
  summarizePassStatus,
  summarizeVerificationOutput,
  shouldStopAfterTaskResult,
  terminalPacketCompletionMatchesQueueState,
  isBrowserMaintenanceTaskKind,
  getInboundAutomationRolloutBlockReason,
  isAutonomousPacketRunSuccessful,
  classifyHandledLinkedinReplyUnavailable,
  normalizeInboundCaptureFailureReason,
  resolveResearchTaskTimeoutMs,
  resolveCodexConnectorRuntimeConfig,
  resolveInboundExoCommandTimeoutMs,
  shouldAbortPassAfterTaskProblem,
  shouldIgnoreCodexUserConfig,
  shouldPreferBackfillSlice,
} from "../scripts/run-agent-host-pass.js";
import {
  checkoutTaskLease,
  createTaskLeaseFingerprint,
} from "../src/lib/agent-host-state.js";
import {
  releaseAgentRunLock,
  tryAcquireAgentRunLock,
} from "../src/lib/agent-run-lock.js";
import { getLocalDatabase, updateMotion } from "../src/db/database.js";

const HOST_PASS_SCRIPT = path.resolve("scripts/run-agent-host-pass.js");
const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

function runSpawnedHostPass({ stateDir, cwd, lane = null }) {
  return spawnSync(process.execPath, [HOST_PASS_SCRIPT], {
    cwd,
    env: {
      ...process.env,
      EXO_STATE_DIR: stateDir,
      EXO_HOME_STATE_DIR: stateDir,
      ...(lane ? { EXO_AGENT_LANE: lane } : {}),
    },
    encoding: "utf8",
  });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ageSubmittedAccountPacket(motionId, companyId, completedAt) {
  const database = getLocalDatabase();
  const row = database
    .prepare("SELECT payload_json FROM motion_accounts WHERE motion_id = ? AND company_id = ?")
    .get(motionId, companyId);
  assert.ok(row);
  const payload = JSON.parse(row.payload_json);
  payload.packetState = {
    ...(payload.packetState ?? {}),
    completedAt,
  };
  database
    .prepare(`
      UPDATE motion_accounts
      SET payload_json = @payloadJson,
          updated_at = @updatedAt
      WHERE motion_id = @motionId
        AND company_id = @companyId
    `)
    .run({
      payloadJson: JSON.stringify(payload, null, 2),
      updatedAt: completedAt,
      motionId,
      companyId,
    });
}

test("main-module host pass exits cleanly on an empty workspace", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-host-pass-empty-"));
  const stateDir = path.join(tempRoot, ".exo");

  const result = runSpawnedHostPass({ stateDir, cwd: tempRoot });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = readJsonFile(path.join(stateDir, "agent-last-pass.json"));
  assert.equal(summary.status, "noop");
  assert.equal(summary.lane, null);
});

test("main-module host pass persists stale submitted packet review warnings", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-host-pass-stale-review-"));
  const stateDir = path.join(tempRoot, ".exo");
  const previousStateDir = process.env.EXO_STATE_DIR;
  process.env.EXO_STATE_DIR = stateDir;
  const env = { ...process.env, EXO_STATE_DIR: stateDir };

  try {
    const motion = JSON.parse(
      execFileSync("node", [
        cliPath,
        "motion",
        "add",
        "--url",
        "https://example.com/host-pass-stale-review",
        "--premise",
        "This offer matters when host pass summaries must flag stale review packets.",
        "--audience",
        "Revenue operators",
        "--signal",
        "company::Is the host pass summary carrying stale review state?",
        "--json"
      ], {
        cwd: repoRoot,
        env,
        encoding: "utf8",
      })
    );
    const reviewMotion = updateMotion({
      ...motion,
      status: "active",
      packetReviewPolicy: "review",
    });
    const company = JSON.parse(
      execFileSync("node", [
        cliPath,
        "companies",
        "add",
        "--name",
        "Host Pass Review Co",
        "--domain",
        "host-pass-review.example",
        "--motion",
        motion.id,
        "--json"
      ], {
        cwd: repoRoot,
        env,
        encoding: "utf8",
      })
    );
    execFileSync("node", [cliPath, "companies", "queue", "claim", company.id, "--motion", motion.id, "--worker", "host-pass-worker", "--json"], {
      cwd: repoRoot,
      env,
    });
    execFileSync("node", [cliPath, "companies", "queue", "complete", company.id, "--motion", motion.id, "--worker", "host-pass-worker", "--next-status", "researched", "--notes", "Ready for review.", "--json"], {
      cwd: repoRoot,
      env,
    });
    ageSubmittedAccountPacket(motion.id, company.id, "2026-01-01T00:00:00.000Z");
    updateMotion({
      ...reviewMotion,
      status: "draft",
    });

    const result = runSpawnedHostPass({ stateDir, cwd: repoRoot });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = readJsonFile(path.join(stateDir, "agent-last-pass.json"));
    assert.equal(summary.packetReviewWarnings.count, 1);
    assert.equal(summary.packetReviewWarnings.items[0].packetId, `company_research:${company.id}`);
    assert.equal(summary.packetReviewWarnings.items[0].subject, "Host Pass Review Co");
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("main-module host pass persists expired host-state cleanup before default and lane passes", () => {
  for (const lane of [null, "transport"]) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-host-pass-startup-state-"));
    const stateDir = path.join(tempRoot, ".exo");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "agent-host-state.json"), JSON.stringify({
      browserBackoff: {
        retrieval: {
          unavailableUntil: "2026-01-01T00:00:00.000Z",
          reason: "expired retrieval backoff",
        },
        execution: {
          unavailableUntil: "2026-01-01T00:00:00.000Z",
          reason: "expired execution backoff",
        },
      },
      taskLeases: [
        {
          taskKind: "write_draft",
          fingerprint: `expired-${lane ?? "default"}`,
          workerLabel: "worker-stale",
          acquiredAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-01T00:10:00.000Z",
          motionId: "motion-1",
          companyId: "company-1",
          prospectId: "prospect-1",
        },
      ],
      recentTaskVerifications: [
        {
          taskKind: "send_message",
          fingerprint: `verification-${lane ?? "default"}`,
          verifiedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-01T00:10:00.000Z",
        },
      ],
    }, null, 2));

    const result = runSpawnedHostPass({ stateDir, cwd: tempRoot, lane });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summaryName = lane ? `agent-last-pass.${lane}.json` : "agent-last-pass.json";
    const summary = readJsonFile(path.join(stateDir, summaryName));
    assert.equal(summary.status, "noop");
    assert.equal(summary.lane, lane);
    const hostState = readJsonFile(path.join(stateDir, "agent-host-state.json"));
    assert.deepEqual(hostState.taskLeases, []);
    assert.deepEqual(hostState.recentTaskVerifications, []);
    assert.equal(hostState.browserBackoff.retrieval.unavailableUntil, null);
    assert.equal(hostState.browserBackoff.execution.unavailableUntil, null);
  }
});

test("main-module host pass returns a persisted lane noop when that lane lock is held", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-host-pass-lane-lock-"));
  const stateDir = path.join(tempRoot, ".exo");
  fs.mkdirSync(stateDir, { recursive: true });
  const heldLock = tryAcquireAgentRunLock({ stateDir, lane: "transport", pid: process.pid });
  assert.equal(heldLock.acquired, true);

  try {
    const result = runSpawnedHostPass({ stateDir, cwd: tempRoot, lane: "transport" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, "noop");
    assert.equal(summary.lane, "transport");
    assert.match(summary.reason, /Another transport lane pass is already active/i);
    assert.match(summary.reason, new RegExp(`pid ${process.pid}`));

    const persisted = readJsonFile(path.join(stateDir, "agent-last-pass.transport.json"));
    assert.equal(persisted.status, "noop");
    assert.equal(persisted.lane, "transport");
    assert.equal(persisted.reason, summary.reason);
  } finally {
    releaseAgentRunLock(heldLock);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("main-module host pass can start a transport lane while the research lane lock is held", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-host-pass-other-lane-lock-"));
  const stateDir = path.join(tempRoot, ".exo");
  fs.mkdirSync(stateDir, { recursive: true });
  const heldLock = tryAcquireAgentRunLock({ stateDir, lane: "research", pid: process.pid });
  assert.equal(heldLock.acquired, true);

  try {
    const result = runSpawnedHostPass({ stateDir, cwd: tempRoot, lane: "transport" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.status, "noop");
    assert.equal(summary.lane, "transport");
    assert.doesNotMatch(summary.reason, /already active/i);
  } finally {
    releaseAgentRunLock(heldLock);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("scheduled-style lane pass refreshes the merged legacy summary from lane summaries", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-host-pass-merged-summary-"));
  const stateDir = path.join(tempRoot, ".exo");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "agent-last-pass.json"), JSON.stringify({
    status: "failed",
    reason: "stale merged summary",
    lanes: [],
    results: [],
    finalQueueCounts: { dueTaskCount: 99, waitingTaskCount: 99, blockerCount: 99 },
  }, null, 2));
  fs.writeFileSync(path.join(stateDir, "agent-last-pass.research.json"), JSON.stringify({
    status: "noop",
    reason: "research lane already idle",
    startedAt: "2026-06-10T16:00:00.000Z",
    endedAt: "2026-06-10T16:00:02.000Z",
    lane: "research",
    results: [],
    finalQueueCounts: { dueTaskCount: 0, waitingTaskCount: 1, blockerCount: 0 },
  }, null, 2));

  try {
    const result = runSpawnedHostPass({ stateDir, cwd: tempRoot, lane: "transport" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const laneSummary = JSON.parse(result.stdout);
    assert.equal(laneSummary.lane, "transport");

    const merged = readJsonFile(path.join(stateDir, "agent-last-pass.json"));
    assert.notEqual(merged.reason, "stale merged summary");
    assert.deepEqual(merged.lanes.map((lane) => lane.lane).sort(), ["research", "transport"]);
    assert.equal(merged.lanes.find((lane) => lane.lane === "transport").reason, laneSummary.reason);
    assert.equal(merged.lanes.find((lane) => lane.lane === "research").reason, "research lane already idle");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("chooseNextQueueTask prefers connector-native send work before retrieval and draft work even when browser preflight is down", () => {
  const queue = {
    tasks: [
      { kind: "run_inbound_sync", id: "sync-1" },
      { kind: "send_message", id: "send-1" },
      { kind: "write_draft", id: "draft-1" },
    ],
  };

  assert.equal(chooseNextQueueTask(queue, false)?.id, "send-1");
  assert.equal(chooseNextQueueTask(queue, true)?.id, "send-1");
  assert.equal(
    chooseNextQueueTask(
      queue,
      true,
      {
        browserBackoff: {
          execution: {
            unavailableUntil: "2026-06-03T03:00:00.000Z",
            reason: "send lane blocked",
          },
        },
      },
      "2026-06-03T02:00:00.000Z",
    )?.id,
    "send-1",
  );
});

test("chooseNextQueueTask ignores browser-lane backoff for connector-native execution and retrieval work", () => {
  const queue = {
    tasks: [
      { kind: "send_message", id: "send-1" },
      { kind: "run_inbound_sync", id: "sync-1" },
      { kind: "write_draft", id: "draft-1" },
    ],
  };

  assert.equal(
    chooseNextQueueTask(
      queue,
      true,
      {
        browserBackoff: {
          execution: {
            unavailableUntil: "2026-06-03T03:00:00.000Z",
            reason: "send lane blocked",
          },
        },
      },
      "2026-06-03T02:00:00.000Z",
    )?.id,
    "send-1",
  );

  assert.equal(
    chooseNextQueueTask(
      queue,
      true,
      {
        browserBackoff: {
          retrieval: {
            unavailableUntil: "2026-06-03T03:00:00.000Z",
            reason: "retrieval lane blocked",
          },
        },
      },
      "2026-06-03T02:00:00.000Z",
    )?.id,
    "send-1",
  );

  assert.equal(
    chooseNextQueueTask(
      queue,
      true,
      {
        browserBackoff: {
          execution: {
            unavailableUntil: "2026-06-03T03:00:00.000Z",
            reason: "send lane blocked",
          },
        },
      },
      "2026-06-03T02:00:00.000Z",
      true,
    )?.id,
    "send-1",
  );
});

test("legacy global browser backoff does not suppress connector-native send work", () => {
  const queue = {
    tasks: [
      { kind: "send_message", id: "send-1" },
      { kind: "run_inbound_sync", id: "sync-1" },
    ],
  };

  assert.equal(
    chooseNextQueueTask(
      queue,
      true,
      {
        browserTransportUnavailableUntil: "2026-06-03T03:00:00.000Z",
        lastBrowserTransportError: "Detached Chrome browser sends are blocked while additional Chrome app instances are running with custom user-data-dir values (pid 9746).",
      },
      "2026-06-03T02:00:00.000Z",
    )?.id,
    "send-1",
  );
});

test("chooseNextQueueTask skips recently verified send tasks in verification mode", () => {
  const firstTask = {
    kind: "send_message",
    id: "send-1",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "First message",
    writeback: "exo actions result ...prospect-1",
  };
  const queue = {
    tasks: [
      firstTask,
      {
        kind: "send_message",
        id: "send-2",
        motionId: "motion-1",
        companyId: "company-1",
        prospectId: "prospect-2",
        surface: "follow_up_direct_message",
        recipientUrl: "https://www.linkedin.com/in/example-two/",
        queuedAt: "2026-06-03T05:01:00.000Z",
        body: "Second message",
        writeback: "exo actions result ...prospect-2",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(
      queue,
      true,
      {
        recentTaskVerifications: [
          {
            taskKind: "send_message",
            fingerprint: createTaskVerificationFingerprint(firstTask),
            verifiedAt: "2026-06-03T05:10:00.000Z",
            expiresAt: "2026-06-03T11:10:00.000Z",
          },
        ],
      },
      "2026-06-03T05:15:00.000Z",
      false,
      "verify",
    )?.id,
    "send-2",
  );
});

test("chooseNextQueueTask runs operator-authored sends live even in verify mode", () => {
  const operatorTask = {
    kind: "send_message",
    id: "send-operator",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "email",
    recipientUrl: "https://mail.google.com/mail/#all/thread-1",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "Operator wrote this.",
    authoredBy: "operator",
    editedByOperator: true,
    writeback: "exo actions result ...prospect-1",
  };
  const agentTask = {
    kind: "send_message",
    id: "send-agent",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-2",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-two/",
    queuedAt: "2026-06-03T05:01:00.000Z",
    body: "Agent wrote this.",
    authoredBy: "agent",
    editedByOperator: false,
    writeback: "exo actions result ...prospect-2",
  };

  const selected = chooseNextQueueTask(
    { tasks: [operatorTask, agentTask] },
    true,
    {
      recentTaskVerifications: [
        {
          taskKind: "send_message",
          fingerprint: createTaskVerificationFingerprint(operatorTask),
          verifiedAt: "2026-06-03T05:10:00.000Z",
          expiresAt: "2026-06-03T11:10:00.000Z",
        },
      ],
    },
    "2026-06-03T05:15:00.000Z",
    false,
    "verify",
  );

  assert.equal(selected?.id, "send-operator");
  assert.equal(selected?._selectedSendMode, "operator_live");
});

test("chooseNextQueueTask runs operator-approved sends live even in verify mode", () => {
  const approvedTask = {
    kind: "send_message",
    id: "send-approved",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-approved/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "Agent wrote this.",
    authoredBy: "agent",
    editedByOperator: false,
    approvedByOperator: true,
    writeback: "exo actions result ...prospect-1",
  };

  const selected = chooseNextQueueTask(
    { tasks: [approvedTask] },
    true,
    { recentTaskVerifications: [] },
    "2026-06-03T05:15:00.000Z",
    false,
    "verify",
  );

  assert.equal(selected?.id, "send-approved");
  assert.equal(selected?._selectedSendMode, "operator_live");
});

test("chooseNextQueueTask skips operator sends in verify mode when the live rollout gate is closed", () => {
  const operatorTask = {
    kind: "send_message",
    id: "send-operator",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "Operator wrote this.",
    authoredBy: "operator",
    editedByOperator: true,
    writeback: "exo actions result ...prospect-1",
  };
  const quickSyncTask = {
    kind: "run_inbound_sync",
    id: "sync-quick",
    mode: "quick",
    dueAt: "2026-06-03T05:01:00.000Z",
    queuedAt: "2026-06-03T05:01:00.000Z",
  };
  const healthWarnings = [
    { capability: "linkedin", handle: "aliumairdev", surfaceLabel: "Sent Invitations", freshnessState: "never" },
  ];

  // Operator sends escalate to live delivery; while inbound retrieval health
  // gates live sends, the pass must move on to the sync work that heals the
  // gate instead of selecting a send that execution will refuse.
  const selected = chooseNextQueueTask(
    { tasks: [operatorTask, quickSyncTask] },
    true,
    { recentTaskVerifications: [] },
    "2026-06-03T05:15:00.000Z",
    false,
    "verify",
    [],
    healthWarnings,
  );

  assert.equal(selected?.id, "sync-quick");

  // Once retrieval health recovers, the same queue escalates the operator
  // send again.
  const afterHeal = chooseNextQueueTask(
    { tasks: [operatorTask, quickSyncTask] },
    true,
    { recentTaskVerifications: [] },
    "2026-06-03T05:15:00.000Z",
    false,
    "verify",
    [],
    [],
  );

  assert.equal(afterHeal?.id, "send-operator");
  assert.equal(afterHeal?._selectedSendMode, "operator_live");
});

test("chooseNextQueueTask still proves agent sends in verify mode while operator sends are gated", () => {
  const operatorTask = {
    kind: "send_message",
    id: "send-operator",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "Operator wrote this.",
    authoredBy: "operator",
    editedByOperator: true,
    writeback: "exo actions result ...prospect-1",
  };
  const agentTask = {
    kind: "send_message",
    id: "send-agent",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-2",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-two/",
    queuedAt: "2026-06-03T05:01:00.000Z",
    body: "Agent wrote this.",
    authoredBy: "agent",
    editedByOperator: false,
    writeback: "exo actions result ...prospect-2",
  };
  const healthWarnings = [
    { capability: "linkedin", handle: "aliumairdev", surfaceLabel: "Sent Invitations", freshnessState: "never" },
  ];

  // Verify-mode proofs do not deliver anything, so retrieval health only
  // gates the operator escalation — not verification of agent sends.
  const selected = chooseNextQueueTask(
    { tasks: [operatorTask, agentTask] },
    true,
    { recentTaskVerifications: [] },
    "2026-06-03T05:15:00.000Z",
    false,
    "verify",
    [],
    healthWarnings,
  );

  assert.equal(selected?.id, "send-agent");
  assert.equal(selected?._selectedSendMode, "verify");
});

test("chooseNextQueueTask prefers send work over due retrieval even if retrieval is older", () => {
  const queue = {
    tasks: [
      {
        kind: "send_message",
        id: "send-1",
        dueAt: "2026-06-03T05:01:00.000Z",
        queuedAt: "2026-06-03T05:00:00.000Z",
      },
      {
        kind: "run_inbound_sync",
        id: "sync-1",
        dueAt: "2026-06-03T04:00:00.000Z",
        queuedAt: "2026-06-03T04:00:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:15:00.000Z", false, "verify")?.id,
    "send-1",
  );
});

test("chooseNextQueueTask skips work already checked out by another worker", () => {
  const sendTask = {
    kind: "send_message",
    id: "send-1",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    dueAt: "2026-06-03T05:01:00.000Z",
    queuedAt: "2026-06-03T05:00:00.000Z",
  };
  const syncTask = {
    kind: "run_inbound_sync",
    id: "sync-1",
    userId: "user-1",
    accountId: "account-1",
    surface: "linkedin-following-list",
    surfaceKeys: ["linkedin-following-list"],
    mode: "full",
    dueAt: "2026-06-03T04:00:00.000Z",
    queuedAt: "2026-06-03T04:00:00.000Z",
  };
  const hostState = checkoutTaskLease(null, {
    taskKind: sendTask.kind,
    fingerprint: createTaskLeaseFingerprint(sendTask),
    workerLabel: "worker-2",
    acquiredAt: "2026-06-03T05:10:00.000Z",
    expiresAt: "2026-06-03T06:10:00.000Z",
    motionId: sendTask.motionId,
    companyId: sendTask.companyId,
    prospectId: sendTask.prospectId,
    surface: sendTask.surface,
    subject: "Prospect One",
    action: "Send Direct Message",
  }).state;

  assert.equal(
    chooseNextQueueTask(
      { tasks: [sendTask, syncTask] },
      true,
      hostState,
      "2026-06-03T05:15:00.000Z",
      false,
      "verify",
    )?.id,
    "sync-1",
  );
});

test("chooseNextQueueTask can force a waiting retrieval task ahead of due sends", () => {
  const queue = {
    tasks: [
      {
        kind: "send_message",
        id: "send-1",
        dueAt: "2026-06-03T05:01:00.000Z",
        queuedAt: "2026-06-03T05:00:00.000Z",
      },
    ],
    waiting: [
      {
        kind: "run_inbound_sync",
        id: "sync-waiting-1",
        dueAt: "2026-06-03T10:00:00.000Z",
        queuedAt: "2026-06-03T04:00:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:15:00.000Z", false, "verify", [], [], true)?.id,
    "sync-waiting-1",
  );
});

test("chooseNextQueueTask prefers draft work over due retrieval when no send is queued", () => {
  const queue = {
    tasks: [
      {
        kind: "run_inbound_sync",
        id: "sync-1",
        dueAt: "2026-06-03T04:00:00.000Z",
        queuedAt: "2026-06-03T04:00:00.000Z",
      },
      {
        kind: "write_draft",
        id: "draft-1",
        dueAt: "2026-06-03T05:01:00.000Z",
        queuedAt: "2026-06-03T05:00:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:15:00.000Z", false, "live")?.id,
    "draft-1",
  );
});

test("chooseNextQueueTask runs research before full backfill sync and quick sync before research", () => {
  const queue = {
    tasks: [
      {
        kind: "run_inbound_sync",
        mode: "full",
        id: "sync-backfill-1",
        dueAt: "2026-06-03T04:00:00.000Z",
        queuedAt: "2026-06-03T04:00:00.000Z",
      },
      {
        kind: "company_research",
        id: "research-1",
        dueAt: "2026-06-03T05:00:00.000Z",
        queuedAt: "2026-06-03T05:00:00.000Z",
      },
      {
        kind: "run_inbound_sync",
        mode: "quick",
        id: "sync-quick-1",
        dueAt: "2026-06-03T04:30:00.000Z",
        queuedAt: "2026-06-03T04:30:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:15:00.000Z", false, "live")?.id,
    "sync-quick-1",
  );

  const withoutQuick = { tasks: queue.tasks.filter((task) => task.id !== "sync-quick-1") };
  assert.equal(
    chooseNextQueueTask(withoutQuick, true, {}, "2026-06-03T05:15:00.000Z", false, "live")?.id,
    "research-1",
  );

  const onlyBackfill = { tasks: queue.tasks.filter((task) => task.id === "sync-backfill-1") };
  assert.equal(
    chooseNextQueueTask(onlyBackfill, true, {}, "2026-06-03T05:15:00.000Z", false, "live")?.id,
    "sync-backfill-1",
  );
});

test("chooseNextQueueTask prefers a backfill slice once the interleave quota is met", () => {
  const queue = {
    tasks: [
      {
        kind: "company_research",
        id: "research-1",
        dueAt: "2026-06-03T05:00:00.000Z",
        queuedAt: "2026-06-03T05:00:00.000Z",
      },
      {
        kind: "run_inbound_sync",
        mode: "full",
        id: "sync-backfill-1",
        dueAt: "2026-06-03T04:00:00.000Z",
        queuedAt: "2026-06-03T04:00:00.000Z",
      },
    ],
  };

  // Quota met: three non-backfill standard tasks have run, no backfill yet.
  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:15:00.000Z", false, "live", [], [], false, {
      passLane: "standard",
      standardTaskCount: 3,
      maintenanceTaskCount: 0,
      backfillTaskCount: 0,
    })?.id,
    "sync-backfill-1",
  );

  // Quota not met again yet: one backfill slice already ran this pass.
  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:15:00.000Z", false, "live", [], [], false, {
      passLane: "standard",
      standardTaskCount: 4,
      maintenanceTaskCount: 0,
      backfillTaskCount: 1,
    })?.id,
    "research-1",
  );
});

test("shouldPreferBackfillSlice ratchets the quota as backfill slices complete", () => {
  assert.equal(shouldPreferBackfillSlice({ standardTaskCount: 0, backfillTaskCount: 0 }), false);
  assert.equal(shouldPreferBackfillSlice({ standardTaskCount: 2, backfillTaskCount: 0 }), false);
  assert.equal(shouldPreferBackfillSlice({ standardTaskCount: 3, backfillTaskCount: 0 }), true);
  assert.equal(shouldPreferBackfillSlice({ standardTaskCount: 4, backfillTaskCount: 1 }), false);
  assert.equal(shouldPreferBackfillSlice({ standardTaskCount: 7, backfillTaskCount: 1 }), true);
});

test("chooseNextQueueTask prefers send work over cleanup even if cleanup is older", () => {
  const queue = {
    tasks: [
      {
        kind: "send_message",
        id: "send-1",
        dueAt: "2026-06-03T05:01:00.000Z",
        queuedAt: "2026-06-03T05:00:00.000Z",
      },
      {
        kind: "withdraw_connection",
        id: "withdraw-1",
        dueAt: "2026-06-03T04:30:00.000Z",
        queuedAt: "2026-06-03T04:30:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:15:00.000Z", false, "live")?.id,
    "send-1",
  );
});

test("maintenance bursts stay separate from standard task passes", () => {
  assert.equal(isBrowserMaintenanceTaskKind("withdraw_connection"), true);
  assert.equal(isBrowserMaintenanceTaskKind("write_draft"), false);

  assert.equal(canRunTaskInCurrentPass("withdraw_connection", [], 0, 0), true);
  assert.equal(canRunTaskInCurrentPass("write_draft", [], 0, 0), true);

  assert.equal(
    canRunTaskInCurrentPass(
      "withdraw_connection",
      [{ kind: "write_draft", status: "completed" }],
      1,
      0,
    ),
    false,
  );

  assert.equal(
    canRunTaskInCurrentPass(
      "write_draft",
      [{ kind: "withdraw_connection", status: "completed" }],
      0,
      1,
    ),
    false,
  );

  assert.equal(
    canRunTaskInCurrentPass(
      "withdraw_connection",
      [{ kind: "withdraw_connection", status: "completed" }],
      0,
      24,
    ),
    true,
  );

  assert.equal(
    canRunTaskInCurrentPass(
      "withdraw_connection",
      [{ kind: "withdraw_connection", status: "completed" }],
      0,
      25,
    ),
    false,
  );
});

test("standard passes keep draining within the time budget even after the old 8-task mark", () => {
  assert.equal(
    canRunTaskInCurrentPass(
      "write_draft",
      Array.from({ length: 8 }, () => ({ kind: "write_draft", status: "completed" })),
      8,
      0,
      {
        elapsedMs: 4 * 60 * 1000,
        standardPassBudgetMs: 14 * 60 * 1000,
      },
    ),
    true,
  );
});

test("standard passes stop once their time budget is exhausted", () => {
  assert.equal(
    canRunTaskInCurrentPass(
      "write_draft",
      Array.from({ length: 8 }, () => ({ kind: "write_draft", status: "completed" })),
      8,
      0,
      {
        elapsedMs: 14 * 60 * 1000,
        standardPassBudgetMs: 14 * 60 * 1000,
      },
    ),
    false,
  );
});

test("buildInboundContractArgs preserves queued surface scoping for live sync tasks", () => {
  const args = buildInboundContractArgs({
    capability: "linkedin",
    userId: "user-1",
    accountId: "account-1",
    surfaceKeys: ["linkedin-sent-invitations", "linkedin-messaging-inbox", "linkedin-sent-invitations"],
    mode: "full",
  });

  assert.deepEqual(args, [
    "inbound",
    "sync",
    "linkedin-live",
    "user-1",
    "--account",
    "account-1",
    "--surface",
    "linkedin-sent-invitations",
    "--surface",
    "linkedin-messaging-inbox",
    "--mode",
    "full",
    "--json",
  ]);
});

test("buildInboundContractArgs omits linkedin-only flags for gmail live sync tasks", () => {
  const args = buildInboundContractArgs({
    capability: "gmail",
    userId: "user-1",
    accountId: "account-1",
    surfaceKeys: ["gmail-inbox-threads"],
    mode: "quick",
    resumeCursor: "cursor-1",
    resumeStartOffset: 25,
    maxPages: 3,
    pageSize: 50,
  });

  assert.deepEqual(args, [
    "inbound",
    "sync",
    "gmail-live",
    "user-1",
    "--account",
    "account-1",
    "--mode",
    "quick",
    "--json",
  ]);
});

test("resolveInboundExoCommandTimeoutMs gives full sync tasks the capture budget", () => {
  assert.equal(resolveInboundExoCommandTimeoutMs({ mode: "quick" }), 180000);
  assert.equal(resolveInboundExoCommandTimeoutMs({ mode: "full" }), 360000);
});

test("chooseNextQueueTask can keep draining standard work after maintenance tasks appear later in the queue", () => {
  const queue = {
    tasks: [
      {
        kind: "withdraw_connection",
        id: "withdraw-1",
        dueAt: "2026-06-03T04:30:00.000Z",
        queuedAt: "2026-06-03T04:30:00.000Z",
      },
      {
        kind: "write_draft",
        id: "draft-1",
        dueAt: "2026-06-03T04:31:00.000Z",
        queuedAt: "2026-06-03T04:31:00.000Z",
      },
    ],
  };

  const selected = chooseNextQueueTask(
    queue,
    true,
    {},
    "2026-06-03T05:15:00.000Z",
    false,
    "live",
    [],
    [],
    false,
    {
      passLane: "standard",
      standardTaskCount: 1,
      maintenanceTaskCount: 0,
    },
  );

  assert.equal(selected?.id, "draft-1");
});

test("chooseNextQueueTask prefers send work before claimed company research", () => {
  const queue = {
    tasks: [
      {
        kind: "send_message",
        id: "send-1",
        dueAt: "2026-06-03T05:01:00.000Z",
        queuedAt: "2026-06-03T05:00:00.000Z",
      },
      {
        kind: "company_research",
        id: "company-research-1",
        dueAt: "2026-06-03T04:30:00.000Z",
        queuedAt: "2026-06-03T04:30:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:15:00.000Z", false, "live")?.id,
    "send-1",
  );
});

test("chooseNextQueueTask prefers send work before prospect selection", () => {
  const queue = {
    tasks: [
      {
        kind: "send_message",
        id: "send-1",
        dueAt: "2026-06-03T05:01:00.000Z",
        queuedAt: "2026-06-03T05:00:00.000Z",
      },
      {
        kind: "prospect_selection",
        id: "prospect-selection-1",
        dueAt: "2026-06-03T04:30:00.000Z",
        queuedAt: "2026-06-03T04:30:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:15:00.000Z", false, "live")?.id,
    "send-1",
  );
});

test("chooseNextQueueTask can still run prospect research when browser preflight is down", () => {
  const queue = {
    tasks: [
      {
        kind: "prospect_research",
        id: "prospect-research-1",
        dueAt: "2026-06-03T04:30:00.000Z",
        queuedAt: "2026-06-03T04:30:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, false)?.id,
    "prospect-research-1",
  );
});

test("chooseNextQueueTask can still run company research when browser preflight is down", () => {
  const queue = {
    tasks: [
      {
        kind: "company_research",
        id: "company-research-1",
        dueAt: "2026-06-03T04:30:00.000Z",
        queuedAt: "2026-06-03T04:30:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, false)?.id,
    "company-research-1",
  );
});

test("chooseNextQueueTask can still run company discovery when browser preflight is down", () => {
  const queue = {
    tasks: [
      {
        kind: "company_discovery",
        id: "company-discovery-1",
        motionId: "motion-1",
        dueAt: "2026-06-03T04:20:00.000Z",
        queuedAt: "2026-06-03T04:20:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, false)?.id,
    "company-discovery-1",
  );
});

test("chooseNextQueueTask prefers the thinnest discovery motion when none has run recently", () => {
  const queue = {
    tasks: [
      {
        kind: "company_discovery",
        id: "company-discovery-1",
        motionId: "motion-1",
        deficitAfterBacklog: 1,
        dueAt: "2026-06-03T04:20:00.000Z",
        queuedAt: "2026-06-03T04:20:00.000Z",
      },
      {
        kind: "company_discovery",
        id: "company-discovery-2",
        motionId: "motion-2",
        deficitAfterBacklog: 4,
        dueAt: "2026-06-03T04:25:00.000Z",
        queuedAt: "2026-06-03T04:25:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, false)?.id,
    "company-discovery-2",
  );
});

test("chooseNextQueueTask round-robins discovery motions after one was just attempted", () => {
  const queue = {
    tasks: [
      {
        kind: "company_discovery",
        id: "company-discovery-1",
        motionId: "motion-1",
        deficitAfterBacklog: 1,
        dueAt: "2026-06-03T04:20:00.000Z",
        queuedAt: "2026-06-03T04:20:00.000Z",
      },
      {
        kind: "company_discovery",
        id: "company-discovery-2",
        motionId: "motion-2",
        deficitAfterBacklog: 4,
        dueAt: "2026-06-03T04:25:00.000Z",
        queuedAt: "2026-06-03T04:25:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(
      queue,
      false,
      {
        recentMotionTaskRuns: [
          {
            taskKind: "company_discovery",
            motionId: "motion-2",
            recordedAt: "2026-06-03T05:10:00.000Z",
            status: "completed",
          },
        ],
      },
      "2026-06-03T05:15:00.000Z",
    )?.id,
    "company-discovery-1",
  );
});

test("chooseNextQueueTask rotates across motion task kinds instead of letting one motion monopolize the pass", () => {
  const queue = {
    tasks: [
      {
        kind: "prospect_selection",
        id: "prospect-selection-1",
        motionId: "motion-1",
        dueAt: "2026-06-03T04:20:00.000Z",
        queuedAt: "2026-06-03T04:20:00.000Z",
      },
      {
        kind: "company_discovery",
        id: "company-discovery-2",
        motionId: "motion-2",
        deficitAfterBacklog: 1,
        dueAt: "2026-06-03T04:25:00.000Z",
        queuedAt: "2026-06-03T04:25:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(
      queue,
      false,
      {
        recentMotionTaskRuns: [
          {
            taskKind: "company_research",
            motionId: "motion-1",
            recordedAt: "2026-06-03T05:10:00.000Z",
            status: "completed",
          },
        ],
      },
      "2026-06-03T05:15:00.000Z",
    )?.id,
    "company-discovery-2",
  );
});

test("normalizeInboundCaptureFailureReason collapses raw Codex timeout noise into a governed retrieval failure", () => {
  const error = new Error("spawnSync /Applications/Codex.app/Contents/Resources/codex ETIMEDOUT");
  // @ts-expect-error test synthetic child-process fields
  error.stderr = "WARN codex_core_plugins::loader: failed to load plugin: invalid plugin key `posthog`";

  assert.equal(normalizeInboundCaptureFailureReason(error), "codex_capture_timeout");
});

test("normalizeInboundCaptureFailureReason classifies plugin-loader startup failures cleanly", () => {
  const error = new Error("spawnSync /Applications/Codex.app/Contents/Resources/codex exited 1");
  // @ts-expect-error test synthetic child-process fields
  error.stderr = "WARN codex_core_plugins::loader: failed to load plugin: invalid plugin key `posthog`";

  assert.equal(normalizeInboundCaptureFailureReason(error), "codex_capture_startup_failed");
});

test("autonomous Codex subprocess failures demote into blocked packet results", () => {
  const error = new Error("Codex task failed: spawnSync /Applications/Codex.app/Contents/Resources/codex ETIMEDOUT");

  assert.deepEqual(
    buildBlockedCodexTaskResult(error, { summary: null }),
    {
      status: "blocked",
      detail: {
        summary: null,
        reason: "Codex task failed: spawnSync /Applications/Codex.app/Contents/Resources/codex ETIMEDOUT",
      },
    },
  );
});

test("prospect research gets a longer autonomous timeout budget than company research", () => {
  assert.equal(resolveResearchTaskTimeoutMs("company_discovery"), 10 * 60 * 1000);
  assert.equal(resolveResearchTaskTimeoutMs("company_research"), 10 * 60 * 1000);
  assert.equal(resolveResearchTaskTimeoutMs("prospect_selection"), 10 * 60 * 1000);
  assert.equal(resolveResearchTaskTimeoutMs("prospect_research"), 15 * 60 * 1000);
});

test("terminal packet completion matcher accepts generic completed shorthand", () => {
  assert.equal(terminalPacketCompletionMatchesQueueState("completed", "ready"), true);
  assert.equal(terminalPacketCompletionMatchesQueueState("ready_for_first_touch_decision", "ready"), true);
  assert.equal(terminalPacketCompletionMatchesQueueState("Ready for first touch decision", "ready"), true);
  assert.equal(terminalPacketCompletionMatchesQueueState("ready-for-first-touch-decision", "ready"), true);
  assert.equal(terminalPacketCompletionMatchesQueueState("complete", "ready"), true);
  assert.equal(terminalPacketCompletionMatchesQueueState("completed", "researched"), true);
  assert.equal(terminalPacketCompletionMatchesQueueState("suppressed", "suppressed"), true);
  assert.equal(terminalPacketCompletionMatchesQueueState("suppressed", "ready"), false);
});

test("autonomous packet runs accept success variants as a completed terminal result", () => {
  assert.equal(isAutonomousPacketRunSuccessful("completed"), true);
  assert.equal(isAutonomousPacketRunSuccessful("success"), true);
  assert.equal(isAutonomousPacketRunSuccessful("Success"), true);
  assert.equal(isAutonomousPacketRunSuccessful("ok"), true);
  assert.equal(isAutonomousPacketRunSuccessful("OK"), true);
  assert.equal(isAutonomousPacketRunSuccessful("blocked"), false);
});

test("explainNoopPass makes verify-mode no-op passes explicit once all due sends are proved", () => {
  const provedTask = {
    kind: "send_message",
    id: "send-1",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "First message",
    writeback: "exo actions result ...prospect-1",
  };

  assert.equal(
    explainNoopPass(
      { tasks: [provedTask] },
      true,
      {
        recentTaskVerifications: [
          {
            taskKind: "send_message",
            fingerprint: createTaskVerificationFingerprint(provedTask),
            verifiedAt: "2026-06-03T05:10:00.000Z",
            expiresAt: "2026-06-03T11:10:00.000Z",
          },
        ],
      },
      "2026-06-03T05:15:00.000Z",
      false,
      "verify",
    ),
    "Verify mode had no unverified send_message tasks left to prove.",
  );
  assert.equal(summarizePassStatus([]), "noop");
});

test("summarizePassStatus marks completed results with remaining due work as partial", () => {
  assert.equal(
    summarizePassStatus(
      [{ kind: "run_inbound_sync", status: "completed" }],
      { tasks: [{ kind: "write_draft", id: "draft-1" }], waiting: [], blockers: [] },
    ),
    "partial",
  );
  assert.equal(
    summarizePassStatus(
      [{ kind: "run_inbound_sync", status: "completed" }],
      { tasks: [], waiting: [], blockers: [] },
    ),
    "completed",
  );
});

test("explainNoopPass makes forced-retrieval empty passes explicit", () => {
  assert.equal(
    explainNoopPass(
      { tasks: [], waiting: [] },
      true,
      {},
      "2026-06-03T05:15:00.000Z",
      false,
      "verify",
      [],
      [],
      true,
    ),
    "No due tasks or waiting autonomous retrieval tasks were available.",
  );
});

test("explainNoopPass does not claim verify-only hold for operator-authored sends", () => {
  const provedOperatorTask = {
    kind: "send_message",
    id: "send-1",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "email",
    recipientUrl: "https://mail.google.com/mail/#all/thread-1",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "Operator wrote this.",
    authoredBy: "operator",
    editedByOperator: true,
    writeback: "exo actions result ...prospect-1",
  };

  assert.notEqual(
    explainNoopPass(
      { tasks: [provedOperatorTask] },
      true,
      {
        recentTaskVerifications: [
          {
            taskKind: "send_message",
            fingerprint: createTaskVerificationFingerprint(provedOperatorTask),
            verifiedAt: "2026-06-03T05:10:00.000Z",
            expiresAt: "2026-06-03T11:10:00.000Z",
          },
        ],
      },
      "2026-06-03T05:15:00.000Z",
      false,
      "verify",
    ),
    "Verify mode had no unverified send_message tasks left to prove.",
  );
});

test("explainNoopPass surfaces the live rollout gate for deferred operator sends in verify mode", () => {
  const operatorTask = {
    kind: "send_message",
    id: "send-operator",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "Operator wrote this.",
    authoredBy: "operator",
    editedByOperator: true,
    writeback: "exo actions result ...prospect-1",
  };
  const healthWarnings = [
    { capability: "linkedin", handle: "aliumairdev", surfaceLabel: "Sent Invitations", freshnessState: "never" },
  ];

  const reason = explainNoopPass(
    { tasks: [operatorTask] },
    true,
    { recentTaskVerifications: [] },
    "2026-06-03T05:15:00.000Z",
    false,
    "verify",
    [],
    healthWarnings,
  );

  assert.match(reason, /Operator-approved sends stay queued while the live rollout gate is closed/);
  assert.match(reason, /autonomous inbound retrieval is healthy again/);
});

test("chooseNextQueueTask prefers previously verified sends in canary mode before proving new ones", () => {
  const verifiedTask = {
    kind: "send_message",
    id: "send-verified",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "First message",
    writeback: "exo actions result ...prospect-1",
  };
  const unverifiedTask = {
    kind: "send_message",
    id: "send-unverified",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-2",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-two/",
    queuedAt: "2026-06-03T05:01:00.000Z",
    body: "Second message",
    writeback: "exo actions result ...prospect-2",
  };

  const selected = chooseNextQueueTask(
    { tasks: [unverifiedTask, verifiedTask] },
    true,
    {
      recentTaskVerifications: [
        {
          taskKind: "send_message",
          fingerprint: createTaskVerificationFingerprint(verifiedTask),
          verifiedAt: "2026-06-03T05:10:00.000Z",
          expiresAt: "2026-06-03T11:10:00.000Z",
        },
      ],
    },
    "2026-06-03T05:15:00.000Z",
    false,
    "canary",
  );

  assert.equal(selected?.id, "send-verified");
  assert.equal(selected?._selectedSendMode, "canary_live");
});

test("chooseNextQueueTask falls back to verification when canary mode has no proved sends", () => {
  const selected = chooseNextQueueTask(
    {
      tasks: [
        {
          kind: "send_message",
          id: "send-unverified",
          motionId: "motion-1",
          companyId: "company-1",
          prospectId: "prospect-1",
          surface: "follow_up_direct_message",
          recipientUrl: "https://www.linkedin.com/in/example-one/",
          queuedAt: "2026-06-03T05:00:00.000Z",
          body: "First message",
          writeback: "exo actions result ...prospect-1",
        },
      ],
    },
    true,
    {},
    "2026-06-03T05:15:00.000Z",
    false,
    "canary",
  );

  assert.equal(selected?.id, "send-unverified");
  assert.equal(selected?._selectedSendMode, "canary_verify");
});

test("chooseNextQueueTask pauses live and canary sends when the send circuit breaker is active", () => {
  const queue = {
    tasks: [
      {
        kind: "send_message",
        id: "send-1",
        motionId: "motion-1",
        companyId: "company-1",
        prospectId: "prospect-1",
        surface: "follow_up_direct_message",
        recipientUrl: "https://www.linkedin.com/in/example-one/",
        queuedAt: "2026-06-03T05:00:00.000Z",
        body: "First message",
        writeback: "exo actions result ...prospect-1",
      },
    ],
  };

  const hostState = {
    sendCircuitBreaker: {
      consecutiveFailures: 2,
      unavailableUntil: "2026-06-03T11:00:00.000Z",
      reason: "send failed twice",
      lastFailureAt: "2026-06-03T05:30:00.000Z",
      lastTaskFingerprint: "abc123",
      lastTaskLabel: "Taras Mykhalyshyn at BillEase",
    },
  };

  assert.equal(
    chooseNextQueueTask(queue, true, hostState, "2026-06-03T05:45:00.000Z", false, "live")?.id,
    undefined,
  );
  assert.equal(
    chooseNextQueueTask(queue, true, hostState, "2026-06-03T05:45:00.000Z", false, "canary")?.id,
    undefined,
  );
  assert.equal(
    chooseNextQueueTask(queue, true, hostState, "2026-06-03T05:45:00.000Z", false, "verify")?.id,
    "send-1",
  );
});

test("chooseNextQueueTask blocks canary and live sends when manual-only inbound surfaces remain enabled", () => {
  const queue = {
    tasks: [
      {
        kind: "send_message",
        id: "send-1",
        motionId: "motion-1",
        companyId: "company-1",
        prospectId: "prospect-1",
        surface: "follow_up_direct_message",
        recipientUrl: "https://www.linkedin.com/in/example-one/",
        queuedAt: "2026-06-03T05:00:00.000Z",
        body: "First message",
        writeback: "exo actions result ...prospect-1",
      },
    ],
  };
  const automationWarnings = [
    {
      capability: "linkedin",
      handle: "omalab-main",
      surfaceLabel: "Comment Replies",
    },
  ];

  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:45:00.000Z", false, "live", automationWarnings)?.id,
    undefined,
  );
  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:45:00.000Z", false, "canary", automationWarnings)?.id,
    undefined,
  );
  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:45:00.000Z", false, "verify", automationWarnings)?.id,
    "send-1",
  );
});

test("chooseNextQueueTask blocks canary and live sends when autonomous retrieval truth is stale", () => {
  const queue = {
    tasks: [
      {
        kind: "send_message",
        id: "send-1",
        motionId: "motion-1",
        companyId: "company-1",
        prospectId: "prospect-1",
        surface: "follow_up_direct_message",
        recipientUrl: "https://www.linkedin.com/in/example-one/",
        queuedAt: "2026-06-03T05:00:00.000Z",
        body: "First message",
        writeback: "exo actions result ...prospect-1",
      },
    ],
  };
  const automationHealthWarnings = [
    {
      capability: "gmail",
      handle: "omalab-main",
      surfaceLabel: "Inbox Threads",
      freshnessState: "stale",
    },
  ];

  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:45:00.000Z", false, "live", [], automationHealthWarnings)?.id,
    undefined,
  );
  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:45:00.000Z", false, "canary", [], automationHealthWarnings)?.id,
    undefined,
  );
  assert.equal(
    chooseNextQueueTask(queue, true, {}, "2026-06-03T05:45:00.000Z", false, "verify", [], automationHealthWarnings)?.id,
    "send-1",
  );
});

test("classifyHandledLinkedinReplyUnavailable recognizes read-only reply-disabled inbox threads", () => {
  const handled = classifyHandledLinkedinReplyUnavailable(
    {
      kind: "send_message",
      surface: "inbound_reply",
    },
    {
      channel: "linkedin",
      action: "send_direct_message",
    },
    {
      status: "not_ready",
      reason: "Unipile shows the David Terry LinkedIn thread as chat_id `abc` with `content_type: \"sponsored\"`, `read_only: 1`, and `disabledFeatures: [\"reply\",\"reactions\"]`.",
    },
  );

  assert.deepEqual(handled, {
    summary: "Could not send the governed LinkedIn reply because the thread is read-only and reply is disabled.",
    reason: "Unipile shows the David Terry LinkedIn thread as chat_id `abc` with `content_type: \"sponsored\"`, `read_only: 1`, and `disabledFeatures: [\"reply\",\"reactions\"]`.",
  });
});

test("manual-only inbound rollout guard explains why live and canary no-op", () => {
  const sendTask = {
    kind: "send_message",
    id: "send-1",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "First message",
    writeback: "exo actions result ...prospect-1",
  };
  const automationWarnings = [
    {
      capability: "linkedin",
      handle: "omalab-main",
      surfaceLabel: "Comment Replies",
    },
  ];

  assert.equal(
    getInboundAutomationRolloutBlockReason(automationWarnings, "live"),
    "Live send rollout is paused until enabled manual-only inbound surfaces are disabled: linkedin:omalab-main / Comment Replies.",
  );
  assert.equal(
    getInboundAutomationRolloutBlockReason(automationWarnings, "verify"),
    null,
  );
  assert.equal(
    explainNoopPass(
      { tasks: [sendTask] },
      true,
      {},
      "2026-06-03T05:15:00.000Z",
      false,
      "canary",
      automationWarnings,
    ),
    "Live send rollout is paused until enabled manual-only inbound surfaces are disabled: linkedin:omalab-main / Comment Replies.",
  );
});

test("stale autonomous retrieval rollout guard explains why live and canary no-op", () => {
  const sendTask = {
    kind: "send_message",
    id: "send-1",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "First message",
    writeback: "exo actions result ...prospect-1",
  };
  const automationHealthWarnings = [
    {
      capability: "gmail",
      handle: "omalab-main",
      surfaceLabel: "Inbox Threads",
      freshnessState: "stale",
    },
  ];

  assert.equal(
    getInboundAutomationRolloutBlockReason([], "live", automationHealthWarnings),
    "Live send rollout is paused until autonomous inbound retrieval is healthy again: gmail:omalab-main / Inbox Threads (stale).",
  );
  assert.equal(
    getInboundAutomationRolloutBlockReason([], "verify", automationHealthWarnings),
    null,
  );
  assert.equal(
    explainNoopPass(
      { tasks: [sendTask] },
      true,
      {},
      "2026-06-03T05:15:00.000Z",
      false,
      "canary",
      [],
      automationHealthWarnings,
    ),
    "Live send rollout is paused until autonomous inbound retrieval is healthy again: gmail:omalab-main / Inbox Threads (stale).",
  );
});

test("chooseNextQueueTask respects canary cooldown but still allows proof-only work", () => {
  const verifiedTask = {
    kind: "send_message",
    id: "send-verified",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-one/",
    queuedAt: "2026-06-03T05:00:00.000Z",
    body: "First message",
    writeback: "exo actions result ...prospect-1",
  };
  const unverifiedTask = {
    kind: "send_message",
    id: "send-unverified",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-2",
    surface: "follow_up_direct_message",
    recipientUrl: "https://www.linkedin.com/in/example-two/",
    queuedAt: "2026-06-03T05:01:00.000Z",
    body: "Second message",
    writeback: "exo actions result ...prospect-2",
  };

  const selected = chooseNextQueueTask(
    { tasks: [verifiedTask, unverifiedTask] },
    true,
    {
      recentTaskVerifications: [
        {
          taskKind: "send_message",
          fingerprint: createTaskVerificationFingerprint(verifiedTask),
          verifiedAt: "2026-06-03T05:10:00.000Z",
          expiresAt: "2026-06-03T11:10:00.000Z",
        },
      ],
      canaryCooldown: {
        unavailableUntil: "2026-06-03T08:00:00.000Z",
        lastSentAt: "2026-06-03T02:00:00.000Z",
        lastTaskFingerprint: createTaskVerificationFingerprint(verifiedTask),
        lastTaskLabel: "Taras Mykhalyshyn at BillEase",
      },
    },
    "2026-06-03T05:15:00.000Z",
    false,
    "canary",
  );

  assert.equal(selected?.id, "send-unverified");
  assert.equal(selected?._selectedSendMode, "canary_verify");
});

test("task prompts are bounded and fail-fast", () => {
  const draftPrompt = buildDraftPrompt({ motion: { name: "test-motion" }, surface: { key: "connection_request" } });
  assert.match(draftPrompt, /detached background pass/i);
  assert.match(draftPrompt, /Return only JSON/i);
  assert.match(draftPrompt, /one field only: body/i);

  const emailDraftPrompt = buildDraftPrompt({
    motion: { name: "test-motion" },
    surface: { key: "email", replySubject: "Re: Fire department RFP" },
  });
  assert.match(emailDraftPrompt, /Return only JSON/i);
  assert.match(emailDraftPrompt, /fields: subject and body/i);
  assert.match(emailDraftPrompt, /Use surface\.replySubject exactly/i);

  const inboundPrompt = buildInboundCapturePrompt({ prompt: "Inspect Gmail and return JSON." });
  assert.match(inboundPrompt, /^@chrome\b/m);
  assert.match(inboundPrompt, /one bounded Exo inbound retrieval task/i);
  assert.match(inboundPrompt, /Do one Chrome connector attach attempt/i);
  assert.match(inboundPrompt, /Do not run diagnostics/i);

  const connectorInboundPrompt = buildInboundCapturePrompt(
    {
      prompt: "Inspect Gmail and return JSON.",
      captureTransportMode: "connector_native_only",
    },
    "gmail",
  );
  assert.doesNotMatch(connectorInboundPrompt, /^@chrome\b/m);
  assert.match(connectorInboundPrompt, /native gmail tools already available in this runtime/i);
  assert.match(connectorInboundPrompt, /Do not use Chrome browser tools/i);

  const companyResearchPrompt = buildCompanyResearchPrompt(
    {
      packet: { id: "company_research:company-1" },
      summary: "Research Acme against the motion premise.",
    },
    {
      companyId: "company-1",
      motionId: "motion-1",
      packetId: "company_research:company-1",
    },
  );
  assert.doesNotMatch(companyResearchPrompt, /^@chrome\b/m);
  assert.match(companyResearchPrompt, /one bounded Exo company research packet/i);
  assert.match(companyResearchPrompt, /native web retrieval capabilities/i);
  assert.match(companyResearchPrompt, /Start with the company site/i);
  assert.match(companyResearchPrompt, /Use shell commands only for the governed Exo writeback commands/i);
  assert.match(companyResearchPrompt, /Do not hunt people or direct contact data here/i);
  assert.match(companyResearchPrompt, /Do not use completed there/i);

  const companyDiscoveryPrompt = buildCompanyDiscoveryPrompt(
    {
      motion: { id: "motion-1", name: "test-motion" },
      summary: "Find 10 new companies for the motion backlog.",
      inputs: {
        inventory: {
          targetCompanyCount: 10,
          deficitAfterBacklog: 20,
        },
      },
    },
    {
      motionId: "motion-1",
      targetCompanyCount: 10,
    },
  );
  assert.doesNotMatch(companyDiscoveryPrompt, /^@chrome\b/m);
  assert.match(companyDiscoveryPrompt, /one bounded Exo company discovery task/i);
  assert.match(companyDiscoveryPrompt, /native web retrieval capabilities/i);
  assert.match(companyDiscoveryPrompt, /Add companies, not prospects/i);
  assert.match(companyDiscoveryPrompt, /fresh signal-qualified account discovery only/i);
  assert.match(companyDiscoveryPrompt, /count as a floor, not a ceiling/i);
  assert.match(companyDiscoveryPrompt, /instead of stopping exactly at the minimum/i);
  assert.match(companyDiscoveryPrompt, /run the governed Exo writeback commands needed to queue the discovered companies/i);
  assert.match(companyDiscoveryPrompt, /Do not use completed there/i);

  const prospectSelectionPrompt = buildProspectSelectionPrompt(
    {
      packet: { id: "prospect_selection:company-1" },
      company: { id: "company-1", name: "Acme" },
    },
    {
      companyId: "company-1",
      motionId: "motion-1",
      packetId: "prospect_selection:company-1",
    },
  );
  assert.doesNotMatch(prospectSelectionPrompt, /^@chrome\b/m);
  assert.match(prospectSelectionPrompt, /one bounded Exo prospect selection packet/i);
  assert.match(prospectSelectionPrompt, /for finding the right people, not full contact enrichment/i);
  assert.match(prospectSelectionPrompt, /Do not use completed there/i);

  const prospectResearchPrompt = buildProspectResearchPrompt(
    {
      packet: { id: "prospect_research:company-1:prospect-1" },
      company: { id: "company-1", name: "Acme" },
      prospect: { id: "prospect-1", name: "Jordan Example" },
    },
    {
      companyId: "company-1",
      motionId: "motion-1",
      prospectId: "prospect-1",
      packetId: "prospect_research:company-1:prospect-1",
    },
  );
  assert.doesNotMatch(prospectResearchPrompt, /^@chrome\b/m);
  assert.match(prospectResearchPrompt, /one bounded Exo prospect research packet/i);
  assert.match(prospectResearchPrompt, /for enriching the selected person and landing their governed profile\/contact surface/i);
  assert.match(prospectResearchPrompt, /Do not draft outreach, do not pick a touch sequence/i);
  assert.match(prospectResearchPrompt, /set completionStatus to ready, suppressed, or exhausted/i);
  assert.match(prospectResearchPrompt, /Do not use completed there/i);

  const connectorSendPrompt = buildSendPrompt({
    channel: "email",
    connector: "codex:gmail",
    executionPolicy: { mode: "native_connector_tools_only" },
    recipient: { email: "lpark@govpointeoffice.us", threadUrl: "https://mail.google.com/mail/#all/thread-1" },
  });
  assert.doesNotMatch(connectorSendPrompt, /^@chrome\b/m);
  assert.match(connectorSendPrompt, /one bounded Exo connector send task/i);
  assert.match(connectorSendPrompt, /native gmail tools already available in this runtime/i);
  assert.match(connectorSendPrompt, /Do not use Chrome browser tools/i);

  const tempCodexDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-unipile-send-prompt-"));
  const tempCodexHome = path.join(tempCodexDir, ".codex");
  const originalCodexHome = process.env.CODEX_HOME;
  fs.mkdirSync(tempCodexHome, { recursive: true });
  fs.writeFileSync(path.join(tempCodexHome, "config.toml"), [
    '[mcp_servers.unipile.env]',
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    "",
  ].join("\n"));

  try {
    process.env.CODEX_HOME = tempCodexHome;
    const sendDryRunPrompt = buildSendPrompt(
      {
        channel: "linkedin",
        connector: "codex:unipile",
        executionPolicy: { mode: "native_connector_tools_only" },
        recipient: { profileUrl: "https://www.linkedin.com/in/example" },
      },
      { dryRun: true },
    );
    assert.match(sendDryRunPrompt, /Prepare the governed send and stop before the final send action/i);
    assert.doesNotMatch(sendDryRunPrompt, /Do not click Send/i);
    assert.match(sendDryRunPrompt, /"status":"ready_to_send"/i);
    assert.match(sendDryRunPrompt, /https:\/\/api14\.unipile\.com:14465\/api\/v1\/accounts/i);
    assert.match(sendDryRunPrompt, /Do not substitute api1\.unipile\.com/i);
    assert.match(sendDryRunPrompt, /direct POST with no native draft\/composer state/i);
  } finally {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    fs.rmSync(tempCodexDir, { recursive: true, force: true });
  }
});

test("subject-using draft surfaces require a subject in the background-pass schema", () => {
  const emailSchema = buildDraftOutputSchema({ surface: { key: "email" } });
  assert.deepEqual(emailSchema.required, ["subject", "body"]);
  assert.equal(emailSchema.properties.subject.type, "string");

  const linkedinSchema = buildDraftOutputSchema({ surface: { key: "connection_request" } });
  assert.deepEqual(linkedinSchema.required, ["body"]);
  assert.equal("subject" in linkedinSchema.properties, false);
});

test("connector runtime config keeps managed MCP servers available in detached codex passes", () => {
  assert.deepEqual(resolveCodexConnectorRuntimeConfig("codex:gmail"), {
    pluginIds: ["gmail@openai-curated"],
    mcpServerIds: [],
  });
  assert.deepEqual(resolveCodexConnectorRuntimeConfig("codex:unipile"), {
    pluginIds: [],
    mcpServerIds: ["unipile"],
  });
  assert.equal(shouldIgnoreCodexUserConfig({ connectorRequired: true }), false);
  assert.equal(shouldIgnoreCodexUserConfig({ connectorRequired: false }), true);
});

test("browser codex args avoid synthetic MCP server tables when user config is ignored", () => {
  const browserArgs = buildCodexTaskArgs({
    prompt: "Do browser work",
    schema: null,
    outputName: "browser.json",
    browserRequired: true,
    useOutputSchema: false,
    timeoutMs: 1000,
  }, "/tmp/browser.json");
  const browserJoined = browserArgs.join(" ");
  assert.match(browserJoined, /--ignore-user-config/);
  assert.match(browserJoined, /plugins\."chrome@openai-bundled"\.enabled=true/);
  assert.doesNotMatch(browserJoined, /mcp_servers\.playwriter\.enabled=false/);
  assert.doesNotMatch(browserJoined, /mcp_servers\.icypeas\.enabled=false/);
  assert.doesNotMatch(browserJoined, /mcp_servers\.leadmagic\.enabled=false/);
  assert.doesNotMatch(browserJoined, /mcp_servers\.prospeo\.enabled=false/);

  const connectorArgs = buildCodexTaskArgs({
    prompt: "Do connector work",
    schema: null,
    outputName: "connector.json",
    browserRequired: false,
    connectorRequired: true,
    enabledPlugins: ["gmail@openai-curated"],
    enabledMcpServers: ["unipile"],
    useOutputSchema: false,
    timeoutMs: 1000,
  }, "/tmp/connector.json");
  const connectorJoined = connectorArgs.join(" ");
  assert.doesNotMatch(connectorJoined, /--ignore-user-config/);
  assert.match(connectorJoined, /plugins\."gmail@openai-curated"\.enabled=true/);
  assert.match(connectorJoined, /mcp_servers\.unipile\.enabled=true/);
});

test("Codex task exec options hard-kill timed-out background subprocesses", () => {
  const options = buildCodexTaskExecOptions({
    prompt: "Do connector work",
    schema: null,
    outputName: "connector.json",
    browserRequired: false,
    connectorRequired: true,
    enabledPlugins: [],
    enabledMcpServers: ["unipile"],
    useOutputSchema: false,
    timeoutMs: 12345,
  });

  assert.equal(options.timeout, 12345);
  assert.equal(options.killSignal, "SIGKILL");
  assert.equal(options.cwd, process.cwd());
});

test("buildCodexTaskEnv derives HOME from CODEX_HOME and forwards Unipile config", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-codex-task-env-"));
  const codexHome = path.join(tempDir, ".codex");

  try {
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(path.join(codexHome, "config.toml"), [
      '[mcp_servers.unipile.env]',
      'UNIPILE_API_KEY = "test-key"',
      'UNIPILE_DSN = "https://api14.unipile.com:14465"',
      'UNIPILE_V2_API_KEY = "test-v2-key"',
      'UNIPILE_V2_BASE_URL = "https://api.unipile.com/v2"',
      "",
    ].join("\n"));

    const env = buildCodexTaskEnv({
      PATH: "/usr/bin:/bin",
      CODEX_HOME: codexHome,
    });

    assert.equal(env.CODEX_HOME, codexHome);
    assert.equal(env.HOME, tempDir);
    assert.equal(env.USER, path.basename(tempDir));
    assert.equal(env.LOGNAME, path.basename(tempDir));
    assert.equal(env.UNIPILE_API_KEY, "test-key");
    assert.equal(env.UNIPILE_DSN, "https://api14.unipile.com:14465");
    assert.equal(env.UNIPILE_BASE_URL, "https://api14.unipile.com:14465");
    assert.equal(env.UNIPILE_V2_API_KEY, "test-v2-key");
    assert.equal(env.UNIPILE_V2_BASE_URL, "https://api.unipile.com/v2");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("summarizeVerificationOutput compacts inbox, daily, and next verification payloads", () => {
  const inboxSummary = summarizeVerificationOutput(
    "exo inbox --user user-1 --json",
    JSON.stringify({
      counts: {
        itemCount: 12,
        highPriorityCount: 3,
        mediumPriorityCount: 8,
        lowPriorityCount: 1,
      },
      surfaces: {
        uncheckedSurfaceCount: 0,
        actionableSurfaceCount: 4,
      },
      items: [{ id: "ignore-me" }],
    }),
  );
  assert.deepEqual(inboxSummary, {
    kind: "inbox",
    counts: {
      itemCount: 12,
      highPriorityCount: 3,
      mediumPriorityCount: 8,
      lowPriorityCount: 1,
    },
    uncheckedSurfaceCount: 0,
    actionableSurfaceCount: 4,
  });

  const dailySummary = summarizeVerificationOutput(
    "exo daily --user user-1 --json",
    JSON.stringify({
      counts: {
        itemCount: 44,
        dueNowCount: 9,
        waitingCount: 2,
        replyPriorityCount: 1,
        actionPriorityCount: 7,
        waitPriorityCount: 1,
      },
      items: [
        {
          priority: "reply",
          recommendedAction: "Reply to the live inbound thread.",
        },
      ],
    }),
  );
  assert.deepEqual(dailySummary, {
    kind: "daily",
    counts: {
      itemCount: 44,
      dueNowCount: 9,
      waitingCount: 2,
      replyPriorityCount: 1,
      actionPriorityCount: 7,
      waitPriorityCount: 1,
    },
    topPriority: "reply",
    topRecommendation: "Reply to the live inbound thread.",
  });

  const nextSummary = summarizeVerificationOutput(
    "exo next --user user-1 --json",
    JSON.stringify({
      source: "daily",
      nextMove: "Reply now.",
      operatorPrompt: "Reply now?",
      status: {
        priority: "reply",
        dueAt: "2026-06-03T09:00:00.000Z",
      },
    }),
  );
  assert.deepEqual(nextSummary, {
    kind: "next",
    source: "daily",
    nextMove: "Reply now.",
    operatorPrompt: "Reply now?",
    priority: "reply",
    dueAt: "2026-06-03T09:00:00.000Z",
  });
});

test("extractDraftBodyFromCodexResponse unwraps structured envelopes into plain outbound copy", () => {
  const envelope = {
    motionId: "motion-1",
    surfaceKey: "follow_up_direct_message",
    draft: {
      text: "Plain outbound copy.",
    },
  };

  assert.equal(
    extractDraftBodyFromCodexResponse({ body: JSON.stringify(envelope) }),
    "Plain outbound copy.",
  );
  assert.equal(
    extractDraftBodyFromCodexResponse({ body: "Plain outbound copy." }),
    "Plain outbound copy.",
  );
});

test("extractDraftOutputFromCodexResponse preserves subject for email drafts", () => {
  assert.deepEqual(
    extractDraftOutputFromCodexResponse(
      {
        subject: "Re: Fire department RFP",
        body: "Plain outbound copy.",
      },
      "email",
    ),
    {
      subject: "Re: Fire department RFP",
      body: "Plain outbound copy.",
    },
  );
});

test("verification-only send passes stop after the first proved task", () => {
  assert.equal(
    shouldStopAfterTaskResult(
      { kind: "send_message", id: "send-1" },
      { status: "completed", detail: { verificationOnly: true, sendStatus: "ready_to_send" } },
    ),
    true,
  );

  assert.equal(
    shouldStopAfterTaskResult(
      { kind: "send_message", id: "send-1" },
      { status: "completed", detail: { verificationOnly: false } },
    ),
    false,
  );

  assert.equal(
    shouldStopAfterTaskResult(
      { kind: "write_draft", id: "draft-1" },
      { status: "completed", detail: { verificationOnly: true } },
    ),
    false,
  );

  assert.equal(
    shouldStopAfterTaskResult(
      { kind: "send_message", id: "send-1", _selectedSendMode: "canary_live" },
      { status: "completed", detail: { verificationOnly: false } },
    ),
    true,
  );
});

test("failed retrieval tasks do not abort the host pass, but other failed work still does", () => {
  assert.equal(
    shouldAbortPassAfterTaskProblem(
      { kind: "run_inbound_sync", id: "sync-1" },
      { status: "failed", detail: { reason: "connector timeout" } },
    ),
    false,
  );

  assert.equal(
    shouldAbortPassAfterTaskProblem(
      { kind: "run_inbound_sync", id: "sync-1" },
      { status: "blocked", detail: { reason: "connector blocked" } },
    ),
    false,
  );

  assert.equal(
    shouldAbortPassAfterTaskProblem(
      { kind: "send_message", id: "send-1" },
      { status: "failed", detail: { reason: "send failed" } },
    ),
    true,
  );

  assert.equal(
    shouldAbortPassAfterTaskProblem(
      { kind: "write_draft", id: "draft-1" },
      { status: "completed", detail: {} },
    ),
    false,
  );
});

test("connector-native inbound handoffs do not require browser attach", () => {
  assert.equal(requiresBrowserAttachForInboundCapture({ captureTransportMode: "browser_native_only" }), true);
  assert.equal(requiresBrowserAttachForInboundCapture({ captureTransportMode: "connector_native_only" }), false);
  assert.equal(requiresBrowserAttachForInboundCapture(null), true);
});

test("preflight task gate can allow maintenance work even when Chrome debug-instance warnings exist", () => {
  const preflight = {
    browser: {
      blockedReasons: [],
      taskReadiness: {
        run_inbound_sync: {
          ready: true,
          blockedReasons: [],
        },
        send_message: {
          ready: true,
          blockedReasons: [],
        },
        withdraw_connection: {
          ready: true,
          blockedReasons: [],
        },
      },
    },
  };

  assert.deepEqual(getPreflightTaskGate(preflight, "run_inbound_sync"), {
    allowed: true,
    reason: null,
  });
  assert.deepEqual(getPreflightTaskGate(preflight, "send_message"), {
    allowed: true,
    reason: null,
  });
  assert.deepEqual(getPreflightTaskGate(preflight, "withdraw_connection"), {
    allowed: true,
    reason: null,
  });
});

test("sanitizeCodexOutputSchema removes format annotations recursively", () => {
  const schema = {
    type: "object",
    format: "uri",
    properties: {
      checkedAt: { type: "string", format: "date-time" },
      nested: {
        type: "object",
        properties: {
          url: { type: ["string", "null"], format: "uri" }
        }
      }
    }
  };

  const sanitized = sanitizeCodexOutputSchema(schema);
  assert.deepEqual(sanitized, {
    type: "object",
    properties: {
      checkedAt: { type: "string" },
      nested: {
        type: "object",
        properties: {
          url: { type: ["string", "null"] }
        }
      }
    }
  });
});

test("normalizeInboundCaptureForWriteback coerces timestamps and failed-capture defaults", () => {
  const normalized = normalizeInboundCaptureForWriteback({
    mode: "quick",
    status: "failed",
    checkedAt: "June 2 2026 9:00 PM EDT",
    itemCount: null,
    error: "",
    threads: [],
  }, "gmail");

  assert.match(normalized.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(normalized.itemCount, 0);
  assert.equal(normalized.error, "gmail capture failed");
});

test("normalizeInboundCaptureForWriteback synthesizes a failed linkedin surface payload from blocked output", () => {
  const normalized = normalizeInboundCaptureForWriteback({
    mode: "quick",
    status: "blocked",
    reason: "Browser is not available: extension",
  }, "linkedin");

  assert.equal(normalized.mode, "quick");
  assert.equal(normalized.status, "blocked");
  assert.equal(normalized.sentInvitations.status, "failed");
  assert.equal(normalized.followersList.status, "failed");
  assert.equal(normalized.messagingInbox.itemCount, 0);
  assert.equal(normalized.profileViews.error, "Browser is not available: extension");
  assert.equal(normalized.error, "Browser is not available: extension");
});

test("normalizeInboundCaptureForWriteback keeps top-level warning captures free of invented failure errors", () => {
  const normalized = normalizeInboundCaptureForWriteback({
    mode: "quick",
    status: "warning",
    followersList: {
      status: "warning",
      checkedAt: "2026-06-03T04:00:00.000Z",
      itemCount: 1,
      visibleTotalCount: 2,
      captureCompleteness: "partial_visible_slice",
      requestedMode: "quick",
      actualMode: "quick",
      reconcileRequired: true,
      reconcileReason: "Visible surface total exceeded the bounded itemized slice.",
      exhaustionStatus: "incomplete",
      exhaustionReason: "visible_total_exceeds_itemized_rows",
      paginationAttempted: false,
      terminalSignalSeen: false,
      stalledPassCount: 0,
      error: "Visible surface total exceeded the bounded itemized slice.",
      items: [],
    },
    sentInvitations: { status: "success", checkedAt: "2026-06-03T04:00:00.000Z", itemCount: 0, items: [] },
    receivedInvitations: { status: "success", checkedAt: "2026-06-03T04:00:00.000Z", itemCount: 0, items: [] },
    messagingInbox: { status: "success", checkedAt: "2026-06-03T04:00:00.000Z", itemCount: 0, items: [] },
    profileViews: { status: "success", checkedAt: "2026-06-03T04:00:00.000Z", itemCount: 0, items: [] },
    followingList: { status: "success", checkedAt: "2026-06-03T04:00:00.000Z", itemCount: 0, items: [] },
  }, "linkedin");

  assert.equal(normalized.status, "warning");
  assert.equal(normalized.error, null);
});

test("explainNoopPass surfaces an active runtime usage-limit hold", () => {
  const reason = explainNoopPass(
    { tasks: [{ kind: "write_draft", id: "draft-1", motionId: "motion-1" }] },
    true,
    {
      runtimeUsageLimit: {
        detectedAt: "2026-06-09T16:41:00.000Z",
        unavailableUntil: "2026-06-09T19:12:00.000Z",
        reason: "Codex task failed: You're out of Codex messages.",
        runtime: "codex",
      },
    },
    "2026-06-09T17:00:00.000Z",
    false,
    "verify",
  );
  assert.match(reason, /Codex hit its usage limit/);
  assert.match(reason, /2026-06-09T19:12:00\.000Z/);
});

test("explainNoopPass ignores an expired runtime usage-limit hold", () => {
  const reason = explainNoopPass(
    { tasks: [] },
    true,
    {
      runtimeUsageLimit: {
        detectedAt: "2026-06-09T16:41:00.000Z",
        unavailableUntil: "2026-06-09T19:12:00.000Z",
        reason: "Codex task failed: You're out of Codex messages.",
        runtime: "codex",
      },
    },
    "2026-06-09T20:00:00.000Z",
    false,
    "verify",
  );
  assert.doesNotMatch(reason, /usage limit/i);
});

test("chooseNextQueueTask skips tasks that already failed in the current pass", () => {
  const failingTask = {
    kind: "run_inbound_sync",
    id: "sync-followers",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    surfaceKeys: ["linkedin-followers-list"],
    mode: "quick",
  };
  const nextTask = {
    kind: "run_inbound_sync",
    id: "sync-inbox",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    surfaceKeys: ["linkedin-messaging-inbox"],
    mode: "quick",
  };
  const queue = { tasks: [failingTask, nextTask], waiting: [], blockers: [] };

  const beforeFailure = chooseNextQueueTask(queue, true);
  assert.equal(beforeFailure?.id, "sync-followers");

  const afterFailure = chooseNextQueueTask(
    queue,
    true,
    {},
    new Date().toISOString(),
    false,
    "verify",
    [],
    [],
    false,
    { failedTaskFingerprints: new Set([createTaskLeaseFingerprint(failingTask)]) },
  );
  assert.equal(afterFailure?.id, "sync-inbox");

  const allFailed = chooseNextQueueTask(
    queue,
    true,
    {},
    new Date().toISOString(),
    false,
    "verify",
    [],
    [],
    false,
    {
      failedTaskFingerprints: new Set([
        createTaskLeaseFingerprint(failingTask),
        createTaskLeaseFingerprint(nextTask),
      ]),
    },
  );
  assert.equal(allFailed, null);
});
