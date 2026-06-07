// @ts-check
//
// Regression coverage for the operator-surface write path.
//
// Every interactive button in the Exo UI dispatches a typed { writer, args }
// intent to executeActionIntent, which calls the real governed core writers and
// persists to the .exo store. This suite seeds a world via the CLI, then drives
// each writer in-process and asserts the mutation actually persisted — the same
// contract the UI relies on. It exists because a real bug shipped here
// (assignCompanyUser crashed on a confirmation message because updateCompany
// returned nothing); these tests lock the whole dispatcher down.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

// One temp state dir for this file's process. node --test isolates each test
// file in its own subprocess, so setting EXO_STATE_DIR here is safe; the
// in-process db connection (opened lazily on first read) uses it.
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-act-"));
process.env.EXO_STATE_DIR = stateDir;
process.env.EXO_AGENT_RUN_LOCK_TEMP_DIR = path.join(stateDir, "run-lock");

const { executeActionIntent } = await import("../src/core/execute-action-intent.js");
const { findCompanyById, findMotionById, insertMotion, listInboundObservations, listMotions } = await import("../src/db/database.js");
const { TRANSITION_MOTION_MARKER_URL } = await import("../src/core/ensure-transition-motion.js");
const { reconcileConnectionDegreesFromAccepts } = await import("../src/core/reconcile-connection-degrees.js");
const { buildAgentRunLockDir } = await import("../src/lib/agent-run-lock.js");

/** @param {string[]} args */
function cli(args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, EXO_STATE_DIR: stateDir },
  }).toString();
}
/** @param {string[]} args */
function cliJson(args) {
  return JSON.parse(cli([...args, "--json"]));
}

/** Re-read the seeded prospect from whichever motion currently holds it. */
function reProspect(prospectId) {
  for (const motion of listMotions()) {
    for (const account of motion.targetMap?.accounts ?? []) {
      const hit = (account.prospects ?? []).find((p) => p.id === prospectId);
      if (hit) return { motionId: motion.id, prospect: hit };
    }
  }
  return null;
}

/**
 * @param {string} motionId
 * @param {string} companyId
 */
function reAccount(motionId, companyId) {
  return (findMotionById(motionId)?.targetMap?.accounts ?? []).find((account) => account.companyId === companyId) ?? null;
}

/** @param {string} actorName */
function observationIdByActor(actorName) {
  const hit = listInboundObservations().find((o) => o.actorName === actorName);
  assert.ok(hit, `seeded observation for ${actorName} not found`);
  return hit.id;
}

