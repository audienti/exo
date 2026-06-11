// @ts-check

const PACKET_KINDS = new Set(["company_research", "prospect_selection", "prospect_research"]);
const TERMINAL_REASONS = new Set(["not_a_fit", "no_longer_target", "exhausted"]);

/**
 * @param {Record<string, any>} motion
 * @param {"company_research" | "prospect_selection" | "prospect_research"} packetKind
 * @returns {"auto" | "review"}
 */
export function resolvePacketReviewMode(motion, packetKind) {
  const policy = motion.packetReviewPolicy ?? "auto";
  if (policy === "review") return "review";
  if (policy === "auto" || !policy || typeof policy !== "object" || Array.isArray(policy)) return "auto";

  const direct = normalizeMode(policy[packetKind]);
  if (direct) return direct;

  const fallback = normalizeMode(policy.default);
  return fallback ?? "auto";
}

/**
 * @param {"company_research" | "prospect_selection"} packetKind
 * @param {{
 *   outcome?: string | null | undefined,
 *   nextStatus?: string | null | undefined,
 *   notes?: string | null | undefined,
 *   reason?: string | null | undefined,
 *   workerLabel?: string | null | undefined
 * }} input
 * @param {string} now
 */
export function buildAccountPacketProposal(packetKind, input, now) {
  const outcome = normalizeAccountOutcome(packetKind, input.outcome, input.nextStatus);
  const reason = normalizeNullableString(input.reason) ?? normalizeNullableString(input.notes);
  return {
    kind: packetKind,
    action: outcome.action,
    nextStatus: outcome.nextStatus,
    disposition: outcome.disposition,
    reason,
    notes: normalizeNullableString(input.notes),
    workerLabel: normalizeNullableString(input.workerLabel),
    proposedAt: now,
  };
}

/**
 * @param {"prospect_research"} packetKind
 * @param {{
 *   outcome?: string | null | undefined,
 *   nextStatus?: string | null | undefined,
 *   notes?: string | null | undefined,
 *   reason?: string | null | undefined,
 *   workerLabel?: string | null | undefined
 * }} input
 * @param {string} now
 */
export function buildProspectPacketProposal(packetKind, input, now) {
  const outcome = normalizeProspectOutcome(input.outcome, input.nextStatus);
  const reason = normalizeNullableString(input.reason) ?? normalizeNullableString(input.notes);
  return {
    kind: packetKind,
    action: outcome.action,
    nextStatus: outcome.nextStatus,
    disposition: outcome.disposition,
    reason,
    notes: normalizeNullableString(input.notes),
    workerLabel: normalizeNullableString(input.workerLabel),
    proposedAt: now,
  };
}

/**
 * @param {unknown} proposal
 * @param {unknown} fallback
 * @returns {Record<string, any>}
 */
export function resolveStoredPacketProposal(proposal, fallback) {
  if (proposal && typeof proposal === "object" && !Array.isArray(proposal)) {
    return /** @type {Record<string, any>} */ (proposal);
  }
  if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
    return /** @type {Record<string, any>} */ (fallback);
  }
  throw new Error("Packet review decision requires a stored or explicit proposal.");
}

/**
 * @param {Record<string, any>} proposal
 */
export function completionInputFromProposal(proposal) {
  if (proposal.action === "no_longer_target" || proposal.action === "not_a_fit") {
    return { nextStatus: "suppressed" };
  }
  if (proposal.action === "exhausted") {
    return { nextStatus: "exhausted" };
  }
  if (proposal.action === "advance") {
    return { nextStatus: proposal.nextStatus ?? undefined };
  }
  return { nextStatus: undefined };
}

/**
 * @param {Record<string, any>} proposal
 */
export function dispositionFromProposal(proposal) {
  const disposition = normalizeNullableString(proposal.disposition);
  if (disposition) return disposition;
  if (proposal.action === "nurture") return "nurture";
  if (proposal.action === "no_longer_target") return "no_longer_target";
  if (proposal.action === "not_a_fit") return "not_a_fit";
  if (proposal.action === "exhausted") return "exhausted";
  return null;
}

/**
 * @param {Record<string, any>} proposal
 */
export function requiresDisposition(proposal) {
  return proposal.action === "nurture" || TERMINAL_REASONS.has(String(proposal.action));
}

/**
 * @param {unknown} value
 * @returns {"auto" | "review" | null}
 */
function normalizeMode(value) {
  return value === "auto" || value === "review" ? value : null;
}

/**
 * @param {"company_research" | "prospect_selection"} packetKind
 * @param {string | null | undefined} outcome
 * @param {string | null | undefined} nextStatus
 */
function normalizeAccountOutcome(packetKind, outcome, nextStatus) {
  const normalized = normalizeNullableString(outcome);
  if (normalized === "nurture") {
    return { action: "nurture", nextStatus: null, disposition: "nurture" };
  }
  if (normalized === "no_longer_target" || normalized === "not_a_fit") {
    return { action: "no_longer_target", nextStatus: "suppressed", disposition: "no_longer_target" };
  }
  if (normalized === "exhausted") {
    return { action: "exhausted", nextStatus: "exhausted", disposition: "exhausted" };
  }
  if (nextStatus === "suppressed") {
    return { action: "no_longer_target", nextStatus: "suppressed", disposition: "no_longer_target" };
  }
  if (nextStatus === "exhausted") {
    return { action: "exhausted", nextStatus: "exhausted", disposition: "exhausted" };
  }
  return { action: "advance", nextStatus: nextStatus ?? (packetKind === "company_research" ? "researched" : null), disposition: null };
}

/**
 * @param {string | null | undefined} outcome
 * @param {string | null | undefined} nextStatus
 */
function normalizeProspectOutcome(outcome, nextStatus) {
  const normalized = normalizeNullableString(outcome);
  if (normalized === "nurture") {
    return { action: "nurture", nextStatus: null, disposition: "nurture" };
  }
  if (normalized === "not_a_fit" || normalized === "no_longer_target") {
    return { action: "not_a_fit", nextStatus: "suppressed", disposition: "not_a_fit" };
  }
  if (normalized === "exhausted") {
    return { action: "exhausted", nextStatus: "exhausted", disposition: "exhausted" };
  }
  if (nextStatus === "suppressed") {
    return { action: "not_a_fit", nextStatus: "suppressed", disposition: "not_a_fit" };
  }
  if (nextStatus === "exhausted") {
    return { action: "exhausted", nextStatus: "exhausted", disposition: "exhausted" };
  }
  return { action: "advance", nextStatus: null, disposition: null };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
