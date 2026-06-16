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

  const html = renderOperatorPage(model, {
    interactive: true,
    activeView: "blocked",
    returnTo: "/operator?view=blocked#blocked",
  });
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
  assert.match(html, /<b>0<\/b> queued/i);
  assert.match(html, /1 queued/i);
  assert.match(html, /Agent work queued/i);
  assert.match(html, /Run agent now/i);
  assert.match(html, /Open queue/i);
  assert.match(html, /class="exo-action exo-action-flat" data-exo-writer="runAgentQueuePass"/);
  assert.match(html, /data-exo-writer="runAgentQueuePass"/);
  assert.doesNotMatch(html, /next-move agent-runtime/);
});

test("operator uses prospect avatars that already exist on due-now planner work", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      checklist: [],
    },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    dueNowItems: [
      {
        state: "due_now",
        source: { type: "cadence" },
        motion: { id: "17adf3ca-a6b3-4d26-9f93-bc60f28fe94d", name: "harsh-spare-mongoose" },
        company: { id: "82b0baf7-f98d-4bb6-b12c-c913fcb998cf", name: "Columbus McKinnon" },
        prospect: {
          id: "d149a3e4-6988-4ad7-b40b-000e231e1ac9",
          name: "Sue Weinheimer",
          title: "Director, Technical Infrastructure Americas",
          avatarUrl: "https://example.com/sue.jpg",
        },
        recommendedAction: "First-touch decision: LinkedIn connection request is the only verified usable direct channel.",
        dueAt: "2026-06-04T11:06:00.000Z",
      },
    ],
    waitingItems: [],
    truthAccounts: [],
  });

  assert.equal(model.nextMove?.subject, "Sue Weinheimer");
  assert.equal(model.nextMove?.avatarUrl, "https://example.com/sue.jpg");

  const html = renderOperatorPage(model, {
    interactive: true,
    activeView: "blocked",
    returnTo: "/operator?view=blocked#blocked",
  });
  assert.match(html, /https:\/\/example\.com\/sue\.jpg/i);
  assert.match(html, /<img class="avatar" src="https:\/\/example\.com\/sue\.jpg"/i);
});

test("operator promotes packet review planner work with review actions", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-11T12:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      checklist: [],
    },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    dueNowItems: [
      {
        state: "due_now",
        priority: "action",
        priorityRank: 0.2,
        cadenceEffect: "packet_review_needed",
        dueAt: "2026-06-11T11:45:00.000Z",
        source: {
          type: "packet_review",
          kind: "company_research",
          packetId: "company_research:company-1",
        },
        motion: { id: "17adf3ca-a6b3-4d26-9f93-bc60f28fe94d", name: "harsh-spare-mongoose" },
        company: { id: "82b0baf7-f98d-4bb6-b12c-c913fcb998cf", name: "Packet Review Co" },
        prospect: { id: "company_research:company-1", name: "Packet Review Co", title: "Company Research" },
        recommendedAction: "Review company research packet company_research:company-1: accept, amend, or return it.",
        whyItMatters: "Company Research packet for Packet Review Co is awaiting operator review.",
        context: {
          packetId: "company_research:company-1",
          packetLabel: "Company Research",
          actions: [
            { href: "/companies/82b0baf7-f98d-4bb6-b12c-c913fcb998cf" },
          ],
        },
        operatorActions: [
          {
            label: "Review packet",
            mode: "detail",
            href: "/companies/82b0baf7-f98d-4bb6-b12c-c913fcb998cf",
            writer: null,
            args: { command: "exo motion packet-brief motion-1 --packet company_research:company-1 --json" },
            variant: "primary",
            icon: "eye",
          },
          {
            label: "Accept",
            mode: "detail",
            href: "/companies/82b0baf7-f98d-4bb6-b12c-c913fcb998cf",
            writer: null,
            args: { command: "exo agent packets accept motion-1 --packet company_research:company-1 --json" },
            variant: "secondary",
            icon: "check",
          },
          {
            label: "Amend",
            mode: "detail",
            href: "/companies/82b0baf7-f98d-4bb6-b12c-c913fcb998cf",
            writer: null,
            args: { command: "exo agent packets amend motion-1 --packet company_research:company-1 --outcome <outcome> --reason \"Why this outcome is correct\" --json" },
            variant: "secondary",
            icon: "refresh",
          },
          {
            label: "Return",
            mode: "detail",
            href: "/companies/82b0baf7-f98d-4bb6-b12c-c913fcb998cf",
            writer: null,
            args: { command: "exo agent packets return motion-1 --packet company_research:company-1 --notes \"What the worker must fix\" --json" },
            variant: "danger",
            icon: "x",
          },
        ],
      },
    ],
    waitingItems: [],
    truthAccounts: [],
  });

  assert.equal(model.nextMove?.subject, "Packet Review Co");
  assert.equal(model.nextMove?.surface, "packet review");
  assert.equal(model.nextMove?.action, "Review packet");
  assert.deepEqual(model.nextMove?.actions.map((action) => action.label), [
    "Review packet",
    "Accept",
    "Amend",
    "Return",
  ]);

  const html = renderOperatorPage(model, {
    interactive: true,
    activeView: "blocked",
    returnTo: "/operator?view=blocked#blocked",
  });
  assert.match(html, /Review packet/);
  assert.match(html, /Accept/);
  assert.match(html, /Amend/);
  assert.match(html, /Return/);
});

test("operator does not surface outbound-capacity deficit as a human next move", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-07T22:15:30.558Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      headline: "Keep filling today's LinkedIn invitation deficit.",
      nextMove: "Use the ready connection-request branches to send 23 more LinkedIn invitations today and close the remaining deficit.",
      why: "Outbound pacing is behind today's target.",
      checklist: [],
    },
    decisionQueue: { items: [] },
    dueNowItems: [
      {
        motion: { id: "outbound-capacity:linkedin", name: "LinkedIn outbound capacity" },
        company: { id: "outbound-capacity:linkedin", name: "William Flanagan" },
        prospect: { id: "outbound-capacity:linkedin", name: "LinkedIn invitation target", title: "Daily deficit" },
        state: "due_now",
        priority: "action",
        priorityRank: 0.95,
        cadenceEffect: "capacity_deficit",
        dueAt: "2026-06-07T22:15:30.558Z",
        whyItMatters: "LinkedIn target is 25 invitations today.",
        recommendedAction: "Use the ready connection-request branches to send 23 more LinkedIn invitations today and close the remaining deficit.",
        source: { type: "outbound_capacity", kind: "fill_connection_request_deficit", channel: "linkedin" },
      },
    ],
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  assert.equal(model.nextMove, null);
  assert.deepEqual(model.decisions, []);
  assert.equal(model.counts.decisions, 0);
});

test("operator does not merge outbound-capacity summary into a person card with the same due time", () => {
  const dueAt = "2026-06-11T17:55:42.509Z";
  const capacityAction = "Send 18 ready LinkedIn connection requests now, then select prospects from 10 researched accounts so the motion can refill 7 ready branches for today's invitation target.";
  const personAction = "Ready for first-touch decision: LinkedIn is the only verified usable channel; no direct email or mobile is verified.";
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: dueAt,
    regenerateCommand: "exo ui",
    operatorSummary: {
      headline: "Next move for william-main",
      nextMove: capacityAction,
      why: "LinkedIn target is 25 invitations today.",
      checklist: [
        {
          subject: "LinkedIn capacity deficit",
          action: capacityAction,
          dueAt,
        },
      ],
    },
    decisionQueue: { items: [] },
    dueNowItems: [
      {
        motion: { id: "outbound-capacity:linkedin", name: "LinkedIn outbound capacity" },
        company: { id: "outbound-capacity:linkedin", name: "William Flanagan" },
        prospect: { id: "outbound-capacity:linkedin", name: "LinkedIn invitation target", title: "Daily deficit" },
        state: "due_now",
        priority: "action",
        priorityRank: 0.95,
        cadenceEffect: "capacity_deficit",
        dueAt,
        whyItMatters: "LinkedIn target is 25 invitations today.",
        recommendedAction: capacityAction,
        source: { type: "outbound_capacity", kind: "fill_connection_request_deficit", channel: "linkedin" },
      },
      {
        motion: { id: "17adf3ca-a6b3-4d26-9f93-bc60f28fe94d", name: "harsh-spare-mongoose" },
        company: { id: "82b0baf7-f98d-4bb6-b12c-c913fcb998cf", name: "Cornerstone OnDemand" },
        prospect: {
          id: "d149a3e4-6988-4ad7-b40b-000e231e1ac9",
          name: "Amresh Munshi",
          title: "Director, Procurement & Strategic Sourcing",
        },
        state: "due_now",
        priority: "action",
        priorityRank: 0.9,
        dueAt,
        cadence: {
          currentStep: "connection-request",
          nextAction: personAction,
        },
        whyItMatters: "The planned cadence branch is due and no stronger inbound event has displaced it.",
        recommendedAction: personAction,
        source: { type: "cadence", kind: "planned_next_action" },
      },
    ],
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  assert.equal(model.nextMove?.subject, "Amresh Munshi");
  assert.equal(model.nextMove?.title, personAction);
  assert.equal(model.nextMove?.why, "The planned cadence branch is due and no stronger inbound event has displaced it.");
  assert.equal(model.nextMove?.action, "Compose request");

  const html = renderOperatorPage(model, {
    interactive: true,
    activeView: "blocked",
    returnTo: "/operator?view=blocked#blocked",
  });
  assert.match(html, /Amresh Munshi/);
  assert.match(html, /LinkedIn is the only verified usable channel/);
  assert.match(html, />Compose request</);
  assert.doesNotMatch(html, />Compose email</);
  assert.doesNotMatch(html, /Send 18 ready LinkedIn connection requests now/);
  assert.doesNotMatch(html, /LinkedIn target is 25 invitations today/);
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

test("operator renders assignment blockers as live pin actions when blocker actions exist", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-05T11:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: {
      items: [
        {
          id: "assignment-blocker-1",
          subject: "Bill Browning",
          reason: "Needs operator assignment",
          detail: "22 ready branches across 12 companies cannot open until one trusted owner is assigned.",
          blockType: "assignment",
          resolveLabel: "Assign owner",
          channel: "linkedin",
          actions: [
            {
              writer: "assignCompanyUser",
              label: "Assign 6sense",
              args: {
                companyId: "company-1",
                userId: "user-1",
              },
            },
          ],
        },
      ],
    },
    truthAccounts: [],
  });

  const html = renderOperatorPage(model, {
    interactive: true,
    activeView: "blocked",
    returnTo: "/operator?view=blocked#blocked",
  });
  assert.match(html, /data-exo-writer="assignCompanyUser"/);
  assert.match(html, /class="exo-action exo-action-flat"/);
  assert.match(html, /Assign 6sense/);
});

test("operator stale draft blockers link straight to the compose panel", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T15:41:01.811Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: {
      items: [
        {
          id: "queue-blocker-peter",
          subject: "Peter Kirk",
          reason: "Queued draft needs re-review",
          detail: "Post Accept Message was queued, but the branch moved to Inbound Reply.",
          blockType: "stale_draft",
          resolveLabel: "Review draft",
          channel: "linkedin",
          actions: [],
          prospectId: "prospect-peter",
        },
      ],
    },
    truthAccounts: [],
  });

  const html = renderOperatorPage(model, {
    interactive: true,
    activeView: "blocked",
    returnTo: "/operator?view=blocked#blocked",
  });
  assert.match(
    html,
    /href="\/prospects\/prospect-peter\?return=%2Foperator%3Fview%3Dblocked%23blocked#compose-prospect-peter"/,
  );
  assert.doesNotMatch(html, /Review draft.*disabled/);
});

