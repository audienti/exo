// @ts-check

import { isConnectionRequestInFlight } from "../lib/cadence-helpers.js";

const PUBLIC_ACTIVITY_LIMIT = 5;
const PRE_CONNECT_DELAY_MS = 48 * 60 * 60 * 1000;
const PENDING_INVITE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PENDING_INVITE_PROACTIVE_TOUCHES = 2;
const ELIGIBLE_ACTIVITY_TYPES = new Set([
  "own-post",
  "comment",
  "reshare-with-comment",
  "interview-share",
]);
const PUBLIC_ENGAGEMENT_TOUCH_SURFACES = new Set([
  "like_post",
  "create_comment_reaction",
  "public_comment",
  "comment_reply",
]);
const METADATA_PREFIX = "exo-public-engagement.";
const PUBLIC_REACTION_ACTIONS = new Set(["like_post", "create_comment_reaction"]);

const PRE_CONNECT_SKIP_REASON = "No eligible recent public LinkedIn activity is stored, so Exo should skip warmup and move straight to a direct connection request.";

/**
 * @param {any} prospect
 */
export function listStoredLinkedinPublicActivity(prospect) {
  const rawItems = Array.isArray(prospect?.linkedinProfileSnapshot?.recentPosts)
    ? prospect.linkedinProfileSnapshot.recentPosts
    : [];
  const normalized = [];
  const seen = new Set();
  for (const rawItem of rawItems) {
    const item = normalizePublicActivity(rawItem);
    if (!item?.url || seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    if (!isEligiblePublicActivity(item)) {
      continue;
    }
    normalized.push(item);
    if (normalized.length >= PUBLIC_ACTIVITY_LIMIT) {
      break;
    }
  }
  return normalized;
}

/**
 * @param {any} rawSelection
 */
export function normalizePublicEngagementSelection(rawSelection) {
  if (!rawSelection || typeof rawSelection !== "object") {
    return null;
  }
  const normalized = normalizePublicActivity(rawSelection);
  if (!normalized?.url || !normalized.targetKind) {
    return null;
  }
  return {
    ...normalized,
    targetUrl: normalized.url,
    selectionReason: normalizeText(rawSelection.selectionReason),
    selectedAt: normalizeIso(rawSelection.selectedAt),
  };
}

/**
 * @param {any} rawDecision
 */
export function normalizePreConnectDecision(rawDecision) {
  if (!rawDecision || typeof rawDecision !== "object") {
    return null;
  }
  const mode = rawDecision.mode === "skip"
    ? "skip"
    : rawDecision.mode === "bypass"
      ? "bypass"
      : null;
  const reason = normalizeText(rawDecision.reason);
  if (!mode || !reason) {
    return null;
  }
  return {
    mode,
    reason,
    decidedAt: normalizeIso(rawDecision.decidedAt),
  };
}

/**
 * @param {any} prospect
 * @param {{
 *   forceReaction?: boolean,
 *   ignorePersistedSelection?: boolean,
 * }} [options]
 */
export function selectLinkedinPublicEngagementTarget(prospect, options = {}) {
  const proactiveSpent = listProactiveSpentSourceUrls(prospect);
  const discardedTargets = listDiscardedDraftTargetUrls(prospect);
  const excludedUrls = new Set(
    Array.isArray(options.excludeUrls)
      ? options.excludeUrls.map((value) => normalizeText(value)).filter(Boolean)
      : [],
  );
  const shouldForceReaction = options.forceReaction === true;
  const persisted = options.ignorePersistedSelection
    ? null
    : normalizePublicEngagementSelection(prospect?.publicEngagementSelection);

  if (persisted && !excludedUrls.has(persisted.url) && !proactiveSpent.has(persisted.url) && !discardedTargets.has(persisted.url)) {
    return buildSelection(persisted, shouldForceReaction, {
      reason: persisted.selectionReason ?? defaultSelectionReason(persisted, shouldForceReaction),
      persisted: true,
    });
  }

  const candidates = listStoredLinkedinPublicActivity(prospect)
    .filter((item) => !excludedUrls.has(item.url) && !proactiveSpent.has(item.url) && !discardedTargets.has(item.url))
    .sort(comparePublicActivity);
  if (!candidates.length) {
    return null;
  }

  return buildSelection(candidates[0], shouldForceReaction, {
    reason: defaultSelectionReason(candidates[0], shouldForceReaction),
    persisted: false,
  });
}

/**
 * @param {any} prospect
 * @param {string} now
 */
export function buildLinkedinPublicEngagementPlan(prospect, now) {
  const normalizedNow = normalizeIso(now) ?? new Date().toISOString();
  const preConnectDecision = normalizePreConnectDecision(prospect?.preConnectDecision);
  const reactiveReply = buildReactiveCommentReplyPlan(prospect, normalizedNow);
  if (reactiveReply) {
    return reactiveReply;
  }

  if (hasAcceptedConnection(prospect)) {
    return {
      kind: "none",
      mode: "proactive",
      reason: "connection_accepted",
      dueAt: null,
    };
  }

  const latestInviteSentAt = latestConnectionRequestSentAt(prospect);
  if (!latestInviteSentAt) {
    if (preConnectDecision?.mode === "bypass") {
      return {
        kind: "none",
        mode: "proactive",
        reason: "pre_connect_bypassed",
        reasonDetail: preConnectDecision.reason,
        dueAt: null,
      };
    }
    if (preConnectDecision?.mode === "skip") {
      return {
        kind: "skip",
        mode: "proactive",
        reason: "pre_connect_skipped",
        reasonDetail: preConnectDecision.reason,
        dueAt: normalizedNow,
      };
    }
    const forceReactionRecovery = shouldRecoverDiscardedCommentWithReaction(prospect);
    const preInviteTouch = latestPreInviteProactiveTouch(prospect);
    if (preInviteTouch?.occurredAt) {
      return {
        kind: "waiting",
        mode: "proactive",
        reason: "waiting_for_connection_request_delay",
        dueAt: addMs(preInviteTouch.occurredAt, PRE_CONNECT_DELAY_MS),
      };
    }

    const selection = selectLinkedinPublicEngagementTarget(prospect, {
      forceReaction: forceReactionRecovery,
    });
    if (!selection) {
      return {
        kind: "skip",
        mode: "proactive",
        reason: "no_eligible_activity",
        reasonDetail: PRE_CONNECT_SKIP_REASON,
        dueAt: normalizedNow,
      };
    }

    return {
      kind: selection.requiresDraft ? "draft" : "send",
      mode: "proactive",
      reason: "pre_connect",
      phase: "pre_connect",
      dueAt: normalizedNow,
      selection,
      fallbackSelection: selection.requiresDraft ? null : selectLinkedinPublicEngagementTarget(prospect, {
        forceReaction: true,
        ignorePersistedSelection: true,
        excludeUrls: [selection.targetUrl],
      }),
    };
  }

  if (!isConnectionRequestInFlight(prospect?.cadenceState ?? {})) {
    return {
      kind: "none",
      mode: "proactive",
      reason: "invite_not_pending",
      dueAt: null,
    };
  }

  const pendingInviteTouches = listPendingInviteProactiveTouches(prospect);
  if (pendingInviteTouches.length >= MAX_PENDING_INVITE_PROACTIVE_TOUCHES) {
    return {
      kind: "none",
      mode: "proactive",
      reason: "pending_invite_limit_reached",
      dueAt: null,
    };
  }

  const anchorAt = pendingInviteTouches.at(-1)?.occurredAt ?? latestInviteSentAt;
  const dueAt = addMs(anchorAt, PENDING_INVITE_INTERVAL_MS);
  if (dueAt > normalizedNow) {
    return {
      kind: "waiting",
      mode: "proactive",
      reason: "waiting_for_pending_invite_followup_window",
      dueAt,
    };
  }

  const selection = selectLinkedinPublicEngagementTarget(prospect, {
    forceReaction: shouldRecoverDiscardedCommentWithReaction(prospect),
  });
  if (!selection) {
    return {
      kind: "none",
      mode: "proactive",
      reason: "no_eligible_activity",
      dueAt: null,
    };
  }

  return {
    kind: selection.requiresDraft ? "draft" : "send",
    mode: "proactive",
    reason: "pending_invite_followup",
    phase: "pending_invite",
    dueAt,
    selection,
    fallbackSelection: selection.requiresDraft ? null : selectLinkedinPublicEngagementTarget(prospect, {
      forceReaction: true,
      ignorePersistedSelection: true,
      excludeUrls: [selection.targetUrl],
    }),
  };
}

/**
 * @param {any} prospect
 * @param {string} [now]
 */
export function derivePreConnectState(prospect, now = new Date().toISOString()) {
  const decision = normalizePreConnectDecision(prospect?.preConnectDecision);
  if (
    !decision
    && !normalizeText(prospect?.linkedinProfileUrl)
    && !normalizePublicEngagementSelection(prospect?.publicEngagementSelection)
    && !listStoredLinkedinPublicActivity(prospect).length
  ) {
    return null;
  }
  if (decision?.mode === "bypass") {
    return {
      status: "bypassed",
      reason: decision.reason,
      decidedAt: decision.decidedAt,
    };
  }

  const plan = buildLinkedinPublicEngagementPlan(prospect, now);
  if (plan.reason === "pre_connect_skipped") {
    return {
      status: "skipped",
      reason: plan.reasonDetail ?? decision?.reason ?? null,
      decidedAt: decision?.decidedAt ?? null,
    };
  }
  if (plan.kind === "skip") {
    return {
      status: "skipped",
      reason: plan.reasonDetail ?? PRE_CONNECT_SKIP_REASON,
      decidedAt: null,
    };
  }
  return null;
}

/**
 * @param {any} prospect
 */
export function listProactiveSpentSourceUrls(prospect) {
  const spent = new Set();
  for (const touch of prospect?.touches ?? []) {
    if (touch?.direction !== "outbound" || !PUBLIC_ENGAGEMENT_TOUCH_SURFACES.has(String(touch?.surface ?? ""))) {
      continue;
    }
    if (parsePublicEngagementMetadata(touch.notes)?.mode === "reactive") {
      continue;
    }
    const url = normalizeText(touch.sourceUrl);
    if (url) {
      spent.add(url);
    }
  }
  return spent;
}

/**
 * @param {{
 *   mode: "proactive" | "reactive",
 *   phase?: string | null,
 *   targetUrl?: string | null,
 *   targetKind?: "post" | "comment" | null,
 *   actionKey?: string | null,
 *   detail?: string | null,
 * }} input
 */
export function buildPublicEngagementMetadata(input) {
  const lines = [
    `${METADATA_PREFIX}mode=${input.mode}`,
  ];
  if (normalizeText(input.phase)) {
    lines.push(`${METADATA_PREFIX}phase=${normalizeText(input.phase)}`);
  }
  if (normalizeText(input.targetUrl)) {
    lines.push(`${METADATA_PREFIX}target-url=${normalizeText(input.targetUrl)}`);
  }
  if (input.targetKind === "post" || input.targetKind === "comment") {
    lines.push(`${METADATA_PREFIX}target-kind=${input.targetKind}`);
  }
  if (normalizeText(input.actionKey)) {
    lines.push(`${METADATA_PREFIX}action=${normalizeText(input.actionKey)}`);
  }
  if (normalizeText(input.detail)) {
    lines.push(`${METADATA_PREFIX}detail=${normalizeText(input.detail)}`);
  }
  return lines.join("\n");
}

/**
 * @param {string | null | undefined} notes
 */
export function parsePublicEngagementMetadata(notes) {
  const text = normalizeText(notes);
  if (!text) {
    return null;
  }

  /** @type {Record<string, string>} */
  const values = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(METADATA_PREFIX)) {
      continue;
    }
    const pair = trimmed.slice(METADATA_PREFIX.length);
    const divider = pair.indexOf("=");
    if (divider === -1) {
      continue;
    }
    const key = pair.slice(0, divider).trim();
    const value = pair.slice(divider + 1).trim();
    if (key) {
      values[key] = value;
    }
  }

  if (!Object.keys(values).length) {
    return null;
  }

  const mode = values.mode === "reactive" ? "reactive" : values.mode === "proactive" ? "proactive" : null;
  const targetKind = values["target-kind"] === "comment"
    ? "comment"
    : values["target-kind"] === "post"
      ? "post"
      : null;

  return {
    mode,
    phase: normalizeText(values.phase),
    targetUrl: normalizeText(values["target-url"]),
    targetKind,
    actionKey: normalizeText(values.action),
    detail: normalizeText(values.detail),
  };
}

