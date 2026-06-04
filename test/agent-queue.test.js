// @ts-check
//
// buildAgentQueue: emits write_draft for prospects whose next message hasn't
// been written, gates stale send-ready drafts as blockers, and otherwise
// preserves the prior send_message behavior.

import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentQueue } from "../src/core/build-agent-queue.js";
import {
  classifyDraftStaleness,
  isDraftActive,
  selectNextDraftSurface,
} from "../src/core/select-next-draft-surface.js";

/**
 * Build a minimal motion → account → prospect tree the queue can read. Caller
 * passes draft + touch state to set up each scenario.
 *
 * @param {{
 *   drafts?: any[],
 *   touches?: any[],
 *   linkedinProfileUrl?: string | null,
 *   email?: string | null,
 *   sourceUrl?: string | null,
 *   linkedinProfileSnapshot?: any,
 *   observations?: any[],
 *   profiles?: any[],
 *   users?: any[],
 *   cues?: any[],
 *   cadenceState?: any,
 *   accountQueueState?: any,
 *   accountPacketState?: any,
 * }} prospectFields
 */
function fixture(prospectFields) {
  return {
    motions: [
      {
        id: "motion-1",
        name: "Motion One",
        targetMap: {
          accounts: [
            {
              companyId: "company-1",
              companyName: "Acme",
              queueState: prospectFields.accountQueueState ?? undefined,
              packetState: prospectFields.accountPacketState ?? undefined,
              prospects: [
                {
                  id: "prospect-1",
                  name: "Princess",
                  linkedinProfileUrl: "https://linkedin.com/in/princess",
                  email: prospectFields.email ?? undefined,
                  sourceUrl: prospectFields.sourceUrl ?? undefined,
                  linkedinProfileSnapshot: prospectFields.linkedinProfileSnapshot ?? { connectionDegree: null, isOpenProfile: null },
                  drafts: prospectFields.drafts ?? [],
                  touches: prospectFields.touches ?? [],
                  cadenceState: {
                    status: "ready",
                    currentStep: "connection-request",
                    updatedAt: "2026-06-01T00:00:00.000Z",
                    ...(prospectFields.cadenceState ?? {}),
                  },
                  ...(prospectFields.linkedinProfileUrl === null ? { linkedinProfileUrl: null } : {}),
                },
              ],
            },
          ],
        },
      },
    ],
    companies: [{ id: "company-1", engagementUserAssignment: { accountRefs: [] } }],
    profiles: prospectFields.profiles,
    users: prospectFields.users ?? [],
    observations: prospectFields.observations ?? [],
    cues: prospectFields.cues ?? [],
  };
}

function inboundUserFixture({ capability = "linkedin", surfaceKey, surfaceStateOverrides = {} } = {}) {
  return {
    id: "user-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "Operator",
    owner: "operator",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00",
    },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability,
        handle: capability === "gmail" ? "operator@example.com" : "operator-linkedin",
        label: null,
        sourceType: capability === "gmail" ? "harness-connection" : "browser-profile",
        browserProfileId: capability === "gmail" ? null : "profile-1",
        harnessConnectionId: capability === "gmail" ? "harness-1" : null,
        preferred: true,
        notes: null,
        inboundSync: {
          surfaces: [
            {
              surfaceKey,
              enabled: true,
              lastSyncedAt: "2026-05-01T00:00:00.000Z",
              lastObservedAt: "2026-05-01T00:00:00.000Z",
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
              ...surfaceStateOverrides,
            },
          ],
        },
      },
    ],
    harnessConnections: capability === "gmail"
      ? [
          {
            id: "harness-1",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            runtime: "codex",
            connector: "gmail",
            label: null,
            status: "available",
            notes: null,
          },
        ]
      : [],
  };
}

test("selectNextDraftSurface picks connection_request when no prior touches exist", () => {
  const surface = selectNextDraftSurface({
    linkedinProfileUrl: "https://linkedin.com/in/princess",
    touches: [],
  });
  assert.equal(surface, "connection_request");
});

