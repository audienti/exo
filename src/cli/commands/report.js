#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import path from "node:path";
import { renderMotionReport } from "../../artifacts/render-motion.js";
import { buildDailyView } from "../../core/build-daily-view.js";
import { buildInboxView } from "../../core/build-inbox-view.js";
import { buildInboundReviewView } from "../../core/build-inbound-review-view.js";
import { buildMotionReport } from "../../core/build-motion-report.js";
import {
  findMotionById,
  findUserById,
  listBrowserProfiles,
  listCompanies,
  listInboundCues,
  listInboundObservations,
  listMotions,
  listUsers,
} from "../../db/database.js";
import { buildWorkspaceModel } from "../../../prototype/build-motion-workspace.mjs";

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
  exo report workspace --user <user-id> --out ./motion-workspace.html

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

  report
    .command("workspace")
    .description("Render one read-only workspace projection across truth surfaces, motions, prep, engagement, and planner pressure.")
    .option("--user <user-id>", "Execution user identifier")
    .option("--capability <capability>", "Browser capability used when deriving motion engagement readiness. Defaults to linkedin.")
    .option("--out <path>", "Write HTML output to this path instead of stdout")
    .option("--json", "Emit the derived workspace projection as machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo report workspace --user <user-id> --out ./motion-workspace.html
  exo report workspace --user <user-id> --json

Rules:
  - This is a composite operator projection over inbound review, inbox, daily, motion list, and motion reports.
  - Prep lanes and engagement lanes are derived views, not a new canonical stage model.
  - HTML output is read-only and does not open the browser.
`
    )
    .action((options) => {
      if (options.json && options.out) {
        console.error("Use either --json or --out for report workspace, not both together.");
        process.exitCode = 1;
        return;
      }

      const user = resolveReportUser(options.user, "workspace");
      if (!user) {
        return;
      }

      const motions = listMotions();
      const companies = listCompanies();
      const browserProfiles = listBrowserProfiles();
      const users = listUsers();
      const observations = listInboundObservations({
        userId: user.id,
      });
      const cues = listInboundCues({
        userId: user.id,
        status: "open",
      });

      const inboundReview = buildInboundReviewView(user, observations, motions, companies);
      const inbox = buildInboxView(user, observations, motions, companies);
      const daily = buildDailyView(user, motions, companies, browserProfiles, observations, {
        rawCues: cues,
      });
      const reports = motions.map((motion) =>
        buildMotionReport(motion, companies, browserProfiles, users, {
          capability: options.capability,
        }),
      );
      const regenerateCommand = `exo report workspace --user ${user.id} --out ${
        options.out ?? "./motion-workspace.html"
      }`;
      const result = buildWorkspaceModel({
        user,
        inboundReview,
        inbox,
        daily,
        reports,
        regenerateCommand,
      });

      if (options.json) {
        console.log(JSON.stringify(result.data, null, 2));
        return;
      }

      if (options.out) {
        const outputPath = path.resolve(process.cwd(), options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, result.html, "utf8");
        console.log(`Workspace report written to ${outputPath}`);
        return;
      }

      console.log(result.html);
    });
}

/**
 * @param {string | undefined} explicitUserId
 * @param {string} surface
 */
function resolveReportUser(explicitUserId, surface) {
  if (explicitUserId) {
    const user = findUserById(explicitUserId);
    if (!user) {
      console.error(`User not found: ${explicitUserId}`);
      process.exitCode = 1;
      return null;
    }
    return user;
  }

  const users = listUsers();
  if (users.length === 1) {
    return users[0];
  }

  if (!users.length) {
    console.error("No execution users exist yet. Add a user first or pass --user explicitly.");
  } else {
    console.error(`More than one execution user exists. Pass --user to choose the report ${surface} owner.`);
  }
  process.exitCode = 1;
  return null;
}
