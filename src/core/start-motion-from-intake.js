// @ts-check

import { assignMotionUser } from "./assign-motion-user.js";
import { buildMotionIntake } from "./build-motion-intake.js";
import { ensureTransitionMotion } from "./ensure-transition-motion.js";
import { runAgentQueuePassAction } from "./run-agent-queue-pass.js";
import { startMotion } from "./start-motion.js";
import {
  findUserById,
  insertMotion,
  listBrowserProfiles,
  listMotions,
  updateMotion,
} from "../db/database.js";

/**
 * @param {Record<string, any>} args
 * @param {{ kickoffAgentQueuePass?: (args: Record<string, any>) => { ok: true, writer: string, message: string } | Promise<{ ok: true, writer: string, message: string }> }} [deps]
 */
export async function startMotionFromIntakeAction(args, deps = {}) {
  const kickoffAgentQueuePass = deps.kickoffAgentQueuePass ?? runAgentQueuePassAction;
  const mode = normalizeMotionIntakeMode(args.mode);
  const userId = normalizeOptionalString(args.userId);
  if (!userId) {
    throw new Error(mode === "transition"
      ? "Select an execution user before opening the transition backlog."
      : "Select a launch user before starting a motion.");
  }
  const rawUser = findUserById(userId);
  if (!rawUser) {
    throw new Error(`User not found: ${userId}`);
  }

  if (mode === "transition") {
    const transitionMotion = await ensureTransitionMotion();
    const assigned = assignMotionUser(transitionMotion, rawUser, listBrowserProfiles(), {
      assignedBy: "exo-ui",
      reason: "Carry ongoing interface-driven relationships through one governed container",
    });
    updateMotion(assigned);
    return {
      ok: true,
      writer: "startMotionFromIntake",
      message: `Opened transition backlog and assigned it to ${assigned.engagementUserAssignment?.label ?? rawUser.label}.`,
      redirect: args.redirectTo ?? `/motions/${assigned.id}`,
      motionId: assigned.id,
      kickoff: null,
    };
  }

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
      launchUserId: userId,
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
    const maybeAssigned = assignLaunchUserIfNeeded(result.motion, rawUser, {
      assignedBy: "exo-ui",
      reason: "Keep one execution identity for this motion",
      force: false,
    });
    if (maybeAssigned.changed) {
      updateMotion(maybeAssigned.motion);
    }
    return {
      ok: true,
      writer: "startMotionFromIntake",
      message: maybeAssigned.changed
        ? `Continuing ${maybeAssigned.motion.name} and assigned it to ${maybeAssigned.motion.engagementUserAssignment?.label ?? rawUser.label}.`
        : `Continuing ${result.motion.name}.`,
      redirect: args.redirectTo ?? `/motions/${result.motion.id}`,
      motionId: result.motion.id,
      kickoff: null,
    };
  }

  const motionWithUser = result.status === "created" || result.status === "cloned"
    ? assignMotionUser(result.motion, rawUser, listBrowserProfiles(), {
        assignedBy: "exo-ui",
        reason: "Keep one execution identity for this motion",
      })
    : result.motion;
  const storedMotion = result.status === "created" || result.status === "cloned"
    ? insertMotion(motionWithUser)
    : motionWithUser;
  const verb = result.status === "cloned" ? "Cloned" : "Created";
  const kickoff = args.kickoffAgentPass
    ? await kickoffAgentQueuePass({
        background: true,
        sendMode: args.sendMode ?? "verify",
      })
    : null;

  return {
    ok: true,
    writer: "startMotionFromIntake",
    message: [
      `${verb} motion ${storedMotion.name} and assigned it to ${storedMotion.engagementUserAssignment?.label ?? rawUser.label}.`,
      kickoff?.message ?? null,
    ].filter(Boolean).join(" "),
    redirect: args.redirectTo ?? `/motions/${storedMotion.id}`,
    motionId: storedMotion.id,
    kickoff,
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
 * @returns {"motion" | "transition"}
 */
function normalizeMotionIntakeMode(value) {
  return normalizeOptionalString(value) === "transition" ? "transition" : "motion";
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

/**
 * @param {import("../schema/motion.js").motionSchema._type} rawMotion
 * @param {import("../schema/user.js").userSchema._type} rawUser
 * @param {{ assignedBy?: string | null, reason?: string | null, force?: boolean }} [options]
 */
function assignLaunchUserIfNeeded(rawMotion, rawUser, options = {}) {
  const assignedUserId = rawMotion.engagementUserAssignment?.userId ?? null;
  if (assignedUserId === rawUser.id) {
    return { motion: rawMotion, changed: false };
  }
  if (assignedUserId && !options.force) {
    return { motion: rawMotion, changed: false };
  }
  return {
    motion: assignMotionUser(rawMotion, rawUser, listBrowserProfiles(), {
      assignedBy: options.assignedBy ?? null,
      reason: options.reason ?? null,
    }),
    changed: true,
  };
}
