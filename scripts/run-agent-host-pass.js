#!/usr/bin/env node
// @ts-check

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildAgentQueue, isBackfillInboundSyncTask } from "../src/core/build-agent-queue.js";
import { buildStalePacketReviewWarnings } from "../src/core/build-stale-packet-review-warnings.js";
import {
  applyInboundIdentityResolutionResult,
  buildInboundIdentityResolutionCompanyProfile,
  needsInboundIdentityResolution,
  resolveManagedLinkedinAccount,
} from "../src/core/inbound-identity-resolution.js";
import { inboundObservationsSharePersonIdentity } from "../src/core/inbound-observations.js";
import { buildInboundAutomationHealthWarnings, buildInboundAutomationWarnings } from "../src/core/user-inbound-sync.js";
import {
  findInboundObservationById,
  findUserById,
  findCompanyById,
  findMotionById,
  insertCompany,
  listAgentQueueProspectBranches,
  listCompanies,
  listInboundCues,
  listInboundObservations,
  listMotions,
  listUsers,
  updateCompany,
  updateMotion,
  upsertInboundObservation,
} from "../src/db/database.js";
import { updateMotionProspect } from "../src/core/record-prospect.js";
import { setMotionProspectCadence } from "../src/core/set-prospect-cadence.js";
import { setMotionProspectDraft } from "../src/core/set-prospect-draft.js";
import { claimMotionTargetAccountPacket } from "../src/core/claim-target-account-packet.js";
import { claimMotionProspectPacket } from "../src/core/claim-motion-prospect-packet.js";
import { recordActionResult } from "../src/core/record-action-result.js";
import {
  BROWSER_TRANSPORT_TASK_KINDS,
  clearBrowserBackoffForTask,
  checkoutTaskLease,
  getCanaryCooldown,
  clearSendCircuitBreaker,
  createTaskLeaseFingerprint,
  createTaskVerificationFingerprint as createHostStateTaskVerificationFingerprint,
  getActiveTaskLease,
  getRecentMotionRunAt,
  getBrowserBackoffForTask,
  getRecentMotionTaskRunAt,
  getRecentTaskVerification,
  getRuntimeUsageLimit,
  getSendCircuitBreaker,
  normalizeAgentHostState,
  pruneExpiredBrowserBackoffs,
  recordMaintenanceTaskCooldown,
  recordMotionTaskRun,
  recordRuntimeUsageLimit,
  recordSendCircuitFailure,
  recordTaskVerification,
  recordCanarySendCooldown,
  releaseTaskLease,
  setBrowserBackoffForTask,
} from "../src/lib/agent-host-state.js";
import {
  releaseAgentRunLock,
  tryAcquireAgentRunLock,
} from "../src/lib/agent-run-lock.js";
import {
  DEFAULT_RUNTIME_USAGE_LIMIT_BACKOFF_MS,
  classifyRuntimeUsageLimitFailure,
} from "../src/lib/runtime-usage-limit.js";
import { buildPreflightSummary } from "../src/lib/agent-preflight.js";
import { getTaskExecutionLane, normalizeAgentExecutionLane } from "../src/lib/agent-task-lanes.js";
import {
  applyLinkedinMaintenanceConnectorResult,
  buildLinkedinMaintenanceHandoff,
  runLinkedinMaintenanceWithUnipile,
} from "../src/lib/linkedin-unipile-maintenance.js";
import { extractUsableDraftBody } from "../src/lib/draft-policy.js";
import { extractLinkedinPublicId } from "../src/lib/prospect-contacts.js";
import { readUnipileConfig } from "../src/lib/unipile-config.js";
import { withAgentHostStateLock } from "../src/lib/agent-host-state-lock.js";
import { writeAgentPassSummary } from "../src/lib/agent-pass-summary.js";

const CODEX_BIN = process.env.EXO_CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex";
const ROOT = process.cwd();
const STATE_DIR = process.env.EXO_STATE_DIR || path.join(ROOT, ".exo");
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
// When set ("transport" | "research"), this pass only executes tasks in that
// lane. The lane runner holds a lane-scoped run lock, so a transport pass
// (sync/sends through the connector identity) and a research pass (native
// compute) can run concurrently on the same host.
const EXECUTION_LANE = normalizeAgentExecutionLane(process.env.EXO_AGENT_LANE);
const PREFLIGHT_PATH = path.join(STATE_DIR, "agent-preflight.json");
const HOST_STATE_PATH = path.join(STATE_DIR, "agent-host-state.json");
const TEMP_ROOT = path.join(STATE_DIR, "automation-tmp");
const MAX_TASKS_PER_PASS = normalizePositiveInteger(process.env.EXO_AGENT_MAX_TASKS, 1000);
const MAX_MAINTENANCE_TASKS_PER_PASS = normalizePositiveInteger(process.env.EXO_AGENT_MAX_MAINTENANCE_TASKS, 25);
const STANDARD_PASS_BUDGET_MS = normalizePositiveInteger(process.env.EXO_AGENT_STANDARD_PASS_BUDGET_MS, 14 * 60 * 1000);
// After this many non-backfill standard tasks, the pass prefers one full-sync
// backfill slice so backfill keeps progressing even when motion work would
// otherwise fill the whole pass budget (and vice versa: rank ordering keeps
// backfill from starving motion work).
const BACKFILL_INTERLEAVE_EVERY = normalizePositiveInteger(process.env.EXO_AGENT_BACKFILL_INTERLEAVE_EVERY, 3);
const DRAFT_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_DRAFT_TIMEOUT_MS, 120000);
const BROWSER_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_BROWSER_TIMEOUT_MS, 300000);
const INBOUND_CAPTURE_TIMEOUT_MS = normalizePositiveInteger(
  process.env.EXO_AGENT_INBOUND_CAPTURE_TIMEOUT_MS,
  Math.max(BROWSER_TIMEOUT_MS, 6 * 60 * 1000),
);
const LINKEDIN_UNIPILE_HANDOFF_CAPTURE_TIMEOUT_MS = normalizePositiveInteger(
  process.env.EXO_AGENT_LINKEDIN_UNIPILE_HANDOFF_CAPTURE_TIMEOUT_MS,
  45 * 1000,
);
const INBOUND_IDENTITY_RESOLUTION_TIMEOUT_MS = normalizePositiveInteger(
  process.env.EXO_AGENT_INBOUND_IDENTITY_RESOLUTION_TIMEOUT_MS,
  3 * 60 * 1000,
);
const COMPANY_RESEARCH_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_COMPANY_RESEARCH_TIMEOUT_MS, 10 * 60 * 1000);
const PROSPECT_RESEARCH_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_PROSPECT_RESEARCH_TIMEOUT_MS, 15 * 60 * 1000);
const EXO_COMMAND_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_EXO_COMMAND_TIMEOUT_MS, 60000);
const INBOUND_EXO_COMMAND_TIMEOUT_MS = normalizePositiveInteger(
  process.env.EXO_AGENT_INBOUND_EXO_COMMAND_TIMEOUT_MS,
  Math.max(EXO_COMMAND_TIMEOUT_MS, 3 * 60 * 1000),
);
const LINKEDIN_FULL_SYNC_TASK_BUDGET_MS = normalizePositiveInteger(
  process.env.EXO_AGENT_LINKEDIN_FULL_SYNC_TASK_BUDGET_MS,
  5 * 60 * 1000,
);
const SHELL_COMMAND_TIMEOUT_MS = normalizePositiveInteger(process.env.EXO_AGENT_SHELL_COMMAND_TIMEOUT_MS, 60000);
const BROWSER_TRANSPORT_BACKOFF_MS = normalizePositiveInteger(process.env.EXO_AGENT_BROWSER_BACKOFF_MS, 15 * 60 * 1000);
const VERIFY_TASK_COOLDOWN_MS = normalizePositiveInteger(process.env.EXO_AGENT_VERIFY_TASK_COOLDOWN_MS, 6 * 60 * 60 * 1000);
const SEND_CIRCUIT_BREAKER_THRESHOLD = normalizePositiveInteger(process.env.EXO_AGENT_SEND_CIRCUIT_BREAKER_THRESHOLD, 2);
const SEND_CIRCUIT_BREAKER_BACKOFF_MS = normalizePositiveInteger(process.env.EXO_AGENT_SEND_CIRCUIT_BREAKER_BACKOFF_MS, 12 * 60 * 60 * 1000);
const CANARY_SEND_COOLDOWN_MS = normalizePositiveInteger(process.env.EXO_AGENT_CANARY_SEND_COOLDOWN_MS, 6 * 60 * 60 * 1000);
const VERIFICATION_OUTPUT_MAX_CHARS = normalizePositiveInteger(process.env.EXO_AGENT_VERIFICATION_OUTPUT_MAX_CHARS, 1200);
const TASK_LEASE_GRACE_MS = normalizePositiveInteger(process.env.EXO_AGENT_TASK_LEASE_GRACE_MS, 10 * 60 * 1000);
const AUTONOMOUS_WORKER_LABEL = normalizeNullableString(process.env.EXO_AGENT_WORKER_LABEL) ?? buildAutonomousWorkerLabel();
const SUBJECT_DRAFT_SURFACES = new Set(["email", "in_mail_message"]);
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
const MOTION_ROUND_ROBIN_TASK_KINDS = new Set([
  "company_discovery",
  "company_research",
  "prospect_selection",
  "prospect_research",
]);

export function buildCodexTaskEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  const codexHome = normalizeNullableString(env.CODEX_HOME) ?? CODEX_HOME;
  const homeDir = resolveCodexTaskHomeDir(codexHome, normalizeNullableString(env.HOME));
  const username = normalizeNullableString(env.USER)
    ?? normalizeNullableString(env.LOGNAME)
    ?? path.basename(homeDir);
  const unipileConfig = readUnipileConfig(codexHome);

  env.CODEX_HOME = codexHome;
  env.HOME = homeDir;
  env.USER = username;
  env.LOGNAME = username;

  if (!normalizeNullableString(env.UNIPILE_API_KEY) && unipileConfig.apiKey) {
    env.UNIPILE_API_KEY = unipileConfig.apiKey;
  }
  const hasExplicitUnipileBaseUrl = unipileConfig.baseUrlSource !== "default";
  if (!normalizeNullableString(env.UNIPILE_DSN) && hasExplicitUnipileBaseUrl && unipileConfig.baseUrl) {
    env.UNIPILE_DSN = unipileConfig.baseUrl;
  }
  if (!normalizeNullableString(env.UNIPILE_BASE_URL) && hasExplicitUnipileBaseUrl && unipileConfig.baseUrl) {
    env.UNIPILE_BASE_URL = unipileConfig.baseUrl;
  }
  if (!normalizeNullableString(env.UNIPILE_V2_API_KEY) && unipileConfig.v2ApiKey) {
    env.UNIPILE_V2_API_KEY = unipileConfig.v2ApiKey;
  }
  if (!normalizeNullableString(env.UNIPILE_V2_BASE_URL) && unipileConfig.v2BaseUrl) {
    env.UNIPILE_V2_BASE_URL = unipileConfig.v2BaseUrl;
  }

  return env;
}

function resolveCodexTaskHomeDir(codexHome, currentHome) {
  const normalizedHome = normalizeNullableString(currentHome);
  if (normalizedHome) {
    return normalizedHome;
  }
  const normalizedCodexHome = normalizeNullableString(codexHome);
  if (normalizedCodexHome && path.basename(normalizedCodexHome) === ".codex") {
    return path.dirname(normalizedCodexHome);
  }
  return os.homedir();
}

export function runAgentHostPass() {
  fs.mkdirSync(TEMP_ROOT, { recursive: true });

  const runLock = tryAcquireAgentRunLock({ stateDir: STATE_DIR, lane: EXECUTION_LANE });
  if (!runLock.acquired) {
    return buildAgentHostPassLockNoop(runLock);
  }

  try {
    return runUnlockedAgentHostPass();
  } finally {
    releaseAgentRunLock(runLock);
  }
}

