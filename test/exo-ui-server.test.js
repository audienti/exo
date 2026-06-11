// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  buildUiStateRevision,
  renderRoute,
  resetWorkspaceProjectionCacheForTests,
  resolveWorkspaceProjectionForUi,
  startExoUiServer,
} from "../src/cli/exo-ui-server.js";
import { insertCompany, insertMotion, insertUser } from "../src/db/database.js";
import { buildAgentRunLockDir } from "../src/lib/agent-run-lock.js";
import {
  buildCompanyView,
  buildMotionView,
  buildProspect,
  buildTargetAccount,
  fixtureNow,
} from "./support/normalized-fixtures.js";

/**
 * @param {() => Promise<void>} callback
 */
async function withSeededRouteUser(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-route-user-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.EXO_HOME_STATE_DIR = process.env.EXO_STATE_DIR;

  insertUser({
    id: "user-1",
    createdAt: "2026-06-07T10:00:00.000Z",
    updatedAt: "2026-06-07T10:00:00.000Z",
    label: "Route User",
    owner: "William",
    notes: null,
    workingHours: {
      mode: "scheduled",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "07:00",
      endLocalTime: "18:00",
    },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-07T10:00:00.000Z",
        updatedAt: "2026-06-07T10:00:00.000Z",
        capability: "linkedin",
        handle: "route-user",
        label: "Route LinkedIn",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        providerAccountId: "acct-route-user",
        preferred: true,
        automationControls: {
          weeklyQuotas: {
            profileVisits: null,
            invitations: null,
            messages: null,
          },
        },
        metadata: null,
        notes: null,
        inboundSync: { surfaces: [] },
      },
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: "2026-06-07T10:00:00.000Z",
        updatedAt: "2026-06-07T10:00:00.000Z",
        runtime: "codex",
        connector: "unipile",
        label: null,
        status: "available",
        notes: null,
      },
    ],
    managedAccountExclusions: [],
    inboundIgnoreRules: [],
  });

  try {
    await callback();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
  }
}

test("ui state revision changes when agent runtime artifacts change without a DB write", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-rev-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const stateDir = path.join(tmpDir, ".exo");
  fs.mkdirSync(stateDir, { recursive: true });

  const dbPath = path.join(stateDir, "exo.db");
  fs.writeFileSync(dbPath, "seed");

  const statePaths = {
    localDatabasePath: dbPath,
    homeDatabasePath: dbPath,
    repoPolicyPath: path.join(tmpDir, "repo-policy.json"),
    homePolicyPath: path.join(tmpDir, "home-policy.json"),
    homeStateDir: stateDir,
  };

  const rev1 = buildUiStateRevision(statePaths);

  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(path.join(stateDir, "agent-last-pass.json"), JSON.stringify({ status: "blocked" }));
  const rev2 = buildUiStateRevision(statePaths);
  assert.notEqual(rev2, rev1);

  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(path.join(stateDir, "agent-host-state.json"), JSON.stringify({
    browserBackoff: {
      execution: {
        unavailableUntil: "2099-06-04T10:22:27.465Z",
        reason: "blocked",
      },
    },
  }));
  const rev3 = buildUiStateRevision(statePaths);
  assert.notEqual(rev3, rev2);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const lockDir = buildAgentRunLockDir({ stateDir });
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "pid"), "4242\n");
  const rev4 = buildUiStateRevision(statePaths);
  assert.notEqual(rev4, rev3);

  fs.rmSync(lockDir, { recursive: true, force: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const laneLockDir = buildAgentRunLockDir({ stateDir, lane: "transport" });
  fs.mkdirSync(laneLockDir, { recursive: true });
  fs.writeFileSync(path.join(laneLockDir, "pid"), "4242\n");
  const rev5 = buildUiStateRevision(statePaths);
  assert.notEqual(rev5, rev4);
});

