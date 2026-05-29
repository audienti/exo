// @ts-check

/**
 * @param {{
 *   user: { label: string, owner: string | null },
 *   counts: { itemCount: number, highPriorityCount: number, mediumPriorityCount: number, lowPriorityCount: number },
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
    `Low Priority: ${result.counts.lowPriorityCount}`,
    `Enabled Surfaces: ${result.surfaces.enabledSurfaceCount}`,
    `Actionable Surfaces: ${result.surfaces.actionableSurfaceCount}`,
    `Quiet Checked Surfaces: ${result.surfaces.quietSurfaceCount}`,
    `Unchecked Surfaces: ${result.surfaces.uncheckedSurfaceCount}`
  ];

  if (result.surfaces.accounts.length) {
    lines.push("");
    lines.push("Surface State:");

    for (const account of result.surfaces.accounts) {
      lines.push(`  ${account.capability}:${account.handle}`);
      for (const surface of account.surfaces) {
        lines.push(`    [${surface.lastRunStatus}] ${surface.label}  items:${surface.lastItemCount ?? 0}`);
        lines.push(`      ${surface.summary}`);
        lines.push(`      Action: ${surface.recommendedAction}`);
      }
    }
  }

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
