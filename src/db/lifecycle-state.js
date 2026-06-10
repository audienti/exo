// @ts-check

export const dispositionValues = ["active", "nurture", "not_a_fit", "no_longer_target", "exhausted"];
export const packetStatusValues = ["claimed", "submitted", "returned"];

export const workableBranchPredicateSql = `
  prospects.disposition = 'active'
  AND motion_accounts.disposition = 'active'
  AND prospects.queue_status NOT IN ('suppressed', 'exhausted', 'held_cross_motion')
  AND motion_accounts.queue_status NOT IN ('suppressed', 'exhausted')
`;

/**
 * @param {string} disposition
 * @param {string} currentQueueStatus
 */
export function queueStatusForDisposition(disposition, currentQueueStatus) {
  if (disposition === "not_a_fit" || disposition === "no_longer_target") return "suppressed";
  if (disposition === "exhausted") return "exhausted";
  return currentQueueStatus;
}