test("ui projection cache reuses the same derived projection for the same state revision", async (t) => {
  resetWorkspaceProjectionCacheForTests();
  t.after(() => resetWorkspaceProjectionCacheForTests());

  let buildCount = 0;
  const input = {
    userId: "user-1",
    capability: "linkedin",
    regenerateCommand: "exo ui",
  };
  const buildProjection = (args) => {
    buildCount += 1;
    return {
      data: {
        user: { id: args.userId },
        generatedAt: "2026-06-05T13:00:00.000Z",
      },
      html: `<p>${args.userId}</p>`,
    };
  };

  const first = await resolveWorkspaceProjectionForUi(input, {
    buildProjection,
    stateRevision: "rev-1",
  });
  const second = await resolveWorkspaceProjectionForUi(input, {
    buildProjection,
    stateRevision: "rev-1",
  });

  assert.equal(buildCount, 1);
  assert.equal(second, first);

  const third = await resolveWorkspaceProjectionForUi(input, {
    buildProjection,
    stateRevision: "rev-2",
  });
  assert.equal(buildCount, 2);
  assert.notEqual(third, first);
});

test("ui projection cache collapses concurrent builds for the same state revision", async (t) => {
  resetWorkspaceProjectionCacheForTests();
  t.after(() => resetWorkspaceProjectionCacheForTests());

  let buildCount = 0;
  const input = {
    userId: "user-1",
    capability: "linkedin",
    regenerateCommand: "exo ui",
  };
  const buildProjection = async () => {
    buildCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      data: {
        user: { id: "user-1" },
        generatedAt: "2026-06-05T13:00:00.000Z",
      },
      html: "<p>cached</p>",
    };
  };

  const [first, second] = await Promise.all([
    resolveWorkspaceProjectionForUi(input, {
      buildProjection,
      stateRevision: "rev-1",
    }),
    resolveWorkspaceProjectionForUi(input, {
      buildProjection,
      stateRevision: "rev-1",
    }),
  ]);

  assert.equal(buildCount, 1);
  assert.equal(first, second);
});

test("ui projection cache invalidates when a second WAL-backed motion write changes the state revision", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-wal-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.EXO_HOME_STATE_DIR = process.env.EXO_STATE_DIR;
  resetWorkspaceProjectionCacheForTests();

  t.after(() => {
    resetWorkspaceProjectionCacheForTests();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
  });

  const makeMotion = (suffix) => ({
    id: randomUUID(),
    name: `test-motion-${suffix}`,
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    offer: {
      sourceUrl: `https://example.com/${suffix}`,
      title: `Example ${suffix}`,
      summary: null,
    },
    premise: {
      kind: "statement",
      summary: `Test premise ${suffix}`,
    },
    audiences: [],
    signals: [],
    targetMap: { accounts: [] },
    stakeholderMap: { people: [] },
    suppressionPolicy: {},
    execution: {},
    notes: null,
  });

  insertMotion(makeMotion("one"));
  const firstRevision = buildUiStateRevision();
  let buildCount = 0;
  const buildProjection = () => {
    buildCount += 1;
    return {
      data: {
        user: { id: "user-1" },
        generatedAt: "2026-06-05T13:00:00.000Z",
      },
      html: `<p>${buildCount}</p>`,
    };
  };

  await resolveWorkspaceProjectionForUi({
    userId: "user-1",
    capability: "linkedin",
    regenerateCommand: "exo ui",
  }, {
    buildProjection,
  });
  assert.equal(buildCount, 1);

  await new Promise((resolve) => setTimeout(resolve, 20));
  insertMotion(makeMotion("two"));
  const secondRevision = buildUiStateRevision();

  assert.notEqual(secondRevision, firstRevision);

  await resolveWorkspaceProjectionForUi({
    userId: "user-1",
    capability: "linkedin",
    regenerateCommand: "exo ui",
  }, {
    buildProjection,
  });
  assert.equal(buildCount, 2);
});

