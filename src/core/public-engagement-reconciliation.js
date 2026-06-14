// @ts-check

import {
  CAPABILITY_SEAM_STATES,
  buildCapabilitySeamResult,
} from "./capability-seam-contract.js";

export const PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER = "src/core/public-engagement-reconciliation.js";

const PUBLIC_ENGAGEMENT_ACTIONS = Object.freeze({
  like_post: {
    proofSurfaces: ["linkedin-catch-up-updates"],
    stateKeys: ["action.post.like"],
    externalState: "post_reaction_created",
  },
  unlike_post: {
    proofSurfaces: ["linkedin-catch-up-updates"],
    stateKeys: ["action.post.un_like"],
    externalState: "post_reaction_removed",
  },
  create_post_comment: {
    proofSurfaces: ["linkedin-comment-replies", "linkedin-catch-up-updates"],
    stateKeys: ["action.post.comment"],
    externalState: "post_comment_created",
  },
  share_post: {
    proofSurfaces: ["linkedin-catch-up-updates"],
    stateKeys: ["action.post.share"],
    externalState: "post_shared",
  },
  create_comment_comment: {
    proofSurfaces: ["linkedin-comment-replies"],
    stateKeys: ["action.post.comment.reply.outbound"],
    externalState: "comment_reply_created",
  },
  create_comment_reaction: {
    proofSurfaces: ["linkedin-comment-replies"],
    stateKeys: ["action.post.comment.react.outbound"],
    externalState: "comment_reaction_created",
  },
});

const PUBLIC_ENGAGEMENT_TRUTH_SURFACES = Object.freeze({
  "linkedin-comment-replies": {
    stateKeys: ["public_reply_received", "comment_thread_updated"],
  },
  "linkedin-catch-up-updates": {
    stateKeys: ["catch_up_update_detected", "public_engagement_opportunity"],
  },
});

/**
 * @param {{
 *   row: any,
 *   actionKey?: string | null,
 *   resultKey?: string | null,
 *   surface?: string | null,
 *   proofFacts?: any[] | null,
 *   unsupportedProofSurfaces?: string[] | null,
 *   disabledProofSurfaces?: string[] | null,
 *   observedAt?: string | null,
 *   checkedAt?: string | null,
 * }} input
 */
export function reconcilePublicEngagementMutation(input) {
  const actionKey = normalizeNullableString(input?.actionKey ?? input?.row?.actionKey ?? input?.row?.capabilityKey);
  const definition = actionKey ? PUBLIC_ENGAGEMENT_ACTIONS[actionKey] : null;
  if (!actionKey || !definition) return null;

  const proofSurfaces = resolveProofSurfaces(input.row, definition.proofSurfaces);
  const row = buildPublicEngagementRow(input.row, {
    capabilityKey: actionKey,
    actionKey,
    proofSurfaces,
    stateKeys: resolveStateKeys(input.row, definition.stateKeys),
  });
  const resultKey = normalizeNullableString(input.resultKey) ?? "sent";
  const surface = normalizeNullableString(input.surface);
  const proofFacts = findExplicitActionProofFacts(input.proofFacts, actionKey, proofSurfaces);

  if (proofFacts.length) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "public_engagement_explicit_proof_observed",
      evidence: proofFacts,
      observedAt: resolveObservedAt(input.observedAt, proofFacts),
      checkedAt: input.checkedAt ?? null,
      debt: {
        kind: "public_engagement_mutation_reconciled",
        actionKey,
        resultKey,
        surface,
        externalState: definition.externalState,
      },
    });
  }

  const missingProofSurfaces = intersectProofSurfaces([
    ...normalizeStringList(input.unsupportedProofSurfaces),
    ...normalizeStringList(input.disabledProofSurfaces),
  ], proofSurfaces);

  if (missingProofSurfaces.length) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.MISSING_PROOF,
      reason: "public_engagement_proof_surface_unsupported",
      missingProofSurfaces,
      checkedAt: input.checkedAt ?? null,
      debt: {
        kind: "public_engagement_mutation_missing_proof",
        actionKey,
        resultKey,
        surface,
        externalState: definition.externalState,
        surfaceStatus: "unsupported",
      },
    });
  }

  return buildCapabilitySeamResult({
    row,
    state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
    reason: "public_engagement_external_proof_pending",
    checkedAt: input.checkedAt ?? null,
    debt: {
      kind: "public_engagement_mutation_pending_proof",
      actionKey,
      resultKey,
      surface,
      externalState: definition.externalState,
      proofSurfaces,
    },
  });
}

/**
 * @param {{
 *   row: any,
 *   surfaceKey?: string | null,
 *   proofFacts?: any[] | null,
 *   observedAt?: string | null,
 *   checkedAt?: string | null,
 * }} input
 */
