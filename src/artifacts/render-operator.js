// @ts-check
//
// Render the Operator landing view (Exo UI Build Spec) as a static HTML page.
//
// Inputs are produced by src/core/build-operator-view.js. All visual primitives
// come from src/lib/exo-ui-components.js so other surfaces (Motions, Prospects,
// etc.) can reuse the same design system.

import {
  actionTag,
  avatar,
  btn,
  card,
  countChip,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  liveActionBtn,
  ownerTag,
  renderShell,
  sectionHead,
  stateDot,
  truthTag,
} from "../lib/exo-ui-components.js";

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {{
 *   interactive?: boolean,
 *   activeView?: "queue" | "blocked" | "motions" | null,
 *   selectedMotionId?: string | null,
 *   motionChoices?: Array<{ id: string, name: string, offerLabel?: string | null, offerHost?: string | null, icpSummary?: string | null }>,
 *   returnTo?: string | null,
 *   agentRuntime?: any
 * }} [meta]
 * @returns {string}
 */
export function renderOperatorPage(model, meta = {}) {
  const motionGroups = collectMotionGroups(model);
  const motionOptions = collectMotionOptions(motionGroups, meta.motionChoices ?? [], meta.selectedMotionId);
  const activeView = normalizeOperatorView(meta.activeView, motionOptions, model.counts, meta.selectedMotionId);
  const operatorMeta = {
    ...meta,
    activeView,
  };
  const body =
    `<div class="op-wrap feed">` +
    renderIntro(model, operatorMeta) +
    renderWorkViews(model, motionGroups, motionOptions, operatorMeta) +
    (model.counts.stale > 0
      ? renderSection("stale", "eye", "Stale or incomplete", model.counts.stale, "amber", null, renderStale(model.stale))
      : "") +
    renderFooter(model) +
    `</div>`;

  return renderShell({
    title: `Exo — Operator · ${model.user.label}`,
    activeId: "operator",
    sectionLabel: "Operator",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    agentRuntime: model.agentRuntime
      ? { ...(meta.agentRuntime ?? {}), queueCount: model.agentRuntime.queueCount }
      : meta.agentRuntime ?? null,
  });
}

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {{ activeView?: "queue" | "blocked" | "motions" | null }} [meta]
 */
