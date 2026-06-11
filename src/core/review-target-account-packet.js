// @ts-check

import { applyCompleteTargetAccountPacket } from "../lib/motion-packets.js";
import {
  findMotionAccountByMotionAndCompany,
  findMotionById,
  setAccountDisposition,
  upsertMotionAccount,
} from "../db/database.js";
import {
  buildAccountPacketProposal,
  completionInputFromProposal,
  dispositionFromProposal,
  resolveStoredPacketProposal,
} from "./packet-review-policy.js";
import {
  finalizeTargetAccountUpdate,
  prepareTargetAccountContext,
} from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   outcome?: "advance" | "nurture" | "no_longer_target" | "not_a_fit" | "exhausted" | undefined,
 *   nextStatus?: "researched" | "suppressed" | "exhausted" | undefined,
 *   notes?: string | null | undefined,
 *   reason?: string | null | undefined,
 *   reviewer?: string | null | undefined
 * }} [input]
 */
export function acceptMotionTargetAccountPacket(rawMotion, rawCompany, input = {}) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const packetState = requireReviewablePacket(baseAccount.packetState);
  const explicitProposal = input.outcome || input.nextStatus
    ? buildAccountPacketProposal(packetState.kind, input, now)
    : null;
  const proposal = resolveStoredPacketProposal(explicitProposal, packetState.proposal);

  if (proposal.action === "nurture") {
    const updatedMotion = persistAccountPacket(motion, company, accounts, baseAccount, {
      packetState: {
        ...packetState,
        status: "completed",
        completedAt: now,
        proposal,
        reviewer: input.reviewer ?? packetState.reviewer ?? null,
      },
      packetStatus: null,
      now,
    });
    const motionAccount = findMotionAccount(motion.id, company.id);
    if (motionAccount) {
      setAccountDisposition(motionAccount.id, {
        disposition: "nurture",
        actor: "operator",
        reason: proposal.reason ?? input.reason ?? input.notes ?? null,
        at: now,
      });
    }
    return findMotionById(motion.id) ?? updatedMotion;
  }

  const completionInput = completionInputFromProposal(proposal);
  const completedAccount = applyCompleteTargetAccountPacket({
    ...baseAccount,
    packetState: {
      ...packetState,
      status: "claimed",
    },
  }, {
    nextStatus: completionInput.nextStatus,
    notes: input.notes ?? proposal.reason ?? null,
  }, now);
  const updatedMotion = persistAccountPacket(motion, company, accounts, completedAccount, {
    packetState: {
      ...completedAccount.packetState,
      proposal,
      reviewer: input.reviewer ?? packetState.reviewer ?? null,
    },
    packetStatus: null,
    now,
  });
  const disposition = dispositionFromProposal(proposal);
  const motionAccount = findMotionAccount(motion.id, company.id);
  if (disposition && motionAccount) {
    setAccountDisposition(motionAccount.id, {
      disposition,
      actor: "operator",
      reason: proposal.reason ?? input.reason ?? input.notes ?? null,
      at: now,
    });
  }
  return findMotionById(motion.id) ?? updatedMotion;
}

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{ notes: string, reviewer?: string | null | undefined }} input
 */
export function returnMotionTargetAccountPacket(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const packetState = requireReviewablePacket(baseAccount.packetState);
  return persistAccountPacket(motion, company, accounts, baseAccount, {
    packetStatus: "returned",
    packetState: {
      ...packetState,
      status: "returned",
      returnNotes: input.notes,
      returnedAt: now,
      reviewer: input.reviewer ?? packetState.reviewer ?? null,
    },
    now,
  });
}

/**
 * @param {unknown} packetState
 */
function requireReviewablePacket(packetState) {
  if (!packetState || typeof packetState !== "object" || Array.isArray(packetState)) {
    throw new Error("No packet is awaiting review.");
  }
  const state = /** @type {Record<string, any>} */ (packetState);
  if (state.status !== "submitted" && state.status !== "returned") {
    throw new Error(`Packet is not awaiting review: ${state.status ?? "none"}.`);
  }
  if (state.kind !== "company_research" && state.kind !== "prospect_selection") {
    throw new Error(`Unsupported account packet kind: ${state.kind ?? "unknown"}.`);
  }
  return /** @type {Record<string, any> & { kind: "company_research" | "prospect_selection" }} */ (state);
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {import("../schema/target-account.js").targetAccountSchema._type[]} accounts
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {{ packetStatus: "submitted" | "returned" | null, packetState: Record<string, any> | null, now: string }} input
 */
function persistAccountPacket(motion, company, accounts, account, input) {
  const updatedAccount = {
    ...account,
    packetStatus: input.packetStatus,
    packetState: input.packetState,
  };
  const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, updatedAccount, input.now);
  upsertMotionAccount({
    id: `motion-account-${motion.id}-${company.id}`,
    motionId: motion.id,
    companyId: company.id,
    executionUserId: motion.engagementUserAssignment?.userId ?? null,
    queueStatus: updatedAccount.queueState?.status ?? "selected",
    disposition: updatedAccount.disposition,
    packetStatus: input.packetStatus,
    lastResearchAt: updatedAccount.lastResearchAt,
    payload: {
      ...updatedAccount,
      prospects: undefined,
      signalMatches: undefined,
    },
    now: input.now,
  });
  return updatedMotion;
}

/**
 * @param {string} motionId
 * @param {string} companyId
 */
function findMotionAccount(motionId, companyId) {
  return findMotionAccountByMotionAndCompany(motionId, companyId);
}
