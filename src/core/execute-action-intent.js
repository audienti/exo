// @ts-check
//
// Execute an action intent against governed Exo state.
//
// This is the live wiring between an operator surface and Exo: a typed
// `{ writer, args }` intent (produced by build-action-intents.js) is dispatched
// to the real core writer, which mutates and persists the same cadence / queue /
// touch / observation state the CLI writes. The derived Operator agent-queue and
// daily surfaces read from this, so they update on the next render.

import { assignCompanyUser } from "./assign-company-user.js";
import { assignMotionUser } from "./assign-motion-user.js";
import { ignoreInboundObservation } from "./ignore-inbound-observation.js";
import { approveMotionProspectDraft } from "./set-prospect-draft.js";
import { addMotionProspectTimelineNote } from "./add-prospect-note.js";
import { claimMotionTargetAccountPacket } from "./claim-target-account-packet.js";
import { acceptMotionTargetAccountPacket, returnMotionTargetAccountPacket } from "./review-target-account-packet.js";
import { acceptMotionProspectPacket, returnMotionProspectPacket } from "./review-motion-prospect-packet.js";
import { recordActionResult } from "./record-action-result.js";
import { recordMotionProspectTouch } from "./record-prospect-touch.js";
import { rehomeProspect } from "./rehome-prospect.js";
import { persistRehomedProspect } from "./persist-rehomed-prospect.js";
import { runTransitionPromote } from "./run-transition-promote.js";
import { autoPromoteInboundAccepts } from "./auto-promote-inbound-accepts.js";
import { runAgentQueuePassAction } from "./run-agent-queue-pass.js";
import { setMotionProspectCadence } from "./set-prospect-cadence.js";
import { startMotionFromIntakeAction } from "./start-motion-from-intake.js";
import { transitionInboundObservation } from "./transition-inbound-observation.js";
import { claimUserRuntimeAccount } from "./claim-user-runtime-account.js";
import { removeMotionGoverned } from "./remove-motion.js";
import { addMotionSignals, removeMotionSignal } from "./manage-motion-signals.js";
import { applyInstallScope, completeOnboardingUser } from "./onboarding.js";
import { findActionResultForTouch } from "../lib/action-result-catalog.js";
import { transitionMotionStatus } from "./transition-motion-status.js";
import {
  toggleWorkspaceEnrichmentProvider,
  updateWorkspacePhoneEnrichmentPolicy,
} from "../lib/workspace-settings.js";
import {
  findCompanyById,
  deleteSignalMatchesForSignal,
  findMotionAccountByMotionAndCompany,
  findMotionById,
  findProspectById,
  findUserById,
  listBrowserProfiles,
  listCompanies,
  listInboundObservations,
  listMotions,
  mutateUserById,
  setAccountDisposition,
  setProspectDisposition,
  updateCompany,
  updateMotion,
  updateMotionWithRetry,
} from "../db/database.js";

/**
 * @param {{ writer?: string, args?: Record<string, any> }} intent
 * @returns {Promise<{ ok: true, message: string, writer: string }>}
 */
