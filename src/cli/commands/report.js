#!/usr/bin/env node
// @ts-check

import { renderMotionReport } from "../../artifacts/render-motion.js";
import { buildMotionReport } from "../../core/build-motion-report.js";
import { findMotionById, listBrowserProfiles, listCompanies, listUsers } from "../../db/database.js";

/**
 * @param {import("commander").Command} program
 */
export function registerReport(program) {
  const report = program
    .command("report")
    .description("Render operator-facing composite reports from governed Exo state.")
    .addHelpText(
      "after",
      `
Canonical report interface:
  exo report motion <motion-id>

Rules:
  - Reports are composite read paths over the existing Exo state model.
  - Use this when you want one operator view instead of jumping between show, target, and prospects.
  - Reports do not mutate state.
`
    );

  report
    .command("motion")
    .description("Show one unified motion report: setup, readiness, company progress, prospects, and next actions.")
    .argument("<motion-id>", "Motion identifier")
    .option("--capability <capability>", "Browser capability required for engagement readiness. Defaults to linkedin.")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo report motion <motion-id>
  exo report motion <motion-id> --json
  exo report motion <motion-id> --capability linkedin --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);
      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const result = buildMotionReport(raw, listCompanies(), listBrowserProfiles(), listUsers(), {
        capability: options.capability
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderMotionReport(result));
    });
}
