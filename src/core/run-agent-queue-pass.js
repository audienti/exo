// @ts-check

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runAgentWorkerPass } from "../cli/commands/agent.js";
import { getHomeStateDir } from "../db/paths.js";
import { inspectAgentRunLock } from "../lib/agent-run-lock.js";
import { AGENT_EXECUTION_LANES } from "../lib/agent-task-lanes.js";

/** @param {Record<string, any>} args */
export async function runAgentQueuePassAction(args) {
  const stateDir = getHomeStateDir();
  const activeLockMessage = describeActiveAgentPassLock(stateDir);
  if (activeLockMessage) {
    throw new Error(activeLockMessage);
  }
  if (args.background !== false) {
    const pid = launchDetachedAgentQueuePass(args);
    return {
      ok: true,
      writer: "runAgentQueuePass",
      message: `Agent pass started in background${pid ? ` (pid ${pid})` : ""}.`,
    };
  }
  const summary = await runAgentWorkerPass({
    quiet: true,
    sendMode: args.sendMode ?? null,
    maxTasks: args.maxTasks ?? null,
    forceRetrieval: Boolean(args.forceRetrieval),
    ignoreBrowserBackoff: Boolean(args.ignoreBrowserBackoff),
  });
  if (summary?.status === "noop" && /already active/i.test(String(summary.reason ?? ""))) {
    throw new Error(String(summary.reason).trim() || "Another agent pass is already active.");
  }
  return {
    ok: true,
    writer: "runAgentQueuePass",
    message: summarizeAgentQueuePass(summary),
  };
}

/**
 * @param {string} stateDir
 * @returns {string | null}
 */
function describeActiveAgentPassLock(stateDir) {
  const activeLocks = [
    {
      scope: "agent",
      label: "agent pass",
      lock: inspectAgentRunLock({ stateDir }),
    },
    ...AGENT_EXECUTION_LANES.map((lane) => ({
      scope: lane,
      label: `${lane} lane pass`,
      lock: inspectAgentRunLock({ stateDir, lane }),
    })),
  ].filter((entry) => entry.lock.active);

  if (!activeLocks.length) return null;
  if (activeLocks.length === 1) {
    const active = activeLocks[0];
    return `Another ${active.label} is already active${active.lock.pid ? ` (pid ${active.lock.pid})` : ""}.`;
  }

  const details = activeLocks
    .map((active) => `${active.scope}${active.lock.pid ? ` pid ${active.lock.pid}` : ""}`)
    .join(", ");
  return `Another agent pass is already active (${details}).`;
}

/** @param {Record<string, any>} args */
export function launchDetachedAgentQueuePass(args) {
  const stateDir = getHomeStateDir();
  const cliPath = fileURLToPath(new URL("../cli/index.js", import.meta.url));
  const logPath = path.join(stateDir, "agent.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  const childArgs = [cliPath, "agent", "run", "--json"];
  if (args.sendMode != null && String(args.sendMode).trim()) {
    childArgs.push("--send-mode", String(args.sendMode).trim());
  }
  if (args.maxTasks != null && String(args.maxTasks).trim()) {
    childArgs.push("--max-tasks", String(args.maxTasks).trim());
  }
  if (args.forceRetrieval) {
    childArgs.push("--force-retrieval");
  }
  if (args.ignoreBrowserBackoff) {
    childArgs.push("--ignore-browser-backoff");
  }

  const stdoutFd = fs.openSync(logPath, "a");
  const stderrFd = fs.openSync(logPath, "a");
  try {
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        EXO_STATE_DIR: stateDir,
      },
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    child.unref();
    return child.pid ?? null;
  } finally {
    fs.closeSync(stdoutFd);
    if (stderrFd !== stdoutFd) {
      fs.closeSync(stderrFd);
    }
  }
}

/** @param {any} summary */
function summarizeAgentQueuePass(summary) {
  const results = Array.isArray(summary?.results) ? summary.results : [];
  const count = results.length;
  const finalQueue = summary?.finalQueueCounts ?? {};
  const queueSentence = `Queue now ${finalQueue.dueTaskCount ?? 0} due, ${finalQueue.waitingTaskCount ?? 0} waiting, ${finalQueue.blockerCount ?? 0} blockers.`;
  if (summary?.status === "noop") {
    return `Agent checked the queue. Nothing ran. ${queueSentence}`;
  }
  const lastReason = summary?.reason
    ?? results.at(-1)?.detail?.reason
    ?? null;
  const ranSentence = summary?.status === "partial"
    ? `Agent made progress on ${count} task${count === 1 ? "" : "s"}.`
    : `Agent ran ${count} task${count === 1 ? "" : "s"}${summary?.status === "blocked" ? " before blocking" : ""}.`;
  return [ranSentence, lastReason, queueSentence].filter(Boolean).join(" ");
}