function renderIntro(model, meta = {}) {
  const c = model.counts;
  const summaryParts = ["What needs action"];
  if (c.blocked > 0) summaryParts.push("what is blocked");
  if (c.stale > 0) summaryParts.push("what still needs review");
  let summaryLine = "What needs action right now.";
  if (summaryParts.length === 2) {
    summaryLine = `${summaryParts[0]} and ${summaryParts[1]}.`;
  } else if (summaryParts.length > 2) {
    summaryLine = `${summaryParts.slice(0, -1).join(", ")}, and ${summaryParts.at(-1)}.`;
  }
  const stats = [
    renderIntroStat(c.decisions, "queued", operatorViewHref("queue"), meta.activeView === "queue"),
    c.blocked > 0 ? renderIntroStat(c.blocked, "blocked", operatorViewHref("blocked"), meta.activeView === "blocked") : "",
    c.stale > 0 ? `<span><b>${c.stale}</b> stale</span>` : "",
  ].filter(Boolean);
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Operator</h1>` +
    `<p class="op-line">${summaryLine}</p>` +
    `</div>` +
    `<div class="op-stat">` +
    stats.join("<i></i>") +
    `</div>` +
    `</div>`
  );
}

/**
 * @param {number} count
 * @param {string} label
 * @param {string} href
 * @param {boolean} active
 */
function renderIntroStat(count, label, href, active) {
  return `<a class="op-stat-link${active ? " is-active" : ""}" href="${escapeAttr(href)}"><b>${count}</b> ${escapeHtml(label)}</a>`;
}

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {Array<{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   offerLabel?: string | null,
 *   offerHost?: string | null,
 *   icpSummary?: string | null,
 *   count: number,
 *   hasPromoted: boolean,
 *   decisions: import("../core/build-operator-view.js").OperatorDecisionCard[],
 * }>} motionGroups
 * @param {{
 *   interactive?: boolean,
 *   activeView?: "queue" | "blocked" | "motions" | null,
 *   selectedMotionId?: string | null,
 *   returnTo?: string | null,
 * }} [meta]
 */
function renderWorkViews(model, motionGroups, motionOptions, meta = {}) {
  const activeView = normalizeOperatorView(meta.activeView, motionOptions, model.counts, meta.selectedMotionId);
  return (
    `<section class="op-sec" data-sec="operator-views">` +
    `<div class="sec-head">` +
    iconSvg("layers", 16, "sec-ic") +
    renderWorkViewNav(model, motionOptions, { activeView, selectedMotionId: meta.selectedMotionId ?? null }) +
    `<span class="sec-sub">Focus operator work by lane.</span>` +
    `</div>` +
    `<div id="operator-views-panel-queue" class="op-view-panel" role="tabpanel" aria-labelledby="operator-views-tab-queue" data-tab-panel="queue"${activeView !== "queue" ? " hidden" : ""}>${activeView === "queue" ? renderQueuePanel(model, meta) : ""}</div>` +
    (model.counts.blocked > 0
      ? `<div id="operator-views-panel-blocked" class="op-view-panel" role="tabpanel" aria-labelledby="operator-views-tab-blocked" data-tab-panel="blocked"${activeView !== "blocked" ? " hidden" : ""}>${activeView === "blocked" ? renderBlockedPanel(model, meta) : ""}</div>`
      : "") +
    (motionOptions.length > 0
      ? `<div id="operator-views-panel-motions" class="op-view-panel" role="tabpanel" aria-labelledby="operator-views-tab-motions" data-tab-panel="motions"${activeView !== "motions" ? " hidden" : ""}>${activeView === "motions" ? renderMotionPanel(model, motionGroups, motionOptions, meta) : ""}</div>`
      : "") +
    `</section>`
  );
}

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {Array<{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   offerLabel?: string | null,
 *   offerHost?: string | null,
 *   icpSummary?: string | null,
 *   count: number,
 *   hasPromoted: boolean,
 * }>} motionOptions
 * @param {{ activeView: "queue" | "blocked" | "motions", selectedMotionId?: string | null }} meta
 */
function renderWorkViewNav(model, motionOptions, meta) {
  return (
    `<div class="seg seg-tabs op-view-tabs" aria-label="Operator work views">` +
    renderWorkViewLink("queue", "Queue", model.counts.decisions, "amber", meta.activeView === "queue") +
    (model.counts.blocked > 0
      ? renderWorkViewLink("blocked", "Blocked", model.counts.blocked, "red", meta.activeView === "blocked")
      : "") +
    (motionOptions.length > 0
      ? renderMotionPicker(motionOptions, { activeView: meta.activeView, selectedMotionId: meta.selectedMotionId ?? null })
      : "") +
    `</div>`
  );
}

/**
 * @param {"queue" | "blocked"} view
 * @param {string} label
 * @param {number} count
 * @param {"amber" | "red"} tone
 * @param {boolean} active
 */
function renderWorkViewLink(view, label, count, tone, active) {
  return (
    `<a class="seg-tab${active ? " is-active" : ""}" id="operator-views-tab-${escapeAttr(view)}" href="${escapeAttr(operatorViewHref(view))}">` +
    escapeHtml(label) +
    countChip(count, tone) +
    `</a>`
  );
}

/**
 * @param {Array<{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   offerLabel?: string | null,
 *   offerHost?: string | null,
 *   icpSummary?: string | null,
 *   count: number,
 *   hasPromoted: boolean,
 * }>} motionOptions
 * @param {{ activeView?: "queue" | "blocked" | "motions" | null, selectedMotionId?: string | null }} [meta]
 */
function renderMotionPicker(motionOptions, meta = {}) {
  const selected = findMotionOption(motionOptions, meta.selectedMotionId);
  const currentLabel = selected?.offerLabel ?? selected?.label ?? "All motions";
  return (
    `<details class="seg-motion-picker${meta.activeView === "motions" ? " is-active" : ""}">` +
    `<summary class="seg-tab seg-motion-trigger${meta.activeView === "motions" ? " is-active" : ""}" id="operator-views-tab-motions" aria-haspopup="menu">` +
    `<span class="seg-motion-trigger-copy">` +
    `<span class="seg-motion-trigger-label">By motion</span>` +
    `<span class="seg-motion-trigger-current">${escapeHtml(currentLabel)}</span>` +
    `</span>` +
    countChip(motionOptions.length, "blue") +
    `<span class="seg-motion-trigger-chev">${iconSvg("chevron", 12)}</span>` +
    `</summary>` +
    `<div class="seg-motion-menu" role="menu" aria-label="Choose an active motion">` +
    renderMotionMenuOption({
      href: operatorViewHref("motions"),
      title: "All motions",
      meta: "Show operator work grouped across every active motion.",
      metaLabel: null,
      motionName: null,
      offerHost: null,
      count: motionOptions.length,
      current: !selected,
    }) +
    motionOptions.map((option) =>
      renderMotionMenuOption({
        href: operatorViewHref("motions", option.filterValue),
        title: option.offerLabel ?? option.label,
        meta: option.icpSummary ?? null,
        metaLabel: option.icpSummary ? "ICP" : null,
        motionName: option.label,
        offerHost: option.offerHost ?? null,
        count: option.count,
        current: selected?.key === option.key,
      })).join("") +
    `</div>` +
    `</details>`
  );
}

/**
 * @param {{
 *   href: string,
 *   title: string,
 *   meta?: string | null,
 *   metaLabel?: string | null,
 *   motionName?: string | null,
 *   offerHost?: string | null,
 *   count: number,
 *   current?: boolean,
 * }} opts
 */
function renderMotionMenuOption(opts) {
  const showMotionName = Boolean(
    opts.motionName
    && opts.motionName.trim()
    && opts.motionName.trim() !== opts.title.trim(),
  );
  return (
    `<a class="motion-menu-opt${opts.current ? " is-current" : ""}" href="${escapeAttr(opts.href)}" role="menuitem">` +
    `<span class="motion-menu-copy">` +
    (opts.offerHost
      ? `<span class="motion-menu-host">${iconSvg("link", 11)}<span>${escapeHtml(opts.offerHost)}</span></span>`
      : `<span class="motion-menu-host motion-menu-host-all">${iconSvg("layers", 11)}<span>All active motions</span></span>`) +
    `<span class="motion-menu-title">${escapeHtml(opts.title)}</span>` +
    (opts.meta
      ? `<span class="motion-menu-meta">${escapeHtml(opts.metaLabel ? `${opts.metaLabel} · ${opts.meta}` : opts.meta)}</span>`
      : "") +
    (showMotionName ? `<span class="motion-menu-code">${escapeHtml(opts.motionName ?? "")}</span>` : "") +
    `</span>` +
    countChip(opts.count, "blue") +
    `</a>`
  );
}

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {{ interactive?: boolean, returnTo?: string | null }} [meta]
 */
function renderQueuePanel(model, meta = {}) {
  return (
    renderNextMove(model.nextMove, meta) +
    renderSection(
      "dec",
      "queue",
      "Action queue",
      model.counts.decisions,
      "amber",
      "One queue of operator work across inbound review and due-now planner actions. Background agent work is separate.",
      renderDecisions(model.decisions, meta, { hasPromoted: Boolean(model.nextMove) }),
    )
  );
}

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {{ interactive?: boolean, returnTo?: string | null }} [meta]
 */
function renderBlockedPanel(model, meta = {}) {
  return renderSection(
    "blk",
    "alert",
    "Blocked",
    model.counts.blocked,
    "red",
    "Issues that need a real unblock before governed work resumes.",
    renderBlocked(model.blocked, meta),
  );
}

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {Array<{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   count: number,
 *   hasPromoted: boolean,
 *   decisions: import("../core/build-operator-view.js").OperatorDecisionCard[],
 * }>} motionGroups
 * @param {Array<{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   offerLabel?: string | null,
 *   offerHost?: string | null,
 *   icpSummary?: string | null,
 *   count: number,
 *   hasPromoted: boolean,
 * }>} motionOptions
 * @param {{
 *   interactive?: boolean,
 *   selectedMotionId?: string | null,
 *   returnTo?: string | null,
 * }} [meta]
 */
function renderMotionPanel(model, motionGroups, motionOptions, meta = {}) {
  const selectedOption = findMotionOption(motionOptions, meta.selectedMotionId);
  const selected = selectedOption
    ? (findMotionGroup(motionGroups, selectedOption.filterValue) ?? motionGroups.find((group) => group.label === selectedOption.label) ?? null)
    : null;
  if (!selectedOption) {
    if (!motionGroups.length) {
      return renderSection(
        "motion-work",
        "layers",
        "All motions",
        motionOptions.length,
        "blue",
        "No motion-scoped operator work is queued right now.",
        emptyState({ icon: "check", message: "No motion-scoped operator work is queued right now." }),
      );
    }
    return motionGroups.map((group) =>
      renderMotionGroupSection(
        model,
        group,
        resolveMotionGroupOption(motionOptions, group),
        meta,
        { filtered: false },
      )).join("");
  }
  if (!selected) {
    return (
      renderSection(
        "motion-work",
        "layers",
        selectedOption.offerLabel ?? selectedOption.label,
        0,
        "blue",
        "No operator work is queued for this motion right now.",
        emptyState({ icon: "check", message: "No operator work is queued for this motion right now." }),
      ) +
      renderMotionClearAction()
    );
  }
  return renderMotionGroupSection(model, selected, selectedOption, meta, { filtered: true });
}

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   count: number,
 *   hasPromoted: boolean,
 *   decisions: import("../core/build-operator-view.js").OperatorDecisionCard[],
 * }} group
 * @param {{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   offerLabel?: string | null,
 *   offerHost?: string | null,
 *   icpSummary?: string | null,
 *   count: number,
 *   hasPromoted: boolean,
 * }} option
 * @param {{ interactive?: boolean, returnTo?: string | null }} meta
 * @param {{ filtered?: boolean }} [view]
 */
function renderMotionGroupSection(model, group, option, meta, view = {}) {
  const filtered = Boolean(view.filtered);
  const title = option.offerLabel ?? option.label;
  const descriptor = buildMotionDescriptor(option);
  const promotedDecision = filtered && !group.hasPromoted
    ? (group.decisions[0] ?? null)
    : null;
  const nextMove = group.hasPromoted
    ? model.nextMove
    : decisionCardToNextMove(promotedDecision);
  const visibleDecisions = promotedDecision
    ? group.decisions.slice(1)
    : group.decisions;
  const hasPromoted = group.hasPromoted || Boolean(promotedDecision);
  const sub = filtered
    ? `${descriptor ? `${descriptor} · ` : ""}${group.hasPromoted
      ? "Promoted next move included. Everything below stays inside this motion."
      : hasPromoted
        ? "Motion-scoped next move included. Everything below stays inside this motion."
        : "Only this motion's operator work is shown."}`
    : descriptor || "Operator work grouped under this motion.";
  return (
    (nextMove ? renderNextMove(nextMove, meta) : "") +
    renderSection(
      filtered ? "motion-work" : `motion-work-${group.key}`,
      "layers",
      title,
      group.count,
      "blue",
      sub,
      renderDecisions(visibleDecisions, meta, { hasPromoted }),
    ) +
    (filtered ? renderMotionClearAction() : "")
  );
}

/**
 * @param {import("../core/build-operator-view.js").OperatorDecisionCard | null | undefined} decision
 * @returns {import("../core/build-operator-view.js").OperatorNextMove | null}
 */
function decisionCardToNextMove(decision) {
  if (!decision) return null;
  return {
    title: decision.summary,
    subject: decision.person,
    prospectId: decision.prospectId ?? null,
    personId: decision.personId ?? null,
    avatarUrl: decision.avatarUrl ?? null,
    subtitle: decision.roleLine ?? ([decision.role, decision.company].filter(Boolean).join(" · ") || null),
    motionId: decision.motionId ?? null,
    motionName: decision.motionName ?? null,
    motionStatus: "active",
    truth: decision.truth,
    truthAt: decision.truthAt ?? null,
    surface: decision.surface ?? null,
    action: decision.primaryActionLabel,
    actionMode: decision.primaryActionMode,
    actionStatus: decision.actionStatus ?? null,
    actionWriter: null,
    actionArgs: null,
    actionHref: decision.primaryHref ?? null,
    why: decision.why ?? null,
    previewLabel: decision.previewLabel ?? null,
    previewSubject: decision.previewSubject ?? null,
    previewText: decision.previewText ?? null,
    backlogCompanies: null,
    actions: decision.actions ?? [],
  };
}

/**
 * @param {{
 *   label: string,
 *   offerLabel?: string | null,
 *   offerHost?: string | null,
 *   icpSummary?: string | null,
 * }} option
 */
function buildMotionDescriptor(option) {
  const parts = [];
  if (option.offerHost) {
    parts.push(option.offerHost);
  }
  if (option.icpSummary) {
    parts.push(`ICP: ${option.icpSummary}`);
  }
  if (option.label && option.label !== (option.offerLabel ?? option.label)) {
    parts.push(option.label);
  }
  return parts.join(" · ");
}

function renderMotionClearAction() {
  return `<div class="op-motion-clear">${btn({ variant: "ghost", size: "sm", icon: "refresh", label: "Clear to all motions", href: operatorViewHref("motions") })}</div>`;
}

/**
 * @param {Array<{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   offerLabel?: string | null,
 *   offerHost?: string | null,
 *   icpSummary?: string | null,
 *   count: number,
 *   hasPromoted: boolean,
 * }>} motionOptions
 * @param {{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   count: number,
 *   hasPromoted: boolean,
 * }} group
 */
function resolveMotionGroupOption(motionOptions, group) {
  return motionOptions.find((option) =>
    (group.motionId && option.motionId === group.motionId)
    || option.filterValue === group.filterValue
    || option.label === group.label) ?? {
    key: group.key,
    filterValue: group.filterValue,
    motionId: group.motionId,
    label: group.label,
    offerLabel: group.label,
    offerHost: null,
    icpSummary: null,
    count: group.count,
    hasPromoted: group.hasPromoted,
  };
}

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 */
function collectMotionGroups(model) {
  /** @type {Map<string, {
   *   key: string,
   *   filterValue: string,
   *   motionId: string | null,
   *   label: string,
   *   count: number,
   *   hasPromoted: boolean,
   *   decisions: import("../core/build-operator-view.js").OperatorDecisionCard[],
   * }>} */
  const groups = new Map();

  const ensure = (motionId, motionName) => {
    const label = normalizeMotionLabel(motionName, motionId);
    if (!label) return null;
    const filterValue = motionId ?? `name:${label}`;
    const key = motionId ? `motion:${motionId}` : `name:${label}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        filterValue,
        motionId: motionId ?? null,
        label,
        count: 0,
        hasPromoted: false,
        decisions: [],
      });
    }
    return groups.get(key) ?? null;
  };

  if (model.nextMove) {
    const group = ensure(model.nextMove.motionId ?? null, model.nextMove.motionName ?? null);
    if (group) {
      group.hasPromoted = true;
      group.count += 1;
    }
  }

  for (const decision of model.decisions) {
    const group = ensure(decision.motionId ?? null, decision.motionName ?? null);
    if (!group) continue;
    group.count += 1;
    group.decisions.push(decision);
  }

  return [...groups.values()].sort((left, right) =>
    Number(Boolean(right.hasPromoted)) - Number(Boolean(left.hasPromoted))
    || right.count - left.count
    || left.label.localeCompare(right.label));
}

