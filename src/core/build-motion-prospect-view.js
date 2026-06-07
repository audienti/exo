// @ts-check

import { motionSchema } from "../schema/motion.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { withDerivedTargetAccountQueueState } from "../lib/motion-queue.js";
import { hasUsableEmailFallback, selectBestEmailContactPoint } from "../lib/prospect-contacts.js";

const RECENT_POST_READY_BANDS = new Set(["0-14-days", "15-30-days", "31-60-days"]);
const ENGAGEABLE_ACTIVITY_TYPES = new Set([
  "own-post",
  "reshare",
  "reshare-with-comment",
  "comment",
  "interview-share"
]);
const THREAD_MESSAGE_LIMIT = 8;
const PROSPECT_TIMELINE_OBSERVATION_KINDS = new Set([
  "email_reply_received",
  "email_thread_updated",
  "inbound_reply_received",
  "message_received",
  "thread_updated",
  "public_reply_received",
  "comment_thread_updated",
  "connection_request_pending",
  "connection_request_received",
  "connection_request_accepted",
  "connection_request_declined",
  "connection_request_withdraw_requested",
  "connection_request_withdrawn",
  "connection_request_no_longer_pending",
  "connection_request_received_no_longer_pending",
  "follower_added",
  "follower_confirmed",
]);

/**
 * @param {unknown} rawMotion
 * @param {{
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   rawObservations?: unknown[] | null
 * }} [options]
 */
export function buildMotionProspectView(rawMotion, options = {}) {
  const motion = motionSchema.parse(rawMotion);
  const rawObservations = Array.isArray(options.rawObservations) ? options.rawObservations : [];
  const observations = rawObservations.map((item) => inboundObservationSchema.parse(item));
  const companyAccounts = motion.targetMap.accounts
    .map((account) => withDerivedTargetAccountQueueState(account))
    .filter((account) => !options.companyId || account.companyId === options.companyId);

  if (options.companyId && companyAccounts.length === 0) {
    throw new Error(`Company ${options.companyId} is not targeted in motion ${motion.id}.`);
  }

  const prospectViews = companyAccounts
    .flatMap((account) => account.prospects.map((prospect) => buildProspectView(account, prospect, observations)))
    .sort(compareProspectViews);

  const selectedProspect = options.prospectId
    ? prospectViews.find((prospect) => prospect.prospectId === options.prospectId) ?? null
    : null;

  if (options.prospectId && !selectedProspect) {
    throw new Error(`Prospect ${options.prospectId} is not targeted in motion ${motion.id}.`);
  }

  return {
    motion: {
      id: motion.id,
      name: motion.name,
      status: motion.status,
      sourceUrl: motion.offer.sourceUrl,
      createdAt: motion.createdAt,
      updatedAt: motion.updatedAt
    },
    counts: {
      companyCount: companyAccounts.length,
      prospectCount: prospectViews.length,
      messageTestReadyCount: prospectViews.filter((prospect) => prospect.messageTestReady).length,
      recentPostReadyCount: prospectViews.filter((prospect) => prospect.recentPost.engageable).length,
      emailFallbackCount: prospectViews.filter((prospect) => prospect.hasEmailFallback).length,
      queueStatusCounts: buildStatusCounts(prospectViews.map((prospect) => prospect.queueStatus))
    },
    prospects: prospectViews,
    prospect: selectedProspect,
    writingBrief: selectedProspect
      ? {
          company: {
            id: selectedProspect.companyId,
            name: selectedProspect.companyName,
            websiteUrl: selectedProspect.websiteUrl,
            linkedinCompanyUrl: selectedProspect.linkedinCompanyUrl,
            logoSourceUrl: selectedProspect.companyLogoSourceUrl,
            logoUrl: selectedProspect.companyLogoUrl
          },
          prospect: selectedProspect,
          signalMatches: selectedProspect.signalMatches,
          cadenceState: selectedProspect.cadenceState,
          touches: selectedProspect.touches,
          messageTestReady: selectedProspect.messageTestReady,
          recentPost: selectedProspect.recentPost
        }
      : null
  };
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} observations
 */
