// @ts-check

import { motionSchema } from "../schema/motion.js";
import { rehydrateMotion } from "./rehydrate-motion.js";

const TRANSITIONS = {
  pause: {
    targetStatus: "paused",
    allowedFrom: ["draft", "active"]
  },
  resume: {
    targetStatus: "active",
    allowedFrom: ["paused"]
  },
  archive: {
    targetStatus: "archived",
    allowedFrom: ["draft", "active", "paused"]
  },
  restart: {
    targetStatus: "active",
    allowedFrom: ["draft", "paused", "archived"]
  }
};

/**
 * @param {unknown} rawMotion
 * @param {"pause" | "resume" | "archive" | "restart"} action
 */
export function transitionMotionStatus(rawMotion, action) {
  const transition = TRANSITIONS[action];
  if (!transition) {
    throw new Error(`Unsupported motion lifecycle action: ${action}`);
  }

  const { motion } = rehydrateMotion(rawMotion);

  if (motion.status === transition.targetStatus) {
    return {
      changed: false,
      motion
    };
  }

  if (!transition.allowedFrom.includes(motion.status)) {
    throw new Error(`Cannot ${action} a motion in ${motion.status} status.`);
  }

  return {
    changed: true,
    motion: motionSchema.parse({
      ...motion,
      status: transition.targetStatus,
      updatedAt: new Date().toISOString()
    })
  };
}