test("operator capability blockers keep the live repair link", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-15T17:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: {
      items: [
        {
          id: "queue-blocker-gmail",
          subject: "Acme · Princess",
          reason: "Exact Gmail inbox required",
          detail: "william-main has multiple managed Gmail inboxes, so this motion cannot trust one sender implicitly. Pick one Exact Gmail inbox under Execution before email work can run.",
          blockType: "capability",
          resolveLabel: "Open motion settings",
          channel: "email",
          actions: [],
          prospectId: "prospect-princess",
          resolveMode: "detail",
          resolveHref: "/motions/motion-1/settings#execution",
        },
      ],
    },
    truthAccounts: [],
  });

  const html = renderOperatorPage(model, {
    interactive: true,
    activeView: "blocked",
    returnTo: "/operator?view=blocked#blocked",
  });
  assert.match(html, /Exact Gmail inbox required/);
  assert.match(
    html,
    /href="\/motions\/motion-1\/settings\?return=%2Foperator%3Fview%3Dblocked%23blocked#execution"/,
  );
  assert.doesNotMatch(html, /Open motion settings.*disabled/);
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
      primaryActionMode: "compose",
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
  assert.match(html, /href="\/people\/obs-1\?return=%2Foperator&amp;compose=1#compose-obs-1"/);
  assert.match(html, /Latest message/);
  assert.match(html, /Subject · Strategic partnership fit/);
  assert.match(html, /Would be good to compare notes on partnerships\./);
  assert.match(html, /title="They replied\."[^>]*>due now</i);
  assert.doesNotMatch(html, /Why this move/i);
});

test("operator planner cards use their routed detail href instead of a fake person link", () => {
  const motionId = "857e193e-fd1e-422f-94ac-e856e59d0619";
  const companyId = "08c6ac2d-4896-4aa4-8701-15b283ff6aaf";
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-07T22:15:30.558Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      headline: "Research the queued account.",
      nextMove: "Open the company research brief and continue the packet.",
      why: "Queued discovery should route to the real company surface, not an internal person page.",
      checklist: [],
    },
    decisionQueue: { items: [] },
    dueNowItems: [
      {
        motion: { id: motionId, name: "rational-coarse-wren" },
        company: { id: companyId, name: "The Pitch" },
        prospect: null,
        state: "due_now",
        priority: "action",
        priorityRank: 0.8,
        dueAt: "2026-06-07T22:15:30.558Z",
        whyItMatters: "Queued company research is ready to resume.",
        recommendedAction: "Open company research.",
        source: { type: "company_discovery", kind: "run_company_discovery" },
      },
    ],
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const html = renderOperatorPage(model, { interactive: true });

  assert.match(html, new RegExp(`href="/companies/${companyId}\\?return=%2Foperator"`));
  assert.doesNotMatch(html, /href="\/people\//);
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
      actionMode: "compose",
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

test("operator renders wired accept and reject actions when an inbound invite needs decision", () => {
  const html = renderOperatorPage({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T20:34:00.000Z",
    regenerateCommand: "exo ui",
    counts: { decisions: 1, queue: 0, blocked: 0, stale: 0, agendaLeft: 0 },
    agentRuntime: null,
    nextMove: {
      title: "Review Rizwan I.'s inbound connection request and decide whether to accept or decline it.",
      subject: "Rizwan I.",
      prospectId: null,
      personId: "obs-rizwan",
      avatarUrl: null,
      subtitle: "Business Developer · Integriti",
      motionName: "Inbound review",
      motionStatus: "active",
      truth: "partial",
      truthAt: "1d ago",
      surface: "received invitations",
      action: "Accept",
      actionMode: "detail",
      actionStatus: "needs decision",
      actionWriter: "recordInboundObservation",
      actionArgs: { observationId: "obs-rizwan", nextKind: "connection_request_accept_requested" },
      actionHref: "https://www.linkedin.com/in/rizwan-i/",
      why: "Inbound connection requests are explicit asks for access. They need a yes or no, not passive drift.",
      previewLabel: null,
      previewSubject: null,
      previewText: null,
      backlogCompanies: null,
      actions: [
        {
          label: "Accept",
          mode: "detail",
          href: "https://www.linkedin.com/in/rizwan-i/",
          writer: "recordInboundObservation",
          args: { observationId: "obs-rizwan", nextKind: "connection_request_accept_requested" },
          variant: "primary",
          icon: "check",
        },
        {
          label: "Reject",
          mode: "detail",
          href: "https://www.linkedin.com/in/rizwan-i/",
          writer: "recordInboundObservation",
          args: { observationId: "obs-rizwan", nextKind: "connection_request_decline_requested" },
          variant: "danger",
          icon: "x",
        },
      ],
    },
    decisions: [
      {
        id: "obs-rizwan-2",
        person: "Alicia Buyer",
        prospectId: null,
        initials: "AB",
        avatarUrl: null,
        role: "VP Sales",
        company: "BuyerCo",
        roleLine: "VP Sales · BuyerCo",
        stakes: "high",
        summary: "Review Alicia Buyer's inbound connection request and decide whether to accept or decline it.",
        truth: "partial",
        truthAt: "3h ago",
        surface: "received invitations",
        actionStatus: "needs decision",
        primaryActionLabel: "Accept",
        primaryActionMode: "detail",
        primaryHref: "https://www.linkedin.com/in/alicia-buyer/",
        secondaryActionLabel: "Pass",
        secondaryHref: null,
        why: "Inbound connection requests are explicit asks for access. They need a yes or no, not passive drift.",
        previewLabel: null,
        previewSubject: null,
        previewText: null,
        actions: [
          {
            label: "Accept",
            mode: "detail",
            href: "https://www.linkedin.com/in/alicia-buyer/",
            writer: "recordInboundObservation",
            args: { observationId: "obs-rizwan-2", nextKind: "connection_request_accept_requested" },
            variant: "primary",
            icon: "check",
          },
          {
            label: "Reject",
            mode: "detail",
            href: "https://www.linkedin.com/in/alicia-buyer/",
            writer: "recordInboundObservation",
            args: { observationId: "obs-rizwan-2", nextKind: "connection_request_decline_requested" },
            variant: "danger",
            icon: "x",
          },
        ],
      },
    ],
    queue: [],
    blocked: [],
    stale: [],
    agenda: [],
  }, { interactive: true });

  assert.match(html, />Accept</);
  assert.match(html, />Reject</);
  assert.match(html, /nextKind&quot;:&quot;connection_request_accept_requested&quot;/);
  assert.match(html, /nextKind&quot;:&quot;connection_request_decline_requested&quot;/);
  assert.equal((html.match(/data-exo-writer="recordInboundObservation"/g) ?? []).length, 4);
});

test("operator open actions stay on the detail page instead of auto-opening compose", () => {
  const html = renderOperatorPage({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-05T16:00:00.000Z",
    regenerateCommand: "exo ui",
    counts: { decisions: 1, queue: 0, blocked: 0, stale: 0, agendaLeft: 0 },
    agentRuntime: null,
    nextMove: null,
    decisions: [
      {
        id: "obs-view",
        person: "Nina Prospect",
        prospectId: null,
        initials: "NP",
        avatarUrl: null,
        role: "Director of Demand Generation",
        company: "BuyerCo",
        roleLine: "Director of Demand Generation · BuyerCo",
        stakes: null,
        summary: "Review whether Nina Prospect's profile view changes the patience or escalation logic on this branch.",
        truth: "checked",
        truthAt: "2m",
        surface: "profile views",
        actionStatus: "needs decision",
        primaryActionLabel: "Open",
        primaryActionMode: "detail",
        primaryHref: "https://www.linkedin.com/in/nina-prospect/",
        secondaryActionLabel: "Profile",
        secondaryHref: null,
        why: "A profile view is real attention. It does not unlock a private move by itself, but it changes how patient the branch should be.",
        previewLabel: "Engagement",
        previewSubject: null,
        previewText: "Nina Prospect appeared in your LinkedIn profile viewers. Viewed 2mo ago.",
      },
    ],
    queue: [],
    blocked: [],
    stale: [],
    agenda: [],
  }, { interactive: true });

  assert.match(html, /href="\/people\/obs-view\?return=%2Foperator"/);
  assert.doesNotMatch(html, /href="\/people\/obs-view\?return=%2Foperator#compose-obs-view"/);
});

test("operator excludes stale global-intake claim backlog from the live decision lane", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-05T13:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: {
      items: [
        {
          id: "obs-stale",
          subject: "Mike Agron",
          summary: "Old inbound thread.",
          recommendedAction: "Claim Mike Agron into this workspace's transition backlog if this thread belongs here.",
          priority: "high",
          state: "needs_claim",
          surfaceKey: "linkedin-messaging-inbox",
          observedAt: "2023-02-29T13:00:00.000Z",
          actorTitle: "Advisor",
          actorCompanyName: "Legacy Co",
          actorProfileUrl: "https://www.linkedin.com/in/mike-agron/",
          options: ["claim"],
        },
        {
          id: "obs-fresh",
          subject: "Jordan Cipolla",
          summary: "Recent inbound thread.",
          recommendedAction: "Claim Jordan Cipolla into this workspace's transition backlog if this thread belongs here.",
          priority: "high",
          state: "needs_claim",
          surfaceKey: "linkedin-messaging-inbox",
          observedAt: "2026-06-01T13:00:00.000Z",
          actorTitle: "Founder",
          actorCompanyName: "Current Co",
          actorProfileUrl: "https://www.linkedin.com/in/jordan-cipolla/",
          options: ["claim"],
        },
      ],
    },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  assert.equal(model.counts.decisions, 1);
  assert.equal(model.nextMove?.subject, "Jordan Cipolla");
  assert.deepEqual(model.decisions.map((item) => item.person), []);

  const html = renderOperatorPage(model, { interactive: true });
  assert.match(html, /Jordan Cipolla/);
  assert.match(html, /The first queued action is promoted above\./);
  assert.doesNotMatch(html, /Mike Agron/);
});

test("operator hero follows the governed summary instead of the top raw decision item", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T14:00:46.399Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      headline: "Next move for william-main",
      nextMove: "Reply to Peter Kirk and move the branch into an active conversation.",
      why: "This is a live response on a private channel. The branch is no longer speculative outreach.",
      checklist: [
        {
          subject: "Inbound review / Smooth Operator / Peter Kirk",
          action: "Reply to Peter Kirk and move the branch into an active conversation.",
          dueAt: "2024-10-09T15:16:36.000Z",
        },
        {
          subject: "transition-inbound-backlog / Valet Living / Matt Pierce",
          action: "Reply to Matt Pierce and move the branch into an active conversation.",
          dueAt: "2026-06-05T15:07:07.000Z",
        },
      ],
    },
    decisionQueue: {
      items: [
        {
          id: "obs-matt",
          subject: "Matt Pierce",
          summary: "Matt Pierce has unread LinkedIn message activity.",
          recommendedAction: "Reply to Matt Pierce and move the branch into an active conversation.",
          priority: "high",
          state: "needs_reply",
          surfaceKey: "linkedin-messaging-inbox",
          observedAt: "2026-06-05T15:07:07.000Z",
          actorTitle: "Business Intelligence, Revenue Operations, and Business Transformation Professional",
          actorCompanyName: "Valet Living",
          actorProfileUrl: "https://www.linkedin.com/in/mpiercekc/",
          previewLabel: "Latest message",
          previewText: "Yes, that's fine.",
          why: "This is a live response on a private channel. The branch is no longer speculative outreach.",
          options: ["reply-now"],
        },
        {
          id: "obs-peter",
          subject: "Peter Kirk",
          summary: "Peter Kirk has unread LinkedIn message activity.",
          recommendedAction: "Reply to Peter Kirk and move the branch into an active conversation.",
          priority: "high",
          state: "needs_reply",
          surfaceKey: "linkedin-messaging-inbox",
          observedAt: "2024-10-09T15:16:36.000Z",
          actorTitle: "Needs reply",
          actorCompanyName: "Smooth Operator",
          actorProfileUrl: "https://www.linkedin.com/in/peter-kirk/",
          previewLabel: "Latest message",
          previewText: "Happy to talk.",
          why: "This is a live response on a private channel. The branch is no longer speculative outreach.",
          options: ["reply-now"],
        },
      ],
    },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  assert.equal(model.nextMove?.subject, "Peter Kirk");
  assert.equal(model.nextMove?.title, "Reply to Peter Kirk and move the branch into an active conversation.");
  assert.deepEqual(model.decisions.map((item) => item.person), ["Matt Pierce"]);

  const html = renderOperatorPage(model, { interactive: true });
  assert.match(html, /Reply to Peter Kirk and move the branch into an active conversation\./);
  assert.match(html, /Peter Kirk/);
  assert.match(html, /Matt Pierce/);
});

