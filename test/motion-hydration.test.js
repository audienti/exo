// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendActivityEvent,
  findMotionById,
  findOrCreateCompany,
  getLocalDatabase,
  insertMotion,
  resolvePersonIdentity,
  upsertEmployment,
  upsertMotionAccount,
  upsertProspect,
  upsertProspectDraft,
  upsertSignalMatch,
} from "../src/db/database.js";
import {
  motionCoreSchema,
  motionSchema,
  motionViewSchema,
} from "../src/schema/motion.js";

test("motion schemas split stored core from hydrated legacy view", () => {
  const view = buildMotionView();
  const core = motionCoreSchema.parse(view);

  assert.equal("targetMap" in core, false);
  assert.equal(motionSchema, motionViewSchema);
  assert.equal(motionViewSchema.parse(view).targetMap.status, "pending");
});

test("motion rows store core only and hydrate a legacy targetMap view from normalized rows", () => {
  withIsolatedExoState(() => {
    const motion = insertMotion(buildMotionView());
    const storedPayload = JSON.parse(
      getLocalDatabase()
        .prepare("SELECT payload_json FROM motions WHERE id = ?")
        .get(motion.id)
        .payload_json
    );

    assert.equal("targetMap" in storedPayload, false);
    motionCoreSchema.parse(storedPayload);

    const company = findOrCreateCompany({
      id: "company-hydrate",
      name: "Hydrate Co",
      domain: "hydrate.example",
      websiteUrl: "https://hydrate.example",
      linkedinCompanyUrl: "https://www.linkedin.com/company/hydrate-co/",
    });
    const motionAccount = upsertMotionAccount({
      id: "motion-account-hydrate",
      motionId: motion.id,
      companyId: company.id,
      queueStatus: "researched",
      disposition: "nurture",
      packetStatus: "submitted",
      lastResearchAt: "2026-06-10T10:00:00.000Z",
      payload: {
        notes: "Account note",
        packetState: {
          kind: "company_research",
          status: "completed",
          completedAt: "2026-06-10T10:00:00.000Z",
          workerLabel: "researcher",
        },
      },
    });
    const person = resolvePersonIdentity({
      id: "person-jane-buyer",
      name: "Jane Buyer",
      contactPoints: [
        { kind: "linkedin_profile_url", value: "https://www.linkedin.com/in/jane-buyer/" },
        { kind: "email", value: "jane@hydrate.example", verificationStatus: "verified" },
      ],
    }).person;
    upsertEmployment({
      personId: person.id,
      companyId: company.id,
      title: "VP Revenue",
      source: "manual",
      observedAt: "2026-06-10T09:00:00.000Z",
    });
    const prospect = upsertProspect({
      id: "prospect-jane-buyer",
      motionId: motion.id,
      companyId: company.id,
      motionAccountId: motionAccount.id,
      personId: person.id,
      queueStatus: "selected",
      disposition: "not_a_fit",
      packetStatus: "returned",
      cadenceStatus: "ready",
      cadenceCurrentStep: "connection-request",
      cadenceNextActionDueAt: "2026-06-11T12:00:00.000Z",
      payload: {
        name: "Stale Prospect Name",
        linkedinProfileUrl: "https://www.linkedin.com/in/jane-buyer/",
        whyRelevant: "Owns revenue operations",
        sourceUrl: "https://hydrate.example/team/jane",
        observedAt: "2026-06-10T09:00:00.000Z",
        fitConfidence: "high",
        buyingCommitteeRole: "economic_buyer",
        decisionAuthority: "buys",
      },
    });
    const signal = upsertSignalMatch({
      id: "signal-match-hiring",
      motionAccountId: motionAccount.id,
      motionId: motion.id,
      companyId: company.id,
      observedAt: "2026-06-10T08:00:00.000Z",
      payload: {
        id: "signal-match-hiring",
        signalId: "signal-hiring",
        signalName: "Hiring revenue operations",
        signalScope: "company",
        summary: "Hiring a revenue operations leader",
        sourceUrl: "https://hydrate.example/jobs",
        sourceLabel: "Careers",
        observedAt: "2026-06-10T08:00:00.000Z",
        recordedAt: "2026-06-10T08:05:00.000Z",
        confidence: "high",
        evidenceSnippet: "RevOps opening",
        notes: null,
        subject: { type: "company", personName: null, personTitle: null },
      },
    });
    appendActivityEvent({
      id: "touch-jane-connection",
      dedupeKey: "touch:jane:connection",
      kind: "touch",
      personId: person.id,
      prospectId: prospect.id,
      motionId: motion.id,
      companyId: company.id,
      surface: "connection_request",
      direction: "outbound",
      outcome: "sent",
      occurredAt: "2026-06-10T12:00:00.000Z",
      payload: {
        summary: "Sent connection request",
        body: "Jane, noticed the RevOps role.",
      },
    });
    upsertProspectDraft({
      id: "draft-jane-connection",
      prospectId: prospect.id,
      motionId: motion.id,
      personId: person.id,
      surface: "connection_request",
      channel: "linkedin",
      status: "ready",
      body: "Jane, noticed the RevOps role.",
      now: "2026-06-10T11:00:00.000Z",
    });

    const hydrated = motionSchema.parse(findMotionById(motion.id));
    assert.equal(hydrated.targetMap.status, "ready");
    assert.equal(hydrated.targetMap.accounts.length, 1);
    assert.equal(hydrated.targetMap.accounts[0].companyName, "Hydrate Co");
    assert.equal(hydrated.targetMap.accounts[0].disposition, "nurture");
    assert.equal(hydrated.targetMap.accounts[0].packetStatus, "submitted");
    assert.equal(hydrated.targetMap.accounts[0].queueState.status, "ready");
    assert.equal(hydrated.targetMap.accounts[0].signalMatches[0].id, signal.id);
    assert.equal(hydrated.targetMap.accounts[0].prospects.length, 1);
    assert.equal(hydrated.targetMap.accounts[0].prospects[0].name, "Jane Buyer");
    assert.equal(hydrated.targetMap.accounts[0].prospects[0].title, "VP Revenue");
    assert.equal(hydrated.targetMap.accounts[0].prospects[0].disposition, "not_a_fit");
    assert.equal(hydrated.targetMap.accounts[0].prospects[0].packetStatus, "returned");
    assert.equal(hydrated.targetMap.accounts[0].prospects[0].queueState.status, "ready");
    assert.equal(hydrated.targetMap.accounts[0].prospects[0].email, "jane@hydrate.example");
    assert.equal(hydrated.targetMap.accounts[0].prospects[0].cadenceState.status, "ready");
    assert.equal(hydrated.targetMap.accounts[0].prospects[0].touches[0].id, "touch-jane-connection");
    assert.equal(hydrated.targetMap.accounts[0].prospects[0].drafts[0].id, "draft-jane-connection");
  });
});

function buildMotionView() {
  const now = "2026-06-10T12:00:00.000Z";
  return motionViewSchema.parse({
    id: "motion-hydrate",
    name: "Hydration Motion",
    createdAt: now,
    updatedAt: now,
    status: "active",
    offer: {
      sourceUrl: "https://hydrate.example",
      offerNotes: "Offer notes",
    },
    premise: {
      statement: "Hydration matters when rows replace blobs.",
      notes: null,
      source: "operator",
      status: "defined",
    },
    targetingProfile: {},
    suppressionPolicy: {},
    offerThesis: {
      sourceUrl: "https://hydrate.example",
      sourceTitle: "Hydrate",
      sourceDescription: "Hydrated motion test",
      sourceSummary: "Hydrated motion test",
      offerNotes: "Offer notes",
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
  });
}

/**
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
function withIsolatedExoState(callback) {
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-hydration-"));
  process.env.EXO_STATE_DIR = stateDir;
  delete process.env.EXO_HOME_STATE_DIR;

  try {
    return callback();
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir === undefined) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}
