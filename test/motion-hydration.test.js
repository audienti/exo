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
  insertUser,
  listActivityEvents,
  listDueProspectBranches,
  listOutboundCapacityAccounts,
  MotionVersionConflictError,
  resolvePersonIdentity,
  updateMotion,
  updateMotionWithRetry,
  upsertEmployment,
  upsertMotionAccount,
  upsertProspect,
  upsertProspectDraft,
  upsertSignalMatch,
} from "../src/db/database.js";
import { claimMotionProspectPacket } from "../src/core/claim-motion-prospect-packet.js";
import { claimMotionTargetAccountPacket } from "../src/core/claim-target-account-packet.js";
import { completeMotionProspectPacket } from "../src/core/complete-motion-prospect-packet.js";
import { completeMotionTargetAccountPacket } from "../src/core/complete-target-account-packet.js";
import { recordMotionProspect } from "../src/core/record-prospect.js";
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

test("motion core updates reject stale versions and preserve the winning update", () => {
  withIsolatedExoState(() => {
    const motion = insertMotion(buildMotionView());
    const copyA = findMotionById(motion.id);
    const copyB = findMotionById(motion.id);

    const storedA = updateMotion({
      ...copyA,
      status: "paused",
      updatedAt: "2026-06-10T12:01:00.000Z",
    });
    assert.equal(storedA.version, 2);
    assert.equal(storedA.status, "paused");

    assert.throws(
      () => updateMotion({
        ...copyB,
        status: "archived",
        updatedAt: "2026-06-10T12:02:00.000Z",
      }),
      MotionVersionConflictError
    );

    const stored = findMotionById(motion.id);
    assert.equal(stored.status, "paused");
    assert.equal(stored.version, 2);
  });
});

test("motion core retry helper reloads after a version conflict", () => {
  withIsolatedExoState(() => {
    const motion = insertMotion(buildMotionView());
    let attempts = 0;

    const stored = updateMotionWithRetry(motion.id, (current) => {
      attempts += 1;
      if (attempts === 1) {
        updateMotion({
          ...current,
          status: "paused",
          updatedAt: "2026-06-10T12:01:00.000Z",
        });
      }
      return {
        ...current,
        status: "archived",
        updatedAt: "2026-06-10T12:02:00.000Z",
      };
    });

    assert.equal(attempts, 2);
    assert.equal(stored.status, "archived");
    assert.equal(stored.version, 3);
  });
});

test("packet completion writes terminal dispositions and system events to normalized rows", () => {
  withIsolatedExoState(() => {
    const motion = insertMotion(buildMotionView());
    const accountCompany = buildFullCompany(findOrCreateCompany({
      id: "company-account-terminal",
      name: "Account Terminal Co",
      domain: "account-terminal.example",
      websiteUrl: "https://account-terminal.example",
    }), motion.id);
    const claimedAccountMotion = claimMotionTargetAccountPacket(motion, accountCompany, {
      workerLabel: "account-worker",
    });

    completeMotionTargetAccountPacket(claimedAccountMotion, accountCompany, {
      workerLabel: "account-worker",
      nextStatus: "suppressed",
      notes: "No longer a target.",
    });

    const accountRow = getLocalDatabase()
      .prepare("SELECT * FROM motion_accounts WHERE motion_id = ? AND company_id = ?")
      .get(motion.id, accountCompany.id);
    assert.equal(accountRow.queue_status, "suppressed");
    assert.equal(accountRow.disposition, "no_longer_target");
    assert.equal(accountRow.packet_status, null);
    assert.equal(accountRow.packet_claimed_by, null);
    assert.equal(
      listActivityEvents({ motionId: motion.id, companyId: accountCompany.id })
        .filter((event) => event.kind === "system" && event.payload?.subject === "account")
        .length,
      1
    );

    const prospectCompany = buildFullCompany(findOrCreateCompany({
      id: "company-prospect-terminal",
      name: "Prospect Terminal Co",
      domain: "prospect-terminal.example",
      websiteUrl: "https://prospect-terminal.example",
    }), motion.id);
    const prospectMotion = recordMotionProspect(findMotionById(motion.id), prospectCompany, {
      name: "Pat Packet",
      title: "VP Sales",
      linkedinProfileUrl: "https://www.linkedin.com/in/pat-packet",
      whyRelevant: "Owns packet completion proof.",
    });
    const prospect = prospectMotion.targetMap.accounts
      .find((account) => account.companyId === prospectCompany.id)
      ?.prospects[0];
    assert.ok(prospect);
    const claimedProspectMotion = claimMotionProspectPacket(prospectMotion, prospectCompany, {
      prospectId: prospect.id,
      workerLabel: "prospect-worker",
    });

    completeMotionProspectPacket(claimedProspectMotion, prospectCompany, {
      prospectId: prospect.id,
      workerLabel: "prospect-worker",
      nextStatus: "exhausted",
      notes: "No viable path remains.",
    });

    const prospectRow = getLocalDatabase()
      .prepare("SELECT * FROM prospects WHERE id = ?")
      .get(prospect.id);
    assert.equal(prospectRow.queue_status, "exhausted");
    assert.equal(prospectRow.disposition, "exhausted");
    assert.equal(prospectRow.packet_status, null);
    assert.equal(prospectRow.packet_claimed_by, null);
    assert.equal(
      listActivityEvents({ prospectId: prospect.id })
        .filter((event) => event.kind === "system" && event.payload?.subject === "prospect")
        .length,
      1
    );
  });
});

