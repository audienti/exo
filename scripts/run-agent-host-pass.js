#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildAgentQueue } from "../src/core/build-agent-queue.js";
import { buildInboundAutomationHealthWarnings, buildInboundAutomationWarnings } from "../src/core/user-inbound-sync.js";
import {
  findCompanyById,
  findMotionById,
  listBrowserProfiles,
  listCompanies,
  listInboundCues,
  listInboundObservations,
  listMotions,
  listUsers,
  updateMotion,
} from "../src/db/database.js";
import { updateMotionProspect } from "../src/core/record-prospect.js";
import { resolveScopedExecutionAssignment } from "../src/core/resolve-scoped-execution-assignment.js";
import { resolveUserConnection } from "../src/core/resolve-user-connection.js";
import { setMotionProspectCadence } from "../src/core/set-prospect-cadence.js";
import { setMotionProspectDraft } from "../src/core/set-prospect-draft.js";
import { claimMotionTargetAccountPacket } from "../src/core/claim-target-account-packet.js";
import { recordActionResult } from "../src/core/record-action-result.js";
import {
  BROWSER_TRANSPORT_TASK_KINDS,
  clearBrowserBackoffForTask,
  getCanaryCooldown,
  clearSendCircuitBreaker,
  createTaskVerificationFingerprint as createHostStateTaskVerificationFingerprint,
  getBrowserBackoffForTask,
  getRecentTaskVerification,
  getSendCircuitBreaker,
  normalizeAgentHostState,
  pruneExpiredBrowserBackoffs,
  recordSendCircuitFailure,
  recordTaskVerification,
  recordCanarySendCooldown,
  setBrowserBackoffForTask,
} from "../src/lib/agent-host-state.js";
import { buildPreflightSummary } from "../src/lib/agent-preflight.js";
import { runLinkedinMaintenanceWithPlaywriter } from "../src/lib/linkedin-playwriter-maintenance.js";
import { sendLinkedinMessageWithPlaywriter } from "../src/lib/linkedin-playwriter-send.js";
import { extractUsableDraftBody } from "../src/lib/draft-policy.js";
import {
  deletePlaywriterSession,
  ensurePlaywriterSession,
} from "../src/lib/playwriter-session.js";
import { extractLinkedinPublicId } from "../src/lib/prospect-contacts.js";

const CODEX_BIN = process.env.EXO_CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex";
const ROOT = process.cwd();
const STATE_DIR = process.env.EXO_STATE_DIR || path.join(ROOT, ".exo");
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const PASS_SUMMARY_PATH = path.join(STATE_DIR, "agent-last-pass.json");
const PREFLIGHT_PATH = path.join(STATE_DIR, "agent-preflight.json");
const HOST_STATE_PATH = path.join(STATE_DIR, "agent-host-state.json");
const TEMP_ROOT = path.join(STATE_DIR, "automation-tmp");
const MAX_TASKS_PER_PASS = normalizePositiveInteger(process.env.EXO_AGENT_MAX_TASKS, 8);
const DRAFT_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_DRAFT_TIMEOUT_MS, 120000);
const BROWSER_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_BROWSER_TIMEOUT_MS, 300000);
const INBOUND_CAPTURE_TIMEOUT_MS = normalizePositiveInteger(
  process.env.EXO_AGENT_INBOUND_CAPTURE_TIMEOUT_MS,
  Math.max(BROWSER_TIMEOUT_MS, 6 * 60 * 1000),
);
const COMPANY_RESEARCH_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_COMPANY_RESEARCH_TIMEOUT_MS, 10 * 60 * 1000);
const EXO_COMMAND_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_EXO_COMMAND_TIMEOUT_MS, 60000);
const SHELL_COMMAND_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_SHELL_COMMAND_TIMEOUT_MS, 60000);
const CHROME_ATTACH_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_CHROME_ATTACH_TIMEOUT_MS, 60000);
const CHROME_WINDOW_BOOTSTRAP_WAIT_MS = normalizePositiveInteger(process.env.EXO_AGENT_CHROME_WINDOW_BOOTSTRAP_WAIT_MS, 5000);
const BROWSER_TRANSPORT_BACKOFF_MS = normalizePositiveInteger(process.env.EXO_AGENT_BROWSER_BACKOFF_MS, 15 * 60 * 1000);
const VERIFY_TASK_COOLDOWN_MS = normalizePositiveInteger(process.env.EXO_AGENT_VERIFY_TASK_COOLDOWN_MS, 6 * 60 * 60 * 1000);
const SEND_CIRCUIT_BREAKER_THRESHOLD = normalizePositiveInteger(process.env.EXO_AGENT_SEND_CIRCUIT_BREAKER_THRESHOLD, 2);
const SEND_CIRCUIT_BREAKER_BACKOFF_MS = normalizePositiveInteger(process.env.EXO_AGENT_SEND_CIRCUIT_BREAKER_BACKOFF_MS, 12 * 60 * 60 * 1000);
const CANARY_SEND_COOLDOWN_MS = normalizePositiveInteger(process.env.EXO_AGENT_CANARY_SEND_COOLDOWN_MS, 6 * 60 * 60 * 1000);
const VERIFICATION_OUTPUT_MAX_CHARS = normalizePositiveInteger(process.env.EXO_AGENT_VERIFICATION_OUTPUT_MAX_CHARS, 1200);
const AUTONOMOUS_WORKER_LABEL = normalizeNullableString(process.env.EXO_AGENT_WORKER_LABEL) ?? buildAutonomousWorkerLabel();
const DRAFT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["body"],
  properties: {
    body: { type: "string", minLength: 1 }
  }
};
const CODEX_CONNECTOR_RUNTIME_CONFIG = {
  gmail: {
    pluginIds: ["gmail@openai-curated"],
    mcpServerIds: [],
  },
  hubspot: {
    pluginIds: ["hubspot@openai-curated"],
    mcpServerIds: [],
  },
  unipile: {
    pluginIds: [],
    mcpServerIds: ["unipile"],
  },
};

if (isMainModule(import.meta.url)) {
  try {
    const summary = runAgentHostPass();
    fs.mkdirSync(path.dirname(PASS_SUMMARY_PATH), { recursive: true });
    fs.writeFileSync(PASS_SUMMARY_PATH, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}

export function runAgentHostPass() {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });

  const preflight = buildAndPersistPreflight();
  const hostState = loadHostState();
  const browserReady = preflight.browser?.ready !== false;
  const ignoreBrowserBackoff = isBrowserBackoffIgnored();
  const forceRetrieval = isRetrievalForceEnabled();
  const sendMode = getSendMode();

  const startedAt = new Date().toISOString();
  const results = [];
  let iteration = 0;
  let noOpReason = null;

  while (iteration < MAX_TASKS_PER_PASS) {
    const queue = loadQueue();
    const queueCheckedAt = new Date().toISOString();
    const rolloutWarnings = loadInboundAutomationRolloutWarnings(queueCheckedAt);
    const task = chooseNextQueueTask(
      queue,
      browserReady,
      hostState,
      queueCheckedAt,
      ignoreBrowserBackoff,
      sendMode,
      rolloutWarnings.automationWarnings,
      rolloutWarnings.automationHealthWarnings,
      forceRetrieval,
    );
    if (!task) {
      if (results.length === 0) {
        noOpReason = explainNoopPass(
          queue,
          browserReady,
          hostState,
          queueCheckedAt,
          ignoreBrowserBackoff,
          sendMode,
          rolloutWarnings.automationWarnings,
          rolloutWarnings.automationHealthWarnings,
          forceRetrieval,
        );
      }
      break;
    }

    const result = executeTask(task, preflight, {
      sendMode,
      automationWarnings: rolloutWarnings.automationWarnings,
      automationHealthWarnings: rolloutWarnings.automationHealthWarnings,
    });
    results.push(result);
    iteration += 1;

    const blockedBrowserTask = result.status === "blocked" && BROWSER_TRANSPORT_TASK_KINDS.has(task.kind);
    const selectedMode = typeof task?._selectedSendMode === "string" ? task._selectedSendMode : getSendMode();
    const liveSendAttempt = task.kind === "send_message"
      && (selectedMode === "live" || selectedMode === "canary_live" || selectedMode === "operator_live");
    if (blockedBrowserTask) {
      const unavailableUntil = new Date(Date.now() + BROWSER_TRANSPORT_BACKOFF_MS).toISOString();
      const nextState = setBrowserBackoffForTask(
        hostState,
        task.kind,
        unavailableUntil,
        result.detail?.reason ?? "browser_transport_blocked",
      );
      hostState.browserBackoff = nextState.browserBackoff;
      saveHostState(hostState);
    }

    if ((result.status === "blocked" || result.status === "failed") && liveSendAttempt) {
      const failureAt = result.finishedAt ?? new Date().toISOString();
      const breakerBefore = getSendCircuitBreaker(hostState, failureAt);
      const nextFailureCount = breakerBefore.consecutiveFailures + 1;
      const nextState = recordSendCircuitFailure(hostState, {
        failureAt,
        reason: result.detail?.reason ?? `${result.status}: send task did not complete`,
        taskFingerprint: createTaskVerificationFingerprint(task),
        taskLabel: [task.prospectName, task.companyName].filter(Boolean).join(" at ") || task.recipientUrl || task.prospectId || "unknown send",
        unavailableUntil: nextFailureCount >= SEND_CIRCUIT_BREAKER_THRESHOLD
          ? new Date(Date.parse(failureAt) + SEND_CIRCUIT_BREAKER_BACKOFF_MS).toISOString()
          : null,
      });
      hostState.sendCircuitBreaker = nextState.sendCircuitBreaker;
      saveHostState(hostState);
    }

    if (blockedBrowserTask) {
      if ((getSendMode() === "verify" || getSendMode() === "canary") && task.kind === "send_message") {
        break;
      }
      continue;
    }

    if (result.status === "completed" && BROWSER_TRANSPORT_TASK_KINDS.has(task.kind)) {
      const nextState = clearBrowserBackoffForTask(hostState, task.kind);
      hostState.browserBackoff = nextState.browserBackoff;
      saveHostState(hostState);
    }

    if (result.status === "completed" && liveSendAttempt && result.detail?.verificationOnly !== true) {
      const nextState = clearSendCircuitBreaker(hostState);
      hostState.sendCircuitBreaker = nextState.sendCircuitBreaker;
      if (selectedMode === "canary_live") {
        const cooldownState = recordCanarySendCooldown(hostState, {
          sentAt: result.finishedAt ?? new Date().toISOString(),
          unavailableUntil: new Date(Date.parse(result.finishedAt ?? new Date().toISOString()) + CANARY_SEND_COOLDOWN_MS).toISOString(),
          taskFingerprint: createTaskVerificationFingerprint(task),
          taskLabel: [task.prospectName, task.companyName].filter(Boolean).join(" at ") || task.recipientUrl || task.prospectId || "unknown send",
        });
        hostState.canaryCooldown = cooldownState.canaryCooldown;
      }
      saveHostState(hostState);
    }

    if (result.status === "completed" && result.detail?.verificationOnly === true) {
      const nextState = recordTaskVerification(hostState, {
        taskKind: task.kind,
        fingerprint: createTaskVerificationFingerprint(task),
        verifiedAt: result.finishedAt ?? new Date().toISOString(),
        expiresAt: new Date(Date.now() + VERIFY_TASK_COOLDOWN_MS).toISOString(),
        motionId: task.motionId ?? null,
        companyId: task.companyId ?? null,
        prospectId: task.prospectId ?? null,
        surface: task.surface ?? null,
        recipientUrl: task.recipientUrl ?? null,
        verificationStatus: result.detail?.sendStatus ?? null,
        prospectName: task.prospectName ?? null,
        companyName: task.companyName ?? null,
      });
      hostState.recentTaskVerifications = nextState.recentTaskVerifications;
      saveHostState(hostState);
    }

    if (shouldStopAfterTaskResult(task, result)) {
      break;
    }

    if (result.status === "failed" || result.status === "blocked") {
      break;
    }
  }

  const endedAt = new Date().toISOString();
  const finalQueue = loadQueue();
  const finalRolloutWarnings = loadInboundAutomationRolloutWarnings(endedAt);
  const status = summarizePassStatus(results);
  const reason = status === "noop"
    ? (noOpReason ?? explainNoopPass(
      finalQueue,
      browserReady,
      hostState,
      endedAt,
      ignoreBrowserBackoff,
      sendMode,
      finalRolloutWarnings.automationWarnings,
      finalRolloutWarnings.automationHealthWarnings,
      forceRetrieval,
    ))
    : summarizePassReason(results);
  return {
    status,
    reason,
    startedAt,
    endedAt,
    maxTasksPerPass: MAX_TASKS_PER_PASS,
    browserReady,
    preflightPath: PREFLIGHT_PATH,
    results,
    finalQueueCounts: summarizeQueue(finalQueue),
  };
}

