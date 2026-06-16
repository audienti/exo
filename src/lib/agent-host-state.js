// @ts-check

import { createHash } from "node:crypto";

import { inspectAgentRunLock } from "./agent-run-lock.js";
import { AGENT_EXECUTION_LANES, getTaskExecutionLane } from "./agent-task-lanes.js";

export const BROWSER_TASK_LANE_BY_KIND = {
};

export const BROWSER_TRANSPORT_TASK_KINDS = new Set(Object.keys(BROWSER_TASK_LANE_BY_KIND));

/**
 * @param {string | null | undefined} taskKind
 */
export function getBrowserTaskLane(taskKind) {
  return taskKind ? (BROWSER_TASK_LANE_BY_KIND[taskKind] ?? null) : null;
}

/**
 * @param {any} state
 */
export function normalizeAgentHostState(state) {
  const normalized = {
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
    runtimeUsageLimit: {
      unavailableUntil: null,
      reason: null,
      detectedAt: null,
      runtime: null,
    },
    taskLeases: [],
    recentTaskVerifications: [],
    recentMotionTaskRuns: [],
    maintenanceTaskCooldowns: [],
  };

  for (const lane of ["retrieval", "execution"]) {
    const entry = state?.browserBackoff?.[lane];
    normalized.browserBackoff[lane] = {
      unavailableUntil: normalizeIsoDatetime(entry?.unavailableUntil),
      reason: normalizeReason(entry?.reason),
    };
  }

  const legacyUntil = normalizeIsoDatetime(state?.browserTransportUnavailableUntil);
  const legacyReason = normalizeReason(state?.lastBrowserTransportError ?? state?.browserTransportReason);
  if (legacyUntil) {
    const lanes = inferLegacyBackoffLanes(legacyReason);
    for (const lane of lanes) {
      if (!normalized.browserBackoff[lane].unavailableUntil) {
        normalized.browserBackoff[lane] = {
          unavailableUntil: legacyUntil,
          reason: legacyReason,
        };
      }
    }
  }

  normalized.sendCircuitBreaker = {
    consecutiveFailures: normalizePositiveInteger(state?.sendCircuitBreaker?.consecutiveFailures) ?? 0,
    unavailableUntil: normalizeIsoDatetime(state?.sendCircuitBreaker?.unavailableUntil),
    reason: normalizeReason(state?.sendCircuitBreaker?.reason),
    lastFailureAt: normalizeIsoDatetime(state?.sendCircuitBreaker?.lastFailureAt),
    lastTaskFingerprint: normalizeReason(state?.sendCircuitBreaker?.lastTaskFingerprint),
    lastTaskLabel: normalizeReason(state?.sendCircuitBreaker?.lastTaskLabel),
  };
  if (shouldClearScopeLocalSendCircuitBreaker(normalized.sendCircuitBreaker?.reason)) {
    normalized.sendCircuitBreaker = {
      consecutiveFailures: 0,
      unavailableUntil: null,
      reason: null,
      lastFailureAt: null,
      lastTaskFingerprint: null,
      lastTaskLabel: null,
    };
  }

  normalized.canaryCooldown = {
    unavailableUntil: normalizeIsoDatetime(state?.canaryCooldown?.unavailableUntil),
    lastSentAt: normalizeIsoDatetime(state?.canaryCooldown?.lastSentAt),
    lastTaskFingerprint: normalizeReason(state?.canaryCooldown?.lastTaskFingerprint),
    lastTaskLabel: normalizeReason(state?.canaryCooldown?.lastTaskLabel),
  };

  normalized.runtimeUsageLimit = {
    unavailableUntil: normalizeIsoDatetime(state?.runtimeUsageLimit?.unavailableUntil),
    reason: normalizeReason(state?.runtimeUsageLimit?.reason),
    detectedAt: normalizeIsoDatetime(state?.runtimeUsageLimit?.detectedAt),
    runtime: normalizeReason(state?.runtimeUsageLimit?.runtime),
  };

  const leases = Array.isArray(state?.taskLeases)
    ? state.taskLeases
    : [];
  normalized.taskLeases = leases
    .map(normalizeTaskLeaseEntry)
    .filter(Boolean);

  const verifications = Array.isArray(state?.recentTaskVerifications)
    ? state.recentTaskVerifications
    : [];
  normalized.recentTaskVerifications = verifications
    .map(normalizeTaskVerificationEntry)
    .filter(Boolean);

  const motionTaskRuns = Array.isArray(state?.recentMotionTaskRuns)
    ? state.recentMotionTaskRuns
    : [];
  normalized.recentMotionTaskRuns = motionTaskRuns
    .map(normalizeMotionTaskRunEntry)
    .filter(Boolean);

  const maintenanceTaskCooldowns = Array.isArray(state?.maintenanceTaskCooldowns)
    ? state.maintenanceTaskCooldowns
    : [];
  normalized.maintenanceTaskCooldowns = maintenanceTaskCooldowns
    .map(normalizeMaintenanceTaskCooldownEntry)
    .filter(Boolean);

  return normalized;
}

