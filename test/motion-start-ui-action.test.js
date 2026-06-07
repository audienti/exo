// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-ui-action-"));
process.env.EXO_STATE_DIR = stateDir;

const { executeActionIntent } = await import("../src/core/execute-action-intent.js");
const { findMotionById, insertMotion, listMotions } = await import("../src/db/database.js");
const { TRANSITION_MOTION_MARKER_URL } = await import("../src/core/ensure-transition-motion.js");

const seededOfferHtml = [
  "<html>",
  "<head>",
  "<title>Seeded Motion</title>",
  '<meta name="description" content="Seeded motion fixture." />',
  "</head>",
  "<body>ok</body>",
  "</html>",
].join("");
const seededOfferUrl = `data:text/html,${encodeURIComponent(seededOfferHtml)}`;
const freshOfferHtml = [
  "<html>",
  "<head>",
  "<title>Fresh Motion</title>",
  '<meta name="description" content="Fresh motion fixture." />',
  "</head>",
  "<body>ok</body>",
  "</html>",
].join("");
const freshOfferUrl = `data:text/html,${encodeURIComponent(freshOfferHtml)}`;
const multiSignalOfferHtml = [
  "<html>",
  "<head>",
  "<title>Multi Signal Motion</title>",
  '<meta name="description" content="Multi signal motion fixture." />',
  "</head>",
  "<body>ok</body>",
  "</html>",
].join("");
const multiSignalOfferUrl = `data:text/html,${encodeURIComponent(multiSignalOfferHtml)}`;

/**
 * @param {string[]} args
 */
function cliJson(args) {
  return JSON.parse(
    execFileSync("node", [cliPath, ...args, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: stateDir },
      encoding: "utf8",
    }),
  );
}

const launchUser = cliJson(["users", "add", "--label", "Launch User"]);

test("startMotionFromIntake creates a motion and returns the routed destination", async () => {
  const beforeCount = listMotions().length;

  const result = await executeActionIntent({
    writer: "startMotionFromIntake",
    args: {
      userId: launchUser.id,
      url: freshOfferUrl,
      premise: "This offer matters when operators need the motions UI to start real work.",
      audience: "Revenue leaders",
      signal: "company::Is there recent evidence the team widened GTM scope?",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.writer, "startMotionFromIntake");
  assert.match(result.message, /Created motion/i);
  assert.match(result.redirect ?? "", /^\/motions\//);

  const createdId = String(result.redirect).split("/").at(-1);
  const created = createdId ? findMotionById(createdId) : null;
  assert.ok(created, "created motion should be persisted");
  assert.equal(created?.offer.sourceUrl, freshOfferUrl);
  assert.equal(created?.engagementUserAssignment?.userId, launchUser.id);
  assert.equal(listMotions().length, beforeCount + 1);
});

test("startMotionFromIntake can continue an existing motion without creating a duplicate", async () => {
  const existing = cliJson([
    "motion",
    "start",
    "--url",
    seededOfferUrl,
    "--premise",
    "This offer matters when operators need a governed reuse path.",
    "--audience",
    "Revenue leaders",
    "--signal",
    "company::Is there recent evidence the team widened GTM scope?",
  ]);

  const beforeCount = listMotions().length;
  const result = await executeActionIntent({
    writer: "startMotionFromIntake",
    args: {
      userId: launchUser.id,
      url: seededOfferUrl,
      existingStrategy: "continue",
      sourceMotionId: existing.motion.id,
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /Continuing/i);
  assert.equal(result.redirect, `/motions/${existing.motion.id}`);
  assert.equal(findMotionById(existing.motion.id)?.engagementUserAssignment?.userId, launchUser.id);
  assert.equal(listMotions().length, beforeCount);
});

test("startMotionFromIntake splits multiline signal input into multiple motion signals", async () => {
  const result = await executeActionIntent({
    writer: "startMotionFromIntake",
    args: {
      userId: launchUser.id,
      url: multiSignalOfferUrl,
      premise: "This offer matters when operators need more than one signal to steer motion research.",
      audience: "Revenue leaders",
      signal: [
        "company::Is there recent evidence the team widened GTM scope?",
        "person::Is there recent evidence the likely owner is posting about pipeline coverage?",
      ].join("\n"),
    },
  });

  assert.equal(result.ok, true);
  const createdId = String(result.redirect).split("/").at(-1);
  const created = createdId ? findMotionById(createdId) : null;
  assert.ok(created, "created motion should be persisted");
  assert.deepEqual(
    created?.signals.map((signal) => signal.question),
    [
      "Is there recent evidence the team widened GTM scope?",
      "Is there recent evidence the likely owner is posting about pipeline coverage?",
    ],
  );
  assert.deepEqual(
    created?.signals.map((signal) => signal.scope),
    ["company", "person"],
  );
  assert.equal(created?.engagementUserAssignment?.userId, launchUser.id);
});

test("startMotionFromIntake opens the transition backlog container for the selected user", async () => {
  const seeded = cliJson([
    "motion",
    "start",
    "--url",
    "data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3ETransition%20Seed%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3Eok%3C%2Fbody%3E%3C%2Fhtml%3E",
    "--premise",
    "This offer matters when tests need a seed motion they can repurpose into the transition backlog.",
    "--audience",
    "Operators",
    "--signal",
    "company::Is there recent evidence this workspace is carrying legacy relationships?",
  ]).motion;
  insertMotion({
    ...seeded,
    id: randomUUID(),
    name: "transition-inbound-backlog",
    offer: {
      ...seeded.offer,
      sourceUrl: TRANSITION_MOTION_MARKER_URL,
    },
    engagementUserAssignment: null,
  });

  const result = await executeActionIntent({
    writer: "startMotionFromIntake",
    args: {
      mode: "transition",
      userId: launchUser.id,
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /Opened transition backlog/i);
  assert.match(result.redirect ?? "", /^\/motions\//);

  const transitionId = String(result.redirect).split("/").at(-1);
  const transition = transitionId ? findMotionById(transitionId) : null;
  assert.ok(transition, "transition backlog should exist");
  assert.equal(transition?.offer.sourceUrl, TRANSITION_MOTION_MARKER_URL);
  assert.equal(transition?.engagementUserAssignment?.userId, launchUser.id);
});