/**
 * @param {Array<{
 *   key: string,
 *   filterValue: string,
 *   motionId: string | null,
 *   label: string,
 *   offerLabel?: string | null,
 *   offerHost?: string | null,
 *   icpSummary?: string | null,
 *   count: number,
 *   hasPromoted: boolean,
 * }>} motionGroups
 * @param {Array<{ id: string, name: string, offerLabel?: string | null, offerHost?: string | null, icpSummary?: string | null }>} motionChoices
 * @param {string | null | undefined} selectedMotionId
 */
function collectMotionOptions(motionGroups, motionChoices, selectedMotionId) {
  if (!Array.isArray(motionChoices) || motionChoices.length === 0) {
    return motionGroups.map((group) => ({
      key: group.key,
      filterValue: group.filterValue,
      motionId: group.motionId,
      label: group.label,
      count: group.count,
      hasPromoted: group.hasPromoted,
    }));
  }

  const groupByMotionId = new Map(motionGroups.filter((group) => group.motionId).map((group) => [group.motionId, group]));
  const groupByLabel = new Map(motionGroups.map((group) => [group.label, group]));
  const options = motionChoices
    .filter((choice) => typeof choice?.id === "string" && choice.id.trim() && typeof choice?.name === "string" && choice.name.trim())
    .map((choice) => {
      const motionId = choice.id.trim();
      const label = choice.name.trim();
      const group = groupByMotionId.get(motionId) ?? groupByLabel.get(label) ?? null;
      return {
        key: `motion:${motionId}`,
        filterValue: motionId,
        motionId,
        label,
        offerLabel: normalizeMotionLabel(choice.offerLabel, label),
        offerHost: normalizeMotionLabel(choice.offerHost, null),
        icpSummary: normalizeMotionLabel(choice.icpSummary, null),
        count: group?.count ?? 0,
        hasPromoted: group?.hasPromoted ?? false,
      };
    });

  const selectedGroup = findMotionGroup(motionGroups, selectedMotionId);
  if (selectedGroup && !options.some((option) => option.filterValue === selectedGroup.filterValue)) {
    options.push({
      key: selectedGroup.key,
      filterValue: selectedGroup.filterValue,
      motionId: selectedGroup.motionId,
      label: selectedGroup.label,
      offerLabel: selectedGroup.label,
      offerHost: null,
      icpSummary: null,
      count: selectedGroup.count,
      hasPromoted: selectedGroup.hasPromoted,
    });
  }

  return options.sort((left, right) =>
    Number(Boolean(right.hasPromoted)) - Number(Boolean(left.hasPromoted))
    || (left.offerLabel ?? left.label).localeCompare(right.offerLabel ?? right.label));
}

