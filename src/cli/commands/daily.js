#!/usr/bin/env node
// @ts-check

import { renderDaily } from "../../artifacts/render-daily.js";
import { buildDailyView } from "../../core/build-daily-view.js";
import { buildUserWorkspaceContext } from "../../core/workspace-context.js";
import { findUserById, listBrowserProfiles, listCompanies, listInboundCues, listInboundObservations, listMotions, listUsers } from "../../db/database.js";
import { summarizeExecutionUsers } from "../../lib/execution-users.js";
import { buildUserScopedBootstrapView } from "../../lib/user-scoped-bootstrap.js";

/**
 * @param {import("commander").Command} program
 */
export function registerDaily(program) {
  program
    .command("daily")
    .description("Show the operator's daily execution agenda across cadence and inbound state.")
    .option("--user <user-id>", "Execution user identifier")
    .option("--motion <motion-id>", "Filter to one motion")
    .option("--company <company-id>", "Filter to one company")
    .option("--prospect <prospect-id>", "Filter to one prospect")
    .option("--limit <count>", "Maximum agenda items to return")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Canonical daily interface:
  exo daily --user <user-id>
  exo daily --user <user-id> --motion <motion-id> --json

Rules:
  - The daily is the planner surface over cadence plus inbound observations.
  - It is not a scraper, a feed, or a scheduler.
  - It shows what is due now, what is waiting, and what inbound movement overrode the old plan.
`
    )
    .action((options) => {
      const resolution = resolveDailyUser(options.user, { json: Boolean(options.json) });
      if (!resolution.user) {
        if (resolution.bootstrapView) {
          console.log(JSON.stringify(resolution.bootstrapView, null, 2));
        }
        return;
      }
      const user = resolution.user;

      const observations = listInboundObservations({
        userId: user.id,
        motionId: options.motion ?? null,
        companyId: options.company ?? null,
        prospectId: options.prospect ?? null
      });
      const workspaceContext = buildUserWorkspaceContext(user, {
        rawObservations: observations,
        rawCues: listInboundCues({
          userId: user.id,
          status: "open"
        }),
      });
      const result = buildDailyView(workspaceContext.user, listMotions(), listCompanies(), listBrowserProfiles(), workspaceContext.observations, {
        rawUsers: listUsers(),
        rawCues: workspaceContext.cues,
        motionId: options.motion ?? null,
        companyId: options.company ?? null,
        prospectId: options.prospect ?? null,
        limit: options.limit !== undefined ? Number.parseInt(options.limit, 10) : null
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderDaily(result));
    });
}

/**
 * @param {string | undefined} explicitUserId
 * @param {{ json?: boolean | undefined }} [options]
 */
function resolveDailyUser(explicitUserId, options = {}) {
  if (explicitUserId) {
    const user = findUserById(explicitUserId);
    if (!user) {
      console.error(`User not found: ${explicitUserId}`);
      process.exitCode = 1;
      return {
        user: null,
        bootstrapView: null
      };
    }
    return {
      user,
      bootstrapView: null
    };
  }

  const users = listUsers();
  const { totalUserCount, eligibleUserCount, eligibleUsers } = summarizeExecutionUsers(users);
  if (eligibleUserCount === 1) {
    return {
      user: eligibleUsers[0],
      bootstrapView: null
    };
  }

  if (!totalUserCount) {
    if (options.json) {
      return {
        user: null,
        bootstrapView: buildUserScopedBootstrapView({
          surface: "daily",
          reason: "no_users"
        })
      };
    }
    console.error("No execution users exist yet. Start with `exo users intake --json`, then add a user or pass --user explicitly.");
  } else if (!eligibleUserCount) {
    if (options.json) {
      return {
        user: null,
        bootstrapView: buildUserScopedBootstrapView({
          surface: "daily",
          reason: "no_execution_capable_users"
        })
      };
    }
    console.error("No execution-capable users exist yet. Start with `exo users intake --json`, then map at least one connected account or pass --user explicitly.");
  } else {
    console.error("More than one execution-capable user exists. Pass --user to choose the daily agenda owner.");
  }
  process.exitCode = 1;
  return {
    user: null,
    bootstrapView: null
  };
}
