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
        lastTouchAt: normalizeOptionalNullableString(input.lastTouchAt) ?? prospect.cadenceState.lastTouchAt ?? null,
        nextAction: normalizeOptionalNullableString(input.nextAction) ?? prospect.cadenceState.nextAction ?? null,
        nextActionDueAt:
          normalizeOptionalNullableString(input.nextActionDueAt) ?? prospect.cadenceState.nextActionDueAt ?? null,
        blockedChannels:
          input.blockedChannels !== undefined
            ? normalizeStringArray(input.blockedChannels)
            : prospect.cadenceState.blockedChannels,
        requireNewHook: input.requireNewHook ?? prospect.cadenceState.requireNewHook,
        notes: normalizeOptionalNullableString(input.notes) ?? prospect.cadenceState.notes ?? null,
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