/**
 * @param {string | null | undefined} value
 * @param {string | null | undefined} fallbackId
 */
function normalizeMotionLabel(value, fallbackId) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof fallbackId === "string" && fallbackId.trim()) {
    return fallbackId.trim();
  }
  return null;
}

/**
 * @param {Array<{ key: string, filterValue: string }>} motionGroups
 * @param {string | null | undefined} selectedMotionId
 */
function findMotionGroup(motionGroups, selectedMotionId) {
  if (!selectedMotionId) return null;
  return motionGroups.find((group) => group.filterValue === selectedMotionId || group.key === selectedMotionId) ?? null;
}

/**
 * @param {Array<{ key: string, filterValue: string }>} motionOptions
 * @param {string | null | undefined} selectedMotionId
 */
function findMotionOption(motionOptions, selectedMotionId) {
  if (!selectedMotionId) return null;
  return motionOptions.find((option) => option.filterValue === selectedMotionId || option.key === selectedMotionId) ?? null;
}

/**
 * @param {"queue" | "blocked" | "motions" | null | undefined} requested
 * @param {Array<any>} motionOptions
 * @param {{ blocked: number }} counts
 * @param {string | null | undefined} selectedMotionId
 */
function normalizeOperatorView(requested, motionOptions, counts, selectedMotionId) {
  const preferred = selectedMotionId ? "motions" : requested ?? "queue";
  if (preferred === "blocked") {
    return counts.blocked > 0 ? "blocked" : "queue";
  }
  if (preferred === "motions") {
    return motionOptions.length > 0 ? "motions" : "queue";
  }
  return "queue";
}

