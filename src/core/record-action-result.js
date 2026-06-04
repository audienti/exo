// @ts-check

import { markMotionProspectDraftSent, setMotionProspectDraft } from "./set-prospect-draft.js";
import { recordMotionProspectTouch } from "./record-prospect-touch.js";
import { setMotionProspectCadence } from "./set-prospect-cadence.js";
import { transitionInboundObservation } from "./transition-inbound-observation.js";
import { findActionDefinition, normalizeActionKey } from "../lib/action-catalog.js";
import { findSupportedActionResult, normalizeActionResultKey } from "../lib/action-result-catalog.js";
import { isSendableDraftStatus } from "../lib/draft-policy.js";
import {
  findCompanyById,
  findInboundObservationById,
  findMotionById,
  listMotions,
  updateMotion,
} from "../db/database.js";

const DM_SURFACES = new Set(["post_accept_message", "follow_up_direct_message", "inbound_reply"]);

/**
 * @param {{
 *   actionKey: string,
 *   resultKey: string,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   motionId?: string | null,
 *   observationId?: string | null,
 *   surface?: string | null,
 *   occurredAt?: string | null,
 *   summary?: string | null,
 *   subject?: string | null,
 *   body?: string | null,
 *   sourceUrl?: string | null,
 *   notes?: string | null,
 *   nextAction?: string | null,
 *   nextActionDueAt?: string | null,
 * }} input
 */
