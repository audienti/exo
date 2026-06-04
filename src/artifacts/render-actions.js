// @ts-check

/**
 * @param {{
 *   actions: Array<{
 *     key: string,
 *     label: string,
 *     platform: string,
 *     category: string,
 *     executionActionType: string,
 *     requiredCapability: string,
 *     draftSurface: string | null
 *   }>
 * }} result
 */
export function renderActionCatalog(result) {
  const lines = ["Canonical Actions"];

  for (const action of result.actions) {
    lines.push(`  ${action.key}  ${action.label}  [${action.platform} / ${action.category}]`);
    lines.push(`    Execution: ${action.executionActionType}  Capability: ${action.requiredCapability}  Draft Surface: ${action.draftSurface ?? "none"}`);
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   action: {
 *     key: string,
 *     label: string,
 *     summary: string,
 *     platform: string,
 *     category: string,
 *     executionActionType: string,
 *     rateLimitActionType: string,
 *     requiredCapability: string,
 *     entityRequirement: string,
 *     fields: string[],
 *     aliases: string[],
 *     activityKeys: string[],
 *     draftSurface: string | null,
 *     supportedResults?: Array<{ key: string, label: string }>,
 *     executionHints: {
 *       affordances: string[],
 *       fallbacks: string[],
 *       successProofs: string[],
 *       failureSignatures: string[],
 *       cleanup: string[]
 *     },
 *     knowledgeRefs: Array<{ path: string, section: string }>
 *   }
 * }} result
 */
export function renderActionDetail(result) {
  const { action } = result;
  const lines = [
    `Action: ${action.label}`,
    `Key: ${action.key}`,
    `Platform: ${action.platform}`,
    `Category: ${action.category}`,
    `Execution Action Type: ${action.executionActionType}`,
    `Rate Limit Type: ${action.rateLimitActionType}`,
    `Required Capability: ${action.requiredCapability}`,
    `Entity Requirement: ${action.entityRequirement}`,
    `Summary: ${action.summary}`,
    `Draft Surface: ${action.draftSurface ?? "none"}`,
    `Supported Results: ${action.supportedResults?.map((result) => result.key).join(", ") || "none"}`,
    `Fields: ${action.fields.join(", ") || "none"}`,
    `Aliases: ${action.aliases.join(", ") || "none"}`,
    `Observed Activity Keys: ${action.activityKeys.join(", ") || "none"}`,
    "Knowledge"
  ];

  for (const reference of action.knowledgeRefs) {
    lines.push(`  - ${reference.path} :: ${reference.section}`);
  }

  const hintSections = [
    ["Affordances", action.executionHints.affordances],
    ["Fallbacks", action.executionHints.fallbacks],
    ["Success Proofs", action.executionHints.successProofs],
    ["Failure Signatures", action.executionHints.failureSignatures],
    ["Cleanup", action.executionHints.cleanup]
  ].filter(([, entries]) => entries.length > 0);

  if (hintSections.length > 0) {
    lines.push("", "Execution Hints");
    for (const [label, entries] of hintSections) {
      lines.push(`  ${label}`);
      for (const entry of entries) {
        lines.push(`    - ${entry}`);
      }
    }
  }

  return lines.join("\n");
}
