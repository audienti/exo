// @ts-check
//
// Agent queue surface — everything the agent is about to run or is holding
// because no one has touched it. Moved out of the Operator landing so the
// Operator view stays focused on decisions and the queue gets its own scan-
// friendly page. Each row shows how long the work has been waiting.

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
  sectionHead,
  stateDot,
} from "../lib/exo-ui-components.js";
import { renderAgentRuntimeCard, renderAgentRuntimeMeta } from "./render-agent-runtime-card.js";

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {{ interactive?: boolean, generatedAt?: string, agentStatus?: any }} [meta]
 * @returns {string}
 */
export function renderQueuePage(model, meta = {}) {
  const runtime = model.agentRuntime ?? meta.agentRuntime ?? null;
  const agentStatus = meta.agentStatus ?? null;
  const oldestWait = oldestWaitingLabel(model.queue);
  const body =
    `<div class="op-wrap feed">` +
    renderIntro(model, oldestWait, runtime) +
    renderAgentRuntimeCard(runtime, meta, { surface: "queue", showMeta: false, showActions: false }) +
    renderAgentStatusPanel(agentStatus, meta) +
    `<section class="op-sec" data-sec="queue">` +
    sectionHead({
      icon: "queue",
      title: "Agent queue",
      count: model.queue.length,
      countTone: "blue",
      sub: oldestWait ? `oldest ${oldestWait}` : "agent can run now",
    }) +
    `<div class="sec-body">${renderQueue(model.queue)}</div>` +
    `</section>` +
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
 */
function renderIntro(model, oldestWait, runtime) {
  const c = model.counts;
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
    `<span><b>${c.queue}</b> queued</span><i></i>` +
    `<span><b>${oldestWait ?? "—"}</b> oldest wait</span><i></i>` +
    `<span><b>${c.blocked}</b> blocked</span>` +
    `</div>` +
    introAction +
    `</div>` +
    `</div>`
  );
}

/**
 * @param {any} status
 * @param {{ generatedAt?: string }} meta
 */
function renderAgentStatusPanel(status, meta = {}) {
  if (!status || typeof status !== "object") return "";
  const due = numberOrZero(status.backlog?.dueTaskCount);
  const waiting = numberOrZero(status.backlog?.waitingTaskCount);
  const blockers = numberOrZero(status.backlog?.blockerCount);
  const checked = formatRelative(status.checkedAt, meta.generatedAt ?? undefined);
  const stateLabel = titleize(status.state ?? "unknown");
  const countTone = blockers > 0 ? "red" : due > 0 ? "blue" : waiting > 0 ? "amber" : "neutral";
  const sub = [stateLabel, checked ? `checked ${checked}` : null].filter(Boolean).join(", ");

  return (
    `<section class="op-sec" data-sec="agent-status">` +
    sectionHead({
      icon: "activity",
      title: "Agent status",
      count: due,
      countTone,
      sub,
    }) +
    `<div class="ws-grid">` +
    renderCurrentWorkPanel(status) +
    renderBacklogPanel(status) +
    renderThroughputPanel(status) +
    renderPartialPanel(status) +
    renderInboundSurfacePanel(status) +
    `</div>` +
    `</section>`
  );
}

/** @param {any} status */
function renderCurrentWorkPanel(status) {
  const tasks = Array.isArray(status.current?.tasks) ? status.current.tasks : [];
  const locks = Array.isArray(status.current?.locks?.lanes)
    ? status.current.locks.lanes.filter((lock) => lock?.active)
    : [];
  let body = "";
  if (tasks.length) {
    body = tasks.slice(0, 3).map(renderActiveTask).join("");
    if (tasks.length > 3) {
      body += `<div class="stat-sub">${escapeHtml(tasks.length - 3)} more checked out</div>`;
    }
  } else if (locks.length) {
    body = locks.map((lock) => (
      `<div class="mini-row">` +
      avatar({ initials: laneInitials(lock.lane), name: lock.lane, size: 28, accent: "#f59e0b" }) +
      `<div class="mini-id">` +
      `<div class="mini-name">${escapeHtml(titleize(lock.lane))} pass active</div>` +
      `<div class="mini-sub">${escapeHtml(lock.pid ? `pid ${lock.pid}; no task lease yet` : "No task lease yet")}</div>` +
      `</div>` +
      `</div>`
    )).join("");
  } else {
    body = `<div class="empty-state">${iconSvg("cpu", 18)}<span>No task is checked out right now.</span></div>`;
  }

  return (
    `<div class="ws-panel span-2">` +
    `<div class="pulse-cap">Current work</div>` +
    `<div class="ws-surfaces">${body}</div>` +
    `</div>`
  );
}

