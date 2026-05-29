// @ts-check

import { applyCompleteMotionProspectPacket } from "../lib/motion-packets.js";
import {
  finalizeTargetAccountUpdate,
  prepareTargetAccountContext
} from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   prospectId: string,
 *   workerLabel?: string | null | undefined,
 *   nextStatus?: "suppressed" | "exhausted" | undefined,
 *   notes?: string | null | undefined
 * }} input
 */
export function completeMotionProspectPacket(rawMotion, rawCompany, input) {
  const { motion, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const existingProspect = baseAccount.prospects.find((prospect) => prospect.id === input.prospectId);

  if (!existingProspect) {
    throw new Error(`Prospect not found on target account: ${input.prospectId}`);
  }

  const updatedProspects = baseAccount.prospects.map((prospect) => (
    prospect.id === input.prospectId
      ? applyCompleteMotionProspectPacket(prospect, input, now)
      : prospect
  ));

  return finalizeTargetAccountUpdate(motion, accounts, {
    ...baseAccount,
    prospects: updatedProspects
  }, now);
}
