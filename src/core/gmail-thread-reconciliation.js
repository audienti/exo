// @ts-check

import {
  CAPABILITY_SEAM_STATES,
  buildCapabilitySeamResult,
} from "./capability-seam-contract.js";

export const GMAIL_THREAD_RECONCILIATION_OWNER = "src/core/gmail-thread-reconciliation.js";

const GMAIL_INBOX_THREADS_SURFACE = "gmail-inbox-threads";
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Pure Gmail-owned reconciliation for gmail-inbox-threads truth.
 *
 * @param {{
 *   row: any,
 *   surface?: any | null,
 *   observations?: any[] | null,
 *   localWaitingSends?: any[] | null,
 *   checkedAt?: string | null,
 *   now?: string | null,
 *   staleAfterMs?: number | null,
 * }} input
 */
export function reconcileGmailThreadTruth(input) {
  const row = withOwner(input.row, GMAIL_THREAD_RECONCILIATION_OWNER);
  const observations = normalizeArray(input.observations).filter(isGmailThreadObservation);
  const localWaitingSends = normalizeArray(input.localWaitingSends).map(normalizeLocalWaitingSend).filter(Boolean);
  const checkedAt = normalizeNullableString(input.checkedAt) ?? resolveSurfaceCheckedAt(input.surface);

  const inboundReply = findInboundReplyObservation(observations, localWaitingSends);
  if (inboundReply) {
    const hasLocalWaiting = localWaitingSends.some((send) => observationMatchesSend(inboundReply, send));
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: hasLocalWaiting
        ? "inbound_gmail_reply_overrides_local_waiting_state"
        : "inbound_gmail_reply_observed",
      evidence: [buildThreadEvidence(inboundReply)],
      observedAt: normalizeNullableString(inboundReply.observedAt),
      checkedAt,
      debt: {
        kind: hasLocalWaiting ? "local_waiting_overridden_by_inbound_reply" : "gmail_reply_observed",
        localWaitingCount: localWaitingSends.length,
      },
    });
  }

  const threadUpdate = observations.find((observation) => observation.kind === "email_thread_updated") ?? null;
  if (threadUpdate) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "gmail_thread_update_observed",
      evidence: [buildThreadEvidence(threadUpdate)],
      observedAt: normalizeNullableString(threadUpdate.observedAt),
      checkedAt,
      debt: {
        kind: "gmail_thread_update_observed",
        localWaitingCount: localWaitingSends.length,
      },
    });
  }

  if (isStale(input.surface, input.now, input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS, checkedAt)) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.STALE,
      reason: "gmail_thread_truth_stale",
      checkedAt,
      debt: {
        kind: "thread_truth_stale",
        lastCheckedAt: checkedAt,
        staleAfterMs: input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
      },
    });
  }

  if (isFreshQuietThreadSurface(input.surface, checkedAt)) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.QUIET,
      reason: "fresh_gmail_thread_sync_quiet",
      checkedAt,
      debt: { kind: "none" },
    });
  }

  return buildCapabilitySeamResult({
    row,
    state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
    reason: "gmail_thread_truth_pending",
    checkedAt,
    debt: {
      kind: "thread_truth_pending",
      localWaitingCount: localWaitingSends.length,
    },
  });
}

/**
 * @param {any[]} observations
 * @param {any[]} localWaitingSends
 */
function findInboundReplyObservation(observations, localWaitingSends) {
  const replies = observations.filter((observation) => observation.kind === "email_reply_received");
  if (!replies.length) {
    return null;
  }

  if (!localWaitingSends.length) {
    return replies[0];
  }

  return replies.find((observation) =>
    localWaitingSends.some((send) => observationMatchesSend(observation, send))
  ) ?? null;
}

/** @param {any} value */
function normalizeLocalWaitingSend(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    actionKey: normalizeNullableString(value.actionKey),
    resultKey: normalizeNullableString(value.resultKey),
    motionId: normalizeNullableString(value.motionId),
    companyId: normalizeNullableString(value.companyId),
    prospectId: normalizeNullableString(value.prospectId),
    recipientEmail: normalizeEmail(
      value.recipientEmail ?? value.toEmail ?? value.email ?? value.actorHandle ?? value.recipient,
    ),
    occurredAt: normalizeNullableString(value.occurredAt ?? value.sentAt ?? value.observedAt),
  };
}

/**
 * @param {any} observation
 * @param {any} send
 */