test("selectNextDraftSurface picks inbound_reply when an inbound touch is unanswered", () => {
  const surface = selectNextDraftSurface({
    linkedinProfileUrl: "https://linkedin.com/in/princess",
    touches: [
      { surface: "connection_request", direction: "outbound", outcome: "accepted", occurredAt: "2026-05-01T00:00:00Z" },
      { surface: "post_accept_message", direction: "outbound", outcome: "sent", occurredAt: "2026-05-02T00:00:00Z" },
      { surface: "inbound_reply", direction: "inbound", outcome: "received", occurredAt: "2026-05-03T00:00:00Z" },
    ],
  });
  assert.equal(surface, "inbound_reply");
});

test("selectNextDraftSurface honors a governed direct-message cadence before the touch heuristic", () => {
  const surface = selectNextDraftSurface({
    linkedinProfileUrl: "https://linkedin.com/in/princess",
    linkedinProfileSnapshot: {
      connectionDegree: 3,
      isOpenProfile: true,
    },
    touches: [],
    cadenceState: {
      status: "ready",
      currentStep: "direct-message",
    },
  });
  assert.equal(surface, "follow_up_direct_message");
});

test("selectNextDraftSurface treats connectionDegree=1 as enough to draft the first post-accept message", () => {
  const surface = selectNextDraftSurface({
    linkedinProfileUrl: "https://linkedin.com/in/princess",
    linkedinProfileSnapshot: {
      connectionDegree: 1,
    },
    touches: [],
    cadenceState: {
      status: "ready",
      currentStep: "direct-message",
    },
  });
  assert.equal(surface, "post_accept_message");
});

test("selectNextDraftSurface reuses the direct-message surface for a first private message on an open profile", () => {
  const surface = selectNextDraftSurface({
    linkedinProfileUrl: "https://linkedin.com/in/princess",
    linkedinProfileSnapshot: {
      connectionDegree: 3,
      isOpenProfile: true,
    },
    touches: [],
    cadenceState: {
      status: "ready",
      currentStep: "direct-message",
    },
  });
  assert.equal(surface, "follow_up_direct_message");
});

test("classifyDraftStaleness flags a ready follow_up draft as stale once an inbound touch arrives", () => {
  const draft = { surface: "follow_up_direct_message", status: "ready" };
  const nextSurface = "inbound_reply";
  const result = classifyDraftStaleness(draft, nextSurface);
  assert.equal(result.stale, true);
  assert.match(result.reason ?? "", /^surface_moved_to_inbound_reply$/);
});

test("isDraftActive treats drafting/ready/queued/approved as active, sent/discarded as not", () => {
  assert.equal(isDraftActive({ status: "drafting" }), true);
  assert.equal(isDraftActive({ status: "ready" }), true);
  assert.equal(isDraftActive({ status: "queued" }), true);
  assert.equal(isDraftActive({ status: "approved" }), true);
  assert.equal(isDraftActive({ status: "sent" }), false);
  assert.equal(isDraftActive({ status: "discarded" }), false);
});

test("buildAgentQueue emits a full inbound sync task when an itemization gap exists", () => {
  const queue = buildAgentQueue({
    motions: [],
    companies: [],
    users: [
      inboundUserFixture({
        capability: "linkedin",
        surfaceKey: "linkedin-sent-invitations",
        surfaceStateOverrides: {
          lastRunStatus: "success",
          lastItemCount: 2,
          lastVisibleTotalCount: 5,
          lastObservationCount: 2,
          lastItemizationGapCount: 3,
          lastRequestedMode: "quick",
          lastActualMode: "quick",
        },
      }),
    ],
    observations: [],
    cues: [],
  });

  const task = queue.tasks.find((item) => item.kind === "run_inbound_sync");
  assert.ok(task);
  assert.equal(task.mode, "full");
  assert.equal(task.reason, "itemization_gap");
  assert.ok(task.surfaceKeys.includes("linkedin-sent-invitations"));
  assert.match(task.contractCommand, /exo inbound sync linkedin-live user-1 --account account-1 --mode full --json/);
  assert.match(task.applyCommand, /exo inbound sync run user-1 --input <combined-inbound-sync\.json> --refresh --json/);
});

