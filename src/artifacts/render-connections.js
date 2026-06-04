// @ts-check
//
// Render the Connections surface (Exo UI Build Spec — inbound truth) as static
// HTML. CSS-only tabs (received / sent / following / followers / views), each
// an itemized person list with tab-specific actions and per-surface freshness,
// plus a surface-freshness footer. Demonstrates Empty / Partial / Failed.

import {
  avatar,
  btn,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  renderShell,
  truthTag,
} from "../lib/exo-ui-components.js";

/**
 * @param {ReturnType<import("../core/build-connections-view.js").buildConnectionsViewModel>} model
 * @param {{ user?: { label?: string } | null, generatedAt?: string, regenerateCommand?: string }} [meta]
 * @returns {string}
 */
export function renderConnectionsPage(model, meta = {}) {
  const radios = model.tabs
    .map((tab, i) => `<input type="radio" name="cn-tab" id="cn-${escapeAttr(tab.key)}" class="conn-toggle"${i === 0 ? " checked" : ""}>`)
    .join("");

  const body =
    radios +
    `<div class="dom-wrap">` +
    renderIntro(model) +
    `<div class="conn-main">` +
    renderTabs(model.tabs) +
    model.tabs.map((tab) => renderPanel(tab, meta)).join("") +
    `</div>` +
    renderFreshness(model.freshness) +
    renderFooter(meta) +
    `</div>`;

  return renderShell({
    title: `Exo — Connections${meta.user?.label ? ` · ${meta.user.label}` : ""}`,
    activeId: "connections",
    sectionLabel: "Connections",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    agentRuntime: meta.agentRuntime ?? null,
  });
}

