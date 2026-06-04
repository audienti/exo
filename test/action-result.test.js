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
const { findMotionById, listInboundObservations, listMotions } = await import("../src/db/database.js");

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
