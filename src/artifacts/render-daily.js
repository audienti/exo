// @ts-check

import { buildOperatorPromptFromDailyItem } from "../lib/operator-prompts.js";

/**
 * @param {{
 *   user: { label: string, owner: string | null },
 *   generatedAt: string,
 *   counts: {
 *     itemCount: number,
 *     replyPriorityCount: number,
 *     actionPriorityCount: number,
 *     waitPriorityCount: number,
 *     dueNowCount: number,
 *     waitingCount: number,
 *     overriddenByInboundCount: number,
 *     advancedByInboundCount: number,
 *     packetReviewCount?: number
 *   },
 *   capacity?: {
 *     linkedin?: null | {
 *       status: string,
 *       reason: string,
 *       account: { handle: string, profileLabel: string | null },
 *       quota: { weeklyInvitations: number | null, dailyInvitationsTarget: number | null },
 *       execution: {
 *         sentToday: number,
 *         pendingInvitations: number,
 *         readyConnectionRequests: number,
 *         remainingInvitationsToday?: number | null,
 *         inventoryShortfall?: number | null
 *       }
 *     }
 *   },
 *   packetReview?: {
 *     count: number,
 *     oldestSubmittedAt: string | null,
 *     oldestAgeSeconds: number | null,
 *     items: Array<{ subject: string, packetId: string, packetLabel: string, ageLabel: string }>
 *   },
 *   items: Array<{
 *     motion: { name: string },
 *     company: { name: string },
 *     prospect: { name: string, title: string },
 *     state: "due_now" | "waiting_until",
 *     priority: "reply" | "action" | "wait",
 *     cadenceEffect: "none" | "overridden_by_inbound" | "advanced_by_inbound" | "supporting_waiting_branch" | "waiting_on_outbound",
 *     dueAt: string,
 *     whyItMatters: string,
 *     recommendedAction: string,
 *     guidance: null | { docPath: string, taskPrompt: string },
 *     source: { type: string, kind: string },
 *     waitingBranch?: null | { kind: string, nextMove: string, why: string }
 *   }>
 * }} result
 */
export function renderDaily(result) {
  if (!result.items.length) {
    if (result.packetReview?.count) {
      return formatPacketReviewLine(result.packetReview);
    }
    return "No due moves right now.";
  }

  const topItem = result.items[0];
  const prompt = buildOperatorPromptFromDailyItem(topItem) ?? topItem.recommendedAction;
  const lines = [prompt];

  const remainingDueNow = Math.max(result.counts.dueNowCount - 1, 0);
  if (remainingDueNow || result.counts.waitingCount) {
    lines.push(`After that: ${remainingDueNow} more due now, ${result.counts.waitingCount} waiting.`);
  }

  if (result.packetReview?.count) {
    lines.push(formatPacketReviewLine(result.packetReview));
  }

  const linkedinCapacity = result.capacity?.linkedin ?? null;
  if (
    linkedinCapacity?.status === "configured"
    && typeof linkedinCapacity.execution.remainingInvitationsToday === "number"
    && typeof linkedinCapacity.execution.readyConnectionRequests === "number"
  ) {
    lines.push(
      `LinkedIn today: ${linkedinCapacity.execution.readyConnectionRequests} ready now, ${linkedinCapacity.execution.remainingInvitationsToday} remaining to hit target.`
    );
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
