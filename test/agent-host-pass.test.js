// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBrowserAttachProbePrompt,
  buildBrowserActionPrompt,
  buildCompanyResearchPrompt,
  createTaskVerificationFingerprint,
  buildDraftPrompt,
  buildInboundCapturePrompt,
  buildSendPrompt,
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
  shouldRetryChromeAttachWithProfileWindow,
  getInboundAutomationRolloutBlockReason,
  classifyHandledLinkedinReplyUnavailable,
  normalizeInboundCaptureFailureReason,
  resolveCodexConnectorRuntimeConfig,
  shouldIgnoreCodexUserConfig,
} from "../scripts/run-agent-host-pass.js";

test("chooseNextQueueTask prefers draft work when browser is not ready", () => {
  const queue = {
    tasks: [
      { kind: "run_inbound_sync", id: "sync-1" },
      { kind: "send_message", id: "send-1" },
      { kind: "write_draft", id: "draft-1" },
    ],
  };

  assert.equal(chooseNextQueueTask(queue, false)?.id, "draft-1");
  assert.equal(chooseNextQueueTask(queue, true)?.id, "sync-1");
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
    "sync-1",
  );
});

test("chooseNextQueueTask skips only the blocked browser lane", () => {
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
    "sync-1",
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
    "sync-1",
  );
});

test("legacy global browser backoff migrates to the execution lane when the error is send-specific", () => {
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
    "sync-1",
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

test("chooseNextQueueTask prefers due retrieval over send work even if send tasks are listed first", () => {
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

test("chooseNextQueueTask prefers cleanup over send work even if send tasks are listed first", () => {
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
    "withdraw-1",
  );
});

test("chooseNextQueueTask prefers claimed company research before send work", () => {
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
    "company-research-1",
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
      {
        kind: "send_message",
        id: "send-1",
        dueAt: "2026-06-03T05:01:00.000Z",
        queuedAt: "2026-06-03T05:00:00.000Z",
      },
    ],
  };

  assert.equal(
    chooseNextQueueTask(queue, false)?.id,
    "company-research-1",
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

  const sendPrompt = buildSendPrompt({ recipient: { profileUrl: "https://www.linkedin.com/in/example" } });
  assert.match(sendPrompt, /^@chrome\b/m);
  assert.match(sendPrompt, /one bounded Exo browser send task/i);
  assert.match(sendPrompt, /Do not run Exo writeback yourself/i);

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

  const sendDryRunPrompt = buildSendPrompt(
    { recipient: { profileUrl: "https://www.linkedin.com/in/example" } },
    { dryRun: true },
  );
  assert.match(sendDryRunPrompt, /Prepare the governed send and stop before the final click/i);
  assert.match(sendDryRunPrompt, /Do not click Send/i);
  assert.match(sendDryRunPrompt, /"status":"ready_to_send"/i);

  const actionPrompt = buildBrowserActionPrompt({ kind: "withdraw_connection", prospectName: "Jordan Example" });
  assert.match(actionPrompt, /^@chrome\b/m);
  assert.match(actionPrompt, /withdraw the stale outbound linkedin invitation/i);
  assert.match(actionPrompt, /Do not run Exo writeback yourself/i);
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

test("chrome attach probe prompt and recovery matcher stay specific", () => {
  const prompt = buildBrowserAttachProbePrompt();
  assert.match(prompt, /^@chrome\b/m);
  assert.match(prompt, /lightweight browser-client call such as listing open tabs/i);
  assert.match(prompt, /Do not use shell commands, npm packages, or repo inspection/i);
  assert.match(prompt, /Do not import or require playwright/i);
  assert.equal(
    shouldRetryChromeAttachWithProfileWindow('Browser is not available: extension'),
    true,
  );
  assert.equal(
    shouldRetryChromeAttachWithProfileWindow('Could not resolve Chrome plugin root'),
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
