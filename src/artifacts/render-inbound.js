// @ts-check

/**
 * @param {{
 *   surfaces: Array<{
 *     key: string,
 *     platform: string,
 *     capability: string,
 *     label: string,
 *     truthLevel: string,
 *     retrievalMode: string,
 *     defaultEnabled: boolean
 *   }>
 * }} result
 */
export function renderInboundSurfaceCatalog(result) {
  const lines = ["Inbound Surfaces"];

  for (const surface of result.surfaces) {
    lines.push(`  ${surface.key}  ${surface.label}  [${surface.platform} / ${surface.capability}]`);
    lines.push(`    Truth: ${surface.truthLevel}  Retrieval: ${surface.retrievalMode}  Default: ${surface.defaultEnabled ? "on" : "off"}`);
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   surface: {
 *     key: string,
 *     label: string,
 *     platform: string,
 *     capability: string,
 *     summary: string,
 *     truthLevel: string,
 *     retrievalMode: string,
 *     defaultEnabled: boolean,
 *     observationKinds: string[]
 *   }
 * }} result
 */
export function renderInboundSurfaceDetail(result) {
  const { surface } = result;
  return [
    `Inbound Surface: ${surface.label}`,
    `Key: ${surface.key}`,
    `Platform: ${surface.platform}`,
    `Capability: ${surface.capability}`,
    `Truth Level: ${surface.truthLevel}`,
    `Retrieval Mode: ${surface.retrievalMode}`,
    `Default Enabled: ${surface.defaultEnabled ? "yes" : "no"}`,
    `Summary: ${surface.summary}`,
    `Observation Kinds: ${surface.observationKinds.join(", ")}`
  ].join("\n");
}

/**
 * @param {{
 *   user: { label: string, owner: string | null },
 *   counts: { accountCount: number, enabledSurfaceCount: number, staleSurfaceCount: number, failedSurfaceCount: number },
 *   accounts: Array<{
 *     accountId: string,
 *     capability: string,
 *     handle: string,
 *     preferred: boolean,
 *     sourceType: string,
 *     enabledSurfaceCount: number,
 *     staleSurfaceCount: number,
 *     failedSurfaceCount: number,
 *     surfaces: Array<{
 *       key: string,
 *       label: string,
 *       enabled: boolean,
 *       truthLevel: string,
 *       lastRunStatus: string,
 *       lastSyncedAt: string | null,
 *       lastItemCount: number | null,
 *       lastError: string | null
 *     }>
 *   }>
 * }} result
 */
