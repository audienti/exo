// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  formatAgentDoctorReport,
  inspectAgentSchedulerState,
  parseLoadedLaunchAgentStateDir,
  removeForeignExoLaunchAgents,
  scanForeignExoLaunchAgents,
} from "../src/cli/commands/agent.js";

const CANONICAL_LABEL = "com.tester.exo.queue-drainer";
const STATE_DIR = "/Users/tester/Documents/Knit/.exo";

/**
 * @param {Record<string, string>} plists
 */
function makeLaunchAgentsDir(plists) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-launch-agents-"));
  for (const [fileName, content] of Object.entries(plists)) {
    fs.writeFileSync(path.join(dir, fileName), content, "utf8");
  }
  return dir;
}

/**
 * @param {string} stateDir
 */
function plistReferencing(stateDir) {
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<plist version=\"1.0\"><dict>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${stateDir}/run-agent-host.sh</string>`,
    "  </array>",
    "</dict></plist>",
    "",
  ].join("\n");
}

test("scanForeignExoLaunchAgents reports renamed exo runners and ignores everything else", () => {
  const launchAgentsDir = makeLaunchAgentsDir({
    [`${CANONICAL_LABEL}.plist`]: plistReferencing(STATE_DIR),
    "com.tester.exo.agent-loop.plist": plistReferencing(STATE_DIR),
    "com.tester.exo.queue-drainer-v2.plist": plistReferencing("/Users/tester/other-workspace/.exo"),
    "com.apple.unrelated.plist": plistReferencing(STATE_DIR),
    "notes.txt": "not a plist",
  });

  /** @type {string[]} */
  const printedTargets = [];
  const foreign = scanForeignExoLaunchAgents({
    canonicalLabel: CANONICAL_LABEL,
    launchAgentsDir,
    stateDir: STATE_DIR,
    uid: 501,
    printLaunchctl: (target) => {
      printedTargets.push(target);
      if (target.endsWith("com.tester.exo.agent-loop")) {
        return "\tstate = running\n\tpid = 4242\n";
      }
      throw new Error(`Could not find service "${target}" in domain`);
    },
  });

  assert.deepEqual(foreign.map((agent) => agent.label).sort(), [
    "com.tester.exo.agent-loop",
    "com.tester.exo.queue-drainer-v2",
  ]);
  assert.deepEqual(printedTargets.sort(), [
    "gui/501/com.tester.exo.agent-loop",
    "gui/501/com.tester.exo.queue-drainer-v2",
  ]);

  const loop = foreign.find((agent) => agent.label === "com.tester.exo.agent-loop");
  assert.equal(loop?.loaded, true);
  assert.equal(loop?.running, true);
  assert.equal(loop?.pid, 4242);
  assert.equal(loop?.referencesStateDir, true);
  assert.equal(loop?.target, "gui/501/com.tester.exo.agent-loop");
  assert.equal(loop?.installPath, path.join(launchAgentsDir, "com.tester.exo.agent-loop.plist"));

  const otherWorkspace = foreign.find((agent) => agent.label === "com.tester.exo.queue-drainer-v2");
  assert.equal(otherWorkspace?.loaded, false);
  assert.equal(otherWorkspace?.running, false);
  assert.equal(otherWorkspace?.referencesStateDir, false);

  fs.rmSync(launchAgentsDir, { recursive: true, force: true });
});

test("scanForeignExoLaunchAgents leaves referencesStateDir null without a state dir to match", () => {
  const launchAgentsDir = makeLaunchAgentsDir({
    "com.tester.exo.agent-loop.plist": plistReferencing(STATE_DIR),
  });

  const foreign = scanForeignExoLaunchAgents({
    canonicalLabel: CANONICAL_LABEL,
    launchAgentsDir,
    uid: 501,
    printLaunchctl: () => { throw new Error("not loaded"); },
  });

  assert.equal(foreign.length, 1);
  assert.equal(foreign[0]?.referencesStateDir, null);

  fs.rmSync(launchAgentsDir, { recursive: true, force: true });
});

