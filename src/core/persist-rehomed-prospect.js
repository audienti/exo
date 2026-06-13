// @ts-check

import {
  findMotionAccountByMotionAndCompany,
  findUserById,
  listBrowserProfiles,
  moveProspectToMotionRows,
  updateCompany,
  upsertInboundObservation,
  upsertMotionAccount,
} from "../db/database.js";
import { motionSchema } from "../schema/motion.js";
import { companySchema } from "../schema/company.js";
import { assignCompanyUser } from "./assign-company-user.js";

/**
 * @param {{
 *   result: {
 *     prospectId: string,
 *     company: unknown,
 *     toMotion: unknown,
 *     observations: any[],
 *   }
 * }} input
 */
export function persistRehomedProspect(input) {
  const toMotion = motionSchema.parse(input.result.toMotion);
  let company = companySchema.parse(input.result.company);
  const assignedMotionUser = resolveMotionAssignedUser(toMotion);

  if (!company.engagementUserAssignment?.userId && assignedMotionUser) {
    company = assignCompanyUser(company, assignedMotionUser, listBrowserProfiles(), {
      assignedBy: "rehome-prospect",
      reason: `Inherited from motion ${toMotion.name} during re-home.`,
      accountRefs: toMotion.engagementUserAssignment?.accountRefs ?? null,
    });
  }

  const targetAccount = toMotion.targetMap.accounts.find((account) => account.companyId === company.id) ?? null;
  const existingMotionAccount = findMotionAccountByMotionAndCompany(toMotion.id, company.id);
  if (targetAccount) {
    upsertMotionAccount({
      id: existingMotionAccount?.id,
      motionId: toMotion.id,
      companyId: company.id,
      executionUserId: assignedMotionUser?.id ?? existingMotionAccount?.executionUserId ?? null,
      queueStatus: targetAccount.queueState?.status ?? existingMotionAccount?.queueStatus ?? "selected",
      disposition: targetAccount.disposition,
      packetStatus: targetAccount.packetStatus ?? packetStatusFromPacketState(targetAccount.packetState),
      lastResearchAt: targetAccount.lastResearchAt,
      payload: {
        ...targetAccount,
        prospects: undefined,
        signalMatches: undefined,
      },
    });
  }

  updateCompany(company);
  moveProspectToMotionRows({
    prospectId: input.result.prospectId,
    toMotionId: toMotion.id,
  });
  for (const observation of input.result.observations) {
    upsertInboundObservation(observation);
  }

  return {
    company,
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 */
function resolveMotionAssignedUser(motion) {
  const userId = motion.engagementUserAssignment?.userId ?? null;
  return userId ? findUserById(userId) : null;
}

/**
 * @param {unknown} packetState
 * @returns {"claimed" | "submitted" | "returned" | null}
 */
function packetStatusFromPacketState(packetState) {
  if (!packetState || typeof packetState !== "object" || Array.isArray(packetState)) {
    return null;
  }
  switch (packetState.status) {
    case "claimed":
    case "submitted":
    case "returned":
      return packetState.status;
    default:
      return null;
  }
}