test("buildAgentQueue emits a due company_research task for a claimed account packet", () => {
  const queue = buildAgentQueue(
    fixture({
      accountQueueState: {
        status: "queued_for_research",
        source: "manual",
        updatedAt: "2026-06-03T05:00:00.000Z",
      },
      accountPacketState: {
        kind: "company_research",
        status: "claimed",
        workerLabel: "codex-ui",
        claimedAt: "2026-06-03T05:01:00.000Z",
        completedAt: null,
        notes: "Queued from the UI.",
      },
    }),
  );

  const task = queue.tasks.find((item) => item.kind === "company_research");
  assert.ok(task);
  assert.equal(task.companyId, "company-1");
  assert.equal(task.packetId, "company_research:company-1");
  assert.equal(task.claimState, "claimed");
  assert.equal(task.workerLabel, "codex-ui");
  assert.equal(task.dueAt, "2026-06-03T05:01:00.000Z");
  assert.match(task.briefCommand, /exo motion packet-brief motion-1 --packet company_research:company-1 --json/);
});

test("buildAgentQueue emits a due company_research task for a claimable backlog account packet", () => {
  const queue = buildAgentQueue(
    fixture({
      accountQueueState: {
        status: "discovered",
        source: "manual",
        updatedAt: "2026-06-03T05:00:00.000Z",
      },
      accountPacketState: null,
    }),
  );

  const task = queue.tasks.find((item) => item.kind === "company_research");
  assert.ok(task);
  assert.equal(task.companyId, "company-1");
  assert.equal(task.packetId, "company_research:company-1");
  assert.equal(task.claimState, "claimable");
  assert.equal(task.workerLabel, null);
  assert.equal(task.reason, "claimable_company_packet");
  assert.match(task.claimCommand, /exo companies queue claim company-1 --motion motion-1 --worker <worker-label> --json/);
  assert.match(task.briefCommand, /exo motion packet-brief motion-1 --packet company_research:company-1 --json/);
});

test("buildAgentQueue can surface a waiting autonomous retrieval task when forced", () => {
  const queue = buildAgentQueue({
    motions: [],
    companies: [],
    users: [
      inboundUserFixture({
        capability: "gmail",
        surfaceKey: "gmail-inbox-threads",
        surfaceStateOverrides: {
          lastRunStatus: "success",
          lastObservedAt: "2026-06-03T08:00:00.000Z",
          lastSyncedAt: "2026-06-03T08:00:00.000Z",
        },
      }),
    ],
    observations: [],
    cues: [],
    now: "2026-06-03T09:00:00.000Z",
    includeWaitingRetrieval: true,
  });

  const task = queue.waiting.find((item) => item.kind === "run_inbound_sync");
  assert.ok(task);
  assert.equal(task.reason, "manual_force_retrieval");
  assert.equal(task.mode, "quick");
  assert.equal(task.queueState, "waiting");
  assert.equal(task.surfaceKeys[0], "gmail-inbox-threads");
  assert.match(task.whyItMatters ?? "", /forcing an early Gmail truth refresh/i);
});

test("buildAgentQueue emits a quick inbound sync task when open cues point at stale inbound truth", () => {
  const queue = buildAgentQueue({
    motions: [],
    companies: [],
    users: [
      inboundUserFixture({
        capability: "gmail",
        surfaceKey: "gmail-inbox-threads",
        surfaceStateOverrides: {
          lastRunStatus: "warning",
          lastObservedAt: "2026-05-01T00:00:00.000Z",
        },
      }),
    ],
    observations: [],
    cues: [
      {
        id: "cue-1",
        dedupeKey: "account-1:gmail-inbox-threads:unread_message_badge",
        userId: "user-1",
        accountId: "account-1",
        capability: "gmail",
        platform: "gmail",
        surfaceKey: "gmail-inbox-threads",
        kind: "unread_message_badge",
        source: "action_glance",
        status: "open",
        observedAt: "2026-06-01T00:00:00.000Z",
        recordedAt: "2026-06-01T00:00:01.000Z",
        resolvedAt: null,
        summary: "Unread Gmail activity detected.",
        motionId: null,
        companyId: null,
        prospectId: null,
        notes: null,
      },
    ],
  });

  const task = queue.tasks.find((item) => item.kind === "run_inbound_sync");
  assert.ok(task);
  assert.equal(task.mode, "quick");
  assert.equal(task.reason, "sync_hint");
  assert.deepEqual(task.surfaceKeys, ["gmail-inbox-threads"]);
  assert.match(task.contractCommand, /exo inbound sync gmail-live user-1 --account account-1 --mode quick --json/);
});

