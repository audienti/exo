// @ts-check

import {
  claimMotionAccountPacket,
  findMotionAccountByMotionAndCompany,
  findMotionById,
  upsertMotionAccount,
} from "../db/database.js";
import { prepareTargetAccountContext } from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   workerLabel: string,
 *   notes?: string | null | undefined
 * }} input
 */
export function claimMotionTargetAccountPacket(rawMotion, rawCompany, input) {
  const { motion, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const existingMotionAccount = findMotionAccountByMotionAndCompany(motion.id, baseAccount.companyId);
  const queueStatus = baseAccount.queueState?.status ?? "discovered";
  const nextQueueStatus = queueStatusForClaim(queueStatus);
  const now = new Date().toISOString();
  const packetKind = nextQueueStatus === "researched" ? "prospect_selection" : "company_research";
  const motionAccount = upsertMotionAccount({
    id: existingMotionAccount?.id,
    motionId: motion.id,
    companyId: baseAccount.companyId,
    executionUserId: motion.engagementUserAssignment?.userId ?? existingMotionAccount?.executionUserId ?? null,
    queueStatus: nextQueueStatus,
    disposition: baseAccount.disposition,
    packetStatus: existingMotionAccount?.packetStatus ?? packetStatusFromPacketState(baseAccount.packetState),
    lastResearchAt: baseAccount.lastResearchAt,
    payload: {
      ...baseAccount,
      packetState: {
        kind: packetKind,
        status: "claimed",
        workerLabel: input.workerLabel,
        claimedAt: now,
        completedAt: null,
        notes: input.notes ?? null,
      },
      prospects: undefined,
      signalMatches: undefined,
    },
    now,
  });
  claimMotionAccountPacket(motionAccount.id, {
    workerLabel: input.workerLabel,
    claimedAt: now,
  });
  return findMotionById(motion.id) ?? motion;
}

/**
 * @param {string} queueStatus
 * @returns {string}
 */
function queueStatusForClaim(queueStatus) {
  if (queueStatus === "discovered" || queueStatus === "queued_for_research") return "queued_for_research";
  if (queueStatus === "researched") return "researched";
  throw new Error(`No claimable motion packet exists for queue state ${queueStatus}.`);
}

/**
 * @param {unknown} packetState
 * @returns {"claimed" | null}
 */
function packetStatusFromPacketState(packetState) {
  if (!packetState || typeof packetState !== "object" || Array.isArray(packetState)) return null;
  return packetState.status === "claimed" ? "claimed" : null;
}