/**
 * @param {any} state
 * @param {string} [now]
 */
export function pruneExpiredBrowserBackoffs(state, now = new Date().toISOString()) {
  const normalized = normalizeAgentHostState(state);
  for (const lane of ["retrieval", "execution"]) {
    const until = normalizeIsoDatetime(normalized.browserBackoff[lane]?.unavailableUntil);
    if (!until) continue;
    if (Date.parse(now) >= Date.parse(until)) {
      normalized.browserBackoff[lane] = {
        unavailableUntil: null,
        reason: null,
      };
    }
  }
  normalized.recentTaskVerifications = normalized.recentTaskVerifications.filter((entry) => {
    if (!entry.expiresAt) return false;
    return Date.parse(now) < Date.parse(entry.expiresAt);
  });
  normalized.taskLeases = normalized.taskLeases.filter((entry) => {
    if (!entry.expiresAt) return false;
    return Date.parse(now) < Date.parse(entry.expiresAt);
  });
  const breakerUntil = normalizeIsoDatetime(normalized.sendCircuitBreaker?.unavailableUntil);
  if (breakerUntil && Date.parse(now) >= Date.parse(breakerUntil)) {
    normalized.sendCircuitBreaker = {
      consecutiveFailures: 0,
      unavailableUntil: null,
      reason: null,
      lastFailureAt: null,
      lastTaskFingerprint: null,
      lastTaskLabel: null,
    };
  }
  const canaryUntil = normalizeIsoDatetime(normalized.canaryCooldown?.unavailableUntil);
  if (canaryUntil && Date.parse(now) >= Date.parse(canaryUntil)) {
    normalized.canaryCooldown = {
      unavailableUntil: null,
      lastSentAt: normalized.canaryCooldown?.lastSentAt ?? null,
      lastTaskFingerprint: normalized.canaryCooldown?.lastTaskFingerprint ?? null,
      lastTaskLabel: normalized.canaryCooldown?.lastTaskLabel ?? null,
    };
  }
  const usageLimitUntil = normalizeIsoDatetime(normalized.runtimeUsageLimit?.unavailableUntil);
  if (usageLimitUntil && Date.parse(now) >= Date.parse(usageLimitUntil)) {
    normalized.runtimeUsageLimit = {
      unavailableUntil: null,
      reason: null,
      detectedAt: null,
      runtime: null,
    };
  }
  normalized.maintenanceTaskCooldowns = normalized.maintenanceTaskCooldowns.filter((entry) => {
    if (!entry.unavailableUntil) return false;
    return Date.parse(now) < Date.parse(entry.unavailableUntil);
  });
  return normalized;
}

/**
 * Drop task leases that no longer have a live runner lock behind them. This
 * prevents stale checkout entries from keeping the UI in a false "active"
 * state after a crashed or completed pass failed to release its lease.
 *
 * @param {any} state
 * @param {{ stateDir?: string | null, now?: string }} [input]
 */
export function pruneInactiveTaskLeases(state, input = {}) {
  const now = input.now ?? new Date().toISOString();
  const normalized = pruneExpiredBrowserBackoffs(state, now);
  const stateDir = typeof input.stateDir === "string" && input.stateDir.trim().length
    ? input.stateDir.trim()
    : null;
  if (!stateDir || !normalized.taskLeases.length) {
    return normalized;
  }

  const sharedLock = inspectAgentRunLock({ stateDir });
  const laneLocks = new Map(
    AGENT_EXECUTION_LANES.map((lane) => [lane, inspectAgentRunLock({ stateDir, lane })]),
  );
  const hasLaneLockArtifacts = [...laneLocks.values()].some((lock) => lock.exists);

  normalized.taskLeases = normalized.taskLeases.filter((entry) => {
    const lane = getTaskExecutionLane(entry?.taskKind);
    if (!lane) {
      return sharedLock.active;
    }
    const laneLock = laneLocks.get(lane);
    if (laneLock?.active) {
      return true;
    }
    return sharedLock.active && !hasLaneLockArtifacts;
  });
  normalized.taskLeases = keepNewestTaskLeasePerLane(normalized.taskLeases);

  return normalized;
}

