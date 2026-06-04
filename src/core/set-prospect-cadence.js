// @ts-check

import { cadenceStateSchema, prospectSchema, targetAccountSchema } from "../schema/target-account.js";
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
 *   currentStep?: import("../schema/target-account.js").cadenceStateSchema._type["currentStep"],
 *   lastTouchChannel?: import("../schema/target-account.js").cadenceStateSchema._type["lastTouchChannel"],
 *   lastTouchOutcome?: import("../schema/target-account.js").cadenceStateSchema._type["lastTouchOutcome"],
 *   lastTouchAt?: string | null | undefined,
 *   nextAction?: string | null | undefined,
 *   nextActionDueAt?: string | null | undefined,
 *   blockedChannels?: string[],
 *   requireNewHook?: boolean | undefined,
 *   notes?: string | null | undefined
 * }} input
 */
export function setMotionProspectCadence(rawMotion, rawCompany, input) {
  const { motion, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const prospectIndex = baseAccount.prospects.findIndex((prospect) => prospect.id === input.prospectId);
  const normalizedLastTouchAt = normalizeOptionalNullableString(input.lastTouchAt);
  const normalizedNextAction = normalizeOptionalNullableString(input.nextAction);
  const normalizedNextActionDueAt = normalizeOptionalNullableString(input.nextActionDueAt);
  const normalizedNotes = normalizeOptionalNullableString(input.notes);

  if (prospectIndex === -1) {
    throw new Error(`Prospect not found: ${input.prospectId}`);
  }

  const prospects = baseAccount.prospects.map((prospect, index) => {
    if (index !== prospectIndex) {
      return prospect;
    }

    return prospectSchema.parse({
      ...prospect,
      cadenceState: cadenceStateSchema.parse({
        ...prospect.cadenceState,
        status: "ready",
        currentStep: input.currentStep ?? prospect.cadenceState.currentStep ?? null,
        lastTouchChannel: input.lastTouchChannel ?? prospect.cadenceState.lastTouchChannel ?? null,
        lastTouchOutcome: input.lastTouchOutcome ?? prospect.cadenceState.lastTouchOutcome ?? null,
        lastTouchAt: normalizedLastTouchAt === undefined ? prospect.cadenceState.lastTouchAt ?? null : normalizedLastTouchAt,
        nextAction: normalizedNextAction === undefined ? prospect.cadenceState.nextAction ?? null : normalizedNextAction,
        nextActionDueAt:
          normalizedNextActionDueAt === undefined ? prospect.cadenceState.nextActionDueAt ?? null : normalizedNextActionDueAt,
        blockedChannels:
          input.blockedChannels !== undefined
            ? normalizeStringArray(input.blockedChannels)
            : prospect.cadenceState.blockedChannels,
        requireNewHook: input.requireNewHook ?? prospect.cadenceState.requireNewHook,
        notes: normalizedNotes === undefined ? prospect.cadenceState.notes ?? null : normalizedNotes,
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