test("person route preserves the scaffold compose draft instead of overwriting it during render", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-person-route-user-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.EXO_HOME_STATE_DIR = process.env.EXO_STATE_DIR;
  insertUser({
    id: "user-1",
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
    label: "person-user",
    owner: "operator",
    notes: null,
    workingHours: { mode: "always", timezone: "America/New_York", weekdays: ["mon"], startLocalTime: "09:00", endLocalTime: "17:00" },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T10:00:00.000Z",
        capability: "linkedin",
        handle: "person-user",
        label: "Person User",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        providerAccountId: "acct-person-user",
        preferred: true,
        automationControls: { weeklyQuotas: { profileVisits: null, invitations: null, messages: null } },
        metadata: null,
        notes: null,
        inboundSync: { surfaces: [] },
      },
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T10:00:00.000Z",
        runtime: "codex",
        connector: "unipile",
        label: null,
        status: "available",
        notes: null,
      },
    ],
    managedAccountExclusions: [],
    inboundIgnoreRules: [],
  });

  const composeDraft = { subject: null, body: "" };
  const person = {
    id: "person-1",
    matchedProspect: false,
    hasDurableIdentity: true,
    suggestedSurface: "inbound_reply",
  };
  Object.defineProperty(person, "composeDraft", {
    enumerable: true,
    configurable: true,
    get() {
      return composeDraft;
    },
    set() {
      throw new Error("composeDraft should not be reassigned during person route render");
    },
  });

  try {
    const html = await renderRoute("/people/person-1", { userId: "user-1", capability: "linkedin" }, {
      listInboundObservations: () => [],
      listMotions: () => [],
      listCompanies: () => [],
      buildPersonView: () => person,
      findTransitionMotion: () => null,
      renderPersonPage: (receivedPerson, meta) => {
        assert.equal(receivedPerson, person);
        assert.equal(receivedPerson.composeDraft, composeDraft);
        assert.equal(meta.userId, "user-1");
        assert.equal(meta.transitionMotionId, null);
        assert.deepEqual(meta.motions, []);
        return "<html>person</html>";
      },
      resolveWorkspaceProjectionForUi: async () => {
        throw new Error("person route should return before building the shared workspace projection");
      },
    });

    assert.equal(html, "<html>person</html>");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
  }
});

test("person route builds claim motion choices with offer, premise, and status detail", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-person-claim-motions-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.EXO_HOME_STATE_DIR = process.env.EXO_STATE_DIR;
  insertUser({
    id: "user-1",
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
    label: "person-user",
    owner: "operator",
    notes: null,
    workingHours: { mode: "always", timezone: "America/New_York", weekdays: ["mon"], startLocalTime: "09:00", endLocalTime: "17:00" },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T10:00:00.000Z",
        capability: "linkedin",
        handle: "person-user",
        label: "Person User",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        providerAccountId: "acct-person-user",
        preferred: true,
        automationControls: { weeklyQuotas: { profileVisits: null, invitations: null, messages: null } },
        metadata: null,
        notes: null,
        inboundSync: { surfaces: [] },
      },
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T10:00:00.000Z",
        runtime: "codex",
        connector: "unipile",
        label: null,
        status: "available",
        notes: null,
      },
    ],
    managedAccountExclusions: [],
    inboundIgnoreRules: [],
  });

  const transition = {
    id: "transition-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    name: "transition-inbound-backlog",
    status: "active",
    offer: { sourceUrl: "https://transition.exo.local/inbound-backlog", offerNotes: "" },
    premise: {
      statement: "Continue and reconcile relationships started before Exo, then re-home them into real motions once they are understood.",
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
      sourceUrl: "https://transition.exo.local/inbound-backlog",
      sourceTitle: null,
      sourceDescription: null,
      sourceSummary: "",
      offerNotes: null,
      problemThesis: null,
      buyerImpactThesis: null,
      likelyTriggerThesis: null,
      likelyRoleThesis: null,
      likelySegmentThesis: null,
      status: "needs_inference",
    },
    audienceHypotheses: [],
    signals: [],
    targetMap: { status: "pending", accounts: [], segments: [] },
    stakeholderMap: { status: "pending", stakeholders: [] },
    motionPlan: { status: "pending", variants: [] },
    nextSteps: [],
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
  };
  const motion = {
    id: "motion-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    name: "harsh-spare-mongoose",
    status: "draft",
    offer: { sourceUrl: "https://www.knitit.ai/", offerNotes: "" },
    premise: {
      statement: "This offer matters when GTM teams need governed outbound work instead of a pile of disconnected prospecting tasks.",
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
      sourceUrl: "https://www.knitit.ai/",
      sourceTitle: "Knit",
      sourceDescription: null,
      sourceSummary: "",
      offerNotes: null,
      problemThesis: null,
      buyerImpactThesis: null,
      likelyTriggerThesis: null,
      likelyRoleThesis: null,
      likelySegmentThesis: null,
      status: "needs_inference",
    },
    audienceHypotheses: [],
    signals: [],
    targetMap: { status: "pending", accounts: [], segments: [] },
    stakeholderMap: { status: "pending", stakeholders: [] },
    motionPlan: { status: "pending", variants: [] },
    nextSteps: [],
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
  };

  try {
    const html = await renderRoute("/people/person-1", { userId: "user-1", capability: "linkedin" }, {
      listInboundObservations: () => [],
      listMotions: () => [transition, motion],
      listCompanies: () => [],
      buildPersonView: () => ({ id: "person-1", matchedProspect: false, hasDurableIdentity: true, suggestedSurface: null }),
      findTransitionMotion: () => transition,
      renderPersonPage: (_person, meta) => {
        assert.deepEqual(meta.motions, [
          {
            id: "transition-1",
            name: "transition-inbound-backlog",
            offerLabel: "Transition backlog",
            premise: "Continue and reconcile relationships started before Exo, then re-home them into real motions once they are understood.",
            status: "active",
            statusLabel: "Active",
          },
          {
            id: "motion-1",
            name: "harsh-spare-mongoose",
            offerLabel: "Knit",
            premise: "This offer matters when GTM teams need governed outbound work instead of a pile of disconnected prospecting tasks.",
            status: "draft",
            statusLabel: "Draft",
          },
        ]);
        return "<html>person-claim-choices</html>";
      },
      resolveWorkspaceProjectionForUi: async () => {
        throw new Error("person route should return before building the shared workspace projection");
      },
    });

    assert.equal(html, "<html>person-claim-choices</html>");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
  }
});