test("buildAgentQueue does not immediately requeue a bounded linkedin quick-pass warning", () => {
  const queue = buildAgentQueue({
    motions: [],
    companies: [],
    users: [
      {
        id: "user-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        label: "Operator",
        owner: "operator",
        notes: null,
        workingHours: {
          mode: "always",
          timezone: "America/New_York",
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          startLocalTime: "09:00",
          endLocalTime: "17:00",
        },
        accounts: [
          {
            id: "account-1",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            capability: "linkedin",
            handle: "operator-linkedin",
            label: null,
            sourceType: "browser-profile",
            browserProfileId: "profile-1",
            harnessConnectionId: null,
            preferred: true,
            notes: null,
            inboundSync: {
              surfaces: [
                {
                  surfaceKey: "linkedin-sent-invitations",
                  enabled: true,
                  lastSyncedAt: "2026-06-03T08:30:00.000Z",
                  lastObservedAt: "2026-06-03T08:30:00.000Z",
                  lastRunStatus: "warning",
                  lastItemCount: 20,
                  lastVisibleTotalCount: 20,
                  lastCaptureCompleteness: "partial_visible_slice",
                  lastRequestedMode: "quick",
                  lastActualMode: "quick",
                  lastReconcileRequired: true,
                  lastReconcileReason: "bounded_capture_stopped_early",
                  lastExhaustionStatus: "incomplete",
                  lastExhaustionReason: "bounded_capture_stopped_early",
                  lastPaginationAttempted: true,
                  lastTerminalSignalSeen: false,
                  lastStalledPassCount: 0,
                  lastObservationCount: 20,
                  lastItemizationGapCount: 0,
                  lastCountDiscrepancyCount: 0,
                  lastError: "Unipile returned more pending sent invitations than this quick pass itemized.",
                },
                { surfaceKey: "linkedin-received-invitations", enabled: false, lastRunStatus: "never" },
                { surfaceKey: "linkedin-messaging-inbox", enabled: false, lastRunStatus: "never" },
                { surfaceKey: "linkedin-profile-views", enabled: false, lastRunStatus: "never" },
                { surfaceKey: "linkedin-followers-list", enabled: false, lastRunStatus: "never" },
                { surfaceKey: "linkedin-following-list", enabled: false, lastRunStatus: "never" },
                { surfaceKey: "linkedin-comment-replies", enabled: false, lastRunStatus: "never" },
                { surfaceKey: "linkedin-catch-up-updates", enabled: false, lastRunStatus: "never" },
              ],
            },
          },
        ],
        harnessConnections: [],
      },
    ],
    observations: [],
    cues: [],
    now: "2026-06-03T09:00:00.000Z",
  });

  assert.equal(queue.tasks.some((item) => item.kind === "run_inbound_sync"), false);
});

