// @ts-check

import { buildMotionPacketSummary } from "../lib/motion-packets.js";
import { motionSchema } from "../schema/motion.js";

/**
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 * @param {{
 *   now?: string | null | undefined,
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined,
 * }} [options]
 */
export function buildPacketReviewView(rawMotions, rawCompanies, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const companies = Array.isArray(rawCompanies) ? rawCompanies : [];
  const motions = rawMotions.map((item) => motionSchema.parse(item));
  const items = motions
    .filter((motion) => !options.motionId || motion.id === options.motionId)
    .flatMap((motion) =>
      buildMotionPacketSummary(motion, companies, { status: "submitted" }).items
        .filter((packet) => !options.companyId || packet.companyId === options.companyId)
        .filter((packet) => !options.prospectId || packet.prospectId === options.prospectId)
        .map((packet) => shapePacketReviewItem(motion, packet, now))
    )
    .sort(comparePacketReviewItems);
  const oldest = items[0] ?? null;

  return {
    count: items.length,
    oldestSubmittedAt: oldest?.submittedAt ?? null,
    oldestAgeSeconds: oldest?.ageSeconds ?? null,
    items
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {any} packet
 * @param {string} now
 */
function shapePacketReviewItem(motion, packet, now) {
  const submittedAt = packet.completedAt ?? packet.claimedAt ?? motion.updatedAt ?? now;
  const ageSeconds = ageInSeconds(submittedAt, now);
  const subject = packet.prospectName
    ? `${packet.prospectName} at ${packet.companyName}`
    : packet.companyName;
  const reviewHref = packet.prospectId
    ? `/prospects/${encodeURIComponent(packet.prospectId)}`
    : `/companies/${encodeURIComponent(packet.companyId)}`;
  const briefCommand = `exo motion packet-brief ${motion.id} --packet ${packet.packetId} --json`;
  const acceptCommand = `exo agent packets accept ${motion.id} --packet ${packet.packetId} --json`;
  const amendCommand = `exo agent packets amend ${motion.id} --packet ${packet.packetId} --outcome <outcome> --reason "Why this outcome is correct" --json`;
  const returnCommand = `exo agent packets return ${motion.id} --packet ${packet.packetId} --notes "What the worker must fix" --json`;

  return {
    id: `packet-review:${motion.id}:${packet.packetId}`,
    packetId: packet.packetId,
    packetKind: packet.packetKind,
    packetLabel: humanizePacketKind(packet.packetKind),
    motion: {
      id: motion.id,
      name: motion.name
    },
    company: {
      id: packet.companyId,
      name: packet.companyName
    },
    prospect: packet.prospectId
      ? {
          id: packet.prospectId,
          name: packet.prospectName ?? subject,
          title: packet.prospectTitle ?? packet.packetKind
        }
      : null,
    subject,
    submittedAt,
    ageSeconds,
    ageLabel: formatAge(ageSeconds),
    proposal: packet.proposal ?? null,
    notes: packet.notes ?? null,
    reviewHref,
    commands: {
      brief: briefCommand,
      accept: acceptCommand,
      amend: amendCommand,
      return: returnCommand
    },
    actions: [
      {
        kind: "review",
        label: "Review packet",
        command: briefCommand,
        href: reviewHref
      },
      {
        kind: "accept",
        label: "Accept",
        command: acceptCommand,
        href: reviewHref
      },
      {
        kind: "amend",
        label: "Amend",
        command: amendCommand,
        href: reviewHref
      },
      {
        kind: "return",
        label: "Return",
        command: returnCommand,
        href: reviewHref
      }
    ]
  };
}

/**
 * @param {ReturnType<typeof shapePacketReviewItem>} left
 * @param {ReturnType<typeof shapePacketReviewItem>} right
 */
function comparePacketReviewItems(left, right) {
  return (
    left.submittedAt.localeCompare(right.submittedAt)
    || left.subject.localeCompare(right.subject)
    || left.packetId.localeCompare(right.packetId)
  );
}

/**
 * @param {string} packetKind
 */
function humanizePacketKind(packetKind) {
  return packetKind
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * @param {string | null | undefined} submittedAt
 * @param {string} now
 */
function ageInSeconds(submittedAt, now) {
  if (!submittedAt) return null;
  const submittedTime = new Date(submittedAt).getTime();
  const nowTime = new Date(now).getTime();
  if (Number.isNaN(submittedTime) || Number.isNaN(nowTime)) return null;
  return Math.max(0, Math.floor((nowTime - submittedTime) / 1000));
}

/**
 * @param {number | null} seconds
 */
function formatAge(seconds) {
  if (seconds == null) return "unknown age";
  if (seconds < 60) return "<1m";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
