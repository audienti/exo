// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildDailyView } from "../src/core/build-daily-view.js";
import { buildInboxView } from "../src/core/build-inbox-view.js";
import { buildInboundReviewView } from "../src/core/build-inbound-review-view.js";
import { buildOperatorPromptFromInboxItem } from "../src/lib/operator-prompts.js";

const rawUser = {
  id: "user-1",
  createdAt: "2026-06-04T16:00:00.000Z",
  updatedAt: "2026-06-04T16:00:00.000Z",
  label: "william-main",
};

function rawObservation(overrides = {}) {
  return {
    id: "obs-1",
    dedupeKey: "obs-1",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    platform: "linkedin",
    surfaceKey: "linkedin-messaging-inbox",
    kind: "inbound_reply_received",
    truthLevel: "authoritative",
    observedAt: "2026-06-04T16:20:00.000Z",
    recordedAt: "2026-06-04T16:20:00.000Z",
    eventAt: null,
    externalId: "thread-1",
    actorName: "Zoe Jupp",
    actorTitle: "Head of Strategic Partnerships @ Nassau Street Partners",
    actorCompanyName: null,
    actorHandle: "zoe-jupp",
    actorProfileUrl: "https://www.linkedin.com/in/zoe-jupp/",
    actorLinkedinPublicId: "zoe-jupp",
    actorLinkedinMemberId: "member-zoe",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: "https://www.linkedin.com/messaging/thread/example/",
    sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
    subject: "Strategic partnership fit",
    summary: "Zoe Jupp has unread LinkedIn message activity.",
    motionId: null,
    companyId: null,
    prospectId: null,
    notes: "LinkedIn thread subject: Strategic partnership fit",
    messages: [
      {
        id: "msg-1",
        direction: "inbound",
        sentAt: "2026-06-04T16:18:00.000Z",
        fromName: "Zoe Jupp",
        fromHandle: null,
        body: "Would be good to compare notes on partnerships.",
      },
    ],
    ...overrides,
  };
}

