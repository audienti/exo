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
    `Updated: ${motion.updatedAt}`,
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
 * @param {{
 *   status: "decision-required" | "continued" | "cloned" | "created",
 *   offerPreview: {
 *     sourceUrl: string,
 *     sourceTitle: string | null,
 *     sourceDescription: string | null,
 *     sourceSummary: string
 *   },
 *   existingMotions: Array<{
 *     id: string,
 *     name: string,
 *     status: string,
 *     premiseStatus: string,
 *     audienceCount: number,
 *     signalCount: number,
 *     companyCount: number,
 *     prospectCount: number
 *   }>,
 *   motion?: import("../schema/motion.js").motionSchema._type
 * }} result
 */
export function renderMotionStartResult(result) {
  const lines = [
    `Motion Start: ${result.status}`,
    `URL: ${result.offerPreview.sourceUrl}`,
    `Offer Title: ${result.offerPreview.sourceTitle ?? "none"}`,
    `Offer Description: ${result.offerPreview.sourceDescription ?? "none"}`,
    `Offer Summary: ${result.offerPreview.sourceSummary}`
  ];

  if (result.existingMotions.length) {
    lines.push("", "Existing URL Matches");
    for (const motion of result.existingMotions) {
      lines.push(`  ${motion.name}  ${motion.id}  ${motion.status}  premise:${motion.premiseStatus}  audiences:${motion.audienceCount}  signals:${motion.signalCount}  companies:${motion.companyCount}  prospects:${motion.prospectCount}`);
    }
  }

  if (result.status === "decision-required") {
    lines.push("", "Decision Required");
    lines.push("  Existing motions already use this URL. Choose whether to continue one, clone one, or create a fresh motion from the same offer.");
    return lines.join("\n");
  }

  if (result.motion) {
    lines.push("", `Motion: ${result.motion.name}`, `Motion ID: ${result.motion.id}`);
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   motion: {
 *     id: string,
 *     name: string,
 *     status: string,
 *     sourceUrl: string,
 *     premiseStatus: string,
 *     audienceCount: number,
 *     signalCount: number,
 *     stakeholderTargetCount: number
 *   },
 *   motionPreflight: { status: "ready" | "blocked", blockers: string[] },
 *   browserGate: {
 *     status: "ready" | "blocked",
 *     capability: string,
 *     blocksEngagement: boolean,
 *     message: string,
 *     resolvedProfile: null | {
 *       id: string,
 *       label: string,
 *       browser: string,
 *       profileDirectory: string,
 *       verifiedCapabilities: string[]
 *     },
 *     trustedProfileCount: number
 *   },
 *   companyLoop: {
 *     companyCount: number,
 *     readyCount: number,
 *     items: Array<{
 *       companyId: string,
 *       companyName: string,
 *       stage: string,
 *       signalMatchCount: number,
 *       prospectCount: number,
 *       readyThroughLineCount: number,
 *       readyOpeningPlanCount: number,
 *       readyCadenceCount: number,
 *       missingEmailFallbackCount: number,
 *       executionIdentity: {
 *         status: string,
 *         message: string
 *       },
 *       nextCommand: string
 *     }>
 *   },
 *   overallStage: string,
 *   readyToTarget: boolean,
 *   readyToEngage: boolean,
 *   nextActions: string[]
 * }} result
 */