test("scanForeignExoLaunchAgents returns empty when the LaunchAgents dir is missing", () => {
  const foreign = scanForeignExoLaunchAgents({
    canonicalLabel: CANONICAL_LABEL,
    launchAgentsDir: path.join(os.tmpdir(), "exo-launch-agents-does-not-exist"),
    uid: 501,
    printLaunchctl: () => { throw new Error("unreachable"); },
  });
  assert.deepEqual(foreign, []);
});

test("removeForeignExoLaunchAgents only removes plists that provably reference this workspace", () => {
  const launchAgentsDir = makeLaunchAgentsDir({
    "com.tester.exo.agent-loop.plist": plistReferencing(STATE_DIR),
    "com.tester.exo.queue-drainer-v2.plist": plistReferencing("/Users/tester/other-workspace/.exo"),
  });

  /** @type {string[]} */
  const bootedOut = [];
  const removed = removeForeignExoLaunchAgents({
    canonicalLabel: CANONICAL_LABEL,
    launchAgentsDir,
    stateDir: STATE_DIR,
    uid: 501,
    printLaunchctl: () => "\tstate = running\n\tpid = 99\n",
    bootoutLaunchctl: (target) => { bootedOut.push(target); },
  });

  assert.deepEqual(removed.map((agent) => agent.label), ["com.tester.exo.agent-loop"]);
  assert.deepEqual(bootedOut, ["gui/501/com.tester.exo.agent-loop"]);
  assert.equal(fs.existsSync(path.join(launchAgentsDir, "com.tester.exo.agent-loop.plist")), false);
  // The other workspace's runner is untouched: visible drift, never collateral.
  assert.equal(fs.existsSync(path.join(launchAgentsDir, "com.tester.exo.queue-drainer-v2.plist")), true);

  fs.rmSync(launchAgentsDir, { recursive: true, force: true });
});

test("removeForeignExoLaunchAgents skips plists it cannot prove ownership of (no state dir)", () => {
  const launchAgentsDir = makeLaunchAgentsDir({
    "com.tester.exo.agent-loop.plist": plistReferencing(STATE_DIR),
  });

  const removed = removeForeignExoLaunchAgents({
    canonicalLabel: CANONICAL_LABEL,
    launchAgentsDir,
    stateDir: null,
    uid: 501,
    printLaunchctl: () => { throw new Error("not loaded"); },
    bootoutLaunchctl: () => { throw new Error("must not boot out unproven plists"); },
  });

  assert.deepEqual(removed, []);
  assert.equal(fs.existsSync(path.join(launchAgentsDir, "com.tester.exo.agent-loop.plist")), true);

  fs.rmSync(launchAgentsDir, { recursive: true, force: true });
});

test("removeForeignExoLaunchAgents still removes the plist when bootout fails", () => {
  const launchAgentsDir = makeLaunchAgentsDir({
    "com.tester.exo.agent-loop.plist": plistReferencing(STATE_DIR),
  });

  const removed = removeForeignExoLaunchAgents({
    canonicalLabel: CANONICAL_LABEL,
    launchAgentsDir,
    stateDir: STATE_DIR,
    uid: 501,
    printLaunchctl: () => { throw new Error("not loaded"); },
    bootoutLaunchctl: () => { throw new Error("Could not find service"); },
  });

  assert.deepEqual(removed.map((agent) => agent.label), ["com.tester.exo.agent-loop"]);
  assert.equal(fs.existsSync(path.join(launchAgentsDir, "com.tester.exo.agent-loop.plist")), false);

  fs.rmSync(launchAgentsDir, { recursive: true, force: true });
});

