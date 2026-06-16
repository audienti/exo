// @ts-check

export const STALE_CONNECTION_REQUEST_DAYS = 21;

const OBSERVED_CONNECTION_REQUEST_BRANCH_KINDS = new Set([
  "connection_request_pending",
  "profile_view_after_touch",
  "connection_request_no_longer_pending",
  "connection_request_not_accepted",
  "connection_request_accepted",
]);

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

/**
 * When cadence writeback lags behind inbound reconciliation, linked inbox or
 * observation rows are still authoritative enough to suppress a duplicate
 * first-touch connection request.
 *
 * @param {Array<{ kind?: string | null | undefined, observedAt?: string | null | undefined, eventAt?: string | null | undefined }> | null | undefined} items
 * @returns {{ state: "pending" | "attention_after_touch" | "needs_status_reconciliation" | "not_accepted" | "accepted", observedAt: string | null } | null}
 */
export function summarizeObservedConnectionRequestState(items) {
  const latest = (Array.isArray(items) ? items : [])
    .filter((item) => OBSERVED_CONNECTION_REQUEST_BRANCH_KINDS.has(String(item?.kind ?? "")))
    .sort((left, right) => (
      (Date.parse(right?.eventAt ?? right?.observedAt ?? "") || 0)
      - (Date.parse(left?.eventAt ?? left?.observedAt ?? "") || 0)
    ))[0] ?? null;

  if (!latest) {
    return null;
  }

  const observedAt = latest.eventAt ?? latest.observedAt ?? null;
  switch (latest.kind) {
    case "connection_request_pending":
      return { state: "pending", observedAt };
    case "profile_view_after_touch":
      return { state: "attention_after_touch", observedAt };
    case "connection_request_no_longer_pending":
      return { state: "needs_status_reconciliation", observedAt };
    case "connection_request_not_accepted":
      return { state: "not_accepted", observedAt };
    case "connection_request_accepted":
      return { state: "accepted", observedAt };
    default:
      return null;
  }
}

/**
 * @param {Array<{ kind?: string | null | undefined, observedAt?: string | null | undefined, eventAt?: string | null | undefined }> | null | undefined} items
 */
export function hasObservedPendingConnectionRequest(items) {
  const state = summarizeObservedConnectionRequestState(items);
  return state?.state === "pending" || state?.state === "attention_after_touch";
}
