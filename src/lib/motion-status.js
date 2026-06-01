// @ts-check

/**
 * @param {string | null | undefined} status
 */
export function isExecutionEligibleMotionStatus(status) {
  return status === "active";
}

/**
 * @param {string | null | undefined} status
 */
export function isPlannerEligibleMotionStatus(status) {
  return status === "active" || status === "draft";
}
