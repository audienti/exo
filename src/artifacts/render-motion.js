// @ts-check

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @returns {string}
 */
export function renderMotionSummary(motion) {
  const lines = [
    `Motion: ${motion.name}`,
    `ID: ${motion.id}`,
    `Status: ${motion.status}`,
    `URL: ${motion.offer.sourceUrl}`,
    `Created: ${motion.createdAt}`,
    "",
    "Premise",
    `  Statement: ${motion.premise.statement ?? "none"}`,
    `  Notes: ${motion.premise.notes ?? "none"}`,
    `  Source: ${motion.premise.source}`,
    `  Status: ${motion.premise.status}`,
    "",
    "Targeting Profile",
    `  Geolocations: ${joinOrNone(motion.targetingProfile.geolocations)}`,
    `  ICP Types: ${joinOrNone(motion.targetingProfile.icpTypes)}`,
    `  Industries: ${joinOrNone(motion.targetingProfile.industries)}`,
    `  Company Types: ${joinOrNone(motion.targetingProfile.companyTypes)}`,
    `  Company Shapes: ${joinOrNone(motion.targetingProfile.companyShapes)}`,
    `  Company Sizes: ${joinOrNone(motion.targetingProfile.companySizes)}`,
    `  Target Titles: ${joinOrNone(motion.targetingProfile.targetTitles)}`,
    `  Role Families: ${joinOrNone(motion.targetingProfile.roleFamilies)}`,
    `  Segment Variants: ${joinOrNone(motion.targetingProfile.segmentVariants)}`,
    `  Stakeholder Target Count: ${motion.targetingProfile.stakeholderTargetCount}`,
    "",
    "Suppression Policy",
    `  Excluded Accounts: ${joinOrNone(motion.suppressionPolicy.excludedAccounts)}`,
    `  Excluded Domains: ${joinOrNone(motion.suppressionPolicy.excludedDomains)}`,
    `  Excluded Contacts: ${joinOrNone(motion.suppressionPolicy.excludedContacts)}`,
    `  DNC Entries: ${motion.suppressionPolicy.doNotContactEntries.length}`,
    `  DNC Sources: ${joinOrNone(motion.suppressionPolicy.doNotContactSources)}`,
    "",
    "Offer Thesis Seed",
    `  Source Title: ${motion.offerThesis.sourceTitle ?? "none"}`,
    `  Source Description: ${motion.offerThesis.sourceDescription ?? "none"}`,
    `  Source Summary: ${motion.offerThesis.sourceSummary}`,
    `  Status: ${motion.offerThesis.status}`,
    "",
    "Audience Hypotheses"
  ];

  if (!motion.audienceHypotheses.length) {
    lines.push("  none");
  } else {
    for (const audience of motion.audienceHypotheses) {
      lines.push(`  ${audience.id}  ${audience.name}  [confidence: ${audience.confidence}]`);
      if (audience.companyCriteria.length) {
        lines.push(`    Company Criteria: ${audience.companyCriteria.join(", ")}`);
      }
      if (audience.roleCriteria.length) {
        lines.push(`    Role Criteria: ${audience.roleCriteria.join(", ")}`);
      }
      if (audience.notes) {
        lines.push(`    Notes: ${audience.notes}`);
      }
    }
  }

  lines.push("", "Signals");

  if (!motion.signals.length) {
    lines.push("  none");
  } else {
    for (const signal of motion.signals) {
      lines.push(`  ${signal.id}  ${signal.scope}  ${signal.name}`);
      lines.push(`    Question: ${signal.question}`);
      if (signal.whyItMatters) {
        lines.push(`    Why It Matters: ${signal.whyItMatters}`);
      }
      if (signal.matchRule) {
        lines.push(`    Match Rule: ${signal.matchRule}`);
      }
      if (signal.audienceIds.length) {
        lines.push(`    Audience Ids: ${signal.audienceIds.join(", ")}`);
      }
      if (signal.observationMethods.length) {
        lines.push(
          `    Observation Methods: ${signal.observationMethods
            .map((method) => `${method.surface}${method.query ? ` (${method.query})` : ""}`)
            .join(", ")}`
        );
      }
    }
  }

  lines.push(
    "",
    "Target Accounts"
  );

  if (!motion.targetMap.accounts.length) {
    lines.push("  none");
  } else {
    for (const account of motion.targetMap.accounts) {
      lines.push(`  ${account.companyName}  [matches: ${account.signalMatches.length}]  [prospects: ${account.prospects.length}]`);
      if (account.websiteUrl) {
        lines.push(`    Website: ${account.websiteUrl}`);
      }
      if (account.signalMatches.length) {
        for (const match of account.signalMatches) {
          const subject = match.subject.type === "person"
            ? `${match.subject.personName ?? "unknown person"}${match.subject.personTitle ? ` (${match.subject.personTitle})` : ""}`
            : account.companyName;
          lines.push(`    - ${match.signalName} [${match.confidence}] on ${subject}`);
          lines.push(`      Writing Signal: ${match.summary}`);
          if (match.sourceUrl) {
            lines.push(`      Source: ${match.sourceUrl}`);
          }
          if (match.observedAt) {
            lines.push(`      Observed: ${match.observedAt}`);
          }
        }
      }
      if (account.prospects.length) {
        for (const prospect of account.prospects) {
          lines.push(`    Prospect: ${prospect.name} (${prospect.title}) [${prospect.buyingCommitteeRole}, ${prospect.decisionAuthority}, ${prospect.fitConfidence}]`);
          lines.push(`      Why Relevant: ${prospect.whyRelevant}`);
          if (prospect.email) {
            lines.push(`      Email: ${prospect.email}`);
          }
          if (prospect.profileViewedAt) {
            lines.push(`      Profile Viewed: ${prospect.profileViewedAt}`);
          }
          if (prospect.roleTruth.summary) {
            lines.push(`      Role Truth: ${prospect.roleTruth.summary}`);
          }
          if (prospect.triggerWindow.summary) {
            lines.push(`      Trigger Window: ${prospect.triggerWindow.summary}`);
          }
          if (prospect.identityTells.summary) {
            lines.push(`      Identity Tells: ${prospect.identityTells.summary}`);
          }
          if (prospect.liveSignal.summary) {
            lines.push(`      Live Signal: ${prospect.liveSignal.summary}`);
          }
          if (prospect.signalMatchIds.length) {
            lines.push(`      Signal Match Ids: ${prospect.signalMatchIds.join(", ")}`);
          }
          if (prospect.throughLine.status === "ready") {
            lines.push(`      Through-Line: ${prospect.throughLine.compressionLine ?? "defined"}`);
          }
          if (prospect.openingPlan.status === "ready") {
            lines.push(`      Opening Plan: ${prospect.openingPlan.replyPath ?? "defined"}`);
          }
          if (prospect.cadenceState.status === "ready") {
            lines.push(`      Cadence: ${prospect.cadenceState.currentStep ?? "defined"}`);
          }
        }
      }
    }
  }

  lines.push(
    "",
    "Next Steps"
  );

  for (const step of motion.nextSteps) {
    lines.push(`  - ${step}`);
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
