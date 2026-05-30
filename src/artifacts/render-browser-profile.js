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
    `Identity Owner: ${profile.identity.owner ?? "unknown"}`,
    `Identity Workspace: ${profile.identity.workspace ?? "unknown"}`,
    `Identity Scope: ${profile.identity.scope}`,
    `Identity Accounts: ${profile.identity.accounts.length ? profile.identity.accounts.map((account) => `${account.capability}:${account.handle}`).join(", ") : "none"}`,
    `Weekly Quotas: profile-visits=${formatQuota(profile.automationControls.weeklyQuotas.profileVisits)}, connection-requests=${formatQuota(profile.automationControls.weeklyQuotas.invitations)}, messages-inmail=${formatQuota(profile.automationControls.weeklyQuotas.messages)}`,
    `Declared Capabilities: ${profile.capabilities.join(", ") || "none"}`,
    `Verified Capabilities: ${profile.verifiedCapabilities.join(", ") || "none"}`,
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

    for (const capabilityCheck of profile.lastTestResult.capabilityChecks) {
      lines.push(
        `  ${capabilityCheck.verified ? "PASS" : "WARN"} capability:${capabilityCheck.capability}: ${capabilityCheck.details}`
      );
    }
  }

  if (profile.lastAuthProbeResult) {
    lines.push("", "Last Auth Probe");
    lines.push(`  Runtime: ${profile.lastAuthProbeResult.runtime}`);
    lines.push(`  Checked At: ${profile.lastAuthProbeResult.checkedAt}`);
    lines.push(`  Status: ${profile.lastAuthProbeResult.status}`);
    lines.push(`  Summary: ${profile.lastAuthProbeResult.summary}`);

    for (const warning of profile.lastAuthProbeResult.warnings) {
      lines.push(`  WARN ${warning}`);
    }

    for (const capabilityCheck of profile.lastAuthProbeResult.capabilityChecks) {
      const expected = capabilityCheck.expectedHandle ? ` expected=${capabilityCheck.expectedHandle}` : "";
      const detected = capabilityCheck.detectedHandle ? ` detected=${capabilityCheck.detectedHandle}` : "";
      lines.push(
        `  ${capabilityCheck.verified ? "PASS" : "WARN"} auth:${capabilityCheck.capability}:${expected}${detected} ${capabilityCheck.details}`
      );
    }
  }

  return lines.join("\n");
}

/**
 * @param {Array<import("../schema/browser-profile.js").browserProfileSchema._type>} profiles
 * @param {readonly string[]} supportedCapabilities
 * @returns {string}
 */
export function renderBrowserProfileCapabilities(profiles, supportedCapabilities) {
  const lines = ["Browser Profile Capabilities", ""];

  if (!profiles.length) {
    lines.push("Supported Capabilities");

    for (const capability of supportedCapabilities) {
      lines.push(`  ${capability}`);
    }

    lines.push("", "Profiles", "  none", "", "Coverage");

    for (const capability of supportedCapabilities) {
      lines.push(`  ${capability}: none`);
    }

    return lines.join("\n");
  }

  lines.push("Profiles");

  for (const profile of profiles) {
    lines.push(
      `  ${profile.id}  ${profile.status}  ${profile.label}  declared:[${profile.capabilities.join(", ")}] verified:[${profile.verifiedCapabilities.join(", ")}]`
    );
  }

  lines.push("", "Coverage");

  for (const capability of supportedCapabilities) {
    const matchingProfiles = profiles.filter((profile) => profile.verifiedCapabilities.includes(capability));
    const summary = matchingProfiles.length
      ? matchingProfiles.map((profile) => `${profile.id} (${profile.status})`).join(", ")
      : "none";
    lines.push(`  ${capability}: ${summary}`);
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   browsersScanned: readonly string[],
 *   candidates: Array<{
 *     browser: string,
 *     profileDirectory: string,
 *     detectedProfileName: string | null,
 *     profilePath: string,
 *     structuralStatus: string,
 *     observedCapabilities: string[],
 *     registered: boolean,
 *     registeredProfileId: string | null,
 *     declaredCapabilities: string[],
 *     verifiedCapabilities: string[]
 *   }>
 * }} result
 * @returns {string}
 */
export function renderDiscoveredBrowserProfiles(result) {
  const lines = ["Discovered Browser Profiles", ""];
  lines.push(`Browsers Scanned: ${result.browsersScanned.join(", ") || "none"}`);

  if (!result.candidates.length) {
    lines.push("", "Candidates", "  none");
    return lines.join("\n");
  }

  lines.push("", "Candidates");
  for (const candidate of result.candidates) {
    lines.push(
      `  ${candidate.browser}  ${candidate.profileDirectory}  ${candidate.detectedProfileName ?? "unknown"}  ${candidate.structuralStatus}`
    );
    lines.push(`    path: ${candidate.profilePath}`);
    lines.push(`    observed:[${candidate.observedCapabilities.join(", ")}]`);
    if (candidate.registered) {
      lines.push(
        `    registered: yes  id:${candidate.registeredProfileId}  declared:[${candidate.declaredCapabilities.join(", ")}]  verified:[${candidate.verifiedCapabilities.join(", ")}]`
      );
    } else {
      lines.push("    registered: no");
    }
  }

  return lines.join("\n");
}

/**
 * @param {number | null} value
 * @returns {string}
 */
function formatQuota(value) {
  return value === null ? "unlimited" : String(value);
}
