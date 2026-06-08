#!/usr/bin/env node

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isTransitionMotion } from "../src/core/ensure-transition-motion.js";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXO_STATE_DIR = path.join(REPO_ROOT, ".exo");
const USER_ID = "00d08a04-c0b5-457c-8cb0-205c81593224";
const CLI_PATH = path.join(REPO_ROOT, "src/cli/index.js");
const OUTPUT_PATH = path.join(REPO_ROOT, "prototype/motion-workspace.html");
const STALE_HOURS = 24;
const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_REGENERATE_COMMAND = `exo report workspace --user ${USER_ID} --out ./prototype/motion-workspace.html`;
const DEFAULT_WORKSPACE_ACTION_WORKER = "codex-workspace";

async function runJson(args) {
  const { stdout } = await execFileAsync("node", [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      EXO_STATE_DIR,
    },
    maxBuffer: MAX_BUFFER,
  });

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse JSON for exo ${args.join(" ")}\n${stdout}\n${error.message}`);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function startCase(value) {
  const normalized = String(value ?? "")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

  return normalized
    .replaceAll("Linkedin", "LinkedIn")
    .replaceAll("Inmail", "InMail")
    .replaceAll("Gtm", "GTM");
}

function titleizeStatus(value) {
  if (!value) {
    return "Unknown";
  }

  return startCase(value).replace(/\bAvp\b/g, "AVP");
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(items, keyFn) {
  return items.reduce((accumulator, item) => {
    const key = keyFn(item) ?? "unknown";
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function sortByName(items, key = "name") {
  return items.slice().sort((left, right) => {
    const leftValue = String(left[key] ?? "");
    const rightValue = String(right[key] ?? "");
    return leftValue.localeCompare(rightValue);
  });
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestDate(values) {
  return values
    .map((value) => parseDate(value))
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function hoursSince(value, now) {
  const date = parseDate(value);
  if (!date) {
    return null;
  }

  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

function formatTimestamp(value) {
  const date = parseDate(value);
  if (!date) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(value, now) {
  const date = parseDate(value);
  if (!date) {
    return "never";
  }

  const deltaMs = now.getTime() - date.getTime();
  const minutes = Math.round(deltaMs / (1000 * 60));
  const absMinutes = Math.abs(minutes);

  if (absMinutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  const absHours = Math.abs(hours);

  if (absHours < 48) {
    return `${hours}h`;
  }

  const days = Math.round(hours / 24);
  return `${days}d`;
}

function formatCount(value, label) {
  const number = Number(value ?? 0);
  return `${number} ${label}${number === 1 ? "" : "s"}`;
}

function formatListInline(values) {
  return uniqueValues(values).join(" / ") || "None";
}

function compactCountLine(counts) {
  return Object.entries(counts)
    .filter(([, value]) => Number(value) > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([key, value]) => `${value} ${titleizeStatus(key)}`)
    .join(" · ");
}

function latestTouch(prospect) {
  return toArray(prospect.touches)
    .slice()
    .sort((left, right) => {
      const leftAt = parseDate(left.occurredAt)?.getTime() ?? 0;
      const rightAt = parseDate(right.occurredAt)?.getTime() ?? 0;
      return leftAt - rightAt;
    })
    .at(-1) ?? null;
}

function plannerKey(item) {
  return [item.motion?.id, item.company?.id, item.prospect?.id].join("::");
}

function truthSurfaceKey(accountId, surfaceKey) {
  return `${accountId}::${surfaceKey}`;
}

function humanizeCapability(value) {
  if (!value) {
    return "unknown";
  }

  return value.replaceAll("-", " ");
}

function humanizeChannel(value) {
  if (!value || value === "none") {
    return "none";
  }

  return value.replaceAll("-", " ");
}

function initialsFromLabel(value, limit = 2) {
  const tokens = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return "?";
  }

  if (tokens.length === 1) {
    return tokens[0].slice(0, limit).toUpperCase();
  }

  return tokens
    .slice(0, limit)
    .map((token) => token[0])
    .join("")
    .toUpperCase();
}

function stableThemeIndex(value, size) {
  const source = String(value ?? "");
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return size > 0 ? hash % size : 0;
}

function extractHost(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function proxiedImageUrl(value, size = "160x160") {
  const url = String(value ?? "").trim();
  if (!url) {
    return null;
  }

  if (/^https?:\/\/imageproxy\.bizzbridge\.com\//i.test(url)) {
    return url;
  }

  if (!/^https?:\/\//i.test(url)) {
    return null;
  }

  return `https://imageproxy.bizzbridge.com/${size}/${url}`;
}

function renderAvatar(label, imageUrl, kind = "person") {
  const proxied = proxiedImageUrl(imageUrl);
  const themeIndex = stableThemeIndex(`${kind}:${label}`, 6);

  if (proxied) {
    return `
      <span class="avatar avatar-${escapeHtml(kind)} avatar-theme-${themeIndex}">
        <img src="${escapeHtml(proxied)}" alt="${escapeHtml(label)}" loading="lazy">
      </span>
    `;
  }

  return `
    <span class="avatar avatar-${escapeHtml(kind)} avatar-theme-${themeIndex}">
      <span class="avatar-fallback">${escapeHtml(initialsFromLabel(label, kind === "company" ? 1 : 2))}</span>
    </span>
  `;
}

function renderCompanyPill(companyName, websiteUrl, logoUrl = null) {
  const host = extractHost(websiteUrl);

  return `
    <div class="company-pill">
      ${renderAvatar(companyName, logoUrl, "company")}
      <div class="company-pill-copy">
        <strong>${escapeHtml(companyName)}</strong>
        <span>${escapeHtml(host ?? "company identity")}</span>
      </div>
    </div>
  `;
}

const MOTION_DETAIL_ICON_PATHS = {
  home: "M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9",
  chevronR: "m9 6 6 6-6 6",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm6 13 4 4",
  check: "m5 12 5 5 9-11",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",
  spark: "M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6Z",
  link: "M9 15l6-6m-4-3 1-1a4 4 0 0 1 6 6l-1 1m-8 8-1 1a4 4 0 0 1-6-6l1-1",
  building: "M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M15 9h3a1 1 0 0 1 1 1v11M8 7h2M8 11h2M8 15h2",
  users: "M16 19a5 5 0 0 0-10 0M11 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m6 1a3 3 0 0 0 0-6m4 11a4.5 4.5 0 0 0-3.5-4.4",
  flag: "M5 21V4h11l-2 4 2 4H5",
  cpu: "M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 7h10v10H7zM10 10h4v4h-4z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3.5 2",
  refresh: "M4 12a8 8 0 0 1 13.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.7 5.7L4 16m0 4v-4h4",
  arrowR: "M5 12h14m-6-6 6 6-6 6",
  alert: "M12 4 2 20h20L12 4Zm0 6v5m0 3h.01",
  activity: "M3 12h4l3 8 4-16 3 8h4",
};

function renderMotionDetailIcon(name, size = 14, className = "") {
  const path = MOTION_DETAIL_ICON_PATHS[name];
  if (!path) {
    return "";
  }

  return `
    <svg class="md-ic ${escapeHtml(className)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="${escapeHtml(path)}"></path>
    </svg>
  `;
}

function renderShellLogoMark(size = 18) {
  return `
    <svg class="md-ic shell-logo-mark" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 4l8 8-8 8M12 4l8 8-8 8"></path>
    </svg>
  `;
}