export function renderMotionTargetingSummary(result) {
  const lines = [
    `Motion Targeting: ${result.motion.name}`,
    `Motion ID: ${result.motion.id}`,
    `Stage: ${result.overallStage}`,
    `Ready To Target: ${result.readyToTarget ? "yes" : "no"}`,
    `Ready To Engage: ${result.readyToEngage ? "yes" : "no"}`,
    `Browser Gate: ${result.browserGate.status} (${result.browserGate.capability})`,
    `  ${result.browserGate.message}`
  ];

  if (result.browserGate.resolvedProfile) {
    lines.push(`  Profile: ${result.browserGate.resolvedProfile.label} (${result.browserGate.resolvedProfile.browser} / ${result.browserGate.resolvedProfile.profileDirectory})`);
  }

  if (result.motionPreflight.blockers.length) {
    lines.push("", "Motion Preflight Blockers");
    for (const blocker of result.motionPreflight.blockers) {
      lines.push(`  - ${blocker}`);
    }
  }

  lines.push("", "Company Loop");

  if (!result.companyLoop.items.length) {
    lines.push("  none");
  } else {
    for (const company of result.companyLoop.items) {
      lines.push(`  ${company.companyName}  [${company.stage}]  signals:${company.signalMatchCount}  prospects:${company.prospectCount}  through-lines:${company.readyThroughLineCount}  opening-plans:${company.readyOpeningPlanCount}  cadence:${company.readyCadenceCount}`);
      lines.push(`    Execution Identity: ${company.executionIdentity.status} — ${company.executionIdentity.message}`);
      if (company.missingEmailFallbackCount > 0) {
        lines.push(`    Missing Email Fallbacks: ${company.missingEmailFallbackCount}`);
      }
      lines.push(`    Next Command: ${company.nextCommand}`);
    }
  }

  lines.push("", "Next Actions");
  for (const action of result.nextActions) {
    lines.push(`  - ${action}`);
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   motion: {
 *     id: string,
 *     name: string,
 *     status: string,
 *     sourceUrl: string,
 *     createdAt: string,
 *     updatedAt: string
 *   },
 *   counts: {
 *     companyCount: number,
 *     prospectCount: number,
 *     messageTestReadyCount: number,
 *     recentPostReadyCount: number,
 *     emailFallbackCount: number
 *   },
 *   prospects: Array<{
 *     companyId: string,
 *     companyName: string,
 *     prospectId: string,
 *     name: string,
 *     title: string,
 *     buyingCommitteeRole: string,
 *     decisionAuthority: string,
 *     fitConfidence: string,
 *     messageTestReady: boolean,
 *     recentPost: { engageable: boolean },
 *     hasEmailFallback: boolean,
 *     primaryChannel: string | null,
 *     compressionLine: string | null
 *   }>
 * }} result
 */