/** @param {string} [now] */
function loadInboundAutomationRolloutWarnings(now = new Date().toISOString()) {
  const users = listUsers();
  return {
    automationWarnings: buildInboundAutomationWarnings(users),
    automationHealthWarnings: buildInboundAutomationHealthWarnings(users, now),
  };
}

/**
 * Stop the pass after one verification-only send. That path intentionally does
 * not write back, so the queue would otherwise surface the same task again.
 *
 * @param {any} task
 * @param {any} result
 */
export function shouldStopAfterTaskResult(task, result) {
  return Boolean(
    task?.kind === "send_message"
      && result?.status === "completed"
      && (
        result?.detail?.verificationOnly === true
        || task?._selectedSendMode === "canary_live"
      )
  );
}

/** @param {any[]} results */
export function summarizePassStatus(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "noop";
  }
  if (results.some((result) => result?.status === "failed")) {
    return "failed";
  }
  if (results.some((result) => result?.status === "blocked")) {
    return "blocked";
  }
  if (results.every((result) => result?.status === "completed" || result?.status === "discarded")) {
    return "completed";
  }
  return "mixed";
}

/** @param {any[]} results */
export function summarizePassReason(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const firstProblem = results.find((result) => result?.status === "failed" || result?.status === "blocked");
  return firstProblem?.detail?.reason ?? null;
}

/** @param {any} task */
export function createTaskVerificationFingerprint(task) {
  return createHostStateTaskVerificationFingerprint(task);
}

/** @param {any} task */
function isOperatorControlledSendTask(task) {
  if (task?.kind !== "send_message") return false;
  return task?.authoredBy === "operator" || task?.editedByOperator === true;
}

/**
 * @param {ReturnType<typeof loadQueue>} queue
 * @param {boolean} browserReady
 * @param {any} [hostState]
 * @param {string} [now]
 * @param {boolean} [ignoreBrowserBackoff]
 * @param {"live" | "verify" | "canary"} [sendMode]
 * @param {Array<Record<string, any>>} [automationWarnings]
 * @param {Array<Record<string, any>>} [automationHealthWarnings]
 * @param {boolean} [forceRetrieval]
 */
export function chooseNextQueueTask(
  queue,
  browserReady,
  hostState = {},
  now = new Date().toISOString(),
  ignoreBrowserBackoff = false,
  sendMode = "live",
  automationWarnings = [],
  automationHealthWarnings = [],
  forceRetrieval = false,
) {
  if (!browserReady) {
    return getQueueTasksForExecution(queue, forceRetrieval).find((task) => !BROWSER_TRANSPORT_TASK_KINDS.has(task.kind)) ?? null;
  }

  /** @type {any | null} */
  let canaryFallback = null;
  const sendCircuitBreaker = getSendCircuitBreaker(hostState, now);
  const canaryCooldown = getCanaryCooldown(hostState, now);
  const automationBlockReason = getInboundAutomationRolloutBlockReason(automationWarnings, sendMode, automationHealthWarnings);
  for (const task of getQueueTasksForExecution(queue, forceRetrieval)) {
    if (!BROWSER_TRANSPORT_TASK_KINDS.has(task.kind)) {
      return task;
    }
    if (!ignoreBrowserBackoff) {
      const backoff = getBrowserBackoffForTask(hostState, task.kind, now);
      if (backoff.active) {
        continue;
      }
    }

    if (task.kind === "send_message") {
      if (automationBlockReason) {
        continue;
      }
      if (sendMode !== "verify" && sendCircuitBreaker.active) {
        continue;
      }
      const verification = getRecentTaskVerification(
        hostState,
        task.kind,
        createTaskVerificationFingerprint(task),
        now,
      );
      if (sendMode === "verify") {
        if (isOperatorControlledSendTask(task)) {
          return {
            ...task,
            _selectedSendMode: "operator_live",
            _recentVerification: verification ?? null,
          };
        }
        if (verification) {
          continue;
        }
        return {
          ...task,
          _selectedSendMode: "verify",
        };
      }
      if (sendMode === "canary") {
        if (verification) {
          if (canaryCooldown.active) {
            continue;
          }
          return {
            ...task,
            _selectedSendMode: "canary_live",
            _recentVerification: verification,
          };
        }
        if (!canaryFallback) {
          canaryFallback = {
            ...task,
            _selectedSendMode: "canary_verify",
          };
        }
        continue;
      }
      return {
        ...task,
        _selectedSendMode: "live",
      };
    }

    return task;
  }

  return sendMode === "canary" ? canaryFallback : null;
}

/**
 * Manual host-pass verification should be able to exercise retrieval without
 * waiting for the stale window. When explicitly forced, include waiting
 * `run_inbound_sync` tasks in the same selection pipeline as due work.
 *
 * @param {{ tasks?: any[], waiting?: any[] } | null | undefined} queue
 * @param {boolean} [forceRetrieval]
 */
function getQueueTasksForExecution(queue, forceRetrieval = false) {
  const dueTasks = Array.isArray(queue?.tasks) ? queue.tasks : [];
  if (!forceRetrieval) {
    return sortQueueTasksForExecution(dueTasks);
  }
  const waitingRetrievalTasks = Array.isArray(queue?.waiting)
    ? queue.waiting.filter((task) => task?.kind === "run_inbound_sync")
    : [];
  return sortQueueTasksForExecution([...dueTasks, ...waitingRetrievalTasks]);
}

/**
 * The host runner should not depend on upstream queue ordering for its safety
 * model. Retrieval and mechanical cleanup must outrank send work even if the
 * queue builder changes shape later.
 *
 * @param {any[]} tasks
 */
function sortQueueTasksForExecution(tasks) {
  const rank = {
    run_inbound_sync: 0,
    company_research: 1,
    reject_connection_request: 2,
    withdraw_connection: 3,
    unfollow_profile: 4,
    send_message: 5,
    write_draft: 6,
  };

  return [...(tasks ?? [])].sort((left, right) => {
    const leftRank = rank[left?.kind] ?? 99;
    const rightRank = rank[right?.kind] ?? 99;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const leftKey = normalizeQueueTaskSortTime(left);
    const rightKey = normalizeQueueTaskSortTime(right);
    return leftKey.localeCompare(rightKey);
  });
}

/**
 * @param {ReturnType<typeof loadQueue> | { tasks?: any[] } | null} queue
 * @param {boolean} browserReady
 * @param {any} [hostState]
 * @param {string} [now]
 * @param {boolean} [ignoreBrowserBackoff]
 * @param {"live" | "verify" | "canary"} [sendMode]
 * @param {Array<Record<string, any>>} [automationWarnings]
 * @param {Array<Record<string, any>>} [automationHealthWarnings]
 * @param {boolean} [forceRetrieval]
 */
export function explainNoopPass(
  queue,
  browserReady,
  hostState = {},
  now = new Date().toISOString(),
  ignoreBrowserBackoff = false,
  sendMode = "live",
  automationWarnings = [],
  automationHealthWarnings = [],
  forceRetrieval = false,
) {
  const tasks = getQueueTasksForExecution(queue, forceRetrieval);
  if (tasks.length === 0) {
    return forceRetrieval
      ? "No due tasks or waiting autonomous retrieval tasks were available."
      : "No due tasks were available.";
  }

  if (!browserReady) {
    if (tasks.some((task) => !BROWSER_TRANSPORT_TASK_KINDS.has(task.kind))) {
      return "Browser-backed work is blocked, and the remaining due non-browser work was already exhausted in this pass.";
    }
    return "Browser preflight was not ready, and no due non-browser tasks were available.";
  }

  const sendTasks = tasks.filter((task) => task.kind === "send_message");
  if (sendTasks.length > 0) {
    const automationBlockReason = getInboundAutomationRolloutBlockReason(automationWarnings, sendMode, automationHealthWarnings);
    if (automationBlockReason) {
      return automationBlockReason;
    }
    const verificationRequiredSendTasks = sendTasks.filter((task) => !isOperatorControlledSendTask(task));
    const verifiedSendTasks = verificationRequiredSendTasks.filter((task) => getRecentTaskVerification(
      hostState,
      task.kind,
      createTaskVerificationFingerprint(task),
      now,
    ));
    if (sendMode === "verify"
      && verificationRequiredSendTasks.length > 0
      && verifiedSendTasks.length === verificationRequiredSendTasks.length) {
      return "Verify mode had no unverified send_message tasks left to prove.";
    }
    if (sendMode !== "verify") {
      const sendCircuitBreaker = getSendCircuitBreaker(hostState, now);
      if (sendCircuitBreaker.active) {
        return `Live send rollout is paused by the circuit breaker until ${sendCircuitBreaker.unavailableUntil ?? "unknown"}.`;
      }
    }
    if (sendMode === "canary" && verifiedSendTasks.length > 0) {
      const canaryCooldown = getCanaryCooldown(hostState, now);
      if (canaryCooldown.active) {
        return `Canary live-send cooldown is active until ${canaryCooldown.unavailableUntil ?? "unknown"}.`;
      }
    }
  }

  const blockedTaskKinds = [];
  for (const task of tasks) {
    if (!BROWSER_TRANSPORT_TASK_KINDS.has(task.kind) || ignoreBrowserBackoff) {
      continue;
    }
    const backoff = getBrowserBackoffForTask(hostState, task.kind, now);
    if (backoff.active) {
      blockedTaskKinds.push(task.kind);
    }
  }
  if (blockedTaskKinds.length > 0) {
    return `All due browser task classes are currently under backoff (${Array.from(new Set(blockedTaskKinds)).join(", ")}).`;
  }

  return "No selectable tasks were available for the current browser and send-mode state.";
}

/**
 * @param {any} task
 * @param {any} preflight
 * @param {{
 *   sendMode?: string | null,
 *   automationWarnings?: Array<Record<string, any>> | null,
 *   automationHealthWarnings?: Array<Record<string, any>> | null
 * }} [options]
 */
