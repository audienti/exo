#!/usr/bin/env node
// @ts-check

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { buildAgentQueue } from "../src/core/build-agent-queue.js";
import {
  listAgentQueueProspectBranches,
  listBrowserProfiles,
  listCompanies,
  listInboundCues,
  listInboundObservations,
  listMotions,
  listUsers,
} from "../src/db/database.js";
import { getHomeStateDir } from "../src/db/paths.js";
import { pruneExpiredBrowserBackoffs } from "../src/lib/agent-host-state.js";
import {
  decideAgentBurstContinuation,
  DEFAULT_AGENT_BURST_MAX_RUNTIME_MS,
  DEFAULT_AGENT_BURST_SOON_WAIT_MS,
} from "../src/lib/agent-burst.js";
import { getTaskExecutionLane, normalizeAgentExecutionLane } from "../src/lib/agent-task-lanes.js";

const EXECUTION_LANE = normalizeAgentExecutionLane(process.env.EXO_AGENT_LANE);
if (!EXECUTION_LANE) {
  console.error("run-agent-lane-burst requires EXO_AGENT_LANE=transport or research.");
  process.exit(1);
}

const STATE_DIR = getHomeStateDir();
const PASS_RUNNER_SCRIPT = path.resolve(import.meta.dirname, "run-agent-host-pass.js");
const BURST_MAX_RUNTIME_MS = parseEnvInt("EXO_AGENT_BURST_MAX_RUNTIME_MS", DEFAULT_AGENT_BURST_MAX_RUNTIME_MS);
const BURST_SOON_WAIT_MS = parseEnvInt("EXO_AGENT_BURST_SOON_WAIT_MS", DEFAULT_AGENT_BURST_SOON_WAIT_MS);
const BURST_STARTED_AT_MS = Date.now();

let cycle = 0;
let exitCode = 0;

while (true) {
  cycle += 1;
  const summary = await runLanePass();
  const laneQueue = loadLaneQueue(EXECUTION_LANE);
  const rawDecision = decideAgentBurstContinuation(laneQueue, {
    startedAtMs: BURST_STARTED_AT_MS,
    nowMs: Date.now(),
    maxRuntimeMs: BURST_MAX_RUNTIME_MS,
    soonWaitMs: BURST_SOON_WAIT_MS,
  });
  const decision = refineBurstDecision(summary, rawDecision);

  console.log([
    `burst_lane=${EXECUTION_LANE}`,
    `cycle=${cycle}`,
    `pass_status=${summary?.status ?? "unknown"}`,
    `due=${decision.dueTaskCount ?? 0}`,
    `waiting=${decision.waitingCount ?? 0}`,
    `action=${decision.action}`,
    `reason=${decision.reason}`,
    decision.nextDueAt ? `next_due_at=${decision.nextDueAt}` : null,
    Number.isFinite(decision.delayMs) ? `delay_ms=${Math.max(0, Math.trunc(Number(decision.delayMs)))}` : null,
  ].filter(Boolean).join(" "));

  if (summary?.status === "failed") {
    exitCode = 1;
  }

  if (decision.action === "stop") {
    break;
  }
  if (decision.action === "sleep") {
    await sleep(Math.max(0, Number(decision.delayMs) || 0));
  }
}

process.exitCode = exitCode;

function loadLaneQueue(lane) {
  const queue = buildAgentQueue({
    motions: listMotions(),
    companies: listCompanies(),
    profiles: listBrowserProfiles(),
    users: listUsers(),
    observations: listInboundObservations(),
    cues: listInboundCues(),
    prospectBranches: listAgentQueueProspectBranches(),
    hostState: loadHostState(),
  });

  const tasks = (queue.tasks ?? []).filter((task) => getTaskExecutionLane(task?.kind) === lane);
  const waiting = (queue.waiting ?? []).filter((task) => getTaskExecutionLane(task?.kind) === lane);
  const blockers = (queue.blockers ?? []).filter((task) => getTaskExecutionLane(task?.kind) === lane);

  return {
    itemCount: tasks.length,
    waitingCount: waiting.length,
    blockerCount: blockers.length,
    tasks,
    waiting,
    blockers,
  };
}

function loadHostState() {
  return pruneExpiredBrowserBackoffs(readJsonIfExists(path.join(STATE_DIR, "agent-host-state.json")));
}

async function runLanePass() {
  const stdout = await new Promise((resolve, reject) => {
    execFile(process.execPath, [PASS_RUNNER_SCRIPT], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        EXO_AGENT_LANE: EXECUTION_LANE,
      },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    }, (error, out, err) => {
      if (error) {
        reject(new Error([
          `Lane ${EXECUTION_LANE} host pass failed.`,
          error.message,
          out?.trim() ? `stdout:\n${out.trim()}` : null,
          err?.trim() ? `stderr:\n${err.trim()}` : null,
        ].filter(Boolean).join("\n\n")));
        return;
      }
      resolve(out);
    });
  });

  try {
    return JSON.parse(String(stdout));
  } catch (error) {
    throw new Error(
      `Lane ${EXECUTION_LANE} host pass returned invalid JSON.\n${error instanceof Error ? error.message : String(error)}\n\nRaw output:\n${stdout}`,
    );
  }
}

function refineBurstDecision(summary, decision) {
  if (summary?.status === "noop" && decision.action === "rerun") {
    return {
      ...decision,
      action: "stop",
      reason: "noop_with_due_backlog",
    };
  }
  if (summary?.status === "failed") {
    return {
      ...decision,
      action: "stop",
      reason: "lane_pass_failed",
    };
  }
  return decision;
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseEnvInt(name, fallback) {
  const value = Number.parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