test("buildAgentQueue skips unsupported Gmail live-sync accounts and keeps the runnable Gmail connector task", () => {
  const queue = buildAgentQueue({
    motions: [],
    companies: [],
    users: [
      {
        id: "user-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        label: "Operator",
        owner: "operator",
        notes: null,
        workingHours: {
          mode: "always",
          timezone: "America/New_York",
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          startLocalTime: "09:00",
          endLocalTime: "17:00",
        },
        accounts: [
          {
            id: "gmail-unipile",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            capability: "gmail",
            handle: "wrong@example.com",
            label: "Wrong Gmail",
            sourceType: "harness-connection",
            browserProfileId: null,
            harnessConnectionId: "harness-unipile",
            preferred: false,
            notes: null,
            inboundSync: {
              surfaces: [
                {
                  surfaceKey: "gmail-inbox-threads",
                  enabled: true,
                  lastSyncedAt: "2026-05-01T00:00:00.000Z",
                  lastObservedAt: "2026-05-01T00:00:00.000Z",
                  lastRunStatus: "success",
                },
              ],
            },
          },
          {
            id: "gmail-real",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            capability: "gmail",
            handle: "right@example.com",
            label: "Right Gmail",
            sourceType: "harness-connection",
            browserProfileId: null,
            harnessConnectionId: "harness-gmail",
            preferred: true,
            notes: null,
            inboundSync: {
              surfaces: [
                {
                  surfaceKey: "gmail-inbox-threads",
                  enabled: true,
                  lastSyncedAt: "2026-05-01T00:00:00.000Z",
                  lastObservedAt: "2026-05-01T00:00:00.000Z",
                  lastRunStatus: "success",
                },
              ],
            },
          },
        ],
        harnessConnections: [
          {
            id: "harness-unipile",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            runtime: "codex",
            connector: "unipile",
            label: null,
            status: "available",
            notes: null,
          },
          {
            id: "harness-gmail",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            runtime: "codex",
            connector: "gmail",
            label: null,
            status: "available",
            notes: null,
          },
        ],
      },
    ],
    observations: [],
    cues: [],
    now: "2026-06-04T10:00:00.000Z",
  });

  const gmailTasks = queue.tasks.filter((item) => item.kind === "run_inbound_sync" && item.capability === "gmail");
  assert.equal(gmailTasks.length, 1);
  assert.equal(gmailTasks[0].accountId, "gmail-real");
  assert.match(gmailTasks[0].contractCommand, /--account gmail-real --mode quick --json/);
});

test("buildAgentQueue emits a write_draft task for a prospect with no draft yet", () => {
  const queue = buildAgentQueue(fixture({ touches: [], drafts: [] }));
  const writes = queue.tasks.filter((t) => t.kind === "write_draft");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].surface, "connection_request");
  assert.equal(writes[0].reason, "no_draft");
  assert.match(writes[0].briefCommand, /exo motion draft-brief motion-1 --prospect prospect-1 --surface connection_request --json/);
  assert.match(writes[0].writeback, /exo companies prospects draft set company-1/);
  assert.match(writes[0].writeback, /--status queued/);
  assert.equal(writes[0].postWriteStatus, "queued");
  assert.equal(writes[0].queueState, "due_now");
});

test("buildAgentQueue does not emit a connection-request draft when the cadence branch is not explicitly ready", () => {
  const queue = buildAgentQueue(
    fixture({
      touches: [],
      drafts: [],
      cadenceState: {
        status: "pending",
        currentStep: null,
      },
    }),
  );

  assert.equal(queue.tasks.some((task) => task.kind === "write_draft"), false);
});

test("buildAgentQueue emits a direct-message draft for an open-profile prospect whose cadence already moved past invites", () => {
  const queue = buildAgentQueue(
    fixture({
      drafts: [],
      touches: [],
      linkedinProfileSnapshot: {
        connectionDegree: 2,
        isOpenProfile: true,
      },
      cadenceState: {
        status: "ready",
        currentStep: "direct-message",
        nextAction: "Send the first private LinkedIn message from the open-profile branch.",
      },
    }),
  );

  const writes = queue.tasks.filter((t) => t.kind === "write_draft");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].surface, "follow_up_direct_message");
  assert.match(writes[0].briefCommand, /--surface follow_up_direct_message --json/);
});