function executeTask(task, preflight, options = {}) {
  const startedAt = new Date().toISOString();
  const base = {
    kind: task.kind,
    motionId: task.motionId ?? null,
    companyId: task.companyId ?? null,
    prospectId: task.prospectId ?? null,
    startedAt,
  };

  try {
    if (task.kind === "write_draft") {
      const draft = runDraftTask(task);
      return {
        ...base,
        status: draft.status,
        finishedAt: new Date().toISOString(),
        detail: draft.detail,
      };
    }

    if (preflight.browser?.ready === false) {
      return {
        ...base,
        status: "blocked",
        finishedAt: new Date().toISOString(),
        detail: {
          reason: `Browser preflight failed: ${(preflight.browser?.blockedReasons ?? []).join("; ")}`,
        }
      };
    }

    const taskGate = getPreflightTaskGate(preflight, task.kind);
    if (!taskGate.allowed) {
      return {
        ...base,
        status: "blocked",
        finishedAt: new Date().toISOString(),
        detail: {
          reason: taskGate.reason ?? `Preflight blocked ${task.kind}.`,
        },
      };
    }

    if (task.kind === "run_inbound_sync") {
      const sync = runInboundSyncTask(task, preflight);
      if (sync.status === "blocked" || sync.status === "failed") {
        sync.detail = {
          ...sync.detail,
          reason: augmentBrowserTaskReason(sync.detail?.reason ?? null, preflight),
        };
      }
      return {
        ...base,
        status: sync.status,
        finishedAt: new Date().toISOString(),
        detail: sync.detail,
      };
    }

    if (task.kind === "company_research") {
      const research = runCompanyResearchTask(task);
      return {
        ...base,
        status: research.status,
        finishedAt: new Date().toISOString(),
        detail: research.detail,
      };
    }

    if (task.kind === "send_message") {
      const rolloutBlockReason = getInboundAutomationRolloutBlockReason(
        options.automationWarnings ?? [],
        typeof task?._selectedSendMode === "string" ? task._selectedSendMode : options.sendMode ?? "live",
        options.automationHealthWarnings ?? [],
      );
      if (rolloutBlockReason) {
        return {
          ...base,
          status: "blocked",
          finishedAt: new Date().toISOString(),
          detail: {
            reason: rolloutBlockReason,
          },
        };
      }
      const send = runSendTask(task);
      if (send.status === "blocked" || send.status === "failed") {
        send.detail = {
          ...send.detail,
          reason: augmentBrowserTaskReason(send.detail?.reason ?? null, preflight),
        };
      }
      return {
        ...base,
        status: send.status,
        finishedAt: new Date().toISOString(),
        detail: send.detail,
      };
    }

    if (task.kind === "withdraw_connection" || task.kind === "reject_connection_request" || task.kind === "unfollow_profile") {
      const action = runBrowserActionTask(task);
      if (action.status === "blocked" || action.status === "failed") {
        action.detail = {
          ...action.detail,
          reason: augmentBrowserTaskReason(action.detail?.reason ?? null, preflight),
        };
      }
      return {
        ...base,
        status: action.status,
        finishedAt: new Date().toISOString(),
        detail: action.detail,
      };
    }

    return {
      ...base,
      status: "blocked",
      finishedAt: new Date().toISOString(),
      detail: { reason: `Unsupported task kind: ${task.kind}` },
    };
  } catch (error) {
    return {
      ...base,
      status: "failed",
      finishedAt: new Date().toISOString(),
      detail: {
        reason: error instanceof Error ? error.message : String(error),
      }
    };
  }
}

/**
 * @param {Array<Record<string, any>>} automationWarnings
 * @param {Array<Record<string, any>>} [automationHealthWarnings]
 * @param {string} [sendMode]
 */
export function getInboundAutomationRolloutBlockReason(automationWarnings = [], sendMode = "live", automationHealthWarnings = []) {
  if (sendMode === "verify") {
    return null;
  }
  if (Array.isArray(automationWarnings) && automationWarnings.length > 0) {
    const samples = automationWarnings
      .slice(0, 2)
      .map((warning) => `${warning.capability}:${warning.handle} / ${warning.surfaceLabel}`);
    const extraCount = Math.max(0, automationWarnings.length - samples.length);
    const suffix = extraCount > 0 ? ` (+${extraCount} more)` : "";
    return `Live send rollout is paused until enabled manual-only inbound surfaces are disabled: ${samples.join(", ")}${suffix}.`;
  }
  if (Array.isArray(automationHealthWarnings) && automationHealthWarnings.length > 0) {
    const samples = automationHealthWarnings
      .slice(0, 2)
      .map((warning) => `${warning.capability}:${warning.handle} / ${warning.surfaceLabel} (${warning.freshnessState})`);
    const extraCount = Math.max(0, automationHealthWarnings.length - samples.length);
    const suffix = extraCount > 0 ? ` (+${extraCount} more)` : "";
    return `Live send rollout is paused until autonomous inbound retrieval is healthy again: ${samples.join(", ")}${suffix}.`;
  }
  return null;
}

/** @param {any} task */
function runDraftTask(task) {
  const brief = runExoJsonArgs([
    "motion",
    "draft-brief",
    task.motionId,
    "--prospect",
    task.prospectId,
    "--surface",
    task.surface,
    "--json",
  ]);
  if (brief?.surface?.available === false) {
    return {
      status: "blocked",
      detail: {
        reason: brief.surface.missingReason ?? `Draft surface ${task.surface} is not currently writeable.`,
      },
    };
  }
  const response = runCodexTask({
    prompt: buildDraftPrompt(brief),
    schema: DRAFT_OUTPUT_SCHEMA,
    outputName: `draft-${task.motionId}-${task.prospectId}.json`,
    browserRequired: false,
    timeoutMs: DRAFT_TIMEOUT_MS,
  });
  const body = extractDraftBodyFromCodexResponse(response);
  if (!body) {
    throw new Error("Draft task did not return a non-empty body.");
  }
  setDraft(task, body);
  return {
    status: "completed",
    detail: {
      postWriteStatus: task.postWriteStatus,
      bodyPreview: truncate(body, 160),
    },
  };
}

/** @param {any} task */
function runInboundSyncTask(task, preflight) {
  const stageTimingsMs = {};
  let stageStartedAt = Date.now();
  const liveResult = runInboundContract(task);
  stageTimingsMs.contract = Date.now() - stageStartedAt;
  if (liveResult.payload) {
    stageStartedAt = Date.now();
    applyInboundPayload(task, liveResult.payload);
    stageTimingsMs.apply = Date.now() - stageStartedAt;
    stageStartedAt = Date.now();
    const verification = runVerificationCommands(task.verificationCommands ?? []);
    stageTimingsMs.verification = Date.now() - stageStartedAt;
    return {
      status: "completed",
      detail: {
        transport: "direct_payload",
        verification,
        stageTimingsMs,
      }
    };
  }

  if (liveResult.transport?.kind !== "agent_handoff") {
    return {
      status: "blocked",
      detail: {
        reason: liveResult.transport?.reason ?? `Unsupported inbound transport: ${liveResult.transport?.kind ?? "unknown"}`,
      }
    };
  }

  const captureRequest = liveResult.transport.captureRequest;
  let capture;
  if (requiresBrowserAttachForInboundCapture(captureRequest)) {
    stageStartedAt = Date.now();
    const transportReady = ensureChromeTransportReady(preflight);
    stageTimingsMs.attach = Date.now() - stageStartedAt;

    if (transportReady.status !== "ok") {
      capture = buildFailedInboundCapture(task, `chrome_attach_failed: ${transportReady.reason ?? "native Chrome/browser-control attach was unavailable for background retrieval."}`);
    } else {
      stageStartedAt = Date.now();
      try {
        capture = runRecoveredBrowserCodexTask({
          prompt: buildInboundCapturePrompt(captureRequest, liveResult.transport.connector ?? null),
          schema: captureRequest.outputSchema,
          outputName: `inbound-${task.capability}-${task.accountId}.json`,
          classifyBlockedReason: (result) => classifyBrowserTransportBlockedReason(result?.error ?? result?.reason ?? null),
          timeoutMs: INBOUND_CAPTURE_TIMEOUT_MS,
        });
      } catch (error) {
        capture = buildFailedInboundCapture(task, normalizeInboundCaptureFailureReason(error));
      }
      stageTimingsMs.capture = Date.now() - stageStartedAt;
    }
  } else {
    stageStartedAt = Date.now();
    try {
      capture = runConnectorCodexTask({
        prompt: buildInboundCapturePrompt(captureRequest, liveResult.transport.connector ?? null),
        schema: captureRequest.outputSchema,
        outputName: `inbound-${task.capability}-${task.accountId}.json`,
        timeoutMs: INBOUND_CAPTURE_TIMEOUT_MS,
        enabledPlugins: resolveCodexConnectorPluginIds(liveResult.transport.connector ?? task.capability ?? null),
        enabledMcpServers: resolveCodexConnectorMcpServerIds(liveResult.transport.connector ?? task.capability ?? null),
      });
    } catch (error) {
      capture = buildFailedInboundCapture(task, normalizeInboundCaptureFailureReason(error));
    }
    stageTimingsMs.capture = Date.now() - stageStartedAt;
  }
  const normalizedCapture = normalizeInboundCaptureForWriteback(capture, task.capability);

  stageStartedAt = Date.now();
  const builtPayload = buildInboundPayload(task, normalizedCapture);
  stageTimingsMs.payloadBuild = Date.now() - stageStartedAt;
  stageStartedAt = Date.now();
  applyInboundPayload(task, builtPayload.payload);
  stageTimingsMs.apply = Date.now() - stageStartedAt;
  stageStartedAt = Date.now();
  const verification = runVerificationCommands(task.verificationCommands ?? []);
  stageTimingsMs.verification = Date.now() - stageStartedAt;

  return {
    status: "completed",
    detail: {
      transport: "agent_handoff",
      captureStatus: normalizedCapture.status,
      captureError: normalizedCapture.error ?? null,
      observedCount: normalizedCapture.itemCount ?? null,
      verification,
      stageTimingsMs,
    }
  };
}

/** @param {any} task */
function runCompanyResearchTask(task) {
  const claimed = ensureCompanyResearchTaskClaimed(task);
  if (!claimed.ok) {
    return {
      status: claimed.status,
      detail: {
        reason: claimed.reason,
      },
    };
  }

  const claimedTask = claimed.task;
  const brief = runExoJsonArgs([
    "motion",
    "packet-brief",
    claimedTask.motionId,
    "--packet",
    claimedTask.packetId,
    "--json",
  ]);

  const result = runCodexTask({
    prompt: buildCompanyResearchPrompt(brief, claimedTask),
    schema: null,
    outputName: `company-research-${claimedTask.motionId}-${claimedTask.companyId}.json`,
    browserRequired: false,
    useOutputSchema: false,
    timeoutMs: COMPANY_RESEARCH_TIMEOUT_MS,
  });

  if (result?.status !== "completed") {
    return {
      status: "blocked",
      detail: {
        reason: normalizeNullableString(result?.reason) ?? "Company research task did not complete.",
        summary: normalizeNullableString(result?.summary) ?? null,
      },
    };
  }

  const accountState = findMotionTargetAccountState(claimedTask.motionId, claimedTask.companyId);
  const packetStatus = accountState?.packetState?.status ?? null;
  const queueStatus = accountState?.queueState?.status ?? null;
  const completionStatus = normalizeNullableString(result?.completionStatus) ?? null;
  const summary = normalizeNullableString(result?.summary) ?? null;

  if (packetStatus !== "completed") {
    return {
      status: "failed",
      detail: {
        reason: `Company research task reported completion, but packet state is still ${packetStatus ?? "unknown"}.`,
        summary,
      },
    };
  }

  if (!["researched", "suppressed", "exhausted"].includes(queueStatus ?? "")) {
    return {
      status: "failed",
      detail: {
        reason: `Company research task reported completion, but queue state is still ${queueStatus ?? "unknown"}.`,
        summary,
      },
    };
  }

  if (completionStatus && completionStatus !== "none" && completionStatus !== queueStatus) {
    return {
      status: "failed",
      detail: {
        reason: `Company research task returned ${completionStatus}, but Exo stored ${queueStatus}.`,
        summary,
      },
    };
  }

  return {
    status: "completed",
    detail: {
      queueStatus,
      completionStatus: queueStatus,
      summary,
    },
  };
}

