// @ts-check

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 * @returns {string}
 */
export function renderBrowserProfileSummary(profile) {
  const lines = [
    `Browser Profile: ${profile.id}`,
    `Status: ${profile.status}`,
    `Label: ${profile.label}`,
    `Browser: ${profile.browser}`,
    `Detected Name: ${profile.detectedProfileName ?? "unknown"}`,
    `Profile Directory: ${profile.profileDirectory}`,
    `Profile Path: ${profile.profilePath}`,
    `User Data Dir: ${profile.userDataDir}`,
    `Browser Command: ${profile.browserCommand ?? "none"}`,
    `Capabilities: ${profile.capabilities.join(", ")}`,
    `Last Tested: ${profile.lastTestedAt ?? "never"}`,
    profile.notes ? `Notes: ${profile.notes}` : null
  ].filter(Boolean);

  if (profile.lastTestResult) {
    lines.push("", "Last Test");
    lines.push(`  Summary: ${profile.lastTestResult.summary}`);

    for (const check of profile.lastTestResult.checks) {
      lines.push(`  ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.details}`);
    }

    for (const warning of profile.lastTestResult.warnings) {
      lines.push(`  WARN ${warning}`);
    }
  }

  return lines.join("\n");
}
