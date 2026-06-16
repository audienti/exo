#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import path from "node:path";
import { renderMotionReport } from "../../artifacts/render-motion.js";
import { renderConnectionsPage } from "../../artifacts/render-connections.js";
import { renderExecutionPage } from "../../artifacts/render-execution.js";
import { renderMotionsPage } from "../../artifacts/render-motions.js";
import { renderOperatorPage } from "../../artifacts/render-operator.js";
import { renderProspectsPage } from "../../artifacts/render-prospects.js";
import { renderWorkspaceRollupPage } from "../../artifacts/render-workspace-rollup.js";
import { buildConnectionsViewModel } from "../../core/build-connections-view.js";
import { buildExecutionViewModel } from "../../core/build-execution-view.js";
import { buildMotionReport } from "../../core/build-motion-report.js";
import { buildMotionsViewModel } from "../../core/build-motions-view.js";
import { buildOperatorViewModel } from "../../core/build-operator-view.js";
import { buildProspectsViewModel } from "../../core/build-prospects-view.js";
import { buildWorkspaceRollup } from "../../core/build-workspace-rollup.js";
import {
  findMotionById,
  findUserById,
  listActivityEvents,
  listBrowserProfiles,
  listCompanies,
  listMotions,
  listUsers,
} from "../../db/database.js";
import { summarizeExecutionUsers } from "../../lib/execution-users.js";
import { buildWorkspaceProjection, startWorkspaceServer } from "../workspace-runtime.js";

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
  exo report operator --user <user-id> --out ./operator.html
  exo report motions --user <user-id> --out ./motions.html
  exo report prospects --user <user-id> --out ./prospects.html
  exo report execution --out ./execution.html
  exo report connections --user <user-id> --out ./connections.html
  exo report rollup --user <user-id> --out ./workspace.html
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
        capability: options.capability,
        rawActivityEvents: listActivityEvents({ motionId: raw.id }),
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderMotionReport(result));
    });

  report
    .command("operator")
    .description("Render the Operator landing surface (Next move, decisions, agent queue, blocked, stale, agenda) for one user.")
    .option("--user <user-id>", "Execution user identifier")
    .option("--capability <capability>", "Browser capability used when deriving motion engagement readiness. Defaults to linkedin.")
    .option("--out <path>", "Write HTML output to this path instead of stdout")
    .option("--json", "Emit the derived operator-landing view model as machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo report operator --user <user-id> --out ./operator.html
  exo report operator --user <user-id> --json

Rules:
  - Reads governed Exo state and the workspace projection — no mutation.
  - HTML output follows the Exo UI Build Spec (operator-first, three-axis status).
  - Surfaces map: next move + need decision + agent queue + blocked + stale + today.
`
    )
    .action((options) => {
      if (options.json && options.out) {
        console.error("Use either --json or --out for report operator, not both together.");
        process.exitCode = 1;
        return;
      }

      const user = resolveReportUser(options.user, "operator");
      if (!user) {
        return;
      }

      const regenerateCommand = `exo report operator --user ${user.id} --out ${options.out ?? "./operator.html"}`;
      const projection = buildWorkspaceProjection({
        userId: user.id,
        capability: options.capability,
        regenerateCommand,
      });
      const data = projection.data;
      const model = buildOperatorViewModel({
        user: data.user,
        generatedAt: data.generatedAt,
        regenerateCommand,
        operatorSummary: data.operatorSummary,
        decisionQueue: data.decisionQueue,
        agentQueue: data.agentQueue,
        blockedQueue: data.blockedQueue,
        dueNowItems: data.dueNowItems,
        waitingItems: data.waitingItems,
        truthAccounts: data.truthAccounts,
        rawMotions: listMotions(),
      });

      if (options.json) {
        console.log(JSON.stringify(model, null, 2));
        return;
      }

      const html = renderOperatorPage(model);

      if (options.out) {
        const outputPath = path.resolve(process.cwd(), options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, html, "utf8");
        console.log(`Operator landing report written to ${outputPath}`);
        return;
      }

      console.log(html);
    });

  report
    .command("motions")
    .description("Render the Motions surface (list + per-motion detail: offer → premise → signals → audiences → matches → plan).")
    .option("--user <user-id>", "Execution user identifier")
    .option("--capability <capability>", "Browser capability used when deriving motion engagement readiness. Defaults to linkedin.")
    .option("--out <path>", "Write HTML output to this path instead of stdout")
    .option("--json", "Emit the derived motions view model as machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo report motions --user <user-id> --out ./motions.html
  exo report motions --user <user-id> --json

Rules:
  - Reads governed Exo state and the workspace projection — no mutation.
  - Motion detail inverts the hierarchy: the premise leads, the codename does not.
  - Each list card anchor-links to its full detail in the same document.
`
    )
    .action((options) => {
      if (options.json && options.out) {
        console.error("Use either --json or --out for report motions, not both together.");
        process.exitCode = 1;
        return;
      }

      const user = resolveReportUser(options.user, "motions");
      if (!user) {
        return;
      }

      const regenerateCommand = `exo report motions --user ${user.id} --out ${options.out ?? "./motions.html"}`;
      const projection = buildWorkspaceProjection({
        userId: user.id,
        capability: options.capability,
        regenerateCommand,
      });
      const data = projection.data;
      const model = buildMotionsViewModel({
        motionSummaries: data.motionSummaries,
        motionDetails: data.motionDetails,
        rawMotions: listMotions(),
        rawCompanies: listCompanies(),
      });

      if (options.json) {
        console.log(JSON.stringify(model, null, 2));
        return;
      }

      const html = renderMotionsPage(model, {
        user: data.user,
        generatedAt: data.generatedAt,
        regenerateCommand,
      });

      if (options.out) {
        const outputPath = path.resolve(process.cwd(), options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, html, "utf8");
        console.log(`Motions report written to ${outputPath}`);
        return;
      }

      console.log(html);
    });

  report
    .command("prospects")
    .description("Render the Prospects surface (All table + By-company groups + per-person detail) for one user.")
    .option("--user <user-id>", "Execution user identifier")
    .option("--capability <capability>", "Browser capability used when deriving engagement readiness. Defaults to linkedin.")
    .option("--out <path>", "Write HTML output to this path instead of stdout")
    .option("--json", "Emit the derived prospects view model as machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo report prospects --user <user-id> --out ./prospects.html
  exo report prospects --user <user-id> --json

Rules:
  - Reads governed Exo state and the workspace projection — no mutation.
  - Canonical people inventory: name, title, company, surfacing signal, fit, branch, owner.
  - Each name anchor-links to a person detail (signal, premise, next step, colleagues).
`
    )
    .action((options) => {
      if (options.json && options.out) {
        console.error("Use either --json or --out for report prospects, not both together.");
        process.exitCode = 1;
        return;
      }

      const user = resolveReportUser(options.user, "prospects");
      if (!user) {
        return;
      }

      const regenerateCommand = `exo report prospects --user ${user.id} --out ${options.out ?? "./prospects.html"}`;
      const projection = buildWorkspaceProjection({
        userId: user.id,
        capability: options.capability,
        regenerateCommand,
      });
      const data = projection.data;
      const model = buildProspectsViewModel({
        prospectPrepLanes: data.prospectPrepLanes,
        engagementLanes: data.engagementLanes,
        motionDetails: data.motionDetails,
        rawMotions: listMotions(),
      });

      if (options.json) {
        console.log(JSON.stringify(model, null, 2));
        return;
      }

      const html = renderProspectsPage(model, {
        user: data.user,
        generatedAt: data.generatedAt,
        regenerateCommand,
      });

      if (options.out) {
        const outputPath = path.resolve(process.cwd(), options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, html, "utf8");
        console.log(`Prospects report written to ${outputPath}`);
        return;
      }

      console.log(html);
    });

  report
    .command("execution")
    .description("Render the Execution surface: users → assigned motions, connected accounts, and capability coverage.")
    .option("--out <path>", "Write HTML output to this path instead of stdout")
    .option("--json", "Emit the derived execution view model as machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo report execution --out ./execution.html
  exo report execution --json

Rules:
  - Reads governed Exo state (users, accounts, browser profiles, motions) — no mutation.
  - Ownership and transport identity stay separate from GTM objects.
  - Each user anchor-links to assigned motions, connected accounts, capability coverage.
`
    )
    .action((options) => {
      if (options.json && options.out) {
        console.error("Use either --json or --out for report execution, not both together.");
        process.exitCode = 1;
        return;
      }

      const model = buildExecutionViewModel({
        rawUsers: listUsers(),
        rawMotions: listMotions(),
        rawCompanies: listCompanies(),
        rawProfiles: listBrowserProfiles(),
      });

      if (options.json) {
        console.log(JSON.stringify(model, null, 2));
        return;
      }

      const regenerateCommand = `exo report execution --out ${options.out ?? "./execution.html"}`;
      const html = renderExecutionPage(model, {
        user: null,
        generatedAt: new Date().toISOString(),
        regenerateCommand,
      });

      if (options.out) {
        const outputPath = path.resolve(process.cwd(), options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, html, "utf8");
        console.log(`Execution report written to ${outputPath}`);
        return;
      }

      console.log(html);
    });

  report
    .command("connections")
    .description("Render the Connections surface (inbound truth): received/sent/following/followers/views with per-surface freshness.")
    .option("--user <user-id>", "Execution user identifier")
    .option("--capability <capability>", "Browser capability used when deriving engagement readiness. Defaults to linkedin.")
    .option("--out <path>", "Write HTML output to this path instead of stdout")
    .option("--json", "Emit the derived connections view model as machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo report connections --user <user-id> --out ./connections.html
  exo report connections --user <user-id> --json

Rules:
  - First-class inbound truth domain — not buried in an activity log.
  - Each tab itemizes its surface and shows freshness; Empty / Partial / Failed stay distinct.
`
    )
    .action((options) => {
      if (options.json && options.out) {
        console.error("Use either --json or --out for report connections, not both together.");
        process.exitCode = 1;
        return;
      }

      const user = resolveReportUser(options.user, "connections");
      if (!user) {
        return;
      }

      const regenerateCommand = `exo report connections --user ${user.id} --out ${options.out ?? "./connections.html"}`;
      const projection = buildWorkspaceProjection({
        userId: user.id,
        capability: options.capability,
        regenerateCommand,
      });
      const data = projection.data;
      const model = buildConnectionsViewModel({
        observations: data.observations,
        reviewItems: data.reviewItems,
        truthAccounts: data.truthAccounts,
      });

      if (options.json) {
        console.log(JSON.stringify(model, null, 2));
        return;
      }

      const html = renderConnectionsPage(model, {
        user: data.user,
        generatedAt: data.generatedAt,
        regenerateCommand,
      });

      if (options.out) {
        const outputPath = path.resolve(process.cwd(), options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, html, "utf8");
        console.log(`Connections report written to ${outputPath}`);
        return;
      }

      console.log(html);
    });

  report
    .command("rollup")
    .description("Render the Workspace rollup (Exo UI spec): stat strip + operator pulse, motions readiness, surface freshness, execution.")
    .option("--user <user-id>", "Execution user identifier")
    .option("--capability <capability>", "Browser capability used when deriving engagement readiness. Defaults to linkedin.")
    .option("--out <path>", "Write HTML output to this path instead of stdout")
    .option("--json", "Emit the derived rollup view model as machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo report rollup --user <user-id> --out ./workspace.html
  exo report rollup --user <user-id> --json

Rules:
  - Composed analytics overview — not another canonical domain.
  - Reuses the same status language across every panel and links back to its domain.
`
    )
    .action((options) => {
      if (options.json && options.out) {
        console.error("Use either --json or --out for report rollup, not both together.");
        process.exitCode = 1;
        return;
      }

      const user = resolveReportUser(options.user, "rollup");
      if (!user) {
        return;
      }

      const regenerateCommand = `exo report rollup --user ${user.id} --out ${options.out ?? "./workspace.html"}`;
      const projection = buildWorkspaceProjection({
        userId: user.id,
        capability: options.capability,
        regenerateCommand,
      });
      const data = projection.data;
      const executionModel = buildExecutionViewModel({
        rawUsers: listUsers(),
        rawMotions: listMotions(),
        rawCompanies: listCompanies(),
        rawProfiles: listBrowserProfiles(),
      });
      const model = buildWorkspaceRollup({
        operatorSummary: data.operatorSummary,
        decisionQueue: data.decisionQueue,
        agentQueue: data.agentQueue,
        blockedQueue: data.blockedQueue,
        motionSummaries: data.motionSummaries,
        truthAccounts: data.truthAccounts,
        reviewItems: data.reviewItems,
        executionUsers: executionModel.users,
      });

      if (options.json) {
        console.log(JSON.stringify(model, null, 2));
        return;
      }

      const html = renderWorkspaceRollupPage(model, {
        user: data.user,
        generatedAt: data.generatedAt,
        regenerateCommand,
      });

      if (options.out) {
        const outputPath = path.resolve(process.cwd(), options.out);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, html, "utf8");
        console.log(`Workspace rollup written to ${outputPath}`);
        return;
      }

      console.log(html);
    });

  report
    .command("workspace")
    .description("Render one read-only workspace projection across truth surfaces, motions, prep, engagement, and planner pressure.")
    .option("--user <user-id>", "Execution user identifier")
    .option("--capability <capability>", "Browser capability used when deriving motion engagement readiness. Defaults to linkedin.")
    .option("--out <path>", "Write HTML output to this path instead of stdout")
    .option("--serve [port]", "Serve an interactive workspace projection on localhost instead of writing a static file")
    .option("--json", "Emit the derived workspace projection as machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo report workspace --user <user-id> --out ./motion-workspace.html
  exo report workspace --user <user-id> --json
  exo report workspace --user <user-id> --serve 4312

Rules:
  - This is a composite operator projection over inbound review, inbox, daily, motion list, and motion reports.
  - Prep lanes and engagement lanes are derived views, not a new canonical stage model.
  - HTML output is read-only and does not open the browser.
  - Interactive serve mode can run state-only workspace actions, but live browser actions still need the outer agent/runtime.
`
    )
    .action(async (options) => {
      if (options.json && options.out) {
        console.error("Use either --json or --out for report workspace, not both together.");
        process.exitCode = 1;
        return;
      }

      if (options.serve && (options.json || options.out)) {
        console.error("Use --serve by itself for an interactive workspace surface.");
        process.exitCode = 1;
        return;
      }

      const user = resolveReportUser(options.user, "workspace");
      if (!user) {
        return;
      }

      if (options.serve) {
        try {
          const port = normalizeServePort(options.serve);
          const server = await startWorkspaceServer({
            userId: user.id,
            capability: options.capability,
            port,
          });
          console.log(`Workspace server listening at ${server.url}`);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
        return;
      }

      const regenerateCommand = `exo report workspace --user ${user.id} --out ${options.out ?? "./motion-workspace.html"}`;
      const result = buildWorkspaceProjection({
        userId: user.id,
        capability: options.capability,
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
  const { totalUserCount, eligibleUserCount, eligibleUsers } = summarizeExecutionUsers(users);
  if (eligibleUserCount === 1) {
    return eligibleUsers[0];
  }

  if (!totalUserCount) {
    console.error("No execution users exist yet. Start with `exo users intake --json`, then add a user or pass --user explicitly.");
  } else if (!eligibleUserCount) {
    console.error("No execution-capable users exist yet. Start with `exo users intake --json`, then map at least one connected account or pass --user explicitly.");
  } else {
    console.error(`More than one execution-capable user exists. Pass --user to choose the report ${surface} owner.`);
  }
  process.exitCode = 1;
  return null;
}

/**
 * @param {boolean | string | undefined} rawValue
 */
function normalizeServePort(rawValue) {
  if (rawValue === true || rawValue == null) {
    return 4312;
  }

  const numeric = Number(rawValue);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    throw new Error(`Invalid --serve port: ${String(rawValue)}`);
  }

  return numeric;
}
