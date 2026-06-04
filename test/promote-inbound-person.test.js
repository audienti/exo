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

test("promoteInboundPersonToProspect does not enforce stakeholder caps on the Unknown company fallback", () => {
  const unknownCompany = buildCompany({
    id: "company-unknown",
    name: "Unknown company",
    domain: null,
    websiteUrl: null,
    motionIds: ["motion-1"],
  });
  const motion = buildMotion({
    targetMap: {
      status: "ready",
      segments: [],
      accounts: [
        {
          companyId: unknownCompany.id,
          companyName: "Unknown company",
          domain: null,
          websiteUrl: null,
          linkedinCompanyUrl: null,
          companyLogoSourceUrl: null,
          companyLogoUrl: null,
          signalMatches: [],
          prospects: [
            {
              id: "prospect-1",
              name: "First Unknown",
              title: "Role One",
              linkedinProfileUrl: "https://www.linkedin.com/in/first-unknown/",
              avatarSourceUrl: null,
              avatarUrl: null,
              email: null,
              buyingCommitteeRole: "other",
              decisionAuthority: "unknown",
              fitConfidence: "moderate",
              whyRelevant: "Already promoted.",
              sourceUrl: "https://www.linkedin.com/in/first-unknown/",
              observedAt: "2026-06-04T15:00:00.000Z",
              profileViewedAt: null,
              roleTruth: { currentRoleDescription: null, summary: null, operatingMode: null, scope: null, evidence: [] },
              triggerWindow: { summary: null, tenureMonths: null, tenureBand: null, whyNowAnchor: null, personTriggers: [], companyTriggers: [] },
              identityTells: { summary: null, headline: null, aboutQuotes: [], frameworks: [], certifications: [], quantifiedReceipts: [], selfImageVerbs: [], metaphors: [] },
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
                updatedAt: "2026-06-04T15:00:00.000Z",
                notes: null,
              },
              packetState: null,
              notes: null,
              signalMatchIds: [],
              touches: [],
              cadenceState: {
                status: "ready",
                currentStep: null,
                lastTouchChannel: null,
                lastTouchOutcome: "pending",
                lastTouchAt: null,
                nextAction: "Review this inbound person and choose the next move.",
                nextActionDueAt: null,
                blockedChannels: [],
                requireNewHook: false,
                notes: null,
                updatedAt: null,
              },
              drafts: [],
              timelineNotes: [],
            },
          ],
          queueState: {
            status: "ready",
            source: "derived",
            updatedAt: "2026-06-04T15:00:00.000Z",
            notes: null,
          },
          packetState: null,
          lastResearchAt: null,
          notes: null,
        },
      ],
    },
  });

  const result = promoteInboundPersonToProspect({
    rawMotion: motion,
    rawCompanies: [unknownCompany],
    seedObservation: buildObservation({
      id: "obs-2",
      actorName: "Second Unknown",
      actorTitle: "Role Two",
      actorProfileUrl: "https://www.linkedin.com/in/second-unknown/",
      actorLinkedinPublicId: "second-unknown",
      actorLinkedinMemberId: "member-second",
    }),
    relatedObservations: [],
    now: "2026-06-04T16:30:00.000Z",
  });

  const account = result.motion.targetMap.accounts.find((item) => item.companyId === unknownCompany.id);
  assert.ok(account);
  assert.equal(account?.prospects.length, 2);
  assert.equal(account?.prospects[1]?.name, "Second Unknown");
});
