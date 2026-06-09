// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
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