test("cleanup route renders only stale global-intake claim backlog and exposes the sidebar route", async () => {
  await withSeededRouteUser(async () => {
    const html = await renderRoute("/cleanup", { userId: "user-1", capability: "linkedin" }, {
      resolveWorkspaceProjectionForUi: async () => ({
        data: {
          user: { id: "user-1", label: "william-main", owner: "William" },
          generatedAt: "2026-06-05T13:00:00.000Z",
          reviewItems: [
            {
              id: "obs-stale",
              observedAt: "2026-01-01T13:00:00.000Z",
              ageDays: 155,
              state: "needs_claim",
              priority: "high",
              actorName: "Mike Agron",
              actorTitle: "Advisor",
              actorCompanyName: "Legacy Co",
              actorProfileUrl: "https://www.linkedin.com/in/mike-agron/",
              actorAvatarUrl: null,
              summary: "Mike Agron has unread LinkedIn message activity.",
              recommendedAction: "Claim Mike Agron into this workspace's transition backlog if this thread belongs here.",
              whyItMatters: "This inbound person is still global intake.",
              surfaceKey: "linkedin-messaging-inbox",
              previewLabel: "Latest message",
              previewSubject: "Legacy follow-up",
              previewText: "Checking whether this still belongs here.",
              prospect: null,
            },
            {
              id: "obs-fresh",
              observedAt: "2026-06-01T13:00:00.000Z",
              ageDays: 4,
              state: "needs_claim",
              priority: "high",
              actorName: "Jordan Cipolla",
              actorTitle: "Founder",
              actorCompanyName: "Current Co",
              actorProfileUrl: "https://www.linkedin.com/in/jordan-cipolla/",
              actorAvatarUrl: null,
              summary: "Jordan Cipolla has unread LinkedIn message activity.",
              recommendedAction: "Claim Jordan Cipolla into this workspace's transition backlog if this thread belongs here.",
              whyItMatters: "This inbound person is still global intake.",
              surfaceKey: "linkedin-messaging-inbox",
              previewLabel: null,
              previewSubject: null,
              previewText: null,
              prospect: null,
            },
          ],
        },
        html: "",
      }),
    });

    assert.match(html, /Clean up/i);
    assert.match(html, /href="\/cleanup"/);
    assert.match(html, /Mike Agron/);
    assert.match(html, /older than 60 days/i);
    assert.match(html, /Ignore sender/);
    assert.match(html, /data-exo-writer="ignoreInboundObservation"/);
    assert.doesNotMatch(html, /class="exo-action" data-exo-writer="ignoreInboundObservation"/);
    assert.doesNotMatch(html, /Jordan Cipolla/);
  });
});