export async function executeActionIntent(intent) {
  if (!intent || typeof intent !== "object" || !intent.writer) {
    throw new Error("Action intent requires a writer.");
  }
  const args = intent.args ?? {};

  switch (intent.writer) {
    case "setAccountDisposition":
      return runSetAccountDisposition(args);
    case "setProspectDisposition":
      return runSetProspectDisposition(args);
    case "resolvePacketReview":
      return runResolvePacketReview(args);
    case "setMotionProspectCadence":
      return runCadence(args);
    case "recordMotionProspectTouch":
      return runTouch(args);
    case "recordActionResult":
      return runActionResult(args);
    case "recordInboundObservation":
      return await runInboundObservation(args);
    case "assignCompanyUser":
      return runAssignCompanyUser(args);
    case "assignMotionUser":
      return runAssignMotionUser(args);
    case "deleteMotion":
      return await runDeleteMotion(args);
    case "restartMotion":
      return runRestartMotion(args);
    case "claimTargetAccountPacket":
      return runClaimTargetAccountPacket(args);
    case "claimRuntimeAccount":
      return runClaimRuntimeAccount(args);
    case "runAgentQueuePass":
      return runAgentQueuePassAction(args);
    case "claimInboundPersonToMotion": {
      if (!args.observationId) throw new Error("claimInboundPersonToMotion requires observationId.");
      const promoted = await runTransitionPromote({
        observationId: args.observationId,
        userId: args.userId ?? null,
      });
      if (!args.toMotionId || args.toMotionId === promoted.motion.id) {
        return { ok: true, writer: "claimInboundPersonToMotion", message: promoted.message };
      }
      const rehomed = runRehome({
        prospectId: promoted.prospectId,
        toMotionId: args.toMotionId,
        userId: args.userId ?? null,
      });
      return { ok: true, writer: "claimInboundPersonToMotion", message: rehomed.message };
    }
    case "promoteInboundPerson": {
      if (!args.observationId) throw new Error("promoteInboundPerson requires observationId.");
      const result = await runTransitionPromote({
        observationId: args.observationId,
        userId: args.userId ?? null,
        motionId: args.motionId ?? null,
      });
      return { ok: true, writer: "promoteInboundPerson", message: result.message };
    }
    case "ignoreInboundObservation": {
      if (!args.observationId) throw new Error("ignoreInboundObservation requires observationId.");
      const result = await ignoreInboundObservation({
        observationId: args.observationId,
        reason: args.reason ?? null,
      });
      return { ok: true, writer: "ignoreInboundObservation", message: result.message };
    }
    case "promoteAndApproveDraft": {
      if (!args.observationId || !args.surface) {
        throw new Error("promoteAndApproveDraft requires observationId and surface.");
      }
      // 1 — promote the inbound person into the transition motion as a prospect.
      const promoted = await runTransitionPromote({ observationId: args.observationId, userId: args.userId ?? null });
      // 2 — approve (queue) their first message on the resolved prospect.
      const rawMotion = findMotionById(promoted.motion.id);
      const rawCompany = findCompanyById(promoted.company.id);
      approveMotionProspectDraft(rawMotion, rawCompany, {
        prospectId: promoted.prospectId,
        surface: args.surface,
        body: args.body ?? "",
        subject: args.subject ?? null,
      });
      return {
        ok: true,
        writer: "promoteAndApproveDraft",
        message: `Added ${promoted.prospectName} as a prospect and queued the ${String(args.surface).replaceAll("_", " ")} for the agent to send.`,
      };
    }
    case "approveProspectDraft":
      return runApproveDraft(args);
    case "addProspectTimelineNote":
      return runAddTimelineNote(args);
    case "rehomeProspect":
      return runRehome(args);
    case "startMotionFromIntake":
      return await startMotionFromIntakeAction(args);
    case "addMotionSignals":
      return runAddMotionSignals(args);
    case "removeMotionSignal":
      return runRemoveMotionSignal(args);
    case "setWorkspaceInstallScope":
      return runSetWorkspaceInstallScope(args);
    case "completeOnboardingUser":
      return runCompleteOnboardingUser(args);
    case "toggleWorkspaceEnrichmentProvider":
      return runToggleWorkspaceEnrichmentProvider(args);
    case "setWorkspacePhoneEnrichmentPolicy":
      return runSetWorkspacePhoneEnrichmentPolicy(args);
    default:
      throw new Error(`Unsupported action writer: ${intent.writer}`);
  }
}

/** @param {Record<string, any>} args */
function loadMotionCompanyContext(args) {
  if (!args.companyId) {
    throw new Error("Company action requires companyId.");
  }
  const rawCompany = findCompanyById(args.companyId);
  if (!rawCompany) throw new Error(`Company not found: ${args.companyId}`);

  const rawMotion = args.motionId ? findMotionById(args.motionId) : null;
  if (!rawMotion) {
    throw new Error("Company action requires motionId.");
  }
  return { rawMotion, rawCompany };
}

/** @param {Record<string, any>} args */
function loadMotionAndCompany(args) {
  if (!args.companyId || !args.prospectId) {
    throw new Error("Prospect action requires companyId and prospectId.");
  }
  const rawCompany = findCompanyById(args.companyId);
  if (!rawCompany) throw new Error(`Company not found: ${args.companyId}`);

  let rawMotion = args.motionId ? findMotionById(args.motionId) : null;
  if (!rawMotion) {
    // Fall back to whichever motion targets this company + prospect.
    rawMotion =
      listMotions().find((motion) =>
        (motion.targetMap?.accounts ?? []).some(
          (account) =>
            account.companyId === args.companyId &&
            (account.prospects ?? []).some((prospect) => prospect.id === args.prospectId),
        ),
      ) ?? null;
  }
  if (!rawMotion) throw new Error(`No motion targets prospect ${args.prospectId} at company ${args.companyId}.`);
  return { rawMotion, rawCompany };
}