function runUnlockedAgentHostPass() {
  let hostState = cleanupHostStateOnStartup();
  const preflight = buildAndPersistPreflight();
  const executionContext = createAgentExecutionContext();
  const browserReady = preflight.browser?.ready !== false;
  const ignoreBrowserBackoff = isBrowserBackoffIgnored();
  const forceRetrieval = isRetrievalForceEnabled();
  const sendMode = getSendMode();

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const results = [];
  // Tasks that failed or blocked in THIS pass are not re-selected within it.
  // Without this, a deterministically failing task (e.g. a sync slice whose
  // payload is rejected) hot-loops and burns the whole pass budget — observed
  // live: one failing followers slice retried 26 times in 14 minutes while
  // every other surface starved. Cross-pass backoff is separate policy work.
  const failedTaskFingerprints = new Set();
  let standardTaskCount = 0;
  let maintenanceTaskCount = 0;
  let backfillTaskCount = 0;
  let noOpReason = null;

  try {
    while (true) {
      // Reload each iteration so leases/backoffs written by a concurrent lane
      // worker are visible before we pick the next task.
      hostState = loadHostState();
      // While the model subscription is out of messages, every runtime task
      // would fail the same way. Hold the whole pass instead of burning
      // through the queue; the backoff expires on its own at the reset time.
      const usageLimit = getRuntimeUsageLimit(hostState);
      if (usageLimit.active && !isRuntimeUsageLimitIgnored()) {
        if (results.length === 0) {
          noOpReason = describeRuntimeUsageLimitHold(usageLimit);
        }
        break;
      }
      const queue = loadQueue(hostState);
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
        {
          passLane: maintenanceTaskCount > 0 ? "maintenance" : standardTaskCount > 0 ? "standard" : null,
          standardTaskCount,
          maintenanceTaskCount,
          backfillTaskCount,
          failedTaskFingerprints,
        },
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

      if (!canRunTaskInCurrentPass(task.kind, results, standardTaskCount, maintenanceTaskCount, {
        elapsedMs: Date.now() - startedAtMs,
        standardPassBudgetMs: STANDARD_PASS_BUDGET_MS,
      })) {
        break;
      }

      let checkout = /** @type {any} */ (null);
      hostState = mutateHostState((state) => {
        checkout = maybeCheckoutTaskForExecution(state, task, queueCheckedAt);
        return checkout.stateChanged ? checkout.state : state;
      });
      if (!checkout.ok) {
        continue;
      }

      const executableTask = checkout.task;
      const maintenanceTask = isBrowserMaintenanceTaskKind(executableTask.kind);
      const result = executeTask(executableTask, preflight, {
        sendMode,
        automationWarnings: rolloutWarnings.automationWarnings,
        automationHealthWarnings: rolloutWarnings.automationHealthWarnings,
      }, executionContext);
      if (checkout.stateChanged) {
        hostState = mutateHostState((state) => releaseCheckedOutTask(state, executableTask));
      }
      results.push(result);
      if (result.status === "failed" || result.status === "blocked") {
        failedTaskFingerprints.add(createTaskLeaseFingerprint(executableTask));
      }
      if (shouldRecordMotionTaskRun(executableTask)) {
        hostState = mutateHostState((state) => recordMotionTaskRun(state, {
          taskKind: executableTask.kind,
          motionId: executableTask.motionId,
          companyId: executableTask.companyId ?? null,
          prospectId: executableTask.prospectId ?? null,
          recordedAt: result.finishedAt ?? new Date().toISOString(),
          status: result.status,
        }));
      }
      if (result.status === "completed" && executableTask.kind === "reconcile_connection_request_status") {
        hostState = mutateHostState((state) => recordCompletedMaintenanceTaskCooldown(state, executableTask, result));
      }
      if (maintenanceTask) {
        maintenanceTaskCount += 1;
      } else {
        standardTaskCount += 1;
        if (isBackfillInboundSyncTask(executableTask)) {
          backfillTaskCount += 1;
        }
      }

      const prospectScopedBlockedSend = isProspectScopedBlockedSendResult(executableTask, result);
      const blockedBrowserTask = shouldApplyBrowserTaskBackoff(executableTask, result);
      const selectedMode = typeof executableTask?._selectedSendMode === "string" ? executableTask._selectedSendMode : getSendMode();
      const liveSendAttempt = executableTask.kind === "send_message"
        && (selectedMode === "live" || selectedMode === "canary_live" || selectedMode === "operator_live");
      if (blockedBrowserTask) {
        const unavailableUntil = new Date(Date.now() + BROWSER_TRANSPORT_BACKOFF_MS).toISOString();
        hostState = mutateHostState((state) => setBrowserBackoffForTask(
          state,
          executableTask.kind,
          unavailableUntil,
          result.detail?.reason ?? "browser_transport_blocked",
        ));
      }

      const dispatchGateHeld = result.detail?.dispatchGate?.status === "block"
        || result.detail?.dispatchGate?.status === "wait";
      if ((result.status === "blocked" || result.status === "failed") && liveSendAttempt && !dispatchGateHeld && !prospectScopedBlockedSend) {
        const failureAt = result.finishedAt ?? new Date().toISOString();
        hostState = mutateHostState((state) => {
          const breakerBefore = getSendCircuitBreaker(state, failureAt);
          const nextFailureCount = breakerBefore.consecutiveFailures + 1;
          return recordSendCircuitFailure(state, {
            failureAt,
            reason: result.detail?.reason ?? `${result.status}: send task did not complete`,
            taskFingerprint: createTaskVerificationFingerprint(executableTask),
            taskLabel: [executableTask.prospectName, executableTask.companyName].filter(Boolean).join(" at ") || executableTask.recipientUrl || executableTask.prospectId || "unknown send",
            unavailableUntil: nextFailureCount >= SEND_CIRCUIT_BREAKER_THRESHOLD
              ? new Date(Date.parse(failureAt) + SEND_CIRCUIT_BREAKER_BACKOFF_MS).toISOString()
              : null,
          });
        });
      }

      // A runtime usage-limit failure (out of Codex messages, rate limit, 429)
      // is a host-wide condition, not a prospect problem. Record the hold and
      // stop the pass so the rest of the queue does not fail the same way.
      const failureReasonText = (result.status === "failed" || result.status === "blocked")
        && typeof result.detail?.reason === "string"
        ? result.detail.reason
        : null;
      if (failureReasonText) {
        const usageLimitClassification = classifyRuntimeUsageLimitFailure(failureReasonText);
        if (usageLimitClassification.limited) {
          const detectedAt = result.finishedAt ?? new Date().toISOString();
          const unavailableUntil = usageLimitClassification.resetAt
            ?? new Date(Date.parse(detectedAt) + DEFAULT_RUNTIME_USAGE_LIMIT_BACKOFF_MS).toISOString();
          hostState = mutateHostState((state) => recordRuntimeUsageLimit(state, {
            detectedAt,
            unavailableUntil,
            reason: failureReasonText,
            runtime: "codex",
          }));
          break;
        }
      }

      if (blockedBrowserTask) {
        if ((getSendMode() === "verify" || getSendMode() === "canary") && executableTask.kind === "send_message") {
          break;
        }
        continue;
      }

      if (result.status === "completed" && BROWSER_TRANSPORT_TASK_KINDS.has(executableTask.kind)) {
        hostState = mutateHostState((state) => clearBrowserBackoffForTask(state, executableTask.kind));
      }

      if (result.status === "completed" && liveSendAttempt && result.detail?.verificationOnly !== true) {
        hostState = mutateHostState((state) => {
          let nextState = clearSendCircuitBreaker(state);
          if (selectedMode === "canary_live") {
            nextState = recordCanarySendCooldown(nextState, {
              sentAt: result.finishedAt ?? new Date().toISOString(),
              unavailableUntil: new Date(Date.parse(result.finishedAt ?? new Date().toISOString()) + CANARY_SEND_COOLDOWN_MS).toISOString(),
              taskFingerprint: createTaskVerificationFingerprint(executableTask),
              taskLabel: [executableTask.prospectName, executableTask.companyName].filter(Boolean).join(" at ") || executableTask.recipientUrl || executableTask.prospectId || "unknown send",
            });
          }
          return nextState;
        });
      }

      if (result.status === "completed" && result.detail?.verificationOnly === true) {
        hostState = mutateHostState((state) => recordTaskVerification(state, {
          taskKind: executableTask.kind,
          fingerprint: createTaskVerificationFingerprint(executableTask),
          verifiedAt: result.finishedAt ?? new Date().toISOString(),
          expiresAt: new Date(Date.now() + VERIFY_TASK_COOLDOWN_MS).toISOString(),
          motionId: executableTask.motionId ?? null,
          companyId: executableTask.companyId ?? null,
          prospectId: executableTask.prospectId ?? null,
          surface: executableTask.surface ?? null,
          recipientUrl: executableTask.recipientUrl ?? null,
          verificationStatus: result.detail?.sendStatus ?? null,
          prospectName: executableTask.prospectName ?? null,
          companyName: executableTask.companyName ?? null,
        }));
      }

      if (shouldStopAfterTaskResult(executableTask, result)) {
        break;
      }

      if (shouldAbortPassAfterTaskProblem(executableTask, result)) {
        break;
      }
    }
  } finally {
    disposeAgentExecutionContext(executionContext);
  }

  const endedAt = new Date().toISOString();
  const finalQueue = loadQueue(hostState);
  const finalRolloutWarnings = loadInboundAutomationRolloutWarnings(endedAt);
  const status = summarizePassStatus(results, finalQueue);
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
    lane: EXECUTION_LANE,
    maxTasksPerPass: MAX_TASKS_PER_PASS,
    maxMaintenanceTasksPerPass: MAX_MAINTENANCE_TASKS_PER_PASS,
    backfillInterleaveEvery: BACKFILL_INTERLEAVE_EVERY,
    backfillTaskCount,
    browserReady,
    preflightPath: PREFLIGHT_PATH,
    results,
    finalQueueCounts: summarizeQueue(finalQueue),
    packetReviewWarnings: buildStalePacketReviewWarnings(listMotions(), listCompanies(), { now: endedAt }),
  };
}

