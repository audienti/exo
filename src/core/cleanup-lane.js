// @ts-check

export const GLOBAL_INTAKE_CLEANUP_DAYS = 60;

/**
 * @param {string | null | undefined} observedAt
 * @param {Date | string | null | undefined} [now]
 */
export function ageDaysFromObservedAt(observedAt, now = new Date()) {
  if (!observedAt) return null;
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.getTime())) return null;
  const reference = now instanceof Date ? now : now ? new Date(now) : new Date();
  if (Number.isNaN(reference.getTime())) return null;
  const diffMs = reference.getTime() - observed.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * Old unclaimed global-intake claim decisions should stop crowding the live
 * Operator lane and move into a dedicated cleanup surface instead.
 *
 * @param {{ state?: string | null, observedAt?: string | null, ageDays?: number | null } | null | undefined} item
 * @param {{ now?: Date | string | null | undefined, minAgeDays?: number | null | undefined }} [options]
 */
export function isCleanupLaneItem(item, options = {}) {
  if (!item || item.state !== "needs_claim") return false;
  const minAgeDays = Number.isFinite(options.minAgeDays)
    ? Number(options.minAgeDays)
    : GLOBAL_INTAKE_CLEANUP_DAYS;
  const ageDays = Number.isFinite(item.ageDays)
    ? Number(item.ageDays)
    : ageDaysFromObservedAt(item.observedAt ?? null, options.now);
  return Number.isFinite(ageDays) && ageDays >= minAgeDays;
}

/**
 * @template T
 * @param {T[]} items
 * @param {{ now?: Date | string | null | undefined, minAgeDays?: number | null | undefined }} [options]
 */
export function filterCleanupLaneItems(items, options = {}) {
  return (items ?? []).filter((item) => isCleanupLaneItem(item, options));
}