/** @param {Record<string, any>} args */
function runSetAccountDisposition(args) {
  const { rawMotion, rawCompany } = loadMotionCompanyContext(args);
  const disposition = normalizeDisposition(args.disposition);
  const actor = normalizeDispositionActor(args.actor);
  const reason = normalizeDispositionReason(disposition, args.reason);
  const motionAccount = findMotionAccountByMotionAndCompany(rawMotion.id, rawCompany.id);
  if (!motionAccount) {
    throw new Error(`Motion account not found for ${rawCompany.name} on ${rawMotion.name}.`);
  }

  const updated = setAccountDisposition(motionAccount.id, {
    disposition,
    actor,
    reason,
  });
  if (!updated) {
    throw new Error(`Motion account not found: ${motionAccount.id}`);
  }

  const action = disposition === "active" ? "Reactivated" : `Marked ${disposition.replaceAll("_", " ")}`;
  return {
    ok: true,
    writer: "setAccountDisposition",
    message: `${action} ${rawCompany.name} on ${rawMotion.name}.`,
  };
}

/** @param {Record<string, any>} args */
function runSetProspectDisposition(args) {
  const { rawMotion, rawCompany } = loadMotionAndCompany(args);
  const disposition = normalizeDisposition(args.disposition);
  const actor = normalizeDispositionActor(args.actor);
  const reason = normalizeDispositionReason(disposition, args.reason);
  const account = rawMotion.targetMap?.accounts?.find((item) => item.companyId === rawCompany.id) ?? null;
  const prospect = account?.prospects?.find((item) => item.id === args.prospectId) ?? null;
  if (!prospect) {
    throw new Error(`Prospect not found on target account: ${args.prospectId}`);
  }

  const updated = setProspectDisposition(prospect.id, {
    disposition,
    actor,
    reason,
  });
  if (!updated) {
    throw new Error(`Prospect not found: ${prospect.id}`);
  }

  const stored = findProspectById(prospect.id);
  const action = disposition === "active" ? "Reactivated" : `Marked ${disposition.replaceAll("_", " ")}`;
  return {
    ok: true,
    writer: "setProspectDisposition",
    message: `${action} ${stored?.payload?.name ?? prospect.name ?? "prospect"} on ${rawMotion.name}.`,
  };
}

/** @param {Record<string, any>} args */
function runResolvePacketReview(args) {
  if (!args.motionId || !args.packetId) {
    throw new Error("resolvePacketReview requires motionId and packetId.");
  }
  const action = normalizePacketReviewAction(args.action);
  const context = loadPacketReviewContext(args.motionId, args.packetId);
  const reason = normalizeOptionalText(args.reason);
  const notes = normalizeOptionalText(args.notes);
  if (action === "amended" && !reason && !notes) {
    throw new Error("Packet review reason is required for amended decisions.");
  }
  if (action === "returned" && !notes && !reason) {
    throw new Error("Packet review return notes are required.");
  }

  const decisionInput = {
    outcome: args.outcome ? normalizePacketReviewOutcome(args.outcome) : undefined,
    nextStatus: args.nextStatus ? normalizePacketReviewNextStatus(args.nextStatus) : undefined,
    reason: reason ?? notes ?? null,
    notes: notes ?? reason ?? null,
    reviewer: normalizeOptionalText(args.reviewer) ?? null,
  };
  const updatedMotion = context.packet.packetKind === "prospect_research"
    ? resolveProspectPacketReviewDecision(context, action, decisionInput)
    : resolveAccountPacketReviewDecision(context, action, decisionInput);
  const result = buildPacketReviewDecisionResult(context, updatedMotion, action);
  const subject = result.prospect
    ? `${result.prospect.name} at ${result.company.name}`
    : result.company.name;
  return {
    ok: true,
    writer: "resolvePacketReview",
    message: `Packet ${action.replace(/ed$/, "")}ed: ${subject}.`,
  };
}

/**
 * @param {ReturnType<typeof loadPacketReviewContext>} context
 * @param {"accepted" | "amended" | "returned"} action
 * @param {Record<string, any>} input
 */
function resolveAccountPacketReviewDecision(context, action, input) {
  if (action === "returned") {
    return returnMotionTargetAccountPacket(context.motion, context.company, {
      notes: input.notes,
      reviewer: input.reviewer,
    });
  }
  return acceptMotionTargetAccountPacket(context.motion, context.company, input);
}

/**
 * @param {ReturnType<typeof loadPacketReviewContext>} context
 * @param {"accepted" | "amended" | "returned"} action
 * @param {Record<string, any>} input
 */
function resolveProspectPacketReviewDecision(context, action, input) {
  if (!context.packet.prospectId) {
    throw new Error(`Prospect packet ${context.packet.id} is missing a prospect id.`);
  }
  if (action === "returned") {
    return returnMotionProspectPacket(context.motion, context.company, {
      prospectId: context.packet.prospectId,
      notes: input.notes,
      reviewer: input.reviewer,
    });
  }
  return acceptMotionProspectPacket(context.motion, context.company, {
    ...input,
    prospectId: context.packet.prospectId,
  });
}

