// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { renderOperatorPage } from "../src/artifacts/render-operator.js";
import { buildDailyView } from "../src/core/build-daily-view.js";
import { buildOperatorViewModel } from "../src/core/build-operator-view.js";

const now = "2026-06-12T10:59:10.611Z";

const rawUser = {
  id: "user-1",
  createdAt: "2026-06-12T10:00:00.000Z",
  updatedAt: "2026-06-12T10:00:00.000Z",
  label: "william-main",
  owner: "operator",
};

function rawCompany() {
  return {
    id: "company-1",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    name: "DNOW",
    domain: "dnow.com",
    websiteUrl: "https://www.dnow.com/",
    linkedinCompanyUrl: "https://www.linkedin.com/company/dnowinc",
    logoSourceUrl: null,
    logoUrl: null,
    notes: null,
    tags: [],
    motionIds: ["motion-1"],
    engagementProfileAssignment: null,
    engagementUserAssignment: {
      userId: "user-1",
      label: "william-main",
      owner: "operator",
      accountRefs: [],
      assignedAt: "2026-06-12T10:00:00.000Z",
      assignedBy: "operator",
      reason: "Use one operator consistently for this company.",
      sticky: true,
    },
  };
}

function rawMotion() {
  return {
    id: "motion-1",
    version: 1,
    name: "harsh-spare-mongoose",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    status: "active",
    offer: {
      sourceUrl: "https://www.dnow.com/",
      offerNotes: null,
    },
    premise: {
      statement: "This matters when post-merger IT work creates vendor rationalization pressure.",
      notes: null,
      source: "operator",
      status: "defined",
    },
    targetingProfile: {
      geolocations: [],
      icpTypes: [],
      industries: [],
      companyTypes: [],
      companyShapes: [],
      companySizes: [],
      targetTitles: [],
      roleFamilies: [],
      segmentVariants: [],
      stakeholderTargetCount: 3,
    },
    suppressionPolicy: {
      excludedAccounts: [],
      excludedDomains: [],
      excludedContacts: [],
      doNotContactEntries: [],
      doNotContactSources: [],
      crmCustomerSuppressionEnabled: false,
      crmOpportunitySuppressionEnabled: false,
    },
    offerThesis: {
      sourceUrl: "https://www.dnow.com/",
      sourceTitle: "DNOW",
      sourceDescription: "DNOW offer",
      sourceSummary: "DNOW offer",
      offerNotes: null,
      problemThesis: null,
      buyerImpactThesis: null,
      likelyTriggerThesis: null,
      likelyRoleThesis: null,
      likelySegmentThesis: null,
      status: "seeded",
    },
    audienceHypotheses: [],
    signals: [],
    targetMap: {
      status: "ready",
      segments: [],
      accounts: [
        {
          companyId: "company-1",
          companyName: "DNOW",
          domain: "dnow.com",
          websiteUrl: "https://www.dnow.com/",
          linkedinCompanyUrl: "https://www.linkedin.com/company/dnowinc",
          companyLogoSourceUrl: null,
          companyLogoUrl: null,
          signalMatches: [],
          prospects: [
            {
              id: "prospect-1",
              name: "Kelly Munson",
              title: "Chief Administrative and Information Officer",
              linkedinProfileUrl: "https://www.linkedin.com/in/kelly-munson-02aa423b",
              avatarSourceUrl: null,
              avatarUrl: null,
              email: null,
              buyingCommitteeRole: "executive_sponsor",
              decisionAuthority: "influences",
              fitConfidence: "unknown",
              whyRelevant: "Owns IT and cybersecurity through active merger integration work.",
              sourceUrl: "https://www.linkedin.com/in/kelly-munson-02aa423b",
              observedAt: "2026-06-11T18:36:00.000Z",
              profileViewedAt: "2026-06-11T18:34:00.000Z",
              roleTruth: {},
              triggerWindow: {},
              identityTells: {},
              linkedinProfileSnapshot: {},
              liveSignal: {},
              publicEngagementSelection: null,
              contactPoints: [],
              contactEnrichmentState: {},
              queueState: {
                status: "ready",
                source: "derived",
                updatedAt: "2026-06-11T18:24:04.496Z",
                notes: null,
                crossMotionOwner: null,
              },
              disposition: "active",
              packetStatus: null,
              packetState: null,
              notes: null,
              signalMatchIds: [],
              touches: [],
              cadenceState: {
                status: "ready",
                currentStep: "connection-request",
                lastTouchChannel: null,
                lastTouchOutcome: null,
                lastTouchAt: null,
                nextAction: "Decide first touch using LinkedIn connection request anchored on MRC integration, ERP remediation, and CAIO ownership of IT/cybersecurity.",
                nextActionDueAt: "2026-06-11T19:00:00.000Z",
                blockedChannels: [],
                requireNewHook: false,
                notes: null,
                updatedAt: "2026-06-11T18:24:04.496Z",
              },
              drafts: [
                {
                  id: "draft-1",
                  surface: "connection_request",
                  channel: "linkedin",
                  subject: null,
                  body: "Kelly, thought it would be good to connect.",
                  status: "approved",
                  authoredBy: "operator",
                  editedByOperator: false,
                  approvedByOperator: true,
                  createdAt: "2026-06-11T19:16:20.543Z",
                  updatedAt: "2026-06-12T10:58:04.785Z",
                  approvedAt: "2026-06-12T10:58:04.785Z",
                  sentAt: null,
                  notes: null,
                },
              ],
              timelineNotes: [],
            },
          ],
          queueState: {
            status: "ready",
            source: "derived",
            updatedAt: "2026-06-11T18:24:04.496Z",
            notes: null,
            crossMotionOwner: null,
          },
          disposition: "active",
          packetStatus: null,
          packetState: null,
          lastResearchAt: "2026-06-11T18:24:04.496Z",
          notes: null,
        },
      ],
    },
    stakeholderMap: {
      status: "pending",
      stakeholders: [],
    },
    motionPlan: {
      status: "pending",
      variants: [],
    },
    nextSteps: [],
    packetReviewPolicy: "auto",
    engagementProfileAssignment: null,
    engagementUserAssignment: {
      userId: "user-1",
      label: "william-main",
      owner: "operator",
      accountRefs: [],
      assignedAt: "2026-06-12T10:00:00.000Z",
      assignedBy: "operator",
      reason: "Use one operator consistently for this motion.",
      sticky: true,
    },
  };
}

