#!/usr/bin/env node
// @ts-check

import { buildSetupIntake } from "../../core/build-setup-intake.js";

/**
 * @param {import("commander").Command} program
 */
export function registerSetup(program) {
  const setup = program
    .command("setup")
    .description("Chat-first setup routing for new users and new motions.");

  setup
    .command("intake")
    .description("Inspect a chat message, detect whether it is setting up a user or motion, and return the next governed question.")
    .requiredOption("--message <message>", "Freeform operator message describing the setup request")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo setup intake --message "Add a new user named Sarah Chen" --json
  exo setup intake --message "We need a new motion for https://example.com/product" --json
`
    )
    .action((options) => {
      const result = buildSetupIntake({ message: options.message ?? null });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Setup route: ${result.route}`);
      console.log(`Intent: ${result.detectedIntent.kind}`);
      if (result.nextQuestion?.prompt) {
        console.log(`Next question: ${result.nextQuestion.prompt}`);
      }
      if (result.applyCommandHint) {
        console.log(`Apply hint: ${result.applyCommandHint}`);
      }
    });
}
