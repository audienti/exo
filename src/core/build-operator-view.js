// @ts-check
//
// Operator landing view model.
//
// Reshapes the existing workspace projection (operatorSummary + decisionQueue
// + agentQueue + truthAccounts + motion summaries) into the shared model used
// by the Operator landing and the separate Agent queue page.
//
// Pure data — no rendering. The renderers in src/artifacts/render-operator.js
// and src/artifacts/render-queue.js turn this into HTML using the shared UI
// primitives.

import { listActiveBrowserBackoffs } from "../lib/agent-host-state.js";

/**
 * @typedef {Object} OperatorViewModel
 * @property {{ id: string, label: string, owner: string }} user
 * @property {string} generatedAt
 * @property {string} regenerateCommand
 * @property {OperatorViewCounts} counts
 * @property {OperatorAgentRuntime | null} agentRuntime
 * @property {OperatorNextMove | null} nextMove
 * @property {OperatorDecisionCard[]} decisions
 * @property {OperatorQueueItem[]} queue
 * @property {OperatorBlockedCard[]} blocked
 * @property {OperatorStaleRow[]} stale
 * @property {OperatorAgendaRow[]} agenda
 *
 * @typedef {Object} OperatorViewCounts
 * @property {number} decisions
 * @property {number} queue
 * @property {number} blocked
 * @property {number} stale
 * @property {number} agendaLeft
 *
 * @typedef {Object} OperatorAgentRuntime
 * @property {"off" | "running" | "on"} state
 * @property {string} headline
 * @property {string} detail
 * @property {string | null} cadenceLabel
 * @property {string | null} sendMode
 * @property {string | null} lastPassSummary
 * @property {number} queueCount
 * @property {boolean} canRunNow
 *
 * @typedef {Object} OperatorNextMove
 * @property {string} title
 * @property {string | null} subject
 * @property {string | null} prospectId
 * @property {string | null} personId
 * @property {string | null} avatarUrl
 * @property {string | null} subtitle
 * @property {string | null} motionName
 * @property {string | null} motionStatus
 * @property {string} truth
 * @property {string | null} truthAt
 * @property {string | null} surface
 * @property {string} action
 * @property {string | null} actionStatus
 * @property {string | null} actionWriter
 * @property {Record<string, any> | null} actionArgs
 * @property {string | null} actionHref
 * @property {string | null} why
 * @property {string | null} previewLabel
 * @property {string | null} previewSubject
 * @property {string | null} previewText
 * @property {Array<{ id: string, name: string, stage: string, queueStatus?: string | null, href: string | null }> | null} backlogCompanies
 *
 * @typedef {Object} OperatorDecisionCard
 * @property {string} id
 * @property {string} person
 * @property {string | null} prospectId
 * @property {string | null} initials
 * @property {string | null} avatarUrl
 * @property {string | null} role
 * @property {string | null} company
 * @property {string | null} roleLine
 * @property {"high" | "block" | "medium" | null} stakes
 * @property {string} summary
 * @property {string} truth
 * @property {string | null} truthAt
 * @property {string | null} surface
 * @property {string} actionStatus
 * @property {string} primaryActionLabel
 * @property {string | null} primaryHref
 * @property {string} secondaryActionLabel
 * @property {string | null} secondaryHref
 * @property {string | null} why
 * @property {string | null} previewLabel
 * @property {string | null} previewSubject
 * @property {string | null} previewText
 *
 * @typedef {Object} OperatorQueueItem
 * @property {string} id
 * @property {string} subject
 * @property {string | null} motionName
 * @property {string} action
 * @property {string} note
 * @property {string} capability
 * @property {string | null} dueAt
 * @property {string | null} dueAtIso
 * @property {string | null} waitingFor
 * @property {string | null} href
 *
 * @typedef {Object} OperatorBlockedAction
 * @property {string} writer
 * @property {string} label
 * @property {Record<string, any>} args
 *
 * @typedef {Object} OperatorBlockedCard
 * @property {string} id
 * @property {string} subject
 * @property {string} reason
 * @property {string} detail
 * @property {"assignment" | "capability" | "failed"} blockType
 * @property {string} resolveLabel
 * @property {string} channel
 * @property {OperatorBlockedAction[]} actions
 *
 * @typedef {Object} OperatorStaleRow
 * @property {string} id
 * @property {string} subject
 * @property {string} detail
 * @property {"unchecked" | "partial" | "failed" | "checked" | "quiet"} truth
 * @property {string | null} lastChecked
 * @property {string} resolveLabel
 *
 * @typedef {Object} OperatorAgendaRow
 * @property {string} id
 * @property {string} time
 * @property {string} label
 * @property {string} meta
 * @property {"decision" | "agent" | "truth" | "blocked"} kind
 * @property {boolean} done
 */