test("buildAgentQueue rewrites a malformed structured-envelope draft instead of sending it", () => {
  const queue = buildAgentQueue(
    fixture({
      drafts: [
        {
          surface: "follow_up_direct_message",
          status: "queued",
          body: JSON.stringify({
            motionId: "motion-1",
            surfaceKey: "follow_up_direct_message",
            draft: { text: "Actual copy." },
          }),
          approvedAt: "2026-06-03T00:00:00.000Z",
          channel: "linkedin",
        },
      ],
      touches: [],
      linkedinProfileSnapshot: {
        connectionDegree: 2,
        isOpenProfile: true,
      },
      cadenceState: {
        status: "ready",
        currentStep: "direct-message",
      },
    }),
  );

  assert.equal(queue.tasks.filter((t) => t.kind === "send_message").length, 0);
  const writes = queue.tasks.filter((t) => t.kind === "write_draft");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].surface, "follow_up_direct_message");
  assert.equal(writes[0].reason, "rewrite_malformed_draft");
});

test("buildAgentQueue does NOT emit write_draft when an active draft already exists on the right surface", () => {
  const queue = buildAgentQueue(
    fixture({
      touches: [],
      drafts: [{ surface: "connection_request", status: "ready", body: "Hi" }],
    }),
  );
  assert.equal(queue.tasks.filter((t) => t.kind === "write_draft").length, 0);
});

test("buildAgentQueue emits a write_draft on the new surface when the prospect has replied since the prior draft", () => {
  const touches = [
    { surface: "connection_request", direction: "outbound", outcome: "accepted", occurredAt: "2026-05-01T00:00:00Z" },
    { surface: "post_accept_message", direction: "outbound", outcome: "sent", occurredAt: "2026-05-02T00:00:00Z" },
    { surface: "inbound_reply", direction: "inbound", outcome: "received", occurredAt: "2026-05-03T00:00:00Z" },
  ];
  const queue = buildAgentQueue(
    fixture({
      touches,
      drafts: [{ surface: "follow_up_direct_message", status: "ready", body: "Following up" }],
    }),
  );
  const writes = queue.tasks.filter((t) => t.kind === "write_draft");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].surface, "inbound_reply");
});

test("buildAgentQueue surfaces a send-ready draft as a stale_send_ready_draft blocker once a reply arrives", () => {
  const touches = [
    { surface: "connection_request", direction: "outbound", outcome: "accepted", occurredAt: "2026-05-01T00:00:00Z" },
    { surface: "post_accept_message", direction: "outbound", outcome: "sent", occurredAt: "2026-05-02T00:00:00Z" },
    { surface: "inbound_reply", direction: "inbound", outcome: "received", occurredAt: "2026-05-03T00:00:00Z" },
  ];
  const queue = buildAgentQueue(
    fixture({
      touches,
      drafts: [
        {
          surface: "follow_up_direct_message",
          status: "approved",
          body: "Following up",
          approvedAt: "2026-05-02T12:00:00Z",
          channel: "linkedin",
        },
      ],
    }),
  );
  assert.equal(queue.tasks.filter((t) => t.kind === "send_message").length, 0, "stale send-ready drafts must not be enqueued as sends");
  assert.equal(queue.blockers.length, 1);
  assert.equal(queue.blockers[0].kind, "stale_send_ready_draft");
  assert.equal(queue.blockers[0].sendReadySurface, "follow_up_direct_message");
  assert.equal(queue.blockers[0].nextSurface, "inbound_reply");
});

test("buildAgentQueue still emits send_message for an approved draft on the current surface", () => {
  const touches = [
    { surface: "connection_request", direction: "outbound", outcome: "accepted", occurredAt: "2026-05-01T00:00:00Z" },
  ];
  const queue = buildAgentQueue(
    fixture({
      touches,
      cadenceState: {
        currentStep: "direct-message",
      },
      drafts: [
        {
          surface: "post_accept_message",
          status: "approved",
          body: "Thanks for connecting.",
          approvedAt: "2026-05-02T00:00:00Z",
          channel: "linkedin",
        },
      ],
    }),
  );
  const sends = queue.tasks.filter((t) => t.kind === "send_message");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].surface, "post_accept_message");
  assert.equal(queue.blockers.length, 0);
});

