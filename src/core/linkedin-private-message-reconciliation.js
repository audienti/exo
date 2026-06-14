// @ts-check

import {
  CAPABILITY_SEAM_STATES,
  buildCapabilitySeamResult,
} from "./capability-seam-contract.js";

export const LINKEDIN_PRIVATE_MESSAGE_RECONCILIATION_OWNER = "src/core/linkedin-private-message-reconciliation.js";

const LINKEDIN_MESSAGING_INBOX_SURFACE = "linkedin-messaging-inbox";
const DIRECT_MESSAGE_ACTION = "send_direct_message";
const DIRECT_MESSAGE_SENT_STATE = "direct_message_sent";
const INBOUND_REPLY_KINDS = new Set(["inbound_reply_received", "message_received"]);

/**
 * @param {{
 *   row: any,
 *   actionKey?: string | null,
 *   resultKey?: string | null,
 *   surface?: string | null,
 *   prospectId?: string | null,
 *   threadId?: string | null,
 *   actorLinkedinPublicId?: string | null,
 *   actorLinkedinMemberId?: string | null,
 *   actorHandle?: string | null,
 *   actorProfileUrl?: string | null,
 *   occurredAt?: string | null,
 *   body?: string | null,
 *   observations?: any[] | null,
 *   missingProofSurfaces?: string[] | null,
 *   checkedAt?: string | null,
 * }} input
 */
export function reconcileLinkedinPrivateMessageMutation(input) {
  const actionKey = normalizeString(input.actionKey ?? input.row?.actionKey ?? input.row?.capabilityKey);
  const resultKey = normalizeString(input.resultKey ?? "sent");
  if (actionKey !== DIRECT_MESSAGE_ACTION || resultKey !== "sent") {
    return null;
  }

  const matchingObservations = normalizeObservations(input.observations)
    .filter((observation) => observation.surfaceKey === LINKEDIN_MESSAGING_INBOX_SURFACE)
    .filter((observation) => observationMatchesMutation(observation, input));
  const inboundReplyEvidence = findInboundReplyEvidence(matchingObservations, input);
  if (inboundReplyEvidence) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "linkedin_inbound_reply_overrides_outbound_waiting",
      evidence: [inboundReplyEvidence],
      observedAt: inboundReplyEvidence.observedAt,
      checkedAt: input.checkedAt,
      debt: buildDirectMessageDebt(input, {
        clearedBy: "inbound_reply_received",
        proofSurface: LINKEDIN_MESSAGING_INBOX_SURFACE,
      }),
    });
  }

  const sentProofEvidence = findOutboundSentEvidence(matchingObservations, input);
  if (sentProofEvidence) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "linkedin_direct_message_sent_proof_observed",
      evidence: [sentProofEvidence],
      observedAt: sentProofEvidence.observedAt,
      checkedAt: input.checkedAt,
      debt: buildDirectMessageDebt(input, {
        clearedBy: "direct_message_sent_proof",
        proofSurface: LINKEDIN_MESSAGING_INBOX_SURFACE,
      }),
    });
  }

  const missingProofSurfaces = normalizeStringList(input.missingProofSurfaces);
  if (missingProofSurfaces.length > 0) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.MISSING_PROOF,
      reason: "linkedin_messaging_inbox_proof_missing",
      missingProofSurfaces,
      checkedAt: input.checkedAt,
      debt: buildDirectMessageDebt(input, {
        surfaceStatus: "missing",
      }),
    });
  }

  return buildCapabilitySeamResult({
    row: input.row,
    state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
    reason: "linkedin_direct_message_external_proof_pending",
    checkedAt: input.checkedAt,
    debt: buildDirectMessageDebt(input),
  });
}

/**
 * @param {{
 *   row: any,
 *   observations?: any[] | null,
 *   checkedAt?: string | null,
 * }} input
 */
export function reconcileLinkedinMessagingInboxSurface(input) {
  const observations = normalizeObservations(input.observations)
    .filter((observation) => observation.surfaceKey === LINKEDIN_MESSAGING_INBOX_SURFACE);
  if (observations.length > 0) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "linkedin_messaging_inbox_observations_present",
      evidence: observations.map((observation) => buildObservationEvidence(observation, null, null)),
      observedAt: newestObservedAt(observations),
      checkedAt: input.checkedAt,
      debt: {
        surfaceKey: LINKEDIN_MESSAGING_INBOX_SURFACE,
        observationCount: observations.length,
      },
    });
  }

  if (normalizeString(input.checkedAt)) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.QUIET,
      reason: "linkedin_messaging_inbox_thread_quiet",
      observedAt: input.checkedAt,
      checkedAt: input.checkedAt,
      debt: {
        surfaceKey: LINKEDIN_MESSAGING_INBOX_SURFACE,
        observationCount: 0,
      },
    });
  }

  return buildCapabilitySeamResult({
    row: input.row,
    state: CAPABILITY_SEAM_STATES.MISSING_PROOF,
    reason: "linkedin_messaging_inbox_proof_missing",
    missingProofSurfaces: [LINKEDIN_MESSAGING_INBOX_SURFACE],
    debt: {
      surfaceKey: LINKEDIN_MESSAGING_INBOX_SURFACE,
      surfaceStatus: "missing",
    },
  });
}

/**
 * @param {any[]} observations
 * @param {{ occurredAt?: string | null }} input
 */
