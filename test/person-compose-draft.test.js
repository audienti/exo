// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildPersonView } from "../src/core/build-person-view.js";
import {
  buildPersonComposeDraftBrief,
  buildPersonComposePrompt,
  resolvePersonComposeDraft,
} from "../src/core/build-person-compose-draft.js";
import { TRANSITION_MOTION_MARKER_URL } from "../src/core/ensure-transition-motion.js";

function rawObservation(overrides = {}) {
  return {
    id: "obs-person-compose",
    dedupeKey: "obs-person-compose",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    platform: "linkedin",
    surfaceKey: "linkedin-messaging-inbox",
    kind: "inbound_reply_received",
    truthLevel: "authoritative",
    observedAt: "2026-06-04T20:27:55.273Z",
    recordedAt: "2026-06-04T20:27:55.273Z",
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
    motionId: null,
    companyId: "company-valet",
    prospectId: null,
    notes: null,
    messages: [
      {
        id: "msg-matt-1",
        direction: "outbound",
        sentAt: "2026-06-04T16:05:59.952Z",
        fromName: "You",
        fromHandle: null,
        body: "Who in your organization deals with external vendors that are critical to your business operations?",
      },
      {
        id: "msg-matt-2",
        direction: "inbound",
        sentAt: "2026-06-04T20:27:55.273Z",
        fromName: "Matt Pierce",
        fromHandle: null,
        body: "Hey - at Valet Living, it would probably be the CTO, Robert Cassagrande. I'm new to the company, so don't really know him, but he likely manages outsourced vendor relationships.",
      },
    ],
    ...overrides,
  };
}

function rawCompany(overrides = {}) {
  return {
    id: "company-valet",
    createdAt: "2026-06-04T16:00:00.000Z",
    updatedAt: "2026-06-04T16:00:00.000Z",
    name: "Valet Living",
    domain: "valetliving.com",
    websiteUrl: "https://www.valetliving.com/",
    linkedinCompanyUrl: "https://www.linkedin.com/company/valet-living/",
    logoSourceUrl: null,
    logoUrl: null,
    notes: "Property services company.",
    tags: [],
    motionIds: [],
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
    ...overrides,
  };
}

function rawMotion(overrides = {}) {
  return {
    id: "motion-1",
    name: "outsourced-vendor-motion",
    createdAt: "2026-06-04T16:00:00.000Z",
    updatedAt: "2026-06-04T16:00:00.000Z",
    status: "draft",
    offer: {
      sourceUrl: "https://example.com/offer",
      offerNotes: "Operational vendor dependency assessment.",
    },
    premise: {
      statement: "This matters when a company depends on outside vendors for business-critical operations.",
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
      sourceUrl: "https://example.com/offer",
      sourceTitle: "Offer",
      sourceDescription: "Offer description",
      sourceSummary: "Offer summary",
      offerNotes: "Operational vendor dependency assessment.",
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
      status: "pending",
      accounts: [],
      segments: [],
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

test("buildPersonComposeDraftBrief treats transition backlog as company-and-profile context, not offer context", () => {
  const transitionMotion = rawMotion({
    id: "motion-transition",
    name: "transition-inbound-backlog",
    offer: {
      sourceUrl: TRANSITION_MOTION_MARKER_URL,
      offerNotes: "Transition only.",
    },
    premise: {
      statement: "Continue and reconcile relationships started before Exo.",
      notes: null,
      source: "operator",
      status: "defined",
    },
  });
  const company = rawCompany({ motionIds: [transitionMotion.id] });
  const person = buildPersonView({
    observationId: "obs-transition",
    rawObservations: [
      rawObservation({
        id: "obs-transition",
        dedupeKey: "obs-transition",
        motionId: transitionMotion.id,
      }),
    ],
    rawMotions: [transitionMotion],
    rawCompanies: [company],
  });

  assert.ok(person);
  const brief = buildPersonComposeDraftBrief(person);
  assert.ok(brief);
  assert.equal(brief?.motion.mode, "transition_backlog");
  assert.equal(brief?.company.name, "Valet Living");
  assert.equal(brief?.person.name, "Matt Pierce");
  assert.equal(brief?.relationship.key, "in-conversation");
  assert.equal(brief?.threadMessages.length, 2);
  assert.match(buildPersonComposePrompt(brief), /Do not invent an offer, premise, campaign, or sales angle\./);
});

test("buildPersonComposeDraftBrief exposes real motion context when the observation is linked to one", () => {
  const motion = rawMotion();
  const company = rawCompany({ motionIds: [motion.id] });
  const person = buildPersonView({
    observationId: "obs-linked-motion",
    rawObservations: [
      rawObservation({
        id: "obs-linked-motion",
        dedupeKey: "obs-linked-motion",
        motionId: motion.id,
      }),
    ],
    rawMotions: [motion],
    rawCompanies: [company],
  });

  assert.ok(person);
  const brief = buildPersonComposeDraftBrief(person);
  assert.ok(brief);
  assert.equal(brief?.motion.mode, "linked_motion");
  assert.equal(brief?.motion.premise, "This matters when a company depends on outside vendors for business-critical operations.");
  assert.match(buildPersonComposePrompt(brief), /A real motion is linked here\./);
});

test("resolvePersonComposeDraft uses the writer output and passes thread context through", () => {
  const person = buildPersonView({
    observationId: "obs-writer-path",
    rawObservations: [rawObservation({
      id: "obs-writer-path",
      dedupeKey: "obs-writer-path",
    })],
    rawMotions: [],
    rawCompanies: [rawCompany()],
  });

  assert.ok(person);
  /** @type {NonNullable<ReturnType<typeof buildPersonComposeDraftBrief>> | null} */
  let capturedBrief = null;
  const draft = resolvePersonComposeDraft(person, {
    writer: (brief) => {
      capturedBrief = brief;
      return {
        subject: null,
        body: "Appreciate the pointer. Robert Cassagrande sounds like the right person to compare notes with. I'll reach out there.",
      };
    },
  });

  assert.ok(capturedBrief);
  assert.equal(capturedBrief?.relationship.key, "in-conversation");
  assert.equal(capturedBrief?.motion.mode, "unlinked");
  assert.match(capturedBrief?.threadMessages[1]?.body ?? "", /Robert Cassagrande/);
  assert.equal(
    draft.body,
    "Appreciate the pointer. Robert Cassagrande sounds like the right person to compare notes with. I'll reach out there.",
  );
});
