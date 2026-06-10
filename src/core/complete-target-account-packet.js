// @ts-check

import { applyCompleteTargetAccountPacket } from "../lib/motion-packets.js";
import {
  findMotionById,
  setAccountDisposition,
  upsertMotionAccount,
} from "../db/database.js";
import {
  finalizeTargetAccountUpdate,
  prepareTargetAccountContext
} from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   workerLabel?: string | null | undefined,
 *   nextStatus?: "researched" | "suppressed" | "exhausted" | undefined,
 *   notes?: string | null | undefined
 * }} input
 */
export function completeMotionTargetAccountPacket(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const updatedAccount = applyCompleteTargetAccountPacket(baseAccount, input, now);
  const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
  const motionAccount = upsertMotionAccount({
    id: buildMotionAccountId(motion.id, company.id),
    motionId: motion.id,
    companyId: company.id,
    executionUserId: motion.engagementUserAssignment?.userId ?? null,
    queueStatus: updatedAccount.queueState?.status ?? "selected",
    disposition: updatedAccount.disposition,
    packetStatus: updatedAccount.packetStatus,
    lastResearchAt: updatedAccount.lastResearchAt,
    payload: {
      ...updatedAccount,
      prospects: undefined,
      signalMatches: undefined,
    },
    now,
  });

  const terminalDisposition = accountDispositionForPacketStatus(input.nextStatus);
  if (terminalDisposition && motionAccount) {
    setAccountDisposition(motionAccount.id, {
      disposition: terminalDisposition,
      actor: "agent",
      reason: input.notes ?? null,
      at: now,
    });
  }

  return findMotionById(motion.id) ?? updatedMotion;
}

/**
 * @param {"researched" | "suppressed" | "exhausted" | undefined} status
 */
function accountDispositionForPacketStatus(status) {
  if (status === "suppressed") return "no_longer_target";
  if (status === "exhausted") return "exhausted";
  return null;
}

/**
 * @param {string} motionId
 * @param {string} companyId
 */
function buildMotionAccountId(motionId, companyId) {
  return `motion-account-${motionId}-${companyId}`;
}
