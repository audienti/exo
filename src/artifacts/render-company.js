// @ts-check

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @returns {string}
 */
export function renderCompanySummary(company) {
  const lines = [
    `Company: ${company.id}`,
    `Name: ${company.name}`,
    `Domain: ${company.domain ?? "none"}`,
    `Website: ${company.websiteUrl ?? "none"}`,
    `LinkedIn Company URL: ${company.linkedinCompanyUrl ?? "none"}`,
    `Tags: ${joinOrNone(company.tags)}`,
    `Motions: ${joinOrNone(company.motionIds)}`,
    company.engagementProfileAssignment
      ? `Engagement Profile: ${company.engagementProfileAssignment.label} (${company.engagementProfileAssignment.browser} / ${company.engagementProfileAssignment.profileDirectory})`
      : "Engagement Profile: none",
    `Created: ${company.createdAt}`,
    `Updated: ${company.updatedAt}`,
    company.notes ? `Notes: ${company.notes}` : null
  ].filter(Boolean);

  return lines.join("\n");
}

/**
 * @param {{
 *   company: {
 *     id: string,
 *     name: string,
 *     domain: string | null,
 *     websiteUrl: string | null,
 *     linkedinCompanyUrl: string | null
 *   },
 *   motion: {
 *     id: string,
 *     name: string,
 *     premise: string | null,
 *     audienceHypotheses: Array<{ id: string, name: string, companyCriteria: string[], roleCriteria: string[], confidence: string }>,
 *     targetTitles: string[]
 *   },
 *   researchPath: string[],
 *   stateWritebacks: string[],
 *   signalRecency: {
 *     preferredWindowDays: number,
 *     maximumWindowDays: number,
 *     rules: string[]
 *   },
 *   signalChecklist: Array<{
 *     id: string,
 *     name: string,
 *     scope: string,
 *     question: string,
 *     whyItMatters: string | null,
 *     matchRule: string | null,
 *     audiences: string[],
 *     observationPlan: Array<{ surface: string, query: string | null, notes: string | null }>
 *   }>,
 *   personSignalChecklist: Array<{
 *     id: string,
 *     name: string,
 *     scope: string,
 *     question: string,
 *     whyItMatters: string | null,
 *     matchRule: string | null,
 *     audiences: string[],
 *     observationPlan: Array<{ surface: string, query: string | null, notes: string | null }>
 *   }>,
 *   prospectPlan: {
 *     minimumCount: number,
 *     targetCount: number,
 *     seniorityFloor: string,
 *     preferredTitles: string[],
 *     rules: string[],
 *     requiredOutputs: string[]
 *   },
 *   completionCriteria: string[]
 * }} brief
 */
export function renderCompanyResearchBrief(brief) {
  const lines = [
    `Company Research Brief: ${brief.company.name}`,
    `Company ID: ${brief.company.id}`,
    `Motion: ${brief.motion.name} (${brief.motion.id})`,
    `Domain: ${brief.company.domain ?? "none"}`,
    `Website: ${brief.company.websiteUrl ?? "missing"}`,
    `LinkedIn Company URL: ${brief.company.linkedinCompanyUrl ?? "none"}`,
    `Premise: ${brief.motion.premise ?? "none"}`,
    `Target Titles: ${joinOrNone(brief.motion.targetTitles)}`,
    "",
    "Research Path"
  ];

  for (const step of brief.researchPath) {
    lines.push(`  - ${step}`);
  }

  lines.push("", "State Writebacks");
  for (const writeback of brief.stateWritebacks) {
    lines.push(`  - ${writeback}`);
  }

  lines.push("", "Signal Recency");
  for (const rule of brief.signalRecency.rules) {
    lines.push(`  - ${rule}`);
  }

  lines.push("", "Company Signal Checklist");
  if (!brief.signalChecklist.length) {
    lines.push("  none");
  } else {
    for (const signal of brief.signalChecklist) {
      lines.push(`  ${signal.id}  ${signal.scope}  ${signal.name}`);
      lines.push(`    Question: ${signal.question}`);
      if (signal.whyItMatters) {
        lines.push(`    Why It Matters: ${signal.whyItMatters}`);
      }
      if (signal.matchRule) {
        lines.push(`    Match Rule: ${signal.matchRule}`);
      }
      if (signal.audiences.length) {
        lines.push(`    Audiences: ${signal.audiences.join(", ")}`);
      }
      for (const method of signal.observationPlan) {
        lines.push(`    Observe via ${method.surface}: ${method.query ?? "no explicit query"}`);
        if (method.notes) {
          lines.push(`      Notes: ${method.notes}`);
        }
      }
    }
  }

  lines.push("", "Person Signal Checklist");
  if (!brief.personSignalChecklist.length) {
    lines.push("  none");
  } else {
    for (const signal of brief.personSignalChecklist) {
      lines.push(`  ${signal.id}  ${signal.scope}  ${signal.name}`);
      lines.push(`    Question: ${signal.question}`);
      for (const method of signal.observationPlan) {
        lines.push(`    Observe via ${method.surface}: ${method.query ?? "no explicit query"}`);
        if (method.notes) {
          lines.push(`      Notes: ${method.notes}`);
        }
      }
    }
  }

  lines.push(
    "",
    "Prospect Plan",
    `  Find ${brief.prospectPlan.minimumCount}-${brief.prospectPlan.targetCount} people.`,
    `  Seniority Floor: ${brief.prospectPlan.seniorityFloor}`,
    `  Preferred Titles: ${joinOrNone(brief.prospectPlan.preferredTitles)}`
  );

  for (const rule of brief.prospectPlan.rules) {
    lines.push(`  - ${rule}`);
  }

  lines.push("", "Required Outputs");
  for (const output of brief.prospectPlan.requiredOutputs) {
    lines.push(`  - ${output}`);
  }

  lines.push("", "Completion Criteria");
  for (const criterion of brief.completionCriteria) {
    lines.push(`  - ${criterion}`);
  }

  return lines.join("\n");
}

/**
 * @param {Array<import("../schema/company.js").companySchema._type>} companies
 * @returns {string}
 */
export function renderCompanyList(companies) {
  if (!companies.length) {
    return "No companies found.";
  }

  return companies
    .map((company) => {
      const domain = company.domain ?? "no-domain";
      const assignment = company.engagementProfileAssignment?.label ?? "none";
      return `${company.id}  ${company.name}  ${domain}  [motions: ${company.motionIds.length}]  [profile: ${assignment}]`;
    })
    .join("\n");
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {Array<import("../schema/motion.js").motionSchema._type>} motions
 * @returns {string}
 */
export function renderCompanyMotions(company, motions) {
  const lines = [
    `Company Motions: ${company.name}`,
    `Company Id: ${company.id}`,
    ""
  ];

  if (!motions.length) {
    lines.push("No linked motions.");
    return lines.join("\n");
  }

  for (const motion of motions) {
    lines.push(`${motion.id}  ${motion.status}  ${motion.offer.sourceUrl}`);
  }

  return lines.join("\n");
}

/**
 * @param {string[]} values
 * @returns {string}
 */
function joinOrNone(values) {
  return values.length ? values.join(", ") : "none";
}