function claimedPrivateInboundFixture({ observationOverrides = {}, prospectOverrides = {} } = {}) {
  const observation = rawObservation({
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    ...observationOverrides,
  });

  const prospect = {
    id: "prospect-1",
    name: "Zoe Jupp",
    title: "Head of Strategic Partnerships @ Nassau Street Partners",
    linkedinProfileUrl: "https://www.linkedin.com/in/zoe-jupp/",
    avatarSourceUrl: null,
    avatarUrl: null,
    email: null,
    buyingCommitteeRole: "other",
    decisionAuthority: "unknown",
    fitConfidence: "moderate",
    whyRelevant: "Transitioned from messaging inbox.",
    sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
    observedAt: "2026-06-04T16:20:00.000Z",
    profileViewedAt: null,
    roleTruth: {
      currentRoleDescription: null,
      summary: null,
      operatingMode: null,
      scope: null,
      evidence: [],
    },
    triggerWindow: {
      summary: null,
      tenureMonths: null,
      tenureBand: null,
      whyNowAnchor: null,
      personTriggers: [],
      companyTriggers: [],
    },
    identityTells: {
      summary: null,
      headline: null,
      aboutQuotes: [],
      frameworks: [],
      certifications: [],
      quantifiedReceipts: [],
      selfImageVerbs: [],
      metaphors: [],
    },
    linkedinProfileSnapshot: {
      capturedAt: null,
      profileUrl: null,
      publicId: null,
      memberId: null,
      displayName: null,
      currentRoleTitle: null,
      currentCompanyName: null,
      headline: null,
      location: null,
      about: null,
      followerCount: null,
      connectionCount: null,
      isPremium: null,
      isOpenProfile: null,
      connectionDegree: null,
      recentPosts: [],
    },
    liveSignal: {
      channel: null,
      activityType: null,
      summary: null,
      url: null,
      observedAt: null,
      freshnessBand: null,
      hookStrength: null,
      engagementRationale: null,
    },
    contactPoints: [],
    contactEnrichmentState: {
      status: "pending",
      sourcesTried: [],
      missingChannels: [],
      bestDirectChannels: [],
      lastEnrichedAt: null,
      notes: null,
    },
    queueState: {
      status: "ready",
      source: "derived",
      updatedAt: "2026-06-04T16:20:00.000Z",
      notes: null,
    },
    packetState: null,
    notes: null,
    signalMatchIds: [],
    touches: [
      {
        id: "touch-1",
        surface: "inbound_reply",
        direction: "inbound",
        outcome: "replied",
        occurredAt: "2026-06-04T16:20:00.000Z",
        summary: "Zoe Jupp has unread LinkedIn message activity.",
        subject: null,
        body: "Would be good to compare notes on partnerships.",
        sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
        notes: null,
      },
    ],
    cadenceState: {
      status: "ready",
      currentStep: "direct-message",
      lastTouchChannel: "direct-message",
      lastTouchOutcome: "replied",
      lastTouchAt: "2026-06-04T16:20:00.000Z",
      nextAction: "Live reply — continue the conversation.",
      nextActionDueAt: null,
      blockedChannels: [],
      requireNewHook: false,
      notes: null,
      updatedAt: "2026-06-04T16:20:00.000Z",
    },
    drafts: [],
    timelineNotes: [],
    ...prospectOverrides,
  };

  const rawMotions = [
    {
      id: "motion-1",
      name: "transition-inbound-backlog",
      createdAt: "2026-06-04T16:00:00.000Z",
      updatedAt: "2026-06-04T16:00:00.000Z",
      status: "active",
      offer: {
        sourceUrl: "https://transition.exo.local/inbound-backlog",
        offerNotes: null,
      },
      premise: {
        statement: "Carry transition backlog safely.",
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
        sourceUrl: "https://transition.exo.local/inbound-backlog",
        sourceTitle: null,
        sourceDescription: null,
        sourceSummary: "Carry transition backlog safely.",
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
            companyName: "Unknown company",
            domain: null,
            websiteUrl: null,
            linkedinCompanyUrl: null,
            companyLogoSourceUrl: null,
            companyLogoUrl: null,
            signalMatches: [],
            queueState: {
              status: "selected",
              source: "manual",
              updatedAt: "2026-06-04T16:00:00.000Z",
              notes: null,
            },
            packetState: null,
            lastResearchAt: null,
            notes: null,
            prospects: [prospect],
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
      engagementProfileAssignment: null,
      engagementUserAssignment: null,
    },
  ];

  const rawCompanies = [
    {
      id: "company-1",
      createdAt: "2026-06-04T16:00:00.000Z",
      updatedAt: "2026-06-04T16:00:00.000Z",
      name: "Unknown company",
      domain: null,
      websiteUrl: null,
      linkedinCompanyUrl: null,
      logoSourceUrl: null,
      logoUrl: null,
      notes: null,
      tags: [],
      motionIds: ["motion-1"],
      engagementProfileAssignment: null,
      engagementUserAssignment: null,
    },
  ];

  return { observation, rawMotions, rawCompanies };
}

test("unclaimed cold inbound private messages stay in global intake until they are claimed", () => {
  const observation = rawObservation();
  const inbox = buildInboxView(rawUser, [observation], [], []);
  const review = buildInboundReviewView(rawUser, [observation], [], []);

  const item = inbox.items[0];
  assert.equal(item.status, "global-intake");
  assert.equal(item.reviewState, "needs_claim");
  assert.match(item.recommendedAction, /claim zoe jupp/i);
  assert.equal(buildOperatorPromptFromInboxItem(item), null);

  const reviewItem = review.reviewItems[0];
  assert.equal(reviewItem.state, "needs_claim");
  assert.match(reviewItem.recommendedAction, /claim zoe jupp/i);
  assert.equal(reviewItem.previewLabel, "Latest message");
  assert.equal(reviewItem.previewSubject, "Strategic partnership fit");
  assert.equal(reviewItem.previewText, "Would be good to compare notes on partnerships.");
});

test("unclaimed private messages with prior outbound history still require claim before reply handling", () => {
  const observation = rawObservation({
    id: "obs-2",
    dedupeKey: "obs-2",
    kind: "email_reply_received",
    capability: "gmail",
    platform: "gmail",
    surfaceKey: "gmail-inbox-threads",
    actorName: "Lina Park",
    actorHandle: "lpark@govpointeoffice.us",
    threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-2",
    sourceUrl: "https://mail.google.com/mail/u/0/#inbox/thread-2",
    messages: [
      {
        id: "msg-1",
        direction: "outbound",
        sentAt: "2026-06-04T15:55:00.000Z",
        fromName: "William Flanagan",
        fromHandle: "william@example.com",
        body: "Could you send over the current RFP details?",
      },
      {
        id: "msg-2",
        direction: "inbound",
        sentAt: "2026-06-04T16:18:00.000Z",
        fromName: "Lina Park",
        fromHandle: "lpark@govpointeoffice.us",
        body: "Attached.",
      },
    ],
  });
  const inbox = buildInboxView(rawUser, [observation], [], []);
  const review = buildInboundReviewView(rawUser, [observation], [], []);
  const item = inbox.items[0];
  const reviewItem = review.reviewItems[0];

  assert.equal(item.status, "global-intake");
  assert.equal(item.reviewState, "needs_claim");
  assert.match(item.recommendedAction, /claim lina park/i);
  assert.equal(buildOperatorPromptFromInboxItem(item), null);
  assert.equal(reviewItem.state, "needs_claim");
  assert.match(reviewItem.recommendedAction, /claim lina park/i);
  assert.equal(reviewItem.previewLabel, "Latest message");
  assert.equal(reviewItem.previewText, "Attached.");
});

test("received invitation notes become operator preview content", () => {
  const note = "Would love to connect about public-sector procurement workflows.";
  const observation = rawObservation({
    id: "obs-3",
    dedupeKey: "obs-3",
    kind: "connection_request_received",
    surfaceKey: "linkedin-received-invitations",
    subject: null,
    summary: "Zoe Jupp sent a new inbound LinkedIn connection request.",
    notes: note,
    messages: [],
  });
  const review = buildInboundReviewView(rawUser, [observation], [], []);
  const reviewItem = review.reviewItems[0];

  assert.equal(reviewItem.previewLabel, "Invitation note");
  assert.equal(reviewItem.previewText, note);
});

test("claimed private inbound without a draft stays in the agent lane", () => {
  const { observation, rawMotions, rawCompanies } = claimedPrivateInboundFixture();
  const inbox = buildInboxView(rawUser, [observation], rawMotions, rawCompanies);
  const review = buildInboundReviewView(rawUser, [observation], rawMotions, rawCompanies);
  const daily = buildDailyView(rawUser, rawMotions, rawCompanies, [], [observation], { now: "2026-06-04T17:00:00.000Z" });

  const item = inbox.items[0];
  assert.equal(item.status, "agent-draft");
  assert.equal(item.reviewState, "agent_draft_due");
  assert.match(item.recommendedAction, /draft the response/i);
  assert.equal(buildOperatorPromptFromInboxItem(item), null);

  const reviewItem = review.reviewItems[0];
  assert.equal(reviewItem.state, "agent_draft_due");
  assert.match(reviewItem.recommendedAction, /draft the response/i);

  assert.equal(daily.items.some((entry) => entry.prospect?.id === "prospect-1"), false);
});

test("claimed private inbound with a ready draft returns to operator review", () => {
  const { observation, rawMotions, rawCompanies } = claimedPrivateInboundFixture({
    prospectOverrides: {
      drafts: [
        {
          id: "draft-1",
          surface: "inbound_reply",
          channel: "linkedin",
          subject: null,
          body: "Drafted reply body.",
          status: "ready",
          authoredBy: "agent",
          editedByOperator: false,
          createdAt: "2026-06-04T16:21:00.000Z",
          updatedAt: "2026-06-04T16:21:00.000Z",
          approvedAt: null,
          sentAt: null,
          notes: null,
        },
      ],
    },
  });
  const inbox = buildInboxView(rawUser, [observation], rawMotions, rawCompanies);
  const review = buildInboundReviewView(rawUser, [observation], rawMotions, rawCompanies);
  const daily = buildDailyView(rawUser, rawMotions, rawCompanies, [], [observation], { now: "2026-06-04T17:00:00.000Z" });

  const item = inbox.items[0];
  assert.equal(item.status, "needs-triage");
  assert.equal(item.reviewState, "ready_for_reply");
  assert.match(item.recommendedAction, /review the drafted response/i);
  assert.match(buildOperatorPromptFromInboxItem(item) ?? "", /review the drafted reply/i);

  const reviewItem = review.reviewItems[0];
  assert.equal(reviewItem.state, "ready_for_reply");
  assert.equal(reviewItem.previewLabel, "Draft message");
  assert.equal(reviewItem.previewText, "Drafted reply body.");

  const dailyItem = daily.items.find((entry) => entry.prospect?.id === "prospect-1");
  assert.ok(dailyItem);
  assert.equal(dailyItem.priority, "reply");
  assert.match(dailyItem.recommendedAction, /review the drafted response/i);
});

test("queued private replies are treated as already handled", () => {
  const observation = rawObservation({
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
  });
  const rawMotions = [
    {
      id: "motion-1",
      name: "transition-inbound-backlog",
      createdAt: "2026-06-04T16:00:00.000Z",
      updatedAt: "2026-06-04T16:00:00.000Z",
      status: "active",
      offer: {
        sourceUrl: "https://transition.exo.local/inbound-backlog",
        offerNotes: null,
      },
      premise: {
        statement: "Carry transition backlog safely.",
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
        sourceUrl: "https://transition.exo.local/inbound-backlog",
        sourceTitle: null,
        sourceDescription: null,
        sourceSummary: "Carry transition backlog safely.",
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
            companyName: "Unknown company",
            domain: null,
            websiteUrl: null,
            linkedinCompanyUrl: null,
            companyLogoSourceUrl: null,
            companyLogoUrl: null,
            signalMatches: [],
            queueState: {
              status: "selected",
              source: "manual",
              updatedAt: "2026-06-04T16:00:00.000Z",
              notes: null,
            },
            packetState: null,
            lastResearchAt: null,
            notes: null,
            prospects: [
              {
                id: "prospect-1",
                name: "Zoe Jupp",
                title: "Head of Strategic Partnerships @ Nassau Street Partners",
                linkedinProfileUrl: "https://www.linkedin.com/in/zoe-jupp/",
                avatarSourceUrl: null,
                avatarUrl: null,
                email: null,
                buyingCommitteeRole: "other",
                decisionAuthority: "unknown",
                fitConfidence: "moderate",
                whyRelevant: "Transitioned from messaging inbox.",
                sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
                observedAt: "2026-06-04T16:20:00.000Z",
                profileViewedAt: null,
                roleTruth: {
                  currentRoleDescription: null,
                  summary: null,
                  operatingMode: null,
                  scope: null,
                  evidence: [],
                },
                triggerWindow: {
                  summary: null,
                  tenureMonths: null,
                  tenureBand: null,
                  whyNowAnchor: null,
                  personTriggers: [],
                  companyTriggers: [],
                },
                identityTells: {
                  summary: null,
                  headline: null,
                  aboutQuotes: [],
                  frameworks: [],
                  certifications: [],
                  quantifiedReceipts: [],
                  selfImageVerbs: [],
                  metaphors: [],
                },
                linkedinProfileSnapshot: {
                  capturedAt: null,
                  profileUrl: null,
                  publicId: null,
                  memberId: null,
                  displayName: null,
                  currentRoleTitle: null,
                  currentCompanyName: null,
                  headline: null,
                  location: null,
                  about: null,
                  followerCount: null,
                  connectionCount: null,
                  isPremium: null,
                  isOpenProfile: null,
                  connectionDegree: null,
                  recentPosts: [],
                },
                liveSignal: {
                  channel: null,
                  activityType: null,
                  summary: null,
                  url: null,
                  observedAt: null,
                  freshnessBand: null,
                  hookStrength: null,
                  engagementRationale: null,
                },
                contactPoints: [],
                contactEnrichmentState: {
                  status: "pending",
                  sourcesTried: [],
                  missingChannels: [],
                  bestDirectChannels: [],
                  lastEnrichedAt: null,
                  notes: null,
                },
                queueState: {
                  status: "ready",
                  source: "derived",
                  updatedAt: "2026-06-04T16:20:00.000Z",
                  notes: null,
                },
                packetState: null,
                notes: null,
                signalMatchIds: [],
                touches: [
                  {
                    id: "touch-1",
                    surface: "inbound_reply",
                    direction: "inbound",
                    outcome: "replied",
                    occurredAt: "2026-06-04T16:20:00.000Z",
                    summary: "Zoe Jupp has unread LinkedIn message activity.",
                    subject: null,
                    body: null,
                    sourceUrl: null,
                    notes: null,
                  },
                ],
                cadenceState: {
                  status: "ready",
                  currentStep: "direct-message",
                  lastTouchChannel: "direct-message",
                  lastTouchOutcome: "replied",
                  lastTouchAt: "2026-06-04T16:20:00.000Z",
                  nextAction: "Live reply — continue the conversation.",
                  nextActionDueAt: null,
                  blockedChannels: [],
                  requireNewHook: false,
                  notes: null,
                  updatedAt: "2026-06-04T16:20:00.000Z",
                },
                drafts: [
                  {
                    id: "draft-1",
                    surface: "inbound_reply",
                    channel: "linkedin",
                    subject: null,
                    body: "Queued reply body.",
                    status: "approved",
                    authoredBy: "operator",
                    editedByOperator: true,
                    createdAt: "2026-06-04T16:21:00.000Z",
                    updatedAt: "2026-06-04T16:21:00.000Z",
                    approvedAt: "2026-06-04T16:21:00.000Z",
                    sentAt: null,
                    notes: null,
                  },
                ],
                timelineNotes: [],
              },
            ],
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
      engagementProfileAssignment: null,
      engagementUserAssignment: null,
    },
  ];
  const rawCompanies = [
    {
      id: "company-1",
      createdAt: "2026-06-04T16:00:00.000Z",
      updatedAt: "2026-06-04T16:00:00.000Z",
      name: "Unknown company",
      domain: null,
      websiteUrl: null,
      linkedinCompanyUrl: null,
      logoSourceUrl: null,
      logoUrl: null,
      notes: null,
      tags: [],
      motionIds: ["motion-1"],
      engagementProfileAssignment: null,
      engagementUserAssignment: null,
    },
  ];

  const inbox = buildInboxView(rawUser, [observation], rawMotions, rawCompanies);
  const review = buildInboundReviewView(rawUser, [observation], rawMotions, rawCompanies);
  const item = inbox.items[0];
  const reviewItem = review.reviewItems[0];

  assert.equal(item.status, "queued");
  assert.equal(item.reviewState, "queued_for_send");
  assert.match(item.recommendedAction, /agent will send it/i);
  assert.equal(buildOperatorPromptFromInboxItem(item), null);
  assert.equal(reviewItem.state, "queued_for_send");
  assert.match(reviewItem.recommendedAction, /agent will send it/i);
});

test("reply-disabled private replies are treated as handled notifications instead of open reply work", () => {
  const observation = rawObservation({
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
  });
  const rawMotions = [
    {
      id: "motion-1",
      name: "transition-inbound-backlog",
      createdAt: "2026-06-04T16:00:00.000Z",
      updatedAt: "2026-06-04T16:00:00.000Z",
      status: "active",
      offer: {
        sourceUrl: "https://transition.exo.local/inbound-backlog",
        offerNotes: null,
      },
      premise: {
        statement: "Carry transition backlog safely.",
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
        sourceUrl: "https://transition.exo.local/inbound-backlog",
        sourceTitle: null,
        sourceDescription: null,
        sourceSummary: "Carry transition backlog safely.",
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
            companyName: "Unknown company",
            domain: null,
            websiteUrl: null,
            linkedinCompanyUrl: null,
            companyLogoSourceUrl: null,
            companyLogoUrl: null,
            signalMatches: [],
            queueState: {
              status: "selected",
              source: "manual",
              updatedAt: "2026-06-04T16:00:00.000Z",
              notes: null,
            },
            packetState: null,
            lastResearchAt: null,
            notes: null,
            prospects: [
              {
                id: "prospect-1",
                name: "Zoe Jupp",
                title: "Head of Strategic Partnerships @ Nassau Street Partners",
                linkedinProfileUrl: "https://www.linkedin.com/in/zoe-jupp/",
                avatarSourceUrl: null,
                avatarUrl: null,
                email: null,
                buyingCommitteeRole: "other",
                decisionAuthority: "unknown",
                fitConfidence: "moderate",
                whyRelevant: "Transitioned from messaging inbox.",
                sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
                observedAt: "2026-06-04T16:20:00.000Z",
                profileViewedAt: null,
                roleTruth: {
                  currentRoleDescription: null,
                  summary: null,
                  operatingMode: null,
                  scope: null,
                  evidence: [],
                },
                triggerWindow: {
                  summary: null,
                  tenureMonths: null,
                  tenureBand: null,
                  whyNowAnchor: null,
                  personTriggers: [],
                  companyTriggers: [],
                },
                identityTells: {
                  summary: null,
                  headline: null,
                  aboutQuotes: [],
                  frameworks: [],
                  certifications: [],
                  quantifiedReceipts: [],
                  selfImageVerbs: [],
                  metaphors: [],
                },
                linkedinProfileSnapshot: {
                  capturedAt: null,
                  profileUrl: null,
                  publicId: null,
                  memberId: null,
                  displayName: null,
                  currentRoleTitle: null,
                  currentCompanyName: null,
                  headline: null,
                  location: null,
                  about: null,
                  followerCount: null,
                  connectionCount: null,
                  isPremium: null,
                  isOpenProfile: null,
                  connectionDegree: null,
                  recentPosts: [],
                },
                liveSignal: {
                  channel: null,
                  activityType: null,
                  summary: null,
                  url: null,
                  observedAt: null,
                  freshnessBand: null,
                  hookStrength: null,
                  engagementRationale: null,
                },
                contactPoints: [],
                contactEnrichmentState: {
                  status: "pending",
                  sourcesTried: [],
                  missingChannels: [],
                  bestDirectChannels: [],
                  lastEnrichedAt: null,
                  notes: null,
                },
                queueState: {
                  status: "ready",
                  source: "derived",
                  updatedAt: "2026-06-04T16:20:00.000Z",
                  notes: null,
                },
                packetState: null,
                notes: null,
                signalMatchIds: [],
                touches: [
                  {
                    id: "touch-1",
                    surface: "inbound_reply",
                    direction: "inbound",
                    outcome: "replied",
                    occurredAt: "2026-06-04T16:20:00.000Z",
                    summary: "Zoe Jupp has unread LinkedIn message activity.",
                    subject: null,
                    body: null,
                    sourceUrl: null,
                    notes: null,
                  },
                  {
                    id: "touch-2",
                    surface: "inbound_reply",
                    direction: "outbound",
                    outcome: "blocked",
                    occurredAt: "2026-06-04T16:31:00.000Z",
                    summary: "Could not send the governed LinkedIn reply because the thread is read-only and reply is disabled.",
                    subject: null,
                    body: null,
                    sourceUrl: null,
                    notes: "Unipile shows the LinkedIn thread as read_only with disabledFeatures.reply.",
                  },
                ],
                cadenceState: {
                  status: "ready",
                  currentStep: "direct-message",
                  lastTouchChannel: "direct-message",
                  lastTouchOutcome: "blocked",
                  lastTouchAt: "2026-06-04T16:31:00.000Z",
                  nextAction: null,
                  nextActionDueAt: null,
                  blockedChannels: [],
                  requireNewHook: false,
                  notes: null,
                  updatedAt: "2026-06-04T16:31:00.000Z",
                },
                drafts: [
                  {
                    id: "draft-1",
                    surface: "inbound_reply",
                    channel: "linkedin",
                    subject: null,
                    body: "Queued reply body.",
                    status: "discarded",
                    authoredBy: "operator",
                    editedByOperator: true,
                    createdAt: "2026-06-04T16:21:00.000Z",
                    updatedAt: "2026-06-04T16:31:00.000Z",
                    approvedAt: "2026-06-04T16:21:00.000Z",
                    sentAt: null,
                    notes: "Unipile shows the LinkedIn thread as read_only with disabledFeatures.reply.",
                  },
                ],
                timelineNotes: [],
              },
            ],
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
      engagementProfileAssignment: null,
      engagementUserAssignment: null,
    },
  ];
  const rawCompanies = [
    {
      id: "company-1",
      createdAt: "2026-06-04T16:00:00.000Z",
      updatedAt: "2026-06-04T16:00:00.000Z",
      name: "Unknown company",
      domain: null,
      websiteUrl: null,
      linkedinCompanyUrl: null,
      logoSourceUrl: null,
      logoUrl: null,
      notes: null,
      tags: [],
      motionIds: ["motion-1"],
      engagementProfileAssignment: null,
      engagementUserAssignment: null,
    },
  ];

  const inbox = buildInboxView(rawUser, [observation], rawMotions, rawCompanies);
  const review = buildInboundReviewView(rawUser, [observation], rawMotions, rawCompanies);
  const daily = buildDailyView(rawUser, rawMotions, rawCompanies, [], [observation], { now: "2026-06-04T17:00:00.000Z" });
  const item = inbox.items[0];
  const reviewItem = review.reviewItems[0];

  assert.equal(item.status, "resolved");
  assert.equal(item.reviewState, "reply_unavailable");
  assert.match(item.recommendedAction, /reply unavailable/i);
  assert.match(item.recommendedAction, /read-only and reply is disabled/i);
  assert.equal(buildOperatorPromptFromInboxItem(item), null);
  assert.equal(reviewItem.state, "reply_unavailable");
  assert.match(reviewItem.recommendedAction, /reply unavailable/i);
  assert.equal(daily.items.some((entry) =>
    entry.prospect?.id === "prospect-1" && entry.priority === "reply"
  ), false);
});