/**
 * @param {string} motionId
 * @param {string} packetId
 */
function loadPacketReviewContext(motionId, packetId) {
  const motion = findMotionById(motionId);
  if (!motion) {
    throw new Error(`Motion not found: ${motionId}`);
  }
  const packet = parsePacketId(packetId);
  const company = findCompanyById(packet.companyId);
  if (!company) {
    throw new Error(`Company not found: ${packet.companyId}`);
  }
  return { motion, company, packet };
}

/**
 * @param {ReturnType<typeof loadPacketReviewContext>} context
 * @param {any} updatedMotion
 * @param {"accepted" | "amended" | "returned"} action
 */
function buildPacketReviewDecisionResult(context, updatedMotion, action) {
  const account = updatedMotion.targetMap.accounts.find((item) => item.companyId === context.company.id) ?? null;
  const prospect = context.packet.prospectId
    ? account?.prospects.find((item) => item.id === context.packet.prospectId) ?? null
    : null;
  return {
    action,
    motion: { id: updatedMotion.id, name: updatedMotion.name },
    company: { id: context.company.id, name: context.company.name },
    packet: context.packet,
    account,
    prospect,
  };
}

/**
 * @param {string} packetId
 */
function parsePacketId(packetId) {
  const [packetKind, companyId, prospectId = null] = String(packetId).split(":");
  if (packetKind !== "company_research" && packetKind !== "prospect_selection" && packetKind !== "prospect_research") {
    throw new Error(`Invalid packet kind in packet id: ${packetId}`);
  }
  if (!companyId) {
    throw new Error(`Invalid packet id: ${packetId}`);
  }
  if (packetKind === "prospect_research" && !prospectId) {
    throw new Error(`Prospect research packet id must include a prospect id: ${packetId}`);
  }
  return { id: packetId, packetKind, companyId, prospectId };
}

/** @param {unknown} value */
function normalizeDisposition(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "active"
    || normalized === "nurture"
    || normalized === "not_a_fit"
    || normalized === "no_longer_target"
    || normalized === "exhausted"
  ) {
    return normalized;
  }
  throw new Error(`Invalid disposition: ${String(value ?? "")}`);
}

/**
 * @param {unknown} value
 * @returns {"operator" | "agent" | "system"}
 */
function normalizeDispositionActor(value) {
  const normalized = String(value ?? "operator").trim().toLowerCase();
  if (normalized === "operator" || normalized === "agent" || normalized === "system") {
    return normalized;
  }
  throw new Error(`Invalid disposition actor: ${String(value ?? "")}`);
}

/**
 * @param {string} disposition
 * @param {unknown} value
 */
function normalizeDispositionReason(disposition, value) {
  const reason = normalizeOptionalText(value);
  if (disposition !== "active" && !reason) {
    throw new Error("Disposition reason is required for nurture and terminal states.");
  }
  return reason ?? "Reactivated by operator.";
}

/** @param {unknown} value */
function normalizePacketReviewAction(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "accepted" || normalized === "amended" || normalized === "returned") {
    return normalized;
  }
  throw new Error(`Invalid packet review action: ${String(value ?? "")}`);
}

/** @param {unknown} value */
function normalizePacketReviewOutcome(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "advance"
    || normalized === "nurture"
    || normalized === "not_a_fit"
    || normalized === "no_longer_target"
    || normalized === "exhausted"
  ) {
    return normalized;
  }
  throw new Error(`Invalid packet review outcome: ${String(value ?? "")}`);
}

/** @param {unknown} value */
function normalizePacketReviewNextStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "researched" || normalized === "suppressed" || normalized === "exhausted") {
    return normalized;
  }
  throw new Error(`Invalid packet review next status: ${String(value ?? "")}`);
}

/** @param {unknown} value */
function normalizeOptionalText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/** @param {Record<string, any>} args */
function runCadence(args) {
  const { rawMotion, rawCompany } = loadMotionAndCompany(args);
  const stored = setMotionProspectCadence(rawMotion, rawCompany, {
    prospectId: args.prospectId,
    currentStep: args.currentStep ?? undefined,
    nextAction: args.nextAction ?? undefined,
    nextActionDueAt: args.nextActionDueAt ?? undefined,
  });
  const account = stored.targetMap.accounts.find((item) => item.companyId === args.companyId) ?? null;
  const prospect = account?.prospects.find((item) => item.id === args.prospectId) ?? null;
  return {
    ok: true,
    writer: "setMotionProspectCadence",
    message: `Scheduled "${prospect?.cadenceState?.nextAction ?? args.nextAction ?? "next move"}" for ${prospect?.name ?? "prospect"} on ${stored.name}.`,
  };
}

