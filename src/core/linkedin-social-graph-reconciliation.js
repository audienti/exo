// @ts-check

import {
  CAPABILITY_SEAM_STATES,
  buildCapabilitySeamResult,
} from "./capability-seam-contract.js";
import { extractLinkedinPublicId } from "../lib/prospect-contacts.js";

export const LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER = "src/core/linkedin-social-graph-reconciliation.js";

const LINKEDIN_FOLLOWERS_SURFACE = "linkedin-followers-list";
const LINKEDIN_FOLLOWING_SURFACE = "linkedin-following-list";
const LINKEDIN_PROFILE_VIEWS_SURFACE = "linkedin-profile-views";

const SOCIAL_GRAPH_SURFACES = new Set([
  LINKEDIN_FOLLOWERS_SURFACE,
  LINKEDIN_FOLLOWING_SURFACE,
  LINKEDIN_PROFILE_VIEWS_SURFACE,
]);

const FOLLOW_PRESENT_KINDS = new Set([
  "follow_state_changed",
  "follow_state_confirmed",
]);

const PROFILE_VIEW_AFTER_TOUCH_KIND = "profile_view_after_touch";

/**
 * @param {{
 *   row: any,
 *   surface?: any,
 *   observations?: any[] | null,
 *   checkedAt?: string | null,
 * }} input
 */
export function reconcileLinkedinSocialGraphSurface(input) {
  const surface = input.surface ?? {};
  const surfaceKey = resolveSurfaceKey(input.row, surface);
  const observations = normalizeObservationList(input.observations ?? surface.observations);
  const counts = summarizeSurfaceCounts(surface, observations);
  const checkedAt = normalizeNullableString(input.checkedAt)
    ?? normalizeNullableString(surface.checkedAt)
    ?? normalizeNullableString(surface.lastSyncedAt)
    ?? normalizeNullableString(surface.observedAt)
    ?? normalizeNullableString(surface.lastObservedAt);
  const observedAt = latestObservedAt(observations)
    ?? normalizeNullableString(surface.observedAt)
    ?? normalizeNullableString(surface.lastObservedAt);

  if (!SOCIAL_GRAPH_SURFACES.has(surfaceKey)) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.UNSUPPORTED,
      reason: "linkedin_social_graph_surface_unsupported",
      checkedAt,
      debt: {
        surfaceKey,
      },
    });
  }

  if (counts.countDiscrepancyCount > 0) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.CONTRADICTED,
      reason: "linkedin_social_graph_visible_total_contradiction",
      evidence: buildObservationEvidence(observations),
      observedAt,
      checkedAt,
      debt: buildSurfaceDebt({
        surfaceKey,
        coverage: "visible_total_contradiction",
        counts,
        nextSyncMode: "repair_count_discrepancy",
      }),
    });
  }

  if (counts.itemizationGapCount > 0 || !counts.completeItemization) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.STALE,
      reason: "linkedin_social_graph_partial_itemization_gap",
      evidence: buildObservationEvidence(observations),
      observedAt,
      checkedAt,
      debt: buildSurfaceDebt({
        surfaceKey,
        coverage: "partial_itemization_gap",
        counts,
        nextSyncMode: "resume_itemization",
      }),
    });
  }

  if (surfaceKey === LINKEDIN_PROFILE_VIEWS_SURFACE && hasProfileViewAfterTouch(observations)) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "linkedin_profile_view_after_touch_observed",
      evidence: buildObservationEvidence(observations),
      observedAt,
      checkedAt,
      debt: buildSurfaceDebt({
        surfaceKey,
        coverage: "complete_itemized_sync",
        counts,
        nextSyncMode: "cadenced",
      }),
    });
  }

  return buildCapabilitySeamResult({
    row: input.row,
    state: CAPABILITY_SEAM_STATES.QUIET,
    reason: "linkedin_social_graph_complete_itemized_sync",
    evidence: buildObservationEvidence(observations),
    observedAt,
    checkedAt,
    debt: buildSurfaceDebt({
      surfaceKey,
      coverage: "complete_itemized_sync",
      counts,
      nextSyncMode: "cadenced",
    }),
  });
}

