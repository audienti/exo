#!/usr/bin/env node
// @ts-check

import { motionSchema } from "../../schema/motion.js";
import { findMotionById } from "../../db/database.js";
import { renderMotionSummary } from "../../artifacts/render-motion.js";

/**
 * @param {import("commander").Command} program
 */
export function registerShowMotion(program) {
  program
    .command("show-motion")
    .description("Show a stored motion.")
    .argument("<motion-id>", "Motion identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const motion = motionSchema.parse(raw);

      if (options.json) {
        console.log(JSON.stringify(motion, null, 2));
        return;
      }

      console.log(renderMotionSummary(motion));
    });
}

