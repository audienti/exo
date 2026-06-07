// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildMotionIntake } from "../src/core/build-motion-intake.js";
import { defineMotion } from "../src/core/define-motion.js";

const offerHtml = [
  "<html>",
  "<head>",
  "<title>Motion Intake Fixture</title>",
  '<meta name="description" content="Motion intake test fixture." />',
  "</head>",
  "<body>ok</body>",
  "</html>",
].join("");
const offerUrl = `data:text/html,${encodeURIComponent(offerHtml)}`;

async function createMotion(nameSuffix) {
  return defineMotion({
    url: offerUrl,
    name: `fixture-${nameSuffix}`,
    offerNotes: null,
    premise: {
      statement: "This offer matters when operators need one governed intake path.",
      source: "operator",
    },
    audienceHypotheses: ["Revenue leaders"],
    signals: ["company::Is there recent evidence the team widened GTM scope?"],
    targetingProfile: {},
    suppressionPolicy: {},
  });
}

/**
 * @param {import("../src/schema/motion.js").motionSchema._type} motion
 * @param {string} userId
 * @param {string} [label]
 */
function assignFixtureUser(motion, userId, label = "Launch User") {
  motion.engagementUserAssignment = {
    userId,
    label,
    owner: null,
    accountRefs: [],
    assignedAt: "2026-06-07T10:00:00.000Z",
    assignedBy: "test",
    reason: "fixture",
    sticky: true,
  };
  return motion;
}

test("motion intake asks for a launch user before continuing or cloning an unassigned motion", async () => {
  const existing = await createMotion("existing");

  const continued = buildMotionIntake(
    {
      url: offerUrl,
      existingStrategy: "continue",
    },
    [existing],
  );

  assert.equal(continued.status, "needs-question");
  assert.equal(continued.readyToLaunch, false);
  assert.equal(continued.nextQuestion?.key, "launch-user");

  const cloned = buildMotionIntake(
    {
      url: offerUrl,
      existingStrategy: "clone",
    },
    [existing],
  );

  assert.equal(cloned.status, "needs-question");
  assert.equal(cloned.readyToLaunch, false);
  assert.equal(cloned.nextQuestion?.key, "launch-user");
});

test("motion intake is ready when continuing an already assigned motion or cloning with a selected launch user", async () => {
  const existing = assignFixtureUser(await createMotion("existing"), "user-1");

  const continued = buildMotionIntake(
    {
      url: offerUrl,
      existingStrategy: "continue",
    },
    [existing],
  );

  assert.equal(continued.status, "ready-to-launch");
  assert.equal(continued.readyToLaunch, true);
  assert.equal(continued.nextQuestion, null);

  const cloned = buildMotionIntake(
    {
      url: offerUrl,
      existingStrategy: "clone",
      launchUserId: "user-1",
    },
    [existing],
  );

  assert.equal(cloned.status, "ready-to-launch");
  assert.equal(cloned.readyToLaunch, true);
  assert.equal(cloned.nextQuestion, null);
});

test("motion intake asks for a launch user after the fresh motion definition is complete", () => {
  const result = buildMotionIntake(
    {
      url: "https://example.com/fresh-offer",
      premise: {
        statement: "This offer matters when operators need assignment in the intake itself.",
        source: "operator",
      },
      audienceHypotheses: ["Revenue leaders"],
      signals: ["company::Is there recent evidence this team widened GTM scope?"],
    },
    [],
  );

  assert.equal(result.status, "needs-question");
  assert.equal(result.readyToLaunch, false);
  assert.equal(result.nextQuestion?.key, "launch-user");
});

test("motion intake asks for the specific source motion before continue or clone when multiple motions share one URL", async () => {
  const first = await createMotion("first");
  const second = await createMotion("second");

  const result = buildMotionIntake(
    {
      url: offerUrl,
      existingStrategy: "continue",
    },
    [first, second],
  );

  assert.equal(result.status, "needs-question");
  assert.equal(result.nextQuestion?.key, "source-motion");
  assert.match(result.nextQuestion?.prompt ?? "", /which one/i);
  assert.equal(result.readyToLaunch, false);
});
