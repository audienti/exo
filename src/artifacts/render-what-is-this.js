// @ts-check

/**
 * @param {ReturnType<import("../core/what-is-this.js").describeExo>} description
 * @returns {string}
 */
export function renderWhatIsThis(description) {
  const lines = [
    `${description.name} ${description.version}`,
    description.identity.oneLiner,
    "",
    `Current call: ${description.operatorInterface.currentCall.headline}`,
    `Next move: ${description.operatorInterface.currentCall.nextMove}`,
    "",
    "Default agent contract:",
    "  - ask one direct operator question at a time when Exo already knows the decision",
    "  - hide shell setup, state-path setup, and sync mechanics unless the workflow is blocked",
    "  - write durable outcomes back into Exo instead of leaving them in chat"
  ];

  if (description.operatorInterface.currentCall.blockers.length) {
    lines.push("", "Current blockers:");
    for (const blocker of description.operatorInterface.currentCall.blockers) {
      lines.push(`  - ${blocker}`);
    }
  }

  lines.push("", "Current state:");
  lines.push(`  - motions: ${description.stateSummary.motions.count}`);
  if (description.stateSummary.motions.focusMotionName) {
    lines.push(`  - focus motion: ${description.stateSummary.motions.focusMotionName}`);
  }
  lines.push(`  - ready browser profiles: ${description.stateSummary.browserProfiles.readyCount}`);
  lines.push(`  - companies: ${description.stateSummary.companies.count}`);
  lines.push(`  - execution users: ${description.stateSummary.users.count}`);
  lines.push("", "Use `exo next` for the next governed operator decision.");
  lines.push("Use `exo what-is-this --json` when an agent needs the full contract.");

  return lines.join("\n");
}
