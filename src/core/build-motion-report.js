// @ts-check

import { motionSchema } from "../schema/motion.js";
import { evaluateMotionTargeting } from "./evaluate-motion-targeting.js";
import { buildMotionProspectView } from "./build-motion-prospect-view.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 * @param {unknown[]} rawProfiles
 * @param {unknown[]} rawUsers
 * @param {{
 *   capability?: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type
 * }} [options]
 */
export function buildMotionReport(rawMotion, rawCompanies, rawProfiles, rawUsers, options = {}) {
  const motion = motionSchema.parse(rawMotion);
  const targeting = evaluateMotionTargeting(rawMotion, rawCompanies, rawProfiles, rawUsers, options);
  const prospects = buildMotionProspectView(rawMotion);

  return {
    motion: {
      id: motion.id,
      name: motion.name,
      status: motion.status,
      sourceUrl: motion.offer.sourceUrl,
      createdAt: motion.createdAt,
      updatedAt: motion.updatedAt,
      premise: {
        status: motion.premise.status,
        statement: motion.premise.statement,
        notes: motion.premise.notes
      },
      setup: {
        audienceHypotheses: motion.audienceHypotheses.map((audience) => ({
          id: audience.id,
          name: audience.name,
          confidence: audience.confidence
        })),
        signals: motion.signals.map((signal) => ({
          id: signal.id,
          name: signal.name,
          scope: signal.scope,
          status: signal.status
        })),
        targetingProfile: {
          stakeholderTargetCount: motion.targetingProfile.stakeholderTargetCount,
          targetTitles: motion.targetingProfile.targetTitles,
          roleFamilies: motion.targetingProfile.roleFamilies,
          industries: motion.targetingProfile.industries,
          geolocations: motion.targetingProfile.geolocations,
          segmentVariants: motion.targetingProfile.segmentVariants
        },
        suppression: {
          excludedAccountsCount: motion.suppressionPolicy.excludedAccounts.length,
          excludedDomainsCount: motion.suppressionPolicy.excludedDomains.length,
          excludedContactsCount: motion.suppressionPolicy.excludedContacts.length,
          doNotContactEntryCount: motion.suppressionPolicy.doNotContactEntries.length
        }
      }
    },
    targeting,
    prospects
  };
}
