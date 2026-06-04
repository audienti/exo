// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { renderOperatorPage } from "../src/artifacts/render-operator.js";
import { renderQueuePage } from "../src/artifacts/render-queue.js";
import { buildOperatorViewModel } from "../src/core/build-operator-view.js";

test("operator does not surface autonomous company research as a fake decision", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-03T22:55:47.158Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      headline: "Operator headline",
      nextMove: "Map the first governed account before launch.",
      why: "The motion is still blocked on its first governed account.",
      focusMotion: {
        id: "motion-1",
        name: "harsh-spare-mongoose",
        status: "active",
        companyCount: 3,
        prospectCount: 2,
        overallStage: "needs-company-research",
        updatedAt: "2026-06-03T18:55:47.158Z",
        readyToEngage: false,
        readyToTarget: false,
        backlogCompanies: [
          { id: "company-1", name: "Acadia Pharmaceuticals", stage: "needs-company-research", queueStatus: "discovered" },
          { id: "company-2", name: "Cornerstone OnDemand", stage: "needs-company-research", queueStatus: "discovered" },
        ],
      },
      checklist: [],
    },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  assert.equal(model.nextMove, null);

  const html = renderOperatorPage(model, { interactive: true });
  assert.match(html, /No operator decision is waiting right now/i);
  assert.doesNotMatch(html, /Queue for agent/);
});

test("operator moves agent status into the header dropdown instead of a blocking card", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "LinkedIn inbound truth",
          action: "run_inbound_sync",
          why: "Refresh stale truth.",
          dueAt: "2026-06-04T10:55:00.000Z",
          sourceType: "inbound_itemization_gap",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const runtime = {
    scheduler: { kind: "launchd", installed: false, loaded: false, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: null,
    queueCount: 1,
  };

  const html = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(html, /data-agent-health="yellow"/);
  assert.match(html, /1 queued/i);
  assert.match(html, /Agent work queued/i);
  assert.match(html, /Run agent now/i);
  assert.match(html, /Open queue/i);
  assert.match(html, /data-exo-writer="runAgentQueuePass"/);
  assert.doesNotMatch(html, /next-move agent-runtime/);
});

test("operator queue links a company research task back to the research brief", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-03T22:55:47.158Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      checklist: [],
    },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "company_research::company-1::research_company",
          motionId: "motion-1",
          companyId: "company-1",
          subject: "Acadia Pharmaceuticals",
          action: "Research company",
          why: "Claimed for governed company research.",
          motionName: "harsh-spare-mongoose",
          dueAt: "2026-06-03T22:55:47.158Z",
          sourceType: "company_research_packet",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  assert.equal(model.queue[0]?.href, "/companies/company-1/research-brief/motion-1");
  assert.equal(model.queue[0]?.capability, "company research");
});

test("operator detail links preserve a return path back to operator", () => {
  const html = renderOperatorPage({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:00:00.000Z",
    regenerateCommand: "exo ui",
    counts: { decisions: 1, queue: 0, blocked: 0, stale: 0, agendaLeft: 0 },
    agentRuntime: null,
    nextMove: null,
    decisions: [
      {
        id: "obs-1",
        person: "Nebojsa Pekic",
        prospectId: null,
        initials: "NP",
        avatarUrl: null,
        role: "Founder",
        company: "Agency Co",
        roleLine: "Founder · Agency Co",
        stakes: "high",
        summary: "Reply or ignore.",
        truth: "checked",
        truthAt: "2m",
        surface: "LinkedIn message",
        actionStatus: "due now",
        primaryActionLabel: "Reply",
        primaryHref: "https://www.linkedin.com/in/nebojsa-pekic/",
        secondaryActionLabel: "Ignore",
        secondaryHref: null,
        why: "They replied.",
        previewLabel: "Latest message",
        previewSubject: "Strategic partnership fit",
        previewText: "Would be good to compare notes on partnerships.",
      },
    ],
    queue: [],
    blocked: [],
    stale: [],
    agenda: [],
  }, { interactive: true });

  assert.match(html, /href="\/people\/obs-1\?return=%2Foperator"/);
  assert.match(html, /href="\/people\/obs-1\?return=%2Foperator#compose-obs-1"/);
  assert.match(html, /Latest message/);
  assert.match(html, /Subject · Strategic partnership fit/);
  assert.match(html, /Would be good to compare notes on partnerships\./);
  assert.match(html, /title="They replied\."[^>]*>due now</i);
  assert.doesNotMatch(html, /Why this move/i);
});

