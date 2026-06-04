// @ts-check

export const STALE_CONNECTION_REQUEST_DAYS = 21;

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

/**
 * @param {{ kind?: string | null | undefined, observedAt?: string | null | undefined } | null | undefined} observation
 * @param {{ now?: string | null | undefined }} [options]
 */
export function isStalePendingConnectionRequest(observation, options = {}) {
  if (observation?.kind !== "connection_request_pending") {
    return false;
  }

  const observedAt = observation.observedAt ? new Date(observation.observedAt) : null;
  if (!observedAt || Number.isNaN(observedAt.getTime())) {
    return false;
  }

  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    return false;
  }

  const ageDays = (now.getTime() - observedAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= STALE_CONNECTION_REQUEST_DAYS;
}