test("due prospect branch scan uses normalized active dispositions and hydrates the selected branch", () => {
  withIsolatedExoState(() => {
    const motion = insertMotion(buildMotionView());
    const userId = "user-due-branch";
    insertUser(buildExecutionUser(userId));
    const active = seedDueProspectBranch({
      motionId: motion.id,
      companyId: "company-due-active",
      companyName: "Due Active Co",
      personId: "person-due-active",
      prospectId: "prospect-due-active",
      name: "Avery Active",
      title: "VP Revenue",
      executionUserId: userId,
      accountDisposition: "active",
      prospectDisposition: "active",
      dueAt: "2026-06-10T11:00:00.000Z",
    });
    seedDueProspectBranch({
      motionId: motion.id,
      companyId: "company-due-account-terminal",
      companyName: "Terminal Account Co",
      personId: "person-due-account-terminal",
      prospectId: "prospect-due-account-terminal",
      name: "Terry Terminal",
      title: "COO",
      executionUserId: userId,
      accountDisposition: "no_longer_target",
      prospectDisposition: "active",
      dueAt: "2026-06-10T10:00:00.000Z",
    });
    seedDueProspectBranch({
      motionId: motion.id,
      companyId: "company-due-prospect-nurture",
      companyName: "Prospect Nurture Co",
      personId: "person-due-prospect-nurture",
      prospectId: "prospect-due-prospect-nurture",
      name: "Nora Nurture",
      title: "CRO",
      executionUserId: userId,
      accountDisposition: "active",
      prospectDisposition: "nurture",
      dueAt: "2026-06-10T09:00:00.000Z",
    });

    const branches = listDueProspectBranches({
      executionUserId: userId,
      now: "2026-06-10T12:00:00.000Z",
      limit: 5,
    });

    assert.equal(branches.length, 1);
    assert.equal(branches[0].motion.id, motion.id);
    assert.equal(branches[0].account.companyId, active.company.id);
    assert.equal(branches[0].account.prospects.length, 1);
    assert.equal(branches[0].prospect.id, active.prospect.id);
    assert.equal(branches[0].prospect.name, "Avery Active");
    assert.equal(branches[0].prospect.title, "VP Revenue");
    assert.equal(branches[0].prospect.cadenceState.status, "ready");
  });
});

