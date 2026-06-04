// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
    assert.deepEqual(report.env, {
      sendMode: "canary",
      maxTasks: "2",
      forceRetrieval: "1",
      ignoreBrowserBackoff: "1",
      stateDir,
    });
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
    assert.equal(report.env.sendMode, "canary");
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