test("queue page shows the same run-now runtime bar when the background agent is off", () => {
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
  const introStart = html.indexOf("<h1>Agent queue</h1>");
  const runtimeBarStart = html.indexOf('<details class="agent-bar');
  const introHtml = html.slice(introStart, runtimeBarStart);
  assert.ok(runtimeBarStart > -1, "queue page should render the runtime disclosure bar");
  assert.match(html, /<details class="agent-bar(?: agent-bar-embedded)?" open>/);
  assert.doesNotMatch(html, /next-move agent-runtime/);
  assert.match(html, /data-agent-health="yellow"/);
  assert.match(html, /Agent work queued/i);
  assert.match(html, /Background agent off/i);
  assert.match(html, /The background agent is not installed on this machine\./i);
  assert.match(html, /Next action: Install the background agent before expecting autonomous draining\./i);
  assert.match(html, /Run agent now/i);
  assert.doesNotMatch(html, /Work the agent will run autonomously/i);
  assert.match(introHtml, /Run agent now/i);
  assert.match(introHtml, /Review only/i);
  assert.match(html, /data-exo-writer="runAgentQueuePass"/);
});

test("queue page shows checked-out agent work distinctly from plain queued work", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: true, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: null,
    queueCount: 1,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T21:10:00.000Z",
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
          dueAt: "2026-06-06T21:00:00.000Z",
          sourceType: "inbound_itemization_gap",
          checkoutState: "checked_out",
          checkedOutBy: "william@host",
          checkedOutAt: "2026-06-06T21:05:00.000Z",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  assert.equal(model.queue[0]?.checkoutState, "checked_out");
  assert.equal(model.queue[0]?.checkedOutBy, "william@host");

  const html = renderQueuePage(model, { interactive: true, agentRuntime: runtime });
  assert.match(html, /Checked out/i);
  assert.match(html, /william@host/i);
  assert.doesNotMatch(html, /Queued for agent<\/span>/i);
});

test("queue page shows queue age separately from the next due time", () => {
  const now = Date.now();
  const queuedAt = new Date(now - (2 * 60 * 60 * 1000)).toISOString();
  const dueAt = new Date(now + (5 * 60 * 1000)).toISOString();

  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: new Date(now).toISOString(),
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "Justin Robinson",
          action: "Send Connection Request",
          why: "Queued for the agent.",
          queuedAt,
          dueAt,
          sourceType: "send_ready",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const html = renderQueuePage(model, { interactive: true });
  assert.match(html, /queued 2h/i);
  assert.match(html, /due in 5m|due in 4m/i);
  assert.doesNotMatch(html, /waiting <1m/i);
});

test("queue page does not invent queue age from a derived due time", () => {
  const now = Date.now();
  const dueAt = new Date(now - (10 * 60 * 1000)).toISOString();

  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: new Date(now).toISOString(),
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "Brandon Clements",
          action: "like_post",
          why: "Public warmup is ready.",
          dueAt,
          queuedAt: null,
          sourceType: "cadence",
          taskKind: "send_message",
          capability: "linkedin",
          surface: "like_post",
          via: "public-engagement",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const html = renderQueuePage(model, { interactive: true });
  assert.doesNotMatch(html, /queued 10m|queued 9m/i);
});

test("queue page folds agent status into a strip and tabs the full surface list", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "blocked", endedAt: "2026-06-04T10:48:00.000Z" },
    queueCount: 1,
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
    agentRuntime: runtime,
  });
  const agentStatus = {
    checkedAt: "2026-06-04T11:00:00.000Z",
    state: "queued",
    current: { active: false, activeTaskCount: 0, tasks: [], locks: { active: false, lanes: [] } },
    backlog: {
      dueTaskCount: 2,
      waitingTaskCount: 0,
      blockerCount: 0,
      dueByKind: [{ kind: "send_message", count: 2 }],
      waitingByReason: [],
      blockersByReason: [],
    },
    throughput: {
      lastPass: {
        status: "blocked",
        resultCount: 1,
        completedCount: 0,
        blockedCount: 1,
        failedCount: 0,
        durationSeconds: 1,
        byKind: [],
      },
      last24Hours: { resultCount: 1, recentMotionRunCount: 9 },
    },
    partial: { active: false },
    inboundSurfaces: {
      count: 3,
      items: [
        {
          capability: "gmail",
          accountHandle: "wflanagan",
          surfaceLabel: "Inbox Threads",
          lastRunStatus: "success",
          lastSyncedAt: "2026-06-04T10:40:00.000Z",
          lastObservedAt: "2026-06-04T10:40:00.000Z",
          capturedItemCount: 1,
          visibleTotalCount: null,
          observationCount: 1,
          pageWalkStatus: "pages not recorded",
          resumeCursor: null,
          resumeStartOffset: null,
          lastError: null,
        },
        {
          capability: "linkedin",
          accountHandle: "wf",
          surfaceLabel: "Followers",
          lastRunStatus: "failed",
          lastSyncedAt: null,
          lastObservedAt: "2026-06-04T09:00:00.000Z",
          capturedItemCount: 0,
          visibleTotalCount: null,
          observationCount: 0,
          pageWalkStatus: null,
          resumeCursor: null,
          resumeStartOffset: null,
          lastError: "Connector timeout",
        },
        {
          capability: "linkedin",
          accountHandle: "wf",
          surfaceLabel: "Connections",
          lastRunStatus: null,
          lastSyncedAt: null,
          lastObservedAt: null,
          capturedItemCount: null,
          visibleTotalCount: null,
          observationCount: null,
          pageWalkStatus: null,
          resumeCursor: null,
          resumeStartOffset: null,
          lastError: null,
        },
      ],
    },
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    generatedAt: "2026-06-04T11:00:00.000Z",
  });

  // Runtime bar: collapsed by default when the scheduler is on, status side chip present.
  assert.match(html, /<section class="op-sec queue-runtime-panel" data-sec="agent-status">/);
  assert.match(html, /<details class="agent-bar agent-bar-embedded">/);
  assert.match(html, /Queued · checked just now/);
  assert.doesNotMatch(html, /next-move agent-runtime/);

  // Runtime + strip share one shell instead of rendering as two stacked panels.
  const panelStart = html.indexOf('<section class="op-sec queue-runtime-panel" data-sec="agent-status">');
  const tabsStart = html.indexOf('data-tabset="queue-views"');
  const panelHtml = html.slice(panelStart, tabsStart);
  assert.ok(panelStart > -1, "queue page should render a combined runtime/status panel");
  assert.equal((panelHtml.match(/data-sec="agent-status"/g) ?? []).length, 1);
  assert.equal((panelHtml.match(/class="agent-bar/g) ?? []).length, 1);
  assert.equal((panelHtml.match(/class="ws-strip/g) ?? []).length, 1);

  // Status strip replaces the panel grid.
  assert.match(html, /Current work/);
  assert.match(html, /No task checked out/);
  assert.match(html, /<b>2<\/b> due · <b>0<\/b> waiting · <b>0<\/b> blockers/);
  assert.match(html, /2 Send Message/);
  assert.match(html, /Last pass blocked · 1 result · 1s/);
  assert.match(html, /24h: 1 result, 9 motion runs/);
  assert.doesNotMatch(html, /class="ws-grid"/);

  // Segmented control with deep-linkable queue/surfaces panels.
  assert.match(html, /role="tablist"[^>]*data-tabset="queue-views"/);
  assert.match(html, /class="seg seg-tabs"/);
  assert.match(html, /data-tab-target="queue"/);
  assert.match(html, /data-tab-target="surfaces"/);
  assert.match(html, /data-tab-panel="surfaces" hidden/);

  // Surfaces tab: every enabled surface renders — no truncation, errors first,
  // sync recency on each row.
  assert.match(html, /gmail \/ wflanagan \/ Inbox Threads/);
  assert.match(html, /linkedin \/ wf \/ Followers/);
  assert.match(html, /linkedin \/ wf \/ Connections/);
  assert.match(html, /synced 20m ago/);
  assert.match(html, /synced 2h ago/);
  assert.match(html, /never synced/);
  assert.match(html, /No telemetry recorded yet/);
  assert.doesNotMatch(html, /more enabled surfaces/);
  assert.ok(
    html.indexOf("Connector timeout") < html.indexOf("Inbox Threads"),
    "surfaces with errors should sort to the top of the list",
  );
});

test("queue page marks send work as gated by failed LinkedIn inbound sync", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "partial", endedAt: "2026-06-14T00:50:00.000Z" },
    queueCount: 13,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-14T00:53:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "sync-1",
          subject: "LinkedIn sent invitations",
          action: "Run inbound sync",
          why: "Repair stale LinkedIn truth before sending.",
          dueAt: "2026-06-14T00:45:00.000Z",
          sourceType: "inbound_itemization_gap",
          taskKind: "run_inbound_sync",
          capability: "linkedin",
          surfaceKeys: ["linkedin-sent-invitations", "linkedin-received-invitations"],
        },
        {
          id: "send-1",
          subject: "Brandon Clements",
          action: "send_connection_request",
          why: "Connection request is ready.",
          dueAt: "2026-06-14T00:44:00.000Z",
          sourceType: "cadence",
          taskKind: "send_message",
          capability: "linkedin",
          surface: "connection_request",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });
  const agentStatus = {
    checkedAt: "2026-06-14T00:53:00.000Z",
    state: "partial",
    current: { active: false, activeTaskCount: 0, tasks: [], locks: { active: false, lanes: [] } },
    backlog: {
      dueTaskCount: 13,
      waitingTaskCount: 7,
      blockerCount: 0,
      dueByKind: [
        { kind: "send_message", count: 7 },
        { kind: "run_inbound_sync", count: 6 },
      ],
      waitingByReason: [],
      blockersByReason: [],
    },
    throughput: {
      lastPass: { status: "partial", resultCount: 1, durationSeconds: 4, byKind: [] },
      last24Hours: { resultCount: 1, recentMotionRunCount: 3 },
    },
    partial: {
      active: true,
      reason: "No due tasks were available.",
      nextAction: "Continue the agent pass to drain 13 due tasks.",
    },
    inboundSurfaces: {
      count: 2,
      items: [
        {
          capability: "linkedin",
          accountHandle: "williamflanagan",
          surfaceKey: "linkedin-sent-invitations",
          surfaceLabel: "Sent Invitations",
          syncTrustStatus: "untrusted",
          lastRunStatus: "failed",
          lastSyncedAt: null,
          lastObservedAt: "2026-06-14T00:30:00.000Z",
          capturedItemCount: 0,
          visibleTotalCount: null,
          observationCount: 0,
          pageWalkStatus: null,
          resumeCursor: null,
          resumeStartOffset: null,
          lastError: "linkedin capture failed.",
        },
        {
          capability: "linkedin",
          accountHandle: "williamflanagan",
          surfaceKey: "linkedin-received-invitations",
          surfaceLabel: "Received Invitations",
          syncTrustStatus: "untrusted",
          lastRunStatus: "failed",
          lastSyncedAt: null,
          lastObservedAt: "2026-06-14T00:31:00.000Z",
          capturedItemCount: 0,
          visibleTotalCount: null,
          observationCount: 0,
          pageWalkStatus: null,
          resumeCursor: null,
          resumeStartOffset: null,
          lastError: "linkedin capture failed.",
        },
      ],
    },
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    generatedAt: "2026-06-14T00:53:00.000Z",
  });

  assert.match(html, /Live sends gated/i);
  assert.match(html, /1 send task are paused until LinkedIn inbound sync is healthy\./i);
  assert.match(html, /Run 1 inbound sync repair task first\./i);
  assert.match(html, /Latest error: linkedin capture failed\./i);
  assert.doesNotMatch(html, /linkedin capture failed\.\./i);
  assert.match(html, /Live send gated/i);
  assert.match(html, /Gated by sync/i);
  assert.doesNotMatch(html, /Continue the agent pass to drain 13 due tasks\./i);

  assert.match(html, /data-tab-target="queue"[^>]*>Agent queue<span class="count-chip tone-blue">1<\/span>/i);
  assert.match(html, /data-tab-target="waiting"[^>]*>Waiting<span class="count-chip tone-amber">1<\/span>/i);
  assert.match(html, /id="queue-views-panel-waiting"[^>]*data-tab-panel="waiting" hidden/i);
  const queuePanel = html.slice(
    html.indexOf('id="queue-views-panel-queue"'),
    html.indexOf('id="queue-views-panel-waiting"'),
  );
  const waitingPanel = html.slice(
    html.indexOf('id="queue-views-panel-waiting"'),
    html.indexOf('id="queue-views-panel-surfaces"'),
  );
  assert.match(queuePanel, /LinkedIn sent invitations/i);
  assert.doesNotMatch(queuePanel, /Brandon Clements/i);
  assert.match(waitingPanel, /Brandon Clements/i);
});

