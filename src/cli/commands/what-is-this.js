#!/usr/bin/env node
// @ts-check

import { describeExo } from "../../core/what-is-this.js";
import { renderWhatIsThis } from "../../artifacts/render-what-is-this.js";

/**
 * @param {import("commander").Command} program
 */
export function registerWhatIsThis(program) {
  program
    .command("what-is-this")
    .alias("about")
    .description("Explain what Exo is, how to use it, and what is currently implemented.")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Use this command first when a human or agent needs to orient itself.

Examples:
  exo what-is-this
  exo what-is-this --json
  exo about --json
`
    )
    .action((options) => {
      const description = describeExo();

      if (options.json) {
        console.log(JSON.stringify(description, null, 2));
        return;
      }

      console.log(renderWhatIsThis(description));
    });
}