/** @param {any} task */
function renderActiveTask(task) {
  const elapsed = Number.isFinite(task.elapsedSeconds)
    ? `${formatDurationSeconds(Number(task.elapsedSeconds))} elapsed`
    : null;
  const resume = [
    task.progress?.resumeCursor ? `cursor ${task.progress.resumeCursor}` : null,
    Number.isInteger(task.progress?.resumeStartOffset) ? `offset ${task.progress.resumeStartOffset}` : null,
    Number.isInteger(task.progress?.maxPages) ? `page budget ${task.progress.maxPages}` : null,
  ].filter(Boolean);
  const chips = [
    task.workerLabel ? `<span class="surface-ref">${iconSvg("cpu", 11)}${escapeHtml(task.workerLabel)}</span>` : null,
    task.surfaceLabels?.length
      ? `<span class="surface-ref">${iconSvg("inbox", 11)}${escapeHtml(task.surfaceLabels.join(", "))}</span>`
      : task.surface
        ? `<span class="surface-ref">${iconSvg("inbox", 11)}${escapeHtml(titleize(task.surface))}</span>`
        : null,
    resume.length ? `<span class="surface-ref">${iconSvg("refresh", 11)}${escapeHtml(resume.join(", "))}</span>` : null,
  ].filter(Boolean).join("");

  return (
    `<div class="ws-surface">` +
    `<div>` +
    `<div class="mini-row">` +
    avatar({ initials: laneInitials(task.lane), name: task.lane, size: 28, accent: "#3b82f6" }) +
    `<div class="mini-id">` +
    `<div class="mini-name">${escapeHtml(`${titleize(task.lane)}: ${titleize(task.kind)}`)}</div>` +
    `<div class="mini-sub">${escapeHtml([task.subject, elapsed].filter(Boolean).join(" · "))}</div>` +
    `</div>` +
    `</div>` +
    `</div>` +
    stateDot("waiting", "Running") +
    (chips ? `<div class="wsf-note nm-chips">${chips}</div>` : "") +
    `</div>`
  );
}

/** @param {any} status */
function renderBacklogPanel(status) {
  const backlog = status.backlog ?? {};
  const due = numberOrZero(backlog.dueTaskCount);
  const waiting = numberOrZero(backlog.waitingTaskCount);
  const blockers = numberOrZero(backlog.blockerCount);
  const dueGroups = renderGroupChips(backlog.dueByKind, "kind", 4);
  const waitingGroups = renderWaitingGroups(backlog.waitingByReason);
  const blockerGroups = renderGroupChips(backlog.blockersByReason, "reason", 3);

  return (
    `<div class="ws-panel span-2">` +
    `<div class="pulse-cap">Backlog</div>` +
    `<div class="stat-nums">` +
    `<span><b>${escapeHtml(due)}</b><em>Due</em></span>` +
    `<span><b>${escapeHtml(waiting)}</b><em>Waiting</em></span>` +
    `<span><b>${escapeHtml(blockers)}</b><em>Blockers</em></span>` +
    `</div>` +
    (dueGroups ? `<div class="nm-chips">${dueGroups}</div>` : "") +
    (waitingGroups ? `<div class="stat-sub">Waiting: ${waitingGroups}</div>` : "") +
    (blockerGroups ? `<div class="stat-sub">Blockers: ${blockerGroups}</div>` : "") +
    `</div>`
  );
}

/** @param {any} status */
function renderThroughputPanel(status) {
  const lastPass = status.throughput?.lastPass ?? null;
  const last24 = status.throughput?.last24Hours ?? {};
  const passLine = lastPass
    ? `${titleize(lastPass.status ?? "unknown")}: ${countLabel(lastPass.resultCount, "result")}, ${countLabel(lastPass.completedCount, "completed")}, ${countLabel(lastPass.blockedCount, "blocked")}`
    : "Last pass not recorded";
  const duration = Number.isFinite(lastPass?.durationSeconds)
    ? `${formatDurationSeconds(Number(lastPass.durationSeconds))} duration`
    : null;
  const byKind = renderGroupChips(lastPass?.byKind, "kind", 3);

  return (
    `<div class="ws-panel">` +
    `<div class="pulse-cap">Throughput</div>` +
    `<div class="mini-name">${escapeHtml(passLine)}</div>` +
    (duration ? `<div class="mini-sub">${escapeHtml(duration)}</div>` : "") +
    `<div class="stat-sub">24h: ${escapeHtml(countLabel(last24.resultCount, "result"))}, ${escapeHtml(countLabel(last24.recentMotionRunCount, "motion run"))}</div>` +
    (byKind ? `<div class="nm-chips">${byKind}</div>` : "") +
    `</div>`
  );
}

/** @param {any} status */
function renderPartialPanel(status) {
  if (!status.partial?.active) return "";
  return (
    `<div class="ws-panel">` +
    `<div class="pulse-cap">Partial reason</div>` +
    `<div class="mini-name">${escapeHtml(status.partial.reason ?? "Partial pass")}</div>` +
    (status.partial.nextAction ? `<div class="mini-sub">${escapeHtml(status.partial.nextAction)}</div>` : "") +
    `</div>`
  );
}

