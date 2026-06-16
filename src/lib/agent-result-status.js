// @ts-check

/**
 * Some task results are serialized as `blocked` even though the underlying
 * contract is "not yet due" rather than "cannot run". Treat those as waiting
 * whenever we summarize pass health or operator-facing runtime status.
 *
 * @param {any} result
 */
export function isDeferredAgentResult(result) {
  const rawStatus = normalizeStatus(result?.status);
  if (rawStatus !== "blocked") return false;
  const gateStatus = normalizeStatus(result?.detail?.dispatchGate?.status);
  if (gateStatus === "wait") return true;

  const waitingReason = normalizeText(result?.detail?.waitingReason);
  const nextDueAt = normalizeText(result?.detail?.nextDueAt);
  return Boolean(waitingReason && nextDueAt);
}

/**
 * @param {any} result
 * @returns {string | null}
 */
export function getEffectiveAgentResultStatus(result) {
  const rawStatus = normalizeStatus(result?.status);
  if (!rawStatus) return null;
  return isDeferredAgentResult(result) ? "waiting" : rawStatus;
}

/**
 * @param {Array<any>} results
 * @param {{ tasks?: any[], blockers?: any[], dueTaskCount?: number | null, blockerCount?: number | null } | null | undefined} [finalQueue]
 * @returns {"noop" | "failed" | "blocked" | "partial" | "completed" | "mixed"}
 */
export function summarizeEffectivePassStatus(results, finalQueue = null) {
  if (!Array.isArray(results) || results.length === 0) {
    return "noop";
  }

  const statuses = results.map((result) => getEffectiveAgentResultStatus(result) ?? "unknown");
  if (statuses.some((status) => status === "failed")) {
    return "failed";
  }
  if (statuses.some((status) => status === "blocked")) {
    return "blocked";
  }
  if (statuses.every((status) => status === "completed" || status === "discarded" || status === "waiting")) {
    return hasRemainingDueBacklog(finalQueue) ? "partial" : "completed";
  }
  return "mixed";
}

/**
 * Recorded pass summaries can carry older top-level statuses that we need to
 * preserve or gently correct for operator-facing views. We only override the
 * stored status for known legacy seams:
 * - `completed` with remaining due backlog should read as `partial`
 * - deferred `blocked` pass summaries should read as `partial`
 * - `blocked` pass summaries with no queue blockers left should read as
 *   `partial` when they only stranded due or waiting work
 *
 * Everything else keeps the recorded top-level status because it already
 * reflects pass-level semantics better than re-inferring from individual
 * results after the fact.
 *
 * @param {unknown} rawStatus
 * @param {unknown} effectiveStatus
 * @param {{
 *   finalQueue?: any,
 *   resultCounts?: { blocked?: number, failed?: number } | null,
 * } | null} [context]
 * @returns {string | null}
 */
export function coerceRecordedPassStatus(rawStatus, effectiveStatus, context = null) {
  const normalizedRawStatus = normalizeStatus(rawStatus);
  const normalizedEffectiveStatus = normalizeStatus(effectiveStatus);

  if (!normalizedEffectiveStatus || normalizedEffectiveStatus === "noop") {
    return normalizedRawStatus;
  }
  if (!normalizedRawStatus
    || normalizedRawStatus === "noop"
    || normalizedRawStatus === "recorded"
    || normalizedRawStatus === "unknown") {
    return normalizedEffectiveStatus;
  }
  if (normalizedRawStatus === "partial") {
    return "partial";
  }
  if (normalizedEffectiveStatus === "partial"
    && (normalizedRawStatus === "completed" || normalizedRawStatus === "blocked")) {
    return "partial";
  }
  if (shouldTreatRecordedBlockedPassAsPartial(normalizedRawStatus, normalizedEffectiveStatus, context)) {
    return "partial";
  }
  return normalizedRawStatus;
}

/**
 * Normalize one recorded pass artifact for operator-facing readers.
 *
 * @param {any} pass
 */
