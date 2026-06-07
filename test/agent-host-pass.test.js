// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
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
} from "../scripts/run-agent-host-pass.js";
import {
  checkoutTaskLease,
  createTaskLeaseFingerprint,
} from "../src/lib/agent-host-state.js";

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
