#!/usr/bin/env node
// @ts-check

import { motionSchema } from "../../schema/motion.js";
import { listMotions } from "../../db/database.js";

/**
 * @param {import("commander").Command} program
 */
export function registerListMotions(program) {
  program
    .command("list-motions")
    .description("List stored motions.")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const motions = listMotions().map((motion) => motionSchema.parse(motion));

      if (options.json) {
        console.log(JSON.stringify(motions, null, 2));
        return;
      }

      if (!motions.length) {
        console.log("No motions found.");
        return;
      }

      for (const motion of motions) {
        console.log(`${motion.id}  ${motion.status}  ${motion.offer.sourceUrl}`);
      }
    });
}

