// @ts-check

import {
  CAPABILITY_SEAM_STATES,
  buildCapabilitySeamResult,
} from "./capability-seam-contract.js";

export const EMAIL_SEND_RECONCILIATION_OWNER = "src/core/email-send-reconciliation.js";

const GMAIL_SENT_MAIL_SURFACE = "gmail-sent-mail";
const GMAIL_INBOX_THREADS_SURFACE = "gmail-inbox-threads";
const EMAIL_SEND_ACTION = "send_email";
const SENT_RESULT = "sent";

/**
 * @param {{
 *   actionKey: string,
 *   resultKey: string,
 *   surface?: string | null,
 *   observationId?: string | null,
 * }} input
 */
export function buildEmailSendMutationReconciliation(input) {
  if (String(input.actionKey ?? "") !== EMAIL_SEND_ACTION || String(input.resultKey ?? "") !== SENT_RESULT) {
    return null;
  }

  return {
    state: "pending_external_proof",
    owner: EMAIL_SEND_RECONCILIATION_OWNER,
    actionKey: EMAIL_SEND_ACTION,
    resultKey: SENT_RESULT,
    surface: normalizeNullableString(input.surface) ?? "email",
    proofSurface: null,
    missingProofSurface: GMAIL_SENT_MAIL_SURFACE,
    externalState: "email_sent",
    reason: "send_email_recorded_waiting_for_gmail_proof",
    observationId: normalizeNullableString(input.observationId),
    clearedBy: null,
  };
}

/**
 * Pure Gmail-owned reconciliation for local send_email mutation debt.
 *
 * @param {{
 *   row: any,
 *   localSend?: any | null,
 *   sentMailProofs?: any[] | null,
 *   threadObservations?: any[] | null,
 *   sentMailSurface?: any | null,
 *   checkedAt?: string | null,
 * }} input
 */
export function reconcileEmailSendDebt(input) {
  const row = withOwner(input.row, EMAIL_SEND_RECONCILIATION_OWNER);
  const localSend = normalizeLocalSend(input.localSend);
  const checkedAt = normalizeNullableString(input.checkedAt);

  if (!localSend) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.QUIET,
      reason: "no_local_email_send_recorded",
      checkedAt,
      debt: { kind: "none", localState: null },
    });
  }

  const sentMailProof = findSentMailProof(localSend, input.sentMailProofs);
  if (sentMailProof) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "gmail_sent_mail_proof_observed",
      evidence: [buildSentMailEvidence(sentMailProof)],
      observedAt: sentMailProof.observedAt,
      checkedAt,
      debt: {
        kind: "cleared_by_sent_mail_proof",
        localState: "email_sent",
        localSend,
      },
    });
  }

  const threadProof = findThreadProof(localSend, input.threadObservations);
  if (threadProof) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "gmail_thread_proof_observed",
      evidence: [buildThreadEvidence(threadProof)],
      observedAt: normalizeNullableString(threadProof.observedAt),
      checkedAt,
      debt: {
        kind: "cleared_by_gmail_thread_proof",
        localState: "email_sent",
        localSend,
      },
    });
  }

  if (isUnsupportedSentMailSurface(input.sentMailSurface)) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.UNSUPPORTED,
      reason: "gmail_sent_mail_proof_unsupported",
      checkedAt: resolveSurfaceCheckedAt(input.sentMailSurface, checkedAt),
      debt: {
        kind: "sent_mail_proof_unsupported",
        localState: "email_sent",
        unsupportedProofSurfaces: [GMAIL_SENT_MAIL_SURFACE],
        localSend,
      },
    });
  }

  if (isCheckedSentMailSurface(input.sentMailSurface)) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.MISSING_PROOF,
      reason: "gmail_sent_mail_proof_missing_after_checked_surface",
      missingProofSurfaces: [GMAIL_SENT_MAIL_SURFACE],
      checkedAt: resolveSurfaceCheckedAt(input.sentMailSurface, checkedAt),
      debt: {
        kind: "sent_mail_proof_missing",
        localState: "email_sent",
        missingProofSurfaces: [GMAIL_SENT_MAIL_SURFACE],
        localSend,
      },
    });
  }

  return buildCapabilitySeamResult({
    row,
    state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
    reason: "local_send_recorded_pending_gmail_external_proof",
    checkedAt,
    debt: {
      kind: "pending_external_proof",
      localState: "email_sent",
      awaitingProofSurfaces: [GMAIL_SENT_MAIL_SURFACE, GMAIL_INBOX_THREADS_SURFACE],
      localSend,
    },
  });
}

