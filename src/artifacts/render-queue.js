// @ts-check
//
// Agent queue surface — everything the agent is about to run or is holding
// because no one has touched it. Moved out of the Operator landing so the
// Operator view stays focused on decisions and the queue gets its own scan-
// friendly page. Each row shows how long the work has been waiting.
//
// Layout: a one-line runtime disclosure (expand for install/lock facts), a
// one-row status strip (current work / backlog / throughput), then the queue
// itself behind a segmented control that flips between queue cards and the
// full inbound-surface telemetry list.

import {
  avatar,
  btn,
  card,
  emptyState,
  escapeHtml,
  formatRelative,
  iconSvg,
  liveActionBtn,
  renderShell,
  segTabs,
  stateDot,
} from "../lib/exo-ui-components.js";
import { renderAgentRuntimeBar, renderAgentRuntimeMeta } from "./render-agent-runtime-card.js";

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {{ interactive?: boolean, generatedAt?: string, agentStatus?: any, agentRunLog?: any }} [meta]
 * @returns {string}
 */
export function renderQueuePage(model, meta = {}) {
  const runtime = model.agentRuntime ?? meta.agentRuntime ?? null;
  const agentStatus = meta.agentStatus ?? null;
  const liveSendGate = buildLiveSendGate(agentStatus, model.queue);
  const queueGroups = buildQueueGroups(model.queue, liveSendGate);
  const activity = buildQueueActivity(meta.agentRunLog ?? null, agentStatus);
  const oldestWait = oldestWaitingLabel(queueGroups.actionable);
  const body =
    `<div class="op-wrap feed">` +
    renderIntro(model, oldestWait, runtime, queueGroups) +
    renderQueueRuntimePanel(runtime, agentStatus, meta, liveSendGate) +
    renderQueueTabs(model, agentStatus, oldestWait, meta, liveSendGate, queueGroups, activity) +
    renderFooter(model) +
    `</div>`;

  return renderShell({
    title: `Exo — Agent queue · ${model.user.label}`,
    activeId: "queue",
    sectionLabel: "Agent queue",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    agentRuntime: runtime ? { ...(meta.agentRuntime ?? {}), ...runtime } : null,
  });
}

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {string | null} oldestWait
 * @param {import("../core/build-operator-view.js").OperatorAgentRuntime | null | undefined} runtime
 * @param {{ actionable: import("../core/build-operator-view.js").OperatorQueueItem[], waiting: import("../core/build-operator-view.js").OperatorQueueItem[] }} queueGroups
 */
