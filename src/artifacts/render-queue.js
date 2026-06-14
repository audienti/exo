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
 * @param {{ interactive?: boolean, generatedAt?: string, agentStatus?: any }} [meta]
 * @returns {string}
 */
export function renderQueuePage(model, meta = {}) {
  const runtime = model.agentRuntime ?? meta.agentRuntime ?? null;
  const agentStatus = meta.agentStatus ?? null;
  const liveSendGate = buildLiveSendGate(agentStatus);
  const queueGroups = buildQueueGroups(model.queue, liveSendGate);
  const oldestWait = oldestWaitingLabel(queueGroups.actionable);
  const body =
    `<div class="op-wrap feed">` +
    renderIntro(model, oldestWait, runtime, queueGroups) +
    renderQueueRuntimePanel(runtime, agentStatus, meta, liveSendGate) +
    renderQueueTabs(model, agentStatus, oldestWait, meta, liveSendGate, queueGroups) +
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
  const passLine = lastPass
    ? [
      `Last pass ${titleize(lastPass.status ?? "unknown").toLowerCase()}`,
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
 * @param {{ generatedAt?: string }} meta
 * @param {ReturnType<typeof buildLiveSendGate>} [liveSendGate]
 * @param {{ actionable: import("../core/build-operator-view.js").OperatorQueueItem[], waiting: import("../core/build-operator-view.js").OperatorQueueItem[] }} [queueGroups]
 */
function renderQueueTabs(model, status, oldestWait, meta = {}, liveSendGate = null, queueGroups = undefined) {
  const surfaces = Array.isArray(status?.inboundSurfaces?.items) ? status.inboundSurfaces.items : [];
  const groups = queueGroups ?? buildQueueGroups(model.queue, liveSendGate);
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
  // Oldest waits at the top so the operator scans for stuck work first.
  const sorted = [...queue].sort((a, b) => waitMillis(b.dueAtIso) - waitMillis(a.dueAtIso));
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
    waitingFor: null,
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
 */
function buildLiveSendGate(status) {
  if (!status || typeof status !== "object") return null;
  const backlog = status.backlog ?? {};
  const sendCount = countGroup(backlog.dueByKind, "kind", "send_message");
  if (sendCount <= 0) return null;
  const failedLinkedInSurfaces = unhealthyLinkedInSurfaces(status);
  if (failedLinkedInSurfaces.length <= 0) return null;

  const syncRepairCount = countGroup(backlog.dueByKind, "kind", "run_inbound_sync");
  const firstError = normalizeSentence(failedLinkedInSurfaces.find((surface) => surface?.lastError)?.lastError ?? null);
  const repairSentence = syncRepairCount > 0
    ? `Run ${countLabel(syncRepairCount, "inbound sync repair task")} first.`
    : "Repair LinkedIn inbound sync before sending.";
  const errorSentence = firstError ? ` Latest error: ${firstError}` : "";
  return {
    headline: "Live sends gated",
    detail: `${countLabel(sendCount, "send task")} are paused until LinkedIn inbound sync is healthy. ${repairSentence}${errorSentence}`,
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
    const lastRunStatus = String(surface?.lastRunStatus ?? "").trim().toLowerCase();
    return capability === "linkedin" && (Boolean(surface?.lastError) || lastRunStatus === "failed");
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
  return Boolean(liveSendGate) && q.taskKind === "send_message";
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
    const ms = waitMillis(item.dueAtIso);
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