/**
 * @param {any} prospect
 */
export function latestConnectionRequestSentAt(prospect) {
  return latestTouchOccurredAt(
    prospect?.touches ?? [],
    (touch) => touch?.surface === "connection_request" && touch?.direction === "outbound" && touch?.outcome === "sent",
  );
}

/**
 * @param {any} prospect
 */
export function hasAcceptedConnection(prospect) {
  if (prospect?.linkedinProfileSnapshot?.connectionDegree === 1) {
    return true;
  }
  return (prospect?.touches ?? []).some(
    (touch) =>
      touch?.surface === "accept_connection"
      || (touch?.surface === "connection_request" && touch?.outcome === "accepted"),
  );
}

/**
 * @param {any} prospect
 */
export function latestReactiveCommentInboundAt(prospect) {
  return latestTouchOccurredAt(
    prospect?.touches ?? [],
    (touch) =>
      touch?.direction === "inbound"
      && (touch?.surface === "public_comment" || touch?.surface === "comment_reply"),
  );
}

/**
 * @param {any} prospect
 */
export function latestReactiveCommentSourceUrl(prospect) {
  const latest = latestTouch(
    prospect?.touches ?? [],
    (touch) =>
      touch?.direction === "inbound"
      && (touch?.surface === "public_comment" || touch?.surface === "comment_reply"),
  );
  return normalizeText(latest?.sourceUrl);
}