/** @param {Record<string, any>} args */
function runTouch(args) {
  const mappedResult = findActionResultForTouch({
    surface: args.surface,
    direction: args.direction ?? "outbound",
    outcome: args.outcome ?? "sent",
    observationId: args.observationId ?? null,
  });

  if (mappedResult) {
    const result = recordActionResult({
      actionKey: mappedResult.actionKey,
      resultKey: mappedResult.resultKey,
      motionId: args.motionId ?? null,
      companyId: args.companyId ?? null,
      prospectId: args.prospectId ?? null,
      observationId: args.observationId ?? null,
      surface: mappedResult.surface,
      occurredAt: args.occurredAt ?? new Date().toISOString(),
      summary: args.summary ?? "Recorded from the operator surface.",
      subject: args.subject ?? null,
      body: args.body ?? null,
      sourceUrl: args.sourceUrl ?? null,
      notes: args.notes ?? null,
      nextAction: args.nextAction,
      nextActionDueAt: args.nextActionDueAt,
    });
    return {
      ok: true,
      writer: "recordActionResult",
      message: result.actionResult.message,
    };
  }

  const { rawMotion, rawCompany } = loadMotionAndCompany(args);
  const stored = recordMotionProspectTouch(rawMotion, rawCompany, {
    prospectId: args.prospectId,
    surface: args.surface,
    direction: args.direction ?? "outbound",
    outcome: args.outcome ?? "sent",
    occurredAt: args.occurredAt ?? new Date().toISOString(),
    summary: args.summary ?? "Recorded from the operator surface.",
  });
  return {
    ok: true,
    writer: "recordMotionProspectTouch",
    message: `Logged ${String(args.surface).replaceAll("_", " ")} for prospect on ${stored.name}.`,
  };
}

/** @param {Record<string, any>} args */
function runToggleWorkspaceEnrichmentProvider(args) {
  const lane = normalizeEnrichmentLane(args.lane);
  const provider = String(args.provider ?? "").trim().toLowerCase();
  if (!provider) {
    throw new Error("toggleWorkspaceEnrichmentProvider requires provider.");
  }
  if (args.enabled === undefined || args.enabled === null) {
    throw new Error("toggleWorkspaceEnrichmentProvider requires enabled.");
  }

  const settings = toggleWorkspaceEnrichmentProvider({
    cwd: process.cwd(),
    lane,
    provider,
    enabled: toBooleanArg(args.enabled),
  });
  const action = toBooleanArg(args.enabled) ? "Enabled" : "Disabled";
  const laneLabel = lane === "validation" ? "email validation" : `${lane} enrichment`;
  const configured = lane === "validation"
    ? settings.workspace.enrichment.email.validators
    : settings.workspace.enrichment[lane].providers;

  return {
    ok: true,
    writer: "toggleWorkspaceEnrichmentProvider",
    message: `${action} ${provider} for ${laneLabel}. ${configured.length} provider${configured.length === 1 ? "" : "s"} configured.`,
  };
}

/** @param {Record<string, any>} args */
function runSetWorkspacePhoneEnrichmentPolicy(args) {
  if (!args.field) {
    throw new Error("setWorkspacePhoneEnrichmentPolicy requires field.");
  }
  const field = String(args.field).trim();
  const value = toBooleanArg(args.value);
  if (!["mobileOnly", "preferWhatsappCapable"].includes(field)) {
    throw new Error(`Unsupported phone enrichment field: ${field}`);
  }

  const settings = updateWorkspacePhoneEnrichmentPolicy({
    cwd: process.cwd(),
    ...(field === "mobileOnly" ? { mobileOnly: value } : {}),
    ...(field === "preferWhatsappCapable" ? { preferWhatsappCapable: value } : {}),
  });

  return {
    ok: true,
    writer: "setWorkspacePhoneEnrichmentPolicy",
    message:
      field === "mobileOnly"
        ? `Phone enrichment now ${settings.workspace.enrichment.phone.mobileOnly ? "requires mobile numbers only" : "allows non-mobile numbers"}.`
        : `Phone enrichment will ${settings.workspace.enrichment.phone.preferWhatsappCapable ? "prefer WhatsApp-capable numbers when the provider can prove it" : "stop prioritizing WhatsApp-capable evidence"}.`,
  };
}

/** @param {Record<string, any>} args */
function runActionResult(args) {
  const result = recordActionResult({
    actionKey: args.actionKey,
    resultKey: args.resultKey,
    motionId: args.motionId ?? null,
    companyId: args.companyId ?? null,
    prospectId: args.prospectId ?? null,
    observationId: args.observationId ?? null,
    surface: args.surface ?? null,
    occurredAt: args.occurredAt ?? null,
    summary: args.summary ?? null,
    subject: args.subject ?? null,
    body: args.body ?? null,
    sourceUrl: args.sourceUrl ?? null,
    notes: args.notes ?? null,
    nextAction: args.nextAction,
    nextActionDueAt: args.nextActionDueAt,
  });
  return {
    ok: true,
    writer: "recordActionResult",
    message: result.actionResult.message,
  };
}

