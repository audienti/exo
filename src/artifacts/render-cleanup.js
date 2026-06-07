// @ts-check

import {
  avatar,
  btn,
  card,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  ownerTag,
  renderShell,
  sectionHead,
  truthTag,
} from "../lib/exo-ui-components.js";

/**
 * @param {ReturnType<import("../core/build-cleanup-view.js").buildCleanupViewModel>} model
 * @param {{ interactive?: boolean, returnTo?: string | null, agentRuntime?: any }} [meta]
 */
export function renderCleanupPage(model, meta = {}) {
  const body =
    `<div class="op-wrap feed">` +
    renderIntro(model) +
    renderSection(
      "cleanup",
      "clock",
      "Old claim backlog",
      model.counts.itemCount,
      "amber",
      `older than ${model.policy.minAgeDays} days`,
      renderItems(model.items, meta),
    ) +
    renderFooter(model) +
    `</div>`;

  return renderShell({
    title: `Exo — Clean up · ${model.user.label}`,
    activeId: "cleanup",
    sectionLabel: "Clean up",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    agentRuntime: meta.agentRuntime ?? model.agentRuntime ?? null,
  });
}

/** @param {ReturnType<import("../core/build-cleanup-view.js").buildCleanupViewModel>} model */
function renderIntro(model) {
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Clean up</h1>` +
    `<p class="op-line">Old global-intake claim decisions live here so current operator work does not get buried under stale backlog.</p>` +
    `</div>` +
    `<div class="op-stat">` +
    `<span><b>${model.counts.itemCount}</b> stale claim items</span>` +
    (model.counts.oldestAgeDays != null ? `<i></i><span><b>${model.counts.oldestAgeDays}d</b> oldest</span>` : "") +
    `</div>` +
    `</div>`
  );
}

/**
 * @param {string} key
 * @param {string} icon
 * @param {string} title
 * @param {number} count
 * @param {"neutral" | "amber" | "blue" | "red"} tone
 * @param {string | null} sub
 * @param {string} bodyHtml
 */
function renderSection(key, icon, title, count, tone, sub, bodyHtml) {
  return (
    `<section class="op-sec" data-sec="${escapeAttr(key)}">` +
    sectionHead({ icon, title, count, countTone: tone, sub }) +
    `<div class="sec-body">${bodyHtml}</div>` +
    `</section>`
  );
}

/**
 * @param {ReturnType<import("../core/build-cleanup-view.js").buildCleanupViewModel>["items"]} items
 * @param {{ interactive?: boolean, returnTo?: string | null }} meta
 */
function renderItems(items, meta) {
  if (!items.length) {
    return emptyState({ icon: "check", message: "No stale global-intake cleanup is waiting." });
  }
  return items.map((item) => renderItemCard(item, meta)).join("");
}

/**
 * @param {ReturnType<import("../core/build-cleanup-view.js").buildCleanupViewModel>["items"][number]} item
 * @param {{ interactive?: boolean, returnTo?: string | null }} meta
 */
function renderItemCard(item, meta) {
  const chips = [
    truthTag(item.truth, relativeFromIso(item.truthAt)),
    item.surface ? `<span class="surface-ref">${iconSvg("inbox", 11)}${escapeHtml(item.surface)}</span>` : null,
    `<span class="surface-ref">${iconSvg("clock", 11)}${escapeHtml(`${item.ageDays}d old`)}</span>`,
    ownerTag({ ownerName: null }),
  ]
    .filter(Boolean)
    .join("");

  return card({
    stakes: item.stakes ?? null,
    className: "dec-card",
    children:
      `<div class="row-top">` +
      avatar({ src: item.avatarUrl, initials: item.initials, name: item.person, size: 34 }) +
      `<div class="row-id">` +
      personName(item.person, item.prospectId, item.id, meta, "row-name") +
      `<div class="row-role">${escapeHtml(item.roleLine ?? "")}</div>` +
      `</div>` +
      `<span class="count-chip tone-amber">${escapeHtml(`${item.ageDays}d`)}</span>` +
      `</div>` +
      `<p class="row-summary">${escapeHtml(item.summary)}</p>` +
      renderPreview(item.previewLabel, item.previewSubject, item.previewText) +
      `<div class="row-chips">${chips}</div>` +
      `<div class="row-actions">` +
      (meta.interactive ? renderIgnoreButton(item) : "") +
      btn({
        variant: "primary",
        icon: "arrowR",
        label: item.primaryActionLabel,
        href: personHref(item.prospectId, item.id, meta) ?? item.primaryHref ?? undefined,
      }) +
      `</div>`,
  });
}

/**
 * @param {ReturnType<import("../core/build-cleanup-view.js").buildCleanupViewModel>["items"][number]} item
 */
function renderIgnoreButton(item) {
  const args = JSON.stringify({
    observationId: item.id,
    reason: "Operator rejected this inbound solicitation and wants future mail from the sender ignored.",
  });
  const inner = btn({ variant: "danger", size: "sm", icon: "x", label: "Ignore sender" });
  return `<span data-exo-writer="ignoreInboundObservation" data-exo-args="${escapeAttr(args)}" data-exo-return="1">${inner}</span>`;
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
 * @param {string} name
 * @param {string | null | undefined} prospectId
 * @param {string | null | undefined} personId
 * @param {{ interactive?: boolean, returnTo?: string | null }} meta
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
 * @param {{ interactive?: boolean, returnTo?: string | null }} meta
 */
function personHref(prospectId, personId, meta) {
  if (!meta.interactive) return null;
  if (prospectId) return withReturn(`/prospects/${encodeURIComponent(prospectId)}`, meta);
  if (personId) return withReturn(`/people/${encodeURIComponent(personId)}`, meta);
  return null;
}

/**
 * @param {string} href
 * @param {{ interactive?: boolean, returnTo?: string | null }} meta
 */
function withReturn(href, meta) {
  if (!meta.interactive) return href;
  const returnTo = meta.returnTo ?? "/cleanup";
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

/** @param {string | null | undefined} iso */
function relativeFromIso(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const diff = Date.now() - target.getTime();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) return `${Math.round(abs / minute)}m ago`;
  if (abs < day) return `${Math.round(abs / hour)}h ago`;
  return `${Math.round(abs / day)}d ago`;
}

/** @param {ReturnType<import("../core/build-cleanup-view.js").buildCleanupViewModel>} model */
function renderFooter(model) {
  const stamp = new Date(model.generatedAt).toISOString();
  return (
    `<div class="gen-footer">` +
    `Generated ${escapeHtml(stamp)} · regenerate with <code>${escapeHtml(model.regenerateCommand)}</code>` +
    `</div>`
  );
}