/**
 * @param {any} item
 */
function normalizePublicActivity(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const activityType = normalizeActivityType(item.activityType);
  const targetKind = item.targetKind === "comment"
    ? "comment"
    : item.targetKind === "post"
      ? "post"
      : inferTargetKind(activityType);
  const recommendedAction = item.recommendedAction === "comment"
    ? "comment"
    : item.recommendedAction === "reaction"
      ? "reaction"
      : inferRecommendedAction(item);
  return {
    activityType,
    url: normalizeText(item.url),
    postedAt: normalizeIso(item.postedAt),
    freshnessBand: normalizeText(item.freshnessBand),
    summary: normalizeText(item.summary),
    snippet: normalizeText(item.snippet),
    targetKind,
    authoredByProspect: item.authoredByProspect === false ? false : item.authoredByProspect === true ? true : null,
    hasOriginalCommentary: item.hasOriginalCommentary === false ? false : item.hasOriginalCommentary === true ? true : null,
    businessRelevance: normalizeBusinessRelevance(item.businessRelevance),
    recommendedAction,
    rationale: normalizeText(item.rationale),
  };
}

/**
 * @param {any} item
 */
function isEligiblePublicActivity(item) {
  if (!item?.url || !item.targetKind) {
    return false;
  }
  if (item.authoredByProspect === false) {
    return false;
  }
  if (!item.activityType || !ELIGIBLE_ACTIVITY_TYPES.has(item.activityType)) {
    return false;
  }
  if (item.activityType === "reshare-with-comment" && item.hasOriginalCommentary === false) {
    return false;
  }
  return true;
}

