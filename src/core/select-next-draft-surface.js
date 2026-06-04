// @ts-check
//
// Decides which outreach surface a prospect's NEXT message draft should be
// written for. The agent queue uses this to enqueue write_draft tasks and to
// detect when an existing draft has gone stale (the prospect did something
// that pushed the next move to a different surface, e.g. they replied).
//
// Priority is inbound-first because an unanswered inbound is the strongest
// signal that pre-written outbound is no longer the right next move.
//
// Used by build-agent-queue.js. Kept here so the rule lives in one place and
// has its own test coverage.

const SURFACE_PRIORITY = [
  "inbound_reply",
  "comment_reply",
  "post_accept_message",
  "follow_up_direct_message",
  "connection_request",
  "email",
];

const ACTIVE_DRAFT_STATUSES = new Set(["drafting", "ready", "queued", "approved"]);
const GOVERNED_CADENCE_STEPS = new Set(["connection-request", "direct-message", "value-add-email"]);

/**
 * Is a draft in a state where it's still the prospect's current outbound move?
 * Sent and discarded drafts are historical; the others are pending the loop.
 * @param {{ status?: string }} draft
 */
export function isDraftActive(draft) {
  return ACTIVE_DRAFT_STATUSES.has(String(draft?.status ?? ""));
}

/**
 * The single highest-priority surface this prospect should have a draft for
 * RIGHT NOW, or null if no surface is currently writeable. Returned as just
 * the surface key — the caller knows the prospect context.
 *
 * @param {any} prospect
 * @returns {string | null}
 */
export function selectNextDraftSurface(prospect) {
  if (!prospect) return null;
  const touches = Array.isArray(prospect.touches) ? prospect.touches : [];
  const cadence = prospect.cadenceState ?? {};

  for (const surface of ["inbound_reply", "comment_reply"]) {
    if (isSurfaceWriteable(surface, prospect, touches)) return surface;
  }

  const cadenceSurface = preferredCadenceSurface(cadence.currentStep, prospect, touches);
  if (cadenceSurface) return cadenceSurface;
  if (GOVERNED_CADENCE_STEPS.has(String(cadence.currentStep ?? ""))) return null;

  for (const surface of SURFACE_PRIORITY) {
    if (surface === "inbound_reply" || surface === "comment_reply") continue;
    if (isSurfaceWriteable(surface, prospect, touches)) return surface;
  }
  return null;
}

/**
 * Is `draft` stale because the prospect's next surface has moved on?
 * Returns null if the draft is still on the right surface, or a reason string
 * if it isn't. The classic case: a follow_up_direct_message draft sitting in
 * `ready` status when the prospect just replied — the next surface is now
 * inbound_reply, so the old draft is obsolete.
 *
 * @param {{ surface?: string, status?: string }} draft
 * @param {string | null} nextSurface  result of selectNextDraftSurface()
 * @returns {{ stale: boolean, reason: string | null }}
 */
export function classifyDraftStaleness(draft, nextSurface) {
  if (!isDraftActive(draft)) return { stale: false, reason: null };
  if (!nextSurface) {
    // No surface is currently writeable for this prospect (e.g. they've been
    // fully engaged or are blocked). A pending draft on any surface is now
    // out-of-place.
    return { stale: true, reason: "no_writeable_surface" };
  }
  if (draft.surface !== nextSurface) {
    return { stale: true, reason: `surface_moved_to_${nextSurface}` };
  }
  return { stale: false, reason: null };
}

// --- internal availability rules ---------------------------------------------

/**
 * @param {string} surface
 * @param {any} prospect
 * @param {any[]} touches
 */
function isSurfaceWriteable(surface, prospect, touches) {
  switch (surface) {
    case "inbound_reply":
      return hasUnansweredInbound(touches);
    case "comment_reply":
      return hasUnansweredCommentThread(touches);
    case "post_accept_message":
      return hasAcceptedConnection(prospect, touches) && !touches.some((t) => t.surface === "post_accept_message");
    case "follow_up_direct_message":
      return (hasPriorPrivateOutbound(touches) || isFirstPrivateDirectMessagePath(prospect, touches)) && !hasUnansweredInbound(touches);
    case "connection_request":
      return (
        !touches.some((t) => t.surface === "connection_request") &&
        Boolean(prospect.linkedinProfileUrl)
      );
    case "email":
      return Boolean(prospect.email) && !recentOutboundEmail(touches);
    default:
      return false;
  }
}