/**
 * @param {{
 *   row: any,
 *   actionKey?: string | null,
 *   resultKey?: string | null,
 *   surface?: string | null,
 *   target?: any,
 *   touchedAt?: string | null,
 *   actionAt?: string | null,
 *   observations?: any[] | null,
 *   followingObservations?: any[] | null,
 *   profileViewObservations?: any[] | null,
 *   followingSurface?: any,
 *   profileViewSurface?: any,
 *   checkedAt?: string | null,
 * }} input
 */
export function reconcileLinkedinSocialGraphMutation(input) {
  const actionKey = normalizeNullableString(input.actionKey) ?? normalizeNullableString(input.row?.actionKey);
  const resultKey = normalizeNullableString(input.resultKey);

  if (resultKey && resultKey !== "sent") {
    return null;
  }

  if (actionKey === "follow") {
    return reconcileFollowMutation(input);
  }

  if (actionKey === "unfollow") {
    return reconcileUnfollowMutation(input);
  }

  if (actionKey === "profile_view") {
    return reconcileProfileViewMutation(input);
  }

  return null;
}

/**
 * @param {Parameters<typeof reconcileLinkedinSocialGraphMutation>[0]} input
 */
function reconcileFollowMutation(input) {
  const followingSurface = input.followingSurface ?? {};
  const observations = normalizeObservationList(
    input.followingObservations ?? input.observations ?? followingSurface.observations,
  );
  const proof = findMatchingObservation(observations, input.target, FOLLOW_PRESENT_KINDS);
  const checkedAt = resolveMutationCheckedAt(input, followingSurface);

  if (proof) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "linkedin_following_list_proof_observed",
      evidence: [buildObservationEvidenceItem(proof)],
      observedAt: normalizeNullableString(proof.observedAt),
      checkedAt,
      debt: buildMutationDebt({
        actionKey: "follow",
        surface: input.surface ?? "follow",
        proofSurface: LINKEDIN_FOLLOWING_SURFACE,
        externalState: "followed",
        target: input.target,
        clearedBy: proof.kind,
      }),
    });
  }

  return buildCapabilitySeamResult({
    row: input.row,
    state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
    reason: "linkedin_follow_pending_following_list_proof",
    evidence: [],
    checkedAt,
    debt: buildMutationDebt({
      actionKey: "follow",
      surface: input.surface ?? "follow",
      proofSurface: LINKEDIN_FOLLOWING_SURFACE,
      externalState: "followed",
      target: input.target,
      clearedBy: null,
    }),
  });
}

/**
 * @param {Parameters<typeof reconcileLinkedinSocialGraphMutation>[0]} input
 */