export function reconcilePublicEngagementTruthSurface(input) {
  const surfaceKey = normalizeNullableString(input?.surfaceKey ?? input?.row?.surfaceKey ?? input?.row?.capabilityKey);
  const definition = surfaceKey ? PUBLIC_ENGAGEMENT_TRUTH_SURFACES[surfaceKey] : null;
  if (!surfaceKey || !definition) return null;

  const row = buildPublicEngagementRow(input.row, {
    capabilityKey: surfaceKey,
    surfaceKey,
    proofSurfaces: [surfaceKey],
    stateKeys: resolveStateKeys(input.row, definition.stateKeys),
  });
  const proofFacts = findExplicitSurfaceProofFacts(input.proofFacts, surfaceKey);

  if (proofFacts.length) {
    return buildCapabilitySeamResult({
      row,
      state: CAPABILITY_SEAM_STATES.QUIET,
      reason: "public_engagement_explicit_proof_observed",
      evidence: proofFacts,
      observedAt: resolveObservedAt(input.observedAt, proofFacts),
      checkedAt: input.checkedAt ?? null,
      debt: null,
    });
  }

  return buildCapabilitySeamResult({
    row,
    state: CAPABILITY_SEAM_STATES.UNSUPPORTED,
    reason: "autonomous_public_engagement_capture_unsupported",
    checkedAt: input.checkedAt ?? null,
    debt: {
      kind: "unsupported_autonomous_public_engagement_capture",
      surfaceKey,
      retrievalMode: "browser-capture",
      owner: PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER,
    },
  });
}

/**
 * @param {any} row
 * @param {{
 *   capabilityKey: string,
 *   actionKey?: string,
 *   surfaceKey?: string,
 *   proofSurfaces: string[],
 *   stateKeys: string[],
 * }} overrides
 */
function buildPublicEngagementRow(row, overrides) {
  return {
    ...(row ?? {}),
    capabilityKey: overrides.capabilityKey,
    actionKey: overrides.actionKey ?? row?.actionKey,
    surfaceKey: overrides.surfaceKey ?? row?.surfaceKey,
    proofSurfaces: overrides.proofSurfaces,
    stateKeys: overrides.stateKeys,
    reconcile: {
      ...(row?.reconcile ?? {}),
      owner: row?.reconcile?.owner ?? PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER,
    },
  };
}

/**
 * @param {any} row
 * @param {string[]} fallback
 */
function resolveProofSurfaces(row, fallback) {
  const proofSurfaces = normalizeStringList(row?.proofSurfaces);
  return proofSurfaces.length ? proofSurfaces : [...fallback];
}

/**
 * @param {any} row
 * @param {string[]} fallback
 */
function resolveStateKeys(row, fallback) {
  const stateKeys = normalizeStringList(row?.stateKeys);
  return stateKeys.length ? stateKeys : [...fallback];
}

/**
 * @param {any[] | null | undefined} facts
 * @param {string} actionKey
 * @param {string[]} proofSurfaces
 */
function findExplicitActionProofFacts(facts, actionKey, proofSurfaces) {
  return normalizeProofFacts(facts).filter((fact) => {
    const factActionKey = normalizeNullableString(fact.actionKey ?? fact.capabilityKey);
    const factSurfaceKey = normalizeProofFactSurface(fact);
    return factActionKey === actionKey
      && factSurfaceKey !== null
      && proofSurfaces.includes(factSurfaceKey)
      && hasExplicitProofIdentity(fact);
  });
}

/**
 * @param {any[] | null | undefined} facts
 * @param {string} surfaceKey
 */
function findExplicitSurfaceProofFacts(facts, surfaceKey) {
  return normalizeProofFacts(facts).filter((fact) =>
    normalizeProofFactSurface(fact) === surfaceKey && hasExplicitProofIdentity(fact)
  );
}

/**
 * @param {any} fact
 */
function normalizeProofFactSurface(fact) {
  return normalizeNullableString(fact.surfaceKey ?? fact.proofSurface ?? fact.surface);
}

/**
 * @param {any} fact
 */
function hasExplicitProofIdentity(fact) {
  return Boolean(normalizeNullableString(
    fact.proofId
      ?? fact.externalId
      ?? fact.observationId
      ?? fact.url
      ?? fact.targetUrl
      ?? fact.observedAt,
  ));
}

/**
 * @param {any[] | null | undefined} facts
 */
function normalizeProofFacts(facts) {
  if (!Array.isArray(facts)) return [];
  return facts.filter((fact) => fact && typeof fact === "object" && !Array.isArray(fact));
}

/**
 * @param {string | null | undefined} explicitObservedAt
 * @param {any[]} facts
 */
function resolveObservedAt(explicitObservedAt, facts) {
  return normalizeNullableString(explicitObservedAt)
    ?? normalizeNullableString(facts[0]?.observedAt)
    ?? null;
}

/**
 * @param {string[]} candidates
 * @param {string[]} proofSurfaces
 */
function intersectProofSurfaces(candidates, proofSurfaces) {
  const proofSurfaceSet = new Set(proofSurfaces);
  const result = [];
  for (const candidate of candidates) {
    if (proofSurfaceSet.has(candidate) && !result.includes(candidate)) {
      result.push(candidate);
    }
  }
  return result;
}

/**
 * @param {unknown} value
 */
function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeNullableString(item))
    .filter((item) => item !== null);
}

/**
 * @param {unknown} value
 */
function normalizeNullableString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}