test("approved outbound first-touch drafts leave the operator decision lane", () => {
  const daily = buildDailyView(rawUser, [rawMotion()], [rawCompany()], [], [], { now });

  assert.equal(
    daily.items.some((item) => item.prospect?.name === "Kelly Munson"),
    false,
    "expected approved queued send work to stay out of operator due-now decisions",
  );

  const model = buildOperatorViewModel({
    user: { id: rawUser.id, label: rawUser.label, owner: rawUser.owner },
    generatedAt: now,
    regenerateCommand: "exo ui",
    operatorSummary: { checklist: [] },
    decisionQueue: { items: [] },
    agentQueue: { items: [], blockers: [] },
    blockedQueue: { items: [] },
    dueNowItems: daily.items,
    waitingItems: [],
    truthAccounts: [],
  });

  const html = renderOperatorPage(model, { interactive: true });
  assert.doesNotMatch(html, /Kelly Munson/);
  assert.doesNotMatch(html, /Thought it would be good to connect/);
});

test("buildDailyView reuses precomputed inbound review items when provided", () => {
  const daily = buildDailyView(rawUser, [rawMotion()], [rawCompany()], [], [], {
    now,
    inbox: {
      user: { id: rawUser.id, label: rawUser.label, owner: rawUser.owner },
      surfaces: { accounts: [] },
      items: [],
    },
    inboundReview: {
      user: { id: rawUser.id, label: rawUser.label, owner: rawUser.owner },
      surfaces: { accounts: [] },
      itemizationGaps: [],
      reviewItems: [
        {
          id: "obs-1",
          state: "needs_reply",
          kind: "linkedin_dm",
          observedAt: now,
          motion: { id: "motion-1", name: "harsh-spare-mongoose" },
          company: { id: "company-1", name: "DNOW" },
          prospect: {
            id: "prospect-1",
            name: "Kelly Munson",
            title: "Chief Administrative and Information Officer",
          },
          account: { id: "account-1", capability: "linkedin" },
          actorName: "Kelly Munson",
          whyItMatters: "A live inbound reply is waiting on the operator.",
          recommendedAction: "Reply to Kelly Munson now.",
          decisionOptions: [],
        },
      ],
    },
  });

  assert.equal(
    daily.items.some((item) => item.source?.type === "inbound_review" && item.prospect?.id === "prospect-1"),
    true,
  );
});

