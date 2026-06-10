// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateMotionTargeting } from "../src/core/evaluate-motion-targeting.js";

test("evaluateMotionTargeting filters unrelated companies before schema parsing", () => {
  const result = evaluateMotionTargeting(
    fixtureMotion(),
    [
      { id: "unrelated-company", motionIds: ["other-motion"] },
      fixtureCompany(),
    ],
    [],
    [],
  );

  assert.equal(result.companyLoop.companyCount, 1);
  assert.equal(result.companyLoop.items[0].companyId, "company-1");
});

function fixtureMotion() {
  const now = "2026-06-10T00:00:00.000Z";
  return {
    id: "motion-1",
    name: "Motion One",
    createdAt: now,
    updatedAt: now,
    status: "active",
    offer: {
      sourceUrl: "https://example.com/offer",
      offerNotes: null,
    },
    premise: {
      statement: "This offer matters when teams need governed execution.",
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
      targetTitles: ["Director"],
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
      sourceTitle: "Example Offer",
      sourceDescription: null,
      sourceSummary: "Governed execution offer.",
      offerNotes: null,
      problemThesis: null,
      buyerImpactThesis: null,
      likelyTriggerThesis: null,
      likelyRoleThesis: null,
      likelySegmentThesis: null,
      status: "seeded",
    },
    audienceHypotheses: [
      {
        id: "audience-1",
        name: "Operators",
        companyCriteria: [],
        roleCriteria: [],
        notes: null,
        confidence: "moderate",
      },
    ],
    signals: [
      {
        id: "signal-1",
        name: "Execution signal",
        question: "Is there evidence this team needs governed execution?",
        scope: "company",
        whyItMatters: null,
        matchRule: null,
        audienceIds: ["audience-1"],
        observationMethods: [],
        status: "ready",
      },
    ],
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
  };
}

function fixtureCompany() {
  const now = "2026-06-10T00:00:00.000Z";
  return {
    id: "company-1",
    createdAt: now,
    updatedAt: now,
    name: "Acme",
    domain: "acme.example",
    websiteUrl: "https://acme.example",
    linkedinCompanyUrl: "https://www.linkedin.com/company/acme",
    logoSourceUrl: null,
    logoUrl: null,
    notes: null,
    tags: [],
    motionIds: ["motion-1"],
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
  };
}
