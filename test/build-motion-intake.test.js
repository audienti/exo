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

test("motion intake treats continue and clone as ready when an existing motion already covers the required definition", async () => {
  const existing = await createMotion("existing");

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
    },
    [existing],
  );

  assert.equal(cloned.status, "ready-to-launch");
  assert.equal(cloned.readyToLaunch, true);
  assert.equal(cloned.nextQuestion, null);
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
