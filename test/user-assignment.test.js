// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { assignCompanyUser } from "../src/core/assign-company-user.js";
import { assignMotionUser } from "../src/core/assign-motion-user.js";

function companyFixture() {
  return {
    id: "company-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    name: "Acme",
    domain: "acme.example",
    websiteUrl: "https://acme.example",
    linkedinCompanyUrl: "https://www.linkedin.com/company/acme/",
    logoSourceUrl: null,
    logoUrl: null,
    notes: null,
    tags: [],
    motionIds: [],
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
  };
}

function motionFixture() {
  return {
    id: "motion-1",
    name: "Acme Motion",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    status: "active",
    offer: {
      sourceUrl: "https://example.com/product",
      offerNotes: null,
    },
    premise: {
      statement: "This matters when the buyer has a real coordination problem.",
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

function profileFixture() {
  return {
    id: "profile-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "workspace-main",
    browser: "chrome",
    browserCommand: null,
    userDataDir: "/Users/example/Library/Application Support/Google/Chrome",
    profileDirectory: "Profile 4",
    profilePath: "/Users/example/Library/Application Support/Google/Chrome/Profile 4",
    detectedProfileName: null,
    capabilities: ["generic-web", "linkedin"],
    verifiedCapabilities: ["linkedin"],
    identity: {
      owner: "operator",
      workspace: "workspace",
      scope: "work",
      accounts: [{ capability: "linkedin", handle: "operator-linkedin" }],
    },
    automationControls: {
      weeklyQuotas: {
        profileVisits: null,
        invitations: null,
        messages: null,
      },
    },
    notes: null,
    status: "ready",
    lastTestedAt: null,
    lastTestResult: null,
    lastAuthProbedAt: null,
    lastAuthProbeResult: null,
  };
}

function userFixture() {
  return {
    id: "user-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "Operator",
    owner: "operator",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00",
    },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "linkedin",
        handle: "operator-linkedin",
        label: null,
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        harnessConnectionId: null,
        preferred: true,
        notes: null,
        automationControls: {
          weeklyQuotas: {
            profileVisits: null,
            invitations: null,
            messages: null,
          },
        },
        inboundSync: {
          surfaces: [],
        },
      },
    ],
    harnessConnections: [],
  };
}

test("assignCompanyUser clears legacy profile assignment even when the user has a browser-profile account", () => {
  const updated = assignCompanyUser(companyFixture(), userFixture(), [profileFixture()], {
    assignedBy: "test",
    reason: "Pin the operator",
  });

  assert.equal(updated.engagementUserAssignment?.userId, "user-1");
  assert.equal(updated.engagementProfileAssignment, null);
});

test("assignCompanyUser persists explicit account refs for company-specific routing", () => {
  const updated = assignCompanyUser(companyFixture(), userFixture(), [profileFixture()], {
    assignedBy: "test",
    reason: "Pin the exact account",
    accountRefs: ["linkedin:operator-linkedin"],
  });

  assert.deepEqual(updated.engagementUserAssignment?.accountRefs, ["linkedin:operator-linkedin"]);
});

test("assignMotionUser clears legacy profile assignment even when the user has a browser-profile account", () => {
  const updated = assignMotionUser(motionFixture(), userFixture(), [profileFixture()], {
    assignedBy: "test",
    reason: "Pin the operator",
  });

  assert.equal(updated.engagementUserAssignment?.userId, "user-1");
  assert.equal(updated.engagementProfileAssignment, null);
});

test("assignMotionUser rejects account refs that are not mapped onto the user", () => {
  assert.throws(() => assignMotionUser(motionFixture(), userFixture(), [profileFixture()], {
    assignedBy: "test",
    reason: "Pin the exact account",
    accountRefs: ["gmail:not-mapped@example.com"],
  }), /does not have a connected account/i);
});
