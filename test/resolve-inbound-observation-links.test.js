// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInboundObservationLinkContext,
  resolveInboundObservationLinks,
} from "../src/core/resolve-inbound-observation-links.js";

function motionFixture() {
  return {
    id: "motion-1",
    name: "Motion One",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    status: "active",
    offer: {
      sourceUrl: "https://example.com/product",
      offerNotes: null,
    },
    premise: {
      statement: "This matters now.",
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
      sourceUrl: "https://example.com/product",
      sourceTitle: null,
      sourceDescription: null,
      sourceSummary: "",
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
          domain: "acme.example",
          websiteUrl: "https://acme.example",
          linkedinCompanyUrl: "https://linkedin.com/company/acme",
          companyLogoSourceUrl: null,
          companyLogoUrl: null,
          signalMatches: [],
          prospects: [
            {
              id: "prospect-1",
              name: "Princess",
              title: "VP Revenue",
              linkedinProfileUrl: "https://linkedin.com/in/princess",
              avatarSourceUrl: null,
              avatarUrl: null,
              email: "princess@acme.example",
              buyingCommitteeRole: "other",
              decisionAuthority: "unknown",
              fitConfidence: "moderate",
              whyRelevant: "In scope.",
              sourceUrl: "https://linkedin.com/in/princess",
              observedAt: "2026-06-01T00:00:00.000Z",
              linkedinProfileSnapshot: {
                publicId: "princess",
                memberId: null,
                profileUrl: "https://linkedin.com/in/princess",
              },
              contactPoints: [],
              drafts: [],
              touches: [],
              cadenceState: {
                status: "ready",
                currentStep: "connection-request",
                updatedAt: "2026-06-01T00:00:00.000Z",
              },
            },
          ],
          lastResearchAt: null,
          notes: null,
        },
      ],
    },
    stakeholderMap: { status: "pending", stakeholders: [] },
    motionPlan: { status: "pending", variants: [] },
    nextSteps: [],
  };
}

test("resolveInboundObservationLinks returns the same links with a prebuilt context", () => {
  const motions = [motionFixture()];
  const observation = {
    surfaceKey: "linkedin-sent-invitations",
    actorProfileUrl: "https://linkedin.com/in/princess",
    actorHandle: null,
    actorLinkedinPublicId: null,
    actorLinkedinMemberId: null,
    motionId: null,
    companyId: null,
    prospectId: null,
  };

  const withoutContext = resolveInboundObservationLinks(motions, observation);
  const linkContext = buildInboundObservationLinkContext(motions);
  const withContext = resolveInboundObservationLinks(motions, observation, linkContext);

  assert.deepEqual(withContext, withoutContext);
  assert.deepEqual(withContext, {
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
  });
});

test("resolveInboundObservationLinks preserves explicit prospect-scoped links without manufacturing a conflict", () => {
  const motions = [motionFixture()];

  const resolved = resolveInboundObservationLinks(motions, {
    surfaceKey: "linkedin-received-invitations",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    actorProfileUrl: "https://linkedin.com/in/princess",
  });

  assert.deepEqual(resolved, {
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
  });
});
