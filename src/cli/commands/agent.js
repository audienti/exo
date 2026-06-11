#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { buildAgentQueue } from "../../core/build-agent-queue.js";
import { buildSendHandoff } from "../../core/build-send-handoff.js";
import { buildStalePacketReviewWarnings } from "../../core/build-stale-packet-review-warnings.js";
import { acceptMotionProspectPacket, returnMotionProspectPacket } from "../../core/review-motion-prospect-packet.js";
import { acceptMotionTargetAccountPacket, returnMotionTargetAccountPacket } from "../../core/review-target-account-packet.js";
import { buildInboundAutomationHealthWarnings, buildInboundAutomationStatus, buildInboundAutomationWarnings } from "../../core/user-inbound-sync.js";
import {
  findCompanyById,
  findMotionById,
  listAgentQueueProspectBranches,
  listBrowserProfiles,
  listCompanies,
  listInboundCues,
  listInboundObservations,
  listMotions,
  listUsers,
} from "../../db/database.js";
import { getHomeStateDir } from "../../db/paths.js";
import { createTaskVerificationFingerprint, getCanaryCooldown, getRecentTaskVerification, getSendCircuitBreaker, listActiveBrowserBackoffs, pruneExpiredBrowserBackoffs } from "../../lib/agent-host-state.js";
import { releaseAgentRunLock, tryAcquireAgentRunLock } from "../../lib/agent-run-lock.js";
import { AGENT_EXECUTION_LANES, normalizeAgentExecutionLane } from "../../lib/agent-task-lanes.js";
import { mergeLanePassSummaries, writeAgentPassSummary } from "../../lib/agent-pass-summary.js";
import { buildPreflightSummary } from "../../lib/agent-preflight.js";
import { buildLaunchAgentLabel, buildRoutinePlan, ROUTINE_ARTIFACT_VERSION } from "../../lib/agent-routine.js";
import { buildMotionPacketSummary } from "../../lib/motion-packets.js";
import { runCliRepairableContract } from "../repairable-contracts.js";

/**
 * @param {import("commander").Command} program
 */
