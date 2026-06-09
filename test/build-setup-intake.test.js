// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildSetupIntake } from "../src/core/build-setup-intake.js";

function baseUser(overrides = {}) {
  return {
    id: "user-1",
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    label: "operator-main",
    accounts: [
      {
        id: "gmail-account",
        createdAt: "2026-06-09T00:00:00.000Z",
        updatedAt: "2026-06-09T00:00:00.000Z",
        capability: "gmail",
        handle: "operator@example.com",
        sourceType: "harness-connection",
        harnessConnectionId: "gmail-harness",
        providerAccountId: "acct-gmail-1",
        preferred: true,
      },
    ],
    harnessConnections: [
      {
        id: "gmail-harness",
        createdAt: "2026-06-09T00:00:00.000Z",
        updatedAt: "2026-06-09T00:00:00.000Z",
        runtime: "codex",
        connector: "gmail",
        status: "available",
      },
    ],
    ...overrides,
  };
}

test("setup intake detects a new motion description in chat and asks the next governed question", () => {
  const result = buildSetupIntake({
    message: "We need a new motion for https://example.com/offer",
    rawUsers: [baseUser()],
    rawProfiles: [],
    rawMotions: [],
    rawCompanies: [],
  });

  assert.equal(result.detectedIntent.kind, "new-motion");
  assert.equal(result.route, "onboarding-motion");
  assert.equal(result.nextQuestion?.key, "premise");
  assert.match(result.nextQuestion?.prompt ?? "", /why should this offer matter right now/i);
  assert.match(
    result.definitions.find((entry) => entry.key === "signals")?.body ?? "",
    /observable evidence/i,
  );
});

test("setup intake detects an additional user in chat without opening the UI", () => {
  const result = buildSetupIntake({
    message: "Add a second user named Sarah Chen for this workspace.",
    rawUsers: [baseUser()],
    rawProfiles: [],
    rawMotions: [
      {
        id: "motion-1",
        createdAt: "2026-06-09T00:00:00.000Z",
        updatedAt: "2026-06-09T00:00:00.000Z",
        name: "fixture-motion",
        status: "active",
        premise: {
          status: "defined",
          statement: "This offer matters when GTM teams need one governed setup flow.",
          source: "operator",
          notes: null,
        },
        audienceHypotheses: [{ id: "aud-1", name: "Revenue leaders", companyCriteria: [], roleCriteria: [], notes: null, confidence: "moderate" }],
        signals: [{ id: "sig-1", question: "Is there recent evidence the team is changing GTM workflow?", scope: "company", status: "ready" }],
        offer: {
          sourceUrl: "https://example.com/offer",
          sourceTitle: "Example Offer",
          sourceDescription: "Example",
          sourceSummary: "Example",
        },
        targetMap: { accounts: [] },
        nextSteps: [],
      },
    ],
    rawCompanies: [],
  });

  assert.equal(result.detectedIntent.kind, "new-user");
  assert.equal(result.route, "add-user");
  assert.equal(result.status, "ready-to-apply");
  assert.equal(result.extracted.userLabel, "Sarah Chen");
  assert.match(result.applyCommandHint ?? "", /exo users add --label "Sarah Chen" --json/);
});
