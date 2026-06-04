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
import { buildMotionIntake } from "./build-motion-intake.js";
import { ignoreInboundObservation } from "./ignore-inbound-observation.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { approveMotionProspectDraft } from "./set-prospect-draft.js";
import { addMotionProspectTimelineNote } from "./add-prospect-note.js";
import { claimMotionTargetAccountPacket } from "./claim-target-account-packet.js";
import { recordActionResult } from "./record-action-result.js";
import { recordMotionProspectTouch } from "./record-prospect-touch.js";
import { rehomeProspect } from "./rehome-prospect.js";
import { runTransitionPromote } from "./run-transition-promote.js";
import { autoPromoteInboundAccepts } from "./auto-promote-inbound-accepts.js";
import { setMotionProspectCadence } from "./set-prospect-cadence.js";
import { transitionInboundObservation } from "./transition-inbound-observation.js";
import { claimUserRuntimeAccount } from "./claim-user-runtime-account.js";
import { addMotionSignals, removeMotionSignal } from "./manage-motion-signals.js";
import { runAgentWorkerPass } from "../cli/commands/agent.js";
import { findActionResultForTouch } from "../lib/action-result-catalog.js";
import { inspectAgentRunLock } from "../lib/agent-run-lock.js";
import { getHomeStateDir } from "../db/paths.js";
import { startMotion } from "./start-motion.js";
import {
  findCompanyById,
  findMotionById,
  findUserById,
  insertMotion,
  listBrowserProfiles,
  listCompanies,
  listInboundObservations,
  listMotions,
  updateUser,
  updateCompany,
  updateMotion,
  upsertInboundObservation,
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
    case "claimTargetAccountPacket":
      return runClaimTargetAccountPacket(args);
    case "claimRuntimeAccount":
      return runClaimRuntimeAccount(args);
    case "runAgentQueuePass":
      return runAgentQueuePass(args);
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
      const updated = approveMotionProspectDraft(rawMotion, rawCompany, {
        prospectId: promoted.prospectId,
        surface: args.surface,
        body: args.body ?? "",
        subject: args.subject ?? null,
      });
      updateMotion(updated);
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
      return await runStartMotionFromIntake(args);
    case "addMotionSignals":
      return runAddMotionSignals(args);
    case "removeMotionSignal":
      return runRemoveMotionSignal(args);
    default:
      throw new Error(`Unsupported action writer: ${intent.writer}`);
  }
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
function runCadence(args) {
  const { rawMotion, rawCompany } = loadMotionAndCompany(args);
  const updated = setMotionProspectCadence(rawMotion, rawCompany, {
    prospectId: args.prospectId,
    currentStep: args.currentStep ?? undefined,
    nextAction: args.nextAction ?? undefined,
    nextActionDueAt: args.nextActionDueAt ?? undefined,
  });
  const stored = updateMotion(updated);
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
  const updated = recordMotionProspectTouch(rawMotion, rawCompany, {
    prospectId: args.prospectId,
    surface: args.surface,
    direction: args.direction ?? "outbound",
    outcome: args.outcome ?? "sent",
    occurredAt: args.occurredAt ?? new Date().toISOString(),
    summary: args.summary ?? "Recorded from the operator surface.",
  });
  const stored = updateMotion(updated);
  return {
    ok: true,
    writer: "recordMotionProspectTouch",
    message: `Logged ${String(args.surface).replaceAll("_", " ")} for prospect on ${stored.name}.`,
  };
}