function buildProspectView(account, prospect, observations) {
  const signalMatches = account.signalMatches.filter((match) => prospect.signalMatchIds.includes(match.id));
  const recentPost = buildRecentPostReadiness(prospect);
  const messageTestReady = prospect.cadenceState.status === "ready";
  const latestSignalMatch = signalMatches[0] ?? null;
  const conversationContext = buildProspectConversationContext(account, prospect, observations);

  return {
    companyId: account.companyId,
    companyName: account.companyName,
    websiteUrl: account.websiteUrl,
    linkedinCompanyUrl: account.linkedinCompanyUrl,
    companyLogoSourceUrl: account.companyLogoSourceUrl,
    companyLogoUrl: account.companyLogoUrl,
    prospectId: prospect.id,
    name: prospect.name,
    title: prospect.title,
    buyingCommitteeRole: prospect.buyingCommitteeRole,
    decisionAuthority: prospect.decisionAuthority,
    fitConfidence: prospect.fitConfidence,
    whyRelevant: prospect.whyRelevant,
    linkedinProfileUrl: prospect.linkedinProfileUrl,
    avatarSourceUrl: prospect.avatarSourceUrl,
    avatarUrl: prospect.avatarUrl,
    email: prospect.email,
    hasEmailFallback: hasUsableEmailFallback(prospect),
    bestEmailContactPoint: selectBestEmailContactPoint(prospect),
    profileViewedAt: prospect.profileViewedAt,
    roleTruth: prospect.roleTruth,
    triggerWindow: prospect.triggerWindow,
    identityTells: prospect.identityTells,
    linkedinProfileSnapshot: prospect.linkedinProfileSnapshot,
    liveSignal: prospect.liveSignal,
    contactPoints: prospect.contactPoints,
    contactEnrichmentState: prospect.contactEnrichmentState,
    queueStatus: prospect.queueState.status,
    notes: prospect.notes,
    recentPost,
    signalMatches,
    signalMatchCount: signalMatches.length,
    latestSignalSummary: latestSignalMatch?.summary ?? null,
    threadMessages: conversationContext.threadMessages,
    latestInboundMessage: conversationContext.latestInboundMessage,
    timelineObservations: conversationContext.timelineObservations,
    touches: prospect.touches,
    cadenceStatus: prospect.cadenceState.status,
    messageTestReady,
    cadenceState: prospect.cadenceState,
    nextAction: prospect.cadenceState.nextAction
  };
}

/**
 * @param {Array<string>} statuses
 */
