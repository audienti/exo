// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { formatAgentDoctorReport } from "../src/cli/commands/agent.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

test("formatAgentDoctorReport makes the worker diagnosis explicit", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T02:52:50.459Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 6,
      waitingTaskCount: 1,
      blockerCount: 2,
      draftTaskCount: 0,
      browserTaskCount: 0,
      browserTaskKinds: [],
    },
    browser: {
      required: false,
      ready: true,
      skipReason: "no_browser_tasks_due",
      blockedReasons: [],
      warnings: [
        "Additional Chrome app instance(s) are running with custom user-data-dir values: pid 9746.",
      ],
      taskReadiness: {
        run_inbound_sync: {
          ready: true,
          blockedReasons: [],
        },
        send_message: {
          ready: true,
          blockedReasons: [],
        },
        withdraw_connection: {
          ready: true,
          blockedReasons: [],
        },
      },
      chromeAppInstances: {
        conflictingUserDataDirInstances: [
          {
            pid: 9746,
            userDataDir: "/var/folders/.../para-knit-slack-debug-profile",
          },
        ],
      },
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: false,
      running: false,
      pid: null,
      state: null,
      runs: 0,
      runIntervalSeconds: 900,
      lastExitCode: null,
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: "Bad request.",
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "verify",
    },
    rollout: {
      sendMode: "verify",
      dueSendCount: 6,
      verifiedDueSendCount: 2,
      unverifiedDueSendCount: 4,
      allDueSendsVerified: false,
      nextCanaryCandidate: {
        label: "Taras Mykhalyshyn at BillEase",
      },
      nextVerifyCandidate: {
        label: "Georg Steiger at BillEase",
      },
      verifiedDueSends: [],
      unverifiedDueSends: [],
      recommendedTransition: {
        targetSendMode: "verify",
        ready: false,
        command: null,
        summary: null,
      },
    },
    automationStatus: {
      enabledAutonomousSurfaceCount: 6,
      dueNowCount: 0,
      freshCount: 6,
      retryBackoffCount: 0,
      nextDueSurface: {
        dueAt: "2026-06-03T10:03:12.000Z",
        capability: "gmail",
        handle: "omalab-main",
        surfaceLabel: "Inbox Threads",
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: "2026-06-03T03:01:40.777Z",
          reason: "Detached Chrome browser sends are blocked while additional Chrome app instances are running with custom user-data-dir values (pid 9746).",
        },
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: "2026-06-03T02:30:00.000Z",
      nextExpectedRunAt: "2026-06-03T02:45:00.000Z",
      overdue: true,
      overdueBySeconds: 470,
    },
    lastPass: {
      status: "blocked",
      startedAt: "2026-06-03T02:30:00.000Z",
      endedAt: "2026-06-03T02:52:50.459Z",
      reason: "Detached Chrome browser sends are blocked while additional Chrome app instances are running with custom user-data-dir values (pid 9746).",
      results: [],
    },
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Queue: 6 due, 1 waiting, 2 blockers\./);
  assert.match(output, /Scheduler: launchd installed but not loaded\./);
  assert.match(output, /Scheduler is overdue\. 2026-06-03T02:45:00.000Z \(\d+s late\)\./);
  assert.match(output, /Send mode: verify\. Send tasks stop before the final send, so they will not drain\./);
  assert.match(output, /Send proof coverage: 2\/6 due sends already have fresh proof\./);
  assert.match(output, /Verify mode still needs 4 more proofs\. Next likely proof: Georg Steiger at BillEase\./);
  assert.match(output, /Autonomous retrieval: 6\/6 enabled surfaces currently fresh, 0 due now\./);
  assert.match(output, /Next autonomous retrieval due around 2026-06-03T10:03:12.000Z for gmail:omalab-main · Inbox Threads\./);
  assert.match(output, /run_inbound_sync: ready/);
  assert.match(output, /send_message: ready/);
  assert.match(output, /No browser-dependent queue work is due right now\./);
  assert.match(output, /withdraw_connection: ready/);
  assert.match(output, /pid 9746/);
  assert.match(output, /launchd plist: \/Users\/tester\/Library\/LaunchAgents\/com\.williamflanagan\.exo\.queue-drainer\.plist/);
  assert.match(output, /host runner: \/tmp\/exo\/\.exo\/run-agent-host\.sh/);
  assert.doesNotMatch(output, /Browser backoff by task class:/);
});