function renderWorkspaceShellNavItem({ label, icon, route, active = false }) {
  return `
    <button
      class="nav-item ${active ? "active" : ""}"
      type="button"
      data-nav-item="${escapeHtml(route)}"
      data-nav-label="${escapeHtml(label)}"
      data-nav-route="${escapeHtml(route)}"
      title="${escapeHtml(label)}"
    >
      ${renderMotionDetailIcon(icon, 17)}
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderMotionStateDot(state, label = null) {
  const normalized = String(state ?? "").toLowerCase();
  const meta = {
    active: { color: "#3b82f6", label: "active" },
    draft: { color: "#71717a", label: "draft" },
    paused: { color: "#f59e0b", label: "paused" },
    ready: { color: "#22c55e", label: "ready" },
    waiting: { color: "#94a3b8", label: "waiting" },
    blocked: { color: "#ef4444", label: "blocked" },
    "reply-accepted": { color: "#22c55e", label: "reply / accepted" },
    "sent-pending": { color: "#818cf8", label: "sent / pending" },
    "pinned-ready": { color: "#22c55e", label: "assigned ready" },
    "unassigned-global-ready": { color: "#94a3b8", label: "unassigned" },
    unassigned: { color: "#94a3b8", label: "unassigned" },
  };
  const resolved = meta[normalized] ?? { color: "#94a3b8", label: titleizeStatus(label ?? state ?? "unknown") };

  return `
    <span class="state-dot motion-state-dot">
      <i style="background:${escapeHtml(resolved.color)}"></i>
      ${escapeHtml(titleizeStatus(label ?? resolved.label))}
    </span>
  `;
}

function renderMotionTruthTag(label, tone = "quiet", at = null) {
  const normalizedTone = ["good", "warning", "danger", "accent", "quiet"].includes(tone) ? tone : "quiet";
  return `
    <span class="truth-tag motion-truth-tag truth-${escapeHtml(normalizedTone)}">
      <i></i>
      ${escapeHtml(String(label ?? "quiet").toUpperCase())}
      ${at ? `<em>· ${escapeHtml(at)}</em>` : ""}
    </span>
  `;
}

function renderMotionOwnerTag(label) {
  const ownerLabel = label || "Unassigned";
  return `
    <span class="owner-tag">
      <span class="owner-tag-badge">${escapeHtml(initialsFromLabel(ownerLabel))}</span>
      ${escapeHtml(ownerLabel)}
    </span>
  `;
}

function motionTruthToneFromStatus(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "ready" || normalized === "defined" || normalized === "checked") {
    return "good";
  }
  if (normalized === "draft" || normalized === "partial") {
    return "warning";
  }
  if (normalized === "missing" || normalized === "unchecked" || normalized === "unknown") {
    return "quiet";
  }
  return "quiet";
}

function humanizeSignalScope(scope) {
  if (scope === "company") {
    return { label: "Company-level", className: "scope-company", icon: "building" };
  }
  if (scope === "person") {
    return { label: "Person-level", className: "scope-person", icon: "users" };
  }
  return { label: "Company + person", className: "scope-both", icon: "activity" };
}

function deriveSurfaceMeta(surface, now) {
  const lastMeaningfulAt = latestDate([surface.lastObservedAt, surface.lastSyncedAt]);
  const stale = lastMeaningfulAt
    ? hoursSince(lastMeaningfulAt.toISOString(), now) >= STALE_HOURS
    : false;
  const never = surface.lastRunStatus === "never";
  const disabled = surface.enabled === false;
  const unchecked = never;
  const actionable = Number(surface.lastItemCount ?? 0) > 0 || Boolean(surface.needsItemization);
  const itemizationGap = Boolean(surface.needsItemization);

  let tone = "quiet";
  if (disabled) {
    tone = "disabled";
  } else if (itemizationGap || unchecked) {
    tone = "danger";
  } else if (actionable) {
    tone = "accent";
  } else if (stale) {
    tone = "warning";
  } else if (surface.lastRunStatus === "success") {
    tone = "good";
  }

  const chips = [
    {
      tone: surface.lastRunStatus === "success" ? "good" : unchecked ? "danger" : "warning",
      label: surface.lastRunStatus ?? "unknown",
    },
  ];

  if (unchecked) {
    chips.push({ tone: "danger", label: "unchecked" });
  }

  if (actionable) {
    chips.push({ tone: "accent", label: "actionable" });
  }

  if (itemizationGap) {
    chips.push({ tone: "danger", label: "itemization gap" });
  }

  if (stale && !unchecked) {
    chips.push({ tone: "warning", label: "stale" });
  }

  if (disabled) {
    chips.push({ tone: "disabled", label: "disabled" });
  }

  let freshnessLabel = "Quiet";
  if (unchecked) {
    freshnessLabel = "Never checked";
  } else if (actionable) {
    freshnessLabel = stale ? "Actionable and stale" : "Actionable";
  } else if (stale) {
    freshnessLabel = "Stale";
  } else if (surface.lastRunStatus === "success") {
    freshnessLabel = "Fresh";
  }

  return {
    tone,
    chips,
    actionable,
    unchecked,
    stale,
    itemizationGap,
    freshnessLabel,
    lastMeaningfulAt,
  };
}

function mergeTruthAccounts(user, inboundReview, inbox, now) {
  const reviewAccounts = new Map(
    toArray(inboundReview?.surfaces?.accounts).map((account) => [account.accountId, account]),
  );
  const inboxAccounts = new Map(
    toArray(inbox?.surfaces?.accounts).map((account) => [account.accountId, account]),
  );
  const itemizationGapKeys = new Set(
    toArray(inboundReview?.itemizationGaps).map((gap) => truthSurfaceKey(gap.account?.id, gap.surfaceKey)),
  );

  return toArray(user?.accounts).map((account) => {
    const reviewAccount = reviewAccounts.get(account.id);
    const inboxAccount = inboxAccounts.get(account.id);
    const userSurfaces = new Map(
      toArray(account.inboundSync?.surfaces).map((surface) => [surface.surfaceKey, surface]),
    );
    const reviewSurfaces = new Map(
      toArray(reviewAccount?.surfaces).map((surface) => [surface.key, surface]),
    );
    const inboxSurfaces = new Map(
      toArray(inboxAccount?.surfaces).map((surface) => [surface.key, surface]),
    );

    const surfaceKeys = uniqueValues([
      ...userSurfaces.keys(),
      ...reviewSurfaces.keys(),
      ...inboxSurfaces.keys(),
    ]);

    const surfaces = surfaceKeys.map((key) => {
      const base = userSurfaces.get(key);
      const review = reviewSurfaces.get(key);
      const inboxSurface = inboxSurfaces.get(key);
      const surface = {
        key,
        label: review?.label ?? inboxSurface?.label ?? startCase(key),
        enabled: base?.enabled ?? true,
        truthLevel: review?.truthLevel ?? inboxSurface?.truthLevel ?? "unknown",
        lastRunStatus: review?.lastRunStatus ?? inboxSurface?.lastRunStatus ?? base?.lastRunStatus ?? "never",
        lastSyncedAt: review?.lastSyncedAt ?? inboxSurface?.lastSyncedAt ?? base?.lastSyncedAt ?? null,
        lastObservedAt:
          review?.lastObservedAt ?? inboxSurface?.lastObservedAt ?? base?.lastObservedAt ?? null,
        lastItemCount:
          review?.lastItemCount ?? inboxSurface?.lastItemCount ?? base?.lastItemCount ?? null,
        summary: review?.summary ?? inboxSurface?.summary ?? null,
        recommendedAction:
          review?.recommendedAction ?? inboxSurface?.recommendedAction ?? null,
        observationCount: review?.observationCount ?? 0,
        needsItemization:
          Boolean(review?.needsItemization) ||
          itemizationGapKeys.has(truthSurfaceKey(account.id, key)),
      };

      return {
        ...surface,
        meta: deriveSurfaceMeta(surface, now),
      };
    });

    const orderedSurfaces = surfaces.slice().sort((left, right) => {
      const toneRank = {
        danger: 0,
        accent: 1,
        warning: 2,
        good: 3,
        quiet: 4,
        disabled: 5,
      };
      const leftRank = toneRank[left.meta.tone] ?? 9;
      const rightRank = toneRank[right.meta.tone] ?? 9;

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.label.localeCompare(right.label);
    });

    return {
      id: account.id,
      capability: account.capability,
      handle: account.handle,
      label: account.label,
      preferred: account.preferred,
      sourceType: account.sourceType,
      surfaces: orderedSurfaces,
      actionableSurfaceCount:
        inboxAccount?.actionableSurfaceCount ??
        orderedSurfaces.filter((surface) => surface.meta.actionable).length,
      quietSurfaceCount:
        inboxAccount?.quietSurfaceCount ??
        orderedSurfaces.filter((surface) => !surface.meta.actionable && !surface.meta.unchecked).length,
      uncheckedSurfaceCount:
        inboxAccount?.uncheckedSurfaceCount ??
        orderedSurfaces.filter((surface) => surface.meta.unchecked).length,
    };
  });
}

function deriveCompanyPrepLane(company) {
  if (company.stage === "needs-company-identity" || !company.websiteUrl || !company.linkedinCompanyUrl) {
    return {
      key: "needs-company-identity",
      label: "Needs company identity",
      description: "Canonical website or LinkedIn identity is still missing.",
    };
  }

  if (company.queueStatus === "queued_for_research") {
    return {
      key: "queued-for-research",
      label: "Queued for research",
      description: "Canonical identity exists, but company research is not complete yet.",
    };
  }

  if (company.queueStatus === "researched") {
    return {
      key: "researched",
      label: "Researched / pick prospects",
      description: "Company signals are in, but prospect selection is not complete yet.",
    };
  }

  if (company.queueStatus === "selected") {
    return {
      key: "selected",
      label: "Selected / build branches",
      description: "Prospects exist, but through-lines or opening plans still need work.",
    };
  }

  if (company.queueStatus === "suppressed") {
    return {
      key: "suppressed",
      label: "Suppressed",
      description: "This company is intentionally out of play.",
    };
  }

  if (company.queueStatus === "exhausted") {
    return {
      key: "exhausted",
      label: "Exhausted",
      description: "This company is out of viable next moves right now.",
    };
  }

  return {
    key: "targeting-ready",
    label: "Targeting ready",
    description: "Company identity, signal work, and branch scaffolding are already in place.",
  };
}

function deriveProspectPrepLane(prospect) {
  if (prospect.throughLineStatus !== "ready") {
    return {
      key: "needs-through-line",
      label: "Needs through-line",
      description: "The branch still lacks a defensible reason-to-talk line.",
    };
  }

  if (prospect.openingPlanStatus !== "ready") {
    return {
      key: "needs-opening-plan",
      label: "Needs opening plan",
      description: "The branch lacks a concrete first move and reply path.",
    };
  }

  if (prospect.cadenceStatus !== "ready") {
    return {
      key: "needs-cadence",
      label: "Needs cadence state",
      description: "Exo does not yet have a usable current step and next action.",
    };
  }

  if (prospect.contactEnrichmentState?.status === "pending") {
    return {
      key: "contact-enrichment-pending",
      label: "Contact enrichment pending",
      description: "Core branch logic exists, but direct-channel fallback work is still open.",
    };
  }

  if (prospect.contactEnrichmentState?.status === "exhausted" && !prospect.hasEmailFallback) {
    return {
      key: "primary-only-ready",
      label: "Ready but weak fallback",
      description: "The branch is ready on the primary path, but direct fallback coverage is still thin.",
    };
  }

  return {
    key: "prep-complete",
    label: "Prep complete",
    description: "Through-line, opening plan, cadence, and fallback coverage are all in decent shape.",
  };
}

function deriveEngagementLane(prospect, dailyItem) {
  const cadence = prospect.cadenceState ?? {};
  const lastTouch = latestTouch(prospect);
  const lastOutcome = cadence.lastTouchOutcome ?? lastTouch?.outcome ?? null;
  const nextAction = (dailyItem?.recommendedAction ?? prospect.nextAction ?? cadence.nextAction ?? "").toLowerCase();
  const queueStatus = prospect.queueStatus ?? cadence.status;

  if (queueStatus === "suppressed" || queueStatus === "exhausted" || cadence.status === "exhausted") {
    return {
      key: "exhausted",
      label: "Exhausted",
      description: "No viable branch remains here without new truth.",
    };
  }

  if (lastOutcome === "blocked" || nextAction.includes("blocked")) {
    return {
      key: "blocked",
      label: "Blocked",
      description: "The primary path failed or the channel is blocked.",
    };
  }

  if (hasReplyAcceptedHistory(prospect)) {
    return {
      key: "reply-accepted",
      label: "Reply / accepted",
      description: "The branch already moved off the cold start problem and into live response handling.",
    };
  }

  if (
    dailyItem?.state === "waiting_until" ||
    (!lastOutcome && /wait|hold|patient|reserve/.test(nextAction))
  ) {
    return {
      key: "waiting",
      label: "Waiting",
      description: "This branch is intentionally being held, not actively pushed.",
    };
  }

  if (["sent", "pending"].includes(lastOutcome) && cadence.currentStep === "value-add-email") {
    return {
      key: "waiting",
      label: "Email sent",
      description: "An email is already out and the branch is waiting on their reply.",
    };
  }

  if (["sent", "pending"].includes(lastOutcome)) {
    return {
      key: "sent-pending",
      label: "Sent / pending",
      description: "A touch is already in flight and the branch is now waiting on the other side.",
    };
  }

  return {
    key: "ready",
    label: "Ready",
    description: "The branch is prepped and still waiting for its first governed move.",
  };
}

function hasReplyAcceptedHistory(prospect) {
  const cadenceOutcome = prospect?.cadenceState?.lastTouchOutcome ?? null;
  if (["accepted", "replied", "reply", "positive_reply"].includes(cadenceOutcome)) {
    return true;
  }

  return toArray(prospect?.touches).some((touch) =>
    ["accepted", "replied", "reply", "positive_reply"].includes(touch?.outcome),
  );
}

function buildMotionSummaries(reports, daily, inboundReview) {
  const dailyItems = toArray(daily.items);
  const reviewItems = toArray(inboundReview.reviewItems);

  return reports.map((report) => {
    const motion = report.motion;
    const targeting = report.targeting ?? {};
    const queue = targeting.queue ?? {};
    const companyLoop = targeting.companyLoop ?? {};
    const motionDailyItems = dailyItems.filter((item) => item.motion?.id === motion.id);
    const motionReviewItems = reviewItems.filter((item) => item.motion?.id === motion.id);
    const identityCounts = countBy(toArray(companyLoop.items), (item) => item.executionIdentity?.status ?? "unknown");
    const backlogCompanies = toArray(companyLoop.items)
      .filter((item) => item.stage === "needs-company-identity" || item.stage === "needs-company-research")
      .map((item) => ({
        id: item.companyId,
        name: item.companyName,
        stage: item.stage,
        queueStatus: item.queueStatus ?? "discovered",
      }));

    return {
      id: motion.id,
      name: motion.name,
      status: motion.status,
      updatedAt: motion.updatedAt,
      premiseStatus: motion.premise?.status ?? "unknown",
      overallStage: targeting.overallStage ?? "unknown",
      readyToTarget: Boolean(targeting.readyToTarget),
      readyToEngage: Boolean(targeting.readyToEngage),
      companyCount: companyLoop.companyCount ?? queue.companyCount ?? 0,
      prospectCount: queue.prospectCount ?? report.prospects?.counts?.prospectCount ?? 0,
      readyToSendCount: queue.readyToSendCount ?? 0,
      inventoryTarget: targeting.inventoryTarget ?? null,
      browserGate: targeting.browserGate ?? null,
      executionIdentityCounts: identityCounts,
      dueNowCount: motionDailyItems.filter((item) => item.state === "due_now").length,
      waitingCount: motionDailyItems.filter((item) => item.state === "waiting_until").length,
      reviewCount: motionReviewItems.length,
      nextActions: toArray(targeting.nextActions).slice(0, 3),
      backlogCompanies,
      queueCompanyStatusCounts: queue.companyStatusCounts ?? {},
      queueProspectStatusCounts: queue.prospectStatusCounts ?? {},
    };
  });
}

function flattenCompanyPrep(reports) {
  return reports.flatMap((report) => {
    const motion = report.motion;
    return toArray(report.targeting?.companyLoop?.items).map((company) => ({
      motionId: motion.id,
      motionName: motion.name,
      motionStatus: motion.status,
      ...company,
      lane: deriveCompanyPrepLane(company),
    }));
  });
}

function buildDailyIndex(dailyItems) {
  return new Map(toArray(dailyItems).map((item) => [plannerKey(item), item]));
}

function buildReviewIndex(reviewItems) {
  return new Map(toArray(reviewItems).map((item) => [plannerKey(item), item]));
}

function flattenProspects(reports, dailyIndex, reviewIndex) {
  return reports.flatMap((report) => {
    const motion = report.motion;
    return toArray(report.prospects?.prospects).map((prospect) => {
      const key = [motion.id, prospect.companyId, prospect.prospectId].join("::");
      const dailyItem = dailyIndex.get(key) ?? null;
      const reviewItem = reviewIndex.get(key) ?? null;

      return {
        motionId: motion.id,
        motionName: motion.name,
        motionStatus: motion.status,
        ...prospect,
        lane: deriveProspectPrepLane(prospect),
        engagementLane: deriveEngagementLane(prospect, dailyItem),
        dailyItem,
        reviewItem,
      };
    });
  });
}

function buildGapNotes(truthAccounts, prospects) {
  const notes = [
    {
      title: "Freshness still uses a simple clock",
      body: "Fresh vs stale is currently based on elapsed time since the last sync or observed item, not a surface-specific service level.",
    },
    {
      title: "Prep stages are inferred",
      body: "Company and prospect prep still have to be assembled from queue status, through-lines, opening plans, cadence state, and contact enrichment because there is no single prep-stage field yet.",
    },
  ];

  const accountsWithoutSurfaces = truthAccounts.filter((account) => account.surfaces.length === 0);
  if (accountsWithoutSurfaces.length > 0) {
    notes.push({
      title: "Some accounts still have no visible truth inventory",
      body: `${accountsWithoutSurfaces
        .map((account) => `${account.capability}:${account.handle}`)
        .join(", ")} expose no visible inbound surfaces here, so quiet cannot yet be separated from not instrumented.`,
    });
  }

  const launchStateAmbiguity = prospects.filter((prospect) => {
    const lastOutcome = prospect.cadenceState?.lastTouchOutcome ?? null;
    const nextAction = (prospect.nextAction ?? "").toLowerCase();
    return Boolean(lastOutcome) && /first planned touch|first touch|once launch is approved/.test(nextAction);
  });
  if (launchStateAmbiguity.length > 0) {
    notes.push({
      title: "Some branches still have launch-state ambiguity",
      body: `${launchStateAmbiguity.length} branch${launchStateAmbiguity.length === 1 ? "" : "es"} still read like a first-touch plan even though touches are already recorded. A canonical launch-state field would remove that ambiguity.`,
    });
  }

  return notes;
}

function artifactStatusSeverity(status) {
  if (status === "ready" || status === "live") {
    return "good";
  }

  if (status === "partial" || status === "in-progress") {
    return "warning";
  }

  return "danger";
}

function summarizeArtifactStatus(hasAny, isComplete) {
  if (isComplete) {
    return "ready";
  }

  if (hasAny) {
    return "partial";
  }

  return "missing";
}

function pickFocusMotion(motionSummaries) {
  return motionSummaries
    .slice()
    .sort((left, right) => {
      if (left.status === "active" && right.status !== "active") {
        return -1;
      }

      if (left.status !== "active" && right.status === "active") {
        return 1;
      }

      if (left.dueNowCount !== right.dueNowCount) {
        return right.dueNowCount - left.dueNowCount;
      }

      if (left.readyToSendCount !== right.readyToSendCount) {
        return right.readyToSendCount - left.readyToSendCount;
      }

      const leftUpdated = parseDate(left.updatedAt)?.getTime() ?? 0;
      const rightUpdated = parseDate(right.updatedAt)?.getTime() ?? 0;
      return rightUpdated - leftUpdated;
    })[0] ?? null;
}

function resolveOperatorFocusMotion(motionSummaries, topDueItem) {
  const topDueMotionId = topDueItem?.motion?.id ?? null;
  if (!topDueMotionId) {
    return pickFocusMotion(motionSummaries);
  }

  return motionSummaries.find((motion) => motion.id === topDueMotionId) ?? pickFocusMotion(motionSummaries);
}

function buildOperatorSummary({ user, daily, motionSummaries, truthAccounts, reviewItems, now }) {
  const dueNowItems = toArray(daily.items).filter((item) => item.state === "due_now");
  const waitingItems = toArray(daily.items).filter((item) => item.state === "waiting_until");
  const allSurfaces = truthAccounts.flatMap((account) => account.surfaces);
  const actionableSurfaceCount = allSurfaces.filter((surface) => surface.meta.actionable).length;
  const staleSurfaceCount = allSurfaces.filter((surface) => surface.meta.stale && !surface.meta.unchecked).length;
  const uncheckedSurfaceCount = allSurfaces.filter((surface) => surface.meta.unchecked).length;
  const topDueItem = dueNowItems[0] ?? null;
  const topWaitingItem = waitingItems[0] ?? null;
  const focusMotion = resolveOperatorFocusMotion(motionSummaries, topDueItem);

  let headline = `Operator call for ${user.label}`;
  let nextMove = "No governed move is exposed right now.";
  let why = "The planner does not currently expose due work, so the operator should inspect the focus motion and truth surfaces.";

  if (topDueItem) {
    headline = `Next move for ${user.label}`;
    nextMove = topDueItem.recommendedAction ?? nextMove;
    why = topDueItem.whyItMatters ?? why;
  } else if (focusMotion) {
    headline = `Focus ${focusMotion.name}`;
    nextMove = focusMotion.nextActions[0] ?? "Continue the focus motion using its highest-priority governed next action.";
    why = (focusMotion.inventoryTarget?.shortfall ?? 0) > 0
      ? `This motion only has ${focusMotion.inventoryTarget.availableProspectCount} available prospects against a floor of ${focusMotion.inventoryTarget.minimumAvailableProspects}, so the next move should keep feeding discovery instead of forcing weak-fit branches.`
      : focusMotion.readyToEngage
      ? "This motion already has usable execution inventory, so the next move should come from its ready branches."
      : `This motion is still in ${focusMotion.overallStage}, so the next move should clear its top blocker instead of forcing execution.`;
  } else if (topWaitingItem) {
    headline = `Held work for ${user.label}`;
    nextMove = topWaitingItem.recommendedAction ?? nextMove;
    why = topWaitingItem.whyItMatters ?? why;
  }

  const checklist = dueNowItems.slice(0, 4).map((item) => {
    const capacityItem = String(item.prospect?.id ?? "") === "outbound-capacity:linkedin";
    const subjectParts = [
      item.motion?.name && !String(item.motion.id ?? "").startsWith("outbound-capacity:") ? item.motion.name : null,
      item.company?.name && !String(item.company.id ?? "").startsWith("outbound-capacity:") ? item.company.name : null,
      item.prospect?.name && !String(item.prospect.id ?? "").startsWith("outbound-capacity:") ? item.prospect.name : null,
    ].filter(Boolean);

    return {
      subject: capacityItem
        ? "LinkedIn capacity deficit"
        : subjectParts.join(" / ") || item.prospect?.name || item.company?.name || item.motion?.name || "General",
      action: item.recommendedAction ?? item.cadence?.nextAction ?? "No governed action exposed.",
      dueAt: item.dueAt ?? null,
    };
  });

  return {
    headline,
    nextMove,
    why,
    generatedAt: now.toISOString(),
    focusMotion,
    checklist,
    counts: {
      dueNow: dueNowItems.length,
      waiting: waitingItems.length,
      review: reviewItems.length,
      actionableSurfaces: actionableSurfaceCount,
      staleSurfaces: staleSurfaceCount,
      uncheckedSurfaces: uncheckedSurfaceCount,
    },
  };
}

function buildArtifactSummaries(reports, motionSummaries) {
  const summaryIndex = new Map(motionSummaries.map((motion) => [motion.id, motion]));

  return reports
    .map((report) => {
      const motionSummary = summaryIndex.get(report.motion.id) ?? null;
      const prospects = toArray(report.prospects?.prospects);
      const audienceCount = toArray(report.motion.setup?.audienceHypotheses).length;
      const signalCount = toArray(report.motion.setup?.signals).length;
      const throughLineReadyCount = prospects.filter((prospect) => prospect.throughLineStatus === "ready").length;
      const openingPlanReadyCount = prospects.filter((prospect) => prospect.openingPlanStatus === "ready").length;
      const cadenceReadyCount = prospects.filter((prospect) => prospect.cadenceStatus === "ready").length;
      const messageTestReadyCount = report.prospects?.counts?.messageTestReadyCount ?? 0;
      const companyCount = motionSummary?.companyCount ?? report.targeting?.companyLoop?.companyCount ?? 0;
      const prospectCount = motionSummary?.prospectCount ?? report.prospects?.counts?.prospectCount ?? 0;

      return {
        motionId: report.motion.id,
        motionName: report.motion.name,
        motionStatus: report.motion.status,
        overallStage: motionSummary?.overallStage ?? report.targeting?.overallStage ?? "unknown",
        frame: {
          status: summarizeArtifactStatus(
            report.motion.premise?.status === "defined" || audienceCount > 0 || signalCount > 0,
            report.motion.premise?.status === "defined" && audienceCount > 0 && signalCount > 0,
          ),
          premiseStatus: report.motion.premise?.status ?? "unknown",
          audienceCount,
          signalCount,
        },
        targetMap: {
          status: summarizeArtifactStatus(companyCount > 0 || prospectCount > 0, companyCount > 0 && prospectCount > 0),
          companyCount,
          prospectCount,
        },
        branchLogic: {
          status: summarizeArtifactStatus(
            throughLineReadyCount > 0 || openingPlanReadyCount > 0 || cadenceReadyCount > 0,
            prospectCount > 0
              && throughLineReadyCount === prospectCount
              && openingPlanReadyCount === prospectCount
              && cadenceReadyCount === prospectCount,
          ),
          throughLineReadyCount,
          openingPlanReadyCount,
          cadenceReadyCount,
          messageTestReadyCount,
        },
        execution: {
          status: summarizeArtifactStatus(
            (motionSummary?.readyToSendCount ?? 0) > 0
              || (motionSummary?.waitingCount ?? 0) > 0
              || (motionSummary?.dueNowCount ?? 0) > 0,
            (motionSummary?.readyToSendCount ?? 0) > 0,
          ),
          readyToSendCount: motionSummary?.readyToSendCount ?? 0,
          dueNowCount: motionSummary?.dueNowCount ?? 0,
          waitingCount: motionSummary?.waitingCount ?? 0,
          reviewCount: motionSummary?.reviewCount ?? 0,
        },
      };
    })
    .sort((left, right) => {
      if (left.motionStatus === "active" && right.motionStatus !== "active") {
        return -1;
      }

      if (left.motionStatus !== "active" && right.motionStatus === "active") {
        return 1;
      }

      return left.motionName.localeCompare(right.motionName);
    });
}

function buildMotionDetailModels(reports, motionSummaries, daily, inboundReview) {
  const summaryIndex = new Map(motionSummaries.map((motion) => [motion.id, motion]));
  const dailyIndex = buildDailyIndex(daily.items);
  const reviewCountsByMotion = countBy(toArray(inboundReview.reviewItems), (item) => item.motion?.id ?? "unknown");

  return reports.map((report) => {
    const motion = report.motion;
    const transitionMotion = isTransitionMotion(motion);
    const summary = summaryIndex.get(motion.id) ?? null;
    const rawSignals = toArray(motion.setup?.signals);
    const rawAudiences = toArray(motion.setup?.audienceHypotheses);
    const rawCompanies = toArray(report.matches?.companies);
    const rawCompanyLoop = toArray(report.targeting?.companyLoop?.items);
    const signalCoverage = buildSignalCoverage(report);
    const companyExecutionIndex = new Map(
      [
        ...rawCompanies.map((company) => [company.companyId, company.executionIdentity ?? null]),
        ...rawCompanyLoop.map((company) => [company.companyId, company.executionIdentity ?? null]),
      ],
    );
    const companies = sortByName(
      rawCompanies
        .filter((company) => (company.signalMatchCount ?? 0) > 0)
        .map((company) => ({
        companyId: company.companyId,
        companyName: company.companyName,
        websiteUrl: company.websiteUrl,
        linkedinCompanyUrl: company.linkedinCompanyUrl,
        logoUrl: company.companyLogoUrl,
        domain: company.domain,
        prospectCount: company.prospectCount,
        signalMatchCount: company.signalMatchCount,
        latestMatchAt: company.latestMatchAt,
        executionIdentity: company.executionIdentity ?? null,
        matchedSignals: toArray(company.matchedSignals),
        matchedSignalIndexes: uniqueValues(
          toArray(company.matchedSignals).map((match) => (match.signalIndex ? `S${match.signalIndex}` : null)),
        ),
        matchedSignalQuestions: uniqueValues(
          toArray(company.matchedSignals).map((match) => match.question ?? match.signalName ?? null),
        ),
        })),
      "companyName",
    );
    const backlogCompanies = sortByName(
      rawCompanyLoop
        .filter((company) => company.stage === "needs-company-identity" || company.stage === "needs-company-research")
        .map((company) => ({
          companyId: company.companyId,
          companyName: company.companyName,
          websiteUrl: company.websiteUrl,
          linkedinCompanyUrl: company.linkedinCompanyUrl,
          logoUrl: company.logoUrl,
          domain: extractHost(company.websiteUrl) ?? "",
          prospectCount: company.prospectCount ?? 0,
          signalMatchCount: company.signalMatchCount ?? 0,
          queueStatus: company.queueStatus ?? "discovered",
          stage: company.stage,
          executionIdentity: company.executionIdentity ?? null,
        })),
      "companyName",
    );
    const people = toArray(report.prospects?.prospects)
      .map((prospect) => {
        const dailyItem = dailyIndex.get([motion.id, prospect.companyId, prospect.prospectId].join("::")) ?? null;
        const branchState = deriveEngagementLane(prospect, dailyItem);
        const primarySignal = toArray(prospect.signalMatches).find((match) => match.subject?.type === "person")
          ?? toArray(prospect.signalMatches)[0]
          ?? null;
        const executionIdentity = companyExecutionIndex.get(prospect.companyId) ?? null;

        return {
          companyId: prospect.companyId,
          companyName: prospect.companyName,
          prospectId: prospect.prospectId,
          name: prospect.name,
          title: prospect.title,
          linkedinProfileUrl: prospect.linkedinProfileUrl,
          avatarUrl: prospect.avatarUrl,
          branchState,
          ownerLabel: executionIdentity?.user?.label ?? executionIdentity?.profile?.label ?? "Unassigned",
          signalLabel: primarySignal?.summary ?? primarySignal?.signalName ?? prospect.whyRelevant,
          signalQuestion: primarySignal?.question ?? primarySignal?.signalName ?? null,
        };
      })
      .sort((left, right) =>
        (left.companyName || "").localeCompare(right.companyName || "")
        || (left.name || "").localeCompare(right.name || ""),
      );
    const signals = rawSignals.map((signal) => {
      const companyCount = signalCoverage.companyCounts.get(signal.id) ?? 0;
      const personCount = signalCoverage.personCounts.get(signal.id) ?? 0;
      const latestEvidenceAt = signalCoverage.latestBySignal.get(signal.id) ?? null;

      return {
        ...signal,
        methods: toArray(signal.observationMethods).map((method) => humanizeObservationMethod(method.surface)),
        companyCount,
        personCount,
        latestEvidenceAt,
        matchLabel: buildSignalMatchLabel(signal.scope, companyCount, personCount),
      };
    });
    const audiences = rawAudiences.map((audience) => {
      const relatedSignalIds = signals
        .filter((signal) => toArray(signal.audienceIds).includes(audience.id))
        .map((signal) => signal.id);
      const matchedSubjects = new Set();
      relatedSignalIds.forEach((signalId) => {
        const subjects = signalCoverage.subjectKeysBySignal.get(signalId);
        if (!subjects) {
          return;
        }
        subjects.forEach((subjectKey) => matchedSubjects.add(subjectKey));
      });

      return {
        ...audience,
        rolesLine: buildAudienceRolesLine(audience),
        matchedCount: matchedSubjects.size,
      };
    });

    return {
      motionId: motion.id,
      motionName: motion.name,
      motionStatus: motion.status,
      overallStage: summary?.overallStage ?? report.targeting?.overallStage ?? "unknown",
      truth: transitionMotion ? "transition" : null,
      strategyState: deriveMotionStrategyState(report),
      updatedAt: motion.updatedAt,
      offer: {
        title: motion.offerThesis?.sourceTitle ?? extractHost(motion.offer?.sourceUrl ?? motion.sourceUrl) ?? motion.name,
        url: motion.offer?.sourceUrl ?? motion.sourceUrl,
        urlLabel: extractHost(motion.offer?.sourceUrl ?? motion.sourceUrl) ?? motion.offer?.sourceUrl ?? motion.sourceUrl,
        summary: motion.offerThesis?.sourceSummary ?? motion.offerThesis?.sourceDescription ?? "No offer summary is stored yet.",
        problem: motion.offerThesis?.problemThesis ?? motion.offerThesis?.sourceDescription ?? "Problem framing is not stored yet.",
        feltBy: motion.offerThesis?.likelyRoleThesis ?? summarizeOfferAudience(rawAudiences),
        triggers: motion.offerThesis?.likelyTriggerThesis ?? summarizeOfferTriggers(rawSignals),
      },
      premise: {
        statement: motion.premise?.statement,
        note: derivePremiseSupportNote(report),
        source: motion.premise?.source,
        status: motion.premise?.status ?? "unknown",
      },
      signals,
      audiences,
      companies,
      backlogCompanies,
      people,
      blocker: deriveMotionBlocker(report),
      plan: {
        nextSteps: buildMotionPlanSteps(report, summary, reviewCountsByMotion[motion.id] ?? 0),
        dueNowCount: summary?.dueNowCount ?? 0,
        waitingCount: summary?.waitingCount ?? 0,
        reviewCount: reviewCountsByMotion[motion.id] ?? 0,
        readyToSendCount: report.execution?.readyToSendCount ?? summary?.readyToSendCount ?? 0,
        messageTestReadyCount: report.execution?.messageTestReadyCount ?? 0,
        companyCount: report.execution?.companyCount ?? summary?.companyCount ?? 0,
        prospectCount: report.execution?.prospectCount ?? summary?.prospectCount ?? 0,
      },
    };
  });
}

function buildSignalCoverage(report) {
  const companyCounts = new Map();
  const personCounts = new Map();
  const latestBySignal = new Map();
  const subjectKeysBySignal = new Map();

  toArray(report.matches?.companies).forEach((company) => {
    const seenSignals = new Set();
    toArray(company.matchedSignals).forEach((match) => {
      if (!subjectKeysBySignal.has(match.signalId)) {
        subjectKeysBySignal.set(match.signalId, new Set());
      }
      subjectKeysBySignal.get(match.signalId).add(`company:${company.companyId}`);
      updateLatestSignalMatch(latestBySignal, match.signalId, match.observedAt);

      if (seenSignals.has(match.signalId)) {
        return;
      }
      seenSignals.add(match.signalId);
      companyCounts.set(match.signalId, (companyCounts.get(match.signalId) ?? 0) + 1);
    });
  });

  toArray(report.prospects?.prospects).forEach((prospect) => {
    const seenSignals = new Set();
    toArray(prospect.signalMatches).forEach((match) => {
      if (!subjectKeysBySignal.has(match.signalId)) {
        subjectKeysBySignal.set(match.signalId, new Set());
      }
      subjectKeysBySignal.get(match.signalId).add(`person:${prospect.prospectId}`);
      updateLatestSignalMatch(latestBySignal, match.signalId, match.observedAt);

      if (match.subject?.type !== "person" || seenSignals.has(match.signalId)) {
        return;
      }
      seenSignals.add(match.signalId);
      personCounts.set(match.signalId, (personCounts.get(match.signalId) ?? 0) + 1);
    });
  });

  return {
    companyCounts,
    personCounts,
    latestBySignal,
    subjectKeysBySignal,
  };
}

function updateLatestSignalMatch(latestBySignal, signalId, observedAt) {
  if (!observedAt) {
    return;
  }

  const current = latestBySignal.get(signalId);
  const currentTime = parseDate(current)?.getTime() ?? 0;
  const observedTime = parseDate(observedAt)?.getTime() ?? 0;

  if (!current || observedTime > currentTime) {
    latestBySignal.set(signalId, observedAt);
  }
}

function humanizeObservationMethod(surface) {
  const labels = {
    google: "Google",
    linkedin: "LinkedIn",
    news: "News",
    manual: "Manual",
    other: "Other",
    "company-site": "Company site",
    "sales-navigator": "Sales Navigator",
  };

  return labels[surface] ?? titleizeStatus(surface);
}

function buildSignalMatchLabel(scope, companyCount, personCount) {
  if (scope === "person") {
    return `${personCount} ${personCount === 1 ? "person" : "people"} lit`;
  }

  if (scope === "both") {
    return `${companyCount} compan${companyCount === 1 ? "y" : "ies"} · ${personCount} ${personCount === 1 ? "person" : "people"}`;
  }

  return `${companyCount} compan${companyCount === 1 ? "y" : "ies"} lit`;
}

function summarizeOfferAudience(audiences) {
  const roleCriteria = uniqueValues(toArray(audiences).flatMap((audience) => toArray(audience.roleCriteria)));
  if (roleCriteria.length > 0) {
    return roleCriteria.slice(0, 3).join(" · ");
  }

  const names = toArray(audiences).map((audience) => audience.name).filter(Boolean);
  return names.length > 0
    ? names.slice(0, 2).join(" · ")
    : "Audience framing is not stored yet.";
}

function summarizeOfferTriggers(signals) {
  const names = toArray(signals).map((signal) => signal.name).filter(Boolean);
  return names.length > 0
    ? names.slice(0, 2).join(" · ")
    : "Trigger framing is not stored yet.";
}

function buildAudienceRolesLine(audience) {
  if (toArray(audience.roleCriteria).length > 0) {
    return toArray(audience.roleCriteria).join(" · ");
  }

  if (toArray(audience.companyCriteria).length > 0) {
    return toArray(audience.companyCriteria).join(" · ");
  }

  return audience.notes ?? "No explicit role criteria are stored yet.";
}

function derivePremiseSupportNote(report) {
  if (isTransitionMotion(report.motion)) {
    return "This holding motion keeps inherited relationships moving until they can be understood and re-homed into real motions.";
  }

  if (report.motion?.premise?.notes) {
    return report.motion.premise.notes;
  }

  const signals = toArray(report.motion?.setup?.signals);
  if (report.motion?.premise?.status !== "defined" || signals.length === 0) {
    return "Targeting is hard-blocked until the premise and the motion signals both exist.";
  }

  if (signals.some((signal) => signal.status !== "ready")) {
    return "The premise is defined, but the signal set is still draft, so the why-now proof conditions are not fully tightened yet.";
  }

  return "This premise is the governing prediction the rest of the motion has to prove with recent, externally observable evidence.";
}

function deriveMotionStrategyState(report) {
  if (isTransitionMotion(report.motion)) {
    return { label: "transition backlog", tone: "quiet" };
  }

  const premiseDefined = report.motion?.premise?.status === "defined";
  const signals = toArray(report.motion?.setup?.signals);
  const readySignals = signals.filter((signal) => signal.status === "ready").length;

  if (!premiseDefined || signals.length === 0) {
    return { label: "strategy blocked", tone: "danger" };
  }

  if (readySignals === signals.length) {
    return { label: "strategy ready", tone: "good" };
  }

  if (readySignals > 0) {
    return { label: "strategy partial", tone: "warning" };
  }

  return { label: "signals draft", tone: "quiet" };
}

function deriveMotionBlocker(report) {
  if (isTransitionMotion(report.motion)) {
    return "Reconcile these in-flight relationships and re-home them into real motions.";
  }

  return (
    toArray(report.targeting?.motionPreflight?.blockers)[0]
    ?? (report.targeting?.browserGate?.status === "blocked" ? report.targeting.browserGate.message : null)
  );
}

function buildMotionPlanSteps(report, motionSummary, reviewCount) {
  if (isTransitionMotion(report.motion)) {
    return buildTransitionPlanSteps(report, motionSummary, reviewCount);
  }

  const steps = toArray(report.targeting?.nextActions).length > 0
    ? toArray(report.targeting?.nextActions)
    : toArray(report.motion?.setup?.nextSteps);

  return steps.slice(0, 5).map((text, index) => {
    if (index === 0 && (report.targeting?.inventoryTarget?.shortfall ?? 0) > 0) {
      return {
        text,
        tone: "warning",
        tag: `${report.targeting.inventoryTarget.shortfall} short`,
      };
    }

    if (index === 0 && (motionSummary?.dueNowCount ?? 0) > 0) {
      return { text, tone: "warning", tag: `${motionSummary.dueNowCount} due now` };
    }

    if (index === 0 && (report.execution?.readyToSendCount ?? motionSummary?.readyToSendCount ?? 0) > 0) {
      return {
        text,
        tone: "accent",
        tag: `${report.execution?.readyToSendCount ?? motionSummary?.readyToSendCount ?? 0} agent-ready`,
      };
    }

    if (/block|trusted browser|assign/i.test(text)) {
      return { text, tone: "danger", tag: "blocked" };
    }

    if (/wait|hold|reserve|patient/i.test(text)) {
      return { text, tone: "quiet", tag: `${motionSummary?.waitingCount ?? 0} waiting` };
    }

    if (index === 0 && reviewCount > 0) {
      return { text, tone: "warning", tag: `${reviewCount} review` };
    }

    return { text, tone: "quiet", tag: null };
  });
}

function buildTransitionPlanSteps(report, motionSummary, reviewCount) {
  const steps = [];
  const readyToSendCount = report.execution?.readyToSendCount ?? motionSummary?.readyToSendCount ?? 0;
  const companyCount = report.execution?.companyCount ?? motionSummary?.companyCount ?? 0;
  const prospectCount = report.execution?.prospectCount ?? motionSummary?.prospectCount ?? 0;

  if (reviewCount > 0) {
    steps.push({
      text: "Review inbound relationships that still need a routing decision.",
      tone: "warning",
      tag: `${reviewCount} to review`,
    });
  }

  if (readyToSendCount > 0) {
    steps.push({
      text: "Let the agent continue live threads here while you decide where each relationship belongs.",
      tone: "accent",
      tag: `${readyToSendCount} agent-ready`,
    });
  }

  if (prospectCount > 0) {
    steps.push({
      text: "Re-home understood relationships into real motions once the offer and owner are clear.",
      tone: "quiet",
      tag: `${prospectCount} prospects`,
    });
  }

  if (companyCount > 0) {
    steps.push({
      text: "Keep unresolved carry-over here only until the right motion exists.",
      tone: "quiet",
      tag: `${companyCount} companies`,
    });
  }

  if (steps.length === 0) {
    steps.push({
      text: "Hold inherited relationships here until there is enough context to re-home them.",
      tone: "quiet",
      tag: "holding",
    });
  }

  return steps.slice(0, 5);
}

function reviewPriorityRank(value) {
  if (value === "high") {
    return 0;
  }

  if (value === "medium") {
    return 1;
  }

  return 2;
}

function isInboundReviewDailyItem(item) {
  return item?.source?.type === "inbound_review" || String(item?.motion?.id ?? "").startsWith("inbound-review:");
}

function isDecisionReviewItem(item) {
  return new Set([
    "needs_reply",
    "ready_for_reply",
    "needs_decision",
    "needs_status_reconciliation",
    "needs_triage",
    "thread_change_review",
    "ready_for_post_accept",
    "needs_claim",
  ]).has(item?.state);
}

function plannerSubject(item) {
  const capacityItem = String(item?.prospect?.id ?? "") === "outbound-capacity:linkedin";

  if (capacityItem) {
    return "LinkedIn capacity";
  }

  return [item?.company?.name, item?.prospect?.name].filter(Boolean).join(" / ") || item?.motion?.name || "General";
}

function reviewSubject(item) {
  return item?.prospect?.name || item?.actorName || item?.company?.name || "Unknown";
}

function buildPacketAction(channel, kind, item, workerLabel) {
  const packetSubject = item.prospectName ?? item.companyName ?? "Unknown";

  if (kind === "prospect_research" && item.prospectId) {
    return {
      kind: "claim_motion_prospect_packet",
      label: `Claim ${packetSubject}`,
      confirm: `Claim the ${kind.replaceAll("_", " ")} packet for ${packetSubject}?`,
      companyId: item.companyId,
      motionId: item.motionId,
      prospectId: item.prospectId,
      workerLabel,
      notes: `Claimed from the Exo workspace for ${channel} ${kind}.`,
    };
  }

  return {
    kind: "claim_target_account_packet",
    label: `Claim ${packetSubject}`,
    confirm: `Claim the ${kind.replaceAll("_", " ")} packet for ${packetSubject}?`,
    companyId: item.companyId,
    motionId: item.motionId,
    workerLabel,
    notes: `Claimed from the Exo workspace for ${channel} ${kind}.`,
  };
}

function buildWorkspaceStateActions({ user, reports, daily, workerLabel = DEFAULT_WORKSPACE_ACTION_WORKER }) {
  const firstBlockedCompanyName = Object.values(daily.capacity ?? {})
    .map((entry) => entry?.plannerItem?.context?.firstAssignmentBlockedCompanyName ?? null)
    .find(Boolean) ?? null;

  const blockedReadyCompanies = [...new Map(
    Object.entries(daily.capacity ?? {}).flatMap(([channel, entry]) =>
      toArray(entry?.execution?.assignmentBlockedCompanies).map((company) => [
        `${channel}::${company.companyId}`,
        {
          channel,
          companyId: company.companyId,
          companyName: company.companyName,
        },
      ]),
    ),
  ).values()]
    .map((company) => ({
      kind: "assign_company_user",
      label: `Assign ${company.companyName}`,
      confirm: `Assign ${company.companyName} to ${user.label}?`,
      companyId: company.companyId,
      companyName: company.companyName,
      userId: user.id,
      userLabel: user.label,
      browserCapability: company.channel ?? "linkedin",
      reason: "Make ready outbound branches executable",
    }))
    .sort((left, right) => {
      if (left.companyName === firstBlockedCompanyName) {
        return -1;
      }

      if (right.companyName === firstBlockedCompanyName) {
        return 1;
      }

      return right.companyName.localeCompare(left.companyName);
    });

  const packetActionsByKey = new Map();

  Object.entries(daily.capacity ?? {}).forEach(([channel, entry]) => {
    const claimableItemsByKind = entry?.execution?.packets?.claimableItemsByKind ?? {};

    Object.entries(claimableItemsByKind).forEach(([kind, items]) => {
      const actions = toArray(items)
        .slice(0, 3)
        .map((item) => buildPacketAction(channel, kind, item, workerLabel));

      packetActionsByKey.set(`${channel}::${kind}`, actions);
    });
  });

  return {
    blockedReadyCompanies,
    packetActionsByKey,
  };
}

function buildDecisionLinks(item) {
  const links = [];

  if (item.actorProfileUrl) {
    links.push({
      label: "Profile",
      href: item.actorProfileUrl,
    });
  }

  if (item.sourceUrl && item.sourceUrl !== item.actorProfileUrl) {
    links.push({
      label: "Invites",
      href: item.sourceUrl,
    });
  }

  return links;
}

function buildDecisionActions(item) {
  if (item.kind !== "connection_request_received" || item.state !== "needs_decision") {
    return [];
  }

  const subject = item.actorName ?? item.prospect?.name ?? item.company?.name ?? "this inbound invite";

  return [
    {
      kind: "record_inbound_observation",
      label: "Mark accepted",
      confirm: `Record ${subject} as accepted in Exo? This updates governed state only; it does not click LinkedIn for you.`,
      observationId: item.id,
      nextKind: "connection_request_accepted",
    },
    {
      kind: "record_inbound_observation",
      label: "Mark declined",
      confirm: `Record ${subject} as declined in Exo? This updates governed state only; it does not click LinkedIn for you.`,
      observationId: item.id,
      nextKind: "connection_request_declined",
    },
  ];
}

function buildDecisionQueue(reviewItems) {
  const sorted = toArray(reviewItems).slice().sort((left, right) => {
    const priorityDelta = reviewPriorityRank(left.priority) - reviewPriorityRank(right.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const leftObserved = parseDate(left.observedAt)?.getTime() ?? 0;
    const rightObserved = parseDate(right.observedAt)?.getTime() ?? 0;
    return rightObserved - leftObserved;
  });

  const decisions = sorted.filter(isDecisionReviewItem);
  const signals = sorted.filter((item) => !isDecisionReviewItem(item));

  return {
    itemCount: decisions.length,
    replyCount: decisions.filter((item) => item.state === "needs_reply" || item.state === "ready_for_reply").length,
    decisionCount: decisions.filter((item) => item.state === "needs_decision").length,
    parkedSignalCount: signals.length,
    items: decisions.map((item) => ({
      id: item.id,
      kind: item.kind,
      subject: reviewSubject(item),
      summary: item.summary ?? "No summary recorded.",
      previewLabel: item.previewLabel ?? null,
      previewSubject: item.previewSubject ?? null,
      previewText: item.previewText ?? null,
      why: item.whyItMatters ?? null,
      priority: item.priority ?? "low",
      state: item.state ?? "unknown",
      options: toArray(item.decisionOptions),
      surfaceKey: item.surfaceKey ?? null,
      observedAt: item.observedAt ?? null,
      recommendedAction: item.recommendedAction ?? null,
      avatarUrl: item.actorAvatarUrl ?? item.actorAvatarSourceUrl ?? null,
      actorTitle: item.actorTitle ?? null,
      actorCompanyName: item.actorCompanyName ?? null,
      actorProfileUrl: item.actorProfileUrl ?? null,
      sourceUrl: item.sourceUrl ?? null,
      companyName: item.company?.name ?? null,
      prospectId: item.prospect?.id ?? null,
      motionName: item.motion?.name ?? null,
      links: buildDecisionLinks(item),
      actions: buildDecisionActions(item),
    })),
    signals: signals.map((item) => ({
      id: item.id,
      subject: reviewSubject(item),
      summary: item.summary ?? "No summary recorded.",
      priority: item.priority ?? "low",
      state: item.state ?? "unknown",
      surfaceKey: item.surfaceKey ?? null,
      observedAt: item.observedAt ?? null,
      recommendedAction: item.recommendedAction ?? null,
    })),
  };
}

function buildExecutionBacklog(daily, stateActions = { blockedReadyCompanies: [], packetActionsByKey: new Map() }) {
  const capacityEntries = Object.entries(daily.capacity ?? {});

  const blockers = capacityEntries.flatMap(([channel, entry]) => {
    const execution = entry?.execution ?? {};
    const blockedReadyCount = Number(execution.assignmentBlockedReadyConnectionRequests ?? 0);
    const blockedCompanyCount = Number(execution.assignmentBlockedCompanyCount ?? 0);

    if (blockedReadyCount <= 0 && blockedCompanyCount <= 0) {
      return [];
    }

    return [
      {
        channel,
        accountHandle: entry?.account?.handle ?? null,
        blockedReadyCount,
        blockedCompanyCount,
        firstCompanyName: entry?.plannerItem?.context?.firstAssignmentBlockedCompanyName ?? null,
        firstProspectName: entry?.plannerItem?.context?.firstAssignmentBlockedProspectName ?? null,
        stateActions: stateActions.blockedReadyCompanies,
      },
    ];
  });

  const packets = capacityEntries.flatMap(([channel, entry]) => {
    const claimableItemsByKind = entry?.execution?.packets?.claimableItemsByKind ?? {};

    return Object.entries(claimableItemsByKind).flatMap(([kind, items]) => {
      const previewItems = toArray(items);
      if (previewItems.length === 0) {
        return [];
      }

      return [
        {
          channel,
          kind,
          count: previewItems.length,
          preview: previewItems
            .slice(0, 3)
            .map((item) => item.prospectName ?? item.companyName)
            .filter(Boolean),
          firstPacketId: previewItems[0].packetId ?? null,
          firstMotionName: previewItems[0].motionName ?? null,
          stateActions: stateActions.packetActionsByKey.get(`${channel}::${kind}`) ?? [],
        },
      ];
    });
  });

  return {
    blockerCount: blockers.length,
    blockedReadyCount: blockers.reduce((total, item) => total + item.blockedReadyCount, 0),
    blockedCompanyCount: blockers.reduce((total, item) => total + item.blockedCompanyCount, 0),
    packetCount: packets.reduce((total, item) => total + item.count, 0),
    blockers,
    packets,
  };
}

function buildWorkspaceAgentQueue(rawAgentQueue) {
  const tasks = toArray(rawAgentQueue?.tasks);
  const waiting = toArray(rawAgentQueue?.waiting);

  return {
    count: Number(rawAgentQueue?.count ?? tasks.length),
    itemCount: Number(rawAgentQueue?.itemCount ?? tasks.length),
    waitingCount: Number(rawAgentQueue?.waitingCount ?? waiting.length),
    tasks,
    waiting,
    blockers: toArray(rawAgentQueue?.blockers),
    items: tasks.map(mapAgentQueueTask),
    waitingItems: waiting.map(mapAgentQueueTask),
  };
}

function mapAgentQueueTask(task) {
  return {
    id: workspaceAgentTaskId(task),
    taskKind: task.kind ?? "unknown",
    observationId: task.observationId ?? null,
    motionId: task.motionId ?? null,
    companyId: task.companyId ?? null,
    prospectId: task.prospectId ?? null,
    subject: task.prospectName ?? task.companyName ?? titleizeStatus(task.kind ?? "agent_work"),
    action: agentQueueTaskAction(task),
    why: agentQueueTaskWhy(task),
    motionName: task.motionName ?? null,
    companyName: task.companyName ?? null,
    dueAt: task.dueAt ?? task.queuedAt ?? null,
    sourceType: agentQueueTaskSourceType(task),
    state: task.queueState ?? "unknown",
    surface: task.surface ?? null,
    waitingReason: task.waitingReason ?? null,
  };
}

function workspaceAgentTaskId(task) {
  return [
    task.kind ?? "agent_work",
    task.prospectId ?? task.observationId ?? task.companyId ?? task.motionId ?? "workspace",
    task.surface ?? task.action ?? "task",
  ].join("::");
}

function agentQueueTaskAction(task) {
  const surface = humanizeQueueSurface(task.surface);

  switch (task.kind) {
    case "run_inbound_sync":
      return "Refresh inbound truth";
    case "company_discovery":
      return "Discover companies";
    case "company_research":
      return "Research company";
    case "prospect_selection":
      return "Select prospects";
    case "prospect_research":
      return "Research prospect";
    case "write_draft":
      return `Write ${surface} draft`;
    case "send_message":
      return task.surface === "connection_request"
        ? "Send connection request"
        : `Send ${surface}`;
    case "reject_connection_request":
      return "Decline inbound connection request";
    case "withdraw_connection":
      return "Withdraw stale connection request";
    case "unfollow_profile":
      return "Unfollow profile";
    default:
      return titleizeStatus(task.kind ?? "agent_work");
  }
}

function agentQueueTaskWhy(task) {
  switch (task.kind) {
    case "run_inbound_sync":
      return task.whyItMatters ?? "Inbound truth needs a governed refresh before the operator surface can be trusted.";
    case "company_discovery":
      return task.whyItMatters ?? "This motion is below its prospect floor and needs more companies queued into backlog.";
    case "company_research":
      return task.whyItMatters ?? "This company was explicitly queued for governed research.";
    case "prospect_selection":
      return task.whyItMatters ?? "This researched account still needs the smallest credible stakeholder set.";
    case "prospect_research":
      return task.whyItMatters ?? "This selected prospect still needs governed research and cadence before the branch is usable.";
    case "write_draft":
      return task.reason === "no_draft"
        ? "No governed draft exists on the current surface yet."
        : titleizeStatus(task.reason ?? "draft work is due");
    case "send_message":
      return "This draft is already queued to send and needs no operator input.";
    case "reject_connection_request":
      return "The operator already chose to decline this invite.";
    case "withdraw_connection":
      return "The pending invite crossed the withdrawal policy window.";
    case "unfollow_profile":
      return "The withdrawn connection branch still has a follow to clean up.";
    default:
      return null;
  }
}

function agentQueueTaskSourceType(task) {
  if (task.kind === "reject_connection_request") {
    return "inbound_observation";
  }

  if (task.kind === "run_inbound_sync") {
    return "inbound_sync";
  }

  if (task.kind === "company_discovery") {
    return "company_discovery";
  }

  if (task.kind === "company_research") {
    return "company_research_packet";
  }

  if (task.kind === "withdraw_connection" || task.kind === "unfollow_profile") {
    return "maintenance";
  }

  return "cadence";
}

function humanizeQueueSurface(surface) {
  if (!surface) {
    return "message";
  }

  return titleizeStatus(String(surface).replaceAll("_", " "));
}

function buildBlockedQueue(agentQueue, executionBacklog) {
  const assignmentItems = toArray(executionBacklog?.blockers).map((item, index) => ({
    id: `assignment-blocker-${index}-${item.channel ?? "any"}`,
    subject: item.firstProspectName ?? item.firstCompanyName ?? titleizeStatus(item.channel),
    meta: item.accountHandle ?? titleizeStatus(item.channel),
    reason: "Needs operator assignment",
    detail: `${item.blockedReadyCount} ready branch${item.blockedReadyCount === 1 ? "" : "es"} across ${item.blockedCompanyCount} compan${item.blockedCompanyCount === 1 ? "y" : "ies"} cannot open until one trusted owner is assigned.`,
    blockType: "assignment",
    channel: item.channel ?? "",
    resolveLabel: "Assign owner",
    stateActions: toArray(item.stateActions),
    actions: toArray(item.stateActions)
      .filter((action) => action?.kind === "assign_company_user" && action.companyId && action.userId)
      .map((action) => ({
        writer: "assignCompanyUser",
        label: action.companyName ? `Assign ${action.companyName}` : action.label ?? "Assign owner",
        args: {
          companyId: action.companyId,
          userId: action.userId,
          reason: action.reason ?? "Make ready outbound branches executable",
          browserCapability: action.browserCapability ?? "linkedin",
        },
      })),
  }));

  const queueBlockers = toArray(agentQueue?.blockers).map((item, index) => ({
    id: `queue-blocker-${index}-${item.prospectId ?? item.motionId ?? "draft"}`,
    subject: item.prospectName ?? item.companyName ?? "Queued draft",
    meta: item.companyName ?? item.motionName ?? "Agent queue",
    reason: "Queued draft needs re-review",
    detail: item.nextSurface
      ? `${humanizeQueueSurface(item.sendReadySurface)} was queued, but the branch moved to ${humanizeQueueSurface(item.nextSurface)}.`
      : `${humanizeQueueSurface(item.sendReadySurface)} was queued, but the branch no longer exposes a writeable surface.`,
    blockType: "stale_draft",
    channel: "linkedin",
    resolveLabel: "Review draft",
    stateActions: [],
    actions: [],
    prospectId: item.prospectId ?? null,
  }));

  return {
    itemCount: assignmentItems.length + queueBlockers.length,
    items: [...assignmentItems, ...queueBlockers],
  };
}

function renderChips(chips) {
  return chips
    .map(
      (chip) =>
        `<span class="chip chip-${escapeHtml(chip.tone)}">${escapeHtml(titleizeStatus(chip.label))}</span>`,
    )
    .join("");
}

function renderOperatorChecklist(items, now) {
  if (!items.length) {
    return `<div class="empty-state">Nothing is due now. Use the focus motion and truth strip to decide whether the next move is waiting, cleanup, or fresh targeting work.</div>`;
  }

  return `
    <ul class="operator-list">
      ${items
        .map(
          (item) => `
            <li class="operator-item">
              <div>
                <strong>${escapeHtml(item.subject)}</strong>
                <p>${escapeHtml(item.action)}</p>
              </div>
              <span>${escapeHtml(formatRelative(item.dueAt, now))}</span>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function compactActorContext(title, company) {
  if (!title && !company) {
    return null;
  }

  if (title && company && title.toLowerCase().includes(company.toLowerCase())) {
    return title;
  }

  return [title, company].filter(Boolean).join(" · ");
}

function humanizeSurfaceRef(surfaceKey) {
  return titleizeStatus(String(surfaceKey ?? "unknown").replaceAll("-", " "));
}

function pickOperatorNextMoveItem(decisionQueue) {
  return decisionQueue.items.find((item) => item.state === "needs_reply")
    ?? decisionQueue.items[0]
    ?? null;
}

function renderOperatorCountChip(value, tone = "neutral", label = "") {
  return `
    <span class="count-chip tone-${escapeHtml(tone)}">
      ${escapeHtml(String(value))}
      ${label ? `<em>${escapeHtml(label)}</em>` : ""}
    </span>
  `;
}

function renderOperatorActionTag(label, tone = "warning") {
  const colors = {
    warning: "#f59e0b",
    danger: "#ef4444",
    accent: "#3b82f6",
    quiet: "#94a3b8",
    good: "#22c55e",
  };
  const color = colors[tone] ?? colors.warning;

  return `<span class="action-tag" style="--am:${escapeHtml(color)}">${escapeHtml(label)}</span>`;
}

function renderOperatorSurfaceRef(surfaceKey) {
  return `
    <span class="cap-ref">
      ${renderMotionDetailIcon("activity", 11)}
      ${escapeHtml(humanizeSurfaceRef(surfaceKey))}
    </span>
  `;
}

function renderOperatorLinkButton(label, href, variant = "ghost", size = "sm") {
  return `
    <a
      class="btn btn-${escapeHtml(variant)} btn-${escapeHtml(size)}"
      href="${escapeHtml(href)}"
      target="_blank"
      rel="noreferrer"
    >${escapeHtml(label)}</a>
  `;
}

function renderOperatorActionButton({
  action,
  label,
  variant = "secondary",
  size = "sm",
  busyLabel = "Working...",
  doneLabel = "Done",
}) {
  return `
    <button
      class="btn btn-${escapeHtml(variant)} btn-${escapeHtml(size)} workspace-action-button"
      type="button"
      data-action="${escapeHtml(JSON.stringify({ ...action, label: label ?? action.label ?? "workspace action" }))}"
      data-busy-label="${escapeHtml(busyLabel)}"
      data-done-label="${escapeHtml(doneLabel)}"
    >${escapeHtml(label ?? action.label ?? "Run")}</button>
  `;
}

function renderOperatorDecisionButtons(item, interactive, { hero = false } = {}) {
  const profileLink = item.links.find((link) => link.label === "Profile") ?? null;
  const surfaceLink = item.links.find((link) => link.label !== "Profile") ?? null;

  if (item.state === "needs_reply") {
    const primaryLink = surfaceLink ?? profileLink ?? null;
    const controls = [];

    if (primaryLink) {
      controls.push(renderOperatorLinkButton(hero ? "Send reply" : "Reply now", primaryLink.href, "primary"));
    }
    if (profileLink && profileLink !== primaryLink) {
      controls.push(renderOperatorLinkButton("Profile", profileLink.href));
    } else if (surfaceLink && surfaceLink !== primaryLink) {
      controls.push(renderOperatorLinkButton(surfaceLink.label, surfaceLink.href));
    }

    return controls.join("");
  }

  if (item.state === "needs_decision" && interactive?.enabled && item.actions.length > 0) {
    const acceptedAction = item.actions.find((action) => action.nextKind === "connection_request_accepted") ?? null;
    const declinedAction = item.actions.find((action) => action.nextKind === "connection_request_declined") ?? null;
    const controls = [];

    if (acceptedAction) {
      controls.push(renderOperatorActionButton({
        action: acceptedAction,
        label: "Accept",
        variant: "primary",
        busyLabel: "Accepting...",
        doneLabel: "Accepted",
      }));
    }
    if (declinedAction) {
      controls.push(renderOperatorActionButton({
        action: declinedAction,
        label: "Decline",
        variant: "danger",
        busyLabel: "Declining...",
        doneLabel: "Declined",
      }));
    }
    if (profileLink) {
      controls.push(renderOperatorLinkButton("Profile", profileLink.href));
    }

    return controls.join("");
  }

  return [profileLink, surfaceLink]
    .filter(Boolean)
    .slice(0, 2)
    .map((link) => renderOperatorLinkButton(link.label, link.href))
    .join("");
}

function buildOperatorStaleRows(truthAccounts) {
  const rows = truthAccounts.flatMap((account) =>
    toArray(account.surfaces)
      .filter((surface) => surface.meta.unchecked || surface.meta.stale || surface.meta.itemizationGap)
      .map((surface) => ({
        id: `${account.handle}:${surface.key}`,
        subject: `${account.handle} · ${surface.label}`,
        truth: surface.meta.unchecked
          ? "unchecked"
          : surface.meta.itemizationGap
            ? "partial"
            : surface.meta.stale
              ? "quiet"
              : "quiet",
        lastChecked: surface.meta.freshnessLabel,
        detail: surface.summary ?? surface.recommendedAction ?? "Truth surface needs review.",
        actionLabel: surface.meta.unchecked ? "Check status" : surface.meta.itemizationGap ? "Sync now" : "Open truth",
      })),
  );

  return rows
    .sort((left, right) => {
      const leftRank = left.truth === "unchecked" ? 0 : left.truth === "partial" ? 1 : 2;
      const rightRank = right.truth === "unchecked" ? 0 : right.truth === "partial" ? 1 : 2;
      return leftRank - rightRank || left.subject.localeCompare(right.subject);
    })
    .slice(0, 6);
}

function formatOperatorAgendaTime(isoString, now) {
  const parsed = parseDate(isoString);
  if (!parsed) {
    return "Later";
  }

  if (parsed.getTime() <= now.getTime()) {
    return "Now";
  }

  return parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncateOperatorLabel(text, max = 82) {
  const value = String(text ?? "").trim();
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function buildOperatorAgendaRows(daily, now) {
  return toArray(daily.items)
    .slice()
    .sort((left, right) => {
      const leftTime = parseDate(left.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = parseDate(right.dueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })
    .slice(0, 6)
    .map((item, index) => {
      const sourceType = item.source?.type ?? "operator";
      const kind = sourceType === "inbound_review"
        ? "decision"
        : sourceType.includes("gap")
          ? "truth"
          : item.state === "waiting_until"
            ? "blocked"
            : "agent";

      return {
        id: plannerKey(item) || `agenda-${index}`,
        kind,
        time: formatOperatorAgendaTime(item.dueAt, now),
        label: truncateOperatorLabel(item.recommendedAction ?? item.cadence?.nextAction ?? plannerSubject(item)),
        meta: `${titleizeStatus(sourceType)} · ${formatRelative(item.dueAt, now)}`,
      };
    });
}

function renderOperatorNextMoveCard(item, operatorSummary, now, interactive) {
  if (!item) {
    return "";
  }

  const actorContext = compactActorContext(item.actorTitle, item.actorCompanyName) ?? humanizeSurfaceRef(item.surfaceKey);
  const whyId = `why-${escapeHtml(item.id)}`;
  const stateMarkup = item.motionName ? renderMotionStateDot("active", item.motionName) : "";

  return `
    <article class="card stakes-high next-move">
      <div class="nm-flag">${renderMotionDetailIcon("flag", 13)}NEXT MOVE</div>
      <div class="nm-body">
        ${renderAvatar(item.subject, item.avatarUrl, "person")}
        <div class="nm-main">
          <div class="nm-title">${escapeHtml(item.recommendedAction ?? operatorSummary.nextMove ?? item.subject)}</div>
          <div class="nm-sub">${escapeHtml(actorContext)}</div>
          <div class="nm-chips">
            ${stateMarkup}
            ${renderMotionTruthTag("observed", "accent", formatRelative(item.observedAt, now))}
            ${renderOperatorSurfaceRef(item.surfaceKey)}
          </div>
        </div>
        <div class="nm-actions">
          ${renderOperatorDecisionButtons(item, interactive, { hero: true })}
        </div>
      </div>
      ${
        item.why || operatorSummary.why
          ? `
            <div class="why">
              <button class="why-toggle" type="button" data-why-toggle="${escapeHtml(whyId)}">
                ${renderMotionDetailIcon("spark", 13)}Why this move ${renderMotionDetailIcon("chevronR", 12)}
              </button>
              <p class="why-text" id="${escapeHtml(whyId)}" hidden>${escapeHtml(item.why ?? operatorSummary.why)}</p>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderOperatorDecisionCards(items, interactive, now) {
  if (!items.length) {
    return `<div class="empty-state">${renderMotionDetailIcon("check", 18)}No decisions waiting. Inbound is clear right now.</div>`;
  }

  return items
    .map((item) => {
      const actorContext = compactActorContext(item.actorTitle, item.actorCompanyName) ?? item.summary;
      const stateTone = item.state === "needs_reply" ? "accent" : "warning";
      const stateLabel = item.state === "needs_reply" ? "needs reply" : "needs decision";

      return `
        <article class="card dec-card">
          <div class="row-top">
            ${renderAvatar(item.subject, item.avatarUrl, "person")}
            <div class="row-id">
              <div class="row-name">${escapeHtml(item.subject)}</div>
              <div class="row-role">${escapeHtml(actorContext)}</div>
            </div>
            ${renderOperatorActionTag(stateLabel, stateTone)}
          </div>
          <p class="row-summary">${escapeHtml(item.summary)}</p>
          <div class="row-chips">
            ${renderMotionTruthTag("observed", "quiet", formatRelative(item.observedAt, now))}
            ${renderOperatorSurfaceRef(item.surfaceKey)}
          </div>
          <div class="row-actions">
            ${renderOperatorDecisionButtons(item, interactive)}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderOperatorBlockedCards(blockedQueue, interactive) {
  if (!blockedQueue.items.length) {
    return `<div class="empty-state">${renderMotionDetailIcon("check", 18)}Nothing is blocked or waiting for operator re-review right now.</div>`;
  }

  return blockedQueue.items
    .map((item) => `
      <article class="card blk-card stakes-block">
        <div class="row-top">
          ${renderAvatar(item.subject ?? item.channel, null, "person")}
          <div class="row-id">
            <div class="row-name">${escapeHtml(item.subject ?? titleizeStatus(item.channel))}</div>
            <div class="row-role">${escapeHtml(item.meta ?? titleizeStatus(item.channel))}</div>
          </div>
          ${renderOperatorActionTag(
            item.blockType === "assignment" ? "blocked · assignment" : "blocked · re-review",
            "danger",
          )}
        </div>
        <p class="row-summary"><strong class="blk-reason">${escapeHtml(item.reason)}.</strong> ${escapeHtml(item.detail)}</p>
        <div class="row-actions">
          ${toArray(item.stateActions).slice(0, 2).map((action, index) => renderOperatorActionButton({
            action,
            label: action.companyName ? `Assign ${action.companyName}` : action.label,
            variant: index === 0 ? "secondary" : "ghost",
            busyLabel: "Assigning...",
            doneLabel: "Assigned",
          })).join("")}
        </div>
      </article>
    `)
    .join("");
}

function renderOperatorStaleRows(rows) {
  if (!rows.length) {
    return `<div class="empty-state">${renderMotionDetailIcon("eye", 18)}All tracked surfaces are fresh enough to trust.</div>`;
  }

  return `
    <div class="stale-list">
      ${rows
        .map((row) => `
          <div class="stale-row">
            ${renderMotionDetailIcon(row.truth === "unchecked" ? "alert" : "clock", 15, "stale-ic")}
            <div class="stale-main">
              <div class="stale-top">
                <span class="stale-subject">${escapeHtml(row.subject)}</span>
                ${renderMotionTruthTag(row.truth, row.truth === "unchecked" ? "danger" : row.truth === "partial" ? "warning" : "quiet", row.lastChecked)}
              </div>
              <p class="stale-detail">${escapeHtml(row.detail)}</p>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" data-nav-route="connections" data-nav-label="Connections">${escapeHtml(row.actionLabel)}</button>
          </div>
        `)
        .join("")}
    </div>
  `;
}

function renderOperatorAgendaRows(rows) {
  if (!rows.length) {
    return `<div class="empty-state">${renderMotionDetailIcon("clock", 18)}No agenda items are due right now.</div>`;
  }

  return `
    <div class="agenda-list">
      ${rows
        .map((row) => `
          <button class="agenda-row" type="button" data-nav-route="operator" data-nav-label="Operator">
            <span class="agenda-check" style="--at:${escapeHtml(
              row.kind === "decision"
                ? "#f59e0b"
                : row.kind === "truth"
                  ? "#a78bfa"
                  : row.kind === "blocked"
                    ? "#ef4444"
                    : "#3b82f6",
            )}"></span>
            <span class="agenda-time">${escapeHtml(row.time)}</span>
            <span class="agenda-label">${escapeHtml(row.label)}</span>
            <span class="agenda-meta">${escapeHtml(row.meta)}</span>
          </button>
        `)
        .join("")}
    </div>
  `;
}

function renderArtifactInventory(artifactSummaries) {
  return artifactSummaries
    .map((artifact) => {
      const rows = [
        {
          label: "Motion frame",
          status: artifact.frame.status,
          detail: `${titleizeStatus(artifact.frame.premiseStatus)} premise · ${artifact.frame.audienceCount} audience${artifact.frame.audienceCount === 1 ? "" : "s"} · ${artifact.frame.signalCount} signal${artifact.frame.signalCount === 1 ? "" : "s"}`,
        },
        {
          label: "Target map",
          status: artifact.targetMap.status,
          detail: `${artifact.targetMap.companyCount} compan${artifact.targetMap.companyCount === 1 ? "y" : "ies"} · ${artifact.targetMap.prospectCount} prospect${artifact.targetMap.prospectCount === 1 ? "" : "s"}`,
        },
        {
          label: "Branch logic",
          status: artifact.branchLogic.status,
          detail: `${artifact.branchLogic.throughLineReadyCount}/${artifact.targetMap.prospectCount || 0} through-lines · ${artifact.branchLogic.openingPlanReadyCount}/${artifact.targetMap.prospectCount || 0} opening plans · ${artifact.branchLogic.cadenceReadyCount}/${artifact.targetMap.prospectCount || 0} cadence`,
        },
        {
          label: "Execution inventory",
          status: artifact.execution.status,
          detail: `${artifact.execution.readyToSendCount} ready · ${artifact.execution.dueNowCount} due now · ${artifact.execution.waitingCount} waiting · ${artifact.execution.reviewCount} review`,
        },
      ];

      return `
        <article class="artifact-card">
          <div class="artifact-card-head">
            <div>
              <div class="mini-eyebrow">${escapeHtml(titleizeStatus(artifact.motionStatus))}</div>
              <h3>${escapeHtml(artifact.motionName)}</h3>
            </div>
            <span class="chip chip-quiet">${escapeHtml(titleizeStatus(artifact.overallStage))}</span>
          </div>
          <div class="artifact-stack">
            ${rows
              .map(
                (row) => `
                  <div class="artifact-row">
                    <div>
                      <span>${escapeHtml(row.label)}</span>
                      <strong>${escapeHtml(row.detail)}</strong>
                    </div>
                    <span class="chip chip-${artifactStatusSeverity(row.status)}">${escapeHtml(titleizeStatus(row.status))}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
          <div class="workspace-action-row">
            <button class="action-button action-button-quiet" type="button" data-open-motion-detail="${escapeHtml(artifact.motionId)}">Open detail</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderMotionDetailOverlays(motionDetails, interactive, now) {
  return motionDetails.map((detail) => renderMotionDetailOverlay(detail, interactive, now)).join("");
}

function renderMotionDetailOverlay(detail, interactive, now) {
  const syncButton = interactive?.enabled
    ? `
      <button
        class="action-button workspace-action-button"
        type="button"
        data-action="${escapeHtml(JSON.stringify({
          kind: "refresh_motion",
          motionId: detail.motionId,
          label: "sync motion",
        }))}"
        data-busy-label="Syncing..."
        data-done-label="Synced"
      >Sync motion</button>
    `
    : "";
  const planStats = [
    { label: "Companies", value: detail.plan.companyCount },
    { label: "Prospects", value: detail.plan.prospectCount },
    { label: "Ready branches", value: detail.plan.readyToSendCount },
    { label: "Message-ready", value: detail.plan.messageTestReadyCount },
  ];
  const premiseTruth = renderMotionTruthTag(
    titleizeStatus(detail.premise.status ?? "unknown"),
    motionTruthToneFromStatus(detail.premise.status),
    null,
  );
  const strategyTruth = renderMotionTruthTag(
    detail.strategyState.label ?? "quiet",
    detail.strategyState.tone,
    null,
  );

  return `
    <section
      class="shell-page motion-detail-page"
      data-page="motion-detail"
      data-motion-detail="${escapeHtml(detail.motionId)}"
      data-motion-name="${escapeHtml(detail.motionName)}"
      hidden
    >
      <div class="motion-detail-shell">
        <div class="motion-detail">
            <div class="motion-head">
              <div>
                <div class="mh-eyebrow">
                  ${renderMotionDetailIcon("layers", 13)}
                  <span class="mh-tag">MOTION</span>
                  ${renderMotionStateDot(detail.motionStatus)}
                  ${strategyTruth}
                </div>
                <div class="mh-name" id="motion-detail-title-${escapeHtml(detail.motionId)}">${escapeHtml(detail.motionName)}</div>
              </div>
              <div class="motion-head-actions">
                ${syncButton}
              </div>
            </div>

            <section class="offer-card">
              <div class="offer-head">
                <span class="def-cap">${renderMotionDetailIcon("spark", 12)}Offer · what this motion is for</span>
                <a class="offer-url" href="${escapeHtml(detail.offer.url)}" target="_blank" rel="noreferrer">${renderMotionDetailIcon("link", 12)}${escapeHtml(detail.offer.urlLabel)}</a>
              </div>
              <div class="offer-title">What this motion is for</div>
              <div class="offer-kicker">${escapeHtml(detail.offer.title)}</div>
              <p class="offer-summary">${escapeHtml(detail.offer.summary)}</p>
              <div class="offer-thesis">
                <div class="ot-cell">
                  <span class="ot-cap">Problem</span>
                  <span class="ot-val">${escapeHtml(detail.offer.problem)}</span>
                </div>
                <div class="ot-cell">
                  <span class="ot-cap">Felt by</span>
                  <span class="ot-val">${escapeHtml(detail.offer.feltBy)}</span>
                </div>
                <div class="ot-cell">
                  <span class="ot-cap">Triggers</span>
                  <span class="ot-val">${escapeHtml(detail.offer.triggers)}</span>
                </div>
              </div>
            </section>

            <section class="premise-hero">
              <div class="premise-flag">${renderMotionDetailIcon("target", 13)}Premise · Why this offer matters here</div>
              <p class="premise-statement">${escapeHtml(detail.premise.statement ?? "No premise is defined yet.")}</p>
              <p class="premise-note">${escapeHtml(detail.premise.note)}</p>
              <div class="premise-meta">
                <span class="pm-item"><span class="pm-cap">Status</span>${premiseTruth}</span>
                <i class="pm-div"></i>
                <span class="pm-item"><span class="pm-cap">Source</span><span class="pm-src">${escapeHtml(titleizeStatus(detail.premise.source))}</span></span>
                <i class="pm-div"></i>
                <span class="pm-item"><span class="pm-cap">Updated</span><span class="pm-src">${escapeHtml(formatTimestamp(detail.updatedAt))}</span></span>
              </div>
            </section>

            <div class="md-section sig-section">Signals <span>${escapeHtml(String(detail.signals.length))}</span><em class="sig-section-q">What would tell us this premise is live here?</em></div>
            <div class="signal-grid">
              ${
                detail.signals.length > 0
                  ? detail.signals.map((signal, index) => `
                    <article class="signal-card">
                      <div class="sig-top">
                        <span class="sig-idx">S${index + 1}</span>
                        <div class="sig-main">
                          <div class="sig-q">${escapeHtml(signal.question)}</div>
                        </div>
                        <span class="scope-badge ${escapeHtml(humanizeSignalScope(signal.scope).className)}">${renderMotionDetailIcon(humanizeSignalScope(signal.scope).icon, 11)}${escapeHtml(humanizeSignalScope(signal.scope).label)}</span>
                      </div>
                      <div class="sig-why">${escapeHtml(signal.whyItMatters ?? "Why-now rationale has not been written yet.")}</div>
                      <div class="sig-rule">
                        <span class="sig-rule-cap">CHECK</span>
                        <code>${escapeHtml(signal.matchRule ?? "No match rule is stored yet.")}</code>
                      </div>
                      <div class="sig-foot">
                        <div class="sig-methods">
                          ${signal.methods.length > 0
                            ? signal.methods.map((method) => `<span class="method-chip">${escapeHtml(method)}</span>`).join("")
                            : `<span class="method-chip">Observation method not stored</span>`}
                        </div>
                        <div class="sig-foot-right">
                          <span class="sig-window">${renderMotionDetailIcon("clock", 11)}${escapeHtml(signal.latestEvidenceAt ? `Latest ${formatRelative(signal.latestEvidenceAt, now)}` : "No matched evidence yet")}</span>
                          ${renderMotionTruthTag(titleizeStatus(signal.status), motionTruthToneFromStatus(signal.status), null)}
                          <span class="sig-matched">${escapeHtml(signal.matchLabel)}</span>
                        </div>
                      </div>
                    </article>
                  `).join("")
                  : `<div class="empty-state">No motion signals are stored yet.</div>`
              }
            </div>

            <div class="md-section">Audience hypotheses <span>${escapeHtml(String(detail.audiences.length))}</span></div>
            <div class="hyp-list">
              ${
                detail.audiences.length > 0
                  ? detail.audiences.map((audience, index) => `
                    <article class="hyp-card">
                      <span class="hyp-idx">H${index + 1}</span>
                      <div class="hyp-body">
                        <div class="hyp-stmt">${escapeHtml(audience.name)}</div>
                        <div class="hyp-roles">${escapeHtml(audience.rolesLine)}</div>
                      </div>
                      <span class="hyp-match">${escapeHtml(`${audience.matchedCount} matched`)}</span>
                    </article>
                  `).join("")
                  : `<div class="empty-state">No audience hypotheses are stored yet.</div>`
              }
            </div>

            <div class="evidence-rule">${renderMotionDetailIcon("arrowR", 13)}Below: where these signals actually fired — evidence generated by the motion.</div>

            <div class="md-section">Matched companies <span>${escapeHtml(String(detail.companies.length))}</span></div>
            <div class="md-list">
              ${
                detail.companies.length > 0
                  ? detail.companies.map((company) => `
                    <article class="md-co">
                      ${renderMotionDetailIcon("building", 15, "md-co-ic")}
                      <div class="md-co-id">
                        <span class="md-co-name">${escapeHtml(company.companyName)}</span>
                        <span class="md-co-sub">${escapeHtml(extractHost(company.websiteUrl) ?? company.domain ?? "canonical identity stored")}</span>
                      </div>
                      ${
                        company.matchedSignalIndexes.length > 0
                          ? `<span class="match-sig" title="${escapeHtml(company.matchedSignalQuestions.join(" · "))}">matched ${escapeHtml(company.matchedSignalIndexes.join(" · "))}</span>`
                          : `<span class="match-sig">No linked signal ids</span>`
                      }
                      <span class="md-co-meta">${escapeHtml(formatCount(company.prospectCount, "person"))}</span>
                      ${renderMotionStateDot(company.executionIdentity?.status, company.executionIdentity?.status)}
                    </article>
                  `).join("")
                  : `<div class="empty-state">No companies have fired a stored motion signal yet.</div>`
              }
            </div>

            <div class="md-section">Research backlog <span>${escapeHtml(String(detail.backlogCompanies.length))}</span></div>
            <div class="md-list">
              ${
                detail.backlogCompanies.length > 0
                  ? detail.backlogCompanies.map((company) => `
                    <article class="md-co">
                      ${renderMotionDetailIcon("building", 15, "md-co-ic")}
                      <div class="md-co-id">
                        <span class="md-co-name">${escapeHtml(company.companyName)}</span>
                        <span class="md-co-sub">${escapeHtml(extractHost(company.websiteUrl) ?? company.domain ?? "canonical identity stored")}</span>
                      </div>
                      <span class="match-sig">${renderMotionDetailIcon("refresh", 11)}${escapeHtml(titleizeStatus(company.stage))}</span>
                      <span class="md-co-meta">${escapeHtml(formatCount(company.prospectCount, "person"))}</span>
                      ${renderMotionStateDot(company.executionIdentity?.status, company.executionIdentity?.status)}
                    </article>
                  `).join("")
                  : `<div class="empty-state">No research backlog is exposed right now.</div>`
              }
            </div>

            <div class="md-section">Matched people <span>${escapeHtml(String(detail.people.length))}</span></div>
            <div class="md-list">
              ${
                detail.people.length > 0
                  ? detail.people.map((person) => `
                    <article class="md-co">
                      ${renderAvatar(person.name, person.avatarUrl, "person")}
                      <div class="md-co-id">
                        <span class="md-co-name">${escapeHtml(person.name)}</span>
                        <span class="md-co-sub">${escapeHtml(`${person.title} · ${person.companyName}`)}</span>
                      </div>
                      <span class="match-sig" title="${escapeHtml(person.signalQuestion ?? person.signalLabel)}">${renderMotionDetailIcon("activity", 11)}${escapeHtml(person.signalLabel)}</span>
                      ${renderMotionStateDot(person.branchState.key, person.branchState.label)}
                      ${renderMotionOwnerTag(person.ownerLabel)}
                    </article>
                  `).join("")
                  : `<div class="empty-state">No people have been carried into this motion yet.</div>`
              }
            </div>

            <div class="md-section">Motion plan &amp; execution</div>
            ${detail.blocker ? `<div class="rel-gap">${renderMotionDetailIcon("alert", 13)}${escapeHtml(detail.blocker)}</div>` : ""}
            <div class="plan-list">
              ${
                detail.plan.nextSteps.length > 0
                  ? detail.plan.nextSteps.map((step) => `
                    <article class="plan-row">
                      ${renderMotionDetailIcon("arrowR", 14, "plan-ic")}
                      <span class="plan-text">${escapeHtml(step.text)}</span>
                      ${step.tag ? `<span class="hyp-match tone-${escapeHtml(step.tone ?? "neutral")}">${escapeHtml(step.tag)}</span>` : ""}
                    </article>
                  `).join("")
                  : `<div class="empty-state">No governed next actions are exposed for this motion right now.</div>`
              }
            </div>
            <div class="md-stats plan-stats">
              ${planStats.map((stat) => `
                <article class="md-tile">
                  <b>${escapeHtml(String(stat.value))}</b>
                  <em>${escapeHtml(stat.label)}</em>
                </article>
              `).join("")}
            </div>
        </div>
      </div>
    </section>
  `;
}

function renderDecisionQueue(decisionQueue, now, interactive) {
  if (decisionQueue.items.length === 0) {
    return `<div class="empty-state">No operator decisions are exposed right now.</div>`;
  }

  return `
    <div class="work-stack">
      ${decisionQueue.items
        .slice(0, 6)
        .map((item) => {
          const optionsLabel = item.options.length > 0
            ? item.options.map((option) => titleizeStatus(option)).join(" / ")
            : "Review";
          const actorContext = [
            item.actorTitle,
            item.actorCompanyName
              && !String(item.actorTitle ?? "").toLowerCase().includes(String(item.actorCompanyName).toLowerCase())
              ? item.actorCompanyName
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const meta = [
            item.surfaceKey ? titleizeStatus(item.surfaceKey) : null,
            formatRelative(item.observedAt, now),
            item.companyName,
          ].filter(Boolean);
          const controlMarkup = [
            renderWorkspaceActionLinksMarkup(toArray(item.links)),
            renderWorkspaceActionButtonMarkup(toArray(item.actions), interactive),
          ].join("");

          return `
            <article class="work-card work-card-danger">
              <div class="work-card-head">
                <div>
                  <div class="mini-eyebrow">${escapeHtml(titleizeStatus(item.state))}</div>
                  <h3>${escapeHtml(item.subject)}</h3>
                </div>
                <span class="chip chip-${item.priority === "high" ? "danger" : item.priority === "medium" ? "warning" : "quiet"}">${escapeHtml(
                  optionsLabel,
                )}</span>
              </div>
              ${actorContext ? `<p class="work-card-subline">${escapeHtml(actorContext)}</p>` : ""}
              <p class="work-card-copy">${escapeHtml(item.summary)}</p>
              <div class="work-card-meta">${meta.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>
              ${controlMarkup ? `<div class="workspace-action-row">${controlMarkup}</div>` : ""}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderAgentQueueItems(items, now, emptyMessage) {
  if (items.length === 0) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }

  return `
    <div class="work-stack">
      ${items
        .slice(0, 6)
        .map((item) => {
          const meta = [
            item.motionName,
            item.sourceType ? titleizeStatus(item.sourceType.replaceAll("_", " ")) : null,
            formatRelative(item.dueAt, now),
          ].filter(Boolean);

          return `
            <article class="work-card">
              <div class="work-card-head">
                <div>
                  <div class="mini-eyebrow">${escapeHtml(titleizeStatus(item.state))}</div>
                  <h3>${escapeHtml(item.subject)}</h3>
                </div>
                <span class="chip chip-${item.state === "due_now" ? "accent" : "quiet"}">${escapeHtml(
                  formatRelative(item.dueAt, now),
                )}</span>
              </div>
              <p class="work-card-copy">${escapeHtml(item.action)}</p>
              <div class="work-card-meta">${meta.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderWorkspaceActionLinksMarkup(links) {
  return toArray(links)
    .map((link) => `
      <a
        class="action-button action-button-quiet action-link-button"
        href="${escapeHtml(link.href)}"
        target="_blank"
        rel="noreferrer"
      >${escapeHtml(link.label)}</a>
    `)
    .join("");
}

function renderWorkspaceActionButtonMarkup(actions, interactive) {
  if (!interactive?.enabled || !actions.length) {
    return "";
  }

  return actions
    .map((action) => `
      <button
        class="action-button workspace-action-button"
        type="button"
        data-action="${escapeHtml(JSON.stringify(action))}"
      >${escapeHtml(action.label)}</button>
    `)
    .join("");
}

function renderWorkspaceActionButtons(actions, interactive) {
  const buttons = renderWorkspaceActionButtonMarkup(actions, interactive);
  if (!buttons) {
    return "";
  }

  return `
    <div class="workspace-action-row">
      ${buttons}
    </div>
  `;
}

function renderBacklogQueue(executionBacklog, interactive) {
  const cards = [];

  executionBacklog.blockers.forEach((item) => {
    cards.push(`
      <article class="mini-card">
        <div class="mini-card-head">
          <span class="mini-eyebrow">${escapeHtml(titleizeStatus(item.channel))}</span>
          <strong>${escapeHtml(`${item.blockedReadyCount} blocked-ready`)}</strong>
        </div>
        <p>${escapeHtml(
          `${item.blockedCompanyCount} compan${item.blockedCompanyCount === 1 ? "y" : "ies"} need assignment${item.firstCompanyName ? `. Start with ${item.firstCompanyName}.` : "."}`,
        )}</p>
        ${renderWorkspaceActionButtons(toArray(item.stateActions), interactive)}
      </article>
    `);
  });

  executionBacklog.packets.forEach((item) => {
    cards.push(`
      <article class="mini-card">
        <div class="mini-card-head">
          <span class="mini-eyebrow">${escapeHtml(titleizeStatus(item.channel))}</span>
          <strong>${escapeHtml(`${item.count} ${titleizeStatus(item.kind)}`)}</strong>
        </div>
        <p>${escapeHtml(item.preview.join(" / ") || item.firstMotionName || "Claimable packet backlog exposed.")}</p>
        ${renderWorkspaceActionButtons(toArray(item.stateActions), interactive)}
      </article>
    `);
  });

  if (cards.length === 0) {
    return `<div class="empty-state">No blocked-ready work or background packet backlog is exposed right now.</div>`;
  }

  return `<div class="mini-stack">${cards.join("")}</div>`;
}

function renderTruthAccounts(truthAccounts, now) {
  return truthAccounts
    .map((account) => {
      const accountSummary = [
        formatCount(account.actionableSurfaceCount, "actionable surface"),
        formatCount(account.uncheckedSurfaceCount, "unchecked surface"),
        formatCount(account.surfaces.length, "tracked surface"),
      ].join(" · ");

      const surfaceMarkup =
        account.surfaces.length === 0
          ? `<div class="empty-state">No governed inbound surfaces are exposed for this account yet.</div>`
          : account.surfaces
              .map((surface) => {
                const fields = [
                  ["lastRunStatus", surface.lastRunStatus ?? "unknown"],
                  ["lastSyncedAt", formatTimestamp(surface.lastSyncedAt)],
                  ["lastObservedAt", formatTimestamp(surface.lastObservedAt)],
                  ["lastItemCount", surface.lastItemCount ?? "none"],
                ];

                return `
                  <article class="surface-card tone-${escapeHtml(surface.meta.tone)}">
                    <div class="surface-card-head">
                      <div>
                        <div class="mini-eyebrow">${escapeHtml(surface.truthLevel)}</div>
                        <h4>${escapeHtml(surface.label)}</h4>
                      </div>
                      <div class="chip-row">${renderChips(surface.meta.chips)}</div>
                    </div>
                    <p class="surface-summary">${escapeHtml(surface.summary ?? surface.meta.freshnessLabel)}</p>
                    <div class="surface-field-grid">
                      ${fields
                        .map(
                          ([label, value]) => `
                            <div class="surface-field">
                              <span>${escapeHtml(label)}</span>
                              <strong>${escapeHtml(String(value))}</strong>
                            </div>
                          `,
                        )
                        .join("")}
                    </div>
                    <div class="surface-foot">
                      <span>${escapeHtml(surface.meta.freshnessLabel)}</span>
                      <span>${escapeHtml(formatRelative(surface.meta.lastMeaningfulAt?.toISOString(), now))}</span>
                    </div>
                    ${
                      surface.recommendedAction
                        ? `<p class="surface-action">${escapeHtml(surface.recommendedAction)}</p>`
                        : ""
                    }
                  </article>
                `;
              })
              .join("");

      return `
        <section class="account-truth-group">
          <div class="account-truth-head">
            <div>
              <div class="mini-eyebrow">${escapeHtml(account.capability)}</div>
              <h3>${escapeHtml(account.handle)}</h3>
            </div>
            <p>${escapeHtml(accountSummary)}</p>
          </div>
          <div class="surface-grid">${surfaceMarkup}</div>
        </section>
      `;
    })
    .join("");
}

function renderMotionCards(motions) {
  return motions
    .map((motion) => {
      const identitySummary = compactCountLine(motion.executionIdentityCounts) || "No execution identity data";
      const queueSummary = [
        formatCount(motion.companyCount, "company"),
        formatCount(motion.prospectCount, "prospect"),
        formatCount(motion.readyToSendCount, "ready branch"),
      ].join(" · ");
      const dailySummary = [
        formatCount(motion.dueNowCount, "due now"),
        formatCount(motion.waitingCount, "waiting"),
        formatCount(motion.reviewCount, "review item"),
      ].join(" · ");

      return `
        <article
          class="motion-card motion-card-link"
          role="button"
          tabindex="0"
          aria-label="${escapeHtml(`Open ${motion.name} motion detail`)}"
          data-open-motion-detail="${escapeHtml(motion.id)}"
        >
          <div class="motion-card-head">
            <div>
              <div class="mini-eyebrow">${escapeHtml(titleizeStatus(motion.status))}</div>
              <h3>${escapeHtml(motion.name)}</h3>
            </div>
            <div class="chip-row">
              <span class="chip chip-${motion.readyToEngage ? "good" : "warning"}">${escapeHtml(
                motion.readyToEngage ? "engageable" : "not engageable",
              )}</span>
              <span class="chip chip-quiet">${escapeHtml(titleizeStatus(motion.overallStage))}</span>
            </div>
          </div>
          <div class="metric-strip">
            <div>
              <span>Updated</span>
              <strong>${escapeHtml(formatTimestamp(motion.updatedAt))}</strong>
            </div>
            <div>
              <span>Motion queue</span>
              <strong>${escapeHtml(queueSummary)}</strong>
            </div>
            <div>
              <span>Planner pressure</span>
              <strong>${escapeHtml(dailySummary)}</strong>
            </div>
          </div>
          <div class="motion-note-grid">
            <div class="note-card">
              <span>Browser gate</span>
              <strong>${escapeHtml(titleizeStatus(motion.browserGate?.status ?? "unknown"))}</strong>
              <p>${escapeHtml(motion.browserGate?.message ?? "No clear execution gate is recorded for this motion yet.")}</p>
            </div>
            <div class="note-card">
              <span>Execution identity</span>
              <strong>${escapeHtml(identitySummary)}</strong>
              <p>Pinned sending identity coverage across the companies in this motion.</p>
            </div>
          </div>
          <div class="motion-actions">
            <span>Top next actions</span>
            <ul>
              ${
                motion.nextActions.length > 0
                  ? motion.nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")
                  : "<li>No motion-level next actions were exposed.</li>"
              }
            </ul>
          </div>
          <div class="motion-card-foot" aria-hidden="true">
            <span>View motion setup</span>
            <span>→</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderLaneSection(title, subtitle, lanes, renderCard) {
  return `
    <section class="lane-section">
      <div class="subsection-head">
        <div>
          <div class="mini-eyebrow">Current Exo state</div>
          <h3>${escapeHtml(title)}</h3>
        </div>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <div class="lane-grid">
        ${lanes
          .map((lane) => {
            const count = lane.items.length;
            return `
              <section class="lane-column">
                <div class="lane-head">
                  <div>
                    <h4>${escapeHtml(lane.label)}</h4>
                    <p>${escapeHtml(lane.description)}</p>
                  </div>
                  <strong>${count}</strong>
                </div>
                <div class="lane-stack">
                  ${
                    count > 0
                      ? lane.items.map(renderCard).join("")
                      : `<div class="empty-state">Nothing in this lane right now.</div>`
                  }
                </div>
              </section>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderCompanyPrepCard(company) {
  const companyLogoUrl = company.logoUrl ?? company.companyLogoUrl ?? null;

  return `
    <article class="prep-card">
      <div class="prep-card-head">
        <div class="entity-row">
          ${renderAvatar(company.companyName, companyLogoUrl, "company")}
          <div class="entity-copy">
            <div class="mini-eyebrow">${escapeHtml(company.motionName)}</div>
            <h4>${escapeHtml(company.companyName)}</h4>
            <p class="entity-subline">${escapeHtml(
              extractHost(company.websiteUrl) ?? company.domain ?? "canonical identity still incomplete",
            )}</p>
          </div>
        </div>
        <span class="chip chip-${company.executionIdentity?.status === "pinned-ready" ? "good" : "warning"}">${escapeHtml(
          titleizeStatus(company.executionIdentity?.status ?? "unknown"),
        )}</span>
      </div>
      <div class="mini-metrics">
        <span>${escapeHtml(titleizeStatus(company.queueStatus))}</span>
        <span>${escapeHtml(formatCount(company.signalMatchCount, "signal"))}</span>
        <span>${escapeHtml(formatCount(company.prospectCount, "prospect"))}</span>
      </div>
      <p>${escapeHtml(company.lane.description)}</p>
      <div class="kv-grid">
        <div><span>through-lines ready</span><strong>${company.readyThroughLineCount}</strong></div>
        <div><span>opening plans ready</span><strong>${company.readyOpeningPlanCount}</strong></div>
        <div><span>cadence ready</span><strong>${company.readyCadenceCount}</strong></div>
        <div><span>missing email fallback</span><strong>${company.missingEmailFallbackCount}</strong></div>
      </div>
    </article>
  `;
}

function renderProspectPrepCard(prospect) {
  const liveBranch = Boolean(prospect.cadenceState?.lastTouchAt || toArray(prospect.touches).length > 0);
  const channelSummary = `${humanizeChannel(prospect.primaryChannel)} → ${humanizeChannel(
    prospect.fallbackChannel,
  )}`;
  const enrichStatus = prospect.contactEnrichmentState?.status ?? "unknown";
  const avatarUrl = prospect.avatarUrl ?? prospect.profileImageUrl ?? null;

  return `
    <article class="prep-card">
      <div class="prep-card-head">
        <div class="entity-row">
          ${renderAvatar(prospect.name, avatarUrl, "person")}
          <div class="entity-copy">
            <div class="mini-eyebrow">${escapeHtml(prospect.motionName)}</div>
            <h4>${escapeHtml(prospect.name)}</h4>
            <p class="entity-subline">${escapeHtml(prospect.title)}</p>
          </div>
        </div>
        <div class="chip-row">
          <span class="chip chip-${liveBranch ? "warning" : "quiet"}">${escapeHtml(
            liveBranch ? "engagement live" : "not launched",
          )}</span>
          <span class="chip chip-${prospect.recentPost?.engageable ? "accent" : "quiet"}">${escapeHtml(
            prospect.recentPost?.engageable ? "warmup ready" : "no live warmup",
          )}</span>
        </div>
      </div>
      <div class="mini-metrics">
        <span>${escapeHtml(prospect.companyName)}</span>
        <span>${escapeHtml(channelSummary)}</span>
      </div>
      <p>${escapeHtml(prospect.lane.description)}</p>
      <div class="kv-grid">
        <div><span>queue</span><strong>${escapeHtml(titleizeStatus(prospect.queueStatus))}</strong></div>
        <div><span>through-line</span><strong>${escapeHtml(titleizeStatus(prospect.throughLineStatus))}</strong></div>
        <div><span>opening plan</span><strong>${escapeHtml(titleizeStatus(prospect.openingPlanStatus))}</strong></div>
        <div><span>contact enrichment</span><strong>${escapeHtml(titleizeStatus(enrichStatus))}</strong></div>
      </div>
    </article>
  `;
}

function renderEngagementCard(prospect, now) {
  const dailyItem = prospect.dailyItem;
  const reviewItem = prospect.reviewItem;
  const touch = latestTouch(prospect);
  const cadence = prospect.cadenceState ?? {};
  const lastOutcome = cadence.lastTouchOutcome ?? touch?.outcome ?? "not-started";
  const dueAt = dailyItem?.dueAt ?? cadence.nextActionDueAt ?? null;
  const overdue = dueAt ? parseDate(dueAt)?.getTime() <= now.getTime() : false;
  const nextAction = dailyItem?.recommendedAction ?? prospect.nextAction ?? cadence.nextAction ?? "No next action recorded.";
  const lastTouchSummary = touch?.summary ?? "No touch recorded in Exo.";
  const lastTouchTimestamp = touch?.occurredAt ?? cadence.lastTouchAt ?? null;
  const avatarUrl = prospect.avatarUrl ?? prospect.profileImageUrl ?? null;
  const companyLogoUrl = prospect.logoUrl ?? prospect.companyLogoUrl ?? null;

  return `
    <article class="engagement-card">
      <div class="engagement-card-head">
        <div class="entity-row">
          ${renderAvatar(prospect.name, avatarUrl, "person")}
          <div class="entity-copy">
            <div class="mini-eyebrow">${escapeHtml(prospect.motionName)}</div>
            <h4>${escapeHtml(prospect.name)}</h4>
            <p class="entity-subline">${escapeHtml(prospect.title)}</p>
          </div>
        </div>
        <div class="chip-row">
          <span class="chip chip-${overdue ? "danger" : dueAt ? "accent" : "quiet"}">${escapeHtml(
            overdue ? "overdue" : dueAt ? "timed" : "untimed",
          )}</span>
          ${reviewItem ? '<span class="chip chip-warning">inbound review</span>' : ""}
        </div>
      </div>
      <div class="entity-support-row">
        ${renderCompanyPill(prospect.companyName, prospect.websiteUrl, companyLogoUrl)}
      </div>
      <div class="mini-metrics">
        <span>primary: ${escapeHtml(humanizeChannel(prospect.primaryChannel))}</span>
        <span>fallback: ${escapeHtml(humanizeChannel(prospect.fallbackChannel))}</span>
      </div>
      <div class="kv-grid kv-grid-dense">
        <div><span>current step</span><strong>${escapeHtml(titleizeStatus(cadence.currentStep ?? "none"))}</strong></div>
        <div><span>last outcome</span><strong>${escapeHtml(titleizeStatus(lastOutcome))}</strong></div>
        <div><span>last touch</span><strong>${escapeHtml(formatTimestamp(lastTouchTimestamp))}</strong></div>
        <div><span>due time</span><strong>${escapeHtml(formatTimestamp(dueAt))}</strong></div>
      </div>
      <p class="tight-copy">${escapeHtml(lastTouchSummary)}</p>
      <p class="tight-copy"><strong>Next action:</strong> ${escapeHtml(nextAction)}</p>
    </article>
  `;
}

function renderRailItems(items, emptyMessage, renderer) {
  if (items.length === 0) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }

  return items.map(renderer).join("");
}

function renderDailyRailItem(item) {
  const title =
    item.prospect?.id === "outbound-capacity:linkedin"
      ? "LinkedIn capacity deficit"
      : `${item.company?.name ?? "Unknown company"} / ${item.prospect?.name ?? "Unknown prospect"}`;

  return `
    <article class="rail-card">
      <div class="rail-card-head">
        <h4>${escapeHtml(title)}</h4>
        <span class="chip chip-${item.state === "due_now" ? "danger" : "warning"}">${escapeHtml(
          titleizeStatus(item.state),
        )}</span>
      </div>
      <p>${escapeHtml(item.recommendedAction ?? item.cadence?.nextAction ?? "No action recorded.")}</p>
      <div class="rail-meta">${escapeHtml(item.motion?.name ?? "No motion")} · ${escapeHtml(
        formatTimestamp(item.dueAt),
      )}</div>
    </article>
  `;
}

function renderReviewRailItem(item) {
  const title = `${item.company?.name ?? "Unknown company"} / ${item.prospect?.name ?? item.actorName ?? "Unknown prospect"}`;

  return `
    <article class="rail-card">
      <div class="rail-card-head">
        <h4>${escapeHtml(title)}</h4>
        <span class="chip chip-${item.priority === "high" ? "danger" : item.priority === "medium" ? "warning" : "quiet"}">${escapeHtml(
          titleizeStatus(item.priority),
        )}</span>
      </div>
      <p>${escapeHtml(item.summary)}</p>
      <div class="rail-meta">${escapeHtml(item.surfaceKey)} · ${escapeHtml(formatTimestamp(item.observedAt))}</div>
      <p class="tight-copy"><strong>Recommended:</strong> ${escapeHtml(item.recommendedAction)}</p>
    </article>
  `;
}

function renderGapNotes(notes) {
  return notes
    .map(
      (note) => `
        <article class="gap-card">
          <h4>${escapeHtml(note.title)}</h4>
          <p>${escapeHtml(note.body)}</p>
        </article>
      `,
    )
    .join("");
}

function groupIntoLanes(items, laneOrder) {
  const buckets = new Map(laneOrder.map((lane) => [lane.key, { ...lane, items: [] }]));

  items.forEach((item) => {
    const existing = buckets.get(item.lane.key) ?? buckets.get(item.engagementLane?.key);
    const laneKey = item.lane?.key ?? item.engagementLane?.key;
    if (!laneKey) {
      return;
    }

    if (!buckets.has(laneKey)) {
      const fallback = item.lane ?? item.engagementLane;
      buckets.set(laneKey, { ...fallback, items: [] });
    }

    buckets.get(laneKey).items.push(item);
  });

  return [...buckets.values()];
}

function sortEngagementCards(items, now) {
  return items.slice().sort((left, right) => {
    const leftDue = parseDate(left.dailyItem?.dueAt ?? left.cadenceState?.nextActionDueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightDue = parseDate(right.dailyItem?.dueAt ?? right.cadenceState?.nextActionDueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;

    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    const leftTouch = parseDate(left.cadenceState?.lastTouchAt)?.getTime() ?? 0;
    const rightTouch = parseDate(right.cadenceState?.lastTouchAt)?.getTime() ?? 0;

    if (leftTouch !== rightTouch) {
      return rightTouch - leftTouch;
    }

    return `${left.companyName}:${left.name}`.localeCompare(`${right.companyName}:${right.name}`);
  });
}

function renderPage({
  truthAccounts,
  motionSummaries,
  motionDetails,
  operatorSummary,
  decisionQueue,
  agentQueue,
  blockedQueue,
  executionBacklog,
  interactive,
  artifactSummaries,
  companyPrep,
  prospectPrep,
  engagementProspects,
  daily,
  inboundReview,
  inbox,
  gapNotes,
  now,
  regenerateCommand,
}) {
  const allSurfaces = truthAccounts.flatMap((account) => account.surfaces);
  const staleSurfaceCount = allSurfaces.filter((surface) => surface.meta.stale && !surface.meta.unchecked).length;
  const uncheckedSurfaceCount = allSurfaces.filter((surface) => surface.meta.unchecked).length;
  const actionableSurfaceCount = allSurfaces.filter((surface) => surface.meta.actionable).length;
  const readyBranchCount = motionSummaries.reduce((total, motion) => total + (motion.readyToSendCount ?? 0), 0);

  const companyLanes = groupIntoLanes(companyPrep, [
    { key: "needs-company-identity", label: "Needs company identity", description: "Website or LinkedIn company identity is still missing." },
    { key: "queued-for-research", label: "Queued for research", description: "Identity exists, but research is not complete yet." },
    { key: "researched", label: "Researched / pick prospects", description: "Signals are in, but prospect selection is still open." },
    { key: "selected", label: "Selected / build branches", description: "Prospects exist, but branch scaffolding is incomplete." },
    { key: "targeting-ready", label: "Targeting ready", description: "Company prep is already usable for outreach branches." },
    { key: "suppressed", label: "Suppressed", description: "This company is intentionally out of play." },
    { key: "exhausted", label: "Exhausted", description: "No more viable company work is exposed right now." },
  ]).map((lane) => ({
    ...lane,
    items: sortByName(lane.items, "companyName"),
  }));

  const prospectPrepLanes = groupIntoLanes(prospectPrep, [
    { key: "needs-through-line", label: "Needs through-line", description: "The branch still lacks a why-talk line." },
    { key: "needs-opening-plan", label: "Needs opening plan", description: "The first move is not defensible yet." },
    { key: "needs-cadence", label: "Needs cadence state", description: "Exo does not yet expose a usable current step." },
    { key: "contact-enrichment-pending", label: "Contact enrichment pending", description: "Core branch logic exists, but fallback coverage is still open." },
    { key: "primary-only-ready", label: "Ready but weak fallback", description: "Primary path exists, but direct fallback is still thin." },
    { key: "prep-complete", label: "Prep complete", description: "Prep is done; engagement state is separate." },
  ]).map((lane) => ({
    ...lane,
    items: sortByName(lane.items, "name"),
  }));

  const engagementLanes = [
    { key: "ready", label: "Ready", description: "Prepared branches that still need their first governed move." },
    { key: "sent-pending", label: "Sent / pending", description: "Touches are in flight and waiting on the other side." },
    { key: "waiting", label: "Waiting", description: "Branches intentionally held in reserve or waiting on a checkpoint." },
    { key: "blocked", label: "Blocked", description: "Primary path failed or the channel blocked." },
    { key: "reply-accepted", label: "Reply / accepted", description: "Cold-start phase is over; live response handling takes over." },
    { key: "exhausted", label: "Exhausted", description: "No further governed move is exposed here right now." },
  ].map((lane) => ({
    ...lane,
    items: sortEngagementCards(
      engagementProspects.filter((prospect) => prospect.engagementLane.key === lane.key),
      now,
    ),
  }));

  const headerStats = [
    { count: decisionQueue.itemCount, label: "need decision" },
    { count: blockedQueue.itemCount, label: "blocked" },
    { count: staleSurfaceCount, label: "stale" },
  ];
  const operatorHeroItem = pickOperatorNextMoveItem(decisionQueue);
  const operatorDecisionItems = decisionQueue.items
    .filter((item) => item.id !== operatorHeroItem?.id)
    .slice(0, 4);
  const operatorStaleRows = buildOperatorStaleRows(truthAccounts);
  const operatorAgendaRows = buildOperatorAgendaRows(daily, now);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exo Motion Workspace Projection</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

    :root {
      --bg: #090b0f;
      --panel: #11141a;
      --panel-strong: #171b23;
      --panel-soft: #0d1015;
      --line: rgba(255, 255, 255, 0.09);
      --line-strong: rgba(255, 255, 255, 0.16);
      --text: #eef2f8;
      --muted: #98a4b5;
      --cold: #667387;
      --accent: #346bff;
      --accent-soft: rgba(52, 107, 255, 0.16);
      --good: #33c28c;
      --good-soft: rgba(51, 194, 140, 0.14);
      --warn: #f0a44d;
      --warn-soft: rgba(240, 164, 77, 0.14);
      --drift: #f06f7e;
      --drift-soft: rgba(240, 111, 126, 0.14);
      --disabled: #778294;
      --disabled-soft: rgba(119, 130, 148, 0.16);
      --radius: 20px;
      --radius-sm: 13px;
      --shadow: 0 22px 60px rgba(0, 0, 0, 0.32);
      --md-sans: "Hanken Grotesk", "Manrope", sans-serif;
      --md-mono: "JetBrains Mono", "IBM Plex Mono", monospace;
      --md-bg-1: #0d0d0f;
      --md-bg-2: #131316;
      --md-bg-3: #1a1a1f;
      --md-bg-hover: #202027;
      --md-border: rgba(255, 255, 255, 0.07);
      --md-border-2: rgba(255, 255, 255, 0.12);
      --md-border-3: rgba(255, 255, 255, 0.18);
      --md-text: #ededf0;
      --md-text-2: #a1a1aa;
      --md-text-3: #71717a;
      --md-text-4: #52525b;
      --md-green: #22c55e;
      --md-amber: #f59e0b;
      --md-red: #ef4444;
      --md-violet: #a78bfa;
      --md-slate: #94a3b8;
    }

    * {
      box-sizing: border-box;
    }

    [hidden] {
      display: none !important;
    }

    html, body {
      margin: 0;
      height: 100%;
      min-height: 100%;
      background: var(--md-bg-1);
      color: var(--md-text);
      font-family: var(--md-sans);
      font-size: 13.5px;
      -webkit-font-smoothing: antialiased;
    }

    body {
      overflow: hidden;
    }

    h1, h2, h3, h4, p, ul {
      margin: 0;
    }

    ul {
      padding-left: 18px;
    }

    code {
      font-family: var(--md-mono);
      font-size: 0.9em;
    }

    .exo-root {
      display: grid;
      grid-template-columns: 212px minmax(0, 1fr);
      height: 100vh;
      background: var(--md-bg-1);
    }

    .exo-root.nav-collapsed {
      grid-template-columns: 58px minmax(0, 1fr);
    }

    .nav {
      background: var(--md-bg-1);
      border-right: 1px solid var(--md-border);
      display: flex;
      flex-direction: column;
      padding: 14px 10px;
      gap: 1px;
      overflow-y: auto;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 4px 6px 14px;
    }

    .brand-mark {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      background: var(--accent);
      color: #fff;
      display: grid;
      place-items: center;
      flex: none;
    }

    .brand-name {
      font-weight: 800;
      font-size: 18px;
      letter-spacing: -0.04em;
      color: var(--md-text);
    }

    .nav-collapse {
      margin-left: auto;
      appearance: none;
      background: none;
      border: none;
      color: var(--md-text-4);
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      display: grid;
      place-items: center;
    }

    .nav-collapse:hover {
      color: var(--md-text-2);
      background: var(--md-bg-3);
    }

    .nav.collapsed {
      padding: 14px 8px;
      align-items: center;
    }

    .nav.collapsed .nav-brand {
      flex-direction: column;
      gap: 12px;
      padding: 2px 0 14px;
    }

    .nav.collapsed .nav-collapse {
      margin: 0;
    }

    .nav.collapsed .nav-item {
      justify-content: center;
      padding: 9px 0;
      width: 40px;
    }

    .nav.collapsed .nav-item span,
    .nav.collapsed .brand-name {
      display: none;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 7px 9px;
      border: none;
      background: none;
      color: var(--md-text-2);
      border-radius: 8px;
      cursor: pointer;
      font-size: 13.5px;
      font-weight: 500;
      text-align: left;
      transition: background .12s, color .12s;
    }

    .nav-item:hover {
      background: var(--md-bg-3);
      color: var(--md-text);
    }

    .nav-item.active {
      background: var(--md-bg-3);
      color: var(--md-text);
      font-weight: 600;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
    }

    .nav-item.active .md-ic,
    .nav-item.active svg {
      color: var(--accent);
    }

    .nav-spacer {
      flex: 1;
    }

    .main {
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100vh;
    }

    .topbar {
      height: 52px;
      flex: none;
      border-bottom: 1px solid var(--md-border);
      background: var(--md-bg-1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      gap: 14px;
    }

    .crumbs {
      display: flex;
      align-items: center;
      gap: 5px;
      color: var(--md-text-3);
    }

    .crumb-btn {
      appearance: none;
      background: none;
      border: none;
      color: var(--md-text-3);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      padding: 4px 7px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
    }

    .crumb-btn:hover {
      color: var(--md-text);
      background: var(--md-bg-3);
    }

    .cr-sep {
      color: var(--md-text-4);
      display: inline-flex;
      align-items: center;
    }

    .cr-cur {
      color: var(--md-text);
      font-weight: 700;
    }

    .top-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .searchbox {
      position: relative;
      width: 306px;
    }

    .sb-ic {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--md-text-4);
      pointer-events: none;
    }

    .searchbox input {
      width: 100%;
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      border-radius: 9px;
      color: var(--md-text);
      font-family: inherit;
      font-size: 13px;
      padding: 10px 12px 10px 31px;
      outline: none;
    }

    .searchbox input:focus {
      border-color: var(--md-border-3);
      background: var(--md-bg-3);
    }

    .searchbox input::placeholder {
      color: var(--md-text-4);
    }

    .chrome-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      color: var(--md-text-2);
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 600;
    }

    .chrome-btn:hover {
      background: var(--md-bg-3);
      color: var(--md-text);
    }

    .raise-trigger .md-ic {
      color: var(--md-violet);
    }

    .canvas {
      flex: 1;
      overflow-y: auto;
      padding: 22px 26px 80px;
    }

    .page-stack {
      display: grid;
      gap: 18px;
      align-content: start;
    }

    .shell-page {
      display: grid;
      gap: 18px;
      align-content: start;
      max-width: 1180px;
    }

    .shell-page[hidden] {
      display: none !important;
    }

    .page-head {
      display: grid;
      gap: 6px;
      max-width: 880px;
    }

    .page-head h1 {
      font-size: 24px;
      letter-spacing: -0.03em;
    }

    .page-head p {
      color: var(--md-text-3);
      font-size: 13px;
      line-height: 1.5;
    }

    .op-intro {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      max-width: 1240px;
    }

    .op-intro > div:first-child {
      flex: 1;
      min-width: 0;
    }

    .op-intro h1 {
      font-size: 24px;
      letter-spacing: -0.03em;
    }

    .op-line {
      color: var(--md-text-3);
      font-size: 13px;
      margin-top: 3px;
      max-width: 620px;
    }

    .op-stat {
      display: flex;
      align-items: center;
      gap: 11px;
      font-size: 12.5px;
      color: var(--md-text-3);
      background: var(--md-bg-1);
      border: 1px solid var(--md-border);
      border-radius: 10px;
      padding: 9px 14px;
      white-space: nowrap;
      flex-wrap: wrap;
    }

    .op-stat b {
      color: var(--md-text);
      font-weight: 700;
      font-size: 14px;
    }

    .op-stat i {
      width: 1px;
      height: 14px;
      background: var(--md-border-2);
    }

    .op-wrap {
      max-width: 1180px;
      display: grid;
      gap: 18px;
    }

    .op-sec {
      display: grid;
      gap: 11px;
    }

    .card {
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      border-radius: 13px;
      padding: 14px;
      position: relative;
    }

    .card.stakes-high {
      border-color: rgba(59, 130, 246, 0.34);
      box-shadow: inset 3px 0 0 var(--accent);
    }

    .card.stakes-block {
      border-color: rgba(239, 68, 68, 0.28);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      border: 1px solid transparent;
      white-space: nowrap;
      text-decoration: none;
      font-family: inherit;
      transition: background .13s, border-color .13s;
    }

    .btn-md {
      padding: 8px 15px;
    }

    .btn-sm {
      padding: 6px 11px;
      font-size: 12px;
      gap: 6px;
    }

    .btn-primary {
      background: var(--accent);
      color: #fff;
      box-shadow: 0 1px 0 rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.14);
    }

    .btn-primary:hover {
      background: color-mix(in srgb, var(--accent) 88%, #fff);
    }

    .btn-secondary {
      background: var(--md-bg-3);
      color: var(--md-text);
      border-color: var(--md-border-2);
    }

    .btn-secondary:hover {
      background: var(--md-bg-hover);
      border-color: var(--md-border-3);
    }

    .btn-ghost {
      background: transparent;
      color: var(--md-text-2);
      border-color: var(--md-border);
    }

    .btn-ghost:hover {
      background: var(--md-bg-3);
      color: var(--md-text);
    }

    .btn-danger {
      background: transparent;
      color: #f87171;
      border-color: rgba(239,68,68,.32);
    }

    .btn-danger:hover {
      background: rgba(239,68,68,.12);
      border-color: rgba(239,68,68,.5);
    }

    .action-tag {
      display: inline-flex;
      align-items: center;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: .02em;
      color: var(--am);
      padding-left: 9px;
      position: relative;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .action-tag::before {
      content: "";
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 11px;
      border-radius: 2px;
      background: var(--am);
    }

    .cap-ref {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--md-text-3);
      font-family: var(--md-mono);
      letter-spacing: -.01em;
    }

    .cap-ref .md-ic {
      color: var(--md-text-4);
    }

    .count-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--md-bg-3);
      color: var(--md-text-2);
      font-size: 11.5px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 20px;
      border: 1px solid var(--md-border);
    }

    .count-chip em {
      font-style: normal;
      font-weight: 500;
      color: var(--md-text-3);
      font-size: 10.5px;
    }

    .count-chip.tone-amber {
      color: #fbbf24;
      background: rgba(245,158,11,.1);
      border-color: rgba(245,158,11,.22);
    }

    .count-chip.tone-blue {
      color: #60a5fa;
      background: rgba(59,130,246,.1);
      border-color: rgba(59,130,246,.22);
    }

    .count-chip.tone-red {
      color: #f87171;
      background: rgba(239,68,68,.1);
      border-color: rgba(239,68,68,.22);
    }

    .row-top {
      display: flex;
      align-items: flex-start;
      gap: 11px;
    }

    .row-id {
      flex: 1;
      min-width: 0;
    }

    .row-name {
      font-weight: 700;
      font-size: 14px;
      letter-spacing: -.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .row-role {
      font-size: 12px;
      color: var(--md-text-3);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 1px;
    }

    .row-summary {
      font-size: 12.5px;
      color: var(--md-text-2);
      margin: 9px 0 0;
      line-height: 1.5;
    }

    .row-summary .blk-reason {
      color: var(--md-text);
      font-weight: 600;
    }

    .row-note {
      font-size: 12px;
      color: var(--md-text-3);
      margin: 7px 0 0;
      line-height: 1.45;
    }

    .row-chips {
      display: flex;
      align-items: center;
      gap: 13px;
      flex-wrap: wrap;
      margin-top: 10px;
    }

    .row-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    .row-actions.tight {
      margin-top: 9px;
    }

    .next-move {
      padding: 16px 18px;
    }

    .nm-flag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--md-mono);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .16em;
      color: var(--accent);
      margin-bottom: 11px;
      text-transform: uppercase;
    }

    .nm-body {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }

    .nm-main {
      flex: 1;
      min-width: 0;
    }

    .nm-title {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -.02em;
    }

    .nm-sub {
      font-size: 12.5px;
      color: var(--md-text-3);
      margin-top: 2px;
    }

    .nm-chips {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-top: 10px;
    }

    .nm-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: none;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .why {
      margin-top: 12px;
      border-top: 1px solid var(--md-border);
      padding-top: 11px;
    }

    .why-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      color: var(--md-violet);
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      font-family: var(--md-mono);
      letter-spacing: .02em;
      padding: 0;
    }

    .why-text {
      font-size: 12.5px;
      color: var(--md-text-2);
      line-height: 1.6;
      margin-top: 8px;
      border-left: 2px solid rgba(167,139,250,.35);
      padding-left: 11px;
    }

    .sec-head {
      display: flex;
      align-items: center;
      gap: 9px;
      margin-bottom: 11px;
    }

    .sec-head .md-ic {
      color: var(--md-text-3);
    }

    .sec-head h2 {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -.01em;
      white-space: nowrap;
    }

    .sec-sub {
      font-size: 11.5px;
      color: var(--md-text-4);
      font-family: var(--md-mono);
    }

    .sec-right {
      margin-left: auto;
    }

    .sec-body {
      display: flex;
      flex-direction: column;
      gap: 9px;
    }

    .empty-state {
      display: flex;
      align-items: center;
      gap: 9px;
      color: var(--md-text-4);
      font-size: 12.5px;
      padding: 14px;
      border: 1px dashed var(--md-border-2);
      border-radius: 10px;
    }

    .empty-state .md-ic {
      color: var(--md-text-4);
    }

    .blk-reason {
      color: #f87171 !important;
    }

    .stale-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      border-radius: 12px;
      overflow: hidden;
    }

    .stale-row {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      padding: 12px 14px;
      transition: background .12s;
    }

    .stale-row:not(:last-child) {
      border-bottom: 1px solid var(--md-border);
    }

    .stale-row:hover {
      background: var(--md-bg-3);
    }

    .stale-ic {
      color: var(--md-text-3);
      margin-top: 1px;
    }

    .stale-main {
      flex: 1;
      min-width: 0;
    }

    .stale-top {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .stale-subject {
      font-weight: 600;
      font-size: 13px;
    }

    .stale-detail {
      font-size: 12px;
      color: var(--md-text-3);
      margin-top: 2px;
    }

    .agenda-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      border-radius: 12px;
      overflow: hidden;
    }

    .agenda-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 14px;
      background: none;
      border: none;
      width: 100%;
      text-align: left;
      cursor: pointer;
      color: var(--md-text);
      transition: background .12s;
    }

    .agenda-row:not(:last-child) {
      border-bottom: 1px solid var(--md-border);
    }

    .agenda-row:hover {
      background: var(--md-bg-3);
    }

    .agenda-check {
      width: 17px;
      height: 17px;
      border-radius: 5px;
      border: 1.5px solid var(--at);
      flex: none;
      display: grid;
      place-items: center;
      color: var(--at);
    }

    .agenda-time {
      font-family: var(--md-mono);
      font-size: 11px;
      color: var(--md-text-3);
      width: 40px;
      flex: none;
    }

    .agenda-label {
      flex: 1;
      font-size: 12.5px;
      font-weight: 500;
    }

    .agenda-meta {
      font-family: var(--md-mono);
      font-size: 10.5px;
      color: var(--md-text-4);
    }

    .context-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 16px;
    }

    .context-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .context-chip {
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--md-border);
      background: var(--md-bg-2);
      min-width: 136px;
    }

    .context-chip span {
      display: block;
      color: var(--md-text-4);
      font-family: var(--md-mono);
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .context-chip strong {
      display: block;
      margin-top: 6px;
      color: var(--md-text);
      font-size: 12.5px;
      line-height: 1.35;
    }

    .shell-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .control-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.8fr);
      gap: 18px;
      align-items: start;
    }

    .secondary-stack {
      display: grid;
      gap: 18px;
    }

    .queue-panel {
      display: grid;
      gap: 16px;
    }

    .queue-panel-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }

    .queue-panel-head h2,
    .queue-panel-head h3 {
      margin-top: 8px;
      letter-spacing: -0.04em;
    }

    .queue-panel-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .work-stack,
    .mini-stack {
      display: grid;
      gap: 12px;
    }

    .queue-panel .work-stack {
      max-height: 680px;
      overflow: auto;
      padding-right: 4px;
    }

    .work-card,
    .mini-card {
      border: 1px solid var(--md-border);
      border-radius: 13px;
      background: var(--md-bg-2);
    }

    .work-card {
      padding: 16px;
      display: grid;
      gap: 12px;
    }

    .mini-card {
      padding: 14px 16px;
      display: grid;
      gap: 8px;
    }

    .work-card-danger {
      border-color: rgba(239, 68, 68, 0.22);
      background: rgba(239, 68, 68, 0.06);
    }

    .work-card-head,
    .mini-card-head {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: flex-start;
    }

    .work-card-head h3 {
      margin-top: 8px;
      font-size: 1rem;
      letter-spacing: -0.03em;
    }

    .work-card-copy,
    .mini-card p {
      color: var(--text);
      line-height: 1.55;
    }

    .work-card-subline {
      margin-top: -4px;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.45;
    }

    .mini-card p {
      color: var(--muted);
    }

    .work-card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: var(--muted);
      font-size: 0.8rem;
      font-family: "IBM Plex Mono", monospace;
    }

    .work-card-meta span::after {
      content: "•";
      margin-left: 10px;
      color: rgba(255, 255, 255, 0.18);
    }

    .work-card-meta span:last-child::after {
      content: "";
      margin: 0;
    }

    .workspace-action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .action-button {
      appearance: none;
      border: 1px solid rgba(52, 107, 255, 0.28);
      background: rgba(52, 107, 255, 0.12);
      color: var(--text);
      border-radius: 999px;
      padding: 8px 12px;
      font: inherit;
      font-size: 0.84rem;
      cursor: pointer;
      transition: 140ms ease;
    }

    .action-link-button {
      display: inline-flex;
      align-items: center;
      text-decoration: none;
    }

    .action-button:hover {
      background: rgba(52, 107, 255, 0.18);
      border-color: rgba(52, 107, 255, 0.42);
    }

    .action-button:disabled {
      cursor: wait;
      opacity: 0.6;
    }

    .action-button-quiet {
      border-color: rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.04);
    }

    .workspace-status {
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(52, 107, 255, 0.22);
      background: rgba(52, 107, 255, 0.08);
      color: var(--text);
      font-size: 0.9rem;
    }

    .workspace-status.is-error {
      border-color: rgba(239, 139, 139, 0.24);
      background: rgba(239, 139, 139, 0.12);
    }

    .hero,
    .section,
    .rail-panel,
    .gap-section {
      border: 1px solid var(--md-border);
      border-radius: 13px;
      background: var(--md-bg-2);
      box-shadow: none;
    }

    .hero {
      padding: 22px;
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(320px, 1fr);
      gap: 24px;
      border-color: rgba(59, 130, 246, 0.18);
    }

    .hero h1 {
      margin-top: 10px;
      font-size: clamp(2.1rem, 4vw, 3.2rem);
      line-height: 0.98;
      letter-spacing: -0.05em;
      max-width: 12ch;
    }

    .hero-copy {
      color: var(--muted);
      max-width: 70ch;
      line-height: 1.65;
      margin-top: 14px;
    }

    .hero-main {
      display: grid;
      gap: 18px;
    }

    .hero-metrics {
      display: grid;
      gap: 12px;
      align-content: start;
    }

    .metric-card {
      padding: 16px 18px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.028), rgba(255, 255, 255, 0.012));
    }

    .metric-card span,
    .note-card span,
    .surface-field span,
    .kv-grid span,
    .mini-metrics span,
    .rail-meta,
    .mini-eyebrow,
    .section-eyebrow {
      display: block;
      color: var(--muted);
      font-size: 0.8rem;
    }

    .metric-card strong,
    .note-card strong,
    .surface-field strong,
    .kv-grid strong,
    .lane-head strong,
    .artifact-row strong,
    .operator-call strong {
      display: block;
      margin-top: 6px;
      font-size: 1rem;
    }

    .eyebrow,
    .mini-eyebrow,
    .section-eyebrow {
      color: var(--accent);
      font-family: "IBM Plex Mono", monospace;
      text-transform: uppercase;
      letter-spacing: 0.14em;
    }

    .eyebrow {
      font-size: 0.78rem;
    }

    .mini-eyebrow,
    .section-eyebrow {
      font-size: 0.7rem;
    }

    .content-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 18px;
      align-items: start;
    }

    .main-column {
      display: grid;
      gap: 18px;
    }

    .section {
      padding: 20px;
    }

    .operator-call {
      padding: 18px;
      border-radius: 18px;
      border: 1px solid rgba(52, 107, 255, 0.24);
      background:
        linear-gradient(180deg, rgba(52, 107, 255, 0.12), rgba(52, 107, 255, 0.03)),
        rgba(11, 15, 22, 0.9);
      display: grid;
      gap: 14px;
    }

    .operator-call-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }

    .operator-call h2,
    .artifact-card h3 {
      margin-top: 8px;
      letter-spacing: -0.04em;
    }

    .operator-next-move {
      font-size: 1.05rem;
      line-height: 1.6;
      color: var(--text);
    }

    .operator-why,
    .operator-focus p,
    .artifact-row > div span,
    .artifact-card p {
      color: var(--muted);
      line-height: 1.6;
    }

    .operator-focus {
      display: grid;
      gap: 8px;
      padding-top: 2px;
    }

    .operator-focus strong {
      font-size: 1rem;
    }

    .operator-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 10px;
    }

    .operator-item {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
    }

    .operator-item p {
      margin-top: 6px;
      color: var(--muted);
      line-height: 1.55;
    }

    .operator-item span {
      color: var(--cold);
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.76rem;
      white-space: nowrap;
    }

    .section-head,
    .subsection-head,
    .account-truth-head,
    .motion-card-head,
    .artifact-card-head,
    .surface-card-head,
    .prep-card-head,
    .engagement-card-head,
    .rail-card-head,
    .lane-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }

    .section-head h2,
    .subsection-head h3 {
      margin-top: 10px;
      letter-spacing: -0.04em;
    }

    .section-head p,
    .subsection-head p,
    .motion-card p,
    .prep-card p,
    .engagement-card p,
    .surface-summary,
    .surface-action,
    .gap-card p,
    .rail-card p {
      color: var(--muted);
      line-height: 1.6;
    }

    .summary-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }

    .summary-chip {
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.022);
    }

    .summary-chip strong {
      display: block;
      margin-top: 6px;
      font-size: 1rem;
    }

    .truth-stack,
    .motion-grid,
    .gap-grid,
    .artifact-grid {
      display: grid;
      gap: 16px;
      margin-top: 18px;
    }

    .account-truth-group {
      padding: 18px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.018);
    }

    .account-truth-head h3,
    .motion-card h3 {
      margin-top: 8px;
      font-size: 1.3rem;
      letter-spacing: -0.04em;
    }

    .surface-grid,
    .motion-grid,
    .artifact-grid {
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }

    .surface-grid {
      display: grid;
      gap: 12px;
      margin-top: 14px;
    }

    .motion-card-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
      color: var(--accent);
      font-family: var(--md-mono);
      font-size: 0.74rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .surface-card,
    .motion-card,
    .artifact-card,
    .prep-card,
    .engagement-card,
    .rail-card,
    .gap-card,
    .note-card {
      border: 1px solid var(--md-border);
      border-radius: 13px;
      background: var(--md-bg-2);
    }

    .surface-card,
    .motion-card,
    .artifact-card,
    .prep-card,
    .engagement-card,
    .rail-card,
    .gap-card {
      padding: 15px;
    }

    .motion-card-link {
      cursor: pointer;
      transition:
        border-color 140ms ease,
        background 140ms ease,
        transform 140ms ease,
        box-shadow 140ms ease;
    }

    .motion-card-link:hover {
      border-color: rgba(52, 107, 255, 0.28);
      background: linear-gradient(180deg, rgba(27, 30, 40, 0.98), rgba(19, 19, 22, 0.98));
      transform: translateY(-1px);
    }

    .motion-card-link:focus-visible {
      outline: none;
      border-color: rgba(52, 107, 255, 0.42);
      box-shadow:
        0 0 0 1px rgba(52, 107, 255, 0.42),
        0 0 0 4px rgba(52, 107, 255, 0.12);
    }

    .tone-danger {
      border-color: rgba(239, 139, 139, 0.36);
      background: linear-gradient(180deg, rgba(52, 24, 30, 0.82), rgba(18, 12, 15, 0.98));
    }

    .tone-warning {
      border-color: rgba(240, 164, 77, 0.32);
      background: linear-gradient(180deg, rgba(55, 35, 20, 0.74), rgba(18, 13, 10, 0.98));
    }

    .tone-accent {
      border-color: rgba(52, 107, 255, 0.32);
      background: linear-gradient(180deg, rgba(20, 35, 68, 0.8), rgba(12, 16, 26, 0.98));
    }

    .tone-good {
      border-color: rgba(51, 194, 140, 0.3);
      background: linear-gradient(180deg, rgba(18, 43, 35, 0.74), rgba(11, 16, 15, 0.98));
    }

    .tone-disabled {
      opacity: 0.72;
      border-color: rgba(108, 119, 133, 0.25);
    }

    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid transparent;
      font-size: 0.72rem;
      line-height: 1;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-family: "IBM Plex Mono", monospace;
    }

    .chip-good {
      color: var(--good);
      border-color: rgba(123, 220, 177, 0.26);
      background: var(--good-soft);
    }

    .chip-warning {
      color: var(--warn);
      border-color: rgba(214, 155, 109, 0.26);
      background: var(--warn-soft);
    }

    .chip-danger {
      color: var(--drift);
      border-color: rgba(239, 139, 139, 0.26);
      background: var(--drift-soft);
    }

    .chip-accent {
      color: var(--accent);
      border-color: rgba(52, 107, 255, 0.26);
      background: var(--accent-soft);
    }

    .chip-quiet {
      color: var(--muted);
      border-color: rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
    }

    .chip-disabled {
      color: var(--disabled);
      border-color: rgba(108, 119, 133, 0.24);
      background: var(--disabled-soft);
    }

    .surface-card h4,
    .prep-card h4,
    .engagement-card h4,
    .rail-card h4,
    .gap-card h4 {
      margin-top: 8px;
      font-size: 1rem;
      letter-spacing: -0.03em;
    }

    .surface-summary,
    .surface-action,
    .tight-copy {
      margin-top: 12px;
    }

    .entity-row {
      display: flex;
      gap: 12px;
      align-items: center;
      min-width: 0;
    }

    .entity-copy {
      min-width: 0;
    }

    .entity-copy h4 {
      margin-top: 6px;
    }

    .entity-subline {
      margin-top: 6px;
      color: var(--muted);
      line-height: 1.45;
    }

    .entity-support-row {
      margin-top: 14px;
    }

    .avatar {
      position: relative;
      flex: 0 0 auto;
      width: 46px;
      height: 46px;
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #131821;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
    }

    .avatar-company {
      width: 40px;
      height: 40px;
      border-radius: 14px;
    }

    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .avatar-fallback {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.9rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: rgba(255, 255, 255, 0.9);
    }

    .avatar-theme-0 { background: linear-gradient(135deg, #355cff, #182a60); }
    .avatar-theme-1 { background: linear-gradient(135deg, #00a7e1, #114168); }
    .avatar-theme-2 { background: linear-gradient(135deg, #7f4dff, #342163); }
    .avatar-theme-3 { background: linear-gradient(135deg, #13b57c, #163f38); }
    .avatar-theme-4 { background: linear-gradient(135deg, #ef8c3d, #5b2e12); }
    .avatar-theme-5 { background: linear-gradient(135deg, #f05f7a, #5e1e31); }

    .company-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
    }

    .company-pill-copy {
      min-width: 0;
    }

    .company-pill-copy strong,
    .company-pill-copy span {
      display: block;
    }

    .company-pill-copy strong {
      font-size: 0.88rem;
      line-height: 1.2;
    }

    .company-pill-copy span {
      margin-top: 4px;
      color: var(--muted);
      font-size: 0.74rem;
    }

    .surface-field-grid,
    .metric-strip,
    .motion-note-grid,
    .kv-grid,
    .gap-grid {
      display: grid;
      gap: 10px;
    }

    .surface-field-grid,
    .metric-strip,
    .motion-note-grid,
    .kv-grid {
      margin-top: 14px;
    }

    .surface-field-grid,
    .kv-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .kv-grid-dense {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .surface-field,
    .summary-chip,
    .metric-card,
    .note-card {
      padding: 12px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.024);
    }

    .surface-foot,
    .mini-metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }

    .mini-metrics span,
    .surface-foot span {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--muted);
      font-size: 0.76rem;
    }

    .motion-grid {
      display: grid;
      margin-top: 18px;
    }

    .artifact-stack {
      display: grid;
      gap: 10px;
    }

    .artifact-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.02);
    }

    .motion-actions {
      margin-top: 14px;
    }

    .motion-actions span {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 0.8rem;
    }

    .motion-actions li {
      color: var(--text);
      margin-top: 6px;
      line-height: 1.45;
    }

    .lane-section + .lane-section {
      margin-top: 20px;
    }

    .lane-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }

    .lane-column {
      padding: 0;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(18, 21, 28, 0.98), rgba(12, 15, 20, 0.98));
      min-height: 220px;
      overflow: hidden;
    }

    .lane-stack {
      display: grid;
      gap: 12px;
      padding: 14px;
      background: rgba(7, 9, 13, 0.28);
    }

    .lane-head {
      padding: 16px 16px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.018);
    }

    .empty-state {
      padding: 14px;
      border-radius: 14px;
      border: 1px dashed rgba(255, 255, 255, 0.12);
      color: var(--muted);
      background: rgba(255, 255, 255, 0.02);
      line-height: 1.5;
    }

    .right-rail {
      position: sticky;
      top: 24px;
      display: grid;
      gap: 18px;
    }

    .rail-panel {
      padding: 18px;
    }

    .rail-panel h3 {
      margin-top: 8px;
      letter-spacing: -0.03em;
    }

    .rail-stack {
      display: grid;
      gap: 12px;
      margin-top: 16px;
    }

    .rail-meta {
      margin-top: 10px;
    }

    .gap-section {
      padding: 24px;
    }

    .gap-grid {
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      margin-top: 18px;
    }

    .regen {
      margin-top: 14px;
      padding: 12px;
      border-radius: 14px;
      border: 1px solid rgba(52, 107, 255, 0.2);
      background: rgba(52, 107, 255, 0.08);
      color: var(--text);
      line-height: 1.6;
    }

    body.modal-open {
      overflow: hidden;
    }

    .motion-detail-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
    }

    .motion-detail-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(4, 6, 10, 0.72);
      backdrop-filter: blur(10px);
    }

    .motion-detail-panel {
      position: relative;
      z-index: 1;
      width: calc(100vw - 12px);
      max-height: calc(100vh - 12px);
      margin: 6px;
      border: 1px solid rgba(52, 107, 255, 0.14);
      border-radius: 24px;
      background: linear-gradient(180deg, rgba(12, 15, 21, 0.98), rgba(8, 11, 16, 0.98));
      box-shadow: 0 40px 120px rgba(0, 0, 0, 0.52);
      overflow: hidden;
      outline: none;
      display: flex;
      justify-content: flex-start;
    }

    .motion-detail-shell {
      width: min(1120px, 100%);
      max-height: calc(100vh - 12px);
      overflow: auto;
      padding: 22px 26px 80px;
      display: grid;
      gap: 16px;
      box-sizing: border-box;
      scrollbar-gutter: stable;
    }

    .motion-detail-header,
    .motion-detail-block-head,
    .motion-detail-section-head,
    .motion-detail-premise-meta,
    .motion-signal-top,
    .motion-signal-foot,
    .motion-match-row,
    .motion-plan-row,
    .motion-audience-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }

    .motion-detail-header {
      align-items: center;
      padding-bottom: 4px;
    }

    .motion-detail-eyebrow,
    .motion-detail-header-actions,
    .motion-plan-summary,
    .motion-signal-methods,
    .motion-signal-meta,
    .motion-match-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .motion-detail-header h2 {
      margin-top: 10px;
      font-size: 1.05rem;
      color: var(--muted);
      letter-spacing: -0.02em;
    }

    .motion-detail-block,
    .motion-detail-section {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(16, 20, 26, 0.98), rgba(11, 14, 19, 0.98));
      padding: 16px 18px;
    }

    .motion-detail-block-head h3,
    .motion-detail-section-head h3,
    .motion-detail-premise h3 {
      margin-top: 8px;
      letter-spacing: -0.04em;
    }

    .motion-detail-link {
      color: var(--text);
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.8rem;
      text-decoration: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.18);
      padding-bottom: 2px;
    }

    .motion-detail-link:hover {
      color: #a8c1ff;
      border-color: rgba(168, 193, 255, 0.6);
    }

    .motion-detail-offer-title {
      margin-top: 14px;
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .motion-detail-copy {
      margin-top: 10px;
      color: var(--muted);
      line-height: 1.65;
      max-width: 88ch;
    }

    .motion-detail-offer-grid,
    .motion-plan-stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 16px;
    }

    .motion-detail-offer-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .motion-detail-offer-grid article,
    .motion-plan-stat {
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .motion-detail-offer-grid span,
    .motion-plan-stat span,
    .motion-detail-premise-meta em,
    .motion-signal-rule span,
    .motion-audience-copy p,
    .motion-match-copy p,
    .motion-detail-divider {
      color: var(--muted);
      font-size: 0.78rem;
      line-height: 1.5;
    }

    .motion-detail-offer-grid strong,
    .motion-plan-stat strong {
      display: block;
      margin-top: 8px;
      font-size: 0.9rem;
      line-height: 1.55;
      font-weight: 600;
    }

    .motion-detail-premise {
      border-color: rgba(52, 107, 255, 0.22);
      background:
        linear-gradient(180deg, rgba(52, 107, 255, 0.12), rgba(52, 107, 255, 0.04)),
        rgba(10, 13, 18, 0.98);
      box-shadow: inset 3px 0 0 var(--accent);
    }

    .motion-detail-premise-statement {
      margin-top: 16px;
      max-width: 40ch;
      font-size: clamp(1.4rem, 2vw, 1.72rem);
      line-height: 1.45;
      letter-spacing: -0.03em;
    }

    .motion-detail-premise-note {
      margin-top: 14px;
      padding-left: 12px;
      border-left: 2px solid rgba(255, 255, 255, 0.16);
      color: rgba(238, 242, 248, 0.84);
      line-height: 1.6;
      max-width: 72ch;
    }

    .motion-detail-premise-meta {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      flex-wrap: wrap;
    }

    .motion-detail-premise-meta span {
      display: grid;
      gap: 6px;
      min-width: 140px;
    }

    .motion-detail-premise-meta em {
      font-style: normal;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-family: "IBM Plex Mono", monospace;
    }

    .motion-detail-premise-meta strong {
      font-size: 0.94rem;
    }

    .motion-signal-stack,
    .motion-audience-stack,
    .motion-match-list,
    .motion-plan-list {
      display: grid;
      gap: 12px;
      margin-top: 16px;
    }

    .motion-signal-card,
    .motion-match-row,
    .motion-plan-row,
    .motion-audience-row {
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
    }

    .motion-signal-index,
    .motion-audience-index {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 36px;
      height: 28px;
      padding: 0 8px;
      border-radius: 999px;
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.74rem;
      color: #b7c9ff;
      background: rgba(52, 107, 255, 0.16);
      border: 1px solid rgba(52, 107, 255, 0.26);
      flex: none;
    }

    .motion-signal-title {
      flex: 1;
      min-width: 0;
    }

    .motion-signal-title strong,
    .motion-audience-copy strong,
    .motion-match-copy strong,
    .motion-plan-row strong {
      font-size: 0.98rem;
      line-height: 1.5;
      letter-spacing: -0.02em;
    }

    .motion-signal-title p {
      margin-top: 8px;
      color: var(--muted);
      line-height: 1.58;
    }

    .motion-scope-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-family: "IBM Plex Mono", monospace;
      border: 1px solid rgba(255, 255, 255, 0.08);
      white-space: nowrap;
    }

    .motion-scope-company {
      color: #9dc0ff;
      background: rgba(96, 165, 250, 0.12);
      border-color: rgba(96, 165, 250, 0.24);
    }

    .motion-scope-person {
      color: #d4bbff;
      background: rgba(167, 139, 250, 0.12);
      border-color: rgba(167, 139, 250, 0.22);
    }

    .motion-scope-both {
      color: #96eef8;
      background: rgba(34, 211, 238, 0.12);
      border-color: rgba(34, 211, 238, 0.24);
    }

    .motion-signal-rule {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.06);
      overflow: auto;
    }

    .motion-signal-rule code {
      display: block;
      margin-top: 6px;
      white-space: pre-wrap;
      color: #d5def2;
    }

    .motion-signal-foot {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      flex-wrap: wrap;
    }

    .motion-signal-meta {
      color: var(--muted);
      font-size: 0.78rem;
      font-family: "IBM Plex Mono", monospace;
      justify-content: flex-end;
      flex: 1;
    }

    .motion-audience-copy {
      flex: 1;
      min-width: 0;
    }

    .motion-match-main {
      display: flex;
      gap: 12px;
      align-items: center;
      min-width: 0;
      flex: 1;
    }

    .motion-match-copy {
      min-width: 0;
    }

    .motion-match-meta {
      justify-content: flex-end;
      flex: 1;
      color: var(--muted);
      font-size: 0.8rem;
      min-width: 0;
    }

    .motion-match-meta .chip {
      max-width: 520px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .motion-detail-divider {
      margin-bottom: 12px;
      font-style: italic;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .motion-detail-gap {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(240, 164, 77, 0.24);
      background: rgba(240, 164, 77, 0.1);
      color: #ffd9a9;
      line-height: 1.55;
    }

    .motion-plan-list {
      margin-top: 14px;
    }

    @media (max-width: 1200px) {
      .content-grid,
      .hero,
      .control-grid {
        grid-template-columns: 1fr;
      }

      .right-rail {
        position: static;
      }
    }

    @media (max-width: 980px) {
      .op-intro,
      .context-row {
        flex-direction: column;
        align-items: flex-start;
      }

      .searchbox {
        width: min(100%, 280px);
      }
    }

    @media (max-width: 760px) {
      .exo-root {
        grid-template-columns: 72px minmax(0, 1fr);
      }

      .summary-strip,
      .surface-field-grid,
      .metric-strip,
      .motion-note-grid,
      .kv-grid,
      .kv-grid-dense {
        grid-template-columns: 1fr;
      }

      .nav {
        padding: 14px 8px;
        align-items: center;
      }

      .nav .nav-brand {
        flex-direction: column;
        gap: 12px;
        padding: 2px 0 14px;
      }

      .nav .nav-collapse {
        margin: 0;
      }

      .nav .nav-item {
        justify-content: center;
        padding: 9px 0;
        width: 40px;
      }

      .nav .nav-item span,
      .nav .brand-name {
        display: none;
      }

      .canvas {
        padding: 18px 14px 56px;
      }

      .topbar,
      .top-right {
        flex-direction: column;
        align-items: flex-start;
      }

      .section,
      .hero,
      .gap-section,
      .rail-panel {
        padding: 18px;
      }

      .queue-panel-head,
      .operator-item,
      .artifact-row {
        flex-direction: column;
      }

      .motion-detail-panel {
        width: calc(100vw - 12px);
        margin: 6px;
        max-height: calc(100vh - 12px);
      }

      .motion-detail-shell {
        padding: 18px 16px 42px;
      }

      .motion-detail-header,
      .motion-detail-block-head,
      .motion-detail-section-head,
      .motion-signal-top,
      .motion-signal-foot,
      .motion-match-row,
      .motion-audience-row,
      .motion-plan-row {
        flex-direction: column;
      }

      .motion-detail-offer-grid,
      .motion-plan-stats {
        grid-template-columns: 1fr;
      }
    }

    /* Motion detail fidelity pass: match the design package instead of the
       generic workspace card language. */
    body.modal-open {
      overflow: hidden;
    }

    .motion-detail-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
    }

    .motion-detail-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(5, 5, 7, 0.72);
      backdrop-filter: blur(3px);
    }

    .motion-detail-panel {
      position: relative;
      z-index: 1;
      width: 100vw;
      height: 100vh;
      margin: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      overflow: hidden;
      outline: none;
    }

    .motion-detail-shell {
      height: 100vh;
      overflow: auto;
      padding: 22px 26px 80px;
      box-sizing: border-box;
      scrollbar-gutter: stable;
    }

    .motion-detail {
      max-width: 1000px;
      font-family: var(--md-sans);
      color: var(--md-text);
    }

    .motion-detail .action-button {
      border-radius: 8px;
      min-height: 38px;
      padding: 0 14px;
      background: var(--md-bg-2);
      border-color: var(--md-border-2);
      color: var(--md-text);
      box-shadow: none;
      font-family: var(--md-sans);
      font-size: 12.5px;
      font-weight: 600;
    }

    .motion-detail .action-button:hover {
      background: var(--md-bg-hover);
      border-color: var(--md-border-3);
      transform: none;
    }

    .motion-detail .action-button-quiet {
      background: transparent;
      color: var(--md-text-2);
    }

    .motion-detail-page {
      max-width: 1180px;
    }

    .motion-detail-page .motion-detail-shell {
      height: auto;
      overflow: visible;
      padding: 0;
    }

    .motion-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;
    }

    .motion-head-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .mh-eyebrow {
      display: flex;
      align-items: center;
      gap: 11px;
      margin-bottom: 6px;
    }

    .mh-eyebrow .md-ic {
      color: var(--md-text-4);
      flex: none;
    }

    .mh-tag {
      font-family: var(--md-mono);
      font-size: 10px;
      letter-spacing: 0.18em;
      color: var(--md-text-4);
      font-weight: 700;
    }

    .mh-name {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--md-text-2);
    }

    .motion-state-dot,
    .motion-truth-tag,
    .owner-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 999px;
      flex: none;
      white-space: nowrap;
    }

    .motion-state-dot {
      font-size: 11px;
      color: var(--md-text-2);
    }

    .motion-state-dot i {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      display: block;
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.04);
    }

    .motion-truth-tag {
      font-family: var(--md-mono);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 3px 9px;
      border: 1px solid var(--md-border);
      background: var(--md-bg-2);
    }

    .motion-truth-tag i {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      display: block;
    }

    .motion-truth-tag em {
      font-style: normal;
      color: var(--md-text-4);
    }

    .motion-truth-tag.truth-good {
      color: var(--md-green);
      background: rgba(34, 197, 94, 0.1);
      border-color: rgba(34, 197, 94, 0.18);
    }

    .motion-truth-tag.truth-good i {
      background: var(--md-green);
    }

    .motion-truth-tag.truth-warning {
      color: var(--md-amber);
      background: rgba(245, 158, 11, 0.1);
      border-color: rgba(245, 158, 11, 0.18);
    }

    .motion-truth-tag.truth-warning i {
      background: var(--md-amber);
    }

    .motion-truth-tag.truth-danger {
      color: var(--md-red);
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.18);
    }

    .motion-truth-tag.truth-danger i {
      background: var(--md-red);
    }

    .motion-truth-tag.truth-accent {
      color: var(--accent);
      background: rgba(59, 130, 246, 0.12);
      border-color: rgba(59, 130, 246, 0.18);
    }

    .motion-truth-tag.truth-accent i {
      background: var(--accent);
    }

    .motion-truth-tag.truth-quiet {
      color: var(--md-slate);
      background: rgba(148, 163, 184, 0.1);
      border-color: rgba(148, 163, 184, 0.18);
    }

    .motion-truth-tag.truth-quiet i {
      background: var(--md-slate);
    }

    .offer-card {
      background: var(--md-bg-1);
      border: 1px solid var(--md-border);
      border-radius: 13px;
      padding: 16px 18px;
      margin-bottom: 14px;
    }

    .offer-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 11px;
    }

    .def-cap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--md-mono);
      font-size: 9.5px;
      letter-spacing: 0.13em;
      text-transform: uppercase;
      color: var(--md-text-4);
      font-weight: 700;
    }

    .def-cap .md-ic {
      color: var(--md-violet);
      flex: none;
    }

    .offer-url {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-family: var(--md-mono);
      font-size: 11px;
      color: var(--md-text-3);
      text-decoration: none;
    }

    .offer-url:hover {
      color: var(--accent);
    }

    .offer-url .md-ic {
      color: var(--md-text-4);
      flex: none;
    }

    .offer-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-bottom: 9px;
    }

    .offer-kicker {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .offer-summary {
      font-size: 12.5px;
      color: var(--md-text-2);
      line-height: 1.55;
      margin-top: 5px;
      max-width: 760px;
      text-wrap: pretty;
    }

    .offer-thesis {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      background: var(--md-border);
      border: 1px solid var(--md-border);
      border-radius: 10px;
      overflow: hidden;
      margin-top: 13px;
    }

    .ot-cell {
      background: var(--md-bg-2);
      padding: 11px 13px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .ot-cap {
      font-family: var(--md-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--md-text-4);
    }

    .ot-val {
      font-size: 11.5px;
      color: var(--md-text-2);
      line-height: 1.45;
    }

    .premise-hero {
      position: relative;
      overflow: hidden;
      background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, var(--md-bg-2)), var(--md-bg-2));
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
      border-radius: 13px;
      padding: 20px 22px 18px;
      margin-bottom: 8px;
    }

    .premise-hero::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--accent);
    }

    .premise-flag {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-family: var(--md-mono);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: var(--accent);
      margin-bottom: 13px;
      text-transform: uppercase;
    }

    .premise-statement {
      font-size: 21px;
      line-height: 1.42;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--md-text);
      max-width: 840px;
      text-wrap: pretty;
    }

    .premise-note {
      font-size: 12.5px;
      color: var(--md-text-3);
      line-height: 1.55;
      margin-top: 13px;
      max-width: 780px;
      border-left: 2px solid var(--md-border-2);
      padding-left: 12px;
    }

    .premise-meta {
      display: flex;
      align-items: center;
      gap: 15px;
      flex-wrap: wrap;
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid var(--md-border);
    }

    .pm-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .pm-cap {
      font-family: var(--md-mono);
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--md-text-4);
    }

    .pm-src {
      font-size: 11.5px;
      color: var(--md-text-2);
    }

    .pm-div {
      width: 1px;
      height: 13px;
      background: var(--md-border-2);
      flex: none;
    }

    .md-section {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 13px;
      font-weight: 700;
      margin: 20px 0 11px;
    }

    .md-section span {
      font-family: var(--md-mono);
      font-size: 11px;
      color: var(--md-text-3);
      background: var(--md-bg-3);
      padding: 1px 8px;
      border-radius: 10px;
    }

    .sig-section {
      align-items: baseline;
    }

    .sig-section-q {
      font-style: normal;
      font-size: 12px;
      color: var(--md-text-3);
      font-weight: 500;
      font-family: var(--md-sans);
      letter-spacing: 0;
      background: none;
      padding: 0;
      margin-left: 2px;
    }

    .signal-grid {
      display: flex;
      flex-direction: column;
      gap: 11px;
    }

    .signal-card {
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      border-radius: 13px;
      padding: 15px 17px;
    }

    .sig-top {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 10px;
    }

    .sig-main {
      flex: 1;
      min-width: 0;
    }

    .sig-idx {
      font-family: var(--md-mono);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 13%, transparent);
      padding: 3px 7px;
      border-radius: 6px;
      flex: none;
      margin-top: 1px;
    }

    .sig-q {
      font-size: 14.5px;
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.4;
      text-wrap: pretty;
    }

    .sig-why {
      font-size: 12.5px;
      color: var(--md-text-2);
      line-height: 1.55;
      margin-bottom: 12px;
      max-width: 780px;
    }

    .sig-rule {
      display: flex;
      align-items: center;
      gap: 9px;
      background: var(--md-bg-1);
      border: 1px solid var(--md-border);
      border-radius: 8px;
      padding: 8px 11px;
      margin-bottom: 12px;
      overflow-x: auto;
    }

    .sig-rule-cap {
      font-family: var(--md-mono);
      font-size: 8.5px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: var(--md-text-4);
      flex: none;
    }

    .sig-rule code {
      font-family: var(--md-mono);
      font-size: 11px;
      color: var(--md-slate);
      white-space: nowrap;
    }

    .sig-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      padding-top: 11px;
      border-top: 1px solid var(--md-border);
    }

    .sig-methods,
    .sig-foot-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .method-chip {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--md-text-3);
      background: var(--md-bg-3);
      border: 1px solid var(--md-border);
      padding: 2px 8px;
      border-radius: 5px;
    }

    .sig-window {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: var(--md-mono);
      font-size: 10.5px;
      color: var(--md-text-4);
    }

    .sig-window .md-ic {
      flex: none;
    }

    .sig-matched {
      font-size: 11px;
      font-weight: 600;
      color: var(--md-text-2);
    }

    .scope-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-family: var(--md-mono);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      padding: 3px 9px;
      border-radius: 6px;
      flex: none;
      white-space: nowrap;
    }

    .scope-company {
      color: #60a5fa;
      background: rgba(59, 130, 246, 0.12);
    }

    .scope-person {
      color: #a78bfa;
      background: rgba(167, 139, 250, 0.12);
    }

    .scope-both {
      color: #22d3ee;
      background: rgba(34, 211, 238, 0.12);
    }

    .hyp-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .hyp-card {
      display: flex;
      align-items: center;
      gap: 13px;
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      border-radius: 11px;
      padding: 12px 15px;
    }

    .hyp-idx {
      font-family: var(--md-mono);
      font-size: 11px;
      font-weight: 700;
      color: var(--md-text-4);
      flex: none;
    }

    .hyp-body {
      flex: 1;
      min-width: 0;
    }

    .hyp-stmt {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
    }

    .hyp-roles {
      font-size: 11px;
      color: var(--md-text-3);
      margin-top: 3px;
      font-family: var(--md-mono);
    }

    .hyp-match {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      border-radius: 999px;
      font-family: var(--md-mono);
      font-size: 10.5px;
      font-weight: 700;
      color: #60a5fa;
      background: rgba(59, 130, 246, 0.12);
      border: 1px solid rgba(59, 130, 246, 0.18);
      white-space: nowrap;
    }

    .hyp-match.tone-accent {
      color: #60a5fa;
      background: rgba(59, 130, 246, 0.12);
      border-color: rgba(59, 130, 246, 0.18);
    }

    .hyp-match.tone-warning {
      color: var(--md-amber);
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.18);
    }

    .hyp-match.tone-danger {
      color: var(--md-red);
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.18);
    }

    .hyp-match.tone-quiet,
    .hyp-match.tone-neutral,
    .hyp-match.tone-good {
      color: var(--md-text-3);
      background: var(--md-bg-3);
      border-color: var(--md-border);
    }

    .evidence-rule {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 22px 0 4px;
      font-size: 11.5px;
      color: var(--md-text-4);
      font-style: italic;
    }

    .md-list {
      background: var(--md-bg-1);
      border: 1px solid var(--md-border);
      border-radius: 12px;
      overflow: hidden;
      max-width: 900px;
    }

    .md-co {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 15px;
      border-bottom: 1px solid var(--md-border);
    }

    .md-co:last-child {
      border-bottom: none;
    }

    .md-co:hover {
      background: var(--md-bg-2);
    }

    .md-co-ic {
      color: var(--md-text-3);
      flex: none;
    }

    .md-co-id {
      flex: 1;
      min-width: 0;
    }

    .md-co-name {
      display: block;
      font-size: 13px;
      font-weight: 600;
    }

    .md-co-sub {
      display: block;
      font-size: 11.5px;
      color: var(--md-text-3);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .md-co-meta {
      font-size: 11.5px;
      color: var(--md-text-3);
      font-family: var(--md-mono);
      white-space: nowrap;
    }

    .match-sig {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-family: var(--md-mono);
      font-size: 10.5px;
      color: var(--md-text-3);
      background: var(--md-bg-1);
      border: 1px solid var(--md-border);
      padding: 2px 8px;
      border-radius: 6px;
      white-space: nowrap;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: none;
    }

    .match-sig .md-ic {
      color: var(--md-text-4);
      flex: none;
    }

    .owner-tag {
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      padding: 2px 8px 2px 4px;
      font-size: 11px;
      color: var(--md-text-2);
      max-width: 170px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .owner-tag-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: var(--md-bg-3);
      color: var(--md-text);
      font-family: var(--md-mono);
      font-size: 9px;
      font-weight: 700;
      flex: none;
    }

    .rel-gap {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #fbbf24;
      padding: 10px 16px;
      background: rgba(245, 158, 11, 0.07);
      border: 1px solid var(--md-border);
      border-radius: 12px;
      margin-bottom: 12px;
    }

    .plan-list {
      display: flex;
      flex-direction: column;
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 14px;
    }

    .plan-row {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 11px 15px;
    }

    .plan-row:not(:last-child) {
      border-bottom: 1px solid var(--md-border);
    }

    .plan-ic {
      color: var(--md-text-4);
      flex: none;
    }

    .plan-text {
      flex: 1;
      font-size: 12.5px;
      line-height: 1.45;
    }

    .md-stats {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }

    .md-tile {
      display: flex;
      flex-direction: column;
      gap: 5px;
      background: var(--md-bg-2);
      border: 1px solid var(--md-border);
      border-radius: 11px;
      padding: 13px 18px;
      min-width: 108px;
    }

    .md-tile b {
      font-size: 23px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }

    .md-tile em {
      font-style: normal;
      font-size: 10.5px;
      color: var(--md-text-3);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-family: var(--md-mono);
    }

    @media (max-width: 1100px) {
      .motion-detail-shell {
        padding: 18px 18px 56px;
      }

      .offer-thesis {
        grid-template-columns: 1fr;
      }

      .md-list {
        max-width: 100%;
      }
    }

    @media (max-width: 760px) {
      .motion-detail-shell {
        padding: 16px 14px 40px;
      }

      .motion-head,
      .offer-head,
      .sig-top,
      .sig-foot,
      .md-co,
      .premise-meta {
        flex-direction: column;
        align-items: flex-start;
      }

      .match-sig,
      .owner-tag,
      .md-co-meta {
        max-width: 100%;
      }

      .sig-section {
        flex-wrap: wrap;
      }
    }
  </style>
</head>
<body>
  <div class="exo-root">
    <aside class="nav" data-shell-nav>
      <div class="nav-brand">
        <span class="brand-mark">${renderShellLogoMark(18)}</span>
        <span class="brand-name">exo</span>
        <button class="nav-collapse" type="button" data-nav-collapse title="Collapse sidebar">
          ${renderMotionDetailIcon("chevronR", 15)}
        </button>
      </div>
      ${renderWorkspaceShellNavItem({ label: "Operator", icon: "flag", route: "operator", active: true })}
      ${renderWorkspaceShellNavItem({ label: "Motions", icon: "layers", route: "motions" })}
      ${renderWorkspaceShellNavItem({ label: "Prospects", icon: "users", route: "prospects" })}
      ${renderWorkspaceShellNavItem({ label: "Execution", icon: "cpu", route: "execution" })}
      ${renderWorkspaceShellNavItem({ label: "Connections", icon: "link", route: "connections" })}
      ${renderWorkspaceShellNavItem({ label: "Workspace", icon: "activity", route: "workspace" })}
      <div class="nav-spacer"></div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumbs">
          <button class="crumb-btn" type="button" data-nav-route="operator" data-nav-label="Operator" title="Home">
            ${renderMotionDetailIcon("home", 15)}
          </button>
          <span class="cr-sep">${renderMotionDetailIcon("chevronR", 13)}</span>
          <button class="crumb-btn cr-link" type="button" id="shell-parent-link" data-nav-route="motions" hidden></button>
          <span class="cr-sep" id="shell-detail-sep" hidden>${renderMotionDetailIcon("chevronR", 13)}</span>
          <span class="cr-cur" id="shell-current-label">Operator</span>
        </div>
        <div class="top-right">
          <label class="searchbox" aria-label="Search people">
            ${renderMotionDetailIcon("search", 15, "sb-ic")}
            <input type="search" placeholder="Search people..." spellcheck="false">
          </label>
          <button class="chrome-btn raise-trigger" type="button" data-nav-route="operator" data-nav-label="Operator" title="Open operator">
            ${renderMotionDetailIcon("spark", 15)}
            Raised
          </button>
        </div>
      </header>

      <main class="canvas">
        <div id="workspace-status" class="workspace-status" hidden></div>
        <div class="page-stack">
          <section class="shell-page operator-page" data-page="operator">
            <div class="op-intro">
              <div>
                <h1>Operator</h1>
                <p class="op-line">What needs judgment, what is blocked, and what still needs review.</p>
              </div>
              <div class="op-stat">
                ${headerStats
                  .map(
                    (item, index) => `
                      ${index > 0 ? "<i></i>" : ""}
                      <b>${escapeHtml(String(item.count))}</b>
                      <span>${escapeHtml(item.label)}</span>
                    `,
                  )
                  .join("")}
              </div>
            </div>

            <div class="op-wrap">
              ${renderOperatorNextMoveCard(operatorHeroItem, operatorSummary, now, interactive)}

              <section class="op-sec">
                <div class="sec-head">
                  ${renderMotionDetailIcon("flag", 16, "sec-ic")}
                  <h2>Need decision</h2>
                  ${renderOperatorCountChip(decisionQueue.itemCount, "amber")}
                </div>
                <div class="sec-body">
                  ${renderOperatorDecisionCards(operatorDecisionItems, interactive, now)}
                </div>
              </section>

              <section class="op-sec">
                <div class="sec-head">
                  ${renderMotionDetailIcon("alert", 16, "sec-ic")}
                  <h2>Blocked</h2>
                  ${renderOperatorCountChip(blockedQueue.itemCount, "red")}
                </div>
                <div class="sec-body">
                  ${renderOperatorBlockedCards(blockedQueue, interactive)}
                </div>
              </section>

              <section class="op-sec">
                <div class="sec-head">
                  ${renderMotionDetailIcon("eye", 16, "sec-ic")}
                  <h2>Stale or incomplete</h2>
                  ${renderOperatorCountChip(operatorStaleRows.length, "amber")}
                </div>
                <div class="sec-body">
                  ${renderOperatorStaleRows(operatorStaleRows)}
                </div>
              </section>

              <section class="op-sec">
                <div class="sec-head">
                  ${renderMotionDetailIcon("clock", 16, "sec-ic")}
                  <h2>Today's agenda</h2>
                  ${renderOperatorCountChip(operatorAgendaRows.length, "neutral", "left")}
                </div>
                <div class="sec-body">
                  ${renderOperatorAgendaRows(operatorAgendaRows)}
                </div>
              </section>
            </div>
          </section>

          <section class="shell-page motions-page" data-page="motions" hidden>
            <div class="page-head">
              <h1>Motions</h1>
              <p>Your active GTM motions. Open one to see its companies, prospects and action progress.</p>
            </div>
            <div class="motion-grid">${renderMotionCards(motionSummaries)}</div>
          </section>

          ${renderMotionDetailOverlays(motionDetails, interactive, now)}

          <section class="shell-page prospects-page" data-page="prospects" hidden>
            <div class="page-head">
              <h1>Prospects</h1>
              <p>Prospect targeting across the workspace.</p>
            </div>
            ${renderLaneSection(
              "Company prep lanes",
              "",
              companyLanes,
              renderCompanyPrepCard,
            )}
            ${renderLaneSection(
              "Prospect prep lanes",
              "",
              prospectPrepLanes,
              renderProspectPrepCard,
            )}
          </section>

          <section class="shell-page execution-page" data-page="execution" hidden>
            <div class="page-head">
              <h1>Execution</h1>
              <p>Live branches and governed branch state across the workspace.</p>
            </div>
            <div class="lane-grid">
              ${engagementLanes
                .map(
                  (lane) => `
                    <section class="lane-column">
                      <div class="lane-head">
                        <div>
                          <h4>${escapeHtml(lane.label)}</h4>
                          <p>${escapeHtml(lane.description)}</p>
                        </div>
                        <strong>${lane.items.length}</strong>
                      </div>
                      <div class="lane-stack">
                        ${renderRailItems(
                          lane.items,
                          "No prospects in this lane right now.",
                          (prospect) => renderEngagementCard(prospect, now),
                        )}
                      </div>
                    </section>
                  `,
                )
                .join("")}
            </div>
          </section>

          <section class="shell-page connections-page" data-page="connections" hidden>
            <div class="page-head">
              <h1>Connections</h1>
              <p>Truth surfaces, sync coverage, and governed inbound state.</p>
            </div>
            <div class="summary-strip">
              <div class="summary-chip">
                <span>Connected accounts</span>
                <strong>${truthAccounts.length}</strong>
              </div>
              <div class="summary-chip">
                <span>Enabled surfaces</span>
                <strong>${inboundReview.surfaces?.enabledSurfaceCount ?? 0}</strong>
              </div>
              <div class="summary-chip">
                <span>Unchecked surfaces</span>
                <strong>${inboundReview.surfaces?.uncheckedSurfaceCount ?? 0}</strong>
              </div>
              <div class="summary-chip">
                <span>Itemization gaps</span>
                <strong>${inboundReview.counts?.itemizationGapCount ?? 0}</strong>
              </div>
            </div>
            <div class="truth-stack">${renderTruthAccounts(truthAccounts, now)}</div>
          </section>

          <section class="shell-page workspace-page" data-page="workspace" hidden>
            <div class="page-head">
              <h1>Workspace</h1>
              <p>Cross-motion state, artifacts, and backlog pressure.</p>
            </div>
            <section class="section">
              <div class="section-head">
                <div>
                  <div class="section-eyebrow">Motions</div>
                  <h2>Motion state</h2>
                </div>
              </div>
              <div class="artifact-grid">${renderArtifactInventory(artifactSummaries)}</div>
            </section>

            <div class="content-grid">
              <div class="main-column">
                <section class="gap-section">
                  <div class="section-head">
                    <div>
                      <div class="section-eyebrow">Model gaps</div>
                      <h2>Model gaps</h2>
                    </div>
                  </div>
                  <div class="gap-grid">${renderGapNotes(gapNotes)}</div>
                </section>
              </div>

              <aside class="right-rail">
                <section class="rail-panel">
                  <div class="section-eyebrow">Waiting</div>
                  <h3>Waiting</h3>
                  <div class="rail-stack">
                    ${renderAgentQueueItems(
                      agentQueue.waitingItems,
                      now,
                      "Nothing is explicitly waiting right now.",
                    )}
                  </div>
                </section>

                <section class="rail-panel">
                  <div class="section-eyebrow">Signals</div>
                  <h3>Watch signals</h3>
                  <div class="rail-stack">
                    ${renderRailItems(
                      decisionQueue.signals.slice(0, 8),
                      "No parked signals are exposed right now.",
                      (item) =>
                        renderReviewRailItem({
                          company: item.companyName ? { name: item.companyName } : null,
                          prospect: null,
                          actorName: item.subject,
                          priority: item.priority,
                          summary: item.summary,
                          surfaceKey: item.surfaceKey ?? "unknown",
                          observedAt: item.observedAt,
                          recommendedAction: item.recommendedAction ?? "Hold for now.",
                        }),
                    )}
                  </div>
                </section>

                <section class="rail-panel">
                  <div class="section-eyebrow">State</div>
                  <h3>Workspace state</h3>
                  <div class="rail-stack">
                    <article class="rail-card">
                      <div class="rail-card-head">
                        <h4>Truth coverage</h4>
                        <span class="chip chip-${uncheckedSurfaceCount > 0 ? "danger" : "quiet"}">${escapeHtml(
                          `${uncheckedSurfaceCount} unchecked`,
                        )}</span>
                      </div>
                      <p>${escapeHtml(`${actionableSurfaceCount} actionable · ${staleSurfaceCount} stale · ${truthAccounts.length} accounts`)}</p>
                    </article>
                    <article class="rail-card">
                      <div class="rail-card-head">
                        <h4>Inbox</h4>
                        <span class="chip chip-${decisionQueue.itemCount > 0 ? "danger" : "quiet"}">${escapeHtml(
                          `${decisionQueue.itemCount} decisions`,
                        )}</span>
                      </div>
                      <p>${escapeHtml(
                        `${decisionQueue.replyCount} replies · ${decisionQueue.decisionCount} yes/no items · ${decisionQueue.parkedSignalCount} watch signals`,
                      )}</p>
                    </article>
                    <article class="rail-card">
                      <div class="rail-card-head">
                        <h4>Execution</h4>
                        <span class="chip chip-${agentQueue.itemCount > 0 ? "accent" : "quiet"}">${escapeHtml(
                          `${agentQueue.itemCount} due`,
                        )}</span>
                      </div>
                      <p>${escapeHtml(
                        `${readyBranchCount} ready branches · ${agentQueue.waitingCount} scheduled · ${blockedQueue.itemCount} blocked · ${executionBacklog.packetCount} packets`,
                      )}</p>
                    </article>
                  </div>
                  <div class="regen">
                    <div class="mini-eyebrow">Regenerate</div>
                    <code>${escapeHtml(regenerateCommand)}</code>
                  </div>
                </section>
              </aside>
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>
  <script>
    (() => {
            const interactiveEnabled = ${JSON.stringify(Boolean(interactive?.enabled))};
            const actionEndpoint = ${JSON.stringify(interactive?.actionEndpoint ?? "/api/action")};
            const statusEl = document.getElementById("workspace-status");
            const shellRoot = document.querySelector(".exo-root");
            const shellNav = document.querySelector("[data-shell-nav]");
            const currentLabelEl = document.getElementById("shell-current-label");
            const parentLinkEl = document.getElementById("shell-parent-link");
            const detailSepEl = document.getElementById("shell-detail-sep");
            const canvasEl = document.querySelector(".canvas");
            const pageNodes = Array.from(document.querySelectorAll("[data-page]"));
            const routeMeta = {
              operator: { navId: "operator", label: "Operator" },
              motions: { navId: "motions", label: "Motions" },
              prospects: { navId: "prospects", label: "Prospects" },
              execution: { navId: "execution", label: "Execution" },
              connections: { navId: "connections", label: "Connections" },
              workspace: { navId: "workspace", label: "Workspace" },
              "motion-detail": { navId: "motions", label: "Motions" },
            };
            const readClassNames = (node) => String(node?.getAttribute?.("class") || node?.className || "")
              .split(/\s+/)
              .filter(Boolean);
            const writeClassNames = (node, next) => {
              if (!node) return;
              const className = Array.from(new Set(next)).join(" ");
              node.setAttribute("class", className);
            };
            const setClassFlag = (node, className, enabled) => {
              if (!node || !className) return;
              const next = readClassNames(node).filter((token) => token !== className);
              if (enabled) {
                next.push(className);
              }
              writeClassNames(node, next);
            };
            const toggleClassFlag = (node, className) => {
              if (!node || !className) return;
              const current = readClassNames(node);
              setClassFlag(node, className, !current.includes(className));
            };
            const setStatus = (message, isError = false) => {
              if (!statusEl) return;
              statusEl.hidden = !message;
              statusEl.textContent = message || "";
              setClassFlag(statusEl, "is-error", Boolean(isError));
            };
            const setButtonLabel = (button, label) => {
              if (!button || !label) return;
              button.textContent = label;
            };
            const setActiveNav = (navId) => {
              document.querySelectorAll("[data-nav-item]").forEach((item) => {
                item.setAttribute("class", item.dataset.navItem === navId ? "nav-item active" : "nav-item");
              });
            };
            const setBreadcrumb = (route, motionId = "") => {
              const meta = routeMeta[route] || routeMeta.operator;
              if (route === "motion-detail" && motionId) {
                const motionPage = document.querySelector('[data-page="motion-detail"][data-motion-detail="' + motionId + '"]');
                const motionName = motionPage?.dataset.motionName || "Motion";
                if (parentLinkEl) {
                  parentLinkEl.hidden = false;
                  parentLinkEl.textContent = meta.label;
                }
                if (detailSepEl) {
                  detailSepEl.hidden = false;
                }
                if (currentLabelEl) {
                  currentLabelEl.textContent = motionName;
                }
                return;
              }
              if (parentLinkEl) {
                parentLinkEl.hidden = true;
              }
              if (detailSepEl) {
                detailSepEl.hidden = true;
              }
              if (currentLabelEl) {
                currentLabelEl.textContent = meta.label;
              }
            };
            const renderRoute = (route, motionId = "") => {
              let resolvedRoute = route;
              let resolvedMotionId = motionId;
              if (resolvedRoute === "motion-detail") {
                const motionPage = document.querySelector('[data-page="motion-detail"][data-motion-detail="' + resolvedMotionId + '"]');
                if (!motionPage) {
                  resolvedRoute = "motions";
                  resolvedMotionId = "";
                }
              }
              pageNodes.forEach((page) => {
                const isActive = resolvedRoute === "motion-detail"
                  ? page.dataset.page === "motion-detail" && page.dataset.motionDetail === resolvedMotionId
                  : page.dataset.page === resolvedRoute;
                page.hidden = !isActive;
              });
              setActiveNav((routeMeta[resolvedRoute] || routeMeta.operator).navId);
              setBreadcrumb(resolvedRoute, resolvedMotionId);
              if (canvasEl) {
                canvasEl.scrollTo({ top: 0, left: 0, behavior: "auto" });
              }
            };
            const navigate = (route, motionId = "") => renderRoute(route, motionId);

            document.querySelector("[data-nav-collapse]")?.addEventListener("click", () => {
              toggleClassFlag(shellRoot, "nav-collapsed");
              toggleClassFlag(shellNav, "collapsed");
            });

            document.querySelectorAll("[data-nav-route]").forEach((button) => {
              button.addEventListener("click", () => {
                const route = button.dataset.navRoute || "operator";
                if (route) {
                  navigate(route);
                }
              });
            });

            document.querySelectorAll("[data-why-toggle]").forEach((button) => {
              button.addEventListener("click", () => {
                const target = document.getElementById(button.dataset.whyToggle || "");
                if (!target) return;
                target.hidden = !target.hidden;
                button.setAttribute("aria-expanded", String(!target.hidden));
                setClassFlag(button, "open", !target.hidden);
              });
            });

            document.querySelectorAll("[data-open-motion-detail]").forEach((control) => {
              const openMotionDetail = () => {
                navigate("motion-detail", control.dataset.openMotionDetail || "");
              };
              control.addEventListener("click", (event) => {
                const target = event.target;
                if (
                  target &&
                  typeof target.closest === "function" &&
                  target.closest("button, a, input, select, textarea, summary") &&
                  target.closest("button, a, input, select, textarea, summary") !== control
                ) {
                  return;
                }
                openMotionDetail();
              });
              if (control.tagName !== "BUTTON") {
                control.addEventListener("keydown", (event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  openMotionDetail();
                });
              }
            });
            renderRoute("operator");

            if (interactiveEnabled) {
              document.querySelectorAll(".workspace-action-button").forEach((button) => {
                button.addEventListener("click", async () => {
                  const payload = JSON.parse(button.dataset.action || "{}");
                  const confirmMessage = payload.confirm || "Run this Exo action?";
                  if (confirmMessage && !window.confirm(confirmMessage)) {
                    return;
                  }

                  const originalLabel = button.dataset.originalLabel || button.textContent || "";
                  button.dataset.originalLabel = originalLabel;
                  button.disabled = true;
                  setButtonLabel(button, button.dataset.busyLabel || "Running...");
                  setStatus("Running " + (payload.label || "workspace action") + "...");

                  try {
                    const response = await fetch(actionEndpoint, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(payload),
                    });
                    const result = await response.json();

                    if (!response.ok || result.ok === false) {
                      throw new Error(result.error || result.message || "Workspace action failed.");
                    }

                    setButtonLabel(button, button.dataset.doneLabel || "Done");
                    setStatus(result.message || "Workspace action complete.");
                    window.setTimeout(() => window.location.reload(), 500);
                  } catch (error) {
                    setStatus(error instanceof Error ? error.message : String(error), true);
                    button.disabled = false;
                    setButtonLabel(button, originalLabel);
                  }
                });
              });
            }
          })();
        </script>
</body>
</html>`;
}

/**
 * @param {{
 *   user: any,
 *   observations?: any[],
 *   inboundReview: any,
 *   inbox: any,
 *   daily: any,
 *   agentQueue?: any,
 *   reports: any[],
 *   regenerateCommand?: string,
 *   interactive?: { enabled?: boolean, actionEndpoint?: string, workerLabel?: string } | null
 * }} input
 */
export function buildWorkspaceModel(input) {
  const {
    user,
    observations = [],
    inboundReview,
    inbox,
    daily,
    agentQueue: rawAgentQueue = null,
    reports,
    regenerateCommand = DEFAULT_REGENERATE_COMMAND,
    interactive = null,
  } = input;

  const now = parseDate(daily.generatedAt) ?? new Date();
  const truthAccounts = mergeTruthAccounts(user, inboundReview, inbox, now);
  const motionSummaries = buildMotionSummaries(reports, daily, inboundReview).sort((left, right) => {
    const leftUpdated = parseDate(left.updatedAt)?.getTime() ?? 0;
    const rightUpdated = parseDate(right.updatedAt)?.getTime() ?? 0;
    return rightUpdated - leftUpdated;
  });
  const motionDetails = buildMotionDetailModels(reports, motionSummaries, daily, inboundReview);
  const dailyIndex = buildDailyIndex(daily.items);
  const reviewIndex = buildReviewIndex(inboundReview.reviewItems);
  const companyPrep = flattenCompanyPrep(reports);
  const prospects = flattenProspects(reports, dailyIndex, reviewIndex);
  const gapNotes = buildGapNotes(truthAccounts, prospects);
  const stateActions = buildWorkspaceStateActions({
    user,
    reports,
    daily,
    workerLabel: interactive?.workerLabel ?? DEFAULT_WORKSPACE_ACTION_WORKER,
  });
  const decisionQueue = buildDecisionQueue(inboundReview.reviewItems);
  const agentQueue = buildWorkspaceAgentQueue(rawAgentQueue);
  const executionBacklog = buildExecutionBacklog(daily, stateActions);
  const blockedQueue = buildBlockedQueue(rawAgentQueue, executionBacklog);

  const companyLanes = groupIntoLanes(companyPrep, [
    { key: "needs-company-identity", label: "Needs company identity", description: "Website or LinkedIn company identity is still missing." },
    { key: "queued-for-research", label: "Queued for research", description: "Identity exists, but research is not complete yet." },
    { key: "researched", label: "Researched / pick prospects", description: "Signals are in, but prospect selection is still open." },
    { key: "selected", label: "Selected / build branches", description: "Prospects exist, but branch scaffolding is incomplete." },
    { key: "targeting-ready", label: "Targeting ready", description: "Company prep is already usable for outreach branches." },
    { key: "suppressed", label: "Suppressed", description: "This company is intentionally out of play." },
    { key: "exhausted", label: "Exhausted", description: "No more viable company work is exposed right now." },
  ]).map((lane) => ({
    ...lane,
    items: sortByName(lane.items, "companyName"),
  }));

  const prospectPrepLanes = groupIntoLanes(prospects, [
    { key: "needs-through-line", label: "Needs through-line", description: "The branch still lacks a why-talk line." },
    { key: "needs-opening-plan", label: "Needs opening plan", description: "The first move is not defensible yet." },
    { key: "needs-cadence", label: "Needs cadence state", description: "Exo does not yet expose a usable current step." },
    { key: "contact-enrichment-pending", label: "Contact enrichment pending", description: "Core branch logic exists, but fallback coverage is still open." },
    { key: "primary-only-ready", label: "Ready but weak fallback", description: "Primary path exists, but direct fallback is still thin." },
    { key: "prep-complete", label: "Prep complete", description: "Prep is done; engagement state is separate." },
  ]).map((lane) => ({
    ...lane,
    items: sortByName(lane.items, "name"),
  }));

  const engagementLanes = [
    { key: "ready", label: "Ready", description: "Prepared branches that still need their first governed move." },
    { key: "sent-pending", label: "Sent / pending", description: "Touches are in flight and waiting on the other side." },
    { key: "waiting", label: "Waiting", description: "Branches intentionally held in reserve or waiting on a checkpoint." },
    { key: "blocked", label: "Blocked", description: "Primary path failed or the channel blocked." },
    { key: "reply-accepted", label: "Reply / accepted", description: "Cold-start phase is over; live response handling takes over." },
    { key: "exhausted", label: "Exhausted", description: "No further governed move is exposed here right now." },
  ].map((lane) => ({
    ...lane,
    items: sortEngagementCards(
      prospects.filter((prospect) => prospect.engagementLane.key === lane.key),
      now,
    ),
  }));

  const dueNowItems = toArray(daily.items).filter((item) => item.state === "due_now");
  const waitingItems = toArray(daily.items).filter((item) => item.state === "waiting_until");
  const reviewItems = toArray(inboundReview.reviewItems).slice().sort((left, right) => {
    const leftObserved = parseDate(left.observedAt)?.getTime() ?? 0;
    const rightObserved = parseDate(right.observedAt)?.getTime() ?? 0;
    return rightObserved - leftObserved;
  });
  const operatorSummary = buildOperatorSummary({
    user,
    daily,
    motionSummaries,
    truthAccounts,
    reviewItems,
    now,
  });
  const artifactSummaries = buildArtifactSummaries(reports, motionSummaries);

  const html = renderPage({
    truthAccounts,
    motionSummaries,
    motionDetails,
    operatorSummary,
    decisionQueue,
    agentQueue,
    blockedQueue,
    executionBacklog,
    interactive,
    artifactSummaries,
    companyPrep,
    prospectPrep: prospects,
    engagementProspects: prospects,
    daily,
    inboundReview,
    inbox,
    gapNotes,
    now,
    regenerateCommand,
  });

  return {
    html,
    data: {
      generatedAt: now.toISOString(),
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner ?? null,
      },
      regenerateCommand,
      truthAccounts,
      motionSummaries,
      motionDetails,
      operatorSummary,
      decisionQueue,
      agentQueue,
      blockedQueue,
      executionBacklog,
      interactive: interactive ? { enabled: Boolean(interactive.enabled), actionEndpoint: interactive.actionEndpoint ?? null } : null,
      artifactSummaries,
      companyLanes,
      prospectPrepLanes,
      engagementLanes,
      dueNowItems,
      waitingItems,
      observations,
      reviewItems,
      itemizationGaps: toArray(inboundReview.itemizationGaps),
      gapNotes,
    },
  };
}

async function main() {
  const [users, motions] = await Promise.all([
    runJson(["users", "list", "--json"]),
    runJson(["motion", "list", "--json"]),
  ]);

  const user = toArray(users).find((candidate) => candidate.id === USER_ID) ?? toArray(users)[0];
  if (!user) {
    throw new Error("No execution users exist in Exo, so the workspace projection cannot resolve inbound or daily state.");
  }

  const [inboundReview, inbox, daily, agentQueue] = await Promise.all([
    runJson(["inbound", "review", user.id, "--json"]),
    runJson(["inbox", "--user", user.id, "--json"]),
    runJson(["daily", "--user", user.id, "--json"]),
    runJson(["agent", "queue", "--json"]),
  ]);

  const reports = await Promise.all(
    toArray(motions).map((motion) => runJson(["report", "motion", motion.id, "--json"])),
  );
  const { html } = buildWorkspaceModel({
    user,
    inboundReview,
    inbox,
    daily,
    agentQueue,
    reports,
    regenerateCommand: DEFAULT_REGENERATE_COMMAND,
  });

  await writeFile(OUTPUT_PATH, html, "utf8");
  process.stdout.write(`${OUTPUT_PATH}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
