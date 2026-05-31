// @ts-check

/**
 * @param {import("../schema/user.js").userSchema._type} user
 */
export function renderUserSummary(user) {
  const accountLines = user.accounts.length
    ? user.accounts.map((account) => {
        const source = account.sourceType === "browser-profile"
          ? `profile:${account.browserProfileId}`
          : `harness:${account.harnessConnectionId}`;
        return `  - ${account.capability}:${account.handle} ${account.preferred ? "(preferred) " : ""}[${source}]`;
      })
    : ["  - none"];
  const harnessLines = user.harnessConnections.length
    ? user.harnessConnections.map((connection) => `  - ${connection.runtime}:${connection.connector} (${connection.status})`)
    : ["  - none"];

  return [
    `User: ${user.label}`,
    `ID: ${user.id}`,
    `Owner: ${user.owner ?? "unknown"}`,
    `Created: ${user.createdAt}`,
    `Updated: ${user.updatedAt}`,
    `Working Hours: ${renderWorkingHoursInline(user.workingHours)}`,
    "Accounts:",
    ...accountLines,
    "Harness Connections:",
    ...harnessLines
  ].join("\n");
}

/**
 * @param {import("../schema/user.js").userSchema._type[]} users
 */
export function renderUserList(users) {
  if (!users.length) {
    return "No users found.";
  }

  return users
    .map((user) => `${user.id}  ${user.label}  owner:${user.owner ?? "unknown"}  accounts:${user.accounts.length}  harness:${user.harnessConnections.length}`)
    .join("\n");
}

/**
 * @param {{
 *   user: { id: string, label: string, owner: string | null },
 *   inspectedAt: string,
 *   counts: {
 *     connectionCount: number,
 *     availableCount: number,
 *     unavailableCount: number,
 *     unknownCount: number,
 *     updatedCount: number
 *   },
 *   probes: Array<{
 *     runtime: string,
 *     connector: string,
 *     storedStatus: string,
 *     detectedStatus: string,
 *     supported: boolean,
 *     willWriteback: boolean,
 *     reason: string,
 *     source: { path: string | null },
 *     evidence: string[]
 *   }>
 * }} result
 */
export function renderUserHarnessProbe(result) {
  const lines = [
    `Harness Probe: ${result.user.label}`,
    `User ID: ${result.user.id}`,
    `Inspected: ${result.inspectedAt}`,
    `Connections: ${result.counts.connectionCount}`,
    `Available: ${result.counts.availableCount}`,
    `Unavailable: ${result.counts.unavailableCount}`,
    `Unknown: ${result.counts.unknownCount}`
  ];

  if (result.counts.updatedCount > 0) {
    lines.push(`Writeback Updates: ${result.counts.updatedCount}`);
  }

  if (!result.probes.length) {
    lines.push("No matching harness connections.");
    return lines.join("\n");
  }

  lines.push("Probe Results:");
  for (const probe of result.probes) {
    lines.push(`- ${probe.runtime}:${probe.connector} stored=${probe.storedStatus} detected=${probe.detectedStatus}`);
    lines.push(`  Reason: ${probe.reason}`);
    if (probe.source.path) {
      lines.push(`  Source: ${probe.source.path}`);
    }
    if (probe.evidence.length) {
      lines.push(`  Evidence: ${probe.evidence.join(", ")}`);
    }
    if (!probe.supported) {
      lines.push("  Note: runtime probe not implemented for this runtime yet.");
    }
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   user: { id: string, label: string, owner: string | null },
 *   inspectedAt: string,
 *   workingHours: {
 *     mode: string,
 *     timezone: string,
 *     weekdays: string[],
 *     startLocalTime: string,
 *     endLocalTime: string
 *   },
 *   status: {
 *     openNow: boolean,
 *     nextOpenAt: string | null,
 *     summary: string
 *   }
 * }} result
 */
export function renderUserWorkingHours(result) {
  return [
    `Working Hours: ${result.user.label}`,
    `User ID: ${result.user.id}`,
    `Inspected: ${result.inspectedAt}`,
    `Mode: ${result.workingHours.mode}`,
    `Timezone: ${result.workingHours.timezone}`,
    `Weekdays: ${result.workingHours.weekdays.join(", ")}`,
    `Window: ${result.workingHours.startLocalTime}-${result.workingHours.endLocalTime}`,
    `Open Now: ${result.status.openNow ? "yes" : "no"}`,
    `Next Open At: ${result.status.nextOpenAt ?? "none"}`,
    `Summary: ${result.status.summary}`
  ].join("\n");
}

/**
 * @param {{
 *   mode: string,
 *   timezone: string,
 *   weekdays: string[],
 *   startLocalTime: string,
 *   endLocalTime: string
 * } | undefined} workingHours
 */
function renderWorkingHoursInline(workingHours) {
  if (!workingHours) {
    return "always open";
  }

  if (workingHours.mode === "always") {
    return "always open";
  }

  return `${workingHours.timezone} ${workingHours.startLocalTime}-${workingHours.endLocalTime} (${workingHours.weekdays.join(",")})`;
}
