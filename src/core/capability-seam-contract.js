// @ts-check

export const CAPABILITY_SEAM_STATES = Object.freeze({
  QUIET: "quiet",
  PENDING_PROOF: "pending_proof",
  CONTRADICTED: "contradicted",
  STALE: "stale",
  RECONCILED: "reconciled",
  UNSUPPORTED: "unsupported",
  MISSING_PROOF: "missing_proof",
});

const CHECKED_STATES = new Set([
  CAPABILITY_SEAM_STATES.QUIET,
  CAPABILITY_SEAM_STATES.RECONCILED,
]);

const ACTION_REQUIRED_STATES = new Set([
  CAPABILITY_SEAM_STATES.PENDING_PROOF,
  CAPABILITY_SEAM_STATES.CONTRADICTED,
  CAPABILITY_SEAM_STATES.STALE,
  CAPABILITY_SEAM_STATES.MISSING_PROOF,
]);

const KNOWN_STATES = new Set(Object.values(CAPABILITY_SEAM_STATES));

/**
 * Normalize a service-specific reconciliation decision into one shared backend
 * contract. Service owners keep their domain logic; shared queue and review paths
 * get one stable shape.
 *
 * @param {{
 *   row: any,
 *   state: string,
 *   reason: string,
 *   proofSurfaces?: string[] | null,
 *   missingProofSurfaces?: string[] | null,
 *   stateKeys?: string[] | null,
 *   evidence?: any[] | null,
 *   observedAt?: string | null,
 *   checkedAt?: string | null,
 *   debt?: any,
 * }} input
 */
export function buildCapabilitySeamResult(input) {
  const row = input.row ?? {};
  const capabilityKey = requireNonEmptyString(row.capabilityKey, "Capability seam row must include capabilityKey");
  const state = normalizeState(input.state);
  const proofSurfaces = requireStringList(
    input.proofSurfaces ?? row.proofSurfaces,
    `${capabilityKey} must include proof surfaces`,
  );
  const stateKeys = requireStringList(
    input.stateKeys ?? row.stateKeys,
    `${capabilityKey} must include state keys`,
  );
  const providedMissingProofSurfaces = normalizeOptionalStringList(input.missingProofSurfaces);
  const missingProofSurfaces = state === CAPABILITY_SEAM_STATES.MISSING_PROOF
    ? providedMissingProofSurfaces.length
      ? providedMissingProofSurfaces
      : [...proofSurfaces]
    : providedMissingProofSurfaces;
  const reason = requireNonEmptyString(input.reason, `${capabilityKey} must include a seam result reason`);

  return {
    capabilityKey,
    rowId: typeof row.id === "string" && row.id.length ? row.id : null,
    service: typeof row.service === "string" && row.service.length ? row.service : null,
    owner: typeof row.reconcile?.owner === "string" && row.reconcile.owner.length ? row.reconcile.owner : null,
    state,
    quiet: CHECKED_STATES.has(state),
    checked: CHECKED_STATES.has(state),
    supported: state !== CAPABILITY_SEAM_STATES.UNSUPPORTED,
    requiresAction: ACTION_REQUIRED_STATES.has(state),
    reason,
    proofSurfaces,
    missingProofSurfaces,
    stateKeys,
    evidence: cloneArray(input.evidence),
    observedAt: normalizeNullableString(input.observedAt),
    checkedAt: normalizeNullableString(input.checkedAt),
    debt: input.debt ?? null,
    strategies: {
      sync: normalizeNullableString(row.syncStrategy),
      reconciliation: normalizeNullableString(row.reconciliationStrategy),
      mutationDebt: normalizeNullableString(row.mutationDebtPolicy),
    },
  };
}

/**
 * @param {string} value
 */
function normalizeState(value) {
  const normalized = String(value ?? "").trim();
  if (!KNOWN_STATES.has(normalized)) {
    throw new Error(`Unknown capability seam state: ${normalized || "<empty>"}`);
  }
  return normalized;
}

/**
 * @param {unknown} value
 * @param {string} message
 */
function requireStringList(value, message) {
  const normalized = normalizeOptionalStringList(value);
  if (normalized.length === 0) {
    throw new Error(message);
  }
  return normalized;
}

/**
 * @param {unknown} value
 */
function normalizeOptionalStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

/**
 * @param {unknown} value
 * @param {string} message
 */
function requireNonEmptyString(value, message) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

/**
 * @param {unknown} value
 */
function normalizeNullableString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {unknown} value
 */
function cloneArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return { ...item };
    }
    return item;
  });
}