test("queue page runtime summary normalizes soft-blocked pass history into partial", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: {
      status: "blocked",
      reason: "LinkedIn spacing keeps this outbound action from firing immediately.",
      endedAt: "2026-06-15T15:41:17.286Z",
      results: [
        { kind: "send_message", status: "completed" },
        { kind: "send_message", status: "blocked" },
      ],
      finalQueueCounts: {
        dueTaskCount: 24,
        waitingTaskCount: 27,
        blockerCount: 0,
      },
    },
    queueCount: 24,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-15T15:48:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "send-1",
          subject: "Tonia Ewing",
          action: "Send connection request",
          why: "Ready to send.",
          dueAt: "2026-06-15T15:41:00.000Z",
          taskKind: "send_message",
          capability: "exo",
          motionName: "harsh-spare-mongoose",
          actionKey: "send_connection_request",
          surface: "connection_request",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });
  const agentStatus = {
    state: "partial",
    checkedAt: "2026-06-15T15:48:00.000Z",
    current: { active: false, tasks: [], locks: { active: false, lanes: [] } },
    backlog: {
      dueTaskCount: 24,
      waitingTaskCount: 27,
      blockerCount: 0,
      dueByKind: [{ kind: "send_message", count: 24 }],
      waitingByReason: [
        { waitingReason: "randomized_spacing", count: 27, nextDueAt: "2026-06-15T15:49:00.000Z", taskKinds: [] },
      ],
      blockersByReason: [],
    },
    throughput: {
      lastPass: { status: "partial", resultCount: 2, durationSeconds: 60 },
      last24Hours: { resultCount: 2, recentMotionRunCount: 0 },
    },
    partial: {
      active: true,
      status: "partial",
      reason: "The last pass ended before the due queue drained; 24 due tasks remain.",
      nextAction: "Continue the agent pass to drain 24 due tasks.",
    },
    holds: { count: 0, items: [] },
    inboundSurfaces: { items: [] },
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    generatedAt: "2026-06-15T15:48:00.000Z",
  });

  assert.match(model.agentRuntime?.lastPassSummary ?? "", /Last pass partial/i);
  assert.match(html, /Last pass partial/i);
  assert.doesNotMatch(html, /Last pass blocked/i);
});

test("queue page activity copy reframes spacing waits as partial queue pressure", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "partial", endedAt: "2026-06-15T15:41:17.286Z" },
    queueCount: 24,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-15T15:48:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });
  const agentStatus = {
    state: "partial",
    checkedAt: "2026-06-15T15:48:00.000Z",
    current: { active: false, tasks: [], locks: { active: false, lanes: [] } },
    backlog: {
      dueTaskCount: 24,
      waitingTaskCount: 27,
      blockerCount: 0,
      dueByKind: [],
      waitingByReason: [],
      blockersByReason: [],
    },
    throughput: {
      lastPass: { status: "partial", resultCount: 2, durationSeconds: 60 },
      last24Hours: { resultCount: 2, recentMotionRunCount: 0 },
    },
    partial: { active: true, reason: "The last pass ended before the due queue drained; 24 due tasks remain.", nextAction: null },
    holds: { count: 0, items: [] },
    inboundSurfaces: { items: [] },
  };
  const agentRunLog = {
    checkedAt: "2026-06-15T15:48:00.000Z",
    stateDir: "/tmp/exo",
    entries: [
      {
        timestamp: "2026-06-15T15:41:17.286Z",
        startedAt: "2026-06-15T15:26:01.605Z",
        endedAt: "2026-06-15T15:41:17.286Z",
        status: "partial",
        lane: "transport",
        taskKind: "multiple",
        taskKinds: ["send_message"],
        resultCounts: { total: 2, completed: 1, blocked: 1, failed: 0, noop: 0, partial: 0 },
        queueCounts: { dueTaskCount: 24, waitingTaskCount: 27, blockerCount: 0 },
        reason: "LinkedIn spacing keeps this outbound action from firing immediately.",
        sourceArtifact: { kind: "agent.log", path: "/tmp/exo/agent.log" },
      },
    ],
    warnings: [],
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    agentRunLog,
    generatedAt: "2026-06-15T15:48:00.000Z",
  });

  assert.match(html, /Spacing deferred the next send batch; 24 due tasks remained in queue\./i);
  assert.doesNotMatch(html, /LinkedIn spacing keeps this outbound action from firing immediately\./i);
});

test("queue page activity shows waiting result counts for retried inbound identity work", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "partial", endedAt: "2026-06-15T18:02:00.000Z" },
    queueCount: 4,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-15T18:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });
  const agentStatus = {
    state: "partial",
    checkedAt: "2026-06-15T18:05:00.000Z",
    current: { active: false, tasks: [], locks: { active: false, lanes: [] } },
    backlog: {
      dueTaskCount: 4,
      waitingTaskCount: 6,
      blockerCount: 0,
      dueByKind: [],
      waitingByReason: [],
      blockersByReason: [],
    },
    throughput: {
      lastPass: { status: "partial", resultCount: 2, durationSeconds: 120 },
      last24Hours: { resultCount: 2, recentMotionRunCount: 0 },
    },
    partial: { active: true, reason: "The last pass ended before the due queue drained; 4 due tasks remain.", nextAction: null },
    holds: { count: 0, items: [] },
    inboundSurfaces: { items: [] },
  };
  const agentRunLog = {
    checkedAt: "2026-06-15T18:05:00.000Z",
    stateDir: "/tmp/exo",
    entries: [
      {
        timestamp: "2026-06-15T18:02:00.000Z",
        startedAt: "2026-06-15T18:00:00.000Z",
        endedAt: "2026-06-15T18:02:00.000Z",
        status: "partial",
        lane: "transport",
        taskKind: "multiple",
        taskKinds: ["resolve_inbound_identity", "send_message"],
        resultCounts: { total: 2, completed: 1, waiting: 1, blocked: 0, failed: 0, noop: 0, partial: 0 },
        queueCounts: { dueTaskCount: 4, waitingTaskCount: 6, blockerCount: 0 },
        reason: null,
        sourceArtifact: { kind: "agent.log", path: "/tmp/exo/agent.log" },
      },
    ],
    warnings: [],
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    agentRunLog,
    generatedAt: "2026-06-15T18:05:00.000Z",
  });

  assert.match(html, /1 completed · 1 waiting/i);
});

test("queue page activity tab shows current holds and deduped recent failures", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "failed", endedAt: "2026-06-15T15:41:17.286Z" },
    queueCount: 55,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-15T15:48:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "send-1",
          subject: "Tonia Ewing",
          action: "Send connection request",
          why: "Ready to send.",
          dueAt: "2026-06-15T15:41:00.000Z",
          taskKind: "send_message",
          capability: "exo",
          motionName: "harsh-spare-mongoose",
          actionKey: "send_connection_request",
          surface: "connection_request",
        },
      ],
      blockers: [
        {
          reason: "gmail_exact_inbox_required",
          count: 1,
        },
      ],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const agentStatus = {
    state: "blocked",
    checkedAt: "2026-06-15T15:48:00.000Z",
    current: { active: false, tasks: [], locks: { active: false, lanes: [] } },
    backlog: {
      dueTaskCount: 55,
      waitingTaskCount: 5,
      blockerCount: 1,
      dueByKind: [{ kind: "send_message", count: 40 }],
      waitingByReason: [],
      blockersByReason: [{ reason: "gmail_exact_inbox_required", count: 1 }],
    },
    throughput: {
      lastPass: { status: "failed", resultCount: 14, durationSeconds: 900 },
      last24Hours: { resultCount: 14, recentMotionRunCount: 2 },
    },
    partial: { active: false },
    holds: {
      count: 1,
      items: [
        {
          kind: "send_circuit_breaker",
          unavailableUntil: "2026-06-15T16:00:00.000Z",
          reason: "Multiple Gmail inboxes are mapped for william-main. Pick one exact inbox on this motion before email work can run.",
        },
      ],
    },
    inboundSurfaces: { items: [] },
  };

  const agentRunLog = {
    checkedAt: "2026-06-15T15:48:00.000Z",
    stateDir: "/tmp/exo",
    entries: [
      {
        timestamp: "2026-06-15T15:41:17.286Z",
        startedAt: "2026-06-15T15:26:01.605Z",
        endedAt: "2026-06-15T15:41:17.286Z",
        status: "failed",
        lane: "transport",
        taskKind: "run_inbound_sync",
        taskKinds: ["run_inbound_sync"],
        resultCounts: { total: 6, completed: 5, blocked: 0, failed: 1, noop: 0, partial: 0 },
        queueCounts: { dueTaskCount: 56, waitingTaskCount: 5, blockerCount: 0 },
        reason: "Could not apply inbound payload for linkedin:acct-1\nCommand failed: node exo inbound sync\nInbound observation motion motion-1 conflicts with resolved prospect context undefined.",
        sourceArtifact: { kind: "agent.log", path: "/tmp/exo/agent.log" },
      },
      {
        timestamp: "2026-06-15T15:41:17.286Z",
        startedAt: "2026-06-15T15:26:01.605Z",
        endedAt: "2026-06-15T15:41:17.286Z",
        status: "failed",
        lane: "transport",
        taskKind: "run_inbound_sync",
        taskKinds: ["run_inbound_sync"],
        resultCounts: { total: 6, completed: 5, blocked: 0, failed: 1, noop: 0, partial: 0 },
        queueCounts: { dueTaskCount: 56, waitingTaskCount: 5, blockerCount: 0 },
        reason: "Could not apply inbound payload for linkedin:acct-1\nCommand failed: node exo inbound sync\nInbound observation motion motion-1 conflicts with resolved prospect context undefined.",
        sourceArtifact: { kind: "agent-last-pass", path: "/tmp/exo/agent-last-pass.transport.json" },
      },
      {
        timestamp: "2026-06-15T15:41:06.790Z",
        startedAt: "2026-06-15T15:26:01.637Z",
        endedAt: "2026-06-15T15:41:06.790Z",
        status: "partial",
        lane: "research",
        taskKind: "multiple",
        taskKinds: ["prospect_selection", "company_research"],
        resultCounts: { total: 8, completed: 8, blocked: 0, failed: 0, noop: 0, partial: 0 },
        queueCounts: { dueTaskCount: 57, waitingTaskCount: 5, blockerCount: 0 },
        reason: null,
        sourceArtifact: { kind: "agent-last-pass", path: "/tmp/exo/agent-last-pass.research.json" },
      },
    ],
    warnings: [],
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    agentRunLog,
    generatedAt: "2026-06-15T15:48:00.000Z",
  });

  assert.match(html, /data-tab-target="activity"[^>]*>Activity<span class="count-chip tone-neutral">3<\/span>/i);
  assert.match(html, /id="queue-views-panel-activity"[^>]*data-tab-panel="activity" hidden/i);
  assert.match(html, /Current holds/i);
  assert.match(html, /Send work paused/i);
  assert.match(html, /Multiple Gmail inboxes are mapped for william-main/i);
  assert.match(html, /Recent runs/i);
  assert.match(html, /Transport · Run Inbound Sync/i);
  assert.match(html, /Inbound observation motion motion-1 conflicts with resolved prospect context undefined\./i);
  assert.equal(
    (html.match(/Inbound observation motion motion-1 conflicts with resolved prospect context undefined\./gi) ?? []).length,
    1,
  );
});