test("formatAgentDoctorReport shows launchd run history when the worker is loaded", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T05:11:22.430Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 5,
      waitingTaskCount: 1,
      blockerCount: 3,
      draftTaskCount: 4,
      browserTaskCount: 0,
      browserTaskKinds: [],
    },
    browser: {
      required: false,
      ready: true,
      skipReason: "no_browser_tasks_due",
      blockedReasons: [],
      warnings: [],
      taskReadiness: {
        send_message: {
          ready: true,
          blockedReasons: [],
        },
      },
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: false,
      pid: null,
      state: "not running",
      runs: 0,
      runIntervalSeconds: 900,
      lastExitCode: null,
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "live",
    },
    rollout: {
      sendMode: "live",
      dueSendCount: 1,
      verifiedDueSendCount: 0,
      unverifiedDueSendCount: 1,
      allDueSendsVerified: false,
      nextCanaryCandidate: null,
      nextVerifyCandidate: {
        label: "Tom Nielsen at Snyk",
      },
      verifiedDueSends: [],
      unverifiedDueSends: [],
      recommendedTransition: {
        targetSendMode: "live",
        ready: false,
        command: null,
        summary: null,
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: null,
      nextExpectedRunAt: null,
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: null,
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Scheduler: launchd loaded\. state=not running runs=0/);
  assert.match(output, /interval=15m/);
  assert.match(output, /Send mode: live\. Connector-native sends are allowed to complete and write back\./);
});

test("formatAgentDoctorReport surfaces stale installed runner artifacts", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T07:31:07.108Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 5,
      waitingTaskCount: 1,
      blockerCount: 3,
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
      taskReadiness: {
        send_message: {
          ready: true,
          blockedReasons: [],
        },
      },
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: false,
      pid: null,
      state: "not running",
      runs: 10,
      runIntervalSeconds: 900,
      runningForSeconds: null,
      lastExitCode: "0",
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "verify",
      artifactVersion: null,
      expectedArtifactVersion: "2026-06-03-1",
      stale: true,
      reinstallCommand: "exo agent install-routine --runtime codex --interval 15m --send-mode verify --install",
    },
    rollout: {
      sendMode: "verify",
      dueSendCount: 5,
      verifiedDueSendCount: 5,
      unverifiedDueSendCount: 0,
      allDueSendsVerified: true,
      nextCanaryCandidate: {
        label: "Taras Mykhalyshyn at BillEase",
      },
      nextVerifyCandidate: null,
      verifiedDueSends: [],
      unverifiedDueSends: [],
      sendCircuitBreaker: {
        active: false,
        consecutiveFailures: 0,
        unavailableUntil: null,
        reason: null,
        lastFailureAt: null,
        lastTaskFingerprint: null,
        lastTaskLabel: null,
      },
      canaryCooldown: {
        active: false,
        unavailableUntil: null,
        lastSentAt: null,
        lastTaskFingerprint: null,
        lastTaskLabel: null,
      },
      recommendedTransition: {
        targetSendMode: "verify",
        ready: false,
        command: "exo agent install-routine --runtime codex --interval 15m --send-mode verify --install",
        summary: "Reinstall the scheduled worker before any rollout change so the live runner matches current code.",
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
      sendCircuitBreaker: {
        consecutiveFailures: 0,
        unavailableUntil: null,
        reason: null,
        lastFailureAt: null,
        lastTaskFingerprint: null,
        lastTaskLabel: null,
      },
      canaryCooldown: {
        unavailableUntil: null,
        lastSentAt: null,
        lastTaskFingerprint: null,
        lastTaskLabel: null,
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: "2026-06-03T07:15:25.509Z",
      activeRunStartedAt: null,
      activeRunElapsedSeconds: null,
      activeRunOverCadence: false,
      activeRunOverCadenceBySeconds: 0,
      nextExpectedRunAt: "2026-06-03T07:30:25.509Z",
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: null,
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Installed host runner artifacts are stale relative to current code \(have no version, need 2026-06-03-1\)\./);
  assert.match(output, /Reinstall the routine to apply reliability fixes: exo agent install-routine --runtime codex --interval 15m --send-mode verify --install/);
  assert.match(output, /Reinstall the scheduled worker before any rollout change so the live runner matches current code\./);
});