test("cleanup route hides the cleanup sidebar item when no stale cleanup work exists", async () => {
  await withSeededRouteUser(async () => {
    const html = await renderRoute("/cleanup", { userId: "user-1", capability: "linkedin" }, {
      resolveWorkspaceProjectionForUi: async () => ({
        data: {
          user: { id: "user-1", label: "william-main", owner: "William" },
          generatedAt: "2026-06-05T13:00:00.000Z",
          reviewItems: [],
        },
        html: "",
      }),
    });

    assert.match(html, /No stale global-intake cleanup is waiting\./i);
    assert.doesNotMatch(html, /href="\/cleanup"/);
  });
});

test("prospects route applies the q search filter and preserves it in rendered links", async () => {
  await withSeededRouteUser(async () => {
    const html = await renderRoute("/prospects?q=procurement", { userId: "user-1", capability: "linkedin" }, {
      resolveWorkspaceProjectionForUi: async () => ({
        data: {
          user: { id: "user-1", label: "william-main", owner: "William" },
          generatedAt: "2026-06-06T13:00:00.000Z",
          prospectPrepLanes: [{
            key: "selected",
            items: [
              {
                prospectId: "prospect-1",
                name: "Lina Park",
                title: "Director of Procurement",
                companyId: "company-1",
                companyName: "ExampleCo",
                motionId: "motion-1",
                motionName: "motion-one",
                whyRelevant: "Relevant now.",
                contactPoints: [],
                touches: [],
                signalMatches: [{ summary: "Recent buying-committee change." }],
                cadenceState: { status: "ready", currentStep: "done" },
              },
              {
                prospectId: "prospect-2",
                name: "Marco Diaz",
                title: "VP Finance",
                companyId: "company-2",
                companyName: "Northstar",
                motionId: "motion-1",
                motionName: "motion-one",
                whyRelevant: "Relevant later.",
                contactPoints: [],
                touches: [],
                signalMatches: [{ summary: "Risk tooling review underway." }],
                cadenceState: { status: "ready", currentStep: "done" },
              },
            ],
          }],
          engagementLanes: [],
          motionDetails: [],
          reviewItems: [],
        },
        html: "",
      }),
    });

    assert.match(html, /value="procurement"/);
    assert.match(html, /Lina Park/);
    assert.match(html, /href="\/prospects\/prospect-1\?q=procurement"/);
    assert.doesNotMatch(html, /Marco Diaz/);
  });
});

test("motions route passes execution users into the new-motion intake form", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-motions-route-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.EXO_HOME_STATE_DIR = process.env.EXO_STATE_DIR;

  insertUser({
    id: "user-1",
    createdAt: "2026-06-07T10:00:00.000Z",
    updatedAt: "2026-06-07T10:00:00.000Z",
    label: "Launch User",
    owner: "William",
    notes: null,
    workingHours: {
      mode: "scheduled",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "07:00",
      endLocalTime: "18:00",
    },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-07T10:00:00.000Z",
        updatedAt: "2026-06-07T10:00:00.000Z",
        capability: "linkedin",
        handle: "launch-user",
        label: "Launch LinkedIn",
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        harnessConnectionId: null,
        providerAccountId: null,
        preferred: true,
        automationControls: {
          weeklyQuotas: {
            profileVisits: null,
            invitations: null,
            messages: null,
          },
        },
        metadata: null,
        notes: null,
        inboundSync: { surfaces: [] },
      },
    ],
    harnessConnections: [],
    inboundIgnoreRules: [],
  });

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
  });

  const html = await renderRoute("/motions", { userId: "user-1", capability: "linkedin" }, {
    resolveWorkspaceProjectionForUi: async () => ({
      data: {
        user: { id: "user-1", label: "Launch User", owner: "William" },
        generatedAt: "2026-06-07T10:00:00.000Z",
        motionSummaries: [],
        motionDetails: [],
      },
      html: "",
    }),
  });

  assert.match(html, /name="userId"/);
  assert.match(html, /<option value="user-1" selected>Launch User<\/option>/);
  assert.doesNotMatch(html, /No execution users available/);
});

