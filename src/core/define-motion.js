// @ts-check

import crypto from "node:crypto";
import { targetingProfileSchema } from "../schema/targeting-profile.js";
import { suppressionPolicySchema } from "../schema/suppression-policy.js";
import { offerThesisSchema } from "../schema/offer-thesis.js";
import { motionSchema } from "../schema/motion.js";
import { fetchPageSnapshot } from "../lib/web.js";

/**
 * @param {{
 *   url: string,
 *   offerNotes: string | null,
 *   targetingProfile: unknown,
 *   suppressionPolicy: unknown
 * }} input
 */
export async function defineMotion(input) {
  const targetingProfile = targetingProfileSchema.parse(input.targetingProfile);
  const suppressionPolicy = suppressionPolicySchema.parse(input.suppressionPolicy);

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

  return motionSchema.parse({
    id: motionId,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    offer: {
      sourceUrl: input.url,
      offerNotes: input.offerNotes
    },
    targetingProfile,
    suppressionPolicy,
    offerThesis,
    signalSet: {
      status: "pending",
      items: []
    },
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
    nextSteps: buildNextSteps(targetingProfile, suppressionPolicy)
  });
}

/**
 * @param {string | null} title
 * @param {string | null} description
 * @returns {string}
 */
function buildSourceSummary(title, description) {
  const parts = [title, description].filter(Boolean);
  if (!parts.length) {
    return "Source page fetched, but no reliable title or description was available yet.";
  }

  return parts.join(" — ");
}

/**
 * @param {import("../schema/targeting-profile.js").targetingProfileSchema._type} targetingProfile
 * @param {import("../schema/suppression-policy.js").suppressionPolicySchema._type} suppressionPolicy
 * @returns {string[]}
 */
function buildNextSteps(targetingProfile, suppressionPolicy) {
  const steps = [
    "Generate offer thesis from the seeded source snapshot.",
    "Define the top externally verifiable custom signals for this offer.",
    "Use Sales Navigator retrieval against the targeting profile to build the target map.",
    "Resolve stakeholders by title and role family for each target account.",
    "Create segment-specific through-lines and first-move logic."
  ];

  if (suppressionPolicy.excludedAccounts.length || suppressionPolicy.excludedDomains.length || suppressionPolicy.doNotContactEntries.length) {
    steps.splice(2, 0, "Apply suppression policy before building the target map.");
  }

  if (targetingProfile.segmentVariants.length > 1) {
    steps.push("Create distinct motion branches for each declared segment variant.");
  }

  return steps;
}