function renderIntro(model, oldestWait, runtime, queueGroups) {
  const c = model.counts;
  const queuedCount = queueGroups.actionable.length;
  const introAction = runtime?.canRunNow
    ? liveActionBtn({
        writer: "runAgentQueuePass",
        args: {},
        variant: "primary",
        size: "md",
        icon: "cpu",
        label: runtime.runLabel ?? "Run agent now",
      })
    : "";
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Agent queue</h1>` +
    renderAgentRuntimeMeta(runtime, { className: "op-meta", iconSize: 11 }) +
    `</div>` +
    `<div class="op-intro-actions">` +
    `<div class="op-stat">` +
    `<span><b>${queuedCount}</b> queued</span><i></i>` +
    `<span><b>${oldestWait ?? "—"}</b> oldest wait</span><i></i>` +
    `<span><b>${c.blocked}</b> blocked</span>` +
    `</div>` +
    introAction +
    `</div>` +
    `</div>`
  );
}

/**
 * State dot + checked stamp for the runtime bar's right side. Tones map the
 * agent-status report state onto the shared STATE_META palette.
 *
 * @param {any} status
 * @param {{ generatedAt?: string }} meta
 */
function agentStatusSide(status, meta = {}) {
  if (!status || typeof status !== "object" || !status.state) return null;
  const tone = AGENT_STATE_TONE[/** @type {keyof typeof AGENT_STATE_TONE} */ (status.state)] ?? "waiting";
  const checked = formatRelative(status.checkedAt, meta.generatedAt ?? undefined);
  const label = [titleize(status.state), checked ? `checked ${checked}` : null]
    .filter(Boolean)
    .join(" · ");
  return stateDot(tone, label);
}

const AGENT_STATE_TONE = {
  running: "ready",
  queued: "active",
  waiting: "waiting",
  idle: "waiting",
  partial: "paused",
  blocked: "blocked",
};

/**
 * Queue page runtime: one panel, two rows. The disclosure bar stays the first
 * row and the status strip becomes the second row inside the same framed shell.
 *
 * @param {import("../core/build-operator-view.js").OperatorAgentRuntime | null | undefined} runtime
 * @param {any} status
 * @param {{ generatedAt?: string }} [meta]
 * @param {ReturnType<typeof buildLiveSendGate>} [liveSendGate]
 */
function renderQueueRuntimePanel(runtime, status, meta = {}, liveSendGate = null) {
  if (!runtime && (!status || typeof status !== "object")) return "";
  const runtimeBar = runtime
    ? renderAgentRuntimeBar(runtime, {
        side: agentStatusSide(status, meta),
        forceOpen: status?.state === "blocked",
        embedded: true,
      })
    : "";
  const strip = renderAgentStatusStrip(status, { embedded: true, liveSendGate });
  return (
    `<section class="op-sec queue-runtime-panel" data-sec="agent-status">` +
    runtimeBar +
    strip +
    `</section>`
  );
}

/**
 * One-row strip: current work / backlog / throughput, plus a partial-reason
 * cell while a pass is parked mid-drain. Replaces the old two-row panel grid.
 *
 * @param {any} status
 * @param {{ embedded?: boolean, liveSendGate?: ReturnType<typeof buildLiveSendGate> }} [options]
 */
function renderAgentStatusStrip(status, options = {}) {
  if (!status || typeof status !== "object") return "";
  const partial = Boolean(status.partial?.active);
  const liveSendGate = options.liveSendGate ?? null;
  const strip =
    `<div class="ws-strip${partial ? " has-partial" : ""}">` +
    renderCurrentWorkCell(status) +
    renderBacklogCell(status, liveSendGate) +
    renderThroughputCell(status) +
    (partial ? renderPartialCell(status, liveSendGate) : "") +
    `</div>`;
  if (options.embedded) {
    return strip;
  }
  return (
    `<section class="op-sec" data-sec="agent-status">` +
    strip +
    `</section>`
  );
}

/** @param {any} status */
function renderCurrentWorkCell(status) {
  const tasks = Array.isArray(status.current?.tasks) ? status.current.tasks : [];
  const locks = Array.isArray(status.current?.locks?.lanes)
    ? status.current.locks.lanes.filter((lock) => lock?.active)
    : [];
  let name = "Idle";
  let sub = "No task checked out";
  if (tasks.length) {
    const task = tasks[0];
    const elapsed = Number.isFinite(task.elapsedSeconds)
      ? `${formatDurationSeconds(Number(task.elapsedSeconds))} elapsed`
      : null;
    const more = tasks.length > 1 ? `+${tasks.length - 1} more` : null;
    name = `${titleize(task.lane)}: ${titleize(task.kind)}`;
    sub = [task.subject, elapsed, more].filter(Boolean).join(" · ");
  } else if (locks.length) {
    const lock = locks[0];
    name = `${titleize(lock.lane)} pass active`;
    sub = lock.pid ? `pid ${lock.pid}; no task lease yet` : "No task lease yet";
  }
  return (
    `<div class="ws-cell">` +
    `<div class="pulse-cap">Current work</div>` +
    `<div class="mini-name">${escapeHtml(name)}</div>` +
    `<div class="mini-sub">${escapeHtml(sub)}</div>` +
    `</div>`
  );
}

/**
 * @param {any} status
 * @param {ReturnType<typeof buildLiveSendGate>} [liveSendGate]
 */
function renderBacklogCell(status, liveSendGate = null) {
  const backlog = status.backlog ?? {};
  const due = numberOrZero(backlog.dueTaskCount);
  const waiting = numberOrZero(backlog.waitingTaskCount);
  const blockers = numberOrZero(backlog.blockerCount);
  const kinds = plainGroups(backlog.dueByKind, "kind", 3);
  const waitingGroups = waiting > 0 ? renderWaitingGroups(backlog.waitingByReason) : "";
  const blockerGroups = blockers > 0 ? plainGroups(backlog.blockersByReason, "reason", 2) : "";

  return (
    `<div class="ws-cell">` +
    `<div class="pulse-cap">Backlog</div>` +
    `<div class="mini-name"><b>${escapeHtml(due)}</b> due · <b>${escapeHtml(waiting)}</b> waiting · <b>${escapeHtml(blockers)}</b> blockers</div>` +
    (liveSendGate ? `<div class="stat-sub"><b>${escapeHtml(liveSendGate.headline)}</b>: ${escapeHtml(liveSendGate.detail)}</div>` : "") +
    (kinds ? `<div class="mini-sub">${escapeHtml(kinds)}</div>` : "") +
    (waitingGroups ? `<div class="stat-sub">Waiting: ${waitingGroups}</div>` : "") +
    (blockerGroups ? `<div class="stat-sub">Blockers: ${escapeHtml(blockerGroups)}</div>` : "") +
    `</div>`
  );
}

/** @param {any} status */
function renderThroughputCell(status) {
  const lastPass = status.throughput?.lastPass ?? null;
  const last24 = status.throughput?.last24Hours ?? {};
  const duration = Number.isFinite(lastPass?.durationSeconds)
    ? formatDurationSeconds(Number(lastPass.durationSeconds))
    : null;
  const passPrefix = status?.current?.active ? "Previous pass" : "Last pass";
  const passLine = lastPass
    ? [
      `${passPrefix} ${titleize(lastPass.status ?? "unknown").toLowerCase()}`,
      countLabel(lastPass.resultCount, "result"),
      duration,
    ].filter(Boolean).join(" · ")
    : "Last pass not recorded";

  return (
    `<div class="ws-cell">` +
    `<div class="pulse-cap">Throughput</div>` +
    `<div class="mini-name">${escapeHtml(passLine)}</div>` +
    `<div class="mini-sub">24h: ${escapeHtml(countLabel(last24.resultCount, "result"))}, ${escapeHtml(countLabel(last24.recentMotionRunCount, "motion run"))}</div>` +
    `</div>`
  );
}

/**
 * @param {any} status
 * @param {ReturnType<typeof buildLiveSendGate>} [liveSendGate]
 */
function renderPartialCell(status, liveSendGate = null) {
  const reason = liveSendGate?.partialReason ?? status.partial.reason ?? "Partial pass";
  const nextAction = liveSendGate?.partialNextAction ?? status.partial.nextAction ?? null;
  return (
    `<div class="ws-cell">` +
    `<div class="pulse-cap">Partial reason</div>` +
    `<div class="mini-name">${escapeHtml(reason)}</div>` +
    (nextAction ? `<div class="mini-sub">${escapeHtml(nextAction)}</div>` : "") +
    `</div>`
  );
}

/**
 * Segmented control flipping between the queue cards and the full inbound
 * surface telemetry list. Tab targets give #queue / #surfaces deep links via
 * the shared tabset JS.
 *
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {any} status
 * @param {string | null} oldestWait
 * @param {{ generatedAt?: string, agentRunLog?: any }} meta
 * @param {ReturnType<typeof buildLiveSendGate>} [liveSendGate]
 * @param {{ actionable: import("../core/build-operator-view.js").OperatorQueueItem[], waiting: import("../core/build-operator-view.js").OperatorQueueItem[] }} [queueGroups]
 * @param {ReturnType<typeof buildQueueActivity>} [activity]
 */
function renderQueueTabs(model, status, oldestWait, meta = {}, liveSendGate = null, queueGroups = undefined, activity = undefined) {
  const surfaces = Array.isArray(status?.inboundSurfaces?.items) ? status.inboundSurfaces.items : [];
  const groups = queueGroups ?? buildQueueGroups(model.queue, liveSendGate);
  const activityView = activity ?? buildQueueActivity(meta.agentRunLog ?? null, status);
  const tabItems = [
    {
      target: "queue",
      label: "Agent queue",
      panelId: "queue-views-panel-queue",
      count: groups.actionable.length,
      countTone: "blue",
      active: true,
    },
  ];
  if (groups.waiting.length > 0) {
    tabItems.push({
      target: "waiting",
      label: "Waiting",
      panelId: "queue-views-panel-waiting",
      count: groups.waiting.length,
      countTone: "amber",
    });
  }
  tabItems.push({
    target: "surfaces",
    label: "Inbound surfaces",
    panelId: "queue-views-panel-surfaces",
    count: surfaces.length,
  });
  tabItems.push({
    target: "activity",
    label: "Activity",
    panelId: "queue-views-panel-activity",
    count: activityView.count,
  });
  const tabs = segTabs({
    tabsetId: "queue-views",
    ariaLabel: "Queue views",
    tabs: tabItems,
  });
  const sub = oldestWait ? `oldest ${oldestWait}` : "agent can run now";
  const waitingPanel = groups.waiting.length > 0
    ? `<div id="queue-views-panel-waiting" class="sec-body" role="tabpanel" aria-labelledby="queue-views-tab-waiting" data-tab-panel="waiting" hidden>${renderQueue(groups.waiting, liveSendGate, "No gated work is waiting right now.")}</div>`
    : "";

  return (
    `<section class="op-sec" data-sec="queue">` +
    `<div class="sec-head">` +
    iconSvg("queue", 16, "sec-ic") +
    tabs +
    `<span class="sec-sub">${escapeHtml(sub)}</span>` +
    `</div>` +
    `<div id="queue-views-panel-queue" class="sec-body" role="tabpanel" aria-labelledby="queue-views-tab-queue" data-tab-panel="queue">${renderQueue(groups.actionable, liveSendGate)}</div>` +
    waitingPanel +
    `<div id="queue-views-panel-surfaces" class="sec-body sec-body-list" role="tabpanel" aria-labelledby="queue-views-tab-surfaces" data-tab-panel="surfaces" hidden>${renderSurfacesPanel(surfaces, meta)}</div>` +
    `<div id="queue-views-panel-activity" class="sec-body sec-body-list" role="tabpanel" aria-labelledby="queue-views-tab-activity" data-tab-panel="activity" hidden>${renderActivityPanel(activityView, meta)}</div>` +
    `</section>`
  );
}

/**
 * Every enabled surface, no truncation — never-synced surfaces are the gaps
 * an operator most needs to see. Surfaces with errors sort to the top.
 *
 * @param {any[]} surfaces
 * @param {{ generatedAt?: string }} meta
 */
function renderSurfacesPanel(surfaces, meta = {}) {
  if (!surfaces.length) {
    return emptyState({ icon: "inbox", message: "No inbound surfaces enabled yet." });
  }
  const sorted = [...surfaces].sort(
    (left, right) => Number(Boolean(right?.lastError)) - Number(Boolean(left?.lastError)),
  );
  return (
    `<div class="ws-panel">` +
    `<div class="ws-surfaces">${sorted.map((surface) => renderInboundSurfaceRow(surface, meta)).join("")}</div>` +
    `</div>`
  );
}

/**
 * @param {any} agentRunLog
 * @param {any} status
 */
function buildQueueActivity(agentRunLog, status) {
  const holds = Array.isArray(status?.holds?.items) ? status.holds.items : [];
  const entries = collapseRunLogEntries(Array.isArray(agentRunLog?.entries) ? agentRunLog.entries : [])
    .slice(0, 10);
  return {
    holds,
    entries,
    count: holds.length + entries.length,
  };
}

/**
 * @param {{ holds: any[], entries: any[] }} activity
 * @param {{ generatedAt?: string }} meta
 */
function renderActivityPanel(activity, meta = {}) {
  const holds = Array.isArray(activity?.holds) ? activity.holds : [];
  const entries = Array.isArray(activity?.entries) ? activity.entries : [];
  if (!holds.length && !entries.length) {
    return emptyState({ icon: "clock", message: "No recent agent activity recorded yet." });
  }
  return (
    `<div class="ws-panel">` +
    (holds.length
      ? `<div class="pulse-cap">Current holds</div>${holds.map((hold) => renderActivityHoldCard(hold, meta)).join("")}`
      : "") +
    (entries.length
      ? `<div class="pulse-cap"${holds.length ? ` style="margin-top:14px"` : ""}>Recent runs</div>${entries.map((entry) => renderActivityEntryCard(entry, meta)).join("")}`
      : "") +
    `</div>`
  );
}

/**
 * @param {any} hold
 * @param {{ generatedAt?: string }} meta
 */
function renderActivityHoldCard(hold, meta = {}) {
  const until = formatRelative(hold?.unavailableUntil, meta.generatedAt ?? undefined);
  const chips = [
    `<span class="cap-ref">${iconSvg("alert", 11)}${escapeHtml(titleize(hold?.kind ?? "hold"))}</span>`,
    until ? `<span class="surface-ref">${iconSvg("clock", 11)}until ${escapeHtml(until)}</span>` : null,
  ].filter(Boolean).join("");
  return card({
    className: "q-card",
    children:
      `<div class="row-top">` +
      avatar({ initials: "HL", name: "Hold", size: 30, accent: "#ef4444" }) +
      `<div class="row-id">` +
      `<div class="row-name">${escapeHtml(describeHoldKind(hold))}</div>` +
      `<div class="row-role">Current blocker</div>` +
      `</div>` +
      stateDot("blocked", "Blocked") +
      `</div>` +
      `<p class="row-note">${escapeHtml(hold?.reason ?? "The agent is waiting on this hold to clear.")}</p>` +
      `<div class="row-chips">${chips}</div>` +
      `<div class="row-actions"><span class="q-agent">${iconSvg("alert", 11)}Blocking new send work</span></div>`,
  });
}

/**
 * @param {any} entry
 * @param {{ generatedAt?: string }} meta
 */
function renderActivityEntryCard(entry, meta = {}) {
  const when = formatRelative(entry?.timestamp ?? entry?.endedAt ?? entry?.startedAt, meta.generatedAt ?? undefined);
  const title = describeRunEntryTitle(entry);
  const reason = summarizeRunEntryReason(entry);
  const outcome = describeRunEntryOutcome(entry);
  const queue = describeRunEntryQueue(entry);
  const source = describeRunEntrySource(entry);
  const chips = [
    entry?.lane ? `<span class="cap-ref">${iconSvg("cpu", 11)}${escapeHtml(titleize(entry.lane))}</span>` : null,
    entry?.taskKind ? `<span class="surface-ref">${iconSvg("queue", 11)}${escapeHtml(titleize(entry.taskKind))}</span>` : null,
    outcome ? `<span class="surface-ref">${iconSvg("check", 11)}${escapeHtml(outcome)}</span>` : null,
    queue ? `<span class="surface-ref">${iconSvg("clock", 11)}${escapeHtml(queue)}</span>` : null,
  ].filter(Boolean).join("");
  return card({
    className: "q-card",
    children:
      `<div class="row-top">` +
      avatar({
        initials: initials((entry?.lane ?? entry?.taskKind ?? "AG").replace(/[_-]+/g, " ")),
        name: title,
        size: 30,
        accent: activityToneColor(entry?.status),
      }) +
      `<div class="row-id">` +
      `<div class="row-name">${escapeHtml(title)}</div>` +
      `<div class="row-role">${escapeHtml(when ? `${titleize(entry?.status ?? "recorded")} ${when}` : titleize(entry?.status ?? "recorded"))}</div>` +
      `</div>` +
      stateDot(activityTone(entry?.status), titleize(entry?.status ?? "recorded")) +
      `</div>` +
      `<p class="row-note">${escapeHtml(reason ?? "Run recorded without a detailed reason.")}</p>` +
      `<div class="row-chips">${chips}</div>` +
      `<div class="row-actions"><span class="q-agent">${iconSvg("cpu", 11)}${escapeHtml(source)}</span></div>`,
  });
}

/**
 * @param {any[]} entries
 * @returns {any[]}
 */
function collapseRunLogEntries(entries) {
  const collapsed = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = [
      entry?.timestamp ?? entry?.endedAt ?? entry?.startedAt ?? "",
      entry?.status ?? "",
      entry?.lane ?? "",
      entry?.taskKind ?? "",
      Array.isArray(entry?.taskKinds) ? entry.taskKinds.join(",") : "",
      summarizeRunEntryReason(entry) ?? "",
      entry?.motionId ?? "",
      entry?.companyId ?? "",
      entry?.prospectId ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    collapsed.push(entry);
  }
  return collapsed;
}

/**
 * @param {any} surface
 * @param {{ generatedAt?: string }} meta
 */
function renderInboundSurfaceRow(surface, meta = {}) {
  const title = [surface.capability, surface.accountHandle, surface.surfaceLabel]
    .filter(Boolean)
    .join(" / ");
  const count = formatCapturedCount(surface);
  const details = [
    count ? `captured ${count}` : null,
    Number.isFinite(surface.observationCount) ? `${surface.observationCount} observations` : null,
    surface.pageWalkStatus ? surface.pageWalkStatus : null,
    surface.resumeCursor ? `cursor ${surface.resumeCursor}` : null,
    Number.isInteger(surface.resumeStartOffset) ? `offset ${surface.resumeStartOffset}` : null,
    surface.lastError ? `last error: ${surface.lastError}` : null,
  ].filter(Boolean);
  const synced = formatRelative(surface.lastSyncedAt ?? surface.lastObservedAt, meta.generatedAt ?? undefined);
  const when = synced
    ? `<span class="wsf-when">synced ${escapeHtml(synced)}</span>`
    : `<span class="wsf-when never">never synced</span>`;
  const hasTelemetry = Boolean(surface.lastRunStatus) || details.length > 0;
  const dot = surface.lastError
    ? stateDot("blocked", titleize(surface.lastRunStatus ?? "error"))
    : hasTelemetry
      ? stateDot("active", surface.lastRunStatus ? titleize(surface.lastRunStatus) : "Recorded")
      : stateDot("waiting", "Enabled");

  return (
    `<div class="ws-surface">` +
    `<div class="wsf-name">${escapeHtml(title || "Inbound surface")}</div>` +
    `<div class="wsf-side">${dot}${when}</div>` +
    `<div class="wsf-note">${escapeHtml(details.length ? details.join("; ") : "No telemetry recorded yet")}</div>` +
    `</div>`
  );
}

/**
 * @param {import("../core/build-operator-view.js").OperatorQueueItem[]} queue
 * @param {ReturnType<typeof buildLiveSendGate>} [liveSendGate]
 * @param {string} [emptyMessage]
 */
function renderQueue(queue, liveSendGate = null, emptyMessage = "Agent queue empty — nothing ready to run.") {
  if (!queue.length) {
    return emptyState({ icon: "cpu", message: emptyMessage });
  }
  // Oldest queued work stays at the top so the operator scans for stuck items
  // first, even when pacing moved the next due time forward later.
  const sorted = [...queue].sort((a, b) => queueAgeMillis(b) - queueAgeMillis(a));
  return sorted.map((item) => renderQueueItem(item, liveSendGate)).join("");
}

/**
 * @param {import("../core/build-operator-view.js").OperatorQueueItem[]} queue
 * @param {ReturnType<typeof buildLiveSendGate>} liveSendGate
 */
function buildQueueGroups(queue, liveSendGate) {
  const actionable = [];
  const waiting = [];
  for (const item of queue) {
    if (isLiveSendQueueItem(item, liveSendGate)) {
      waiting.push(item);
    } else {
      actionable.push(item);
    }
  }
  if (liveSendGate && waiting.length > 0 && !actionable.some(isLiveSendPrerequisiteQueueItem)) {
    actionable.unshift(buildLiveSendPrerequisiteQueueItem(liveSendGate));
  }
  return { actionable, waiting };
}

/** @param {import("../core/build-operator-view.js").OperatorQueueItem} item */
function isLiveSendPrerequisiteQueueItem(item) {
  return item.taskKind === "run_inbound_sync" || item.taskKind === "resolve_inbound_identity";
}

/**
 * @param {NonNullable<ReturnType<typeof buildLiveSendGate>>} liveSendGate
 * @returns {import("../core/build-operator-view.js").OperatorQueueItem & { queueRole: string, reviewLabel: string }}
 */
function buildLiveSendPrerequisiteQueueItem(liveSendGate) {
  return {
    id: "live-send-gate-prerequisite",
    subject: "Repair LinkedIn inbound sync",
    motionName: "Prerequisite",
    action: liveSendGate.prerequisiteAction,
    note: liveSendGate.detail,
    capability: "linkedin",
    taskKind: "run_inbound_sync",
    dueAt: null,
    dueAtIso: null,
    queuedAtIso: null,
    waitingFor: null,
    dueIn: null,
    checkoutState: null,
    checkedOutBy: null,
    checkedOutAt: null,
    href: "/queue#surfaces",
    queueRole: "prerequisite",
    reviewLabel: "Open surfaces",
  };
}

/**
 * @param {import("../core/build-operator-view.js").OperatorQueueItem} q
 * @param {ReturnType<typeof buildLiveSendGate>} [liveSendGate]
 */
function renderQueueItem(q, liveSendGate = null) {
  const gatedSend = isLiveSendQueueItem(q, liveSendGate);
  const prerequisite = q.queueRole === "prerequisite";
  const waitChip = q.waitingFor
    ? `<span class="surface-ref">${iconSvg("clock", 11)}${escapeHtml(q.waitingFor)}</span>`
    : null;
  const dueChip = q.dueIn
    ? `<span class="surface-ref">${iconSvg("clock", 11)}${escapeHtml(q.dueIn)}</span>`
    : null;
  const checkoutChip = q.checkoutState === "checked_out"
    ? `<span class="surface-ref">${iconSvg("cpu", 11)}Checked out${q.checkedOutBy ? ` · ${escapeHtml(q.checkedOutBy)}` : ""}</span>`
    : null;
  const gateChip = gatedSend
    ? `<span class="surface-ref">${iconSvg("alert", 11)}Live send gated</span>`
    : null;
  const chips = [
    `<span class="cap-ref">${iconSvg("cpu", 11)}${escapeHtml(q.capability)}</span>`,
    q.motionName ? stateDot("active", q.motionName) : null,
    waitChip,
    dueChip,
    checkoutChip,
    gateChip,
  ]
    .filter(Boolean)
    .join("");
  const review = q.href
    ? btn({ variant: "secondary", size: "sm", icon: "arrowR", label: q.reviewLabel ?? "Review", href: q.href })
    : "";
  const agentTag = gatedSend
    ? `<span class="q-agent">${iconSvg("clock", 11)}Gated by sync</span>`
    : prerequisite
    ? `<span class="q-agent">${iconSvg("alert", 11)}Prerequisite</span>`
    : q.checkoutState === "checked_out"
    ? `<span class="q-agent">${iconSvg("cpu", 11)}Checked out</span>`
    : `<span class="q-agent">${iconSvg("cpu", 11)}Queued for agent</span>`;
  const state = gatedSend
    ? stateDot("paused", "Gated")
    : prerequisite
    ? stateDot("ready", "Prerequisite")
    : q.checkoutState === "checked_out"
    ? stateDot("waiting", "Checked out")
    : stateDot("ready");

  return card({
    className: "q-card",
    children:
      `<div class="row-top">` +
      avatar({ initials: initials(q.subject), name: q.subject, size: 30, accent: "#3b82f6" }) +
      `<div class="row-id">` +
      `<div class="row-name">${escapeHtml(q.subject)}</div>` +
      `<div class="row-role">${escapeHtml(q.motionName ?? "Inbound itemization")}</div>` +
      `</div>` +
      state +
      `</div>` +
      `<p class="row-note">${escapeHtml(q.action)}</p>` +
      `<div class="row-chips">${chips}</div>` +
      `<div class="row-actions">${agentTag}${review}</div>`,
  });
}

/**
 * Live sends are only safe when the inbound truth surfaces they depend on are
 * healthy. When LinkedIn sync is failed, show the queue as gated instead of
 * implying every due send is runnable.
 *
 * @param {any} status
 * @param {import("../core/build-operator-view.js").OperatorQueueItem[]} queue
 */
function buildLiveSendGate(status, queue) {
  if (!status || typeof status !== "object") return null;
  const blockingSurfaces = unhealthyLinkedInSurfaces(status);
  if (blockingSurfaces.length <= 0) return null;
  const blockingSurfaceByKey = new Map(blockingSurfaces.map((surface) => [surface.surfaceKey, surface]));
  const gatedItems = queue.filter((item) => {
    if (item.taskKind !== "send_message") return false;
    const surfaceKeys = requiredLinkedinGateSurfaceKeys(item);
    return surfaceKeys.some((surfaceKey) => blockingSurfaceByKey.has(surfaceKey));
  });
  if (gatedItems.length <= 0) return null;

  const relevantBlockingSurfaceKeys = unique(
    gatedItems.flatMap((item) => requiredLinkedinGateSurfaceKeys(item))
      .filter((surfaceKey) => blockingSurfaceByKey.has(surfaceKey)),
  );
  const relevantBlockingSurfaces = relevantBlockingSurfaceKeys
    .map((surfaceKey) => blockingSurfaceByKey.get(surfaceKey))
    .filter(Boolean);
  const syncRepairCount = queue.filter((item) =>
    item.taskKind === "run_inbound_sync"
    && item.surfaceKeys?.some((surfaceKey) => relevantBlockingSurfaceKeys.includes(surfaceKey))
  ).length;
  const firstError = normalizeSentence(relevantBlockingSurfaces.find((surface) => surface?.lastError)?.lastError ?? null);
  const repairSentence = syncRepairCount > 0
    ? `Run ${countLabel(syncRepairCount, "inbound sync repair task")} first.`
    : "Repair LinkedIn inbound sync before sending.";
  const errorSentence = firstError ? ` Latest error: ${firstError}` : "";
  return {
    gatedIds: new Set(gatedItems.map((item) => item.id)),
    headline: "Live sends gated",
    detail: `${countLabel(gatedItems.length, "send task")} are paused until LinkedIn inbound sync is healthy. ${repairSentence}${errorSentence}`,
    prerequisiteAction: repairSentence,
    partialReason: "Live sends paused until inbound sync is healthy.",
    partialNextAction: `${repairSentence} Do not send from stale LinkedIn truth.`,
  };
}

/** @param {unknown} value */
function normalizeSentence(value) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!text) return null;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * @param {any} status
 * @returns {any[]}
 */
function unhealthyLinkedInSurfaces(status) {
  const surfaces = Array.isArray(status?.inboundSurfaces?.items) ? status.inboundSurfaces.items : [];
  return surfaces.filter((surface) => {
    const capability = String(surface?.capability ?? "").trim().toLowerCase();
    const syncTrustStatus = String(surface?.syncTrustStatus ?? "").trim().toLowerCase();
    const lastRunStatus = String(surface?.lastRunStatus ?? "").trim().toLowerCase();
    return capability === "linkedin"
      && (syncTrustStatus === "untrusted" || lastRunStatus === "failed" || lastRunStatus === "never");
  });
}

/**
 * @param {any[] | null | undefined} groups
 * @param {string} keyName
 * @param {string} expected
 */
function countGroup(groups, keyName, expected) {
  if (!Array.isArray(groups)) return 0;
  return groups.reduce((sum, group) => {
    const key = String(group?.[keyName] ?? "").trim().toLowerCase();
    const count = numberOrZero(group?.count);
    return key === expected ? sum + count : sum;
  }, 0);
}

/**
 * @param {import("../core/build-operator-view.js").OperatorQueueItem} q
 * @param {ReturnType<typeof buildLiveSendGate>} liveSendGate
 */
function isLiveSendQueueItem(q, liveSendGate) {
  return Boolean(liveSendGate) && liveSendGate.gatedIds instanceof Set && liveSendGate.gatedIds.has(q.id);
}

/**
 * @param {import("../core/build-operator-view.js").OperatorQueueItem} item
 * @returns {string[]}
 */
function requiredLinkedinGateSurfaceKeys(item) {
  const action = String(item.actionKey ?? "").trim().toLowerCase();
  const surface = String(item.surface ?? "").trim().toLowerCase();
  if (action === "send_connection_request" || surface === "connection_request") {
    return ["linkedin-sent-invitations", "linkedin-received-invitations"];
  }
  if (
    action === "send_direct_message"
    || action === "in_mail_message"
    || surface === "post_accept_message"
    || surface === "follow_up_direct_message"
  ) {
    return ["linkedin-messaging-inbox"];
  }
  return [];
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/** @param {import("../core/build-operator-view.js").OperatorViewModel} model */
function renderFooter(model) {
  const stamp = new Date(model.generatedAt).toISOString();
  return (
    `<div class="gen-footer">` +
    `Generated ${escapeHtml(stamp)} · regenerate with <code>${escapeHtml(model.regenerateCommand)}</code>` +
    `</div>`
  );
}

/**
 * @param {any[] | null | undefined} groups
 * @param {string} keyName
 * @param {number} limit
 */
function plainGroups(groups, keyName, limit) {
  if (!Array.isArray(groups) || !groups.length) return "";
  return groups.slice(0, limit)
    .map((group) => `${group?.count ?? 0} ${titleize(group?.[keyName] ?? "unknown")}`)
    .join(" · ");
}

/** @param {any[] | null | undefined} groups */
function renderWaitingGroups(groups) {
  if (!Array.isArray(groups) || !groups.length) return "";
  return groups.slice(0, 3).map((group) => {
    const due = group?.nextDueAt ? formatRelative(group.nextDueAt) : null;
    const label = `${group?.count ?? 0} ${titleize(group?.waitingReason ?? "waiting")}${due ? `, next ${due}` : ""}`;
    return escapeHtml(label);
  }).join(" · ");
}

/** @param {any} hold */
function describeHoldKind(hold) {
  switch (String(hold?.kind ?? "").trim().toLowerCase()) {
    case "send_circuit_breaker":
      return "Send work paused";
    case "canary_cooldown":
      return "Canary cooldown";
    case "runtime_usage_limit":
      return "Runtime usage limit";
    default:
      if (String(hold?.kind ?? "").startsWith("browser_backoff:")) {
        const lane = String(hold.kind).split(":")[1] ?? "browser";
        return `${titleize(lane)} lane backoff`;
      }
      return titleize(hold?.kind ?? "hold");
  }
}

/** @param {any} entry */
function describeRunEntryTitle(entry) {
  const lane = entry?.lane ? titleize(entry.lane) : null;
  const task = entry?.taskKind ? titleize(entry.taskKind) : null;
  if (lane && task) return `${lane} · ${task}`;
  if (task) return task;
  if (lane) return `${lane} pass`;
  return "Agent activity";
}

const RUN_OUTCOME_STATUS_KEYS = ["completed", "waiting", "blocked", "failed", "partial", "noop"];

/** @param {any} entry */
function describeRunEntryOutcome(entry) {
  const counts = entry?.resultCounts ?? {};
  const parts = RUN_OUTCOME_STATUS_KEYS
    .filter((key) => Number(counts[key]) > 0)
    .map((key) => `${counts[key]} ${key}`);
  const breakdownSum = RUN_OUTCOME_STATUS_KEYS.reduce((sum, key) => sum + counts[key], 0);
  if (Number(counts.total) > 0 && breakdownSum === 0) {
    parts.push(`${counts.total} recorded`);
  }
  return parts.join(" · ") || null;
}

/** @param {any} entry */
function describeRunEntryQueue(entry) {
  const queue = entry?.queueCounts;
  if (!queue || typeof queue !== "object") return null;
  return [
    Number.isFinite(queue.dueTaskCount) ? `${queue.dueTaskCount} due` : null,
    Number.isFinite(queue.waitingTaskCount) ? `${queue.waitingTaskCount} waiting` : null,
    Number.isFinite(queue.blockerCount) && queue.blockerCount > 0 ? `${queue.blockerCount} blockers` : null,
  ].filter(Boolean).join(" · ");
}

/** @param {any} entry */
function describeRunEntrySource(entry) {
  switch (String(entry?.sourceArtifact?.kind ?? "").trim().toLowerCase()) {
    case "agent.log":
      return "Source: agent log";
    case "agent-last-pass":
      return "Source: last pass summary";
    case "agent-host-state":
      return "Source: host state";
    default:
      return "Source: agent activity";
  }
}

/** @param {any} entry */
function summarizeRunEntryReason(entry) {
  const normalizedStatus = String(entry?.status ?? "").trim().toLowerCase();
  const reason = typeof entry?.reason === "string" ? entry.reason : "";
  if (!reason.trim()) {
    return normalizedStatus === "running"
      ? "Current run is in progress."
      : describeRunEntryOutcome(entry);
  }

  const compactReason = stripNoisyExecStreams(reason);
  if (normalizedStatus === "partial"
    && /LinkedIn spacing keeps this outbound action from firing immediately\./i.test(compactReason)) {
    const dueTaskCount = Number.isFinite(entry?.queueCounts?.dueTaskCount)
      ? Number(entry.queueCounts.dueTaskCount)
      : null;
    return dueTaskCount && dueTaskCount > 0
      ? `Spacing deferred the next send batch; ${dueTaskCount} due task${dueTaskCount === 1 ? "" : "s"} remained in queue.`
      : "Spacing deferred the next send batch.";
  }
  const exoTimeoutCommand = compactReason.match(/^Exo command failed:\s*(.+?)\nspawnSync\s+.+?\sETIMEDOUT/i);
  if (exoTimeoutCommand) {
    return `Timed out while running: ${exoTimeoutCommand[1].trim()}`;
  }
  if (/^Codex task failed:\s*spawnSync\s+.+?\sETIMEDOUT/i.test(compactReason)) {
    return "Codex task timed out before the bounded packet finished.";
  }

  const lines = compactReason
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Command failed:/i.test(line))
    .filter((line) => !/^\(node:\d+\)\s*ExperimentalWarning/i.test(line))
    .filter((line) => !/^\(Use `node --trace-warnings/i.test(line))
    .filter((line) => !/^\|\s*stderr=/i.test(line));
  const cleaned = lines[lines.length - 1] ?? compactReason.trim();
  return cleaned.replace(/\s+/g, " ");
}

