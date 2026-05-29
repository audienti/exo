// @ts-check

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
 *     advancedByInboundCount: number
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
  const lines = [
    `Daily: ${result.user.label}${result.user.owner ? ` (${result.user.owner})` : ""}`,
    `Generated At: ${result.generatedAt}`,
    `Items: ${result.counts.itemCount}`,
    `Reply Priority: ${result.counts.replyPriorityCount}`,
    `Action Priority: ${result.counts.actionPriorityCount}`,
    `Wait Priority: ${result.counts.waitPriorityCount}`,
    `Due Now: ${result.counts.dueNowCount}`,
    `Waiting: ${result.counts.waitingCount}`,
    `Overridden By Inbound: ${result.counts.overriddenByInboundCount}`,
    `Advanced By Inbound: ${result.counts.advancedByInboundCount}`
  ];

  const linkedinCapacity = result.capacity?.linkedin ?? null;
  if (linkedinCapacity) {
    lines.push(`LinkedIn Capacity: ${linkedinCapacity.status}`);
    lines.push(`LinkedIn Handle: ${linkedinCapacity.account.handle}`);
    if (linkedinCapacity.account.profileLabel) {
      lines.push(`LinkedIn Profile: ${linkedinCapacity.account.profileLabel}`);
    }
    lines.push(`LinkedIn Capacity Reason: ${linkedinCapacity.reason}`);

    if (linkedinCapacity.status === "configured") {
      lines.push(`LinkedIn Daily Target: ${linkedinCapacity.quota.dailyInvitationsTarget ?? 0}`);
      lines.push(`LinkedIn Weekly Quota: ${linkedinCapacity.quota.weeklyInvitations ?? 0}`);
      lines.push(`LinkedIn Sent Today: ${linkedinCapacity.execution.sentToday}`);
      lines.push(`LinkedIn Pending: ${linkedinCapacity.execution.pendingInvitations}`);
      lines.push(`LinkedIn Ready Now: ${linkedinCapacity.execution.readyConnectionRequests}`);
      lines.push(`LinkedIn Remaining Today: ${linkedinCapacity.execution.remainingInvitationsToday ?? 0}`);
      lines.push(`LinkedIn Inventory Shortfall: ${linkedinCapacity.execution.inventoryShortfall ?? 0}`);
    }
  }

  if (!result.items.length) {
    lines.push("No daily agenda items.");
    return lines.join("\n");
  }

  for (const item of result.items) {
    lines.push("");
    lines.push(`- ${item.prospect.name} (${item.prospect.title}) at ${item.company.name}`);
    lines.push(`  Motion: ${item.motion.name}`);
    lines.push(`  State: ${item.state}`);
    lines.push(`  Priority: ${item.priority}`);
    lines.push(`  Cadence Effect: ${item.cadenceEffect}`);
    lines.push(`  Due At: ${item.dueAt}`);
    lines.push(`  Source: ${item.source.type}:${item.source.kind}`);
    lines.push(`  Why It Matters: ${item.whyItMatters}`);
    lines.push(`  Next: ${item.recommendedAction}`);
    if (item.guidance?.taskPrompt) {
      lines.push(`  Agent Prompt: ${item.guidance.taskPrompt}`);
    }
    if (item.guidance?.docPath) {
      lines.push(`  Guidance Doc: ${item.guidance.docPath}`);
    }
    if (item.waitingBranch) {
      lines.push(`  Waiting Branch: ${item.waitingBranch.kind}`);
      lines.push(`  Waiting Why: ${item.waitingBranch.why}`);
      lines.push(`  Waiting Next: ${item.waitingBranch.nextMove}`);
    }
  }

  return lines.join("\n");
}
