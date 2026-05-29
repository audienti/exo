#!/usr/bin/env node
// @ts-check

import { buildNextView } from "../../core/build-next-view.js";
import { describeExo } from "../../core/what-is-this.js";
import {
  findMotionById,
  findUserById,
  listBrowserProfiles,
  listCompanies,
  listInboundObservations,
  listMotions,
  listUsers
} from "../../db/database.js";
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
    .action((options) => {
      const description = describeExo();
      const rawMotions = listMotions();
      const rawCompanies = listCompanies();
      const rawUsers = listUsers();
      const rawUser = resolveNextUser(options.user, rawUsers);

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

      const result = buildNextView({
        rawUser,
        rawMotion,
        rawMotions,
        rawCompanies,
        rawProfiles: listBrowserProfiles(),
        rawUsers,
        rawObservations,
        filters: {
          motionId: options.motion ?? null,
          companyId: options.company ?? null,
          prospectId: options.prospect ?? null
        }
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

  return rawUsers.length === 1 ? rawUsers[0] : null;
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
    return findMotionById(focusMotionId);
  }

  return null;
}

/**
 * @param {ReturnType<typeof buildNextView>} result
 */
function renderNext(result) {
  const lines = [
    result.headline,
    `Next: ${result.nextMove}`
  ];

  if (result.why) {
    lines.push(`Why: ${result.why}`);
  }

  if (result.context.motion?.name) {
    lines.push(`Motion: ${result.context.motion.name}`);
  }

  if (result.context.company?.name) {
    lines.push(`Company: ${result.context.company.name}`);
  }

  if (result.context.prospect?.name) {
    lines.push(`Prospect: ${result.context.prospect.name}`);
  }

  if (result.status.kind) {
    lines.push(`State: ${result.status.kind}`);
  }

  if (result.status.priority) {
    lines.push(`Priority: ${result.status.priority}`);
  }

  if (result.status.effect) {
    lines.push(`Effect: ${result.status.effect}`);
  }

  if (result.status.dueAt) {
    lines.push(`Due At: ${result.status.dueAt}`);
  }

  if (result.guidance?.taskPrompt) {
    lines.push(`Agent Prompt: ${result.guidance.taskPrompt}`);
  }

  if (result.guidance?.docPath) {
    lines.push(`Guidance Doc: ${result.guidance.docPath}`);
  }

  return lines.join("\n");
}
