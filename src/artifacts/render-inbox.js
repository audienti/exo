// @ts-check

import { buildOperatorPromptFromInboxItem } from "../lib/operator-prompts.js";

/**
 * @param {{
 *   user: { label: string, owner: string | null },
 *   counts: { itemCount: number, highPriorityCount: number, mediumPriorityCount: number, lowPriorityCount: number, packetReviewCount?: number },
 *   surfaces: {
 *     accountCount: number,
 *     enabledSurfaceCount: number,
 *     actionableSurfaceCount: number,
 *     quietSurfaceCount: number,
 *     uncheckedSurfaceCount: number,
 *     accounts: Array<{
 *       capability: string,
 *       handle: string,
 *       surfaces: Array<{
 *         label: string,
 *         lastRunStatus: string,
 *         lastItemCount: number | null,
 *         summary: string,
 *         recommendedAction: string
 *       }>
 *     }>
 *   },
 *   packetReview?: {
 *     count: number,
 *     oldestSubmittedAt: string | null,
 *     oldestAgeSeconds: number | null,
 *     items: Array<{ subject: string, packetId: string, packetLabel: string, ageLabel: string }>
 *   },
 *   items: Array<{
 *     observedAt: string,
 *     kind: string,
 *     priority: string,
 *     status: string,
 *     summary: string,
 *     whyItMatters: string,
 *     recommendedAction: string,
 *     motion: { name: string } | null,
 *     company: { name: string | null } | null,
 *     prospect: { name: string, title: string } | null
 *   }>
 * }} result
 */
export function renderInbox(result) {
  if (!result.items.length) {
    if (result.packetReview?.count) {
      return formatPacketReviewLine(result.packetReview);
    }
    if (result.surfaces.uncheckedSurfaceCount) {
      return `Inbox is quiet, but ${result.surfaces.uncheckedSurfaceCount} surface${result.surfaces.uncheckedSurfaceCount === 1 ? "" : "s"} still need checking.`;
    }
    return "Inbox is quiet right now.";
  }

  const topItem = result.items[0];
  const prompt = buildOperatorPromptFromInboxItem(topItem) ?? topItem.recommendedAction;
  const lines = [prompt];

  lines.push(
    `Also live: ${result.counts.highPriorityCount} high, ${result.counts.mediumPriorityCount} medium, ${result.counts.lowPriorityCount} low.`
  );

  if (result.packetReview?.count) {
    lines.push(formatPacketReviewLine(result.packetReview));
  }

  if (result.surfaces.uncheckedSurfaceCount) {
    lines.push(`Unchecked surfaces: ${result.surfaces.uncheckedSurfaceCount}.`);
  }

  return lines.join("\n");
}

/**
 * @param {{ count: number, items: Array<{ subject: string, packetId: string, packetLabel: string, ageLabel: string }> }} review
 */
function formatPacketReviewLine(review) {
  const first = review.items[0] ?? null;
  if (!first) return "Packet review: no packets awaiting review.";
  return `Packet review: ${review.count} awaiting review. Oldest is ${first.packetLabel.toLowerCase()} ${first.packetId} for ${first.subject}, submitted ${first.ageLabel} ago.`;
}