test("formatAgentDoctorReport flags a running launchd pass that has exceeded its cadence", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T07:40:00.000Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 5,
      waitingTaskCount: 1,
      blockerCount: 3,
      draftTaskCount: 0,
      browserTaskCount: 5,
      browserTaskKinds: ["send_message"],
    },
    browser: {
      required: true,
      ready: true,
      skipReason: null,
      blockedReasons: [],
      warnings: [],
      taskReadiness: {
        send_message: {
          ready: true,
          blockedReasons: [],
        },
      },
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: true,
      pid: 4242,
      state: "running",
      runs: 9,
      runIntervalSeconds: 900,
      runningForSeconds: 1100,
      lastExitCode: "0",
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "verify",
    },
    rollout: {
      sendMode: "verify",
      dueSendCount: 5,
      verifiedDueSendCount: 4,
      unverifiedDueSendCount: 1,
      allDueSendsVerified: false,
      nextCanaryCandidate: {
        label: "Taras Mykhalyshyn at BillEase",
      },
      nextVerifyCandidate: {
        label: "Jim Wangler at Semgrep",
      },
      verifiedDueSends: [],
      unverifiedDueSends: [],
      recommendedTransition: {
        targetSendMode: "verify",
        ready: false,
        command: null,
        summary: null,
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: "2026-06-03T07:10:00.000Z",
      activeRunStartedAt: "2026-06-03T07:21:40.000Z",
      activeRunElapsedSeconds: 1100,
      activeRunOverCadence: true,
      activeRunOverCadenceBySeconds: 200,
      nextExpectedRunAt: "2026-06-03T07:25:00.000Z",
      overdue: true,
      overdueBySeconds: 900,
    },
    lastPass: {
      startedAt: "2026-06-03T07:10:00.000Z",
      endedAt: "2026-06-03T07:10:45.000Z",
      status: "completed",
      results: [],
    },
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Scheduler: launchd loaded\. state=running runs=9 last_exit=0 interval=15m running_for=18m20s/);
  assert.match(output, /Current launchd pass has exceeded its cadence by 200s\./);
});

