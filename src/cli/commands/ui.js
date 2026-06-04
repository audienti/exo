#!/usr/bin/env node
// @ts-check

import { findUserById, listUsers } from "../../db/database.js";
import { summarizeExecutionUsers } from "../../lib/execution-users.js";
import { startExoUiServer } from "../exo-ui-server.js";
import { isPidAlive, probeUiStatus, readUiLock, removeUiLock } from "../ui-lock.js";

/**
 * @param {import("commander").Command} program
 */
export function registerUi(program) {
  program
    .command("ui-status")
    .description("Report whether an Exo UI server is already running (for parallel agents), and where.")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options) => {
      const status = await resolveUiStatus();
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      if (!status.running) {
        console.log(status.lock ? "Exo UI is not running (stale lock cleared)." : "Exo UI is not running.");
        return;
      }
      console.log(`Exo UI is running at ${status.url} (pid ${status.pid}, user ${status.userId}, since ${status.startedAt}).`);
    });

  program
    .command("ui")
    .description("Serve the interactive Exo operator UI (live surfaces + working action buttons wired to Exo state).")
    .option("--user <user-id>", "Execution user identifier")
    .option("--capability <capability>", "Browser capability used when deriving engagement readiness. Defaults to linkedin.")
    .option("--port <port>", "Port to listen on (default 4317)")
    .addHelpText(
      "after",
      `
Examples:
  exo ui
  exo ui --port 4317
  exo ui --user <user-id>

Rules:
  - Serves Operator / Motions / Prospects / Users / Connections / Workspace from live Exo state.
  - Nav routes between surfaces; action buttons execute real cadence/queue/touch writes.
  - Read-and-write: clicking an action mutates the .exo store, then the surface reloads.
`
    )
    .option("--reuse", "If an Exo UI is already running, print its URL and exit instead of starting another")
    .action(async (options) => {
      const existing = await resolveUiStatus();
      if (existing.running) {
        if (options.reuse) {
          console.log(`Exo UI already running at ${existing.url} (pid ${existing.pid}). Reusing it.`);
          return;
        }
        console.error(
          `An Exo UI is already running at ${existing.url} (pid ${existing.pid}). ` +
            `Open it, run \`exo ui-status\`, or pass --reuse / a different --port.`,
        );
        process.exitCode = 1;
        return;
      }

      const user = resolveUiUser(options.user);
      if (!user) {
        return;
      }

      try {
        const port = options.port ? Number(options.port) : undefined;
        if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
          throw new Error(`Invalid --port: ${options.port}`);
        }
        const server = await startExoUiServer({ userId: user.id, capability: options.capability, port });
        console.log(`Exo UI listening at ${server.url}`);
        console.log(`  Operator    ${server.url}operator`);
        console.log(`  Motions     ${server.url}motions`);
        console.log(`  Prospects   ${server.url}prospects`);
        console.log(`  Users       ${server.url}users`);
        console.log(`  Connections ${server.url}connections`);
        console.log(`  Workspace   ${server.url}workspace`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

/**
 * Determine whether an Exo UI is genuinely running: the lock must exist, its
 * pid alive, and its /status endpoint must answer. Clears a stale lock.
 * @returns {Promise<{ running: boolean, lock: any, url?: string, pid?: number, userId?: string, startedAt?: string }>}
 */
async function resolveUiStatus() {
  const lock = readUiLock();
  if (!lock || !lock.url) {
    return { running: false, lock: null };
  }
  const alive = isPidAlive(lock.pid);
  const status = alive ? await probeUiStatus(lock.url) : null;
  if (!alive || !status) {
    removeUiLock();
    return { running: false, lock };
  }
  return { running: true, lock, url: lock.url, pid: lock.pid, userId: lock.userId, startedAt: lock.startedAt };
}

/**
 * @param {string | undefined} explicitUserId
 */
function resolveUiUser(explicitUserId) {
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
    console.error("More than one execution-capable user exists. Pass --user to choose the UI owner.");
  }
  process.exitCode = 1;
  return null;
}
