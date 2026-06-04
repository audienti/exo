// @ts-check
//
// Find or create the single catch-all "transition" motion that absorbs
// in-flight relationships migrated from prior tooling. Identified by a stable
// marker URL so we never create a second one.

import { defineMotion } from "./define-motion.js";
import { insertMotion, listMotions } from "../db/database.js";

export const TRANSITION_MOTION_MARKER_URL = "https://transition.exo.local/inbound-backlog";

/**
 * @param {{
 *   offer?: { sourceUrl?: string | null } | null,
 *   sourceUrl?: string | null,
 *   name?: string | null,
 * } | null | undefined} motion
 */
export function isTransitionMotion(motion) {
  if (!motion) {
    return false;
  }

  const sourceUrl = motion.offer?.sourceUrl ?? motion.sourceUrl ?? null;
  if (sourceUrl === TRANSITION_MOTION_MARKER_URL) {
    return true;
  }

  return /^transition-inbound-backlog$/i.test(String(motion.name ?? "").trim());
}

/**
 * @returns {Promise<import("../schema/motion.js").motionSchema._type>}
 */
export async function ensureTransitionMotion() {
  const existing = findTransitionMotion();
  if (existing) {
    return existing;
  }

  const motion = await defineMotion({
    url: TRANSITION_MOTION_MARKER_URL,
    name: "transition-inbound-backlog",
    offerNotes: "Transition motion: in-flight relationships migrated from prior tooling.",
    premise: {
      statement:
        "Continue and reconcile relationships started before Exo, then re-home them into real motions once they are understood.",
      source: "operator",
    },
    targetingProfile: {},
    suppressionPolicy: {},
  });
  return insertMotion(motion);
}

/**
 * @returns {import("../schema/motion.js").motionSchema._type | null}
 */
export function findTransitionMotion() {
  const motions = listMotions();
  return (
    motions.find((motion) => isTransitionMotion(motion)) ??
    null
  );
}