export function normalizeRecordedPassSummary(pass) {
  if (!pass || typeof pass !== "object") return pass;
  const results = Array.isArray(pass.results) ? pass.results : [];
  const finalQueue = pass.finalQueueCounts ?? null;
  const effectiveStatus = summarizeEffectivePassStatus(results, finalQueue);
  const rawStatus = normalizeStatus(pass.status);
  const status = coerceRecordedPassStatus(rawStatus, effectiveStatus, {
    finalQueue,
    resultCounts: buildRecordedPassStatusCounts(results),
  }) ?? rawStatus;
  const reason = summarizeEffectivePassReason(results)
    ?? (status === rawStatus ? normalizeText(pass.reason) : null);
  return {
    ...pass,
    status,
    reason,
  };
}

/**
 * In verify mode every send is parked until a canary proves the copy, so a
 * "noop" pass whose reason is the verify-mode all-clear is a deliberate hold on
 * pending sends rather than an idle queue. Shared by the operator view-builder
 * and the header pill so both classify the hold identically.
 *
 * @param {{ sendMode: string | null, lastPass: any, verificationSendCount: number }} input
 */
export function isVerifyModeHoldingSends(input) {
  if (input.sendMode !== "verify" || input.verificationSendCount <= 0) return false;
  const status = String(input.lastPass?.status ?? "").trim().toLowerCase();
  const reason = String(input.lastPass?.reason ?? "").trim().toLowerCase();
  return status === "noop" && /no unverified outbound copy send_message tasks left to prove/.test(reason);
}

/**
 * @param {string | null} rawStatus
 * @param {string | null} effectiveStatus
 * @param {{
 *   finalQueue?: any,
 *   resultCounts?: { blocked?: number, failed?: number } | null,
 * } | null} context
 */
function shouldTreatRecordedBlockedPassAsPartial(rawStatus, effectiveStatus, context) {
  if (rawStatus !== "blocked" || effectiveStatus !== "blocked") return false;
  const finalQueue = context?.finalQueue;
  const blockerCount = normalizeNonNegativeInteger(finalQueue?.blockerCount)
    ?? normalizeNonNegativeInteger(finalQueue?.statusCounts?.blocked)
    ?? null;
  if (blockerCount !== 0) return false;
  const dueTaskCount = normalizeNonNegativeInteger(finalQueue?.dueTaskCount)
    ?? normalizeNonNegativeInteger(finalQueue?.readyTaskCount)
    ?? 0;
  const waitingTaskCount = normalizeNonNegativeInteger(finalQueue?.waitingTaskCount) ?? 0;
  const blockedResultCount = normalizeNonNegativeInteger(context?.resultCounts?.blocked) ?? 0;
  const failedResultCount = normalizeNonNegativeInteger(context?.resultCounts?.failed) ?? 0;
  return failedResultCount === 0
    && blockedResultCount > 0
    && (dueTaskCount > 0 || waitingTaskCount > 0);
}

/** @param {Array<any>} results */
function buildRecordedPassStatusCounts(results) {
  const counts = {
    blocked: 0,
    failed: 0,
  };
  if (!Array.isArray(results)) return counts;
  for (const result of results) {
    const status = getEffectiveAgentResultStatus(result) ?? normalizeStatus(result?.status);
    if (status === "blocked") counts.blocked += 1;
    if (status === "failed") counts.failed += 1;
  }
  return counts;
}

/**
 * @param {Array<any>} results
 * @returns {string | null}
 */
export function summarizeEffectivePassReason(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const firstProblem = results.find((result) => {
    const status = getEffectiveAgentResultStatus(result);
    return status === "failed" || status === "blocked";
  });
  return normalizeText(firstProblem?.detail?.reason);
}

/**
 * @param {{ tasks?: any[], blockers?: any[], dueTaskCount?: number | null, blockerCount?: number | null } | null | undefined} finalQueue
 */
function hasRemainingDueBacklog(finalQueue) {
  const queue = finalQueue;
  if (!queue || typeof queue !== "object") return false;
  const dueTaskCount = Number.isFinite(queue.dueTaskCount) ? Number(queue.dueTaskCount) : null;
  if (dueTaskCount !== null) return dueTaskCount > 0;
  const blockerCount = Number.isFinite(queue.blockerCount) ? Number(queue.blockerCount) : null;
  if (blockerCount !== null && blockerCount > 0) return true;
  return (Array.isArray(queue.tasks) && queue.tasks.length > 0)
    || (Array.isArray(queue.blockers) && queue.blockers.length > 0);
}

/** @param {unknown} value */
function normalizeStatus(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.toLowerCase() : null;
}

/** @param {unknown} value */
function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

/** @param {unknown} value */
function normalizeText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