test("formatAgentDoctorReport surfaces an active live-send circuit breaker", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T08:00:00.000Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 5,
      waitingTaskCount: 1,
      blockerCount: 3,
      draftTaskCount: 0,
      browserTaskCount: 5,
      browserTaskKinds: ["send_message"],
    },
    browser: {
      required: true,
      ready: true,
      skipReason: null,
      blockedReasons: [],
      warnings: [],
      taskReadiness: {
        send_message: {
          ready: true,
          blockedReasons: [],
        },
      },
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: false,
      pid: null,
      state: "not running",
      runs: 10,
      runIntervalSeconds: 900,
      runningForSeconds: null,
      lastExitCode: "0",
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "canary",
    },
    rollout: {
      sendMode: "canary",
      dueSendCount: 5,
      verifiedDueSendCount: 5,
      unverifiedDueSendCount: 0,
      allDueSendsVerified: true,
      nextCanaryCandidate: {
        label: "Taras Mykhalyshyn at BillEase",
      },
      nextVerifyCandidate: null,
      verifiedDueSends: [],
      unverifiedDueSends: [],
      sendCircuitBreaker: {
        active: true,
        consecutiveFailures: 2,
        unavailableUntil: "2026-06-03T14:00:00.000Z",
        reason: "linkedin_direct_message_blocked",
        lastFailureAt: "2026-06-03T07:45:00.000Z",
        lastTaskFingerprint: "abc123",
        lastTaskLabel: "Taras Mykhalyshyn at BillEase",
      },
      recommendedTransition: {
        targetSendMode: "canary",
        ready: false,
        command: null,
        summary: "Live send rollout is paused by the circuit breaker until 2026-06-03T14:00:00.000Z after 2 consecutive live/canary send failures.",
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
      sendCircuitBreaker: {
        consecutiveFailures: 2,
        unavailableUntil: "2026-06-03T14:00:00.000Z",
        reason: "linkedin_direct_message_blocked",
        lastFailureAt: "2026-06-03T07:45:00.000Z",
        lastTaskFingerprint: "abc123",
        lastTaskLabel: "Taras Mykhalyshyn at BillEase",
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: "2026-06-03T07:45:00.000Z",
      activeRunStartedAt: null,
      activeRunElapsedSeconds: null,
      activeRunOverCadence: false,
      activeRunOverCadenceBySeconds: 0,
      nextExpectedRunAt: "2026-06-03T08:00:00.000Z",
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: {
      startedAt: "2026-06-03T07:45:00.000Z",
      endedAt: "2026-06-03T07:46:00.000Z",
      status: "blocked",
      results: [],
    },
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Live send circuit breaker is active until 2026-06-03T14:00:00.000Z after 2 consecutive live\/canary send failures\./);
  assert.match(output, /Live send rollout is paused by the circuit breaker until 2026-06-03T14:00:00.000Z after 2 consecutive live\/canary send failures\./);
});

test("formatAgentDoctorReport surfaces an active canary cooldown", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T08:00:00.000Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 5,
      waitingTaskCount: 1,
      blockerCount: 3,
      draftTaskCount: 0,
      browserTaskCount: 5,
      browserTaskKinds: ["send_message"],
    },
    browser: {
      required: true,
      ready: true,
      skipReason: null,
      blockedReasons: [],
      warnings: [],
      taskReadiness: {
        send_message: {
          ready: true,
          blockedReasons: [],
        },
      },
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: false,
      pid: null,
      state: "not running",
      runs: 10,
      runIntervalSeconds: 900,
      runningForSeconds: null,
      lastExitCode: "0",
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "canary",
    },
    rollout: {
      sendMode: "canary",
      dueSendCount: 5,
      verifiedDueSendCount: 5,
      unverifiedDueSendCount: 0,
      allDueSendsVerified: true,
      nextCanaryCandidate: {
        label: "Taras Mykhalyshyn at BillEase",
      },
      nextVerifyCandidate: null,
      verifiedDueSends: [],
      unverifiedDueSends: [],
      sendCircuitBreaker: {
        active: false,
        consecutiveFailures: 0,
        unavailableUntil: null,
        reason: null,
        lastFailureAt: null,
        lastTaskFingerprint: null,
        lastTaskLabel: null,
      },
      canaryCooldown: {
        active: true,
        unavailableUntil: "2026-06-03T14:00:00.000Z",
        lastSentAt: "2026-06-03T08:00:00.000Z",
        lastTaskFingerprint: "abc123",
        lastTaskLabel: "Taras Mykhalyshyn at BillEase",
      },
      recommendedTransition: {
        targetSendMode: "canary",
        ready: false,
        command: null,
        summary: "Canary live-send cooldown is active until 2026-06-03T14:00:00.000Z after Taras Mykhalyshyn at BillEase.",
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
      canaryCooldown: {
        unavailableUntil: "2026-06-03T14:00:00.000Z",
        lastSentAt: "2026-06-03T08:00:00.000Z",
        lastTaskFingerprint: "abc123",
        lastTaskLabel: "Taras Mykhalyshyn at BillEase",
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: "2026-06-03T07:45:00.000Z",
      activeRunStartedAt: null,
      activeRunElapsedSeconds: null,
      activeRunOverCadence: false,
      activeRunOverCadenceBySeconds: 0,
      nextExpectedRunAt: "2026-06-03T08:00:00.000Z",
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: {
      startedAt: "2026-06-03T07:45:00.000Z",
      endedAt: "2026-06-03T07:46:00.000Z",
      status: "completed",
      results: [],
    },
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Canary live-send cooldown is active until 2026-06-03T14:00:00.000Z after Taras Mykhalyshyn at BillEase\./);
});

