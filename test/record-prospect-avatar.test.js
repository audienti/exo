// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { recordMotionProspect, updateMotionProspect } from "../src/core/record-prospect.js";

function buildMotionFixture() {
  return {
    id: "motion-1",
    name: "identity-first-motion",
    createdAt: "2026-06-07T12:00:00.000Z",
    updatedAt: "2026-06-07T12:00:00.000Z",
    status: "active",
    offer: {
      sourceUrl: "https://example.com/identity-first-motion",
      offerNotes: "Identity-first motion"
    },
    premise: {
      statement: "Identity-backed prospecting only works when durable profile evidence lands in Exo.",
      notes: null,
      source: "operator",
      status: "defined"
    },
    targetingProfile: {
      geolocations: [],
      icpTypes: [],
      industries: [],
      companyTypes: [],
      companyShapes: [],
      companySizes: [],
      stakeholderTargetCount: 3,
      targetTitles: ["Head of Risk"],
      roleFamilies: ["risk"],
      segmentVariants: []
    },
    suppressionPolicy: {
      excludedAccounts: [],
      excludedDomains: [],
      excludedContacts: [],
      doNotContactEntries: [],
      doNotContactSources: [],
      crmCustomerSuppressionEnabled: false,
      crmOpportunitySuppressionEnabled: false
    },
    offerThesis: {
      sourceUrl: "https://example.com/identity-first-motion",
      sourceTitle: null,
      sourceDescription: null,
      sourceSummary: "Identity-first motion",
      offerNotes: "Identity-first motion",
      problemThesis: null,
      buyerImpactThesis: null,
      likelyTriggerThesis: null,
      likelyRoleThesis: null,
      likelySegmentThesis: null,
      status: "needs_inference"
    },
    audienceHypotheses: [],
    signals: [],
    targetMap: {
      status: "ready",
      accounts: [],
      segments: []
    },
    stakeholderMap: {
      status: "pending",
      stakeholders: []
    },
    motionPlan: {
      status: "pending",
      variants: []
    },
    nextSteps: [],
    engagementProfileAssignment: null,
    engagementUserAssignment: null
  };
}

function buildCompanyFixture() {
  return {
    id: "company-1",
    createdAt: "2026-06-07T12:00:00.000Z",
    updatedAt: "2026-06-07T12:00:00.000Z",
    name: "BillEase",
    domain: "billease.ph",
    websiteUrl: "https://billease.ph",
    linkedinCompanyUrl: "https://www.linkedin.com/company/billease/",
    logoSourceUrl: null,
    logoUrl: null,
    notes: null,
    tags: [],
    motionIds: ["motion-1"],
    engagementProfileAssignment: null,
    engagementUserAssignment: null
  };
}

test("recordMotionProspect promotes a snapshot avatar into canonical prospect media fields", () => {
  const motion = recordMotionProspect(buildMotionFixture(), buildCompanyFixture(), {
    name: "Minh Le",
    title: "Head of Risk",
    whyRelevant: "Owns lending controls and credit instrumentation.",
    linkedinProfileSnapshot: {
      profileUrl: "https://www.linkedin.com/in/minh-le-risk/",
      avatarSourceUrl: "https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example"
    }
  });

  const prospect = motion.targetMap.accounts[0].prospects[0];
  assert.equal(prospect.avatarSourceUrl, "https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example");
  assert.equal(prospect.avatarUrl, "https://imageproxy.bizzbridge.com/200x200/https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example");
  assert.equal(prospect.linkedinProfileSnapshot.avatarSourceUrl, "https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example");
  assert.equal(prospect.linkedinProfileSnapshot.avatarChecked, false);
});

test("updateMotionProspect promotes a snapshot avatar without clearing an existing canonical avatar on null snapshot input", () => {
  const seededMotion = recordMotionProspect(buildMotionFixture(), buildCompanyFixture(), {
    name: "Minh Le",
    title: "Head of Risk",
    whyRelevant: "Owns lending controls and credit instrumentation.",
    avatarSourceUrl: "https://cdn.example.com/minh-initial.png"
  });
  const seededProspect = seededMotion.targetMap.accounts[0].prospects[0];

  const enrichedMotion = updateMotionProspect(seededMotion, buildCompanyFixture(), {
    prospectId: seededProspect.id,
    linkedinProfileSnapshot: {
      profileUrl: "https://www.linkedin.com/in/minh-le-risk/",
      avatarSourceUrl: "https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example"
    }
  });
  const enrichedProspect = enrichedMotion.targetMap.accounts[0].prospects[0];
  assert.equal(enrichedProspect.avatarSourceUrl, "https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example");
  assert.equal(enrichedProspect.linkedinProfileSnapshot.avatarChecked, false);

  const unchangedMotion = updateMotionProspect(enrichedMotion, buildCompanyFixture(), {
    prospectId: seededProspect.id,
    linkedinProfileSnapshot: {
      profileUrl: "https://www.linkedin.com/in/minh-le-risk/",
      avatarSourceUrl: null
    }
  });
  const unchangedProspect = unchangedMotion.targetMap.accounts[0].prospects[0];
  assert.equal(unchangedProspect.avatarSourceUrl, "https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example");
  assert.equal(unchangedProspect.linkedinProfileSnapshot.avatarSourceUrl, null);
  assert.equal(unchangedProspect.linkedinProfileSnapshot.avatarChecked, false);
});
