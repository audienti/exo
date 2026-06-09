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

  const html = renderOperatorPage(model, { interactive: true });
  assert.match(html, /https:\/\/example\.com\/sue\.jpg/i);
  assert.match(html, /<img class="avatar" src="https:\/\/example\.com\/sue\.jpg"/i);
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

  const html = renderOperatorPage(model, { interactive: true });
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

  const html = renderOperatorPage(model, { interactive: true });
  assert.match(html, /href="\/prospects\/prospect-peter\?return=%2Foperator#compose-prospect-peter"/);
  assert.doesNotMatch(html, /Review draft.*disabled/);
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
  assert.match(html, /href="\/people\/obs-1\?return=%2Foperator#compose-obs-1"/);
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
      actionArgs: { observationId: "obs-rizwan", nextKind: "connection_request_accepted" },
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
          args: { observationId: "obs-rizwan", nextKind: "connection_request_accepted" },
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
            args: { observationId: "obs-rizwan-2", nextKind: "connection_request_accepted" },
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
  assert.match(html, /nextKind&quot;:&quot;connection_request_accepted&quot;/);
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
  const introStart = html.indexOf("<h1>Agent queue</h1>");
  const runtimeCardStart = html.indexOf("next-move agent-runtime");
  const introHtml = html.slice(introStart, runtimeCardStart);
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

test("agent runtime spells out that verify mode will not send already-proved drafts", () => {
  const runtime = {
    scheduler: { kind: "launchd", installed: true, loaded: true, running: false, runIntervalSeconds: 900 },
    routine: { exists: true, sendMode: "verify" },
    lastPass: {
      status: "noop",
      reason: "Verify mode had no unverified send_message tasks left to prove.",
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
  assert.match(operatorHtml, /Approved drafts are waiting in review only/i);
  assert.match(operatorHtml, /2 queued agent-authored sends already have fresh proof/i);
  assert.match(operatorHtml, /Review only will not send them\./i);
  assert.match(operatorHtml, /Switch the agent out of review only when you want the next pass to send approved drafts\./i);
  assert.match(operatorHtml, />Run review pass</i);
  assert.match(operatorHtml, /Installed: yes/i);
  assert.doesNotMatch(operatorHtml, />Run agent now</i);

  const queueHtml = renderQueuePage(model, { interactive: true, agentRuntime: runtime });
  const introStart = queueHtml.indexOf("<h1>Agent queue</h1>");
  const runtimeCardStart = queueHtml.indexOf("next-move agent-runtime");
  const introHtml = queueHtml.slice(introStart, runtimeCardStart);
  assert.match(queueHtml, /Approved drafts are waiting in review only/i);
  assert.match(queueHtml, /2 queued agent-authored sends already have fresh proof/i);
  assert.match(queueHtml, /Review only will not send them\./i);
  assert.match(queueHtml, />Run review pass</i);
  assert.match(queueHtml, /Next action: Switch the agent out of review only when you want the next pass to send approved drafts\./i);
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
  assert.match(html, /What needs action right now\./i);
  assert.doesNotMatch(html, /<h2>Blocked<\/h2>/i);
  assert.doesNotMatch(html, /<h2>Stale or incomplete<\/h2>/i);
  assert.doesNotMatch(html, /Nothing blocked\./i);
  assert.doesNotMatch(html, /All surfaces fresh\./i);
  assert.doesNotMatch(html, /<b>0<\/b> blocked/i);
  assert.doesNotMatch(html, /<b>0<\/b> stale/i);
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
