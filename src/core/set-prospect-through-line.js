// @ts-check

import { prospectSchema, targetAccountSchema, throughLineSchema } from "../schema/target-account.js";
import {
  finalizeTargetAccountUpdate,
  normalizeNullableString,
  normalizeStringArray,
  prepareTargetAccountContext
} from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   prospectId: string,
 *   signalMatchIds?: string[],
 *   specificToThem: string,
 *   sharedProblem: string,
 *   whyNow: string,
 *   legitimateWedge: string,
 *   compressionLine: string
 * }} input
 */
export function setMotionProspectThroughLine(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const signalMatchIds = normalizeStringArray(input.signalMatchIds);
  const knownSignalIds = new Set(baseAccount.signalMatches.map((match) => match.id));
  const prospectIndex = baseAccount.prospects.findIndex((prospect) => prospect.id === input.prospectId);

  if (prospectIndex === -1) {
    throw new Error(`Prospect not found on ${company.name}: ${input.prospectId}`);
  }

  for (const signalMatchId of signalMatchIds) {
    if (!knownSignalIds.has(signalMatchId)) {
      throw new Error(`Signal match not found on ${company.name}: ${signalMatchId}`);
    }
  }

  const prospects = baseAccount.prospects.map((prospect, index) => {
    if (index !== prospectIndex) {
      return prospect;
    }

    return prospectSchema.parse({
      ...prospect,
      signalMatchIds: mergeStringLists(prospect.signalMatchIds, signalMatchIds),
      throughLine: throughLineSchema.parse({
        ...prospect.throughLine,
        status: "ready",
        specificToThem: input.specificToThem,
        sharedProblem: input.sharedProblem,
        whyNow: input.whyNow,
        legitimateWedge: input.legitimateWedge,
        compressionLine: input.compressionLine,
        signalMatchIds: signalMatchIds.length ? signalMatchIds : prospect.throughLine.signalMatchIds,
        updatedAt: now
      })
    });
  });

  const updatedAccount = targetAccountSchema.parse({
    ...baseAccount,
    lastResearchAt: now,
    prospects
  });

  return finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
}

/**
 * @param {string[] | undefined} left
 * @param {string[] | undefined} right
 */
function mergeStringLists(left, right) {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}