function observationMatchesSend(observation, send) {
  if (!sameWhenBothPresent(send.motionId, normalizeNullableString(observation.motionId))) return false;
  if (!sameWhenBothPresent(send.companyId, normalizeNullableString(observation.companyId))) return false;
  if (!sameWhenBothPresent(send.prospectId, normalizeNullableString(observation.prospectId))) return false;
  if (!sameWhenBothPresent(send.recipientEmail, normalizeEmail(observation.actorHandle ?? observation.fromEmail))) {
    return false;
  }

  return hasInboundActivityAfterSend(observation, send);
}

/**
 * @param {any} observation
 * @param {any} send
 */
function hasInboundActivityAfterSend(observation, send) {
  const messages = Array.isArray(observation.messages) ? observation.messages : [];
  const inboundMessageAfterSend = messages.some((message) =>
    String(message?.direction ?? "").toLowerCase() === "inbound"
    && occurredAtOrAfter(message?.sentAt, send.occurredAt)
  );
  return inboundMessageAfterSend || occurredAtOrAfter(observation.observedAt, send.occurredAt);
}

/** @param {any} observation */
function isGmailThreadObservation(observation) {
  if (!observation || typeof observation !== "object") {
    return false;
  }

  return normalizeNullableString(observation.surfaceKey) === GMAIL_INBOX_THREADS_SURFACE
    && ["email_reply_received", "email_thread_updated"].includes(String(observation.kind ?? ""));
}

/**
 * @param {any} surface
 * @param {string | null | undefined} now
 * @param {number} staleAfterMs
 * @param {string | null} checkedAt
 */
function isStale(surface, now, staleAfterMs, checkedAt) {
  if (!surface || !checkedAt || !now || !Number.isFinite(staleAfterMs)) {
    return false;
  }

  const nowMs = Date.parse(now);
  const checkedMs = Date.parse(checkedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(checkedMs)) {
    return false;
  }

  return nowMs - checkedMs > staleAfterMs;
}

/**
 * @param {any} surface
 * @param {string | null} checkedAt
 */
function isFreshQuietThreadSurface(surface, checkedAt) {
  if (!surface || typeof surface !== "object") {
    return false;
  }

  const status = normalizeNullableString(surface.lastRunStatus ?? surface.status);
  const itemCount = surface.lastItemCount ?? surface.itemCount ?? surface.lastVisibleTotalCount ?? null;
  const completeness = normalizeNullableString(surface.lastCaptureCompleteness ?? surface.captureCompleteness);
  const exhaustion = normalizeNullableString(surface.lastExhaustionStatus ?? surface.exhaustionStatus);

  return normalizeNullableString(surface.surfaceKey ?? surface.key) === GMAIL_INBOX_THREADS_SURFACE
    && status === "success"
    && checkedAt !== null
    && (itemCount === 0 || itemCount === "0")
    && completeness === "complete"
    && (!exhaustion || exhaustion === "complete");
}

/** @param {any} surface */
function resolveSurfaceCheckedAt(surface) {
  return normalizeNullableString(surface?.lastSyncedAt ?? surface?.checkedAt ?? surface?.lastObservedAt);
}

/** @param {any} observation */
function buildThreadEvidence(observation) {
  return {
    surface: GMAIL_INBOX_THREADS_SURFACE,
    externalId: normalizeNullableString(observation.externalId ?? observation.threadId ?? observation.id),
    observedAt: normalizeNullableString(observation.observedAt),
    kind: normalizeNullableString(observation.kind),
  };
}

/**
 * @param {string | null} left
 * @param {string | null} right
 */
function sameWhenBothPresent(left, right) {
  return !left || !right || left === right;
}

/**
 * @param {unknown} value
 * @param {string | null} reference
 */
function occurredAtOrAfter(value, reference) {
  const parsed = Date.parse(String(value ?? ""));
  const referenceParsed = Date.parse(String(reference ?? ""));
  if (!Number.isFinite(parsed) || !Number.isFinite(referenceParsed)) {
    return true;
  }
  return parsed >= referenceParsed;
}

/**
 * @param {any} row
 * @param {string} owner
 */
function withOwner(row, owner) {
  return {
    ...(row ?? {}),
    reconcile: {
      ...(row?.reconcile ?? {}),
      owner,
    },
  };
}

/** @param {any[] | null | undefined} value */
function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

/** @param {unknown} value */
function normalizeEmail(value) {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}

/** @param {unknown} value */
function normalizeNullableString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}