/**
 * @param {any} state
 * @param {string | null | undefined} taskKind
 * @param {string} [now]
 */
export function getBrowserBackoffForTask(state, taskKind, now = new Date().toISOString()) {
  const lane = getBrowserTaskLane(taskKind);
  if (!lane) {
    return {
      lane: null,
      active: false,
      unavailableUntil: null,
      reason: null,
    };
  }

  const normalized = pruneExpiredBrowserBackoffs(state, now);
  const entry = normalized.browserBackoff[lane];
  const unavailableUntil = normalizeIsoDatetime(entry?.unavailableUntil);
  const active = Boolean(unavailableUntil && Date.parse(now) < Date.parse(unavailableUntil));
  return {
    lane,
    active,
    unavailableUntil,
    reason: normalizeReason(entry?.reason),
  };
}

/**
 * @param {any} state
 * @param {string | null | undefined} taskKind
 * @param {string} unavailableUntil
 * @param {string | null | undefined} reason
 */
export function setBrowserBackoffForTask(state, taskKind, unavailableUntil, reason) {
  const normalized = normalizeAgentHostState(state);
  const lane = getBrowserTaskLane(taskKind);
  if (!lane) return normalized;
  normalized.browserBackoff[lane] = {
    unavailableUntil: normalizeIsoDatetime(unavailableUntil),
    reason: normalizeReason(reason),
  };
  return normalized;
}

/**
 * @param {any} state
 * @param {string | null | undefined} taskKind
 */
export function clearBrowserBackoffForTask(state, taskKind) {
  const normalized = normalizeAgentHostState(state);
  const lane = getBrowserTaskLane(taskKind);
  if (!lane) return normalized;
  normalized.browserBackoff[lane] = {
    unavailableUntil: null,
    reason: null,
  };
  return normalized;
}

/**
 * @param {any} state
 */
export function listActiveBrowserBackoffs(state) {
  const normalized = pruneExpiredBrowserBackoffs(state);
  return Object.entries(normalized.browserBackoff)
    .filter(([, entry]) => entry.unavailableUntil)
    .map(([lane, entry]) => ({
      lane,
      unavailableUntil: entry.unavailableUntil,
      reason: entry.reason,
    }));
}

/**
 * Active-only view of the send circuit breaker, read straight off raw host
 * state for the UI hold-detection path. Returns null when no breaker is
 * currently tripped. (Distinct from `getSendCircuitBreaker`, which normalizes
 * and always returns a full `{active,...}` record.)
 *
 * @param {any} hostState
 * @param {string | null | undefined} [checkedAt]
 * @returns {{ unavailableUntil: string, reason: string | null } | null}
 */
export function activeSendCircuitBreaker(hostState, checkedAt = null) {
  const unavailableUntil = typeof hostState?.sendCircuitBreaker?.unavailableUntil === "string"
    ? hostState.sendCircuitBreaker.unavailableUntil.trim()
    : "";
  if (!unavailableUntil) return null;
  const untilMs = Date.parse(unavailableUntil);
  if (!Number.isFinite(untilMs)) return null;
  const nowMs = checkedAt ? Date.parse(checkedAt) : Date.now();
  if (!Number.isFinite(nowMs) || nowMs >= untilMs) return null;
  return {
    unavailableUntil,
    reason: typeof hostState?.sendCircuitBreaker?.reason === "string"
      ? hostState.sendCircuitBreaker.reason.trim() || null
      : null,
  };
}

/**
 * Highest-priority active agent hold (browser backoff, then send circuit
 * breaker) for a runtime that still has queued work, or null when nothing is
 * holding the queue. Shared by the operator view-builder and the header pill so
 * both classify holds identically.
 *
 * @param {any} runtime
 * @param {number} queueCount
 * @param {string | null} [checkedAt]
 */
export function findActiveAgentHold(runtime, queueCount, checkedAt = null) {
  if (!runtime || queueCount <= 0) return null;
  const active = listActiveBrowserBackoffs(runtime.hostState ?? null);
  const browserHold = active.find((entry) => entry.lane === "execution")
    ?? active.find((entry) => entry.lane === "retrieval")
    ?? null;
  if (browserHold) {
    return {
      kind: "browser_backoff",
      lane: browserHold.lane ?? null,
      unavailableUntil: browserHold.unavailableUntil ?? null,
      reason: browserHold.reason ?? null,
    };
  }
  const sendCircuitBreaker = activeSendCircuitBreaker(runtime.hostState ?? null, checkedAt);
  if (sendCircuitBreaker) {
    return {
      kind: "send_circuit_breaker",
      lane: "execution",
      unavailableUntil: sendCircuitBreaker.unavailableUntil,
      reason: sendCircuitBreaker.reason,
    };
  }
  return null;
}

