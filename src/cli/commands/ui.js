#!/usr/bin/env node
// @ts-check

import { findUserById, listUsers } from "../../db/database.js";
import { summarizeExecutionUsers } from "../../lib/execution-users.js";
import { startExoUiServer } from "../exo-ui-server.js";
import { isPidAlive, probeUiStatus, readUiLock, removeUiLock } from "../ui-lock.js";

const DEFAULT_UI_PORT = 4317;

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
      if (status.status === "degraded") {
        console.log(
          `Exo UI may still be holding ${status.url} (pid ${status.pid}), but /status could not be reached. ` +
          "Treat the port as occupied until that process exits or the lock is repaired.",
        );
        return;
      }
      if (!status.running) {
        console.log(status.status === "stale" ? "Exo UI is not running (stale lock cleared)." : "Exo UI is not running.");
        return;
      }
      console.log(
        `Exo UI is running at ${status.url} (pid ${status.pid}, ${
          status.userId ? `user ${status.userId}` : "onboarding mode"
        }, since ${status.startedAt}).`
      );
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
  - Serves Operator / Motions / Prospects / Users / Connections / Workspace / Settings / Clean up from live Exo state.
  - Nav routes between surfaces; action buttons execute real cadence/queue/touch writes.
  - Read-and-write: clicking an action mutates the .exo store, then the surface reloads.
`
    )
    .option("--reuse", "If an Exo UI is already running, print its URL and exit instead of starting another")
    .action(async (options) => {
      const port = options.port ? Number(options.port) : undefined;
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
        console.error(`Invalid --port: ${options.port}`);
        process.exitCode = 1;
        return;
      }

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
      const requestedPort = port ?? DEFAULT_UI_PORT;
      if (existing.status === "degraded" && existing.port === requestedPort) {
        console.error(
          `An Exo UI process at ${existing.url} (pid ${existing.pid}) still holds port ${existing.port}, ` +
          "but /status could not be reached. Treat that port as occupied until the process exits or the lock is repaired.",
        );
        process.exitCode = 1;
        return;
      }

      const launch = resolveUiLaunch(options.user);
      if (!launch) {
        return;
      }

      try {
        const server = await startExoUiServer({ userId: launch.userId, capability: options.capability, port });
        console.log(`Exo UI listening at ${server.url}`);
        console.log(`  Operator    ${server.url}operator`);
        console.log(`  Motions     ${server.url}motions`);
        console.log(`  Prospects   ${server.url}prospects`);
        console.log(`  Users       ${server.url}users`);
        console.log(`  Connections ${server.url}connections`);
        console.log(`  Workspace   ${server.url}workspace`);
        console.log(`  Settings    ${server.url}settings`);
        console.log(`  Clean up    ${server.url}cleanup`);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

/**
 * Determine whether an Exo UI is serving, stale, or degraded.
 * Clears a lock only when its recorded pid is no longer alive.
 * @returns {Promise<{
 *   status: "not_running" | "stale" | "running" | "degraded",
 *   running: boolean,
 *   probeOk: boolean,
 *   pidAlive: boolean,
 *   lock: any,
 *   url?: string,
 *   pid?: number,
 *   port?: number,
 *   userId?: string,
 *   startedAt?: string,
 *   probeStatus?: any,
 * }>}
 */
async function resolveUiStatus() {
  const lock = readUiLock();
  if (!lock || !lock.url) {
    return { status: "not_running", running: false, probeOk: false, pidAlive: false, lock: null };
  }
  const pidAlive = isPidAlive(lock.pid);
  if (!pidAlive) {
    removeUiLock();
    return {
      status: "stale",
      running: false,
      probeOk: false,
      pidAlive: false,
      lock,
      url: lock.url,
      pid: lock.pid,
      port: lock.port,
      userId: lock.userId,
      startedAt: lock.startedAt,
    };
  }
  const probeStatus = await probeUiStatus(lock.url);
  if (!probeStatus) {
    return {
      status: "degraded",
      running: false,
      probeOk: false,
      pidAlive: true,
      lock,
      url: lock.url,
      pid: lock.pid,
      port: lock.port,
      userId: lock.userId,
      startedAt: lock.startedAt,
    };
  }
  return {
    status: "running",
    running: true,
    probeOk: true,
    pidAlive: true,
    lock,
    url: lock.url,
    pid: lock.pid,
    port: lock.port,
    userId: lock.userId,
    startedAt: lock.startedAt,
    probeStatus,
  };
}

/**
 * @param {string | undefined} explicitUserId
 */
function resolveUiLaunch(explicitUserId) {
  if (explicitUserId) {
    const user = findUserById(explicitUserId);
    if (!user) {
      console.error(`User not found: ${explicitUserId}`);
      process.exitCode = 1;
      return null;
    }
    return { userId: user.id };
  }

  const users = listUsers();
  const { totalUserCount, eligibleUserCount, eligibleUsers } = summarizeExecutionUsers(users);
  if (eligibleUserCount === 1) {
    return { userId: eligibleUsers[0].id };
  }

  if (eligibleUserCount > 1) {
    console.error("More than one execution-capable user exists. Pass --user to choose the UI owner.");
    process.exitCode = 1;
    return null;
  }

  if (totalUserCount > 1) {
    console.error("Multiple execution users exist, but none is uniquely ready. Pass --user to continue onboarding for one of them.");
    process.exitCode = 1;
    return null;
  }

  return { userId: users[0]?.id ?? null };
}
