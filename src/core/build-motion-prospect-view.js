// @ts-check

import { motionSchema } from "../schema/motion.js";
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

/**
 * @param {unknown} rawMotion
 * @param {{
 *   companyId?: string | null,
 *   prospectId?: string | null
 * }} [options]
 */
export function buildMotionProspectView(rawMotion, options = {}) {
  const motion = motionSchema.parse(rawMotion);
  const companyAccounts = motion.targetMap.accounts
    .map((account) => withDerivedTargetAccountQueueState(account))
    .filter((account) => !options.companyId || account.companyId === options.companyId);

  if (options.companyId && companyAccounts.length === 0) {
    throw new Error(`Company ${options.companyId} is not targeted in motion ${motion.id}.`);
  }

  const prospectViews = companyAccounts
    .flatMap((account) => account.prospects.map((prospect) => buildProspectView(account, prospect)))
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
            linkedinCompanyUrl: selectedProspect.linkedinCompanyUrl
          },
          prospect: selectedProspect,
          signalMatches: selectedProspect.signalMatches,
          throughLine: selectedProspect.throughLine,
          openingPlan: selectedProspect.openingPlan,
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
 */
function buildProspectView(account, prospect) {
  const signalMatches = account.signalMatches.filter((match) =>
    prospect.signalMatchIds.includes(match.id)
    || prospect.throughLine.signalMatchIds.includes(match.id)
    || prospect.openingPlan.signalMatchIds.includes(match.id)
  );
  const recentPost = buildRecentPostReadiness(prospect);
  const messageTestReady = prospect.throughLine.status === "ready"
    && prospect.openingPlan.status === "ready"
    && prospect.cadenceState.status === "ready";

  return {
    companyId: account.companyId,
    companyName: account.companyName,
    websiteUrl: account.websiteUrl,
    linkedinCompanyUrl: account.linkedinCompanyUrl,
    prospectId: prospect.id,
    name: prospect.name,
    title: prospect.title,
    buyingCommitteeRole: prospect.buyingCommitteeRole,
    decisionAuthority: prospect.decisionAuthority,
    fitConfidence: prospect.fitConfidence,
    whyRelevant: prospect.whyRelevant,
    linkedinProfileUrl: prospect.linkedinProfileUrl,
    email: prospect.email,
    hasEmailFallback: hasUsableEmailFallback(prospect),
    bestEmailContactPoint: selectBestEmailContactPoint(prospect),
    profileViewedAt: prospect.profileViewedAt,
    roleTruth: prospect.roleTruth,
    triggerWindow: prospect.triggerWindow,
    identityTells: prospect.identityTells,
    liveSignal: prospect.liveSignal,
    contactPoints: prospect.contactPoints,
    contactEnrichmentState: prospect.contactEnrichmentState,
    queueStatus: prospect.queueState.status,
    notes: prospect.notes,
    recentPost,
    signalMatches,
    signalMatchCount: signalMatches.length,
    touches: prospect.touches,
    throughLineStatus: prospect.throughLine.status,
    openingPlanStatus: prospect.openingPlan.status,
    cadenceStatus: prospect.cadenceState.status,
    messageTestReady,
    throughLine: prospect.throughLine,
    openingPlan: prospect.openingPlan,
    cadenceState: prospect.cadenceState,
    primaryChannel: prospect.openingPlan.primaryChannel,
    fallbackChannel: prospect.openingPlan.fallbackChannel,
    replyPath: prospect.openingPlan.replyPath,
    compressionLine: prospect.throughLine.compressionLine,
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
