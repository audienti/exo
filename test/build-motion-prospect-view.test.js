// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildMotionProspectView } from "../src/core/build-motion-prospect-view.js";

function buildMotion(overrides = {}) {
  return {
    id: "motion-1",
    name: "Motion One",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    status: "active",
    offer: {
      sourceUrl: "https://example.com",
      offerNotes: null,
    },
    premise: {
      statement: "Risk leaders need better outbound signal hygiene.",
      notes: null,
      source: "operator",
      status: "defined",
    },
    targetingProfile: {
      geolocations: ["United States"],
      icpTypes: [],
      industries: ["software"],
      companyTypes: [],
      companyShapes: [],
      companySizes: [],
      targetTitles: ["VP Risk"],
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
      sourceUrl: "https://example.com",
      sourceTitle: "Example Product",
      sourceDescription: "Outbound signal platform",
      sourceSummary: "Example Product - Outbound signal platform",
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
          companyName: "GovPointe",
          domain: "govpointe.com",
          websiteUrl: "https://govpointe.com",
          linkedinCompanyUrl: null,
          signalMatches: [],
          prospects: [
            {
              id: "prospect-1",
              name: "Lina Park",
              title: "Procurement Support Department",
              linkedinProfileUrl: null,
              email: "lpark@govpointeoffice.us",
              whyRelevant: "Transitioned from inbox threads — in-flight before Exo.",
              sourceUrl: null,
              observedAt: null,
              signalMatchIds: [],
              touches: [
                {
                  id: "touch-1",
                  surface: "email",
                  direction: "outbound",
                  outcome: "sent",
                  occurredAt: "2026-06-05T00:24:16.523Z",
                  summary: "Sent send email for Lina Park.",
                },
              ],
              cadenceState: {
                status: "ready",
                currentStep: "value-add-email",
                lastTouchChannel: "email",
                lastTouchOutcome: "sent",
                lastTouchAt: "2026-06-05T00:24:16.523Z",
                nextAction: "Wait for an email reply before changing channels again.",
                nextActionDueAt: null,
                blockedChannels: [],
                requireNewHook: false,
                notes: null,
                updatedAt: "2026-06-05T00:24:16.536Z",
              },
            },
          ],
          queueState: { status: "selected" },
          packetState: null,
          lastResearchAt: null,
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
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
    ...overrides,
  };
}

function buildThreadMessages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index + 1}`,
    direction: index % 2 === 0 ? "outbound" : "inbound",
    sentAt: `2026-06-04T${String(10 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
    fromName: index % 2 === 0 ? "William Flanagan" : "Lina Park",
    fromHandle: index % 2 === 0 ? "william@example.com" : "lpark@govpointeoffice.us",
    body: `Thread message ${index + 1}`,
  }));
}

test("buildMotionProspectView keeps email thread observations when no parsed messages were captured", () => {
  const view = buildMotionProspectView(buildMotion(), {
    prospectId: "prospect-1",
    rawObservations: [
      {
        id: "obs-email-thread",
        dedupeKey: "gmail:thread:1",
        userId: "user-1",
        accountId: "account-1",
        capability: "gmail",
        platform: "gmail",
        surfaceKey: "gmail-inbox-threads",
        kind: "email_thread_updated",
        truthLevel: "authoritative",
        observedAt: "2026-06-04T13:37:36.000Z",
        recordedAt: "2026-06-04T13:44:05.113Z",
        eventAt: null,
        externalId: "thread-1",
        actorName: "Lina Park",
        actorTitle: "Procurement Support Department",
        actorCompanyName: "GovPointe",
        actorHandle: "lpark@govpointeoffice.us",
        actorProfileUrl: null,
        actorLinkedinPublicId: null,
        actorLinkedinMemberId: null,
        actorAvatarSourceUrl: null,
        actorAvatarUrl: null,
        threadUrl: "https://mail.google.com/mail/#all/thread-1",
        sourceUrl: "https://mail.google.com/mail/#all/thread-1",
        subject: null,
        summary: "Repeated follow-up on a public-safety recruitment/website RFP for Halfmoon Hillcrest Fire Dept.",
        motionId: "motion-1",
        companyId: "company-1",
        prospectId: "prospect-1",
        providerSharedSecret: null,
        notes: "Subject: Re: William - Halfmoon Hillcrest Fire Dept.\n\nExternal follow-up thread. No reply from William visible in this thread.",
        messages: [],
      },
    ],
  }).prospect;

  assert.deepEqual(view?.threadMessages ?? [], []);
  assert.equal(view?.replySubject, "Re: William - Halfmoon Hillcrest Fire Dept.");
  assert.equal(view?.timelineObservations.length, 1);
  assert.equal(view?.timelineObservations[0]?.kind, "email_thread_updated");
  assert.equal(view?.timelineObservations[0]?.surfaceKey, "gmail-inbox-threads");
});