test("motion detail route renders governed account, prospect, and packet review actions", async () => {
  await withSeededRouteUser(async () => {
    const motionId = "motion-lifecycle-ui";
    const companyId = "company-lifecycle-ui";
    const prospectId = "prospect-lifecycle-ui";
    const company = buildCompanyView({
      id: companyId,
      createdAt: fixtureNow,
      updatedAt: fixtureNow,
      name: "Lifecycle UI Co",
      domain: "lifecycle-ui.example",
      linkedinCompanyUrl: null,
      websiteUrl: "https://lifecycle-ui.example",
    }, { motionIds: [motionId] });
    const prospect = buildProspect({
      id: prospectId,
      name: "Priya Lifecycle",
      title: "VP Revenue",
      packetStatus: "submitted",
      packetState: {
        kind: "prospect_research",
        status: "submitted",
        workerLabel: "prospect-worker",
        claimedAt: "2026-06-11T10:00:00.000Z",
        completedAt: "2026-06-11T10:20:00.000Z",
        proposal: {
          kind: "prospect_research",
          action: "advance",
          nextStatus: null,
          disposition: null,
          reason: "Prospect branch is ready for review.",
          proposedAt: "2026-06-11T10:20:00.000Z",
        },
      },
    });
    const account = buildTargetAccount({
      companyId,
      companyName: company.name,
      domain: company.domain,
      websiteUrl: company.websiteUrl,
      queueState: {
        status: "researched",
        source: "manual",
        updatedAt: fixtureNow,
        notes: null,
      },
      packetStatus: "submitted",
      packetState: {
        kind: "company_research",
        status: "submitted",
        workerLabel: "account-worker",
        claimedAt: "2026-06-11T09:00:00.000Z",
        completedAt: "2026-06-11T09:30:00.000Z",
        notes: "Account evidence is ready.",
        proposal: {
          kind: "company_research",
          action: "advance",
          nextStatus: "researched",
          disposition: null,
          reason: "Company has enough evidence to advance.",
          proposedAt: "2026-06-11T09:30:00.000Z",
        },
      },
      prospects: [prospect],
    });
    const motion = buildMotionView({
      id: motionId,
      name: "lifecycle-motion",
      targetMap: {
        status: "ready",
        accounts: [account],
        segments: [],
      },
    });
    insertCompany(company);
    insertMotion(motion);

    const html = await renderRoute(`/motions/${motionId}`, { userId: "user-1", capability: "linkedin" }, {
      resolveWorkspaceProjectionForUi: async () => ({
        data: {
          user: { id: "user-1", label: "william-main", owner: "William" },
          generatedAt: "2026-06-11T12:00:00.000Z",
          motionSummaries: [{
            id: motionId,
            name: "lifecycle-motion",
            status: "active",
            overallStage: "targeting-ready",
            companyCount: 1,
            prospectCount: 1,
            dueNowCount: 0,
            readyToEngage: true,
          }],
          motionDetails: [{
            motionId,
            motionName: "lifecycle-motion",
            motionStatus: "active",
            overallStage: "targeting-ready",
            strategyState: { tone: "success" },
            truth: "checked",
            offer: { title: "Lifecycle offer", url: "https://example.com/lifecycle", summary: "" },
            premise: { statement: "Lifecycle matters when active prospects must be explicit.", status: "checked", source: "operator" },
            audiences: [],
            signals: [],
            companies: [{
              companyId,
              companyName: company.name,
              domain: company.domain,
              websiteUrl: company.websiteUrl,
              prospectCount: 1,
              matchedSignalIndexes: [1],
              matchedSignals: [{ summary: "Lifecycle signal." }],
              executionIdentity: { status: "pinned-ready" },
            }],
            backlogCompanies: [],
            people: [{
              prospectId,
              name: prospect.name,
              title: prospect.title,
              companyName: company.name,
              signalLabel: "Lifecycle signal.",
              branchState: { key: "ready", label: "Ready" },
              ownerLabel: "william-main",
            }],
            plan: { nextSteps: [], dueNowCount: 0, messageTestReadyCount: 0, readyToSendCount: 0, packetStatus: "ready" },
          }],
          reviewItems: [],
        },
        html: "",
      }),
    });

    assert.match(html, /Lifecycle UI Co/);
    assert.match(html, /Priya Lifecycle/);
    assert.match(html, /data-exo-writer="setAccountDisposition"/);
    assert.match(html, /data-exo-writer="setProspectDisposition"/);
    assert.match(html, /Packet review/);
    assert.match(html, /company_research:company-lifecycle-ui/);
    assert.match(html, /data-exo-writer="resolvePacketReview"/);
    assert.match(html, /Accept/);
    assert.match(html, /Amend/);
    assert.match(html, /Return/);
    assert.match(html, /No longer target/);
  });
});

