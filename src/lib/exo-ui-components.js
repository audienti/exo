// @ts-check
//
// Exo UI — shared HTML/CSS primitives.
//
// Recreated from the Exo Build Spec design tokens. Three-axis status system
// (state / truth / action) stays visually distinct from real buttons. Helpers
// are plain string-template functions so other view renderers (Motions,
// Prospects, etc.) can reuse them without a JS runtime.

import { listActiveBrowserBackoffs } from "./agent-host-state.js";

/** @param {string | number | null | undefined} value */
export function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** @param {string | null | undefined} value */
export function escapeAttr(value) {
  return escapeHtml(value);
}

/**
 * @param {string | null | undefined} iso
 * @param {Date | string | null | undefined} [now]
 * @returns {string | null}
 */
export function formatRelative(iso, now) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const nowDate = now instanceof Date ? now : now ? new Date(now) : new Date();
  const diffMs = nowDate.getTime() - target.getTime();
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return past ? "just now" : "in <1m";
  if (abs < hour) {
    const m = Math.round(abs / minute);
    return past ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < day) {
    const h = Math.round(abs / hour);
    return past ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.round(abs / day);
  return past ? `${d}d ago` : `in ${d}d`;
}

// ---------------------------------------------------------------------------
// Icons — single-path SVG glyphs, stroke 1.7. Only the glyphs used by the
// current views are listed; add more on demand.
// ---------------------------------------------------------------------------
export const ICONS = {
  home: "M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",
  chevron: "m6 9 6 6 6-6",
  chevronR: "m9 6 6 6-6 6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm6 13 4 4",
  spark: "M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6Z",
  check: "m5 12 5 5 9-11",
  x: "M6 6l12 12M18 6 6 18",
  arrowR: "M5 12h14m-6-6 6 6-6 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3.5 2",
  userPlus: "M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m9-4v6m3-3h-6",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  linkedin: "M5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM4 9h2v11H4zM9 9h2v1.6c.4-.8 1.4-1.8 3-1.8 2.4 0 3 1.6 3 4V20h-2v-5c0-1.4-.5-2.2-1.7-2.2S11 13.8 11 15.2V20H9z",
  alert: "M12 4 2 20h20L12 4Zm0 6v5m0 3h.01",
  refresh: "M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.7L4 16m0 4v-4h4",
  cpu: "M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 7h10v10H7zM10 10h4v4h-4z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  flag: "M5 21V4h11l-2 4 2 4H5",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5",
  users: "M16 19a5 5 0 0 0-10 0M11 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m6 1a3 3 0 0 0 0-6m4 11a4.5 4.5 0 0 0-3.5-4.4",
  link: "M9 15l6-6m-4-3 1-1a4 4 0 0 1 6 6l-1 1m-8 8-1 1a4 4 0 0 1-6-6l1-1",
  activity: "M3 12h4l3 8 4-16 3 8h4",
  inbox: "M3 13h5l2 3h4l2-3h5M3 13l3-9h12l3 9v7H3z",
  building: "M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M15 9h3a1 1 0 0 1 1 1v11M8 7h2M8 11h2M8 15h2",
  queue: "M4 6h16M4 12h12M4 18h8",
  phone: "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2Z",
  bot: "M12 2v2M7 7h10a2 2 0 0 1 2 2v7a3 3 0 0 1-3 3h-1v3h-2v-3H9v3H7v-3H6a3 3 0 0 1-3-3V9a2 2 0 0 1 2-2Zm1 4h.01M15 11h.01M9 15h6",
  sliders: "M4 6h6m4 0h6M10 6a2 2 0 1 1 4 0 2 2 0 0 1-4 0ZM4 12h2m4 0h10M6 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0ZM4 18h10m4 0h2M14 18a2 2 0 1 1 4 0 2 2 0 0 1-4 0",
};

/**
 * @param {string} name
 * @param {number} [size]
 * @param {string} [className]
 */
export function iconSvg(name, size = 16, className = "") {
  const path = ICONS[/** @type {keyof typeof ICONS} */ (name)] ?? "";
  return (
    `<svg class="ic ${escapeAttr(className)}" width="${size}" height="${size}" viewBox="0 0 24 24"` +
    ` fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${path}"/></svg>`
  );
}

/**
 * @param {{ src?: string | null, initials?: string | null, name?: string | null, size?: number, accent?: string }} opts
 */
export function avatar(opts) {
  const size = opts.size ?? 32;
  const fontSize = Math.round(size * 0.38);
  if (opts.src) {
    return `<img class="avatar" src="${escapeAttr(opts.src)}" alt="${escapeAttr(opts.name ?? "")}" width="${size}" height="${size}" style="width:${size}px;height:${size}px"/>`;
  }
  const initials =
    opts.initials ??
    (opts.name
      ? opts.name
          .split(/\s+/)
          .map((word) => word[0] ?? "")
          .slice(0, 2)
          .join("")
      : "?");
  const accent = opts.accent ?? "#3f3f46";
  return (
    `<span class="avatar avatar-ini" style="width:${size}px;height:${size}px;font-size:${fontSize}px;background:${escapeAttr(accent)}">` +
    `${escapeHtml(initials.toUpperCase())}</span>`
  );
}

// ---------------------------------------------------------------------------
// Inert status primitives — never look pressable.
// ---------------------------------------------------------------------------

const STATE_META = {
  draft: ["#71717a", "draft"],
  active: ["#3b82f6", "active"],
  paused: ["#f59e0b", "paused"],
  archived: ["#52525b", "archived"],
  ready: ["#22c55e", "ready"],
  waiting: ["#94a3b8", "waiting"],
  blocked: ["#ef4444", "blocked"],
  identified: ["#38bdf8", "identified"],
  "pre-connect": ["#a78bfa", "pre-connect"],
  "connection-requested": ["#818cf8", "requested"],
  connected: ["#22c55e", "connected"],
  "reply-accepted": ["#22c55e", "conversation"],
};

/**
 * @param {string} state
 * @param {string} [label]
 */
export function stateDot(state, label) {
  const [color, fallbackLabel] = STATE_META[/** @type {keyof typeof STATE_META} */ (state)] ?? [
    "#71717a",
    state,
  ];
  return `<span class="state-dot"><i style="background:${color}"></i>${escapeHtml(label ?? fallbackLabel)}</span>`;
}

const TRUTH_META = {
  checked: ["#22c55e", "CHECKED"],
  partial: ["#f59e0b", "PARTIAL"],
  unchecked: ["#71717a", "UNCHECKED"],
  failed: ["#ef4444", "FAILED"],
  transition: ["#38bdf8", "TRANSITION"],
  quiet: ["#64748b", "QUIET"],
};

/**
 * @param {string} truth
 * @param {string | null} [at]
 */
export function truthTag(truth, at) {
  const [color, label] = TRUTH_META[/** @type {keyof typeof TRUTH_META} */ (truth)] ?? [
    "#71717a",
    String(truth).toUpperCase(),
  ];
  return (
    `<span class="truth-tag" title="Truth: ${escapeAttr(label.toLowerCase())}${at ? ` · ${escapeAttr(at)}` : ""}">` +
    `<i style="background:${color}"></i>${escapeHtml(label)}` +
    (at ? `<em>· ${escapeHtml(at)}</em>` : "") +
    `</span>`
  );
}

const ACTION_META = {
  "due now": "#3b82f6",
  "needs decision": "#f59e0b",
  waiting: "#94a3b8",
  "blocked · assignment": "#ef4444",
  "blocked · capability": "#ef4444",
  reconciliation: "#f59e0b",
  failed: "#ef4444",
};

/**
 * @param {string} status
 * @param {string | null | undefined} [title]
 */
export function actionTag(status, title) {
  const color = ACTION_META[/** @type {keyof typeof ACTION_META} */ (status)] ?? "#94a3b8";
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  return `<span class="action-tag" style="--am:${color}"${titleAttr}>${escapeHtml(status)}</span>`;
}

/**
 * @param {number} n
 * @param {"neutral" | "amber" | "blue" | "red"} [tone]
 * @param {string} [label]
 */
export function countChip(n, tone = "neutral", label) {
  return (
    `<span class="count-chip tone-${tone}">${escapeHtml(n)}` +
    (label ? `<em>${escapeHtml(label)}</em>` : "") +
    `</span>`
  );
}

// ---------------------------------------------------------------------------
// Real buttons & cards.
// ---------------------------------------------------------------------------

/**
 * @param {{ variant?: "primary" | "secondary" | "ghost" | "danger", size?: "sm" | "md", icon?: string, label: string, href?: string | null, disabled?: boolean, title?: string }} opts
 */
export function btn(opts) {
  const variant = opts.variant ?? "secondary";
  const size = opts.size ?? "md";
  const iconHtml = opts.icon ? iconSvg(opts.icon, size === "sm" ? 14 : 16) : "";
  const titleAttr = opts.title ? ` title="${escapeAttr(opts.title)}"` : "";
  const inner = `${iconHtml}<span>${escapeHtml(opts.label)}</span>`;
  if (opts.href) {
    return (
      `<a class="btn btn-${variant} btn-${size}" href="${escapeAttr(opts.href)}"${titleAttr}` +
      (opts.href.startsWith("http") ? ` target="_blank" rel="noreferrer"` : "") +
      `>${inner}</a>`
    );
  }
  return (
    `<button class="btn btn-${variant} btn-${size}" type="button"${opts.disabled ? " disabled" : ""}${titleAttr}>` +
    `${inner}</button>`
  );
}

/**
 * @param {{ label?: string | null, lead: string, detail?: string | null, meta?: string | null, className?: string | null }} opts
 */
export function renderNextMoveAlert(opts) {
  const label = normalizeUiText(opts.label) ?? "Next move";
  const lead = sentenceUiText(opts.lead);
  const detail = normalizeUiText(opts.detail);
  const meta = normalizeUiText(opts.meta);
  const cls = opts.className ? ` ${escapeAttr(opts.className)}` : "";
  return (
    `<div class="next-alert${cls}">` +
    iconSvg("flag", 14) +
    `<span class="next-alert-copy">` +
    `<span class="next-alert-label">${escapeHtml(label)}</span>` +
    `<strong>${escapeHtml(lead)}</strong>` +
    (detail ? `<span>${escapeHtml(sentenceUiText(detail))}</span>` : "") +
    (meta ? `<span class="next-alert-meta">${escapeHtml(meta)}</span>` : "") +
    `</span>` +
    `</div>`
  );
}

/**
 * Wrap a button in a live action host the shared client dispatcher POSTs to /act.
 * @param {{ writer: string, args: Record<string, any>, variant?: "primary" | "secondary" | "ghost" | "danger", size?: "sm" | "md", label: string, icon?: string, title?: string, className?: string }} opts
 */
export function liveActionBtn(opts) {
  const inner = btn({
    variant: opts.variant ?? "secondary",
    size: opts.size ?? "sm",
    icon: opts.icon,
    label: opts.label,
    title: opts.title,
  });
  const className = ["exo-action", "exo-action-flat", opts.className].filter(Boolean).join(" ");
  return `<span class="${escapeAttr(className)}" data-exo-writer="${escapeAttr(opts.writer)}" data-exo-args="${escapeAttr(JSON.stringify(opts.args))}">${inner}</span>`;
}

/**
 * @param {{ stakes?: "high" | "block" | "medium" | null, className?: string, children: string }} opts
 */
export function card(opts) {
  const stakes = opts.stakes ? ` stakes-${opts.stakes}` : "";
  const cls = opts.className ? ` ${opts.className}` : "";
  return `<div class="card${stakes}${cls}">${opts.children}</div>`;
}

/**
 * @param {{ icon?: string | null, title: string, count?: number | null, countTone?: "neutral" | "amber" | "blue" | "red", sub?: string | null, right?: string | null }} opts
 */
export function sectionHead(opts) {
  return (
    `<div class="sec-head">` +
    (opts.icon ? iconSvg(opts.icon, 16, "sec-ic") : "") +
    `<h2>${escapeHtml(opts.title)}</h2>` +
    (typeof opts.count === "number" ? countChip(opts.count, opts.countTone ?? "neutral") : "") +
    (opts.sub ? `<span class="sec-sub">${escapeHtml(opts.sub)}</span>` : "") +
    (opts.right ? `<div class="sec-right">${opts.right}</div>` : "") +
    `</div>`
  );
}

/**
 * @param {{ ownerName?: string | null, initials?: string | null, avatarUrl?: string | null, accent?: string }} opts
 */