/**
 * @param {any} task
 */
function ensureCompanyResearchTaskClaimed(task) {
  if (task?.claimState !== "claimable") {
    return { ok: true, status: "completed", task };
  }

  const rawMotion = task?.motionId ? findMotionById(task.motionId) : null;
  if (!rawMotion) {
    return {
      ok: false,
      status: "failed",
      reason: `Company research task is missing motion ${task?.motionId ?? "unknown"}.`,
    };
  }

  const rawCompany = task?.companyId ? findCompanyById(task.companyId) : null;
  if (!rawCompany) {
    return {
      ok: false,
      status: "failed",
      reason: `Company research task is missing company ${task?.companyId ?? "unknown"}.`,
    };
  }

  try {
    const updatedMotion = claimMotionTargetAccountPacket(rawMotion, rawCompany, {
      workerLabel: AUTONOMOUS_WORKER_LABEL,
      notes: task?.notes ?? "Claimed automatically by the agent queue.",
    });
    const storedMotion = updateMotion(updatedMotion);
    const account = (storedMotion.targetMap?.accounts ?? []).find((item) => item.companyId === rawCompany.id) ?? null;
    const claimedAt = account?.packetState?.claimedAt ?? task?.queuedAt ?? null;
    return {
      ok: true,
      status: "completed",
      task: {
        ...task,
        claimState: "claimed",
        reason: "claimed_company_packet",
        workerLabel: account?.packetState?.workerLabel ?? AUTONOMOUS_WORKER_LABEL,
        queuedAt: claimedAt,
        dueAt: claimedAt,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: /already claimed by/i.test(reason) ? "discarded" : "blocked",
      reason,
    };
  }
}

/** @param {any} task */
function runSendTask(task) {
  const selectedMode = typeof task?._selectedSendMode === "string" ? task._selectedSendMode : getSendMode();
  const dryRun = selectedMode === "verify" || selectedMode === "canary_verify";
  const verifyFirst = selectedMode === "verify" || selectedMode === "canary_verify";
  const handoff = runExoJsonArgs([
    "agent",
    "send",
    task.companyId,
    "--motion",
    task.motionId,
    "--prospect",
    task.prospectId,
    "--surface",
    task.surface,
    "--json",
  ]);
  if (handoff.status !== "ready") {
    return {
      status: "blocked",
      detail: { reason: handoff.reason ?? "Send contract is blocked." }
    };
  }

  const directSend = maybeRunLinkedinSendWithPlaywriter(handoff, { dryRun, verifyFirst });
  if (directSend) {
    const reconciled = maybeReconcileBlockedLinkedinSendTask(task, handoff, directSend);
    if (reconciled) {
      return reconciled;
    }
    const handledUnavailable = maybeHandleUnavailableLinkedinReplyTask(task, handoff, directSend, { dryRun });
    if (handledUnavailable) {
      return handledUnavailable;
    }
    if (dryRun && (directSend.status === "ready_to_send" || directSend.status === "sent")) {
      return {
        status: "completed",
        detail: {
          action: handoff.action,
          recipient: describeHandoffRecipient(handoff),
          verificationOnly: true,
          sendStatus: directSend.status,
        },
      };
    }
    if (directSend.status !== "sent") {
      return {
        status: "blocked",
        detail: { reason: directSend.reason ?? "Send task was not completed." },
      };
    }

    runShellText(task.writeback);
    return {
      status: "completed",
      detail: { action: handoff.action, recipient: describeHandoffRecipient(handoff) },
    };
  }

  const result = usesConnectorNativeSend(handoff)
    ? runConnectorCodexTask({
        prompt: buildSendPrompt(handoff, { dryRun }),
        outputName: `send-${task.motionId}-${task.prospectId}-${task.surface}.json`,
        timeoutMs: BROWSER_TIMEOUT_MS,
        enabledPlugins: resolveCodexConnectorPluginIds(handoff.connector ?? handoff.channel ?? null),
        enabledMcpServers: resolveCodexConnectorMcpServerIds(handoff.connector ?? handoff.channel ?? null),
      })
    : runRecoveredBrowserCodexTask({
        prompt: buildSendPrompt(handoff, { dryRun }),
        outputName: `send-${task.motionId}-${task.prospectId}-${task.surface}.json`,
        classifyBlockedReason: (payload) => classifyBrowserTransportBlockedReason(payload?.reason ?? null),
        timeoutMs: BROWSER_TIMEOUT_MS,
      });

  if (dryRun && (result.status === "ready_to_send" || result.status === "sent")) {
    return {
      status: "completed",
      detail: {
        action: handoff.action,
        recipient: describeHandoffRecipient(handoff),
        verificationOnly: true,
        sendStatus: result.status,
      },
    };
  }

  const handledUnavailable = maybeHandleUnavailableLinkedinReplyTask(task, handoff, result, { dryRun });
  if (handledUnavailable) {
    return handledUnavailable;
  }

  if (result.status !== "sent") {
    return {
      status: "blocked",
      detail: { reason: result.reason ?? "Send task was not completed." }
    };
  }

  runShellText(task.writeback);
  return {
    status: "completed",
    detail: { action: handoff.action, recipient: describeHandoffRecipient(handoff) }
  };
}

/**
 * @param {any} task
 * @param {any} handoff
 * @param {any} result
 */
function maybeReconcileBlockedLinkedinSendTask(task, handoff, result) {
  if (result?.status !== "blocked") return null;
  if (handoff?.channel !== "linkedin" || handoff?.action !== "send_connection_request") return null;
  const profileSnapshot = result?.profileSnapshot;
  if (!profileSnapshot || typeof profileSnapshot !== "object") return null;

  const connectionDegree = Number.isInteger(profileSnapshot.connectionDegree) ? profileSnapshot.connectionDegree : null;
  const isOpenProfile = profileSnapshot.isOpenProfile === true;
  if (connectionDegree !== 1 && !isOpenProfile) return null;

  const rawCompany = findCompanyById(task.companyId);
  const rawMotion = task.motionId ? findMotionById(task.motionId) : null;
  if (!rawCompany || !rawMotion) return null;

  const capturedAt = normalizeIsoDatetime(profileSnapshot.capturedAt) ?? new Date().toISOString();
  const profileUrl = normalizeNullableString(profileSnapshot.profileUrl) ?? handoff.recipient?.profileUrl ?? null;
  const publicId = extractLinkedinPublicId(profileUrl ?? null);
  const nextStepLabel = connectionDegree === 1
    ? "Send the first post-accept LinkedIn message."
    : "Send the first private LinkedIn message on the direct-message path.";

  let nextMotion = updateMotionProspect(rawMotion, rawCompany, {
    prospectId: task.prospectId,
    name: normalizeNullableString(profileSnapshot.displayName) ?? undefined,
    title: normalizeNullableString(profileSnapshot.currentRoleTitle) ?? undefined,
    linkedinProfileUrl: profileUrl ?? undefined,
    avatarSourceUrl: normalizeNullableString(profileSnapshot.avatarSourceUrl) ?? undefined,
    sourceUrl: profileUrl ?? undefined,
    observedAt: capturedAt,
    profileViewedAt: capturedAt,
    identityTells: {
      headline: normalizeNullableString(profileSnapshot.headline) ?? undefined,
    },
    linkedinProfileSnapshot: {
      capturedAt,
      profileUrl,
      publicId,
      memberId: null,
      displayName: normalizeNullableString(profileSnapshot.displayName),
      currentRoleTitle: normalizeNullableString(profileSnapshot.currentRoleTitle),
      currentCompanyName: normalizeNullableString(profileSnapshot.currentCompanyName),
      headline: normalizeNullableString(profileSnapshot.headline),
      location: normalizeNullableString(profileSnapshot.location),
      about: normalizeNullableString(profileSnapshot.about),
      followerCount: null,
      connectionCount: null,
      isPremium: undefined,
      isOpenProfile,
      connectionDegree,
      recentPosts: [],
    },
  });

  nextMotion = setMotionProspectCadence(nextMotion, rawCompany, {
    prospectId: task.prospectId,
    currentStep: "direct-message",
    nextAction: nextStepLabel,
  });

  const obsoleteDraft = findProspectDraft(nextMotion, task.companyId, task.prospectId, task.surface);
  if (obsoleteDraft) {
    nextMotion = setMotionProspectDraft(nextMotion, rawCompany, {
      prospectId: task.prospectId,
      surface: task.surface,
      subject: obsoleteDraft.subject ?? null,
      body: obsoleteDraft.body ?? "",
      status: "discarded",
      authoredBy: obsoleteDraft.authoredBy ?? "agent",
      notes: "Discarded automatically after live LinkedIn profile inspection showed the branch should move to a direct-message path.",
    });
  }

  updateMotion(nextMotion);
  return {
    status: "completed",
    detail: {
      action: handoff.action,
      recipient: handoff.recipient?.profileUrl ?? null,
      reconciledProfileCapability: true,
      connectionDegree,
      isOpenProfile,
      nextStep: "direct-message",
    },
  };
}

/**
 * @param {any} task
 * @param {any} handoff
 * @param {any} result
 * @param {{ dryRun?: boolean }} [options]
 */
function maybeHandleUnavailableLinkedinReplyTask(task, handoff, result, options = {}) {
  const handled = classifyHandledLinkedinReplyUnavailable(task, handoff, result);
  if (!handled || options.dryRun === true) {
    return null;
  }

  const actionResult = recordActionResult({
    actionKey: "send_direct_message",
    resultKey: "unavailable",
    motionId: task.motionId ?? null,
    companyId: task.companyId ?? null,
    prospectId: task.prospectId ?? null,
    surface: task.surface ?? null,
    occurredAt: new Date().toISOString(),
    summary: handled.summary,
    notes: handled.reason,
    nextAction: null,
  });

  return {
    status: "completed",
    detail: {
      action: handoff.action,
      recipient: describeHandoffRecipient(handoff),
      replyUnavailable: true,
      handledException: true,
      reason: handled.reason,
      summary: handled.summary,
      actionResult: {
        actionKey: actionResult.actionResult.action.key,
        resultKey: actionResult.actionResult.result.key,
        surface: actionResult.actionResult.surface,
      },
    },
  };
}

/**
 * @param {any} task
 * @param {any} handoff
 * @param {any} result
 */
export function classifyHandledLinkedinReplyUnavailable(task, handoff, result) {
  if (!task || task.surface !== "inbound_reply") return null;
  if (handoff?.channel !== "linkedin" || handoff?.action !== "send_direct_message") return null;
  const status = normalizeNullableString(result?.status)?.toLowerCase() ?? null;
  if (status !== "blocked" && status !== "not_ready") return null;
  const reason = normalizeNullableString(result?.reason);
  if (!reason) return null;
  const lowered = reason.toLowerCase();
  const readOnlyThread = lowered.includes("read_only") || lowered.includes("read-only") || lowered.includes("readonly");
  const replyDisabled = (
    lowered.includes("disabledfeatures") && lowered.includes("reply")
  ) || lowered.includes("reply is disabled");
  if (!readOnlyThread || !replyDisabled) return null;
  return {
    summary: "Could not send the governed LinkedIn reply because the thread is read-only and reply is disabled.",
    reason,
  };
}

/** @param {any} handoff @param {{ dryRun?: boolean | undefined, verifyFirst?: boolean | undefined }} [options] */
function maybeRunLinkedinSendWithPlaywriter(handoff, options = {}) {
  if (!supportsDirectLinkedinPlaywriterSend(handoff)) {
    return null;
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const session = ensurePlaywriterSession({
      profileDirectory: handoff.browserProfile.profileDirectory,
      expectedHandle: handoff.sender?.accountRefs?.linkedin ?? null,
      capability: "linkedin",
      targetUrl: handoff.recipient.profileUrl,
      allowReuseExisting: false,
      forceWindowPreflight: true,
    });
    if (!session.ok || !session.sessionId) {
      return {
        status: "blocked",
        reason: `playwriter_session_failed: ${session.reason ?? "could not prepare a Playwriter session for LinkedIn send."}`,
      };
    }

    let shouldDeleteSession = !session.reused;
    try {
      if (options.verifyFirst === true) {
        const verification = sendLinkedinMessageWithPlaywriter({
          sessionId: session.sessionId,
          playwriterBin: session.playwriterBin,
          handoff,
          dryRun: true,
          timeoutMs: Math.min(BROWSER_TIMEOUT_MS, 180000),
        });
        if (verification?.status !== "ready_to_send" && verification?.status !== "sent") {
          if (attempt === 1 && shouldRetryPlaywriterTransportResult(verification)) {
            shouldDeleteSession = true;
          } else {
            return verification;
          }
        }
      }

      const result = sendLinkedinMessageWithPlaywriter({
        sessionId: session.sessionId,
        playwriterBin: session.playwriterBin,
        handoff,
        dryRun: options.dryRun === true,
        timeoutMs: BROWSER_TIMEOUT_MS,
      });
      if (attempt === 1 && shouldRetryPlaywriterTransportResult(result)) {
        shouldDeleteSession = true;
      } else {
        return result;
      }
    } catch (error) {
      const result = {
        status: "blocked",
        reason: `playwriter_send_failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      if (attempt === 1 && shouldRetryPlaywriterTransportResult(result)) {
        shouldDeleteSession = true;
      } else {
        return result;
      }
    } finally {
      if (shouldDeleteSession) {
        deletePlaywriterSession({
          sessionId: session.sessionId,
          playwriterBin: session.playwriterBin,
        });
      }
    }
  }

  return {
    status: "blocked",
    reason: "playwriter_send_failed: LinkedIn send did not complete after refreshing the Playwriter session.",
  };
}

/** @param {any} handoff */
function supportsDirectLinkedinPlaywriterSend(handoff) {
  return Boolean(
    handoff
    && handoff.status === "ready"
    && handoff.channel === "linkedin"
    && handoff.connector === "chrome"
    && typeof handoff.recipient?.profileUrl === "string"
    && handoff.recipient.profileUrl.trim().length
    && typeof handoff.browserProfile?.profileDirectory === "string"
    && handoff.browserProfile.profileDirectory.trim().length
    && (handoff.action === "send_connection_request" || handoff.action === "send_direct_message")
  );
}

/** @param {{ status?: string | null, reason?: string | null } | null | undefined } result */
function shouldRetryPlaywriterTransportResult(result) {
  const lowered = String(result?.reason ?? "").toLowerCase();
  return result?.status === "blocked" && (
    lowered.includes("fetch failed")
    || lowered.includes("session ")
    || lowered.includes("run 'playwriter session new' first")
    || lowered.includes("socket hang up")
    || lowered.includes("target page, context or browser has been closed")
    || lowered.includes("econnreset")
  );
}

/** @param {any} task */
function maybeRunLinkedinMaintenanceWithPlaywriter(task) {
  const binding = resolveLinkedinMaintenanceBinding(task);
  if (!binding) {
    return null;
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const session = ensurePlaywriterSession({
      profileDirectory: binding.profileDirectory,
      expectedHandle: binding.expectedHandle,
      capability: "linkedin",
      targetUrl: task.recipientUrl,
      allowReuseExisting: false,
      forceWindowPreflight: true,
    });
    if (!session.ok || !session.sessionId) {
      return {
        status: "blocked",
        reason: `playwriter_session_failed: ${session.reason ?? "could not prepare a Playwriter session for LinkedIn maintenance."}`,
      };
    }

    let shouldDeleteSession = !session.reused;
    try {
      const result = runLinkedinMaintenanceWithPlaywriter({
        sessionId: session.sessionId,
        playwriterBin: session.playwriterBin,
        task,
        timeoutMs: BROWSER_TIMEOUT_MS,
      });
      if (attempt === 1 && shouldRetryPlaywriterTransportResult(result)) {
        shouldDeleteSession = true;
      } else {
        return result;
      }
    } catch (error) {
      const result = {
        status: "blocked",
        reason: `playwriter_maintenance_failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      if (attempt === 1 && shouldRetryPlaywriterTransportResult(result)) {
        shouldDeleteSession = true;
      } else {
        return result;
      }
    } finally {
      if (shouldDeleteSession) {
        deletePlaywriterSession({
          sessionId: session.sessionId,
          playwriterBin: session.playwriterBin,
        });
      }
    }
  }

  return {
    status: "blocked",
    reason: "playwriter_maintenance_failed: LinkedIn maintenance did not complete after refreshing the Playwriter session.",
  };
}

/** @param {any} task */
function resolveLinkedinMaintenanceBinding(task) {
  if (typeof task?.recipientUrl !== "string" || !task.recipientUrl.trim()) {
    return null;
  }

  const rawProfiles = listBrowserProfiles();
  const rawUsers = listUsers();
  if (!Array.isArray(rawProfiles) || rawProfiles.length === 0 || !Array.isArray(rawUsers) || rawUsers.length === 0) {
    return null;
  }

  if (typeof task.companyId === "string" && task.companyId.trim()) {
    const rawCompany = findCompanyById(task.companyId);
    if (rawCompany) {
      const rawMotion = typeof task.motionId === "string" && task.motionId.trim()
        ? findMotionById(task.motionId)
        : null;
      const resolution = resolveScopedExecutionAssignment({
        rawCompany,
        rawMotion,
        rawProfiles,
        rawUsers,
        capability: "linkedin",
      });
      const profileDirectory = normalizeNullableString(resolution?.resolvedProfile?.profileDirectory);
      if (profileDirectory) {
        return {
          profileDirectory,
          expectedHandle: normalizeNullableString(resolution?.resolvedAccount?.handle),
        };
      }
    }
  }

  const readyCandidates = rawUsers
    .map((user) => resolveUserConnection(user, rawProfiles, { capability: "linkedin" }).resolved)
    .filter((candidate) => candidate?.status === "ready" && candidate.browserProfile?.profileDirectory);

  if (readyCandidates.length !== 1) {
    return null;
  }

  return {
    profileDirectory: readyCandidates[0].browserProfile.profileDirectory,
    expectedHandle: normalizeNullableString(readyCandidates[0].handle),
  };
}

/**
 * @param {any} rawMotion
 * @param {string} companyId
 * @param {string} prospectId
 * @param {string} surface
 */
function findProspectDraft(rawMotion, companyId, prospectId, surface) {
  const account = rawMotion?.targetMap?.accounts?.find((item) => item.companyId === companyId) ?? null;
  const prospect = account?.prospects?.find((item) => item.id === prospectId) ?? null;
  return (prospect?.drafts ?? []).find((draft) => draft.surface === surface && draft.status !== "sent" && draft.status !== "discarded") ?? null;
}

/** @param {any} task */
function runBrowserActionTask(task) {
  const directMaintenance = maybeRunLinkedinMaintenanceWithPlaywriter(task);
  if (directMaintenance) {
    if (directMaintenance.status !== "completed") {
      return {
        status: "blocked",
        detail: { reason: directMaintenance.reason ?? `${task.kind} did not complete.` },
      };
    }

    runShellText(task.writeback);
    return {
      status: "completed",
      detail: {
        action: task.kind,
        recipientUrl: task.recipientUrl ?? null,
        alreadySatisfied: directMaintenance.alreadySatisfied === true,
      },
    };
  }

  const result = runRecoveredBrowserCodexTask({
    prompt: buildBrowserActionPrompt(task),
    outputName: `${task.kind}-${task.motionId ?? "none"}-${task.prospectId ?? "none"}.json`,
    classifyBlockedReason: (payload) => classifyBrowserTransportBlockedReason(payload?.reason ?? null),
    timeoutMs: BROWSER_TIMEOUT_MS,
  });

  if (result.status !== "completed") {
    return {
      status: "blocked",
      detail: { reason: result.reason ?? `${task.kind} did not complete.` }
    };
  }

  runShellText(task.writeback);
  return {
    status: "completed",
    detail: { action: task.kind, recipientUrl: task.recipientUrl ?? null }
  };
}

/** @param {any} task */
function runInboundContract(task) {
  if (task.capability === "gmail") {
    return runExoJsonArgs([
      "inbound",
      "sync",
      "gmail-live",
      task.userId,
      "--account",
      task.accountId,
      "--mode",
      task.mode,
      "--json",
    ]);
  }

  if (task.capability === "linkedin") {
    return runExoJsonArgs([
      "inbound",
      "sync",
      "linkedin-live",
      task.userId,
      "--account",
      task.accountId,
      "--mode",
      task.mode,
      "--json",
    ]);
  }

  throw new Error(`Unsupported inbound capability: ${task.capability}`);
}

/**
 * @param {any} task
 * @param {any} payload
 */
function applyInboundPayload(task, payload) {
  const payloadPath = writeTempJsonFile(`inbound-payload-${task.capability}-${task.accountId}`, payload);
  try {
    const output = execFileSync(process.execPath, [
      "src/cli/index.js",
      "inbound",
      "sync",
      "run",
      task.userId,
      "--input",
      payloadPath,
      "--refresh",
      "--json",
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        EXO_STATE_DIR: STATE_DIR,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
      timeout: EXO_COMMAND_TIMEOUT_MS,
    });
    return parseJsonLoose(output);
  } catch (error) {
    throw new Error(`Could not apply inbound payload for ${task.capability}:${task.accountId}\n${buildExecErrorMessage(error)}`);
  } finally {
    safeUnlink(payloadPath);
  }
}

/**
 * @param {any} task
 * @param {any} capture
 */
function buildInboundPayload(task, capture) {
  const capturePath = writeTempJsonFile(`inbound-capture-${task.capability}-${task.accountId}`, capture);
  try {
    const command = task.capability === "linkedin" ? "linkedin" : task.capability === "gmail" ? "gmail" : null;
    if (!command) {
      throw new Error(`Unsupported inbound capability: ${task.capability}`);
    }

    const output = execFileSync(process.execPath, [
      "src/cli/index.js",
      "inbound",
      "sync",
      command,
      task.userId,
      "--account",
      task.accountId,
      "--input",
      capturePath,
      "--json",
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        EXO_STATE_DIR: STATE_DIR,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
      timeout: EXO_COMMAND_TIMEOUT_MS,
    });
    return parseJsonLoose(output);
  } catch (error) {
    throw new Error(`Could not build inbound payload for ${task.capability}:${task.accountId}\n${buildExecErrorMessage(error)}`);
  } finally {
    safeUnlink(capturePath);
  }
}

/**
 * @param {string} prefix
 * @param {any} payload
 */
function writeTempJsonFile(prefix, payload) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const filePath = path.join(TEMP_ROOT, `${prefix}-${token}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

/**
 * @param {string} filePath
 */
function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    // Best-effort cleanup only.
  }
}

/** @param {any} task @param {string} body */
function setDraft(task, body) {
  const args = [
    "src/cli/index.js",
    "companies",
    "prospects",
    "draft",
    "set",
    task.companyId,
    "--prospect",
    task.prospectId,
  ];
  if (task.motionId) {
    args.push("--motion", task.motionId);
  }
  args.push(
    "--surface",
    task.surface,
    "--status",
    task.postWriteStatus,
    "--body",
    body
  );
  execFileSync(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      EXO_STATE_DIR: STATE_DIR,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: EXO_COMMAND_TIMEOUT_MS,
  });
}

/**
 * @param {{
 *   prompt: string,
 *   schema: unknown,
 *   outputName: string,
 *   browserRequired: boolean,
 *   connectorRequired?: boolean,
 *   enabledPlugins?: string[] | undefined,
 *   enabledMcpServers?: string[] | undefined,
 *   useOutputSchema?: boolean,
 *   timeoutMs: number,
 * }} input
 */
function runCodexTask(input) {
  const tempDir = fs.mkdtempSync(path.join(TEMP_ROOT, "codex-task-"));
  const outputPath = path.join(tempDir, input.outputName);

  const args = [
    "exec",
    "--ephemeral",
    "--cd",
    ROOT,
    "--ignore-rules",
    "--sandbox",
    "danger-full-access",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "--output-last-message",
    outputPath,
  ];

  if (shouldIgnoreCodexUserConfig(input)) {
    args.push("--ignore-user-config");
  }

  if (input.useOutputSchema !== false) {
    const schemaPath = path.join(tempDir, "schema.json");
    fs.writeFileSync(schemaPath, JSON.stringify(sanitizeCodexOutputSchema(input.schema), null, 2));
    args.push("--output-schema", schemaPath);
  }

  if (input.browserRequired) {
    args.push(
      "-c",
      'model_reasoning_effort="medium"',
      "-c",
      'mcp_servers.playwriter.enabled=false',
      "-c",
      'mcp_servers.icypeas.enabled=false',
      "-c",
      'mcp_servers.leadmagic.enabled=false',
      "-c",
      'mcp_servers.prospeo.enabled=false'
    );
  } else if (input.connectorRequired) {
    args.push(
      "-c",
      'model_reasoning_effort="medium"'
    );
  }

  for (const pluginId of input.browserRequired
    ? ["chrome@openai-bundled"]
    : normalizePluginIds(input.enabledPlugins)) {
    args.push("-c", `plugins."${pluginId}".enabled=true`);
  }

  for (const mcpServerId of normalizePluginIds(input.enabledMcpServers)) {
    args.push("-c", `mcp_servers.${mcpServerId}.enabled=true`);
  }

  args.push("-");

  try {
    execFileSync(CODEX_BIN, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        CODEX_HOME,
      },
      encoding: "utf8",
      input: input.prompt,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: input.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const message = buildExecErrorMessage(error);
    throw new Error(`Codex task failed: ${message}`);
  }

  const raw = fs.readFileSync(outputPath, "utf8");
  return parseJsonLoose(raw);
}

/**
 * @param {{
 *   prompt: string,
 *   schema?: unknown,
 *   outputName: string,
 *   enabledPlugins?: string[] | undefined,
 *   enabledMcpServers?: string[] | undefined,
 *   timeoutMs: number,
 * }} input
 */
function runConnectorCodexTask(input) {
  return runCodexTask({
    prompt: input.prompt,
    schema: input.schema ?? null,
    outputName: input.outputName,
    browserRequired: false,
    connectorRequired: true,
    enabledPlugins: input.enabledPlugins ?? [],
    enabledMcpServers: input.enabledMcpServers ?? [],
    useOutputSchema: false,
    timeoutMs: input.timeoutMs,
  });
}

/**
 * @param {{
 *   prompt: string,
 *   schema?: unknown,
 *   outputName: string,
 *   classifyBlockedReason?: ((payload: any) => string | null),
 *   timeoutMs: number,
 * }} input
 */
function runRecoveredBrowserCodexTask(input) {
  const firstAttempt = runBrowserCodexTaskOnce(input);
  if (!firstAttempt.shouldRetry) {
    if (firstAttempt.error) throw firstAttempt.error;
    return firstAttempt.result;
  }

  const preflight = fs.existsSync(PREFLIGHT_PATH)
    ? parseJsonLoose(fs.readFileSync(PREFLIGHT_PATH, "utf8"))
    : buildAndPersistPreflight();
  const opened = openSelectedChromeWindow(preflight);
  if (!opened.ok) {
    if (firstAttempt.error) throw firstAttempt.error;
    return firstAttempt.result;
  }

  sleepMs(CHROME_WINDOW_BOOTSTRAP_WAIT_MS);
  const secondAttempt = runBrowserCodexTaskOnce(input);
  if (secondAttempt.error) throw secondAttempt.error;
  return secondAttempt.result;
}

/**
 * @param {{
 *   prompt: string,
 *   schema?: unknown,
 *   outputName: string,
 *   classifyBlockedReason?: ((payload: any) => string | null),
 *   timeoutMs: number,
 * }} input
 */
function runBrowserCodexTaskOnce(input) {
  try {
    const result = runCodexTask({
      prompt: input.prompt,
      schema: input.schema ?? null,
      outputName: input.outputName,
      browserRequired: true,
      useOutputSchema: false,
      timeoutMs: input.timeoutMs,
    });
    const blockedReason = input.classifyBlockedReason?.(result) ?? null;
    return {
      result,
      error: null,
      shouldRetry: shouldRetryChromeAttachWithProfileWindow(blockedReason),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: null,
      error: error instanceof Error ? error : new Error(message),
      shouldRetry: shouldRetryChromeAttachWithProfileWindow(message),
    };
  }
}

/** @param {string[]} commands */
function runVerificationCommands(commands) {
  return commands.map((command) => ({
    ...runVerificationCommand(command),
  }));
}

/** @param {string} command */
function runVerificationCommand(command) {
  const startedAt = Date.now();
  const output = runShellText(command).trim();
  const elapsedMs = Date.now() - startedAt;
  const entry = {
    command,
    elapsedMs,
    summary: summarizeVerificationOutput(command, output),
  };
  if (normalizeBoolean(process.env.EXO_AGENT_INCLUDE_VERIFICATION_OUTPUT, false)) {
    return {
      ...entry,
      output: truncateVerificationOutput(output),
    };
  }
  return entry;
}

/**
 * @param {string} command
 * @param {string} output
 */
export function summarizeVerificationOutput(command, output) {
  const parsed = tryParseJsonLoose(output);
  if (!parsed || typeof parsed !== "object") {
    return {
      kind: "text",
      preview: truncateVerificationOutput(output, 240),
    };
  }

  if (/\bexo\s+inbox\b/.test(command)) {
    return {
      kind: "inbox",
      counts: pickFields(parsed.counts, [
        "itemCount",
        "highPriorityCount",
        "mediumPriorityCount",
        "lowPriorityCount",
      ]),
      uncheckedSurfaceCount: parsed.surfaces?.uncheckedSurfaceCount ?? null,
      actionableSurfaceCount: parsed.surfaces?.actionableSurfaceCount ?? null,
    };
  }

  if (/\bexo\s+daily\b/.test(command)) {
    return {
      kind: "daily",
      counts: pickFields(parsed.counts, [
        "itemCount",
        "dueNowCount",
        "waitingCount",
        "replyPriorityCount",
        "actionPriorityCount",
        "waitPriorityCount",
      ]),
      topPriority: parsed.items?.[0]?.priority ?? null,
      topRecommendation: parsed.items?.[0]?.recommendedAction ?? null,
    };
  }

  if (/\bexo\s+next\b/.test(command)) {
    return {
      kind: "next",
      source: parsed.source ?? null,
      nextMove: parsed.nextMove ?? null,
      operatorPrompt: parsed.operatorPrompt ?? null,
      priority: parsed.status?.priority ?? null,
      dueAt: parsed.status?.dueAt ?? null,
    };
  }

  return {
    kind: "json",
    keys: Object.keys(parsed).slice(0, 8),
  };
}

/**
 * @param {unknown} value
 */
function tryParseJsonLoose(value) {
  try {
    return parseJsonLoose(value);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, any> | null | undefined} source
 * @param {string[]} keys
 */
function pickFields(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * @param {string} output
 * @param {number} [maxChars]
 */
function truncateVerificationOutput(output, maxChars = VERIFICATION_OUTPUT_MAX_CHARS) {
  const text = String(output ?? "").trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildAndPersistPreflight() {
  const preflight = buildPreflightSummary({ stateDir: STATE_DIR, codexHome: CODEX_HOME });
  fs.mkdirSync(path.dirname(PREFLIGHT_PATH), { recursive: true });
  fs.writeFileSync(PREFLIGHT_PATH, JSON.stringify(preflight, null, 2));
  return preflight;
}

function loadHostState() {
  if (!fs.existsSync(HOST_STATE_PATH)) {
    return normalizeAgentHostState(null);
  }

  return pruneExpiredBrowserBackoffs(parseJsonLoose(fs.readFileSync(HOST_STATE_PATH, "utf8")));
}

/** @param {any} state */
function saveHostState(state) {
  fs.mkdirSync(path.dirname(HOST_STATE_PATH), { recursive: true });
  fs.writeFileSync(HOST_STATE_PATH, JSON.stringify(state, null, 2));
}

function loadQueue() {
  return buildAgentQueue({
    motions: listMotions(),
    companies: listCompanies(),
    users: listUsers(),
    observations: listInboundObservations(),
    cues: listInboundCues(),
    includeWaitingRetrieval: isRetrievalForceEnabled(),
  });
}

/** @param {ReturnType<typeof loadQueue>} queue */
function summarizeQueue(queue) {
  return {
    dueTaskCount: queue.tasks.length,
    waitingTaskCount: queue.waiting.length,
    blockerCount: (queue.blockers ?? []).length,
  };
}

/** @param {any} task */
function normalizeQueueTaskSortTime(task) {
  return normalizeIsoDatetime(task?.dueAt)
    ?? normalizeIsoDatetime(task?.queuedAt)
    ?? normalizeIsoDatetime(task?.approvedAt)
    ?? "9999-12-31T23:59:59.999Z";
}

/** @param {any} brief */
export function buildDraftPrompt(brief) {
  return [
    "Write exactly one governed Exo draft from the brief below.",
    "You are running in a detached background pass.",
    "Do not browse, do not inspect the repo, do not narrate your process, and do not ask questions.",
    "Return only JSON that matches the provided schema.",
    "The schema has one field only: body. Put the exact outbound copy there and nothing else.",
    "Style rules: plain human copy, concise, specific, no em dashes, no throat-clearing, no AI language.",
    "",
    "Brief JSON:",
    JSON.stringify(brief, null, 2),
  ].join("\n");
}

/** @param {unknown} response */
export function extractDraftBodyFromCodexResponse(response) {
  const body = extractUsableDraftBody(response);
  return typeof body === "string" && body.trim().length ? body.trim() : null;
}

/** @param {any} captureRequest @param {string|null|undefined} [connector] */
export function buildInboundCapturePrompt(captureRequest, connector = null) {
  if (requiresBrowserAttachForInboundCapture(captureRequest)) {
    return buildChromeNativePrompt(
      [
        "This is one bounded Exo inbound retrieval task.",
        "Do not inspect the repo, do not read Exo state, do not run exo what-is-this, and do not narrate.",
        "Do one Chrome connector attach attempt and one retry after 2 seconds if the first attempt cannot attach.",
        "If it still cannot attach, return a failed JSON capture result that matches the schema with a concrete error string.",
        "Do not run diagnostics, do not open new Chrome windows, do not ask for approval, and do not fall back to Playwriter or shell commands.",
        "",
        captureRequest.prompt,
      ],
      connector,
    );
  }

  return [
    "This is one bounded Exo inbound retrieval task.",
    "Do not inspect the repo, do not read Exo state, do not run exo what-is-this, and do not narrate.",
    `Use the native ${connector ?? "connector"} tools already available in this runtime. Do not use Chrome browser tools.`,
    "Do not run diagnostics, do not open browser windows, do not ask for approval, and do not fall back to Playwriter or shell commands.",
    "",
    captureRequest.prompt,
  ].join("\n");
}

/** @param {any} brief @param {any} task */
export function buildCompanyResearchPrompt(brief, task) {
  return [
    "This is one bounded Exo company research packet.",
    "Do not inspect arbitrary repo files, do not read arbitrary Exo state, do not run exo what-is-this, and do not narrate.",
    "Use the runtime's native web retrieval capabilities for the actual research. Do not use browser tools or open Chrome windows.",
    "Start with the company site, then broaden to public web or news only if needed by the brief.",
    "Use shell commands only for the governed Exo writeback commands needed to store findings and complete the packet.",
    "Work only this one company. Persist only concise, writer-usable signal summaries. No em dashes.",
    "Before returning completed, run the governed Exo writeback commands needed to store the strongest evidence and complete the packet as researched, suppressed, or exhausted.",
    "Return only JSON with exactly these fields: status, completionStatus, summary, reason.",
    "",
    "Task JSON:",
    JSON.stringify(task, null, 2),
    "",
    "Governed packet brief JSON:",
    JSON.stringify(brief, null, 2),
  ].join("\n");
}

/** @param {any} handoff @param {{ dryRun?: boolean | undefined }} [options] */
export function buildSendPrompt(handoff, options = {}) {
  const dryRun = options.dryRun === true;
  if (usesConnectorNativeSend(handoff)) {
    const connectorLabel = connectorToolLabel(handoff.connector);
    return [
      "This is one bounded Exo connector send task.",
      "Do not inspect the repo, do not read Exo state, do not run exo what-is-this, and do not narrate.",
      dryRun
        ? "Prepare the governed send and stop before the final send action."
        : "Perform the governed send and nothing else.",
      `Use the native ${connectorLabel} tools already available in this runtime. Do not use Chrome browser tools.`,
      "Do not run diagnostics, do not open browser windows, do not switch identities, do not fall back to shell commands, and do not paraphrase the stored message.",
      dryRun
        ? "Do not send yet. After the exact governed subject/body are loaded into the correct composer and are ready for a real send, return {\"status\":\"ready_to_send\",\"reason\":null}."
        : "Do not run Exo writeback yourself. After the real send happens, return {\"status\":\"sent\",\"reason\":null}.",
      "",
      "Governed send contract JSON:",
      JSON.stringify(handoff, null, 2),
    ].join("\n");
  }
  return buildChromeNativePrompt([
    "This is one bounded Exo browser send task.",
    "Do not inspect the repo, do not read Exo state, do not run exo what-is-this, and do not narrate.",
    dryRun
      ? "Prepare the governed send and stop before the final click."
      : "Perform the governed send and nothing else.",
    "Do one Chrome connector attach attempt and one retry after 2 seconds if the first attempt cannot attach.",
    "If it still cannot attach, return {\"status\":\"blocked\",\"reason\":\"<concrete reason>\"}.",
    "Do not run diagnostics, do not open new Chrome windows, do not switch profiles, do not use Playwriter, and do not paraphrase the stored message.",
    dryRun
      ? "Do not click Send. After the exact governed message is loaded into a writable composer and is ready for a real send, return {\"status\":\"ready_to_send\",\"reason\":null}."
      : "Do not run Exo writeback yourself. After the real send happens, return {\"status\":\"sent\",\"reason\":null}.",
    "",
    "Governed send contract JSON:",
    JSON.stringify(handoff, null, 2),
  ]);
}

/** @param {any} task */
export function buildBrowserActionPrompt(task) {
  const actionLine = task.kind === "withdraw_connection"
    ? `Withdraw the stale outbound LinkedIn invitation for ${task.prospectName}.`
    : task.kind === "reject_connection_request"
      ? `Decline the inbound LinkedIn invitation from ${task.prospectName}.`
      : `Unfollow ${task.prospectName} on LinkedIn.`;

  return buildChromeNativePrompt([
    "This is one bounded Exo browser maintenance task.",
    "Do not inspect the repo, do not read Exo state, do not run exo what-is-this, and do not narrate.",
    actionLine,
    "Use native Chrome tools only.",
    "Do one Chrome connector attach attempt and one retry after 2 seconds if the first attempt cannot attach.",
    "If it still cannot attach, return {\"status\":\"blocked\",\"reason\":\"<concrete reason>\"}.",
    "Do not run diagnostics, do not open new Chrome windows, and do not use Playwriter or shell fallbacks.",
    "Do not run Exo writeback yourself. After the real browser action happens, return {\"status\":\"completed\",\"reason\":null}.",
    "",
    "Task JSON:",
    JSON.stringify(task, null, 2),
  ]);
}

export function buildBrowserAttachProbePrompt() {
  return buildChromeNativePrompt([
    "This is a detached background Chrome attach probe with a complete supplied contract.",
    "Do not inspect the repo, do not read Exo state, do not run exo what-is-this, and do not narrate.",
    "Use the Chrome browser plugin only.",
    "Do not use shell commands, npm packages, or repo inspection.",
    "Do not import or require playwright.",
    "Do one lightweight browser-client call such as listing open tabs after bootstrap.",
    "Do not open new windows. Do not use Playwriter. Do not ask for approval.",
    "Return only JSON: {\"status\":\"ok\",\"reason\":null} or {\"status\":\"blocked\",\"reason\":\"<concrete reason>\"}.",
  ]);
}

function ensureChromeTransportReady(preflight) {
  const initial = runChromeAttachProbe();
  if (initial.status === "ok") {
    return { status: "ok", reason: null };
  }

  if (!shouldRetryChromeAttachWithProfileWindow(initial.reason ?? null)) {
    return initial;
  }

  const recovered = openSelectedChromeWindow(preflight);
  if (!recovered.ok) {
    return {
      status: "blocked",
      reason: recovered.reason ?? initial.reason ?? "Chrome transport is blocked.",
    };
  }

  sleepMs(2000);
  return runChromeAttachProbe();
}

/** @param {any} captureRequest */
export function requiresBrowserAttachForInboundCapture(captureRequest) {
  return captureRequest?.captureTransportMode !== "connector_native_only";
}

function runChromeAttachProbe() {
  const result = runCodexTask({
    prompt: buildBrowserAttachProbePrompt(),
    schema: null,
    outputName: "chrome-attach-probe.json",
    browserRequired: true,
    useOutputSchema: false,
    timeoutMs: CHROME_ATTACH_TIMEOUT_MS,
  });

  return {
    status: result?.status === "ok" ? "ok" : "blocked",
    reason: typeof result?.reason === "string" && result.reason.trim().length ? result.reason.trim() : null,
  };
}

export function shouldRetryChromeAttachWithProfileWindow(reason) {
  return typeof reason === "string" && /browser is not available: extension/i.test(reason);
}

/** @param {unknown} value */
function classifyBrowserTransportBlockedReason(value) {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length ? reason : null;
}

/**
 * @param {any} task
 * @param {string} reason
 */
function buildFailedInboundCapture(task, reason) {
  const checkedAt = new Date().toISOString();
  if (task.capability === "linkedin") {
    return {
      mode: task.mode === "full" ? "full" : "quick",
      status: "failed",
      checkedAt,
      error: reason,
    };
  }

  return {
    mode: task.mode === "full" ? "full" : "quick",
    status: "failed",
    checkedAt,
    itemCount: 0,
    threads: [],
    error: reason,
  };
}

function openSelectedChromeWindow(preflight) {
  const pluginRoot = typeof preflight?.browser?.pluginRoot === "string" ? preflight.browser.pluginRoot : null;
  if (!pluginRoot) {
    return {
      ok: false,
      reason: "Chrome plugin root is unavailable, so the host runner cannot open the selected Chrome profile window.",
    };
  }

  const scriptPath = path.join(pluginRoot, "scripts", "open-chrome-window.js");
  try {
    const output = execFileSync(process.execPath, [scriptPath], {
      cwd: ROOT,
      env: {
        ...process.env,
        EXO_STATE_DIR: STATE_DIR,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      reason: null,
      output,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `Could not open the selected Chrome profile window.\n${buildExecErrorMessage(error)}`,
    };
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function buildChromeNativePrompt(lines, connector = "chrome") {
  if (connector && connector !== "chrome") {
    return lines.join("\n");
  }
  return ["@chrome", ...lines].join("\n");
}

function isSendDryRunEnabled() {
  return getSendMode() === "verify";
}

function isBrowserBackoffIgnored() {
  return normalizeBoolean(process.env.EXO_AGENT_IGNORE_BROWSER_BACKOFF, false) || isSendDryRunEnabled();
}

function isRetrievalForceEnabled() {
  return normalizeBoolean(process.env.EXO_AGENT_FORCE_RETRIEVAL, false);
}

function getSendMode() {
  const explicit = String(process.env.EXO_AGENT_SEND_MODE ?? "").trim().toLowerCase();
  if (explicit === "verify" || explicit === "live" || explicit === "canary") {
    return explicit;
  }
  return normalizeBoolean(process.env.EXO_AGENT_SEND_DRY_RUN, false) ? "verify" : "live";
}

export function getPreflightTaskGate(preflight, taskKind) {
  const blockedReasons = Array.isArray(preflight?.browser?.blockedReasons)
    ? preflight.browser.blockedReasons.filter((reason) => typeof reason === "string" && reason.trim().length)
    : [];
  const taskPolicy = preflight?.browser?.taskReadiness?.[taskKind] ?? null;
  if (taskPolicy && taskPolicy.ready === false) {
    const reasons = Array.isArray(taskPolicy.blockedReasons)
      ? taskPolicy.blockedReasons.filter((reason) => typeof reason === "string" && reason.trim().length)
      : [];
    return {
      allowed: false,
      reason: reasons.join(" "),
    };
  }
  if (blockedReasons.length) {
    return {
      allowed: false,
      reason: blockedReasons.join(" "),
    };
  }
  return {
    allowed: true,
    reason: null,
  };
}

function augmentBrowserTaskReason(reason, preflight) {
  const base = typeof reason === "string" && reason.trim().length ? reason.trim() : null;
  const warnings = Array.isArray(preflight?.browser?.warnings)
    ? preflight.browser.warnings.filter((warning) => typeof warning === "string" && warning.trim().length)
    : [];
  if (!warnings.length) {
    return base;
  }
  const warningText = warnings.join(" ");
  if (!base) return warningText;
  return `${base} Environment warning: ${warningText}`;
}

/**
 * @param {string} command
 * @param {{ stdin?: string | undefined }} [options]
 */
function runShellJson(command, options = {}) {
  return parseJsonLoose(runShellText(command, options));
}

/**
 * @param {string} command
 * @param {{ stdin?: string | undefined }} [options]
 */
function runShellText(command, options = {}) {
  try {
    return execFileSync("zsh", ["-lc", command], {
      cwd: ROOT,
      env: {
        ...process.env,
        EXO_STATE_DIR: STATE_DIR,
      },
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      input: options.stdin,
      maxBuffer: 10 * 1024 * 1024,
      timeout: SHELL_COMMAND_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${buildExecErrorMessage(error)}`);
  }
}

