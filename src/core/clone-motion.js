// @ts-check

import crypto from "node:crypto";
import { motionSchema } from "../schema/motion.js";
import { rehydrateMotion } from "./rehydrate-motion.js";
import { buildMotionName } from "./motion-support.js";
import { updateMotionDefinition } from "./update-motion.js";

/**
 * @param {unknown} rawMotion
 * @param {Parameters<typeof updateMotionDefinition>[1]} patch
 */
export function cloneMotionDefinition(rawMotion, patch) {
  const { motion } = rehydrateMotion(rawMotion);
  const now = new Date().toISOString();
  const clonedId = crypto.randomUUID();

  const baseClone = motionSchema.parse({
    ...motion,
    id: clonedId,
    name: buildMotionName({
      explicitName: patch.name,
      seed: clonedId
    }),
    createdAt: now,
    updatedAt: now,
    status: "draft",
    targetMap: {
      status: "pending",
      accounts: [],
      segments: motion.targetingProfile.segmentVariants
    },
    stakeholderMap: {
      status: "pending",
      stakeholders: []
    },
    motionPlan: {
      status: "pending",
      variants: []
    },
    engagementProfileAssignment: null,
    engagementUserAssignment: null
  });

  return updateMotionDefinition(baseClone, {
    ...patch,
    name: patch.name
  });
}