export function renderUserInboundSync(result) {
  const lines = [
    `Inbound Sync: ${result.user.label}`,
    `Owner: ${result.user.owner ?? "unknown"}`,
    `Accounts: ${result.counts.accountCount}`,
    `Enabled Surfaces: ${result.counts.enabledSurfaceCount}`,
    `Never Synced: ${result.counts.staleSurfaceCount}`,
    `Failed Surfaces: ${result.counts.failedSurfaceCount}`
  ];

  for (const account of result.accounts) {
    lines.push("");
    lines.push(
      `  ${account.accountId}  ${account.capability}:${account.handle}${account.preferred ? " (preferred)" : ""}  source:${account.sourceType}`
    );
    lines.push(
      `    Enabled: ${account.enabledSurfaceCount}  Never Synced: ${account.staleSurfaceCount}  Failed: ${account.failedSurfaceCount}`
    );

    for (const surface of account.surfaces) {
      lines.push(
        `    - ${surface.key}  ${surface.enabled ? "enabled" : "disabled"}  status:${surface.lastRunStatus}  truth:${surface.truthLevel}`
      );
      if (surface.lastSyncedAt || surface.lastItemCount !== null || surface.lastError) {
        lines.push(
          `      lastSynced:${surface.lastSyncedAt ?? "never"}  items:${surface.lastItemCount ?? "unknown"}${surface.lastError ? `  error:${surface.lastError}` : ""}`
        );
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   user: { label: string, owner: string | null },
 *   counts: { observationCount: number, accountCount: number, surfaceCount: number },
 *   observations: Array<{
 *     id: string,
 *     accountId: string,
 *     capability: string,
 *     surfaceKey: string,
 *     kind: string,
 *     observedAt: string,
 *     actorName: string | null,
 *     summary: string,
 *     motionId: string | null,
 *     companyId: string | null,
 *     prospectId: string | null
 *   }>
 * }} result
 */
export function renderInboundObservationList(result) {
  const lines = [
    `Inbound Observations: ${result.user.label}`,
    `Owner: ${result.user.owner ?? "unknown"}`,
    `Observations: ${result.counts.observationCount}`,
    `Accounts: ${result.counts.accountCount}`,
    `Surfaces: ${result.counts.surfaceCount}`
  ];

  for (const observation of result.observations) {
    lines.push("");
    lines.push(
      `  ${observation.observedAt}  ${observation.surfaceKey}  ${observation.kind}  [${observation.capability}]`
    );
    lines.push(`    ${observation.actorName ?? "Unknown actor"}  ${observation.summary}`);
    if (observation.motionId || observation.companyId || observation.prospectId) {
      lines.push(
        `    linked motion:${observation.motionId ?? "-"} company:${observation.companyId ?? "-"} prospect:${observation.prospectId ?? "-"}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   observation: {
 *     id: string,
 *     userId: string,
 *     accountId: string,
 *     capability: string,
 *     platform: string,
 *     surfaceKey: string,
 *     kind: string,
 *     truthLevel: string,
 *     observedAt: string,
 *     recordedAt: string,
 *     actorName: string | null,
 *     actorTitle: string | null,
 *     actorCompanyName: string | null,
 *     actorHandle: string | null,
 *     actorProfileUrl: string | null,
 *     threadUrl: string | null,
 *     sourceUrl: string | null,
 *     summary: string,
 *     motionId: string | null,
 *     companyId: string | null,
 *     prospectId: string | null,
 *     notes: string | null
 *   }
 * }} result
 */
export function renderInboundObservationDetail(result) {
  const { observation } = result;
  return [
    `Inbound Observation: ${observation.kind}`,
    `Id: ${observation.id}`,
    `User: ${observation.userId}`,
    `Account: ${observation.accountId}`,
    `Capability: ${observation.capability}`,
    `Platform: ${observation.platform}`,
    `Surface: ${observation.surfaceKey}`,
    `Truth Level: ${observation.truthLevel}`,
    `Observed: ${observation.observedAt}`,
    `Recorded: ${observation.recordedAt}`,
    `Actor: ${[observation.actorName, observation.actorTitle, observation.actorCompanyName].filter(Boolean).join(" | ") || "unknown"}`,
    `Actor Handle: ${observation.actorHandle ?? "unknown"}`,
    `Actor Profile: ${observation.actorProfileUrl ?? "none"}`,
    `Thread Url: ${observation.threadUrl ?? "none"}`,
    `Source Url: ${observation.sourceUrl ?? "none"}`,
    `Summary: ${observation.summary}`,
    `Motion: ${observation.motionId ?? "none"}`,
    `Company: ${observation.companyId ?? "none"}`,
    `Prospect: ${observation.prospectId ?? "none"}`,
    `Notes: ${observation.notes ?? "none"}`
  ].join("\n");
}

/**
 * @param {{
 *   user: { label: string, owner: string | null },
 *   counts: {
 *     reviewItemCount: number,
 *     highPriorityCount: number,
 *     mediumPriorityCount: number,
 *     lowPriorityCount: number,
 *     decisionItemCount: number,
 *     signalItemCount: number,
 *     itemizationGapCount: number
 *   },
 *   surfaces: {
 *     enabledSurfaceCount: number,
 *     uncheckedSurfaceCount: number,
 *     itemizationGapCount: number,
 *     accounts: Array<{
 *       capability: string,
 *       handle: string,
 *       surfaces: Array<{
 *         label: string,
 *         lastRunStatus: string,
 *         lastItemCount: number | null,
 *         summary: string,
 *         recommendedAction: string,
 *         needsItemization: boolean
 *       }>
 *     }>
 *   },
 *   reviewItems: Array<{
 *     observedAt: string,
 *     ageDays: number,
 *     priority: string,
 *     state: string,
 *     kind: string,
 *     summary: string,
 *     recommendedAction: string,
 *     decisionOptions: string[],
 *     motion: { name: string } | null,
 *     company: { name: string | null } | null,
 *     prospect: { name: string, title: string } | null
 *   }>,
 *   itemizationGaps: Array<{
 *     capability: string,
 *     handle: string,
 *     label: string,
 *     itemCount: number,
 *     summary: string,
 *     recommendedAction: string
 *   }>
 * }} result
 */
export function renderInboundReview(result) {
  const lines = [
    `Inbound Review: ${result.user.label}`,
    `Owner: ${result.user.owner ?? "unknown"}`,
    `Review Items: ${result.counts.reviewItemCount}`,
    `High Priority: ${result.counts.highPriorityCount}`,
    `Medium Priority: ${result.counts.mediumPriorityCount}`,
    `Low Priority: ${result.counts.lowPriorityCount}`,
    `Decision Items: ${result.counts.decisionItemCount}`,
    `Signal Items: ${result.counts.signalItemCount}`,
    `Enabled Surfaces: ${result.surfaces.enabledSurfaceCount}`,
    `Unchecked Surfaces: ${result.surfaces.uncheckedSurfaceCount}`,
    `Itemization Gaps: ${result.counts.itemizationGapCount}`
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
        if (surface.needsItemization) {
          lines.push("      Gap: sync counted items here, but no individual observations were written back.");
        }
      }
    }
  }

  if (result.reviewItems.length) {
    lines.push("");
    lines.push("Review Queue:");

    for (const item of result.reviewItems) {
      lines.push(`  ${item.observedAt}  [${item.priority}]  ${item.kind}  state:${item.state}  age:${item.ageDays}d`);
      lines.push(`    ${item.summary}`);
      lines.push(`    Next: ${item.recommendedAction}`);
      if (item.decisionOptions.length) {
        lines.push(`    Choices: ${item.decisionOptions.join(", ")}`);
      }
      if (item.motion || item.company || item.prospect) {
        lines.push(
          `    Context: motion=${item.motion?.name ?? "-"}  company=${item.company?.name ?? "-"}  prospect=${item.prospect ? `${item.prospect.name} (${item.prospect.title})` : "-"}`
        );
      }
    }
  }

  if (result.itemizationGaps.length) {
    lines.push("");
    lines.push("Itemization Gaps:");

    for (const gap of result.itemizationGaps) {
      lines.push(`  ${gap.capability}:${gap.handle}  ${gap.label}  items:${gap.itemCount}`);
      lines.push(`    ${gap.summary}`);
      lines.push(`    Next: ${gap.recommendedAction}`);
    }
  }

  return lines.join("\n");
}
