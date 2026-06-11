// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-action-result-"));
process.env.EXO_STATE_DIR = stateDir;

const { recordActionResult } = await import("../src/core/record-action-result.js");
const { buildAgentQueue } = await import("../src/core/build-agent-queue.js");
const { buildMotionsViewModel } = await import("../src/core/build-motions-view.js");
const { renderMotionDetailPage } = await import("../src/artifacts/render-motions.js");
const {
  findMotionById,
  getLocalDatabase,
  listActivityEvents,
  listInboundObservations,
  listMotions,
} = await import("../src/db/database.js");

/**
 * @param {string[]} args
 */
function cli(args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, EXO_STATE_DIR: stateDir },
    encoding: "utf8",
  });
}

/**
 * @param {string[]} args
 */
function cliJson(args) {
  return JSON.parse(cli([...args, "--json"]));
}

/**
 * @param {string} prospectId
 */
function reProspect(prospectId) {
  for (const motion of listMotions()) {
    for (const account of motion.targetMap?.accounts ?? []) {
      const hit = (account.prospects ?? []).find((prospect) => prospect.id === prospectId);
      if (hit) {
        return { motionId: motion.id, prospect: hit };
      }
    }
  }

  return null;
}

test("recordActionResult writes back outbound send and marks an approved draft sent", () => {
  const motion = cliJson([
    "motion", "add",
    "--url", "https://example.com/result-outbound",
    "--premise", "This offer matters when a GTM team needs governed action results.",
    "--audience", "Revenue leaders",
    "--signal", "company::Is GTM execution blocked on scattered state?",
  ]);
  cli(["motion", "restart", motion.id]);

  const company = cliJson([
    "companies", "add",
    "--name", "Result Systems",
    "--domain", "results.example",
    "--motion", motion.id,
  ]);
  const prospect = cliJson([
    "companies", "prospects", "add", company.id,
    "--motion", motion.id,
    "--name", "Olive Outcome",
    "--title", "VP Revenue",
    "--linkedin-profile-url", "https://www.linkedin.com/in/olive-outcome",
    "--buying-committee-role", "primary_business_owner",
    "--decision-authority", "buys",
    "--fit-confidence", "high",
    "--why-relevant", "Owns the outreach motion.",
  ]).prospects[0];

  cli([
    "companies", "prospects", "draft", "approve", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--surface", "connection_request",
    "--body", "Short note for the connection request.",
  ]);

  const result = recordActionResult({
    actionKey: "connection_request",
    resultKey: "sent",
    motionId: motion.id,
    companyId: company.id,
    prospectId: prospect.id,
    occurredAt: "2026-06-02T12:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionResult.touchRecorded, true);
  assert.equal(result.actionResult.draftMarkedSent, true);
  assert.equal(result.actionResult.surface, "connection_request");

  const stored = reProspect(prospect.id)?.prospect;
  assert.ok(stored, "prospect exists after action result");
  assert.equal(stored.drafts.find((draft) => draft.surface === "connection_request")?.status, "sent");
  assert.ok(stored.touches.some((touch) =>
    touch.surface === "connection_request"
    && touch.outcome === "sent"
    && touch.occurredAt === "2026-06-02T12:00:00.000Z"
  ));
  assert.equal(stored.cadenceState.currentStep, "connection-request");
  assert.equal(stored.cadenceState.lastTouchOutcome, "sent");
  assert.match(stored.cadenceState.nextAction ?? "", /accept|reply/i);
});

test("recordActionResult writes outbound send state to normalized rows", () => {
  const motion = cliJson([
    "motion", "add",
    "--url", "https://example.com/result-row-backed",
    "--premise", "This offer matters when action results need row-backed writes.",
    "--audience", "Revenue operators",
    "--signal", "company::Is send state still trapped in hydrated blobs?",
  ]);
  cli(["motion", "restart", motion.id]);

  const company = cliJson([
    "companies", "add",
    "--name", "Row Result Systems",
    "--domain", "row-results.example",
    "--motion", motion.id,
  ]);
  const prospect = cliJson([
    "companies", "prospects", "add", company.id,
    "--motion", motion.id,
    "--name", "Riley Rows",
    "--title", "VP Revenue",
    "--linkedin-profile-url", "https://www.linkedin.com/in/riley-rows",
    "--buying-committee-role", "primary_business_owner",
    "--decision-authority", "buys",
    "--fit-confidence", "high",
    "--why-relevant", "Owns row-backed action results.",
  ]).prospects[0];

  cli([
    "companies", "cadence", "set", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--current-step", "connection-request",
    "--next-action", "Send the connection request.",
  ]);

  cli([
    "companies", "prospects", "draft", "set", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--surface", "connection_request",
    "--status", "queued",
    "--body", "Row-backed connection request.",
  ]);

  const beforeMotionRow = getLocalDatabase()
    .prepare("SELECT updated_at FROM motions WHERE id = ?")
    .get(motion.id);

  const result = recordActionResult({
    actionKey: "connection_request",
    resultKey: "sent",
    motionId: motion.id,
    companyId: company.id,
    prospectId: prospect.id,
    occurredAt: "2026-06-02T12:45:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionResult.touchRecorded, true);
  assert.equal(result.actionResult.draftMarkedSent, true);
  assert.equal(result.actionResult.cadenceUpdated, true);

  const rowProspect = getLocalDatabase()
    .prepare("SELECT * FROM prospects WHERE id = ?")
    .get(prospect.id);
  assert.equal(rowProspect.cadence_status, "ready");
  assert.equal(rowProspect.cadence_current_step, "connection-request");
  assert.equal(rowProspect.cadence_last_touch_outcome, "sent");
  assert.equal(rowProspect.cadence_last_touch_at, "2026-06-02T12:45:00.000Z");
  assert.equal(rowProspect.cadence_next_action_due_at, null);

  const afterMotionRow = getLocalDatabase()
    .prepare("SELECT updated_at FROM motions WHERE id = ?")
    .get(motion.id);
  assert.equal(afterMotionRow.updated_at, beforeMotionRow.updated_at);

  const rowDraft = getLocalDatabase()
    .prepare("SELECT status, sent_at FROM prospect_drafts WHERE prospect_id = ? AND surface = 'connection_request'")
    .get(prospect.id);
  assert.equal(rowDraft.status, "sent");
  assert.ok(rowDraft.sent_at, "sent_at is set on row draft");

  const rowTouch = listActivityEvents({ prospectId: prospect.id }).find((event) =>
    event.surface === "connection_request" && event.outcome === "sent"
  );
  assert.ok(rowTouch, "touch event was written as an activity_events row");
  assert.equal(rowTouch.occurredAt, "2026-06-02T12:45:00.000Z");
});

test("recordActionResult blocks stale outbound send when another motion owns the person", () => {
  const motionA = cliJson([
    "motion", "add",
    "--url", "https://example.com/result-owner-a",
    "--premise", "This offer matters when ownership has to be enforced at send time.",
    "--audience", "Revenue operators",
    "--signal", "company::Is stale send writeback possible?",
  ]);
  cli(["motion", "restart", motionA.id]);
  const companyA = cliJson([
    "companies", "add",
    "--name", "Owner A Co",
    "--domain", "owner-a.example",
    "--motion", motionA.id,
  ]);
  const prospectA = cliJson([
    "companies", "prospects", "add", companyA.id,
    "--motion", motionA.id,
    "--name", "Sam Sameperson",
    "--title", "VP Revenue",
    "--linkedin-profile-url", "https://www.linkedin.com/in/sam-sameperson",
    "--why-relevant", "Owns the first active branch.",
  ]).prospects[0];
  cli([
    "companies", "prospects", "draft", "approve", companyA.id,
    "--motion", motionA.id,
    "--prospect", prospectA.id,
    "--surface", "connection_request",
    "--body", "First motion connection request.",
  ]);
  recordActionResult({
    actionKey: "connection_request",
    resultKey: "sent",
    motionId: motionA.id,
    companyId: companyA.id,
    prospectId: prospectA.id,
    occurredAt: "2026-06-03T12:00:00.000Z",
  });

  const motionB = cliJson([
    "motion", "add",
    "--url", "https://example.com/result-owner-b",
    "--premise", "This offer matters when stale branches must not send.",
    "--audience", "Revenue operators",
    "--signal", "company::Is the same person already active elsewhere?",
  ]);
  cli(["motion", "restart", motionB.id]);
  const companyB = cliJson([
    "companies", "add",
    "--name", "Owner B Co",
    "--domain", "owner-b.example",
    "--motion", motionB.id,
  ]);
  const prospectB = cliJson([
    "companies", "prospects", "add", companyB.id,
    "--motion", motionB.id,
    "--name", "Sam Sameperson",
    "--title", "Chief Revenue Officer",
    "--linkedin-profile-url", "https://www.linkedin.com/in/sam-sameperson",
    "--why-relevant", "Same person in a stale second branch.",
  ]).prospects[0];
  cli([
    "companies", "prospects", "draft", "approve", companyB.id,
    "--motion", motionB.id,
    "--prospect", prospectB.id,
    "--surface", "connection_request",
    "--body", "Second motion connection request.",
  ]);

  const held = getLocalDatabase()
    .prepare("SELECT queue_status FROM prospects WHERE id = ?")
    .get(prospectB.id);
  assert.equal(held.queue_status, "held_cross_motion");

  assert.throws(
    () => recordActionResult({
      actionKey: "connection_request",
      resultKey: "sent",
      motionId: motionB.id,
      companyId: companyB.id,
      prospectId: prospectB.id,
      occurredAt: "2026-06-03T12:05:00.000Z",
    }),
    /stale branch/
  );

  const staleTouch = listActivityEvents({ prospectId: prospectB.id }).find((event) =>
    event.surface === "connection_request" && event.outcome === "sent"
  );
  assert.equal(staleTouch, undefined);
  const draft = getLocalDatabase()
    .prepare("SELECT status FROM prospect_drafts WHERE prospect_id = ? AND surface = 'connection_request'")
    .get(prospectB.id);
  assert.equal(draft.status, "approved");

  const user = cliJson(["users", "add", "--label", "Held Visibility User", "--owner", "Operator"]);
  const workspaceJson = cliJson(["report", "workspace", "--user", user.id]);
  const heldMotionDetail = workspaceJson.motionDetails.find((detail) => detail.motionId === motionB.id);
  assert.ok(heldMotionDetail, "expected held motion to be visible in workspace detail data");
  const heldPerson = heldMotionDetail.people.find((person) => person.prospectId === prospectB.id);
  assert.ok(heldPerson, "expected held branch to be visible on its owning motion");
  assert.equal(heldPerson.branchState.key, "held-cross-motion");
  assert.equal(heldPerson.branchState.label, "Held behind owner");
  assert.equal(heldPerson.queueStatus, "held_cross_motion");
  assert.equal(heldPerson.crossMotionOwner?.motionId, motionA.id);

  const motionModel = buildMotionsViewModel({
    motionSummaries: workspaceJson.motionSummaries,
    motionDetails: workspaceJson.motionDetails,
    rawMotions: listMotions(),
  });
  const renderedHeldMotion = motionModel.details.find((detail) => detail.id === motionB.id);
  assert.ok(renderedHeldMotion, "expected held motion detail page model");
  const renderedHeldPerson = renderedHeldMotion.people.find((person) => person.id === prospectB.id);
  assert.equal(renderedHeldPerson?.branch, "held-cross-motion");
  assert.equal(renderedHeldPerson?.branchLabel, "Held behind owner");
  assert.equal(renderedHeldPerson?.crossMotionOwner?.motionId, motionA.id);
  const html = renderMotionDetailPage(renderedHeldMotion, { interactive: true });
  assert.match(html, /Sam Sameperson/);
  assert.match(html, /Held behind owner/);
});

test("recordActionResult writes back outbound send and marks a queued draft sent", () => {
  const motion = cliJson([
    "motion", "add",
    "--url", "https://example.com/result-outbound-queued",
    "--premise", "This offer matters when agent-owned queued drafts should still close cleanly on send.",
    "--audience", "Revenue leaders",
    "--signal", "company::Is GTM execution blocked on scattered state?",
  ]);
  cli(["motion", "restart", motion.id]);

  const company = cliJson([
    "companies", "add",
    "--name", "Queued Result Systems",
    "--domain", "queued-results.example",
    "--motion", motion.id,
  ]);
  const prospect = cliJson([
    "companies", "prospects", "add", company.id,
    "--motion", motion.id,
    "--name", "Quinn Queue",
    "--title", "VP Revenue",
    "--linkedin-profile-url", "https://www.linkedin.com/in/quinn-queue",
    "--buying-committee-role", "primary_business_owner",
    "--decision-authority", "buys",
    "--fit-confidence", "high",
    "--why-relevant", "Owns the agent-queued outreach motion.",
  ]).prospects[0];

  cli([
    "companies", "cadence", "set", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--current-step", "connection-request",
    "--next-action", "Send the connection request.",
  ]);

  cli([
    "companies", "prospects", "draft", "set", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--surface", "connection_request",
    "--status", "queued",
    "--body", "Short note for the queued connection request.",
  ]);

  const result = recordActionResult({
    actionKey: "connection_request",
    resultKey: "sent",
    motionId: motion.id,
    companyId: company.id,
    prospectId: prospect.id,
    occurredAt: "2026-06-02T12:30:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionResult.touchRecorded, true);
  assert.equal(result.actionResult.draftMarkedSent, true);
  assert.equal(result.actionResult.surface, "connection_request");

  const stored = reProspect(prospect.id)?.prospect;
  assert.ok(stored, "prospect exists after queued action result");
  assert.equal(stored.drafts.find((draft) => draft.surface === "connection_request")?.status, "sent");
  assert.ok(stored.touches.some((touch) =>
    touch.surface === "connection_request"
    && touch.outcome === "sent"
    && touch.occurredAt === "2026-06-02T12:30:00.000Z"
  ));
});

test("recordActionResult accepts an inbound connection request and reconciles the linked prospect", () => {
  const motion = cliJson([
    "motion", "add",
    "--url", "https://example.com/result-accept",
    "--premise", "This offer matters when inbound acceptance should advance governed cadence.",
    "--audience", "Security leaders",
    "--signal", "company::Is the team expanding security tooling?",
  ]);
  cli(["motion", "restart", motion.id]);

  const company = cliJson([
    "companies", "add",
    "--name", "Accept Labs",
    "--domain", "accept.example",
    "--motion", motion.id,
  ]);
  const prospect = cliJson([
    "companies", "prospects", "add", company.id,
    "--motion", motion.id,
    "--name", "Avery Accept",
    "--title", "VP Security",
    "--buying-committee-role", "primary_business_owner",
    "--decision-authority", "buys",
    "--fit-confidence", "high",
    "--why-relevant", "Owns the post-accept motion.",
  ]).prospects[0];

  const user = cliJson(["users", "add", "--label", "Action User", "--owner", "Operator"]);
  const userWithAccount = cliJson([
    "users", "accounts", "add", user.id,
    "--capability", "linkedin",
    "--handle", "action-user",
    "--runtime", "codex",
    "--connector", "chrome",
    "--preferred",
  ]);
  const linkedinAccount = userWithAccount.accounts.find((account) => account.capability === "linkedin");
  assert.ok(linkedinAccount, "seeded linkedin account");

  const observation = cliJson([
    "inbound", "observations", "add", user.id,
    "--account", linkedinAccount.id,
    "--surface", "linkedin-received-invitations",
    "--kind", "connection_request_received",
    "--observed-at", "2026-06-02T12:10:00.000Z",
    "--summary", "Avery Accept sent a connection request",
    "--actor-name", "Avery Accept",
    "--actor-profile-url", "https://www.linkedin.com/in/avery-accept/",
    "--motion", motion.id,
    "--company", company.id,
    "--prospect", prospect.id,
  ]).observation;

  const result = recordActionResult({
    actionKey: "accept_connection",
    resultKey: "accepted",
    observationId: observation.id,
    occurredAt: "2026-06-02T12:30:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionResult.touchRecorded, true);
  assert.equal(result.actionResult.inboundObservationTransitionedTo, "connection_request_accepted");
  assert.equal(result.actionResult.surface, "accept_connection");

  const stored = reProspect(prospect.id)?.prospect;
  assert.ok(stored, "prospect exists after accept");
  assert.equal(stored.linkedinProfileSnapshot.connectionDegree, 1);
  assert.equal(stored.cadenceState.currentStep, "direct-message");
  assert.equal(stored.cadenceState.lastTouchOutcome, "accepted");
  assert.match(stored.cadenceState.nextAction ?? "", /post-accept message/i);
  assert.ok(stored.touches.some((touch) => touch.surface === "accept_connection" && touch.outcome === "accepted"));

  const acceptedObservation = listInboundObservations().find((item) =>
    item.externalId === observation.externalId && item.kind === "connection_request_accepted"
  );
  assert.ok(acceptedObservation, "accepted observation was written");
});

test("exo actions result lands a direct-message send through the public CLI", () => {
  const motion = cliJson([
    "motion", "add",
    "--url", "https://example.com/result-cli",
    "--premise", "This offer matters when the public CLI should close the draft loop.",
    "--audience", "Marketing leaders",
    "--signal", "company::Is the team increasing paid spend?",
  ]);
  cli(["motion", "restart", motion.id]);

  const company = cliJson([
    "companies", "add",
    "--name", "CLI Results Co",
    "--domain", "cli-results.example",
    "--motion", motion.id,
  ]);
  const prospect = cliJson([
    "companies", "prospects", "add", company.id,
    "--motion", motion.id,
    "--name", "Devon Direct",
    "--title", "VP Marketing",
    "--buying-committee-role", "operator_champion",
    "--decision-authority", "influences",
    "--fit-confidence", "moderate",
    "--why-relevant", "Owns the follow-up branch.",
  ]).prospects[0];

  cli([
    "companies", "prospects", "draft", "approve", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--surface", "post_accept_message",
    "--body", "First post-accept message.",
  ]);

  const result = cliJson([
    "actions", "result",
    "--action", "send_direct_message",
    "--result", "sent",
    "--motion", motion.id,
    "--company", company.id,
    "--prospect", prospect.id,
    "--surface", "post_accept_message",
    "--occurred-at", "2026-06-02T13:00:00.000Z",
  ]);

  assert.equal(result.actionResult.action.key, "send_direct_message");
  assert.equal(result.actionResult.result.key, "sent");
  assert.equal(result.actionResult.surface, "post_accept_message");
  assert.equal(result.actionResult.draftMarkedSent, true);

  const stored = reProspect(prospect.id)?.prospect;
  assert.ok(stored?.touches.some((touch) => touch.surface === "post_accept_message" && touch.outcome === "sent"));
  assert.equal(
    stored?.touches.find((touch) => touch.surface === "post_accept_message" && touch.outcome === "sent")?.body,
    "First post-accept message.",
  );
  assert.equal(stored?.drafts.find((draft) => draft.surface === "post_accept_message")?.status, "sent");
  assert.equal(stored?.cadenceState.currentStep, "direct-message");
});

test("recordActionResult can mark an inbound LinkedIn reply as unavailable and remove it from the send queue", () => {
  const motion = cliJson([
    "motion", "add",
    "--url", "https://example.com/result-unavailable",
    "--premise", "This offer matters when a governed reply path can be terminally unavailable.",
    "--audience", "Partnership leaders",
    "--signal", "company::Is the current conversation blocked on a governed reply path?",
  ]);
  cli(["motion", "restart", motion.id]);

  const company = cliJson([
    "companies", "add",
    "--name", "Unavailable Reply Co",
    "--domain", "unavailable-reply.example",
    "--motion", motion.id,
  ]);
  const prospect = cliJson([
    "companies", "prospects", "add", company.id,
    "--motion", motion.id,
    "--name", "David Terry",
    "--title", "Partnerships Lead",
    "--buying-committee-role", "operator_champion",
    "--decision-authority", "influences",
    "--fit-confidence", "moderate",
    "--why-relevant", "Sent an inbound LinkedIn reply that cannot be answered on the governed thread.",
  ]).prospects[0];

  cli([
    "companies", "touches", "add", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--surface", "inbound_reply",
    "--direction", "inbound",
    "--outcome", "replied",
    "--occurred-at", "2026-06-04T22:20:00.000Z",
    "--summary", "David Terry replied on LinkedIn.",
  ]);

  cli([
    "companies", "cadence", "set", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--current-step", "direct-message",
    "--next-action", "Reply to David Terry on LinkedIn.",
  ]);

  cli([
    "companies", "prospects", "draft", "approve", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--surface", "inbound_reply",
    "--body", "Queued reply body.",
  ]);

  const result = recordActionResult({
    actionKey: "send_direct_message",
    resultKey: "unavailable",
    motionId: motion.id,
    companyId: company.id,
    prospectId: prospect.id,
    surface: "inbound_reply",
    occurredAt: "2026-06-04T22:30:00.000Z",
    summary: "Could not send the governed LinkedIn reply because the thread is read-only and reply is disabled.",
    notes: "Unipile shows the LinkedIn thread as read_only with disabledFeatures.reply.",
    nextAction: null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.actionResult.result.key, "unavailable");
  assert.equal(result.actionResult.touchRecorded, true);
  assert.equal(result.actionResult.draftMarkedDiscarded, true);

  const stored = reProspect(prospect.id)?.prospect;
  assert.ok(stored, "prospect exists after unavailable reply result");
  assert.equal(stored.drafts.find((draft) => draft.surface === "inbound_reply")?.status, "discarded");
  assert.ok(stored.touches.some((touch) =>
    touch.surface === "inbound_reply"
    && touch.outcome === "blocked"
    && touch.notes === "Unipile shows the LinkedIn thread as read_only with disabledFeatures.reply."
  ));
  assert.equal(stored.cadenceState.nextAction, null);

  const queue = buildAgentQueue({
    motions: [findMotionById(motion.id)],
    companies: [company],
    profiles: [],
    users: [],
    observations: [],
  });
  assert.equal(queue.tasks.some((task) =>
    task.kind === "send_message" && task.prospectId === prospect.id && task.surface === "inbound_reply"
  ), false);
});

test("companies touches add delegates canonical touch results through the governed action-result path", () => {
  const motion = cliJson([
    "motion", "add",
    "--url", "https://example.com/result-touch-delegate",
    "--premise", "This offer matters when canonical touch logging should reuse the same governed result path.",
    "--audience", "Operations leaders",
    "--signal", "company::Is outbound state fragmented across tools?",
  ]);
  cli(["motion", "restart", motion.id]);

  const company = cliJson([
    "companies", "add",
    "--name", "Delegate Results Co",
    "--domain", "delegate-results.example",
    "--motion", motion.id,
  ]);
  const prospect = cliJson([
    "companies", "prospects", "add", company.id,
    "--motion", motion.id,
    "--name", "Parker Path",
    "--title", "VP Operations",
    "--linkedin-profile-url", "https://www.linkedin.com/in/parker-path/",
    "--buying-committee-role", "operator_champion",
    "--decision-authority", "influences",
    "--fit-confidence", "moderate",
    "--why-relevant", "Owns the ready branch.",
  ]).prospects[0];

  cli([
    "companies", "prospects", "draft", "approve", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--surface", "connection_request",
    "--body", "Short note for the connection request.",
  ]);

  const result = cliJson([
    "companies", "touches", "add", company.id,
    "--motion", motion.id,
    "--prospect", prospect.id,
    "--surface", "connection_request",
    "--direction", "outbound",
    "--outcome", "sent",
    "--occurred-at", "2026-06-02T13:00:00.000Z",
    "--summary", "Sent the connection request through the low-level touch path.",
  ]);

  assert.ok(result.prospect, "prospect returned from touches add");
  assert.equal(result.prospect.drafts.find((draft) => draft.surface === "connection_request")?.status, "sent");
  assert.equal(result.prospect.cadenceState.currentStep, "connection-request");
  assert.equal(result.prospect.cadenceState.lastTouchOutcome, "sent");
  assert.ok(result.touches.some((touch) =>
    touch.surface === "connection_request"
    && touch.outcome === "sent"
    && touch.occurredAt === "2026-06-02T13:00:00.000Z"
  ));
});

test.after(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});
