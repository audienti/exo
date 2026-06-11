// @ts-check

import { applyCompleteTargetAccountPacket } from "../lib/motion-packets.js";
import {
  findMotionById,
  setAccountDisposition,
  upsertMotionAccount,
} from "../db/database.js";
import {
  buildAccountPacketProposal,
  completionInputFromProposal,
  dispositionFromProposal,
  requiresDisposition,
  resolvePacketReviewMode,
} from "./packet-review-policy.js";
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
 *   outcome?: "advance" | "nurture" | "no_longer_target" | "not_a_fit" | "exhausted" | undefined,
 *   notes?: string | null | undefined,
 *   reason?: string | null | undefined
 * }} input
 */
export function completeMotionTargetAccountPacket(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const claimedPacket = baseAccount.packetState?.status === "claimed" ? baseAccount.packetState : null;
  if (!claimedPacket) {
    applyCompleteTargetAccountPacket(baseAccount, input, now);
  }
  if (claimedPacket?.kind !== "company_research" && claimedPacket?.kind !== "prospect_selection") {
    throw new Error(`Unsupported packet kind: ${claimedPacket?.kind ?? "unknown"}`);
  }
  const proposal = buildAccountPacketProposal(claimedPacket.kind, input, now);
  const reviewMode = resolvePacketReviewMode(motion, claimedPacket.kind);
  if (reviewMode === "review") {
    upsertMotionAccount({
      id: buildMotionAccountId(motion.id, company.id),
      motionId: motion.id,
      companyId: company.id,
      executionUserId: motion.engagementUserAssignment?.userId ?? null,
      queueStatus: baseAccount.queueState?.status ?? "selected",
      disposition: baseAccount.disposition,
      packetStatus: "submitted",
      lastResearchAt: baseAccount.lastResearchAt,
      payload: {
        ...baseAccount,
        packetStatus: "submitted",
        packetState: {
          ...claimedPacket,
          status: "submitted",
          completedAt: now,
          notes: input.notes ?? claimedPacket.notes ?? null,
          proposal,
        },
        prospects: undefined,
        signalMatches: undefined,
      },
      now,
    });
    return findMotionById(motion.id) ?? motion;
  }

  if (proposal.action === "nurture") {
    const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, {
      ...baseAccount,
      packetStatus: null,
      packetState: {
        ...claimedPacket,
        status: "completed",
        completedAt: now,
        notes: input.notes ?? claimedPacket.notes ?? null,
        proposal,
      },
    }, now);
    const motionAccount = upsertMotionAccount({
      id: buildMotionAccountId(motion.id, company.id),
      motionId: motion.id,
      companyId: company.id,
      executionUserId: motion.engagementUserAssignment?.userId ?? null,
      queueStatus: baseAccount.queueState?.status ?? "selected",
      disposition: baseAccount.disposition,
      packetStatus: null,
      lastResearchAt: baseAccount.lastResearchAt,
      payload: {
        ...baseAccount,
        packetStatus: null,
        packetState: {
          ...claimedPacket,
          status: "completed",
          completedAt: now,
          notes: input.notes ?? claimedPacket.notes ?? null,
          proposal,
        },
        prospects: undefined,
        signalMatches: undefined,
      },
      now,
    });
    if (motionAccount) {
      setAccountDisposition(motionAccount.id, {
        disposition: "nurture",
        actor: "agent",
        reason: proposal.reason ?? null,
        at: now,
      });
    }
    return findMotionById(motion.id) ?? updatedMotion;
  }

  const completionInput = completionInputFromProposal(proposal);
  const updatedAccount = applyCompleteTargetAccountPacket(baseAccount, {
    ...input,
    nextStatus: completionInput.nextStatus,
    notes: input.notes ?? proposal.reason ?? null,
  }, now);
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

  const terminalDisposition = requiresDisposition(proposal)
    ? dispositionFromProposal(proposal)
    : accountDispositionForPacketStatus(completionInput.nextStatus);
  if (terminalDisposition && motionAccount) {
    setAccountDisposition(motionAccount.id, {
      disposition: terminalDisposition,
      actor: "agent",
      reason: proposal.reason ?? input.notes ?? null,
      at: now,
    });
  }

  return findMotionById(motion.id) ?? updatedMotion;
}

/**
 * @param {"researched" | "suppressed" | "exhausted" | undefined | null} status
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