/** @param {string[]} args */
function runExoJsonArgs(args) {
  try {
    const output = execFileSync(process.execPath, ["src/cli/index.js", ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        EXO_STATE_DIR: STATE_DIR,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
      timeout: EXO_COMMAND_TIMEOUT_MS,
    });
    return parseJsonLoose(output);
  } catch (error) {
    throw new Error(`Exo command failed: ${args.join(" ")}\n${buildExecErrorMessage(error)}`);
  }
}

/**
 * @param {string} motionId
 * @param {string} companyId
 */
function findMotionTargetAccountState(motionId, companyId) {
  const motion = runExoJsonArgs([
    "motion",
    "show",
    motionId,
    "--json",
  ]);
  return (motion?.targetMap?.accounts ?? []).find((account) => account?.companyId === companyId) ?? null;
}

/** @param {unknown} value */
function parseJsonLoose(value) {
  const text = String(value ?? "").trim();
  if (!text.length) {
    throw new Error("Expected JSON output but command returned nothing.");
  }

  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }
    throw new Error(`Could not parse JSON output: ${truncate(text, 400)}`);
  }
}

/** @param {unknown} error */
function buildExecErrorMessage(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.message];
  const stdout = "stdout" in error ? String(error.stdout ?? "").trim() : "";
  const stderr = "stderr" in error ? String(error.stderr ?? "").trim() : "";
  if (stdout) parts.push(`stdout=${truncate(stdout, 600)}`);
  if (stderr) parts.push(`stderr=${truncate(stderr, 600)}`);
  return parts.join(" | ");
}

