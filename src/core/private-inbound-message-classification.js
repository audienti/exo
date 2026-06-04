// @ts-check

import { isSendableDraftStatus } from "../lib/draft-policy.js";

const PRIVATE_INBOUND_MESSAGE_KINDS = new Set([
  "inbound_reply_received",
  "email_reply_received",
  "message_received",
]);

const PRIVATE_INBOUND_THREAD_KINDS = new Set([
  ...PRIVATE_INBOUND_MESSAGE_KINDS,
  "thread_updated",
  "email_thread_updated",
]);

/**
 * @param {string | null | undefined} kind
 * @returns {boolean}
 */
export function isPrivateInboundMessageKind(kind) {
  return PRIVATE_INBOUND_MESSAGE_KINDS.has(String(kind ?? ""));
}

/**
 * @param {string | null | undefined} kind
 * @returns {boolean}
 */
export function isPrivateInboundThreadKind(kind) {
  return PRIVATE_INBOUND_THREAD_KINDS.has(String(kind ?? ""));
}

/**
 * Exo should only call something a "reply" when the captured thread history
 * proves there was an earlier outbound message from the operator. Provider
 * surfaces often label any unread inbound private message as a reply even when
 * the contact started the thread cold.
 *
 * @param {any[] | any} input
 * @returns {"reply" | "first_inbound" | "not_private_inbound"}
 */
export function classifyPrivateInboundMessage(input) {
  const observations = Array.isArray(input) ? input : [input];
  const privateInbound = observations.filter((observation) => isPrivateInboundMessageKind(observation?.kind));
  if (!privateInbound.length) {
    return "not_private_inbound";
  }

  const hasOutboundHistory = observations.some((observation) =>
    Array.isArray(observation?.messages)
    && observation.messages.some((message) => String(message?.direction ?? "").toLowerCase() === "outbound"),
  );

  return hasOutboundHistory ? "reply" : "first_inbound";
}

/**
 * Once a private inbound thread exists, the operator should stop seeing it as a
 * live reply decision if a matching outbound response is already queued or sent
 * after the inbound message landed.
 *
 * @param {any} observation
 * @param {any | null | undefined} prospect
 * @returns {"open" | "queued" | "sent" | "blocked" | "not_private_inbound"}
 */
export function classifyPrivateInboundResponseState(observation, prospect) {
  return describePrivateInboundResponse(observation, prospect).state;
}

/**
 * @param {any} observation
 * @param {any | null | undefined} prospect
 * @returns {{
 *   state: "open" | "queued" | "sent" | "blocked" | "not_private_inbound",
 *   draft?: any,
 *   touch?: any,
 *   surface?: "email" | "inbound_reply",
 * }}
 */
export function describePrivateInboundResponse(observation, prospect) {
  if (!isPrivateInboundThreadKind(observation?.kind)) {
    return { state: "not_private_inbound" };
  }

  const surface = resolvePrivateInboundReplySurface(observation);
  const observedAtMs = parseIsoMs(observation?.observedAt);
  const drafts = Array.isArray(prospect?.drafts) ? prospect.drafts : [];
  const touches = Array.isArray(prospect?.touches) ? prospect.touches : [];

  const sentDraft = drafts.find((draft) =>
    draft?.surface === surface
    && draft?.status === "sent"
    && occurredAtOrAfter(draft?.sentAt ?? draft?.updatedAt ?? draft?.approvedAt ?? draft?.createdAt, observedAtMs),
  ) ?? null;
  const sentTouch = findLatestMatchingTouch(touches, surface, observedAtMs, (touch) =>
    touch?.surface === surface
    && touch?.direction === "outbound"
    && touch?.outcome === "sent"
  );
  if (sentDraft || sentTouch) {
    return { state: "sent", draft: sentDraft ?? undefined, touch: sentTouch ?? undefined, surface };
  }

  const blockedTouch = findLatestMatchingTouch(touches, surface, observedAtMs, (touch) =>
    touch?.surface === surface
    && touch?.direction === "outbound"
    && touch?.outcome === "blocked"
  );
  if (blockedTouch) {
    return { state: "blocked", touch: blockedTouch, surface };
  }

  const queuedDraft = drafts.find((draft) =>
    draft?.surface === surface
    && isSendableDraftStatus(draft?.status)
    && occurredAtOrAfter(draft?.approvedAt ?? draft?.updatedAt ?? draft?.createdAt, observedAtMs),
  ) ?? null;
  if (queuedDraft) {
    return { state: "queued", draft: queuedDraft, surface };
  }

  return { state: "open", surface };
}

/**
 * @param {any} observation
 * @returns {"email" | "inbound_reply"}
 */
function resolvePrivateInboundReplySurface(observation) {
  const kind = String(observation?.kind ?? "").toLowerCase();
  const capability = String(observation?.capability ?? "").toLowerCase();
  const surfaceKey = String(observation?.surfaceKey ?? "").toLowerCase();
  if (
    kind === "email_reply_received"
    || kind === "email_thread_updated"
    || capability === "gmail"
    || surfaceKey.startsWith("gmail-")
  ) {
    return "email";
  }
  return "inbound_reply";
}

/**
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
function parseIsoMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {string | null | undefined} value
 * @param {number | null} referenceMs
 * @returns {boolean}
 */
function occurredAtOrAfter(value, referenceMs) {
  const parsed = parseIsoMs(value);
  if (parsed == null) {
    return false;
  }
  return referenceMs == null ? true : parsed >= referenceMs;
}

/**
 * @param {any[]} touches
 * @param {"email" | "inbound_reply"} surface
 * @param {number | null} observedAtMs
 * @param {(touch: any) => boolean} predicate
 */
function findLatestMatchingTouch(touches, surface, observedAtMs, predicate) {
  return touches
    .filter((touch) =>
      touch?.surface === surface
      && occurredAtOrAfter(touch?.occurredAt, observedAtMs)
      && predicate(touch)
    )
    .sort((left, right) => String(right?.occurredAt ?? "").localeCompare(String(left?.occurredAt ?? "")))[0] ?? null;
}