test("buildAgentQueue still emits send_message for a queued draft on the current surface", () => {
  const touches = [
    { surface: "connection_request", direction: "outbound", outcome: "accepted", occurredAt: "2026-05-01T00:00:00Z" },
  ];
  const queue = buildAgentQueue(
    fixture({
      touches,
      cadenceState: {
        currentStep: "direct-message",
      },
      drafts: [
        {
          surface: "post_accept_message",
          status: "queued",
          body: "Thanks for connecting.",
          approvedAt: "2026-05-02T00:00:00Z",
          channel: "linkedin",
        },
      ],
    }),
  );
  const sends = queue.tasks.filter((t) => t.kind === "send_message");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].surface, "post_accept_message");
  assert.equal(queue.blockers.length, 0);
});

test("buildAgentQueue preserves email sends as send_email instead of collapsing them into LinkedIn direct messages", () => {
  const queue = buildAgentQueue(
    fixture({
      linkedinProfileUrl: null,
      email: "lpark@govpointeoffice.us",
      sourceUrl: "https://mail.google.com/mail/#all/thread-1",
      cadenceState: {
        currentStep: "value-add-email",
      },
      drafts: [
        {
          surface: "email",
          status: "approved",
          subject: "Re: Fire department RFP",
          body: "Thanks for sending this over. We're going to pass on this one.",
          approvedAt: "2026-06-04T17:14:29.676Z",
          channel: "email",
        },
      ],
    }),
  );

  const sends = queue.tasks.filter((task) => task.kind === "send_message");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].surface, "email");
  assert.equal(sends[0].channel, "email");
  assert.equal(sends[0].action, "send_email");
  assert.equal(sends[0].recipientUrl, "https://mail.google.com/mail/#all/thread-1");
  assert.equal(sends[0].recipientEmail, "lpark@govpointeoffice.us");
  assert.match(sends[0].writeback, /--action send_email --result sent --company company-1 --prospect prospect-1 --surface email/);
  assert.equal(queue.blockers.length, 0);
});

test("buildAgentQueue keeps a future first-touch draft in waiting until its due checkpoint", () => {
  const queue = buildAgentQueue(
    fixture({
      touches: [],
      drafts: [],
      cadenceState: {
        nextActionDueAt: "2099-06-01T00:00:00.000Z",
      },
    }),
  );

  assert.equal(queue.tasks.filter((t) => t.kind === "write_draft").length, 0);
  const waitingDraft = queue.waiting.find((t) => t.kind === "write_draft");
  assert.ok(waitingDraft);
  assert.equal(waitingDraft.surface, "connection_request");
  assert.equal(waitingDraft.waitingReason, "not_due_yet");
  assert.equal(waitingDraft.dueAt, "2099-06-01T00:00:00.000Z");
});

test("buildAgentQueue keeps follow-up drafting in waiting while the current outbound branch is still in flight", () => {
  const queue = buildAgentQueue(
    fixture({
      touches: [
        { surface: "connection_request", direction: "outbound", outcome: "accepted", occurredAt: "2026-05-01T00:00:00Z" },
        { surface: "post_accept_message", direction: "outbound", outcome: "sent", occurredAt: "2026-05-02T00:00:00Z" },
      ],
      drafts: [],
      cadenceState: {
        currentStep: "direct-message",
        lastTouchOutcome: "sent",
      },
    }),
  );

  assert.equal(queue.tasks.filter((t) => t.kind === "write_draft").length, 0);
  const waitingDraft = queue.waiting.find((t) => t.kind === "write_draft");
  assert.ok(waitingDraft);
  assert.equal(waitingDraft.surface, "follow_up_direct_message");
  assert.equal(waitingDraft.waitingReason, "waiting_on_outbound");
  assert.equal(waitingDraft.dueAt, null);
});

test("buildAgentQueue releases a follow-up draft once its cadence checkpoint is due", () => {
  const queue = buildAgentQueue(
    fixture({
      touches: [
        { surface: "connection_request", direction: "outbound", outcome: "accepted", occurredAt: "2026-05-01T00:00:00Z" },
        { surface: "post_accept_message", direction: "outbound", outcome: "sent", occurredAt: "2026-05-02T00:00:00Z" },
      ],
      drafts: [],
      cadenceState: {
        currentStep: "direct-message",
        lastTouchOutcome: "sent",
        nextActionDueAt: "2000-01-01T00:00:00.000Z",
      },
    }),
  );

  const dueDraft = queue.tasks.find((t) => t.kind === "write_draft");
  assert.ok(dueDraft);
  assert.equal(dueDraft.surface, "follow_up_direct_message");
  assert.equal(dueDraft.dueAt, "2000-01-01T00:00:00.000Z");
});