test("outbound capacity account scan includes scoped empty accounts and excludes terminal branches", () => {
  withIsolatedExoState(() => {
    const motion = insertMotion(buildMotionView());
    const userId = "user-capacity-scan";
    insertUser(buildExecutionUser(userId));
    const emptyCompany = findOrCreateCompany({
      id: "company-capacity-empty",
      name: "Capacity Empty Co",
      domain: "capacity-empty.example",
    });
    upsertMotionAccount({
      id: "motion-account-capacity-empty",
      motionId: motion.id,
      companyId: emptyCompany.id,
      executionUserId: userId,
      queueStatus: "discovered",
      disposition: "active",
    });
    const active = seedDueProspectBranch({
      motionId: motion.id,
      companyId: "company-capacity-active",
      companyName: "Capacity Active Co",
      personId: "person-capacity-active",
      prospectId: "prospect-capacity-active",
      name: "Casey Capacity",
      title: "VP Sales",
      executionUserId: userId,
      accountDisposition: "active",
      prospectDisposition: "active",
      dueAt: "2026-06-10T11:00:00.000Z",
    });
    seedDueProspectBranch({
      motionId: motion.id,
      companyId: "company-capacity-terminal-account",
      companyName: "Capacity Terminal Account Co",
      personId: "person-capacity-terminal-account",
      prospectId: "prospect-capacity-terminal-account",
      name: "Tara Terminal",
      title: "COO",
      executionUserId: userId,
      accountDisposition: "no_longer_target",
      prospectDisposition: "active",
      dueAt: "2026-06-10T11:00:00.000Z",
    });
    seedDueProspectBranch({
      motionId: motion.id,
      companyId: "company-capacity-terminal-prospect",
      companyName: "Capacity Terminal Prospect Co",
      personId: "person-capacity-terminal-prospect",
      prospectId: "prospect-capacity-terminal-prospect",
      name: "Nina Nurture",
      title: "CRO",
      executionUserId: userId,
      accountDisposition: "active",
      prospectDisposition: "nurture",
      dueAt: "2026-06-10T11:00:00.000Z",
    });

    const branches = listOutboundCapacityAccounts({
      executionUserId: userId,
    });

    assert.deepEqual(
      branches.map((branch) => branch.account.companyId),
      [emptyCompany.id, active.company.id, "company-capacity-terminal-prospect"]
    );
    assert.equal(branches[0].account.prospects.length, 0);
    assert.equal(branches[1].account.prospects.length, 1);
    assert.equal(branches[1].account.prospects[0].id, active.prospect.id);
    assert.equal(branches[2].account.prospects.length, 0);
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
 * @param {any} company
 * @param {string} motionId
 */
function buildFullCompany(company, motionId) {
  return {
    ...company,
    notes: company.notes ?? null,
    tags: company.tags ?? [],
    motionIds: company.motionIds ?? [motionId],
    engagementProfileAssignment: company.engagementProfileAssignment ?? null,
    engagementUserAssignment: company.engagementUserAssignment ?? null,
  };
}

/**
 * @param {{
 *   motionId: string,
 *   companyId: string,
 *   companyName: string,
 *   personId: string,
 *   prospectId: string,
 *   name: string,
 *   title: string,
 *   executionUserId: string,
 *   accountDisposition: string,
 *   prospectDisposition: string,
 *   dueAt: string
 * }} input
 */
function seedDueProspectBranch(input) {
  const company = findOrCreateCompany({
    id: input.companyId,
    name: input.companyName,
    domain: `${input.companyId}.example`,
  });
  const motionAccount = upsertMotionAccount({
    id: `motion-account-${input.companyId}`,
    motionId: input.motionId,
    companyId: company.id,
    executionUserId: input.executionUserId,
    queueStatus: "researched",
    disposition: input.accountDisposition,
  });
  const person = resolvePersonIdentity({
    id: input.personId,
    name: input.name,
    contactPoints: [{ kind: "linkedin_public_id", value: input.personId.replace(/^person-/, "") }],
  }).person;
  upsertEmployment({
    personId: person.id,
    companyId: company.id,
    title: input.title,
    source: "test",
    observedAt: "2026-06-10T08:00:00.000Z",
  });
  const prospect = upsertProspect({
    id: input.prospectId,
    motionId: input.motionId,
    companyId: company.id,
    motionAccountId: motionAccount.id,
    personId: person.id,
    queueStatus: "selected",
    disposition: input.prospectDisposition,
    cadenceStatus: "ready",
    cadenceCurrentStep: "connection-request",
    cadenceNextActionDueAt: input.dueAt,
    payload: {
      name: input.name,
      whyRelevant: "Due branch test.",
      cadenceState: {
        nextAction: `Send ${input.name} a connection request.`,
      },
    },
  });

  return { company, motionAccount, person, prospect };
}

/**
 * @param {string} id
 */
function buildExecutionUser(id) {
  return {
    id,
    createdAt: "2026-06-10T08:00:00.000Z",
    updatedAt: "2026-06-10T08:00:00.000Z",
    label: "Due Branch User",
    owner: "operator",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00",
    },
    accounts: [],
    harnessConnections: [],
  };
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