/**
 * Render an agent hold (from `findActiveAgentHold`) into the operator-facing
 * sentence shown on the queue page and header pill.
 *
 * @param {{ kind?: string | null, lane?: string | null, reason?: string | null }} backoff
 * @param {string | null} cadence
 * @param {boolean} schedulerLoaded
 * @param {boolean} [passActive]
 */
export function buildAgentBackoffDetail(backoff, cadence, schedulerLoaded, passActive = false) {
  const laneLabel = backoff?.kind === "send_circuit_breaker"
    ? "Send work"
    : backoff?.lane === "retrieval"
      ? "Inbound refresh work"
      : "Send work";
  const reason = typeof backoff?.reason === "string" && backoff.reason.trim()
    ? backoff.reason.trim()
    : null;
  const schedulerLabel = schedulerLoaded
    ? passActive
      ? "Background draining is active."
      : cadence
      ? `Background draining is enabled ${cadence}.`
      : "Background draining is enabled."
    : "No pass is running right now.";
  const holdLabel = backoff?.kind === "send_circuit_breaker"
    ? `${laneLabel} is paused right now.`
    : `${laneLabel} is blocked right now.`;
  return reason
    ? `${schedulerLabel} ${holdLabel} ${reason}`
    : `${schedulerLabel} ${holdLabel}`;
}

/**
 * @param {any} state
 * @param {string | null | undefined} taskKind
 * @param {string | null | undefined} fingerprint
 * @param {string} [now]
 */
export function getRecentTaskVerification(state, taskKind, fingerprint, now = new Date().toISOString()) {
  if (!taskKind || !fingerprint) return null;
  const normalized = pruneExpiredBrowserBackoffs(state, now);
  return normalized.recentTaskVerifications.find((entry) => (
    entry.taskKind === taskKind
    && entry.fingerprint === fingerprint
  )) ?? null;
}

/**
 * @param {any} state
 * @param {{
 *   taskKind: string,
 *   fingerprint: string,
 *   verifiedAt: string,
 *   expiresAt: string,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   surface?: string | null,
 *   recipientUrl?: string | null,
 *   verificationStatus?: string | null,
 *   prospectName?: string | null,
 *   companyName?: string | null,
 * }} entry
 */
export function recordTaskVerification(state, entry) {
  const normalized = normalizeAgentHostState(state);
  const nextEntry = normalizeTaskVerificationEntry(entry);
  if (!nextEntry) return normalized;
  normalized.recentTaskVerifications = normalized.recentTaskVerifications
    .filter((item) => !(item.taskKind === nextEntry.taskKind && item.fingerprint === nextEntry.fingerprint));
  normalized.recentTaskVerifications.push(nextEntry);
  return normalized;
}

/**
 * @param {any} state
 * @param {{
 *   taskKind: string,
 *   motionId: string,
 *   recordedAt: string,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   status?: string | null,
 * }} entry
 */
export function recordMotionTaskRun(state, entry) {
  const normalized = normalizeAgentHostState(state);
  const nextEntry = normalizeMotionTaskRunEntry(entry);
  if (!nextEntry) return normalized;
  normalized.recentMotionTaskRuns = normalized.recentMotionTaskRuns
    .filter((item) => !(item.taskKind === nextEntry.taskKind && item.motionId === nextEntry.motionId));
  normalized.recentMotionTaskRuns.push(nextEntry);
  normalized.recentMotionTaskRuns.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  if (normalized.recentMotionTaskRuns.length > 200) {
    normalized.recentMotionTaskRuns = normalized.recentMotionTaskRuns.slice(-200);
  }
  return normalized;
}

/**
 * @param {any} state
 * @param {{
 *   taskKind: string,
 *   groupKey: string,
 *   recordedAt: string,
 *   unavailableUntil: string,
 *   reason?: string | null,
 *   taskFingerprint?: string | null,
 *   taskLabel?: string | null,
 * }} entry
 */
