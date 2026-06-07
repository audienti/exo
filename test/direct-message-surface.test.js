// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildMotionActionView } from "../src/core/build-motion-action-view.js";
import { buildMotionDraftBrief, buildMotionDraftView } from "../src/core/build-motion-draft-view.js";

function openProfileDirectMessageMotion() {
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
          companyName: "Acme",
          domain: null,
          websiteUrl: null,
          linkedinCompanyUrl: null,
          signalMatches: [],
          prospects: [
            {
              id: "prospect-1",
              name: "Princess",
              title: "VP Risk",
              linkedinProfileUrl: "https://linkedin.com/in/princess",
              whyRelevant: "Runs risk operations for a target account.",
              sourceUrl: null,
              observedAt: null,
              linkedinProfileSnapshot: {
                connectionDegree: 2,
                isOpenProfile: true,
              },
              signalMatchIds: [],
              touches: [],
              cadenceState: {
                status: "ready",
                currentStep: "direct-message",
                lastTouchChannel: null,
                lastTouchOutcome: null,
                lastTouchAt: null,
                nextAction: "Send the first private LinkedIn message from the open-profile branch.",
                nextActionDueAt: null,
                blockedChannels: [],
                requireNewHook: false,
                notes: null,
                updatedAt: "2026-06-01T00:00:00.000Z",
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
  };
}

function inboundReplyMotion() {
  return {
    id: "motion-inbound-1",
    name: "transition-inbound-backlog",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    status: "active",
    offer: {
      sourceUrl: "https://transition.exo.local/inbound-backlog",
      offerNotes: "Transition only.",
    },
    premise: {
      statement: "Continue in-flight conversations without resetting them.",
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
      sourceTitle: "Transition backlog",
      sourceDescription: "Continue active conversations",
      sourceSummary: "Transition backlog",
      offerNotes: "Transition only.",
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
          companyId: "company-valet",
          companyName: "Valet Living",
          domain: null,
          websiteUrl: null,
          linkedinCompanyUrl: null,
          signalMatches: [],
          prospects: [
            {
              id: "prospect-matt",
              name: "Matt Pierce",
              title: "Business Intelligence, Revenue Operations, and Business Transformation Professional",
              linkedinProfileUrl: "https://www.linkedin.com/in/mpiercekc/",
              whyRelevant: "Transitioned from messaging inbox — in-flight before Exo.",
              sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
              observedAt: "2026-06-05T15:07:07.000Z",
              signalMatchIds: [],
              touches: [
                {
                  id: "touch-matt-1",
                  surface: "inbound_reply",
                  direction: "inbound",
                  outcome: "replied",
                  occurredAt: "2026-06-05T15:07:07.000Z",
                  summary: "Matt Pierce has unread LinkedIn message activity.",
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
                lastTouchAt: "2026-06-05T15:07:07.000Z",
                nextAction: "Live reply — continue the conversation.",
                nextActionDueAt: null,
                blockedChannels: [],
                requireNewHook: false,
                notes: null,
                updatedAt: "2026-06-05T15:07:07.000Z",
              },
            },
          ],
          queueState: { status: "ready" },
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
  };
}

function mattInboundObservation() {
  return {
    id: "obs-matt-1",
    dedupeKey: "obs-matt-1",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    platform: "linkedin",
    surfaceKey: "linkedin-messaging-inbox",
    kind: "inbound_reply_received",
    truthLevel: "authoritative",
    observedAt: "2026-06-05T15:07:07.000Z",
    recordedAt: "2026-06-05T15:13:21.093Z",
    eventAt: null,
    externalId: "thread-1",
    actorName: "Matt Pierce",
    actorTitle: "Business Intelligence, Revenue Operations, and Business Transformation Professional",
    actorCompanyName: "Valet Living",
    actorHandle: "mpiercekc",
    actorProfileUrl: "https://www.linkedin.com/in/mpiercekc/",
    actorLinkedinPublicId: "mpiercekc",
    actorLinkedinMemberId: "member-matt",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: "https://www.linkedin.com/messaging/thread/example/",
    sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
    subject: null,
    summary: "Matt Pierce has unread LinkedIn message activity.",
    motionId: "motion-inbound-1",
    companyId: "company-valet",
    prospectId: "prospect-matt",
    notes: null,
    messages: [
      {
        id: "msg-1",
        direction: "outbound",
        sentAt: "2026-06-04T16:05:59.952Z",
        fromName: "You",
        fromHandle: null,
        body: "Who in your organization deals with external vendors that are critical to your business and revenue operations?",
      },
      {
        id: "msg-2",
        direction: "inbound",
        sentAt: "2026-06-04T20:27:55.273Z",
        fromName: "Matt Pierce",
        fromHandle: null,
        body: "Hey - at Valet Living, it would probably be the CTO, Robert Cassagrande. I'm new to the company, so don't really know him, but he likely manages outsourced vendor relationships.",
      },
      {
        id: "msg-3",
        direction: "outbound",
        sentAt: "2026-06-05T13:43:57.399Z",
        fromName: "You",
        fromHandle: null,
        body: "Appreciate the pointer. Robert Cassagrande as CTO sounds right. Is it alright if I reach out to him directly, or is there a vendor management contact you'd recommend instead?",
      },
      {
        id: "msg-4",
        direction: "inbound",
        sentAt: "2026-06-05T14:25:09.250Z",
        fromName: "Matt Pierce",
        fromHandle: null,
        body: "I'd say just reach out to Rob directly. I don't really know what the structure of their team is in terms of vendor management.",
      },
      {
        id: "msg-5",
        direction: "outbound",
        sentAt: "2026-06-05T15:04:24.246Z",
        fromName: "You",
        fromHandle: null,
        body: "Got it, I'll reach out to Rob directly. No worries on the structure — I'll keep my ask focused on reducing vendor-caused delays so BI gets faster, cleaner data. Would it be okay if I mentioned you pointed me his way?",
      },
      {
        id: "msg-6",
        direction: "inbound",
        sentAt: "2026-06-05T15:07:07.056Z",
        fromName: "Matt Pierce",
        fromHandle: null,
        body: "Yes, that's fine.",
      },
    ],
  };
}

test("buildMotionDraftView exposes an open-profile first DM as the writable direct-message surface", () => {
  const view = buildMotionDraftView(openProfileDirectMessageMotion(), {
    prospectId: "prospect-1",
  });

  const card = view.surfaces.find((surface) => surface.key === "follow_up_direct_message");
  assert.ok(card);
  assert.equal(card.available, true);
  assert.equal(card.stage, "First private message");
});

test("buildMotionDraftBrief changes the rules when the direct-message surface is a first private message", () => {
  const brief = buildMotionDraftBrief(openProfileDirectMessageMotion(), {
    prospectId: "prospect-1",
    surface: "follow_up_direct_message",
  });

  assert.equal(brief.surface.available, true);
  assert.equal(brief.surface.stage, "First private message");
  assert.ok(
    brief.draftRequest.rules.some((rule) => /first private LinkedIn message on an open-profile direct-message path/i.test(rule)),
  );
  assert.ok(
    brief.draftRequest.rules.some((rule) => /do not write it like a follow-up/i.test(rule)),
  );
});

test("buildMotionActionView resolves send_direct_message to the first private-message surface for open profiles", () => {
  const view = buildMotionActionView(openProfileDirectMessageMotion(), {
    prospectId: "prospect-1",
  });

  const action = view.actions.find((item) => item.key === "send_direct_message");
  assert.ok(action);
  assert.equal(action.available, true);
  assert.equal(action.draftSurface?.key, "follow_up_direct_message");
  assert.equal(action.draftSurface?.stage, "First private message");
});

test("buildMotionDraftBrief carries linked inbound thread messages into the inbound-reply writing brief", () => {
  const brief = buildMotionDraftBrief(inboundReplyMotion(), {
    prospectId: "prospect-matt",
    surface: "inbound_reply",
    rawObservations: [mattInboundObservation()],
  });

  assert.equal(brief.surface.available, true);
  assert.equal(brief.surface.threadMessages.length, 6);
  assert.match(brief.surface.threadMessages.at(-1)?.body ?? "", /^Yes, that's fine\.$/);
  assert.match(brief.surface.latestInboundMessage?.body ?? "", /^Yes, that's fine\.$/);
  assert.ok(
    brief.draftRequest.rules.some((rule) => /actual inbound thread/i.test(rule)),
  );
  assert.ok(
    brief.draftRequest.rules.some((rule) => /answered a question/i.test(rule)),
  );
});
