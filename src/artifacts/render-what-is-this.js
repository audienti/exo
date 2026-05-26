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
    "How To Use It"
  ];

  for (const item of description.identity.interactionModel) {
    lines.push(`  - ${item}`);
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
