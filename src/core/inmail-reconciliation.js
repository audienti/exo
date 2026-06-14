// @ts-check

import {
  CAPABILITY_SEAM_STATES,
  buildCapabilitySeamResult,
} from "./capability-seam-contract.js";

export const INMAIL_RECONCILIATION_OWNER = "src/core/inmail-reconciliation.js";

const INMAIL_ACTION = "in_mail_message";
const INMAIL_EXTERNAL_STATE = "inmail_sent";

/**
 * @param {{
 *   row: any,
 *   actionKey?: string | null,
 *   resultKey?: string | null,
 *   surface?: string | null,
 *   occurredAt?: string | null,
 *   entitlement?: { available?: boolean | null, reason?: string | null } | null,
 *   proofFacts?: any[] | null,
 *   missingProofSurfaces?: string[] | null,
 *   checkedAt?: string | null,
 * }} input
 */
export function reconcileInmailMutation(input) {
  const actionKey = normalizeString(input.actionKey ?? input.row?.actionKey ?? input.row?.capabilityKey);
  if (actionKey !== INMAIL_ACTION) {
    return null;
  }

  const resultKey = normalizeString(input.resultKey ?? "sent");
  if (resultKey === "unavailable" || input.entitlement?.available === false) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.UNSUPPORTED,
      reason: "inmail_entitlement_missing",
      checkedAt: input.checkedAt,
      debt: buildInmailDebt(input, {
        entitlementStatus: "missing",
        entitlementReason: normalizeString(input.entitlement?.reason),
      }),
    });
  }

  const proofFacts = normalizeProofFacts(input.proofFacts);
  if (proofFacts.length > 0) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.RECONCILED,
      reason: "inmail_sent_proof_observed",
      evidence: proofFacts,
      observedAt: newestObservedAt(proofFacts),
      checkedAt: input.checkedAt,
      debt: buildInmailDebt(input, {
        clearedBy: "inmail_sent_proof",
      }),
    });
  }

  const missingProofSurfaces = normalizeStringList(input.missingProofSurfaces);
  if (missingProofSurfaces.length > 0) {
    return buildCapabilitySeamResult({
      row: input.row,
      state: CAPABILITY_SEAM_STATES.MISSING_PROOF,
      reason: "inmail_sent_proof_surfaces_missing",
      missingProofSurfaces,
      checkedAt: input.checkedAt,
      debt: buildInmailDebt(input, {
        surfaceStatus: "missing",
      }),
    });
  }

  return buildCapabilitySeamResult({
    row: input.row,
    state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
    reason: "inmail_external_proof_pending",
    checkedAt: input.checkedAt,
    debt: buildInmailDebt(input),
  });
}

/**
 * @param {{
 *   row: any,
 *   checkedAt?: string | null,
 * }} input
 */
export function reconcileInmailInboxSurface(input) {
  return buildCapabilitySeamResult({
    row: input.row,
    state: CAPABILITY_SEAM_STATES.UNSUPPORTED,
    reason: "inmail_inbox_surface_unsupported",
    checkedAt: input.checkedAt,
    debt: {
      surfaceKey: normalizeString(input.row?.surfaceKey ?? input.row?.capabilityKey),
      surfaceStatus: "unsupported",
    },
  });
}

/**
 * @param {{
 *   actionKey?: string | null,
 *   resultKey?: string | null,
 *   surface?: string | null,
 *   occurredAt?: string | null,
 * }} input
 * @param {Record<string, any>} [overrides]
 */
function buildInmailDebt(input, overrides = {}) {
  return {
    actionKey: normalizeString(input.actionKey) ?? INMAIL_ACTION,
    resultKey: normalizeString(input.resultKey) ?? "sent",
    surface: normalizeString(input.surface) ?? "in_mail_message",
    occurredAt: normalizeString(input.occurredAt),
    externalState: INMAIL_EXTERNAL_STATE,
    ...overrides,
  };
}

/** @param {unknown} value */
function normalizeProofFacts(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object").map((item) => ({ ...item }))
    : [];
}

/** @param {any[]} proofFacts */
function newestObservedAt(proofFacts) {
  return proofFacts
    .map((fact) => normalizeString(fact.observedAt ?? fact.sentAt ?? fact.checkedAt))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

/** @param {unknown} value */
function normalizeString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}

/** @param {unknown} value */
function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}
