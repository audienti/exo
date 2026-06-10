// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildNextView } from "../src/core/build-next-view.js";

test("buildNextView reuses a provided description for operator fallback", () => {
  const result = buildNextView({
    rawMotions: [],
    rawCompanies: [],
    rawProfiles: [],
    rawUsers: [],
    rawObservations: [],
    description: {
      agentUsage: {
        recommendedPath: {
          mode: "configure-execution-user",
          reason: "Sentinel reason from the prebuilt description.",
          focusMotionId: "motion-sentinel",
          focusMotionName: "Sentinel Motion",
          blockers: ["sentinel blocker"],
          commands: [],
        },
      },
      operatorInterface: {
        currentCall: {
          headline: "Sentinel headline",
          nextMove: "Sentinel next move",
          operatorPrompt: "Sentinel prompt",
        },
      },
    },
  });

  assert.equal(result.headline, "Sentinel headline");
  assert.equal(result.nextMove, "Sentinel next move");
  assert.equal(result.operatorPrompt, "Sentinel prompt");
  assert.equal(result.why, "Sentinel reason from the prebuilt description.");
  assert.equal(result.context.motion.id, "motion-sentinel");
  assert.equal(result.context.motion.name, "Sentinel Motion");
});