test("queue page treats a failed last pass as previous work once a new pass is already running", () => {
  const runtime = {
    lock: { active: true, pid: 4242 },
    scheduler: { kind: "launchd", installed: true, loaded: true, running: true, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: {
      status: "failed",
      reason: "Codex task failed: spawnSync /Applications/Codex.app/Contents/Resources/codex ETIMEDOUT",
      endedAt: "2026-06-15T17:00:00.000Z",
    },
    queueCount: 1,
  };

  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-15T18:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "Acme backlog",
          action: "prospect_selection",
          why: "Research is due.",
          dueAt: "2026-06-15T17:55:00.000Z",
          sourceType: "research_packet",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  const agentStatus = {
    checkedAt: "2026-06-15T18:00:00.000Z",
    state: "running",
    current: {
      active: true,
      activeTaskCount: 1,
      tasks: [
        {
          kind: "prospect_selection",
          action: "prospect_selection",
          lane: "research",
          subject: "Acme backlog",
          startedAt: "2026-06-15T17:58:00.000Z",
          elapsedSeconds: 120,
        },
      ],
      locks: { active: true, lanes: [] },
    },
    backlog: {
      dueTaskCount: 1,
      waitingTaskCount: 0,
      blockerCount: 0,
      dueByKind: [{ kind: "prospect_selection", count: 1 }],
      waitingByReason: [],
      blockersByReason: [],
    },
    throughput: {
      lastPass: {
        status: "failed",
        resultCount: 1,
        durationSeconds: 600,
        byKind: [],
      },
      last24Hours: {
        resultCount: 1,
        recentMotionRunCount: 0,
      },
    },
    partial: {
      active: false,
      reason: null,
      nextAction: null,
    },
    inboundSurfaces: {
      count: 0,
      items: [],
    },
    holds: {
      count: 0,
      items: [],
    },
  };

  const agentRunLog = {
    checkedAt: "2026-06-15T18:00:00.000Z",
    stateDir: "/tmp/exo",
    entries: [
      {
        timestamp: "2026-06-15T17:57:00.000Z",
        startedAt: "2026-06-15T17:47:00.000Z",
        endedAt: "2026-06-15T17:57:00.000Z",
        status: "failed",
        lane: "research",
        taskKind: "prospect_selection",
        taskKinds: ["prospect_selection"],
        resultCounts: { total: 1, completed: 0, blocked: 1, failed: 0, noop: 0, partial: 0 },
        queueCounts: { dueTaskCount: 1, waitingTaskCount: 0, blockerCount: 0 },
        reason: "Codex task failed: spawnSync /Applications/Codex.app/Contents/Resources/codex ETIMEDOUT | stderr=OpenAI Codex v0.140.0-alpha.2 -------- user This is one bounded Exo prospect selection packet. Do not inspect the repo.",
        sourceArtifact: { kind: "agent.log", path: "/tmp/exo/agent.log" },
      },
    ],
    warnings: [],
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    agentRunLog,
    generatedAt: "2026-06-15T18:00:00.000Z",
  });

  assert.match(html, /Previous pass failed · 1 result/i);
  assert.match(html, /Previous pass failed/i);
  assert.doesNotMatch(html, /Previous pass:\s*Last pass failed/i);
  assert.match(html, /Codex task timed out before the bounded packet finished\./i);
  assert.doesNotMatch(html, /This is one bounded Exo prospect selection packet/i);
});

test("queue page does not gate sends on degraded LinkedIn quick-pass warnings", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "partial", endedAt: "2026-06-14T00:50:00.000Z" },
    queueCount: 4,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-14T00:53:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "send-1",
          subject: "Brandon Clements",
          action: "send_connection_request",
          why: "Connection request is ready.",
          dueAt: "2026-06-14T00:44:00.000Z",
          sourceType: "cadence",
          taskKind: "send_message",
          capability: "linkedin",
          surface: "connection_request",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });
  const agentStatus = {
    checkedAt: "2026-06-14T00:53:00.000Z",
    state: "partial",
    current: { active: false, activeTaskCount: 0, tasks: [], locks: { active: false, lanes: [] } },
    backlog: {
      dueTaskCount: 4,
      waitingTaskCount: 0,
      blockerCount: 0,
      dueByKind: [
        { kind: "send_message", count: 1 },
      ],
      waitingByReason: [],
      blockersByReason: [],
    },
    throughput: {
      lastPass: { status: "partial", resultCount: 1, durationSeconds: 4, byKind: [] },
      last24Hours: { resultCount: 1, recentMotionRunCount: 3 },
    },
    partial: {
      active: true,
      reason: "No due tasks were available.",
      nextAction: "Continue the agent pass to drain 4 due tasks.",
    },
    inboundSurfaces: {
      count: 2,
      items: [
        {
          capability: "linkedin",
          accountHandle: "williamflanagan",
          surfaceKey: "linkedin-sent-invitations",
          surfaceLabel: "Sent Invitations",
          syncTrustStatus: "degraded",
          lastRunStatus: "warning",
          lastSyncedAt: "2026-06-14T00:30:00.000Z",
          lastObservedAt: "2026-06-14T00:30:00.000Z",
          capturedItemCount: 20,
          visibleTotalCount: null,
          observationCount: 20,
          pageWalkStatus: null,
          resumeCursor: "cursor-1",
          resumeStartOffset: null,
          lastError: "Unipile returned more pending sent invitations than this quick pass itemized.",
        },
        {
          capability: "linkedin",
          accountHandle: "williamflanagan",
          surfaceKey: "linkedin-messaging-inbox",
          surfaceLabel: "Messaging Inbox",
          syncTrustStatus: "degraded",
          lastRunStatus: "warning",
          lastSyncedAt: "2026-06-14T00:31:00.000Z",
          lastObservedAt: "2026-06-14T00:31:00.000Z",
          capturedItemCount: 20,
          visibleTotalCount: null,
          observationCount: 7,
          pageWalkStatus: null,
          resumeCursor: "cursor-2",
          resumeStartOffset: null,
          lastError: "Unipile returned more unread LinkedIn chats than this quick pass itemized.",
        },
      ],
    },
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    generatedAt: "2026-06-14T00:53:00.000Z",
  });

  assert.doesNotMatch(html, /Live sends gated/i);
  assert.doesNotMatch(html, /Live send gated/i);
  assert.doesNotMatch(html, /Gated by sync/i);
  assert.match(html, /Brandon Clements/i);
  assert.match(html, /data-tab-target="queue"[^>]*>Agent queue<span class="count-chip tone-blue">1<\/span>/i);
  assert.doesNotMatch(html, /data-tab-target="waiting"/i);
});

test("queue page does not gate public warmup sends on failed invite sync", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "partial", endedAt: "2026-06-14T00:50:00.000Z" },
    queueCount: 7,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-14T00:53:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "sync-1",
          subject: "LinkedIn sent invitations",
          action: "Run inbound sync",
          why: "Repair stale LinkedIn truth before sending.",
          dueAt: "2026-06-14T00:45:00.000Z",
          sourceType: "inbound_itemization_gap",
          taskKind: "run_inbound_sync",
          capability: "linkedin",
          surfaceKeys: ["linkedin-sent-invitations"],
        },
        {
          id: "send-1",
          subject: "Brandon Clements",
          action: "like_post",
          why: "Public warmup is ready.",
          dueAt: "2026-06-14T00:44:00.000Z",
          sourceType: "cadence",
          taskKind: "send_message",
          capability: "linkedin",
          surface: "like_post",
          via: "public-engagement",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });
  const agentStatus = {
    checkedAt: "2026-06-14T00:53:00.000Z",
    state: "partial",
    current: { active: false, activeTaskCount: 0, tasks: [], locks: { active: false, lanes: [] } },
    backlog: {
      dueTaskCount: 7,
      waitingTaskCount: 0,
      blockerCount: 0,
      dueByKind: [
        { kind: "send_message", count: 1 },
        { kind: "run_inbound_sync", count: 1 },
      ],
      waitingByReason: [],
      blockersByReason: [],
    },
    throughput: {
      lastPass: { status: "partial", resultCount: 1, durationSeconds: 4, byKind: [] },
      last24Hours: { resultCount: 1, recentMotionRunCount: 3 },
    },
    partial: {
      active: true,
      reason: "No due tasks were available.",
      nextAction: "Continue the agent pass to drain 7 due tasks.",
    },
    inboundSurfaces: {
      count: 2,
      items: [
        {
          capability: "linkedin",
          accountHandle: "williamflanagan",
          surfaceKey: "linkedin-sent-invitations",
          surfaceLabel: "Sent Invitations",
          syncTrustStatus: "untrusted",
          lastRunStatus: "failed",
          lastSyncedAt: null,
          lastObservedAt: "2026-06-14T00:30:00.000Z",
          capturedItemCount: 0,
          visibleTotalCount: null,
          observationCount: 0,
          pageWalkStatus: null,
          resumeCursor: null,
          resumeStartOffset: null,
          lastError: "linkedin capture failed.",
        },
        {
          capability: "linkedin",
          accountHandle: "williamflanagan",
          surfaceKey: "linkedin-received-invitations",
          surfaceLabel: "Received Invitations",
          syncTrustStatus: "untrusted",
          lastRunStatus: "failed",
          lastSyncedAt: null,
          lastObservedAt: "2026-06-14T00:31:00.000Z",
          capturedItemCount: 0,
          visibleTotalCount: null,
          observationCount: 0,
          pageWalkStatus: null,
          resumeCursor: null,
          resumeStartOffset: null,
          lastError: "linkedin capture failed.",
        },
      ],
    },
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    generatedAt: "2026-06-14T00:53:00.000Z",
  });

  assert.doesNotMatch(html, /Live sends gated/i);
  assert.doesNotMatch(html, /Live send gated/i);
  assert.doesNotMatch(html, /Gated by sync/i);
  assert.match(html, /Brandon Clements/i);
  assert.match(html, /data-tab-target="queue"[^>]*>Agent queue<span class="count-chip tone-blue">2<\/span>/i);
  assert.doesNotMatch(html, /data-tab-target="waiting"/i);
});

