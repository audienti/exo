// @ts-check

import { applyCompleteMotionProspectPacket } from "../lib/motion-packets.js";
import {
  findMotionById,
  setProspectDisposition,
} from "../db/database.js";
import { persistProspectRows } from "./record-prospect.js";
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
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const existingProspect = baseAccount.prospects.find((prospect) => prospect.id === input.prospectId);

  if (!existingProspect) {
    throw new Error(`Prospect not found on target account: ${input.prospectId}`);
  }

  const updatedProspects = baseAccount.prospects.map((prospect) => (
    prospect.id === input.prospectId
      ? applyCompleteMotionProspectPacket(prospect, input, now)
      : prospect
  ));

  const updatedAccount = {
    ...baseAccount,
    prospects: updatedProspects
  };
  const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
  const updatedProspect = updatedProspects.find((prospect) => prospect.id === input.prospectId);
  if (updatedProspect) {
    persistProspectRows({
      motion: updatedMotion,
      company,
      account: updatedAccount,
      prospect: updatedProspect,
      now,
    });

    const terminalDisposition = prospectDispositionForPacketStatus(input.nextStatus);
    if (terminalDisposition) {
      setProspectDisposition(updatedProspect.id, {
        disposition: terminalDisposition,
        actor: "agent",
        reason: input.notes ?? null,
        at: now,
      });
    }
  }

  return findMotionById(motion.id) ?? updatedMotion;
}

/**
 * @param {"suppressed" | "exhausted" | undefined} status
 */
function prospectDispositionForPacketStatus(status) {
  if (status === "suppressed") return "not_a_fit";
  if (status === "exhausted") return "exhausted";
  return null;
}