/**
 * @param {any} prospect
 * @param {string} now
 */
function buildReactiveCommentReplyPlan(prospect, now) {
  const inboundAt = latestReactiveCommentInboundAt(prospect);
  if (!inboundAt) {
    return null;
  }
  const lastOutboundAt = latestTouchOccurredAt(
    prospect?.touches ?? [],
    (touch) =>
      touch?.direction === "outbound"
      && (touch?.surface === "public_comment" || touch?.surface === "comment_reply"),
  );
  if (lastOutboundAt && lastOutboundAt >= inboundAt) {
    return null;
  }
  return {
    kind: "draft",
    mode: "reactive",
    reason: "reactive_thread_reply",
    phase: "reactive_thread",
    dueAt: inboundAt ?? now,
    selection: {
      actionKey: "create_comment_comment",
      surface: "comment_reply",
      requiresDraft: true,
      targetKind: "comment",
      targetUrl: latestReactiveCommentSourceUrl(prospect),
      summary: null,
      activityType: "comment",
      recommendedAction: "comment",
      selectionReason: "A real person replied in-thread, so Exo should draft a checked reply now.",
      selectedAt: now,
    },
    fallbackSelection: null,
  };
}

/**
 * @param {any} prospect
 */
function latestPreInviteProactiveTouch(prospect) {
  const inviteSentAt = latestConnectionRequestSentAt(prospect);
  return latestTouch(
    prospect?.touches ?? [],
    (touch) =>
      touch?.direction === "outbound"
      && touch?.outcome === "sent"
      && PUBLIC_ENGAGEMENT_TOUCH_SURFACES.has(String(touch?.surface ?? ""))
      && parsePublicEngagementMetadata(touch.notes)?.mode !== "reactive"
      && (!inviteSentAt || String(touch?.occurredAt ?? "") < inviteSentAt),
  );
}

