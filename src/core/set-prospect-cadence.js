// @ts-check

import { findMotionById, findProspectById, updateProspectCadence } from "../db/database.js";
import {
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
  const { motion, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const prospectIndex = baseAccount.prospects.findIndex((prospect) => prospect.id === input.prospectId);
  const normalizedLastTouchAt = normalizeOptionalNullableString(input.lastTouchAt);
  const normalizedNextAction = normalizeOptionalNullableString(input.nextAction);
  const normalizedNextActionDueAt = normalizeOptionalNullableString(input.nextActionDueAt);
  const normalizedNotes = normalizeOptionalNullableString(input.notes);

  if (prospectIndex === -1) {
    throw new Error(`Prospect not found: ${input.prospectId}`);
  }

  if (!findProspectById(input.prospectId)) {
    throw new Error(`Prospect row not found: ${input.prospectId}`);
  }

  updateProspectCadence(input.prospectId, {
    currentStep: input.currentStep,
    lastTouchChannel: input.lastTouchChannel,
    lastTouchOutcome: input.lastTouchOutcome,
    lastTouchAt: normalizedLastTouchAt,
    nextAction: normalizedNextAction,
    nextActionDueAt: normalizedNextActionDueAt,
    blockedChannels: input.blockedChannels !== undefined ? normalizeStringArray(input.blockedChannels) : undefined,
    requireNewHook: input.requireNewHook,
    notes: normalizedNotes,
  });

  return findMotionById(motion.id) ?? motion;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeOptionalNullableString(value) {
  return value === undefined ? undefined : normalizeNullableString(value);
}