/**
 * Canonical operator deep-link: `/operator?view=…&motion=…#view`. `view` is
 * omitted from the query when it's the default "queue", and `motion` is only
 * attached on the motions view. Exported so the server's returnTo links stay in
 * lock-step with the in-page tab links.
 *
 * @param {"queue" | "blocked" | "motions"} view
 * @param {string | null | undefined} [motionId]
 */
export function operatorViewHref(view, motionId) {
  const params = new URLSearchParams();
  if (view !== "queue") {
    params.set("view", view);
  }
  if (view === "motions" && motionId) {
    params.set("motion", motionId);
  }
  const search = params.toString();
  return `/operator${search ? `?${search}` : ""}#${view}`;
}

/**
 * A person's name links to their prospect show page when they're a tracked
 * prospect, otherwise to the internal person page (interactive UI only).
 *
 * @param {string} name
 * @param {string | null | undefined} prospectId
 * @param {string | null | undefined} personId  inbound observation id
 * @param {{ interactive?: boolean }} meta
 * @param {string} cls
 */
function personName(name, prospectId, personId, meta, cls) {
  const href = personHref(prospectId, personId, meta);
  if (href) {
    return `<a class="${cls} person-link" href="${escapeAttr(href)}">${escapeHtml(name)}</a>`;
  }
  return `<div class="${cls}">${escapeHtml(name)}</div>`;
}

/**
 * @param {string | null | undefined} prospectId
 * @param {string | null | undefined} personId
 * @param {{ interactive?: boolean }} meta
 * @returns {string | null}
 */
function personHref(prospectId, personId, meta) {
  if (!meta.interactive) return null;
  if (prospectId) return withReturn(`/prospects/${encodeURIComponent(prospectId)}`, meta);
  if (personId) return withReturn(`/people/${encodeURIComponent(personId)}`, meta);
  return null;
}

/**
 * @param {string} companyId
 * @param {{ interactive?: boolean }} meta
 * @returns {string | null}
 */
function companyHref(companyId, meta) {
  if (!meta.interactive) return null;
  return `/companies/${encodeURIComponent(companyId)}`;
}

/**
 * Preserve the originating surface on interactive internal links so detail-page
 * actions can route the operator back to the right lane after a mutation.
 *
 * @param {string} href
 * @param {{ interactive?: boolean, returnTo?: string | null }} meta
 * @returns {string}
 */
