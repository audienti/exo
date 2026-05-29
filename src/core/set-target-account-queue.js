// @ts-check

import { targetAccountSchema } from "../schema/target-account.js";
import { applyManualTargetAccountQueueState, isMotionQueueStatus } from "../lib/motion-queue.js";
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

  const { motion, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const updatedAccount = targetAccountSchema.parse(
    applyManualTargetAccountQueueState(baseAccount, {
      status: input.status,
      notes: input.notes
    }, now)
  );

  return finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
}
