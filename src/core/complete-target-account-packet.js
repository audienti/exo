// @ts-check

import { applyCompleteTargetAccountPacket } from "../lib/motion-packets.js";
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
  const { motion, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const updatedAccount = applyCompleteTargetAccountPacket(baseAccount, input, now);
  return finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
}
