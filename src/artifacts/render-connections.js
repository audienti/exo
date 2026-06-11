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
  renderMotionChoiceOption,
  renderShell,
  stateDot,
  truthTag,
} from "../lib/exo-ui-components.js";

/**
 * @param {ReturnType<import("../core/build-connections-view.js").buildConnectionsViewModel>} model
 * @param {{
 *   user?: { label?: string } | null,
  *   generatedAt?: string,
  *   regenerateCommand?: string,
  *   interactive?: boolean,
  *   userId?: string | null,
 *   accountPath?: string | null,
  *   claimMotions?: Array<{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }>,
 * }} [meta]
 * @returns {string}
 */
export function renderConnectionsPage(model, meta = {}) {
  const agentPassActive = isAgentPassActive(meta.agentRuntime ?? null);
  const activeTabKey = resolveInitialConnectionsTab(model.tabs);
  const radios = model.tabs
    .map((tab) => `<input type="radio" name="cn-tab" id="cn-${escapeAttr(tab.key)}" class="conn-toggle"${tab.key === activeTabKey ? " checked" : ""}>`)
    .join("");
  const sentFilters =
    `<input type="radio" name="cn-sent-filter" id="cn-sent-filter-all" class="conn-toggle" checked>` +
    `<input type="radio" name="cn-sent-filter" id="cn-sent-filter-stale" class="conn-toggle">` +
    `<input type="radio" name="cn-sent-filter" id="cn-sent-filter-fresh" class="conn-toggle">`;
  const claimPanels = renderClaimPanels(model.tabs, meta);

  const body =
    radios +
    sentFilters +
    `<div class="dom-wrap">` +
    renderIntro(model, meta) +
    renderAccountSwitcher(model, meta) +
    `<div class="conn-main">` +
    renderTabs(model.tabs) +
    model.tabs.map((tab) => renderPanel(tab, meta, { agentPassActive })).join("") +
    `</div>` +
    renderFreshness(model.freshness) +
    renderFooter(meta) +
    `</div>` +
    claimPanels;

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

/**
 * @param {Array<{ key: string, count?: number, gap?: string | null, people?: any[] }>} tabs
 * @returns {string | null}
 */
function resolveInitialConnectionsTab(tabs) {
  const populated = tabs.find((tab) => Array.isArray(tab.people) && tab.people.length > 0);
  if (populated) return populated.key;

  const meaningful = tabs.find((tab) => Number(tab.count ?? 0) > 0 || Boolean(tab.gap));
  if (meaningful) return meaningful.key;

  return tabs[0]?.key ?? null;
}

/**
 * @param {any} model
 * @param {{ user?: { label?: string } | null }} [meta]
 */
function renderIntro(model, meta = {}) {
  const userLabel = typeof meta.user?.label === "string" && meta.user.label.trim()
    ? meta.user.label.trim()
    : null;
  const selectedAccount = model.accounts?.find((account) => account.accountId === model.selectedAccountId) ?? null;
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Connections</h1>` +
    (userLabel
      ? `<p class="op-line"><span class="surface-ref">Viewing ${escapeHtml(userLabel)}</span></p>`
      : "") +
    (selectedAccount
      ? `<p class="op-line"><span class="surface-ref">Account ${escapeHtml(selectedAccount.title)}</span></p>`
      : "") +
    `<p class="op-line">Connection surfaces for the active execution user: requests in and out, who follows this user, who this user follows, and who viewed this profile. Open a surface to act on it.</p>` +
    `</div>` +
    `</div>`
  );
}

/**
 * @param {{ accounts?: any[], selectedAccountId?: string | null }} model
 * @param {{ interactive?: boolean, accountPath?: string | null }} meta
 */
function renderAccountSwitcher(model, meta) {
  const accounts = Array.isArray(model.accounts) ? model.accounts : [];
  if (accounts.length <= 1) {
    return "";
  }

  return (
    `<div class="op-intro"><div>` +
    `<p class="op-line">Connected accounts in this user context:</p>` +
    `<div class="cap-cover">` +
    accounts.map((account) => renderAccountChip(account, model.selectedAccountId ?? null, meta)).join("") +
    `</div>` +
    `</div></div>`
  );
}

/**
 * @param {any} account
 * @param {string | null} selectedAccountId
 * @param {{ interactive?: boolean, accountPath?: string | null }} meta
 */
function renderAccountChip(account, selectedAccountId, meta) {
  const label = `${account.title}${account.subtitle ? ` · ${account.subtitle}` : ""}`;
  const selected = account.accountId === selectedAccountId;
  const truth = truthTag(account.truth ?? "unchecked");
  if (!meta.interactive || !meta.accountPath) {
    return `<span class="surface-ref">${escapeHtml(label)}${truth}</span>`;
  }

  return btn({
    variant: selected ? "primary" : "secondary",
    size: "sm",
    label,
    href: `${meta.accountPath}?account=${encodeURIComponent(account.accountId)}`,
  }) + truth;
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
 * @param {{ interactive?: boolean, agentRuntime?: any }} meta
 * @param {{ agentPassActive: boolean }} runtime
 */
function renderPanel(tab, meta, runtime) {
  const repairStatus = deriveRepairStatus(tab, meta, runtime);
  const freshHead =
    `<div class="rel-fresh">` +
    `<div class="rel-fresh-l"><span class="rel-fresh-title">${escapeHtml(tab.title)}</span>${truthTag(tab.truth, tab.lastChecked)}</div>` +
    renderPanelStatus(repairStatus) +
    `</div>`;
  const gap = tab.gap ? `<div class="rel-gap">${iconSvg("alert", 13)}${escapeHtml(repairStatus.message ?? tab.gap)}</div>` : "";
  const filterBar = tab.key === "sent" ? renderSentFilterBar(tab.filters) : "";
  const list = tab.people.length
    ? `${filterBar}<div class="rel-list">${tab.people.map((p) => renderPersonRow(p, tab.action, meta)).join("")}</div>`
    : emptyState({ icon: "check", message: `Nothing in ${tab.label.toLowerCase()} right now.` });

  return `<div class="rel-panel rp-${escapeAttr(tab.key)}">${freshHead}${gap}${repairStatus.autoHost}${list}</div>`;
}

/**
 * @param {any} tab
 * @param {{ interactive?: boolean }} meta
 * @param {{ agentPassActive: boolean }} runtime
 */
function deriveRepairStatus(tab, meta, runtime) {
  if (!tab.gap) {
    return { label: null, message: null, autoHost: "" };
  }
  if (tab.autoRepairable && tab.repairTask) {
    const active = runtime.agentPassActive;
    const queuedForWindow = tab.repairTask.waitingReason === "outside_working_hours";
    return {
      label: active ? "Resyncing" : "Resync queued",
      message: active
        ? "Exo is running a full resync for this surface so the missing individual observations land back in the workspace."
        : queuedForWindow
          ? "Exo already queued a full resync for this surface and will run it in the next allowed working window."
          : "Exo already queued a full resync for this surface so the missing individual observations land back in the workspace.",
      autoHost: !active && !queuedForWindow && meta.interactive ? renderAutoRepairHost(tab) : "",
    };
  }
  return { label: null, message: null, autoHost: "" };
}

/** @param {{ label: string | null }} repairStatus */
function renderPanelStatus(repairStatus) {
  if (!repairStatus.label) {
    return `<span class="surface-ref">${iconSvg("refresh", 11)}Agent-managed</span>`;
  }
  return `<span class="surface-ref">${iconSvg("refresh", 11)}${escapeHtml(repairStatus.label)}</span>`;
}

/** @param {any} tab */
function renderAutoRepairHost(tab) {
  const onceKey = [
    "connections-auto-repair",
    tab.surfaceKey ?? tab.key,
    tab.gapKind ?? "gap",
    String(tab.count ?? 0),
    tab.repairTask?.mode ?? "full",
    tab.lastChecked ?? "never",
  ].join(":");
  return (
    `<span class="exo-action conn-auto-repair" hidden data-exo-writer="runAgentQueuePass"` +
    ` data-exo-args="${escapeAttr(JSON.stringify({}))}" data-exo-autostart-key="${escapeAttr(onceKey)}">` +
    `<button class="btn btn-secondary btn-sm" type="button" aria-hidden="true" tabindex="-1"><span>Auto repair</span></button>` +
    `</span>`
  );
}

/** @param {any} runtime */
function isAgentPassActive(runtime) {
  return Boolean(runtime?.lock?.active || runtime?.scheduler?.running);
}

/** @param {{ all: number, stale: number, fresh: number } | null} filters */
function renderSentFilterBar(filters) {
  if (!filters) return "";
  return (
    `<div class="sent-filter-bar">` +
    `<label class="sent-filter" for="cn-sent-filter-all">All<span>${filters.all}</span></label>` +
    `<label class="sent-filter" for="cn-sent-filter-stale">Stale<span>${filters.stale}</span></label>` +
    `<label class="sent-filter" for="cn-sent-filter-fresh">Fresh<span>${filters.fresh}</span></label>` +
    `</div>`
  );
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
    renderPersonMetaLine(p) +
    (p.attention ? `<span class="person-co">${iconSvg("eye", 11)}${escapeHtml(p.attention.label)}${p.attention.when ? ` · ${escapeHtml(p.attention.when)}` : ""}</span>` : "") +
    `</div>` +
    `</div>`;
  return (
    `<div class="person-row"${p.sentGroup ? ` data-sent-group="${escapeAttr(p.sentGroup)}"` : ""}>` +
    avatar({ src: p.avatarUrl, initials: p.initials, name: p.name, size: 40 }) +
    id +
    `<span class="person-when">${escapeHtml(p.when ?? "")}</span>` +
    `<div class="person-actions">${rowActions(p, action, meta)}</div>` +
    `</div>`
  );
}

/** @param {{ company?: string | null, note?: string | null }} p */
function renderPersonMetaLine(p) {
  const parts = [];
  if (p.company) {
    parts.push(`<span class="person-co">${escapeHtml(p.company)}</span>`);
  } else if (!p.note) {
    parts.push(`<span class="person-co dim">Not available yet</span>`);
  }
  if (p.note) {
    parts.push(`<span class="person-co">${escapeHtml(p.note)}</span>`);
  }
  return parts.join("");
}

/**
 * Wrap a button in a live action host the client dispatcher POSTs to /act.
 * @param {{ writer: string, args: Record<string, any>, variant: string, label: string, icon?: string, className?: string }} opts
 */
function actionBtn(opts) {
  const inner =
    `<button class="btn btn-${opts.variant} btn-sm" type="button">` +
    (opts.icon ? iconSvg(opts.icon, 14) : "") +
    `<span>${escapeHtml(opts.label)}</span></button>`;
  const className = opts.className ? ` ${escapeAttr(opts.className)}` : "";
  return `<span class="exo-action${className}" data-exo-writer="${escapeAttr(opts.writer)}" data-exo-args="${escapeAttr(JSON.stringify(opts.args))}">${inner}</span>`;
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
      return [
        rowStatusPill(p),
        claimBtn(p, meta),
        withdrawBtn(p, meta),
        fallbackRowAction(p, meta),
      ].filter(Boolean).join("");
    case "unfollow":
    case "follow-back":
    case "connect":
    default:
      return [claimBtn(p, meta), fallbackRowAction(p, meta)].filter(Boolean).join("");
  }
}

/** @param {any} p */
function profileBtn(p) {
  return p.profileUrl ? btn({ variant: "ghost", size: "sm", icon: "link", label: "Profile", href: p.profileUrl }) : "";
}

/**
 * @param {any} p
 * @param {{ interactive?: boolean }} meta
 */
function fallbackRowAction(p, meta = {}) {
  if (p.canClaim || p.canWithdraw || p.withdrawQueued) {
    return "";
  }
  if (meta.interactive && p.prospectId) {
    return btn({ variant: "secondary", size: "sm", icon: "arrowR", label: "Open prospect", href: `/prospects/${encodeURIComponent(p.prospectId)}` });
  }
  return profileBtn(p);
}

/**
 * @param {any} p
 * @param {{
 *   interactive?: boolean,
 *   claimMotions?: Array<{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }>
 * }} meta
 */
function claimBtn(p, meta = {}) {
  if (!p.canClaim) {
    return "";
  }
  const inner = `<button class="btn btn-secondary btn-sm" type="button">${iconSvg("layers", 14)}<span>Claim</span></button>`;
  if (!meta.interactive || !(meta.claimMotions ?? []).length) {
    return inner;
  }
  return `<a class="btn btn-secondary btn-sm" href="#claim-${escapeAttr(p.id)}">${iconSvg("layers", 14)}<span>Claim</span></a>`;
}

/**
 * @param {any} p
 * @param {{ interactive?: boolean }} meta
 */
function withdrawBtn(p, meta = {}) {
  if (!p.canWithdraw) {
    return "";
  }
  if (meta.interactive && p.id) {
    return actionBtn({
      writer: "recordInboundObservation",
      args: { observationId: p.id, nextKind: "connection_request_withdraw_requested" },
      variant: "danger",
      label: "Withdraw",
      className: "exo-action-flat",
    });
  }
  return btn({ variant: "danger", size: "sm", label: "Withdraw" });
}

/** @param {any} p */
function rowStatusPill(p) {
  if (!p.statusLabel || !p.statusTone) {
    return "";
  }
  return `<span class="row-status row-status-${escapeAttr(p.statusTone)}">${escapeHtml(p.statusLabel)}</span>`;
}

/**
 * @param {ReturnType<import("../core/build-connections-view.js").buildConnectionsViewModel>["tabs"]} tabs
 * @param {{
 *   interactive?: boolean,
 *   userId?: string | null,
 *   claimMotions?: Array<{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }>
 * }} meta
 */
function renderClaimPanels(tabs, meta = {}) {
  if (!meta.interactive || !(meta.claimMotions ?? []).length) {
    return "";
  }
  const seen = new Set();
  const people = tabs
    .flatMap((tab) => tab.people)
    .filter((person) => person.canClaim && !seen.has(person.id) && seen.add(person.id));
  if (!people.length) {
    return "";
  }
  return people.map((person) => renderClaimPanel(person, meta)).join("");
}

/**
 * @param {any} person
 * @param {{ userId?: string | null, claimMotions?: Array<{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }> }} meta
 */
function renderClaimPanel(person, meta = {}) {
  const panelId = `claim-${person.id}`;
  const options = (meta.claimMotions ?? [])
    .map(
      (motion) =>
        renderMotionChoiceOption({
          motion,
          action: {
            writer: "claimInboundPersonToMotion",
            args: { observationId: person.id, userId: meta.userId ?? null, toMotionId: motion.id },
            label: "Claim here",
            icon: "arrowR",
            variant: "primary",
          },
        }),
    )
    .join("");
  return (
    `<div class="compose-panel" id="${escapeAttr(panelId)}">` +
    `<a class="compose-backdrop" href="#cn-${escapeAttr("sent")}" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    `<div class="compose-head">${iconSvg("layers", 18)}` +
    `<div><div class="compose-title">Claim ${escapeHtml(person.name)}</div>` +
    `<div class="compose-sub">Attach this relationship to the motion that should govern it.</div></div>` +
    `<a class="compose-close" href="#cn-${escapeAttr("sent")}" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<div class="compose-field"><span class="compose-label">Destination motion</span><div class="rehome-list">${options}</div></div>` +
    `<div class="compose-actions compose-actions-end">` +
    `<a class="btn btn-ghost btn-sm" href="#cn-sent">Cancel</a>` +
    `</div></div></div>`
  );
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