/**
 * @param {{
 *   user: { id: string, label: string, owner: string },
 *   generatedAt: string,
 *   regenerateCommand: string,
 *   operatorSummary: any,
 *   decisionQueue: any,
 *   agentQueue: any,
 *   blockedQueue?: any,
 *   truthAccounts: any[],
 *   agentRuntime?: any,
 * }} input
 * @returns {OperatorViewModel}
 */
export function buildOperatorViewModel(input) {
  // Items the operator has already resolved must not show as "Need decision".
  // Once a first message is approved/queued (now the agent's to send), already
  // sent, steer-excluded, or the invite is resolved/declined, there's nothing
  // left for the operator to decide. Leaving them in the lane is what made the
  // queue feel incoherent — handled people sitting as live next moves. (These
  // states are all set upstream in buildReviewItem / classifyReviewObservation.)
  const HANDLED_STATES = new Set([
    "agent_draft_due",
    "queued_for_send",
    "post_accept_sent",
    "reply_sent",
    "reply_unavailable",
    "excluded_by_steer",
    "decline_queued",
    "resolved_declined",
  ]);
  const decisionItems = (input.decisionQueue?.items ?? []).filter(
    (item) => !HANDLED_STATES.has(item.state),
  );
  // The Next-move hero is promoted from the top decision; don't render it again
  // in "Need decision" below.
  const promotedDecision = decisionItems.find((item) => item.priority === "high") ?? null;
  const nextMove = shapeNextMove(input.operatorSummary ?? null, promotedDecision);
  const promotedId = nextMove && promotedDecision ? promotedDecision.id : null;

  const decisions = shapeDecisions(decisionItems.filter((item) => item.id !== promotedId));
  const queue = shapeQueue(input.agentQueue?.items ?? []);
  const blocked = shapeBlocked(input.blockedQueue?.items ?? input.agentQueue?.blockers ?? []);
  const stale = shapeStale(input.truthAccounts ?? []);
  const agenda = shapeAgenda(input.operatorSummary?.checklist ?? []);

  const counts = {
    decisions: decisions.length,
    queue: queue.length,
    blocked: blocked.length,
    stale: stale.length,
    agendaLeft: agenda.filter((row) => !row.done).length,
  };
  const agentRuntime = shapeAgentRuntime(input.agentRuntime ?? null, counts.queue);

  return {
    user: input.user,
    generatedAt: input.generatedAt,
    regenerateCommand: input.regenerateCommand,
    counts,
    agentRuntime,
    nextMove,
    decisions,
    queue,
    blocked,
    stale,
    agenda,
  };
}

/**
 * @param {any} summary
 * @param {any} topDecision  the highest-priority open decision, or null
 * @returns {OperatorNextMove | null}
 */
function shapeNextMove(summary, topDecision) {
  if (!summary) return null;

  // Prefer a real person-anchored decision as the hero when one exists.
  // Autonomous queue work belongs in Agent queue, not in Operator as a
  // single-click pseudo-decision.
  if (topDecision) {
    return {
      title: topDecision.recommendedAction || topDecision.summary,
      subject: topDecision.subject,
      prospectId: topDecision.prospectId ?? null,
      personId: topDecision.id ?? null,
      avatarUrl: topDecision.avatarUrl ?? null,
      subtitle: composeSubtitle(topDecision.actorTitle, topDecision.actorCompanyName ?? topDecision.companyName),
      motionName: topDecision.motionName,
      motionStatus: "active",
      truth: pickDecisionTruth(topDecision),
      truthAt: relativeFromIso(topDecision.observedAt),
      surface: humanizeSurfaceKey(topDecision.surfaceKey),
      action: pickPrimaryActionLabel(topDecision),
      actionStatus: actionStatusForState(topDecision.state ?? ""),
      actionWriter: null,
      actionArgs: null,
      actionHref: topDecision.actorProfileUrl ?? topDecision.sourceUrl ?? null,
      why: topDecision.why ?? null,
      previewLabel: topDecision.previewLabel ?? null,
      previewSubject: topDecision.previewSubject ?? null,
      previewText: topDecision.previewText ?? null,
      backlogCompanies: null,
    };
  }

  return null;
}

