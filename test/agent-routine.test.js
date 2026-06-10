// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  buildRoutinePlan,
  parseRoutineInterval,
  resolveRoutineScheduler,
  ROUTINE_ARTIFACT_VERSION,
} from "../src/lib/agent-routine.js";
import { buildNodeTestEnv } from "../scripts/node-test-runtime.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

test("parseRoutineInterval supports minute and hour cadences", () => {
  assert.deepEqual(parseRoutineInterval("15m"), {
    raw: "15m",
    label: "15m",
    minutes: 15,
    seconds: 900,
    cron: "*/15 * * * *",
  });

  assert.deepEqual(parseRoutineInterval("2h"), {
    raw: "2h",
    label: "2h",
    minutes: 120,
    seconds: 7200,
    cron: "0 */2 * * *",
  });
});

test("resolveRoutineScheduler prefers launchd for codex on macOS", () => {
  assert.equal(resolveRoutineScheduler({
    runtime: "codex",
    scheduler: "auto",
    platform: "darwin",
  }), "launchd");

  assert.equal(resolveRoutineScheduler({
    runtime: "claude",
    scheduler: "auto",
    platform: "darwin",
  }), "cron");

  assert.equal(resolveRoutineScheduler({
    runtime: "codex",
    scheduler: "auto",
    platform: "linux",
  }), "cron");
});