/** @param {Record<string, any>} args */
function runAssignCompanyUser(args) {
  if (!args.companyId || !args.userId) throw new Error("assignCompanyUser requires companyId and userId.");
  const rawCompany = findCompanyById(args.companyId);
  if (!rawCompany) throw new Error(`Company not found: ${args.companyId}`);
  const rawUser = findUserById(args.userId);
  if (!rawUser) throw new Error(`User not found: ${args.userId}`);
  const updated = assignCompanyUser(rawCompany, rawUser, listBrowserProfiles(), {
    assignedBy: "exo-ui",
    reason: args.reason ?? "Make ready outbound branches executable",
    browserCapability: args.browserCapability ?? "linkedin",
  });
  // updateCompany persists but does not return the record (unlike updateMotion),
  // so build the confirmation from the in-memory updated company.
  updateCompany(updated);
  return {
    ok: true,
    writer: "assignCompanyUser",
    message: `Pinned ${updated.name} to ${updated.engagementUserAssignment?.label ?? "the selected user"}.`,
  };
}

/** @param {Record<string, any>} args */
function runAssignMotionUser(args) {
  if (!args.motionId || !args.userId) throw new Error("assignMotionUser requires motionId and userId.");
  const rawMotion = findMotionById(args.motionId);
  if (!rawMotion) throw new Error(`Motion not found: ${args.motionId}`);
  const rawUser = findUserById(args.userId);
  if (!rawUser) throw new Error(`User not found: ${args.userId}`);
  const stored = updateMotionWithRetry(args.motionId, (motion) => assignMotionUser(motion, rawUser, listBrowserProfiles(), {
    assignedBy: "exo-ui",
    reason: args.reason ?? "Keep one execution identity for this motion",
  }));
  return {
    ok: true,
    writer: "assignMotionUser",
    message: `Assigned ${stored.name} to ${stored.engagementUserAssignment?.label ?? "the selected user"}.`,
  };
}

/** @param {Record<string, any>} args */
async function runDeleteMotion(args) {
  if (!args.motionId) throw new Error("deleteMotion requires motionId.");
  const result = await removeMotionGoverned({ motionId: args.motionId });
  return {
    ok: true,
    writer: "deleteMotion",
    message: result.message,
    redirect: "/motions",
  };
}

/** @param {Record<string, any>} args */
function runRestartMotion(args) {
  if (!args.motionId) throw new Error("restartMotion requires motionId.");
  const rawMotion = findMotionById(args.motionId);
  if (!rawMotion) throw new Error(`Motion not found: ${args.motionId}`);
  const result = transitionMotionStatus(rawMotion, "restart");
  const storedMotion = result.changed ? updateMotion(result.motion) : result.motion;
  return {
    ok: true,
    writer: "restartMotion",
    message: result.changed
      ? `Set ${storedMotion.name} live.`
      : `${storedMotion.name} is already live.`,
  };
}

/** @param {Record<string, any>} args */
function runSetWorkspaceInstallScope(args) {
  const result = applyInstallScope({ scope: args.scope });
  return {
    ok: true,
    writer: "setWorkspaceInstallScope",
    message: result.scope === "global-install"
      ? `This folder now attaches to the global Exo install at ${result.statePaths.homeStateDir}.`
      : "This folder now keeps its Exo state locally.",
  };
}

/** @param {Record<string, any>} args */
function runCompleteOnboardingUser(args) {
  const result = completeOnboardingUser({
    userId: args.userId ?? null,
    label: args.label ?? null,
    owner: args.owner ?? null,
    runtime: args.runtime ?? "codex",
  });
  return {
    ok: true,
    writer: "completeOnboardingUser",
    message: result.message,
  };
}

/** @param {Record<string, any>} args */
function runAddMotionSignals(args) {
  if (!args.motionId) throw new Error("addMotionSignals requires motionId.");
  const rawMotion = findMotionById(args.motionId);
  if (!rawMotion) throw new Error(`Motion not found: ${args.motionId}`);

  let count = 0;
  const stored = updateMotionWithRetry(args.motionId, (motion) => {
    const result = addMotionSignals(motion, { signal: args.signal });
    count = result.addedSignals.length;
    return result.motion;
  });
  return {
    ok: true,
    writer: "addMotionSignals",
    message: `Added ${count} signal question${count === 1 ? "" : "s"} to ${stored.name}.`,
  };
}