export function registerAgent(program) {
  const agent = program
    .command("agent")
    .description("The agent's autonomous execution loop — drain the queue of no-input work.")
    .addHelpText(
      "after",
      `
Autonomous loop:
  exo agent queue                 # what the agent can do right now without operator input
  exo agent queue --json          # machine-readable, for an agent loop to drain
  exo agent doctor                # why native autonomous work is or is not runnable here
  exo agent doctor --json         # machine-readable host/runtime diagnosis for the worker

How the loop works (runs in EITHER Codex or Claude — the contract is runtime-agnostic):
  1. exo agent run                             → run one real host-worker pass through the same path the scheduler uses
  2. exo agent send <co> --motion <m> --prospect <p>  → the governed send contract
  3. perform the send with native connector tools (Codex or Claude)
  4. run the task's "writeback" command         → records the Sent touch, advances cadence
  5. repeat

Only no-input work appears here. That includes inbound truth refresh, governed
research packets, send-ready drafts, and mechanical cleanup like rejecting
inbound invites or withdrawing stale outbound invites. Nothing in this queue
needs operator input.
`,
    );

  agent
    .command("queue")
    .description("List no-operator-input work the agent can execute now.")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options) => {
      const queueInput = buildAgentQueueInput();
      const { contract: queue } = await runCliRepairableContract({
        contractKind: "agent_queue",
        build: () => buildAgentQueue(queueInput),
        normalizedInputs: queueInput
      });
      if (options.json) {
        console.log(JSON.stringify(queue, null, 2));
        return;
      }
      if (!queue.count && !(queue.blockers ?? []).length) {
        console.log("Agent queue is empty. No retrieval, research, send-ready, or cleanup work is waiting to run.");
        return;
      }
      if (queue.count) {
        console.log(`${queue.count} task(s) the agent can run now:\n`);
        for (const task of queue.tasks) {
          if (task.kind === "run_inbound_sync") {
            console.log(`• run_inbound_sync → ${task.companyName}`);
            console.log(`    why:       ${task.whyItMatters ?? "inbound truth needs refresh"}`);
            console.log(`    mode:      ${task.mode}`);
            console.log(`    due:       ${task.dueAt ?? "now"}`);
            console.log(`    surfaces:  ${(task.surfaceLabels ?? []).join(", ") || task.surface}`);
            console.log(`    contract:  ${task.contractCommand}`);
            console.log(`    apply:     ${task.applyCommand}`);
          } else if (task.kind === "company_discovery") {
            console.log(`• company_discovery → ${task.motionName}`);
            console.log(`    why:       ${task.whyItMatters ?? "motion inventory needs more companies"}`);
            console.log(`    due:       ${task.dueAt ?? "now"}`);
            console.log(`    minimum:   ${task.targetCompanyCount ?? 1} compan${task.targetCompanyCount === 1 ? "y" : "ies"}`);
            console.log(`    brief:     ${task.briefCommand}`);
          } else if (task.kind === "company_research") {
            console.log(`• company_research → ${task.companyName}`);
            console.log(`    why:       ${task.whyItMatters ?? "company research is due"}`);
            console.log(`    due:       ${task.dueAt ?? "now"}`);
            console.log(`    claim:     ${task.claimCommand}`);
            console.log(`    brief:     ${task.briefCommand}`);
          } else if (task.kind === "prospect_selection") {
            console.log(`• prospect_selection → ${task.companyName}`);
            console.log(`    why:       ${task.whyItMatters ?? "prospect selection is due"}`);
            console.log(`    due:       ${task.dueAt ?? "now"}`);
            console.log(`    claim:     ${task.claimCommand}`);
            console.log(`    brief:     ${task.briefCommand}`);
          } else if (task.kind === "prospect_research") {
            console.log(`• prospect_research → ${task.prospectName} · ${task.companyName}`);
            console.log(`    why:       ${task.whyItMatters ?? "prospect research is due"}`);
            console.log(`    due:       ${task.dueAt ?? "now"}`);
            console.log(`    claim:     ${task.claimCommand}`);
            console.log(`    brief:     ${task.briefCommand}`);
          } else if (task.kind === "write_draft") {
            console.log(`• write_draft → ${task.prospectName} · ${task.companyName} (${task.surface})`);
            console.log(`    why:       ${task.reason === "no_draft" ? "no draft yet for this surface" : task.reason}`);
            console.log(`    due:       ${task.dueAt ?? "now"}`);
            console.log(`    brief:     ${task.briefCommand}`);
            console.log(`    on write:  ${task.writeback}`);
          } else if (task.kind === "reject_connection_request") {
            console.log(`• reject_connection_request → ${task.prospectName}${task.companyName ? ` · ${task.companyName}` : ""}`);
            console.log(`    do:        decline this inbound invite on LinkedIn`);
            console.log(`    due:       ${task.dueAt ?? "now"}`);
            if (task.recipientUrl) console.log(`    invite:    ${task.recipientUrl}`);
            console.log(`    on reject: ${task.writeback}`);
          } else if (task.kind === "withdraw_connection") {
            console.log(`• withdraw_connection → ${task.prospectName}${task.companyName ? ` · ${task.companyName}` : ""}`);
            console.log(`    do:        withdraw this stale outbound invite on LinkedIn`);
            console.log(`    due:       ${task.dueAt ?? "now"}`);
            if (task.recipientUrl) console.log(`    invite:    ${task.recipientUrl}`);
            console.log(`    on done:   ${task.writeback}`);
          } else {
            console.log(`• ${task.action} → ${task.prospectName} · ${task.companyName} (${task.surface})`);
            console.log(`    due:       ${task.dueAt ?? "now"}`);
            if (task.recipientUrl) console.log(`    recipient: ${task.recipientUrl}`);
            if (task.body) console.log(`    message:   ${truncate(task.body, 100)}`);
            console.log(`    on send:   ${task.writeback}`);
          }
          console.log("");
        }
      }
      if (queue.waitingCount) {
        console.log(`${queue.waitingCount} queued task(s) are not due yet:\n`);
        for (const task of queue.waiting) {
          const subject = `${task.prospectName}${task.companyName ? ` · ${task.companyName}` : ""}`;
          console.log(`• ${task.kind} → ${subject}${task.surface ? ` (${task.surface})` : ""}`);
          console.log(`    due:       ${task.dueAt ?? "not scheduled yet"}`);
          console.log(`    waiting:   ${humanizeWaitingReason(task.waitingReason)}`);
          if (task.kind === "run_inbound_sync") console.log(`    contract:  ${task.contractCommand}`);
          if (task.kind === "company_discovery" || task.kind === "company_research" || task.kind === "prospect_selection" || task.kind === "prospect_research") {
            console.log(`    brief:     ${task.briefCommand}`);
          }
          if (task.kind === "write_draft") console.log(`    brief:     ${task.briefCommand}`);
          if (task.kind === "send_message" && task.body) console.log(`    message:   ${truncate(task.body, 100)}`);
          console.log("");
        }
      }
      const blockers = queue.blockers ?? [];
      if (blockers.length) {
        console.log(`${blockers.length} blocker(s) — send-ready drafts that need operator re-review:\n`);
        for (const blocker of blockers) {
          console.log(`• ${blocker.prospectName} · ${blocker.companyName}`);
          console.log(`    queued:    ${blocker.sendReadySurface}`);
          console.log(`    now:       ${blocker.nextSurface ?? "no writeable surface"}`);
          console.log(`    resolve:   ${blocker.resolveHint}`);
          console.log("");
        }
      }
    });

  agent
    .command("draft-queue")
    .description("Compatibility view over the unified agent queue: draft-writing work only.")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const queue = loadAgentQueue();
      const dueDrafts = queue.tasks.filter((task) => task.kind === "write_draft");
      const waitingDrafts = queue.waiting.filter((task) => task.kind === "write_draft");
      if (options.json) {
        console.log(JSON.stringify({
          count: dueDrafts.length + waitingDrafts.length,
          dueCount: dueDrafts.length,
          waitingCount: waitingDrafts.length,
          tasks: [...dueDrafts, ...waitingDrafts],
        }, null, 2));
        return;
      }
      if (!dueDrafts.length && !waitingDrafts.length) {
        console.log("No draft-writing work is queued right now.");
        return;
      }
      if (dueDrafts.length) {
        console.log(`${dueDrafts.length} draft task(s) are due now:\n`);
      }
      for (const task of dueDrafts) {
        console.log(`• ${task.prospectName} · ${task.companyName}`);
        console.log(`    surface: ${task.surface}`);
        console.log(`    due:     ${task.dueAt ?? "now"}`);
        console.log(`    brief:   ${task.briefCommand}`);
        console.log(`    write:   ${task.writeback}`);
        console.log("");
      }
      if (waitingDrafts.length) {
        console.log(`${waitingDrafts.length} draft task(s) are scheduled but not due yet:\n`);
      }
      for (const task of waitingDrafts) {
        console.log(`• ${task.prospectName} · ${task.companyName}`);
        console.log(`    surface:  ${task.surface}`);
        console.log(`    due:      ${task.dueAt ?? "not scheduled yet"}`);
        console.log(`    waiting:  ${humanizeWaitingReason(task.waitingReason)}`);
        console.log(`    brief:    ${task.briefCommand}`);
        console.log("");
      }
    });

  agent
    .command("doctor")
    .description("Diagnose whether the background worker can actually run the native autonomous queue on this machine.")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const report = buildAgentDoctorReport();
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(formatAgentDoctorReport(report));
    });

  const packets = agent
    .command("packets")
    .description("Review packet submissions that require operator input.");

  packets
    .command("review")
    .description("List packets submitted for operator review.")
    .option("--motion <motion-id>", "Filter to one motion")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      try {
        const result = buildPacketReviewQueue(options.motion ?? null);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        renderPacketReviewQueue(result);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  packets
    .command("accept <motion-id>")
    .description("Accept a submitted packet proposal without changing its stored outcome.")
    .requiredOption("--packet <packet-id>", "Packet identifier from exo agent packets review")
    .option("--reviewer <label>", "Reviewer label")
    .option("--notes <notes>", "Acceptance notes")
    .option("--json", "Emit machine-readable JSON")
    .action((motionId, options) => {
      try {
        const result = resolvePacketReviewDecision(motionId, options.packet, {
          action: "accepted",
          reviewer: options.reviewer ?? null,
          notes: options.notes ?? null
        });
        emitPacketReviewDecision(result, options.json);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  packets
    .command("amend <motion-id>")
    .description("Accept a submitted packet with an amended outcome.")
    .requiredOption("--packet <packet-id>", "Packet identifier from exo agent packets review")
    .requiredOption("--outcome <outcome>", "Outcome: advance, nurture, not_a_fit, no_longer_target, or exhausted")
    .requiredOption("--reason <reason>", "Reason for the amended decision")
    .option("--next-status <status>", "Optional queue status override: researched, suppressed, or exhausted")
    .option("--reviewer <label>", "Reviewer label")
    .option("--json", "Emit machine-readable JSON")
    .action((motionId, options) => {
      try {
        const result = resolvePacketReviewDecision(motionId, options.packet, {
          action: "amended",
          outcome: normalizePacketReviewOutcome(options.outcome),
          nextStatus: normalizePacketReviewNextStatus(options.nextStatus),
          reason: normalizeRequiredPacketText(options.reason, "Amendment reason"),
          reviewer: options.reviewer ?? null
        });
        emitPacketReviewDecision(result, options.json);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  packets
    .command("return <motion-id>")
    .description("Return a submitted packet to worker redo with review notes.")
    .requiredOption("--packet <packet-id>", "Packet identifier from exo agent packets review")
    .requiredOption("--notes <notes>", "Return notes for the next worker")
    .option("--reviewer <label>", "Reviewer label")
    .option("--json", "Emit machine-readable JSON")
    .action((motionId, options) => {
      try {
        const result = resolvePacketReviewDecision(motionId, options.packet, {
          action: "returned",
          notes: normalizeRequiredPacketText(options.notes, "Return notes"),
          reviewer: options.reviewer ?? null
        });
        emitPacketReviewDecision(result, options.json);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  agent
    .command("send <company-id>")
    .description("Emit the governed send handoff for a send-ready draft on its real channel (the runtime sends it, then runs the write-back).")
    .requiredOption("--motion <motion-id>", "Motion the prospect is targeted in")
    .requiredOption("--prospect <prospect-id>", "Prospect to message")
    .option("--surface <surface>", "Which send-ready draft surface to send (defaults to the single send-ready draft)")
    .option("--runtime <runtime>", "Runtime driving this send: codex | claude (the contract is runtime-agnostic)", "any")
    .option("--json", "Emit machine-readable JSON")
    .action((companyId, options) => {
      const motion = findMotionById(options.motion);
      if (!motion) throw new Error(`Motion not found: ${options.motion}`);
      const company = findCompanyById(companyId);
      if (!company) throw new Error(`Company not found: ${companyId}`);

      const handoff = buildSendHandoff(company, motion, listBrowserProfiles(), listUsers(), {
        prospectId: options.prospect,
        surface: options.surface ?? null,
        runtime: options.runtime ?? "codex",
      });
      if (options.json) {
        console.log(JSON.stringify(handoff, null, 2));
        return;
      }
      if (handoff.status === "blocked") {
        console.log(`Cannot send: ${handoff.reason}`);
        return;
      }
      console.log(`Send ${handoff.action} → ${handoff.recipient.name}`);
      console.log(`  as:        ${handoff.sender.label}${handoff.sender.account ? ` (${handoff.sender.account})` : ""}`);
      console.log(`  recipient: ${formatSendRecipient(handoff)}`);
      console.log(`  message:   ${handoff.message}`);
      console.log(`  steps:`);
      for (const step of handoff.instructions) console.log(`    - ${step}`);
    });

  agent
    .command("run")
    .description("Run one real host-worker pass (or loop) through the same path the scheduled background runner uses.")
    .option("--loop", "Keep running, re-checking every --interval seconds (the always-on agent)")
    .option("--interval <seconds>", "Seconds between passes in --loop mode", "30")
    .option("--send-mode <mode>", "Override the worker send mode for this manual pass: verify | canary | live")
    .option("--max-tasks <count>", "Override the worker task cap for this manual pass")
    .option("--force-retrieval", "Include waiting autonomous retrieval tasks in this pass even when they are not due yet")
    .option("--ignore-browser-backoff", "Ignore stored browser backoff for this manual pass")
    .option("--json", "Emit machine-readable host-pass JSON per pass")
    .action(async (options) => {
      const intervalMs = Math.max(5, Number(options.interval) || 30) * 1000;
      while (true) {
        await runAgentWorkerPass({
          json: Boolean(options.json),
          sendMode: options.sendMode ?? null,
          maxTasks: options.maxTasks ?? null,
          forceRetrieval: Boolean(options.forceRetrieval),
          ignoreBrowserBackoff: Boolean(options.ignoreBrowserBackoff),
        });
        if (!options.loop) {
          return;
        }
        await sleep(intervalMs);
      }
    });

  agent
    .command("install-routine")
    .description("Register the scheduled agent that drains the queue on a cadence (the deploy brick that makes the loop self-run).")
    .option("--runtime <runtime>", "Agent runtime woken on the schedule: codex | claude", "codex")
    .option("--interval <interval>", "How often to run a pass, e.g. 15m, 1h", "15m")
    .option("--scheduler <scheduler>", "Schedule transport: auto | launchd | cron", "auto")
    .option("--send-mode <mode>", "Browser send mode for the scheduled worker: verify | canary | live")
    .option("--install", "Install the resolved scheduler now")
    .option("--install-cron", "Legacy alias for immediate install when the resolved scheduler is cron")
    .option("--write-artifacts", "Write routine artifacts locally without installing the scheduler")
    .option("--force", "Bypass rollout readiness guards when installing canary or live mode")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const repo = process.cwd();
      const stateDir = getHomeStateDir();
      const runtime = options.runtime === "claude" ? "claude" : "codex";
      const shouldInstall = Boolean(options.install || options.installCron);
      const existingRoutine = inspectAgentRoutineState(stateDir);
      const requestedSendMode = normalizeRoutineSendMode(options.sendMode, existingRoutine?.sendMode ?? null);
      const plan = buildRoutinePlan({
        repo,
        stateDir,
        runtime,
        interval: options.interval,
        scheduler: options.scheduler ?? "auto",
        sendMode: requestedSendMode,
      });
      const stateDbPath = path.join(stateDir, "exo.db");
      const hasExistingStateStore = fs.existsSync(stateDbPath);
      const users = hasExistingStateStore ? listUsers() : [];
      const automationWarnings = hasExistingStateStore ? buildInboundAutomationWarnings(users) : [];
      const automationHealthWarnings = hasExistingStateStore ? buildInboundAutomationHealthWarnings(users) : [];
      const automationStatus = hasExistingStateStore ? buildInboundAutomationStatus(users) : {
        enabledAutonomousSurfaceCount: 0,
        dueNowCount: 0,
        freshCount: 0,
        retryBackoffCount: 0,
        nextDueSurface: null,
      };
      const installReadiness = buildRoutineInstallReadiness({
        requestedSendMode: plan.sendMode,
        currentInstalledSendMode: existingRoutine?.sendMode ?? null,
        intervalLabel: plan.interval.label,
        queue: hasExistingStateStore ? loadAgentQueue() : { tasks: [] },
        hostState: pruneExpiredBrowserBackoffs(readJsonIfExists(path.join(stateDir, "agent-host-state.json"))),
        automationWarnings,
        automationHealthWarnings,
      });
      const requestedArtifactWrite = Boolean(options.writeArtifacts || shouldInstall);
      const shouldWriteArtifacts = requestedArtifactWrite && (installReadiness.ready || options.force);
      let artifactsWritten = false;
      const writtenArtifactPaths = new Set();

      if (shouldWriteArtifacts) {
        const artifactsToWrite = shouldInstall
          ? plan.artifacts
          : plan.artifacts.filter((artifact) => artifact.path !== plan.launchAgent?.launchdEntryPath);
        fs.mkdirSync(stateDir, { recursive: true });
        for (const artifact of artifactsToWrite) {
          fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
          fs.writeFileSync(artifact.path, artifact.content, "utf8");
          if (artifact.mode != null) fs.chmodSync(artifact.path, artifact.mode);
          writtenArtifactPaths.add(artifact.path);
        }
        artifactsWritten = true;
      }

      if (!installReadiness.ready) {
        if (options.json) {
          const installBlocked = shouldInstall && !options.force;
          console.log(JSON.stringify({
            runtime: plan.runtime,
            scheduler: plan.scheduler,
            sendMode: plan.sendMode,
            interval: plan.interval.label,
            installed: false,
            installAttempted: false,
            artifactsWritten,
            installError: installBlocked
              ? "Refusing to install this send mode while rollout readiness is blocked."
              : null,
            routinePath: plan.routinePath,
            logPath: plan.logPath,
            cronLine: plan.cronLine,
            hostRunnerPath: plan.hostRunnerPath,
            launchAgent: plan.launchAgent,
            rolloutReadiness: installReadiness,
            automationWarnings,
            automationHealthWarnings,
            automationStatus,
          }, null, 2));
          if (installBlocked) process.exitCode = 1;
          return;
        }
        console.log(`Rollout readiness: blocked. ${installReadiness.reason}`);
        if (installReadiness.command) console.log(`Next step: ${installReadiness.command}`);
        if (shouldInstall && !options.force) {
          console.log("Did not write or install routine artifacts because this rollout mode is not ready.");
          console.error("error: Refusing to install this send mode while rollout readiness is blocked. Re-run with --force only if you intend to bypass the staged rollout guard.");
          process.exitCode = 1;
          return;
        }
        if (shouldInstall && options.force) {
          console.log("Proceeding because --force was set.");
        }
        console.log("");
      }

      if (options.json) {
        let installed = false;
        let installAttempted = false;
        let installError = null;

        let removedForeignAgents = [];
        if (shouldInstall) {
          installAttempted = true;
          if (plan.scheduler === "launchd" && plan.launchAgent) {
            try {
              const installResult = installLaunchAgent(plan.launchAgent, { canonicalLabel: plan.label, stateDir });
              removedForeignAgents = installResult.removedForeignAgents;
              installed = true;
            } catch (error) {
              installError = error instanceof Error ? error.message : String(error);
            }
          } else if (plan.cronLine) {
            try {
              let current = "";
              try { current = execFileSync("crontab", ["-l"], { encoding: "utf8" }); } catch { current = ""; }
              if (!current.includes(plan.routinePath)) {
                execFileSync("crontab", ["-"], { input: `${current.trimEnd()}\n${plan.cronLine}\n`.replace(/^\n/, "") });
              }
              installed = true;
            } catch (error) {
              installError = error instanceof Error ? error.message : String(error);
            }
          }
        }

        console.log(JSON.stringify({
          runtime: plan.runtime,
          scheduler: plan.scheduler,
          sendMode: plan.sendMode,
          interval: plan.interval.label,
          installed,
          installAttempted,
          artifactsWritten,
          installError,
          removedForeignAgents: removedForeignAgents.map((agent) => agent.label),
          routinePath: plan.routinePath,
          logPath: plan.logPath,
          cronLine: plan.cronLine,
          hostRunnerPath: plan.hostRunnerPath,
          launchAgent: plan.launchAgent,
          rolloutReadiness: installReadiness,
          automationWarnings,
          automationHealthWarnings,
          automationStatus,
        }, null, 2));
        return;
      }

      if (shouldWriteArtifacts) {
        console.log(`Wrote the agent routine → ${plan.routinePath}`);
        if (plan.scheduler === "launchd" && plan.hostRunnerPath) {
          console.log(`Wrote the macOS host runner → ${plan.hostRunnerPath}`);
        }
        if (plan.scheduler === "launchd" && plan.launchAgent) {
          console.log(`Wrote the LaunchAgent source → ${plan.launchAgent.sourcePath}`);
          if (plan.launchAgent.launchdEntryPath && writtenArtifactPaths.has(plan.launchAgent.launchdEntryPath)) {
            console.log(`Wrote the launchd entry point → ${plan.launchAgent.launchdEntryPath} (outside macOS protected folders)`);
          }
          if (shouldInstall) {
            console.log(`\nThe scheduled agent (${plan.runtime}, every ${plan.interval.label}, send mode ${plan.sendMode}) now runs through macOS launchd:`);
            console.log(`  installed plist: ${plan.launchAgent.installPath}`);
            console.log(`  target:         ${plan.launchAgent.target}`);
          } else {
            console.log(`\nPrepared local launchd artifacts for the scheduled agent (${plan.runtime}, every ${plan.interval.label}, send mode ${plan.sendMode}).`);
            console.log(`  install plist: ${plan.launchAgent.installPath}`);
            console.log(`  target:        ${plan.launchAgent.target}`);
          }
        } else if (plan.cronLine) {
          console.log(`\nThe scheduled agent (${plan.runtime}, every ${plan.interval.label}, send mode ${plan.sendMode}) drains the queue each pass:`);
          console.log(`  ${plan.cronLine}`);
        }
        console.log("");
      } else {
        console.log(`Planned scheduled agent (${plan.runtime}, every ${plan.interval.label}, send mode ${plan.sendMode}) was not written.`);
        if (plan.scheduler === "launchd" && plan.launchAgent) {
          console.log(`  would install plist: ${plan.launchAgent.installPath}`);
          console.log(`  would target:        ${plan.launchAgent.target}`);
        } else if (plan.cronLine) {
          console.log(`  would install cron: ${plan.cronLine}`);
        }
        if (!shouldInstall) {
          console.log("  re-run with --write-artifacts to generate the local runner files without installing.");
        }
        console.log("");
      }

      if (shouldInstall) {
        if (plan.scheduler === "launchd" && plan.launchAgent) {
          try {
            const installResult = installLaunchAgent(plan.launchAgent, { canonicalLabel: plan.label, stateDir });
            console.log("✓ Installed into your user LaunchAgents and bootstrapped with launchctl.");
            for (const removedAgent of installResult.removedForeignAgents) {
              console.log(`✓ Removed stray exo scheduler ${removedAgent.label} (it pointed at this workspace).`);
            }
          } catch (error) {
            console.log(`Could not install the LaunchAgent automatically (${error instanceof Error ? error.message : error}).`);
            if (plan.launchAgent.bootstrapCommand) console.log(`Bootstrap manually: ${plan.launchAgent.bootstrapCommand}`);
          }
        } else if (plan.cronLine) {
          try {
            let current = "";
            try { current = execFileSync("crontab", ["-l"], { encoding: "utf8" }); } catch { current = ""; }
            if (current.includes(plan.routinePath)) {
              console.log("Already installed in crontab (a line referencing the routine exists). Skipped.");
            } else {
              execFileSync("crontab", ["-"], { input: `${current.trimEnd()}\n${plan.cronLine}\n`.replace(/^\n/, "") });
              console.log("✓ Installed into your user crontab.");
            }
          } catch (error) {
            console.log(`Could not write crontab automatically (${error instanceof Error ? error.message : error}). Add the line above manually.`);
          }
        }
      } else if (plan.scheduler === "launchd" && plan.launchAgent) {
        console.log("Not installed (dry run). Re-run with --install to load the LaunchAgent now.");
        if (plan.launchAgent.bootstrapCommand) console.log(`Or run: ${plan.launchAgent.bootstrapCommand}`);
        if (plan.launchAgent.kickstartCommand) console.log(`Then verify with: ${plan.launchAgent.printCommand}`);
      } else {
        console.log("Not installed (dry run). Re-run with --install or --install-cron to add it to your crontab,");
        console.log(`or paste the routine in ${plan.routinePath} into your ${plan.runtime} automation on a ${plan.interval.label} cadence.`);
      }
      console.log("\nPrerequisites for the scheduled agent to actually send:");
      if (plan.scheduler === "launchd") {
        console.log("  - the Codex desktop app installed at /Applications/Codex.app");
        console.log("  - the governed connector or MCP path callable in that detached Codex session");
      } else {
        console.log(`  - the '${plan.runtime}' CLI installed and authenticated`);
      }
      if (plan.sendMode === "verify") {
        console.log("  - verification-only send mode is enabled, so send tasks will stop at ready_to_send and will not write back");
      } else if (plan.sendMode === "canary") {
        console.log("  - canary send mode is enabled, so each pass will send at most one previously verified send, or prove one new send-ready task");
      }
      console.log("  - the assigned LinkedIn account mapped through its governed connector path");
      console.log("  - routine outbound drafts must land in send-ready state so the queue can drain them");
    });
}

/**
 * @param {{
 *   json?: boolean,
 *   sendMode?: string | null,
 *   maxTasks?: string | number | null,
 *   forceRetrieval?: boolean,
 *   ignoreBrowserBackoff?: boolean,
 *   quiet?: boolean,
 * }} [options]
 */
export async function runAgentWorkerPass(options = {}) {
  const stateDir = getHomeStateDir();
  const existingRoutine = inspectAgentRoutineState(stateDir);
  const resolvedSendMode = normalizeRoutineSendMode(options.sendMode, existingRoutine?.sendMode ?? "verify");
  const runnerScript = process.env.EXO_AGENT_RUNNER_SCRIPT || path.join(process.cwd(), "scripts", "run-agent-host-pass.js");
  const runnerNode = process.env.EXO_AGENT_RUNNER_NODE || process.execPath;
  let runLock = tryAcquireAgentRunLock({ stateDir });
  if (!runLock.acquired) {
    const queue = loadAgentQueue();
    const summary = {
      status: "noop",
      reason: `Another agent pass is already active${runLock.pid ? ` (pid ${runLock.pid})` : ""}.`,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      results: [],
      finalQueueCounts: {
        dueTaskCount: queue.tasks.length,
        waitingTaskCount: queue.waiting.length,
        blockerCount: (queue.blockers ?? []).length,
      },
      packetReviewWarnings: buildStalePacketReviewWarnings(listMotions(), listCompanies()),
    };
    if (!options.quiet) {
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(formatAgentWorkerPassSummary(summary, {
          sendMode: resolvedSendMode,
          forceRetrieval: Boolean(options.forceRetrieval),
        }));
      }
    }
    return summary;
  }
  const env = {
    ...process.env,
    EXO_STATE_DIR: stateDir,
    EXO_AGENT_SEND_MODE: resolvedSendMode,
  };

  if (options.maxTasks != null && String(options.maxTasks).trim().length) {
    env.EXO_AGENT_MAX_TASKS = String(options.maxTasks).trim();
  }
  if (options.forceRetrieval) {
    env.EXO_AGENT_FORCE_RETRIEVAL = "1";
  } else {
    delete env.EXO_AGENT_FORCE_RETRIEVAL;
  }
  if (options.ignoreBrowserBackoff) {
    env.EXO_AGENT_IGNORE_BROWSER_BACKOFF = "1";
  } else {
    delete env.EXO_AGENT_IGNORE_BROWSER_BACKOFF;
  }

  try {
    // Run one host-pass worker per execution lane concurrently: the transport
    // lane grinds through connector-bound work (sync slices, sends, invite
    // cleanup) while the research lane drains native compute work. Setting
    // EXO_AGENT_LANE narrows execution to that single lane.
    const pinnedLane = normalizeAgentExecutionLane(env.EXO_AGENT_LANE);
    const lanes = pinnedLane ? [pinnedLane] : [...AGENT_EXECUTION_LANES];
    const lanePasses = lanes.map((lane) =>
      runWorkerLanePass({ lane, runnerNode, runnerScript, env }));
    releaseAgentRunLock(runLock);
    runLock = null;
    const laneSummaries = await Promise.all(lanePasses);
    const summary = {
      ...mergeLanePassSummaries(laneSummaries),
      packetReviewWarnings: buildStalePacketReviewWarnings(listMotions(), listCompanies()),
    };

    // Each lane runner writes its own agent-last-pass.<lane>.json; the merged
    // view keeps the legacy whole-host summary file current for its readers.
    writeAgentPassSummary({ stateDir, summary });

    if (!options.quiet) {
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(formatAgentWorkerPassSummary(summary, {
          sendMode: resolvedSendMode,
          forceRetrieval: Boolean(options.forceRetrieval),
        }));
      }
    }
    return summary;
  } finally {
    if (runLock) {
      releaseAgentRunLock(runLock);
    }
  }
}

/**
 * Run one host-pass worker for a single execution lane. The child owns the
 * lane lock and reports a no-op summary when held; runner failures still must
 * not take down the sibling lane mid-flight.
 *
 * @param {{
 *   lane: string,
 *   runnerNode: string,
 *   runnerScript: string,
 *   env: Record<string, string | undefined>,
 * }} input
 * @returns {Promise<any>}
 */
async function runWorkerLanePass({ lane, runnerNode, runnerScript, env }) {
  try {
    const raw = await new Promise((resolve, reject) => {
      execFile(runnerNode, [runnerScript], {
        cwd: process.cwd(),
        env: { ...env, EXO_AGENT_LANE: lane },
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      }, (error, stdout) => {
        if (error) {
          reject(new Error(`Host worker ${lane} lane pass failed.\n${formatExecFailure(error)}`));
          return;
        }
        resolve(stdout);
      });
    });

    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch (error) {
      throw new Error(`Host worker ${lane} lane pass returned invalid JSON.\n${error instanceof Error ? error.message : String(error)}\n\nRaw output:\n${raw}`);
    }
    return { ...parsed, lane };
  } catch (error) {
    const now = new Date().toISOString();
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      startedAt: now,
      endedAt: now,
      lane,
      results: [],
    };
  }
}

/**
 * @param {unknown} error
 */
function formatExecFailure(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const stdout = typeof /** @type {any} */ (error).stdout === "string" ? /** @type {any} */ (error).stdout.trim() : "";
  const stderr = typeof /** @type {any} */ (error).stderr === "string" ? /** @type {any} */ (error).stderr.trim() : "";
  return [
    error.message,
    stdout ? `stdout:\n${stdout}` : null,
    stderr ? `stderr:\n${stderr}` : null,
  ].filter(Boolean).join("\n\n");
}

/**
 * @param {any} summary
 * @param {{ sendMode?: string | null, forceRetrieval?: boolean }} [options]
 */
function formatAgentWorkerPassSummary(summary, options = {}) {
  const lines = [];
  const queueCounts = summary?.finalQueueCounts ?? {};
  const status = summary?.status ?? "unknown";
  const reason = summary?.reason ?? null;
  const resultCount = Array.isArray(summary?.results) ? summary.results.length : 0;
  const mode = options.sendMode ?? "verify";

  if (status === "noop") {
    lines.push(`No-op host pass in ${mode} mode.${reason ? ` ${reason}` : ""}`);
  } else {
    lines.push(`Host pass ${status}.${reason ? ` ${reason}` : ""}`);
  }
  if (summary?.startedAt || summary?.endedAt) {
    lines.push(`Window: ${summary?.startedAt ?? "unknown"} → ${summary?.endedAt ?? "unknown"}`);
  }
  if (Array.isArray(summary?.lanes) && summary.lanes.length > 1) {
    lines.push(`Lanes: ${summary.lanes.map((lane) => `${lane?.lane ?? "?"} ${lane?.status ?? "unknown"}`).join(", ")}`);
  }
  if (options.forceRetrieval) {
    lines.push("Forced retrieval was enabled for this manual pass.");
  }
  lines.push(`Results: ${resultCount}. Queue now ${queueCounts.dueTaskCount ?? 0} due, ${queueCounts.waitingTaskCount ?? 0} waiting, ${queueCounts.blockerCount ?? 0} blockers.`);

  if (resultCount > 0) {
    lines.push("");
    lines.push("Task results:");
    for (const result of summary.results) {
      lines.push(`- ${formatAgentWorkerTaskResult(result)}`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {any} result
 */
function formatAgentWorkerTaskResult(result) {
  const subject = [result?.kind, result?.status].filter(Boolean).join(" ");
  const detail = result?.detail ?? {};
  if (detail.verificationOnly === true && detail.sendStatus) {
    return `${subject}: ${detail.sendStatus}`;
  }
  if (typeof detail.reason === "string" && detail.reason.trim().length) {
    return `${subject}: ${detail.reason.trim()}`;
  }
  if (typeof detail.transport === "string" && detail.transport.trim().length) {
    return `${subject}: transport=${detail.transport.trim()}`;
  }
  if (typeof detail.bodyPreview === "string" && detail.bodyPreview.trim().length) {
    return `${subject}: ${truncate(detail.bodyPreview, 120)}`;
  }
  return subject;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAgentQueueInput() {
  const stateDir = getHomeStateDir();
  const hostState = pruneExpiredBrowserBackoffs(readJsonIfExists(path.join(stateDir, "agent-host-state.json")));
  return {
    motions: listMotions(),
    companies: listCompanies(),
    profiles: listBrowserProfiles(),
    users: listUsers(),
    observations: listInboundObservations(),
    cues: listInboundCues(),
    prospectBranches: listAgentQueueProspectBranches(),
    hostState,
  };
}

function loadAgentQueue() {
  return buildAgentQueue(buildAgentQueueInput());
}

function buildAgentDoctorReport() {
  const stateDir = getHomeStateDir();
  const queueModel = loadAgentQueue();
  const hostState = pruneExpiredBrowserBackoffs(readJsonIfExists(path.join(stateDir, "agent-host-state.json")));
  const preflight = buildPreflightSummary({
    stateDir,
    codexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
  });
  const scheduler = inspectAgentSchedulerState(stateDir);
  const routine = inspectAgentRoutineState(stateDir);
  const desiredRoutine = buildRoutinePlan({
    repo: process.cwd(),
    stateDir,
    runtime: "codex",
    interval: scheduler?.runIntervalSeconds ? formatCadenceIntervalSeconds(scheduler.runIntervalSeconds) ?? "15m" : "15m",
    scheduler: scheduler?.kind === "launchd" ? "launchd" : "auto",
    sendMode: routine?.sendMode ?? "verify",
  });
  const routineStatus = buildRoutineArtifactStatus(routine, desiredRoutine);
  const users = listUsers();
  const automationWarnings = buildInboundAutomationWarnings(users);
  const automationHealthWarnings = buildInboundAutomationHealthWarnings(users, preflight.checkedAt);
  const automationStatus = buildInboundAutomationStatus(users, preflight.checkedAt);
  const packetReviewWarnings = buildStalePacketReviewWarnings(listMotions(), listCompanies(), {
    now: preflight.checkedAt,
  });
  const rollout = buildAgentSendRolloutSummary(
    queueModel,
    hostState,
    routineStatus,
    scheduler,
    automationWarnings,
    automationHealthWarnings,
  );
  const cadence = buildSchedulerCadenceSummary(scheduler, readJsonIfExists(path.join(stateDir, "agent-last-pass.json")), preflight.checkedAt);
  return {
    checkedAt: preflight.checkedAt,
    stateDir,
    queue: preflight.queue,
    browser: preflight.browser,
    scheduler,
    routine: routineStatus,
    rollout,
    packetReviewWarnings,
    automationWarnings,
    automationHealthWarnings,
    automationStatus,
    hostState,
    cadence,
    lastPass: readJsonIfExists(path.join(stateDir, "agent-last-pass.json")),
    artifacts: {
      preflightPath: path.join(stateDir, "agent-preflight.json"),
      hostStatePath: path.join(stateDir, "agent-host-state.json"),
      lastPassPath: path.join(stateDir, "agent-last-pass.json"),
      logPath: path.join(stateDir, "agent.log"),
      launchdStdoutPath: path.join(stateDir, "agent-launchd.out.log"),
      launchdStderrPath: path.join(stateDir, "agent-launchd.err.log"),
      hostRunnerPath: path.join(stateDir, "run-agent-host.sh"),
    },
  };
}

/**
 * @param {ReturnType<typeof buildAgentDoctorReport>} report
 */
export function formatAgentDoctorReport(report) {
  const lines = [];
  const queue = report.queue ?? {
    dueTaskCount: 0,
    waitingTaskCount: 0,
    blockerCount: 0,
    draftTaskCount: 0,
    browserTaskCount: 0,
    browserTaskKinds: [],
  };
  const browser = report.browser ?? {
    required: false,
    ready: true,
    skipReason: "no_browser_tasks_due",
    blockedReasons: [],
    warnings: [],
    taskReadiness: {},
  };
  const scheduler = report.scheduler ?? null;
  const routine = report.routine ?? null;
  const taskReadiness = browser.taskReadiness ?? {};
  const taskKinds = ["run_inbound_sync", "send_message", "reconcile_connection_request_status", "reject_connection_request", "withdraw_connection"];
  const shownKinds = taskKinds.filter((taskKind) => taskReadiness[taskKind]);
  const dueTaskKinds = [...new Set(Array.isArray(queue.browserTaskKinds) ? queue.browserTaskKinds : [])];
  const blockedDueTaskKinds = dueTaskKinds.filter((taskKind) => taskReadiness[taskKind]?.ready === false);

  lines.push(`Agent doctor checked at ${report.checkedAt}.`);
  lines.push(`Queue: ${queue.dueTaskCount} due, ${queue.waitingTaskCount} waiting, ${queue.blockerCount} blocker${queue.blockerCount === 1 ? "" : "s"}.`);
  if (scheduler?.kind === "launchd") {
    const schedulerStatus = scheduler.loaded ? "loaded" : scheduler.installed ? "installed but not loaded" : "not installed";
    const schedulerDetail = scheduler.loaded
      ? ` state=${scheduler.state ?? "unknown"} runs=${scheduler.runs ?? 0}${scheduler.lastExitCode !== null ? ` last_exit=${scheduler.lastExitCode}` : ""}${scheduler.runIntervalSeconds ? ` interval=${formatCadenceIntervalSeconds(scheduler.runIntervalSeconds)}` : ""}${Number.isFinite(scheduler.runningForSeconds) ? ` running_for=${formatDurationSeconds(Number(scheduler.runningForSeconds))}` : ""}`
      : "";
    lines.push(`Scheduler: launchd ${schedulerStatus}.${schedulerDetail}`);
    if (scheduler.loaded && (String(scheduler.lastExitCode) === "126" || String(scheduler.lastExitCode) === "78")) {
      lines.push(`Last launchd exit code ${scheduler.lastExitCode} usually means macOS privacy controls (TCC) blocked the runner. Reinstall the routine to move the launchd entry point outside protected folders: exo agent install-routine --runtime codex --install`);
    }
    const foreignAgents = Array.isArray(scheduler.foreignAgents)
      ? scheduler.foreignAgents.filter((agent) => agent?.referencesStateDir !== false)
      : [];
    if (foreignAgents.length > 0) {
      const labels = foreignAgents.map((agent) => `${agent.label}${agent.loaded ? " (loaded)" : ""}`).join(", ");
      lines.push(`Other exo schedulers found for this workspace: ${labels}. Reinstalling the routine converges on the canonical scheduler and removes them.`);
    }
  }
  if (report.cadence?.nextExpectedRunAt) {
    const prefix = report.cadence.overdue ? "Scheduler is overdue." : "Next scheduled pass is expected around";
    lines.push(report.cadence.overdue
      ? `${prefix} ${report.cadence.nextExpectedRunAt} (${report.cadence.overdueBySeconds}s late).`
      : `${prefix} ${report.cadence.nextExpectedRunAt}.`);
  }
  if (report.cadence?.activeRunOverCadence) {
    lines.push(`Current launchd pass has exceeded its cadence by ${report.cadence.activeRunOverCadenceBySeconds}s. Lane workers now own their locks, so inspect lane summaries and active lane lock holders for the live blocker.`);
  }
  if (routine?.exists) {
    if (routine.sendMode === "verify") {
      lines.push("Send mode: verify. Send tasks stop before the final send, so they will not drain.");
    } else if (routine.sendMode === "canary") {
      lines.push("Send mode: canary. Each pass may send at most one previously verified send. Unverified due sends stop at ready_to_send first.");
    } else if (routine.sendMode === "live") {
      lines.push("Send mode: live. Connector-native sends are allowed to complete and write back.");
    }
    if (routine.stale) {
      lines.push(`Installed host runner artifacts are stale relative to current code (have ${routine.artifactVersion ?? "no version"}, need ${routine.expectedArtifactVersion}).`);
      if (routine.reinstallCommand) {
        lines.push(`Reinstall the routine to apply reliability fixes: ${routine.reinstallCommand}`);
      }
    }
  }
  if (report.rollout?.dueSendCount > 0) {
    lines.push(`Send proof coverage: ${report.rollout.verifiedDueSendCount}/${report.rollout.dueSendCount} due sends already have fresh proof.`);
    if (report.rollout.sendCircuitBreaker?.active) {
      const until = report.rollout.sendCircuitBreaker.unavailableUntil ?? "unknown";
      const failures = report.rollout.sendCircuitBreaker.consecutiveFailures ?? 0;
      lines.push(`Live send circuit breaker is active until ${until} after ${failures} consecutive live/canary send failure${failures === 1 ? "" : "s"}.`);
    }
    if (report.rollout.canaryCooldown?.active) {
      const until = report.rollout.canaryCooldown.unavailableUntil ?? "unknown";
      const label = report.rollout.canaryCooldown.lastTaskLabel ? ` after ${report.rollout.canaryCooldown.lastTaskLabel}` : "";
      lines.push(`Canary live-send cooldown is active until ${until}${label}.`);
    }
    if (routine?.sendMode === "verify") {
      if (report.rollout.unverifiedDueSendCount > 0) {
        const nextVerify = report.rollout.nextVerifyCandidate?.label ?? "the next due send";
        lines.push(`Verify mode still needs ${report.rollout.unverifiedDueSendCount} more proof${report.rollout.unverifiedDueSendCount === 1 ? "" : "s"}. Next likely proof: ${nextVerify}.`);
      } else if (!routine?.stale && report.rollout.nextCanaryCandidate?.label) {
        lines.push(`All due sends are already proved. Canary can safely drain next from ${report.rollout.nextCanaryCandidate.label}.`);
      }
    } else if (routine?.sendMode === "canary" && report.rollout.verifiedDueSendCount > 0 && report.rollout.nextCanaryCandidate?.label) {
      lines.push(`Canary is ready to send next from ${report.rollout.nextCanaryCandidate.label}.`);
    }
    if (report.rollout.recommendedTransition?.summary) {
      lines.push(report.rollout.recommendedTransition.summary);
    }
  }
  if (Array.isArray(report.automationWarnings) && report.automationWarnings.length) {
    lines.push("");
    lines.push("Manual-only inbound surfaces:");
    for (const warning of report.automationWarnings) {
      lines.push(`- ${warning.capability}:${warning.handle} · ${warning.surfaceLabel}: ${warning.reason}`);
      if (warning.disableCommand) {
        lines.push(`  disable: ${warning.disableCommand}`);
      }
    }
  }
  if (Array.isArray(report.automationHealthWarnings) && report.automationHealthWarnings.length) {
    lines.push("");
    lines.push("Autonomous inbound retrieval needs refresh:");
    for (const warning of report.automationHealthWarnings) {
      lines.push(`- ${warning.capability}:${warning.handle} · ${warning.surfaceLabel}: ${warning.reason}`);
      if (warning.inspectCommand) {
        lines.push(`  inspect: ${warning.inspectCommand}`);
      }
    }
  }
  if (report.automationStatus) {
    const status = report.automationStatus;
    lines.push("");
    lines.push(`Autonomous retrieval: ${status.freshCount}/${status.enabledAutonomousSurfaceCount} enabled surfaces currently fresh, ${status.dueNowCount} due now.`);
    if (status.retryBackoffCount > 0) {
      lines.push(`Recent failed retrieval backoff: ${status.retryBackoffCount} enabled surface${status.retryBackoffCount === 1 ? "" : "s"} still cooling down.`);
    }
    if (status.nextDueSurface?.dueAt) {
      lines.push(`Next autonomous retrieval due around ${status.nextDueSurface.dueAt} for ${status.nextDueSurface.capability}:${status.nextDueSurface.handle} · ${status.nextDueSurface.surfaceLabel}.`);
    }
  }
  if (report.packetReviewWarnings?.count > 0) {
    lines.push("");
    lines.push("Stale packet reviews:");
    lines.push(`- ${report.packetReviewWarnings.count} submitted packet review${report.packetReviewWarnings.count === 1 ? "" : "s"} older than ${report.packetReviewWarnings.thresholdHours}h. Oldest: ${report.packetReviewWarnings.oldestAgeLabel ?? "unknown age"}.`);
    for (const item of report.packetReviewWarnings.items.slice(0, 5)) {
      const motion = item.motion?.name ? ` in ${item.motion.name}` : "";
      lines.push(`- ${item.subject}${motion}: submitted ${item.submittedAt} (${item.ageLabel})`);
      if (item.commands?.brief) {
        lines.push(`  review: ${item.commands.brief}`);
      }
    }
  }
  if (!browser.required) {
    lines.push("No browser-dependent queue work is due right now.");
  } else if (blockedDueTaskKinds.length) {
    lines.push(`General Chrome preflight passed, but some due task classes are blocked (${blockedDueTaskKinds.join(", ")}).`);
  } else if (browser.ready) {
    lines.push(`Browser transport is ready for due browser work (${dueTaskKinds.join(", ") || "none"}).`);
  } else {
    lines.push("Browser transport is blocked for at least some due work.");
  }
  if (shownKinds.length) {
    lines.push("");
    lines.push("Task readiness:");
    for (const taskKind of shownKinds) {
      const readiness = taskReadiness[taskKind];
      lines.push(`- ${taskKind}: ${readiness.ready ? "ready" : "blocked"}`);
      if (!readiness.ready && Array.isArray(readiness.blockedReasons) && readiness.blockedReasons.length) {
        lines.push(`  reason: ${readiness.blockedReasons[0]}`);
      }
    }
  }

  const blockedReasons = Array.isArray(browser.blockedReasons) ? browser.blockedReasons : [];
  if (blockedReasons.length) {
    lines.push("");
    lines.push("Hard blockers:");
    for (const reason of blockedReasons) lines.push(`- ${reason}`);
  }

  const warnings = Array.isArray(browser.warnings) ? browser.warnings : [];
  if (warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of warnings) lines.push(`- ${warning}`);
  }

  const conflictingInstances = browser.chromeAppInstances?.conflictingUserDataDirInstances ?? [];
  if (conflictingInstances.length) {
    lines.push("");
    lines.push("Conflicting Chrome instances:");
    for (const instance of conflictingInstances) {
      lines.push(`- pid ${instance.pid}: ${instance.userDataDir ?? "custom user-data-dir"}`);
    }
  }

  const activeBackoffs = listActiveBrowserBackoffs(report.hostState);
  if (activeBackoffs.length) {
    lines.push("");
    lines.push("Browser backoff by task class:");
    for (const backoff of activeBackoffs) {
      lines.push(`- ${backoff.lane}: until ${backoff.unavailableUntil}`);
      if (backoff.reason) {
        lines.push(`  reason: ${backoff.reason}`);
      }
    }
  }

  const recentVerifications = Array.isArray(report.hostState?.recentTaskVerifications)
    ? report.hostState.recentTaskVerifications.slice(-5).reverse()
    : [];
  if (recentVerifications.length) {
    lines.push("");
    lines.push("Recent verification-only send proofs:");
    for (const entry of recentVerifications) {
      const subject = entry.prospectName ?? entry.prospectId ?? entry.recipientUrl ?? entry.fingerprint;
      const company = entry.companyName ? ` at ${entry.companyName}` : "";
      const status = entry.verificationStatus ? ` (${entry.verificationStatus})` : "";
      lines.push(`- ${subject}${company}: verified ${entry.verifiedAt}${status}`);
      if (entry.expiresAt) {
        lines.push(`  skip-until: ${entry.expiresAt}`);
      }
    }
  }

  if (report.lastPass) {
    const lastPassStatus = report.lastPass.status
      ?? report.lastPass.results?.[0]?.status
      ?? null;
    const lastPassReason = report.lastPass.reason
      ?? report.lastPass.results?.[0]?.detail?.reason
      ?? null;
    lines.push("");
    lines.push("Last pass:");
    lines.push(`- status: ${lastPassStatus ?? "unknown"}`);
    if (report.lastPass.startedAt) lines.push(`- started: ${report.lastPass.startedAt}`);
    if (report.lastPass.endedAt) lines.push(`- ended: ${report.lastPass.endedAt}`);
    if (lastPassReason) lines.push(`- reason: ${lastPassReason}`);
    const resultCount = Array.isArray(report.lastPass.results) ? report.lastPass.results.length : 0;
    lines.push(`- results: ${resultCount}`);
  }

  lines.push("");
  lines.push("Artifacts:");
  lines.push(`- preflight: ${report.artifacts.preflightPath}`);
  lines.push(`- host state: ${report.artifacts.hostStatePath}`);
  lines.push(`- last pass: ${report.artifacts.lastPassPath}`);
  lines.push(`- agent log: ${report.artifacts.logPath}`);
  if (scheduler?.kind === "launchd") {
    lines.push(`- launchd plist: ${scheduler.installPath}`);
  }
  if (routine?.exists) {
    lines.push(`- host runner: ${routine.path}`);
  }
  return lines.join("\n");
}

/**
 * @param {string | null} motionId
 */
function buildPacketReviewQueue(motionId) {
  const companies = listCompanies();
  const motions = motionId
    ? [requireMotion(motionId)]
    : listMotions();
  const items = motions.flatMap((motion) =>
    buildMotionPacketSummary(motion, companies, { status: "submitted" }).items.map((packet) => ({
      motionId: motion.id,
      motionName: motion.name,
      packetId: packet.packetId,
      packetKind: packet.packetKind,
      companyId: packet.companyId,
      companyName: packet.companyName,
      prospectId: packet.prospectId ?? null,
      prospectName: packet.prospectName ?? null,
      claimState: packet.claimState,
      reviewState: packet.reviewState ?? null,
      completedAt: packet.completedAt ?? null,
      proposal: packet.proposal ?? null,
      notes: packet.notes ?? null,
      briefCommand: `exo motion packet-brief ${motion.id} --packet ${packet.packetId} --json`,
      acceptCommand: `exo agent packets accept ${motion.id} --packet ${packet.packetId} --json`,
      amendCommand: `exo agent packets amend ${motion.id} --packet ${packet.packetId} --outcome <outcome> --reason "Why this outcome is correct" --json`,
      returnCommand: `exo agent packets return ${motion.id} --packet ${packet.packetId} --notes "What the worker must fix" --json`,
    }))
  );

  return {
    count: items.length,
    motionCount: motions.length,
    items
  };
}

function renderPacketReviewQueue(result) {
  if (!result.count) {
    console.log("No packets are awaiting review.");
    return;
  }

  console.log(`${result.count} packet(s) awaiting review:\n`);
  for (const item of result.items) {
    const subject = item.prospectName
      ? `${item.prospectName} at ${item.companyName}`
      : item.companyName;
    console.log(`- ${item.packetId}  ${subject}`);
    console.log(`  motion: ${item.motionName}`);
    console.log(`  kind: ${item.packetKind}`);
    if (item.proposal?.action) console.log(`  proposal: ${item.proposal.action}`);
    if (item.proposal?.reason) console.log(`  reason: ${item.proposal.reason}`);
    console.log(`  brief: ${item.briefCommand}`);
    console.log(`  accept: ${item.acceptCommand}`);
    console.log(`  return: ${item.returnCommand}`);
  }
}

/**
 * @param {string} motionId
 * @param {string} packetId
 * @param {{
 *   action: "accepted" | "amended" | "returned",
 *   outcome?: "advance" | "nurture" | "not_a_fit" | "no_longer_target" | "exhausted",
 *   nextStatus?: "researched" | "suppressed" | "exhausted" | undefined,
 *   reason?: string | null,
 *   notes?: string | null,
 *   reviewer?: string | null
 * }} input
 */
function resolvePacketReviewDecision(motionId, packetId, input) {
  const context = loadPacketReviewContext(motionId, packetId);
  const decisionInput = {
    outcome: input.outcome,
    nextStatus: input.nextStatus,
    reason: input.reason ?? input.notes ?? null,
    notes: input.notes ?? input.reason ?? null,
    reviewer: input.reviewer ?? null,
  };
  const updatedMotion = context.packet.packetKind === "prospect_research"
    ? resolveProspectPacketReviewDecision(context, input.action, decisionInput)
    : resolveAccountPacketReviewDecision(context, input.action, decisionInput);
  return buildPacketReviewDecisionResult(context, updatedMotion, input.action);
}

/**
 * @param {ReturnType<typeof loadPacketReviewContext>} context
 * @param {"accepted" | "amended" | "returned"} action
 * @param {Record<string, any>} input
 */
function resolveAccountPacketReviewDecision(context, action, input) {
  if (action === "returned") {
    return returnMotionTargetAccountPacket(context.motion, context.company, {
      notes: input.notes,
      reviewer: input.reviewer,
    });
  }
  return acceptMotionTargetAccountPacket(context.motion, context.company, input);
}

/**
 * @param {ReturnType<typeof loadPacketReviewContext>} context
 * @param {"accepted" | "amended" | "returned"} action
 * @param {Record<string, any>} input
 */
function resolveProspectPacketReviewDecision(context, action, input) {
  if (!context.packet.prospectId) {
    throw new Error(`Prospect packet ${context.packet.id} is missing a prospect id.`);
  }
  if (action === "returned") {
    return returnMotionProspectPacket(context.motion, context.company, {
      prospectId: context.packet.prospectId,
      notes: input.notes,
      reviewer: input.reviewer,
    });
  }
  return acceptMotionProspectPacket(context.motion, context.company, {
    ...input,
    prospectId: context.packet.prospectId,
  });
}

/**
 * @param {string} motionId
 * @param {string} packetId
 */
function loadPacketReviewContext(motionId, packetId) {
  const motion = requireMotion(motionId);
  const packet = parsePacketId(packetId);
  const company = findCompanyById(packet.companyId);
  if (!company) {
    throw new Error(`Company not found: ${packet.companyId}`);
  }
  return {
    motion,
    company,
    packet
  };
}

/**
 * @param {ReturnType<typeof loadPacketReviewContext>} context
 * @param {any} updatedMotion
 * @param {"accepted" | "amended" | "returned"} action
 */
function buildPacketReviewDecisionResult(context, updatedMotion, action) {
  const account = updatedMotion.targetMap.accounts.find((item) => item.companyId === context.company.id) ?? null;
  const prospect = context.packet.prospectId
    ? account?.prospects.find((item) => item.id === context.packet.prospectId) ?? null
    : null;
  return {
    action,
    motion: {
      id: updatedMotion.id,
      name: updatedMotion.name
    },
    company: {
      id: context.company.id,
      name: context.company.name
    },
    packet: context.packet,
    account,
    prospect
  };
}

function emitPacketReviewDecision(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const subject = result.prospect
    ? `${result.prospect.name} at ${result.company.name}`
    : result.company.name;
  console.log(
    [
      `Packet ${result.action}: ${result.packet.id}`,
      `Subject: ${subject}`,
      `Motion: ${result.motion.name}`,
      `Account Queue: ${result.account?.queueState?.status ?? "unknown"}`,
      `Account Disposition: ${result.account?.disposition ?? "unknown"}`,
      ...(result.prospect
        ? [
          `Prospect Queue: ${result.prospect.queueState?.status ?? "unknown"}`,
          `Prospect Disposition: ${result.prospect.disposition ?? "unknown"}`
        ]
        : [])
    ].join("\n")
  );
}

/**
 * @param {string} motionId
 */
function requireMotion(motionId) {
  const motion = findMotionById(motionId);
  if (!motion) {
    throw new Error(`Motion not found: ${motionId}`);
  }
  return motion;
}

/**
 * @param {string} packetId
 */
function parsePacketId(packetId) {
  const [packetKind, companyId, prospectId = null] = packetId.split(":");
  if (packetKind !== "company_research" && packetKind !== "prospect_selection" && packetKind !== "prospect_research") {
    throw new Error(`Invalid packet kind in packet id: ${packetId}`);
  }
  if (!companyId) {
    throw new Error(`Invalid packet id: ${packetId}`);
  }
  if (packetKind === "prospect_research" && !prospectId) {
    throw new Error(`Prospect research packet id must include a prospect id: ${packetId}`);
  }
  return {
    id: packetId,
    packetKind,
    companyId,
    prospectId
  };
}

/**
 * @param {string} value
 * @returns {"advance" | "nurture" | "not_a_fit" | "no_longer_target" | "exhausted"}
 */
function normalizePacketReviewOutcome(value) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "advance"
    || normalized === "nurture"
    || normalized === "not_a_fit"
    || normalized === "no_longer_target"
    || normalized === "exhausted"
  ) {
    return normalized;
  }
  throw new Error(`Invalid packet review outcome: ${value}`);
}

/**
 * @param {string | undefined} value
 * @returns {"researched" | "suppressed" | "exhausted" | undefined}
 */
function normalizePacketReviewNextStatus(value) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "researched" || normalized === "suppressed" || normalized === "exhausted") {
    return normalized;
  }
  throw new Error(`Invalid packet review next status: ${value}`);
}

/**
 * @param {string | undefined} value
 * @param {string} label
 */
function normalizeRequiredPacketText(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

/** @param {string} text @param {number} max */
function truncate(text, max) {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** @param {string | null | undefined} reason */
function humanizeWaitingReason(reason) {
  switch (reason) {
    case "waiting_for_connection_response":
      return "waiting for the connection request to resolve";
    case "waiting_on_outbound":
      return "waiting on the current outbound branch";
    case "not_due_yet":
      return "scheduled for a later cadence checkpoint";
    case "held_in_reserve":
      return "held in reserve behind a stronger branch";
    default:
      return "not due yet";
  }
}

/**
 * @param {string} filePath
 */
function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Far agents have been observed working around launchd failures by installing
 * their own exo-labelled LaunchAgents under a different name (for example
 * `com.<user>.exo.agent-loop` instead of the canonical queue-drainer). The
 * canonical label then reads as "off" while passes are actually arriving.
 * Scan the LaunchAgents directory for those renamed runners so status can
 * tell the truth and repair can converge them back to the canonical label.
 *
 * @param {{
 *   canonicalLabel: string,
 *   launchAgentsDir?: string,
 *   stateDir?: string | null,
 *   uid?: number | null,
 *   printLaunchctl?: (target: string) => string,
 * }} input
 */
export function scanForeignExoLaunchAgents(input) {
  const launchAgentsDir = input.launchAgentsDir ?? path.join(os.homedir(), "Library", "LaunchAgents");
  const uid = input.uid !== undefined ? input.uid : (process.getuid?.() ?? null);
  const printLaunchctl = input.printLaunchctl
    ?? ((target) => execFileSync("launchctl", ["print", target], { encoding: "utf8" }));
  /** @type {string[]} */
  let entries = [];
  try {
    entries = fs.readdirSync(launchAgentsDir);
  } catch {
    return [];
  }
  const foreign = [];
  for (const entry of entries) {
    if (!entry.endsWith(".plist")) continue;
    const label = entry.slice(0, -".plist".length);
    if (label === input.canonicalLabel) continue;
    if (!/(^|\.)exo\./.test(label)) continue;
    const installPath = path.join(launchAgentsDir, entry);
    let plistContent = "";
    try {
      plistContent = fs.readFileSync(installPath, "utf8");
    } catch {
      // Unreadable plist still gets reported by label so drift is visible.
    }
    const referencesStateDir = input.stateDir ? plistContent.includes(input.stateDir) : null;
    const target = uid === null ? label : `gui/${uid}/${label}`;
    let loaded = false;
    let running = false;
    let pid = null;
    try {
      const output = printLaunchctl(target);
      loaded = true;
      running = (output.match(/^\s*state = (.+)$/m)?.[1]?.trim() ?? null) === "running";
      const pidRaw = output.match(/^\s*pid = (\d+)/m)?.[1] ?? null;
      pid = pidRaw ? Number(pidRaw) : null;
    } catch {
      // Not loaded in this launchd domain; the stray plist alone is the drift.
    }
    foreign.push({ label, installPath, target, loaded, running, pid, referencesStateDir });
  }
  return foreign;
}

/**
 * @param {string | null} [stateDir]
 */
export function inspectAgentSchedulerState(stateDir = null) {
  if (process.platform !== "darwin") {
    return {
      kind: "none",
      installed: false,
      loaded: false,
    };
  }

  const username = os.userInfo().username;
  const uid = process.getuid?.() ?? null;
  const label = buildLaunchAgentLabel(username);
  const installPath = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
  const target = uid === null ? label : `gui/${uid}/${label}`;
  const installed = fs.existsSync(installPath);
  const foreignAgents = scanForeignExoLaunchAgents({ canonicalLabel: label, stateDir, uid });

  if (!installed) {
    return {
      kind: "launchd",
      label,
      target,
      installPath,
      installed: false,
      loaded: false,
      running: false,
      pid: null,
      state: null,
      runs: 0,
      runIntervalSeconds: null,
      runningForSeconds: null,
      lastExitCode: null,
      error: null,
      foreignAgents,
    };
  }

  try {
    const output = execFileSync("launchctl", ["print", target], { encoding: "utf8" });
    const state = output.match(/^\s*state = (.+)$/m)?.[1]?.trim() ?? null;
    const pidRaw = output.match(/^\s*pid = (\d+)/m)?.[1] ?? null;
    const runsRaw = output.match(/^\s*runs = (\d+)/m)?.[1] ?? null;
    const lastExitRaw = output.match(/^\s*last exit code = (.+)$/m)?.[1]?.trim() ?? null;
    const runIntervalRaw = output.match(/^\s*run interval = (\d+) seconds$/m)?.[1] ?? null;
    const pid = pidRaw ? Number(pidRaw) : null;
    return {
      kind: "launchd",
      label,
      target,
      installPath,
      installed: true,
      loaded: true,
      running: state === "running",
      pid,
      state,
      runs: runsRaw ? Number(runsRaw) : 0,
      runIntervalSeconds: runIntervalRaw ? Number(runIntervalRaw) : null,
      runningForSeconds: state === "running" && pid ? readProcessElapsedSeconds(pid) : null,
      lastExitCode: lastExitRaw && lastExitRaw !== "(never exited)" ? lastExitRaw : null,
      error: null,
      foreignAgents,
    };
  } catch (error) {
    return {
      kind: "launchd",
      label,
      target,
      installPath,
      installed: true,
      loaded: false,
      running: false,
      pid: null,
      state: null,
      runs: 0,
      runIntervalSeconds: null,
      runningForSeconds: null,
      lastExitCode: null,
      error: error instanceof Error ? error.message : String(error),
      foreignAgents,
    };
  }
}

/**
 * @param {string} stateDir
 */
export function inspectAgentRoutineState(stateDir) {
  const runnerPath = path.join(stateDir, "run-agent-host.sh");
  if (!fs.existsSync(runnerPath)) {
    return {
      exists: false,
      path: runnerPath,
      sendMode: null,
      artifactVersion: null,
    };
  }

  try {
    const content = fs.readFileSync(runnerPath, "utf8");
    const explicitMatch = content.match(/send_mode=(verify|live|canary)/i);
    if (explicitMatch?.[1]) {
      return {
        exists: true,
        path: runnerPath,
        sendMode: explicitMatch[1].toLowerCase(),
        artifactVersion: parseRoutineArtifactVersion(content),
      };
    }
    const dryRunExport = /EXO_AGENT_SEND_DRY_RUN/.test(content);
    return {
      exists: true,
      path: runnerPath,
      sendMode: /EXO_AGENT_SEND_MODE="?canary"?/i.test(content)
        ? "canary"
        : dryRunExport
          ? "verify"
          : "live",
      artifactVersion: parseRoutineArtifactVersion(content),
    };
  } catch {
    return {
      exists: true,
      path: runnerPath,
      sendMode: null,
      artifactVersion: null,
    };
  }
}

/**
 * @param {{ exists?: boolean, path?: string | null, sendMode?: string | null, artifactVersion?: string | null } | null} routine
 * @param {{ interval?: { label?: string | null } | null, sendMode?: string | null } | null} desiredPlan
 */
function buildRoutineArtifactStatus(routine, desiredPlan) {
  if (!routine?.exists) {
    return {
      exists: false,
      path: routine?.path ?? null,
      sendMode: null,
      artifactVersion: null,
      expectedArtifactVersion: ROUTINE_ARTIFACT_VERSION,
      stale: false,
      reinstallCommand: null,
    };
  }

  const sendMode = routine.sendMode ?? desiredPlan?.sendMode ?? "verify";
  const intervalLabel = desiredPlan?.interval?.label ?? "15m";
  return {
    exists: true,
    path: routine.path ?? null,
    sendMode,
    artifactVersion: routine.artifactVersion ?? null,
    expectedArtifactVersion: ROUTINE_ARTIFACT_VERSION,
    stale: routine.artifactVersion !== ROUTINE_ARTIFACT_VERSION,
    reinstallCommand: `exo agent install-routine --runtime codex --interval ${intervalLabel} --send-mode ${sendMode} --install`,
  };
}

/**
 * @param {"verify" | "canary" | "live"} requestedSendMode
 * @param {string} intervalLabel
 * @returns {string}
 */
function buildCanaryInstallCommand(requestedSendMode, intervalLabel) {
  return `exo agent install-routine --runtime codex --interval ${intervalLabel} --send-mode ${requestedSendMode} --install`;
}

/**
 * @param {{
 *   requestedSendMode: "verify" | "canary" | "live",
 *   currentInstalledSendMode?: string | null,
 *   intervalLabel: string,
 *   queue: ReturnType<typeof loadAgentQueue>,
 *   hostState: any,
 *   automationWarnings?: Array<{ disableCommand?: string | null }> | null,
 *   automationHealthWarnings?: Array<{ inspectCommand?: string | null }> | null,
 * }} input
 */
function buildRoutineInstallReadiness(input) {
  const sendMode = input.requestedSendMode;
  const currentMode = typeof input.currentInstalledSendMode === "string" && input.currentInstalledSendMode.trim().length
    ? input.currentInstalledSendMode.trim().toLowerCase()
    : null;
  const automationWarnings = input.automationWarnings ?? [];
  const automationHealthWarnings = input.automationHealthWarnings ?? [];
  const now = new Date().toISOString();
  const sendCircuitBreaker = getSendCircuitBreaker(input.hostState, now);

  if (currentMode && currentMode === sendMode) {
    return {
      ready: true,
      reason: null,
      command: null,
    };
  }

  if (sendMode === "verify") {
    return {
      ready: true,
      reason: null,
      command: null,
    };
  }

  if (automationWarnings.length > 0) {
    return {
      ready: false,
      reason: "Enabled manual-only inbound surfaces still exist, so autonomous retrieval coverage is not honest enough for live rollout.",
      command: automationWarnings[0]?.disableCommand ?? null,
    };
  }

  if (automationHealthWarnings.length > 0) {
    return {
      ready: false,
      reason: "Enabled autonomous inbound retrieval surfaces are stale, failed, partial, or never checked, so background truth is not healthy enough for send rollout.",
      command: automationHealthWarnings[0]?.inspectCommand ?? null,
    };
  }

  if (sendCircuitBreaker.active) {
    return {
      ready: false,
      reason: `The live-send circuit breaker is active until ${sendCircuitBreaker.unavailableUntil ?? "unknown"}.`,
      command: null,
    };
  }

  if (sendMode === "canary") {
    return {
      ready: true,
      reason: null,
      command: null,
    };
  }

  const dueSendTasks = input.queue.tasks.filter((task) => task.kind === "send_message");
  const unverifiedDueSendCount = dueSendTasks.filter((task) => !getRecentTaskVerification(
    input.hostState,
    task.kind,
    createTaskVerificationFingerprint(task),
    now,
  )).length;
  if (unverifiedDueSendCount > 0) {
    return {
      ready: false,
      reason: `Live mode is blocked because ${unverifiedDueSendCount} due send${unverifiedDueSendCount === 1 ? "" : "s"} still lack fresh verification proof.`,
      command: buildCanaryInstallCommand("canary", input.intervalLabel),
    };
  }

  const canaryCooldown = getCanaryCooldown(input.hostState, now);
  if (!canaryCooldown.lastSentAt) {
    return {
      ready: false,
      reason: "Live mode is blocked until the worker records at least one successful canary send.",
      command: buildCanaryInstallCommand("canary", input.intervalLabel),
    };
  }
  if (canaryCooldown.active) {
    const label = canaryCooldown.lastTaskLabel ? ` after ${canaryCooldown.lastTaskLabel}` : "";
    return {
      ready: false,
      reason: `Live mode is blocked until the canary cooldown expires at ${canaryCooldown.unavailableUntil ?? "unknown"}${label}.`,
      command: null,
    };
  }

  return {
    ready: true,
    reason: null,
    command: null,
  };
}

/**
 * @param {string | null | undefined} value
 * @param {string | null | undefined} currentSendMode
 */
function normalizeRoutineSendMode(value, currentSendMode = null) {
  const fallback = typeof currentSendMode === "string" && currentSendMode.trim().length
    ? currentSendMode
    : "verify";
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (normalized === "live") return "live";
  if (normalized === "canary") return "canary";
  return "verify";
}

/**
 * @param {{ kind?: string | null, runIntervalSeconds?: number | null } | null} scheduler
 * @param {any} lastPass
 * @param {string} checkedAt
 */
export function buildSchedulerCadenceSummary(scheduler, lastPass, checkedAt) {
  const runIntervalSeconds = Number.isFinite(scheduler?.runIntervalSeconds) ? Number(scheduler.runIntervalSeconds) : null;
  const lastStartedAt = normalizeIsoString(lastPass?.startedAt);
  const runningForSeconds = Number.isFinite(scheduler?.runningForSeconds) ? Number(scheduler.runningForSeconds) : null;
  const activeRunStartedAt = scheduler?.running && runningForSeconds !== null
    ? new Date(Date.parse(checkedAt) - (runningForSeconds * 1000)).toISOString()
    : null;
  const activeRunOverCadenceBySeconds = runIntervalSeconds && runningForSeconds !== null
    ? Math.max(0, runningForSeconds - runIntervalSeconds)
    : 0;
  if (!runIntervalSeconds || !lastStartedAt) {
    return {
      runIntervalSeconds,
      lastStartedAt,
      activeRunStartedAt,
      activeRunElapsedSeconds: runningForSeconds,
      activeRunOverCadence: activeRunOverCadenceBySeconds > 0,
      activeRunOverCadenceBySeconds,
      nextExpectedRunAt: null,
      overdue: false,
      overdueBySeconds: 0,
    };
  }

  const nextExpectedRunAt = new Date(Date.parse(lastStartedAt) + (runIntervalSeconds * 1000)).toISOString();
  const overdueBySeconds = Math.max(0, Math.floor((Date.parse(checkedAt) - Date.parse(nextExpectedRunAt)) / 1000));
  return {
    runIntervalSeconds,
    lastStartedAt,
    activeRunStartedAt,
    activeRunElapsedSeconds: runningForSeconds,
    activeRunOverCadence: activeRunOverCadenceBySeconds > 0,
    activeRunOverCadenceBySeconds,
    nextExpectedRunAt,
    overdue: overdueBySeconds > 0,
    overdueBySeconds,
  };
}

/**
 * @param {ReturnType<typeof loadAgentQueue>} queue
 * @param {any} hostState
 * @param {{ sendMode?: string | null } | null} routine
 * @param {{ runIntervalSeconds?: number | null } | null} scheduler
 * @param {Array<Record<string, any>>} [automationWarnings]
 * @param {Array<Record<string, any>>} [automationHealthWarnings]
 */
function buildAgentSendRolloutSummary(queue, hostState, routine, scheduler, automationWarnings = [], automationHealthWarnings = []) {
  const dueSendTasks = queue.tasks.filter((task) => task.kind === "send_message");
  const now = new Date().toISOString();
  const sendCircuitBreaker = getSendCircuitBreaker(hostState, now);
  const canaryCooldown = getCanaryCooldown(hostState, now);
  const verified = [];
  const unverified = [];

  for (const task of dueSendTasks) {
    const verification = getRecentTaskVerification(
      hostState,
      task.kind,
      createTaskVerificationFingerprint(task),
      now,
    );
    const entry = {
      prospectId: task.prospectId ?? null,
      prospectName: task.prospectName ?? null,
      companyId: task.companyId ?? null,
      companyName: task.companyName ?? null,
      motionId: task.motionId ?? null,
      motionName: task.motionName ?? null,
      recipientUrl: task.recipientUrl ?? null,
      surface: task.surface ?? null,
      label: [task.prospectName, task.companyName].filter(Boolean).join(" at ") || task.recipientUrl || task.prospectId || "unknown send",
    };
    if (verification) {
      verified.push({
        ...entry,
        verifiedAt: verification.verifiedAt,
        expiresAt: verification.expiresAt,
        verificationStatus: verification.verificationStatus ?? null,
      });
    } else {
      unverified.push(entry);
    }
  }

  const recommendedTransition = buildSendModeRecommendation({
    routine,
    scheduler,
    automationWarnings,
    automationHealthWarnings,
    sendCircuitBreaker,
    canaryCooldown,
    dueSendCount: dueSendTasks.length,
    verifiedDueSendCount: verified.length,
    unverifiedDueSendCount: unverified.length,
    nextCanaryCandidate: verified[0] ?? null,
  });

  return {
    sendMode: routine?.sendMode ?? null,
    dueSendCount: dueSendTasks.length,
    verifiedDueSendCount: verified.length,
    unverifiedDueSendCount: unverified.length,
    allDueSendsVerified: dueSendTasks.length > 0 && unverified.length === 0,
    nextCanaryCandidate: verified[0] ?? null,
    nextVerifyCandidate: unverified[0] ?? null,
    verifiedDueSends: verified,
    unverifiedDueSends: unverified,
    sendCircuitBreaker,
    canaryCooldown,
    recommendedTransition,
  };
}

/**
 * @param {{
 *   routine: { sendMode?: string | null, stale?: boolean | null, reinstallCommand?: string | null } | null,
 *   scheduler: { runIntervalSeconds?: number | null } | null,
 *   automationWarnings?: Array<{ disableCommand?: string | null }> | null,
 *   automationHealthWarnings?: Array<{ inspectCommand?: string | null }> | null,
 *   sendCircuitBreaker: { active?: boolean, unavailableUntil?: string | null, consecutiveFailures?: number | null } | null,
 *   canaryCooldown: { active?: boolean, unavailableUntil?: string | null, lastTaskLabel?: string | null, lastSentAt?: string | null } | null,
 *   dueSendCount: number,
 *   verifiedDueSendCount: number,
 *   unverifiedDueSendCount: number,
 *   nextCanaryCandidate: { label?: string | null } | null,
 * }} input
 */
function buildSendModeRecommendation(input) {
  const sendMode = input.routine?.sendMode ?? null;
  const intervalLabel = formatCadenceIntervalSeconds(input.scheduler?.runIntervalSeconds ?? null);
  if (input.routine?.stale) {
    return {
      targetSendMode: sendMode,
      ready: false,
      command: input.routine.reinstallCommand ?? null,
      summary: `Reinstall the scheduled worker before any rollout change so the live runner matches current code.`,
    };
  }
  if ((input.automationWarnings?.length ?? 0) > 0) {
    return {
      targetSendMode: sendMode,
      ready: false,
      command: input.automationWarnings?.[0]?.disableCommand ?? null,
      summary: "Resolve enabled manual-only inbound surfaces before any rollout change so background retrieval coverage is honest.",
    };
  }
  if ((input.automationHealthWarnings?.length ?? 0) > 0) {
    return {
      targetSendMode: sendMode,
      ready: false,
      command: input.automationHealthWarnings?.[0]?.inspectCommand ?? null,
      summary: "Refresh enabled autonomous inbound retrieval before any rollout change so background truth is healthy.",
    };
  }
  if (input.sendCircuitBreaker?.active) {
    const until = input.sendCircuitBreaker.unavailableUntil ?? "unknown";
    const failures = input.sendCircuitBreaker.consecutiveFailures ?? 0;
    return {
      targetSendMode: sendMode,
      ready: false,
      command: null,
      summary: `Live send rollout is paused by the circuit breaker until ${until} after ${failures} consecutive live/canary send failure${failures === 1 ? "" : "s"}.`,
    };
  }
  if (sendMode === "canary" && input.canaryCooldown?.active) {
    const until = input.canaryCooldown.unavailableUntil ?? "unknown";
    const label = input.canaryCooldown.lastTaskLabel ? ` after ${input.canaryCooldown.lastTaskLabel}` : "";
    return {
      targetSendMode: "canary",
      ready: false,
      command: null,
      summary: `Canary live-send cooldown is active until ${until}${label}.`,
    };
  }
  if (sendMode === "verify" && input.dueSendCount > 0 && input.unverifiedDueSendCount === 0) {
    const command = intervalLabel
      ? `exo agent install-routine --runtime codex --interval ${intervalLabel} --send-mode canary --install`
      : null;
    const subject = input.nextCanaryCandidate?.label ? ` Next canary send: ${input.nextCanaryCandidate.label}.` : "";
    return {
      targetSendMode: "canary",
      ready: true,
      command,
      summary: `Recommended rollout step: switch the scheduled worker to canary.${subject}`,
    };
  }
  if (
    sendMode === "canary"
    && input.unverifiedDueSendCount === 0
    && input.canaryCooldown?.active !== true
    && input.canaryCooldown?.lastSentAt
  ) {
    const command = intervalLabel
      ? `exo agent install-routine --runtime codex --interval ${intervalLabel} --send-mode live --install`
      : null;
    const label = input.canaryCooldown.lastTaskLabel ? ` Last canary send: ${input.canaryCooldown.lastTaskLabel}.` : "";
    return {
      targetSendMode: "live",
      ready: true,
      command,
      summary: `Recommended rollout step: switch the scheduled worker to live. Canary has already completed at least one successful live send.${label}`,
    };
  }
  return {
    targetSendMode: sendMode,
    ready: false,
    command: null,
    summary: null,
  };
}

/** @param {number | null | undefined} seconds */
function formatCadenceIntervalSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const value = Number(seconds);
  if (value % 3600 === 0) return `${value / 3600}h`;
  if (value % 60 === 0) return `${value / 60}m`;
  return `${value}s`;
}

/** @param {number | null | undefined} seconds */
function formatDurationSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const value = Math.floor(Number(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainingSeconds = value % 60;
  if (hours > 0) return `${hours}h${minutes}m${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

/** @param {unknown} value */
function normalizeIsoString(value) {
  if (typeof value !== "string" || !value.trim().length) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** @param {string} content */
function parseRoutineArtifactVersion(content) {
  const match = content.match(/exo_agent_routine_version=([A-Za-z0-9._-]+)/);
  return match?.[1] ?? null;
}

/** @param {number} pid */
function readProcessElapsedSeconds(pid) {
  try {
    const output = execFileSync("ps", ["-p", String(pid), "-o", "etime="], { encoding: "utf8" }).trim();
    if (!output) return null;
    return parsePsElapsedTime(output);
  } catch {
    return null;
  }
}

/** @param {string} value */
function parsePsElapsedTime(value) {
  const trimmed = value.trim();
  const daySplit = trimmed.split("-");
  let days = 0;
  let timePart = trimmed;
  if (daySplit.length === 2) {
    days = Number.parseInt(daySplit[0], 10);
    timePart = daySplit[1];
  }
  const segments = timePart.split(":").map((segment) => Number.parseInt(segment, 10));
  if (segments.some((segment) => !Number.isFinite(segment))) return null;
  if (segments.length === 2) {
    const [minutes, seconds] = segments;
    return (days * 86400) + (minutes * 60) + seconds;
  }
  if (segments.length === 3) {
    const [hours, minutes, seconds] = segments;
    return (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;
  }
  return null;
}

/**
 * @param {{
 *   sourcePath: string,
 *   installPath: string,
 *   target: string,
 *   bootstrapDomain: string | null,
 *   bootstrapCommand: string | null,
 *   bootoutCommand: string | null,
 *   enableCommand: string | null,
 * }} launchAgent
 */
function installLaunchAgent(launchAgent, options = {}) {
  fs.mkdirSync(path.dirname(launchAgent.installPath), { recursive: true });
  fs.copyFileSync(launchAgent.sourcePath, launchAgent.installPath);
  try {
    execFileSync("launchctl", ["bootout", launchAgent.target], { encoding: "utf8" });
  } catch {
    // Unloaded is fine. We always rewrite and bootstrap the fresh copy.
  }
  if (!launchAgent.bootstrapDomain) {
    throw new Error("Missing launchctl bootstrap domain for this user.");
  }
  execFileSync("launchctl", ["bootstrap", launchAgent.bootstrapDomain, launchAgent.installPath], { encoding: "utf8" });
  try {
    execFileSync("launchctl", ["enable", launchAgent.target], { encoding: "utf8" });
  } catch {
    // Some launchd states are already enabled. Keep the bootstrap as success.
  }
  execFileSync("launchctl", ["print", launchAgent.target], { encoding: "utf8" });
  const removedForeignAgents = options.canonicalLabel
    ? removeForeignExoLaunchAgents({
      canonicalLabel: options.canonicalLabel,
      stateDir: options.stateDir ?? null,
    })
    : [];
  return { removedForeignAgents };
}

/**
 * Converge scheduling back onto the canonical label: boot out and delete any
 * renamed exo LaunchAgents that drive the same state dir, so two schedulers
 * never race over one queue and status stops reporting drift. Plists that
 * reference a different state dir belong to another workspace and are left
 * alone.
 *
 * @param {{
 *   canonicalLabel: string,
 *   stateDir?: string | null,
 *   launchAgentsDir?: string,
 *   uid?: number | null,
 *   printLaunchctl?: (target: string) => string,
 *   bootoutLaunchctl?: (target: string) => void,
 * }} input
 */
export function removeForeignExoLaunchAgents(input) {
  const bootoutLaunchctl = input.bootoutLaunchctl
    ?? ((target) => execFileSync("launchctl", ["bootout", target], { encoding: "utf8" }));
  const foreignAgents = scanForeignExoLaunchAgents(input);
  const removed = [];
  for (const agent of foreignAgents) {
    // Strict containment check: only plists that provably reference this
    // workspace's state dir are ours to remove. Unreadable plists and other
    // workspaces' runners stay (they keep showing up in status as drift).
    if (agent.referencesStateDir !== true) continue;
    try {
      bootoutLaunchctl(agent.target);
    } catch {
      // Already unloaded (or never bootstrapped); removing the plist is what matters.
    }
    try {
      fs.rmSync(agent.installPath, { force: true });
      removed.push(agent);
    } catch {
      // Leave it visible in the next status scan rather than failing the install.
    }
  }
  return removed;
}

/** @param {any} handoff */
function formatSendRecipient(handoff) {
  return handoff?.recipient?.profileUrl
    ?? handoff?.recipient?.email
    ?? handoff?.recipient?.threadUrl
    ?? "unknown";
}
