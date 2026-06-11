// @ts-check

import { buildPacketReviewView } from "./build-packet-review-view.js";

export const DEFAULT_STALE_PACKET_REVIEW_HOURS = 24;

/**
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 * @param {{
 *   now?: string | null | undefined,
 *   thresholdHours?: number | null | undefined,
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined,
 * }} [options]
 */
export function buildStalePacketReviewWarnings(rawMotions, rawCompanies, options = {}) {
  const thresholdHours = normalizePositiveNumber(options.thresholdHours, DEFAULT_STALE_PACKET_REVIEW_HOURS);
  const thresholdSeconds = Math.floor(thresholdHours * 60 * 60);
  const review = buildPacketReviewView(rawMotions, rawCompanies, {
    now: options.now,
    motionId: options.motionId,
    companyId: options.companyId,
    prospectId: options.prospectId,
  });
  const items = review.items
    .filter((item) => item.ageSeconds != null && item.ageSeconds >= thresholdSeconds)
    .map((item) => ({
      id: item.id,
      packetId: item.packetId,
      packetKind: item.packetKind,
      packetLabel: item.packetLabel,
      motion: item.motion,
      company: item.company,
      prospect: item.prospect,
      subject: item.subject,
      submittedAt: item.submittedAt,
      ageSeconds: item.ageSeconds,
      ageLabel: item.ageLabel,
      proposal: item.proposal,
      commands: item.commands,
    }));
  const oldest = items[0] ?? null;

  return {
    kind: "stale_packet_reviews",
    thresholdHours,
    thresholdSeconds,
    count: items.length,
    oldestSubmittedAt: oldest?.submittedAt ?? null,
    oldestAgeSeconds: oldest?.ageSeconds ?? null,
    oldestAgeLabel: oldest?.ageLabel ?? null,
    items,
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizePositiveNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}