/** @param {Record<string, any>} args */
function runRemoveMotionSignal(args) {
  if (!args.motionId || !args.signalId) {
    throw new Error("removeMotionSignal requires motionId and signalId.");
  }
  const rawMotion = findMotionById(args.motionId);
  if (!rawMotion) throw new Error(`Motion not found: ${args.motionId}`);

  let removedSignal = null;
  const stored = updateMotionWithRetry(args.motionId, (motion) => {
    const result = removeMotionSignal(motion, { signalId: args.signalId });
    removedSignal = result.removedSignal;
    return result.motion;
  });
  deleteSignalMatchesForSignal({
    motionId: args.motionId,
    signalId: args.signalId,
  });
  return {
    ok: true,
    writer: "removeMotionSignal",
    message: `Removed signal "${removedSignal?.name ?? args.signalId}" from ${stored.name}.`,
  };
}

/** @param {Record<string, any>} args */
function runClaimTargetAccountPacket(args) {
  if (!args.companyId || !args.motionId) {
    throw new Error("claimTargetAccountPacket requires companyId and motionId.");
  }
  const workerLabel = String(args.workerLabel ?? "codex-ui").trim() || "codex-ui";
  const rawCompany = findCompanyById(args.companyId);
  if (!rawCompany) throw new Error(`Company not found: ${args.companyId}`);
  const rawMotion = findMotionById(args.motionId);
  if (!rawMotion) throw new Error(`Motion not found: ${args.motionId}`);

  const existingAccount = (rawMotion.targetMap?.accounts ?? []).find((account) => account.companyId === args.companyId) ?? null;
  if (
    existingAccount?.packetState?.status === "claimed"
    && existingAccount.packetState?.kind === "company_research"
    && existingAccount.packetState?.workerLabel === workerLabel
  ) {
    return {
      ok: true,
      writer: "claimTargetAccountPacket",
      message: `${rawCompany.name} is already queued for agent research.`,
    };
  }

  const stored = claimMotionTargetAccountPacket(rawMotion, rawCompany, {
    workerLabel,
    notes: args.notes ?? null,
  });
  return {
    ok: true,
    writer: "claimTargetAccountPacket",
    message: `Queued ${rawCompany.name} for agent research on ${stored.name}.`,
  };
}

/** @param {Record<string, any>} args */
function runClaimRuntimeAccount(args) {
  if (!args.userId || !args.capability || !args.runtime || !args.connector || !args.handle) {
    throw new Error("claimRuntimeAccount requires userId, capability, runtime, connector, and handle.");
  }

  // Run the read/mutate/write inside one home-database transaction so two
  // parallel claims against the same user cannot lose the other writer's
  // connected account. See src/db/database.js mutateUserById for the
  // serialization contract.
  const { result } = mutateUserById(args.userId, (latestRaw) => {
    const claimed = claimUserRuntimeAccount(latestRaw, {
      capability: args.capability,
      handle: args.handle,
      label: args.label ?? null,
      runtime: args.runtime,
      connector: args.connector,
      providerAccountId: args.providerAccountId ?? null,
      preferred: typeof args.preferred === "boolean" ? args.preferred : true,
      metadata: args.metadata && typeof args.metadata === "object" ? args.metadata : null,
      notes: args.notes ?? null,
      codexHome: process.env.CODEX_HOME ?? null,
      claudeCli: process.env.EXO_CLAUDE_CLI ?? null,
    });
    return { user: claimed.updatedUser, result: claimed };
  });

  return {
    ok: true,
    writer: "claimRuntimeAccount",
    message: `Claimed ${result.account.handle} as ${result.account.capability} on ${result.harnessConnection.runtime}:${result.harnessConnection.connector} for ${result.updatedUser.label}.`,
  };
}

/** @param {Record<string, any>} args */
function runAddTimelineNote(args) {
  if (!args.prospectId || !args.body || !String(args.body).trim()) {
    throw new Error("addProspectTimelineNote requires prospectId and body.");
  }
  const { rawMotion, rawCompany } = loadMotionAndCompany(args);
  const { note } = addMotionProspectTimelineNote(rawMotion, rawCompany, {
    prospectId: args.prospectId,
    kind: args.kind === "steer" ? "steer" : "note",
    body: String(args.body).trim(),
    author: args.author ?? null,
  });
  return {
    ok: true,
    writer: "addProspectTimelineNote",
    message: note.kind === "steer" ? "Steer added — the agent will see it on its next action." : "Note added to the timeline.",
  };
}

