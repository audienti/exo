// @ts-check

import { z } from "zod";
import { motionCoreSchema } from "./motion.js";
import { browserProfileSchema } from "./browser-profile.js";
import { companySchema } from "./company.js";
import { userSchema } from "./user.js";

export const configMotionSchema = z
  .preprocess(stripMotionExecutionState, motionCoreSchema)
  .transform((motion) => ({
    ...motion,
    stakeholderMap: emptyStakeholderMap(),
    motionPlan: emptyMotionPlan(),
    nextSteps: []
  }));

export const configBundleSchema = z.object({
  kind: z.literal("exo-config"),
  schemaVersion: z.literal("1"),
  exportedAt: z.string().datetime(),
  exoVersion: z.string().min(1),
  motions: z.array(configMotionSchema).default([]),
  browserProfiles: z.array(browserProfileSchema).default([]),
  companies: z.array(companySchema).default([]),
  users: z.array(userSchema).default([])
});

/**
 * @param {unknown} value
 */
function stripMotionExecutionState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return {
    ...value,
    targetMap: undefined,
    stakeholderMap: emptyStakeholderMap(),
    motionPlan: emptyMotionPlan(),
    nextSteps: []
  };
}

function emptyStakeholderMap() {
  return {
    status: "pending",
    stakeholders: []
  };
}

function emptyMotionPlan() {
  return {
    status: "pending",
    variants: []
  };
}