test("queue page shows a prerequisite card when gated sends have no repair task queued", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "partial", endedAt: "2026-06-14T00:50:00.000Z" },
    queueCount: 7,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-14T00:53:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "send-1",
          subject: "Brandon Clements",
          action: "send_connection_request",
          why: "Connection request is ready.",
          dueAt: "2026-06-14T00:44:00.000Z",
          sourceType: "cadence",
          taskKind: "send_message",
          capability: "linkedin",
          surface: "connection_request",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });
  const agentStatus = {
    checkedAt: "2026-06-14T00:53:00.000Z",
    state: "partial",
    current: { active: false, activeTaskCount: 0, tasks: [], locks: { active: false, lanes: [] } },
    backlog: {
      dueTaskCount: 7,
      waitingTaskCount: 0,
      blockerCount: 0,
      dueByKind: [{ kind: "send_message", count: 7 }],
      waitingByReason: [],
      blockersByReason: [],
    },
    throughput: {
      lastPass: { status: "partial", resultCount: 1, durationSeconds: 4, byKind: [] },
      last24Hours: { resultCount: 1, recentMotionRunCount: 3 },
    },
    partial: {
      active: true,
      reason: "No due tasks were available.",
      nextAction: "Continue the agent pass to drain 7 due tasks.",
    },
    inboundSurfaces: {
      count: 1,
      items: [
        {
          capability: "linkedin",
          accountHandle: "williamflanagan",
          surfaceKey: "linkedin-sent-invitations",
          surfaceLabel: "Sent Invitations",
          syncTrustStatus: "untrusted",
          lastRunStatus: "failed",
          lastSyncedAt: null,
          lastObservedAt: "2026-06-14T00:30:00.000Z",
          capturedItemCount: 0,
          visibleTotalCount: null,
          observationCount: 0,
          pageWalkStatus: null,
          resumeCursor: null,
          resumeStartOffset: null,
          lastError: "no_client_session: Capture blocked before identity verification.",
        },
      ],
    },
  };

  const html = renderQueuePage(model, {
    interactive: true,
    agentRuntime: runtime,
    agentStatus,
    generatedAt: "2026-06-14T00:53:00.000Z",
  });

  const queuePanel = html.slice(
    html.indexOf('id="queue-views-panel-queue"'),
    html.indexOf('id="queue-views-panel-waiting"'),
  );
  const waitingPanel = html.slice(
    html.indexOf('id="queue-views-panel-waiting"'),
    html.indexOf('id="queue-views-panel-surfaces"'),
  );
  assert.match(html, /data-tab-target="queue"[^>]*>Agent queue<span class="count-chip tone-blue">1<\/span>/i);
  assert.match(html, /data-tab-target="waiting"[^>]*>Waiting<span class="count-chip tone-amber">1<\/span>/i);
  assert.match(queuePanel, /Repair LinkedIn inbound sync/i);
  assert.match(queuePanel, /Prerequisite/i);
  assert.doesNotMatch(queuePanel, /Brandon Clements/i);
  assert.match(waitingPanel, /Brandon Clements/i);
});

test("operator header marks an overdue loaded scheduler as behind instead of healthy queued", () => {
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
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: {
      status: "completed",
      endedAt: "2026-06-04T10:58:39.906Z",
    },
    cadence: {
      overdue: true,
      overdueBySeconds: 445,
    },
    queueCount: 67,
    blockerCount: 0,
  };

  const html = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(html, /data-agent-health="yellow"/);
  assert.match(html, /Agent is behind/i);
  assert.match(html, /67 queued tasks waiting to run\. No pass is running right now\. The next scheduled pass is already 7m late\./i);
  assert.doesNotMatch(html, /Background agent on/i);
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

test("operator header shows running when launchd is actively draining even without lock metadata", () => {
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
          action: "Prospect research",
          why: "Queued for the agent.",
          dueAt: "2026-06-04T11:00:00.000Z",
          sourceType: "prospect_research_packet",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: true, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: null,
    queueCount: 1,
  };

  const html = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(html, /<span class="agent-pill-state">Running<\/span>/i);
  assert.match(html, /Background agent running/i);
  assert.doesNotMatch(html, /Run agent now/i);
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

test("agent runtime surfaces an active send circuit breaker instead of a green queued state", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-15T15:30:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "Jon Condouret",
          action: "Send Email",
          why: "Queued for the agent.",
          dueAt: "2026-06-15T15:25:00.000Z",
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
    routine: { exists: true, sendMode: "live" },
    hostState: {
      sendCircuitBreaker: {
        consecutiveFailures: 2,
        unavailableUntil: "2099-06-15T17:17:50.670Z",
        reason: "Multiple Gmail inboxes are mapped for william-main. Pick one exact inbox on this motion before email work can run.",
      },
    },
    queueCount: 48,
    blockerCount: 0,
  };

  const operatorHtml = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(operatorHtml, /data-agent-health="yellow"/);
  assert.match(operatorHtml, /Agent is blocked/i);
  assert.match(operatorHtml, /Send work is paused right now\./i);
  assert.match(operatorHtml, /Multiple Gmail inboxes are mapped for william-main/i);
  assert.doesNotMatch(operatorHtml, /Background agent on/i);

  const queueHtml = renderQueuePage(model, { interactive: true, agentRuntime: runtime });
  assert.match(queueHtml, /Agent is blocked/i);
  assert.match(queueHtml, /Send work is paused right now\./i);
  assert.match(queueHtml, /Multiple Gmail inboxes are mapped for william-main/i);
  assert.doesNotMatch(queueHtml, /Background agent on/i);
});

test("agent runtime prefers live browser backoff over a stale failed last-pass transcript", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-05T14:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "Queued cleanup",
          action: "Withdraw Connection",
          why: "Queued for the agent.",
          dueAt: "2026-06-05T14:00:00.000Z",
          sourceType: "cleanup",
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
    lastPass: {
      status: "failed",
      reason: "Codex task failed: Error loading config.toml: invalid transport in `mcp_servers.playwriter`",
      endedAt: "2026-06-05T13:53:50.414Z",
    },
    hostState: {
      browserBackoff: {
        retrieval: { unavailableUntil: null, reason: null },
        execution: {
          unavailableUntil: "2099-06-05T14:13:52.414Z",
          reason: "native Chrome connector is not available in this session",
        },
      },
    },
    queueCount: 1,
    blockerCount: 0,
  };

  const operatorHtml = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(operatorHtml, /Agent is blocked/i);
  assert.match(operatorHtml, /native Chrome connector is not available in this session/i);
  assert.doesNotMatch(operatorHtml, /Agent needs attention/i);
  assert.doesNotMatch(operatorHtml, /mcp_servers\.playwriter/i);
});

test("agent runtime summarizes Codex timeout failures without dumping the bounded task prompt", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    cadence: {
      overdue: true,
      overdueBySeconds: 1073,
    },
    lastPass: {
      status: "failed",
      reason: "Codex task failed: spawnSync /Applications/Codex.app/Contents/Resources/codex ETIMEDOUT | stderr=OpenAI Codex v0.137.0-alpha.4 -------- user This is one bounded Exo connector send task. Do not inspect the repo.",
      endedAt: "2026-06-06T23:52:08.402Z",
    },
    hostState: {
      sendCircuitBreaker: {
        lastTaskLabel: "Saskia Van Der Stel at Savoir Social",
      },
    },
    queueCount: 1,
    blockerCount: 0,
  };

  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T23:59:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "Saskia Van Der Stel",
          action: "Send Direct Message",
          why: "Queued for the agent.",
          dueAt: "2026-06-06T23:41:00.000Z",
          sourceType: "send_ready",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  const html = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(html, /A bounded background Codex task timed out on Saskia Van Der Stel at Savoir Social\./i);
  assert.match(html, /17m behind its every 15m cadence/i);
  assert.doesNotMatch(html, /This is one bounded Exo connector send task/i);
});

test("agent runtime focuses failed status on the real timed out lane instead of a noop lane", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    cadence: {
      overdue: true,
      overdueBySeconds: 734,
    },
    lastPass: {
      status: "failed",
      reason: "research: No due tasks were available. | transport: Command failed: exo next --user user-1 --json\nspawnSync zsh ETIMEDOUT",
      endedAt: "2026-06-12T23:33:08.402Z",
    },
    queueCount: 12,
    blockerCount: 0,
  };

  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-12T23:45:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: {
      items: [
        {
          id: "task-1",
          subject: "Inbound truth",
          action: "run_inbound_sync",
          why: "Refresh stale truth.",
          dueAt: "2026-06-12T23:40:00.000Z",
          sourceType: "inbound_itemization_gap",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  const html = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(html, /The transport lane timed out while asking Exo for the next governed task\./i);
  assert.match(html, /12m behind its every 15m cadence/i);
  assert.doesNotMatch(html, /No due tasks were available/i);
  assert.doesNotMatch(html, /spawnSync zsh ETIMEDOUT/i);
});

test("agent runtime spells out that verify mode only holds unreviewed outbound copy", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: {
      status: "noop",
      reason: "Verify mode had no unverified outbound copy send_message tasks left to prove.",
      endedAt: "2026-06-04T10:17:27.465Z",
    },
    queueCount: 2,
    verificationSendCount: 2,
    blockerCount: 0,
  };

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
          subject: "Ellaine Chrisna Leynes",
          action: "Send Direct Message",
          why: "Queued for the agent.",
          dueAt: "2026-06-04T11:00:00.000Z",
          sourceType: "send_ready",
        },
        {
          id: "task-2",
          subject: "Lina Park",
          action: "Send Email",
          why: "Queued for the agent.",
          dueAt: "2026-06-04T11:01:00.000Z",
          sourceType: "send_ready",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  const operatorHtml = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(operatorHtml, /Unreviewed outbound copy is waiting in review only/i);
  assert.match(operatorHtml, /2 unreviewed copy sends already have fresh proof/i);
  assert.match(operatorHtml, /Review only will not auto-send unreviewed outbound copy\./i);
  assert.match(operatorHtml, /Operator-authored, edited, or approved copy, non-copy actions, and retrieval still run live\./i);
  assert.match(operatorHtml, /Switch the agent out of review only when you want proved unreviewed outbound copy to send automatically\./i);
  assert.match(operatorHtml, />Run review pass</i);
  assert.match(operatorHtml, /Installed: yes/i);
  assert.doesNotMatch(operatorHtml, />Run agent now</i);

  const queueHtml = renderQueuePage(model, { interactive: true, agentRuntime: runtime });
  const introStart = queueHtml.indexOf("<h1>Agent queue</h1>");
  const runtimeBarStart = queueHtml.indexOf('<details class="agent-bar');
  const introHtml = queueHtml.slice(introStart, runtimeBarStart);
  assert.match(queueHtml, /Unreviewed outbound copy is waiting in review only/i);
  assert.match(queueHtml, /2 unreviewed copy sends already have fresh proof/i);
  assert.match(queueHtml, /Review only will not auto-send unreviewed outbound copy\./i);
  assert.match(queueHtml, />Run review pass</i);
  assert.match(queueHtml, /Next action: Switch the agent out of review only when you want proved unreviewed outbound copy to send automatically\./i);
  assert.doesNotMatch(queueHtml, />Run agent now</i);
  assert.match(introHtml, /Run review pass/i);
  assert.match(introHtml, /Review only/i);
  assert.match(introHtml, /Last pass noop/i);
});

test("queue runtime card marks an overdue loaded scheduler as behind", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: {
      status: "completed",
      endedAt: "2026-06-04T10:58:39.906Z",
    },
    cadence: {
      overdue: true,
      overdueBySeconds: 445,
    },
    queueCount: 1,
    blockerCount: 0,
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
    agentRuntime: runtime,
  });

  assert.equal(model.agentRuntime?.headline, "Agent is behind");
  assert.equal(
    model.agentRuntime?.detail,
    "1 queued task waiting to run. No pass is running right now. The next scheduled pass is already 7m late.",
  );
  assert.equal(model.agentRuntime?.runLabel, "Run agent now");
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
  assert.doesNotMatch(html, /<h2>Stale or incomplete<\/h2>/i);
  assert.doesNotMatch(html, /<b>0<\/b> stale/i);
});

test("operator hides empty blocked and stale lanes instead of rendering empty states", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
  });

  const html = renderOperatorPage(model, { interactive: true });
  assert.match(html, /Action queue/i);
  assert.match(html, /Background agent work is separate\./i);
  assert.match(html, /What needs action right now\./i);
  assert.doesNotMatch(html, /<h2>Blocked<\/h2>/i);
  assert.doesNotMatch(html, /<h2>Stale or incomplete<\/h2>/i);
  assert.doesNotMatch(html, /Nothing blocked\./i);
  assert.doesNotMatch(html, /All surfaces fresh\./i);
  assert.doesNotMatch(html, /<b>0<\/b> blocked/i);
  assert.doesNotMatch(html, /<b>0<\/b> stale/i);
});