/** @param {{ pid?: number | null }} lock */
function buildAgentHostPassLockNoop(lock) {
  const now = new Date().toISOString();
  const laneLabel = EXECUTION_LANE ? `${EXECUTION_LANE} lane` : "agent";
  return {
    status: "noop",
    reason: `Another ${laneLabel} pass is already active${lock.pid ? ` (pid ${lock.pid})` : ""}.`,
    startedAt: now,
    endedAt: now,
    lane: EXECUTION_LANE,
    maxTasksPerPass: MAX_TASKS_PER_PASS,
    maxMaintenanceTasksPerPass: MAX_MAINTENANCE_TASKS_PER_PASS,
    backfillInterleaveEvery: BACKFILL_INTERLEAVE_EVERY,
    backfillTaskCount: 0,
    browserReady: null,
    preflightPath: null,
    results: [],
    finalQueueCounts: { dueTaskCount: 0, waitingTaskCount: 0, blockerCount: 0 },
    packetReviewWarnings: buildStalePacketReviewWarnings(listMotions(), listCompanies(), { now }),
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
 * Canary live sends remain one-at-a-time. Verification-only sends may keep
 * draining because recent proof records now prevent the same task from being
 * reselected inside the pass.
 *
 * @param {any} task
 * @param {any} result
 */
export function shouldStopAfterTaskResult(task, result) {
  return Boolean(
    task?.kind === "send_message"
      && result?.status === "completed"
      && task?._selectedSendMode === "canary_live"
  );
}

/**
 * Retrieval failures should not monopolize the whole host pass. A single flaky
 * inbound surface can fail while other governed work still completes safely in
 * the same pass. Send and maintenance failures still stop the pass.
 *
 * @param {any} task
 * @param {any} result
 */
export function shouldAbortPassAfterTaskProblem(task, result) {
  if (result?.status !== "failed" && result?.status !== "blocked") {
    return false;
  }

  if (isProspectScopedBlockedSendResult(task, result)) {
    return false;
  }

  return task?.kind !== "run_inbound_sync" && task?.kind !== "resolve_inbound_identity";
}

/**
 * Prospect-specific send blocks should not poison the whole transport lane.
 * They mean this exact recipient or governed branch is not currently sendable,
 * not that the connector/browser session is globally broken.
 *
 * @param {any} task
 * @param {any} result
 */
export function isProspectScopedBlockedSendResult(task, result) {
  if (task?.kind !== "send_message" || result?.status !== "blocked") {
    return false;
  }

  const dispatchGateStatus = normalizeNullableString(result?.detail?.dispatchGate?.status)?.toLowerCase() ?? null;
  if (dispatchGateStatus === "block" || dispatchGateStatus === "wait") {
    return true;
  }

  const reason = normalizeNullableString(result?.detail?.reason)?.toLowerCase() ?? "";
  if (!reason) {
    return false;
  }

  return reason.includes("already pending")
    || reason.includes("already connected")
    || reason.includes("connection request is already pending");
}

/**
 * Only transport-scoped failures should trigger browser backoff. Prospect-
 * scoped send blocks are branch-state problems and should let the pass keep
 * draining later sync work.
 *
 * @param {any} task
 * @param {any} result
 */
function shouldApplyBrowserTaskBackoff(task, result) {
  if (result?.status !== "blocked") {
    return false;
  }
  if (!BROWSER_TRANSPORT_TASK_KINDS.has(task?.kind)) {
    return false;
  }
  if (isProspectScopedBlockedSendResult(task, result)) {
    return false;
  }
  return true;
}

/** @param {string | null | undefined} taskKind */
export function isBrowserMaintenanceTaskKind(taskKind) {
  return taskKind === "reconcile_connection_request_status"
    || taskKind === "accept_connection_request"
    || taskKind === "withdraw_connection"
    || taskKind === "reject_connection_request";
}

/**
 * Keep passes homogeneous. Standard passes drain until their time budget is
 * exhausted, with MAX_TASKS_PER_PASS acting only as a safety ceiling.
 * Cleanup bursts handle at most MAX_MAINTENANCE_TASKS_PER_PASS maintenance
 * tasks.
 *
 * @param {string | null | undefined} taskKind
 * @param {Array<Record<string, any>>} results
 * @param {number} standardTaskCount
 * @param {number} maintenanceTaskCount
 * @param {{ elapsedMs?: number | null, standardPassBudgetMs?: number | null }} [options]
 */
export function canRunTaskInCurrentPass(taskKind, results, standardTaskCount, maintenanceTaskCount, options = {}) {
  const maintenanceTask = isBrowserMaintenanceTaskKind(taskKind);
  const passHasMaintenanceWork = Array.isArray(results)
    && results.some((result) => isBrowserMaintenanceTaskKind(result?.kind));
  const passHasNonMaintenanceWork = Array.isArray(results)
    && results.some((result) => !isBrowserMaintenanceTaskKind(result?.kind));
  const elapsedMs = Number.isFinite(options?.elapsedMs)
    ? Math.max(0, Number(options.elapsedMs))
    : 0;
  const standardPassBudgetMs = Number.isFinite(options?.standardPassBudgetMs)
    ? Math.max(0, Number(options.standardPassBudgetMs))
    : STANDARD_PASS_BUDGET_MS;

  if (maintenanceTask) {
    if (passHasNonMaintenanceWork || maintenanceTaskCount >= MAX_MAINTENANCE_TASKS_PER_PASS) {
      return false;
    }
    if (taskKind === "reconcile_connection_request_status") {
      return !results.some((result) => result?.kind === "reconcile_connection_request_status");
    }
    return true;
  }
  if (elapsedMs >= standardPassBudgetMs) {
    return false;
  }
  return !passHasMaintenanceWork && standardTaskCount < MAX_TASKS_PER_PASS;
}

/**
 * Decide whether the next slot in this pass should go to a full-sync backfill
 * slice. Backfill ranks last, so without this it only runs when nothing else
 * is due — and a busy motion could starve it for whole passes. After every
 * BACKFILL_INTERLEAVE_EVERY non-backfill standard tasks, one backfill slice
 * is preferred (when one is due).
 *
 * @param {{ standardTaskCount?: number, backfillTaskCount?: number }} [passState]
 */
export function shouldPreferBackfillSlice(passState = {}) {
  const standardTaskCount = Number.isFinite(passState?.standardTaskCount)
    ? Math.max(0, Number(passState.standardTaskCount))
    : 0;
  const backfillTaskCount = Number.isFinite(passState?.backfillTaskCount)
    ? Math.max(0, Number(passState.backfillTaskCount))
    : 0;
  const nonBackfillTaskCount = Math.max(0, standardTaskCount - backfillTaskCount);
  return nonBackfillTaskCount >= BACKFILL_INTERLEAVE_EVERY * (backfillTaskCount + 1);
}

/**
 * @param {{ kind?: string | null } | null | undefined} task
 * @param {{ passLane?: "standard" | "maintenance" | null }} [passState]
 */
function taskMatchesPassLane(task, passState = {}) {
  if (!passState?.passLane) return true;
  return classifyTaskPassLane(task?.kind) === passState.passLane;
}

/** @param {string | null | undefined} taskKind */
function classifyTaskPassLane(taskKind) {
  return isBrowserMaintenanceTaskKind(taskKind) ? "maintenance" : "standard";
}

/**
 * @param {any} task
 */
function shouldRecordMotionTaskRun(task) {
  return MOTION_ROUND_ROBIN_TASK_KINDS.has(task?.kind)
    && typeof task?.motionId === "string"
    && task.motionId.trim().length > 0;
}

/**
 * @param {{ tasks?: any[], blockers?: any[], dueTaskCount?: number | null, blockerCount?: number | null } | null | undefined} queue
 */
function hasRemainingDueBacklog(queue) {
  if (!queue || typeof queue !== "object") return false;
  const dueTaskCount = Number.isFinite(queue.dueTaskCount) ? Number(queue.dueTaskCount) : null;
  if (dueTaskCount !== null) return dueTaskCount > 0;
  const blockerCount = Number.isFinite(queue.blockerCount) ? Number(queue.blockerCount) : null;
  if (blockerCount !== null && blockerCount > 0) return true;
  return (Array.isArray(queue.tasks) && queue.tasks.length > 0)
    || (Array.isArray(queue.blockers) && queue.blockers.length > 0);
}

/**
 * @param {any[]} results
 * @param {{ tasks?: any[], blockers?: any[], dueTaskCount?: number | null, blockerCount?: number | null } | null | undefined} [finalQueue]
 */
export function summarizePassStatus(results, finalQueue = null) {
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
    if (hasRemainingDueBacklog(finalQueue)) {
      return "partial";
    }
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

/** @param {string | null | undefined} taskKind */
export function resolveResearchTaskTimeoutMs(taskKind) {
  return taskKind === "prospect_research"
    ? PROSPECT_RESEARCH_TIMEOUT_MS
    : COMPANY_RESEARCH_TIMEOUT_MS;
}

/**
 * Codex subprocess failures in autonomous packet work are retriable host/runtime
 * blockers, not Exo state corruption.
 *
 * @param {unknown} error
 * @param {Record<string, any>} [detail]
 */
export function buildBlockedCodexTaskResult(error, detail = {}) {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    status: "blocked",
    detail: {
      ...detail,
      reason,
    },
  };
}

/** @param {any} task */
export function createTaskVerificationFingerprint(task) {
  return createHostStateTaskVerificationFingerprint(task);
}

/** @param {string | null | undefined} taskKind */
function supportsGenericTaskCheckout(taskKind) {
  return taskKind === "run_inbound_sync"
    || taskKind === "resolve_inbound_identity"
    || taskKind === "company_discovery"
    || taskKind === "write_draft"
    || taskKind === "send_message"
    || taskKind === "reconcile_connection_request_status"
    || taskKind === "accept_connection_request"
    || taskKind === "reject_connection_request"
    || taskKind === "withdraw_connection";
}

/**
 * @param {any} hostState
 * @param {any} task
 * @param {string} checkedOutAt
 */
function maybeCheckoutTaskForExecution(hostState, task, checkedOutAt) {
  if (!supportsGenericTaskCheckout(task?.kind)) {
    return {
      ok: true,
      stateChanged: false,
      state: hostState,
      task,
    };
  }

  const fingerprint = createTaskLeaseFingerprint(task);
  const expiresAt = new Date(Date.parse(checkedOutAt) + resolveTaskLeaseDurationMs(task)).toISOString();
  const checkout = checkoutTaskLease(hostState, {
    taskKind: task.kind,
    fingerprint,
    workerLabel: AUTONOMOUS_WORKER_LABEL,
    acquiredAt: checkedOutAt,
    expiresAt,
    motionId: task.motionId ?? null,
    companyId: task.companyId ?? null,
    prospectId: task.prospectId ?? null,
    observationId: task.observationId ?? null,
    userId: task.userId ?? null,
    accountId: task.accountId ?? null,
    capability: task.capability ?? null,
    surface: task.surface ?? null,
    subject: buildTaskCheckoutSubject(task),
    action: normalizeNullableString(task.action ?? task.kind) ?? null,
  });
  if (!checkout.ok) {
    return {
      ok: false,
      stateChanged: false,
      state: hostState,
      task,
    };
  }

  return {
    ok: true,
    stateChanged: true,
    state: checkout.state,
    task: {
      ...task,
      checkoutState: "checked_out",
      checkedOutBy: AUTONOMOUS_WORKER_LABEL,
      checkedOutAt,
      checkoutExpiresAt: expiresAt,
      checkoutFingerprint: fingerprint,
    },
  };
}

/**
 * @param {any} hostState
 * @param {any} task
 */
function releaseCheckedOutTask(hostState, task) {
  if (!supportsGenericTaskCheckout(task?.kind)) {
    return hostState;
  }
  return releaseTaskLease(hostState, createTaskLeaseFingerprint(task));
}

/**
 * @param {any} task
 */
function resolveTaskLeaseDurationMs(task) {
  let baseDurationMs = EXO_COMMAND_TIMEOUT_MS;
  switch (task?.kind) {
    case "send_message":
    case "reconcile_connection_request_status":
    case "accept_connection_request":
    case "reject_connection_request":
    case "withdraw_connection":
      baseDurationMs = BROWSER_TIMEOUT_MS;
      break;
    case "write_draft":
      baseDurationMs = DRAFT_TIMEOUT_MS;
      break;
    case "run_inbound_sync":
      baseDurationMs = Math.max(INBOUND_CAPTURE_TIMEOUT_MS, resolveInboundExoCommandTimeoutMs(task));
      break;
    case "prospect_research":
    case "prospect_selection":
    case "company_research":
    case "company_discovery":
      baseDurationMs = resolveResearchTaskTimeoutMs(task.kind);
      break;
    default:
      baseDurationMs = EXO_COMMAND_TIMEOUT_MS;
      break;
  }
  return Math.max(baseDurationMs + TASK_LEASE_GRACE_MS, 60_000);
}

/**
 * @param {any} task
 */
function buildTaskCheckoutSubject(task) {
  return normalizeNullableString(
    task?.prospectName
      ?? task?.companyName
      ?? task?.accountHandle
      ?? task?.userLabel
      ?? task?.motionName
      ?? task?.surface
      ?? task?.kind,
  ) ?? "queued task";
}

/** @param {any} task */
function isOperatorControlledSendTask(task) {
  if (task?.kind !== "send_message") return false;
  return task?.authoredBy === "operator"
    || task?.editedByOperator === true
    || task?.approvedByOperator === true;
}

/** @param {any} task */
function shouldBypassAutomationRolloutGate(task) {
  return isOperatorControlledSendTask(task);
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
 * @param {{ passLane?: "standard" | "maintenance" | null, standardTaskCount?: number, maintenanceTaskCount?: number, backfillTaskCount?: number, failedTaskFingerprints?: Set<string> }} [passState]
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
  passState = {},
) {
  /** @type {any | null} */
  let canaryFallback = null;
  /** @type {any | null} */
  let verifyFallback = null;
  const sendCircuitBreaker = getSendCircuitBreaker(hostState, now);
  const canaryCooldown = getCanaryCooldown(hostState, now);
  const automationBlockReason = getInboundAutomationRolloutBlockReason(automationWarnings, sendMode, automationHealthWarnings);
  // When inbound health is degraded the live send rollout gate is closed, so
  // running another send_message is a guaranteed block. Promote due (and
  // waiting) inbound retrieval recovery work in that case so the drainer
  // actively heals the gate instead of treating the pass as a no-op while
  // sends pile up. Manual-only surface warnings have no in-queue recovery
  // task (operator must disable the surface), so they are not promoted.
  const healthGatePromotesRetrieval = Boolean(automationBlockReason)
    && Array.isArray(automationHealthWarnings)
    && automationHealthWarnings.length > 0;
  const effectiveForceRetrieval = forceRetrieval || healthGatePromotesRetrieval;
  const orderedTasks = getQueueTasksForExecution(queue, effectiveForceRetrieval, hostState, now);
  const candidateTasks = shouldPreferBackfillSlice(passState)
    ? [...orderedTasks.filter(isBackfillInboundSyncTask), ...orderedTasks.filter((task) => !isBackfillInboundSyncTask(task))]
    : orderedTasks;
  const verifyModePrefersRetrievalRecovery = sendMode === "verify"
    && candidateTasks.some((task) => task?.kind === "run_inbound_sync"
      && taskMatchesPassLane(task, passState)
      && (
        isBackfillInboundSyncTask(task)
        || (Array.isArray(automationHealthWarnings) && automationHealthWarnings.length > 0)
      ));
  for (const task of candidateTasks) {
    if (!taskMatchesPassLane(task, passState)) {
      continue;
    }

    // A task that already failed or blocked in this pass is excluded for the
    // remainder of the pass; re-running it immediately would repeat the same
    // failure and starve every other candidate.
    if (passState.failedTaskFingerprints?.has(createTaskLeaseFingerprint(task))) {
      continue;
    }

    if (supportsGenericTaskCheckout(task?.kind)) {
      const activeLease = getActiveTaskLease(hostState, createTaskLeaseFingerprint(task), now);
      if (activeLease) {
        continue;
      }
    }

    const browserTransportRequired = BROWSER_TRANSPORT_TASK_KINDS.has(task.kind);
    if (browserTransportRequired && !browserReady) {
      continue;
    }

    if (browserTransportRequired && !ignoreBrowserBackoff) {
      const backoff = getBrowserBackoffForTask(hostState, task.kind, now);
      if (backoff.active) {
        continue;
      }
    }

    if (verifyModePrefersRetrievalRecovery
      && task.kind !== "run_inbound_sync"
      && !isOperatorControlledSendTask(task)) {
      continue;
    }

    if (task.kind === "send_message") {
      const operatorControlled = isOperatorControlledSendTask(task);
      if (verifyModePrefersRetrievalRecovery && !operatorControlled) {
        continue;
      }
      if (automationBlockReason && !operatorControlled) {
        continue;
      }
      if ((sendMode !== "verify" || operatorControlled) && sendCircuitBreaker.active) {
        continue;
      }
      const verification = getRecentTaskVerification(
        hostState,
        task.kind,
        createTaskVerificationFingerprint(task),
        now,
      );
      if (sendMode === "verify") {
        if (operatorControlled) {
          // Operator review is the explicit send authorization signal. Once a
          // human authored, edited, or approved the draft, proof-only rollout
          // gates should not keep it queued.
          return {
            ...task,
            _selectedSendMode: "operator_live",
            _recentVerification: verification ?? null,
          };
        }
        if (verification) {
          continue;
        }
        if (!verifyFallback) {
          verifyFallback = {
            ...task,
            _selectedSendMode: "verify",
          };
        }
        continue;
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

    if (verifyFallback) {
      return verifyFallback;
    }
    return task;
  }

  if (sendMode === "verify") {
    return verifyFallback;
  }
  return sendMode === "canary" ? canaryFallback : null;
}

/**
 * @param {any} state
 * @param {any} task
 * @param {any} result
 */
export function recordCompletedMaintenanceTaskCooldown(state, task, result) {
  const normalized = normalizeAgentHostState(state);
  if (task?.kind !== "reconcile_connection_request_status" || result?.status !== "completed") {
    return normalized;
  }

  const cooldownMs = normalizePositiveInteger(task?.batch?.cooldownMs, 0);
  if (cooldownMs <= 0) {
    return normalized;
  }

  const recordedAt = normalizeIsoDatetime(result?.finishedAt) ?? new Date().toISOString();
  const groupKey = normalizeNullableString(task?.batch?.groupKey)
    ?? buildConnectionRequestStatusReconciliationGroupKeyFromTask(task);
  if (!groupKey) {
    return normalized;
  }

  return recordMaintenanceTaskCooldown(normalized, {
    taskKind: task.kind,
    groupKey,
    recordedAt,
    unavailableUntil: new Date(Date.parse(recordedAt) + cooldownMs).toISOString(),
    reason: "bounded_connection_request_status_reconciliation",
    taskFingerprint: createTaskLeaseFingerprint(task),
    taskLabel: [task.prospectName, task.companyName].filter(Boolean).join(" at ")
      || task.recipientUrl
      || task.observationId
      || null,
  });
}

/** @param {any} task */
function buildConnectionRequestStatusReconciliationGroupKeyFromTask(task) {
  const userId = normalizeNullableString(task?.userId);
  const accountId = normalizeNullableString(task?.accountId);
  if (!userId || !accountId) {
    return null;
  }
  return [
    userId,
    accountId,
    normalizeNullableString(task?.capability) ?? "linkedin",
  ].join(":");
}

/**
 * Manual host-pass verification should be able to exercise retrieval without
 * waiting for the stale window. When explicitly forced, include waiting
 * `run_inbound_sync` tasks in the same selection pipeline as due work.
 *
 * @param {{ tasks?: any[], waiting?: any[] } | null | undefined} queue
 * @param {boolean} [forceRetrieval]
 */
function getQueueTasksForExecution(queue, forceRetrieval = false, hostState = null, now = new Date().toISOString()) {
  const allDueTasks = Array.isArray(queue?.tasks) ? queue.tasks : [];
  const dueTasks = EXECUTION_LANE
    ? allDueTasks.filter((task) => getTaskExecutionLane(task?.kind) === EXECUTION_LANE)
    : allDueTasks;
  if (!forceRetrieval) {
    return sortQueueTasksForExecution(dueTasks, { hostState, now });
  }
  const waitingRetrievalTasks = Array.isArray(queue?.waiting)
    ? queue.waiting.filter((task) => task?.kind === "run_inbound_sync"
      && (!EXECUTION_LANE || getTaskExecutionLane(task?.kind) === EXECUTION_LANE))
    : [];
  return sortQueueTasksForExecution([...dueTasks, ...waitingRetrievalTasks], {
    forceRetrieval: true,
    hostState,
    now,
  });
}

/**
 * The host runner should not depend on upstream queue ordering. Urgent
 * execution work should clear before long retrieval and research tasks so a
 * full reconciliation pass cannot starve live replies, sends, or drafting.
 * Inside the autonomous motion lane, rotate across motions before drilling
 * deeper into one motion's next task kind, otherwise a single motion can own
 * an entire 14-minute pass just by generating the next downstream packet.
 * Explicit retrieval forcing is still allowed to override this during manual
 * sync recovery.
 *
 * @param {any[]} tasks
 * @param {{ forceRetrieval?: boolean }} [options]
 */
function sortQueueTasksForExecution(tasks, options = {}) {
  const forceRetrieval = options.forceRetrieval === true;
  const hostState = options.hostState ?? null;
  // Quick inbound sync keeps its slot ahead of research: it is fast and
  // refreshes the reply/invite truth that gates safe sending. Full backfill
  // sync (initial itemization / deep history) ranks LAST so a fresh project
  // starts motion work immediately; backfill progresses through bounded
  // slices interleaved by the pass loop (see shouldPreferBackfillSlice).
  const rank = {
    send_message: 0,
    resolve_inbound_identity: 1,
    write_draft: 2,
    reconcile_connection_request_status: 3,
    accept_connection_request: 3,
    reject_connection_request: 3,
    withdraw_connection: 3,
    run_inbound_sync_quick: forceRetrieval ? -1 : 4,
    company_research: 5,
    prospect_selection: 6,
    prospect_research: 7,
    company_discovery: 8,
    run_inbound_sync_full: forceRetrieval ? -1 : 9,
  };

  return [...(tasks ?? [])].sort((left, right) => {
    const leftMotionTask = isMotionRoundRobinTask(left);
    const rightMotionTask = isMotionRoundRobinTask(right);
    if (leftMotionTask && rightMotionTask) {
      const motionComparison = compareMotionRoundRobinAcrossKinds(left, right, hostState);
      if (motionComparison !== 0) {
        return motionComparison;
      }
    }
    const leftRank = rank[executionRankKey(left)] ?? 99;
    const rightRank = rank[executionRankKey(right)] ?? 99;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (left?.kind === right?.kind && leftMotionTask && rightMotionTask) {
      const roundRobinComparison = compareMotionRoundRobinTasks(left, right, hostState);
      if (roundRobinComparison !== 0) {
        return roundRobinComparison;
      }
    }
    const leftKey = normalizeQueueTaskSortTime(left);
    const rightKey = normalizeQueueTaskSortTime(right);
    if (leftKey !== rightKey) {
      return leftKey.localeCompare(rightKey);
    }
    return String(left?.motionId ?? left?.companyId ?? left?.prospectId ?? "")
      .localeCompare(String(right?.motionId ?? right?.companyId ?? right?.prospectId ?? ""));
  });
}

/**
 * Full-mode inbound sync is backfill work and ranks behind motion execution;
 * everything else ranks by kind.
 * @param {any} task
 */
function executionRankKey(task) {
  if (task?.kind !== "run_inbound_sync") return task?.kind;
  return isBackfillInboundSyncTask(task) ? "run_inbound_sync_full" : "run_inbound_sync_quick";
}

/**
 * @param {any} task
 */
function isMotionRoundRobinTask(task) {
  return MOTION_ROUND_ROBIN_TASK_KINDS.has(task?.kind)
    && typeof task?.motionId === "string"
    && task.motionId.trim().length > 0;
}

/**
 * @param {any} left
 * @param {any} right
 * @param {any} hostState
 */
function compareMotionRoundRobinAcrossKinds(left, right, hostState) {
  if (left?.motionId === right?.motionId) {
    return 0;
  }

  const leftRunAt = getRecentMotionRunAt(hostState, left?.motionId, MOTION_ROUND_ROBIN_TASK_KINDS);
  const rightRunAt = getRecentMotionRunAt(hostState, right?.motionId, MOTION_ROUND_ROBIN_TASK_KINDS);
  if (leftRunAt !== rightRunAt) {
    if (!leftRunAt) return -1;
    if (!rightRunAt) return 1;
    return leftRunAt.localeCompare(rightRunAt);
  }

  return 0;
}

/**
 * @param {any} left
 * @param {any} right
 * @param {any} hostState
 */
function compareMotionRoundRobinTasks(left, right, hostState) {
  const leftRunAt = getRecentMotionTaskRunAt(hostState, left?.kind, left?.motionId);
  const rightRunAt = getRecentMotionTaskRunAt(hostState, right?.kind, right?.motionId);
  if (leftRunAt !== rightRunAt) {
    if (!leftRunAt) return -1;
    if (!rightRunAt) return 1;
    return leftRunAt.localeCompare(rightRunAt);
  }

  if (left?.kind === "company_discovery" && right?.kind === "company_discovery") {
    const leftDeficit = normalizeQueueTaskDeficit(left);
    const rightDeficit = normalizeQueueTaskDeficit(right);
    if (leftDeficit !== rightDeficit) {
      return rightDeficit - leftDeficit;
    }
  }

  return 0;
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
  const tasks = getQueueTasksForExecution(queue, forceRetrieval, hostState, now);
  if (tasks.length === 0) {
    return forceRetrieval
      ? "No due tasks or waiting autonomous retrieval tasks were available."
      : "No due tasks were available.";
  }

  const usageLimit = getRuntimeUsageLimit(hostState, now);
  if (usageLimit.active && !isRuntimeUsageLimitIgnored()) {
    return describeRuntimeUsageLimitHold(usageLimit);
  }

  if (!browserReady) {
    if (tasks.some((task) => !BROWSER_TRANSPORT_TASK_KINDS.has(task.kind))) {
      return "Browser preflight was not ready, but the remaining due connector-native work was already exhausted in this pass.";
    }
    return "Browser preflight was not ready, and no due browser-backed tasks were available.";
  }

  const sendTasks = tasks.filter((task) => task.kind === "send_message");
  if (sendTasks.length > 0) {
    const automationBlockReason = getInboundAutomationRolloutBlockReason(automationWarnings, sendMode, automationHealthWarnings);
    const rolloutGatedSendTasks = sendTasks.filter((task) => !shouldBypassAutomationRolloutGate(task));
    if (automationBlockReason && rolloutGatedSendTasks.length > 0) {
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

  return "No selectable tasks were available for the current transport and send-mode state.";
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
function executeTask(task, preflight, options = {}, executionContext = null) {
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

    if (task.kind === "company_discovery") {
      const discovery = runCompanyDiscoveryTask(task);
      return {
        ...base,
        status: discovery.status,
        finishedAt: new Date().toISOString(),
        detail: discovery.detail,
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

    if (task.kind === "prospect_selection") {
      const selection = runProspectSelectionTask(task);
      return {
        ...base,
        status: selection.status,
        finishedAt: new Date().toISOString(),
        detail: selection.detail,
      };
    }

    if (task.kind === "prospect_research") {
      const research = runProspectResearchTask(task);
      return {
        ...base,
        status: research.status,
        finishedAt: new Date().toISOString(),
        detail: research.detail,
      };
    }

    const browserTransportRequired = BROWSER_TRANSPORT_TASK_KINDS.has(task.kind);

    if (browserTransportRequired && preflight.browser?.ready === false) {
      return {
        ...base,
        status: "blocked",
        finishedAt: new Date().toISOString(),
        detail: {
          reason: `Browser preflight failed: ${(preflight.browser?.blockedReasons ?? []).join("; ")}`,
        }
      };
    }

    const taskGate = browserTransportRequired
      ? getPreflightTaskGate(preflight, task.kind)
      : { allowed: true, reason: null };
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
      const sync = runInboundSyncTask(task, preflight, {}, executionContext);
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

    if (task.kind === "resolve_inbound_identity") {
      const resolution = runInboundIdentityResolutionTask(task);
      return {
        ...base,
        status: resolution.status,
        finishedAt: new Date().toISOString(),
        detail: resolution.detail,
      };
    }

    if (task.kind === "send_message") {
      const rolloutBlockReason = shouldBypassAutomationRolloutGate(task)
        ? null
        : getInboundAutomationRolloutBlockReason(
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

    if (isBrowserMaintenanceTaskKind(task.kind)) {
      const action = runBrowserActionTask(task, executionContext);
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
  let response;
  try {
    response = runCodexTask({
      prompt: buildDraftPrompt(brief),
      schema: buildDraftOutputSchema(brief),
      outputName: `draft-${task.motionId}-${task.prospectId}.json`,
      browserRequired: false,
      timeoutMs: DRAFT_TIMEOUT_MS,
    });
  } catch (error) {
    return buildBlockedCodexTaskResult(error);
  }
  const draft = extractDraftOutputFromCodexResponse(response, task.surface);
  if (!draft.body) {
    throw new Error("Draft task did not return a non-empty body.");
  }
  if (draftSurfaceUsesSubject(task.surface) && !draft.subject) {
    throw new Error("Draft task did not return a non-empty subject.");
  }
  setDraft(task, draft);
  return {
    status: "completed",
    detail: {
      postWriteStatus: task.postWriteStatus,
      bodyPreview: truncate(draft.body, 160),
    },
  };
}

/** @param {any} task */
export function runInboundSyncTask(task, preflight, dependencies = {}, executionContext = null) {
  void preflight;
  const runInboundContractImpl = dependencies.runInboundContract ?? runInboundContract;
  const applyInboundPayloadImpl = dependencies.applyInboundPayload ?? applyInboundPayload;
  const runVerificationCommandsImpl = dependencies.runVerificationCommands ?? runVerificationCommands;
  const requiresBrowserAttachForInboundCaptureImpl = dependencies.requiresBrowserAttachForInboundCapture ?? requiresBrowserAttachForInboundCapture;
  const runConnectorCodexTaskImpl = dependencies.runConnectorCodexTask ?? runConnectorCodexTask;
  const buildInboundCapturePromptImpl = dependencies.buildInboundCapturePrompt ?? buildInboundCapturePrompt;
  const buildInboundPayloadImpl = dependencies.buildInboundPayload ?? buildInboundPayload;
  const nowMsImpl = dependencies.nowMs ?? Date.now;
  const resolveContinuationBudgetMsImpl = dependencies.resolveContinuationBudgetMs ?? resolveInboundContinuationBudgetMs;
  const suppressVerification = dependencies.suppressVerification === true;
  const disableMultiPage = dependencies.disableMultiPage === true;

  if (!disableMultiPage) {
    const continuationBudgetMs = resolveContinuationBudgetMsImpl(task);
    if (continuationBudgetMs > 0 && shouldAllowMultiPageInboundSync(task)) {
      const aggregateStageTimingsMs = {};
      const startedAtMs = nowMsImpl();
      let currentTask = { ...task };
      let continuationPassCount = 0;
      /** @type {{ status: string, detail: Record<string, any> } | null} */
      let finalResult = null;

      while (true) {
        const singleResult = runInboundSyncTask(
          currentTask,
          preflight,
          {
            ...dependencies,
            disableMultiPage: true,
            suppressVerification: true,
          },
          executionContext,
        );
        continuationPassCount += 1;
        finalResult = singleResult;
        mergeInboundStageTimings(aggregateStageTimingsMs, singleResult.detail?.stageTimingsMs);
        if (singleResult.status !== "completed") {
          return singleResult;
        }

        const continuation = extractInboundTaskContinuation(singleResult.detail);
        if (!continuation) {
          break;
        }
        if ((nowMsImpl() - startedAtMs) >= continuationBudgetMs) {
          break;
        }

        currentTask = {
          ...currentTask,
          resumeCursor: continuation.resumeCursor ?? null,
          resumeStartOffset: continuation.resumeStartOffset ?? null,
        };
      }

      let verification = [];
      if (!suppressVerification) {
        const verificationStartedAt = nowMsImpl();
        verification = runVerificationCommandsImpl(task.verificationCommands ?? []);
        aggregateStageTimingsMs.verification = (aggregateStageTimingsMs.verification ?? 0) + (nowMsImpl() - verificationStartedAt);
      }

      return {
        status: finalResult?.status ?? "completed",
        detail: {
          ...(finalResult?.detail ?? {}),
          verification,
          stageTimingsMs: aggregateStageTimingsMs,
          continuationPassCount,
        },
      };
    }
  }

  const stageTimingsMs = {};
  let stageStartedAt = Date.now();
  const liveResult = runInboundContractImpl(task);
  stageTimingsMs.contract = Date.now() - stageStartedAt;
  if (liveResult.payload) {
    const surfaceProgress = extractInboundTaskSurfaceProgress(task, liveResult.payload);
    stageStartedAt = Date.now();
    applyInboundPayloadImpl(task, liveResult.payload);
    stageTimingsMs.apply = Date.now() - stageStartedAt;
    let verification = [];
    if (!suppressVerification) {
      stageStartedAt = Date.now();
      verification = runVerificationCommandsImpl(task.verificationCommands ?? []);
      stageTimingsMs.verification = Date.now() - stageStartedAt;
    }
    return {
      status: "completed",
      detail: {
        transport: "direct_payload",
        captureStatus: surfaceProgress.surfaceStatus,
        captureError: surfaceProgress.surfaceError,
        observedCount: surfaceProgress.surfaceItemCount,
        surfaceStatus: surfaceProgress.surfaceStatus,
        surfaceError: surfaceProgress.surfaceError,
        surfaceReconcileReason: surfaceProgress.surfaceReconcileReason,
        nextCursor: surfaceProgress.nextCursor,
        nextStartOffset: surfaceProgress.nextStartOffset,
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
  const passScopedFallbackReason = getPassScopedInboundSameCredentialFallbackReason(executionContext, task, liveResult);
  if (passScopedFallbackReason) {
    stageStartedAt = Date.now();
    const fallbackLiveResult = runInboundContractImpl(task, { directUnipileHttp: true });
    stageTimingsMs.fallbackContract = Date.now() - stageStartedAt;
    if (fallbackLiveResult.payload) {
      const fallbackCapture = summarizeInboundCaptureResult(fallbackLiveResult.capture, task.capability);
      const surfaceProgress = extractInboundTaskSurfaceProgress(task, fallbackLiveResult.payload);
      stageStartedAt = Date.now();
      applyInboundPayloadImpl(task, fallbackLiveResult.payload);
      stageTimingsMs.fallbackApply = Date.now() - stageStartedAt;
      let verification = [];
      if (!suppressVerification) {
        stageStartedAt = Date.now();
        verification = runVerificationCommandsImpl(task.verificationCommands ?? []);
        stageTimingsMs.verification = Date.now() - stageStartedAt;
      }
      return {
        status: "completed",
        detail: {
          transport: "unipile_http_same_credentials_fallback",
          fallbackFrom: "pass_scoped_unipile_mcp_hold",
          fallbackReason: passScopedFallbackReason,
          captureStatus: fallbackCapture?.status ?? surfaceProgress.surfaceStatus,
          captureError: fallbackCapture?.error ?? surfaceProgress.surfaceError,
          observedCount: fallbackCapture?.itemCount ?? surfaceProgress.surfaceItemCount,
          surfaceStatus: surfaceProgress.surfaceStatus,
          surfaceError: surfaceProgress.surfaceError,
          surfaceReconcileReason: surfaceProgress.surfaceReconcileReason,
          nextCursor: surfaceProgress.nextCursor,
          nextStartOffset: surfaceProgress.nextStartOffset,
          verification,
          stageTimingsMs,
        },
      };
    }
  }

  let capture;
  if (requiresBrowserAttachForInboundCaptureImpl(captureRequest)) {
    capture = buildFailedInboundCapture(
      task,
      `connector_native_required: ${task.capability} live sync no longer uses browser-native capture. Re-map this account or surface to a connector-native path.`,
    );
  } else {
    stageStartedAt = Date.now();
    try {
      capture = runConnectorCodexTaskImpl({
        prompt: buildInboundCapturePromptImpl(captureRequest, liveResult.transport.connector ?? null),
        schema: captureRequest.outputSchema,
        outputName: `inbound-${task.capability}-${task.accountId}.json`,
        timeoutMs: resolveInboundCaptureTimeoutMs(task, liveResult),
        enabledPlugins: resolveCodexConnectorPluginIds(liveResult.transport.connector ?? task.capability ?? null),
        enabledMcpServers: resolveCodexConnectorMcpServerIds(liveResult.transport.connector ?? task.capability ?? null),
      });
    } catch (error) {
      capture = buildFailedInboundCapture(task, normalizeInboundCaptureFailureReason(error));
    }
    stageTimingsMs.capture = Date.now() - stageStartedAt;
  }
  const normalizedCapture = normalizeInboundCaptureForWriteback(capture, task.capability);

  if (shouldUseSameCredentialUnipileHttpInboundFallback(task, liveResult, normalizedCapture)) {
    rememberPassScopedInboundSameCredentialFallback(executionContext, task, liveResult, normalizedCapture.error);
    stageStartedAt = Date.now();
    const fallbackLiveResult = runInboundContractImpl(task, { directUnipileHttp: true });
    stageTimingsMs.fallbackContract = Date.now() - stageStartedAt;
    if (fallbackLiveResult.payload) {
      const fallbackCapture = summarizeInboundCaptureResult(fallbackLiveResult.capture, task.capability);
      const surfaceProgress = extractInboundTaskSurfaceProgress(task, fallbackLiveResult.payload);
      stageStartedAt = Date.now();
      applyInboundPayloadImpl(task, fallbackLiveResult.payload);
      stageTimingsMs.fallbackApply = Date.now() - stageStartedAt;
      let verification = [];
      if (!suppressVerification) {
        stageStartedAt = Date.now();
        verification = runVerificationCommandsImpl(task.verificationCommands ?? []);
        stageTimingsMs.verification = Date.now() - stageStartedAt;
      }
      return {
        status: "completed",
        detail: {
          transport: "unipile_http_same_credentials_fallback",
          fallbackFrom: "agent_handoff",
          fallbackReason: normalizedCapture.error ?? null,
          captureStatus: fallbackCapture?.status ?? surfaceProgress.surfaceStatus,
          captureError: fallbackCapture?.error ?? surfaceProgress.surfaceError,
          observedCount: fallbackCapture?.itemCount ?? surfaceProgress.surfaceItemCount,
          surfaceStatus: surfaceProgress.surfaceStatus,
          surfaceError: surfaceProgress.surfaceError,
          surfaceReconcileReason: surfaceProgress.surfaceReconcileReason,
          nextCursor: surfaceProgress.nextCursor,
          nextStartOffset: surfaceProgress.nextStartOffset,
          verification,
          stageTimingsMs,
        },
      };
    }
  }

  stageStartedAt = Date.now();
  const builtPayload = buildInboundPayloadImpl(task, normalizedCapture);
  stageTimingsMs.payloadBuild = Date.now() - stageStartedAt;
  const surfaceProgress = extractInboundTaskSurfaceProgress(task, builtPayload.payload);
  stageStartedAt = Date.now();
  applyInboundPayloadImpl(task, builtPayload.payload);
  stageTimingsMs.apply = Date.now() - stageStartedAt;
  let verification = [];
  if (!suppressVerification) {
    stageStartedAt = Date.now();
    verification = runVerificationCommandsImpl(task.verificationCommands ?? []);
    stageTimingsMs.verification = Date.now() - stageStartedAt;
  }

  return {
    status: "completed",
    detail: {
      transport: "agent_handoff",
      captureStatus: normalizedCapture.status,
      captureError: normalizedCapture.error ?? null,
      observedCount: normalizedCapture.itemCount ?? surfaceProgress.surfaceItemCount,
      surfaceStatus: surfaceProgress.surfaceStatus,
      surfaceError: surfaceProgress.surfaceError,
      surfaceReconcileReason: surfaceProgress.surfaceReconcileReason,
      nextCursor: surfaceProgress.nextCursor,
      nextStartOffset: surfaceProgress.nextStartOffset,
      verification,
      stageTimingsMs,
    }
  };
}

function shouldAllowMultiPageInboundSync(task) {
  return task?.capability === "linkedin"
    && task?.mode === "full"
    && normalizeInboundTaskSurfaceKeys(task).length === 1;
}

function resolveInboundContinuationBudgetMs(task) {
  return shouldAllowMultiPageInboundSync(task)
    ? LINKEDIN_FULL_SYNC_TASK_BUDGET_MS
    : 0;
}

function mergeInboundStageTimings(target, source) {
  if (!source || typeof source !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(source)) {
    if (!Number.isFinite(value)) {
      continue;
    }
    target[key] = (target[key] ?? 0) + value;
  }
}

function extractInboundTaskContinuation(detail) {
  if (!detail || typeof detail !== "object") {
    return null;
  }
  if (normalizeNullableString(detail.surfaceReconcileReason) !== "page_budget_stopped_early") {
    return null;
  }
  const resumeCursor = normalizeNullableString(detail.nextCursor) ?? null;
  const resumeStartOffset = Number.isInteger(detail.nextStartOffset) ? detail.nextStartOffset : null;
  if (!resumeCursor && resumeStartOffset === null) {
    return null;
  }
  return {
    resumeCursor,
    resumeStartOffset,
  };
}

function extractInboundTaskSurfaceProgress(task, payload) {
  const targetSurfaceKey = normalizeInboundTaskSurfaceKeys(task)[0] ?? null;
  if (!targetSurfaceKey) {
    return {
      surfaceStatus: null,
      surfaceError: null,
      surfaceReconcileReason: null,
      nextCursor: null,
      nextStartOffset: null,
      surfaceItemCount: null,
    };
  }

  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
  for (const account of accounts) {
    const surfaces = Array.isArray(account?.surfaces) ? account.surfaces : [];
    const surface = surfaces.find((candidate) => normalizeNullableString(candidate?.surfaceKey) === targetSurfaceKey) ?? null;
    if (!surface) {
      continue;
    }
    const observations = Array.isArray(surface.observations) ? surface.observations : [];
    const itemCount = Number.isInteger(surface.itemCount)
      ? surface.itemCount
      : observations.length > 0
        ? observations.length
        : null;
    return {
      surfaceStatus: normalizeNullableString(surface.status),
      surfaceError: normalizeNullableString(surface.error),
      surfaceReconcileReason: normalizeNullableString(surface.reconcileReason),
      nextCursor: normalizeNullableString(surface.nextCursor),
      nextStartOffset: Number.isInteger(surface.nextStartOffset) ? surface.nextStartOffset : null,
      surfaceItemCount: itemCount,
    };
  }

  return {
    surfaceStatus: null,
    surfaceError: null,
    surfaceReconcileReason: null,
    nextCursor: null,
    nextStartOffset: null,
    surfaceItemCount: null,
  };
}

function resolveInboundCaptureTimeoutMs(task, liveResult) {
  if (
    task?.capability === "linkedin"
    && liveResult?.transport?.kind === "agent_handoff"
    && normalizeNullableString(liveResult?.transport?.connector)?.toLowerCase() === "unipile"
  ) {
    return Math.min(INBOUND_CAPTURE_TIMEOUT_MS, LINKEDIN_UNIPILE_HANDOFF_CAPTURE_TIMEOUT_MS);
  }
  return INBOUND_CAPTURE_TIMEOUT_MS;
}

function shouldUseSameCredentialUnipileHttpInboundFallback(task, liveResult, normalizedCapture) {
  return task?.capability === "linkedin"
    && liveResult?.transport?.kind === "agent_handoff"
    && normalizeNullableString(liveResult?.transport?.connector)?.toLowerCase() === "unipile"
    && normalizeNullableString(normalizedCapture?.status)?.toLowerCase() === "failed";
}

function getPassScopedInboundSameCredentialFallbackReason(executionContext, task, liveResult) {
  const holdKey = buildPassScopedInboundSameCredentialFallbackKey(task, liveResult);
  if (!holdKey) {
    return null;
  }
  const fallbackHolds = executionContext?.inboundConnectorFallbacks;
  if (!(fallbackHolds instanceof Map)) {
    return null;
  }
  const hold = fallbackHolds.get(holdKey);
  return normalizeNullableString(hold?.reason) ?? null;
}

function rememberPassScopedInboundSameCredentialFallback(executionContext, task, liveResult, reason) {
  const normalizedReason = normalizeNullableString(reason);
  if (!shouldHoldInboundSameCredentialFallbackForPass(normalizedReason)) {
    return;
  }
  const holdKey = buildPassScopedInboundSameCredentialFallbackKey(task, liveResult);
  if (!holdKey) {
    return;
  }
  const fallbackHolds = executionContext?.inboundConnectorFallbacks;
  if (!(fallbackHolds instanceof Map)) {
    return;
  }
  fallbackHolds.set(holdKey, {
    reason: normalizedReason,
    recordedAt: new Date().toISOString(),
  });
}

function buildPassScopedInboundSameCredentialFallbackKey(task, liveResult) {
  if (
    task?.capability !== "linkedin"
    || liveResult?.transport?.kind !== "agent_handoff"
    || normalizeNullableString(liveResult?.transport?.connector)?.toLowerCase() !== "unipile"
  ) {
    return null;
  }
  return "linkedin:unipile:inbound";
}

function shouldHoldInboundSameCredentialFallbackForPass(reason) {
  const normalized = normalizeNullableString(reason)?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes("timeout")
    || normalized.includes("timed out")
    || normalized.includes("connector_no_client_session")
    || normalized.includes("errors/no_client_session")
    || normalized.includes("no_client_session");
}

function summarizeInboundCaptureResult(capture, capability) {
  if (!capture || typeof capture !== "object") {
    return {
      status: null,
      error: null,
      itemCount: null,
    };
  }

  const status = normalizeNullableString(capture.status)?.toLowerCase() ?? null;
  const error = normalizeNullableString(capture.error);
  const itemCount = Number.isInteger(capture.itemCount) ? capture.itemCount : null;
  if (capability !== "linkedin" || status || error || itemCount !== null) {
    return { status, error, itemCount };
  }

  const sections = Array.isArray(capture.sections) ? capture.sections : [];
  return {
    status: summarizeInboundCaptureSectionStatus(sections),
    error: sections.map((section) => resolveLinkedinSurfaceError(section)).find(Boolean) ?? null,
    itemCount: sections.reduce(
      (sum, section) => sum + (Number.isInteger(section?.itemCount) ? section.itemCount : 0),
      0,
    ),
  };
}

function summarizeInboundCaptureSectionStatus(sections) {
  const statuses = sections
    .map((section) => normalizeNullableString(section?.status)?.toLowerCase() ?? null)
    .filter(Boolean);
  if (!statuses.length) {
    return null;
  }
  if (statuses.includes("failed")) {
    return "failed";
  }
  if (statuses.includes("warning")) {
    return "warning";
  }
  if (statuses.every((status) => status === "success")) {
    return "success";
  }
  return statuses[0];
}

/** @param {any} task */
function runInboundIdentityResolutionTask(task) {
  const observation = task?.observationId ? findInboundObservationById(task.observationId) : null;
  if (!observation) {
    return {
      status: "discarded",
      detail: {
        reason: `Inbound observation ${task?.observationId ?? "unknown"} no longer exists.`,
      },
    };
  }
  if (!needsInboundIdentityResolution(observation)) {
    return {
      status: "discarded",
      detail: {
        reason: "Inbound sender already has a governed LinkedIn identity.",
      },
    };
  }

  const rawUser = findUserById(observation.userId);
  const managedLinkedinAccount = resolveManagedLinkedinAccount(rawUser, {
    runtime: "codex",
    connector: "unipile",
    availableOnly: true,
  });
  const relatedObservations = listInboundObservations({ userId: observation.userId }).filter(
    (candidate) => candidate.id === observation.id || inboundObservationsSharePersonIdentity(candidate, observation),
  );
  if (!managedLinkedinAccount?.providerAccountId) {
    const applied = applyInboundIdentityResolutionResult({
      seedObservation: observation,
      relatedObservations,
      rawCompanies: listCompanies(),
      resolution: {
        status: "blocked",
        reason: "No managed LinkedIn connector path is currently available for automatic identity resolution.",
      },
    });
    for (const updatedObservation of applied.updatedObservations) {
      upsertInboundObservation(updatedObservation);
    }
    return {
      status: "blocked",
      detail: {
        reason: "No managed LinkedIn connector path is currently available for automatic identity resolution.",
        identityResolutionStatus: "blocked",
      },
    };
  }

  let rawResolution;
  try {
    rawResolution = runCodexTask({
      prompt: buildInboundIdentityResolutionPrompt(observation, relatedObservations, managedLinkedinAccount),
      schema: buildInboundIdentityResolutionOutputSchema(),
      outputName: `resolve-inbound-identity-${observation.id}.json`,
      browserRequired: false,
      connectorRequired: true,
      enabledPlugins: ["gmail@openai-curated"],
      enabledMcpServers: ["unipile"],
      timeoutMs: INBOUND_IDENTITY_RESOLUTION_TIMEOUT_MS,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const applied = applyInboundIdentityResolutionResult({
      seedObservation: observation,
      relatedObservations,
      rawCompanies: listCompanies(),
      resolution: {
        status: "blocked",
        reason,
      },
    });
    for (const updatedObservation of applied.updatedObservations) {
      upsertInboundObservation(updatedObservation);
    }
    return {
      status: "blocked",
      detail: {
        reason,
        identityResolutionStatus: "blocked",
      },
    };
  }

  const resolution = normalizeInboundIdentityResolutionResult(rawResolution);
  const applied = applyInboundIdentityResolutionResult({
    seedObservation: observation,
    relatedObservations,
    rawCompanies: listCompanies(),
    resolution,
    companyProfile: buildInboundIdentityResolutionCompanyProfile(resolution),
  });
  for (const company of applied.companiesToCreate) {
    insertCompany(company);
  }
  for (const company of applied.companiesToUpdate) {
    updateCompany(company);
  }
  for (const updatedObservation of applied.updatedObservations) {
    upsertInboundObservation(updatedObservation);
  }

  return {
    status: resolution.status === "blocked" ? "blocked" : "completed",
    detail: {
      reason: resolution.reason ?? null,
      identityResolutionStatus: resolution.status,
      matchedObservationCount: applied.updatedObservations.length,
      linkedinProfileUrl: resolution.linkedinProfileUrl ?? null,
      linkedinPublicId: resolution.linkedinPublicId ?? null,
      companyDomain: resolution.companyDomain ?? null,
    },
  };
}

/** @param {any} task */
function runCompanyDiscoveryTask(task) {
  const beforeCompanyIds = findMotionLinkedCompanyIds(task.motionId);
  const briefArgs = [
    "motion",
    "discovery-brief",
    task.motionId,
  ];
  if (Number.isInteger(task?.targetCompanyCount) && task.targetCompanyCount > 0) {
    briefArgs.push("--companies", String(task.targetCompanyCount));
  }
  briefArgs.push("--json");

  const brief = runExoJsonArgs(briefArgs);
  const remainingDeficit = Number(brief?.inputs?.inventory?.deficitAfterBacklog ?? 0);
  const minimumCompanyCount = Number.isInteger(task?.targetCompanyCount) && task.targetCompanyCount > 0
    ? task.targetCompanyCount
    : (
        Number.isInteger(brief?.inputs?.inventory?.targetCompanyCount) && Number(brief.inputs.inventory.targetCompanyCount) > 0
          ? Number(brief.inputs.inventory.targetCompanyCount)
          : 1
      );
  if (Number.isFinite(remainingDeficit) && remainingDeficit <= 0) {
    return {
      status: "discarded",
      detail: {
        reason: "Motion no longer needs autonomous company discovery.",
      },
    };
  }

  let result;
  try {
    result = runCodexTask({
      prompt: buildCompanyDiscoveryPrompt(brief, task),
      schema: null,
      outputName: `company-discovery-${task.motionId}.json`,
      browserRequired: false,
      useOutputSchema: false,
      timeoutMs: resolveResearchTaskTimeoutMs(task.kind),
    });
  } catch (error) {
    return buildBlockedCodexTaskResult(error, { summary: null });
  }

  if (!isAutonomousPacketRunSuccessful(result?.status)) {
    return {
      status: "blocked",
      detail: {
        reason: normalizeNullableString(result?.reason) ?? "Company discovery task did not complete.",
        summary: normalizeNullableString(result?.summary) ?? null,
      },
    };
  }

  const afterCompanyIds = findMotionLinkedCompanyIds(task.motionId);
  const addedCompanyIds = afterCompanyIds.filter((companyId) => !beforeCompanyIds.includes(companyId));
  const summary = normalizeNullableString(result?.summary) ?? null;
  const completionStatus = normalizeNullableString(result?.completionStatus) ?? null;

  if (addedCompanyIds.length < minimumCompanyCount && completionStatus !== "exhausted") {
    return {
      status: "failed",
      detail: {
        reason: `Company discovery task reported completion, but only ${addedCompanyIds.length} of the required minimum ${minimumCompanyCount} compan${minimumCompanyCount === 1 ? "y was" : "ies were"} linked into the motion backlog.`,
        summary,
      },
    };
  }

  return {
    status: "completed",
    detail: {
      addedCompanyCount: addedCompanyIds.length,
      targetCompanyCount: minimumCompanyCount,
      completionStatus: completionStatus ?? (addedCompanyIds.length > 0 ? "queued_for_research" : "exhausted"),
      summary,
    },
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

  let result;
  try {
    result = runCodexTask({
      prompt: buildCompanyResearchPrompt(brief, claimedTask),
      schema: null,
      outputName: `company-research-${claimedTask.motionId}-${claimedTask.companyId}.json`,
      browserRequired: false,
      useOutputSchema: false,
      timeoutMs: resolveResearchTaskTimeoutMs(claimedTask.kind),
    });
  } catch (error) {
    return buildBlockedCodexTaskResult(error, { summary: null });
  }

  if (!isAutonomousPacketRunSuccessful(result?.status)) {
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

  if (!terminalPacketCompletionMatchesQueueState(completionStatus, queueStatus)) {
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
function runProspectSelectionTask(task) {
  const claimed = ensureProspectSelectionTaskClaimed(task);
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

  let result;
  try {
    result = runCodexTask({
      prompt: buildProspectSelectionPrompt(brief, claimedTask),
      schema: null,
      outputName: `prospect-selection-${claimedTask.motionId}-${claimedTask.companyId}.json`,
      browserRequired: false,
      useOutputSchema: false,
      timeoutMs: resolveResearchTaskTimeoutMs(claimedTask.kind),
    });
  } catch (error) {
    return buildBlockedCodexTaskResult(error, { summary: null });
  }

  if (!isAutonomousPacketRunSuccessful(result?.status)) {
    return {
      status: "blocked",
      detail: {
        reason: normalizeNullableString(result?.reason) ?? "Prospect selection task did not complete.",
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
        reason: `Prospect selection task reported completion, but packet state is still ${packetStatus ?? "unknown"}.`,
        summary,
      },
    };
  }

  if (!["selected", "ready", "suppressed", "exhausted"].includes(queueStatus ?? "")) {
    return {
      status: "failed",
      detail: {
        reason: `Prospect selection task reported completion, but account queue state is still ${queueStatus ?? "unknown"}.`,
        summary,
      },
    };
  }

  if (!prospectSelectionCompletionMatchesQueueState(completionStatus, queueStatus)) {
    return {
      status: "failed",
      detail: {
        reason: `Prospect selection task returned ${completionStatus}, but Exo stored ${queueStatus}.`,
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
function ensureProspectSelectionTaskClaimed(task) {
  if (task?.claimState !== "claimable") {
    return { ok: true, status: "completed", task };
  }

  const rawMotion = task?.motionId ? findMotionById(task.motionId) : null;
  if (!rawMotion) {
    return {
      ok: false,
      status: "failed",
      reason: `Prospect selection task is missing motion ${task?.motionId ?? "unknown"}.`,
    };
  }

  const rawCompany = task?.companyId ? findCompanyById(task.companyId) : null;
  if (!rawCompany) {
    return {
      ok: false,
      status: "failed",
      reason: `Prospect selection task is missing company ${task?.companyId ?? "unknown"}.`,
    };
  }

  try {
    const updatedMotion = claimMotionTargetAccountPacket(rawMotion, rawCompany, {
      workerLabel: AUTONOMOUS_WORKER_LABEL,
      notes: task?.notes ?? "Claimed automatically for autonomous prospect selection.",
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
        reason: "claimed_prospect_selection_packet",
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
function runProspectResearchTask(task) {
  const claimed = ensureProspectResearchTaskClaimed(task);
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

  let result;
  try {
    result = runCodexTask({
      prompt: buildProspectResearchPrompt(brief, claimedTask),
      schema: null,
      outputName: `prospect-research-${claimedTask.motionId}-${claimedTask.companyId}-${claimedTask.prospectId}.json`,
      browserRequired: false,
      useOutputSchema: false,
      timeoutMs: resolveResearchTaskTimeoutMs(claimedTask.kind),
    });
  } catch (error) {
    return buildBlockedCodexTaskResult(error, { summary: null });
  }

  if (!isAutonomousPacketRunSuccessful(result?.status)) {
    return {
      status: "blocked",
      detail: {
        reason: normalizeNullableString(result?.reason) ?? "Prospect research task did not complete.",
        summary: normalizeNullableString(result?.summary) ?? null,
      },
    };
  }

  const prospectState = findMotionProspectState(claimedTask.motionId, claimedTask.companyId, claimedTask.prospectId);
  const packetStatus = prospectState?.packetState?.status ?? null;
  const queueStatus = prospectState?.queueState?.status ?? null;
  const completionStatus = normalizeNullableString(result?.completionStatus) ?? null;
  const summary = normalizeNullableString(result?.summary) ?? null;

  if (packetStatus !== "completed") {
    return {
      status: "failed",
      detail: {
        reason: `Prospect research task reported completion, but packet state is still ${packetStatus ?? "unknown"}.`,
        summary,
      },
    };
  }

  if (!["ready", "suppressed", "exhausted"].includes(queueStatus ?? "")) {
    return {
      status: "failed",
      detail: {
        reason: `Prospect research task reported completion, but prospect queue state is still ${queueStatus ?? "unknown"}.`,
        summary,
      },
    };
  }

  if (!terminalPacketCompletionMatchesQueueState(completionStatus, queueStatus)) {
    return {
      status: "failed",
      detail: {
        reason: `Prospect research task returned ${completionStatus}, but Exo stored ${queueStatus}.`,
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
function ensureProspectResearchTaskClaimed(task) {
  if (task?.claimState !== "claimable") {
    return { ok: true, status: "completed", task };
  }

  const rawMotion = task?.motionId ? findMotionById(task.motionId) : null;
  if (!rawMotion) {
    return {
      ok: false,
      status: "failed",
      reason: `Prospect research task is missing motion ${task?.motionId ?? "unknown"}.`,
    };
  }

  const rawCompany = task?.companyId ? findCompanyById(task.companyId) : null;
  if (!rawCompany) {
    return {
      ok: false,
      status: "failed",
      reason: `Prospect research task is missing company ${task?.companyId ?? "unknown"}.`,
    };
  }

  try {
    const updatedMotion = claimMotionProspectPacket(rawMotion, rawCompany, {
      prospectId: task.prospectId,
      workerLabel: AUTONOMOUS_WORKER_LABEL,
      notes: task?.notes ?? "Claimed automatically for autonomous prospect research.",
    });
    const storedMotion = updateMotion(updatedMotion);
    const account = (storedMotion.targetMap?.accounts ?? []).find((item) => item.companyId === rawCompany.id) ?? null;
    const prospect = (account?.prospects ?? []).find((item) => item.id === task?.prospectId) ?? null;
    const claimedAt = prospect?.packetState?.claimedAt ?? task?.queuedAt ?? null;
    return {
      ok: true,
      status: "completed",
      task: {
        ...task,
        claimState: "claimed",
        reason: "claimed_prospect_research_packet",
        workerLabel: prospect?.packetState?.workerLabel ?? AUTONOMOUS_WORKER_LABEL,
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
export function runSendTask(task) {
  const selectedMode = typeof task?._selectedSendMode === "string" ? task._selectedSendMode : getSendMode();
  const dryRun = selectedMode === "verify" || selectedMode === "canary_verify";
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
      detail: buildBlockedSendHandoffDetail(handoff),
    };
  }

  const dispatchGateBlock = buildDispatchGateBlockedSendResult(handoff);
  if (dispatchGateBlock) {
    return dispatchGateBlock;
  }

  if (!usesConnectorNativeSend(handoff)) {
    return {
      status: "blocked",
      detail: {
        reason: `LinkedIn send no longer supports browser-backed execution. ${handoff.connector ?? "unknown"} must resolve through a governed connector-native path.`,
      },
    };
  }

  const result = runConnectorCodexTask({
    prompt: buildSendPrompt(handoff, { dryRun }),
    outputName: `send-${task.motionId}-${task.prospectId}-${task.surface}.json`,
    timeoutMs: BROWSER_TIMEOUT_MS,
    enabledPlugins: resolveCodexConnectorPluginIds(handoff.connector ?? handoff.channel ?? null),
    enabledMcpServers: resolveCodexConnectorMcpServerIds(handoff.connector ?? handoff.channel ?? null),
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

  const handledAlreadyPending = maybeHandleAlreadyPendingLinkedinConnectionRequestTask(task, handoff, result, { dryRun });
  if (handledAlreadyPending) {
    return handledAlreadyPending;
  }

  const handledUnavailable = maybeHandleUnavailableLinkedinReplyTask(task, handoff, result, { dryRun });
  if (handledUnavailable) {
    return handledUnavailable;
  }
  const handledPublicUnavailable = maybeHandleUnavailableLinkedinPublicEngagementTask(task, handoff, result, { dryRun });
  if (handledPublicUnavailable) {
    return handledPublicUnavailable;
  }

  if (result.status !== "sent") {
    return {
      status: "blocked",
      detail: { reason: result.reason ?? "Send task was not completed." }
    };
  }

  runShellText(resolveSendTaskWriteback(task, result));
  return {
    status: "completed",
    detail: { action: handoff.action, recipient: describeHandoffRecipient(handoff) }
  };
}

/** @param {any} handoff */
function buildDispatchGateBlockedSendResult(handoff) {
  const gate = handoff?.dispatchGate ?? null;
  if (!gate || gate.status === "allow") return null;
  return {
    status: "blocked",
    detail: buildBlockedSendHandoffDetail(handoff),
  };
}

/** @param {any} handoff */
function buildBlockedSendHandoffDetail(handoff) {
  const gate = handoff?.dispatchGate ?? null;
  return {
    reason: handoff?.reason ?? gate?.reason ?? "Send contract is blocked.",
    reasonCode: handoff?.reasonCode ?? gate?.reasonCode ?? null,
    blockReason: handoff?.blockReason ?? gate?.blockReason ?? null,
    waitingReason: handoff?.waitingReason ?? gate?.waitingReason ?? null,
    nextDueAt: handoff?.nextDueAt ?? gate?.nextDueAt ?? null,
    dispatchGate: gate,
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
 * If LinkedIn already shows the invite as pending on the governed account,
 * the external state is already in the desired outbound state. Reconcile that
 * into Exo instead of retrying the same cold send forever.
 *
 * @param {any} task
 * @param {any} handoff
 * @param {any} result
 * @param {{ dryRun?: boolean }} [options]
 */
function maybeHandleAlreadyPendingLinkedinConnectionRequestTask(task, handoff, result, options = {}) {
  if (options.dryRun === true) {
    return null;
  }
  if (task?.surface !== "connection_request") {
    return null;
  }
  if (handoff?.channel !== "linkedin" || handoff?.action !== "send_connection_request") {
    return null;
  }
  if (result?.status !== "blocked") {
    return null;
  }

  const reason = normalizeNullableString(result?.reason);
  if (!reason || !/already pending/i.test(reason)) {
    return null;
  }

  runShellText(resolveSendTaskWriteback(task, result));
  return {
    status: "completed",
    detail: {
      action: handoff.action,
      recipient: describeHandoffRecipient(handoff),
      inviteAlreadyPending: true,
      handledException: true,
      reason,
    },
  };
}

/**
 * @param {any} task
 * @param {any} handoff
 * @param {any} result
 * @param {{ dryRun?: boolean }} [options]
 */
function maybeHandleUnavailableLinkedinPublicEngagementTask(task, handoff, result, options = {}) {
  if (options.dryRun === true) {
    return null;
  }
  if (result?.status !== "unavailable") {
    return null;
  }
  if (!task?.unavailableWriteback) {
    return null;
  }
  const action = String(handoff?.action ?? "");
  if (!["like_post", "create_comment_reaction", "create_post_comment", "create_comment_comment"].includes(action)) {
    return null;
  }

  runShellText(task.unavailableWriteback);
  return {
    status: "completed",
    detail: {
      action: handoff.action,
      recipient: describeHandoffRecipient(handoff),
      publicTargetUnavailable: true,
      handledException: true,
      reason: result.reason ?? "Stored public-engagement target was unavailable.",
    },
  };
}

/**
 * @param {any} task
 * @param {any} result
 */
function resolveSendTaskWriteback(task, result) {
  const usedTargetUrl = normalizeNullableString(result?.usedTargetUrl);
  let writeback = task.writeback;
  if (usedTargetUrl && task?.writebackByTargetUrl && typeof task.writebackByTargetUrl === "object") {
    const targetWriteback = task.writebackByTargetUrl[usedTargetUrl];
    if (typeof targetWriteback === "string" && targetWriteback.trim().length) {
      writeback = targetWriteback;
    }
  }
  if (task?.postSendNextAction && Number.isFinite(task?.postSendDelayMs)) {
    const dueAt = new Date(Date.now() + Number(task.postSendDelayMs)).toISOString();
    return `${writeback} --next-action ${shellQuote(task.postSendNextAction)} --next-action-due-at ${dueAt}`;
  }
  return writeback;
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

function createAgentExecutionContext() {
  return {
    linkedinMaintenanceSessions: new Map(),
    inboundConnectorFallbacks: new Map(),
  };
}

/** @param {{ linkedinMaintenanceSessions?: Map<string, any>, inboundConnectorFallbacks?: Map<string, any> } | null} executionContext */
function disposeAgentExecutionContext(executionContext) {
  void executionContext;
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

/**
 * @param {any} task
 * @param {{ linkedinMaintenanceSessions?: Map<string, any> } | null} [executionContext]
 */
function runBrowserActionTask(task, executionContext = null) {
  void executionContext;
  const handoff = buildLinkedinMaintenanceHandoff(task, {
    codexHome: CODEX_HOME,
  });
  if (handoff.status !== "ready") {
    return {
      status: "blocked",
      detail: { reason: handoff.reason ?? `${task.kind} is not ready for Unipile MCP maintenance.` },
    };
  }

  let connectorResult;
  try {
    connectorResult = runConnectorCodexTask({
      prompt: buildLinkedinMaintenancePrompt(handoff),
      outputName: `linkedin-maintenance-${task.kind}-${task.observationId}.json`,
      timeoutMs: BROWSER_TIMEOUT_MS,
      enabledPlugins: [],
      enabledMcpServers: ["unipile"],
    });
  } catch (error) {
    if (handoff.executionPolicy?.sameCredentialHttpFallbackAllowed === true && shouldUseSameCredentialUnipileHttpFallback(error)) {
      return runSameCredentialUnipileHttpMaintenanceFallback(task, handoff, error);
    }
    return buildBlockedCodexTaskResult(error, {
      action: task.kind,
      recipientUrl: task.recipientUrl ?? null,
      transport: "unipile_mcp",
    });
  }

  const result = applyLinkedinMaintenanceConnectorResult(task, connectorResult);
  if (result.status !== "completed") {
    if (handoff.executionPolicy?.sameCredentialHttpFallbackAllowed === true && shouldUseSameCredentialUnipileHttpFallback(result)) {
      return runSameCredentialUnipileHttpMaintenanceFallback(task, handoff, result);
    }
    return {
      status: "blocked",
      detail: {
        reason: result.reason ?? `${task.kind} did not complete through Unipile MCP.`,
        action: task.kind,
        recipientUrl: task.recipientUrl ?? null,
        transport: "unipile_mcp",
        responseStatus: result.responseStatus ?? null,
      },
    };
  }

  if (handoff.writebackMode === "task_writeback_after_completion" && normalizeNullableString(task.writeback)) {
    runShellText(task.writeback);
  }
  return {
    status: "completed",
    detail: {
      action: task.kind,
      recipientUrl: task.recipientUrl ?? null,
      transport: "unipile_mcp",
      resolvedKind: result.resolvedKind ?? null,
      profileStatus: result.profileStatus ?? null,
    }
  };
}

function runSameCredentialUnipileHttpMaintenanceFallback(task, handoff, problem) {
  const fallbackReason = extractSameCredentialFallbackReason(problem) ?? "Unipile MCP tool was unavailable.";
  const result = runLinkedinMaintenanceWithUnipile(task, {
    codexHome: CODEX_HOME,
    allowDirectUnipileHttp: true,
  });

  if (result.status !== "completed") {
    return {
      status: "blocked",
      detail: {
        reason: `Unipile MCP was unavailable (${fallbackReason}); same-credential HTTP fallback blocked: ${result.reason ?? "unknown failure"}`,
        action: task.kind,
        recipientUrl: task.recipientUrl ?? null,
        transport: "unipile_http_same_credentials_fallback",
        fallbackFrom: "unipile_mcp",
      },
    };
  }

  if (handoff.writebackMode === "task_writeback_after_completion" && normalizeNullableString(task.writeback)) {
    runShellText(task.writeback);
  }
  return {
    status: "completed",
    detail: {
      action: task.kind,
      recipientUrl: task.recipientUrl ?? null,
      transport: "unipile_http_same_credentials_fallback",
      fallbackFrom: "unipile_mcp",
      fallbackReason,
      responseStatus: result.responseStatus ?? null,
      resolvedKind: result.resolvedKind ?? null,
      profileStatus: result.profileStatus ?? null,
    },
  };
}

/** @param {unknown} problem */
export function shouldUseSameCredentialUnipileHttpFallback(problem) {
  const httpStatus = extractSameCredentialFallbackHttpStatus(problem);
  if (httpStatus !== null && httpStatus > 0) {
    return false;
  }

  const reason = extractSameCredentialFallbackReason(problem);
  if (!reason) {
    return false;
  }

  const normalized = reason.toLowerCase();
  if (
    normalized.includes("out of messages")
    || normalized.includes("usage limit")
    || normalized.includes("rate limit")
    || normalized.includes("quota")
    || normalized.includes("timed out")
    || normalized.includes("timeout")
    || normalized.includes("errors/no_client_session")
    || normalized.includes("no_client_session")
    || normalized.includes("unauthorized")
    || normalized.includes("forbidden")
    || normalized.includes("non-2xx")
    || normalized.includes("api returned")
    || normalized.includes("unipile returned")
    || /\bhttp\s+\d{3}\b/.test(normalized)
    || /\bstatus\s+\d{3}\b/.test(normalized)
  ) {
    return false;
  }

  const mentionsMcp = normalized.includes("mcp") || normalized.includes("execute_request");
  const availabilityGap = [
    "unavailable",
    "not available",
    "not configured",
    "not enabled",
    "disabled",
    "unknown tool",
    "tool not found",
    "no such tool",
    "no tool",
    "does not provide",
    "does not support",
    "not supported",
    "unsupported",
    "not exposed",
    "server not found",
    "server missing",
  ].some((pattern) => normalized.includes(pattern));

  return mentionsMcp && availabilityGap;
}

/** @param {unknown} problem */
function extractSameCredentialFallbackReason(problem) {
  if (problem instanceof Error) {
    return normalizeNullableString(problem.message);
  }
  if (typeof problem === "string") {
    return normalizeNullableString(problem);
  }
  if (!problem || typeof problem !== "object") {
    return null;
  }
  return normalizeNullableString(problem.reason)
    ?? normalizeNullableString(problem.message)
    ?? normalizeNullableString(problem.error)
    ?? null;
}

/** @param {unknown} problem */
function extractSameCredentialFallbackHttpStatus(problem) {
  if (!problem || typeof problem !== "object") {
    return null;
  }
  for (const key of ["httpStatus", "responseStatus", "statusCode"]) {
    const value = problem[key];
    if (Number.isInteger(value)) {
      return value;
    }
  }
  return null;
}

/** @param {any} task */
function runInboundContract(task, options = {}) {
  if (task.capability === "gmail" || task.capability === "linkedin") {
    return runExoJsonArgs(
      buildInboundContractArgs(task, options),
      { timeoutMs: resolveInboundExoCommandTimeoutMs(task) },
    );
  }

  throw new Error(`Unsupported inbound capability: ${task.capability}`);
}

/** @param {any} task */
export function buildInboundContractArgs(task, options = {}) {
  const command = task?.capability === "linkedin"
    ? "linkedin-live"
    : task?.capability === "gmail"
      ? "gmail-live"
      : null;
  if (!command) {
    throw new Error(`Unsupported inbound capability: ${task?.capability ?? "unknown"}`);
  }
  const supportsLinkedinScopedFlags = task?.capability === "linkedin";

  const args = [
    "inbound",
    "sync",
    command,
    task.userId,
    "--account",
    task.accountId,
  ];
  if (supportsLinkedinScopedFlags) {
    for (const surfaceKey of normalizeInboundTaskSurfaceKeys(task)) {
      args.push("--surface", surfaceKey);
    }
    const resumeCursor = normalizeNullableString(task?.resumeCursor);
    if (resumeCursor) {
      args.push("--resume-cursor", resumeCursor);
    }
    if (Number.isInteger(task?.resumeStartOffset) && task.resumeStartOffset >= 0) {
      args.push("--resume-start-offset", String(task.resumeStartOffset));
    }
    if (Number.isInteger(task?.maxPages) && task.maxPages > 0) {
      args.push("--max-pages", String(task.maxPages));
    }
    if (Number.isInteger(task?.pageSize) && task.pageSize > 0) {
      args.push("--page-size", String(task.pageSize));
    }
    if (options.directUnipileHttp === true) {
      args.push("--direct-unipile-http");
    }
  }
  args.push(
    "--mode",
    task.mode,
    "--json",
  );
  return args;
}

/** @param {any} task */
export function resolveInboundExoCommandTimeoutMs(task) {
  if (task?.mode === "full") {
    return Math.max(INBOUND_EXO_COMMAND_TIMEOUT_MS, INBOUND_CAPTURE_TIMEOUT_MS);
  }
  return INBOUND_EXO_COMMAND_TIMEOUT_MS;
}

/** @param {any} task */
function normalizeInboundTaskSurfaceKeys(task) {
  if (!Array.isArray(task?.surfaceKeys)) return [];
  return [...new Set(task.surfaceKeys
    .map((surfaceKey) => normalizeNullableString(surfaceKey))
    .filter(Boolean))];
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
      timeout: resolveInboundExoCommandTimeoutMs(task),
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
      timeout: resolveInboundExoCommandTimeoutMs(task),
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

/** @param {any} task @param {{ subject: string | null, body: string }} draft */
function setDraft(task, draft) {
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
    draft.body
  );
  if (draftSurfaceUsesSubject(task.surface) && draft.subject) {
    args.push("--subject", draft.subject);
  }
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
export function buildCodexTaskArgs(input, outputPath, schemaPath = null) {
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

  const ignoreUserConfig = shouldIgnoreCodexUserConfig(input);
  if (ignoreUserConfig) {
    args.push("--ignore-user-config");
  }

  if (schemaPath) {
    args.push("--output-schema", schemaPath);
  }

  if (input.browserRequired || input.connectorRequired) {
    args.push(
      "-c",
      'model_reasoning_effort="medium"',
    );
  }

  for (const pluginId of input.browserRequired
    ? ["chrome@openai-bundled"]
    : normalizePluginIds(input.enabledPlugins)) {
    args.push("-c", `plugins."${pluginId}".enabled=true`);
  }

  if (!ignoreUserConfig) {
    for (const mcpServerId of normalizePluginIds(input.enabledMcpServers)) {
      args.push("-c", `mcp_servers.${mcpServerId}.enabled=true`);
    }
  }

  args.push("-");
  return args;
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
export function buildCodexTaskExecOptions(input) {
  return {
    cwd: ROOT,
    env: buildCodexTaskEnv(process.env),
    encoding: "utf8",
    input: input.prompt,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: input.timeoutMs,
    // The background host pass must reclaim control when a Codex child times
    // out. SIGTERM can leave the pass hung while the child ignores shutdown.
    killSignal: "SIGKILL",
    maxBuffer: 10 * 1024 * 1024,
  };
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
  let schemaPath = null;

  if (input.useOutputSchema !== false) {
    schemaPath = path.join(tempDir, "schema.json");
    fs.writeFileSync(schemaPath, JSON.stringify(sanitizeCodexOutputSchema(input.schema), null, 2));
  }

  const args = buildCodexTaskArgs(input, outputPath, schemaPath);

  try {
    execFileSync(CODEX_BIN, args, buildCodexTaskExecOptions(input));
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
 * @param {string} value
 */
function shellQuote(value) {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
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

function cleanupHostStateOnStartup() {
  return mutateHostState((state) => pruneExpiredBrowserBackoffs(state));
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

/**
 * Apply a host-state mutation against a freshly loaded copy under the
 * cross-process lock, persisting only when the mutator returns a new object.
 * Exported so concurrency tests can exercise the lock from sibling processes.
 * @param {(state: any) => any} mutator
 * @returns {any} the latest host state (mutated or fresh-loaded)
 */
export function mutateHostState(mutator) {
  return withAgentHostStateLock(STATE_DIR, () => {
    const fresh = loadHostState();
    const next = mutator(fresh) ?? fresh;
    if (next !== fresh) {
      saveHostState(next);
    }
    return next;
  });
}

/** @param {any} [hostState] */
function loadQueue(hostState = null) {
  return buildAgentQueue({
    motions: listMotions(),
    companies: listCompanies(),
    users: listUsers(),
    observations: listInboundObservations(),
    cues: listInboundCues(),
    prospectBranches: listAgentQueueProspectBranches(),
    hostState,
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

/** @param {any} task */
function normalizeQueueTaskDeficit(task) {
  const deficit = Number(task?.deficitAfterBacklog);
  return Number.isFinite(deficit) ? Math.max(0, Math.floor(deficit)) : 0;
}

/** @param {any} brief */
export function buildDraftOutputSchema(brief) {
  if (draftSurfaceUsesSubject(brief?.surface?.key)) {
    return {
      type: "object",
      additionalProperties: false,
      required: ["subject", "body"],
      properties: {
        subject: { type: "string", minLength: 1 },
        body: { type: "string", minLength: 1 },
      },
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["body"],
    properties: {
      body: { type: "string", minLength: 1 },
    },
  };
}

/** @param {any} brief */
export function buildDraftPrompt(brief) {
  const usesSubject = draftSurfaceUsesSubject(brief?.surface?.key);
  return [
    "Write exactly one governed Exo draft from the brief below.",
    "You are running in a detached background pass.",
    "Do not browse, do not inspect the repo, do not narrate your process, and do not ask questions.",
    "Return only JSON that matches the provided schema.",
    usesSubject
      ? "The schema has fields: subject and body. Put the exact outbound copy there and nothing else."
      : "The schema has one field only: body. Put the exact outbound copy there and nothing else.",
    usesSubject
      ? "If surface.replySubject is present, this is a reply. Use surface.replySubject exactly as the subject line. If it is absent, generate a concise subject line."
      : "Do not add a subject line for this surface.",
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

/**
 * @param {unknown} response
 * @param {string | null | undefined} surface
 */
export function extractDraftOutputFromCodexResponse(response, surface) {
  return {
    subject: draftSurfaceUsesSubject(surface) ? extractDraftSubjectFromCodexResponse(response) : null,
    body: extractDraftBodyFromCodexResponse(response),
  };
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

export function buildInboundIdentityResolutionOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "status",
      "reason",
      "actorName",
      "actorTitle",
      "actorCompanyName",
      "linkedinProfileUrl",
      "linkedinPublicId",
      "linkedinMemberId",
      "companyDomain",
      "companyWebsiteUrl",
      "linkedinCompanyUrl",
    ],
    properties: {
      status: {
        type: "string",
        enum: ["resolved", "no_match", "blocked"],
      },
      reason: { type: ["string", "null"] },
      actorName: { type: ["string", "null"] },
      actorTitle: { type: ["string", "null"] },
      actorCompanyName: { type: ["string", "null"] },
      linkedinProfileUrl: { type: ["string", "null"] },
      linkedinPublicId: { type: ["string", "null"] },
      linkedinMemberId: { type: ["string", "null"] },
      companyDomain: { type: ["string", "null"] },
      companyWebsiteUrl: { type: ["string", "null"] },
      linkedinCompanyUrl: { type: ["string", "null"] },
    },
  };
}

/**
 * @param {any} observation
 * @param {any[]} relatedObservations
 * @param {{ handle?: string | null, providerAccountId?: string | null }} managedLinkedinAccount
 */
export function buildInboundIdentityResolutionPrompt(observation, relatedObservations, managedLinkedinAccount) {
  const latestMessages = relatedObservations
    .flatMap((candidate) => Array.isArray(candidate?.messages) ? candidate.messages : [])
    .slice(-4)
    .map((message) => ({
      direction: message.direction ?? "unknown",
      fromName: message.fromName ?? null,
      fromHandle: message.fromHandle ?? null,
      sentAt: message.sentAt ?? null,
      body: typeof message.body === "string" ? message.body.slice(0, 1200) : "",
    }));

  return [
    "This is one bounded Exo inbound identity-resolution task.",
    "Do not inspect the repo, do not read arbitrary Exo state, do not run exo what-is-this, and do not narrate.",
    "Use the existing runtime connectors first.",
    "First use the Gmail connector for sender and thread context.",
    "Then use the Unipile MCP LinkedIn path for company and person resolution.",
    "Only if connector evidence is still insufficient, use public web or the sender domain as supporting evidence.",
    "Do not use Chrome or browser tools.",
    "Do not guess. If multiple LinkedIn people are plausible or confidence is not high, return status=no_match.",
    "Resolve exactly one governed LinkedIn person identity for this sender if you can do so confidently.",
    managedLinkedinAccount?.handle
      ? `The governed LinkedIn account handle for this workspace is ${managedLinkedinAccount.handle}.`
      : "Use the governed LinkedIn account already mapped in this runtime.",
    managedLinkedinAccount?.providerAccountId
      ? `If the Unipile tools require account selection, prefer providerAccountId ${managedLinkedinAccount.providerAccountId}.`
      : null,
    "Return only JSON that matches the schema.",
    "",
    "Observation JSON:",
    JSON.stringify({
      id: observation.id,
      actorName: observation.actorName ?? null,
      actorHandle: observation.actorHandle ?? null,
      actorCompanyName: observation.actorCompanyName ?? null,
      subject: observation.subject ?? null,
      summary: observation.summary ?? null,
      threadUrl: observation.threadUrl ?? observation.sourceUrl ?? null,
      relatedObservationCount: relatedObservations.length,
      recentMessages: latestMessages,
    }, null, 2),
  ].filter(Boolean).join("\n");
}

/** @param {any} handoff */
export function buildLinkedinMaintenancePrompt(handoff) {
  return [
    "This is one bounded Exo LinkedIn maintenance task.",
    "Do not inspect the repo, do not read Exo state, do not run exo what-is-this, and do not narrate.",
    "Use the Unipile MCP execute_request tool exactly once with the HAR request below.",
    "Do not use curl. Do not use shell commands. Do not use Chrome or browser tools.",
    "Do not switch LinkedIn identities, do not broaden to other invitations or profiles, and do not perform any action not represented by this contract.",
    "Return only JSON with fields: status, reason, httpStatus, responseBody.",
    "If the MCP request returns a 2xx response, return status=\"completed\", reason=null, httpStatus=<status>, responseBody=<parsed JSON body>.",
    "If the MCP tool is unavailable, return status=\"blocked\" with the concrete tool availability reason; the Exo host may apply a same-credential HTTP fallback.",
    "If the MCP request fails or returns a non-2xx response, return status=\"blocked\" with the concrete reason, httpStatus if known, and responseBody if available.",
    "",
    "Maintenance contract JSON:",
    JSON.stringify({
      provider: handoff.provider,
      connector: handoff.connector,
      taskKind: handoff.taskKind,
      action: handoff.action,
      observationId: handoff.observationId,
      actorName: handoff.actorName ?? null,
      recipientUrl: handoff.recipientUrl ?? null,
      writebackMode: handoff.writebackMode,
      executionPolicy: handoff.executionPolicy,
    }, null, 2),
    "",
    "HAR request JSON:",
    JSON.stringify(handoff.harRequest, null, 2),
  ].join("\n");
}

/**
 * @param {any} rawResult
 */
function normalizeInboundIdentityResolutionResult(rawResult) {
  const status = normalizeNullableString(rawResult?.status)?.toLowerCase() ?? "blocked";
  const linkedinProfileUrl = normalizeNullableString(rawResult?.linkedinProfileUrl);
  const linkedinPublicId = normalizeNullableString(rawResult?.linkedinPublicId) ?? extractLinkedinPublicId(linkedinProfileUrl);
  const linkedinMemberId = normalizeNullableString(rawResult?.linkedinMemberId);
  const normalized = {
    status: status === "resolved" || status === "no_match" || status === "blocked" ? status : "blocked",
    reason: normalizeNullableString(rawResult?.reason),
    checkedAt: new Date().toISOString(),
    actorName: normalizeNullableString(rawResult?.actorName),
    actorTitle: normalizeNullableString(rawResult?.actorTitle),
    actorCompanyName: normalizeNullableString(rawResult?.actorCompanyName),
    linkedinProfileUrl,
    linkedinPublicId,
    linkedinMemberId,
    companyDomain: normalizeNullableString(rawResult?.companyDomain),
    companyWebsiteUrl: normalizeNullableString(rawResult?.companyWebsiteUrl),
    linkedinCompanyUrl: normalizeNullableString(rawResult?.linkedinCompanyUrl),
  };

  if (
    normalized.status === "resolved"
    && !normalized.linkedinProfileUrl
    && !normalized.linkedinPublicId
    && !normalized.linkedinMemberId
  ) {
    return {
      ...normalized,
      status: "blocked",
      reason: "Inbound identity resolution returned resolved without a LinkedIn identity.",
    };
  }

  return normalized;
}

/** @param {any} brief @param {any} task */
export function buildCompanyResearchPrompt(brief, task) {
  return [
    "This is one bounded Exo company research packet.",
    "Do not inspect arbitrary repo files, do not read arbitrary Exo state, do not run exo what-is-this, and do not narrate.",
    "Use the runtime's native web retrieval capabilities for the actual research. Do not use browser tools or open Chrome windows.",
    "Start with the company site, then broaden to public web or news only if needed by the brief.",
    "Use shell commands only for the governed Exo writeback commands needed to store findings and complete the packet.",
    "Work only this one company. Persist only concise, writer-usable signal summaries and the company-level prospect case. Do not hunt people or direct contact data here. No em dashes.",
    "Before returning completed, run the governed Exo writeback commands needed to store the strongest evidence and complete the packet as researched, suppressed, or exhausted.",
    "When the packet is successful, set completionStatus to researched, suppressed, or exhausted. Do not use completed there.",
    "Return only JSON with exactly these fields: status, completionStatus, summary, reason.",
    "",
    "Task JSON:",
    JSON.stringify(task, null, 2),
    "",
    "Governed packet brief JSON:",
    JSON.stringify(brief, null, 2),
  ].join("\n");
}

/** @param {any} brief @param {any} task */
export function buildCompanyDiscoveryPrompt(brief, task) {
  return [
    "This is one bounded Exo company discovery task.",
    "Do not inspect arbitrary repo files, do not read arbitrary Exo state, do not run exo what-is-this, and do not narrate.",
    "Use the runtime's native web retrieval capabilities for public company discovery. Do not use browser tools or open Chrome windows.",
    "Stay on this one motion only. Add companies, not prospects, in this task.",
    "This lane is for fresh signal-qualified account discovery only. Do not do full company research or people research here.",
    "Treat the requested company count as a floor, not a ceiling.",
    "Use shell commands only for the governed Exo writeback commands needed to land new companies into the motion backlog.",
    "Only add companies that match the premise, target profile, and signal questions closely enough to justify downstream research. No filler accounts.",
    "If the same search path, source list, or page is already yielding more strong-fit companies, land them in this pass instead of stopping exactly at the minimum.",
    "Before returning completed, run the governed Exo writeback commands needed to queue the discovered companies for research.",
    "If the public web cannot support the full requested count, return exhausted instead of inventing weak fits.",
    "When the task is successful, set completionStatus to queued_for_research or exhausted. Do not use completed there.",
    "Return only JSON with exactly these fields: status, completionStatus, summary, reason.",
    "",
    "Task JSON:",
    JSON.stringify(task, null, 2),
    "",
    "Governed discovery brief JSON:",
    JSON.stringify(brief, null, 2),
  ].join("\n");
}

/** @param {any} brief @param {any} task */
export function buildProspectSelectionPrompt(brief, task) {
  return [
    "This is one bounded Exo prospect selection packet.",
    "Do not inspect arbitrary repo files, do not read arbitrary Exo state, do not run exo what-is-this, and do not narrate.",
    "Use the runtime's native web retrieval capabilities for public stakeholder discovery. Do not use browser tools or open Chrome windows.",
    "Stay on this one company. Pick the smallest credible stakeholder set and avoid committee bloat.",
    "Use shell commands only for the governed Exo writeback commands needed to store prospects, land any required LinkedIn profile viewbacks, and complete the packet.",
    "This lane is for finding the right people, not full contact enrichment. Only land the minimum governed profile evidence needed to identify the selected prospects.",
    "If you justify a selected prospect from a LinkedIn profile, store the governed LinkedIn profile enrichment before completing the packet.",
    "Persist only concise, writer-usable reasoning tied to the motion signal or premise. No em dashes.",
    "Before returning completed, run the governed Exo writeback commands needed to store the chosen stakeholders and complete the packet as selected, suppressed, or exhausted.",
    "When the packet is successful, set completionStatus to selected, ready, suppressed, or exhausted. Do not use completed there.",
    "Return only JSON with exactly these fields: status, completionStatus, summary, reason.",
    "",
    "Task JSON:",
    JSON.stringify(task, null, 2),
    "",
    "Governed packet brief JSON:",
    JSON.stringify(brief, null, 2),
  ].join("\n");
}

/** @param {any} brief @param {any} task */
export function buildProspectResearchPrompt(brief, task) {
  return [
    "This is one bounded Exo prospect research packet.",
    "Do not inspect arbitrary repo files, do not read arbitrary Exo state, do not run exo what-is-this, and do not narrate.",
    "Use the runtime's actual available public-web and enrichment capabilities. Do not use browser tools or open Chrome windows.",
    "Stay on this one prospect only. Do not branch into unrelated account work.",
    "Use shell commands only for the governed Exo writeback commands needed to store profile/contact enrichment, the minimum first-touch research context, and packet completion.",
    "This lane is for enriching the selected person and landing their governed profile/contact surface. Do not draft outreach, do not pick a touch sequence, and do not do broader account research here.",
    "The packet is not done until Exo shows the branch is ready for a first-touch decision, or you explicitly complete it into suppressed or exhausted.",
    "Persist only defensible research and verified usable contact points when found. No em dashes.",
    "Before returning completed, run the governed Exo writeback commands needed to land profile/contact enrichment, store only the research needed for first-touch context, and complete the packet.",
    "When the packet is successful, set completionStatus to ready, suppressed, or exhausted. Do not use completed there.",
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
  const autonomousPublicReaction = ["like_post", "create_comment_reaction"].includes(String(handoff?.action ?? ""));
  if (usesConnectorNativeSend(handoff)) {
    const connectorLabel = connectorToolLabel(handoff.connector);
    const unipilePromptHints = buildUnipileSendPromptHints(handoff);
    const dryRunHints = buildConnectorDryRunHints(handoff, { dryRun });
    return [
      "This is one bounded Exo connector send task.",
      "Do not inspect the repo, do not read Exo state, do not run exo what-is-this, and do not narrate.",
      dryRun
        ? "Prepare the governed send and stop before the final send action."
        : "Perform the governed send and nothing else.",
      `Use the native ${connectorLabel} tools already available in this runtime. Do not use Chrome browser tools.`,
      ...unipilePromptHints,
      ...dryRunHints,
      "Do not run diagnostics, do not open browser windows, do not switch identities, do not fall back to shell commands, and do not paraphrase the stored message.",
      dryRun
        ? "Do not send yet. After the exact governed action is loaded into the correct native target and is ready for a real send, return {\"status\":\"ready_to_send\",\"reason\":null}."
        : autonomousPublicReaction
          ? "Do not run Exo writeback yourself. After the real public reaction happens, return {\"status\":\"sent\",\"reason\":null,\"usedTargetUrl\":\"<the exact target URL you actually used>\"}. If the stored target is gone or unwritable and the contract provides one fallback target, try that one exactly once; if neither works, return {\"status\":\"unavailable\",\"reason\":\"<concrete reason>\",\"usedTargetUrl\":null}."
          : "Do not run Exo writeback yourself. After the real send happens, return {\"status\":\"sent\",\"reason\":null}. If the stored target is gone or unwritable, return {\"status\":\"unavailable\",\"reason\":\"<concrete reason>\",\"usedTargetUrl\":null}.",
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
      ? "Do not click Send. After the exact governed action is loaded into a writable target and is ready for a real send, return {\"status\":\"ready_to_send\",\"reason\":null}."
      : autonomousPublicReaction
        ? "Do not run Exo writeback yourself. After the real public reaction happens, return {\"status\":\"sent\",\"reason\":null,\"usedTargetUrl\":\"<the exact target URL you actually used>\"}. If the stored target is gone or unwritable and the contract provides one fallback target, try that one exactly once; if neither works, return {\"status\":\"unavailable\",\"reason\":\"<concrete reason>\",\"usedTargetUrl\":null}."
        : "Do not run Exo writeback yourself. After the real send happens, return {\"status\":\"sent\",\"reason\":null}. If the stored target is gone or unwritable, return {\"status\":\"unavailable\",\"reason\":\"<concrete reason>\",\"usedTargetUrl\":null}.",
    "",
    "Governed send contract JSON:",
    JSON.stringify(handoff, null, 2),
  ]);
}

/** @param {any} handoff */
function buildUnipileSendPromptHints(handoff) {
  if (normalizeConnectorPluginKey(handoff?.connector) !== "unipile") {
    return [];
  }

  const codexHome = normalizeNullableString(process.env.CODEX_HOME) ?? CODEX_HOME;
  const { baseUrl, baseUrlSource } = readUnipileConfig(codexHome);
  const exactBaseUrl = normalizeNullableString(baseUrl);
  if (!exactBaseUrl || baseUrlSource === "default") {
    return [];
  }

  return [
    `Use the configured Unipile MCP server for this runtime. This tenant's configured Unipile API root is ${exactBaseUrl}. Do not substitute localhost or documented default server examples.`,
    `If you need governed account discovery, call GET ${exactBaseUrl}/api/v1/accounts with accept: application/json and keep every follow-on Unipile request on that same base URL.`,
    "If a different Unipile base URL returns errors/no_client_session, treat that as a tenant routing mismatch, not as proof that the governed connector is down.",
  ];
}

/**
 * @param {any} handoff
 * @param {{ dryRun: boolean }} options
 */
function buildConnectorDryRunHints(handoff, options) {
  if (!options.dryRun) {
    return [];
  }
  if (normalizeConnectorPluginKey(handoff?.connector) !== "unipile") {
    return [];
  }
  return [
    "If the governed Unipile action is a direct POST with no native draft/composer state, do not treat that as a blocker.",
    "In that case, verify the governed account, recipient, and exact native send endpoint without firing it, then return {\"status\":\"ready_to_send\",\"reason\":null}.",
  ];
}

/** @param {any} captureRequest */
export function requiresBrowserAttachForInboundCapture(captureRequest) {
  return captureRequest?.captureTransportMode !== "connector_native_only";
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

function isRuntimeUsageLimitIgnored() {
  return normalizeBoolean(process.env.EXO_AGENT_IGNORE_USAGE_LIMIT, false);
}

/**
 * @param {{ runtime?: string | null, unavailableUntil?: string | null }} usageLimit
 */
function describeRuntimeUsageLimitHold(usageLimit) {
  const runtimeLabel = usageLimit?.runtime === "claude" ? "Claude" : "Codex";
  const until = usageLimit?.unavailableUntil ?? null;
  return until
    ? `${runtimeLabel} hit its usage limit. Queued work is on hold and draining resumes automatically after ${until}.`
    : `${runtimeLabel} hit its usage limit. Queued work is on hold until the limit resets.`;
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
 * @param {string | null} completionStatus
 * @param {string | null} queueStatus
 */
export function terminalPacketCompletionMatchesQueueState(completionStatus, queueStatus) {
  const normalizedCompletionStatus = canonicalizePacketCompletionStatus(completionStatus);
  const normalizedQueueStatus = canonicalizePacketCompletionStatus(queueStatus);
  if (!normalizedCompletionStatus || normalizedCompletionStatus === "none" || normalizedCompletionStatus === "completed") {
    return true;
  }
  if (normalizedCompletionStatus === "ready_for_first_touch_decision") {
    return normalizedQueueStatus === "ready";
  }
  return normalizedCompletionStatus === normalizedQueueStatus;
}

function prospectSelectionCompletionMatchesQueueState(completionStatus, queueStatus) {
  if (terminalPacketCompletionMatchesQueueState(completionStatus, queueStatus)) {
    return true;
  }
  const normalizedCompletionStatus = canonicalizePacketCompletionStatus(completionStatus);
  const normalizedQueueStatus = canonicalizePacketCompletionStatus(queueStatus);
  if (normalizedCompletionStatus === "selected" || normalizedCompletionStatus === "ready") {
    return normalizedQueueStatus === "selected" || normalizedQueueStatus === "ready";
  }
  return false;
}

/**
 * Bounded autonomous packet runs have emitted `completed`, `success`, and
 * `ok` for the same successful writeback path. Treat all three as success.
 *
 * @param {string | null | undefined} status
 * @returns {boolean}
 */
export function isAutonomousPacketRunSuccessful(status) {
  const normalized = normalizeNullableString(status)?.toLowerCase() ?? null;
  return normalized === "completed" || normalized === "success" || normalized === "ok";
}

/**
 * Tolerate small packet-status drift from bounded autonomous workers.
 * Different runs have emitted spaces, hyphens, or generic "complete"
 * language for the same terminal outcome.
 *
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function canonicalizePacketCompletionStatus(value) {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null;
  if (!normalized) return null;
  const compact = normalized
    .replace(/[.\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!compact) return null;
  if (compact === "complete" || compact === "done") return "completed";
  if (compact === "ready_for_first_touch" || compact === "first_touch_decision") return "ready_for_first_touch_decision";
  return compact;
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

/**
 * @param {string[]} args
 * @param {{ timeoutMs?: number | null }} [options]
 */
function runExoJsonArgs(args, options = {}) {
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
      timeout: options.timeoutMs ?? EXO_COMMAND_TIMEOUT_MS,
    });
    return parseJsonLoose(output);
  } catch (error) {
    throw new Error(`Exo command failed: ${args.join(" ")}\n${buildExecErrorMessage(error)}`);
  }
}

/**
 * @param {string} motionId
 */
function findMotionLinkedCompanyIds(motionId) {
  return listCompanies()
    .filter((company) => Array.isArray(company.motionIds) && company.motionIds.includes(motionId))
    .map((company) => company.id)
    .sort((left, right) => left.localeCompare(right));
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

/**
 * @param {string} motionId
 * @param {string} companyId
 * @param {string} prospectId
 */
function findMotionProspectState(motionId, companyId, prospectId) {
  const account = findMotionTargetAccountState(motionId, companyId);
  return (account?.prospects ?? []).find((prospect) => prospect?.id === prospectId) ?? null;
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

/** @param {string | null | undefined} surface */
function draftSurfaceUsesSubject(surface) {
  return SUBJECT_DRAFT_SURFACES.has(String(surface ?? "").trim());
}

/** @param {unknown} response */
function extractDraftSubjectFromCodexResponse(response) {
  return normalizeNullableString(extractNestedDraftSubject(response));
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function extractNestedDraftSubject(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) {
      return null;
    }
    const parsed = parseJsonLoose(trimmed);
    return parsed ? extractNestedDraftSubject(parsed) : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if (typeof value.subject === "string" && value.subject.trim().length) {
    return value.subject.trim();
  }

  if (value.draft && typeof value.draft === "object") {
    if (typeof value.draft.subject === "string" && value.draft.subject.trim().length) {
      return value.draft.subject.trim();
    }
    if (typeof value.draft.body === "string") {
      const nested = extractNestedDraftSubject(value.draft.body);
      if (nested) return nested;
    }
  }

  if (typeof value.body === "string") {
    return extractNestedDraftSubject(value.body);
  }

  return null;
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
  const requiredSurfaces = [
    "sentInvitations",
    "receivedInvitations",
    "messagingInbox",
    "profileViews",
    "followersList",
    "followingList",
  ];
  const explicitError = resolveLinkedinCaptureError(capture, status === "failed" ? requiredSurfaces : []);
  const error = status === "failed"
    ? (explicitError ?? "linkedin capture failed")
    : explicitError;
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

function resolveLinkedinCaptureError(capture, surfaceKeys) {
  const topLevelError = normalizeConnectorErrorValue(capture?.error)
    ?? normalizeConnectorErrorValue(capture?.reason)
    ?? normalizeConnectorErrorValue(capture?.errors)
    ?? normalizeConnectorErrorValue(capture?.account?.error)
    ?? normalizeConnectorErrorValue(capture?.account?.errors);
  if (topLevelError) return topLevelError;
  if (!surfaceKeys.length) return null;

  for (const surfaceKey of surfaceKeys) {
    const surfaceError = resolveLinkedinSurfaceError(capture?.[surfaceKey]);
    if (surfaceError) return surfaceError;
  }

  if (Array.isArray(capture?.surfaces)) {
    for (const surface of capture.surfaces) {
      const surfaceError = resolveLinkedinSurfaceError(surface);
      if (surfaceError) return surfaceError;
    }
  }

  return null;
}

function resolveLinkedinSurfaceError(surface) {
  return normalizeConnectorErrorValue(surface?.error)
    ?? normalizeConnectorErrorValue(surface?.reason)
    ?? normalizeConnectorErrorValue(surface?.errors);
}

function normalizeConnectorErrorValue(value) {
  const direct = normalizeNullableString(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const entryError = normalizeConnectorErrorValue(entry);
      if (entryError) return entryError;
    }
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const code = normalizeNullableString(value.code) ?? normalizeNullableString(value.type);
  const message = normalizeNullableString(value.message)
    ?? normalizeNullableString(value.title)
    ?? normalizeNullableString(value.reason);
  if (code && message) return `${code}: ${message}`;
  if (message) return message;
  if (code) return code;

  if (value.error && value.error !== value) {
    return normalizeConnectorErrorValue(value.error);
  }
  return null;
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
  const error = resolveLinkedinSurfaceError(surface);
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
      : (error ?? "linkedin capture failed"),
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

if (isMainModule(import.meta.url)) {
  try {
    const summary = runAgentHostPass();
    writeAgentPassSummary({ stateDir: STATE_DIR, lane: EXECUTION_LANE, summary });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
