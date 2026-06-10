#!/usr/bin/env node
// @ts-check

import { renderInbox } from "../../artifacts/render-inbox.js";
import { buildInboxView } from "../../core/build-inbox-view.js";
import { buildUserWorkspaceContext } from "../../core/workspace-context.js";
import { findUserById, listCompanies, listInboundObservations, listMotions, listUsers } from "../../db/database.js";
import { summarizeExecutionUsers } from "../../lib/execution-users.js";
import { buildUserScopedBootstrapView } from "../../lib/user-scoped-bootstrap.js";
import { runCliRepairableContract } from "../repairable-contracts.js";

/**
 * @param {import("commander").Command} program
 */
export function registerInbox(program) {
  program
    .command("inbox")
    .description("Show the ranked set of meaningful inbound changes that need operator attention.")
    .option("--user <user-id>", "Execution user identifier")
    .option("--account <account-id>", "Filter to one connected account")
    .option("--motion <motion-id>", "Filter to one motion")
    .option("--company <company-id>", "Filter to one company")
    .option("--prospect <prospect-id>", "Filter to one prospect")
    .option("--limit <count>", "Maximum inbox items to return")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Canonical inbox interface:
  exo inbox --user <user-id>
  exo inbox --user <user-id> --motion <motion-id> --json

Rules:
  - The inbox is a triage surface over stored inbound observations, not a feed.
  - It shows what changed and what kind of move that change may justify.
  - It does not replace cadence or daily planning; it feeds them.
`
    )
    .action(async (options) => {
      const resolution = resolveInboxUser(options.user, { json: Boolean(options.json) });
      if (!resolution.user) {
        if (resolution.bootstrapView) {
          console.log(JSON.stringify(resolution.bootstrapView, null, 2));
        }
        return;
      }
      const user = resolution.user;

      const observations = listInboundObservations({
        userId: user.id,
        accountId: options.account ?? null,
        motionId: options.motion ?? null,
        companyId: options.company ?? null,
        prospectId: options.prospect ?? null,
        limit: options.limit !== undefined ? Number.parseInt(options.limit, 10) : null
      });
      const workspaceContext = buildUserWorkspaceContext(user, {
        rawObservations: observations,
      });
      const inboxViewInput = {
        rawUser: workspaceContext.user,
        rawObservations: workspaceContext.observations,
        rawMotions: listMotions(),
        rawCompanies: listCompanies(),
        options: {
          accountId: options.account ?? null
        }
      };
      const { contract: result } = await runCliRepairableContract({
        contractKind: "inbox",
        build: () => buildInboxView(
          inboxViewInput.rawUser,
          inboxViewInput.rawObservations,
          inboxViewInput.rawMotions,
          inboxViewInput.rawCompanies,
          inboxViewInput.options
        ),
        normalizedInputs: inboxViewInput
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInbox(result));
    });
}

/**
 * @param {string | undefined} explicitUserId
 * @param {{ json?: boolean | undefined }} [options]
 */
function resolveInboxUser(explicitUserId, options = {}) {
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
          surface: "inbox",
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
          surface: "inbox",
          reason: "no_execution_capable_users"
        })
      };
    }
    console.error("No execution-capable users exist yet. Start with `exo users intake --json`, then map at least one connected account or pass --user explicitly.");
  } else {
    console.error("More than one execution-capable user exists. Pass --user to choose the inbox owner.");
  }
  process.exitCode = 1;
  return {
    user: null,
    bootstrapView: null
  };
}