/**
 * Trim bulky stdout/stderr payloads from persisted exec failures so the
 * activity log surfaces the actual governed issue instead of a raw transcript.
 *
 * @param {string} reason
 */
function stripNoisyExecStreams(reason) {
  return reason
    .replace(/\s+\|\s+stdout=[\s\S]*?(?=\s+\|\s+stderr=|$)/gi, "")
    .replace(/\s+\|\s+stderr=[\s\S]*$/gi, "")
    .trim();
}

/** @param {string | null | undefined} status */
function activityTone(status) {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "failed":
    case "blocked":
      return "blocked";
    case "partial":
      return "paused";
    case "completed":
    case "recorded":
    case "running":
      return "active";
    case "noop":
      return "waiting";
    default:
      return "waiting";
  }
}

/** @param {string | null | undefined} status */
function activityToneColor(status) {
  switch (activityTone(status)) {
    case "blocked":
      return "#ef4444";
    case "paused":
      return "#f59e0b";
    case "active":
      return "#3b82f6";
    default:
      return "#64748b";
  }
}

/** @param {any} value */
function numberOrZero(value) {
  return Number.isFinite(value) ? Number(value) : 0;
}

/**
 * @param {number | null | undefined} value
 * @param {string} noun
 */
function countLabel(value, noun) {
  const count = numberOrZero(value);
  if (["blocked", "completed", "discarded", "failed"].includes(noun)) {
    return `${count} ${noun}`;
  }
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** @param {number} seconds */
function formatDurationSeconds(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

/** @param {string | null | undefined} value */
function titleize(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .replace(/\bLinkedin\b/g, "LinkedIn")
    .replace(/\bGtm\b/g, "GTM") || "Unknown";
}

/** @param {any} surface */
function formatCapturedCount(surface) {
  const captured = surface?.capturedItemCount;
  const visible = surface?.visibleTotalCount;
  if (captured == null && visible == null) return null;
  if (visible != null && visible !== captured) return `${captured ?? "unknown"}/${visible}`;
  return `${captured ?? visible}`;
}

/** @param {import("../core/build-operator-view.js").OperatorQueueItem[]} queue */
function oldestWaitingLabel(queue) {
  let oldest = 0;
  for (const item of queue) {
    const ms = queueAgeMillis(item);
    if (ms > oldest) oldest = ms;
  }
  if (oldest <= 0) return null;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (oldest < minute) return "<1m";
  if (oldest < hour) return `${Math.round(oldest / minute)}m`;
  if (oldest < day) return `${Math.round(oldest / hour)}h`;
  return `${Math.round(oldest / day)}d`;
}

/** @param {import("../core/build-operator-view.js").OperatorQueueItem} item */
function queueAgeMillis(item) {
  return waitMillis(item.queuedAtIso ?? item.dueAtIso);
}

/** @param {string | null | undefined} iso */
function waitMillis(iso) {
  if (!iso) return 0;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return 0;
  return Math.max(0, Date.now() - target.getTime());
}

/** @param {string | null | undefined} value */
function initials(value) {
  if (!value) return "?";
  return value
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
