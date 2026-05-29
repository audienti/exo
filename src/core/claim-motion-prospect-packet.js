// @ts-check

import { applyClaimMotionProspectPacket } from "../lib/motion-packets.js";
import {
  finalizeTargetAccountUpdate,
  prepareTargetAccountContext
} from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   prospectId: string,
 *   workerLabel: string,
 *   notes?: string | null | undefined
 * }} input
 */
export function claimMotionProspectPacket(rawMotion, rawCompany, input) {
  const { motion, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  if (baseAccount.packetState?.status === "claimed") {
    throw new Error(`Account-level ${baseAccount.packetState.kind} packet is still claimed by ${baseAccount.packetState.workerLabel ?? "another worker"}.`);
  }

  const existingProspect = baseAccount.prospects.find((prospect) => prospect.id === input.prospectId);

  if (!existingProspect) {
    throw new Error(`Prospect not found on target account: ${input.prospectId}`);
  }

  const updatedProspects = baseAccount.prospects.map((prospect) => (
    prospect.id === input.prospectId
      ? applyClaimMotionProspectPacket(prospect, input, now)
      : prospect
  ));

  return finalizeTargetAccountUpdate(motion, accounts, {
    ...baseAccount,
    prospects: updatedProspects
  }, now);
}
