// @ts-check

import { cloneMotionDefinition } from "./clone-motion.js";
import { defineMotion } from "./define-motion.js";
import { buildSourceSummary } from "./motion-support.js";
import { motionSchema } from "../schema/motion.js";
import { fetchPageSnapshot } from "../lib/web.js";

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
 *   suppressionPolicy: unknown,
 *   existingStrategy?: "continue" | "clone" | "new" | null | undefined,
 *   sourceMotionId?: string | null | undefined
 * }} input
 * @param {unknown[]} storedMotions
 */
export async function startMotion(input, storedMotions) {
  const existingMotions = storedMotions
    .map((motion) => motionSchema.parse(motion))
    .filter((motion) => motion.offer.sourceUrl === input.url);
  const offerSnapshot = await fetchPageSnapshot(input.url);
  const offerPreview = {
    sourceUrl: input.url,
    sourceTitle: offerSnapshot.title,
    sourceDescription: offerSnapshot.description,
    sourceSummary: buildSourceSummary(offerSnapshot.title, offerSnapshot.description)
  };

  if (existingMotions.length && !input.existingStrategy) {
    return {
      status: "decision-required",
      offerPreview,
      existingMotions: existingMotions.map(buildExistingMotionPreview),
      options: ["continue", "clone", "new"]
    };
  }

  if (input.existingStrategy === "continue") {
    const selected = resolveExistingMotion(existingMotions, input.sourceMotionId ?? null, "continue");
    return {
      status: "continued",
      offerPreview,
      motion: selected,
      existingMotions: existingMotions.map(buildExistingMotionPreview)
    };
  }

  if (input.existingStrategy === "clone") {
    const selected = resolveExistingMotion(existingMotions, input.sourceMotionId ?? null, "clone");
    const patch = buildClonePatch(input);
    const motion = cloneMotionDefinition(selected, patch);
    return {
      status: "cloned",
      offerPreview,
      motion,
      existingMotions: existingMotions.map(buildExistingMotionPreview)
    };
  }

  const motion = await defineMotion({
    url: input.url,
    name: input.name ?? null,
    offerNotes: input.offerNotes,
    premise: input.premise ?? null,
    audienceHypotheses: input.audienceHypotheses ?? [],
    signals: input.signals ?? [],
    targetingProfile: input.targetingProfile,
    suppressionPolicy: input.suppressionPolicy
  });

  return {
    status: "created",
    offerPreview,
    motion,
    existingMotions: existingMotions.map(buildExistingMotionPreview)
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type[]} existingMotions
 * @param {string | null} sourceMotionId
 * @param {"continue" | "clone"} strategy
 */
function resolveExistingMotion(existingMotions, sourceMotionId, strategy) {
  if (!existingMotions.length) {
    throw new Error(`No existing motions found to ${strategy} for this URL.`);
  }

  if (sourceMotionId) {
    const selected = existingMotions.find((motion) => motion.id === sourceMotionId);
    if (!selected) {
      throw new Error(`Motion ${sourceMotionId} is not an existing motion for this URL.`);
    }

    return selected;
  }

  if (existingMotions.length > 1) {
    throw new Error(`Multiple motions already use this URL. Pass --from <motion-id> to ${strategy} one explicitly.`);
  }

  return existingMotions[0];
}

/**
 * @param {Parameters<typeof startMotion>[0]} input
 */
function buildClonePatch(input) {
  /** @type {Parameters<typeof cloneMotionDefinition>[1]} */
  const patch = {};

  if (input.name !== undefined) {
    patch.name = input.name;
  }

  if (input.offerNotes !== undefined) {
    patch.offerNotes = input.offerNotes;
  }

  if (input.premise !== undefined) {
    patch.premise = input.premise;
  }

  if (input.audienceHypotheses !== undefined) {
    patch.audienceHypotheses = input.audienceHypotheses;
  }

  if (input.signals !== undefined) {
    patch.signals = input.signals;
  }

  if (input.targetingProfile !== undefined) {
    patch.targetingProfile = input.targetingProfile;
  }

  if (input.suppressionPolicy !== undefined) {
    patch.suppressionPolicy = input.suppressionPolicy;
  }

  return patch;
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 */
function buildExistingMotionPreview(motion) {
  return {
    id: motion.id,
    name: motion.name,
    status: motion.status,
    premiseStatus: motion.premise.status,
    audienceCount: motion.audienceHypotheses.length,
    signalCount: motion.signals.length,
    companyCount: motion.targetMap.accounts.length,
    prospectCount: motion.targetMap.accounts.reduce((sum, account) => sum + account.prospects.length, 0)
  };
}
