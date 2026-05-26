// @ts-check

import { motionSchema } from "../schema/motion.js";
import { offerThesisSchema } from "../schema/offer-thesis.js";
import { fetchPageSnapshot } from "../lib/web.js";
import { rehydrateMotion } from "./rehydrate-motion.js";
import { buildNextSteps, buildSourceSummary } from "./motion-support.js";

/**
 * @param {unknown} rawMotion
 */
export async function refreshMotion(rawMotion) {
  const { motion } = rehydrateMotion(rawMotion);
  const pageSnapshot = await fetchPageSnapshot(motion.offer.sourceUrl);
  const now = new Date().toISOString();

  const offerThesis = offerThesisSchema.parse({
    ...motion.offerThesis,
    sourceTitle: pageSnapshot.title,
    sourceDescription: pageSnapshot.description,
    sourceSummary: buildSourceSummary(pageSnapshot.title, pageSnapshot.description)
  });

  return motionSchema.parse({
    ...motion,
    updatedAt: now,
    offerThesis,
    nextSteps: buildNextSteps(
      motion.targetingProfile,
      motion.suppressionPolicy,
      motion.premise,
      motion.audienceHypotheses,
      motion.signals
    )
  });
}