export function ownerTag(opts) {
  if (!opts.ownerName) {
    return (
      `<span class="owner-tag unassigned">` +
      avatar({ initials: "U", size: 18, accent: "#3f3f46" }) +
      `Unassigned</span>`
    );
  }
  return (
    `<span class="owner-tag">` +
    avatar({
      src: opts.avatarUrl ?? null,
      initials: opts.initials ?? null,
      name: opts.ownerName,
      size: 18,
      accent: opts.accent ?? "#3b82f6",
    }) +
    `${escapeHtml(opts.ownerName)}</span>`
  );
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeUiText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function sentenceUiText(value) {
  const normalized = normalizeUiText(value) ?? "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

/** @param {{ icon: string, message: string }} opts */
export function emptyState(opts) {
  return `<div class="empty-state">${iconSvg(opts.icon, 18)}<span>${escapeHtml(opts.message)}</span></div>`;
}

const SCOPE_META = {
  company: ["building", "Company-level"],
  person: ["users", "Person-level"],
  both: ["layers", "Company + person"],
};

/** @param {string} scope */
export function scopeBadge(scope) {
  const [icon, label] = SCOPE_META[/** @type {keyof typeof SCOPE_META} */ (scope)] ?? ["layers", scope];
  return `<span class="scope-badge scope-${escapeAttr(scope)}">${iconSvg(icon, 11)}${escapeHtml(label)}</span>`;
}

const FIT_META = {
  high: ["#22c55e", "High"],
  moderate: ["#f59e0b", "Moderate"],
  low: ["#f59e0b", "Low"],
  "no-fit": ["#ef4444", "No fit"],
};

/** @param {string} fit */
export function fitChip(fit) {
  const [color, label] = FIT_META[/** @type {keyof typeof FIT_META} */ (fit)] ?? ["#71717a", fit];
  return `<span class="fit-chip" style="--fc:${color}">${iconSvg("target", 11)}${escapeHtml(label)}</span>`;
}

/**
 * @param {number} value 0..1 readiness fraction
 * @param {string} [extraClass]
 */
export function readinessBar(value, extraClass = "") {
  const clamped = Math.max(0, Math.min(1, value));
  const color = clamped >= 0.75 ? "#22c55e" : clamped >= 0.5 ? "#f59e0b" : "#ef4444";
  return `<span class="ready-bar ${escapeAttr(extraClass)}"><i style="width:${Math.round(clamped * 100)}%;background:${color}"></i></span>`;
}

// ---------------------------------------------------------------------------
// Page chrome (left nav + topbar). Pass the active nav id to highlight.
// ---------------------------------------------------------------------------

export const PRIMARY_NAV = [
  { id: "operator", label: "Operator", icon: "flag" },
  { id: "motions", label: "Motions", icon: "layers" },
  { id: "prospects", label: "Prospects", icon: "users" },
  { id: "execution", label: "Users", icon: "cpu" },
  { id: "connections", label: "Connections", icon: "link" },
  { id: "workspace", label: "Workspace", icon: "activity" },
  { id: "settings", label: "Settings", icon: "sliders", bottom: true },
  { id: "cleanup", label: "Clean up", icon: "spark", bottom: true },
  // Agent queue sits at the bottom of the rail so operators can scan what the
  // agent is about to run without it crowding the decision-driven Operator view.
  { id: "queue", label: "Agent queue", icon: "queue", bottom: true },
];

/** nav id → interactive route */
export const NAV_ROUTES = {
  operator: "/operator",
  motions: "/motions",
  prospects: "/prospects",
  execution: "/users",
  connections: "/connections",
  workspace: "/workspace",
  settings: "/settings",
  cleanup: "/cleanup",
  queue: "/queue",
};

// The Audienti mark (arrow-fletching). Inline so the UI is self-contained.
export const AUDIENTI_MARK_SVG =
  `<svg class="brand-svg" viewBox="0 12 182 190" fill="none" aria-hidden="true">` +
  `<path d="M53.6973 119.5H172.339C175.963 119.5 178.469 120.776 179.667 122.712C180.861 124.642 180.853 127.386 179.106 130.544V130.545L146.94 188.972C145.192 192.136 142.112 195.023 138.534 197.121C134.956 199.219 130.925 200.5 127.303 200.5H8.66211C5.03732 200.5 2.53091 199.225 1.33301 197.29C0.138985 195.361 0.147348 192.616 1.89355 189.456V189.455L34.0625 131.027L34.0635 131.028C35.8104 127.866 38.888 124.978 42.4658 122.88C46.0435 120.782 50.0746 119.5 53.6973 119.5Z" fill="#DB2C5D"/>` +
  `<path opacity="0.8" d="M8.37012 79.5H127.433C131.114 79.5 135.779 80.301 140.303 81.6055C144.827 82.9102 149.169 84.7065 152.213 86.6709L174.682 101.169C176.207 102.153 177.25 103.07 177.858 103.872C178.472 104.682 178.584 105.291 178.446 105.723C178.306 106.16 177.848 106.612 176.857 106.957C175.878 107.299 174.471 107.5 172.627 107.5H53.5684C49.8849 107.5 45.2198 106.699 40.6963 105.395C36.1719 104.09 31.8312 102.294 28.7871 100.329L6.31934 85.8311C4.7942 84.8468 3.75004 83.9301 3.1416 83.1279C2.52761 82.3184 2.41489 81.7088 2.55273 81.2773C2.6924 80.8403 3.15107 80.3885 4.1416 80.043C5.12068 79.7014 6.52704 79.5 8.37012 79.5Z" fill="#DB2C5D"/>` +
  `<path d="M8.65039 13.5H127.131C130.75 13.5001 134.775 14.7674 138.349 16.8418C141.922 18.9166 144.997 21.772 146.742 24.8975V24.8965L178.865 82.665V82.666C179.753 84.2564 180.254 85.5347 180.429 86.4922C180.607 87.4672 180.428 87.9767 180.157 88.2197C179.876 88.4725 179.306 88.6123 178.29 88.3867C177.296 88.1661 175.997 87.6203 174.412 86.7031L153.351 74.3105H153.352C150.084 72.2948 145.601 70.5447 141.012 69.2979C136.421 68.0507 131.684 67.2969 127.9 67.2969H127.4V67.542H39.2324C35.6136 67.5419 31.5874 66.2753 28.0146 64.2012C24.4416 62.1269 21.3689 59.2723 19.625 56.1455V56.1445L1.89062 24.4092C0.147738 21.2886 0.140808 18.5792 1.33105 16.6748C2.52624 14.7625 5.02855 13.5 8.65039 13.5Z" fill="#DB2C5D"/>` +
  `</svg>`;
const EXO_FAVICON_SVG = AUDIENTI_MARK_SVG
  .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')
  .replace(' class="brand-svg"', "")
  .replace(' aria-hidden="true"', "");
const EXO_FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(EXO_FAVICON_SVG)}`;

/**
 * @param {{ activeId: string, interactive?: boolean, nav?: { showCleanup?: boolean } | null }} opts
 */
export function navAside({ activeId, interactive, nav = null }) {
  /** @param {{ id: string, label: string, icon: string }} item */
  const renderItem = (item) => {
    const cls = item.id === activeId ? "nav-item active" : "nav-item";
    const inner = `${iconSvg(item.icon, 17)}<span>${escapeHtml(item.label)}</span>`;
    if (interactive) {
      return `<a class="${cls}" href="${escapeAttr(NAV_ROUTES[item.id] ?? "/")}" title="${escapeAttr(item.label)}">${inner}</a>`;
    }
    return `<button class="${cls}" type="button" title="${escapeAttr(item.label)}">${inner}</button>`;
  };
  const showCleanup = nav?.showCleanup !== false;
  const items = PRIMARY_NAV.filter((item) => showCleanup || item.id !== "cleanup");
  const topItems = items.filter((item) => !item.bottom).map(renderItem).join("");
  const bottomItems = items.filter((item) => item.bottom).map(renderItem).join("");
  const collapse = interactive
    ? `<button class="nav-collapse" type="button" title="Collapse sidebar" aria-label="Collapse sidebar">${iconSvg("chevronR", 15)}</button>`
    : "";
  return (
    `<aside class="nav">` +
    `<div class="nav-brand">` +
    `<span class="brand-mark">${AUDIENTI_MARK_SVG}</span>` +
    `<span class="brand-name">exo</span>` +
    collapse +
    `</div>` +
    topItems +
    `<div class="nav-spacer"></div>` +
    bottomItems +
    `</aside>`
  );
}

// Vanilla client that turns any `[data-exo-args]` host into a live Exo write:
// POST the typed intent to /act, run the idle→busy→done lifecycle, toast the
// result, and reload so the surface reflects the new governed state.
export const EXO_CLIENT_JS = `
(function(){
  function toast(msg, ok){
    var wrap = document.getElementById('exo-toasts');
    if(!wrap){ wrap = document.createElement('div'); wrap.id='exo-toasts'; document.body.appendChild(wrap); }
    var t = document.createElement('div');
    t.className = 'exo-toast ' + (ok ? 'ok' : 'err');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function(){ t.classList.add('leaving'); setTimeout(function(){ t.remove(); }, 300); }, 3200);
  }
  document.addEventListener('click', async function(e){
    var host = e.target.closest('[data-exo-args]');
    if(!host) return;
    var btn = e.target.closest('button');
    if (!btn) return;
    e.preventDefault();
    var writer = host.getAttribute('data-exo-writer');
    var args;
    try { args = JSON.parse(host.getAttribute('data-exo-args')); } catch(_) { return; }
    // Compose actions: read the (possibly edited) subject/body from the panel.
    if (host.hasAttribute('data-exo-compose')) {
      var panel = host.closest('.compose-panel') || document.getElementById(host.getAttribute('data-exo-compose'));
      if (panel) {
        var bodyEl = panel.querySelector('textarea[name=body]');
        var subjEl = panel.querySelector('input[name=subject]');
        if (bodyEl) args.body = bodyEl.value;
        if (subjEl) args.subject = subjEl.value;
      }
    }
    // Radio-pick actions (re-home, add-to-motion): read the selected option.
    // data-exo-radio="inputName:argKey"
    if (host.hasAttribute('data-exo-radio')) {
      var spec = String(host.getAttribute('data-exo-radio')).split(':');
      var rpanel = host.closest('.compose-panel');
      var picked = rpanel && rpanel.querySelector('input[name=' + spec[0] + ']:checked');
      if (!picked) { toast('Pick an option first.', false); return; }
      args[spec[1]] = picked.value;
    }
    // Inline field actions can ask the client to lift one or more input values
    // into the typed action args.
    // data-exo-fields="inputName:argKey,otherName:otherArg"
    if (host.hasAttribute('data-exo-fields')) {
      var fieldSpecs = String(host.getAttribute('data-exo-fields') || '').split(',');
      for (var i = 0; i < fieldSpecs.length; i += 1) {
        var rawSpec = fieldSpecs[i].trim();
        if (!rawSpec) continue;
        var required = true;
        if (rawSpec.endsWith('?')) {
          required = false;
          rawSpec = rawSpec.slice(0, -1);
        }
        var parts = rawSpec.split(':');
        var fieldName = parts[0];
        var argKey = parts[1] || fieldName;
        var field = host.querySelector('[name="' + fieldName.replace(/"/g, '\\"') + '"]');
        if (!field) continue;
        var value = typeof field.value === 'string' ? field.value.trim() : field.value;
        if (!value) {
          if (required) {
            toast('Enter ' + argKey.replace(/[_-]+/g, ' ') + ' first.', false);
            return;
          }
          continue;
        }
        args[argKey] = value;
      }
    }
    var span = btn ? btn.querySelector('span') : null;
    var prev = span ? span.textContent : '';
    if(btn){ btn.disabled = true; btn.classList.add('btn-busy'); if(span) span.textContent = 'Working…'; }
    try {
      var res;
      try {
        res = await fetch('/act', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ writer: writer, args: args }) });
      } catch (netErr) {
        // fetch() only rejects on network failure — most often the local exo
        // ui server has died. Distinguish from action errors so the operator
        // knows it's an infrastructure problem, not a bad input.
        throw new Error('Exo UI server unreachable — is the exo ui process still running?');
      }
      var data = await res.json().catch(function(){ return {}; });
      if(!res.ok || !data.ok){ throw new Error(data.error || 'Action failed'); }
      if(btn){ btn.classList.remove('btn-busy'); btn.classList.add('btn-done'); if(span) span.textContent = 'Done'; }
      try { sessionStorage.setItem('exo-flash', data.message || 'Done'); } catch(_){}
      toast(data.message || 'Done', true);
      // Some detail-page actions need to route back to the originating operator
      // surface after they mutate state, so the next item can surface without
      // leaving the operator stranded on a dead-end detail page.
      var isCompose = host.hasAttribute('data-exo-compose');
      var wantsReturn = isCompose || host.hasAttribute('data-exo-return');
      setTimeout(function(){
        if (data && data.redirect) {
          location.assign(data.redirect);
          return;
        }
        var ret = null;
        try { if (wantsReturn) ret = new URLSearchParams(location.search).get('return'); } catch(_){}
        if (ret) { location.assign(ret); return; }
        // Drop any open slide-over (the #panel hash) before reloading, so a
        // :target compose/context panel closes instead of re-opening on reload.
        try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch(_){}
        location.reload();
      }, 850);
    } catch(err) {
      if (host.hasAttribute('data-exo-autostart-key')) {
        try { sessionStorage.removeItem('exo-auto-action:' + host.getAttribute('data-exo-autostart-key')); } catch(_){}
      }
      if(btn){ btn.classList.remove('btn-busy'); btn.disabled = false; if(span) span.textContent = prev; }
      toast(String(err && err.message ? err.message : err), false);
    }
  });
  // surface a flash message carried across the reload
  try {
    var flash = sessionStorage.getItem('exo-flash');
    if(flash){ sessionStorage.removeItem('exo-flash'); toast(flash, true); }
  } catch(_){}

  // One-shot auto actions let a surface queue repair work for itself once the
  // page proves the state is non-authoritative, without forcing the operator
  // through a dead manual sync button.
  (function(){
    var hosts = Array.prototype.slice.call(document.querySelectorAll('[data-exo-autostart-key]'));
    if (!hosts.length) return;
    hosts.forEach(function(host){
      var key = host.getAttribute('data-exo-autostart-key');
      if (!key) return;
      var storageKey = 'exo-auto-action:' + key;
      try {
        if (sessionStorage.getItem(storageKey)) return;
        sessionStorage.setItem(storageKey, '1');
      } catch(_){}
      var btn = host.querySelector('button');
      if (!btn) return;
      setTimeout(function(){ try { btn.click(); } catch(_){} }, 40);
    });
  })();

  // Collapsible sidebar (persisted across navigations).
  var root = document.querySelector('.exo-root');
  try { if(localStorage.getItem('exo-nav-collapsed') === '1' && root) root.classList.add('nav-collapsed'); } catch(_){}
  document.addEventListener('click', function(e){
    var btn = e.target.closest('.nav-collapse');
    if(!btn || !root) return;
    e.preventDefault();
    var collapsed = root.classList.toggle('nav-collapsed');
    try { localStorage.setItem('exo-nav-collapsed', collapsed ? '1' : '0'); } catch(_){}
  });

  // Real tabsets: proper tab/button semantics, panel hiding, hash restore, and
  // keyboard navigation. Used by motion settings now, reusable elsewhere.
  (function(){
    function selectTab(tablist, tab, updateHash){
      if (!tablist || !tab) return;
      var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
      var target = tab.getAttribute('data-tab-target');
      tabs.forEach(function(item){
        var active = item === tab;
        item.setAttribute('aria-selected', active ? 'true' : 'false');
        item.setAttribute('tabindex', active ? '0' : '-1');
        item.classList.toggle('is-active', active);
        var panelId = item.getAttribute('aria-controls');
        if (!panelId) return;
        var panel = document.getElementById(panelId);
        if (panel) panel.hidden = item.getAttribute('data-tab-target') !== target;
      });
      if (updateHash && target) {
        try { history.replaceState(null, '', '#' + target); } catch(_) {}
      }
    }
    function initTablist(tablist){
      var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
      if (!tabs.length) return;
      var wanted = null;
      try {
        wanted = location.hash ? location.hash.slice(1) : null;
      } catch(_) {}
      var active = tabs.find(function(tab){ return tab.getAttribute('data-tab-target') === wanted; }) ||
        tabs.find(function(tab){ return tab.getAttribute('aria-selected') === 'true'; }) ||
        tabs[0];
      selectTab(tablist, active, false);
      tablist.addEventListener('click', function(e){
        var tab = e.target.closest('[role="tab"]');
        if (!tab || !tablist.contains(tab)) return;
        e.preventDefault();
        selectTab(tablist, tab, true);
        tab.focus();
      });
      tablist.addEventListener('keydown', function(e){
        var current = e.target.closest('[role="tab"]');
        if (!current || !tablist.contains(current)) return;
        var index = tabs.indexOf(current);
        if (index === -1) return;
        var nextIndex = null;
        if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') nextIndex = 0;
        else if (e.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        e.preventDefault();
        var nextTab = tabs[nextIndex];
        selectTab(tablist, nextTab, true);
        nextTab.focus();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('[role="tablist"][data-tabset]'), initTablist);
  })();

  // Live data watcher: poll the store revision and reflect external changes
  // (e.g. the agent records a touch) without a manual refresh. Reloads only
  // when the operator is idle; otherwise offers a non-destructive "Refresh"
  // pill so an in-progress edit is never blown away.
  //
  // The same poll doubles as a liveness check: if /state fails twice in a row,
  // the local exo ui server is almost certainly down — surface that with a
  // persistent banner so operators don't keep clicking dead buttons.
  (function(){
    var baseline = null, pollMs = 8000, pill = null, banner = null, failStreak = 0;
    function busy(){
      var el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return true;
      if (location.hash && document.querySelector(location.hash + '.slideover, ' + location.hash + '.compose-panel')) return true;
      if (document.querySelector('.exo-action.busy')) return true;
      return false;
    }
    function showPill(){
      if (pill) return;
      pill = document.createElement('button');
      pill.className = 'exo-refresh-pill';
      pill.type = 'button';
      pill.textContent = 'New changes — refresh';
      pill.addEventListener('click', function(){ location.reload(); });
      document.body.appendChild(pill);
    }
    function showOffline(){
      if (banner) return;
      banner = document.createElement('div');
      banner.className = 'exo-server-banner';
      banner.setAttribute('role', 'alert');
      banner.innerHTML = '<strong>Exo UI server unreachable.</strong> Clicks will not save until it comes back. Restart with <code>exo ui</code>, then refresh this page.';
      document.body.appendChild(banner);
      document.body.classList.add('exo-server-down');
    }
    function hideOffline(){
      if (!banner) return;
      banner.remove();
      banner = null;
      document.body.classList.remove('exo-server-down');
    }
    function tick(){
      fetch('/state', { cache: 'no-store' }).then(function(r){
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function(d){
        failStreak = 0;
        hideOffline();
        if (!d || !d.rev) return;
        if (baseline === null) { baseline = d.rev; return; }
        if (d.rev !== baseline) {
          if (busy()) showPill();
          else location.reload();
        }
      }).catch(function(){
        failStreak += 1;
        // Two consecutive failures = ~16s of no response. The first miss could
        // be a transient blip (sleep/wake, brief stall); the second is the
        // signal worth surfacing.
        if (failStreak >= 2) showOffline();
      });
    }
    tick();
    setInterval(tick, pollMs);
  })();
})();
`;

/**
 * @param {{
 *   sectionLabel: string,
 *   detailLabel?: string | null,
 *   interactive?: boolean,
 *   sectionId?: string,
 *   sectionHref?: string | null,
 *   minimalChrome?: boolean,
 *   raisedCount?: number | null,
 *   agentRuntime?: any,
 *   search?: {
 *     action: string,
 *     query?: string | null,
 *     placeholder?: string | null,
 *     paramName?: string | null,
 *     ariaLabel?: string | null,
 *     clearHref?: string | null,
 *   } | null,
 * }} opts
 */
export function topbar(opts) {
  const { sectionLabel, detailLabel, interactive, sectionId } = opts;
  const homeHref = NAV_ROUTES.operator;
  const sectionHref = opts.sectionHref ?? (sectionId ? NAV_ROUTES[sectionId] ?? null : null);
  const home = interactive
    ? `<a class="crumb-btn" href="${escapeAttr(homeHref)}" title="Home">${iconSvg("home", 15)}</a>`
    : `<button class="crumb-btn" type="button" title="Home">${iconSvg("home", 15)}</button>`;
  const sectionCrumb = (label) =>
    interactive && sectionHref
      ? `<a class="crumb-btn cr-link" href="${escapeAttr(sectionHref)}">${escapeHtml(label)}</a>`
      : `<button class="crumb-btn cr-link" type="button">${escapeHtml(label)}</button>`;
  const crumbs =
    `<div class="crumbs">` +
    home +
    iconSvg("chevronR", 13, "cr-sep") +
    (detailLabel
      ? sectionCrumb(sectionLabel) +
        iconSvg("chevronR", 13, "cr-sep") +
        `<span class="cr-cur">${escapeHtml(detailLabel)}</span>`
      : `<span class="cr-cur">${escapeHtml(sectionLabel)}</span>`) +
    `</div>`;
  const agent = renderAgentStatusMenu(opts.agentRuntime ?? null, { interactive: opts.interactive });
  // Search + Raised belong on list/landing surfaces, not on a single record.
  const right =
    `<div class="top-right">` +
    agent +
    (opts.minimalChrome
      ? ""
      : renderTopbarSearch(opts.search) +
        (opts.raisedCount
          ? `<button class="chrome-btn raise-trigger" type="button" title="Surface the next decision that needs you">` +
            iconSvg("spark", 15) +
            `<span>Raised</span><span class="notif-dot">${opts.raisedCount}</span></button>`
          : "")) +
    `</div>`;
  return `<header class="topbar">${crumbs}${right}</header>`;
}

/**
 * @param {{
 *   action: string,
 *   query?: string | null,
 *   placeholder?: string | null,
 *   paramName?: string | null,
 *   ariaLabel?: string | null,
 *   clearHref?: string | null,
 * } | null | undefined} search
 */
function renderTopbarSearch(search) {
  if (!search) {
    return `<div class="search-pill">${iconSvg("search", 14)}<span>Search people…</span></div>`;
  }
  const action = search.action;
  const query = typeof search.query === "string" ? search.query.trim() : "";
  const placeholder = search.placeholder?.trim() || "Search prospects…";
  const paramName = search.paramName?.trim() || "q";
  const ariaLabel = search.ariaLabel?.trim() || placeholder;
  const clearHref = search.clearHref?.trim() || action;
  return (
    `<form class="search-form" action="${escapeAttr(action)}" method="GET" role="search">` +
    `${iconSvg("search", 14)}` +
    `<input class="search-input" type="search" name="${escapeAttr(paramName)}" value="${escapeAttr(query)}" placeholder="${escapeAttr(placeholder)}" aria-label="${escapeAttr(ariaLabel)}" autocomplete="off" spellcheck="false">` +
    `<button class="search-submit" type="submit">Find</button>` +
    (query ? `<a class="search-clear" href="${escapeAttr(clearHref)}">Clear</a>` : "") +
    `</form>`
  );
}

/**
 * @param {any} runtime
 * @param {{ interactive?: boolean }} [opts]
 */
function renderAgentStatusMenu(runtime, opts = {}) {
  const status = summarizeAgentHeaderRuntime(runtime);
  if (!status) return "";
  const actions = [];
  if (status.canRunNow) {
    actions.push(
      liveActionBtn({
        writer: "runAgentQueuePass",
        args: {},
        variant: "primary",
        size: "sm",
        icon: "cpu",
        label: status.runLabel ?? "Run agent now",
      }),
    );
  } else {
    actions.push(`<span class="agent-passive">${iconSvg("clock", 12)}Background pass in progress</span>`);
  }
  if (opts.interactive) {
    actions.push(btn({ variant: "secondary", size: "sm", icon: "queue", label: "Open queue", href: "/queue" }));
  }
  const chips = [
    status.cadence ? `<span class="surface-ref">${iconSvg("clock", 11)}${escapeHtml(status.cadence)}</span>` : "",
    status.sendMode ? `<span class="cap-ref">${iconSvg("cpu", 11)}${escapeHtml(status.sendMode)} mode</span>` : "",
  ].filter(Boolean).join("");
  return (
    `<details class="agent-menu" data-agent-health="${escapeAttr(status.health)}">` +
    `<summary class="agent-pill tone-${escapeAttr(status.health)}" title="${escapeAttr(status.headline)}">` +
    iconSvg("bot", 15) +
    `<span class="agent-pill-label">Agent</span>` +
    `<span class="agent-pill-state">${escapeHtml(status.label)}</span>` +
    `<i class="agent-pill-dot"></i>` +
    `</summary>` +
    `<div class="agent-panel">` +
    `<div class="agent-panel-head">` +
    `<div class="agent-panel-title">${escapeHtml(status.headline)}</div>` +
    `<p class="agent-panel-detail">${escapeHtml(status.detail)}</p>` +
    `</div>` +
    (chips ? `<div class="agent-panel-chips">${chips}</div>` : "") +
    `<div class="agent-panel-actions">${actions.join("")}</div>` +
    `</div>` +
    `</details>`
  );
}

/** @param {number | null | undefined} seconds */
function humanizeCadence(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? "every 1h" : `every ${hours}h`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "every 1m" : `every ${minutes}m`;
  }
  return `every ${seconds}s`;
}

/** @param {number | null | undefined} seconds */
function humanizeDelay(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** @param {any} runtime */
function summarizeAgentHeaderRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") return null;
  const lock = runtime.lock ?? null;
  const scheduler = runtime.scheduler ?? null;
  const routine = runtime.routine ?? null;
  const lastPass = runtime.lastPass ?? null;
  const cadenceState = runtime.cadence ?? null;
  const queueCount = Number.isFinite(runtime.queueCount) ? Number(runtime.queueCount) : 0;
  const activeBackoff = findActiveAgentBackoff(runtime, queueCount);
  const blockerCount = Number.isFinite(runtime.blockerCount) ? Number(runtime.blockerCount) : 0;
  const cadence = humanizeCadence(scheduler?.runIntervalSeconds ?? null);
  const sendMode = typeof routine?.sendMode === "string" && routine.sendMode.trim()
    ? routine.sendMode.trim().toLowerCase()
    : null;
  const verificationSendCount = Number.isFinite(runtime.verificationSendCount)
    ? Number(runtime.verificationSendCount)
    : queueCount;
  const lastStatus = typeof lastPass?.status === "string" ? lastPass.status.trim().toLowerCase() : null;
  const lastReason = summarizeAgentFailureReason(runtime, {
    cadence,
    lastPass,
    queueCount,
  });
  const queuedLabel = `${queueCount} queued`;
  const queuedDetail = `${queueCount} queued task${queueCount === 1 ? "" : "s"} waiting to run.`;
  const verifyHoldingSends = isVerifyModeHoldingSends({ sendMode, lastPass, verificationSendCount });
  const overdueBySeconds = Number.isFinite(cadenceState?.overdueBySeconds) ? Number(cadenceState.overdueBySeconds) : 0;
  const schedulerBehind = Boolean(scheduler?.loaded)
    && !scheduler?.running
    && queueCount > 0
    && Boolean(cadenceState?.overdue)
    && overdueBySeconds > 0;

  if (lock?.active) {
    return {
      health: "green",
      label: "Running",
      headline: "Agent pass running",
      detail: `A queue pass is already in progress${Number.isInteger(lock.pid) ? ` (pid ${lock.pid})` : ""}.`,
      cadence,
      sendMode,
      canRunNow: false,
      runLabel: null,
    };
  }

  if (scheduler?.running) {
    return {
      health: "green",
      label: "Running",
      headline: "Background agent running",
      detail: `Launchd is draining the queue now${cadence ? ` ${cadence}.` : "."}`,
      cadence,
      sendMode,
      canRunNow: false,
      runLabel: null,
    };
  }

  if (activeBackoff) {
    return {
      health: "yellow",
      label: "Blocked",
      headline: "Agent is blocked",
      detail: buildAgentBackoffDetail(activeBackoff, cadence, Boolean(scheduler?.loaded)),
      cadence,
      sendMode,
      canRunNow: true,
      runLabel: "Run agent now",
    };
  }

  if (lastStatus === "failed") {
    return {
      health: "red",
      label: "Issue",
      headline: "Agent needs attention",
      detail: lastReason ?? "The last agent pass did not complete cleanly.",
      cadence,
      sendMode,
      canRunNow: true,
      runLabel: "Run agent now",
    };
  }

  if (lastStatus === "blocked" && blockerCount > 0) {
    return {
      health: "yellow",
      label: "Blocked",
      headline: "Agent is blocked",
      detail: lastReason ?? "The last agent pass hit a real execution blocker.",
      cadence,
      sendMode,
      canRunNow: true,
      runLabel: "Run agent now",
    };
  }

  if (verifyHoldingSends) {
    return {
      health: "yellow",
      label: "Verify only",
      headline: "Verify mode is holding sends",
      detail: `${verificationSendCount} queued agent-authored send${verificationSendCount === 1 ? "" : "s"} already have fresh proof. Verify mode stops those at ready_to_send and will not click Send or write back.`,
      cadence,
      sendMode,
      canRunNow: true,
      runLabel: "Run proof pass",
    };
  }

  if (schedulerBehind) {
    return {
      health: "yellow",
      label: "Behind",
      headline: "Agent is behind",
      detail: `${queuedDetail} No pass is running right now. The next scheduled pass is already ${humanizeDelay(overdueBySeconds)} late.`,
      cadence,
      sendMode,
      canRunNow: true,
      runLabel: "Run agent now",
    };
  }

  if (scheduler?.loaded) {
    return {
      health: "green",
      label: queueCount > 0 ? queuedLabel : "On",
      headline: queueCount > 0 ? "Agent work queued" : "Background agent on",
      detail: queueCount > 0
        ? `${queuedDetail}${cadence ? ` Background draining is enabled ${cadence}.` : " Background draining is enabled."}`
        : cadence ? `Background draining is enabled ${cadence}.` : "Background draining is enabled.",
      cadence,
      sendMode,
      canRunNow: !scheduler.running,
      runLabel: scheduler.running ? null : "Run agent now",
    };
  }

  const hasSetup = Boolean(scheduler?.installed || routine?.exists || lastPass);
  return {
    health: "yellow",
    label: queueCount > 0 ? queuedLabel : hasSetup ? "Idle" : "Off",
    headline: queueCount > 0 ? "Agent work queued" : hasSetup ? "Agent is idle" : "Agent is off",
    detail: queueCount > 0
      ? `${queuedDetail} ${hasSetup ? "No pass is running right now." : "Background draining is off right now."}`
      : hasSetup ? "No pass is running right now." : "Background draining is off right now.",
    cadence,
    sendMode,
    canRunNow: true,
    runLabel: "Run agent now",
  };
}

/**
 * @param {any} runtime
 * @param {{ cadence: string | null, lastPass: any, queueCount: number }} input
 */
function summarizeAgentFailureReason(runtime, input) {
  const rawReason = typeof input.lastPass?.reason === "string" && input.lastPass.reason.trim()
    ? input.lastPass.reason.trim()
    : null;
  if (!rawReason) {
    return null;
  }

  if (/Codex task failed: .*ETIMEDOUT/i.test(rawReason)) {
    const taskLabel = normalizeRuntimeText(runtime?.hostState?.sendCircuitBreaker?.lastTaskLabel);
    const overdueBySeconds = Number.isFinite(runtime?.cadence?.overdueBySeconds)
      ? Number(runtime.cadence.overdueBySeconds)
      : 0;
    const cadenceMiss = runtime?.cadence?.overdue && overdueBySeconds > 0
      ? ` The pass is ${humanizeDelay(overdueBySeconds)} behind${input.cadence ? ` its ${input.cadence} cadence` : " schedule"}.`
      : "";
    return `A bounded background Codex task timed out${taskLabel ? ` on ${taskLabel}` : ""}.${cadenceMiss}`;
  }

  if (/invalid transport in `mcp_servers\.playwriter`/i.test(rawReason)) {
    return "A background Codex task could not start because the configured Playwriter MCP transport is invalid.";
  }

  return rawReason;
}

/** @param {unknown} value */
function normalizeRuntimeText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * @param {{ sendMode: string | null, lastPass: any, verificationSendCount: number }} input
 */
function isVerifyModeHoldingSends(input) {
  if (input.sendMode !== "verify" || input.verificationSendCount <= 0) return false;
  const status = String(input.lastPass?.status ?? "").trim().toLowerCase();
  const reason = String(input.lastPass?.reason ?? "").trim().toLowerCase();
  return status === "noop" && /no unverified send_message tasks left to prove/.test(reason);
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
 * @param {string | null} cadence
 * @param {boolean} schedulerLoaded
 */
function buildAgentBackoffDetail(backoff, cadence, schedulerLoaded) {
  const laneLabel = backoff?.lane === "retrieval" ? "Inbound refresh work" : "Send work";
  const reason = typeof backoff?.reason === "string" && backoff.reason.trim()
    ? backoff.reason.trim()
    : null;
  const schedulerLabel = schedulerLoaded
    ? cadence
      ? `Background draining is enabled ${cadence}.`
      : "Background draining is enabled."
    : "No pass is running right now.";
  return reason
    ? `${schedulerLabel} ${laneLabel} is blocked right now. ${reason}`
    : `${schedulerLabel} ${laneLabel} is blocked right now.`;
}

// ---------------------------------------------------------------------------
// Shared CSS — design tokens + the base styles for primitives + shell. Inline
// into the rendered HTML so the page is self-contained.
// ---------------------------------------------------------------------------

export const FONTS_LINK =
  `<link rel="preconnect" href="https://fonts.googleapis.com">` +
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
  `<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">`;

export const EXO_UI_CSS = `
:root{
  --bg:#09090b; --bg-1:#0d0d0f; --bg-2:#131316; --bg-3:#1a1a1f; --bg-hover:#202027;
  --border:rgba(255,255,255,.07); --border-2:rgba(255,255,255,.12); --border-3:rgba(255,255,255,.18);
  --text:#ededf0; --text-2:#a1a1aa; --text-3:#71717a; --text-4:#52525b;
  --accent:#3b82f6;
  --green:#22c55e; --amber:#f59e0b; --red:#ef4444; --violet:#a78bfa; --slate:#94a3b8;
  --space-scale:0.9; --fs-base:13.5px;
  --r-card:13px; --r-btn:8px; --r-chip:6px;
  --mono:'JetBrains Mono',ui-monospace,monospace;
  --sans:'Hanken Grotesk',-apple-system,system-ui,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:var(--fs-base);
  -webkit-font-smoothing:antialiased;line-height:1.45;overflow:hidden}
.ic{flex:none}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:#2a2a31;border-radius:6px;border:2px solid var(--bg)}
::-webkit-scrollbar-track{background:transparent}
h1,h2,h3{font-weight:700;letter-spacing:-.015em}
button{font-family:inherit;color:inherit}
a{color:inherit;text-decoration:none}

/* shell */
.exo-root{display:grid;grid-template-columns:212px 1fr;height:100vh}
.nav{background:var(--bg-1);border-right:1px solid var(--border);display:flex;flex-direction:column;
  padding:14px 10px;gap:1px;overflow-y:auto}
.nav-brand{display:flex;align-items:center;gap:9px;padding:4px 6px 14px}
.brand-mark{width:26px;height:26px;display:grid;place-items:center;flex:none}
.brand-svg{width:24px;height:24px;display:block}
.brand-name{font-weight:800;font-size:18px;letter-spacing:-.04em}
.nav-collapse{margin-left:auto;background:none;border:none;color:var(--text-4);cursor:pointer;padding:4px;
  border-radius:6px;display:grid;place-items:center}
.nav-collapse:hover{color:var(--text-2);background:var(--bg-3)}
.nav-collapse .ic{transition:transform .15s}
.exo-root.nav-collapsed .nav-collapse .ic{transform:rotate(180deg)}
/* collapsed sidebar */
.exo-root.nav-collapsed{grid-template-columns:58px 1fr}
.exo-root.nav-collapsed .brand-name{display:none}
.exo-root.nav-collapsed .nav-brand{flex-direction:column;gap:10px;padding:2px 0 14px}
.exo-root.nav-collapsed .nav-collapse{margin:0}
.exo-root.nav-collapsed .nav-item{justify-content:center;padding:9px 0}
.exo-root.nav-collapsed .nav-item span{display:none}
.nav-item{display:flex;align-items:center;gap:10px;width:100%;padding:7px 9px;border:none;background:none;
  color:var(--text-2);border-radius:8px;cursor:pointer;font-size:13.5px;font-weight:500;text-align:left;
  transition:background .12s,color .12s}
.nav-item:hover{background:var(--bg-3);color:var(--text)}
.nav-item.active{background:var(--bg-3);color:var(--text);font-weight:600}
.nav-item.active .ic{color:var(--accent)}
.nav-spacer{flex:1}

.main{display:flex;flex-direction:column;min-width:0;height:100vh}
.topbar{height:52px;flex:none;border-bottom:1px solid var(--border);background:var(--bg-1);
  display:flex;align-items:center;justify-content:space-between;padding:0 18px;gap:14px}
.crumbs{display:flex;align-items:center;gap:5px;color:var(--text-3)}
.crumb-btn{background:none;border:none;color:var(--text-3);cursor:pointer;display:inline-flex;align-items:center;
  padding:4px 7px;border-radius:6px;font-size:13px;font-weight:600}
.crumb-btn:hover{color:var(--text);background:var(--bg-3)}
.cr-sep{color:var(--text-4)}
.cr-link{color:var(--text-2)}
.cr-cur{color:var(--text);font-weight:700;padding:0 4px;font-size:13px}
.top-right{display:flex;align-items:center;gap:10px}
.agent-menu{position:relative}
.agent-menu summary{list-style:none}
.agent-menu summary::-webkit-details-marker{display:none}
.agent-pill{display:inline-flex;align-items:center;gap:7px;background:var(--bg-2);border:1px solid var(--border);
  color:var(--text-2);padding:6px 10px;border-radius:999px;cursor:pointer;font-size:12px;font-weight:700}
.agent-pill:hover,.agent-menu[open] .agent-pill{background:var(--bg-3);color:var(--text)}
.agent-pill .ic{color:inherit}
.agent-pill-label{font-weight:700}
.agent-pill-state{font-size:11px;color:var(--text-3)}
.agent-pill-dot{width:8px;height:8px;border-radius:999px;display:block;flex:none;background:var(--slate);box-shadow:0 0 0 2px rgba(255,255,255,.04)}
.agent-menu[data-agent-health="green"] .agent-pill{border-color:rgba(34,197,94,.24);color:#dcfce7}
.agent-menu[data-agent-health="green"] .agent-pill-state{color:#86efac}
.agent-menu[data-agent-health="green"] .agent-pill-dot{background:var(--green)}
.agent-menu[data-agent-health="yellow"] .agent-pill{border-color:rgba(245,158,11,.24);color:#fef3c7}
.agent-menu[data-agent-health="yellow"] .agent-pill-state{color:#fbbf24}
.agent-menu[data-agent-health="yellow"] .agent-pill-dot{background:var(--amber)}
.agent-menu[data-agent-health="red"] .agent-pill{border-color:rgba(239,68,68,.24);color:#fee2e2}
.agent-menu[data-agent-health="red"] .agent-pill-state{color:#fca5a5}
.agent-menu[data-agent-health="red"] .agent-pill-dot{background:var(--red)}
.agent-panel{position:absolute;right:0;top:42px;width:290px;background:var(--bg-1);border:1px solid var(--border-2);
  border-radius:12px;padding:12px;display:none;box-shadow:0 16px 32px rgba(0,0,0,.32);z-index:40}
.agent-menu[open] .agent-panel{display:block}
.agent-panel-head{display:flex;flex-direction:column;gap:4px}
.agent-panel-title{font-size:13px;font-weight:800;color:var(--text)}
.agent-panel-detail{font-size:12px;color:var(--text-3);line-height:1.45}
.agent-panel-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.agent-panel-actions{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
.agent-passive{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-3);font-weight:600}
.search-form{display:flex;align-items:center;gap:8px;background:var(--bg-2);border:1px solid var(--border);
  color:var(--text-2);padding:0 8px 0 10px;border-radius:8px;min-width:260px;max-width:420px}
.search-form .ic{color:var(--text-4)}
.search-input{flex:1;min-width:120px;background:transparent;border:none;outline:none;color:var(--text);
  font-size:12.5px;padding:7px 0}
.search-input::placeholder{color:var(--text-4)}
.search-submit,.search-clear{background:none;border:none;color:var(--text-3);font-size:11.5px;font-weight:700;
  cursor:pointer;padding:0}
.search-submit:hover,.search-clear:hover{color:var(--text)}
.search-clear{display:inline-flex;align-items:center}
.search-pill{display:flex;align-items:center;gap:7px;background:var(--bg-2);border:1px solid var(--border);
  color:var(--text-3);font-size:12.5px;padding:6px 12px;border-radius:8px;min-width:220px}
.search-pill .ic{color:var(--text-4)}
.chrome-btn{display:inline-flex;align-items:center;gap:6px;background:var(--bg-2);border:1px solid var(--border);
  color:var(--text-2);padding:6px 11px;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:600}
.chrome-btn:hover{background:var(--bg-3);color:var(--text)}
.raise-trigger .ic{color:var(--violet)}
.canvas{flex:1;overflow-y:auto;padding:22px 26px 80px}

/* intro */
.op-intro{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;
  margin-bottom:calc(20px * var(--space-scale));max-width:1180px}
.op-intro>div:first-child{flex:1;min-width:0}
.op-intro h1{font-size:24px;letter-spacing:-.03em}
.op-line{color:var(--text-3);font-size:13px;margin-top:3px;max-width:620px}
.op-meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:8px}
.op-intro-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.op-stat{display:flex;align-items:center;gap:11px;font-size:12.5px;color:var(--text-3);
  background:var(--bg-1);border:1px solid var(--border);border-radius:10px;padding:9px 14px;white-space:nowrap}
.op-stat b{color:var(--text);font-weight:700;font-size:14px}
.op-stat i{width:1px;height:14px;background:var(--border-2)}

/* inert status primitives */
.state-dot{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2);
  font-weight:500;white-space:nowrap;cursor:default}
.state-dot i{width:7px;height:7px;border-radius:50%;flex:none}
.truth-tag{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:9.5px;
  font-weight:600;letter-spacing:.08em;color:var(--text-3);cursor:default;white-space:nowrap}
.truth-tag i{width:6px;height:6px;border-radius:2px;flex:none}
.truth-tag em{font-style:normal;color:var(--text-4);letter-spacing:.04em;margin-left:1px}
.action-tag{display:inline-flex;align-items:center;font-size:10.5px;font-weight:700;letter-spacing:.02em;
  color:var(--am);padding-left:9px;position:relative;text-transform:uppercase;cursor:default;white-space:nowrap}
.action-tag::before{content:"";position:absolute;left:0;top:50%;transform:translateY(-50%);
  width:3px;height:11px;border-radius:2px;background:var(--am)}
.surface-ref,.cap-ref{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-3);
  font-family:var(--mono);letter-spacing:-.01em;cursor:default}
.surface-ref .ic,.cap-ref .ic{color:var(--text-4)}
.cap-ref .ic{color:var(--accent)}
.owner-tag{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2);font-weight:500}
.owner-tag.unassigned{color:var(--text-3)}
.count-chip{display:inline-flex;align-items:center;gap:5px;background:var(--bg-3);color:var(--text-2);
  font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:20px;border:1px solid var(--border)}
.count-chip em{font-style:normal;font-weight:500;color:var(--text-3);font-size:10.5px}
.count-chip.tone-amber{color:#fbbf24;background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.22)}
.count-chip.tone-blue{color:#60a5fa;background:rgba(59,130,246,.1);border-color:rgba(59,130,246,.22)}
.count-chip.tone-red{color:#f87171;background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.22)}

/* real buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:var(--r-btn);
  cursor:pointer;font-weight:600;font-size:13px;border:1px solid transparent;white-space:nowrap;
  transition:background .13s,border-color .13s,transform .08s,box-shadow .13s}
.btn:active{transform:translateY(.5px)}
.btn-md{padding:8px 15px}
.btn-sm{padding:6px 11px;font-size:12px;gap:6px}
.btn-primary{background:var(--accent);color:#fff;box-shadow:0 1px 0 rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.14)}
.btn-primary:hover{background:color-mix(in srgb,var(--accent) 88%,#fff);box-shadow:0 2px 10px -2px color-mix(in srgb,var(--accent) 55%,transparent)}
.btn-secondary{background:var(--bg-3);color:var(--text);border-color:var(--border-2)}
.btn-secondary:hover{background:var(--bg-hover);border-color:var(--border-3)}
.btn-ghost{background:transparent;color:var(--text-2);border-color:var(--border)}
.btn-ghost:hover{background:var(--bg-3);color:var(--text)}
.btn-danger{background:transparent;color:#f87171;border-color:rgba(239,68,68,.32)}
.btn-danger:hover{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.5)}
.btn:disabled{cursor:default;opacity:.7}

/* cards */
.card{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--r-card);
  padding:calc(14px * var(--space-scale));position:relative}
.card.stakes-high{border-color:rgba(59,130,246,.28)}
.card.stakes-high::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:var(--accent)}
.card.stakes-block{border-color:rgba(239,68,68,.2)}
.card.stakes-medium{border-color:var(--border-2)}
.row-top{display:flex;align-items:flex-start;gap:11px}
.row-id{flex:1;min-width:0}
.row-name{font-weight:700;font-size:14px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-role{font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.row-summary{font-size:12.5px;color:var(--text-2);margin:9px 0 0;line-height:1.5}
.row-summary .blk-reason{color:#f87171;font-weight:600}
.op-preview{margin-top:10px}
.op-preview-cap,.op-preview-subject{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-4)}
.op-preview-subject{margin-top:5px}
.op-preview-quote{margin-top:6px;font-size:12.5px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}
.row-note{font-size:12px;color:var(--text-3);margin:7px 0 0;line-height:1.45}
.row-chips{display:flex;align-items:center;gap:13px;flex-wrap:wrap;margin-top:10px}
.row-actions{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
.q-agent{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--text-3);background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:3px 9px}
.q-agent .ic{opacity:.8}
.q-card .row-actions .btn{margin-left:auto}
.avatar{border-radius:50%;object-fit:cover;flex:none}
.avatar-ini{display:inline-grid;place-items:center;color:#fff;font-weight:700;text-transform:uppercase}

/* next move hero */
.next-move{margin-bottom:calc(18px * var(--space-scale));padding:calc(16px * var(--space-scale)) calc(18px * var(--space-scale))}
.nm-flag{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;font-weight:700;
  letter-spacing:.16em;color:var(--accent);margin-bottom:11px}
.nm-body{display:flex;align-items:flex-start;gap:14px}
.nm-main{flex:1;min-width:0}
.nm-title{font-size:17px;font-weight:700;letter-spacing:-.02em}
.nm-sub{font-size:12.5px;color:var(--text-3);margin-top:2px}
.nm-chips{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:10px}
.nm-actions{display:flex;align-items:center;gap:8px;flex:none}

/* sections */
.op-sec{margin-bottom:calc(18px * var(--space-scale))}
.sec-head{display:flex;align-items:center;gap:9px;margin-bottom:calc(11px * var(--space-scale))}
.sec-ic{color:var(--text-3)}
.sec-head h2{font-size:15px;font-weight:700;letter-spacing:-.01em;white-space:nowrap}
.sec-sub{font-size:11.5px;color:var(--text-4);font-family:var(--mono)}
.sec-right{margin-left:auto}
/* Card sections flow into a responsive grid so the operator landing uses the
   full canvas width (2-3 columns on wide screens, 1 on narrow) instead of a
   single tall column. Full-width children (lists, empty states) span all
   columns. */
.sec-body{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));
  gap:calc(10px * var(--space-scale));align-items:start}
.sec-body > .stale-list,
.sec-body > .agenda-list,
.sec-body > .empty-state{grid-column:1 / -1}
.empty-state{display:flex;align-items:center;gap:9px;color:var(--text-4);font-size:12.5px;
  padding:14px;border:1px dashed var(--border-2);border-radius:10px}

.op-wrap{max-width:1180px}
/* The operator landing fills the canvas; the grid above keeps card widths sane. */
.op-wrap.feed{max-width:none}
.op-wrap.feed .op-intro,
.op-wrap.feed .next-move{max-width:none}

/* stale list */
.stale-list{display:flex;flex-direction:column;gap:1px;background:var(--bg-2);border:1px solid var(--border);
  border-radius:12px;overflow:hidden}
.stale-row{display:flex;align-items:flex-start;gap:11px;padding:12px 14px}
.stale-row:not(:last-child){border-bottom:1px solid var(--border)}
.stale-row:hover{background:var(--bg-3)}
.stale-ic{color:var(--text-3);margin-top:1px}
.stale-main{flex:1;min-width:0}
.stale-top{display:flex;align-items:center;gap:12px}
.stale-subject{font-weight:600;font-size:13px}
.stale-detail{font-size:12px;color:var(--text-3);margin-top:2px}

/* agenda */
.agenda-list{display:flex;flex-direction:column;gap:1px;background:var(--bg-2);border:1px solid var(--border);
  border-radius:12px;overflow:hidden}
.agenda-row{display:flex;align-items:center;gap:12px;padding:9px 14px;background:none;border:none;
  width:100%;text-align:left;color:var(--text)}
.agenda-row:not(:last-child){border-bottom:1px solid var(--border)}
.agenda-check{width:17px;height:17px;border-radius:5px;border:1.5px solid var(--at,#3b82f6);flex:none;
  display:grid;place-items:center}
.agenda-time{font-family:var(--mono);font-size:11px;color:var(--text-3);width:46px;flex:none}
.agenda-label{flex:1;font-size:12.5px;font-weight:500}
.agenda-meta{font-family:var(--mono);font-size:10.5px;color:var(--text-4)}

.gen-footer{margin-top:36px;padding-top:14px;border-top:1px solid var(--border);
  color:var(--text-4);font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}
.gen-footer code{color:var(--text-3);font-size:10.5px}

/* ---------- domain shells ---------- */
.dom-wrap{width:100%;max-width:1240px;min-width:0}
.ws-wrap{width:100%;max-width:1240px;min-width:0}
/* Wide routes should spend the available canvas width on desktop without
   changing the current constrained behavior on smaller viewports. */
body.view-motions .dom-wrap,
body.view-prospects .dom-wrap,
body.view-connections .dom-wrap,
body.view-execution .dom-wrap,
body.view-settings .dom-wrap,
body.view-workspace .ws-wrap{max-width:none}
body.view-motions .op-intro,
body.view-prospects .op-intro,
body.view-connections .op-intro,
body.view-execution .op-intro,
body.view-settings .op-intro,
body.view-workspace .op-intro{max-width:none}
body.view-prospects .pr-table,
body.view-prospects .pr-groups,
body.view-connections .conn-main,
body.view-connections .conn-fresh,
body.view-execution .user-cards,
body.view-execution .exec-two,
body.view-settings .settings-page,
body.view-settings .exec-policy-card{max-width:none}
.fit-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--fc);
  background:color-mix(in srgb,var(--fc) 12%,transparent);border:1px solid color-mix(in srgb,var(--fc) 30%,transparent);
  padding:2px 8px;border-radius:6px;cursor:default}
.ready-bar{display:block;height:5px;border-radius:3px;background:var(--bg-3);overflow:hidden}
.ready-bar i{display:block;height:100%;border-radius:3px}

/* ---------- motions: list ---------- */
.motion-intake-card{background:var(--bg-1);border:1px solid var(--border);border-radius:14px;padding:16px 18px}
.motion-intake-panel{display:flex;flex-direction:column;gap:14px;min-height:100%}
.motion-intake-thread{display:flex;flex-direction:column;gap:10px}
.motion-intake-step{background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px 15px;
  transition:border-color .14s,background .14s,box-shadow .14s}
.motion-intake-step.is-current{border-color:color-mix(in srgb,var(--accent) 36%,var(--border));
  background:color-mix(in srgb,var(--accent) 8%,var(--bg-2));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 18%,transparent)}
.motion-intake-step.is-complete{border-color:rgba(34,197,94,.22)}
.motion-intake-field{gap:7px}
.motion-intake-helper{font-size:12.5px;line-height:1.55;color:var(--text-3);margin:0}
.motion-intake-panel .motion-intake-textarea{min-height:92px}
.motion-intake-panel .motion-intake-textarea-signals{min-height:132px}
.motion-intake-actions{margin-top:auto;position:sticky;bottom:0;z-index:1;background:linear-gradient(180deg,rgba(11,12,15,0),var(--bg-1) 18%);padding-top:14px}
.motion-intake-options{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.motion-intake-option{display:flex;align-items:flex-start;gap:10px;background:var(--bg-1);border:1px solid var(--border);
  border-radius:10px;padding:10px 12px;cursor:pointer}
.motion-intake-option:hover{border-color:var(--border-3);background:var(--bg-3)}
.motion-intake-option input{accent-color:var(--accent);margin-top:3px}
.motion-intake-option span{display:flex;flex-direction:column;gap:3px}
.motion-intake-option strong{font-size:12.5px;line-height:1.4}
.motion-intake-option em{font-style:normal;font-size:11.5px;line-height:1.45;color:var(--text-3)}
.motion-intake-match strong{text-transform:none}
.motion-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(282px,1fr));gap:14px;max-width:none}
.motion-card{display:flex;flex-direction:column;background:var(--bg-2);border:1px solid var(--border);border-radius:13px;padding:16px;
  text-align:left;transition:border-color .14s,background .14s}
.motion-card:hover{border-color:var(--border-3);background:var(--bg-3)}
.mc-link{display:block;color:inherit;text-decoration:none}
.mc-link:hover .mc-name{color:var(--accent)}
.mc-top{display:flex;align-items:center;gap:8px;margin-bottom:11px}
.mc-ready-tag{margin-left:auto;font-size:10px;color:var(--text-4);font-family:var(--mono);letter-spacing:.04em}
.mc-name{font-size:17px;font-weight:700;letter-spacing:-.02em;margin-bottom:12px;color:var(--text)}
.mc-ready{font-size:11px;color:var(--text-3);font-family:var(--mono);margin-top:6px}
.mc-cap{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:9px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--text-4)}
.mc-cap .ic{opacity:.8}
.mc-offer{margin-bottom:11px}
.mc-offer-t{display:block;margin-top:3px;font-size:12.5px;font-weight:600;color:var(--text-2);line-height:1.4;
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.mc-premise{background:color-mix(in srgb,var(--accent) 5%,var(--bg-3));border:1px solid var(--border);
  border-left:2px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:8px;padding:9px 11px;margin-bottom:4px}
.mc-cap-pr{margin-bottom:5px;gap:6px}
.mc-cap-pr .truth-tag{margin-left:2px}
.mc-premise-t{font-size:12.5px;color:var(--text);line-height:1.5;margin:0;
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.mc-activity{margin-top:11px;padding:10px 11px;border:1px solid var(--border);border-radius:8px;background:var(--bg-1)}
.mc-activity-live{background:color-mix(in srgb,var(--green) 5%,var(--bg-1));border-color:color-mix(in srgb,var(--green) 20%,var(--border))}
.mc-activity-staged{background:color-mix(in srgb,var(--accent) 5%,var(--bg-1));border-color:color-mix(in srgb,var(--accent) 18%,var(--border))}
.mc-activity-t{font-size:12.5px;font-weight:700;color:var(--text);margin-top:4px}
.mc-activity-note{font-size:11px;line-height:1.45;color:var(--text-3);margin-top:4px}
.mc-stats{display:flex;gap:15px;margin-top:13px;padding-top:12px;border-top:1px solid var(--border)}
.mc-stats span{font-size:10.5px;color:var(--text-3)}
.mc-stats b{display:block;font-size:16px;font-weight:800;color:var(--text);letter-spacing:-.02em}
.mc-blk{display:flex;align-items:center;gap:6px;font-size:11px;color:#fbbf24;margin-top:11px}
.mc-go{display:flex;align-items:center;gap:4px;justify-content:flex-end;font-size:12px;font-weight:600;color:var(--accent);margin-top:11px}
.mc-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}

/* ---------- motions: detail ---------- */
.motion-detail{max-width:1000px;scroll-margin-top:18px}
.motion-detail+.motion-detail{margin-top:34px;padding-top:30px;border-top:1px solid var(--border)}
.motion-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:calc(18px * var(--space-scale))}
.mh-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.mh-eyebrow{display:flex;align-items:center;gap:11px;margin-bottom:6px}
.mh-eyebrow>.ic{color:var(--text-4)}
.mh-tag{font-family:var(--mono);font-size:10px;letter-spacing:.18em;color:var(--text-4);font-weight:700}
.mh-name{font-size:17px;font-weight:700;letter-spacing:-.02em;color:var(--text-2)}
.mh-back{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4);
  display:inline-flex;align-items:center;gap:5px;margin-bottom:9px}
.mh-back:hover{color:var(--text-2)}
.motion-settings{max-width:1040px}
.settings-tabs{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0 18px}
.settings-tab{display:inline-flex;align-items:center;gap:6px;background:var(--bg-2);border:1px solid var(--border);
  color:var(--text-2);padding:8px 12px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer}
.settings-tab:hover{background:var(--bg-3);color:var(--text)}
.settings-tab[aria-selected="true"],.settings-tab.is-active{background:color-mix(in srgb,var(--accent) 14%,var(--bg-2));
  border-color:color-mix(in srgb,var(--accent) 34%,var(--border));color:var(--text)}
.settings-tab:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:2px}
.settings-stack{display:flex;flex-direction:column;gap:14px}
.settings-pane{scroll-margin-top:78px}
.settings-pane[hidden]{display:none}
.offer-card{background:var(--bg-1);border:1px solid var(--border);border-radius:var(--r-card);padding:16px 18px;margin-bottom:14px}
.offer-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px}
.def-cap{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:9.5px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--text-4);font-weight:700}
.def-cap .ic{color:var(--violet)}
.offer-url{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:11px;color:var(--text-3)}
.offer-url:hover{color:var(--accent)}
.offer-url .ic{color:var(--text-4)}
.offer-title{font-size:15px;font-weight:700;letter-spacing:-.01em}
.offer-summary{font-size:12.5px;color:var(--text-2);line-height:1.55;margin-top:5px;max-width:760px}
.offer-thesis{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border:1px solid var(--border);
  border-radius:10px;overflow:hidden;margin-top:13px}
.ot-cell{background:var(--bg-2);padding:11px 13px;display:flex;flex-direction:column;gap:5px}
.ot-cap{font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4)}
.ot-val{font-size:11.5px;color:var(--text-2);line-height:1.45}
.premise-hero{position:relative;overflow:hidden;
  background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 7%,var(--bg-2)),var(--bg-2));
  border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);border-radius:var(--r-card);padding:20px 22px 18px;margin-bottom:8px}
.premise-hero::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent)}
.premise-flag{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10px;font-weight:700;
  letter-spacing:.14em;color:var(--accent);margin-bottom:13px}
.premise-statement{font-size:21px;line-height:1.42;font-weight:600;letter-spacing:-.02em;color:var(--text);max-width:840px}
.premise-note{font-size:12.5px;color:var(--text-3);line-height:1.55;margin-top:13px;max-width:780px;
  border-left:2px solid var(--border-2);padding-left:12px}
.premise-meta{display:flex;align-items:center;gap:15px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--border)}
.pm-item{display:inline-flex;align-items:center;gap:8px}
.pm-cap{font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4)}
.pm-src{font-size:11.5px;color:var(--text-2)}
.pm-div{width:1px;height:13px;background:var(--border-2)}
.md-section{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:700;margin:20px 0 11px}
.md-section>span{font-family:var(--mono);font-size:11px;color:var(--text-3);background:var(--bg-3);padding:1px 8px;border-radius:10px}
.sig-section{align-items:baseline}
.sig-section-q{font-style:normal;font-size:12px;color:var(--text-3);font-weight:500;letter-spacing:0;background:none;padding:0;margin-left:2px}
.signal-grid{display:flex;flex-direction:column;gap:11px}
.signal-card{background:var(--bg-2);border:1px solid var(--border);border-radius:13px;padding:15px 17px}
.sig-top{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px}
.sig-idx{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--accent);
  background:color-mix(in srgb,var(--accent) 13%,transparent);padding:3px 7px;border-radius:6px;flex:none;margin-top:1px}
.sig-q{flex:1;font-size:14.5px;font-weight:700;letter-spacing:-.01em;line-height:1.4}
.sig-why{font-size:12.5px;color:var(--text-2);line-height:1.55;margin-bottom:12px;max-width:780px}
.sig-rule{display:flex;align-items:center;gap:9px;background:var(--bg-1);border:1px solid var(--border);border-radius:8px;
  padding:8px 11px;margin-bottom:12px;overflow-x:auto}
.sig-rule-cap{font-family:var(--mono);font-size:8.5px;font-weight:700;letter-spacing:.1em;color:var(--text-4);flex:none}
.sig-rule code{font-family:var(--mono);font-size:11px;color:var(--slate);white-space:nowrap}
.sig-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:11px;border-top:1px solid var(--border)}
.sig-methods{display:flex;gap:6px;flex-wrap:wrap}
.method-chip{font-size:10.5px;font-weight:600;color:var(--text-3);background:var(--bg-3);border:1px solid var(--border);padding:2px 8px;border-radius:5px}
.sig-foot-right{display:flex;align-items:center;gap:13px;flex-wrap:wrap}
.sig-window{display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:10.5px;color:var(--text-4)}
.sig-matched{font-size:11px;font-weight:600;color:var(--text-2)}
.scope-badge{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10px;font-weight:700;
  letter-spacing:.03em;text-transform:uppercase;padding:3px 9px;border-radius:6px;flex:none;white-space:nowrap}
.scope-company{color:#60a5fa;background:rgba(59,130,246,.12)}
.scope-person{color:#a78bfa;background:rgba(167,139,250,.12)}
.scope-both{color:#22d3ee;background:rgba(34,211,238,.12)}
.hyp-list{display:flex;flex-direction:column;gap:8px}
.hyp-card{display:flex;align-items:center;gap:13px;background:var(--bg-2);border:1px solid var(--border);border-radius:11px;padding:12px 15px}
.hyp-idx{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--text-4);flex:none}
.hyp-body{flex:1;min-width:0}
.hyp-stmt{font-size:13px;font-weight:600;line-height:1.4}
.hyp-roles{font-size:11px;color:var(--text-3);margin-top:3px;font-family:var(--mono)}
.evidence-rule{display:flex;align-items:center;gap:9px;margin:22px 0 4px;font-size:11.5px;color:var(--text-4);font-style:italic}
.evidence-rule .ic{color:var(--text-4)}
.md-list{background:var(--bg-1);border:1px solid var(--border);border-radius:12px;overflow:hidden;max-width:900px}
.md-co{display:flex;align-items:center;gap:12px;padding:12px 15px;border-bottom:1px solid var(--border)}
.md-co:last-child{border-bottom:none}
.md-co:hover{background:var(--bg-2)}
.md-co-ic{color:var(--text-3)}
.md-co-id{flex:1;min-width:0}
.md-co-name{display:block;font-size:13px;font-weight:600}
.md-co-sub{display:block;font-size:11.5px;color:var(--text-3)}
.md-co-meta{font-size:11.5px;color:var(--text-3);font-family:var(--mono)}
.match-sig{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:10.5px;color:var(--text-3);
  background:var(--bg-1);border:1px solid var(--border);padding:2px 8px;border-radius:6px;white-space:nowrap;
  max-width:230px;overflow:hidden;text-overflow:ellipsis}
.match-sig .ic{color:var(--text-4);flex:none}
.rel-gap{display:flex;align-items:center;gap:8px;font-size:12px;color:#fbbf24;padding:10px 16px;
  background:rgba(245,158,11,.07);border:1px solid var(--border);border-radius:10px;margin-bottom:11px}
.activity-note{display:flex;align-items:flex-start;gap:9px;font-size:12px;line-height:1.5;color:var(--text-2);
  background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;margin-bottom:12px;max-width:900px}
.activity-note .ic{color:var(--text-4);flex:none;margin-top:1px}
.motion-activity-timeline{background:var(--bg-1);border:1px solid var(--border);border-radius:12px;padding:14px 16px;max-width:900px}
.motion-activity-timeline .tl{margin:0}
.plan-list{display:flex;flex-direction:column;background:var(--bg-2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:14px}
.plan-row{display:flex;align-items:center;gap:11px;padding:11px 15px}
.plan-row:not(:last-child){border-bottom:1px solid var(--border)}
.plan-ic{color:var(--text-4)}
.plan-text{flex:1;font-size:12.5px}
.md-stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.md-tile{display:flex;flex-direction:column;gap:5px;align-items:flex-start;background:var(--bg-2);border:1px solid var(--border);
  border-radius:11px;padding:13px 18px;min-width:96px}
.md-tile b{font-size:23px;font-weight:800;letter-spacing:-.03em}
.md-tile em{font-style:normal;font-size:10.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;font-family:var(--mono)}
.plan-stats .md-ready{display:flex;align-items:center;gap:8px}
.plan-stats .md-ready .ready-bar{width:60px}
.plan-stats .md-ready em{font-style:normal;font-size:13px;font-weight:800;color:var(--text)}

/* ---------- prospects ---------- */
.seg{display:flex;background:var(--bg-2);border:1px solid var(--border);border-radius:9px;padding:2px}
.seg label{border:none;background:none;color:var(--text-3);padding:5px 14px;border-radius:7px;cursor:pointer;
  font-size:12.5px;font-weight:600;user-select:none}
.seg-toggle{position:absolute;opacity:0;pointer-events:none}
#pr-all:checked~.dom-wrap .seg label[for=pr-all],
#pr-company:checked~.dom-wrap .seg label[for=pr-company]{background:var(--bg-hover);color:var(--text)}
.pr-company-view{display:none}
#pr-company:checked~.dom-wrap .pr-all-view{display:none}
#pr-company:checked~.dom-wrap .pr-company-view{display:block}
.pr-table{background:var(--bg-1);border:1px solid var(--border);border-radius:13px;overflow:hidden;max-width:1120px}
.pr-head,.pr-row{display:grid;grid-template-columns:1.5fr 1.6fr 1.1fr 1.4fr 1fr .85fr 1.1fr .5fr;align-items:center;gap:12px;padding:11px 16px}
.pr-head{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4);border-bottom:1px solid var(--border)}
.pr-row{border-bottom:1px solid var(--border)}
.pr-row:last-child{border-bottom:none}
.pr-row:hover{background:var(--bg-2)}
.pr-name{display:flex;align-items:center;gap:9px;font-weight:600;font-size:12.5px;color:var(--text)}
.pr-name:hover{color:var(--accent)}
.pr-title,.pr-co,.pr-signal{font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pr-co{color:var(--text-2)}
.pr-co:hover{color:var(--accent)}
.pr-age{font-family:var(--mono);font-size:11px;color:var(--text-3)}
.pr-groups{display:flex;flex-direction:column;gap:16px;max-width:1120px}
.pr-group{background:var(--bg-1);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.pr-group-head{position:relative;display:flex;align-items:center;gap:11px;width:100%;padding:14px 16px 14px 18px;
  background:var(--bg-3);border:none;border-bottom:1px solid var(--border);color:var(--text);cursor:pointer;text-align:left;transition:background .14s}
.pr-group-head::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent);opacity:.55;transition:opacity .14s}
.pr-group-head:hover{background:var(--bg-hover)}
.pr-group-head:hover::before{opacity:1}
.pr-group-head .ic{color:var(--accent);flex:none}
.pgh-name{font-size:15px;font-weight:700;letter-spacing:-.01em;color:var(--text);white-space:nowrap}
.pgh-link:hover{color:var(--accent)}
.pgh-sub{font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pgh-count{margin-left:auto;font-family:var(--mono);font-size:11px;font-weight:600;color:var(--text-2);background:var(--bg-1);
  border:1px solid var(--border);padding:3px 10px;border-radius:10px;flex:none}
.pgh-go{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;color:var(--accent);flex:none}
.pgh-go .ic{color:var(--accent);transition:transform .14s}
.pr-group-head:hover .pgh-go .ic{transform:translateX(2px)}
.pr-grow{display:flex;align-items:center;gap:12px;padding:11px 16px;border-bottom:1px solid var(--border);
  width:100%;background:none;border-left:none;border-right:none;border-top:none;cursor:pointer;text-align:left}
.pr-grow:last-child{border-bottom:none}
.pr-grow:hover{background:var(--bg-2)}
.pr-grow-id{flex:1;min-width:0}
.pr-grow-name{display:block;font-size:13px;font-weight:600;color:var(--text)}
.pr-grow-sub{display:block;font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pr-grow-signal{font-size:11px;color:var(--text-3);width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pr-grow-go{color:var(--text-4);flex:none;transition:transform .14s,color .14s}
.pr-grow:hover .pr-grow-go{color:var(--accent);transform:translateX(2px)}
.pr-channels,.pr-grow-channels{display:inline-flex;align-items:center;gap:6px;flex:none}
.pr-channel{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;
  background:var(--bg-2);border:1px solid var(--border);color:var(--text-3);text-decoration:none;
  transition:background .14s,border-color .14s,color .14s,transform .14s}
.pr-channel:hover{background:var(--bg-3);border-color:var(--border-2);transform:translateY(-1px)}
.pr-channel:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 58%,transparent);outline-offset:2px}
.pr-channel .ic{color:inherit}
.pr-channel-linkedin{color:#60a5fa}
.pr-channel-email{color:#a78bfa}
.pr-channel-phone{color:#4ade80}
.pr-channels-empty{font-family:var(--mono);font-size:11px;color:var(--text-4)}

/* ---------- engagement timeline ---------- */
.tl{list-style:none;margin:6px 0 4px;padding:0;position:relative}
.tl::before{content:"";position:absolute;left:11px;top:6px;bottom:14px;width:1px;background:var(--border-2)}
.tl-item{position:relative;display:flex;gap:14px;padding:0 0 16px 0}
.tl-item:last-child{padding-bottom:2px}
.tl-dot{flex:none;width:23px;height:23px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;
  background:var(--bg-3);border:1px solid var(--border-2);color:var(--text-2);z-index:1}
.tl-dot .ic{width:12px;height:12px}
.tl-in .tl-dot{background:color-mix(in srgb,var(--green) 16%,var(--bg-3));border-color:color-mix(in srgb,var(--green) 40%,transparent);color:var(--green)}
.tl-out .tl-dot{background:color-mix(in srgb,var(--accent) 16%,var(--bg-3));border-color:color-mix(in srgb,var(--accent) 40%,transparent);color:var(--accent)}
.tl-good .tl-dot{background:color-mix(in srgb,var(--green) 18%,var(--bg-3));border-color:color-mix(in srgb,var(--green) 46%,transparent);color:var(--green)}
.tl-bad .tl-dot{background:color-mix(in srgb,var(--red) 16%,var(--bg-3));border-color:color-mix(in srgb,var(--red) 42%,transparent);color:var(--red)}
.tl-sys .tl-dot{color:var(--text-3)}
.tl-body{flex:1;min-width:0;padding-top:2px}
.tl-head{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.tl-title{font-size:13px;font-weight:600;color:var(--text)}
/* outcome chip — distinct class from the tone token .tl-out (which also lands on
   the row li via the tl-(tone) class); the names must not collide or the whole
   row inherits this uppercase mono styling. */
.tl-outcome{font-family:var(--mono);font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3);
  background:var(--bg-2);border:1px solid var(--border);border-radius:5px;padding:1px 6px}
.tl-good .tl-outcome{color:var(--green);border-color:color-mix(in srgb,var(--green) 35%,transparent)}
.tl-bad .tl-outcome{color:var(--red);border-color:color-mix(in srgb,var(--red) 35%,transparent)}
.tl-time{margin-left:auto;font-size:11px;color:var(--text-4);white-space:nowrap}
.tl-detail{font-size:12.5px;color:var(--text-2);margin:3px 0 0;line-height:1.45}
.tl-rationale strong{color:var(--text)}
.tl-link{display:inline-flex;align-items:center;gap:4px;margin-top:5px;font-size:11px;color:var(--accent)}
.tl-link:hover{text-decoration:underline}
/* message timeline entries — the message body with a lifecycle status chip */
.tl-item{padding-bottom:18px}
.tl-status{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;
  border-radius:5px;padding:1px 7px;border:1px solid var(--border-2);color:var(--text-3);background:var(--bg-2)}
.tl-status-queued{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 38%,transparent);
  background:color-mix(in srgb,var(--accent) 12%,transparent)}
.tl-status-ready{color:#60a5fa;border-color:color-mix(in srgb,#60a5fa 38%,transparent);
  background:color-mix(in srgb,#60a5fa 12%,transparent)}
.tl-status-drafting{color:var(--text-2);border-color:var(--border-2);background:var(--bg-1)}
.tl-status-sent{color:var(--green);border-color:color-mix(in srgb,var(--green) 38%,transparent);
  background:color-mix(in srgb,var(--green) 12%,transparent)}
.tl-status-blocked{color:var(--red);border-color:color-mix(in srgb,var(--red) 38%,transparent);
  background:color-mix(in srgb,var(--red) 12%,transparent)}
.tl-status-received{color:var(--violet);border-color:color-mix(in srgb,var(--violet) 38%,transparent);
  background:color-mix(in srgb,var(--violet) 14%,transparent)}
.tl-message{margin:8px 0 0;padding:11px 13px;border-left:2px solid var(--border-3);background:var(--bg-2);
  border-radius:0 9px 9px 0;font-size:13px;line-height:1.55;color:var(--text);white-space:pre-wrap}
.tl-byline{margin-top:6px;font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-4)}
/* operator note / agent steer timeline entries */
.tl-note .tl-dot{color:var(--text-3)}
.tl-steer .tl-dot{background:color-mix(in srgb,var(--amber) 16%,var(--bg-3));border-color:color-mix(in srgb,var(--amber) 42%,transparent);color:var(--amber)}
.tl-status-steer{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 40%,transparent);background:color-mix(in srgb,var(--amber) 13%,transparent)}
.tl-notebody{margin:8px 0 0;padding:10px 13px;border-radius:9px;font-size:13px;line-height:1.55;color:var(--text);white-space:pre-wrap;
  background:var(--bg-2);border:1px solid var(--border)}
.tl-steer .tl-notebody{border-left:2px solid color-mix(in srgb,var(--amber) 50%,transparent);
  background:color-mix(in srgb,var(--amber) 6%,var(--bg-2))}
.tl-add{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--accent);cursor:pointer}
.tl-add:hover{text-decoration:underline}
.tl-add .ic{width:12px;height:12px}
/* context slide-over premise */
.sig-meta{font-size:11.5px;color:var(--text-4);line-height:1.45;margin:0}
.ctx-premise{font-size:14px;line-height:1.5;font-weight:600;color:var(--text);margin:2px 0 0}

/* ---------- company detail ---------- */
.company-detail{max-width:920px;scroll-margin-top:18px}
.co-head{display:flex;align-items:center;gap:16px;margin-bottom:calc(20px * var(--space-scale))}
.co-name{font-size:22px;font-weight:700;letter-spacing:-.02em;color:var(--text)}
.co-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:9px}
.co-link{display:inline-flex;align-items:center;gap:6px;background:var(--bg-2);border:1px solid var(--border);color:var(--text-2);
  padding:4px 11px;border-radius:8px;font-size:12px;font-weight:600;transition:border-color .14s,color .14s}
.co-link .ic{color:var(--accent)}
.co-link:not(.is-static):hover{border-color:var(--border-3);color:var(--text)}
.co-link.is-static{cursor:default}
.co-motions{display:flex;flex-direction:column;gap:8px}
.co-motion{display:flex;align-items:center;gap:8px;background:var(--bg-2);border:1px solid var(--border);border-radius:10px;
  padding:11px 14px;transition:border-color .14s,background .14s}
.co-motion:hover{border-color:var(--border-3);background:var(--bg-3)}
.co-motion-go{margin-left:auto;color:var(--text-4)}

/* ---------- person detail ---------- */
.person-detail{max-width:920px;scroll-margin-top:18px}
.person-detail+.person-detail{margin-top:34px;padding-top:30px;border-top:1px solid var(--border)}
.pd-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;column-gap:16px;row-gap:11px;margin-bottom:calc(18px * var(--space-scale))}
.pd-id{min-width:0}
.pd-back{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4);
  display:inline-flex;align-items:center;gap:5px;margin-bottom:9px}
.pd-back:hover{color:var(--text-2)}
.pd-name{font-size:22px;font-weight:700;letter-spacing:-.02em;color:var(--text)}
.pd-title{font-size:13.5px;color:var(--text-2);margin-top:3px}
.pd-rail{grid-column:2 / -1;display:flex;align-items:center;gap:11px;flex-wrap:wrap}
.pd-rail .surface-ref{font-size:11px;color:var(--text-3)}
.pd-rail .surface-ref .ic{color:var(--text-4)}
.pd-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:0 0 18px}
.pd-fact{display:flex;flex-direction:column;gap:6px;background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:13px 14px}
.pd-fact-k{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
.pd-fact-v{font-size:13.5px;line-height:1.45;color:var(--text);font-weight:600}
.pd-co-link{display:inline-flex;align-items:center;gap:6px;background:var(--bg-2);border:1px solid var(--border);color:var(--text-2);
  padding:4px 11px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;transition:border-color .14s,color .14s}
.pd-co-link .ic{color:var(--accent)}
.pd-co-link:hover{border-color:var(--border-3);color:var(--text)}
.pd-meta-link{color:var(--text-2)}
.pd-meta-link:hover{color:var(--text)}
.pd-div{width:1px;height:14px;background:var(--border-2)}
.pd-actions{display:flex;align-items:center;gap:9px;flex:none;justify-self:end}
.next-alert{display:flex;align-items:flex-start;gap:9px;background:var(--bg-2);border:1px solid var(--border);
  border-radius:12px;padding:11px 14px;margin:4px 0 18px}
.next-alert>.ic{color:var(--accent);flex:none;margin-top:2px}
.next-alert-copy{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 8px;min-width:0;font-size:13px;line-height:1.45;color:var(--text-2)}
.next-alert-label{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4);flex:none}
.next-alert-copy strong{color:var(--text);font-weight:700}
.next-alert-meta{font-size:11px;color:var(--text-4)}
.pd-signal{max-width:none}
.pd-next-card{padding:15px 18px}
.pd-next-title{font-size:14px;font-weight:700;color:var(--text);margin:0 0 4px}
.pd-premise{position:relative;overflow:hidden;
  background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 6%,var(--bg-2)),var(--bg-2));
  border:1px solid color-mix(in srgb,var(--accent) 26%,transparent);border-radius:var(--r-card);padding:17px 19px}
.pd-premise::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent)}
.pd-premise-stmt{font-size:16px;line-height:1.45;font-weight:600;letter-spacing:-.01em;color:var(--text);max-width:740px;margin-top:11px}
.pd-motion-link{display:inline-flex;align-items:center;gap:9px;background:var(--bg-1);border:1px solid var(--border);color:var(--text);
  padding:8px 13px;border-radius:9px;cursor:pointer;font-size:12.5px;font-weight:600;margin-top:14px;transition:border-color .14s,background .14s}
.pd-motion-link:hover{border-color:var(--border-3);background:var(--bg-3)}
.pd-motion-link .pml-meta{font-family:var(--mono);font-size:11px;color:var(--text-3);font-weight:500}
.pd-motion-link>.ic:last-child{color:var(--text-4)}
.pd-matched{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--text-2);
  background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:10px;padding:10px 14px;margin-bottom:16px}
.pd-matched .ic{color:var(--green)}
.pd-matched-link{display:inline-flex;align-items:center;gap:4px;color:var(--accent);font-weight:600;margin-left:auto}
.pd-matched-link .ic{color:var(--accent)}
.md-co-go{color:var(--text-4);flex:none;transition:transform .14s,color .14s}
.md-co.is-link{width:100%;background:none;border:none;border-bottom:1px solid var(--border);cursor:pointer;text-align:left;font:inherit}
.md-co.is-link:last-child{border-bottom:none}
.md-co.is-link:hover .md-co-go{color:var(--accent);transform:translateX(2px)}

/* ---------- queued Exo action affordance ---------- */
.exo-actions{display:flex;flex-direction:column;gap:8px;max-width:900px}
.exo-action{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--bg-1);
  border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.exo-action-flat{background:transparent;border:none;border-radius:0;padding:0}
.exo-cmd{font-family:var(--mono);font-size:11px;color:var(--text-3);background:var(--bg);border:1px solid var(--border);
  border-radius:6px;padding:5px 8px;overflow-x:auto;white-space:nowrap;flex:1;min-width:0}
.exo-cmd::selection{background:color-mix(in srgb,var(--accent) 35%,transparent)}

/* ---------- compose panel (slide-over) ---------- */
.compose-panel{position:fixed;inset:0;z-index:70;display:none}
.compose-panel:target{display:block}
.compose-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}
.compose-sheet{position:absolute;top:0;right:0;bottom:0;width:min(560px,100%);background:var(--bg-1);
  border-left:1px solid var(--border-2);box-shadow:-24px 0 60px -20px rgba(0,0,0,.6);
  display:flex;flex-direction:column;padding:20px 22px;gap:14px;overflow-y:auto}
.compose-head{display:flex;align-items:flex-start;gap:11px}
.compose-head .ic{color:var(--accent)}
.compose-title{font-size:15px;font-weight:700;letter-spacing:-.01em}
.compose-sub{font-size:12px;color:var(--text-3);margin-top:2px}
.compose-close{margin-left:auto;color:var(--text-3);background:none;border:1px solid var(--border);border-radius:8px;
  width:30px;height:30px;display:grid;place-items:center;cursor:pointer}
.compose-close:hover{color:var(--text);background:var(--bg-3)}
.compose-chan{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);
  border-radius:6px;padding:3px 8px}
.compose-field{display:flex;flex-direction:column;gap:5px}
.compose-label{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4)}
.compose-input,.compose-body{background:var(--bg-2);border:1px solid var(--border-2);border-radius:9px;color:var(--text);
  font-family:var(--sans);font-size:13px;padding:10px 12px;width:100%;resize:vertical}
.compose-body{min-height:200px;line-height:1.55}
.compose-input:focus,.compose-body:focus{outline:none;border-color:color-mix(in srgb,var(--accent) 55%,transparent)}
.compose-meta{display:flex;align-items:center;gap:9px;font-size:11px;color:var(--text-3)}
.compose-byline{display:inline-flex;align-items:center;gap:6px}
.compose-actions{display:flex;align-items:center;gap:9px;margin-top:auto;padding-top:8px;border-top:1px solid var(--border)}
.compose-empty{font-size:12px;color:var(--text-4);font-style:italic}
.rehome-list{display:flex;flex-direction:column;gap:6px}
.rehome-opt{display:flex;align-items:flex-start;gap:10px;background:var(--bg-2);border:1px solid var(--border-2);
  border-radius:9px;padding:10px 12px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-2)}
.rehome-opt:hover{border-color:var(--border-3);color:var(--text)}
.rehome-opt input{accent-color:var(--accent);margin-top:2px;flex:none}
.rehome-copy{display:flex;flex-direction:column;gap:7px;min-width:0}
.rehome-detail{display:flex;flex-direction:column;gap:2px;min-width:0}
.rehome-cap{font-family:var(--mono);font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:var(--text-4)}
.rehome-offer{font-size:13px;line-height:1.45;font-weight:700;color:var(--text)}
.rehome-text{font-size:12px;line-height:1.45;font-weight:500;color:var(--text-2)}
.rehome-code{font-family:var(--mono);font-size:11.5px;color:var(--text-3)}
.cap-note{display:flex;align-items:flex-start;gap:9px;font-size:12px;line-height:1.5;color:var(--text-2);
  background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:9px;padding:11px 13px}
.cap-note .ic{color:var(--amber);flex:none;margin-top:1px}
.cap-note strong{color:var(--text)}
.cap-note.ok{background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.3)}
.cap-note.ok .ic{color:var(--green)}
.op-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#34d399;
  background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.28);border-radius:6px;padding:2px 8px;cursor:default}
.op-chip .ic{color:#34d399}
.deg-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;font-family:var(--mono);
  color:var(--text-2);background:var(--bg-2);border:1px solid var(--border-2);border-radius:6px;padding:2px 8px;cursor:default}
.deg-chip.deg-1{color:var(--green);background:color-mix(in srgb,var(--green) 12%,transparent);border-color:color-mix(in srgb,var(--green) 32%,transparent)}
.deg-chip.deg-1 .ic{color:var(--green)}
.pl-degree{display:flex;align-items:flex-start;gap:6px;font-size:12px;color:var(--text-2);margin:0 0 16px;
  padding:8px 11px;background:color-mix(in srgb,var(--green) 6%,var(--bg-2));border:1px solid var(--border);
  border-left:2px solid color-mix(in srgb,var(--green) 45%,transparent);border-radius:8px}
.pl-degree .ic{color:var(--green);flex:none;margin-top:2px}
.pl-degree strong{color:var(--text)}

/* full-width detail pages */
.canvas.is-detail .dom-wrap,
.canvas.is-detail .company-detail,
.canvas.is-detail .person-detail,
.canvas.is-detail .motion-detail,
.canvas.is-detail .exec-detail,
.canvas.is-detail .exec-two,
.canvas.is-detail .md-list,
.canvas.is-detail .signal-card,
.canvas.is-detail .pr-table{max-width:none}

/* assign + assignable owner */
.pd-assign{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--accent);
  background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 30%,transparent);
  border-radius:8px;padding:3px 10px}
.pd-assign:hover{background:color-mix(in srgb,var(--accent) 16%,transparent)}
.pd-assign .ic{color:var(--accent)}

/* pipeline stepper */
.pipeline{display:flex;align-items:flex-start;margin:6px 0 12px;max-width:820px}
.pl-step{flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;position:relative}
.pl-step::before{content:"";position:absolute;top:10px;right:50%;width:100%;height:2px;background:var(--border-2)}
.pl-step:first-child::before{display:none}
.pl-step.reached::before{background:var(--accent)}
.pl-dot{width:21px;height:21px;border-radius:50%;background:var(--bg-3);border:2px solid var(--border-2);
  position:relative;z-index:1;display:grid;place-items:center;color:#fff}
.pl-step.reached .pl-dot{background:var(--accent);border-color:var(--accent)}
.pl-step.current .pl-dot{background:var(--bg);border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)}
.pl-step.current .pl-dot i{width:7px;height:7px;border-radius:50%;background:var(--accent)}
.pl-label{font-size:10px;font-family:var(--mono);letter-spacing:.03em;text-transform:uppercase;color:var(--text-4);text-align:center;max-width:100px}
.pl-step.reached .pl-label{color:var(--text-2)}
.pl-step.current .pl-label{color:var(--text)}
.pl-now{font-size:12.5px;color:var(--text-2);margin:-4px 0 16px}
.pl-now strong{color:var(--text)}

/* ---------- toasts (interactive) ---------- */
#exo-toasts{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);display:flex;flex-direction:column;
  gap:8px;z-index:60;align-items:center}
.exo-toast{display:inline-flex;align-items:center;gap:8px;background:var(--bg-3);border:1px solid var(--border-2);
  color:var(--text);font-size:12.5px;font-weight:600;padding:9px 15px;border-radius:10px;
  box-shadow:0 8px 28px -8px rgba(0,0,0,.6);max-width:560px;transition:opacity .3s,transform .3s}
.exo-toast.ok{border-color:rgba(34,197,94,.4)}
.exo-toast.ok::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green)}
.exo-toast.err{border-color:rgba(239,68,68,.45)}
.exo-toast.err::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--red)}
.exo-toast.leaving{opacity:0;transform:translateY(8px)}
.exo-refresh-pill{position:fixed;right:22px;bottom:22px;z-index:61;display:inline-flex;align-items:center;gap:8px;
  background:var(--accent);color:#fff;border:none;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;
  padding:10px 16px;border-radius:999px;box-shadow:0 10px 30px -8px color-mix(in srgb,var(--accent) 60%,transparent)}
.exo-refresh-pill::before{content:"";width:7px;height:7px;border-radius:50%;background:#fff;animation:exo-pulse 1.6s ease-in-out infinite}
@keyframes exo-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.exo-refresh-pill:hover{filter:brightness(1.08)}
.exo-server-banner{position:fixed;left:0;right:0;top:0;z-index:80;background:rgba(239,68,68,.95);color:#fff;
  font-size:13px;font-weight:600;padding:10px 18px;text-align:center;
  box-shadow:0 6px 16px -8px rgba(239,68,68,.6)}
.exo-server-banner code{background:rgba(0,0,0,.25);padding:1px 6px;border-radius:4px;font-weight:700}
.exo-server-banner strong{margin-right:6px}
body.exo-server-down{padding-top:42px}
body.exo-server-down .exo-action button{cursor:not-allowed;opacity:.55}
.btn-busy{opacity:.92;cursor:progress}
.btn-done{background:rgba(34,197,94,.16) !important;color:#4ade80 !important;border-color:rgba(34,197,94,.4) !important;box-shadow:none !important}

/* ---------- execution ---------- */
.ws-panel-head{display:flex;align-items:center;gap:8px;margin-bottom:13px}
.ws-panel-head .ic{color:var(--text-3)}
.ws-panel-head h3{font-size:13.5px;font-weight:700;flex:1}
.ws-head-right{display:flex;gap:6px;margin-left:auto}
.user-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;max-width:1000px}
.user-card{display:flex;align-items:center;gap:13px;background:var(--bg-2);border:1px solid var(--border);border-radius:13px;
  padding:15px;cursor:pointer;text-align:left;transition:border-color .14s,background .14s}
.user-card:hover{border-color:var(--border-3);background:var(--bg-3)}
.uc-id{flex:1;min-width:0}
.uc-name{display:block;font-size:14px;font-weight:700;color:var(--text)}
.uc-sub{display:block;font-size:11.5px;color:var(--text-3)}
.uc-meta{display:flex;flex-direction:column;gap:2px;text-align:right;font-size:10.5px;color:var(--text-3);font-family:var(--mono)}
.uc-meta span{white-space:nowrap}
.uc-meta b{color:var(--text);font-size:13px}
.uc-go{color:var(--text-4)}
.exec-detail{max-width:1000px;scroll-margin-top:18px}
.exec-detail+.exec-detail{margin-top:34px;padding-top:30px;border-top:1px solid var(--border)}
.exec-back{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4);
  display:inline-flex;align-items:center;gap:5px;margin-bottom:9px}
.exec-back:hover{color:var(--text-2)}
.exec-two{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:1000px;align-items:start}
.exec-card{background:var(--bg-1);border:1px solid var(--border);border-radius:13px;padding:15px}
.exec-mrow{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)}
.exec-mrow:last-child{border-bottom:none}
.exec-mname{flex:1;font-size:13px;font-weight:600;color:var(--text)}
.exec-mready{width:80px}
.exec-mready .ready-bar{width:100%}
.exec-mmeta{font-size:11px;color:var(--text-3);font-family:var(--mono)}
.exec-acct{display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--border)}
.exec-acct:last-child{border-bottom:none}
.exec-claim-row{display:flex;align-items:center;gap:11px;padding:12px 0;border-bottom:1px solid var(--border)}
.exec-claim-row:last-child{border-bottom:none}
.exec-claim-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.exec-claim-host{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.exec-claim-input{width:180px;min-height:36px;padding:8px 10px;font-size:12.5px}
.exec-claim-state{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-4)}
.wa-ic{color:var(--text-3)}
.wa-id{flex:1;min-width:0}
.wa-handle{display:block;font-size:12.5px;font-weight:600;color:var(--text)}
.wa-cap{display:block;font-size:10.5px;color:var(--text-3);font-family:var(--mono);letter-spacing:-.01em}
.exec-block{display:flex;align-items:center;gap:11px;padding:10px 0;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-2)}
.exec-block:last-child{border-bottom:none}
.cap-cover{display:flex;flex-wrap:wrap;gap:8px}
.cap-pill{display:inline-flex;align-items:center;gap:6px;background:var(--bg-2);border:1px solid var(--border);
  border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:600;color:var(--text-2)}
.cap-pill .truth-tag{margin-left:2px}
.exec-working{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-3);font-family:var(--mono)}
.settings-page{max-width:1120px}
.exec-policy-card{margin-bottom:16px;max-width:1120px}
.exec-policy-lead{font-size:12px;line-height:1.5;color:var(--text-2);margin:0 0 14px;max-width:760px}
.exec-policy-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.exec-policy-lane{background:var(--bg-2);border:1px solid var(--border);border-radius:11px;padding:12px}
.exec-policy-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.exec-policy-head h4{font-size:12px;font-weight:700;color:var(--text)}
.exec-policy-head span{font-size:10.5px;color:var(--text-4);font-family:var(--mono);text-transform:uppercase;letter-spacing:.08em}
.exec-policy-rows{display:flex;flex-direction:column;gap:0}
.exec-policy-row,.exec-policy-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--border)}
.exec-policy-row:first-child,.exec-policy-toggle:first-child{border-top:none;padding-top:0}
.exec-policy-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.exec-policy-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;font-weight:700;color:var(--text)}
.exec-policy-sub{font-size:10px;line-height:1.35;color:var(--text-4);font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase}
.exec-policy-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:nowrap}
.exec-policy-rules{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.exec-policy-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;font-size:10.5px;color:var(--text-4);font-family:var(--mono)}

/* ---------- connections / inbound truth ---------- */
.conn-main{background:var(--bg-1);border:1px solid var(--border);border-radius:13px;overflow:hidden;max-width:1060px}
.conn-fresh{margin-top:16px;max-width:1060px;background:var(--bg-1);border:1px solid var(--border);border-radius:13px;padding:13px 15px}
.conn-fresh-head{display:flex;align-items:center;gap:8px;margin-bottom:12px;white-space:nowrap}
.conn-fresh-head .ic{color:var(--text-4)}
.conn-fresh-head h3{font-size:12.5px;font-weight:700}
.conn-fresh-head span{font-size:11px;color:var(--text-4)}
.conn-fresh-row{display:flex;flex-wrap:wrap;gap:8px}
.fresh-chip{display:inline-flex;align-items:center;gap:10px;background:var(--bg-2);border:1px solid var(--border);
  border-radius:9px;padding:7px 12px;cursor:pointer}
.fresh-chip:hover{background:var(--bg-3)}
.fresh-chip.static{cursor:default;opacity:.7}
.fresh-name{font-size:12px;font-weight:600;white-space:nowrap}
.rel-tabs{display:flex;gap:2px;padding:8px 8px 0;border-bottom:1px solid var(--border);flex-wrap:wrap}
.rel-tab{display:inline-flex;align-items:center;gap:7px;background:none;border:none;color:var(--text-3);
  padding:9px 13px;border-radius:8px 8px 0 0;cursor:pointer;font-size:13px;font-weight:600;
  border-bottom:2px solid transparent;margin-bottom:-1px;user-select:none}
.rel-tab:hover{color:var(--text-2);background:var(--bg-2)}
.rel-tab .ic{color:var(--text-4)}
.rel-tab-n{font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--text-3);
  background:var(--bg-3);padding:1px 6px;border-radius:10px}
.rel-fresh{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px;
  border-bottom:1px solid var(--border);background:var(--bg-2)}
.rel-fresh-l{display:flex;align-items:center;gap:13px}
.rel-fresh-title{font-size:13px;font-weight:700}
.sent-filter-bar{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-1);flex-wrap:wrap}
.sent-filter{display:inline-flex;align-items:center;gap:7px;background:var(--bg-2);border:1px solid var(--border);border-radius:999px;
  padding:6px 11px;font-size:11.5px;font-weight:600;color:var(--text-3);cursor:pointer}
.sent-filter:hover{background:var(--bg-3);color:var(--text-2)}
.sent-filter span{font-family:var(--mono);font-size:10.5px;color:var(--text-4)}
.rel-list{display:flex;flex-direction:column}
.rel-panel{display:none}
.person-row{display:flex;align-items:center;gap:13px;padding:13px 16px;border-bottom:1px solid var(--border)}
.person-row:last-child{border-bottom:none}
.person-row:hover{background:var(--bg-2)}
.person-id{flex:1;min-width:0}
.person-name{display:flex;align-items:center;gap:6px;font-weight:700;font-size:13.5px;letter-spacing:-.01em;color:var(--text)}
a.person-link{cursor:pointer}
a.person-link:hover{color:var(--accent)}
.person-name .tgt{color:var(--amber)}
.person-sub{font-size:12px;color:var(--text-2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.person-foot{display:flex;align-items:center;gap:5px;margin-top:3px;font-size:11px}
.person-co{color:var(--accent);font-weight:500}
.person-co.dim{color:var(--text-4)}
.person-when{font-family:var(--mono);font-size:11px;color:var(--text-3);flex:none;width:64px;text-align:right}
.person-actions{display:flex;align-items:center;gap:7px;flex:none}
.row-status{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;border-radius:7px;padding:4px 10px;
  border:1px solid transparent;white-space:nowrap}
.row-status-stale{color:var(--amber);background:color-mix(in srgb,var(--amber) 11%,transparent);
  border-color:color-mix(in srgb,var(--amber) 28%,transparent)}
.row-status-queued{color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent);
  border-color:color-mix(in srgb,var(--accent) 25%,transparent)}
.row-accepted{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--green);
  background:color-mix(in srgb,var(--green) 12%,transparent);border:1px solid color-mix(in srgb,var(--green) 32%,transparent);
  border-radius:7px;padding:4px 10px}
.row-accepted .ic{width:12px;height:12px}
.conn-toggle{position:absolute;opacity:0;pointer-events:none}
#cn-received:checked~.dom-wrap .rp-received,
#cn-sent:checked~.dom-wrap .rp-sent,
#cn-following:checked~.dom-wrap .rp-following,
#cn-followers:checked~.dom-wrap .rp-followers,
#cn-views:checked~.dom-wrap .rp-views{display:block}
#cn-received:checked~.dom-wrap label.rel-tab[for=cn-received],
#cn-sent:checked~.dom-wrap label.rel-tab[for=cn-sent],
#cn-following:checked~.dom-wrap label.rel-tab[for=cn-following],
#cn-followers:checked~.dom-wrap label.rel-tab[for=cn-followers],
#cn-views:checked~.dom-wrap label.rel-tab[for=cn-views]{color:var(--text);border-bottom-color:var(--accent)}
#cn-received:checked~.dom-wrap label.rel-tab[for=cn-received] .ic,
#cn-sent:checked~.dom-wrap label.rel-tab[for=cn-sent] .ic,
#cn-following:checked~.dom-wrap label.rel-tab[for=cn-following] .ic,
#cn-followers:checked~.dom-wrap label.rel-tab[for=cn-followers] .ic,
#cn-views:checked~.dom-wrap label.rel-tab[for=cn-views] .ic{color:var(--accent)}
#cn-received:checked~.dom-wrap label.rel-tab[for=cn-received] .rel-tab-n,
#cn-sent:checked~.dom-wrap label.rel-tab[for=cn-sent] .rel-tab-n,
#cn-following:checked~.dom-wrap label.rel-tab[for=cn-following] .rel-tab-n,
#cn-followers:checked~.dom-wrap label.rel-tab[for=cn-followers] .rel-tab-n,
#cn-views:checked~.dom-wrap label.rel-tab[for=cn-views] .rel-tab-n{color:var(--text);background:color-mix(in srgb,var(--accent) 22%,transparent)}
#cn-sent-filter-all:checked~.dom-wrap .sent-filter[for=cn-sent-filter-all],
#cn-sent-filter-stale:checked~.dom-wrap .sent-filter[for=cn-sent-filter-stale],
#cn-sent-filter-fresh:checked~.dom-wrap .sent-filter[for=cn-sent-filter-fresh]{color:var(--text);border-color:color-mix(in srgb,var(--accent) 35%,transparent);
  background:color-mix(in srgb,var(--accent) 12%,var(--bg-2))}
#cn-sent-filter-all:checked~.dom-wrap .sent-filter[for=cn-sent-filter-all] span,
#cn-sent-filter-stale:checked~.dom-wrap .sent-filter[for=cn-sent-filter-stale] span,
#cn-sent-filter-fresh:checked~.dom-wrap .sent-filter[for=cn-sent-filter-fresh] span{color:var(--text-2)}
#cn-sent-filter-stale:checked~.dom-wrap .rp-sent .person-row[data-sent-group="fresh"],
#cn-sent-filter-fresh:checked~.dom-wrap .rp-sent .person-row[data-sent-group="stale"]{display:none}
.fresh-chip.tgt-on{border-color:color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 9%,var(--bg-2))}

/* ---------- workspace rollup ---------- */
.ws-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.stat-tile{background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px 15px}
.stat-label{font-size:13px;font-weight:700}
.stat-body{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:11px}
.stat-left{min-width:0;flex:1}
.stat-bar{display:flex;gap:3px;height:6px;border-radius:4px;overflow:hidden;margin:0 0 11px;background:var(--bg-3)}
.stat-bar i{border-radius:4px}
.stat-nums{display:flex;gap:16px}
.stat-nums b{font-size:22px;font-weight:800;letter-spacing:-.03em}
.stat-nums em{display:block;font-style:normal;font-size:10px;color:var(--text-3);text-transform:uppercase;
  letter-spacing:.06em;font-family:var(--mono);margin-top:1px}
.stat-sub{font-size:11px;color:var(--text-3);margin-top:8px}
.stat-rate{font-size:20px;font-weight:800;letter-spacing:-.02em;color:var(--text)}
.ws-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;align-items:start}
.ws-panel{background:var(--bg-1);border:1px solid var(--border);border-radius:13px;padding:14px}
.ws-panel.span-2{grid-column:span 2}
.ws-pulse{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.pulse-col{min-width:0}
.pulse-cap{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--text-4);margin-bottom:9px}
.mini-row{display:flex;align-items:center;gap:9px}
.mini-id{flex:1;min-width:0}
.mini-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
.mini-sub{font-size:11px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pulse-tag{margin:8px 0 0}
.ws-motions{display:flex;flex-direction:column;gap:13px}
.wm-top{display:flex;align-items:center;gap:10px;margin-bottom:7px}
.wm-name{font-size:13px;font-weight:600;flex:1;color:var(--text)}
.wm-meta{font-size:11px;color:var(--text-3);margin-top:6px;font-family:var(--mono);letter-spacing:-.01em}
.wm-blocker{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:#fbbf24;margin-top:5px}
.ws-surfaces{display:flex;flex-direction:column}
.ws-surface{display:grid;grid-template-columns:1.1fr auto;gap:6px 12px;padding:9px 0;border-bottom:1px solid var(--border)}
.ws-surface:last-child{border-bottom:none}
.wsf-name{font-size:12.5px;font-weight:600;color:var(--text)}
.wsf-note{grid-column:1/-1;font-size:11px;color:var(--text-3)}
.ws-gaps{display:flex;flex-direction:column}
.ws-gap{padding:11px 0;border-bottom:1px solid var(--border)}
.ws-gap:last-child{border-bottom:none;padding-bottom:0}
.ws-gap-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.ws-gap-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:9px}
.ws-gap-note,.ws-gap-action{font-size:11.5px;line-height:1.45;color:var(--text-3);margin-top:8px}
.ws-gap-action{color:var(--text-2)}
.ws-accounts{display:flex;flex-direction:column}
.ws-account{display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--border)}
.ws-account:last-child{border-bottom:none}
.ws-cap-note{display:flex;align-items:center;gap:7px;font-size:11.5px;color:#fbbf24;margin-top:11px;
  padding-top:11px;border-top:1px solid var(--border)}
@media (max-width:1100px){.ws-grid{grid-template-columns:1fr 1fr}.ws-stats{grid-template-columns:1fr 1fr}.ws-panel.span-2{grid-column:span 2}}
@media (max-width:980px){.pd-head{grid-template-columns:auto minmax(0,1fr)}.pd-actions{grid-column:2/-1;justify-self:start;flex-wrap:wrap}.pd-rail{grid-column:1/-1}.exec-policy-grid,.exec-policy-rules{grid-template-columns:1fr}.exec-policy-row,.exec-policy-toggle{align-items:flex-start;flex-direction:column}.exec-policy-actions{justify-content:flex-start;flex-wrap:wrap}}
`;

/**
 * Render a complete <html>…</html> shell.
 *
 * @param {{
 *   title: string,
 *   activeId: string,
 *   sectionLabel: string,
 *   detailLabel?: string | null,
 *   body: string,
 *   extraCss?: string | null,
 *   extraJs?: string | null,
 *   interactive?: boolean,
 *   detail?: boolean,
 *   agentRuntime?: any,
 *   sectionHref?: string | null,
 *   search?: {
 *     action: string,
 *     query?: string | null,
 *     placeholder?: string | null,
 *     paramName?: string | null,
 *     ariaLabel?: string | null,
 *     clearHref?: string | null,
 *   } | null,
 * }} opts
 */
export function renderShell(opts) {
  // A detail page (single record) drops the search/raised chrome and uses the
  // full canvas width.
  const canvasClass = opts.detail ? "canvas is-detail" : "canvas";
  const bodyClass = `view-${opts.activeId} ${opts.detail ? "is-detail-route" : "is-index-route"}`;
  return (
    `<!DOCTYPE html><html lang="en"><head>` +
    `<meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<meta name="theme-color" content="#0f172a">` +
    `<title>${escapeHtml(opts.title)}</title>` +
    `<link rel="icon" type="image/svg+xml" href="${EXO_FAVICON_DATA_URL}">` +
    FONTS_LINK +
    `<style>${EXO_UI_CSS}${opts.extraCss ?? ""}</style>` +
    `</head><body class="${bodyClass}">` +
    `<div class="exo-root">` +
    navAside({ activeId: opts.activeId, interactive: opts.interactive, nav: opts.agentRuntime?.nav ?? null }) +
    `<div class="main">` +
    topbar({
      sectionLabel: opts.sectionLabel,
      detailLabel: opts.detailLabel ?? null,
      interactive: opts.interactive,
      sectionId: opts.activeId,
      sectionHref: opts.sectionHref ?? null,
      minimalChrome: Boolean(opts.detail),
      agentRuntime: opts.agentRuntime ?? null,
      search: opts.search ?? null,
    }) +
    `<main class="${canvasClass}">${opts.body}</main>` +
    `</div></div>` +
    (opts.interactive ? `<div id="exo-toasts"></div><script>${EXO_CLIENT_JS}</script>${opts.extraJs ? `<script>${opts.extraJs}</script>` : ""}` : "") +
    `</body></html>`
  );
}
