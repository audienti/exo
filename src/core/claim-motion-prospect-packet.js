// @ts-check

import { claimProspectPacket, findMotionById } from "../db/database.js";
import { prepareTargetAccountContext } from "./target-account-state.js";

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
  const { motion, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  if (baseAccount.packetState?.status === "claimed") {
    throw new Error(`Account-level ${baseAccount.packetState.kind} packet is still claimed by ${baseAccount.packetState.workerLabel ?? "another worker"}.`);
  }

  const existingProspect = baseAccount.prospects.find((prospect) => prospect.id === input.prospectId);

  if (!existingProspect) {
    throw new Error(`Prospect not found on target account: ${input.prospectId}`);
  }

  const claimed = claimProspectPacket(input.prospectId, {
    workerLabel: input.workerLabel,
  });
  if (!claimed) {
    throw new Error(`Prospect packet is already claimed by ${existingProspect.packetState?.workerLabel ?? "another worker"}.`);
  }
  return findMotionById(motion.id) ?? motion;
}
