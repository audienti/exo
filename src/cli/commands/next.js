#!/usr/bin/env node
// @ts-check

import { buildNextView } from "../../core/build-next-view.js";
import { buildUserWorkspaceContext } from "../../core/workspace-context.js";
import { runCliRepairableContract } from "../repairable-contracts.js";
import { describeExo } from "../../core/what-is-this.js";
import {
  findMotionById,
  findUserById,
  listBrowserProfiles,
  listCompanies,
  listDueProspectBranches,
  listInboundCues,
  listInboundObservations,
  listMotions,
  listOutboundCapacityAccounts,
  listUsers
} from "../../db/database.js";
import { summarizeExecutionUsers } from "../../lib/execution-users.js";
import { isExecutionEligibleMotionStatus } from "../../lib/motion-status.js";

/**
 * @param {import("commander").Command} program
 */
export function registerNext(program) {
  program
    .command("next")
    .description("Show the strongest governed next move from Exo right now.")
    .option("--user <user-id>", "Execution user identifier")
    .option("--motion <motion-id>", "Motion identifier")
    .option("--company <company-id>", "Filter to one company")
    .option("--prospect <prospect-id>", "Filter to one prospect")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Canonical next interface:
  exo next
  exo next --user <user-id>
  exo next --motion <motion-id> --json

Rules:
  - This is the operator shorthand for "what should happen next?"
  - It prefers a real daily agenda item when one exists.
  - Otherwise it falls back to the motion path, then the general operator call.
`
    )
    .action(async (options) => {
      const description = describeExo();
      const rawMotions = listMotions();
      const rawCompanies = listCompanies();
      const rawUsers = listUsers();
      const rawUser = resolveNextUser(options.user, rawUsers);
      const now = new Date().toISOString();

      if (options.user && !rawUser) {
        process.exitCode = 1;
        return;
      }

      const rawMotion = resolveNextMotion(options.motion, rawMotions, description);
      if (options.motion && !rawMotion) {
        process.exitCode = 1;
        return;
      }

      const rawObservations = rawUser
        ? listInboundObservations({
            userId: rawUser.id,
            motionId: options.motion ?? null,
            companyId: options.company ?? null,
            prospectId: options.prospect ?? null
          })
        : [];
      const workspaceContext = rawUser
        ? buildUserWorkspaceContext(rawUser, {
            rawObservations,
            rawCues: listInboundCues({
              userId: rawUser.id,
              status: "open"
            })
          })
        : null;

      const nextViewInput = {
        rawUser: workspaceContext?.user ?? rawUser,
        rawMotion,
        rawMotions,
        rawCompanies,
        rawProfiles: listBrowserProfiles(),
        rawUsers,
        rawObservations: workspaceContext?.observations ?? rawObservations,
        rawCues: workspaceContext?.cues ?? [],
        now,
        description,
        filters: {
          motionId: options.motion ?? null,
          companyId: options.company ?? null,
          prospectId: options.prospect ?? null
        },
        capacityAccounts: rawUser
          ? listOutboundCapacityAccounts({
              executionUserId: rawUser.id,
              motionId: options.motion ?? null,
              companyId: options.company ?? null,
              prospectId: options.prospect ?? null,
            })
          : [],
        prospectBranches: rawUser
          ? listDueProspectBranches({
              executionUserId: rawUser.id,
              now,
              limit: 25,
              motionId: options.motion ?? null,
              companyId: options.company ?? null,
              prospectId: options.prospect ?? null,
            })
          : [],
      };
      const { contract: result } = await runCliRepairableContract({
        contractKind: "next",
        build: () => buildNextView(nextViewInput),
        normalizedInputs: nextViewInput
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderNext(result));
    });
}

/**
 * @param {string | undefined} explicitUserId
 * @param {unknown[]} rawUsers
 */
function resolveNextUser(explicitUserId, rawUsers) {
  if (explicitUserId) {
    const user = findUserById(explicitUserId);
    if (!user) {
      console.error(`User not found: ${explicitUserId}`);
      return null;
    }
    return user;
  }

  const { eligibleUsers } = summarizeExecutionUsers(rawUsers);
  return eligibleUsers.length === 1 ? eligibleUsers[0] : null;
}

/**
 * @param {string | undefined} explicitMotionId
 * @param {unknown[]} rawMotions
 * @param {ReturnType<typeof describeExo>} description
 */
function resolveNextMotion(explicitMotionId, rawMotions, description) {
  if (explicitMotionId) {
    const motion = findMotionById(explicitMotionId);
    if (!motion) {
      console.error(`Motion not found: ${explicitMotionId}`);
      return null;
    }
    return motion;
  }

  const activeMotions = rawMotions.filter((motion) => isExecutionEligibleMotionStatus(motion.status));
  if (activeMotions.length === 1) {
    return activeMotions[0];
  }

  const focusMotionId = description.agentUsage.recommendedPath.focusMotionId ?? null;
  if (focusMotionId && activeMotions.length > 0) {
    return activeMotions.find((motion) => motion.id === focusMotionId) ?? null;
  }

  return null;
}

/**
 * @param {ReturnType<typeof buildNextView>} result
 */
function renderNext(result) {
  if (result.operatorPrompt) {
    return result.operatorPrompt;
  }

  const lines = [
    result.nextMove
  ];

  if (result.why) {
    lines.push(`Why: ${result.why}`);
  }

  return lines.join("\n");
}
