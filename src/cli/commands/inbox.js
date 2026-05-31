#!/usr/bin/env node
// @ts-check

import { renderInbox } from "../../artifacts/render-inbox.js";
import { buildInboxView } from "../../core/build-inbox-view.js";
import { findUserById, listCompanies, listInboundObservations, listMotions, listUsers } from "../../db/database.js";
import { summarizeExecutionUsers } from "../../lib/execution-users.js";

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
    .action((options) => {
      const user = resolveInboxUser(options.user);
      if (!user) {
        return;
      }

      const observations = listInboundObservations({
        userId: user.id,
        accountId: options.account ?? null,
        motionId: options.motion ?? null,
        companyId: options.company ?? null,
        prospectId: options.prospect ?? null,
        limit: options.limit !== undefined ? Number.parseInt(options.limit, 10) : null
      });
      const result = buildInboxView(user, observations, listMotions(), listCompanies(), {
        accountId: options.account ?? null
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
 */
function resolveInboxUser(explicitUserId) {
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
    console.error("No execution users exist yet. Add a user first or pass --user explicitly.");
  } else if (!eligibleUserCount) {
    console.error("No execution-capable users exist yet. Add at least one connected account or pass --user explicitly.");
  } else {
    console.error("More than one execution-capable user exists. Pass --user to choose the inbox owner.");
  }
  process.exitCode = 1;
  return null;
}
