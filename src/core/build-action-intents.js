// @ts-check
//
// Action intents — the bridge between an operator surface and Exo's governed
// state. Each actionable item maps to the real Exo writeback it represents,
// using the existing cadence / queue / result writers (no new action store).
//
// The interface is meant to be popped up by the agent when it's convenient for
// the operator. When the operator decides, the agent executes the mapped
// writeback: the intent carries both a runnable `exo` command (CLI-first) and
// the typed `{ writer, args }` so a programmatic driver can call the core
// function directly. Either way the action lands in cadence/queue/touch state,
// and the derived Operator agent-queue/daily surfaces update for free.

/**
 * @typedef {Object} ActionIntent
 * @property {string} kind                       "schedule" | "record-touch" | "queue"
 * @property {string} label                      human label for the affordance
 * @property {string} command                    a runnable `exo ...` command
 * @property {string} writer                      core writer function name
 * @property {Record<string, any>} args          typed args for the writer
 */

/** branch (record-state) → cadence step + touch surface + outcome */
const BRANCH_MOVE = {
  identified: { step: "connection-request", surface: "connection_request", outcome: "sent", verb: "Queue connection request" },
  "pre-connect": { step: "connection-request", surface: "profile_view", outcome: "sent", verb: "Warm before connecting" },
  "connection-requested": { step: "direct-message", surface: "follow_up_direct_message", outcome: "pending", verb: "Schedule follow-up" },
  connected: { step: "direct-message", surface: "post_accept_message", outcome: "sent", verb: "Draft opening message" },
  "reply-accepted": { step: "direct-message", surface: "follow_up_direct_message", outcome: "sent", verb: "Continue conversation" },
  ready: { step: "connection-request", surface: "connection_request", outcome: "sent", verb: "Queue first move" },
  waiting: { step: "quarterly-retouch", surface: "follow_up_direct_message", outcome: "nurture", verb: "Hold for retouch" },
  blocked: { step: "value-add-email", surface: "email", outcome: "pending", verb: "Try email fallback" },
};

/**
 * Build the canonical Exo writeback intents for one prospect.
 *
 * @param {{
 *   prospectId: string,
 *   companyId: string,
 *   motionId: string | null,
 *   name?: string | null,
 *   branch: string,
 *   nextAction?: string | null,
 *   primaryChannel?: string | null,
 * }} prospect
 * @param {{ now?: string }} [options]
 * @returns {{ schedule: ActionIntent | null, recordTouch: ActionIntent | null }}
 */
export function buildProspectActionIntents(prospect, options = {}) {
  if (!prospect.companyId || !prospect.prospectId) {
    return { schedule: null, recordTouch: null };
  }
  const now = options.now ?? new Date().toISOString();
  const move = BRANCH_MOVE[prospect.branch] ?? BRANCH_MOVE.identified;
  const motionFlag = prospect.motionId ? ` --motion ${prospect.motionId}` : "";
  const nextText = (prospect.nextAction ?? move.verb).replace(/\s+/g, " ").trim();
  const summary = `${move.verb} for ${prospect.name ?? "prospect"}`.replace(/\s+/g, " ").trim();
  const actionResult = deriveActionResultMove(move);

  /** @type {ActionIntent} */
  const schedule = {
    kind: "schedule",
    label: move.verb,
    command:
      `exo companies cadence set ${prospect.companyId}` +
      ` --prospect ${prospect.prospectId}${motionFlag}` +
      ` --current-step ${move.step}` +
      ` --next-action ${shellQuote(nextText)}` +
      ` --next-action-due-at ${now}`,
    writer: "setMotionProspectCadence",
    args: {
      companyId: prospect.companyId,
      prospectId: prospect.prospectId,
      motionId: prospect.motionId ?? null,
      currentStep: move.step,
      nextAction: nextText,
      nextActionDueAt: now,
    },
  };

  /** @type {ActionIntent} */
  const recordTouch = {
    kind: "record-touch",
    label: actionResult ? `Record ${move.surface.replaceAll("_", " ")}` : `Log ${move.surface.replaceAll("_", " ")}`,
    command: actionResult
      ? `exo actions result --action ${actionResult.actionKey} --result ${actionResult.resultKey}` +
        ` --company ${prospect.companyId} --prospect ${prospect.prospectId}${motionFlag}` +
        (actionResult.surface ? ` --surface ${actionResult.surface}` : "") +
        ` --occurred-at ${now}` +
        ` --summary ${shellQuote(summary)}`
      : `exo companies touches add ${prospect.companyId}` +
        ` --prospect ${prospect.prospectId}${motionFlag}` +
        ` --surface ${move.surface}` +
        ` --direction outbound` +
        ` --outcome ${move.outcome}` +
        ` --occurred-at ${now}` +
        ` --summary ${shellQuote(summary)}`,
    writer: actionResult ? "recordActionResult" : "recordMotionProspectTouch",
    args: actionResult
      ? {
          actionKey: actionResult.actionKey,
          resultKey: actionResult.resultKey,
          motionId: prospect.motionId ?? null,
          companyId: prospect.companyId,
          prospectId: prospect.prospectId,
          surface: actionResult.surface,
          occurredAt: now,
          summary,
        }
      : {
          companyId: prospect.companyId,
          prospectId: prospect.prospectId,
          motionId: prospect.motionId ?? null,
          surface: move.surface,
          direction: "outbound",
          outcome: move.outcome,
          occurredAt: now,
          summary,
        },
  };

  return { schedule, recordTouch };
}

/**
 * Minimal POSIX shell quoting for the emitted command strings.
 * @param {string} value
 */
function shellQuote(value) {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * @param {{ surface: string, outcome: string }} move
 */
function deriveActionResultMove(move) {
  switch (move.surface) {
    case "connection_request":
      return move.outcome === "sent" ? { actionKey: "connection_request", resultKey: "sent", surface: "connection_request" } : null;
    case "profile_view":
      return move.outcome === "sent" ? { actionKey: "profile_view", resultKey: "sent", surface: "profile_view" } : null;
    case "post_accept_message":
    case "follow_up_direct_message":
      return move.outcome === "sent" ? { actionKey: "send_direct_message", resultKey: "sent", surface: move.surface } : null;
    case "email":
      return move.outcome === "sent" ? { actionKey: "send_email", resultKey: "sent", surface: "email" } : null;
    default:
      return null;
  }
}