test("buildAgentQueue does not emit a connection-request send when cadence has already moved to direct-message", () => {
  const queue = buildAgentQueue(
    fixture({
      touches: [],
      drafts: [
        {
          surface: "connection_request",
          status: "queued",
          body: "This should never send.",
          approvedAt: "2026-05-02T00:00:00Z",
          channel: "linkedin",
        },
      ],
      cadenceState: {
        currentStep: "direct-message",
        nextAction: "Send a short LinkedIn direct message from the existing connection path when capacity allows.",
      },
    }),
  );

  assert.equal(queue.tasks.filter((t) => t.kind === "send_message").length, 0);
  assert.equal(queue.blockers.length, 1);
  assert.equal(queue.blockers[0].reason, "no_writeable_surface");
  assert.equal(queue.blockers[0].sendReadySurface, "connection_request");
});

test("buildAgentQueue keeps a send-ready draft in waiting until the cadence due checkpoint", () => {
  const queue = buildAgentQueue(
    fixture({
      touches: [],
      drafts: [
        {
          surface: "connection_request",
          status: "queued",
          body: "Queued request.",
          approvedAt: "2026-05-02T00:00:00Z",
          channel: "linkedin",
        },
      ],
      cadenceState: {
        nextActionDueAt: "2099-06-01T00:00:00.000Z",
      },
    }),
  );

  assert.equal(queue.tasks.filter((t) => t.kind === "send_message").length, 0);
  const waitingSend = queue.waiting.find((t) => t.kind === "send_message");
  assert.ok(waitingSend);
  assert.equal(waitingSend.surface, "connection_request");
  assert.equal(waitingSend.waitingReason, "not_due_yet");
  assert.equal(waitingSend.dueAt, "2099-06-01T00:00:00.000Z");
});

test("buildAgentQueue queues stale pending connection requests for autonomous withdrawal", () => {
  const queue = buildAgentQueue(
    fixture({
      touches: [],
      drafts: [],
      linkedinProfileSnapshot: { connectionDegree: 2 },
      observations: [
        {
          id: "obs-1",
          kind: "connection_request_pending",
          observedAt: "2000-01-01T00:00:00.000Z",
          actorName: "Princess",
          actorProfileUrl: "https://linkedin.com/in/princess",
          motionId: "motion-1",
          companyId: "company-1",
          prospectId: "prospect-1",
        },
      ],
    }),
  );

  const task = queue.tasks.find((item) => item.kind === "withdraw_connection");
  assert.ok(task);
  assert.equal(task.action, "withdraw_connection");
  assert.equal(task.prospectName, "Princess");
  assert.match(
    task.writeback,
    /exo actions result --action withdraw_connection --result sent --company company-1 --prospect prospect-1 --motion motion-1 --observation obs-1 --surface withdraw_connection/,
  );
});

test("buildAgentQueue queues an unfollow after a withdrawn followed branch needs cleanup", () => {
  const queue = buildAgentQueue(
    fixture({
      drafts: [],
      touches: [
        { surface: "follow", direction: "outbound", outcome: "sent", occurredAt: "2026-05-01T00:00:00Z" },
        { surface: "withdraw_connection", direction: "outbound", outcome: "sent", occurredAt: "2026-05-28T00:00:00Z" },
      ],
    }),
  );

  const task = queue.tasks.find((item) => item.kind === "unfollow_profile");
  assert.ok(task);
  assert.equal(task.action, "unfollow");
  assert.equal(task.prospectName, "Princess");
  assert.match(
    task.writeback,
    /exo actions result --action unfollow --result sent --company company-1 --prospect prospect-1 --motion motion-1 --surface unfollow/,
  );
});