export function recordMaintenanceTaskCooldown(state, entry) {
  const normalized = normalizeAgentHostState(state);
  const nextEntry = normalizeMaintenanceTaskCooldownEntry(entry);
  if (!nextEntry) return normalized;
  normalized.maintenanceTaskCooldowns = normalized.maintenanceTaskCooldowns
    .filter((item) => !(item.taskKind === nextEntry.taskKind && item.groupKey === nextEntry.groupKey));
  normalized.maintenanceTaskCooldowns.push(nextEntry);
  normalized.maintenanceTaskCooldowns.sort((left, right) => left.unavailableUntil.localeCompare(right.unavailableUntil));
  if (normalized.maintenanceTaskCooldowns.length > 200) {
    normalized.maintenanceTaskCooldowns = normalized.maintenanceTaskCooldowns.slice(-200);
  }
  return normalized;
}

/**
 * @param {any} state
 * @param {string | null | undefined} taskKind
 * @param {string | null | undefined} groupKey
 * @param {string} [now]
 */
export function getMaintenanceTaskCooldown(state, taskKind, groupKey, now = new Date().toISOString()) {
  if (!taskKind || !groupKey) {
    return {
      active: false,
      unavailableUntil: null,
      reason: null,
      recordedAt: null,
      taskFingerprint: null,
      taskLabel: null,
    };
  }
  const normalized = pruneExpiredBrowserBackoffs(state, now);
  const entry = normalized.maintenanceTaskCooldowns.find((item) => (
    item.taskKind === taskKind
    && item.groupKey === groupKey
  )) ?? null;
  return {
    active: Boolean(entry),
    unavailableUntil: entry?.unavailableUntil ?? null,
    reason: entry?.reason ?? null,
    recordedAt: entry?.recordedAt ?? null,
    taskFingerprint: entry?.taskFingerprint ?? null,
    taskLabel: entry?.taskLabel ?? null,
  };
}

/**
 * @param {any} state
 * @param {string | null | undefined} taskKind
 * @param {string | null | undefined} motionId
 */
export function getRecentMotionTaskRunAt(state, taskKind, motionId) {
  if (!taskKind || !motionId) return null;
  const normalized = normalizeAgentHostState(state);
  return normalized.recentMotionTaskRuns.find((entry) =>
    entry.taskKind === taskKind && entry.motionId === motionId
  )?.recordedAt ?? null;
}

/**
 * @param {any} state
 * @param {string | null | undefined} motionId
 * @param {Iterable<string> | null | undefined} [taskKinds]
 */
export function getRecentMotionRunAt(state, motionId, taskKinds = null) {
  if (!motionId) return null;
  const normalized = normalizeAgentHostState(state);
  const allowedKinds = taskKinds
    ? new Set(Array.from(taskKinds).filter((value) => typeof value === "string" && value.trim().length > 0))
    : null;
  let latest = null;
  for (const entry of normalized.recentMotionTaskRuns) {
    if (entry.motionId !== motionId) {
      continue;
    }
    if (allowedKinds && !allowedKinds.has(entry.taskKind)) {
      continue;
    }
    if (!latest || entry.recordedAt > latest) {
      latest = entry.recordedAt;
    }
  }
  return latest;
}

/**
 * @param {any} state
 * @param {string} [now]
 */
export function getSendCircuitBreaker(state, now = new Date().toISOString()) {
  const normalized = pruneExpiredBrowserBackoffs(state, now);
  const breaker = normalized.sendCircuitBreaker ?? null;
  const unavailableUntil = normalizeIsoDatetime(breaker?.unavailableUntil);
  const active = Boolean(unavailableUntil && Date.parse(now) < Date.parse(unavailableUntil));
  return {
    active,
    consecutiveFailures: normalizePositiveInteger(breaker?.consecutiveFailures) ?? 0,
    unavailableUntil,
    reason: normalizeReason(breaker?.reason),
    lastFailureAt: normalizeIsoDatetime(breaker?.lastFailureAt),
    lastTaskFingerprint: normalizeReason(breaker?.lastTaskFingerprint),
    lastTaskLabel: normalizeReason(breaker?.lastTaskLabel),
  };
}

/**
 * @param {any} state
 * @param {{
 *   failureAt: string,
 *   reason?: string | null,
 *   taskFingerprint?: string | null,
 *   taskLabel?: string | null,
 *   unavailableUntil?: string | null,
 * }} entry
 */
export function recordSendCircuitFailure(state, entry) {
  const normalized = normalizeAgentHostState(state);
  const prior = normalized.sendCircuitBreaker ?? {};
  normalized.sendCircuitBreaker = {
    consecutiveFailures: (normalizePositiveInteger(prior.consecutiveFailures) ?? 0) + 1,
    unavailableUntil: normalizeIsoDatetime(entry?.unavailableUntil),
    reason: normalizeReason(entry?.reason),
    lastFailureAt: normalizeIsoDatetime(entry?.failureAt),
    lastTaskFingerprint: normalizeReason(entry?.taskFingerprint),
    lastTaskLabel: normalizeReason(entry?.taskLabel),
  };
  return normalized;
}