test("parseLoadedLaunchAgentStateDir extracts EXO_STATE_DIR from launchctl print output", () => {
  const output = [
    "com.tester.exo.queue-drainer = {",
    "\tactive count = 0",
    "\tpath = /Users/tester/Library/LaunchAgents/com.tester.exo.queue-drainer.plist",
    "\ttype = LaunchAgent",
    "\tstate = not running",
    "",
    "\tenvironment = {",
    "\t\tHOME => /Users/tester",
    "\t\tEXO_STATE_DIR => /Users/tester/.local/share/exo/audienti-state",
    "\t\tPATH => /usr/bin:/bin",
    "\t}",
    "}",
  ].join("\n");

  assert.equal(
    parseLoadedLaunchAgentStateDir(output),
    "/Users/tester/.local/share/exo/audienti-state",
  );
});

test("parseLoadedLaunchAgentStateDir returns null when no EXO_STATE_DIR is set", () => {
  assert.equal(parseLoadedLaunchAgentStateDir("state = running\npid = 4242\n"), null);
  assert.equal(parseLoadedLaunchAgentStateDir(""), null);
  assert.equal(parseLoadedLaunchAgentStateDir(/** @type {*} */ (null)), null);
});

test("inspectAgentSchedulerState flags state-scope drift when launchd points at a different EXO_STATE_DIR", () => {
  if (process.platform !== "darwin") {
    return;
  }

  const launchAgentsDir = makeLaunchAgentsDir({
    "com.tester.exo.queue-drainer.plist": plistReferencing("/Users/tester/.local/share/exo/audienti-state"),
  });
  const expectedStateDir = "/Users/tester/work/audienti/exo/.exo";

  const printedTargets = [];
  const result = inspectAgentSchedulerState(expectedStateDir, {
    launchAgentsDir,
    uid: 501,
    username: "tester",
    homeDir: "/Users/tester",
    platform: "darwin",
    printLaunchctl: (target) => {
      printedTargets.push(target);
      return [
        "com.tester.exo.queue-drainer = {",
        "\tstate = not running",
        "\truns = 12",
        "\trun interval = 900 seconds",
        "\tlast exit code = 0",
        "\tenvironment = {",
        "\t\tHOME => /Users/tester",
        "\t\tEXO_STATE_DIR => /Users/tester/.local/share/exo/audienti-state",
        "\t}",
        "}",
      ].join("\n");
    },
  });

  assert.equal(result.installed, true);
  assert.equal(result.loaded, true);
  assert.equal(result.loadedStateDir, "/Users/tester/.local/share/exo/audienti-state");
  assert.equal(result.expectedStateDir, expectedStateDir);
  assert.equal(result.stateDirMismatch, true);
  assert.equal(result.reinstallCommand, "exo agent install-routine --runtime codex --install");
  assert.equal(result.bootoutCommand, "launchctl bootout gui/501/com.tester.exo.queue-drainer");
  // The canonical scheduler should have been the print target.
  assert.ok(printedTargets.includes("gui/501/com.tester.exo.queue-drainer"));

  fs.rmSync(launchAgentsDir, { recursive: true, force: true });
});

test("inspectAgentSchedulerState ignores trailing slashes when comparing state dirs", () => {
  if (process.platform !== "darwin") {
    return;
  }

  const launchAgentsDir = makeLaunchAgentsDir({
    "com.tester.exo.queue-drainer.plist": plistReferencing("/Users/tester/work/audienti/exo/.exo"),
  });

  const result = inspectAgentSchedulerState("/Users/tester/work/audienti/exo/.exo/", {
    launchAgentsDir,
    uid: 501,
    username: "tester",
    homeDir: "/Users/tester",
    platform: "darwin",
    printLaunchctl: () => [
      "com.tester.exo.queue-drainer = {",
      "\tstate = not running",
      "\tenvironment = {",
      "\t\tEXO_STATE_DIR => /Users/tester/work/audienti/exo/.exo",
      "\t}",
      "}",
    ].join("\n"),
  });

  assert.equal(result.loadedStateDir, "/Users/tester/work/audienti/exo/.exo");
  assert.equal(result.stateDirMismatch, false);
  assert.equal(result.reinstallCommand, null);
  assert.equal(result.bootoutCommand, null);

  fs.rmSync(launchAgentsDir, { recursive: true, force: true });
});

