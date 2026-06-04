// @ts-check
//
// Render the Workspace rollup (Exo UI Build Spec — composed analytics overview)
// as static HTML. A stat strip over four panels (operator pulse, motions
// readiness, surface freshness, execution & capability). Every panel reuses the
// same status language and links back into its domain.

import {
  actionTag,
  avatar,
  countChip,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  readinessBar,
  renderShell,
  stateDot,
  truthTag,
} from "../lib/exo-ui-components.js";

/**
 * @param {ReturnType<import("../core/build-workspace-rollup.js").buildWorkspaceRollup>} model
 * @param {{ user?: { label?: string } | null, generatedAt?: string, regenerateCommand?: string }} [meta]
 * @returns {string}
 */
export function renderWorkspaceRollupPage(model, meta = {}) {
  const body =
    `<div class="ws-wrap">` +
    renderIntro() +
    renderStats(model.stats) +
    `<div class="ws-grid">` +
    renderPulse(model.pulse, meta) +
    renderMotions(model.motions, meta) +
    renderSurfaces(model.surfaces) +
    renderExecution(model.execution) +
    `</div>` +
    renderFooter(meta) +
    `</div>`;

  return renderShell({
    title: `Exo — Workspace${meta.user?.label ? ` · ${meta.user.label}` : ""}`,
    activeId: "workspace",
    sectionLabel: "Workspace",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    agentRuntime: meta.agentRuntime ?? null,
  });
}

function renderIntro() {
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Workspace</h1>` +
    `<p class="op-line">Pipeline, motion readiness, surface freshness and execution — the analytics overview.</p>` +
    `</div>` +
    `</div>`
  );
}

/** @param {any} stats */
function renderStats(stats) {
  const tile = (label, body) => `<div class="stat-tile"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-body">${body}</div></div>`;
  const nums = (entries) =>
    `<div class="stat-left"><div class="stat-nums">` +
    entries.map(([n, l]) => `<span><b>${escapeHtml(n)}</b><em>${escapeHtml(l)}</em></span>`).join("") +
    `</div></div>`;

  return (
    `<div class="ws-stats">` +
    tile("Prospect Pool", nums([[stats.pool.total, "total"], [stats.pool.active, "active"], [stats.pool.preConnect, "pre-connect"]])) +
    tile(
      "Connect",
      nums([[stats.connect.requested, "requested"], [stats.connect.connected, "connected"]]) +
        `<div class="stat-rate">${escapeHtml(stats.connect.rate)}</div>`,
    ) +
    tile(
      "Engage",
      nums([[stats.engage.sent, "sent"], [stats.engage.replied, "replied"]]) +
        `<div class="stat-rate">${escapeHtml(stats.engage.rate)}</div>`,
    ) +
    tile(
      "Meet",
      nums([[stats.meet.requested, "requested"], [stats.meet.accepted, "accepted"], [stats.meet.declined, "declined"]]),
    ) +
    `</div>`
  );
}

/**
 * @param {any} pulse
 * @param {{ interactive?: boolean }} [meta]
 */
function renderPulse(pulse, meta = {}) {
  const col = (cap, body) => `<div class="pulse-col"><div class="pulse-cap">${escapeHtml(cap)}</div>${body}</div>`;
  const nameEl = (name, prospectId, personId) => {
    const href = meta.interactive
      ? prospectId
        ? `/prospects/${encodeURIComponent(prospectId)}`
        : personId
          ? `/people/${encodeURIComponent(personId)}`
          : null
      : null;
    return href
      ? `<a class="mini-name person-link" href="${escapeAttr(href)}">${escapeHtml(name)}</a>`
      : `<div class="mini-name">${escapeHtml(name)}</div>`;
  };
  const mini = (name, sub, prospectId, personId) =>
    `<div class="mini-row">${avatar({ initials: initials(name), name, size: 26, accent: "#3b82f6" })}` +
    `<div class="mini-id">${nameEl(name, prospectId, personId)}<div class="mini-sub">${escapeHtml(sub)}</div></div></div>`;

  const decision = pulse.topDecision
    ? mini(pulse.topDecision.name, pulse.topDecision.sub, pulse.topDecision.prospectId, pulse.topDecision.personId) + `<div class="pulse-tag">${actionTag("needs decision")}</div>`
    : emptyState({ icon: "check", message: "Clear" });
  const agent = pulse.topAgent
    ? mini(pulse.topAgent.name, pulse.topAgent.sub) + `<div class="pulse-tag">${stateDot("ready")}</div>`
    : emptyState({ icon: "cpu", message: "Empty" });
  const blocker = pulse.topBlocker
    ? mini(pulse.topBlocker.name, pulse.topBlocker.sub) + `<div class="pulse-tag">${actionTag(pulse.topBlocker.status)}</div>`
    : emptyState({ icon: "check", message: "None" });

  return (
    `<div class="ws-panel span-2">` +
    `<div class="ws-panel-head">${iconSvg("flag", 15)}<h3>Operator pulse</h3>` +
    `<span class="ws-head-right">${countChip(pulse.counts.decisions, "amber", "decide")}${countChip(pulse.counts.agentReady, "blue", "ready")}${countChip(pulse.counts.blocked, "red", "blocked")}</span></div>` +
    `<div class="ws-pulse">${col("Top decision", decision)}${col("Agent ready", agent)}${col("Top blocker", blocker)}</div>` +
    `</div>`
  );
}