function findInboundReplyEvidence(observations, input) {
  for (const observation of observations) {
    const messages = normalizeMessages(observation.messages);
    const inboundMessage = messages.find((message) =>
      message.direction === "inbound" && occurredAtOrAfter(message.sentAt, input.occurredAt)
    );
    if (inboundMessage && INBOUND_REPLY_KINDS.has(observation.kind)) {
      return buildObservationEvidence(observation, inboundMessage, "inbound");
    }

    if (INBOUND_REPLY_KINDS.has(observation.kind) && occurredAtOrAfter(observation.observedAt, input.occurredAt)) {
      return buildObservationEvidence(observation, null, "inbound");
    }
  }
  return null;
}

/**
 * @param {any[]} observations
 * @param {{ occurredAt?: string | null, body?: string | null }} input
 */
function findOutboundSentEvidence(observations, input) {
  for (const observation of observations) {
    const message = normalizeMessages(observation.messages).find((candidate) =>
      candidate.direction === "outbound"
      && occurredAtOrAfter(candidate.sentAt, input.occurredAt)
      && messageBodyMatches(candidate.body, input.body)
    );
    if (message) {
      return buildObservationEvidence(observation, message, "outbound");
    }
  }
  return null;
}

/**
 * @param {any} observation
 * @param {{
 *   prospectId?: string | null,
 *   threadId?: string | null,
 *   actorLinkedinPublicId?: string | null,
 *   actorLinkedinMemberId?: string | null,
 *   actorHandle?: string | null,
 *   actorProfileUrl?: string | null,
 * }} input
 */
function observationMatchesMutation(observation, input) {
  if (matchesString(input.prospectId, observation.prospectId)) return true;
  if (matchesString(input.threadId, observation.externalId ?? observation.threadId)) return true;
  if (matchesString(input.actorLinkedinPublicId, observation.actorLinkedinPublicId)) return true;
  if (matchesString(input.actorLinkedinMemberId, observation.actorLinkedinMemberId)) return true;
  if (matchesString(input.actorHandle, observation.actorHandle)) return true;
  if (matchesString(input.actorProfileUrl, observation.actorProfileUrl)) return true;

  return !normalizeString(input.prospectId)
    && !normalizeString(input.threadId)
    && !normalizeString(input.actorLinkedinPublicId)
    && !normalizeString(input.actorLinkedinMemberId)
    && !normalizeString(input.actorHandle)
    && !normalizeString(input.actorProfileUrl);
}

/**
 * @param {any} observation
 * @param {{ id?: string | null, direction?: string | null, sentAt?: string | null } | null} message
 * @param {"inbound" | "outbound" | null} fallbackDirection
 */
function buildObservationEvidence(observation, message, fallbackDirection) {
  return {
    surface: LINKEDIN_MESSAGING_INBOX_SURFACE,
    observationId: normalizeString(observation.id),
    externalId: normalizeString(observation.externalId ?? observation.threadId),
    messageId: normalizeString(message?.id),
    direction: normalizeString(message?.direction) ?? fallbackDirection,
    observedAt: normalizeString(observation.observedAt),
    sentAt: normalizeString(message?.sentAt),
  };
}

/**
 * @param {{
 *   actionKey?: string | null,
 *   resultKey?: string | null,
 *   surface?: string | null,
 *   prospectId?: string | null,
 *   threadId?: string | null,
 *   occurredAt?: string | null,
 * }} input
 * @param {Record<string, any>} [overrides]
 */
function buildDirectMessageDebt(input, overrides = {}) {
  return {
    actionKey: normalizeString(input.actionKey) ?? DIRECT_MESSAGE_ACTION,
    resultKey: normalizeString(input.resultKey) ?? "sent",
    surface: normalizeString(input.surface),
    prospectId: normalizeString(input.prospectId),
    threadId: normalizeString(input.threadId),
    occurredAt: normalizeString(input.occurredAt),
    externalState: DIRECT_MESSAGE_SENT_STATE,
    ...overrides,
  };
}

/** @param {unknown} value */
function normalizeObservations(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object")
    : [];
}

/** @param {unknown} value */
function normalizeMessages(value) {
  return Array.isArray(value)
    ? value
      .filter((item) => item && typeof item === "object")
      .map((message) => ({
        id: normalizeString(message.id),
        direction: normalizeString(message.direction)?.toLowerCase() ?? null,
        sentAt: normalizeString(message.sentAt),
        body: normalizeString(message.body),
      }))
      .filter((message) => message.direction === "inbound" || message.direction === "outbound")
    : [];
}

/**
 * @param {string | null} candidateBody
 * @param {string | null | undefined} expectedBody
 */
function messageBodyMatches(candidateBody, expectedBody) {
  const expected = normalizeString(expectedBody);
  if (!expected) return true;
  return normalizeWhitespace(candidateBody) === normalizeWhitespace(expected);
}

/**
 * @param {unknown} left
 * @param {unknown} right
 */
function matchesString(left, right) {
  const normalizedLeft = normalizeString(left);
  const normalizedRight = normalizeString(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

/**
 * @param {string | null | undefined} value
 * @param {string | null | undefined} reference
 */
function occurredAtOrAfter(value, reference) {
  const valueMs = Date.parse(String(value ?? ""));
  if (!Number.isFinite(valueMs)) return false;
  const referenceMs = Date.parse(String(reference ?? ""));
  return Number.isFinite(referenceMs) ? valueMs >= referenceMs : true;
}

/** @param {any[]} observations */
function newestObservedAt(observations) {
  return observations
    .map((observation) => normalizeString(observation.observedAt))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

/** @param {unknown} value */
function normalizeString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}

/** @param {unknown} value */
function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

/** @param {unknown} value */
function normalizeWhitespace(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