test("formatAgentDoctorReport surfaces the launchd state-scope drift with reinstall and bootout commands", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-11T02:52:50.459Z",
    stateDir: "/Users/tester/work/audienti/exo/.exo",
    queue: {
      dueTaskCount: 0,
      waitingTaskCount: 0,
      blockerCount: 0,
      draftTaskCount: 0,
      browserTaskCount: 0,
      browserTaskKinds: [],
    },
    browser: {
      required: false,
      ready: true,
      skipReason: "no_browser_tasks_due",
      blockedReasons: [],
      warnings: [],
      taskReadiness: {},
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: false,
      pid: null,
      state: "not running",
      runs: 4,
      runIntervalSeconds: 900,
      runningForSeconds: null,
      lastExitCode: "0",
      label: "com.tester.exo.queue-drainer",
      target: "gui/501/com.tester.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.tester.exo.queue-drainer.plist",
      error: null,
      foreignAgents: [],
      loadedStateDir: "/Users/tester/.local/share/exo/audienti-state",
      expectedStateDir: "/Users/tester/work/audienti/exo/.exo",
      stateDirMismatch: true,
      reinstallCommand: "exo agent install-routine --runtime codex --install",
      bootoutCommand: "launchctl bootout gui/501/com.tester.exo.queue-drainer",
    },
    routine: {
      exists: true,
      path: "/Users/tester/work/audienti/exo/.exo/run-agent-host.sh",
      sendMode: "live",
      stale: false,
      artifactVersion: "2026-06-10-1",
      expectedArtifactVersion: "2026-06-10-1",
      reinstallCommand: null,
    },
    rollout: {
      sendMode: "live",
      dueSendCount: 0,
      verifiedDueSendCount: 0,
      unverifiedDueSendCount: 0,
      allDueSendsVerified: true,
      nextCanaryCandidate: null,
      nextVerifyCandidate: null,
      verifiedDueSends: [],
      unverifiedDueSends: [],
      recommendedTransition: {
        targetSendMode: "live",
        ready: true,
        command: null,
        summary: null,
      },
    },
    automationStatus: {
      enabledAutonomousSurfaceCount: 0,
      dueNowCount: 0,
      freshCount: 0,
      retryBackoffCount: 0,
      nextDueSurface: null,
    },
    hostState: null,
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: null,
      nextExpectedRunAt: null,
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: null,
    artifacts: {
      preflightPath: "/Users/tester/work/audienti/exo/.exo/agent-preflight.json",
      hostStatePath: "/Users/tester/work/audienti/exo/.exo/agent-host-state.json",
      lastPassPath: "/Users/tester/work/audienti/exo/.exo/agent-last-pass.json",
      logPath: "/Users/tester/work/audienti/exo/.exo/agent.log",
      launchdStdoutPath: "/Users/tester/work/audienti/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/Users/tester/work/audienti/exo/.exo/agent-launchd.err.log",
      hostRunnerPath: "/Users/tester/work/audienti/exo/.exo/run-agent-host.sh",
    },
  });

  assert.match(output, /Loaded launchd job is draining a different EXO_STATE_DIR/);
  assert.match(output, /loaded=\/Users\/tester\/\.local\/share\/exo\/audienti-state/);
  assert.match(output, /expected=\/Users\/tester\/work\/audienti\/exo\/\.exo/);
  assert.match(output, /Reinstall the routine to converge: exo agent install-routine --runtime codex --install/);
  assert.match(output, /Or bootout the stale job first: launchctl bootout gui\/501\/com\.tester\.exo\.queue-drainer/);
});
