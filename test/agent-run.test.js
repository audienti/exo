// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { buildNodeTestEnv } from "../scripts/node-test-runtime.js";
import { buildAgentRunLockDir } from "../src/lib/agent-run-lock.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

test("agent run shells through the real host-pass runner and forwards manual-pass controls", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-run-"));
  const stateDir = path.join(tempRoot, ".exo");
  const runnerScript = path.join(tempRoot, "fake-runner.js");

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(runnerScript, [
    "#!/usr/bin/env node",
    "console.log(JSON.stringify({",
    "  status: 'noop',",
    "  reason: 'runner-called',",
    "  env: {",
    "    lane: process.env.EXO_AGENT_LANE ?? null,",
    "    sendMode: process.env.EXO_AGENT_SEND_MODE ?? null,",
    "    maxTasks: process.env.EXO_AGENT_MAX_TASKS ?? null,",
    "    forceRetrieval: process.env.EXO_AGENT_FORCE_RETRIEVAL ?? null,",
    "    ignoreBrowserBackoff: process.env.EXO_AGENT_IGNORE_BROWSER_BACKOFF ?? null,",
    "    stateDir: process.env.EXO_STATE_DIR ?? null,",
    "  },",
    "  results: [],",
    "  finalQueueCounts: { dueTaskCount: 0, waitingTaskCount: 0, blockerCount: 0 }",
    "}));",
  ].join("\n"), "utf8");

  try {
    const output = execFileSync("node", [
      cliPath,
      "agent",
      "run",
      "--json",
      "--send-mode",
      "canary",
      "--max-tasks",
      "2",
      "--force-retrieval",
      "--ignore-browser-backoff",
    ], {
      cwd: repoRoot,
      env: buildNodeTestEnv({
        ...process.env,
        EXO_STATE_DIR: stateDir,
        EXO_AGENT_RUNNER_SCRIPT: runnerScript,
      }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.status, "noop");
    assert.equal(report.reason, "runner-called");
    assert.deepEqual(report.lanes.map((lane) => lane.lane), ["transport", "research"]);
    for (const laneSummary of report.lanes) {
      assert.deepEqual(laneSummary.env, {
        lane: laneSummary.lane,
        sendMode: "canary",
        maxTasks: "2",
        forceRetrieval: "1",
        ignoreBrowserBackoff: "1",
        stateDir,
      });
    }
    const mergedSummaryPath = path.join(stateDir, "agent-last-pass.json");
    assert.equal(fs.existsSync(mergedSummaryPath), true);
    const persisted = JSON.parse(fs.readFileSync(mergedSummaryPath, "utf8"));
    assert.equal(persisted.reason, "runner-called");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent run defaults to the installed routine send mode when none is passed", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-run-installed-mode-"));
  const stateDir = path.join(tempRoot, ".exo");
  const runnerScript = path.join(tempRoot, "fake-runner.js");
  const installedRunner = path.join(stateDir, "run-agent-host.sh");

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(installedRunner, "#!/bin/sh\necho \"send_mode=canary\"\n", "utf8");
  fs.writeFileSync(runnerScript, [
    "#!/usr/bin/env node",
    "console.log(JSON.stringify({",
    "  status: 'noop',",
    "  reason: 'installed-mode',",
    "  env: { sendMode: process.env.EXO_AGENT_SEND_MODE ?? null },",
    "  results: [],",
    "  finalQueueCounts: { dueTaskCount: 0, waitingTaskCount: 0, blockerCount: 0 }",
    "}));",
  ].join("\n"), "utf8");

  try {
    const output = execFileSync("node", [
      cliPath,
      "agent",
      "run",
      "--json",
    ], {
      cwd: repoRoot,
      env: buildNodeTestEnv({
        ...process.env,
        EXO_STATE_DIR: stateDir,
        EXO_AGENT_RUNNER_SCRIPT: runnerScript,
      }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.reason, "installed-mode");
    for (const laneSummary of report.lanes) {
      assert.equal(laneSummary.env.sendMode, "canary");
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent run still drains the research lane when the transport lane lock is held", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-run-lane-lock-"));
  const stateDir = path.join(tempRoot, ".exo");
  const runnerScript = path.join(tempRoot, "fake-runner.js");
  const transportLockDir = buildAgentRunLockDir({ stateDir, lane: "transport" });
  const lockModuleUrl = pathToFileURL(path.join(repoRoot, "src", "lib", "agent-run-lock.js")).href;

  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(transportLockDir, { recursive: true });
  fs.writeFileSync(path.join(transportLockDir, "pid"), `${process.pid}\n`, "utf8");
  fs.writeFileSync(runnerScript, [
    "#!/usr/bin/env node",
    "(async () => {",
    `  const { tryAcquireAgentRunLock, releaseAgentRunLock } = await import(${JSON.stringify(lockModuleUrl)});`,
    "  const lane = process.env.EXO_AGENT_LANE ?? null;",
    "  const laneLock = tryAcquireAgentRunLock({ stateDir: process.env.EXO_STATE_DIR, lane });",
    "  if (!laneLock.acquired) {",
    "    console.log(JSON.stringify({",
    "      status: 'noop',",
    "      reason: `Another ${lane} lane pass is already active${laneLock.pid ? ` (pid ${laneLock.pid})` : ''}.`,",
    "      lane,",
    "      results: [],",
    "      finalQueueCounts: { dueTaskCount: 0, waitingTaskCount: 0, blockerCount: 0 }",
    "    }));",
    "    return;",
    "  }",
    "  try {",
    "    console.log(JSON.stringify({",
    "      status: 'noop',",
    "      reason: `runner-called:${lane ?? 'none'}`,",
    "      lane,",
    "      results: [],",
    "      finalQueueCounts: { dueTaskCount: 0, waitingTaskCount: 0, blockerCount: 0 }",
    "    }));",
    "  } finally {",
    "    releaseAgentRunLock(laneLock);",
    "  }",
    "})().catch((error) => {",
    "  console.error(error instanceof Error ? error.stack : String(error));",
    "  process.exit(1);",
    "});",
  ].join("\n"), "utf8");

  try {
    const output = execFileSync("node", [
      cliPath,
      "agent",
      "run",
      "--json",
    ], {
      cwd: repoRoot,
      env: buildNodeTestEnv({
        ...process.env,
        EXO_STATE_DIR: stateDir,
        EXO_AGENT_RUNNER_SCRIPT: runnerScript,
      }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    const transportLane = report.lanes.find((lane) => lane.lane === "transport");
    const researchLane = report.lanes.find((lane) => lane.lane === "research");
    assert.match(transportLane.reason, /already active/i);
    assert.equal(researchLane.reason, "runner-called:research");
    // The held transport lock must survive the pass untouched.
    assert.equal(fs.existsSync(path.join(transportLockDir, "pid")), true);
  } finally {
    fs.rmSync(transportLockDir, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent run keeps the shared pass guard held until a pinned lane finishes", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-run-spawn-guard-"));
  const stateDir = path.join(tempRoot, ".exo");
  const runnerScript = path.join(tempRoot, "fake-runner.js");
  const lockModuleUrl = pathToFileURL(path.join(repoRoot, "src", "lib", "agent-run-lock.js")).href;

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(runnerScript, [
    "#!/usr/bin/env node",
    "(async () => {",
    `  const { tryAcquireAgentRunLock, releaseAgentRunLock } = await import(${JSON.stringify(lockModuleUrl)});`,
    "  await new Promise((resolve) => setTimeout(resolve, 100));",
    "  const sharedLock = tryAcquireAgentRunLock({ stateDir: process.env.EXO_STATE_DIR });",
    "  if (sharedLock.acquired) {",
    "    releaseAgentRunLock(sharedLock);",
    "  }",
    "  console.log(JSON.stringify({",
    "    status: 'noop',",
    "    reason: 'spawn-guard-checked',",
    "    lockAcquiredAfterSpawn: sharedLock.acquired,",
    "    results: [],",
    "    finalQueueCounts: { dueTaskCount: 0, waitingTaskCount: 0, blockerCount: 0 }",
    "  }));",
    "})().catch((error) => {",
    "  console.error(error instanceof Error ? error.stack : String(error));",
    "  process.exit(1);",
    "});",
  ].join("\n"), "utf8");

  try {
    const output = execFileSync("node", [
      cliPath,
      "agent",
      "run",
      "--json",
    ], {
      cwd: repoRoot,
      env: buildNodeTestEnv({
        ...process.env,
        EXO_STATE_DIR: stateDir,
        EXO_AGENT_LANE: "transport",
        EXO_AGENT_RUNNER_SCRIPT: runnerScript,
      }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.reason, "spawn-guard-checked");
    assert.equal(report.lockAcquiredAfterSpawn, false);
    assert.deepEqual(report.lanes.map((lane) => lane.lane), ["transport"]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent run does not start a second pass when the shared run lock is already held", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-run-lock-"));
  const stateDir = path.join(tempRoot, ".exo");
  const runnerScript = path.join(tempRoot, "fake-runner.js");
  const lockDir = buildAgentRunLockDir({ stateDir });
  const lockPidFile = path.join(lockDir, "pid");
  const runnerTouchedPath = path.join(tempRoot, "runner-touched");

  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(lockPidFile, `${process.pid}\n`, "utf8");
  fs.writeFileSync(runnerScript, [
    "#!/usr/bin/env node",
    `require('node:fs').writeFileSync(${JSON.stringify(runnerTouchedPath)}, 'called');`,
    "console.log(JSON.stringify({ status: 'noop', reason: 'runner-should-not-run', results: [], finalQueueCounts: { dueTaskCount: 0, waitingTaskCount: 0, blockerCount: 0 } }));",
  ].join("\n"), "utf8");

  try {
    const output = execFileSync("node", [
      cliPath,
      "agent",
      "run",
      "--json",
    ], {
      cwd: repoRoot,
      env: buildNodeTestEnv({
        ...process.env,
        EXO_STATE_DIR: stateDir,
        EXO_AGENT_RUNNER_SCRIPT: runnerScript,
      }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.status, "noop");
    assert.match(report.reason, /already active/i);
    assert.equal(fs.existsSync(runnerTouchedPath), false);
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