test("formatAgentDoctorReport describes canary send mode explicitly", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T06:10:00.000Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 5,
      waitingTaskCount: 1,
      blockerCount: 3,
      draftTaskCount: 0,
      browserTaskCount: 5,
      browserTaskKinds: ["send_message"],
    },
    browser: {
      required: true,
      ready: true,
      skipReason: null,
      blockedReasons: [],
      warnings: [],
      taskReadiness: {
        send_message: {
          ready: true,
          blockedReasons: [],
        },
      },
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: false,
      pid: null,
      state: "not running",
      runs: 2,
      runIntervalSeconds: 900,
      lastExitCode: "0",
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "canary",
    },
    rollout: {
      sendMode: "canary",
      dueSendCount: 5,
      verifiedDueSendCount: 3,
      unverifiedDueSendCount: 2,
      allDueSendsVerified: false,
      nextCanaryCandidate: {
        label: "Taras Mykhalyshyn at BillEase",
      },
      nextVerifyCandidate: {
        label: "Tom Nielsen at Snyk",
      },
      verifiedDueSends: [],
      unverifiedDueSends: [],
      recommendedTransition: {
        targetSendMode: "canary",
        ready: false,
        command: null,
        summary: null,
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: null,
      nextExpectedRunAt: null,
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: null,
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Send mode: canary\. Each pass may send at most one previously verified send\. Unverified due sends stop at ready_to_send first\./);
  assert.match(output, /Send proof coverage: 3\/5 due sends already have fresh proof\./);
  assert.match(output, /Canary is ready to send next from Taras Mykhalyshyn at BillEase\./);
});

test("formatAgentDoctorReport recommends live after a successful canary send and no remaining proof gaps", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T15:10:00.000Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 2,
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
      taskReadiness: {
        send_message: {
          ready: true,
          blockedReasons: [],
        },
      },
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
      lastExitCode: "0",
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "canary",
    },
    rollout: {
      sendMode: "canary",
      dueSendCount: 2,
      verifiedDueSendCount: 2,
      unverifiedDueSendCount: 0,
      allDueSendsVerified: true,
      nextCanaryCandidate: {
        label: "Georg Steiger at BillEase",
      },
      nextVerifyCandidate: null,
      verifiedDueSends: [],
      unverifiedDueSends: [],
      recommendedTransition: {
        targetSendMode: "live",
        ready: true,
        command: "exo agent install-routine --runtime codex --interval 15m --send-mode live --install",
        summary: "Recommended rollout step: switch the scheduled worker to live. Canary has already completed at least one successful live send. Last canary send: Taras Mykhalyshyn at BillEase.",
      },
      sendCircuitBreaker: {
        active: false,
        consecutiveFailures: 0,
        unavailableUntil: null,
        reason: null,
        lastFailureAt: null,
        lastTaskFingerprint: null,
        lastTaskLabel: null,
      },
      canaryCooldown: {
        active: false,
        unavailableUntil: null,
        lastSentAt: "2026-06-03T08:00:00.000Z",
        lastTaskFingerprint: "abc123",
        lastTaskLabel: "Taras Mykhalyshyn at BillEase",
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: null,
      nextExpectedRunAt: null,
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: null,
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Send mode: canary\. Each pass may send at most one previously verified send\. Unverified due sends stop at ready_to_send first\./);
  assert.match(output, /Canary is ready to send next from Georg Steiger at BillEase\./);
  assert.match(output, /Recommended rollout step: switch the scheduled worker to live\. Canary has already completed at least one successful live send\. Last canary send: Taras Mykhalyshyn at BillEase\./);
});

