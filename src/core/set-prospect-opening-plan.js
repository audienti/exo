// @ts-check

import { cadenceStateSchema, openingPlanSchema, prospectSchema, targetAccountSchema } from "../schema/target-account.js";
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
 *   supportingProspectIds?: string[],
 *   signalMatchIds?: string[],
 *   whyNow: string,
 *   angle: string,
 *   replyPath: string,
 *   primaryChannel?: "connection-request" | "direct-message" | "inmail" | "email" | "none",
 *   fallbackChannel?: "connection-request" | "direct-message" | "inmail" | "email" | "none",
 *   fallbackTrigger?: string | null | undefined,
 *   preflightActions?: string[],
 *   firstMove: string,
 *   firstMessageGoal: string,
 *   talkingPoints?: string[],
 *   notes?: string | null | undefined
 * }} input
 */
export function setMotionProspectOpeningPlan(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const prospectIndex = baseAccount.prospects.findIndex((prospect) => prospect.id === input.prospectId);
  const supportingProspectIds = normalizeStringArray(input.supportingProspectIds);
  const signalMatchIds = normalizeStringArray(input.signalMatchIds);
  const knownProspectIds = new Set(baseAccount.prospects.map((prospect) => prospect.id));
  const knownSignalIds = new Set(baseAccount.signalMatches.map((match) => match.id));

  if (prospectIndex === -1) {
    throw new Error(`Prospect not found on ${company.name}: ${input.prospectId}`);
  }

  for (const supportingProspectId of supportingProspectIds) {
    if (!knownProspectIds.has(supportingProspectId)) {
      throw new Error(`Supporting prospect not found on ${company.name}: ${supportingProspectId}`);
    }
  }

  for (const signalMatchId of signalMatchIds) {
    if (!knownSignalIds.has(signalMatchId)) {
      throw new Error(`Signal match not found on ${company.name}: ${signalMatchId}`);
    }
  }

  if (supportingProspectIds.length + 1 > motion.targetingProfile.stakeholderTargetCount) {
    throw new Error(
      `Opening plan selects ${supportingProspectIds.length + 1} people but motion stakeholderTargetCount is ${motion.targetingProfile.stakeholderTargetCount}.`
    );
  }

  const prospects = baseAccount.prospects.map((prospect, index) => {
    if (index !== prospectIndex) {
      return prospect;
    }

    return prospectSchema.parse({
      ...prospect,
      signalMatchIds: mergeStringLists(prospect.signalMatchIds, signalMatchIds),
      openingPlan: openingPlanSchema.parse({
        ...prospect.openingPlan,
        status: "ready",
        supportingProspectIds,
        signalMatchIds,
        whyNow: input.whyNow,
        angle: input.angle,
        replyPath: input.replyPath,
        primaryChannel: input.primaryChannel ?? prospect.openingPlan.primaryChannel ?? null,
        fallbackChannel: input.fallbackChannel ?? prospect.openingPlan.fallbackChannel ?? null,
        fallbackTrigger:
          normalizeOptionalNullableString(input.fallbackTrigger) ?? prospect.openingPlan.fallbackTrigger ?? null,
        preflightActions:
          input.preflightActions !== undefined
            ? normalizeStringArray(input.preflightActions)
            : prospect.openingPlan.preflightActions,
        firstMove: input.firstMove,
        firstMessageGoal: input.firstMessageGoal,
        talkingPoints:
          input.talkingPoints !== undefined
            ? normalizeStringArray(input.talkingPoints)
            : prospect.openingPlan.talkingPoints,
        notes: normalizeOptionalNullableString(input.notes) ?? prospect.openingPlan.notes ?? null,
        updatedAt: now
      }),
      cadenceState: cadenceStateSchema.parse({
        ...prospect.cadenceState,
        status: prospect.cadenceState.status === "ready" ? "ready" : "pending",
        currentStep: prospect.cadenceState.currentStep ?? (input.primaryChannel === "connection-request" ? "connection-request" : null),
        nextAction: input.firstMove,
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
 * @param {string | null | undefined} value
 */
function normalizeOptionalNullableString(value) {
  return value === undefined ? undefined : normalizeNullableString(value);
}

/**
 * @param {string[] | undefined} left
 * @param {string[] | undefined} right
 */
function mergeStringLists(left, right) {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}
