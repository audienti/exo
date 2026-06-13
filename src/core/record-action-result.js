// @ts-check

import { autoPromoteInboundAccepts } from "./auto-promote-inbound-accepts.js";
import { buildConnectionRequestMutationReconciliation } from "./connection-request-reconciliation.js";
import { transitionInboundObservation } from "./transition-inbound-observation.js";
import { findActionDefinition, normalizeActionKey } from "../lib/action-catalog.js";
import { findSupportedActionResult, normalizeActionResultKey } from "../lib/action-result-catalog.js";
import { isSendableDraftStatus } from "../lib/draft-policy.js";
import {
  appendActivityEvent,
  findCompanyById,
  findActiveProspectDraftBySurface,
  findCrossMotionOwner,
  findInboundObservationById,
  findMotionById,
  findProspectById,
  getLocalDatabase,
  listMotions,
  transitionProspectDraftStatus,
  updateProspectCadence,
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
    const transitioned = transitionInboundObservation({
      observationId: ids.observationId,
      nextKind: result.inboundTransitionKind,
      observedAt: occurredAt,
      summary: input.summary ?? null,
      notes: input.notes ?? null,
    });
    inboundObservationTransitionedTo = result.inboundTransitionKind;
    if (result.inboundTransitionKind === "connection_request_accepted") {
      void autoPromoteInboundAccepts({ userId: transitioned.existing?.userId ?? null }).catch(() => {
        // Best-effort: the authoritative accept already landed.
      });
    }
  }

  // Observation-only path: a linked invite with no tracked prospect (a rejected
  // seller invite). The inbound transition above is the whole job — there's no
  // prospect to touch, advance, or message. Skip the prospect-centric work.
  if (!ids.companyId || !ids.prospectId) {
    const reconciliation = buildActionResultReconciliation({
      actionKey: action.key,
      resultKey: result.key,
      surface: null,
      observationId: ids.observationId,
      inboundObservationTransitionedTo,
    });
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
        reconciliation,
        message: `${result.label} ${action.label.toLowerCase()} for ${ids.actorName ?? "this invite"}.`,
      },
    };
  }

  let { rawMotion, prospect } = loadTargetContext(ids);
  const surface = resolveSurface({ action, result, explicitSurface: input.surface ?? null, prospect });
  const reconciliation = buildActionResultReconciliation({
    actionKey: action.key,
    resultKey: result.key,
    surface,
    observationId: ids.observationId,
    inboundObservationTransitionedTo,
  });
  const sentDraft = surface && result.markDraftSent
    ? findSendableDraftForSurface(prospect, surface)
    : null;

  const nextAction = input.nextAction !== undefined ? input.nextAction : result.defaultNextAction;
  const needsCadenceUpdate =
    result.cadenceStep !== undefined
    || nextAction !== undefined
    || input.nextActionDueAt !== undefined;

  let touchRecorded = false;
  let draftMarkedSent = false;
  let draftMarkedDiscarded = false;
  let cadenceUpdated = false;

  runLocalTransaction(() => {
    const rowProspect = findProspectById(ids.prospectId);
    if (!rowProspect) {
      throw new Error(`Prospect not found: ${ids.prospectId}`);
    }
    if (isOutboundSendResult(result)) {
      assertProspectStillOwnsOutboundSend(rowProspect, rawMotion.id);
    }

    if (surface && result.touchDirection && result.touchOutcome) {
      const touch = {
        surface,
        direction: result.touchDirection,
        outcome: result.touchOutcome,
        occurredAt,
        summary: input.summary ?? buildTouchSummary(action.label, result.label, prospect.name),
        subject: normalizeOptionalMessageField(input.subject) ?? normalizeOptionalMessageField(sentDraft?.subject),
        body: normalizeOptionalMessageField(input.body) ?? normalizeOptionalMessageField(sentDraft?.body),
        sourceUrl: input.sourceUrl ?? null,
        notes: input.notes ?? null,
        reconciliation,
      };
      appendActivityEvent({
        dedupeKey: `touch:${rawMotion.id}:${rowProspect.id}:${surface}:${result.touchOutcome}:${occurredAt}`,
        kind: "touch",
        personId: rowProspect.personId,
        prospectId: rowProspect.id,
        motionId: rawMotion.id,
        companyId: ids.companyId,
        surface,
        direction: result.touchDirection,
        outcome: result.touchOutcome,
        occurredAt,
        payload: touch,
      });
      if (!prospect.cadenceState?.lastTouchAt || prospect.cadenceState.lastTouchAt <= occurredAt) {
        updateProspectCadence(rowProspect.id, {
          lastTouchChannel: deriveCadenceChannel(surface),
          lastTouchOutcome: result.touchOutcome,
          lastTouchAt: occurredAt,
        });
      }
      touchRecorded = true;
    }

    if (result.markDraftSent && surface) {
      const draft = findActiveProspectDraftBySurface(rowProspect.id, surface);
      const beforeStatus = draft?.status ?? null;
      const transitioned = draft
        ? transitionProspectDraftStatus(draft.id, { status: "sent" })
        : null;
      draftMarkedSent = isSendableDraftStatus(beforeStatus) && transitioned?.status === "sent";
    }

    if (result.markDraftDiscarded && surface) {
      const draft = findActiveProspectDraftBySurface(rowProspect.id, surface);
      if (draft && isSendableDraftStatus(draft.status)) {
        const transitioned = transitionProspectDraftStatus(draft.id, {
          status: "discarded",
          notes: input.notes ?? draft.notes ?? null,
        });
        draftMarkedDiscarded = transitioned?.status === "discarded";
      }
    }

    if (needsCadenceUpdate) {
      updateProspectCadence(rowProspect.id, {
        currentStep: result.cadenceStep ?? undefined,
        nextAction,
        nextActionDueAt: input.nextActionDueAt ?? undefined,
      });
      cadenceUpdated = true;
    }
  });

  rawMotion = findMotionById(rawMotion.id);
  if (!rawMotion) {
    throw new Error(`Motion not found after action result: ${ids.motionId ?? ""}`);
  }
  prospect = requireProspect(rawMotion, ids.companyId, ids.prospectId);

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
      reconciliation,
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
 * @param {any} prospect
 * @param {string} surface
 */
