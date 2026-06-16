// @ts-check

export const DEFAULT_AGENT_BURST_MAX_RUNTIME_MS = 20 * 60 * 1000;
export const DEFAULT_AGENT_BURST_SOON_WAIT_MS = 5 * 60 * 1000;

const IMMEDIATE_RERUN_THRESHOLD_MS = 1000;

/**
 * Decide whether a lane-local agent burst should re-run immediately, sleep
 * until the next short wait expires, or stop and hand control back to the
 * coarse scheduler.
 *
 * @param {{
 *   itemCount?: number | null,
 *   dueTaskCount?: number | null,
 *   count?: number | null,
 *   waitingCount?: number | null,
 *   waiting?: Array<Record<string, any>> | null,
 * }} queue
 * @param {{
 *   startedAtMs?: number | null,
 *   nowMs?: number | null,
 *   maxRuntimeMs?: number | null,
 *   soonWaitMs?: number | null,
 * }} [options]
 */
export function decideAgentBurstContinuation(queue, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const startedAtMs = Number.isFinite(options.startedAtMs) ? Number(options.startedAtMs) : nowMs;
  const maxRuntimeMs = normalizePositiveInteger(options.maxRuntimeMs, DEFAULT_AGENT_BURST_MAX_RUNTIME_MS);
  const soonWaitMs = normalizePositiveInteger(options.soonWaitMs, DEFAULT_AGENT_BURST_SOON_WAIT_MS);
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const dueTaskCount = normalizePositiveInteger(
    queue?.itemCount ?? queue?.dueTaskCount ?? queue?.count,
    Array.isArray(queue?.tasks) ? queue.tasks.length : 0,
  );
  const waitingItems = Array.isArray(queue?.waiting) ? queue.waiting : [];
  const waitingCount = normalizePositiveInteger(queue?.waitingCount, waitingItems.length);

  if (elapsedMs >= maxRuntimeMs) {
    return {
      action: "stop",
      reason: "burst_window_elapsed",
      dueTaskCount,
      waitingCount,
      elapsedMs,
    };
  }

  if (dueTaskCount > 0) {
    return {
      action: "rerun",
      reason: "due_tasks_remain",
      dueTaskCount,
      waitingCount,
      elapsedMs,
    };
  }

  if (waitingCount === 0) {
    return {
      action: "stop",
      reason: "queue_drained",
      dueTaskCount,
      waitingCount,
      elapsedMs,
    };
  }

  const nextDueAt = resolveSoonestWaitingDueAt(waitingItems);
  if (!nextDueAt) {
    return {
      action: "stop",
      reason: "waiting_without_next_due",
      dueTaskCount,
      waitingCount,
      elapsedMs,
    };
  }

  const nextDueMs = Date.parse(nextDueAt);
  if (!Number.isFinite(nextDueMs)) {
    return {
      action: "stop",
      reason: "waiting_due_invalid",
      dueTaskCount,
      waitingCount,
      elapsedMs,
      nextDueAt,
    };
  }

  const delayMs = Math.max(0, nextDueMs - nowMs);
  if (delayMs <= IMMEDIATE_RERUN_THRESHOLD_MS) {
    return {
      action: "rerun",
      reason: "waiting_due_now",
      dueTaskCount,
      waitingCount,
      elapsedMs,
      nextDueAt,
      delayMs,
    };
  }

  if (delayMs > soonWaitMs) {
    return {
      action: "stop",
      reason: "next_due_outside_burst_window",
      dueTaskCount,
      waitingCount,
      elapsedMs,
      nextDueAt,
      delayMs,
    };
  }

  if (elapsedMs + delayMs > maxRuntimeMs) {
    return {
      action: "stop",
      reason: "burst_window_would_expire_before_next_due",
      dueTaskCount,
      waitingCount,
      elapsedMs,
      nextDueAt,
      delayMs,
    };
  }

  return {
    action: "sleep",
    reason: "next_due_soon",
    dueTaskCount,
    waitingCount,
    elapsedMs,
    nextDueAt,
    delayMs,
  };
}

/**
 * @param {Array<Record<string, any>>} waitingItems
 */
function resolveSoonestWaitingDueAt(waitingItems) {
  const dueAts = waitingItems
    .map((task) => normalizeNullableString(task?.nextDueAt ?? task?.dueAt ?? task?.detail?.nextDueAt ?? null))
    .filter(Boolean)
    .sort((left, right) => String(left).localeCompare(String(right)));
  return dueAts[0] ?? null;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizePositiveInteger(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(Number(value)));
}

/** @param {unknown} value */
function normalizeNullableString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