test("executeActionIntent drives every operator writer against governed state", async (t) => {
  // --- seed a world: two motions, a company, an execution user + account, a
  // tracked prospect, and three inbound invitations to promote/record. ---
  const motion = cliJson([
    "motion", "add",
    "--url", "https://example.com/act",
    "--premise", "This offer matters when a GTM leader needs signal-led outreach.",
    "--audience", "Revenue leaders",
    "--signal", "company::Is the company scaling GTM headcount?",
  ]);
  cli(["motion", "restart", motion.id, "--json"]);

  const destMotion = cliJson([
    "motion", "add",
    "--url", "https://example.com/act-dest",
    "--premise", "This offer matters when a security team needs faster detection.",
    "--audience", "Security leaders",
    "--signal", "company::Is the company expanding its security surface?",
  ]);
  cli(["motion", "restart", destMotion.id, "--json"]);

  // Pre-seed the transition motion (cloned from a real one, marked with the
  // transition URL) so the promote writers FIND it via findTransitionMotion()
  // instead of having ensureTransitionMotion() create it — which would fetch
  // the transition.exo.local marker URL and hang ~5s on a DNS timeout.
  const transitionSeed = structuredClone(destMotion);
  transitionSeed.id = randomUUID();
  transitionSeed.name = "transition-inbound-backlog";
  transitionSeed.offer = { ...transitionSeed.offer, sourceUrl: TRANSITION_MOTION_MARKER_URL };
  insertMotion(transitionSeed);

  const company = cliJson([
    "companies", "add", "--name", "Acme Inc", "--domain", "acme.example", "--motion", motion.id,
  ]);
  const backlogCompany = cliJson([
    "companies", "add", "--name", "Backlog Inc", "--domain", "backlog.example", "--motion", motion.id,
  ]);

  const user = cliJson(["users", "add", "--label", "Test User", "--owner", "William"]);
  const userWithAccount = cliJson([
    "users", "accounts", "add", user.id,
    "--capability", "linkedin", "--handle", "test-user",
    "--runtime", "codex", "--connector", "chrome", "--preferred",
  ]);
  const linkedinAccount = userWithAccount.accounts.find((a) => a.capability === "linkedin");
  assert.ok(linkedinAccount, "seeded linkedin account");

  const prospect = cliJson([
    "companies", "prospects", "add", company.id, "--motion", motion.id,
    "--name", "Pat Prospect", "--title", "CRO",
    "--buying-committee-role", "primary_business_owner",
    "--decision-authority", "buys", "--fit-confidence", "high",
    "--why-relevant", "Owns the commercial motion",
  ]).prospects[0];

  // Two pending received invitations not yet linked to a prospect (for promote).
  for (const actor of ["Percy Promote", "Dana Draft", "Mona Motion"]) {
    cli([
      "inbound", "observations", "add", user.id,
      "--account", linkedinAccount.id,
      "--surface", "linkedin-received-invitations",
      "--kind", "connection_request_received",
      "--observed-at", "2026-05-20T10:00:00.000Z",
      "--summary", `${actor} sent a connection request`,
      "--actor-name", actor,
      "--actor-company", `${actor.split(" ")[0]} Labs`,
      "--actor-profile-url", `https://www.linkedin.com/in/${actor.toLowerCase().replace(/\s+/g, "-")}/`,
      "--json",
    ]);
  }
  cli([
    "inbound", "observations", "add", user.id,
    "--account", linkedinAccount.id,
    "--surface", "linkedin-sent-invitations",
    "--kind", "connection_request_pending",
    "--observed-at", "2026-05-01T10:00:00.000Z",
    "--summary", "Wendy Withdraw is still pending",
    "--actor-name", "Wendy Withdraw",
    "--actor-company", "Withdraw Co",
    "--actor-profile-url", "https://www.linkedin.com/in/wendy-withdraw/",
    "--json",
  ]);
  // One invitation already linked to the tracked prospect, so accepting it can
  // reconcile that prospect to 1st-degree.
  cli([
    "inbound", "observations", "add", user.id,
    "--account", linkedinAccount.id,
    "--surface", "linkedin-received-invitations",
    "--kind", "connection_request_received",
    "--observed-at", "2026-05-21T10:00:00.000Z",
    "--summary", "Pat Prospect sent a connection request",
    "--actor-name", "Pat Prospect",
    "--actor-profile-url", "https://www.linkedin.com/in/pat-prospect/",
    "--motion", motion.id,
    "--company", company.id,
    "--prospect", prospect.id,
    "--json",
  ]);

  // A second prospect with an already-recorded ACCEPTED invite but no degree —
  // the backfill target for reconcileConnectionDegreesFromAccepts().
  const backfillProspect = cliJson([
    "companies", "prospects", "add", company.id, "--motion", motion.id,
    "--name", "Quinn Quiet", "--title", "VP Marketing",
    "--buying-committee-role", "operator_champion",
    "--decision-authority", "influences", "--fit-confidence", "moderate",
    "--why-relevant", "Already accepted before degree capture",
  ]).prospects.at(-1);
  cli([
    "inbound", "observations", "add", user.id,
    "--account", linkedinAccount.id,
    "--surface", "linkedin-received-invitations",
    "--kind", "connection_request_accepted",
    "--observed-at", "2026-05-22T10:00:00.000Z",
    "--summary", "Quinn Quiet accepted",
    "--actor-name", "Quinn Quiet",
    "--motion", motion.id,
    "--company", company.id,
    "--prospect", backfillProspect.id,
    "--json",
  ]);

  // --- 1. assignCompanyUser (regression: used to crash on the confirmation) ---
  await t.test("assignCompanyUser pins the company and confirms by name", async () => {
    const res = await executeActionIntent({ writer: "assignCompanyUser", args: { companyId: company.id, userId: user.id } });
    assert.equal(res.ok, true);
    assert.match(res.message, /Acme Inc/);
    assert.equal(findCompanyById(company.id).engagementUserAssignment?.userId, user.id);
  });

  await t.test("assignMotionUser pins the motion and confirms by name", async () => {
    const res = await executeActionIntent({ writer: "assignMotionUser", args: { motionId: motion.id, userId: user.id } });
    assert.equal(res.ok, true);
    assert.match(res.message, new RegExp(motion.name));
    assert.equal(findMotionById(motion.id).engagementUserAssignment?.userId, user.id);
  });

  await t.test("restartMotion marks a draft motion active", async () => {
    const draftMotion = cliJson([
      "motion", "add",
      "--url", "https://example.com/draft-only",
      "--premise", "This offer matters when a draft needs to become the live working motion.",
      "--audience", "Operators",
      "--signal", "company::Is there recent evidence this team is actively evaluating workflow changes?",
    ]);
    const res = await executeActionIntent({ writer: "restartMotion", args: { motionId: draftMotion.id } });
    assert.equal(res.ok, true);
    assert.match(res.message, /Set .* live\./);
    assert.equal(findMotionById(draftMotion.id).status, "active");
  });

  await t.test("claimRuntimeAccount persists a managed account onto the user", async () => {
    const res = await executeActionIntent({
      writer: "claimRuntimeAccount",
      args: {
        userId: user.id,
        capability: "linkedin",
        runtime: "codex",
        connector: "unipile",
        handle: "test-user-managed",
        metadata: {
          premiumFeatures: ["sales_navigator"],
        },
      },
    });
    assert.equal(res.ok, true);
    assert.match(res.message, /test-user-managed/);
    const updatedUser = cliJson(["users", "show", user.id]);
    const unipileConnection = updatedUser.harnessConnections.find((connection) => connection.runtime === "codex" && connection.connector === "unipile");
    assert.ok(unipileConnection, "managed unipile harness connection was written");
    const managed = updatedUser.accounts.find((account) =>
      account.capability === "linkedin"
      && account.sourceType === "harness-connection"
      && account.harnessConnectionId === unipileConnection.id,
    );
    assert.ok(managed, "managed linkedin account was written");
    assert.equal(managed?.handle, "test-user-managed");
    assert.deepEqual(managed?.metadata?.premiumFeatures, ["sales_navigator"]);
  });

  await t.test("claimTargetAccountPacket claims company research idempotently", async () => {
    const res = await executeActionIntent({
      writer: "claimTargetAccountPacket",
      args: {
        motionId: motion.id,
        companyId: backlogCompany.id,
        workerLabel: "codex-ui",
        notes: "Queued from UI regression test",
      },
    });
    assert.equal(res.ok, true);
    assert.match(res.message, /Queued Backlog Inc for agent research/i);
    const claimedAccount = (findMotionById(motion.id).targetMap?.accounts ?? []).find((account) => account.companyId === backlogCompany.id);
    assert.equal(claimedAccount?.packetState?.kind, "company_research");
    assert.equal(claimedAccount?.packetState?.status, "claimed");
    assert.equal(claimedAccount?.packetState?.workerLabel, "codex-ui");

    const again = await executeActionIntent({
      writer: "claimTargetAccountPacket",
      args: {
        motionId: motion.id,
        companyId: backlogCompany.id,
        workerLabel: "codex-ui",
      },
    });
    assert.equal(again.ok, true);
    assert.match(again.message, /already queued/i);
  });

  await t.test("addMotionSignals appends new signal questions without replacing the current set", async () => {
    const before = findMotionById(motion.id);
    const beforeSignalIds = before.signals.map((signal) => signal.id);

    const res = await executeActionIntent({
      writer: "addMotionSignals",
      args: {
        motionId: motion.id,
        signal: "company::Is there recent evidence this company is consolidating pipeline tooling?\nperson::Is there recent evidence a new RevOps leader just joined?",
      },
    });

    assert.equal(res.ok, true);
    assert.match(res.message, /Added 2 signal questions/i);

    const after = findMotionById(motion.id);
    assert.equal(after.signals.length, before.signals.length + 2);
    assert.deepEqual(after.signals.slice(0, beforeSignalIds.length).map((signal) => signal.id), beforeSignalIds);
    assert.ok(after.signals.some((signal) => signal.question === "Is there recent evidence this company is consolidating pipeline tooling?"));
    assert.ok(after.signals.some((signal) => signal.question === "Is there recent evidence a new RevOps leader just joined?"));
  });

  await t.test("removeMotionSignal prunes the signal and its stored evidence", async () => {
    const seedMatch = cliJson([
      "companies",
      "signal-matches",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--signal",
      motion.signals[0].id,
      "--summary",
      "Hiring plan shows active GTM expansion",
      "--source-url",
      "https://acme.example/news/growth",
    ]);
    const seededMatchId = seedMatch.signalMatches.at(-1).id;

    cliJson([
      "companies",
      "prospects",
      "update",
      company.id,
      "--motion",
      motion.id,
      "--prospect",
      prospect.id,
      "--signal-match",
      seededMatchId,
    ]);

    const res = await executeActionIntent({
      writer: "removeMotionSignal",
      args: {
        motionId: motion.id,
        signalId: motion.signals[0].id,
      },
    });

    assert.equal(res.ok, true);
    assert.match(res.message, /Removed signal/i);

    const updatedMotion = findMotionById(motion.id);
    assert.ok(updatedMotion.signals.every((signal) => signal.id !== motion.signals[0].id));
    const updatedAccount = reAccount(motion.id, company.id);
    assert.ok(updatedAccount, "target account still exists");
    assert.equal(updatedAccount.signalMatches.length, 0);
    assert.deepEqual(reProspect(prospect.id)?.prospect.signalMatchIds ?? [], []);
  });

  // --- 2. setMotionProspectCadence ---
  await t.test("setMotionProspectCadence schedules the next action", async () => {
    const res = await executeActionIntent({
      writer: "setMotionProspectCadence",
      args: { motionId: motion.id, companyId: company.id, prospectId: prospect.id, nextAction: "REG scheduled move" },
    });
    assert.equal(res.ok, true);
    assert.equal(reProspect(prospect.id)?.prospect.cadenceState?.nextAction, "REG scheduled move");
  });

  // --- 3. recordMotionProspectTouch ---
  await t.test("recordMotionProspectTouch canonical sends delegate to action-result writeback", async () => {
    const before = (reProspect(prospect.id)?.prospect.touches ?? []).length;
    const res = await executeActionIntent({
      writer: "recordMotionProspectTouch",
      args: { motionId: motion.id, companyId: company.id, prospectId: prospect.id, surface: "follow_up_direct_message", summary: "REG touch" },
    });
    assert.equal(res.ok, true);
    assert.equal(res.writer, "recordActionResult");
    const after = reProspect(prospect.id)?.prospect.touches ?? [];
    assert.equal(after.length, before + 1);
    assert.ok(after.some((touch) => touch.summary === "REG touch"));
  });

  await t.test("recordMotionProspectTouch still supports non-canonical raw touch logging", async () => {
    const before = (reProspect(prospect.id)?.prospect.touches ?? []).length;
    const res = await executeActionIntent({
      writer: "recordMotionProspectTouch",
      args: {
        motionId: motion.id,
        companyId: company.id,
        prospectId: prospect.id,
        surface: "follow_up_direct_message",
        outcome: "pending",
        summary: "Raw pending touch",
      },
    });
    assert.equal(res.ok, true);
    assert.equal(res.writer, "recordMotionProspectTouch");
    const after = reProspect(prospect.id)?.prospect.touches ?? [];
    assert.equal(after.length, before + 1);
    assert.ok(after.some((touch) => touch.summary === "Raw pending touch" && touch.outcome === "pending"));
  });

  // --- 4. approveProspectDraft ---
  await t.test("approveProspectDraft queues an approved draft", async () => {
    const res = await executeActionIntent({
      writer: "approveProspectDraft",
      args: { motionId: motion.id, companyId: company.id, prospectId: prospect.id, surface: "follow_up_direct_message", body: "REG approved body" },
    });
    assert.equal(res.ok, true);
    const draft = (reProspect(prospect.id)?.prospect.drafts ?? []).find((d) => d.surface === "follow_up_direct_message");
    assert.ok(draft, "draft was written");
    assert.ok(["approved", "ready", "sent"].includes(draft.status), `draft status ${draft.status}`);
    assert.equal(draft.approvedByOperator, true);
  });

  // --- 4b. addProspectTimelineNote — operator note + agent steer ---
  await t.test("addProspectTimelineNote appends note and steer entries", async () => {
    const noteRes = await executeActionIntent({
      writer: "addProspectTimelineNote",
      args: { motionId: motion.id, companyId: company.id, prospectId: prospect.id, body: "REG context note", kind: "note" },
    });
    assert.equal(noteRes.ok, true);
    const steerRes = await executeActionIntent({
      writer: "addProspectTimelineNote",
      args: { motionId: motion.id, companyId: company.id, prospectId: prospect.id, body: "REG keep it short, no pitch", kind: "steer" },
    });
    assert.equal(steerRes.ok, true);
    assert.match(steerRes.message, /agent/i);
    const notes = reProspect(prospect.id)?.prospect.timelineNotes ?? [];
    assert.ok(notes.some((n) => n.kind === "note" && n.body === "REG context note"));
    assert.ok(notes.some((n) => n.kind === "steer" && n.body === "REG keep it short, no pitch"));
    // empty body rejects
    await assert.rejects(
      () => executeActionIntent({ writer: "addProspectTimelineNote", args: { motionId: motion.id, companyId: company.id, prospectId: prospect.id, body: "  " } }),
      /requires prospectId and body/,
    );
  });

  // --- 5. recordInboundObservation (the wired Accept button) — accepting a
  // linked invite reconciles the prospect to 1st-degree (closes the freshness
  // loop: an accept is authoritative proof of connection). ---
  await t.test("recordInboundObservation accepts and reconciles to 1st-degree", async () => {
    assert.equal(reProspect(prospect.id)?.prospect.linkedinProfileSnapshot?.connectionDegree ?? null, null, "degree starts unset");
    const res = await executeActionIntent({
      writer: "recordInboundObservation",
      args: { observationId: observationIdByActor("Pat Prospect"), nextKind: "connection_request_accepted" },
    });
    assert.equal(res.ok, true);
    assert.match(res.message, /accepted/i);
    assert.match(res.message, /1st-degree/i);
    assert.equal(reProspect(prospect.id)?.prospect.linkedinProfileSnapshot?.connectionDegree, 1);
  });

  // --- 5b. reconcileConnectionDegreesFromAccepts backfills existing accepts ---
  await t.test("reconcileConnectionDegreesFromAccepts backfills unset degrees idempotently", () => {
    assert.equal(reProspect(backfillProspect.id)?.prospect.linkedinProfileSnapshot?.connectionDegree ?? null, null);
    const updated = reconcileConnectionDegreesFromAccepts();
    assert.ok(updated.some((u) => u.prospectId === backfillProspect.id), "backfill set the unset prospect");
    assert.equal(reProspect(backfillProspect.id)?.prospect.linkedinProfileSnapshot?.connectionDegree, 1);
    // Re-running is a no-op for already-reconciled prospects.
    const again = reconcileConnectionDegreesFromAccepts();
    assert.equal(again.some((u) => u.prospectId === backfillProspect.id), false);
  });

  // --- 6. promoteInboundPerson (auto-creates the transition motion) ---
  await t.test("promoteInboundPerson promotes an invite into a tracked prospect", async () => {
    const res = await executeActionIntent({
      writer: "promoteInboundPerson",
      args: { observationId: observationIdByActor("Percy Promote"), userId: user.id },
    });
    assert.equal(res.ok, true);
    assert.match(res.message, /Promoted/i);
    const transition = listMotions().find((m) => /transition/i.test(m.name));
    assert.ok(transition, "transition motion exists");
    const count = (transition.targetMap?.accounts ?? []).reduce((sum, a) => sum + (a.prospects?.length ?? 0), 0);
    assert.ok(count >= 1, "transition motion has a promoted prospect");
  });

  await t.test("claimInboundPersonToMotion promotes into the backlog and re-homes into the chosen motion", async () => {
    const res = await executeActionIntent({
      writer: "claimInboundPersonToMotion",
      args: {
        observationId: observationIdByActor("Mona Motion"),
        userId: user.id,
        toMotionId: destMotion.id,
      },
    });
    assert.equal(res.ok, true);
    assert.match(res.message, /Re-homed Mona Motion/i);
    assert.match(res.message, new RegExp(destMotion.name));

    const destinationHasProspect = (findMotionById(destMotion.id).targetMap?.accounts ?? []).some((account) =>
      (account.prospects ?? []).some((candidate) => candidate.name === "Mona Motion"),
    );
    assert.equal(destinationHasProspect, true);

    const otherMotionsStillHaveMona = listMotions()
      .filter((candidate) => candidate.id !== destMotion.id)
      .some((candidate) =>
        (candidate.targetMap?.accounts ?? []).some((account) =>
          (account.prospects ?? []).some((prospect) => prospect.name === "Mona Motion"),
        ),
      );
    assert.equal(otherMotionsStillHaveMona, false);
  });

  await t.test("recordInboundObservation can queue a stale sent invite for withdraw and writeback lands it as withdrawn", async () => {
    const observationId = observationIdByActor("Wendy Withdraw");

    const queued = await executeActionIntent({
      writer: "recordInboundObservation",
      args: {
        observationId,
        nextKind: "connection_request_withdraw_requested",
      },
    });
    assert.equal(queued.ok, true);
    assert.match(queued.message, /Queued the agent to withdraw Wendy Withdraw/i);
    assert.equal(
      listInboundObservations().find((observation) => observation.id === observationId)?.kind,
      "connection_request_withdraw_requested",
    );

    const withdrawn = await executeActionIntent({
      writer: "recordActionResult",
      args: {
        actionKey: "withdraw_connection",
        resultKey: "sent",
        observationId,
      },
    });
    assert.equal(withdrawn.ok, true);
    assert.match(withdrawn.message, /Withdrew withdraw connection/i);
    assert.equal(
      listInboundObservations().find((observation) => observation.id === observationId)?.kind,
      "connection_request_withdrawn",
    );
  });

  // --- 7. promoteAndApproveDraft ---
  await t.test("promoteAndApproveDraft promotes and queues the first message", async () => {
    const res = await executeActionIntent({
      writer: "promoteAndApproveDraft",
      args: { observationId: observationIdByActor("Dana Draft"), surface: "post_accept_message", body: "REG first message" },
    });
    assert.equal(res.ok, true);
    assert.match(res.message, /Added .* queued/i);
  });

  // --- 8. rehomeProspect (move Pat from its motion into the destination) ---
  await t.test("rehomeProspect moves a prospect between motions", async () => {
    const res = await executeActionIntent({
      writer: "rehomeProspect",
      args: { prospectId: prospect.id, toMotionId: destMotion.id, userId: user.id },
    });
    assert.equal(res.ok, true);
    const moved = (findMotionById(destMotion.id).targetMap?.accounts ?? []).some((a) =>
      (a.prospects ?? []).some((p) => p.id === prospect.id),
    );
    assert.ok(moved, "prospect now lives in the destination motion");
  });

  // --- 9. error handling: unknown / missing writer must reject, not corrupt ---
  await t.test("unknown and missing writers reject cleanly", async () => {
    await assert.rejects(() => executeActionIntent({ writer: "definitelyNotAWriter", args: {} }), /Unsupported action writer/);
    await assert.rejects(() => executeActionIntent({}), /requires a writer/);
  });

  await t.test("runAgentQueuePass returns a governed pass summary", async () => {
    const fakeRunnerPath = path.join(stateDir, "fake-agent-runner.js");
    fs.writeFileSync(fakeRunnerPath, `#!/usr/bin/env node
console.log(JSON.stringify({
  status: "completed",
  results: [{ kind: "company_research", status: "completed", detail: { summary: "Stored signal." } }],
  finalQueueCounts: { dueTaskCount: 2, waitingTaskCount: 0, blockerCount: 0 }
}));\n`, "utf8");
    fs.chmodSync(fakeRunnerPath, 0o755);

    const previousRunner = process.env.EXO_AGENT_RUNNER_SCRIPT;
    process.env.EXO_AGENT_RUNNER_SCRIPT = fakeRunnerPath;
    try {
      const res = await executeActionIntent({ writer: "runAgentQueuePass", args: { background: false } });
      assert.equal(res.ok, true);
      assert.equal(res.writer, "runAgentQueuePass");
      assert.match(res.message, /Agent ran 1 task/i);
      assert.match(res.message, /Queue now 2 due, 0 waiting, 0 blockers/i);
    } finally {
      if (previousRunner == null) {
        delete process.env.EXO_AGENT_RUNNER_SCRIPT;
      } else {
        process.env.EXO_AGENT_RUNNER_SCRIPT = previousRunner;
      }
    }
  });

  await t.test("runAgentQueuePass surfaces partial passes as progress with backlog remaining", async () => {
    const fakeRunnerPath = path.join(stateDir, "fake-agent-runner-partial.js");
    fs.writeFileSync(fakeRunnerPath, `#!/usr/bin/env node
console.log(JSON.stringify({
  status: "partial",
  results: [{ kind: "run_inbound_sync", status: "completed", detail: { summary: "Refreshed truth." } }],
  finalQueueCounts: { dueTaskCount: 2, waitingTaskCount: 0, blockerCount: 0 }
}));\n`, "utf8");
    fs.chmodSync(fakeRunnerPath, 0o755);

    const previousRunner = process.env.EXO_AGENT_RUNNER_SCRIPT;
    process.env.EXO_AGENT_RUNNER_SCRIPT = fakeRunnerPath;
    try {
      const res = await executeActionIntent({ writer: "runAgentQueuePass", args: { background: false } });
      assert.equal(res.ok, true);
      assert.equal(res.writer, "runAgentQueuePass");
      assert.match(res.message, /Agent made progress on 1 task/i);
      assert.match(res.message, /Queue now 2 due, 0 waiting, 0 blockers/i);
    } finally {
      if (previousRunner == null) {
        delete process.env.EXO_AGENT_RUNNER_SCRIPT;
      } else {
        process.env.EXO_AGENT_RUNNER_SCRIPT = previousRunner;
      }
    }
  });

  await t.test("runAgentQueuePass starts a detached background pass for UI actions", async () => {
    const fakeRunnerPath = path.join(stateDir, "fake-agent-runner-detached.js");
    const markerPath = path.join(stateDir, "detached-pass-marker.json");
    fs.writeFileSync(fakeRunnerPath, `#!/usr/bin/env node
import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify({ status: "completed", kind: "run_inbound_sync" }), "utf8");
console.log(JSON.stringify({
  status: "completed",
  results: [{ kind: "run_inbound_sync", status: "completed", detail: { summary: "Refreshed truth." } }],
  finalQueueCounts: { dueTaskCount: 0, waitingTaskCount: 0, blockerCount: 0 }
}));\n`, "utf8");
    fs.chmodSync(fakeRunnerPath, 0o755);

    const previousRunner = process.env.EXO_AGENT_RUNNER_SCRIPT;
    process.env.EXO_AGENT_RUNNER_SCRIPT = fakeRunnerPath;
    try {
      fs.rmSync(markerPath, { force: true });
      const res = await executeActionIntent({ writer: "runAgentQueuePass", args: {} });
      assert.equal(res.ok, true);
      assert.equal(res.writer, "runAgentQueuePass");
      assert.match(res.message, /started in background/i);

      let summary = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (fs.existsSync(markerPath)) {
          summary = JSON.parse(fs.readFileSync(markerPath, "utf8"));
          if (summary?.status === "completed") break;
        }
        await sleep(100);
      }
      assert.equal(summary?.status, "completed");
      assert.equal(summary?.kind, "run_inbound_sync");
    } finally {
      if (previousRunner == null) {
        delete process.env.EXO_AGENT_RUNNER_SCRIPT;
      } else {
        process.env.EXO_AGENT_RUNNER_SCRIPT = previousRunner;
      }
    }
  });

  await t.test("runAgentQueuePass refuses to launch while another pass lock is active", async () => {
    const lockDir = buildAgentRunLockDir({ stateDir });
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, "pid"), `${process.pid}\n`, "utf8");
    try {
      await assert.rejects(
        () => executeActionIntent({ writer: "runAgentQueuePass", args: {} }),
        /already running|already active/i,
      );
    } finally {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  });
});

test.after(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
  delete process.env.EXO_AGENT_RUN_LOCK_TEMP_DIR;
});