function findSendableDraftForSurface(prospect, surface) {
  return (prospect?.drafts ?? []).find((draft) =>
    draft.surface === surface && isSendableDraftStatus(draft.status)
  ) ?? null;
}

/**
 * @param {NonNullable<ReturnType<typeof findSupportedActionResult>>} result
 */
function isOutboundSendResult(result) {
  return result.touchDirection === "outbound" && result.touchOutcome === "sent";
}

/**
 * @param {NonNullable<ReturnType<typeof findProspectById>>} prospect
 * @param {string} motionId
 */
function assertProspectStillOwnsOutboundSend(prospect, motionId) {
  const owner = findCrossMotionOwner({
    personId: prospect.personId,
    excludeMotionId: motionId,
  });
  if (!owner) return;
  throw new Error(
    `Cannot record outbound send for stale branch ${prospect.id}; person is active in motion ${owner.motionId}.`
  );
}

/**
 * @param {string | null | undefined} value
 */
function normalizeOptionalMessageField(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
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

/**
 * @param {string} surface
 */
function deriveCadenceChannel(surface) {
  if (surface === "email") return "email";
  if (surface === "connection_request") return "connection-request";
  if (surface === "in_mail_message") return "inmail";
  if (surface === "post_accept_message" || surface === "follow_up_direct_message" || surface === "inbound_reply") {
    return "direct-message";
  }
  return null;
}

/**
 * @param {{
 *   actionKey: string,
 *   resultKey: string,
 *   surface: string | null,
 *   observationId: string | null,
 *   inboundObservationTransitionedTo: string | null,
 * }} input
 */
function buildActionResultReconciliation(input) {
  const connectionRequestReconciliation = buildConnectionRequestMutationReconciliation(input);
  if (connectionRequestReconciliation) {
    return connectionRequestReconciliation;
  }

  if (input.actionKey === "send_email" && input.resultKey === "sent") {
    return {
      state: "pending_external_proof",
      owner: "src/core/record-action-result.js",
      actionKey: input.actionKey,
      resultKey: input.resultKey,
      surface: input.surface ?? "email",
      proofSurface: null,
      missingProofSurface: "gmail-sent-mail",
      externalState: "email_sent",
      reason: "send_email_has_no_provider_proof_surface",
      observationId: input.observationId,
      clearedBy: null,
    };
  }

  return null;
}

/**
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
function runLocalTransaction(callback) {
  const database = getLocalDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