export function recordActionResult(input) {
  const actionKey = normalizeActionKey(input.actionKey);
  const resultKey = normalizeActionResultKey(input.resultKey);

  if (!actionKey || !resultKey) {
    throw new Error("Action result requires actionKey and resultKey.");
  }

  const action = findActionDefinition(actionKey);
  if (!action) {
    throw new Error(`Action not found: ${input.actionKey}`);
  }

  const result = findSupportedActionResult(action.key, resultKey);
  if (!result) {
    throw new Error(`Unsupported result for ${action.key}: ${input.resultKey}`);
  }

  const ids = resolveTargetIds(input);
  if (result.requiresObservation && !ids.observationId) {
    throw new Error(`${action.key} ${result.key} requires --observation.`);
  }

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  let inboundObservationTransitionedTo = null;

  if (result.inboundTransitionKind && ids.observationId) {
    transitionInboundObservation({
      observationId: ids.observationId,
      nextKind: result.inboundTransitionKind,
      observedAt: occurredAt,
      summary: input.summary ?? null,
      notes: input.notes ?? null,
    });
    inboundObservationTransitionedTo = result.inboundTransitionKind;
  }

  // Observation-only path: a linked invite with no tracked prospect (a rejected
  // seller invite). The inbound transition above is the whole job — there's no
  // prospect to touch, advance, or message. Skip the prospect-centric work.
  if (!ids.companyId || !ids.prospectId) {
    return {
      ok: true,
      actionResult: {
        action,
        result,
        motionId: null,
        companyId: null,
        prospectId: null,
        observationId: ids.observationId,
        occurredAt,
        surface: null,
        touchRecorded: false,
        draftMarkedSent: false,
        cadenceUpdated: false,
        inboundObservationTransitionedTo,
        message: `${result.label} ${action.label.toLowerCase()} for ${ids.actorName ?? "this invite"}.`,
      },
    };
  }

  let { rawMotion, rawCompany, prospect } = loadTargetContext(ids);
  const surface = resolveSurface({ action, result, explicitSurface: input.surface ?? null, prospect });

  let touchRecorded = false;
  if (surface && result.touchDirection && result.touchOutcome) {
    const updated = recordMotionProspectTouch(rawMotion, rawCompany, {
      prospectId: ids.prospectId,
      surface,
      direction: result.touchDirection,
      outcome: result.touchOutcome,
      occurredAt,
      summary: input.summary ?? buildTouchSummary(action.label, result.label, prospect.name),
      subject: input.subject ?? null,
      body: input.body ?? null,
      sourceUrl: input.sourceUrl ?? null,
      notes: input.notes ?? null,
    });
    rawMotion = updateMotion(updated);
    prospect = requireProspect(rawMotion, ids.companyId, ids.prospectId);
    touchRecorded = true;
  }

  let draftMarkedSent = false;
  if (result.markDraftSent && surface) {
    const beforeStatus = prospect.drafts.find((draft) => draft.surface === surface)?.status ?? null;
    const updated = markMotionProspectDraftSent(rawMotion, rawCompany, {
      prospectId: ids.prospectId,
      surface,
    });
    rawMotion = updateMotion(updated);
    prospect = requireProspect(rawMotion, ids.companyId, ids.prospectId);
    const afterStatus = prospect.drafts.find((draft) => draft.surface === surface)?.status ?? null;
    draftMarkedSent = isSendableDraftStatus(beforeStatus) && afterStatus === "sent";
  }

  let draftMarkedDiscarded = false;
  if (result.markDraftDiscarded && surface) {
    const activeDraft = prospect.drafts.find((draft) =>
      draft.surface === surface && isSendableDraftStatus(draft.status)
    ) ?? null;
    if (activeDraft) {
      const updated = markMotionProspectDraftDiscarded(rawMotion, rawCompany, {
        prospectId: ids.prospectId,
        surface,
        notes: input.notes ?? activeDraft.notes ?? null,
      });
      rawMotion = updateMotion(updated);
      prospect = requireProspect(rawMotion, ids.companyId, ids.prospectId);
      draftMarkedDiscarded = prospect.drafts.some((draft) =>
        draft.surface === surface && draft.id === activeDraft.id && draft.status === "discarded"
      );
    }
  }

  const nextAction = input.nextAction !== undefined ? input.nextAction : result.defaultNextAction;
  const needsCadenceUpdate =
    result.cadenceStep !== undefined
    || nextAction !== undefined
    || input.nextActionDueAt !== undefined;

  let cadenceUpdated = false;
  if (needsCadenceUpdate) {
    const updated = setMotionProspectCadence(rawMotion, rawCompany, {
      prospectId: ids.prospectId,
      currentStep: result.cadenceStep ?? undefined,
      nextAction,
      nextActionDueAt: input.nextActionDueAt ?? undefined,
    });
    rawMotion = updateMotion(updated);
    prospect = requireProspect(rawMotion, ids.companyId, ids.prospectId);
    cadenceUpdated = true;
  }

  return {
    ok: true,
    actionResult: {
      action,
      result,
      motionId: rawMotion.id,
      companyId: ids.companyId,
      prospectId: ids.prospectId,
      observationId: ids.observationId,
      occurredAt,
      surface,
      touchRecorded,
      draftMarkedSent,
      draftMarkedDiscarded,
      cadenceUpdated,
      inboundObservationTransitionedTo,
      message: buildResultMessage(action.label, result.label, prospect.name),
    },
  };
}

/**
 * @param {{
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   motionId?: string | null,
 *   observationId?: string | null,
 * }} input
 */
function resolveTargetIds(input) {
  let companyId = input.companyId ?? null;
  let prospectId = input.prospectId ?? null;
  let motionId = input.motionId ?? null;
  const observationId = input.observationId ?? null;

  let actorName = null;
  if (observationId) {
    const observation = findInboundObservationById(observationId);
    if (!observation) {
      throw new Error(`Inbound observation not found: ${observationId}`);
    }
    companyId = companyId ?? observation.companyId ?? null;
    prospectId = prospectId ?? observation.prospectId ?? null;
    motionId = motionId ?? observation.motionId ?? null;
    actorName = observation.actorName ?? null;
  }

  // A linked observation can stand on its own (e.g. rejecting an inbound seller
  // invite that was never promoted to a prospect). Only demand a tracked prospect
  // when there's no observation to act on directly.
  if (!observationId && (!companyId || !prospectId)) {
    throw new Error("Action result requires a tracked prospect via --company/--prospect or a linked --observation.");
  }

  return { companyId, prospectId, motionId, observationId, actorName };
}

/**
 * @param {{ companyId: string, prospectId: string, motionId?: string | null }} ids
 */