test("operator stats deep-link into the blocked lane and keep the queue copy compact", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: {
      items: [
        {
          id: "obs-1",
          subject: "Queued Person",
          motionId: "motion-1",
          motionName: "harsh-spare-mongoose",
          recommendedAction: "Reply now.",
          state: "needs_reply",
          observedAt: "2026-06-06T11:00:00.000Z",
          surfaceKey: "messaging_inbox",
        },
      ],
    },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: {
      items: [
        {
          id: "blocked-1",
          subject: "LinkedIn",
          reason: "Capability not ready",
          detail: "LinkedIn needs a trusted account path before governed work can resume.",
          blockType: "capability",
          resolveLabel: "Fix capability",
          channel: "linkedin",
        },
      ],
    },
    truthAccounts: [],
  });

  const html = renderOperatorPage(model, {
    interactive: true,
    activeView: "blocked",
    returnTo: "/operator?view=blocked#blocked",
  });

  assert.match(html, /<b>1<\/b> queued/i);
  assert.doesNotMatch(html, /in operator queue/i);
  assert.match(html, /href="\/operator\?view=blocked#blocked"/);
  assert.match(html, /class="seg-tab is-active"[^>]*id="operator-views-tab-blocked"/);
});

test("operator can isolate work to a single motion and preserve that filtered return path", () => {
  const html = renderOperatorPage({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T11:05:00.000Z",
    regenerateCommand: "exo ui",
    counts: { decisions: 3, queue: 0, blocked: 0, stale: 0, agendaLeft: 0 },
    agentRuntime: null,
    nextMove: {
      title: "Reply to Alpha Person.",
      subject: "Alpha Person",
      prospectId: null,
      personId: "alpha-person",
      avatarUrl: null,
      subtitle: "CEO @ Alpha Co",
      motionId: "motion-alpha",
      motionName: "alpha-motion",
      motionStatus: "active",
      truth: "checked",
      truthAt: "2m ago",
      surface: "messaging inbox",
      action: "Reply now",
      actionMode: "compose",
      actionStatus: "due now",
      actionWriter: null,
      actionArgs: null,
      actionHref: "https://www.linkedin.com/in/alpha-person/",
      why: "Alpha needs a fast reply.",
      previewLabel: null,
      previewSubject: null,
      previewText: null,
      backlogCompanies: null,
      actions: [],
    },
    decisions: [
      {
        id: "beta-1",
        person: "Beta Person",
        prospectId: null,
        personId: "beta-person",
        initials: "BP",
        avatarUrl: null,
        role: "VP Growth",
        company: "Beta Co",
        roleLine: "VP Growth · Beta Co",
        motionId: "motion-beta",
        motionName: "beta-motion",
        stakes: null,
        summary: "Only beta task.",
        truth: "checked",
        truthAt: "3m ago",
        surface: "messaging inbox",
        actionStatus: "due now",
        primaryActionLabel: "Open",
        primaryActionMode: "detail",
        primaryHref: "https://www.linkedin.com/in/beta-person/",
        secondaryActionLabel: "Ignore",
        secondaryHref: null,
        why: null,
        previewLabel: null,
        previewSubject: null,
        previewText: null,
        actions: [],
      },
      {
        id: "alpha-2",
        person: "Alpha Queue",
        prospectId: null,
        personId: "alpha-queue",
        initials: "AQ",
        avatarUrl: null,
        role: "CMO",
        company: "Alpha Co",
        roleLine: "CMO · Alpha Co",
        motionId: "motion-alpha",
        motionName: "alpha-motion",
        stakes: null,
        summary: "Only alpha task.",
        truth: "checked",
        truthAt: "4m ago",
        surface: "received invitations",
        actionStatus: "needs decision",
        primaryActionLabel: "Open",
        primaryActionMode: "detail",
        primaryHref: "https://www.linkedin.com/in/alpha-queue/",
        secondaryActionLabel: "Ignore",
        secondaryHref: null,
        why: null,
        previewLabel: null,
        previewSubject: null,
        previewText: null,
        actions: [],
      },
    ],
    queue: [],
    blocked: [],
    stale: [],
    agenda: [],
  }, {
    interactive: true,
    activeView: "motions",
    selectedMotionId: "motion-beta",
    motionChoices: [
      { id: "motion-alpha", name: "alpha-motion", offerLabel: "Alpha target", offerHost: "alpha.example.com", icpSummary: "Founder-led teams" },
      { id: "motion-beta", name: "beta-motion", offerLabel: "Beta target", offerHost: "beta.example.com", icpSummary: "Revenue teams" },
    ],
    returnTo: "/operator?view=motions&motion=motion-beta#motions",
  });

  assert.match(html, /seg-motion-picker is-active/);
  assert.match(html, /By motion/);
  assert.match(html, /Beta target/);
  assert.match(html, /beta\.example\.com/);
  assert.match(html, /ICP · Revenue teams/);
  assert.match(html, /NEXT MOVE/);
  assert.match(html, /data-tab-panel="motions"[\s\S]*Only beta task\./);
  assert.match(html, /data-tab-panel="motions"[\s\S]*The first queued action is promoted above\./);
  assert.doesNotMatch(html, /data-tab-panel="motions"[\s\S]*Only alpha task\./);
  assert.match(html, /Clear to all motions/);
  assert.match(html, /href="\/operator\?view=motions#motions"/);
  assert.match(html, /href="\/people\/beta-person\?return=%2Foperator%3Fview%3Dmotions%26motion%3Dmotion-beta%23motions"/);
});

test("operator motion tab shows an active-motion dropdown before any filter is chosen", () => {
  const html = renderOperatorPage({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T11:05:00.000Z",
    regenerateCommand: "exo ui",
    counts: { decisions: 2, queue: 0, blocked: 0, stale: 0, agendaLeft: 0 },
    agentRuntime: null,
    nextMove: null,
    decisions: [
      {
        id: "alpha-1",
        person: "Alpha Person",
        prospectId: null,
        personId: "alpha-person",
        initials: "AP",
        avatarUrl: null,
        role: "CEO",
        company: "Alpha Co",
        roleLine: "CEO · Alpha Co",
        motionId: "motion-alpha",
        motionName: "alpha-motion",
        stakes: null,
        summary: "Alpha task.",
        truth: "checked",
        truthAt: "2m ago",
        surface: "messaging inbox",
        actionStatus: "due now",
        primaryActionLabel: "Open",
        primaryActionMode: "detail",
        primaryHref: "https://www.linkedin.com/in/alpha-person/",
        secondaryActionLabel: "Ignore",
        secondaryHref: null,
        why: null,
        previewLabel: null,
        previewSubject: null,
        previewText: null,
        actions: [],
      },
      {
        id: "beta-1",
        person: "Beta Person",
        prospectId: null,
        personId: "beta-person",
        initials: "BP",
        avatarUrl: null,
        role: "VP Growth",
        company: "Beta Co",
        roleLine: "VP Growth · Beta Co",
        motionId: "motion-beta",
        motionName: "beta-motion",
        stakes: null,
        summary: "Beta task.",
        truth: "checked",
        truthAt: "3m ago",
        surface: "messaging inbox",
        actionStatus: "due now",
        primaryActionLabel: "Open",
        primaryActionMode: "detail",
        primaryHref: "https://www.linkedin.com/in/beta-person/",
        secondaryActionLabel: "Ignore",
        secondaryHref: null,
        why: null,
        previewLabel: null,
        previewSubject: null,
        previewText: null,
        actions: [],
      },
    ],
    queue: [],
    blocked: [],
    stale: [],
    agenda: [],
  }, {
    interactive: true,
    activeView: "motions",
    motionChoices: [
      { id: "motion-alpha", name: "alpha-motion", offerLabel: "Alpha target", offerHost: "alpha.example.com", icpSummary: "Founder-led teams" },
      { id: "motion-beta", name: "beta-motion", offerLabel: "Beta target", offerHost: "beta.example.com", icpSummary: "Revenue teams" },
      { id: "motion-empty", name: "empty-motion", offerLabel: "Empty target", offerHost: "empty.example.com", icpSummary: "No current queue" },
    ],
    returnTo: "/operator?view=motions#motions",
  });

  assert.match(html, /All motions/);
  assert.match(html, /Show operator work grouped across every active motion\./);
  assert.doesNotMatch(html, /ICP · Show operator work grouped across every active motion\./);
  assert.match(html, /Alpha target/);
  assert.match(html, /alpha\.example\.com/);
  assert.match(html, /ICP · Founder-led teams/);
  assert.match(html, /Empty target/);
  assert.match(html, /Beta task\./);
  assert.match(html, /Alpha task\./);
  assert.doesNotMatch(html, /Select an active motion to filter operator work\./);
  assert.doesNotMatch(html, /<select class="op-motion-select-input"/);
});

test("operator tab panels explicitly hide inactive views in authored CSS", () => {
  const html = renderOperatorPage({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T11:05:00.000Z",
    regenerateCommand: "exo ui",
    counts: { decisions: 1, queue: 0, blocked: 1, stale: 0, agendaLeft: 0 },
    agentRuntime: null,
    nextMove: null,
    decisions: [
      {
        id: "alpha-1",
        person: "Alpha Person",
        prospectId: null,
        personId: "alpha-person",
        initials: "AP",
        avatarUrl: null,
        role: "CEO",
        company: "Alpha Co",
        roleLine: "CEO · Alpha Co",
        motionId: "motion-alpha",
        motionName: "alpha-motion",
        stakes: null,
        summary: "Alpha task.",
        truth: "checked",
        truthAt: "2m ago",
        surface: "messaging inbox",
        actionStatus: "due now",
        primaryActionLabel: "Open",
        primaryActionMode: "detail",
        primaryHref: "https://www.linkedin.com/in/alpha-person/",
        secondaryActionLabel: "Ignore",
        secondaryHref: null,
        why: null,
        previewLabel: null,
        previewSubject: null,
        previewText: null,
        actions: [],
      },
    ],
    queue: [],
    blocked: [
      {
        id: "blocked-1",
        label: "Prospeo",
        kind: "account",
        blocker: "Needs reconnect",
        summary: "Reconnect account.",
        href: "/connections",
      },
    ],
    stale: [],
    agenda: [],
  }, {
    interactive: true,
    activeView: "motions",
    motionChoices: [{ id: "motion-alpha", name: "alpha-motion" }],
    returnTo: "/operator?view=motions#motions",
  });

  assert.match(html, /\.op-view-panel\[hidden\]\{display:none\}/);
  assert.match(html, /data-tab-panel="queue" hidden/);
  assert.match(html, /data-tab-panel="blocked" hidden/);
  assert.doesNotMatch(html, /data-tab-panel="motions" hidden/);
});

test("operator motion dropdown can resolve queued work by motion name when ids are missing on the cards", () => {
  const html = renderOperatorPage({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-06T11:05:00.000Z",
    regenerateCommand: "exo ui",
    counts: { decisions: 1, queue: 0, blocked: 0, stale: 0, agendaLeft: 0 },
    agentRuntime: null,
    nextMove: null,
    decisions: [
      {
        id: "harsh-1",
        person: "Queue Person",
        prospectId: null,
        personId: "queue-person",
        initials: "QP",
        avatarUrl: null,
        role: "CEO",
        company: "BuyerCo",
        roleLine: "CEO · BuyerCo",
        motionId: null,
        motionName: "harsh-spare-mongoose",
        stakes: null,
        summary: "Motion-filtered work.",
        truth: "checked",
        truthAt: "2m ago",
        surface: "messaging inbox",
        actionStatus: "due now",
        primaryActionLabel: "Open",
        primaryActionMode: "detail",
        primaryHref: "https://www.linkedin.com/in/queue-person/",
        secondaryActionLabel: "Ignore",
        secondaryHref: null,
        why: null,
        previewLabel: null,
        previewSubject: null,
        previewText: null,
        actions: [],
      },
    ],
    queue: [],
    blocked: [],
    stale: [],
    agenda: [],
  }, {
    interactive: true,
    activeView: "motions",
    selectedMotionId: "motion-harsh",
    motionChoices: [
      { id: "motion-harsh", name: "harsh-spare-mongoose", offerLabel: "Harsh target", offerHost: "harsh.example.com", icpSummary: "CEO operators" },
    ],
    returnTo: "/operator?view=motions&motion=motion-harsh#motions",
  });

  assert.match(html, /Harsh target/);
  assert.match(html, /harsh\.example\.com/);
  assert.match(html, /Motion-filtered work\./);
  assert.doesNotMatch(html, /No operator work is queued for this motion right now\./);
});

