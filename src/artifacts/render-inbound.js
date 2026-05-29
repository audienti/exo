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
