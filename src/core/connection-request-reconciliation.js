// @ts-check

import { extractLinkedinPublicId } from "../lib/prospect-contacts.js";

export const CONNECTION_REQUEST_RECONCILIATION_REQUIRED_REASON = "unresolved_connection_request_reconciliation";

const STATUS_RECONCILIATION_OBSERVATION_KINDS = new Set([
  "connection_request_no_longer_pending",
]);

/**
 * @param {any} observation
 */
export function shouldQueueConnectionRequestStatusReconciliation(observation) {
  return STATUS_RECONCILIATION_OBSERVATION_KINDS.has(String(observation?.kind ?? ""))
    && Boolean(resolveConnectionRequestProfileIdentity(observation));
}

/**
 * @param {{
 *   surface: {
 *     key?: string | null,
 *     lastRunStatus?: string | null,
 *     lastItemCount?: number | null,
 *     lastVisibleTotalCount?: number | null,
 *     lastCaptureCompleteness?: string | null,
 *     lastExhaustionStatus?: string | null,
 *     lastReconcileRequired?: boolean | null,
 *     lastReconcileReason?: string | null,
 *   },
 *   observations?: any[] | null,
 * }} input
 */
export function summarizeSentInvitationSurfaceReconciliation(input) {
  const surface = input.surface ?? {};
  const observations = input.observations ?? [];
  const unresolvedObservationCount = observations
    .filter((observation) => shouldQueueConnectionRequestStatusReconciliation(observation))
    .length;
  const zeroItemCompleteSync = String(surface.key ?? "") === "linkedin-sent-invitations"
    && surface.lastRunStatus === "success"
    && (surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0) === 0
    && surface.lastCaptureCompleteness === "complete"
    && surface.lastExhaustionStatus === "complete";
  const reconcileRequired = unresolvedObservationCount > 0
    || surface.lastReconcileRequired === true;

  return {
    quiet: zeroItemCompleteSync && !reconcileRequired,
    reconcileRequired,
    reason: unresolvedObservationCount > 0
      ? CONNECTION_REQUEST_RECONCILIATION_REQUIRED_REASON
      : surface.lastReconcileReason ?? null,
    unresolvedObservationCount,
  };
}

/**
 * @param {any} profile
 * @returns {{
 *   nextKind: "connection_request_pending" | "connection_request_accepted" | "connection_request_not_accepted" | null,
 *   profileStatus: {
 *     networkDistance: string | null,
 *     isRelationship: boolean | null,
 *     invitationType: string | null,
 *     invitationStatus: string | null,
 *   }
 * }}
 */
export function classifyConnectionRequestProfileStatus(profile) {
  const networkDistance = normalizeNullableString(profile?.network_distance)?.toUpperCase() ?? null;
  const isRelationship = typeof profile?.is_relationship === "boolean" ? profile.is_relationship : null;
  const invitationType = normalizeNullableString(profile?.invitation?.type)?.toUpperCase() ?? null;
  const invitationStatus = normalizeNullableString(profile?.invitation?.status)?.toUpperCase() ?? null;
  const profileStatus = {
    networkDistance,
    isRelationship,
    invitationType,
    invitationStatus,
  };

  if (isRelationship === true || networkDistance === "FIRST_DEGREE" || invitationStatus === "ACCEPTED") {
    return { nextKind: "connection_request_accepted", profileStatus };
  }

  if (invitationType === "SENT" && invitationStatus === "PENDING") {
    return { nextKind: "connection_request_pending", profileStatus };
  }

  if (isRelationship === false && networkDistance && networkDistance !== "FIRST_DEGREE") {
    return { nextKind: "connection_request_not_accepted", profileStatus };
  }

  if (invitationStatus && invitationStatus !== "PENDING") {
    return { nextKind: "connection_request_not_accepted", profileStatus };
  }

  return { nextKind: null, profileStatus };
}

/**
 * @param {any} observation
 */
export function resolveConnectionRequestProfileIdentity(observation) {
  return normalizeNullableString(observation?.actorLinkedinPublicId)
    ?? normalizeNullableString(observation?.actorHandle)
    ?? extractLinkedinPublicId(observation?.actorProfileUrl)
    ?? normalizeNullableString(observation?.actorLinkedinMemberId)
    ?? null;
}

/** @param {string | null | undefined} value */
function normalizeNullableString(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}