/**
 * @param {any} prospect
 */
function listPendingInviteProactiveTouches(prospect) {
  const inviteSentAt = latestConnectionRequestSentAt(prospect);
  if (!inviteSentAt) {
    return [];
  }
  return (prospect?.touches ?? [])
    .filter((touch) =>
      touch?.direction === "outbound"
      && touch?.outcome === "sent"
      && PUBLIC_ENGAGEMENT_TOUCH_SURFACES.has(String(touch?.surface ?? ""))
      && parsePublicEngagementMetadata(touch.notes)?.mode !== "reactive"
      && String(touch?.occurredAt ?? "") > inviteSentAt,
    )
    .sort((left, right) => String(left?.occurredAt ?? "").localeCompare(String(right?.occurredAt ?? "")));
}

/**
 * @param {any} prospect
 */
function listDiscardedDraftTargetUrls(prospect) {
  const blocked = new Set();
  for (const draft of prospect?.drafts ?? []) {
    if (draft?.status !== "discarded") {
      continue;
    }
    const metadata = parsePublicEngagementMetadata(draft.notes);
    if (metadata?.mode !== "proactive" || !metadata.targetUrl) {
      continue;
    }
    blocked.add(metadata.targetUrl);
  }
  return blocked;
}

/**
 * @param {any} prospect
 */
function shouldRecoverDiscardedCommentWithReaction(prospect) {
  const latestDiscardedAt = latestDiscardedProactiveDraftAt(prospect);
  if (!latestDiscardedAt) {
    return false;
  }
  const latestSuccessfulTouchAt = latestTouchOccurredAt(
    prospect?.touches ?? [],
    (touch) =>
      touch?.direction === "outbound"
      && touch?.outcome === "sent"
      && PUBLIC_ENGAGEMENT_TOUCH_SURFACES.has(String(touch?.surface ?? ""))
      && parsePublicEngagementMetadata(touch.notes)?.mode !== "reactive",
  );
  return !latestSuccessfulTouchAt || latestSuccessfulTouchAt < latestDiscardedAt;
}

/**
 * @param {any} prospect
 */
function latestDiscardedProactiveDraftAt(prospect) {
  let selected = null;
  for (const draft of prospect?.drafts ?? []) {
    if (draft?.status !== "discarded") {
      continue;
    }
    const metadata = parsePublicEngagementMetadata(draft.notes);
    if (metadata?.mode !== "proactive") {
      continue;
    }
    const updatedAt = normalizeIso(draft.updatedAt);
    if (!updatedAt) {
      continue;
    }
    if (!selected || updatedAt > selected) {
      selected = updatedAt;
    }
  }
  return selected;
}

/**
 * @param {ReturnType<typeof normalizePublicActivity>} item
 * @param {boolean} forceReaction
 * @param {{ reason: string, persisted: boolean }} options
 */
function buildSelection(item, forceReaction, options) {
  const targetKind = item.targetKind === "comment" ? "comment" : "post";
  const actionKey = forceReaction || item.recommendedAction !== "comment"
    ? (targetKind === "comment" ? "create_comment_reaction" : "like_post")
    : (targetKind === "comment" ? "create_comment_comment" : "create_post_comment");
  const requiresDraft = !PUBLIC_REACTION_ACTIONS.has(actionKey);
  return {
    targetUrl: item.url,
    targetKind,
    activityType: item.activityType,
    summary: item.summary ?? item.snippet ?? null,
    snippet: item.snippet ?? null,
    postedAt: item.postedAt,
    freshnessBand: item.freshnessBand,
    businessRelevance: item.businessRelevance,
    recommendedAction: forceReaction ? "reaction" : item.recommendedAction,
    rationale: item.rationale,
    selectionReason: options.reason,
    selectedAt: item.postedAt ?? null,
    persisted: options.persisted,
    actionKey,
    surface: requiresDraft
      ? (actionKey === "create_comment_comment" ? "comment_reply" : "public_comment")
      : actionKey,
    requiresDraft,
  };
}