test("observed pending invites suppress stale first-touch cadence and outbound-capacity send pressure", () => {
  const user = {
    ...rawUser,
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-12T10:00:00.000Z",
        updatedAt: "2026-06-12T10:00:00.000Z",
        capability: "linkedin",
        handle: "william-main",
        label: "William Main",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-unipile-1",
        providerAccountId: "provider-linkedin-1",
        preferred: true,
        notes: null,
        inboundSync: { surfaces: [] },
      },
    ],
    harnessConnections: [
      {
        id: "harness-unipile-1",
        createdAt: "2026-06-12T10:00:00.000Z",
        updatedAt: "2026-06-12T10:00:00.000Z",
        runtime: "codex",
        connector: "unipile",
        label: null,
        status: "available",
        notes: null,
      },
    ],
  };
  const observations = [
    {
      id: "obs-pending",
      dedupeKey: "obs-pending",
      userId: "user-1",
      accountId: "account-1",
      capability: "linkedin",
      platform: "linkedin",
      surfaceKey: "linkedin-sent-invitations",
      kind: "connection_request_pending",
      truthLevel: "authoritative",
      observedAt: "2026-06-11T18:20:00.000Z",
      recordedAt: "2026-06-11T18:20:00.000Z",
      eventAt: "2026-06-11T18:18:00.000Z",
      externalId: "pending-1",
      actorName: "Kelly Munson",
      actorTitle: "Chief Administrative and Information Officer",
      actorCompanyName: "DNOW",
      actorHandle: "kelly-munson-02aa423b",
      actorProfileUrl: "https://www.linkedin.com/in/kelly-munson-02aa423b",
      actorLinkedinPublicId: "kelly-munson-02aa423b",
      actorLinkedinMemberId: "member-kelly",
      actorAvatarSourceUrl: null,
      actorAvatarUrl: null,
      threadUrl: null,
      sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
      subject: null,
      summary: "Kelly Munson is still pending on LinkedIn.",
      motionId: "motion-1",
      companyId: "company-1",
      prospectId: "prospect-1",
      notes: null,
      messages: [],
    },
    {
      id: "obs-attention",
      dedupeKey: "obs-attention",
      userId: "user-1",
      accountId: "account-1",
      capability: "linkedin",
      platform: "linkedin",
      surfaceKey: "linkedin-profile-views",
      kind: "profile_view_after_touch",
      truthLevel: "authoritative",
      observedAt: "2026-06-11T18:30:00.000Z",
      recordedAt: "2026-06-11T18:30:00.000Z",
      eventAt: "2026-06-11T18:29:00.000Z",
      externalId: "view-1",
      actorName: "Kelly Munson",
      actorTitle: "Chief Administrative and Information Officer",
      actorCompanyName: "DNOW",
      actorHandle: "kelly-munson-02aa423b",
      actorProfileUrl: "https://www.linkedin.com/in/kelly-munson-02aa423b",
      actorLinkedinPublicId: "kelly-munson-02aa423b",
      actorLinkedinMemberId: "member-kelly",
      actorAvatarSourceUrl: null,
      actorAvatarUrl: null,
      threadUrl: null,
      sourceUrl: "https://www.linkedin.com/analytics/profile-views/",
      subject: null,
      summary: "Kelly Munson viewed our profile after the connection request.",
      motionId: "motion-1",
      companyId: "company-1",
      prospectId: "prospect-1",
      notes: null,
      messages: [],
    },
  ];

  const daily = buildDailyView(user, [rawMotion()], [rawCompany()], [], observations, { now });

  assert.equal(
    daily.items.some((item) => item.prospect?.id === "prospect-1" && item.state === "due_now"),
    false,
    "expected stale first-touch cadence to stay out of the due-now lane once pending-invite evidence exists",
  );
  assert.equal(daily.capacity.linkedin.execution.readyConnectionRequests, 0);
  assert.equal(daily.capacity.linkedin.execution.trackedPendingInvitations, 1);
});