test("buildRoutinePlan emits a macOS host-local Codex runner and launch agent", () => {
  const plan = buildRoutinePlan({
    repo: "/tmp/exo",
    stateDir: "/tmp/exo/.exo",
    runtime: "codex",
    interval: "15m",
    scheduler: "auto",
    platform: "darwin",
    homeDir: "/Users/tester",
    username: "williamflanagan",
    uid: 501,
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
    codexHome: "/Users/tester/.codex",
    nodeBin: "/Applications/Codex.app/Contents/Resources/node",
  });

  assert.equal(plan.scheduler, "launchd");
  assert.equal(plan.sendMode, "verify");
  assert.equal(plan.interval.seconds, 900);
  assert.equal(plan.hostRunnerPath, "/tmp/exo/.exo/run-agent-host.sh");
  assert.equal(plan.launchAgent?.installPath, "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist");
  assert.equal(plan.launchAgent?.target, "gui/501/com.williamflanagan.exo.queue-drainer");
  assert.equal(
    plan.launchAgent?.launchdEntryPath,
    "/Users/tester/Library/Application Support/exo/com.williamflanagan.exo.queue-drainer/launchd-entry.mjs",
  );
  assert.equal(plan.launchAgent?.nodeBin, "/Applications/Codex.app/Contents/Resources/node");
  assert.equal(plan.artifacts.length, 4);

  const runner = plan.artifacts.find((artifact) => artifact.path.endsWith("run-agent-host.sh"))?.content ?? "";
  const prompt = plan.prompt;
  assert.match(runner, new RegExp(`# exo_agent_routine_version=${ROUTINE_ARTIFACT_VERSION}`));
  assert.match(runner, /\/Applications\/Codex\.app\/Contents\/Resources\/codex/);
  assert.match(runner, /HOME="\$\{HOME:-\/Users\/tester\}"/);
  assert.match(runner, /USER="\$\{USER:-williamflanagan\}"/);
  assert.match(runner, /LOGNAME="\$\{LOGNAME:-williamflanagan\}"/);
  assert.match(runner, /export EXO_STATE_DIR="\$STATE_DIR"/);
  assert.match(runner, /export CODEX_SHELL=1/);
  assert.match(runner, /export EXO_AGENT_SEND_DRY_RUN="\$\{EXO_AGENT_SEND_DRY_RUN:-1\}"/);
  assert.match(runner, /LOCK_PID_FILE="\$LOCK_DIR\/pid"/);
  assert.match(runner, /if mkdir "\$LOCK_DIR" 2>\/dev\/null; then/);
  assert.match(runner, /Detected stale Exo queue drainer lock; reclaiming \$LOCK_DIR\./);
  assert.match(runner, /printf '%s\\n' "\$\$" > "\$LOCK_PID_FILE"/);
  assert.match(runner, /release_lock\(\) \{/);
  assert.match(runner, /rm -f "\$LOCK_PID_FILE"/);
  assert.match(runner, /rmdir "\$LOCK_DIR" 2>\/dev\/null \|\| true/);
  assert.match(runner, /trap 'release_lock' EXIT/);
  assert.match(runner, /PREFLIGHT_SCRIPT="\$ROOT\/scripts\/preflight-agent-runtime\.js"/);
  assert.match(runner, /PASS_RUNNER_SCRIPT="\$ROOT\/scripts\/run-agent-host-pass\.js"/);
  assert.match(runner, /node "\$PREFLIGHT_SCRIPT" --json --write "\$PREFLIGHT_JSON"/);
  assert.match(runner, /Starting deterministic host pass \(transport \+ research lanes\)/);
  assert.match(runner, /EXO_AGENT_LANE=transport \/usr\/bin\/caffeinate -dimsu -t 7200 \/usr\/bin\/env node "\$PASS_RUNNER_SCRIPT" &/);
  assert.match(runner, /EXO_AGENT_LANE=research \/usr\/bin\/caffeinate -dimsu -t 7200 \/usr\/bin\/env node "\$PASS_RUNNER_SCRIPT" &/);
  assert.match(runner, /wait "\$transport_pid"/);
  assert.match(runner, /wait "\$research_pid"/);
  const postSpawnReleaseIndex = runner.indexOf("release_lock", runner.indexOf("research_pid=$!"));
  assert.ok(postSpawnReleaseIndex > runner.indexOf("research_pid=$!"));
  assert.ok(postSpawnReleaseIndex < runner.indexOf("wait \"$transport_pid\""));

  assert.match(prompt, /Read \/tmp\/exo\/\.exo\/agent-preflight\.json first if it exists/);
  assert.match(prompt, /skip every browser-backed task in this pass/);
  assert.match(prompt, /Do not run connector diagnostics, do not open Chrome/);
  assert.match(prompt, /verification-only send mode/i);

  const plist = plan.launchAgent?.plist ?? "";
  assert.match(plist, new RegExp(`exo_agent_routine_version=${ROUTINE_ARTIFACT_VERSION}`));
  assert.match(plist, /<string>com\.williamflanagan\.exo\.queue-drainer<\/string>/);
  assert.match(plist, /<key>HOME<\/key>\s*<string>\/Users\/tester<\/string>/);
  assert.match(plist, /<key>USER<\/key>\s*<string>williamflanagan<\/string>/);
  assert.match(plist, /<key>LOGNAME<\/key>\s*<string>williamflanagan<\/string>/);
  assert.match(plist, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/);
  // launchd must exec the TCC-safe entry chain (node + ~/Library entry script),
  // never the in-repo bash runner directly (exit 126 under ~/Documents).
  assert.match(plist, /<string>\/Applications\/Codex\.app\/Contents\/Resources\/node<\/string>\s*<string>\/Users\/tester\/Library\/Application Support\/exo\/com\.williamflanagan\.exo\.queue-drainer\/launchd-entry\.mjs<\/string>/);
  assert.doesNotMatch(plist, /<string>\/tmp\/exo\/\.exo\/run-agent-host\.sh<\/string>/);

  const entry = plan.artifacts.find((artifact) => artifact.path.endsWith("launchd-entry.mjs"));
  assert.ok(entry, "expected a launchd-entry.mjs artifact");
  assert.equal(entry?.path, plan.launchAgent?.launchdEntryPath);
  assert.equal(entry?.mode, 0o755);
  assert.match(entry?.content ?? "", new RegExp(`exo_agent_routine_version=${ROUTINE_ARTIFACT_VERSION}`));
  assert.match(entry?.content ?? "", /const runnerPath = "\/tmp\/exo\/\.exo\/run-agent-host\.sh";/);
  assert.match(entry?.content ?? "", /spawnSync\("\/bin\/bash", \[runnerPath\]/);
});

test("buildRoutinePlan falls back to cron and still emits the shared host runner", () => {
  const plan = buildRoutinePlan({
    repo: "/tmp/exo",
    stateDir: "/tmp/exo/.exo",
    runtime: "claude",
    interval: "30m",
    scheduler: "auto",
    platform: "darwin",
    homeDir: "/Users/tester",
    username: "tester",
    uid: 501,
  });

  assert.equal(plan.scheduler, "cron");
  assert.equal(plan.sendMode, "verify");
  assert.equal(plan.hostRunnerPath, "/tmp/exo/.exo/run-agent-host.sh");
  assert.equal(plan.cronLine, "*/30 * * * * /tmp/exo/.exo/run-agent-host.sh");
  assert.equal(plan.launchAgent, null);
  assert.equal(plan.artifacts.length, 2);
  const runner = plan.artifacts.find((artifact) => artifact.path.endsWith("run-agent-host.sh"))?.content ?? "";
  assert.match(runner, /export HOME="\/Users\/tester"/);
  assert.match(runner, /export USER="tester"/);
  assert.match(runner, /export LOGNAME="tester"/);
  assert.match(runner, /LOCK_PID_FILE="\$LOCK_DIR\/pid"/);
  assert.match(runner, /Exo queue drainer already active/);
  assert.match(runner, /PREFLIGHT_SCRIPT="\$ROOT\/scripts\/preflight-agent-runtime\.js"/);
  assert.match(runner, /PASS_RUNNER_SCRIPT="\$ROOT\/scripts\/run-agent-host-pass\.js"/);
  assert.match(runner, /EXO_AGENT_LANE=transport \/usr\/bin\/env node "\$PASS_RUNNER_SCRIPT" &/);
  assert.match(runner, /EXO_AGENT_LANE=research \/usr\/bin\/env node "\$PASS_RUNNER_SCRIPT" &/);
  const postSpawnReleaseIndex = runner.indexOf("release_lock", runner.indexOf("research_pid=$!"));
  assert.ok(postSpawnReleaseIndex > runner.indexOf("research_pid=$!"));
  assert.ok(postSpawnReleaseIndex < runner.indexOf("wait \"$transport_pid\""));
  assert.doesNotMatch(runner, /claude -p|codex exec/);
});

test("buildRoutinePlan can persist verification-only send mode for the codex launchd runner", () => {
  const plan = buildRoutinePlan({
    repo: "/tmp/exo",
    stateDir: "/tmp/exo/.exo",
    runtime: "codex",
    interval: "15m",
    scheduler: "auto",
    sendMode: "verify",
    platform: "darwin",
    homeDir: "/Users/tester",
    username: "williamflanagan",
    uid: 501,
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
    codexHome: "/Users/tester/.codex",
  });

  assert.equal(plan.scheduler, "launchd");
  assert.equal(plan.sendMode, "verify");
  const runner = plan.artifacts.find((artifact) => artifact.path.endsWith("run-agent-host.sh"))?.content ?? "";
  assert.match(runner, /export EXO_AGENT_SEND_DRY_RUN="\$\{EXO_AGENT_SEND_DRY_RUN:-1\}"/);
  assert.match(runner, /echo "send_mode=verify"/);
  assert.match(plan.prompt, /verification-only send mode/i);
  assert.match(plan.prompt, /stop before the final click/i);
});

test("buildRoutinePlan can persist canary send mode for the codex launchd runner", () => {
  const plan = buildRoutinePlan({
    repo: "/tmp/exo",
    stateDir: "/tmp/exo/.exo",
    runtime: "codex",
    interval: "15m",
    scheduler: "auto",
    sendMode: "canary",
    platform: "darwin",
    homeDir: "/Users/tester",
    username: "williamflanagan",
    uid: 501,
    pathEnv: "/usr/local/bin:/usr/bin:/bin",
    codexHome: "/Users/tester/.codex",
  });

  assert.equal(plan.scheduler, "launchd");
  assert.equal(plan.sendMode, "canary");
  const runner = plan.artifacts.find((artifact) => artifact.path.endsWith("run-agent-host.sh"))?.content ?? "";
  assert.match(runner, /export EXO_AGENT_SEND_MODE="canary"/);
  assert.doesNotMatch(runner, /EXO_AGENT_SEND_DRY_RUN/);
  assert.match(runner, /echo "send_mode=canary"/);
  assert.match(plan.prompt, /canary send mode/i);
  assert.match(plan.prompt, /already has a fresh verification proof, perform the real send/i);
});

test("agent install-routine --json does not write runner artifacts during a dry plan", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-json-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--send-mode", "canary", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.scheduler, "launchd");
    assert.equal(report.sendMode, "canary");
    assert.equal(report.installed, false);
    assert.equal(fs.existsSync(stateDir), false);
    assert.equal(fs.existsSync(path.join(stateDir, "agent-routine.md")), false);
    assert.equal(fs.existsSync(path.join(stateDir, "run-agent-host.sh")), false);
    assert.equal(fs.existsSync(path.join(stateDir, "agent-launchd.plist")), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --json defaults to verify mode for a safe first rollout", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-default-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.sendMode, "verify");
    assert.equal(report.rolloutReadiness.ready, true);
    assert.equal(report.rolloutReadiness.reason, null);
    assert.equal(typeof report.automationStatus.enabledAutonomousSurfaceCount, "number");
    assert.equal(Array.isArray(report.automationHealthWarnings), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine preview does not write artifacts unless explicitly requested", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-preview-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    assert.match(output, /Planned scheduled agent \(codex, every 15m, send mode verify\) was not written\./);
    assert.match(output, /re-run with --write-artifacts to generate the local runner files without installing\./);
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --write-artifacts writes local runner files without installing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-write-artifacts-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--write-artifacts"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    assert.match(output, /Wrote the agent routine/);
    assert.match(output, /Not installed \(dry run\)\./);
    assert.equal(fs.existsSync(path.join(stateDir, "agent-routine.md")), true);
    assert.equal(fs.existsSync(path.join(stateDir, "run-agent-host.sh")), true);
    assert.equal(fs.existsSync(path.join(stateDir, "agent-launchd.plist")), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --json --install writes artifacts and installs the launch agent", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-json-install-"));
  const stateDir = path.join(tempRoot, ".exo");
  const homeDir = path.join(tempRoot, "home");
  const fakeBinDir = path.join(tempRoot, "bin");
  const fakeLaunchctlLogPath = path.join(tempRoot, "launchctl.log");
  const fakeLaunchctlPath = path.join(fakeBinDir, "launchctl");

  try {
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(fakeBinDir, { recursive: true });
    fs.writeFileSync(fakeLaunchctlPath, [
      "#!/usr/bin/env bash",
      `printf '%s\\n' \"$*\" >> ${JSON.stringify(fakeLaunchctlLogPath)}`,
      "exit 0",
      "",
    ].join("\n"), "utf8");
    fs.chmodSync(fakeLaunchctlPath, 0o755);

    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--send-mode", "verify", "--install", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({
        ...process.env,
        EXO_STATE_DIR: stateDir,
        HOME: homeDir,
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
      }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    const launchAgentInstallPath = path.join(homeDir, "Library", "LaunchAgents", "com.williamflanagan.exo.queue-drainer.plist");
    const launchctlLog = fs.readFileSync(fakeLaunchctlLogPath, "utf8");
    assert.equal(report.scheduler, "launchd");
    assert.equal(report.installAttempted, true);
    assert.equal(report.installed, true);
    assert.equal(report.artifactsWritten, true);
    assert.equal(report.installError, null);
    assert.equal(fs.existsSync(path.join(stateDir, "agent-routine.md")), true);
    assert.equal(fs.existsSync(path.join(stateDir, "run-agent-host.sh")), true);
    assert.equal(fs.existsSync(path.join(stateDir, "agent-launchd.plist")), true);
    assert.equal(fs.existsSync(launchAgentInstallPath), true);
    assert.match(launchctlLog, /bootout gui\/\d+\/com\.williamflanagan\.exo\.queue-drainer/);
    assert.match(launchctlLog, /bootstrap gui\/\d+ /);
    assert.match(launchctlLog, /enable gui\/\d+\/com\.williamflanagan\.exo\.queue-drainer/);
    assert.match(launchctlLog, /print gui\/\d+\/com\.williamflanagan\.exo\.queue-drainer/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --json preserves the existing installed send mode when none is specified", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-preserve-mode-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "run-agent-host.sh"), [
      "#!/usr/bin/env bash",
      `# exo_agent_routine_version=${ROUTINE_ARTIFACT_VERSION}`,
      'echo "send_mode=canary"',
      "",
    ].join("\n"));

    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.sendMode, "canary");
    assert.equal(report.rolloutReadiness.ready, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --send-mode live --json allows maintenance when live is already installed", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-preserve-live-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "run-agent-host.sh"), [
      "#!/usr/bin/env bash",
      `# exo_agent_routine_version=${ROUTINE_ARTIFACT_VERSION}`,
      'echo "send_mode=live"',
      "",
    ].join("\n"));

    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--send-mode", "live", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.sendMode, "live");
    assert.equal(report.rolloutReadiness.ready, true);
    assert.equal(report.rolloutReadiness.reason, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --send-mode live --json blocks rollout until a canary send succeeds", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-live-readiness-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--send-mode", "live", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.sendMode, "live");
    assert.equal(report.rolloutReadiness.ready, false);
    assert.match(report.rolloutReadiness.reason, /at least one successful canary send/i);
    assert.equal(
      report.rolloutReadiness.command,
      "exo agent install-routine --runtime codex --interval 15m --send-mode canary --install",
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --send-mode canary --json blocks rollout when autonomous retrieval truth is stale", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-retrieval-health-"));
  const stateDir = path.join(tempRoot, ".exo");
  const databaseModuleUrl = pathToFileURL(path.join(repoRoot, "src", "db", "database.js")).href;

  try {
    execFileSync("node", ["--input-type=module", "-e", `
      import { insertUser } from ${JSON.stringify(databaseModuleUrl)};
      const staleAt = "2000-01-01T00:00:00.000Z";
      const veryStaleAt = "1999-12-31T00:00:00.000Z";
      const user = ${JSON.stringify({
        id: "user-1",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        label: "William",
        owner: "William",
        workingHours: {
          mode: "always",
          timezone: "America/New_York",
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
          startLocalTime: "07:00",
          endLocalTime: "18:00",
        },
        accounts: [
          {
            id: "account-1",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:00.000Z",
            capability: "linkedin",
            handle: "omalab-main",
            label: "LinkedIn",
            sourceType: "browser-profile",
            browserProfileId: "profile-4",
            preferred: true,
            inboundSync: {
              surfaces: [
                {
                  surfaceKey: "linkedin-sent-invitations",
                  enabled: true,
                  lastRunStatus: "success",
                  lastObservedAt: null,
                },
                {
                  surfaceKey: "linkedin-received-invitations",
                  enabled: true,
                  lastRunStatus: "success",
                  lastObservedAt: null,
                },
                {
                  surfaceKey: "linkedin-messaging-inbox",
                  enabled: true,
                  lastRunStatus: "success",
                  lastObservedAt: null,
                },
                {
                  surfaceKey: "linkedin-profile-views",
                  enabled: true,
                  lastRunStatus: "success",
                  lastObservedAt: null,
                },
                {
                  surfaceKey: "linkedin-followers-list",
                  enabled: true,
                  lastRunStatus: "success",
                  lastObservedAt: null,
                },
                {
                  surfaceKey: "linkedin-following-list",
                  enabled: true,
                  lastRunStatus: "success",
                  lastObservedAt: null,
                },
              ],
            },
          },
        ],
      })};
      for (const surface of user.accounts[0].inboundSync.surfaces) {
        surface.lastObservedAt = surface.surfaceKey === "linkedin-messaging-inbox" ? veryStaleAt : staleAt;
      }
      insertUser(user);
    `], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--send-mode", "canary", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.sendMode, "canary");
    assert.equal(report.rolloutReadiness.ready, false);
    assert.match(report.rolloutReadiness.reason, /background truth is not healthy enough for send rollout/i);
    assert.equal(report.rolloutReadiness.command, "exo inbound sync show user-1 --json");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --send-mode canary --json blocks rollout when autonomous retrieval failed recently", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-recent-failure-"));
  const stateDir = path.join(tempRoot, ".exo");
  const databaseModuleUrl = pathToFileURL(path.join(repoRoot, "src", "db", "database.js")).href;

  try {
    execFileSync("node", ["--input-type=module", "-e", `
      import { insertUser } from ${JSON.stringify(databaseModuleUrl)};
      const failedAt = new Date(Date.now() - (5 * 60 * 1000)).toISOString();
      insertUser({
        id: "user-1",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
        label: "William",
        owner: "William",
        accounts: [
          {
            id: "account-1",
            createdAt: "2026-06-03T00:00:00.000Z",
            updatedAt: "2026-06-03T00:00:00.000Z",
            capability: "gmail",
            handle: "omalab-main",
            label: "Gmail",
            sourceType: "browser-profile",
            browserProfileId: "profile-4",
            preferred: true,
            inboundSync: {
              surfaces: [
                {
                  surfaceKey: "gmail-inbox-threads",
                  enabled: true,
                  lastRunStatus: "failed",
                  lastSyncedAt: failedAt,
                },
              ],
            },
          },
        ],
      });
    `], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--send-mode", "canary", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.sendMode, "canary");
    assert.equal(report.rolloutReadiness.ready, false);
    assert.match(report.rolloutReadiness.reason, /background truth is not healthy enough for send rollout/i);
    assert.equal(report.rolloutReadiness.command, "exo inbound sync show user-1 --json");
    assert.equal(report.automationHealthWarnings[0]?.freshnessState, "failed");
    assert.match(report.automationHealthWarnings[0]?.reason, /still in retry backoff/i);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --send-mode live --install refuses before writing artifacts when rollout is not ready", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-live-install-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    let failure = null;
    try {
      execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--send-mode", "live", "--install"], {
        cwd: repoRoot,
        env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure, "expected live install to fail while rollout is not ready");
    const stdout = String(failure.stdout ?? "");
    const stderr = String(failure.stderr ?? "");
    const combined = `${stdout}\n${stderr}`;
    assert.match(combined, /Rollout readiness: blocked\./);
    assert.match(combined, /Did not write or install routine artifacts because this rollout mode is not ready\./);
    assert.match(combined, /error: Refusing to install this send mode while rollout readiness is blocked\./);
    assert.doesNotMatch(combined, /Wrote the agent routine/);
    assert.doesNotMatch(combined, /file:\/\/\/|node:internal|Error: Refusing to install/);
    assert.equal(fs.existsSync(stateDir), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --send-mode live --json stays blocked while canary cooldown is still active", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-live-cooldown-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "agent-host-state.json"), JSON.stringify({
      canaryCooldown: {
        unavailableUntil: "2099-06-03T14:00:00.000Z",
        lastSentAt: "2026-06-03T08:00:00.000Z",
        lastTaskFingerprint: "abc123",
        lastTaskLabel: "Taras Mykhalyshyn at BillEase",
      },
    }, null, 2));

    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--send-mode", "live", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.sendMode, "live");
    assert.equal(report.rolloutReadiness.ready, false);
    assert.match(report.rolloutReadiness.reason, /canary cooldown expires/i);
    assert.equal(report.rolloutReadiness.command, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("agent install-routine --send-mode live --json becomes ready after a successful canary send and cooldown expiry", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-routine-live-ready-"));
  const stateDir = path.join(tempRoot, ".exo");

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "agent-host-state.json"), JSON.stringify({
      canaryCooldown: {
        unavailableUntil: "2026-06-03T01:00:00.000Z",
        lastSentAt: "2026-06-03T00:30:00.000Z",
        lastTaskFingerprint: "abc123",
        lastTaskLabel: "Taras Mykhalyshyn at BillEase",
      },
    }, null, 2));

    const output = execFileSync("node", [cliPath, "agent", "install-routine", "--runtime", "codex", "--interval", "15m", "--send-mode", "live", "--json"], {
      cwd: repoRoot,
      env: buildNodeTestEnv({ ...process.env, EXO_STATE_DIR: stateDir }),
      encoding: "utf8",
    });

    const report = JSON.parse(output);
    assert.equal(report.sendMode, "live");
    assert.equal(report.rolloutReadiness.ready, true);
    assert.equal(report.rolloutReadiness.reason, null);
    assert.equal(report.rolloutReadiness.command, null);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