/**
 * @param {any[]} items
 * @returns {OperatorDecisionCard[]}
 */
function shapeDecisions(items) {
  return items.map((item) => {
    const stakes = item.priority === "high" ? "high" : null;
    return {
      id: String(item.id),
      person: item.subject ?? "Unknown",
      prospectId: item.prospectId ?? null,
      initials: initialsFromName(item.subject ?? null),
      avatarUrl: item.avatarUrl ?? null,
      role: item.actorTitle ?? null,
      company: item.actorCompanyName ?? item.companyName ?? null,
      roleLine: composeSubtitle(item.actorTitle ?? null, item.actorCompanyName ?? item.companyName ?? null),
      stakes,
      summary: item.recommendedAction ?? item.summary ?? "",
      truth: pickDecisionTruth(item),
      truthAt: relativeFromIso(item.observedAt),
      surface: humanizeSurfaceKey(item.surfaceKey),
      actionStatus: actionStatusForState(item.state ?? ""),
      primaryActionLabel: pickPrimaryActionLabel(item),
      primaryHref: item.actorProfileUrl ?? item.sourceUrl ?? null,
      secondaryActionLabel: pickSecondaryActionLabel(item),
      secondaryHref: null,
      why: item.why ?? null,
      previewLabel: item.previewLabel ?? null,
      previewSubject: item.previewSubject ?? null,
      previewText: item.previewText ?? null,
    };
  });
}

/**
 * Resolve the surface an operator should open to review/act on a queued item.
 * Prospect-scoped work (cadence, inbound observation, parallel support) deep-
 * links to the prospect; surface-level work routes to its surface.
 * @param {any} item
 * @returns {string | null}
 */
function queueItemHref(item) {
  if (item.prospectId) {
    return `/prospects/${item.prospectId}`;
  }

  if (item.observationId) {
    return "/connections";
  }

  if (item.sourceType === "company_research_packet" && item.companyId && item.motionId) {
    return `/companies/${encodeURIComponent(item.companyId)}/research-brief/${encodeURIComponent(item.motionId)}`;
  }

  const segments = String(item.id ?? "").split("::");
  const last = segments[segments.length - 1] ?? "";
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(last);
  switch (item.sourceType) {
    case "cadence":
    case "inbound_observation":
    case "parallel_support_action":
      return isUuid ? `/prospects/${last}` : null;
    case "inbound_itemization_gap":
      return "/connections";
    case "outbound_capacity":
      return "/workspace";
    default:
      return null;
  }
}

/**
 * @param {any[]} items
 * @returns {OperatorQueueItem[]}
 */
function shapeQueue(items) {
  return items
    .filter((item) => item && item.action)
    .map((item) => ({
      id: String(item.id),
      subject: item.subject ?? "Unknown work",
      motionName: item.motionName ?? null,
      action: shortenAction(item.action ?? ""),
      note: item.why ?? "",
      capability: deriveCapabilityLabel(item),
      dueAt: relativeFromIso(item.dueAt),
      dueAtIso: item.dueAt ?? null,
      // How long the agent has been holding this — measured from when it became
      // due-now. Past tense ("5m") for already-overdue items, future tense for
      // items still ramping up.
      waitingFor: waitingLabel(item.dueAt),
      // Where the operator goes to review/act on this queued work.
      href: queueItemHref(item),
    }));
}

/**
 * @param {any[]} blockers
 * @returns {OperatorBlockedCard[]}
 */
