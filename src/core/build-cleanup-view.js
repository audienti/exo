// @ts-check

import {
  GLOBAL_INTAKE_CLEANUP_DAYS,
  ageDaysFromObservedAt,
  filterCleanupLaneItems,
} from "./cleanup-lane.js";

/**
 * @param {{
 *   user: { id: string, label: string, owner: string | null | undefined },
 *   generatedAt: string,
 *   regenerateCommand: string,
 *   reviewItems: any[],
 *   agentRuntime?: any,
 * }} input
 */
export function buildCleanupViewModel(input) {
  const now = input.generatedAt ? new Date(input.generatedAt) : new Date();
  const items = filterCleanupLaneItems(input.reviewItems ?? [], { now })
    .map((item) => shapeCleanupItem(item, now))
    .sort(compareCleanupItems);

  return {
    user: input.user,
    generatedAt: input.generatedAt,
    regenerateCommand: input.regenerateCommand,
    agentRuntime: input.agentRuntime ?? null,
    policy: {
      minAgeDays: GLOBAL_INTAKE_CLEANUP_DAYS,
    },
    counts: {
      itemCount: items.length,
      oldestAgeDays: items[0]?.ageDays ?? null,
    },
    items,
  };
}

/**
 * @param {any} item
 * @param {Date} now
 */
function shapeCleanupItem(item, now) {
  const ageDays = Number.isFinite(item.ageDays)
    ? Number(item.ageDays)
    : ageDaysFromObservedAt(item.observedAt ?? null, now) ?? 0;
  return {
    id: String(item.id),
    person: item.actorName ?? item.prospect?.name ?? item.company?.name ?? "Unknown",
    prospectId: item.prospect?.id ?? null,
    initials: initialsFromName(item.actorName ?? item.prospect?.name ?? item.company?.name ?? null),
    avatarUrl: item.actorAvatarUrl ?? item.actorAvatarSourceUrl ?? null,
    roleLine: composeSubtitle(item.actorTitle ?? null, item.actorCompanyName ?? item.company?.name ?? null),
    stakes: item.priority === "high" ? "high" : null,
    summary: item.recommendedAction ?? item.summary ?? "",
    truth: "checked",
    truthAt: item.observedAt ?? null,
    surface: humanizeSurfaceKey(item.surfaceKey ?? null),
    ageDays,
    why: item.whyItMatters ?? null,
    previewLabel: item.previewLabel ?? null,
    previewSubject: item.previewSubject ?? null,
    previewText: item.previewText ?? null,
    primaryActionLabel: "Open",
    primaryHref: item.actorProfileUrl ?? item.sourceUrl ?? null,
  };
}

/**
 * @param {ReturnType<typeof shapeCleanupItem>} left
 * @param {ReturnType<typeof shapeCleanupItem>} right
 */
function compareCleanupItems(left, right) {
  if (left.ageDays !== right.ageDays) {
    return right.ageDays - left.ageDays;
  }

  const leftPriority = left.stakes === "high" ? 0 : 1;
  const rightPriority = right.stakes === "high" ? 0 : 1;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.person.localeCompare(right.person);
}

/**
 * @param {string | null} title
 * @param {string | null} [company]
 */
function composeSubtitle(title, company) {
  const t = (title ?? "").trim();
  const c = (company ?? "").trim();
  if (t && c) {
    return t.toLowerCase().includes(c.toLowerCase()) ? t : `${t} · ${c}`;
  }
  return t || c || null;
}

/** @param {string | null | undefined} key */
function humanizeSurfaceKey(key) {
  if (!key) return null;
  return String(key).replaceAll("-", " ").replace(/^linkedin /, "").replace(/^gmail /, "");
}

/** @param {string | null | undefined} name */
function initialsFromName(name) {
  if (!name) return null;
  return String(name)
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