/** @param {any} model */
function renderIntro(model) {
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Connections</h1>` +
    `<p class="op-line">Your connection surfaces — requests in and out, who follows you, who you follow, and who viewed your profile. Open a surface to act on it.</p>` +
    `</div>` +
    `</div>`
  );
}

/** @param {any[]} tabs */
function renderTabs(tabs) {
  return (
    `<div class="rel-tabs">` +
    tabs
      .map(
        (tab) =>
          `<label class="rel-tab" for="cn-${escapeAttr(tab.key)}">${iconSvg(tab.icon, 14)}${escapeHtml(tab.label)}` +
          `<span class="rel-tab-n">${tab.count}</span></label>`,
      )
      .join("") +
    `</div>`
  );
}

/**
 * @param {any} tab
 * @param {{ interactive?: boolean }} meta
 */
function renderPanel(tab, meta) {
  const freshHead =
    `<div class="rel-fresh">` +
    `<div class="rel-fresh-l"><span class="rel-fresh-title">${escapeHtml(tab.title)}</span>${truthTag(tab.truth, tab.lastChecked)}</div>` +
    // Syncing a LinkedIn surface is an agent/capture operation, not a UI write —
    // shown disabled (honest) rather than as a button that does nothing.
    btn({ variant: "secondary", size: "sm", icon: "refresh", label: "Sync via agent", disabled: true, title: "This surface is refreshed by the capture agent, not from the UI." }) +
    `</div>`;
  const gap = tab.gap ? `<div class="rel-gap">${iconSvg("alert", 13)}${escapeHtml(tab.gap)}</div>` : "";
  const list = tab.people.length
    ? `<div class="rel-list">${tab.people.map((p) => renderPersonRow(p, tab.action, meta)).join("")}</div>`
    : emptyState({ icon: "check", message: `Nothing in ${tab.label.toLowerCase()} right now.` });

  return `<div class="rel-panel rp-${escapeAttr(tab.key)}">${freshHead}${gap}${list}</div>`;
}

/**
 * @param {any} p
 * @param {string} action
 * @param {{ interactive?: boolean }} [meta]
 */
function renderPersonRow(p, action, meta = {}) {
  // When this inbound person is a tracked prospect, deep-link the name to their
  // prospect show page (interactive UI only).
  const nameInner = `${p.target ? iconSvg("target", 12, "tgt") : ""}${escapeHtml(p.name)}`;
  const href = meta.interactive
    ? p.prospectId
      ? `/prospects/${encodeURIComponent(p.prospectId)}`
      : p.id
        ? `/people/${encodeURIComponent(p.id)}`
        : null
    : null;
  const nameEl = href
    ? `<a class="person-name person-link" href="${escapeAttr(href)}">${nameInner}</a>`
    : `<div class="person-name">${nameInner}</div>`;
  const id =
    `<div class="person-id">` +
    nameEl +
    (p.sub ? `<div class="person-sub">${escapeHtml(p.sub)}</div>` : "") +
    `<div class="person-foot">` +
    (p.company ? `<span class="person-co">${escapeHtml(p.company)}</span>` : `<span class="person-co dim">Not available yet</span>`) +
    `</div>` +
    `</div>`;
  return (
    `<div class="person-row">` +
    avatar({ src: p.avatarUrl, initials: p.initials, name: p.name, size: 40 }) +
    id +
    `<span class="person-when">${escapeHtml(p.when ?? "")}</span>` +
    `<div class="person-actions">${rowActions(p, action, meta)}</div>` +
    `</div>`
  );
}

/**
 * Wrap a button in a live action host the client dispatcher POSTs to /act.
 * @param {{ writer: string, args: Record<string, any>, variant: string, label: string, icon?: string }} opts
 */
function actionBtn(opts) {
  const inner =
    `<button class="btn btn-${opts.variant} btn-sm" type="button">` +
    (opts.icon ? iconSvg(opts.icon, 14) : "") +
    `<span>${escapeHtml(opts.label)}</span></button>`;
  return `<span class="exo-action" data-exo-writer="${escapeAttr(opts.writer)}" data-exo-args="${escapeAttr(JSON.stringify(opts.args))}">${inner}</span>`;
}

/**
 * Resolved (accepted/connected) row: the request landed — show the state and a
 * forward action instead of re-offering Accept/Decline or Withdraw.
 * @param {any} p
 */
function acceptedRow(p) {
  const label = p.connectionDegree === 1 ? "Connected" : "Accepted";
  const forward = p.prospectId
    ? btn({ variant: "secondary", size: "sm", icon: "arrowR", label: "Open prospect", href: `/prospects/${encodeURIComponent(p.prospectId)}` })
    : p.id
      ? btn({ variant: "secondary", size: "sm", icon: "userPlus", label: "Add as prospect", href: `/people/${encodeURIComponent(p.id)}` })
      : p.profileUrl
        ? btn({ variant: "ghost", size: "sm", icon: "link", label: "Profile", href: p.profileUrl })
        : "";
  return `<span class="row-accepted">${iconSvg("check", 12)}${escapeHtml(label)}</span>${forward}`;
}

/**
 * @param {any} p
 * @param {string} action
 * @param {{ interactive?: boolean }} [meta]
 */
function rowActions(p, action, meta = {}) {
  if (p.failed) {
    // A failed capture can't be retried from the UI (re-run is an agent op);
    // show the failed truth and a real Profile link rather than a dead Retry.
    return `<span class="row-failed">${truthTag("failed")}</span>` + profileBtn(p);
  }
  switch (action) {
    case "accept-decline":
      // Resolved (accepted, incl. 1st-degree) — no longer pending: show state.
      if (p.resolution === "accepted") return acceptedRow(p);
      // Pending inbound request — wire the real Accept / Decline writers.
      if (meta.interactive && p.id) {
        return (
          actionBtn({ writer: "recordInboundObservation", args: { observationId: p.id, nextKind: "connection_request_accepted" }, variant: "primary", icon: "check", label: "Accept" }) +
          // Reject is NOT a local hide — it queues the agent to actually decline
          // the invite on LinkedIn. decline_requested leaves the operator's list
          // right away; the agent executes the real decline and writes back the
          // final declined state.
          actionBtn({ writer: "recordInboundObservation", args: { observationId: p.id, nextKind: "connection_request_decline_requested" }, variant: "danger", label: "Reject" })
        );
      }
      return btn({ variant: "primary", size: "sm", icon: "check", label: "Accept" }) + btn({ variant: "danger", size: "sm", label: "Decline" });
    case "withdraw":
      // Sent request — if the captured degree says 1st, it was accepted: show
      // that. Otherwise it's still pending and stays in the sent queue.
      if (p.resolution === "accepted") return acceptedRow(p);
      return profileBtn(p);
    case "unfollow":
    case "follow-back":
    case "connect":
    default:
      // These surfaces have no governed UI writer yet — link to the profile
      // (a real action) rather than render a button that does nothing.
      return profileBtn(p);
  }
}

/** @param {any} p */
function profileBtn(p) {
  return p.profileUrl ? btn({ variant: "ghost", size: "sm", icon: "link", label: "Profile", href: p.profileUrl }) : "";
}

/** @param {any[]} freshness */
function renderFreshness(freshness) {
  return (
    `<div class="conn-fresh">` +
    `<div class="conn-fresh-head">${iconSvg("refresh", 13)}<h3>Surface freshness</h3><span>when each surface was last checked</span></div>` +
    `<div class="conn-fresh-row">` +
    freshness
      .map(
        (f) =>
          `<div class="fresh-chip static"><span class="fresh-name">${escapeHtml(f.name)}</span>${truthTag(f.truth, f.at)}</div>`,
      )
      .join("") +
    `</div>` +
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