function reconcileUnfollowMutation(input) {
  const followingSurface = input.followingSurface ?? {};
  const observations = normalizeObservationList(
    input.followingObservations ?? input.observations ?? followingSurface.observations,
  );
  const proof = findMatchingObservation(observations, input.target, FOLLOW_PRESENT_KINDS);
  const counts = summarizeSurfaceCounts(followingSurface, observations);
  const checkedAt = resolveMutationCheckedAt(input, followingSurface);

  if (proof) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
      reason: "linkedin_unfollow_still_present_on_following_list",
      evidence: [buildObservationEvidenceItem(proof)],
      observedAt: normalizeNullableString(proof.observedAt),
      checkedAt,
      debt: buildMutationDebt({
        actionKey: "unfollow",
        surface: input.surface ?? "unfollow",
        proofSurface: LINKEDIN_FOLLOWING_SURFACE,
        externalState: "unfollowed",
        target: input.target,
        clearedBy: null,
      }),
    });
  }

  if (counts.completeItemization && counts.countDiscrepancyCount === 0 && counts.itemizationGapCount === 0) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "linkedin_unfollow_absence_proof_observed",
      evidence: [{
        surfaceKey: LINKEDIN_FOLLOWING_SURFACE,
        itemCount: counts.itemCount,
        visibleTotalCount: counts.visibleTotalCount,
        observedAt: normalizeNullableString(followingSurface.observedAt) ?? normalizeNullableString(followingSurface.lastObservedAt),
      }],
      observedAt: normalizeNullableString(followingSurface.observedAt) ?? normalizeNullableString(followingSurface.lastObservedAt),
      checkedAt,
      debt: buildMutationDebt({
        actionKey: "unfollow",
        surface: input.surface ?? "unfollow",
        proofSurface: LINKEDIN_FOLLOWING_SURFACE,
        externalState: "unfollowed",
        target: input.target,
        clearedBy: "complete_absence_proof",
      }),
    });
  }

  return buildCapabilitySeamResult({
    row: input.row,
    state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
    reason: "linkedin_unfollow_requires_complete_following_list_absence_proof",
    evidence: [],
    checkedAt,
    debt: buildMutationDebt({
      actionKey: "unfollow",
      surface: input.surface ?? "unfollow",
      proofSurface: LINKEDIN_FOLLOWING_SURFACE,
      externalState: "unfollowed",
      target: input.target,
      clearedBy: null,
    }),
  });
}

/**
 * @param {Parameters<typeof reconcileLinkedinSocialGraphMutation>[0]} input
 */
function reconcileProfileViewMutation(input) {
  const profileViewSurface = input.profileViewSurface ?? {};
  const observations = normalizeObservationList(
    input.profileViewObservations ?? input.observations ?? profileViewSurface.observations,
  );
  const touchedAt = normalizeNullableString(input.touchedAt) ?? normalizeNullableString(input.actionAt);
  const proof = observations.find((observation) =>
    observation.kind === PROFILE_VIEW_AFTER_TOUCH_KIND
    && observationMatchesTarget(observation, input.target)
    && observationHappenedAfter(observation, touchedAt)
  );
  const checkedAt = resolveMutationCheckedAt(input, profileViewSurface);

  if (proof) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "linkedin_profile_view_after_touch_observed",
      evidence: [buildObservationEvidenceItem(proof)],
      observedAt: normalizeNullableString(proof.eventAt) ?? normalizeNullableString(proof.observedAt),
      checkedAt,
      debt: buildMutationDebt({
        actionKey: "profile_view",
        surface: input.surface ?? "profile_view",
        proofSurface: LINKEDIN_PROFILE_VIEWS_SURFACE,
        externalState: "profile_view_after_touch",
        target: input.target,
        clearedBy: proof.kind,
      }),
    });
  }

  return buildCapabilitySeamResult({
    row: input.row,
    state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
    reason: "linkedin_profile_view_after_touch_pending",
    evidence: [],
    checkedAt,
    debt: buildMutationDebt({
      actionKey: "profile_view",
      surface: input.surface ?? "profile_view",
      proofSurface: LINKEDIN_PROFILE_VIEWS_SURFACE,
      externalState: "profile_view_after_touch",
      target: input.target,
      clearedBy: null,
    }),
  });
}

/**
 * @param {any} row
 * @param {any} surface
 */
function resolveSurfaceKey(row, surface) {
  return normalizeNullableString(surface.surfaceKey)
    ?? normalizeNullableString(surface.key)
    ?? normalizeNullableString(row?.surfaceKey)
    ?? normalizeNullableString(row?.capabilityKey)
    ?? "";
}

/**
 * @param {unknown} value
 */
function normalizeObservationList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

/**
 * @param {any} surface
 * @param {any[]} observations
 */
