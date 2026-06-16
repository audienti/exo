// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyClaimMotionProspectPacket,
  applyClaimTargetAccountPacket,
  applyCompleteMotionProspectPacket,
} from "../src/lib/motion-packets.js";

function buildProspect(overrides = {}) {
  return {
    id: "prospect-1",
    name: "No Channel Prospect",
    title: "Director of IT",
    linkedinProfileUrl: null,
    avatarSourceUrl: null,
    avatarUrl: null,
    email: null,
    buyingCommitteeRole: "other",
    decisionAuthority: "unknown",
    fitConfidence: "unknown",
    whyRelevant: "Relevant to the motion.",
    sourceUrl: "https://example.com/prospect",
    observedAt: "2026-06-05T13:00:00.000Z",
    profileViewedAt: null,
    roleTruth: {},
    triggerWindow: {},
    identityTells: {},
    linkedinProfileSnapshot: {},
    liveSignal: {},
    contactPoints: [],
    contactEnrichmentState: {
      status: "exhausted",
      sourcesTried: ["gmail", "public-web"],
      missingChannels: ["linkedin_profile", "email", "phone"],
      bestDirectChannels: [],
      lastEnrichedAt: "2026-06-05T13:05:00.000Z",
      notes: "No usable channels found yet.",
    },
    queueState: {
      status: "selected",
      source: "derived",
      updatedAt: "2026-06-05T13:00:00.000Z",
      notes: null,
    },
    packetState: {
      kind: "prospect_research",
      status: "claimed",
      workerLabel: "worker-1",
      claimedAt: "2026-06-05T13:01:00.000Z",
      completedAt: null,
      notes: null,
    },
    notes: null,
    signalMatchIds: [],
    touches: [],
    cadenceState: {
      status: "ready",
      currentStep: null,
      lastTouchChannel: null,
      lastTouchOutcome: null,
      lastTouchAt: null,
      nextAction: null,
      nextActionDueAt: null,
      blockedChannels: [],
      requireNewHook: false,
      notes: null,
      updatedAt: null,
    },
    drafts: [],
    timelineNotes: [],
    ...overrides,
  };
}

function buildAccount(overrides = {}) {
  return {
    companyId: "company-1",
    companyName: "Acme",
    domain: "acme.example",
    websiteUrl: "https://acme.example",
    linkedinCompanyUrl: "https://linkedin.com/company/acme",
    companyLogoSourceUrl: null,
    companyLogoUrl: null,
    signalMatches: [],
    queueState: {
      status: "researched",
      source: "derived",
      updatedAt: "2026-06-05T13:00:00.000Z",
      notes: null,
    },
    packetState: null,
    prospects: [],
    disposition: "active",
    lastResearchAt: "2026-06-05T13:00:00.000Z",
    notes: null,
    ...overrides,
  };
}

test("applyClaimTargetAccountPacket rejects completed account packets", () => {
  assert.throws(
    () => applyClaimTargetAccountPacket(
      buildAccount({
        packetState: {
          kind: "prospect_selection",
          status: "completed",
          workerLabel: "worker-1",
          claimedAt: "2026-06-05T13:01:00.000Z",
          completedAt: "2026-06-05T13:05:00.000Z",
          notes: "Already selected.",
        },
      }),
      { workerLabel: "worker-2" },
      "2026-06-05T13:10:00.000Z",
    ),
    /Prospect selection packet is already completed/i,
  );
});

test("applyClaimTargetAccountPacket allows returned account packets to be reclaimed", () => {
  const claimed = applyClaimTargetAccountPacket(
    buildAccount({
      packetState: {
        kind: "prospect_selection",
        status: "returned",
        workerLabel: "worker-1",
        claimedAt: "2026-06-05T13:01:00.000Z",
        completedAt: "2026-06-05T13:05:00.000Z",
        returnNotes: "Redo this.",
        returnedAt: "2026-06-05T13:07:00.000Z",
      },
    }),
    { workerLabel: "worker-2" },
    "2026-06-05T13:10:00.000Z",
  );

  assert.equal(claimed.packetState?.status, "claimed");
  assert.equal(claimed.packetState?.workerLabel, "worker-2");
});