/** @param {unknown} error */
export function normalizeInboundCaptureFailureReason(error) {
  const message = buildExecErrorMessage(error);
  if (/ETIMEDOUT/i.test(message)) {
    return "codex_capture_timeout";
  }
  if (/invalid plugin key `posthog`/i.test(message)) {
    return "codex_capture_startup_failed";
  }
  return truncate(message, 240);
}

/**
 * @param {string | null | undefined} connector
 * @returns {string[]}
 */
function resolveCodexConnectorPluginIds(connector) {
  return resolveCodexConnectorRuntimeConfig(connector).pluginIds;
}

/**
 * @param {string | null | undefined} connector
 * @returns {string[]}
 */
function resolveCodexConnectorMcpServerIds(connector) {
  return resolveCodexConnectorRuntimeConfig(connector).mcpServerIds;
}

/**
 * @param {string | null | undefined} connector
 * @returns {{ pluginIds: string[], mcpServerIds: string[] }}
 */
export function resolveCodexConnectorRuntimeConfig(connector) {
  const normalized = normalizeConnectorPluginKey(connector);
  if (!normalized) {
    return {
      pluginIds: [],
      mcpServerIds: [],
    };
  }
  return CODEX_CONNECTOR_RUNTIME_CONFIG[normalized] ?? {
    pluginIds: [],
    mcpServerIds: [],
  };
}