test("user-specific connections route renders the target user's connections view", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-user-connections-route-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.EXO_HOME_STATE_DIR = process.env.EXO_STATE_DIR;

  insertUser({
    id: "user-1",
    createdAt: "2026-06-07T10:00:00.000Z",
    updatedAt: "2026-06-07T10:00:00.000Z",
    label: "Ali Umair",
    owner: "Ali",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "07:00",
      endLocalTime: "18:00",
    },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-07T10:00:00.000Z",
        updatedAt: "2026-06-07T10:00:00.000Z",
        capability: "linkedin",
        handle: "aliumairdev",
        label: "Ali Umair",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "hc-1",
        providerAccountId: "acct-ali",
        preferred: true,
        automationControls: {
          weeklyQuotas: {
            profileVisits: null,
            invitations: 25,
            messages: null,
          },
        },
        metadata: null,
        notes: null,
        inboundSync: { surfaces: [] },
      },
    ],
    harnessConnections: [],
    inboundIgnoreRules: [],
  });

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
  });

  const html = await renderRoute("/users/user-1/connections?account=account-1", { userId: "user-1", capability: "linkedin" }, {
    resolveWorkspaceProjectionForUi: async () => ({
      data: {
        user: { id: "user-1", label: "Ali Umair", owner: "Ali" },
        generatedAt: "2026-06-07T10:00:00.000Z",
        observations: [],
        reviewItems: [],
        agentQueue: { tasks: [], items: [] },
        truthAccounts: [
          {
            accountId: "account-1",
            capability: "linkedin",
            handle: "aliumairdev",
            label: "Ali Umair",
            preferred: true,
            surfaces: [
              {
                key: "linkedin-sent-invitations",
                label: "Sent Invitations",
                lastRunStatus: "success",
                lastSyncedAt: "2026-06-07T10:00:00.000Z",
                lastObservedAt: "2026-06-07T10:00:00.000Z",
                lastItemCount: 0,
                meta: {},
              },
            ],
          },
        ],
      },
      html: "",
    }),
  });

  assert.match(html, /Viewing Ali Umair/);
  assert.match(html, /Account Ali Umair · aliumairdev/);
});

test("operator route renders onboarding instead of the workspace projection on a cold-start store", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-onboarding-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousCodexHome = process.env.CODEX_HOME;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.CODEX_HOME = path.join(tempDir, "empty-codex-home");
  fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousCodexHome == null) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  const html = await renderRoute("/operator", { userId: null, capability: "linkedin" }, {
    resolveWorkspaceProjectionForUi: async () => {
      throw new Error("cold-start onboarding should return before building the workspace projection");
    },
  });

  assert.match(html, /Onboarding/);
  assert.match(html, /Install scope/);
  assert.match(html, /local-folder/i);
  assert.match(html, /First outreach user/);
  assert.match(html, /Who is the first user we(?:&#39;|')re managing in Exo\?/);
});

