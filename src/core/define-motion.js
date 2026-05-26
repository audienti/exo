// @ts-check

import crypto from "node:crypto";
import { targetingProfileSchema } from "../schema/targeting-profile.js";
import { suppressionPolicySchema } from "../schema/suppression-policy.js";
import { offerThesisSchema } from "../schema/offer-thesis.js";
import { motionSchema } from "../schema/motion.js";
import { fetchPageSnapshot } from "../lib/web.js";
import {
  buildAudienceHypotheses,
  buildMotionName,
  buildNextSteps,
  buildPremise,
  buildSignals,
  buildSourceSummary
} from "./motion-support.js";

/**
 * @param {{
 *   url: string,
 *   name?: string | null,
 *   offerNotes: string | null,
 *   premise?: { statement?: string | null, notes?: string | null, source?: "operator" | "inferred" | "mixed" } | null,
 *   audienceHypotheses?: Array<string | {
 *     id?: string,
 *     name: string,
 *     companyCriteria?: string[],
 *     roleCriteria?: string[],
 *     notes?: string | null,
 *     confidence?: "low" | "moderate" | "high" | "unknown"
 *   }>,
 *   signals?: Array<string | {
 *     id?: string,
 *     name?: string,
 *     question: string,
 *     scope?: "company" | "person" | "both",
 *     whyItMatters?: string | null,
 *     matchRule?: string | null,
 *     audienceIds?: string[],
 *     observationMethods?: Array<{
 *       surface: "google" | "sales-navigator" | "linkedin" | "company-site" | "news" | "manual" | "other",
 *       query?: string | null,
 *       notes?: string | null
 *     }>,
 *     status?: "draft" | "ready"
 *   }>,
 *   targetingProfile: unknown,
 *   suppressionPolicy: unknown
 * }} input
 */
export async function defineMotion(input) {
  const targetingProfile = targetingProfileSchema.parse(input.targetingProfile);
  const suppressionPolicy = suppressionPolicySchema.parse(input.suppressionPolicy);
  const premise = buildPremise(input.premise);
  const audienceHypotheses = buildAudienceHypotheses(input.audienceHypotheses ?? []);
  const signals = buildSignals(input.signals ?? []);

  const pageSnapshot = await fetchPageSnapshot(input.url);
  const now = new Date().toISOString();
  const motionId = crypto.randomUUID();

  const offerThesis = offerThesisSchema.parse({
    sourceUrl: input.url,
    sourceTitle: pageSnapshot.title,
    sourceDescription: pageSnapshot.description,
    sourceSummary: buildSourceSummary(pageSnapshot.title, pageSnapshot.description),
    offerNotes: input.offerNotes,
    problemThesis: null,
    buyerImpactThesis: null,
    likelyTriggerThesis: null,
    likelyRoleThesis: null,
    likelySegmentThesis: null,
    status: "needs_inference"
  });
  const motionName = buildMotionName({
    explicitName: input.name ?? null,
    seed: motionId
  });

  return motionSchema.parse({
    id: motionId,
    name: motionName,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    offer: {
      sourceUrl: input.url,
      offerNotes: input.offerNotes
    },
    premise,
    targetingProfile,
    suppressionPolicy,
    offerThesis,
    audienceHypotheses,
    signals,
    targetMap: {
      status: "pending",
      accounts: [],
      segments: targetingProfile.segmentVariants
    },
    stakeholderMap: {
      status: "pending",
      stakeholders: []
    },
    motionPlan: {
      status: "pending",
      variants: []
    },
    nextSteps: buildNextSteps(targetingProfile, suppressionPolicy, premise, audienceHypotheses, signals)
  });
}