test("operator next move uses the card body for message context and collapses why into the status label", () => {
  const html = renderOperatorPage({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:00:00.000Z",
    regenerateCommand: "exo ui",
    counts: { decisions: 0, queue: 0, blocked: 0, stale: 0, agendaLeft: 0 },
    agentRuntime: null,
    nextMove: {
      title: "Reply to Zoe Jupp and move the branch into an active conversation.",
      subject: "Zoe Jupp",
      prospectId: null,
      personId: "obs-hero",
      avatarUrl: null,
      subtitle: "Head of Strategic Partnerships @ Nassau Street Partners",
      motionName: "harsh-spare-mongoose",
      motionStatus: "active",
      truth: "checked",
      truthAt: "2m ago",
      surface: "messaging inbox",
      action: "Reply now",
      actionStatus: "due now",
      actionWriter: null,
      actionArgs: null,
      actionHref: "https://www.linkedin.com/in/zoe-jupp/",
      why: "This is a live response on a private channel. The branch is no longer speculative outreach.",
      previewLabel: "Latest message",
      previewSubject: "Strategic partnership fit",
      previewText: "Would be good to compare notes on partnerships.",
      backlogCompanies: null,
    },
    decisions: [],
    queue: [],
    blocked: [],
    stale: [],
    agenda: [],
  }, { interactive: true });

  assert.match(html, /Latest message/);
  assert.match(html, /Subject · Strategic partnership fit/);
  assert.match(html, /Would be good to compare notes on partnerships\./);
  assert.match(html, /title="This is a live response on a private channel\. The branch is no longer speculative outreach\."[^>]*>due now</i);
  assert.doesNotMatch(html, /Why this move/i);
});

test("queue page shows the same run-now runtime card when the background agent is off", () => {
  const runtime = {
      scheduler: { kind: "launchd", installed: false, loaded: false, running: false, runIntervalSeconds: 900 },
      routine: { exists: true, sendMode: "verify" },
      lastPass: { status: "blocked", endedAt: "2026-06-04T10:17:27.465Z" },
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "Gmail inbound truth",
          action: "run_inbound_sync",
          why: "Refresh stale truth.",
          dueAt: "2026-06-04T10:55:00.000Z",
          sourceType: "inbound_itemization_gap",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  const html = renderQueuePage(model, { interactive: true, agentRuntime: runtime });
  assert.match(html, /data-agent-health="yellow"/);
  assert.match(html, /Agent work queued/i);
  assert.match(html, /Agent is off/i);
  assert.match(html, /Run agent now/i);
  assert.match(html, /data-exo-writer="runAgentQueuePass"/);
});

test("operator header suppresses duplicate launches while a pass lock is active", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "Cornerstone OnDemand",
          action: "Research company",
          why: "Claimed company research is due.",
          dueAt: "2026-06-04T11:00:00.000Z",
          sourceType: "company_research_packet",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const runtime = {
      lock: { active: true, pid: 4242 },
      scheduler: { kind: "launchd", installed: false, loaded: false, running: false, runIntervalSeconds: 900 },
      routine: { exists: true, sendMode: "verify" },
      lastPass: null,
    };

  const html = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(html, /data-agent-health="green"/);
  assert.match(html, /Agent pass running/i);
  assert.match(html, /pid 4242/i);
  assert.doesNotMatch(html, /Run agent now/i);
  assert.doesNotMatch(html, /next-move agent-runtime/);
});

test("agent runtime surfaces an active transport backoff instead of a green queued state", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "David Terry",
          action: "Send Inbound Reply",
          why: "Queued for the agent.",
          dueAt: "2026-06-04T11:00:00.000Z",
          sourceType: "send_ready",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "blocked", endedAt: "2026-06-04T10:17:27.465Z" },
    hostState: {
      browserBackoff: {
        retrieval: { unavailableUntil: null, reason: null },
        execution: {
          unavailableUntil: "2099-06-04T10:22:27.465Z",
          reason: "The current execution lane is blocked.",
        },
      },
    },
    queueCount: 1,
    blockerCount: 0,
  };

  const operatorHtml = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(operatorHtml, /data-agent-health="yellow"/);
  assert.match(operatorHtml, /Agent is blocked/i);
  assert.match(operatorHtml, /Send work is blocked right now\./i);

  const queueHtml = renderQueuePage(model, { interactive: true, agentRuntime: runtime });
  assert.match(queueHtml, /Agent is blocked/i);
  assert.match(queueHtml, /Send work is blocked right now\./i);
  assert.doesNotMatch(queueHtml, /Background agent on/i);
});

test("operator does not surface stale truth as a manual run-check lane", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [
      {
        id: "acct-1",
        capability: "gmail",
        handle: "person@example.com",
        surfaces: [
          {
            key: "gmail-inbox-threads",
            label: "Inbox Threads",
            lastRunStatus: "failed",
            recommendedAction: "Refresh inbox truth.",
            summary: "Inbox needs refresh.",
            meta: { stale: true, unchecked: true },
          },
        ],
      },
    ],
  });

  assert.equal(model.counts.stale, 0);
  const html = renderOperatorPage(model, { interactive: true });
  assert.doesNotMatch(html, /Run check|Rerun & itemize|Retry/);
  assert.match(html, /All surfaces fresh/i);
});

test("operator does not render today's agenda on the landing page", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      checklist: [
        {
          id: "agenda-1",
          label: "Reply to Tony Robbins and move the branch into an active conversation.",
          kind: "truth",
          timeLabel: "9:16p",
          meta: "Inbound review / linkedin / Tony Robbins",
          done: false,
        },
      ],
    },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const html = renderOperatorPage(model, { interactive: true });
  assert.doesNotMatch(html, /Today's agenda/i);
  assert.doesNotMatch(html, /Reply to Tony Robbins and move the branch into an active conversation/i);
});
