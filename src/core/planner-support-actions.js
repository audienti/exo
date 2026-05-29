// @ts-check

import { hasExhaustedEnrichmentState } from "../lib/prospect-contacts.js";

/**
 * @param {Array<{
 *   companyId: string,
 *   companyName: string,
 *   prospectId: string,
 *   name: string,
 *   title: string,
 *   hasEmailFallback: boolean,
 *   messageTestReady?: boolean,
 *   notes?: string | null,
 *   contactEnrichmentState?: { status?: string | null },
 *   cadenceState: {
 *     nextActionDueAt: string | null,
 *     lastTouchOutcome: string | null,
 *     notes?: string | null
 *   },
 *   openingPlan: {
 *     firstMove: string | null
 *   },
 *   nextAction: string | null
 * }>} prospects
 * @param {{
 *   companyId: string,
 *   companyName: string,
 *   prospectId: string,
 *   name: string,
 *   title: string,
 *   hasEmailFallback: boolean,
 *   messageTestReady?: boolean,
 *   notes?: string | null,
 *   contactEnrichmentState?: { status?: string | null },
 *   cadenceState: {
 *     nextActionDueAt: string | null,
 *     lastTouchOutcome: string | null,
 *     notes?: string | null
 *   },
 *   openingPlan: {
 *     firstMove: string | null
 *   },
 *   nextAction: string | null
 * }} waitingProspect
 */
export function selectParallelSupportAction(prospects, waitingProspect) {
  const sameAccountProspect = prospects.find((prospect) =>
    isEligibleUntouchedProspect(prospect, waitingProspect) && prospect.companyId === waitingProspect.companyId
  );

  if (sameAccountProspect) {
    return {
      kind: "parallel_same_account_first_touch",
      guidanceKey: "execute_first_touch",
      priority: "action",
      effect: "supporting_waiting_branch",
      dueAt: sameAccountProspect.cadenceState.nextActionDueAt ?? null,
      nextMove: sameAccountProspect.nextAction ?? sameAccountProspect.openingPlan.firstMove ?? `Execute the first planned touch for ${sameAccountProspect.name}.`,
      why: `${waitingProspect.name}'s primary branch is waiting on an external trigger, so the strongest action now is to work another ready prospect at ${waitingProspect.companyName}.`,
      company: sameAccountProspect,
      prospect: sameAccountProspect
    };
  }

  const sameAccountReserveProspect = prospects.find((prospect) =>
    isEligibleReserveEnrichmentProspect(prospect, waitingProspect)
    && prospect.companyId === waitingProspect.companyId
  );

  if (sameAccountReserveProspect && hasExhaustedContactEnrichment(waitingProspect)) {
    return {
      kind: "parallel_same_account_reserve_enrichment",
      guidanceKey: "find_contact_points",
      priority: "action",
      effect: "supporting_waiting_branch",
      dueAt: null,
      nextMove: `While ${waitingProspect.name}'s connection request is pending, try to find a verified direct email and other usable contact points for ${sameAccountReserveProspect.name} so the reserve path is stronger if the primary branch stalls.`,
      why: `${waitingProspect.name}'s primary branch is waiting, and the contact-enrichment pass on that branch is already exhausted. The strongest parallel move now is to deepen the held-in-reserve path for ${sameAccountReserveProspect.name} at ${waitingProspect.companyName}.`,
      company: sameAccountReserveProspect,
      prospect: sameAccountReserveProspect
    };
  }

  const otherProspect = prospects.find((prospect) =>
    isEligibleUntouchedProspect(prospect, waitingProspect) && prospect.companyId !== waitingProspect.companyId
  );

  if (otherProspect) {
    return {
      kind: "parallel_motion_first_touch",
      guidanceKey: "execute_first_touch",
      priority: "action",
      effect: "supporting_waiting_branch",
      dueAt: otherProspect.cadenceState.nextActionDueAt ?? null,
      nextMove: otherProspect.nextAction ?? otherProspect.openingPlan.firstMove ?? `Execute the first planned touch for ${otherProspect.name}.`,
      why: `${waitingProspect.name}'s primary branch is waiting on an external trigger, so the strongest action now is to work another ready prospect branch elsewhere in the motion.`,
      company: otherProspect,
      prospect: otherProspect
    };
  }

  if (!waitingProspect.hasEmailFallback) {
    return {
      kind: "parallel_contact_enrichment",
      guidanceKey: "find_contact_points",
      priority: "action",
      effect: "supporting_waiting_branch",
      dueAt: null,
      nextMove: `While ${waitingProspect.name}'s connection request is pending, try to find a verified direct email and other usable contact points for them in parallel.`,
      why: `${waitingProspect.name}'s primary branch is waiting on an external trigger. The best action now is parallel contact enrichment so the branch gains channel depth without replacing the live LinkedIn path.`,
      company: waitingProspect,
      prospect: waitingProspect
    };
  }

  return null;
}

/**
 * @param {{
 *   companyId: string,
 *   prospectId: string,
 *   messageTestReady?: boolean,
 *   notes?: string | null,
 *   contactEnrichmentState?: { status?: string | null },
 *   cadenceState: { lastTouchOutcome: string | null, notes?: string | null }
 * }} prospect
 * @param {{ prospectId: string }} waitingProspect
 */
function isEligibleUntouchedProspect(prospect, waitingProspect) {
  const notes = normalizeSupportNotes(prospect);

  if (prospect.prospectId === waitingProspect.prospectId) {
    return false;
  }

  if (notes.includes("on hold") || notes.includes("held behind") || notes.includes("wait for operator")) {
    return false;
  }

  if (prospect.messageTestReady === false) {
    return false;
  }

  return !prospect.cadenceState.lastTouchOutcome;
}

/**
 * @param {{
 *   companyId: string,
 *   prospectId: string,
 *   hasEmailFallback: boolean,
 *   messageTestReady?: boolean,
 *   notes?: string | null,
 *   contactEnrichmentState?: { status?: string | null },
 *   cadenceState: { lastTouchOutcome: string | null, notes?: string | null }
 * }} prospect
 * @param {{ prospectId: string }} waitingProspect
 */
function isEligibleReserveEnrichmentProspect(prospect, waitingProspect) {
  const notes = normalizeSupportNotes(prospect);

  if (prospect.prospectId === waitingProspect.prospectId) {
    return false;
  }

  if (!(notes.includes("held behind") || notes.includes("on hold") || notes.includes("wait for operator"))) {
    return false;
  }

  if (prospect.messageTestReady === false) {
    return false;
  }

  if (prospect.hasEmailFallback) {
    return false;
  }

  return !prospect.cadenceState.lastTouchOutcome;
}

/**
 * @param {{
 *   notes?: string | null,
 *   cadenceState: { notes?: string | null }
 * }} prospect
 */
function hasExhaustedContactEnrichment(prospect) {
  if (hasExhaustedEnrichmentState(prospect)) {
    return true;
  }

  const notes = normalizeSupportNotes(prospect);

  return (
    notes.includes("contact-enrichment pass")
    || notes.includes("contact enrichment pass")
    || notes.includes("no gmail hits")
    || notes.includes("no hubspot records")
    || notes.includes("do not store a direct email or phone until")
    || notes.includes("not strong enough to treat as verified fallback")
    || notes.includes("came up empty")
  );
}

/**
 * @param {{
 *   notes?: string | null,
 *   cadenceState: { notes?: string | null }
 * }} prospect
 */
function normalizeSupportNotes(prospect) {
  return `${prospect.notes ?? ""} ${prospect.cadenceState.notes ?? ""}`.toLowerCase();
}