/** @param {any} state */
export function clearSendCircuitBreaker(state) {
  const normalized = normalizeAgentHostState(state);
  normalized.sendCircuitBreaker = {
    consecutiveFailures: 0,
    unavailableUntil: null,
    reason: null,
    lastFailureAt: null,
    lastTaskFingerprint: null,
    lastTaskLabel: null,
  };
  return normalized;
}

/**
 * @param {any} state
 * @param {string} [now]
 */
export function getCanaryCooldown(state, now = new Date().toISOString()) {
  const normalized = pruneExpiredBrowserBackoffs(state, now);
  const cooldown = normalized.canaryCooldown ?? null;
  const unavailableUntil = normalizeIsoDatetime(cooldown?.unavailableUntil);
  const active = Boolean(unavailableUntil && Date.parse(now) < Date.parse(unavailableUntil));
  return {
    active,
    unavailableUntil,
    lastSentAt: normalizeIsoDatetime(cooldown?.lastSentAt),
    lastTaskFingerprint: normalizeReason(cooldown?.lastTaskFingerprint),
    lastTaskLabel: normalizeReason(cooldown?.lastTaskLabel),
  };
}

/**
 * @param {any} state
 * @param {{
 *   sentAt: string,
 *   unavailableUntil: string,
 *   taskFingerprint?: string | null,
 *   taskLabel?: string | null,
 * }} entry
 */
export function recordCanarySendCooldown(state, entry) {
  const normalized = normalizeAgentHostState(state);
  normalized.canaryCooldown = {
    unavailableUntil: normalizeIsoDatetime(entry?.unavailableUntil),
    lastSentAt: normalizeIsoDatetime(entry?.sentAt),
    lastTaskFingerprint: normalizeReason(entry?.taskFingerprint),
    lastTaskLabel: normalizeReason(entry?.taskLabel),
  };
  return normalized;
}

/**
 * @param {any} state
 * @param {string} [now]
 */
export function getRuntimeUsageLimit(state, now = new Date().toISOString()) {
  const normalized = pruneExpiredBrowserBackoffs(state, now);
  const entry = normalized.runtimeUsageLimit ?? null;
  const unavailableUntil = normalizeIsoDatetime(entry?.unavailableUntil);
  const active = Boolean(unavailableUntil && Date.parse(now) < Date.parse(unavailableUntil));
  return {
    active,
    unavailableUntil,
    reason: normalizeReason(entry?.reason),
    detectedAt: normalizeIsoDatetime(entry?.detectedAt),
    runtime: normalizeReason(entry?.runtime),
  };
}

/**
 * @param {any} state
 * @param {{
 *   detectedAt: string,
 *   unavailableUntil: string,
 *   reason?: string | null,
 *   runtime?: string | null,
 * }} entry
 */
export function recordRuntimeUsageLimit(state, entry) {
  const normalized = normalizeAgentHostState(state);
  normalized.runtimeUsageLimit = {
    unavailableUntil: normalizeIsoDatetime(entry?.unavailableUntil),
    reason: normalizeReason(entry?.reason),
    detectedAt: normalizeIsoDatetime(entry?.detectedAt),
    runtime: normalizeReason(entry?.runtime),
  };
  return normalized;
}

/** @param {any} state */
export function clearRuntimeUsageLimit(state) {
  const normalized = normalizeAgentHostState(state);
  normalized.runtimeUsageLimit = {
    unavailableUntil: null,
    reason: null,
    detectedAt: null,
    runtime: null,
  };
  return normalized;
}

/**
 * @param {any} task
 */
export function createTaskLeaseFingerprint(task) {
  const basis = JSON.stringify({
    kind: task?.kind ?? null,
    action: task?.action ?? null,
    motionId: task?.motionId ?? null,
    companyId: task?.companyId ?? null,
    prospectId: task?.prospectId ?? null,
    observationId: task?.observationId ?? null,
    userId: task?.userId ?? null,
    accountId: task?.accountId ?? null,
    capability: task?.capability ?? null,
    packetId: task?.packetId ?? null,
    packetKind: task?.packetKind ?? null,
    surface: task?.surface ?? null,
    surfaceKeys: Array.isArray(task?.surfaceKeys)
      ? [...new Set(task.surfaceKeys
        .map((surfaceKey) => normalizeIdentity(surfaceKey))
        .filter(Boolean))]
      : [],
    mode: task?.mode ?? null,
    resumeCursor: task?.resumeCursor ?? null,
    resumeStartOffset: Number.isInteger(task?.resumeStartOffset) ? task.resumeStartOffset : null,
    maxPages: Number.isInteger(task?.maxPages) ? task.maxPages : null,
    pageSize: Number.isInteger(task?.pageSize) ? task.pageSize : null,
    recipientUrl: task?.recipientUrl ?? null,
    recipientEmail: task?.recipientEmail ?? null,
    via: task?.via ?? null,
  });
  return createHash("sha1").update(basis).digest("hex");
}