/** @param {string | null | undefined} connector */
function normalizeConnectorPluginKey(connector) {
  const normalized = normalizeNullableString(connector)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  const parts = normalized.split(":").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

/**
 * @param {string[] | undefined} pluginIds
 * @returns {string[]}
 */
function normalizePluginIds(pluginIds) {
  if (!Array.isArray(pluginIds) || !pluginIds.length) {
    return [];
  }
  return [...new Set(pluginIds.map((id) => String(id).trim()).filter(Boolean))];
}

/**
 * @param {{ connectorRequired?: boolean | undefined }} input
 */
export function shouldIgnoreCodexUserConfig(input) {
  return input?.connectorRequired !== true;
}

/** @param {any} handoff */
function usesConnectorNativeSend(handoff) {
  return handoff?.executionPolicy?.mode === "native_connector_tools_only";
}

/** @param {string | null | undefined} connector */
function connectorToolLabel(connector) {
  return normalizeConnectorPluginKey(connector) ?? "connector";
}

/** @param {any} handoff */
function describeHandoffRecipient(handoff) {
  return handoff?.recipient?.profileUrl
    ?? handoff?.recipient?.email
    ?? handoff?.recipient?.threadUrl
    ?? null;
}

/** @param {string | undefined} raw @param {number} fallback */
function normalizePositiveInteger(raw, fallback) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** @param {string | undefined} raw @param {boolean} fallback */
function normalizeBoolean(raw, fallback) {
  if (raw == null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized.length) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/** @param {string} text @param {number} max */
function truncate(text, max) {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** @param {unknown} value */
function normalizeNullableString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** @param {string} moduleUrl */
function isMainModule(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === moduleUrl;
}

/** @param {unknown} raw */
export function sanitizeCodexOutputSchema(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => sanitizeCodexOutputSchema(item));
  }

  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "format") continue;
    sanitized[key] = sanitizeCodexOutputSchema(value);
  }
  return sanitized;
}

