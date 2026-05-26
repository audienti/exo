// @ts-check

import { motionSchema } from "../schema/motion.js";
import { offerThesisSchema } from "../schema/offer-thesis.js";
import { suppressionPolicySchema } from "../schema/suppression-policy.js";
import { targetingProfileSchema } from "../schema/targeting-profile.js";
import { rehydrateMotion } from "./rehydrate-motion.js";
import {
  buildAudienceHypotheses,
  buildMotionName,
  buildNextSteps,
  buildPremise,
  buildSignals
} from "./motion-support.js";

/**
 * @param {unknown} rawMotion
 * @param {{
 *   name?: string | null,
 *   offerNotes?: string | null,
 *   premise?: { statement?: string | null, notes?: string | null, source?: "operator" | "inferred" | "mixed" },
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
 *   targetingProfile?: Partial<import("../schema/targeting-profile.js").targetingProfileSchema._type>,
 *   suppressionPolicy?: Partial<import("../schema/suppression-policy.js").suppressionPolicySchema._type>
 * }} patch
 */
export function updateMotionDefinition(rawMotion, patch) {
  const { motion } = rehydrateMotion(rawMotion);
  const now = new Date().toISOString();

  const offerNotes = patch.offerNotes !== undefined
    ? normalizeNullableString(patch.offerNotes)
    : motion.offer.offerNotes;

  const premise = patch.premise
    ? buildPremise({
        statement: patch.premise.statement !== undefined ? patch.premise.statement : motion.premise.statement,
        notes: patch.premise.notes !== undefined ? patch.premise.notes : motion.premise.notes,
        source: patch.premise.source ?? motion.premise.source
      })
    : motion.premise;

  const audienceHypotheses = patch.audienceHypotheses
    ? buildAudienceHypotheses(patch.audienceHypotheses)
    : motion.audienceHypotheses;

  const signals = patch.signals
    ? buildSignals(patch.signals)
    : motion.signals;

  const targetingProfile = targetingProfileSchema.parse({
    ...motion.targetingProfile,
    ...(patch.targetingProfile ?? {})
  });

  const suppressionPolicy = suppressionPolicySchema.parse({
    ...motion.suppressionPolicy,
    ...(patch.suppressionPolicy ?? {})
  });

  const name = patch.name !== undefined
    ? buildMotionName({
        explicitName: patch.name,
        seed: motion.id
      })
    : motion.name;

  return motionSchema.parse({
    ...motion,
    name,
    updatedAt: now,
    offer: {
      ...motion.offer,
      offerNotes
    },
    premise,
    targetingProfile,
    suppressionPolicy,
    offerThesis: offerThesisSchema.parse({
      ...motion.offerThesis,
      offerNotes
    }),
    audienceHypotheses,
    signals,
    targetMap: {
      ...motion.targetMap,
      segments: targetingProfile.segmentVariants
    },
    nextSteps: buildNextSteps(
      targetingProfile,
      suppressionPolicy,
      premise,
      audienceHypotheses,
      signals
    )
  });
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
