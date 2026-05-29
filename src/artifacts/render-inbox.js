// @ts-check

/**
 * @param {{
 *   user: { label: string, owner: string | null },
 *   counts: { itemCount: number, highPriorityCount: number, mediumPriorityCount: number, lowPriorityCount: number },
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
  const lines = [
    `Inbox: ${result.user.label}`,
    `Owner: ${result.user.owner ?? "unknown"}`,
    `Items: ${result.counts.itemCount}`,
    `High Priority: ${result.counts.highPriorityCount}`,
    `Medium Priority: ${result.counts.mediumPriorityCount}`,
    `Low Priority: ${result.counts.lowPriorityCount}`
  ];

  for (const item of result.items) {
    lines.push("");
    lines.push(`  ${item.observedAt}  [${item.priority}]  ${item.kind}  status:${item.status}`);
    lines.push(`    ${item.summary}`);
    lines.push(`    Why: ${item.whyItMatters}`);
    lines.push(`    Next: ${item.recommendedAction}`);
    if (item.motion || item.company || item.prospect) {
      lines.push(
        `    Context: motion=${item.motion?.name ?? "-"}  company=${item.company?.name ?? "-"}  prospect=${item.prospect ? `${item.prospect.name} (${item.prospect.title})` : "-"}`
      );
    }
  }

  return lines.join("\n");
}