/**
 * @param {ReturnType<typeof normalizePublicActivity>} left
 * @param {ReturnType<typeof normalizePublicActivity>} right
 */
function comparePublicActivity(left, right) {
  const commentDelta = Number(isCommentWorthy(right)) - Number(isCommentWorthy(left));
  if (commentDelta !== 0) {
    return commentDelta;
  }
  const relevanceDelta = businessRelevanceScore(right.businessRelevance) - businessRelevanceScore(left.businessRelevance);
  if (relevanceDelta !== 0) {
    return relevanceDelta;
  }
  const freshnessDelta = freshnessScore(right.freshnessBand) - freshnessScore(left.freshnessBand);
  if (freshnessDelta !== 0) {
    return freshnessDelta;
  }
  return String(right.postedAt ?? "").localeCompare(String(left.postedAt ?? ""));
}

/**
 * @param {ReturnType<typeof normalizePublicActivity>} item
 */
function defaultSelectionReason(item, forceReaction) {
  if (forceReaction) {
    return "The original comment lane was rejected, so Exo should use a lightweight reaction on a different untouched item.";
  }
  if (isCommentWorthy(item)) {
    return item.targetKind === "comment"
      ? "This comment is clearly work-relevant, so Exo should tee up a checked in-thread reply."
      : "This post is clearly work-relevant, so Exo should tee up a checked public comment.";
  }
  return "No strong business hook was stored, so Exo should use the freshest untouched public activity for a lightweight reaction.";
}

/**
 * @param {ReturnType<typeof normalizePublicActivity>} item
 */
function inferRecommendedAction(item) {
  return isCommentWorthy(item) ? "comment" : "reaction";
}

/**
 * @param {ReturnType<typeof normalizePublicActivity>} item
 */
function isCommentWorthy(item) {
  return businessRelevanceScore(item.businessRelevance) >= 3;
}

/**
 * Live LinkedIn enrichment now commonly labels authored posts as `post`
 * instead of the older `own-post`. Treat them as the same governed activity.
 *
 * @param {string | null | undefined} activityType
 */
function normalizeActivityType(activityType) {
  const normalized = normalizeText(activityType);
  return normalized === "post" ? "own-post" : normalized;
}

/**
 * @param {string | null | undefined} activityType
 */
function inferTargetKind(activityType) {
  return activityType === "comment" ? "comment" : activityType ? "post" : null;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeBusinessRelevance(value) {
  const normalized = normalizeText(value);
  if (normalized === "high" || normalized === "moderate" || normalized === "low" || normalized === "unknown") {
    return normalized;
  }
  return null;
}

/**
 * @param {string | null | undefined} value
 */
function businessRelevanceScore(value) {
  switch (value) {
    case "high":
      return 4;
    case "moderate":
      return 3;
    case "low":
      return 2;
    default:
      return 1;
  }
}

/**
 * @param {string | null | undefined} value
 */
function freshnessScore(value) {
  switch (value) {
    case "0-14-days":
      return 5;
    case "15-30-days":
      return 4;
    case "31-60-days":
      return 3;
    case "61-90-days":
      return 2;
    case "stale":
      return 1;
    default:
      return 0;
  }
}

/**
 * @param {string | null | undefined} value
 */
function normalizeText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeIso(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * @param {string | null | undefined} value
 * @param {number} deltaMs
 */
function addMs(value, deltaMs) {
  const normalized = normalizeIso(value);
  if (!normalized) {
    return normalizeIso(new Date().toISOString()) ?? new Date().toISOString();
  }
  return new Date(Date.parse(normalized) + deltaMs).toISOString();
}

/**
 * @param {any[]} touches
 * @param {(touch: any) => boolean} predicate
 */
function latestTouch(touches, predicate) {
  let selected = null;
  for (const touch of touches ?? []) {
    if (!predicate(touch)) {
      continue;
    }
    if (!selected || String(touch?.occurredAt ?? "") > String(selected?.occurredAt ?? "")) {
      selected = touch;
    }
  }
  return selected;
}

/**
 * @param {any[]} touches
 * @param {(touch: any) => boolean} predicate
 */
function latestTouchOccurredAt(touches, predicate) {
  return latestTouch(touches, predicate)?.occurredAt ?? null;
}
