// @ts-check

import { applyClaimCompanyResearchPacket } from "../lib/motion-packets.js";
import {
  finalizeTargetAccountUpdate,
  prepareTargetAccountContext
} from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   workerLabel: string,
 *   notes?: string | null | undefined
 * }} input
 */
export function claimMotionTargetAccountPacket(rawMotion, rawCompany, input) {
  const { motion, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const updatedAccount = applyClaimCompanyResearchPacket(baseAccount, input, now);
  return finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
}
