// @ts-check

import { applyCompleteMotionProspectPacket } from "../lib/motion-packets.js";
import {
  findMotionById,
  setProspectDisposition,
} from "../db/database.js";
import {
  buildProspectPacketProposal,
  completionInputFromProposal,
  dispositionFromProposal,
  resolveStoredPacketProposal,
} from "./packet-review-policy.js";
import { persistProspectRows } from "./record-prospect.js";
import {
  finalizeTargetAccountUpdate,
  prepareTargetAccountContext,
} from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   prospectId: string,
 *   outcome?: "advance" | "nurture" | "not_a_fit" | "no_longer_target" | "exhausted" | undefined,
 *   nextStatus?: "suppressed" | "exhausted" | undefined,
 *   notes?: string | null | undefined,
 *   reason?: string | null | undefined,
 *   reviewer?: string | null | undefined
 * }} input
 */
export function acceptMotionProspectPacket(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const existingProspect = findProspect(baseAccount, input.prospectId);
  const packetState = requireReviewablePacket(existingProspect.packetState);
  const explicitProposal = input.outcome || input.nextStatus
    ? buildProspectPacketProposal("prospect_research", input, now)
    : null;
  const proposal = resolveStoredPacketProposal(explicitProposal, packetState.proposal);

  if (proposal.action === "nurture") {
    const completedProspect = {
      ...existingProspect,
      packetStatus: null,
      packetState: {
        ...packetState,
        status: "completed",
        completedAt: now,
        proposal,
        reviewer: input.reviewer ?? packetState.reviewer ?? null,
      },
    };
    const updatedMotion = persistProspectPacket(motion, company, accounts, baseAccount, completedProspect, now);
    setProspectDisposition(completedProspect.id, {
      disposition: "nurture",
      actor: "operator",
      reason: proposal.reason ?? input.reason ?? input.notes ?? null,
      at: now,
    });
    return findMotionById(motion.id) ?? updatedMotion;
  }

  const completionInput = completionInputFromProposal(proposal);
  const completedProspect = applyCompleteMotionProspectPacket({
    ...existingProspect,
    packetState: {
      ...packetState,
      status: "claimed",
    },
  }, {
    nextStatus: completionInput.nextStatus,
    notes: input.notes ?? proposal.reason ?? null,
  }, now);
  const updatedMotion = persistProspectPacket(motion, company, accounts, baseAccount, {
    ...completedProspect,
    packetState: {
      ...completedProspect.packetState,
      proposal,
      reviewer: input.reviewer ?? packetState.reviewer ?? null,
    },
  }, now);
  const disposition = dispositionFromProposal(proposal);
  if (disposition) {
    setProspectDisposition(completedProspect.id, {
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
 * @param {{ prospectId: string, notes: string, reviewer?: string | null | undefined }} input
 */
export function returnMotionProspectPacket(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const existingProspect = findProspect(baseAccount, input.prospectId);
  const packetState = requireReviewablePacket(existingProspect.packetState);
  const returnedProspect = {
    ...existingProspect,
    packetStatus: "returned",
    packetState: {
      ...packetState,
      status: "returned",
      returnNotes: input.notes,
      returnedAt: now,
      reviewer: input.reviewer ?? packetState.reviewer ?? null,
    },
  };
  return persistProspectPacket(motion, company, accounts, baseAccount, returnedProspect, now);
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {string} prospectId
 */
function findProspect(account, prospectId) {
  const prospect = account.prospects.find((item) => item.id === prospectId);
  if (!prospect) throw new Error(`Prospect not found on target account: ${prospectId}`);
  return prospect;
}

/**
 * @param {unknown} packetState
 */
function requireReviewablePacket(packetState) {
  if (!packetState || typeof packetState !== "object" || Array.isArray(packetState)) {
    throw new Error("No prospect packet is awaiting review.");
  }
  const state = /** @type {Record<string, any>} */ (packetState);
  if (state.status !== "submitted" && state.status !== "returned") {
    throw new Error(`Prospect packet is not awaiting review: ${state.status ?? "none"}.`);
  }
  if (state.kind !== "prospect_research") {
    throw new Error(`Unsupported prospect packet kind: ${state.kind ?? "unknown"}.`);
  }
  return state;
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {import("../schema/target-account.js").targetAccountSchema._type[]} accounts
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 * @param {string} now
 */
function persistProspectPacket(motion, company, accounts, account, prospect, now) {
  const updatedAccount = {
    ...account,
    prospects: account.prospects.map((item) => item.id === prospect.id ? prospect : item),
  };
  const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
  persistProspectRows({
    motion: updatedMotion,
    company,
    account: updatedAccount,
    prospect,
    now,
  });
  return updatedMotion;
}
