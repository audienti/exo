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
  requiresDisposition,
  resolvePacketReviewMode,
} from "./packet-review-policy.js";
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
 *   outcome?: "advance" | "nurture" | "not_a_fit" | "no_longer_target" | "exhausted" | undefined,
 *   notes?: string | null | undefined,
 *   reason?: string | null | undefined
 * }} input
 */
export function completeMotionProspectPacket(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const existingProspect = baseAccount.prospects.find((prospect) => prospect.id === input.prospectId);

  if (!existingProspect) {
    throw new Error(`Prospect not found on target account: ${input.prospectId}`);
  }

  const claimedPacket = existingProspect.packetState?.status === "claimed" ? existingProspect.packetState : null;
  if (!claimedPacket) {
    applyCompleteMotionProspectPacket(existingProspect, input, now);
  }
  if (claimedPacket?.kind !== "prospect_research") {
    throw new Error(`Unsupported packet kind: ${claimedPacket?.kind ?? "unknown"}`);
  }
  const proposal = buildProspectPacketProposal("prospect_research", input, now);
  if (resolvePacketReviewMode(motion, "prospect_research") === "review") {
    const submittedProspect = {
      ...existingProspect,
      packetStatus: "submitted",
      packetState: {
        ...claimedPacket,
        status: "submitted",
        completedAt: now,
        notes: input.notes ?? claimedPacket.notes ?? null,
        proposal,
      },
    };
    const updatedAccount = {
      ...baseAccount,
      prospects: baseAccount.prospects.map((prospect) =>
        prospect.id === input.prospectId ? submittedProspect : prospect
      ),
    };
    const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
    persistProspectRows({
      motion: updatedMotion,
      company,
      account: updatedAccount,
      prospect: submittedProspect,
      now,
    });
    return findMotionById(motion.id) ?? updatedMotion;
  }

  if (proposal.action === "nurture") {
    const completedProspect = {
      ...existingProspect,
      packetStatus: null,
      packetState: {
        ...claimedPacket,
        status: "completed",
        completedAt: now,
        notes: input.notes ?? claimedPacket.notes ?? null,
        proposal,
      },
    };
    const updatedAccount = {
      ...baseAccount,
      prospects: baseAccount.prospects.map((prospect) =>
        prospect.id === input.prospectId ? completedProspect : prospect
      ),
    };
    const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
    persistProspectRows({
      motion: updatedMotion,
      company,
      account: updatedAccount,
      prospect: completedProspect,
      now,
    });
    setProspectDisposition(completedProspect.id, {
      disposition: "nurture",
      actor: "agent",
      reason: proposal.reason ?? null,
      at: now,
    });
    return findMotionById(motion.id) ?? updatedMotion;
  }

  const completionInput = completionInputFromProposal(proposal);
  const updatedProspects = baseAccount.prospects.map((prospect) => (
    prospect.id === input.prospectId
      ? applyCompleteMotionProspectPacket(prospect, {
        ...input,
        nextStatus: completionInput.nextStatus,
        notes: input.notes ?? proposal.reason ?? null,
      }, now)
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

    const terminalDisposition = requiresDisposition(proposal)
      ? dispositionFromProposal(proposal)
      : prospectDispositionForPacketStatus(completionInput.nextStatus);
    if (terminalDisposition) {
      setProspectDisposition(updatedProspect.id, {
        disposition: terminalDisposition,
        actor: "agent",
        reason: proposal.reason ?? input.notes ?? null,
        at: now,
      });
    }
  }

  return findMotionById(motion.id) ?? updatedMotion;
}

/**
 * @param {"suppressed" | "exhausted" | undefined | null} status
 */
function prospectDispositionForPacketStatus(status) {
  if (status === "suppressed") return "not_a_fit";
  if (status === "exhausted") return "exhausted";
  return null;
}