function summarizeSurfaceCounts(surface, observations) {
  const itemCount = normalizeInteger(
    surface.itemCount
      ?? surface.lastItemCount
      ?? surface.observationCount
      ?? surface.lastObservationCount
      ?? observations.length,
    observations.length,
  );
  const visibleTotalCount = normalizeOptionalInteger(
    surface.visibleTotalCount
      ?? surface.lastVisibleTotalCount,
  );
  const captureCompleteness = normalizeNullableString(surface.captureCompleteness)
    ?? normalizeNullableString(surface.lastCaptureCompleteness)
    ?? "complete";
  const exhaustionStatus = normalizeNullableString(surface.exhaustionStatus)
    ?? normalizeNullableString(surface.lastExhaustionStatus)
    ?? "complete";
  const status = normalizeNullableString(surface.status)
    ?? normalizeNullableString(surface.lastRunStatus)
    ?? "success";
  const nextStartOffset = normalizeOptionalInteger(surface.nextStartOffset ?? surface.lastNextStartOffset);
  const providedItemizationGap = normalizeOptionalInteger(surface.itemizationGapCount ?? surface.lastItemizationGapCount);
  const providedCountDiscrepancy = normalizeOptionalInteger(surface.countDiscrepancyCount ?? surface.lastCountDiscrepancyCount);
  const visibleTotalGap = visibleTotalCount === null ? 0 : Math.max(visibleTotalCount - itemCount, 0);
  const visibleTotalContradiction = visibleTotalCount === null ? 0 : Math.max(itemCount - visibleTotalCount, 0);
  const incomplete = status !== "success"
    || captureCompleteness !== "complete"
    || exhaustionStatus !== "complete"
    || nextStartOffset !== null;
  const itemizationGapCount = Math.max(
    providedItemizationGap ?? 0,
    visibleTotalGap,
    incomplete ? visibleTotalGap : 0,
  );
  const countDiscrepancyCount = Math.max(
    providedCountDiscrepancy ?? 0,
    visibleTotalContradiction,
  );

  return {
    itemCount,
    visibleTotalCount,
    observationCount: observations.length,
    captureCompleteness,
    exhaustionStatus,
    status,
    nextStartOffset,
    itemizationGapCount,
    countDiscrepancyCount,
    completeItemization: !incomplete
      && itemizationGapCount === 0
      && countDiscrepancyCount === 0,
  };
}

/**
 * @param {{
 *   surfaceKey: string,
 *   coverage: string,
 *   counts: ReturnType<typeof summarizeSurfaceCounts>,
 *   nextSyncMode: string,
 * }} input
 */
function buildSurfaceDebt(input) {
  return {
    surfaceKey: input.surfaceKey,
    coverage: input.coverage,
    itemCount: input.counts.itemCount,
    visibleTotalCount: input.counts.visibleTotalCount,
    observationCount: input.counts.observationCount,
    itemizationGapCount: input.counts.itemizationGapCount,
    countDiscrepancyCount: input.counts.countDiscrepancyCount,
    captureCompleteness: input.counts.captureCompleteness,
    exhaustionStatus: input.counts.exhaustionStatus,
    nextSync: {
      mode: input.nextSyncMode,
      nextStartOffset: input.counts.nextStartOffset,
      repeatedBroadPollingRequired: false,
    },
  };
}

/**
 * @param {{
 *   actionKey: string,
 *   surface: string | null,
 *   proofSurface: string,
 *   externalState: string,
 *   target: any,
 *   clearedBy: string | null,
 * }} input
 */
function buildMutationDebt(input) {
  return {
    actionKey: input.actionKey,
    surface: input.surface,
    proofSurface: input.proofSurface,
    externalState: input.externalState,
    targetIdentity: buildTargetIdentity(input.target),
    clearedBy: input.clearedBy,
  };
}

/**
 * @param {any[]} observations
 */
function buildObservationEvidence(observations) {
  return observations.map(buildObservationEvidenceItem);
}

/**
 * @param {any} observation
 */
function buildObservationEvidenceItem(observation) {
  return {
    id: normalizeNullableString(observation.id),
    kind: normalizeNullableString(observation.kind),
    externalId: normalizeNullableString(observation.externalId),
    actorName: normalizeNullableString(observation.actorName),
    actorProfileUrl: normalizeNullableString(observation.actorProfileUrl),
    actorLinkedinPublicId: resolveObservationPublicId(observation),
    observedAt: normalizeNullableString(observation.observedAt),
    eventAt: normalizeNullableString(observation.eventAt),
  };
}

