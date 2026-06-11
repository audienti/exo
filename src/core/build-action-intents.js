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
 * @property {string} kind                       "schedule" | "record-touch" | "queue" | "lifecycle" | "packet-review"
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

const DISPOSITION_LABELS = {
  active: "Reactivate",
  nurture: "Nurture",
  not_a_fit: "Not a fit",
  no_longer_target: "No longer target",
  exhausted: "Exhausted",
};

const PACKET_ACTION_LABELS = {
  accepted: "Accept",
  amended: "Amend",
  returned: "Return",
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
 * Build the canonical Exo writeback intent for a motion-linked account
 * lifecycle disposition.
 *
 * @param {{
 *   motionId: string,
 *   companyId: string,
 *   disposition: "active" | "nurture" | "not_a_fit" | "no_longer_target" | "exhausted",
 *   reason?: string | null,
 *   actor?: "operator" | "agent" | "system" | null,
 * }} input
 * @returns {ActionIntent}
 */
export function buildAccountDispositionActionIntent(input) {
  const actor = input.actor ?? "operator";
  const reason = input.reason ?? (input.disposition === "active" ? "Reactivated by operator." : null);
  return {
    kind: "lifecycle",
    label: DISPOSITION_LABELS[input.disposition] ?? input.disposition,
    command: buildAccountDispositionCommand(input, reason, actor),
    writer: "setAccountDisposition",
    args: {
      motionId: input.motionId,
      companyId: input.companyId,
      disposition: input.disposition,
      reason,
      actor,
    },
  };
}

/**
 * Build the canonical Exo writeback intent for a motion prospect lifecycle
 * disposition.
 *
 * @param {{
 *   motionId: string,
 *   companyId: string,
 *   prospectId: string,
 *   disposition: "active" | "nurture" | "not_a_fit" | "no_longer_target" | "exhausted",
 *   reason?: string | null,
 *   actor?: "operator" | "agent" | "system" | null,
 * }} input
 * @returns {ActionIntent}
 */
export function buildProspectDispositionActionIntent(input) {
  const actor = input.actor ?? "operator";
  const reason = input.reason ?? (input.disposition === "active" ? "Reactivated by operator." : null);
  return {
    kind: "lifecycle",
    label: DISPOSITION_LABELS[input.disposition] ?? input.disposition,
    command: buildProspectDispositionCommand(input, reason, actor),
    writer: "setProspectDisposition",
    args: {
      motionId: input.motionId,
      companyId: input.companyId,
      prospectId: input.prospectId,
      disposition: input.disposition,
      reason,
      actor,
    },
  };
}

/**
 * Build the canonical Exo writeback intent for resolving an operator packet
 * review.
 *
 * @param {{
 *   motionId: string,
 *   packetId: string,
 *   action: "accepted" | "amended" | "returned",
 *   outcome?: "advance" | "nurture" | "not_a_fit" | "no_longer_target" | "exhausted" | null,
 *   nextStatus?: "researched" | "suppressed" | "exhausted" | null,
 *   reason?: string | null,
 *   notes?: string | null,
 *   reviewer?: string | null,
 * }} input
 * @returns {ActionIntent}
 */
export function buildPacketReviewActionIntent(input) {
  return {
    kind: "packet-review",
    label: packetReviewLabel(input),
    command: buildPacketReviewCommand(input),
    writer: "resolvePacketReview",
    args: compactObject({
      motionId: input.motionId,
      packetId: input.packetId,
      action: input.action,
      outcome: input.outcome ?? null,
      nextStatus: input.nextStatus ?? null,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      reviewer: input.reviewer ?? null,
    }),
  };
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
 * @param {{
 *   motionId: string,
 *   companyId: string,
 *   disposition: string,
 * }} input
 * @param {string | null} reason
 * @param {string} actor
 */
function buildAccountDispositionCommand(input, reason, actor) {
  const base = input.disposition === "active"
    ? `exo companies disposition reactivate ${input.companyId} --motion ${input.motionId}`
    : `exo companies disposition set ${input.companyId} --motion ${input.motionId} --disposition ${input.disposition}`;
  return `${base}${reason ? ` --reason ${shellQuote(reason)}` : ""}${actor !== "operator" ? ` --actor ${actor}` : ""} --json`;
}

/**
 * @param {{
 *   motionId: string,
 *   companyId: string,
 *   prospectId: string,
 *   disposition: string,
 * }} input
 * @param {string | null} reason
 * @param {string} actor
 */
function buildProspectDispositionCommand(input, reason, actor) {
  const base = input.disposition === "active"
    ? `exo companies prospects disposition reactivate ${input.companyId} --motion ${input.motionId} --prospect ${input.prospectId}`
    : `exo companies prospects disposition set ${input.companyId} --motion ${input.motionId} --prospect ${input.prospectId} --disposition ${input.disposition}`;
  return `${base}${reason ? ` --reason ${shellQuote(reason)}` : ""}${actor !== "operator" ? ` --actor ${actor}` : ""} --json`;
}

/**
 * @param {{
 *   motionId: string,
 *   packetId: string,
 *   action: "accepted" | "amended" | "returned",
 *   outcome?: string | null,
 *   nextStatus?: string | null,
 *   reason?: string | null,
 *   notes?: string | null,
 *   reviewer?: string | null,
 * }} input
 */
function buildPacketReviewCommand(input) {
  const verb = input.action === "accepted" ? "accept" : input.action === "returned" ? "return" : "amend";
  const parts = [`exo agent packets ${verb} ${input.motionId}`, `--packet ${input.packetId}`];
  if (input.outcome) parts.push(`--outcome ${input.outcome}`);
  if (input.nextStatus) parts.push(`--next-status ${input.nextStatus}`);
  if (input.reason) parts.push(`--reason ${shellQuote(input.reason)}`);
  if (input.notes) parts.push(`--notes ${shellQuote(input.notes)}`);
  if (input.reviewer) parts.push(`--reviewer ${shellQuote(input.reviewer)}`);
  parts.push("--json");
  return parts.join(" ");
}

/**
 * @param {{ action: "accepted" | "amended" | "returned", outcome?: string | null }} input
 */
function packetReviewLabel(input) {
  if (input.action === "amended" && input.outcome) {
    return DISPOSITION_LABELS[input.outcome] ?? `Amend ${input.outcome.replaceAll("_", " ")}`;
  }
  return PACKET_ACTION_LABELS[input.action] ?? input.action;
}

/** @param {Record<string, any>} input */
function compactObject(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
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
