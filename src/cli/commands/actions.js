#!/usr/bin/env node
// @ts-check

import { renderActionCatalog, renderActionDetail } from "../../artifacts/render-actions.js";
import { recordActionResult } from "../../core/record-action-result.js";
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
  exo actions result --action <action-key> --result <result-key> --company <company-id> --prospect <prospect-id>

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

  actions
    .command("result")
    .description("Write back the governed result of an action that actually happened.")
    .requiredOption("--action <action-key>", "Canonical action key")
    .requiredOption("--result <result-key>", "Governed result key for that action")
    .option("--motion <motion-id>", "Motion identifier")
    .option("--company <company-id>", "Company identifier")
    .option("--prospect <prospect-id>", "Prospect identifier")
    .option("--observation <observation-id>", "Linked inbound observation to reconcile during the result writeback")
    .option("--surface <surface>", "Explicit touch/draft surface when the action maps to more than one writing surface")
    .option("--occurred-at <timestamp>", "When the result actually happened (ISO timestamp)")
    .option("--summary <text>", "Override the stored touch/observation summary")
    .option("--subject <text>", "Subject line for email / InMail outcomes")
    .option("--body <text>", "Body text for the stored touch evidence")
    .option("--source-url <url>", "Source URL for the recorded touch evidence")
    .option("--notes <text>", "Operator notes for the writeback")
    .option("--next-action <text>", "Override the next planned action after this result")
    .option("--next-action-due-at <timestamp>", "Override the next action due time")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      try {
        const result = recordActionResult({
          actionKey: options.action,
          resultKey: options.result,
          motionId: options.motion ?? null,
          companyId: options.company ?? null,
          prospectId: options.prospect ?? null,
          observationId: options.observation ?? null,
          surface: options.surface ?? null,
          occurredAt: options.occurredAt ?? null,
          summary: options.summary ?? null,
          subject: options.subject ?? null,
          body: options.body ?? null,
          sourceUrl: options.sourceUrl ?? null,
          notes: options.notes ?? null,
          nextAction: options.nextAction,
          nextActionDueAt: options.nextActionDueAt,
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(result.actionResult.message);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