test("applyClaimMotionProspectPacket rejects completed prospect packets", () => {
  assert.throws(
    () => applyClaimMotionProspectPacket(
      buildProspect({
        packetState: {
          kind: "prospect_research",
          status: "completed",
          workerLabel: "worker-1",
          claimedAt: "2026-06-05T13:01:00.000Z",
          completedAt: "2026-06-05T13:05:00.000Z",
          notes: "Already researched.",
        },
      }),
      { workerLabel: "worker-2" },
      "2026-06-05T13:10:00.000Z",
    ),
    /Prospect research packet is already completed/i,
  );
});

test("applyClaimMotionProspectPacket allows returned prospect packets to be reclaimed", () => {
  const claimed = applyClaimMotionProspectPacket(
    buildProspect({
      packetState: {
        kind: "prospect_research",
        status: "returned",
        workerLabel: "worker-1",
        claimedAt: "2026-06-05T13:01:00.000Z",
        completedAt: "2026-06-05T13:05:00.000Z",
        returnNotes: "Redo this.",
        returnedAt: "2026-06-05T13:07:00.000Z",
      },
    }),
    { workerLabel: "worker-2" },
    "2026-06-05T13:10:00.000Z",
  );

  assert.equal(claimed.packetState?.status, "claimed");
  assert.equal(claimed.packetState?.workerLabel, "worker-2");
});

test("applyCompleteMotionProspectPacket rejects exhausted when no reachable channel exists and governed LinkedIn search was not attempted", () => {
  assert.throws(
    () => applyCompleteMotionProspectPacket(
      buildProspect(),
      { workerLabel: "worker-1", nextStatus: "exhausted" },
      "2026-06-05T13:10:00.000Z",
    ),
    /linkedin_connected_search/i,
  );
});

test("applyCompleteMotionProspectPacket allows exhausted after governed LinkedIn search was attempted", () => {
  const completed = applyCompleteMotionProspectPacket(
    buildProspect({
      contactEnrichmentState: {
        status: "exhausted",
        sourcesTried: ["gmail", "public-web", "linkedin_connected_search"],
        missingChannels: ["linkedin_profile", "email", "phone"],
        bestDirectChannels: [],
        lastEnrichedAt: "2026-06-05T13:05:00.000Z",
        notes: "Governed connected-account LinkedIn search found no defensible profile URL.",
      },
    }),
    { workerLabel: "worker-1", nextStatus: "exhausted" },
    "2026-06-05T13:10:00.000Z",
  );

  assert.equal(completed.queueState.status, "exhausted");
  assert.equal(completed.packetState?.status, "completed");
});

test("applyCompleteMotionProspectPacket rejects completing a LinkedIn-backed prospect until governed profile enrichment and avatar capture are stored", () => {
  assert.throws(
    () => applyCompleteMotionProspectPacket(
      buildProspect({
        name: "Minh Le",
        linkedinProfileUrl: "https://www.linkedin.com/in/minh-le-risk/",
        contactEnrichmentState: {
          status: "complete",
          sourcesTried: ["linkedin_connected_search"],
          missingChannels: [],
          bestDirectChannels: ["linkedin_profile"],
          lastEnrichedAt: "2026-06-05T13:05:00.000Z",
          notes: null,
        },
      }),
      { workerLabel: "worker-1" },
      "2026-06-05T13:10:00.000Z",
    ),
    /missing stored profile enrichment and avatar capture: Minh Le/i,
  );
});

test("applyCompleteMotionProspectPacket allows completing a LinkedIn-backed prospect after governed profile enrichment recorded avatar capture", () => {
  const completed = applyCompleteMotionProspectPacket(
    buildProspect({
      name: "Minh Le",
      linkedinProfileUrl: "https://www.linkedin.com/in/minh-le-risk/",
      profileViewedAt: "2026-06-05T13:04:00.000Z",
      linkedinProfileSnapshot: {
        capturedAt: "2026-06-05T13:04:00.000Z",
        profileUrl: "https://www.linkedin.com/in/minh-le-risk/",
        avatarSourceUrl: "https://media.licdn.com/dms/image/minh.jpg",
        avatarChecked: true,
      },
      contactEnrichmentState: {
        status: "complete",
        sourcesTried: ["linkedin_connected_search"],
        missingChannels: [],
        bestDirectChannels: ["linkedin_profile"],
        lastEnrichedAt: "2026-06-05T13:05:00.000Z",
        notes: null,
      },
    }),
    { workerLabel: "worker-1" },
    "2026-06-05T13:10:00.000Z",
  );

  assert.equal(completed.packetState?.status, "completed");
});