test("operator route recovers to the one execution-ready user when the bound user is missing", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-missing-user-recovery-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.EXO_HOME_STATE_DIR = process.env.EXO_STATE_DIR;

  insertUser({
    id: "user-ready",
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
    label: "ready-user",
    owner: "operator",
    notes: null,
    workingHours: { mode: "always", timezone: "America/New_York", weekdays: ["mon"], startLocalTime: "09:00", endLocalTime: "17:00" },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T10:00:00.000Z",
        capability: "linkedin",
        handle: "ready-user",
        label: "Ready User",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        providerAccountId: "acct-ready",
        preferred: true,
        automationControls: { weeklyQuotas: { profileVisits: null, invitations: null, messages: null } },
        metadata: null,
        notes: null,
        inboundSync: { surfaces: [] },
      },
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T10:00:00.000Z",
        runtime: "codex",
        connector: "unipile",
        label: null,
        status: "available",
        notes: null,
      },
    ],
    managedAccountExclusions: [],
    inboundIgnoreRules: [],
  });

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
  });

  let projectedUserId = null;
  const html = await renderRoute("/operator", { userId: "deleted-user", capability: "linkedin" }, {
    resolveWorkspaceProjectionForUi: async (input) => {
      projectedUserId = input.userId;
      return {
        data: {
          user: { id: input.userId, label: "ready-user" },
          generatedAt: "2026-06-09T12:00:00.000Z",
          operatorSummary: { checklist: [] },
          decisionQueue: { items: [] },
          agentQueue: { items: [], blockers: [] },
          blockedQueue: { items: [] },
          dueNowItems: [],
          waitingItems: [],
          truthAccounts: [],
        },
        html: "",
      };
    },
  });

  assert.equal(projectedUserId, "user-ready");
  assert.match(html, /ready-user/);
});

test("operator route recovers to the one execution-ready user when the bound user lost account coverage", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-unready-user-recovery-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.EXO_HOME_STATE_DIR = process.env.EXO_STATE_DIR;

  insertUser({
    id: "user-empty",
    createdAt: "2026-06-08T10:00:00.000Z",
    updatedAt: "2026-06-08T10:00:00.000Z",
    label: "empty-user",
    owner: "operator",
    notes: null,
    workingHours: { mode: "always", timezone: "America/New_York", weekdays: ["mon"], startLocalTime: "09:00", endLocalTime: "17:00" },
    accounts: [],
    harnessConnections: [],
    managedAccountExclusions: [],
    inboundIgnoreRules: [],
  });
  insertUser({
    id: "user-ready",
    createdAt: "2026-06-08T11:00:00.000Z",
    updatedAt: "2026-06-08T11:00:00.000Z",
    label: "ready-user",
    owner: "operator",
    notes: null,
    workingHours: { mode: "always", timezone: "America/New_York", weekdays: ["mon"], startLocalTime: "09:00", endLocalTime: "17:00" },
    accounts: [
      {
        id: "account-1",
        createdAt: "2026-06-08T11:00:00.000Z",
        updatedAt: "2026-06-08T11:00:00.000Z",
        capability: "linkedin",
        handle: "ready-user",
        label: "Ready User",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        providerAccountId: "acct-ready",
        preferred: true,
        automationControls: { weeklyQuotas: { profileVisits: null, invitations: null, messages: null } },
        metadata: null,
        notes: null,
        inboundSync: { surfaces: [] },
      },
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: "2026-06-08T11:00:00.000Z",
        updatedAt: "2026-06-08T11:00:00.000Z",
        runtime: "codex",
        connector: "unipile",
        label: null,
        status: "available",
        notes: null,
      },
    ],
    managedAccountExclusions: [],
    inboundIgnoreRules: [],
  });

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
  });

  let projectedUserId = null;
  await renderRoute("/operator", { userId: "user-empty", capability: "linkedin" }, {
    resolveWorkspaceProjectionForUi: async (input) => {
      projectedUserId = input.userId;
      return {
        data: {
          user: { id: input.userId, label: "ready-user" },
          generatedAt: "2026-06-09T12:00:00.000Z",
          operatorSummary: { checklist: [] },
          decisionQueue: { items: [] },
          agentQueue: { items: [], blockers: [] },
          blockedQueue: { items: [] },
          dueNowItems: [],
          waitingItems: [],
          truthAccounts: [],
        },
        html: "",
      };
    },
  });

  assert.equal(projectedUserId, "user-ready");
});

test("ui root redirects to /operator", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-root-redirect-"));
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;
  const previousCodexHome = process.env.CODEX_HOME;

  process.env.EXO_STATE_DIR = path.join(tempDir, ".exo");
  process.env.EXO_HOME_STATE_DIR = process.env.EXO_STATE_DIR;
  process.env.CODEX_HOME = path.join(tempDir, "codex-home");
  fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });

  t.after(async () => {
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
    if (previousCodexHome == null) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const { server, url } = await startExoUiServer({ userId: null, port: 0 });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await fetch(`${url}?view=test`, { redirect: "manual" });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/operator?view=test");
});