function loadTargetContext(ids) {
  const rawCompany = findCompanyById(ids.companyId);
  if (!rawCompany) {
    throw new Error(`Company not found: ${ids.companyId}`);
  }

  let rawMotion = ids.motionId ? findMotionById(ids.motionId) : null;
  if (!rawMotion) {
    rawMotion = listMotions().find((motion) =>
      (motion.targetMap?.accounts ?? []).some((account) =>
        account.companyId === ids.companyId
        && (account.prospects ?? []).some((prospect) => prospect.id === ids.prospectId),
      ),
    ) ?? null;
  }

  if (!rawMotion) {
    throw new Error(`No motion targets prospect ${ids.prospectId} at company ${ids.companyId}.`);
  }

  const prospect = requireProspect(rawMotion, ids.companyId, ids.prospectId);
  return { rawMotion, rawCompany, prospect };
}

/**
 * @param {{
 *   action: ReturnType<typeof findActionDefinition>,
 *   result: ReturnType<typeof findSupportedActionResult>,
 *   explicitSurface: string | null,
 *   prospect: any,
 * }} input
 */
function resolveSurface(input) {
  if (input.explicitSurface) {
    if (input.result.allowedSurfaces?.length && !input.result.allowedSurfaces.includes(input.explicitSurface)) {
      throw new Error(`Surface ${input.explicitSurface} is not valid for ${input.action?.key} ${input.result?.key}.`);
    }
    return input.explicitSurface;
  }

  if (input.result.defaultSurface) {
    return input.result.defaultSurface;
  }

  if (input.action?.key === "send_direct_message") {
    const pendingDrafts = (input.prospect.drafts ?? []).filter((draft) =>
      DM_SURFACES.has(draft.surface) && isSendableDraftStatus(draft.status)
    );
    if (pendingDrafts.length === 1) {
      return pendingDrafts[0].surface;
    }
    if (input.prospect.cadenceState?.lastTouchOutcome === "accepted" && input.prospect.cadenceState?.currentStep === "connection-request") {
      return "post_accept_message";
    }
    if (input.prospect.cadenceState?.currentStep === "direct-message") {
      return "follow_up_direct_message";
    }
    throw new Error("send_direct_message requires --surface unless one approved direct-message draft or cadence branch makes the surface unambiguous.");
  }

  return null;
}

/**
 * @param {any} rawMotion
 * @param {string} companyId
 * @param {string} prospectId
 */
function requireProspect(rawMotion, companyId, prospectId) {
  const account = (rawMotion.targetMap?.accounts ?? []).find((item) => item.companyId === companyId) ?? null;
  const prospect = account?.prospects.find((item) => item.id === prospectId) ?? null;
  if (!prospect) {
    throw new Error(`Prospect not found on motion ${rawMotion.id}: ${prospectId}`);
  }
  return prospect;
}

/**
 * @param {any} rawMotion
 * @param {any} rawCompany
 * @param {{ prospectId: string, surface: string, notes?: string | null | undefined }} input
 */
function markMotionProspectDraftDiscarded(rawMotion, rawCompany, input) {
  const before = requireProspect(rawMotion, rawCompany.id, input.prospectId);
  const existing = before.drafts.find((draft) =>
    draft.surface === input.surface && isSendableDraftStatus(draft.status)
  ) ?? null;
  if (!existing) {
    return rawMotion;
  }

  return setMotionProspectDraft(rawMotion, rawCompany, {
    prospectId: input.prospectId,
    surface: input.surface,
    subject: existing.subject ?? null,
    body: existing.body ?? "",
    status: "discarded",
    authoredBy: existing.authoredBy ?? "agent",
    notes: input.notes ?? existing.notes ?? null,
  });
}

/**
 * @param {string} actionLabel
 * @param {string} resultLabel
 * @param {string} prospectName
 */
function buildTouchSummary(actionLabel, resultLabel, prospectName) {
  return `${resultLabel} ${actionLabel.toLowerCase()} for ${prospectName}.`;
}

/**
 * @param {string} actionLabel
 * @param {string} resultLabel
 * @param {string} prospectName
 */
function buildResultMessage(actionLabel, resultLabel, prospectName) {
  return `${resultLabel} ${actionLabel.toLowerCase()} for ${prospectName}.`;
}