/**
 * @param {any} motions
 * @param {{ interactive?: boolean }} [meta]
 */
function renderMotions(motions, meta = {}) {
  const avgPct = `${Math.round(motions.avg * 100)}%`;
  const motionHref = (id) => (meta.interactive ? `/motions/${encodeURIComponent(id)}` : `../motions.html#m-${id}`);
  const rows = motions.items.length
    ? motions.items
        .map(
          (m) =>
            `<a class="ws-motion" href="${escapeAttr(motionHref(m.id))}">` +
            `<div class="wm-top">${stateDot(m.state)}<span class="wm-name">${escapeHtml(m.name)}</span>${truthTag(m.truth)}</div>` +
            readinessBar(m.readiness) +
            `<div class="wm-meta">${Math.round(m.readiness * 100)}% ready · ${m.companyCount} co · ${m.prospectCount} prospects · ${m.actionCount} actions</div>` +
            (m.blocker ? `<div class="wm-blocker">${iconSvg("alert", 11)}${escapeHtml(m.blocker)}</div>` : "") +
            `</a>`,
        )
        .join("")
    : emptyState({ icon: "layers", message: "No motions yet." });

  return (
    `<div class="ws-panel span-2">` +
    `<div class="ws-panel-head">${iconSvg("layers", 15)}<h3>Motions readiness</h3><span class="ws-head-right"><span class="rb-lab" style="font-family:var(--mono);font-size:10.5px;color:var(--text-3)">avg ${avgPct}</span></span></div>` +
    `<div class="ws-motions">${rows}</div>` +
    `</div>`
  );
}

/** @param {any} surfaces */
function renderSurfaces(surfaces) {
  const rows = surfaces.items
    .map(
      (s) =>
        `<div class="ws-surface">` +
        `<span class="wsf-name">${escapeHtml(s.name)}</span>` +
        `<span>${truthTag(s.truth, s.at)}</span>` +
        `<span class="wsf-note">${escapeHtml(s.note)}</span>` +
        `</div>`,
    )
    .join("");
  return (
    `<div class="ws-panel span-2">` +
    `<div class="ws-panel-head">${iconSvg("eye", 15)}<h3>Surface freshness</h3><span class="ws-head-right">${countChip(surfaces.toReconcile, "amber", "to reconcile")}</span></div>` +
    `<div class="ws-surfaces">${rows}</div>` +
    `</div>`
  );
}

/** @param {any} execution */
function renderExecution(execution) {
  const rows = execution.accounts.length
    ? execution.accounts
        .map(
          (a) =>
            `<div class="ws-account">` +
            iconSvg(a.kind === "gmail" ? "mail" : a.kind === "linkedin" ? "linkedin" : "cpu", 15, "wa-ic") +
            `<div class="wa-id"><span class="wa-handle">${escapeHtml(a.handle)}</span><span class="wa-cap">${escapeHtml(a.capability)}</span></div>` +
            truthTag(a.truth) +
            `</div>`,
        )
        .join("")
    : emptyState({ icon: "cpu", message: "No connected accounts." });
  return (
    `<div class="ws-panel span-2">` +
    `<div class="ws-panel-head">${iconSvg("cpu", 15)}<h3>Execution &amp; capability</h3></div>` +
    `<div class="ws-accounts">${rows}</div>` +
    (execution.blockedNote ? `<div class="ws-cap-note">${iconSvg("alert", 12)}${escapeHtml(execution.blockedNote)}</div>` : "") +
    `</div>`
  );
}

/** @param {{ generatedAt?: string, regenerateCommand?: string }} meta */
function renderFooter(meta) {
  if (!meta.generatedAt && !meta.regenerateCommand) return "";
  const stamp = meta.generatedAt ? new Date(meta.generatedAt).toISOString() : "";
  return (
    `<div class="gen-footer">` +
    (stamp ? `Generated ${escapeHtml(stamp)}` : "") +
    (meta.regenerateCommand ? ` · regenerate with <code>${escapeHtml(meta.regenerateCommand)}</code>` : "") +
    `</div>`
  );
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