/** @param {Record<string, any>} args */
async function runStartMotionFromIntake(args) {
  const url = String(args.url ?? "").trim();
  const allMotions = listMotions();
  const existingMatches = allMotions.filter((motion) => motion.offer?.sourceUrl === url);
  const existingStrategy = existingMatches.length > 0
    ? normalizeExistingStrategy(args.existingStrategy)
    : null;
  const sourceMotionId = existingMatches.length > 0 ? normalizeOptionalString(args.sourceMotionId) : null;
  const shouldDefineFresh = existingMatches.length === 0 || existingStrategy === "new";
  const intake = buildMotionIntake(
    {
      url,
      existingStrategy,
      sourceMotionId,
      premise: shouldDefineFresh ? buildPremiseInput(args.premise) : null,
      audienceHypotheses: shouldDefineFresh ? buildAudienceInputs(args.audience) : [],
      signals: shouldDefineFresh ? buildSignalInputs(args.signal) : [],
      targetingProfile: {},
      suppressionPolicy: {},
    },
    allMotions,
  );

  if (!intake.readyToLaunch) {
    throw new Error(intake.nextQuestion?.prompt ?? "Motion intake still needs more definition.");
  }

  const result = await startMotion(
    {
      url,
      offerNotes: null,
      existingStrategy,
      sourceMotionId,
      premise: shouldDefineFresh ? buildPremiseInput(args.premise) : null,
      audienceHypotheses: shouldDefineFresh ? buildAudienceInputs(args.audience) : [],
      signals: shouldDefineFresh ? buildSignalInputs(args.signal) : [],
      targetingProfile: {},
      suppressionPolicy: {},
    },
    allMotions,
  );

  if (result.status === "decision-required") {
    throw new Error("This URL already has a motion. Choose continue, clone, or start fresh.");
  }

  if (result.status === "continued") {
    return {
      ok: true,
      writer: "startMotionFromIntake",
      message: `Continuing ${result.motion.name}.`,
      redirect: `/motions/${result.motion.id}`,
    };
  }

  const storedMotion = result.status === "created" || result.status === "cloned"
    ? insertMotion(result.motion)
    : result.motion;
  const verb = result.status === "cloned" ? "Cloned" : "Created";
  return {
    ok: true,
    writer: "startMotionFromIntake",
    message: `${verb} motion ${storedMotion.name}.`,
    redirect: `/motions/${storedMotion.id}`,
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
function runAddMotionSignals(args) {
  if (!args.motionId) throw new Error("addMotionSignals requires motionId.");
  const rawMotion = findMotionById(args.motionId);
  if (!rawMotion) throw new Error(`Motion not found: ${args.motionId}`);

  const result = addMotionSignals(rawMotion, { signal: args.signal });
  const stored = updateMotion(result.motion);
  const count = result.addedSignals.length;
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

  const result = removeMotionSignal(rawMotion, { signalId: args.signalId });
  const stored = updateMotion(result.motion);
  return {
    ok: true,
    writer: "removeMotionSignal",
    message: `Removed signal "${result.removedSignal.name}" from ${stored.name}.`,
  };
}

/**
 * @param {unknown} value
 * @returns {"continue" | "clone" | "new" | null}
 */
function normalizeExistingStrategy(value) {
  const normalized = normalizeOptionalString(value);
  return normalized === "continue" || normalized === "clone" || normalized === "new"
    ? normalized
    : null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeOptionalString(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

/**
 * @param {unknown} value
 */
function buildPremiseInput(value) {
  const statement = normalizeOptionalString(value);
  return statement
    ? {
      statement,
      source: "operator",
    }
    : null;
}

/**
 * @param {unknown} value
 */
function buildAudienceInputs(value) {
  const normalized = normalizeOptionalString(value);
  return normalized ? [normalized] : [];
}

/**
 * @param {unknown} value
 */
function buildSignalInputs(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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

  const updated = claimMotionTargetAccountPacket(rawMotion, rawCompany, {
    workerLabel,
    notes: args.notes ?? null,
  });
  updateMotion(updated);
  return {
    ok: true,
    writer: "claimTargetAccountPacket",
    message: `Queued ${rawCompany.name} for agent research on ${updated.name}.`,
  };
}

/** @param {Record<string, any>} args */
function runClaimRuntimeAccount(args) {
  if (!args.userId || !args.capability || !args.runtime || !args.connector || !args.handle) {
    throw new Error("claimRuntimeAccount requires userId, capability, runtime, connector, and handle.");
  }
  const rawUser = findUserById(args.userId);
  if (!rawUser) throw new Error(`User not found: ${args.userId}`);

  const result = claimUserRuntimeAccount(rawUser, {
    capability: args.capability,
    handle: args.handle,
    label: args.label ?? null,
    runtime: args.runtime,
    connector: args.connector,
    providerAccountId: args.providerAccountId ?? null,
    preferred: typeof args.preferred === "boolean" ? args.preferred : true,
    notes: args.notes ?? null,
    codexHome: process.env.CODEX_HOME ?? null,
    claudeCli: process.env.EXO_CLAUDE_CLI ?? null,
  });
  updateUser(result.updatedUser);

  return {
    ok: true,
    writer: "claimRuntimeAccount",
    message: `Claimed ${result.account.handle} as ${result.account.capability} on ${result.harnessConnection.runtime}:${result.harnessConnection.connector} for ${result.updatedUser.label}.`,
  };
}

/** @param {Record<string, any>} args */
function runAgentQueuePass(args) {
  const runLock = inspectAgentRunLock({ stateDir: getHomeStateDir() });
  if (runLock.active) {
    throw new Error(`Another agent pass is already active${runLock.pid ? ` (pid ${runLock.pid})` : ""}.`);
  }
  if (args.background !== false) {
    const pid = launchDetachedAgentQueuePass(args);
    return {
      ok: true,
      writer: "runAgentQueuePass",
      message: `Agent pass started in background${pid ? ` (pid ${pid})` : ""}.`,
    };
  }
  const summary = runAgentWorkerPass({
    quiet: true,
    sendMode: args.sendMode ?? null,
    maxTasks: args.maxTasks ?? null,
    forceRetrieval: Boolean(args.forceRetrieval),
    ignoreBrowserBackoff: Boolean(args.ignoreBrowserBackoff),
  });
  if (summary?.status === "noop" && /already active/i.test(String(summary.reason ?? ""))) {
    throw new Error(String(summary.reason).trim() || "Another agent pass is already active.");
  }
  return {
    ok: true,
    writer: "runAgentQueuePass",
    message: summarizeAgentQueuePass(summary),
  };
}

/** @param {Record<string, any>} args */
function launchDetachedAgentQueuePass(args) {
  const stateDir = getHomeStateDir();
  const cliPath = fileURLToPath(new URL("../cli/index.js", import.meta.url));
  const logPath = path.join(stateDir, "agent.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  const childArgs = [cliPath, "agent", "run", "--json"];
  if (args.sendMode != null && String(args.sendMode).trim()) {
    childArgs.push("--send-mode", String(args.sendMode).trim());
  }
  if (args.maxTasks != null && String(args.maxTasks).trim()) {
    childArgs.push("--max-tasks", String(args.maxTasks).trim());
  }
  if (args.forceRetrieval) {
    childArgs.push("--force-retrieval");
  }
  if (args.ignoreBrowserBackoff) {
    childArgs.push("--ignore-browser-backoff");
  }

  const stdoutFd = fs.openSync(logPath, "a");
  const stderrFd = fs.openSync(logPath, "a");
  try {
    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        EXO_STATE_DIR: stateDir,
      },
      detached: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    child.unref();
    return child.pid ?? null;
  } finally {
    fs.closeSync(stdoutFd);
    if (stderrFd !== stdoutFd) {
      fs.closeSync(stderrFd);
    }
  }
}

/** @param {Record<string, any>} args */
function runAddTimelineNote(args) {
  if (!args.prospectId || !args.body || !String(args.body).trim()) {
    throw new Error("addProspectTimelineNote requires prospectId and body.");
  }
  const { rawMotion, rawCompany } = loadMotionAndCompany(args);
  const { motion, note } = addMotionProspectTimelineNote(rawMotion, rawCompany, {
    prospectId: args.prospectId,
    kind: args.kind === "steer" ? "steer" : "note",
    body: String(args.body).trim(),
    author: args.author ?? null,
  });
  updateMotion(motion);
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
  updateCompany(result.company);
  updateMotion(result.fromMotion);
  updateMotion(result.toMotion);
  for (const observation of result.observations) {
    upsertInboundObservation(observation);
  }
  return { ok: true, writer: "rehomeProspect", message: result.message };
}

/** @param {Record<string, any>} args */
function runApproveDraft(args) {
  if (!args.surface || !args.prospectId) {
    throw new Error("approveProspectDraft requires prospectId and surface.");
  }
  const { rawMotion, rawCompany } = loadMotionAndCompany(args);
  const updated = approveMotionProspectDraft(rawMotion, rawCompany, {
    prospectId: args.prospectId,
    surface: args.surface,
    body: args.body ?? "",
    subject: args.subject ?? null,
  });
  const stored = updateMotion(updated);
  const account = stored.targetMap.accounts.find((a) => a.companyId === args.companyId) ?? null;
  const prospect = account?.prospects.find((p) => p.id === args.prospectId) ?? null;
  return {
    ok: true,
    writer: "approveProspectDraft",
    message: `Approved ${String(args.surface).replaceAll("_", " ")} for ${prospect?.name ?? "prospect"} — queued for the agent to send.`,
  };
}

/** @param {any} summary */
function summarizeAgentQueuePass(summary) {
  const results = Array.isArray(summary?.results) ? summary.results : [];
  const count = results.length;
  const finalQueue = summary?.finalQueueCounts ?? {};
  const queueSentence = `Queue now ${finalQueue.dueTaskCount ?? 0} due, ${finalQueue.waitingTaskCount ?? 0} waiting, ${finalQueue.blockerCount ?? 0} blockers.`;
  if (summary?.status === "noop") {
    return `Agent checked the queue. Nothing ran. ${queueSentence}`;
  }
  const lastReason = summary?.reason
    ?? results.at(-1)?.detail?.reason
    ?? null;
  const ranSentence = `Agent ran ${count} task${count === 1 ? "" : "s"}${summary?.status === "blocked" ? " before blocking" : ""}.`;
  return [ranSentence, lastReason, queueSentence].filter(Boolean).join(" ");
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
    notes: "Recorded from the operator surface.",
  });
  const degreeNote = transitioned.connectionDegreeMarked ? " Marked as a 1st-degree connection." : "";

  // Auto-promote on accept: a fresh connection is a real relationship, not a
  // manual "promote" decision (the only sane outcome would be promote anyway).
  // Pulling them into the backlog now means the agent can draft a first message
  // and the operator's only call is approve-and-send. Non-fatal if it can't.
  let promoteNote = "";
  if (args.nextKind === "connection_request_accepted") {
    try {
      const result = await autoPromoteInboundAccepts({ userId: transitioned.existing?.userId ?? null });
      if (result.count > 0) promoteNote = " Brought into the transition backlog as a prospect.";
    } catch {
      // Promotion is best-effort; recording the accept already succeeded.
    }
  }

  // A reject is queued for the agent, not done locally — say so plainly.
  if (args.nextKind === "connection_request_decline_requested") {
    return {
      ok: true,
      writer: "recordInboundObservation",
      message: `Queued the agent to reject ${transitioned.existing.actorName ?? "this invite"} on LinkedIn — it will drop off once declined.`,
    };
  }

  return {
    ok: true,
    writer: "recordInboundObservation",
    message: `Recorded ${transitioned.existing.actorName ?? "inbound invite"} as ${args.nextKind.replace(/^connection_request_/, "")}.${degreeNote}${promoteNote}`,
  };
}
