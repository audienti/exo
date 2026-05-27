#!/usr/bin/env node
// @ts-check

import { renderActionCatalog, renderActionDetail } from "../../artifacts/render-actions.js";
import { findActionDefinition, listActionCatalog } from "../../lib/action-catalog.js";

/**
 * @param {import("commander").Command} program
 */
export function registerActions(program) {
  const actions = program
    .command("actions")
    .description("Inspect the canonical Audienti-style GTM action catalog.")
    .addHelpText(
      "after",
      `
Canonical actions interface:
  exo actions list
  exo actions show <action-key>

Rules:
  - This is the governed catalog of GTM actions Exo knows how to reason about.
  - It is not a browser automation API by itself.
  - Use motion action briefs when you need prospect-specific readiness and writeback paths.
`
    );

  actions
    .command("list")
    .description("List the canonical GTM actions Exo knows about.")
    .option("--platform <platform>", "Filter to one platform like linkedin or email")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const result = {
        actions: listActionCatalog({ platform: options.platform ?? null })
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderActionCatalog(result));
    });

  actions
    .command("show")
    .description("Show one canonical GTM action in detail.")
    .argument("<action-key>", "Canonical action key")
    .option("--json", "Emit machine-readable JSON")
    .action((actionKey, options) => {
      const action = findActionDefinition(actionKey);

      if (!action) {
        console.error(`Action not found: ${actionKey}`);
        process.exitCode = 1;
        return;
      }

      const result = { action };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderActionDetail(result));
    });
}