test("buildMotionProspectView preserves the full structured Gmail thread history", () => {
  const messages = buildThreadMessages(12);
  const view = buildMotionProspectView(buildMotion(), {
    prospectId: "prospect-1",
    rawObservations: [
      {
        id: "obs-email-thread-full",
        dedupeKey: "gmail:thread:full",
        userId: "user-1",
        accountId: "account-1",
        capability: "gmail",
        platform: "gmail",
        surfaceKey: "gmail-inbox-threads",
        kind: "email_thread_updated",
        truthLevel: "authoritative",
        observedAt: "2026-06-04T13:37:36.000Z",
        recordedAt: "2026-06-04T13:44:05.113Z",
        eventAt: null,
        externalId: "thread-full",
        actorName: "Lina Park",
        actorTitle: "Procurement Support Department",
        actorCompanyName: "GovPointe",
        actorHandle: "lpark@govpointeoffice.us",
        actorProfileUrl: null,
        actorLinkedinPublicId: null,
        actorLinkedinMemberId: null,
        actorAvatarSourceUrl: null,
        actorAvatarUrl: null,
        threadUrl: "https://mail.google.com/mail/#all/thread-full",
        sourceUrl: "https://mail.google.com/mail/#all/thread-full",
        subject: "Re: GovPointe follow-up",
        summary: "Thread changed.",
        motionId: "motion-1",
        companyId: "company-1",
        prospectId: "prospect-1",
        providerSharedSecret: null,
        notes: null,
        messages,
      },
    ],
  }).prospect;

  assert.equal(view?.threadMessages.length, 12);
  assert.equal(view?.threadMessages[0]?.body, "Thread message 1");
  assert.equal(view?.threadMessages.at(-1)?.body, "Thread message 12");
  assert.equal(view?.latestInboundMessage?.body, "Thread message 12");
});

test("buildMotionProspectView surfaces why pre-connect was skipped when no governed public target exists", () => {
  const motion = buildMotion();
  const prospect = motion.targetMap.accounts[0].prospects[0];
  prospect.linkedinProfileUrl = "https://www.linkedin.com/in/lina-park/";
  prospect.email = null;
  prospect.touches = [];
  prospect.cadenceState = {
    status: "ready",
    currentStep: "connection-request",
    lastTouchChannel: null,
    lastTouchOutcome: null,
    lastTouchAt: null,
    nextAction: "Send the first connection request.",
    nextActionDueAt: "2026-06-05T00:24:16.523Z",
    blockedChannels: [],
    requireNewHook: false,
    notes: null,
    updatedAt: "2026-06-05T00:24:16.536Z",
  };
  prospect.linkedinProfileSnapshot = {
    connectionDegree: 2,
    isOpenProfile: null,
    recentPosts: [],
  };
  prospect.publicEngagementSelection = null;

  const view = buildMotionProspectView(motion, {
    prospectId: "prospect-1",
  }).prospect;

  assert.equal(view?.preConnect?.status, "skipped");
  assert.match(view?.preConnect?.reason ?? "", /skip warmup and move straight to a direct connection request/i);
});

test("buildMotionProspectView treats authored linkedin posts labeled post as captured public activity", () => {
  const motion = buildMotion();
  const prospect = motion.targetMap.accounts[0].prospects[0];
  prospect.linkedinProfileUrl = "https://www.linkedin.com/in/lina-park/";
  prospect.email = null;
  prospect.touches = [];
  prospect.cadenceState = {
    status: "ready",
    currentStep: "connection-request",
    lastTouchChannel: null,
    lastTouchOutcome: null,
    lastTouchAt: null,
    nextAction: "Warm the account before sending a connection request.",
    nextActionDueAt: "2026-06-05T00:24:16.523Z",
    blockedChannels: [],
    requireNewHook: false,
    notes: null,
    updatedAt: "2026-06-05T00:24:16.536Z",
  };
  prospect.linkedinProfileSnapshot = {
    connectionDegree: 2,
    isOpenProfile: null,
    recentPosts: [
      {
        activityType: "post",
        url: "https://www.linkedin.com/posts/lina-park_signal-hygiene",
        postedAt: "2026-06-04T17:14:29.676Z",
        freshnessBand: "0-14-days",
        summary: "Lina posted about procurement signal hygiene.",
        snippet: "Bad signal routing burns operator time.",
        targetKind: "post",
        authoredByProspect: true,
        hasOriginalCommentary: true,
        businessRelevance: "high",
        recommendedAction: "comment",
        rationale: "This is directly tied to the workflow she owns.",
      },
    ],
  };
  prospect.publicEngagementSelection = null;

  const view = buildMotionProspectView(motion, {
    prospectId: "prospect-1",
  }).prospect;

  assert.equal(view?.capturedPublicActivity.length, 1);
  assert.equal(view?.capturedPublicActivity[0]?.activityType, "own-post");
  assert.equal(view?.recentPost.available, true);
  assert.equal(view?.recentPost.engageable, true);
  assert.equal(view?.publicEngagementSelection?.targetUrl, "https://www.linkedin.com/posts/lina-park_signal-hygiene");
});