test("formatAgentDoctorReport shows recent verification-only send proofs", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T05:47:24.483Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 5,
      waitingTaskCount: 1,
      blockerCount: 3,
      draftTaskCount: 0,
      browserTaskCount: 5,
      browserTaskKinds: ["send_message"],
    },
    browser: {
      required: true,
      ready: true,
      skipReason: null,
      blockedReasons: [],
      warnings: [],
      taskReadiness: {
        send_message: {
          ready: true,
          blockedReasons: [],
        },
      },
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: false,
      pid: null,
      state: "not running",
      runs: 3,
      runIntervalSeconds: 900,
      lastExitCode: "0",
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "verify",
    },
    rollout: {
      sendMode: "verify",
      dueSendCount: 5,
      verifiedDueSendCount: 5,
      unverifiedDueSendCount: 0,
      allDueSendsVerified: true,
      nextCanaryCandidate: {
        label: "Taras Mykhalyshyn at BillEase",
      },
      nextVerifyCandidate: null,
      verifiedDueSends: [],
      unverifiedDueSends: [],
      recommendedTransition: {
        targetSendMode: "canary",
        ready: true,
        command: "exo agent install-routine --runtime codex --interval 15m --send-mode canary --install",
        summary: "Recommended rollout step: switch the scheduled worker to canary. Next canary send: Taras Mykhalyshyn at BillEase.",
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
      recentTaskVerifications: [
        {
          taskKind: "send_message",
          fingerprint: "abc123",
          prospectName: "Taras Mykhalyshyn",
          companyName: "BillEase",
          verifiedAt: "2026-06-03T05:47:15.929Z",
          expiresAt: "2026-06-03T11:47:15.929Z",
          verificationStatus: "ready_to_send",
        },
      ],
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: "2026-06-03T05:32:15.929Z",
      nextExpectedRunAt: "2026-06-03T05:47:15.929Z",
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: null,
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Recent verification-only send proofs:/);
  assert.match(output, /Taras Mykhalyshyn at BillEase: verified 2026-06-03T05:47:15.929Z \(ready_to_send\)/);
  assert.match(output, /skip-until: 2026-06-03T11:47:15.929Z/);
  assert.match(output, /Send mode: verify\./);
  assert.match(output, /All due sends are already proved\. Canary can safely drain next from Taras Mykhalyshyn at BillEase\./);
  assert.match(output, /Recommended rollout step: switch the scheduled worker to canary\. Next canary send: Taras Mykhalyshyn at BillEase\./);
});