function shapeBlocked(blockers) {
  return blockers.map((blocker, index) => {
    if (blocker && blocker.blockType && blocker.reason && blocker.detail) {
      return {
        id: blocker.id ?? `blocker-${index}-${blocker.channel ?? "any"}`,
        subject: blocker.subject ?? `${blocker.channel ?? "Channel"} blocked`,
        reason: blocker.reason,
        detail: blocker.detail,
        blockType: blocker.blockType,
        resolveLabel: blocker.resolveLabel ?? "Review",
        channel: blocker.channel ?? "",
        actions: normalizeBlockedActions(blocker),
      };
    }

    const isAssignment =
      Array.isArray(blocker.stateActions) && blocker.stateActions.some((act) => act.kind === "assign_company_user");
    const blockType = isAssignment ? "assignment" : blocker.channel ? "capability" : "failed";
    const subject = blocker.firstCompanyName
      ? `${blocker.firstCompanyName}${blocker.firstProspectName ? ` · ${blocker.firstProspectName}` : ""}`
      : `${blocker.channel ?? "Channel"} blocked`;
    const reason =
      blockType === "assignment"
        ? "Needs operator assignment"
        : blockType === "capability"
          ? "Capability not ready"
          : "Run failed";
    const detail =
      blockType === "assignment"
        ? `${blocker.blockedReadyCount} ready branch${blocker.blockedReadyCount === 1 ? "" : "es"} across ${blocker.blockedCompanyCount} compan${blocker.blockedCompanyCount === 1 ? "y" : "ies"} can't move until an owner is pinned.`
        : `${blocker.channel ?? "This channel"} is blocked — clear the upstream issue before retrying.`;
    const actions = Array.isArray(blocker.stateActions)
      ? blocker.stateActions
          .filter((act) => act && act.kind === "assign_company_user" && act.companyId && act.userId)
          .map((act) => ({
            writer: "assignCompanyUser",
            label: act.companyName ? `Pin ${act.companyName}` : act.label ?? "Pin owner",
            args: {
              companyId: act.companyId,
              userId: act.userId,
              reason: act.reason ?? "Make ready outbound branches executable",
              browserCapability: act.browserCapability ?? "linkedin",
            },
          }))
      : [];
    return {
      id: `blocker-${index}-${blocker.channel ?? "any"}`,
      subject,
      reason,
      detail,
      blockType,
      resolveLabel: blockType === "assignment" ? "Pin owner" : blockType === "failed" ? "Retry" : "Fix capability",
      channel: blocker.channel ?? "",
      actions,
    };
  });
}

/**
 * @param {any[]} truthAccounts
 * @returns {OperatorStaleRow[]}
 */
function shapeStale(truthAccounts) {
  // Stale truth is autonomous work, not operator work. Those refresh tasks
  // belong in Agent queue and should drain without putting a one-click "Run
  // check" gate on the decision surface.
  void truthAccounts;
  return [];
}

/**
 * @param {any[]} checklist
 * @returns {OperatorAgendaRow[]}
 */
function shapeAgenda(checklist) {
  return checklist.map((item, index) => ({
    id: `agenda-${index}`,
    time: formatClockTime(item.dueAt) ?? "—",
    label: shortenAction(item.action ?? item.subject ?? ""),
    meta: shortenSubject(item.subject ?? ""),
    kind: deriveAgendaKind(item),
    done: false,
  }));
}

/**
 * @param {any} runtime
 * @param {number} queueCount
 * @returns {OperatorAgentRuntime | null}
 */
