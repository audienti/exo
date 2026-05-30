// @ts-check

/**
 * @param {{
 *   currentStep?: string | null | undefined,
 *   lastTouchOutcome?: string | null | undefined
 * } | null | undefined} cadence
 */
export function isConnectionRequestInFlight(cadence) {
  return (
    cadence?.currentStep === "connection-request"
    && (cadence?.lastTouchOutcome === "sent" || cadence?.lastTouchOutcome === "pending")
  );
}