/**
 * @param {any} state
 * @param {string | null | undefined} fingerprint
 * @param {string} [now]
 */
export function getActiveTaskLease(state, fingerprint, now = new Date().toISOString()) {
  if (!fingerprint) return null;
  const normalized = pruneExpiredBrowserBackoffs(state, now);
  return normalized.taskLeases.find((entry) => entry.fingerprint === fingerprint) ?? null;
}

/**
 * @param {any} state
 * @param {{
 *   taskKind: string,
 *   fingerprint: string,
 *   workerLabel: string,
 *   acquiredAt: string,
 *   expiresAt: string,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   observationId?: string | null,
 *   userId?: string | null,
 *   accountId?: string | null,
 *   capability?: string | null,
 *   surface?: string | null,
 *   subject?: string | null,
 *   action?: string | null,
 * }} entry
 */
export function checkoutTaskLease(state, entry) {
  const normalized = normalizeAgentHostState(state);
  const nextEntry = normalizeTaskLeaseEntry(entry);
  if (!nextEntry) {
    return {
      ok: false,
      reason: "invalid_task_lease",
      state: normalized,
      lease: null,
    };
  }

  const existing = getActiveTaskLease(normalized, nextEntry.fingerprint, nextEntry.acquiredAt);
  if (existing && existing.workerLabel !== nextEntry.workerLabel) {
    return {
      ok: false,
      reason: "already_checked_out",
      state: normalized,
      lease: existing,
    };
  }

  normalized.taskLeases = normalized.taskLeases.filter((item) => item.fingerprint !== nextEntry.fingerprint);
  normalized.taskLeases.push(nextEntry);
  return {
    ok: true,
    reason: null,
    state: normalized,
    lease: nextEntry,
  };
}

/**
 * @param {any} state
 * @param {string | null | undefined} fingerprint
 */
export function releaseTaskLease(state, fingerprint) {
  const normalized = normalizeAgentHostState(state);
  if (!fingerprint) return normalized;
  normalized.taskLeases = normalized.taskLeases.filter((entry) => entry.fingerprint !== fingerprint);
  return normalized;
}

/** @param {any} task */
export function createTaskVerificationFingerprint(task) {
  const basis = JSON.stringify({
    kind: task?.kind ?? null,
    action: task?.action ?? null,
    motionId: task?.motionId ?? null,
    companyId: task?.companyId ?? null,
    prospectId: task?.prospectId ?? null,
    surface: task?.surface ?? null,
    channel: task?.channel ?? null,
    recipientUrl: task?.recipientUrl ?? null,
    recipientEmail: task?.recipientEmail ?? null,
    subject: task?.subject ?? null,
    body: task?.body ?? null,
  });
  return createHash("sha1").update(basis).digest("hex");
}

/**
 * @param {string | null} reason
 */
function inferLegacyBackoffLanes(reason) {
  if (!reason) return ["retrieval", "execution"];
  const lower = reason.toLowerCase();
  if (lower.includes("send")) return ["execution"];
  if (lower.includes("withdraw") || lower.includes("reject") || lower.includes("unfollow")) return ["execution"];
  if (lower.includes("inbound") || lower.includes("gmail") || lower.includes("linkedin") || lower.includes("capture") || lower.includes("retriev") || lower.includes("sync")) {
    return ["retrieval"];
  }
  return ["retrieval", "execution"];
}

/** @param {string | null} reason */
function shouldClearScopeLocalSendCircuitBreaker(reason) {
  if (!reason) return false;
  const lower = reason.toLowerCase();
  return (lower.includes("multiple gmail inboxes are mapped") && lower.includes("pick one exact inbox"))
    || lower.includes("connection request is already pending")
    || lower.includes("already connected");
}