function shapeAgentRuntime(runtime, queueCount) {
  if (!runtime) return null;
  const lock = runtime.lock ?? null;
  const scheduler = runtime.scheduler ?? null;
  const routine = runtime.routine ?? null;
  const lastPass = runtime.lastPass ?? null;
  const activeBackoff = findActiveAgentBackoff(runtime, queueCount);
  const cadenceLabel = formatCadenceLabel(scheduler?.runIntervalSeconds ?? null);
  const sendMode = typeof routine?.sendMode === "string" && routine.sendMode.trim()
    ? routine.sendMode.trim().toLowerCase()
    : null;
  const lastPassSummary = summarizeLastPass(lastPass);

  if (lock?.active) {
    const pidLabel = Number.isInteger(lock.pid) ? ` (pid ${lock.pid})` : "";
    return {
      state: "running",
      headline: scheduler?.loaded ? "Background agent running" : "Agent pass running",
      detail: scheduler?.loaded
        ? `A scheduled agent pass is draining the queue now${pidLabel}${cadenceLabel ? ` on a ${cadenceLabel} cadence` : ""}.`
        : `An agent pass is draining the queue now${pidLabel}.`,
      cadenceLabel,
      sendMode,
      lastPassSummary,
      queueCount,
      canRunNow: false,
    };
  }

  if (activeBackoff) {
    return {
      state: scheduler?.loaded ? "on" : "off",
      headline: "Agent is blocked",
      detail: buildAgentBackoffDetail(activeBackoff, cadenceLabel, Boolean(scheduler?.loaded)),
      cadenceLabel,
      sendMode,
      lastPassSummary,
      queueCount,
      canRunNow: true,
    };
  }

  if (scheduler?.loaded) {
    return {
      state: scheduler.running ? "running" : "on",
      headline: scheduler.running ? "Background agent running" : "Background agent on",
      detail: scheduler.running
        ? `Launchd is draining the queue now${cadenceLabel ? ` on a ${cadenceLabel} cadence` : ""}.`
        : `Background draining is on${cadenceLabel ? ` every ${cadenceLabel}` : ""}.`,
      cadenceLabel,
      sendMode,
      lastPassSummary,
      queueCount,
      canRunNow: !scheduler.running,
    };
  }

  const queuedLabel = `${queueCount} queued task${queueCount === 1 ? "" : "s"}`;
  const offDetail = queueCount > 0
    ? `${queuedLabel} will sit until you run a pass here.`
    : "Background draining is off right now.";
  const installDetail = scheduler?.installed
    ? "The background agent is installed but not loaded."
    : "The background agent is not installed on this machine.";
  return {
    state: "off",
    headline: "Agent is off",
    detail: `${installDetail} ${offDetail}`.trim(),
    cadenceLabel,
    sendMode,
    lastPassSummary,
    queueCount,
    canRunNow: true,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Compose a "Job Title · Company" line, but don't repeat the company when the
 * title already embeds it (e.g. "Founder @Jumon Intelligence" + "Jumon
 * Intelligence", or "Growth Specialist at Audienti" + "Audienti").
 *
 * @param {string | null} title
 * @param {string | null} [company]
 * @returns {string | null}
 */
function composeSubtitle(title, company) {
  const t = (title ?? "").trim();
  const c = (company ?? "").trim();
  if (t && c) {
    return t.toLowerCase().includes(c.toLowerCase()) ? t : `${t} · ${c}`;
  }
  return t || c || null;
}

/** @param {any} item */
function pickDecisionTruth(item) {
  if (!item) return "unchecked";
  if (item.state === "needs_reply" || item.state === "ready_for_post_accept") return "checked";
  if (item.state === "visibility_signal") return "quiet";
  if (item.state === "needs_decision") return "partial";
  return "checked";
}

/** @param {any} item */
function pickPrimaryActionLabel(item) {
  const options = Array.isArray(item.options) ? item.options : [];
  if (options.includes("reply-now")) return "Reply now";
  if (options.includes("message")) return "Send message";
  if (options.includes("accept")) return "Accept";
  if (options.includes("decline")) return "Decline";
  if (item.state === "needs_reply") return "Reply now";
  if (item.state === "ready_for_post_accept") return "Send message";
  return "Open";
}

/** @param {any} item */
function pickSecondaryActionLabel(item) {
  const options = Array.isArray(item.options) ? item.options : [];
  if (options.includes("wait")) return "Hold";
  if (options.includes("decline")) return "Pass";
  return "Profile";
}

/** @param {string} state */
function actionStatusForState(state) {
  if (state === "needs_reply" || state === "ready_for_post_accept") return "due now";
  if (state === "needs_decision") return "needs decision";
  return "needs decision";
}

/** @param {string | null} key */
function humanizeSurfaceKey(key) {
  if (!key) return null;
  return key.replaceAll("-", " ").replace(/^linkedin /, "").replace(/^gmail /, "");
}

/** @param {number | null | undefined} seconds */
function formatCadenceLabel(seconds) {
  if (!Number.isFinite(seconds) || Number(seconds) <= 0) return null;
  const total = Number(seconds);
  if (total % 3600 === 0) return `${total / 3600}h`;
  if (total % 60 === 0) return `${total / 60}m`;
  return `${total}s`;
}

/** @param {string | null | undefined} name */
function initialsFromName(name) {
  if (!name) return null;
  return name
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .slice(0, 2)
    .join("");
}

/** @param {string | null | undefined} iso */
function relativeFromIso(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const diffMs = Date.now() - target.getTime();
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return past ? "just now" : "in <1m";
  if (abs < hour) {
    const value = Math.round(abs / minute);
    return past ? `${value}m ago` : `in ${value}m`;
  }
  if (abs < day) {
    const value = Math.round(abs / hour);
    return past ? `${value}h ago` : `in ${value}h`;
  }
  const days = Math.round(abs / day);
  return past ? `${days}d ago` : `in ${days}d`;
}

/** @param {any} lastPass */
function summarizeLastPass(lastPass) {
  if (!lastPass?.endedAt) return null;
  const when = relativeFromIso(lastPass.endedAt) ?? "recently";
  const status = String(lastPass.status ?? "finished").replaceAll("_", " ");
  return `Last pass ${status} ${when}`;
}

/**
 * @param {any} runtime
 * @param {number} queueCount
 */
function findActiveAgentBackoff(runtime, queueCount) {
  if (!runtime || queueCount <= 0) return null;
  const active = listActiveBrowserBackoffs(runtime.hostState ?? null);
  return active.find((entry) => entry.lane === "execution")
    ?? active.find((entry) => entry.lane === "retrieval")
    ?? null;
}

/**
 * @param {{ lane?: string | null }} backoff
 * @param {string | null} cadenceLabel
 * @param {boolean} schedulerLoaded
 */
function buildAgentBackoffDetail(backoff, cadenceLabel, schedulerLoaded) {
  const laneLabel = backoff?.lane === "retrieval" ? "Inbound refresh work" : "Send work";
  const schedulerLabel = schedulerLoaded
    ? cadenceLabel
      ? `Background draining is enabled ${cadenceLabel}.`
      : "Background draining is enabled."
    : "No pass is running right now.";
  return `${schedulerLabel} ${laneLabel} is blocked right now.`;
}

/**
 * Format how long the queue has been holding this item. Past-due items return
 * "waiting 5m" / "waiting 3h"; not-yet-due items return "due in 5m".
 * Null when no dueAt is available so the renderer can omit the chip.
 *
 * @param {string | null | undefined} iso
 * @returns {string | null}
 */
function waitingLabel(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const diffMs = Date.now() - target.getTime();
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  let unit;
  if (abs < minute) {
    unit = "<1m";
  } else if (abs < hour) {
    unit = `${Math.round(abs / minute)}m`;
  } else if (abs < day) {
    unit = `${Math.round(abs / hour)}h`;
  } else {
    unit = `${Math.round(abs / day)}d`;
  }
  return past ? `waiting ${unit}` : `due in ${unit}`;
}

/** @param {string | null | undefined} iso */
function formatClockTime(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const hour = target.getHours();
  const minute = target.getMinutes();
  const period = hour >= 12 ? "p" : "a";
  const display = ((hour + 11) % 12) + 1;
  return `${display}:${minute.toString().padStart(2, "0")}${period}`;
}

/**
 * @param {any} item
 */
function deriveAgendaKind(item) {
  const subject = String(item.subject ?? "").toLowerCase();
  if (subject.includes("inbound") || subject.includes("itemization")) return "truth";
  if (subject.includes("blocked") || subject.includes("block")) return "blocked";
  if (subject.includes("decide") || subject.includes("decision")) return "decision";
  return "agent";
}

/** @param {string} text */
function shortenAction(text) {
  if (!text) return "";
  const max = 96;
  if (text.length <= max) return text;
  const truncated = text.slice(0, max).replace(/\s+\S*$/, "");
  return `${truncated}…`;
}

/** @param {string} text */
function shortenSubject(text) {
  if (!text) return "";
  const max = 36;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** @param {any} item */
function deriveCapabilityLabel(item) {
  const subject = String(item.subject ?? "");
  const match = subject.match(/^([a-z][a-z-]+):/i);
  if (match) return match[1];
  if (item.sourceType === "company_research_packet") return "company research";
  if (item.sourceType?.includes("inbound")) return "inbound sync";
  if (item.sourceType === "maintenance") return "maintenance";
  return "exo";
}

/** @param {any} blocker */
function normalizeBlockedActions(blocker) {
  if (Array.isArray(blocker.actions)) {
    return blocker.actions;
  }

  return Array.isArray(blocker.stateActions)
    ? blocker.stateActions
        .filter((act) => act && act.kind === "assign_company_user" && act.companyId && act.userId)
        .map((act) => ({
          writer: "assignCompanyUser",
          label: act.companyName ? `Pin ${act.companyName}` : act.label ?? "Pin owner",
          args: {
            companyId: act.companyId,
            userId: act.userId,
            reason: act.reason ?? "Make ready outbound branches executable",
            browserCapability: act.browserCapability ?? "linkedin",
          },
        }))
    : [];
}

/**
 * @param {string | null | undefined} lastRunStatus
 * @param {any} meta
 * @returns {"unchecked" | "partial" | "failed" | "checked" | "quiet"}
 */
function mapSurfaceTruth(lastRunStatus, meta) {
  if (lastRunStatus === "error" || lastRunStatus === "failure") return "failed";
  if (meta?.unchecked) return "unchecked";
  if (meta?.itemizationGap || meta?.stale || lastRunStatus === "warning") return "partial";
  if (lastRunStatus === "success") return "checked";
  return "quiet";
}
