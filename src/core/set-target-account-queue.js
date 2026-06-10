// @ts-check

import { targetAccountSchema } from "../schema/target-account.js";
import { applyManualTargetAccountQueueState, isMotionQueueStatus } from "../lib/motion-queue.js";
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
 *   status: string,
 *   notes?: string | null | undefined
 * }} input
 */
export function setMotionTargetAccountQueue(rawMotion, rawCompany, input) {
  if (!isMotionQueueStatus(input.status)) {
    throw new Error(`Unsupported queue status: ${input.status}`);
  }

  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const queuedAccount = applyManualTargetAccountQueueState(baseAccount, {
      status: input.status,
      notes: input.notes
    }, now);
  const updatedAccount = targetAccountSchema.parse({
    ...queuedAccount,
    packetState: input.status === "queued_for_research" ? queuedAccount.packetState ?? null : null
  });

  const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
  const motionAccount = upsertMotionAccount({
    id: buildMotionAccountId(motion.id, company.id),
    motionId: motion.id,
    companyId: company.id,
    executionUserId: motion.engagementUserAssignment?.userId ?? null,
    queueStatus: updatedAccount.queueState?.status ?? input.status,
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

  const terminalDisposition = accountDispositionForQueueStatus(input.status);
  if (terminalDisposition && motionAccount) {
    setAccountDisposition(motionAccount.id, {
      disposition: terminalDisposition,
      actor: "operator",
      reason: input.notes ?? null,
      at: now,
    });
  }

  return findMotionById(motion.id) ?? updatedMotion;
}

/**
 * @param {string} status
 */
function accountDispositionForQueueStatus(status) {
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
