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
    "Purpose",
    `  ${description.identity.purpose}`,
    "",
    "Agent Start Here"
  ];

  for (const item of description.identity.interactionModel) {
    lines.push(`  - ${item}`);
  }

  lines.push("", "Operator Interface");
  lines.push(`  ${description.operatorInterface.principle}`);
  lines.push(`  Current Call: ${description.operatorInterface.currentCall.headline}`);
  lines.push(`  Next Move: ${description.operatorInterface.currentCall.nextMove}`);
  if (description.operatorInterface.currentCall.blockers.length) {
    lines.push("  Blockers:");
    for (const blocker of description.operatorInterface.currentCall.blockers) {
      lines.push(`    - ${blocker}`);
    }
  }
  lines.push("  Conversation Rules:");
  for (const rule of description.operatorInterface.conversationRules) {
    lines.push(`    - ${rule}`);
  }

  lines.push("", "Guide The Agent");
  lines.push(`  Principle: ${description.agentUsage.operatorGuidance.principle}`);
  lines.push(`  First Question: ${description.agentUsage.operatorGuidance.firstQuestion}`);

  lines.push("", "Current State");
  lines.push(`  Motions: ${description.stateSummary.motions.count}`);
  for (const motion of description.stateSummary.motions.preview) {
    lines.push(
      `    ${motion.name}  ${motion.id}  ${motion.status}  premise:${motion.premiseStatus}  ${motion.sourceUrl}`
    );
  }
  lines.push(
    `  Browser Profiles: ${description.stateSummary.browserProfiles.count} (${description.stateSummary.browserProfiles.readyCount} ready)`
  );
  for (const profile of description.stateSummary.browserProfiles.preview) {
    lines.push(
      `    ${profile.id}  ${profile.label}  ${profile.status}  [${profile.capabilities.join(", ")}]`
    );
  }
  lines.push(`  Companies: ${description.stateSummary.companies.count}`);
  for (const company of description.stateSummary.companies.preview) {
    lines.push(`    ${company.id}  ${company.name}  ${company.domain ?? "no-domain"}`);
  }

  lines.push("", "Recommended Next Actions");
  for (const step of description.gettingStarted) {
    lines.push(`  - ${step.title}: ${step.reason}`);
    for (const command of step.commands) {
      lines.push(`    ${command}`);
    }
  }

  lines.push("", "Current Commands");
  for (const capability of description.currentCapabilities) {
    lines.push(`  - ${capability.command}: ${capability.purpose}`);
  }

  lines.push("", "Operating Rules");
  for (const rule of description.operatingRules) {
    lines.push(`  - ${rule}`);
  }

  lines.push("", "Browser Profile Rules");
  for (const rule of description.browserProfileRules) {
    lines.push(`  - ${rule}`);
  }

  lines.push("", "Concurrency");
  lines.push(`  ${description.concurrency.model}`);
  for (const requirement of description.concurrency.requirements) {
    lines.push(`  - ${requirement}`);
  }

  lines.push("", "Current Limitations");
  for (const limitation of description.currentLimitations) {
    lines.push(`  - ${limitation}`);
  }

  lines.push("", "Docs");
  for (const doc of description.docs) {
    lines.push(`  - ${doc.label}: ${doc.path}`);
  }

  return lines.join("\n");
}