/**
 * @param {any[]} observations
 */
function hasProfileViewAfterTouch(observations) {
  return observations.some((observation) => observation.kind === PROFILE_VIEW_AFTER_TOUCH_KIND);
}

/**
 * @param {any[]} observations
 */
function latestObservedAt(observations) {
  return observations
    .map((observation) => normalizeNullableString(observation.observedAt) ?? normalizeNullableString(observation.eventAt))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

/**
 * @param {any[]} observations
 * @param {any} target
 * @param {Set<string>} allowedKinds
 */
function findMatchingObservation(observations, target, allowedKinds) {
  return observations.find((observation) =>
    allowedKinds.has(String(observation.kind ?? ""))
    && observationMatchesTarget(observation, target)
  ) ?? null;
}

/**
 * @param {any} observation
 * @param {any} target
 */
function observationMatchesTarget(observation, target) {
  const targetIdentities = new Set(buildTargetIdentityValues(target));
  if (targetIdentities.size === 0) return false;
  return buildObservationIdentityValues(observation).some((value) => targetIdentities.has(value));
}

/**
 * @param {any} observation
 * @param {string | null} touchedAt
 */
function observationHappenedAfter(observation, touchedAt) {
  if (!touchedAt) return true;
  const happenedAt = normalizeNullableString(observation.eventAt) ?? normalizeNullableString(observation.observedAt);
  return Boolean(happenedAt && happenedAt >= touchedAt);
}

/**
 * @param {Parameters<typeof reconcileLinkedinSocialGraphMutation>[0]} input
 * @param {any} surface
 */
function resolveMutationCheckedAt(input, surface) {
  return normalizeNullableString(input.checkedAt)
    ?? normalizeNullableString(surface.checkedAt)
    ?? normalizeNullableString(surface.lastSyncedAt)
    ?? normalizeNullableString(surface.observedAt)
    ?? normalizeNullableString(surface.lastObservedAt);
}

/**
 * @param {any} target
 */
function buildTargetIdentity(target) {
  const values = buildTargetIdentityValues(target);
  return {
    linkedinPublicId: values[0] ?? null,
    values,
  };
}

/**
 * @param {any} target
 */
function buildTargetIdentityValues(target) {
  return uniqueStrings([
    target?.linkedinPublicId,
    target?.actorLinkedinPublicId,
    target?.actorHandle,
    target?.handle,
    target?.linkedinHandle,
    extractLinkedinPublicId(target?.linkedinProfileUrl),
    extractLinkedinPublicId(target?.actorProfileUrl),
    extractLinkedinPublicId(target?.profileUrl),
    target?.linkedinMemberId,
    target?.actorLinkedinMemberId,
  ]);
}

/**
 * @param {any} observation
 */
function buildObservationIdentityValues(observation) {
  return uniqueStrings([
    observation?.actorLinkedinPublicId,
    observation?.actorHandle,
    observation?.handle,
    extractLinkedinPublicId(observation?.actorProfileUrl),
    extractLinkedinPublicId(observation?.profileUrl),
    observation?.actorLinkedinMemberId,
  ]);
}

/**
 * @param {any} observation
 */
function resolveObservationPublicId(observation) {
  return normalizeNullableString(observation.actorLinkedinPublicId)
    ?? normalizeNullableString(observation.actorHandle)
    ?? extractLinkedinPublicId(observation.actorProfileUrl)
    ?? null;
}

/**
 * @param {unknown[]} values
 */
function uniqueStrings(values) {
  return [...new Set(values
    .map((value) => normalizeNullableString(value))
    .filter(Boolean))];
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(Math.trunc(numeric), 0);
}

/**
 * @param {unknown} value
 */
function normalizeOptionalInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(Math.trunc(numeric), 0);
}

/** @param {unknown} value */
function normalizeNullableString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}
