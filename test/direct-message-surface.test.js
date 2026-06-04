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