export function renderMotionProspectList(result) {
  const lines = [
    `Motion Prospects: ${result.motion.name}`,
    `Motion ID: ${result.motion.id}`,
    `Status: ${result.motion.status}`,
    `Created: ${result.motion.createdAt}`,
    `Updated: ${result.motion.updatedAt}`,
    `Companies: ${result.counts.companyCount}`,
    `Prospects: ${result.counts.prospectCount}`,
    `Message-Test Ready: ${result.counts.messageTestReadyCount}`,
    `Recent Post Warmups: ${result.counts.recentPostReadyCount}`,
    `Email Fallbacks: ${result.counts.emailFallbackCount}`
  ];

  if (!result.prospects.length) {
    lines.push("", "No targeted prospects are stored on this motion yet.");
    return lines.join("\n");
  }

  lines.push("", "Prospects");
  for (const prospect of result.prospects) {
    lines.push(
      `  ${prospect.prospectId}  ${prospect.companyName}  ${prospect.name} — ${prospect.title}  [${prospect.buyingCommitteeRole}, ${prospect.decisionAuthority}, ${prospect.fitConfidence}]`
    );
    lines.push(
      `    Message-Test: ${prospect.messageTestReady ? "ready" : "not-ready"}  Recent Post Warmup: ${prospect.recentPost.engageable ? "ready" : "not-ready"}  Email: ${prospect.hasEmailFallback ? "yes" : "no"}  Channel: ${prospect.primaryChannel ?? "none"}`
    );
    if (prospect.compressionLine) {
      lines.push(`    Compression: ${prospect.compressionLine}`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   motion: {
 *     id: string,
 *     name: string,
 *     status: string
 *   },
 *   writingBrief: {
 *     company: {
 *       id: string,
 *       name: string,
 *       websiteUrl: string | null,
 *       linkedinCompanyUrl: string | null
 *     },
 *     prospect: {
 *       prospectId: string,
 *       name: string,
 *       title: string,
 *       buyingCommitteeRole: string,
 *       decisionAuthority: string,
 *       fitConfidence: string,
 *       whyRelevant: string,
 *       linkedinProfileUrl: string | null,
 *       email: string | null,
 *       profileViewedAt: string | null,
 *       roleTruth: { summary: string | null },
 *       triggerWindow: { summary: string | null, whyNowAnchor: string | null },
 *       identityTells: { summary: string | null, headline: string | null },
 *       liveSignal: {
 *         channel: string | null,
 *         activityType: string | null,
 *         summary: string | null,
 *         url: string | null,
 *         observedAt: string | null,
 *         freshnessBand: string | null,
 *         hookStrength: string | null,
 *         engagementRationale: string | null
 *       },
 *       recentPost: { engageable: boolean, reason: string },
 *       signalMatches: Array<{ signalName: string, summary: string, sourceUrl: string | null, observedAt: string | null, confidence: string }>,
 *       throughLine: {
 *         specificToThem: string | null,
 *         sharedProblem: string | null,
 *         whyNow: string | null,
 *         legitimateWedge: string | null,
 *         compressionLine: string | null
 *       },
 *       openingPlan: {
 *         whyNow: string | null,
 *         angle: string | null,
 *         replyPath: string | null,
 *         primaryChannel: string | null,
 *         fallbackChannel: string | null,
 *         fallbackTrigger: string | null,
 *         firstMove: string | null,
 *         firstMessageGoal: string | null,
 *         preflightActions: string[]
 *       },
 *       cadenceState: {
 *         currentStep: string | null,
 *         nextAction: string | null,
 *         nextActionDueAt: string | null
 *       },
 *       touches: Array<{
 *         occurredAt: string,
 *         surface: string,
 *         direction: string,
 *         outcome: string,
 *         summary: string
 *       }>
 *     },
 *     messageTestReady: boolean,
 *     recentPost: { engageable: boolean, reason: string }
 *   } | null
 * }} result
 */
export function renderMotionWritingBrief(result) {
  if (!result.writingBrief) {
    return `No writing brief is available for motion ${result.motion.name}.`;
  }

  const { company, prospect, messageTestReady, recentPost } = result.writingBrief;
  const lines = [
    `Motion Writing Brief: ${result.motion.name}`,
    `Motion ID: ${result.motion.id}`,
    `Company: ${company.name} (${company.id})`,
    `Prospect: ${prospect.name} (${prospect.title})`,
    `Prospect ID: ${prospect.prospectId}`,
    `Message-Test Ready: ${messageTestReady ? "yes" : "no"}`,
    `Recent Post Warmup: ${recentPost.engageable ? "ready" : "not-ready"}`,
    `Recent Post Reason: ${recentPost.reason}`,
    `Primary Channel: ${prospect.openingPlan.primaryChannel ?? "none"}`,
    `Fallback Channel: ${prospect.openingPlan.fallbackChannel ?? "none"}`,
    `First Message Goal: ${prospect.openingPlan.firstMessageGoal ?? "none"}`,
    `Reply Path: ${prospect.openingPlan.replyPath ?? "none"}`,
    "",
    "Prospect Context",
    `  Why Relevant: ${prospect.whyRelevant}`,
    `  Role Truth: ${prospect.roleTruth.summary ?? "none"}`,
    `  Trigger Window: ${prospect.triggerWindow.summary ?? "none"}`,
    `  Identity Tells: ${prospect.identityTells.summary ?? "none"}`,
    `  Live Signal: ${prospect.liveSignal.summary ?? "none"}`,
    `  Live Signal URL: ${prospect.liveSignal.url ?? "none"}`,
    `  Live Signal Freshness: ${prospect.liveSignal.freshnessBand ?? "unknown"}`,
    `  Live Signal Hook Strength: ${prospect.liveSignal.hookStrength ?? "unknown"}`,
    "",
    "Through-Line",
    `  Specific To Them: ${prospect.throughLine.specificToThem ?? "none"}`,
    `  Shared Problem: ${prospect.throughLine.sharedProblem ?? "none"}`,
    `  Why Now: ${prospect.throughLine.whyNow ?? "none"}`,
    `  Legitimate Wedge: ${prospect.throughLine.legitimateWedge ?? "none"}`,
    `  Compression Line: ${prospect.throughLine.compressionLine ?? "none"}`,
    "",
    "Opening Plan",
    `  Angle: ${prospect.openingPlan.angle ?? "none"}`,
    `  First Move: ${prospect.openingPlan.firstMove ?? "none"}`,
    `  Fallback Trigger: ${prospect.openingPlan.fallbackTrigger ?? "none"}`,
    `  Preflight Actions: ${prospect.openingPlan.preflightActions.join(" | ") || "none"}`,
    "",
    "Cadence",
    `  Current Step: ${prospect.cadenceState.currentStep ?? "none"}`,
    `  Next Action: ${prospect.cadenceState.nextAction ?? "none"}`,
    `  Next Action Due At: ${prospect.cadenceState.nextActionDueAt ?? "none"}`,
    "",
    "Prior Touches"
  ];

  if (!prospect.touches.length) {
    lines.push("  none");
  } else {
    for (const touch of prospect.touches) {
      lines.push(`  - ${touch.occurredAt}  ${touch.surface}  ${touch.direction}  ${touch.outcome}`);
      lines.push(`    Summary: ${touch.summary}`);
    }
  }

  lines.push(
    "",
    "Signal Matches"
  );

  if (!prospect.signalMatches.length) {
    lines.push("  none");
  } else {
    for (const match of prospect.signalMatches) {
      lines.push(`  - ${match.signalName} [${match.confidence}]`);
      lines.push(`    Writing Signal: ${match.summary}`);
      if (match.observedAt) {
        lines.push(`    Observed: ${match.observedAt}`);
      }
      if (match.sourceUrl) {
        lines.push(`    Source: ${match.sourceUrl}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   motion: { id: string, name: string },
 *   prospect: { name: string, title: string },
 *   company: { name: string },
 *   surfaces: Array<{
 *     key: string,
 *     stage: string,
 *     channel: string,
 *     available: boolean,
 *     missingReason: string | null,
 *     priorTouches: Array<{ occurredAt: string, surface: string, outcome: string, summary: string }>,
 *     contextSummary: {
 *       compressionLine: string | null,
 *       whyNow: string | null,
 *       angle: string | null,
 *       replyPath: string | null,
 *       firstMessageGoal: string | null,
 *       recentPostReady: boolean
 *     }
 *   }>
 * }} result
 */
export function renderMotionDraftCases(result) {
  const lines = [
    `Motion Draft Cases: ${result.motion.name}`,
    `Motion ID: ${result.motion.id}`,
    `Company: ${result.company.name}`,
    `Prospect: ${result.prospect.name} (${result.prospect.title})`,
    ""
  ];

  for (const surface of result.surfaces) {
    lines.push(`${surface.stage}  [${surface.key}]  ${surface.available ? "available" : "unavailable"}`);
    lines.push(`  Channel: ${surface.channel}`);
    lines.push(`  Recent Post Warmup: ${surface.contextSummary.recentPostReady ? "ready" : "not-ready"}`);
    lines.push(`  Compression: ${surface.contextSummary.compressionLine ?? "none"}`);
    lines.push(`  Why Now: ${surface.contextSummary.whyNow ?? "none"}`);
    lines.push(`  Angle: ${surface.contextSummary.angle ?? "none"}`);
    lines.push(`  Reply Path: ${surface.contextSummary.replyPath ?? "none"}`);
    lines.push(`  First Message Goal: ${surface.contextSummary.firstMessageGoal ?? "none"}`);
    if (!surface.available) {
      lines.push(`  Missing Reason: ${surface.missingReason ?? "unknown"}`);
    }
    if (surface.priorTouches.length) {
      lines.push("  Prior Touches:");
      for (const touch of surface.priorTouches) {
        lines.push(`    - ${touch.occurredAt}  ${touch.surface}  ${touch.outcome}: ${touch.summary}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * @param {string[]} values
 * @returns {string}
 */
function joinOrNone(values) {
  return values.length ? values.join(", ") : "none";
}