/** @param {any} status */
function renderInboundSurfacePanel(status) {
  const surfaces = Array.isArray(status.inboundSurfaces?.items) ? status.inboundSurfaces.items : [];
  const interesting = surfaces
    .filter((surface) =>
      surface?.lastError
      || surface?.resumeCursor
      || Number.isInteger(surface?.resumeStartOffset)
      || Number(surface?.itemizationGapCount ?? 0) > 0
      || Number(surface?.countDiscrepancyCount ?? 0) > 0
      || surface?.capturedItemCount !== null
    )
    .slice(0, 4);
  const body = interesting.length
    ? interesting.map(renderInboundSurfaceRow).join("")
    : `<div class="empty-state">${iconSvg("inbox", 18)}<span>No surface telemetry recorded yet.</span></div>`;
  const omitted = surfaces.length > interesting.length
    ? `<div class="stat-sub">${escapeHtml(surfaces.length - interesting.length)} more enabled surfaces</div>`
    : "";

  return (
    `<div class="ws-panel span-2">` +
    `<div class="pulse-cap">Inbound surfaces</div>` +
    `<div class="ws-surfaces">${body}</div>` +
    omitted +
    `</div>`
  );
}

/** @param {any} surface */
function renderInboundSurfaceRow(surface) {
  const title = [surface.capability, surface.accountHandle, surface.surfaceLabel]
    .filter(Boolean)
    .join(" / ");
  const count = formatCapturedCount(surface);
  const details = [
    surface.lastRunStatus ? titleize(surface.lastRunStatus) : null,
    count ? `captured ${count}` : null,
    Number.isFinite(surface.observationCount) ? `${surface.observationCount} observations` : null,
    surface.pageWalkStatus ? surface.pageWalkStatus : null,
    surface.resumeCursor ? `cursor ${surface.resumeCursor}` : null,
    Number.isInteger(surface.resumeStartOffset) ? `offset ${surface.resumeStartOffset}` : null,
    surface.lastError ? `last error: ${surface.lastError}` : null,
  ].filter(Boolean);

  return (
    `<div class="ws-surface">` +
    `<div class="wsf-name">${escapeHtml(title || "Inbound surface")}</div>` +
    stateDot(surface.lastError ? "blocked" : "active", surface.lastRunStatus ? titleize(surface.lastRunStatus) : "Recorded") +
    `<div class="wsf-note">${escapeHtml(details.join("; "))}</div>` +
    `</div>`
  );
}

/** @param {import("../core/build-operator-view.js").OperatorQueueItem[]} queue */
function renderQueue(queue) {
  if (!queue.length) {
    return emptyState({ icon: "cpu", message: "Agent queue empty — nothing ready to run." });
  }
  // Oldest waits at the top so the operator scans for stuck work first.
  const sorted = [...queue].sort((a, b) => waitMillis(b.dueAtIso) - waitMillis(a.dueAtIso));
  return sorted.map(renderQueueItem).join("");
}

/** @param {import("../core/build-operator-view.js").OperatorQueueItem} q */
function renderQueueItem(q) {
  const waitChip = q.waitingFor
    ? `<span class="surface-ref">${iconSvg("clock", 11)}${escapeHtml(q.waitingFor)}</span>`
    : null;
  const checkoutChip = q.checkoutState === "checked_out"
    ? `<span class="surface-ref">${iconSvg("cpu", 11)}Checked out${q.checkedOutBy ? ` · ${escapeHtml(q.checkedOutBy)}` : ""}</span>`
    : null;
  const chips = [
    `<span class="cap-ref">${iconSvg("cpu", 11)}${escapeHtml(q.capability)}</span>`,
    q.motionName ? stateDot("active", q.motionName) : null,
    waitChip,
    checkoutChip,
  ]
    .filter(Boolean)
    .join("");
  const review = q.href
    ? btn({ variant: "secondary", size: "sm", icon: "arrowR", label: "Review", href: q.href })
    : "";
  const agentTag = q.checkoutState === "checked_out"
    ? `<span class="q-agent">${iconSvg("cpu", 11)}Checked out</span>`
    : `<span class="q-agent">${iconSvg("cpu", 11)}Queued for agent</span>`;
  const state = q.checkoutState === "checked_out"
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
function renderGroupChips(groups, keyName, limit) {
  if (!Array.isArray(groups) || !groups.length) return "";
  return groups.slice(0, limit).map((group) => {
    const label = titleize(group?.[keyName] ?? "unknown");
    return `<span class="surface-ref">${iconSvg("queue", 11)}${escapeHtml(`${group?.count ?? 0} ${label}`)}</span>`;
  }).join("");
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
function laneInitials(value) {
  const normalized = String(value ?? "AG").trim();
  if (!normalized) return "AG";
  return normalized
    .split(/[-_\s]+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase() || "AG";
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