function withReturn(href, meta) {
  if (!meta.interactive) return href;
  const returnTo = meta.returnTo ?? "/operator";
  if (!returnTo || !href.startsWith("/")) return href;
  try {
    const url = new URL(href, "http://exo.local");
    if (!url.searchParams.has("return")) {
      url.searchParams.set("return", returnTo);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

/**
 * Where a Reply/Send action goes: a tracked prospect opens their compose panel
 * directly (the panel is a :target, so the hash auto-opens it); an untracked
 * inbound person goes to their person page (to promote first). Falls back to the
 * external href (e.g. LinkedIn) only when not interactive.
 *
 * @param {string | null | undefined} prospectId
 * @param {string | null | undefined} personId
 * @param {string | null | undefined} fallbackHref
 * @param {{ interactive?: boolean }} meta
 * @returns {string | undefined}
 */
function composeHref(prospectId, personId, fallbackHref, meta) {
  // Carry where the operator launched from so the compose submit can return
  // there instead of reloading the detail page in place.
  const ret = `return=${encodeURIComponent(meta.returnTo ?? "/operator")}`;
  if (meta.interactive && prospectId) {
    return `/prospects/${encodeURIComponent(prospectId)}?${ret}#compose-${encodeURIComponent(prospectId)}`;
  }
  if (meta.interactive && personId) {
    // Untracked inbox people draft on demand. Keep the ordinary detail page
    // cheap, but mark explicit compose routes so the person page can generate
    // the reply before opening the panel.
    return `/people/${encodeURIComponent(personId)}?${ret}&compose=1#compose-${encodeURIComponent(personId)}`;
  }
  return fallbackHref ?? undefined;
}

/**
 * @param {string | null | undefined} prospectId
 * @param {string | null | undefined} personId
 * @param {string | null | undefined} fallbackHref
 * @param {{ interactive?: boolean }} meta
 * @returns {string | undefined}
 */
function detailHref(prospectId, personId, fallbackHref, meta) {
  const internalHref = personHref(prospectId, personId, meta);
  if (internalHref) {
    return internalHref;
  }
  return fallbackHref ? withReturn(fallbackHref, meta) : undefined;
}

/**
 * @param {import("../core/build-operator-view.js").OperatorNextMove | null} nm
 * @param {{ interactive?: boolean }} [meta]
 */
function renderNextMove(nm, meta = {}) {
  if (!nm) {
    return card({
      stakes: "high",
      className: "next-move",
      children:
        `<div class="nm-flag">${iconSvg("flag", 13)} NEXT MOVE</div>` +
        `<div class="row-note">No operator decision is waiting right now.</div>`,
    });
  }

  const chips = [
    nm.motionName ? stateDot(nm.motionStatus ?? "active", nm.motionName) : null,
    nm.actionStatus ? actionTag(nm.actionStatus, nm.why ?? undefined) : null,
    truthTag(nm.truth, nm.truthAt ?? null),
    nm.surface ? `<span class="surface-ref">${iconSvg("inbox", 12)}${escapeHtml(nm.surface)}</span>` : null,
  ]
    .filter(Boolean)
    .join("");

  const action = renderOperatorActionSet(
    nm.actions ?? [],
    {
      label: nm.action,
      mode: nm.actionMode,
      href: nm.actionHref,
      writer: nm.actionWriter,
      args: nm.actionArgs ?? null,
      variant: "primary",
      icon: nm.actionMode === "compose" ? "arrowR" : "check",
    },
    {
      prospectId: nm.prospectId,
      personId: nm.personId,
      size: "md",
      meta,
    },
  );

  const subjectLine = nm.subject
    ? personName(nm.subject, nm.prospectId, nm.personId, meta, "nm-title") +
      (nm.subtitle ? `<div class="nm-sub">${escapeHtml(nm.subtitle)}</div>` : "") +
      `<div class="row-summary" style="margin-top:9px">${escapeHtml(nm.title)}</div>`
    : `<div class="nm-title">${escapeHtml(nm.title)}</div>` +
      (nm.subtitle ? `<div class="nm-sub">${escapeHtml(nm.subtitle)}</div>` : "");
  const backlog = (nm.backlogCompanies ?? []).length
    ? `<div class="nm-chips">` +
      (nm.backlogCompanies ?? [])
        .map((company) => {
          const href = meta.interactive ? (company.href ?? companyHref(company.id, meta)) : null;
          const label = `${company.name}`;
          return href
            ? `<a class="surface-ref" href="${escapeAttr(href)}">${iconSvg("building", 12)}${escapeHtml(label)}</a>`
            : `<span class="surface-ref">${iconSvg("building", 12)}${escapeHtml(label)}</span>`;
        })
        .join("") +
      `</div>`
    : "";

  return card({
    stakes: "high",
    className: "next-move",
    children:
      `<div class="nm-flag">${iconSvg("flag", 13)} NEXT MOVE</div>` +
      `<div class="nm-body">` +
      avatar({ src: nm.avatarUrl, name: nm.subject ?? "Next move", initials: nm.subject ? initials(nm.subject) : "NM", size: 48, accent: "#3b82f6" }) +
      `<div class="nm-main">` +
      subjectLine +
      (nm.why ? `<div class="row-note">${escapeHtml(nm.why)}</div>` : "") +
      renderPreview(nm.previewLabel, nm.previewSubject, nm.previewText) +
      (chips ? `<div class="nm-chips">${chips}</div>` : "") +
      backlog +
      `</div>` +
      `<div class="nm-actions">${action}</div>` +
      `</div>`,
  });
}

/**
 * @param {string} key
 * @param {string} icon
 * @param {string} title
 * @param {number | null} count
 * @param {"neutral" | "amber" | "blue" | "red" | null} tone
 * @param {string | null} sub
 * @param {string} bodyHtml
 */
function renderSection(key, icon, title, count, tone, sub, bodyHtml) {
  return (
    `<section class="op-sec" data-sec="${escapeAttr(key)}">` +
    sectionHead({
      icon,
      title,
      count: count != null ? count : null,
      countTone: (tone ?? undefined),
      sub: sub ?? null,
    }) +
    `<div class="sec-body">${bodyHtml}</div>` +
    `</section>`
  );
}

/**
 * @param {string | null | undefined} label
 * @param {string | null | undefined} subject
 * @param {string | null | undefined} text
 */
function renderPreview(label, subject, text) {
  if (!text) return "";
  return (
    `<div class="op-preview">` +
    (label ? `<div class="op-preview-cap">${escapeHtml(label)}</div>` : "") +
    (subject ? `<div class="op-preview-subject">Subject · ${escapeHtml(subject)}</div>` : "") +
    `<blockquote class="tl-message op-preview-quote" title="${escapeAttr(text)}">${escapeHtml(text)}</blockquote>` +
    `</div>`
  );
}

/**
 * @param {import("../core/build-operator-view.js").OperatorDecisionCard[]} decisions
 * @param {{ interactive?: boolean }} [meta]
 * @param {{ hasPromoted?: boolean }} [options]
 */
function renderDecisions(decisions, meta = {}, options = {}) {
  if (!decisions.length) {
    if (options.hasPromoted) {
      return emptyState({ icon: "flag", message: "The first queued action is promoted above." });
    }
    return emptyState({ icon: "check", message: "No operator work is queued right now." });
  }
  return decisions.map((d) => renderDecisionCard(d, meta)).join("");
}

/**
 * @param {import("../core/build-operator-view.js").OperatorDecisionCard} d
 * @param {{ interactive?: boolean }} [meta]
 */
function renderDecisionCard(d, meta = {}) {
  const personId = Object.prototype.hasOwnProperty.call(d, "personId")
    ? d.personId
    : d.id;
  const chips = [
    d.motionName ? stateDot("active", d.motionName) : null,
    truthTag(d.truth, d.truthAt ?? null),
    d.surface ? `<span class="surface-ref">${iconSvg("inbox", 11)}${escapeHtml(d.surface)}</span>` : null,
    ownerTag({ ownerName: d.ownerLabel ?? null }),
  ]
    .filter(Boolean)
    .join("");
  const actions = renderOperatorActionSet(
    d.actions ?? [],
    {
      label: d.primaryActionLabel,
      mode: d.primaryActionMode,
      href: d.primaryHref,
      writer: null,
      args: null,
      variant: "primary",
      icon: d.actionStatus === "due now" ? "arrowR" : "check",
    },
    {
      prospectId: d.prospectId,
      personId,
      size: "sm",
      meta,
    },
  );

  return card({
    stakes: d.stakes ?? null,
    className: "dec-card",
    children:
      `<div class="row-top">` +
      avatar({ src: d.avatarUrl, initials: d.initials, name: d.person, size: 34 }) +
      `<div class="row-id">` +
      personName(d.person, d.prospectId, personId, meta, "row-name") +
      `<div class="row-role">${escapeHtml(d.roleLine ?? [d.role, d.company].filter(Boolean).join(" · "))}</div>` +
      `</div>` +
      actionTag(d.actionStatus, d.why ?? undefined) +
      `</div>` +
      `<p class="row-summary">${escapeHtml(d.summary)}</p>` +
      (d.why ? `<div class="row-note">${escapeHtml(d.why)}</div>` : "") +
      renderPreview(d.previewLabel, d.previewSubject, d.previewText) +
      `<div class="row-chips">${chips}</div>` +
      `<div class="row-actions">${actions}</div>`,
  });
}

/**
 * @param {import("../core/build-operator-view.js").OperatorBlockedCard[]} blocked
 * @param {{ interactive?: boolean, returnTo?: string | null }} [meta]
 */
function renderBlocked(blocked, meta = {}) {
  if (!blocked.length) {
    return emptyState({ icon: "check", message: "Nothing blocked." });
  }
  return blocked.map((item) => renderBlockedCard(item, meta)).join("");
}

/**
 * @param {import("../core/build-operator-view.js").OperatorBlockedCard} b
 * @param {{ interactive?: boolean, returnTo?: string | null }} [meta]
 */
function renderBlockedCard(b, meta = {}) {
  const status =
    b.blockType === "assignment"
      ? "blocked · assignment"
      : b.blockType === "capability"
        ? "blocked · capability"
        : "failed";
  const iconName = b.blockType === "failed" ? "refresh" : b.blockType === "assignment" ? "userPlus" : "mail";
  const href = b.resolveMode === "compose"
    ? composeHref(b.prospectId, b.personId, b.resolveHref, meta)
    : b.resolveMode === "detail"
      ? (b.resolveHref ? withReturn(b.resolveHref, meta) : detailHref(b.prospectId, b.personId, b.resolveHref, meta))
      : undefined;
  // When the blocker carries typed actions (one per company that needs an owner
  // pinned), render them as live exo-writer buttons so the client dispatcher
  // can POST to /act and update governed state. Without typed actions, fall
  // back to a real link when the blocker already knows where review happens.
  // Otherwise render a disabled placeholder so the surface does not lie.
  const resolve = (b.actions ?? []).length
    ? b.actions
        .slice(0, 3)
        .map((act, idx) =>
          actionBtn({
            writer: act.writer,
            args: act.args,
            variant: idx === 0 ? "secondary" : "ghost",
            icon: iconName,
            label: act.label,
          }),
        )
        .join("")
    : href
      ? btn({ variant: "secondary", size: "sm", icon: iconName, label: b.resolveLabel, href })
      : btn({ variant: "secondary", size: "sm", icon: iconName, label: b.resolveLabel, disabled: true });

  return card({
    stakes: "block",
    className: "blk-card",
    children:
      `<div class="row-top">` +
      avatar({ initials: initials(b.subject), name: b.subject, size: 30, accent: "#ef4444" }) +
      `<div class="row-id">` +
      `<div class="row-name">${escapeHtml(b.subject)}</div>` +
      `<div class="row-role">${escapeHtml(b.channel)}</div>` +
      `</div>` +
      actionTag(status) +
      `</div>` +
      `<p class="row-summary"><strong class="blk-reason">${escapeHtml(b.reason)}.</strong> ${escapeHtml(b.detail)}</p>` +
      `<div class="row-actions">${resolve}${ownerTag({ ownerName: null })}</div>`,
  });
}

/** @param {import("../core/build-operator-view.js").OperatorStaleRow[]} stale */
function renderStale(stale) {
  if (!stale.length) {
    return emptyState({ icon: "eye", message: "All surfaces fresh." });
  }
  return (
    `<div class="stale-list">` +
    stale
      .map(
        (s) =>
          `<div class="stale-row">` +
          iconSvg("eye", 15, "stale-ic") +
          `<div class="stale-main">` +
          `<div class="stale-top">` +
          `<span class="stale-subject">${escapeHtml(s.subject)}</span>` +
          truthTag(s.truth, s.lastChecked ?? null) +
          `</div>` +
          `<p class="stale-detail">${escapeHtml(s.detail)}</p>` +
          `</div>` +
          `<span class="surface-ref">${iconSvg("cpu", 11)}Handled by agent queue</span>` +
          `</div>`,
      )
      .join("") +
    `</div>`
  );
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
 * Wrap a button in a live `[data-exo-args]` host so the shared client
 * dispatcher (EXO_CLIENT_JS) POSTs the typed intent to /act on click.
 * Mirrors the helper in render-connections.js so blockers can fire writers
 * without duplicating dispatcher logic.
 *
 * @param {{ writer: string, args: Record<string, any>, variant: "primary" | "secondary" | "ghost" | "danger", label: string, icon?: string }} opts
 */
function actionBtn(opts) {
  const inner =
    `<button class="btn btn-${opts.variant} btn-sm" type="button">` +
    (opts.icon ? iconSvg(opts.icon, 14) : "") +
    `<span>${escapeHtml(opts.label)}</span></button>`;
  return `<span class="exo-action exo-action-flat" data-exo-writer="${escapeAttr(opts.writer)}" data-exo-args="${escapeAttr(JSON.stringify(opts.args))}">${inner}</span>`;
}

/**
 * @param {Array<{
 *   label: string,
 *   mode: "compose" | "detail",
 *   href: string | null,
 *   writer: string | null,
 *   args: Record<string, any> | null,
 *   variant: "primary" | "secondary" | "ghost" | "danger",
 *   icon: string | null,
 *   fields?: Array<{ name: string, argKey?: string, placeholder?: string, required?: boolean }>
 * }>} actions
 * @param {{
 *   label: string,
 *   mode: "compose" | "detail",
 *   href: string | null,
 *   writer: string | null,
 *   args: Record<string, any> | null,
 *   variant: "primary" | "secondary" | "ghost" | "danger",
 *   icon: string | null,
 *   fields?: Array<{ name: string, argKey?: string, placeholder?: string, required?: boolean }>
 * }} fallback
 * @param {{
 *   prospectId: string | null | undefined,
 *   personId: string | null | undefined,
 *   size: "sm" | "md",
 *   meta: { interactive?: boolean, returnTo?: string | null }
 * }} context
 */
function renderOperatorActionSet(actions, fallback, context) {
  const usable = Array.isArray(actions) ? actions.filter(Boolean) : [];
  if (usable.length > 0) {
    return usable.map((action) => renderOperatorAction(action, context)).join("");
  }
  return renderOperatorAction(fallback, context);
}

/**
 * @param {{
 *   label: string,
 *   mode: "compose" | "detail",
 *   href: string | null,
 *   writer: string | null,
 *   args: Record<string, any> | null,
 *   variant: "primary" | "secondary" | "ghost" | "danger",
 *   icon: string | null,
 *   fields?: Array<{ name: string, argKey?: string, placeholder?: string, required?: boolean }>
 * }} action
 * @param {{
 *   prospectId: string | null | undefined,
 *   personId: string | null | undefined,
 *   size: "sm" | "md",
 *   meta: { interactive?: boolean, returnTo?: string | null }
 * }} context
 */
function renderOperatorAction(action, context) {
  if (action.writer) {
    const fields = renderActionFields(action.fields);
    const fieldSpec = buildActionFieldSpec(action.fields);
    const inner =
      fields +
      `<button class="btn btn-${escapeAttr(action.variant)} btn-${escapeAttr(context.size)}" type="button">` +
      (action.icon ? iconSvg(action.icon, context.size === "sm" ? 14 : 16) : "") +
      `<span>${escapeHtml(action.label)}</span></button>`;
    const fieldAttr = fieldSpec ? ` data-exo-fields="${escapeAttr(fieldSpec)}"` : "";
    return (
      `<span class="exo-action exo-action-flat exo-action-inline" data-exo-writer="${escapeAttr(action.writer)}"` +
      ` data-exo-args="${escapeAttr(JSON.stringify(action.args ?? {}))}"${fieldAttr}>${inner}</span>`
    );
  }
  const href = action.mode === "compose"
    ? composeHref(context.prospectId, context.personId, action.href, context.meta)
    : detailHref(context.prospectId, context.personId, action.href, context.meta);
  return btn({
    variant: action.variant,
    size: context.size,
    icon: action.icon ?? undefined,
    label: action.label,
    href,
  });
}

/**
 * @param {Array<{ name: string, argKey?: string, placeholder?: string, required?: boolean }> | undefined} fields
 */
function renderActionFields(fields) {
  if (!fields?.length) return "";
  return fields
    .map((field) =>
      `<input class="compose-input exo-action-input" name="${escapeAttr(field.name)}"` +
      ` placeholder="${escapeAttr(field.placeholder ?? field.argKey ?? field.name)}" autocomplete="off" />`
    )
    .join("");
}

/**
 * @param {Array<{ name: string, argKey?: string, required?: boolean }> | undefined} fields
 */
function buildActionFieldSpec(fields) {
  if (!fields?.length) return "";
  return fields
    .map((field) => `${field.name}:${field.argKey ?? field.name}${field.required === false ? "?" : ""}`)
    .join(",");
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