/** @param {unknown} value */
function normalizeIsoDatetime(value) {
  if (typeof value !== "string" || !value.trim().length) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** @param {unknown} value */
function normalizeReason(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

/** @param {unknown} value */
function normalizePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

/** @param {any} entry */
function normalizeTaskLeaseEntry(entry) {
  const taskKind = normalizeIdentity(entry?.taskKind);
  const fingerprint = normalizeIdentity(entry?.fingerprint);
  const workerLabel = normalizeIdentity(entry?.workerLabel);
  const acquiredAt = normalizeIsoDatetime(entry?.acquiredAt);
  const expiresAt = normalizeIsoDatetime(entry?.expiresAt);
  if (!taskKind || !fingerprint || !workerLabel || !acquiredAt || !expiresAt) return null;
  return {
    taskKind,
    fingerprint,
    workerLabel,
    acquiredAt,
    expiresAt,
    motionId: normalizeIdentity(entry?.motionId),
    companyId: normalizeIdentity(entry?.companyId),
    prospectId: normalizeIdentity(entry?.prospectId),
    observationId: normalizeIdentity(entry?.observationId),
    userId: normalizeIdentity(entry?.userId),
    accountId: normalizeIdentity(entry?.accountId),
    capability: normalizeIdentity(entry?.capability),
    surface: normalizeIdentity(entry?.surface),
    subject: normalizeIdentity(entry?.subject),
    action: normalizeIdentity(entry?.action),
  };
}

/** @param {any} entry */
function normalizeTaskVerificationEntry(entry) {
  const taskKind = typeof entry?.taskKind === "string" && entry.taskKind.trim().length
    ? entry.taskKind.trim()
    : null;
  const fingerprint = typeof entry?.fingerprint === "string" && entry.fingerprint.trim().length
    ? entry.fingerprint.trim()
    : null;
  const verifiedAt = normalizeIsoDatetime(entry?.verifiedAt);
  const expiresAt = normalizeIsoDatetime(entry?.expiresAt);
  if (!taskKind || !fingerprint || !verifiedAt || !expiresAt) return null;
  return {
    taskKind,
    fingerprint,
    verifiedAt,
    expiresAt,
    motionId: normalizeIdentity(entry?.motionId),
    companyId: normalizeIdentity(entry?.companyId),
    prospectId: normalizeIdentity(entry?.prospectId),
    surface: normalizeIdentity(entry?.surface),
    recipientUrl: normalizeIdentity(entry?.recipientUrl),
    verificationStatus: normalizeIdentity(entry?.verificationStatus),
    prospectName: normalizeIdentity(entry?.prospectName),
    companyName: normalizeIdentity(entry?.companyName),
  };
}

/** @param {any} entry */
function normalizeMotionTaskRunEntry(entry) {
  const taskKind = normalizeIdentity(entry?.taskKind);
  const motionId = normalizeIdentity(entry?.motionId);
  const recordedAt = normalizeIsoDatetime(entry?.recordedAt);
  if (!taskKind || !motionId || !recordedAt) return null;
  return {
    taskKind,
    motionId,
    recordedAt,
    companyId: normalizeIdentity(entry?.companyId),
    prospectId: normalizeIdentity(entry?.prospectId),
    status: normalizeIdentity(entry?.status),
  };
}

/** @param {any} entry */
function normalizeMaintenanceTaskCooldownEntry(entry) {
  const taskKind = normalizeIdentity(entry?.taskKind);
  const groupKey = normalizeIdentity(entry?.groupKey);
  const recordedAt = normalizeIsoDatetime(entry?.recordedAt);
  const unavailableUntil = normalizeIsoDatetime(entry?.unavailableUntil);
  if (!taskKind || !groupKey || !recordedAt || !unavailableUntil) return null;
  return {
    taskKind,
    groupKey,
    recordedAt,
    unavailableUntil,
    reason: normalizeReason(entry?.reason),
    taskFingerprint: normalizeIdentity(entry?.taskFingerprint),
    taskLabel: normalizeReason(entry?.taskLabel),
  };
}

/** @param {unknown} value */
function normalizeIdentity(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

/** @param {any[]} taskLeases */
function keepNewestTaskLeasePerLane(taskLeases) {
  const newestByLane = new Map();
  for (const entry of taskLeases) {
    const lane = getTaskExecutionLane(entry?.taskKind) ?? "__shared__";
    const existing = newestByLane.get(lane);
    if (!existing) {
      newestByLane.set(lane, entry);
      continue;
    }
    if (String(entry?.acquiredAt ?? "") >= String(existing?.acquiredAt ?? "")) {
      newestByLane.set(lane, entry);
    }
  }
  return [...newestByLane.values()];
}
