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
  iconSvg,
  liveActionBtn,
  renderShell,
  sectionHead,
  stateDot,
} from "../lib/exo-ui-components.js";
import { renderAgentRuntimeCard, renderAgentRuntimeMeta } from "./render-agent-runtime-card.js";

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {{ interactive?: boolean }} [meta]
 * @returns {string}
 */
export function renderQueuePage(model, meta = {}) {
  const runtime = model.agentRuntime ?? meta.agentRuntime ?? null;
  const oldestWait = oldestWaitingLabel(model.queue);
  const body =
    `<div class="op-wrap feed">` +
    renderIntro(model, oldestWait, runtime) +
    renderAgentRuntimeCard(runtime, meta, { surface: "queue", showMeta: false, showActions: false }) +
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