test("formatAgentDoctorReport surfaces enabled manual-only inbound surfaces", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T07:55:25.627Z",
    stateDir: "/tmp/exo/.exo",
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
      runs: 2,
      runIntervalSeconds: 900,
      runningForSeconds: null,
      lastExitCode: "0",
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "verify",
      artifactVersion: "2026-06-03-1",
      expectedArtifactVersion: "2026-06-03-1",
      stale: false,
      reinstallCommand: null,
    },
    rollout: {
      sendMode: "verify",
      dueSendCount: 2,
      verifiedDueSendCount: 2,
      unverifiedDueSendCount: 0,
      allDueSendsVerified: true,
      nextCanaryCandidate: {
        label: "Taras Mykhalyshyn at BillEase",
      },
      nextVerifyCandidate: null,
      verifiedDueSends: [],
      unverifiedDueSends: [],
      recommendedTransition: {
        targetSendMode: "verify",
        ready: false,
        command: "exo inbound sync set user-1 --account account-1 --disable-surface linkedin-comment-replies --json",
        summary: "Resolve enabled manual-only inbound surfaces before any rollout change so background retrieval coverage is honest.",
      },
    },
    automationWarnings: [
      {
        userId: "user-1",
        accountId: "account-1",
        capability: "linkedin",
        handle: "omalab-main",
        surfaceKey: "linkedin-comment-replies",
        surfaceLabel: "Comment Replies",
        reason: "This surface is not yet wired through Exo's autonomous LinkedIn live-capture path.",
        disableCommand: "exo inbound sync set user-1 --account account-1 --disable-surface linkedin-comment-replies --json",
      },
    ],
    automationStatus: {
      enabledAutonomousSurfaceCount: 6,
      dueNowCount: 0,
      freshCount: 6,
      retryBackoffCount: 0,
      nextDueSurface: {
        dueAt: "2026-06-03T13:55:25.627Z",
        capability: "linkedin",
        handle: "omalab-main",
        surfaceLabel: "Messaging Inbox",
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: "2026-06-03T07:40:25.627Z",
      nextExpectedRunAt: "2026-06-03T07:55:25.627Z",
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: null,
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Manual-only inbound surfaces:/);
  assert.match(output, /linkedin:omalab-main · Comment Replies: This surface is not yet wired through Exo's autonomous LinkedIn live-capture path\./);
  assert.match(output, /disable: exo inbound sync set user-1 --account account-1 --disable-surface linkedin-comment-replies --json/);
  assert.match(output, /Resolve enabled manual-only inbound surfaces before any rollout change so background retrieval coverage is honest\./);
});