/**
 * @param {string | null | undefined} currentStep
 * @param {any} prospect
 * @param {any[]} touches
 */
function preferredCadenceSurface(currentStep, prospect, touches) {
  switch (currentStep) {
    case "connection-request":
      return isSurfaceWriteable("connection_request", prospect, touches) ? "connection_request" : null;
    case "direct-message":
      if (isSurfaceWriteable("post_accept_message", prospect, touches)) return "post_accept_message";
      if (isSurfaceWriteable("follow_up_direct_message", prospect, touches)) return "follow_up_direct_message";
      return null;
    case "value-add-email":
      return isSurfaceWriteable("email", prospect, touches) ? "email" : null;
    default:
      return null;
  }
}

/** @param {any[]} touches */
export function hasAcceptedConnection(prospect, touches = Array.isArray(prospect?.touches) ? prospect.touches : []) {
  if (prospect?.linkedinProfileSnapshot?.connectionDegree === 1) return true;
  return touches.some((t) => t.surface === "connection_request" && t.outcome === "accepted");
}

/** @param {any[]} touches */
export function hasPriorPrivateOutbound(touches) {
  return touches.some(
    (t) =>
      t.direction === "outbound" &&
      (t.surface === "post_accept_message" || t.surface === "follow_up_direct_message" || t.surface === "in_mail_message"),
  );
}

/**
 * Governed first private-message path for a messageable open profile. This is
 * not "post_accept_message" because there is no accepted connection. It still
 * belongs on the direct-message branch and should reuse the direct-message
 * surface instead of leaving the prospect stranded with no writable surface.
 *
 * @param {any} prospect
 * @param {any[]} [touches]
 */
export function isFirstPrivateDirectMessagePath(prospect, touches = Array.isArray(prospect?.touches) ? prospect.touches : []) {
  if (!prospect?.linkedinProfileUrl) return false;
  if (String(prospect?.cadenceState?.currentStep ?? "") !== "direct-message") return false;
  if (hasAcceptedConnection(prospect, touches)) return false;
  if (hasPriorPrivateOutbound(touches)) return false;
  return prospect?.linkedinProfileSnapshot?.isOpenProfile === true;
}

/**
 * Has the prospect sent us something we haven't responded to yet? "Inbound
 * after the most recent outbound" is the practical test.
 * @param {any[]} touches
 */
function hasUnansweredInbound(touches) {
  const lastInbound = lastTouchWhere(touches, (t) => t.direction === "inbound");
  if (!lastInbound) return false;
  const lastOutbound = lastTouchWhere(touches, (t) => t.direction === "outbound");
  if (!lastOutbound) return true;
  return String(lastInbound.occurredAt) > String(lastOutbound.occurredAt);
}

/** @param {any[]} touches */
function hasUnansweredCommentThread(touches) {
  const lastCommentInbound = lastTouchWhere(
    touches,
    (t) => t.direction === "inbound" && (t.surface === "public_comment" || t.surface === "comment_reply"),
  );
  if (!lastCommentInbound) return false;
  const lastCommentOutbound = lastTouchWhere(
    touches,
    (t) => t.direction === "outbound" && (t.surface === "public_comment" || t.surface === "comment_reply"),
  );
  if (!lastCommentOutbound) return true;
  return String(lastCommentInbound.occurredAt) > String(lastCommentOutbound.occurredAt);
}

/** @param {any[]} touches */
function recentOutboundEmail(touches) {
  // Don't re-draft an email if one was sent in the last 24h. Keeps the queue
  // from re-suggesting an email on every poll between send and reply.
  const lastEmail = lastTouchWhere(touches, (t) => t.surface === "email" && t.direction === "outbound");
  if (!lastEmail?.occurredAt) return false;
  const sentMs = Date.parse(lastEmail.occurredAt);
  if (Number.isNaN(sentMs)) return false;
  return Date.now() - sentMs < 24 * 60 * 60 * 1000;
}

/**
 * @param {any[]} touches
 * @param {(touch: any) => boolean} pred
 */
function lastTouchWhere(touches, pred) {
  let chosen = null;
  for (const touch of touches) {
    if (!pred(touch)) continue;
    if (!chosen || String(touch.occurredAt ?? "") > String(chosen.occurredAt ?? "")) {
      chosen = touch;
    }
  }
  return chosen;
}