function buildStatusCounts(statuses) {
  return statuses.reduce((counts, status) => {
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, /** @type {Record<string, number>} */ ({}));
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function buildRecentPostReadiness(prospect) {
  const hasEvidence = Boolean(prospect.liveSignal.summary || prospect.liveSignal.url);
  const freshEnough = prospect.liveSignal.freshnessBand
    ? RECENT_POST_READY_BANDS.has(prospect.liveSignal.freshnessBand)
    : false;
  const linkedinLike = prospect.liveSignal.channel === "linkedin";
  const engageableActivityType = prospect.liveSignal.activityType
    ? ENGAGEABLE_ACTIVITY_TYPES.has(prospect.liveSignal.activityType)
    : false;

  if (!hasEvidence) {
    return {
      available: false,
      engageable: false,
      reason: "No stored recent public activity exists for this prospect."
    };
  }

  if (!linkedinLike) {
    return {
      available: true,
      engageable: false,
      reason: "Stored activity exists, but it is not a LinkedIn-style warmup surface."
    };
  }

  if (!freshEnough) {
    return {
      available: true,
      engageable: false,
      reason: "Stored activity exists, but it is too old or not freshness-scored enough to use as a live warmup."
    };
  }

  if (!engageableActivityType) {
    return {
      available: true,
      engageable: false,
      reason: "Stored activity supports channel viability, but not a clean recent-post engagement move."
    };
  }

  return {
    available: true,
    engageable: true,
    reason: "A recent LinkedIn activity signal exists and is fresh enough to support legitimate warmup."
  };
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} observations
 */
function buildProspectConversationContext(account, prospect, observations) {
  const related = observations.filter((observation) => matchesProspectObservation(account, prospect, observation));
  const latestThreadObservation = related
    .filter((observation) => Array.isArray(observation.messages) && observation.messages.some(hasMessageBody))
    .sort(compareObservedDescending)[0] ?? null;

  const timelineObservations = related
    .filter((observation) =>
      PROSPECT_TIMELINE_OBSERVATION_KINDS.has(observation.kind)
      && !(Array.isArray(observation.messages) && observation.messages.some(hasMessageBody)),
    )
    .map((observation) => ({
      id: observation.id,
      kind: observation.kind,
      surfaceKey: observation.surfaceKey,
      observedAt: observation.observedAt,
      eventAt: observation.eventAt ?? null,
      summary: observation.summary,
      sourceUrl: observation.sourceUrl ?? null,
      threadUrl: observation.threadUrl ?? null,
      notes: observation.notes ?? null,
    }));

  if (!latestThreadObservation) {
    return {
      threadMessages: [],
      latestInboundMessage: null,
      timelineObservations,
    };
  }

  const threadMessages = (latestThreadObservation.messages ?? [])
    .filter(hasMessageBody)
    .slice()
    .sort((left, right) => (Date.parse(left.sentAt ?? "") || 0) - (Date.parse(right.sentAt ?? "") || 0))
    .slice(-THREAD_MESSAGE_LIMIT)
    .map((message) => ({
      id: message.id ?? null,
      direction: message.direction ?? "unknown",
      sentAt: message.sentAt ?? null,
      fromName: normalizeNullableString(message.fromName) ?? null,
      fromHandle: normalizeNullableString(message.fromHandle) ?? null,
      body: message.body.trim(),
    }));

  return {
    threadMessages,
    latestInboundMessage: threadMessages.findLast((message) => message.direction === "inbound") ?? threadMessages.at(-1) ?? null,
    timelineObservations,
  };
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
function matchesProspectObservation(account, prospect, observation) {
  if (observation.prospectId && observation.prospectId === prospect.id) {
    return true;
  }

  const prospectProfileUrl = normalizeNullableString(prospect.linkedinProfileUrl)?.toLowerCase() ?? null;
  const observationProfileUrl = normalizeNullableString(observation.actorProfileUrl)?.toLowerCase() ?? null;
  if (
    observation.companyId === account.companyId
    && prospectProfileUrl
    && observationProfileUrl
    && prospectProfileUrl === observationProfileUrl
  ) {
    return true;
  }

  const prospectSourceUrl = normalizeNullableString(prospect.sourceUrl);
  return Boolean(
    observation.companyId === account.companyId
    && prospectSourceUrl
    && (
      normalizeNullableString(observation.threadUrl) === prospectSourceUrl
      || normalizeNullableString(observation.sourceUrl) === prospectSourceUrl
    )
  );
}

/**
 * @param {{ body?: string | null | undefined }} message
 */
function hasMessageBody(message) {
  return typeof message?.body === "string" && message.body.trim().length > 0;
}

/**
 * @param {{ observedAt: string, recordedAt: string }} left
 * @param {{ observedAt: string, recordedAt: string }} right
 */
function compareObservedDescending(left, right) {
  return right.observedAt.localeCompare(left.observedAt) || right.recordedAt.localeCompare(left.recordedAt);
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {ReturnType<typeof buildProspectView>} left
 * @param {ReturnType<typeof buildProspectView>} right
 */
function compareProspectViews(left, right) {
  if (left.messageTestReady !== right.messageTestReady) {
    return left.messageTestReady ? -1 : 1;
  }

  if (left.recentPost.engageable !== right.recentPost.engageable) {
    return left.recentPost.engageable ? -1 : 1;
  }

  if (left.companyName !== right.companyName) {
    return left.companyName.localeCompare(right.companyName);
  }

  return left.name.localeCompare(right.name);
}