test("formatAgentDoctorReport surfaces stale autonomous inbound retrieval as a rollout blocker", () => {
  const output = formatAgentDoctorReport({
    checkedAt: "2026-06-03T07:55:25.627Z",
    stateDir: "/tmp/exo/.exo",
    queue: {
      dueTaskCount: 2,
      waitingTaskCount: 0,
      blockerCount: 0,
      draftTaskCount: 0,
      browserTaskCount: 2,
      browserTaskKinds: ["send_message"],
    },
    browser: {
      required: true,
      ready: true,
      skipReason: null,
      blockedReasons: [],
      warnings: [],
      taskReadiness: {
        send_message: {
          ready: true,
          blockedReasons: [],
        },
      },
    },
    scheduler: {
      kind: "launchd",
      installed: true,
      loaded: true,
      running: false,
      pid: null,
      state: "not running",
      runs: 2,
      runIntervalSeconds: 900,
      runningForSeconds: null,
      lastExitCode: "0",
      label: "com.williamflanagan.exo.queue-drainer",
      target: "gui/501/com.williamflanagan.exo.queue-drainer",
      installPath: "/Users/tester/Library/LaunchAgents/com.williamflanagan.exo.queue-drainer.plist",
      error: null,
    },
    routine: {
      exists: true,
      path: "/tmp/exo/.exo/run-agent-host.sh",
      sendMode: "verify",
      artifactVersion: "2026-06-03-1",
      expectedArtifactVersion: "2026-06-03-1",
      stale: false,
      reinstallCommand: null,
    },
    rollout: {
      sendMode: "verify",
      dueSendCount: 2,
      verifiedDueSendCount: 2,
      unverifiedDueSendCount: 0,
      allDueSendsVerified: true,
      nextCanaryCandidate: {
        label: "Taras Mykhalyshyn at BillEase",
      },
      nextVerifyCandidate: null,
      verifiedDueSends: [],
      unverifiedDueSends: [],
      recommendedTransition: {
        targetSendMode: "verify",
        ready: false,
        command: "exo inbound sync show user-1 --json",
        summary: "Refresh enabled autonomous inbound retrieval before any rollout change so background truth is healthy.",
      },
    },
    automationWarnings: [],
    automationHealthWarnings: [
      {
        userId: "user-1",
        accountId: "account-1",
        capability: "linkedin",
        handle: "omalab-main",
        surfaceKey: "linkedin-messaging-inbox",
        surfaceLabel: "Messaging Inbox",
        freshnessState: "stale",
        reason: "This enabled background-truth surface is stale and due for refresh.",
        inspectCommand: "exo inbound sync show user-1 --json",
      },
    ],
    automationStatus: {
      enabledAutonomousSurfaceCount: 6,
      dueNowCount: 1,
      freshCount: 5,
      retryBackoffCount: 0,
      nextDueSurface: {
        dueAt: "2026-06-03T13:55:25.627Z",
        capability: "linkedin",
        handle: "omalab-main",
        surfaceLabel: "Sent Invitations",
      },
    },
    hostState: {
      browserBackoff: {
        retrieval: {
          unavailableUntil: null,
          reason: null,
        },
        execution: {
          unavailableUntil: null,
          reason: null,
        },
      },
    },
    cadence: {
      runIntervalSeconds: 900,
      lastStartedAt: "2026-06-03T07:40:25.627Z",
      nextExpectedRunAt: "2026-06-03T07:55:25.627Z",
      overdue: false,
      overdueBySeconds: 0,
    },
    lastPass: null,
    artifacts: {
      preflightPath: "/tmp/exo/.exo/agent-preflight.json",
      hostStatePath: "/tmp/exo/.exo/agent-host-state.json",
      lastPassPath: "/tmp/exo/.exo/agent-last-pass.json",
      logPath: "/tmp/exo/.exo/agent.log",
      launchdStdoutPath: "/tmp/exo/.exo/agent-launchd.out.log",
      launchdStderrPath: "/tmp/exo/.exo/agent-launchd.err.log",
    },
  });

  assert.match(output, /Autonomous inbound retrieval needs refresh:/);
  assert.match(output, /linkedin:omalab-main · Messaging Inbox: This enabled background-truth surface is stale and due for refresh\./);
  assert.match(output, /inspect: exo inbound sync show user-1 --json/);
  assert.match(output, /Refresh enabled autonomous inbound retrieval before any rollout change so background truth is healthy\./);
  assert.match(output, /Autonomous retrieval: 5\/6 enabled surfaces currently fresh, 1 due now\./);
  assert.match(output, /Next autonomous retrieval due around 2026-06-03T13:55:25.627Z for linkedin:omalab-main · Sent Invitations\./);
});

test("agent doctor --json returns the worker diagnosis contract", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-agent-doctor-"));

  try {
    const report = JSON.parse(
      execFileSync("node", [cliPath, "agent", "doctor", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir },
        encoding: "utf8",
      })
    );

    assert.equal(typeof report.checkedAt, "string");
    assert.equal(report.stateDir, tempDir);
    assert.equal(report.queue.dueTaskCount, 0);
    assert.equal(report.browser.required, false);
    assert.equal(report.browser.skipReason, "no_browser_tasks_due");
    assert.equal(typeof report.scheduler.kind, "string");
    assert.equal(typeof report.routine.exists, "boolean");
    assert.equal(typeof report.rollout.dueSendCount, "number");
    assert.equal(Array.isArray(report.rollout.verifiedDueSends), true);
    assert.equal(typeof report.rollout.recommendedTransition.ready, "boolean");
    assert.equal(Array.isArray(report.automationHealthWarnings), true);
    assert.equal(typeof report.automationStatus.enabledAutonomousSurfaceCount, "number");
    assert.equal(typeof report.cadence.overdue, "boolean");
    assert.equal(report.artifacts.preflightPath, path.join(tempDir, "agent-preflight.json"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