/**
 * @param {any} capture
 * @param {string} capability
 */
export function normalizeInboundCaptureForWriteback(capture, capability) {
  if (capability === "linkedin") {
    return normalizeLinkedinCaptureForWriteback(capture);
  }

  const checkedAt = normalizeIsoDatetime(capture?.checkedAt) ?? new Date().toISOString();
  const threads = Array.isArray(capture?.threads)
    ? capture.threads.map((thread) => ({
      ...thread,
      observedAt: normalizeIsoDatetime(thread?.observedAt) ?? checkedAt,
    }))
    : [];
  const status = typeof capture?.status === "string" ? capture.status : "failed";
  const itemCount = Number.isInteger(capture?.itemCount)
    ? capture.itemCount
    : (status === "failed" ? 0 : threads.length);
  const error = status === "success"
    ? null
    : (typeof capture?.error === "string" && capture.error.trim().length
      ? capture.error.trim()
      : `${capability} capture failed`);

  return {
    ...capture,
    checkedAt,
    threads,
    itemCount,
    error,
  };
}

/** @param {any} capture */
function normalizeLinkedinCaptureForWriteback(capture) {
  const mode = capture?.mode === "full" ? "full" : "quick";
  const checkedAt = normalizeIsoDatetime(capture?.checkedAt) ?? new Date().toISOString();
  const status = typeof capture?.status === "string" ? capture.status : "failed";
  const explicitError = typeof capture?.error === "string" && capture.error.trim().length
    ? capture.error.trim()
    : (typeof capture?.reason === "string" && capture.reason.trim().length
      ? capture.reason.trim()
      : null);
  const error = status === "failed"
    ? (explicitError ?? "linkedin capture failed")
    : explicitError;
  const requiredSurfaces = [
    "sentInvitations",
    "receivedInvitations",
    "messagingInbox",
    "profileViews",
    "followersList",
    "followingList",
  ];
  const hasFullShape = requiredSurfaces.every((key) => capture && typeof capture[key] === "object" && capture[key] !== null);
  if (!hasFullShape) {
    return {
      mode,
      status,
      checkedAt,
      itemCount: 0,
      error,
      sentInvitations: buildFailedLinkedinSurface(mode, checkedAt, error),
      receivedInvitations: buildFailedLinkedinSurface(mode, checkedAt, error),
      messagingInbox: buildFailedLinkedinSurface(mode, checkedAt, error),
      profileViews: buildFailedLinkedinSurface(mode, checkedAt, error),
      followersList: buildFailedLinkedinSurface(mode, checkedAt, error),
      followingList: buildFailedLinkedinSurface(mode, checkedAt, error),
    };
  }

  const normalized = { ...capture, mode, status, checkedAt, error };
  for (const surfaceKey of requiredSurfaces) {
    normalized[surfaceKey] = normalizeLinkedinSurfaceCapture(capture[surfaceKey], mode);
  }
  normalized.itemCount = requiredSurfaces.reduce(
    (sum, surfaceKey) => sum + (Number.isInteger(normalized[surfaceKey]?.itemCount) ? normalized[surfaceKey].itemCount : 0),
    0,
  );
  return normalized;
}

function buildFailedLinkedinSurface(mode, checkedAt, error) {
  return {
    status: "failed",
    checkedAt,
    itemCount: 0,
    visibleTotalCount: null,
    captureCompleteness: "failed",
    requestedMode: mode,
    actualMode: mode,
    reconcileRequired: null,
    reconcileReason: null,
    exhaustionStatus: "blocked",
    exhaustionReason: "transport_failure",
    paginationAttempted: false,
    terminalSignalSeen: false,
    stalledPassCount: 0,
    error,
    items: [],
  };
}

function normalizeLinkedinSurfaceCapture(surface, mode) {
  const checkedAt = normalizeIsoDatetime(surface?.checkedAt) ?? new Date().toISOString();
  const items = Array.isArray(surface?.items) ? surface.items : [];
  const status = typeof surface?.status === "string" ? surface.status : "failed";
  return {
    status,
    checkedAt,
    itemCount: Number.isInteger(surface?.itemCount) ? surface.itemCount : (status === "failed" ? 0 : items.length),
    visibleTotalCount: Number.isInteger(surface?.visibleTotalCount) ? surface.visibleTotalCount : null,
    captureCompleteness: surface?.captureCompleteness ?? (status === "failed" ? "failed" : "partial_visible_slice"),
    requestedMode: surface?.requestedMode ?? mode,
    actualMode: surface?.actualMode ?? mode,
    reconcileRequired: typeof surface?.reconcileRequired === "boolean" ? surface.reconcileRequired : null,
    reconcileReason: typeof surface?.reconcileReason === "string" ? surface.reconcileReason : null,
    exhaustionStatus: surface?.exhaustionStatus ?? (status === "failed" ? "blocked" : "incomplete"),
    exhaustionReason: typeof surface?.exhaustionReason === "string" ? surface.exhaustionReason : null,
    paginationAttempted: typeof surface?.paginationAttempted === "boolean" ? surface.paginationAttempted : false,
    terminalSignalSeen: typeof surface?.terminalSignalSeen === "boolean" ? surface.terminalSignalSeen : false,
    stalledPassCount: Number.isInteger(surface?.stalledPassCount) ? surface.stalledPassCount : 0,
    error: status === "success"
      ? null
      : (typeof surface?.error === "string" && surface.error.trim().length ? surface.error.trim() : "linkedin capture failed"),
    items,
  };
}

function buildAutonomousWorkerLabel() {
  const user = normalizeWorkerLabelSegment(safeOsUsername());
  const host = normalizeWorkerLabelSegment(os.hostname());
  return [user, host].filter(Boolean).join("@") || "codex-agent";
}

function safeOsUsername() {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? process.env.LOGNAME ?? "operator";
  }
}

/** @param {unknown} value */
function normalizeWorkerLabelSegment(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;
  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** @param {unknown} value */
function normalizeIsoDatetime(value) {
  if (typeof value !== "string" || !value.trim().length) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}
