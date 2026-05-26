// @ts-check

import { motionSchema } from "../schema/motion.js";
import { offerThesisSchema } from "../schema/offer-thesis.js";
import { suppressionPolicySchema } from "../schema/suppression-policy.js";
import { rehydrateTargetAccount } from "../schema/target-account.js";
import { targetingProfileSchema } from "../schema/targeting-profile.js";
import {
  buildAudienceHypotheses,
  buildMotionName,
  buildNextSteps,
  buildPremise,
  buildSignals,
  buildSourceSummary,
  shouldGenerateMotionName
} from "./motion-support.js";

/**
 * @param {unknown} rawMotion
 * @returns {{ motion: import("../schema/motion.js").motionSchema._type, repaired: boolean }}
 */
export function rehydrateMotion(rawMotion) {
  const source = normalizeRecord(rawMotion);
  const targetingProfile = targetingProfileSchema.parse(source.targetingProfile ?? {});
  const suppressionPolicy = suppressionPolicySchema.parse(source.suppressionPolicy ?? {});
  const premise = buildPremise(source.premise);
  const audienceHypotheses = buildAudienceHypotheses(source.audienceHypotheses ?? []);
  const signals = buildSignals(source.signals ?? source.signalSet?.items ?? []);
  const targetAccounts = buildTargetAccounts(source.targetMap?.accounts ?? []);
  const stakeholderSummaries = buildStakeholderSummaries(targetAccounts);
  const motionPlanVariants = buildMotionPlanVariants(targetAccounts);
  const readiness = summarizeTargetAccountReadiness(targetAccounts);
  const derivedStakeholderMap = targetAccounts.length > 0;
  const derivedMotionPlan = targetAccounts.length > 0;
  const offerSourceUrl = source.offer?.sourceUrl ?? source.offerThesis?.sourceUrl;
  const offerNotes = normalizeNullableString(source.offer?.offerNotes ?? source.offerThesis?.offerNotes);
  const offerThesis = offerThesisSchema.parse({
    sourceUrl: offerSourceUrl,
    sourceTitle: normalizeNullableString(source.offerThesis?.sourceTitle),
    sourceDescription: normalizeNullableString(source.offerThesis?.sourceDescription),
    sourceSummary:
      normalizeNullableString(source.offerThesis?.sourceSummary) ??
      buildSourceSummary(source.offerThesis?.sourceTitle ?? null, source.offerThesis?.sourceDescription ?? null),
    offerNotes,
    problemThesis: normalizeNullableString(source.offerThesis?.problemThesis),
    buyerImpactThesis: normalizeNullableString(source.offerThesis?.buyerImpactThesis),
    likelyTriggerThesis: normalizeNullableString(source.offerThesis?.likelyTriggerThesis),
    likelyRoleThesis: normalizeNullableString(source.offerThesis?.likelyRoleThesis),
    likelySegmentThesis: normalizeNullableString(source.offerThesis?.likelySegmentThesis),
    status: source.offerThesis?.status ?? "needs_inference"
  });

  const motion = motionSchema.parse({
    id: source.id,
    name: buildMotionName({
      explicitName: source.name,
      seed: source.id,
      forceGenerated: shouldGenerateMotionName(source.name)
    }),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    status: source.status ?? "draft",
    offer: {
      sourceUrl: offerSourceUrl,
      offerNotes
    },
    premise,
    targetingProfile,
    suppressionPolicy,
    offerThesis,
    audienceHypotheses,
    signals,
    targetMap: {
      status: source.targetMap?.status ?? "pending",
      accounts: targetAccounts,
      segments: source.targetMap?.segments ?? targetingProfile.segmentVariants
    },
    stakeholderMap: {
      status: derivedStakeholderMap
        ? (stakeholderSummaries.length ? "ready" : "pending")
        : (source.stakeholderMap?.status ?? "pending"),
      stakeholders: derivedStakeholderMap
        ? stakeholderSummaries
        : (source.stakeholderMap?.stakeholders ?? [])
    },
    motionPlan: {
      status: derivedMotionPlan
        ? (motionPlanVariants.length ? "ready" : "pending")
        : (source.motionPlan?.status ?? "pending"),
      variants: derivedMotionPlan
        ? motionPlanVariants
        : (source.motionPlan?.variants ?? [])
    },
    nextSteps: buildNextSteps(targetingProfile, suppressionPolicy, premise, audienceHypotheses, signals, readiness)
  });

  return {
    motion,
    repaired: JSON.stringify(source) !== JSON.stringify(motion)
  };
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Motion payload must be an object.");
  }

  return /** @type {Record<string, any>} */ (value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {unknown[]} rawAccounts
 */
function buildTargetAccounts(rawAccounts) {
  return rawAccounts.map((account) => rehydrateTargetAccount(account));
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type[]} targetAccounts
 */
function buildStakeholderSummaries(targetAccounts) {
  return targetAccounts.flatMap((account) =>
    account.prospects.map((prospect) => ({
      companyId: account.companyId,
      companyName: account.companyName,
      prospectId: prospect.id,
      name: prospect.name,
      title: prospect.title,
      buyingCommitteeRole: prospect.buyingCommitteeRole,
      decisionAuthority: prospect.decisionAuthority,
      fitConfidence: prospect.fitConfidence,
      throughLineStatus: prospect.throughLine.status,
      openingPlanStatus: prospect.openingPlan.status,
      cadenceStatus: prospect.cadenceState.status
    }))
  );
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type[]} targetAccounts
 */
function buildMotionPlanVariants(targetAccounts) {
  return targetAccounts.flatMap((account) =>
    account.prospects
      .filter((prospect) => prospect.openingPlan.status === "ready")
      .map((prospect) => ({
        companyId: account.companyId,
        companyName: account.companyName,
        prospectId: prospect.id,
        prospectName: prospect.name,
        title: prospect.title,
        primaryChannel: prospect.openingPlan.primaryChannel,
        fallbackChannel: prospect.openingPlan.fallbackChannel,
        nextAction: prospect.cadenceState.nextAction,
        replyPath: prospect.openingPlan.replyPath
      }))
  );
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type[]} targetAccounts
 */
function summarizeTargetAccountReadiness(targetAccounts) {
  const prospects = targetAccounts.flatMap((account) => account.prospects);

  return {
    accountCount: targetAccounts.length,
    hasSignalMatches: targetAccounts.some((account) => account.signalMatches.length > 0),
    prospectCount: prospects.length,
    readyThroughLineCount: prospects.filter((prospect) => prospect.throughLine.status === "ready").length,
    readyOpeningPlanCount: prospects.filter((prospect) => prospect.openingPlan.status === "ready").length,
    readyCadenceCount: prospects.filter((prospect) => prospect.cadenceState.status === "ready").length,
    missingEmailFallbackCount: prospects.filter(
      (prospect) =>
        prospect.openingPlan.status === "ready"
        && !prospect.email
        && (!prospect.openingPlan.fallbackChannel || prospect.openingPlan.fallbackChannel === "none")
    ).length
  };
}