/** @param {any} value */
function normalizeLocalSend(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    actionKey: normalizeNullableString(value.actionKey) ?? EMAIL_SEND_ACTION,
    resultKey: normalizeNullableString(value.resultKey) ?? SENT_RESULT,
    surface: normalizeNullableString(value.surface) ?? "email",
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
 * @param {any} localSend
 * @param {any[] | null | undefined} proofs
 */
function findSentMailProof(localSend, proofs) {
  return normalizeArray(proofs).find((proof) =>
    isSentMailProof(proof) && matchesLocalSend(localSend, proof, extractSentMailRecipientEmail(proof))
  ) ?? null;
}

/**
 * @param {any} localSend
 * @param {any[] | null | undefined} observations
 */
function findThreadProof(localSend, observations) {
  return normalizeArray(observations).find((observation) =>
    isGmailThreadObservation(observation)
    && matchesLocalSend(localSend, observation, normalizeEmail(observation.actorHandle ?? observation.fromEmail))
    && hasThreadActivityAfterSend(observation, localSend)
  ) ?? null;
}

/** @param {any} proof */
function isSentMailProof(proof) {
  if (!proof || typeof proof !== "object") {
    return false;
  }

  const surface = normalizeNullableString(proof.surfaceKey ?? proof.proofSurface ?? proof.surface);
  return !surface || surface === GMAIL_SENT_MAIL_SURFACE;
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
 * @param {any} localSend
 * @param {any} proof
 * @param {string | null} proofEmail
 */
function matchesLocalSend(localSend, proof, proofEmail) {
  if (!sameWhenBothPresent(localSend.motionId, normalizeNullableString(proof.motionId))) return false;
  if (!sameWhenBothPresent(localSend.companyId, normalizeNullableString(proof.companyId))) return false;
  if (!sameWhenBothPresent(localSend.prospectId, normalizeNullableString(proof.prospectId))) return false;
  if (!sameWhenBothPresent(localSend.recipientEmail, proofEmail)) return false;

  const proofAt = normalizeNullableString(proof.sentAt ?? proof.observedAt ?? proof.checkedAt);
  if (!proofAt || !localSend.occurredAt) {
    return true;
  }

  return Date.parse(proofAt) >= Date.parse(localSend.occurredAt);
}

/**
 * @param {any} observation
 * @param {any} localSend
 */
function hasThreadActivityAfterSend(observation, localSend) {
  const messages = Array.isArray(observation.messages) ? observation.messages : [];
  const hasInboundAfterSend = messages.some((message) =>
    String(message?.direction ?? "").toLowerCase() === "inbound"
    && occurredAtOrAfter(message?.sentAt, localSend.occurredAt)
  );
  return hasInboundAfterSend || occurredAtOrAfter(observation.observedAt, localSend.occurredAt);
}

/** @param {any} proof */
function buildSentMailEvidence(proof) {
  return {
    surface: GMAIL_SENT_MAIL_SURFACE,
    externalId: normalizeNullableString(proof.externalId ?? proof.messageId ?? proof.id),
    observedAt: normalizeNullableString(proof.sentAt ?? proof.observedAt ?? proof.checkedAt),
  };
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

/** @param {any} surface */
function isUnsupportedSentMailSurface(surface) {
  if (!surface || typeof surface !== "object") {
    return false;
  }

  return surface.supported === false
    || normalizeNullableString(surface.status ?? surface.lastRunStatus ?? surface.supportStatus) === "unsupported"
    || normalizeNullableString(surface.lastExhaustionReason) === "connector_surface_unsupported";
}

/** @param {any} surface */
function isCheckedSentMailSurface(surface) {
  if (!surface || typeof surface !== "object") {
    return false;
  }

  const status = normalizeNullableString(surface.lastRunStatus ?? surface.status);
  return status === "success"
    || Boolean(normalizeNullableString(surface.lastSyncedAt ?? surface.checkedAt))
    || typeof surface.lastItemCount === "number"
    || typeof surface.itemCount === "number";
}

/**
 * @param {any} surface
 * @param {string | null} fallback
 */
function resolveSurfaceCheckedAt(surface, fallback) {
  return normalizeNullableString(surface?.lastSyncedAt ?? surface?.checkedAt ?? surface?.lastObservedAt) ?? fallback;
}

/** @param {any} proof */
function extractSentMailRecipientEmail(proof) {
  return normalizeEmail(proof.recipientEmail ?? proof.toEmail ?? proof.to ?? proof.actorHandle ?? proof.email);
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
