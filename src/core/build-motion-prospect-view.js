// @ts-check

import { motionSchema } from "../schema/motion.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { withDerivedTargetAccountQueueState } from "../lib/motion-queue.js";
import { hasUsableEmailFallback, selectBestEmailContactPoint } from "../lib/prospect-contacts.js";
import {
  listStoredLinkedinPublicActivity,
  selectLinkedinPublicEngagementTarget,
} from "./select-linkedin-public-engagement.js";

const RECENT_POST_READY_BANDS = new Set(["0-14-days", "15-30-days", "31-60-days"]);
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
  "connection_request_not_accepted",
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
  const capturedPublicActivity = listStoredLinkedinPublicActivity(prospect);
  const publicEngagementSelection = selectLinkedinPublicEngagementTarget(prospect);
  const recentPost = buildRecentPostReadiness(prospect, {
    capturedPublicActivity,
    publicEngagementSelection,
  });
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
    capturedPublicActivity,
    publicEngagementSelection,
    contactPoints: prospect.contactPoints,
    contactEnrichmentState: prospect.contactEnrichmentState,
    queueStatus: prospect.queueState.status,
    accountDisposition: account.disposition,
    disposition: prospect.disposition,
    packetStatus: prospect.packetStatus,
    packetState: prospect.packetState,
    notes: prospect.notes,
    recentPost,
    signalMatches,
    signalMatchCount: signalMatches.length,
    latestSignalSummary: latestSignalMatch?.summary ?? null,
    threadMessages: conversationContext.threadMessages,
    latestInboundMessage: conversationContext.latestInboundMessage,
    replySubject: conversationContext.replySubject,
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
 * @param {{
 *   capturedPublicActivity?: ReturnType<typeof listStoredLinkedinPublicActivity>,
 *   publicEngagementSelection?: ReturnType<typeof selectLinkedinPublicEngagementTarget> | null,
 * }} [options]
 */
function buildRecentPostReadiness(prospect, options = {}) {
  const capturedPublicActivity = options.capturedPublicActivity ?? listStoredLinkedinPublicActivity(prospect);
  const selection = options.publicEngagementSelection ?? selectLinkedinPublicEngagementTarget(prospect);
  const hasLegacySignal = Boolean(prospect.liveSignal.summary || prospect.liveSignal.url);

  if (!capturedPublicActivity.length && !hasLegacySignal) {
    return {
      available: false,
      engageable: false,
      reason: "No stored eligible public LinkedIn activity exists for this prospect.",
      selectedTarget: null,
    };
  }

  if (!selection) {
    return {
      available: true,
      engageable: false,
      reason: "Stored activity exists, but none of it currently survives the governed public-engagement rules.",
      selectedTarget: null,
    };
  }

  const freshEnough = selection.freshnessBand
    ? RECENT_POST_READY_BANDS.has(selection.freshnessBand)
    : false;
  if (selection.recommendedAction === "reaction" && !freshEnough && !capturedPublicActivity.length) {
    return {
      available: true,
      engageable: false,
      reason: "Stored activity exists, but it is too old or underspecified to support a governed warmup.",
      selectedTarget: selection,
    };
  }

  return {
    available: true,
    engageable: true,
    reason: selection.recommendedAction === "comment"
      ? "A stored LinkedIn activity target is strong enough to support a checked public comment path."
      : "A stored LinkedIn activity target exists for a lightweight governed reaction.",
    selectedTarget: selection,
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
      replySubject: latestReplySubject(related),
      timelineObservations,
    };
  }

  const replySubject = normalizeNullableString(latestThreadObservation.subject)
    ?? parseObservationNotes(latestThreadObservation.notes).subject;

  const threadMessages = (latestThreadObservation.messages ?? [])
    .filter(hasMessageBody)
    .slice()
    .sort((left, right) => (Date.parse(left.sentAt ?? "") || 0) - (Date.parse(right.sentAt ?? "") || 0))
    .map((message) => ({
      id: message.id ?? null,
      direction: message.direction ?? "unknown",
      sentAt: message.sentAt ?? null,
      fromName: normalizeNullableString(message.fromName) ?? null,
      fromHandle: normalizeNullableString(message.fromHandle) ?? null,
      subject: replySubject,
      body: message.body.trim(),
    }));

  return {
    threadMessages,
    latestInboundMessage: threadMessages.findLast((message) => message.direction === "inbound") ?? threadMessages.at(-1) ?? null,
    replySubject,
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
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} observations
 */
function latestReplySubject(observations) {
  const latest = observations
    .slice()
    .sort(compareObservedDescending)
    .find((observation) => normalizeNullableString(observation.subject) ?? parseObservationNotes(observation.notes).subject);
  if (!latest) {
    return null;
  }
  return normalizeNullableString(latest.subject) ?? parseObservationNotes(latest.notes).subject;
}

/**
 * @param {string | null | undefined} notes
 * @returns {{ subject: string | null, body: string | null }}
 */
function parseObservationNotes(notes) {
  const normalized = normalizeNullableString(notes);
  if (!normalized) {
    return { subject: null, body: null };
  }

  const subjectMatch = normalized.match(/^Subject:\s*(.+?)(?:\r?\n|$)/i);
  const subject = normalizeNullableString(subjectMatch?.[1] ?? null);
  const body = subjectMatch
    ? normalizeNullableString(normalized.slice(subjectMatch[0].length))
    : normalized;

  return { subject, body };
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
