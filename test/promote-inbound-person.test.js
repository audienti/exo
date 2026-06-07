// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { promoteInboundPersonToProspect } from "../src/core/promote-inbound-person.js";

function buildMotion(overrides = {}) {
  return {
    id: "motion-1",
    name: "transition-inbound-backlog",
    createdAt: "2026-06-04T16:00:00.000Z",
    updatedAt: "2026-06-04T16:00:00.000Z",
    status: "active",
    offer: {
      sourceUrl: "https://transition.exo.local/inbound-backlog",
      offerNotes: "Transition motion",
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
      stakeholderTargetCount: 1,
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
      sourceSummary: "Transition motion",
      offerNotes: "Transition motion",
      problemThesis: null,
      buyerImpactThesis: null,
      likelyTriggerThesis: null,
      likelyRoleThesis: null,
      likelySegmentThesis: null,
      status: "needs_inference",
    },
    audienceHypotheses: [],
    signals: [],
    targetMap: {
      status: "ready",
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

function buildCompany(overrides = {}) {
  return {
    id: "company-1",
    createdAt: "2026-06-04T16:00:00.000Z",
    updatedAt: "2026-06-04T16:00:00.000Z",
    name: "Resolved Co",
    domain: "resolved.example",
    websiteUrl: "https://resolved.example",
    linkedinCompanyUrl: null,
    logoSourceUrl: null,
    logoUrl: null,
    notes: null,
    tags: [],
    motionIds: ["motion-1"],
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
    ...overrides,
  };
}

function buildObservation(overrides = {}) {
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
    actorName: "Rita Resolved",
    actorTitle: "VP Revenue",
    actorCompanyName: null,
    actorHandle: null,
    actorProfileUrl: "https://www.linkedin.com/in/rita-resolved/",
    actorLinkedinPublicId: "rita-resolved",
    actorLinkedinMemberId: "member-rita",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: "https://www.linkedin.com/messaging/thread/example/",
    sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
    subject: null,
    summary: "Rita Resolved has unread LinkedIn message activity.",
    motionId: null,
    companyId: null,
    prospectId: null,
    notes: null,
    messages: [],
    ...overrides,
  };
}

test("promoteInboundPersonToProspect honors a pre-resolved company id", () => {
  const motion = buildMotion();
  const company = buildCompany();
  const result = promoteInboundPersonToProspect({
    rawMotion: motion,
    rawCompanies: [company],
    seedObservation: buildObservation({
      companyId: company.id,
      motionId: motion.id,
    }),
    relatedObservations: [],
    now: "2026-06-04T16:30:00.000Z",
  });

  const account = result.motion.targetMap.accounts.find((item) => item.companyId === company.id);
  assert.ok(account);
  assert.equal(account?.companyName, "Resolved Co");
  assert.equal(account?.prospects.length, 1);
  assert.equal(account?.prospects[0]?.name, "Rita Resolved");
});

test("promoteInboundPersonToProspect preserves the latest inbound reply body on the carried touch", () => {
  const motion = buildMotion();
  const company = buildCompany();
  const result = promoteInboundPersonToProspect({
    rawMotion: motion,
    rawCompanies: [company],
    seedObservation: buildObservation({
      companyId: company.id,
      motionId: motion.id,
      messages: [
        {
          id: "msg-outbound",
          direction: "outbound",
          sentAt: "2026-06-04T16:05:59.952Z",
          fromName: "You",
          fromHandle: null,
          body: "Is it alright if I reach out to your CTO directly?",
        },
        {
          id: "msg-inbound",
          direction: "inbound",
          sentAt: "2026-06-04T16:19:00.000Z",
          fromName: "Rita Resolved",
          fromHandle: null,
          body: "Yes, that's fine.",
        },
      ],
    }),
    relatedObservations: [],
    now: "2026-06-04T16:30:00.000Z",
  });

  const account = result.motion.targetMap.accounts.find((item) => item.companyId === company.id);
  const touch = account?.prospects[0]?.touches?.[0] ?? null;
  assert.ok(touch);
  assert.equal(touch?.surface, "inbound_reply");
  assert.equal(touch?.body, "Yes, that's fine.");
  assert.equal(touch?.sourceUrl, "https://www.linkedin.com/messaging/thread/example/");
});

test("promoteInboundPersonToProspect uses a resolved company profile hint when the inbound row has no company name", () => {
  const motion = buildMotion();

  const result = promoteInboundPersonToProspect({
    rawMotion: motion,
    rawCompanies: [],
    seedObservation: buildObservation({
      actorName: "Ezra Fox",
      actorTitle: "Founder, Creative Lead",
      actorCompanyName: null,
      actorProfileUrl: "https://www.linkedin.com/in/ezrafox/",
      actorLinkedinPublicId: "ezrafox",
      actorLinkedinMemberId: "member-ezra",
    }),
    relatedObservations: [],
    resolvedCompanyProfile: {
      name: "Chaotic Good Studios",
      domain: "hellochaoticgood.com",
      websiteUrl: "https://www.hellochaoticgood.com/",
      linkedinCompanyUrl: "https://www.linkedin.com/company/chaotic-good-studios-llc/",
      logoSourceUrl: null,
    },
    now: "2026-06-04T16:30:00.000Z",
  });

  assert.equal(result.company.name, "Chaotic Good Studios");
  assert.equal(result.company.domain, "hellochaoticgood.com");
  assert.equal(result.company.websiteUrl, "https://www.hellochaoticgood.com/");
  const account = result.motion.targetMap.accounts.find((item) => item.companyId === result.company.id);
  assert.ok(account);
  assert.equal(account?.companyName, "Chaotic Good Studios");
  assert.equal(account?.prospects[0]?.name, "Ezra Fox");
});

test("promoteInboundPersonToProspect rejects unresolved people instead of merging them into a shared placeholder company", () => {
  assert.throws(
    () =>
      promoteInboundPersonToProspect({
        rawMotion: buildMotion(),
        rawCompanies: [],
        seedObservation: buildObservation({
          actorName: "Second Unknown",
          actorTitle: "Role Two",
          actorCompanyName: null,
          actorProfileUrl: "https://www.linkedin.com/in/second-unknown/",
          actorLinkedinPublicId: "second-unknown",
          actorLinkedinMemberId: "member-second",
        }),
        relatedObservations: [],
        now: "2026-06-04T16:30:00.000Z",
      }),
    /Cannot promote Second Unknown until a real company is resolved/i,
  );
});