/** @param {Record<string, any>} args */
function runRehome(args) {
  if (!args.prospectId || !args.toMotionId) {
    throw new Error("rehomeProspect requires prospectId and toMotionId.");
  }
  // Find the motion the prospect currently lives in.
  const fromMotion = listMotions().find((motion) =>
    (motion.targetMap?.accounts ?? []).some((account) =>
      (account.prospects ?? []).some((prospect) => prospect.id === args.prospectId),
    ),
  );
  if (!fromMotion) throw new Error(`Prospect not found in any motion: ${args.prospectId}`);
  const toMotion = findMotionById(args.toMotionId);
  if (!toMotion) throw new Error(`Destination motion not found: ${args.toMotionId}`);

  const related = listInboundObservations(args.userId ? { userId: args.userId } : {}).filter(
    (observation) => observation.prospectId === args.prospectId,
  );
  const result = rehomeProspect({
    rawFromMotion: fromMotion,
    rawToMotion: toMotion,
    rawCompanies: listCompanies(),
    prospectId: args.prospectId,
    relatedObservations: related,
  });
  persistRehomedProspect({ result });
  return { ok: true, writer: "rehomeProspect", message: result.message };
}

/** @param {Record<string, any>} args */
function runApproveDraft(args) {
  if (!args.surface || !args.prospectId) {
    throw new Error("approveProspectDraft requires prospectId and surface.");
  }
  const { rawMotion, rawCompany } = loadMotionAndCompany(args);
  const stored = approveMotionProspectDraft(rawMotion, rawCompany, {
    prospectId: args.prospectId,
    surface: args.surface,
    body: args.body ?? "",
    subject: args.subject ?? null,
  });
  const account = stored.targetMap.accounts.find((a) => a.companyId === args.companyId) ?? null;
  const prospect = account?.prospects.find((p) => p.id === args.prospectId) ?? null;
  return {
    ok: true,
    writer: "approveProspectDraft",
    message: `Approved ${String(args.surface).replaceAll("_", " ")} for ${prospect?.name ?? "prospect"} — queued for the agent to send.`,
  };
}

/** @param {Record<string, any>} args */
async function runInboundObservation(args) {
  if (!args.observationId || !args.nextKind) {
    throw new Error("recordInboundObservation requires observationId and nextKind.");
  }
  const transitioned = transitionInboundObservation({
    observationId: args.observationId,
    nextKind: args.nextKind,
    observedAt: new Date().toISOString(),
    summary: null,
  });
  const degreeNote = transitioned.connectionDegreeMarked ? " Marked as a 1st-degree connection." : "";

  // Legacy direct-accept path: keep auto-promotion for callers that transition
  // straight to accepted without going through the live maintenance queue.
  let promoteNote = "";
  if (args.nextKind === "connection_request_accepted") {
    try {
      const result = await autoPromoteInboundAccepts({ userId: transitioned.existing?.userId ?? null });
      if (result.count > 0) promoteNote = " Brought into the transition backlog as a prospect.";
      const blocked = result.blocked?.find((item) => item.observationId === transitioned.observation.id);
      if (!promoteNote && blocked) {
        promoteNote = ` Could not route automatically yet: ${blocked.reason}`;
      }
    } catch {
      // Promotion is best-effort; recording the accept already succeeded.
    }
  }

  if (args.nextKind === "connection_request_accept_requested") {
    return {
      ok: true,
      writer: "recordInboundObservation",
      message: `Queued the agent to accept ${transitioned.existing.actorName ?? "this invite"} on LinkedIn — it will move to connected once the live accept lands.`,
    };
  }

  // A reject is queued for the agent, not done locally — say so plainly.
  if (args.nextKind === "connection_request_decline_requested") {
    return {
      ok: true,
      writer: "recordInboundObservation",
      message: `Queued the agent to reject ${transitioned.existing.actorName ?? "this invite"} on LinkedIn — it will drop off once declined.`,
    };
  }
  if (args.nextKind === "connection_request_withdraw_requested") {
    return {
      ok: true,
      writer: "recordInboundObservation",
      message: `Queued the agent to withdraw ${transitioned.existing.actorName ?? "this pending invite"} on LinkedIn — it will drop off once withdrawn.`,
    };
  }

  return {
    ok: true,
    writer: "recordInboundObservation",
    message: `Recorded ${transitioned.existing.actorName ?? "inbound invite"} as ${args.nextKind.replace(/^connection_request_/, "")}.${degreeNote}${promoteNote}`,
  };
}

/**
 * @param {unknown} value
 */
function normalizeEnrichmentLane(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "email" || normalized === "phone" || normalized === "validation") {
    return normalized;
  }
  throw new Error(`Unsupported enrichment lane: ${String(value ?? "")}`);
}

/**
 * @param {unknown} value
 */
function toBooleanArg(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  throw new Error(`Expected boolean value, received ${String(value ?? "")}.`);
}