test("operator merges due-now planner work into the main action queue without duplicating inbound review", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      checklist: [],
    },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    dueNowItems: [
      {
        state: "due_now",
        source: { type: "inbound_review" },
        motion: { id: "motion-inbound", name: "Inbound review" },
        company: { id: "company-inbound", name: "BuyerCo" },
        prospect: { id: "prospect-inbound", name: "Tony Robbins" },
        recommendedAction: "Reply to Tony Robbins and move the branch into an active conversation.",
        dueAt: "2026-06-04T11:05:00.000Z",
      },
      {
        state: "due_now",
        source: { type: "cadence" },
        motion: { id: "17adf3ca-a6b3-4d26-9f93-bc60f28fe94d", name: "harsh-spare-mongoose" },
        company: { id: "82b0baf7-f98d-4bb6-b12c-c913fcb998cf", name: "Columbus McKinnon" },
        prospect: {
          id: "d149a3e4-6988-4ad7-b40b-000e231e1ac9",
          name: "Sue Weinheimer",
          avatarUrl: "https://example.com/sue.jpg",
        },
        recommendedAction: "First-touch decision: LinkedIn connection request is the only verified usable direct channel.",
        dueAt: "2026-06-04T11:06:00.000Z",
      },
    ],
    waitingItems: [],
    truthAccounts: [],
  });

  assert.equal(model.counts.decisions, 1);
  assert.equal(model.nextMove?.subject, "Sue Weinheimer");
  assert.equal(model.nextMove?.avatarUrl, "https://example.com/sue.jpg");
  assert.deepEqual(model.decisions, []);

  const html = renderOperatorPage(model, { interactive: true });
  assert.match(html, /Action queue/i);
  assert.match(html, /First-touch decision: LinkedIn connection request is the only verified usable direct channel\./i);
  assert.match(html, /Sue Weinheimer/i);
  assert.match(html, /Columbus McKinnon/i);
  assert.match(html, /Compose request/i);
  assert.match(html, /https:\/\/example\.com\/sue\.jpg/i);
  assert.match(html, /href="\/prospects\/d149a3e4-6988-4ad7-b40b-000e231e1ac9\?return=%2Foperator"/i);
  assert.match(html, /The first queued action is promoted above\./i);
  assert.doesNotMatch(html, /Reply to Tony Robbins and move the branch into an active conversation/i);
  assert.doesNotMatch(html, /Due now<\/h2>/i);
});

test("operator decision cards fall back to the motion assignment instead of rendering unassigned", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      checklist: [
        {
          action: "Review another branch first.",
          subject: "BuyerCo / Jordan Example",
        },
      ],
      nextMove: "Review another branch first.",
    },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    dueNowItems: [
      {
        state: "due_now",
        source: { type: "cadence" },
        motion: { id: "motion-1", name: "growmance" },
        company: { id: "company-2", name: "BuyerCo" },
        prospect: { id: "prospect-2", name: "Jordan Example" },
        recommendedAction: "Review another branch first.",
        dueAt: "2026-06-04T11:05:00.000Z",
      },
      {
        state: "due_now",
        source: { type: "cadence" },
        motion: { id: "motion-1", name: "growmance" },
        company: { id: "company-1", name: "Sleek Analytics" },
        prospect: { id: "prospect-1", name: "Abbas Aga" },
        recommendedAction: "Ready for first-touch decision via verified LinkedIn profile.",
        dueAt: "2026-06-04T11:06:00.000Z",
      },
    ],
    waitingItems: [],
    truthAccounts: [],
    rawMotions: [
      {
        id: "motion-1",
        engagementUserAssignment: {
          userId: "user-1",
          label: "william-main",
        },
      },
    ],
  });

  const html = renderOperatorPage(model, { interactive: true });
  assert.equal(model.decisions[0]?.motionId, "motion-1");
  assert.equal(model.decisions[0]?.ownerLabel, "william-main");
  assert.match(html, /Abbas Aga/i);
  assert.match(html, /william-main/i);
  assert.doesNotMatch(html, /owner-tag unassigned/i);
});

test("operator suppresses fresh connection-request decisions while public warmup is already queued", () => {
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: {
      checklist: [],
    },
    decisionQueue: { items: [] },
    agentQueue: {
      tasks: [
        {
          kind: "send_message",
          via: "public-engagement",
          prospectId: "d149a3e4-6988-4ad7-b40b-000e231e1ac9",
          surface: "like_post",
        },
      ],
      waiting: [],
      items: [
        {
          id: "send_message::d149a3e4-6988-4ad7-b40b-000e231e1ac9::like_post",
          taskKind: "send_message",
          prospectId: "d149a3e4-6988-4ad7-b40b-000e231e1ac9",
          subject: "Sue Weinheimer",
          action: "Send Like post",
          sourceType: "cadence",
          surface: "like_post",
          dueAt: "2026-06-04T11:05:30.000Z",
        },
      ],
      blockers: [],
    },
    blockedQueue: { items: [] },
    dueNowItems: [
      {
        state: "due_now",
        source: { type: "cadence" },
        motion: { id: "17adf3ca-a6b3-4d26-9f93-bc60f28fe94d", name: "harsh-spare-mongoose" },
        company: { id: "82b0baf7-f98d-4bb6-b12c-c913fcb998cf", name: "Columbus McKinnon" },
        prospect: {
          id: "d149a3e4-6988-4ad7-b40b-000e231e1ac9",
          name: "Sue Weinheimer",
          avatarUrl: "https://example.com/sue.jpg",
        },
        recommendedAction: "First-touch decision: LinkedIn connection request is the only verified usable direct channel.",
        dueAt: "2026-06-04T11:06:00.000Z",
      },
    ],
    waitingItems: [],
    truthAccounts: [],
  });

  assert.equal(model.counts.decisions, 0);
  assert.equal(model.nextMove, null);
  assert.equal(model.queue.length, 1);

  const html = renderOperatorPage(model, { interactive: true });
  assert.match(html, /No operator decision is waiting right now/i);
  assert.doesNotMatch(html, /Compose request/i);
});

test("agent runtime reports a renamed foreign scheduler instead of saying the agent is off", () => {
  const runtime = {
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: false,
      running: false,
      runIntervalSeconds: 900,
      foreignAgents: [
        {
          label: "com.lizb.exo.agent-loop",
          loaded: true,
          running: true,
          pid: 4242,
          referencesStateDir: true,
        },
      ],
    },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "ok", endedAt: "2026-06-04T10:55:00.000Z" },
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "lizb-main", owner: "Liz" },
    generatedAt: "2026-06-04T11:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  assert.equal(model.agentRuntime?.headline, "Background agent running under a non-canonical scheduler");
  assert.equal(model.agentRuntime?.state, "running");
  assert.match(model.agentRuntime?.detail ?? "", /com\.lizb\.exo\.agent-loop/);
  assert.match(model.agentRuntime?.nextAction ?? "", /install-routine/);
  assert.match((model.agentRuntime?.statusFacts ?? []).join("\n"), /Other exo schedulers: com\.lizb\.exo\.agent-loop \(loaded\)/);

  const html = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(html, /non-canonical scheduler/i);
  assert.doesNotMatch(html, /Background agent off/i);
});

test("agent runtime ignores foreign schedulers that belong to another workspace", () => {
  const runtime = {
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: false,
      running: false,
      runIntervalSeconds: 900,
      foreignAgents: [
        {
          label: "com.lizb.exo.agent-loop",
          loaded: true,
          running: true,
          pid: 4242,
          referencesStateDir: false,
        },
      ],
    },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "blocked", endedAt: "2026-06-04T10:17:27.465Z" },
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "lizb-main", owner: "Liz" },
    generatedAt: "2026-06-04T11:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  assert.equal(model.agentRuntime?.headline, "Background agent off");
  assert.doesNotMatch((model.agentRuntime?.statusFacts ?? []).join("\n"), /Other exo schedulers/);
});

test("agent runtime trusts a fresh pass heartbeat when the installed scheduler is unloaded", () => {
  const runtime = {
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: false,
      running: false,
      runIntervalSeconds: 900,
      foreignAgents: [],
    },
    routine: { exists: true, sendMode: "verify" },
    lastPass: { status: "ok", endedAt: "2026-06-04T10:50:00.000Z" },
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "lizb-main", owner: "Liz" },
    generatedAt: "2026-06-04T11:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  assert.equal(model.agentRuntime?.headline, "Agent passes are arriving outside the installed scheduler");
  assert.equal(model.agentRuntime?.state, "on");
  assert.match(model.agentRuntime?.nextAction ?? "", /install-routine/);
});

test("agent runtime calls out launchd TCC exit codes as a permissions block", () => {
  const runtime = {
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: false,
      runIntervalSeconds: 900,
      lastExitCode: "126",
      foreignAgents: [],
    },
    routine: { exists: true, sendMode: "live" },
    lastPass: null,
  };
  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "lizb-main", owner: "Liz" },
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

  assert.equal(model.agentRuntime?.headline, "Background agent blocked by macOS permissions");
  assert.equal(model.agentRuntime?.state, "off");
  assert.match(model.agentRuntime?.detail ?? "", /code 126/);
  assert.match(model.agentRuntime?.detail ?? "", /protected folder/i);
  assert.match(model.agentRuntime?.nextAction ?? "", /install-routine/);
});

test("operator runtime pauses on an active runtime usage limit instead of failing queued work", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "live" },
    checkedAt: "2026-06-04T11:00:00.000Z",
    lastPass: {
      status: "failed",
      reason: "Codex task failed: You're out of Codex messages. Your rate limit resets on 19:12.",
      endedAt: "2026-06-04T10:58:39.906Z",
    },
    hostState: {
      runtimeUsageLimit: {
        detectedAt: "2026-06-04T10:58:39.906Z",
        unavailableUntil: "2026-06-04T19:12:00.000Z",
        reason: "Codex task failed: You're out of Codex messages. Your rate limit resets on 19:12.",
        runtime: "codex",
      },
    },
    queueCount: 9,
    blockerCount: 0,
  };

  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T11:00:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  assert.equal(model.agentRuntime?.state, "paused");
  assert.equal(model.agentRuntime?.headline, "Agent paused: Codex usage limit");
  assert.match(model.agentRuntime?.detail ?? "", /paused instead of failing queued work/i);
  assert.match(model.agentRuntime?.detail ?? "", /resumes automatically/i);
  assert.equal(model.agentRuntime?.canRunNow, false);
  assert.equal(model.agentRuntime?.usageLimit?.unavailableUntil, "2026-06-04T19:12:00.000Z");
  assert.match(model.agentRuntime?.nextAction ?? "", /Nothing to repair/i);

  const operatorHtml = renderOperatorPage(model, { interactive: true, agentRuntime: runtime });
  assert.match(operatorHtml, /Agent paused: Codex usage limit/i);
  assert.match(operatorHtml, /paused instead of failing queued work/i);
  assert.match(operatorHtml, /Resumes (about|when)/i);
  assert.doesNotMatch(operatorHtml, />Run agent now</i);
});

test("operator runtime resumes normally after the usage limit expires", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "live" },
    lastPass: { status: "completed", endedAt: "2026-06-04T20:00:00.000Z" },
    hostState: {
      runtimeUsageLimit: {
        detectedAt: "2026-06-04T10:58:39.906Z",
        unavailableUntil: "2026-06-04T19:12:00.000Z",
        reason: "Codex task failed: You're out of Codex messages.",
        runtime: "codex",
      },
    },
    queueCount: 2,
    blockerCount: 0,
  };

  const model = buildOperatorViewModel({
    user: { id: "user-1", label: "william-main", owner: "William" },
    generatedAt: "2026-06-04T20:05:00.000Z",
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    truthAccounts: [],
    agentRuntime: runtime,
  });

  assert.notEqual(model.agentRuntime?.state, "paused");
  assert.doesNotMatch(model.agentRuntime?.headline ?? "", /usage limit/i);
});
