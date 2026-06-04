// @ts-check

import { browserProfileCapabilitySchema, browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { buildMotionQueueSummary, withDerivedTargetAccountQueueState } from "../lib/motion-queue.js";
import { resolveScopedExecutionAssignment } from "./resolve-scoped-execution-assignment.js";

const MINIMUM_AVAILABLE_PROSPECTS = 25;

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 * @param {unknown[]} rawProfiles
 * @param {unknown[]} rawUsers
 * @param {{
 *   capability?: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type
 * }} [options]
 */
export function evaluateMotionTargeting(rawMotion, rawCompanies, rawProfiles, rawUsers, options = {}) {
  const motion = motionSchema.parse(rawMotion);
  const capability = browserProfileCapabilitySchema.parse(options.capability ?? "linkedin");
  const companies = rawCompanies
    .map((company) => companySchema.parse(company))
    .filter((company) => company.motionIds.includes(motion.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const profiles = rawProfiles
    .map((profile) => browserProfileSchema.parse(profile))
    .sort(compareProfilesForResolution);
  const users = rawUsers.map((user) => userSchema.parse(user));
  const motionPreflight = buildMotionPreflight(motion);
  const browserGate = buildBrowserGate(profiles, capability);
  const companyLoop = companies.map((company) => buildCompanyTargetingState(company, motion, profiles, users, capability, browserGate));
  const engagementGate = buildEngagementGate({
    capability,
    browserGate,
    companyLoop,
    users
  });
  const queue = buildMotionQueueSummary(motion, companies);
  const overallStage = deriveOverallStage(motionPreflight, companyLoop);
  const readyToTarget = overallStage === "targeting-ready";
  const readyToEngage = readyToTarget
    && engagementGate.status === "ready"
    && companyLoop.every((company) => company.stage !== "targeting-ready" || company.executionIdentity.status === "pinned-ready");
  const inventoryTarget = buildInventoryTarget(queue);

  return {
    motion: {
      id: motion.id,
      name: motion.name,
      status: motion.status,
      sourceUrl: motion.offer.sourceUrl,
      premiseStatus: motion.premise.status,
      audienceCount: motion.audienceHypotheses.length,
      signalCount: motion.signals.length,
      stakeholderTargetCount: motion.targetingProfile.stakeholderTargetCount
    },
    motionPreflight,
    browserGate: engagementGate,
    companyLoop: {
      companyCount: companyLoop.length,
      readyCount: companyLoop.filter((company) => company.stage === "targeting-ready").length,
      items: companyLoop
    },
    queue,
    inventoryTarget,
    overallStage,
    readyToTarget,
    readyToEngage,
    nextActions: buildNextActions(motion, motionPreflight, engagementGate, companyLoop, users, queue, inventoryTarget)
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 */
function buildMotionPreflight(motion) {
  /** @type {string[]} */
  const blockers = [];
  let blockerType = null;

  if (motion.status === "paused") {
    blockers.push("Motion is paused. Resume or restart it before targeting.");
    blockerType = "lifecycle";
  } else if (motion.status === "archived") {
    blockers.push("Motion is archived. Restart it or clone it before targeting.");
    blockerType = "lifecycle";
  }

  if (!motion.offer.sourceUrl) {
    blockers.push("Set the offer source URL first.");
  }

  if (motion.premise.status !== "defined") {
    blockers.push("Define the premise before targeting.");
  }

  if (!motion.audienceHypotheses.length) {
    blockers.push("Define at least one audience hypothesis before targeting.");
  }

  if (!motion.signals.length) {
    blockers.push("Define at least one motion signal before targeting.");
  }

  return {
    status: blockers.length ? "blocked" : "ready",
    blockers,
    blockerType
  };
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/browser-profile.js").browserProfileCapabilitySchema._type} capability
 */
function buildBrowserGate(profiles, capability) {
  return {
    status: "blocked",
    capability,
    blocksEngagement: true,
    message: `Browser-profile fallback has been removed for ${capability}. Map governed connector accounts instead.`,
    resolvedProfile: null,
    trustedProfileCount: 0
  };
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/user.js").userSchema._type[]} users
 * @param {import("../schema/browser-profile.js").browserProfileCapabilitySchema._type} capability
 * @param {ReturnType<typeof buildBrowserGate>} browserGate
 */
function buildCompanyTargetingState(company, motion, profiles, users, capability, browserGate) {
  const rawAccount = motion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
  const account = rawAccount ? withDerivedTargetAccountQueueState(rawAccount) : null;
  const prospects = account?.prospects ?? [];
  const readyCadenceCount = prospects.filter((prospect) => prospect.cadenceState.status === "ready").length;
  const missingEmailFallbackCount = prospects.filter((prospect) => !prospect.email).length;
  const executionIdentity = resolveCompanyExecutionIdentity(company, motion, profiles, users, capability, browserGate.resolvedProfile);

  let stage = "targeting-ready";
  if (!company.websiteUrl || !company.linkedinCompanyUrl) {
    stage = "needs-company-identity";
  } else if (!account || account.signalMatches.length === 0) {
    stage = "needs-company-research";
  } else if (prospects.length === 0) {
    stage = "needs-prospect-selection";
  } else if (readyCadenceCount < prospects.length) {
    stage = "needs-cadence";
  }

  return {
    companyId: company.id,
    companyName: company.name,
    stage,
    queueStatus: account?.queueState?.status ?? "discovered",
    websiteUrl: company.websiteUrl,
    linkedinCompanyUrl: company.linkedinCompanyUrl,
    logoSourceUrl: company.logoSourceUrl,
    logoUrl: company.logoUrl,
    signalMatchCount: account?.signalMatches.length ?? 0,
    prospectCount: prospects.length,
    readyCadenceCount,
    missingEmailFallbackCount,
    executionIdentity,
    nextCommand: buildCompanyNextCommand(company.id, motion.id, stage)
  };
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/user.js").userSchema._type[]} users
 * @param {import("../schema/browser-profile.js").browserProfileCapabilitySchema._type} capability
 * @param {{ id: string, label: string, browser: string, profileDirectory: string, verifiedCapabilities: string[] } | null} globalResolvedProfile
 */
function resolveCompanyExecutionIdentity(company, motion, profiles, users, capability, globalResolvedProfile) {
  const scoped = resolveScopedExecutionAssignment({
    rawCompany: company,
    rawMotion: motion,
    rawProfiles: profiles,
    rawUsers: users,
    capability
  });

  if (scoped.resolvedAccount && scoped.assignedUser) {
    if (scoped.resolvedAccount.browserProfile || scoped.resolvedAccount.sourceType === "browser-profile") {
      const scopeLabel = describeExecutionScope(scoped.source);
      return {
        status: "pinned-untrusted",
        transportKind: "browser-profile",
        resolutionSource: scoped.source,
        message: `${scopeLabel} is pinned to user ${scoped.assignedUser.label}, but profile-backed ${capability} accounts are no longer supported as governed execution paths.`,
        profile: null,
        user: {
          id: scoped.assignedUser.id,
          label: scoped.assignedUser.label
        }
      };
    }

    const scopeLabel = describeExecutionScope(scoped.source);
    return {
      status: scoped.resolvedAccount.status === "ready" ? "pinned-ready" : "pinned-untrusted",
      transportKind: "harness-connection",
      resolutionSource: scoped.source,
      message: scoped.resolvedAccount.status === "ready"
        ? `${scopeLabel} is pinned to user ${scoped.assignedUser.label} for ${capability} through ${scoped.resolvedAccount.harnessConnection.runtime}:${scoped.resolvedAccount.harnessConnection.connector}.`
        : scoped.resolvedAccount.reason,
      profile: null,
      user: {
        id: scoped.assignedUser.id,
        label: scoped.assignedUser.label
      }
    };
  }

  if (scoped.assignedUser && scoped.accountResolution?.status && scoped.accountResolution.status !== "resolved") {
    return {
      status: "pinned-untrusted",
      transportKind: scoped.accountResolution.sourceType ?? null,
      resolutionSource: scoped.source,
      message: scoped.accountResolution.reason,
      profile: null,
      user: {
        id: scoped.assignedUser.id,
        label: scoped.assignedUser.label
      }
    };
  }

  if (scoped.assignedProfile) {
    const scopeLabel = describeExecutionScope(scoped.source);
    return {
      status: "pinned-untrusted",
      transportKind: "browser-profile",
      resolutionSource: scoped.source,
      message: `${scopeLabel} still carries a browser-profile assignment for ${capability}, but browser-profile fallback has been removed.`,
      profile: null,
      user: null
    };
  }

  if (globalResolvedProfile) {
    return {
      status: "unassigned-global-ready",
      transportKind: "browser-profile",
      resolutionSource: scoped.source,
      message: `A browser profile exists for ${capability}, but browser-profile fallback has been removed. Map a governed connector account instead.`,
      profile: null,
      user: null
    };
  }

  return {
    status: "unassigned-no-global-profile",
    transportKind: null,
    resolutionSource: scoped.source,
    message: `No governed ${capability} connector path is available for this company yet.`,
    profile: null,
    user: null
  };
}

/**
 * @param {{
 *   capability: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type,
 *   browserGate: ReturnType<typeof buildBrowserGate>,
 *   companyLoop: ReturnType<typeof buildCompanyTargetingState>[],
 *   users: import("../schema/user.js").userSchema._type[]
 * }} input
 */
function buildEngagementGate(input) {
  const capabilityAccountCount = countCapabilityAccounts(input.users, input.capability);
  const readyConnectorCount = input.companyLoop.filter((company) =>
    company.executionIdentity.status === "pinned-ready"
    && company.executionIdentity.transportKind === "harness-connection"
  ).length;

  if (readyConnectorCount > 0) {
    return {
      status: "ready",
      capability: input.capability,
      blocksEngagement: true,
      message: `A governed ${input.capability} connector path is available for engagement.`,
      resolvedProfile: input.browserGate.resolvedProfile,
      trustedProfileCount: input.browserGate.trustedProfileCount
    };
  }

  const untrustedExecution = input.companyLoop.find((company) => company.executionIdentity.status === "pinned-untrusted");
  if (untrustedExecution) {
    return {
      status: "blocked",
      capability: input.capability,
      blocksEngagement: true,
      message: untrustedExecution.executionIdentity.message,
      resolvedProfile: input.browserGate.resolvedProfile,
      trustedProfileCount: input.browserGate.trustedProfileCount
    };
  }

  if (!capabilityAccountCount) {
    return {
      status: "blocked",
      capability: input.capability,
      blocksEngagement: true,
      message: `No governed ${input.capability} account is mapped to an execution user yet. Research can continue, but engagement cannot launch until you map one.`,
      resolvedProfile: null,
      trustedProfileCount: 0
    };
  }

  return {
    status: "blocked",
    capability: input.capability,
    blocksEngagement: true,
    message: `A governed ${input.capability} account exists, but Exo cannot yet resolve one ready execution identity for this motion. Pin the acting user to the company or motion before launch.`,
    resolvedProfile: input.browserGate.resolvedProfile,
    trustedProfileCount: input.browserGate.trustedProfileCount
  };
}

/**
 * @param {ReturnType<typeof buildMotionPreflight>} motionPreflight
 * @param {ReturnType<typeof buildCompanyTargetingState>[]} companyLoop
 */
function deriveOverallStage(motionPreflight, companyLoop) {
  if (motionPreflight.status === "blocked") {
    if (motionPreflight.blockerType === "lifecycle") {
      if (motionPreflight.blockers.some((blocker) => blocker.includes("paused"))) {
        return "paused";
      }

      if (motionPreflight.blockers.some((blocker) => blocker.includes("archived"))) {
        return "archived";
      }
    }

    return "needs-motion-definition";
  }

  if (!companyLoop.length) {
    return "needs-company-targeting";
  }

  if (companyLoop.some((company) => company.stage === "needs-company-identity" || company.stage === "needs-company-research")) {
    return "needs-company-research";
  }

  if (companyLoop.some((company) => company.stage === "needs-prospect-selection")) {
    return "needs-prospect-selection";
  }

  if (companyLoop.some((company) => company.stage === "needs-cadence")) {
    return "needs-cadence";
  }

  return "targeting-ready";
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {ReturnType<typeof buildMotionPreflight>} motionPreflight
 * @param {ReturnType<typeof buildBrowserGate>} browserGate
 * @param {ReturnType<typeof buildCompanyTargetingState>[]} companyLoop
 * @param {import("../schema/user.js").userSchema._type[]} users
 * @param {ReturnType<typeof buildMotionQueueSummary>} queue
 * @param {ReturnType<typeof buildInventoryTarget>} inventoryTarget
 */
function buildNextActions(motion, motionPreflight, browserGate, companyLoop, users, queue, inventoryTarget) {
  /** @type {string[]} */
  const actions = [];
  const capabilityAccountCount = countCapabilityAccounts(users, browserGate.capability);

  if (motionPreflight.status === "blocked") {
    if (motionPreflight.blockerType === "lifecycle") {
      if (motion.status === "paused") {
        actions.push(`Resume the motion with exo motion resume ${motion.id} or restart it with exo motion restart ${motion.id}.`);
        return actions;
      }

      if (motion.status === "archived") {
        actions.push(`Restart the archived motion with exo motion restart ${motion.id} or branch it with exo motion clone ${motion.id} ... .`);
        return actions;
      }
    }

    actions.push(...motionPreflight.blockers.map((blocker) => `${blocker} Use exo motion update ${motion.id} ... to fix it.`));
    return actions;
  }

  if (browserGate.status === "blocked") {
    if (!capabilityAccountCount) {
      actions.push(`Map a governed ${browserGate.capability} account onto an execution user before launch. Exo can see runtime connector coverage, but no ${browserGate.capability} account is stored in state yet.`);
    } else {
      actions.push(browserGate.message);
    }
  }

  if (!companyLoop.length) {
    actions.push(`Link target companies to ${motion.name} before trying to build prospect plans.`);
    return actions;
  }

  if (inventoryTarget.shortfall > 0) {
    actions.push(
      buildInventoryExpansionAction({
        motion,
        inventoryTarget,
        companyLoop,
      }),
    );
  }

  // Stage precedence should dominate company order so thin motions expand
  // backlog before polishing later-stage work on a single account.
  for (const stage of [
    "needs-company-identity",
    "needs-company-research",
    "needs-prospect-selection",
    "needs-cadence"
  ]) {
    for (const company of companyLoop) {
      if (company.stage !== stage) {
        continue;
      }

      if (stage === "needs-company-identity") {
        actions.push(`Complete canonical website and LinkedIn company identity for ${company.companyName}. Then run exo companies research-brief ${company.companyId} --motion ${motion.id} --json.`);
        continue;
      }

      if (stage === "needs-company-research") {
        actions.push(`Run the company research loop for ${company.companyName}: company site first, then Google/news, and persist only strong recent signal matches.`);
        continue;
      }

      if (stage === "needs-prospect-selection") {
        actions.push(`Select up to ${motion.targetingProfile.stakeholderTargetCount} best-fit prospects for ${company.companyName} and persist them before planning outreach.`);
        continue;
      }

      actions.push(`Complete the remaining prospect cadence state for ${company.companyName} before launch. Exo now treats cadence as the only required branch-planning object.`);
    }
  }

  for (const company of companyLoop) {
    if (company.stage !== "targeting-ready") {
      continue;
    }

    if (company.executionIdentity.status !== "pinned-ready") {
      if (
        company.executionIdentity.transportKind === "harness-connection"
        && company.executionIdentity.status !== "pinned-untrusted"
      ) {
        actions.push(`Repair the governed ${browserGate.capability} connector path for ${company.companyName} before engagement.`);
      } else if (!capabilityAccountCount) {
        actions.push(`Map a governed ${browserGate.capability} account onto an execution user before launching ${company.companyName}.`);
      } else if (company.executionIdentity.status === "unassigned-global-ready") {
        actions.push(`Pin the acting execution user to ${company.companyName} before engagement so the motion launches from one consistent identity.`);
      } else if (company.executionIdentity.status === "pinned-untrusted") {
        actions.push(company.executionIdentity.message);
      } else {
        actions.push(`Resolve a governed ${browserGate.capability} execution identity for ${company.companyName} before engagement.`);
      }
    }

    if (company.missingEmailFallbackCount > 0) {
      actions.push(`Find verified direct-email fallbacks for ${company.companyName} where possible. LinkedIn is still the only ready channel for some chosen prospects.`);
    }
  }

  if (!actions.length) {
    actions.push("The motion is targeting-ready. Let the agent execute the stored cadence branches and surface only review-worthy exceptions to the operator.");
  }

  return actions;
}

/**
 * @param {{
 *   motion: import("../schema/motion.js").motionSchema._type,
 *   inventoryTarget: { minimumAvailableProspects: number, availableProspectCount: number },
 *   companyLoop: Array<{ companyName: string, stage: string }>
 * }} input
 */
function buildInventoryExpansionAction({ motion, inventoryTarget, companyLoop }) {
  const researchCompanies = companyLoop.filter((company) => company.stage === "needs-company-research").map((company) => company.companyName);
  const selectionCompanies = companyLoop.filter((company) => company.stage === "needs-prospect-selection").map((company) => company.companyName);
  const cadenceCompanies = companyLoop.filter((company) => company.stage === "needs-cadence").map((company) => company.companyName);
  const base = `Build ${motion.name} to at least ${inventoryTarget.minimumAvailableProspects} available prospects before treating the queue as sufficient. It only has ${inventoryTarget.availableProspectCount} right now.`;

  if (researchCompanies.length > 0) {
    return `${base} Start with the research backlog on ${joinHumanList(researchCompanies.slice(0, 2))}, then queue more company finding whenever a researched account does not yield strong-fit people instead of forcing weak fits into cadence.`;
  }

  if (selectionCompanies.length > 0) {
    return `${base} Start by selecting the best-fit people from ${joinHumanList(selectionCompanies.slice(0, 2))}, then queue more company finding whenever a researched account does not yield strong-fit people instead of forcing weak fits into cadence.`;
  }

  if (cadenceCompanies.length > 0) {
    return `${base} Start by finishing cadence on the strongest current people at ${joinHumanList(cadenceCompanies.slice(0, 2))}, then queue more company finding whenever those accounts do not yield enough strong-fit people.`;
  }

  return `${base} Keep researching the backlog and queue more company finding whenever an account does not yield strong-fit people instead of forcing weak fits into cadence.`;
}

/**
 * @param {string[]} values
 */
function joinHumanList(values) {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

/**
 * @param {ReturnType<typeof buildMotionQueueSummary>} queue
 */
function buildInventoryTarget(queue) {
  const availableProspectCount = queue.availableProspectCount ?? queue.prospectCount ?? 0;
  return {
    minimumAvailableProspects: MINIMUM_AVAILABLE_PROSPECTS,
    availableProspectCount,
    shortfall: Math.max(MINIMUM_AVAILABLE_PROSPECTS - availableProspectCount, 0),
    status: availableProspectCount >= MINIMUM_AVAILABLE_PROSPECTS ? "met" : "short"
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type[]} users
 * @param {string} capability
 */
function countCapabilityAccounts(users, capability) {
  return users.reduce(
    (count, user) => count + user.accounts.filter((account) => account.capability === capability).length,
    0
  );
}

/**
 * @param {string} source
 */
function describeExecutionScope(source) {
  if (source === "company-user" || source === "company-profile") {
    return "Company";
  }

  if (source === "motion-user" || source === "motion-profile") {
    return "Motion";
  }

  return "Auto-resolved";
}

/**
 * @param {string} companyId
 * @param {string} motionId
 * @param {string} stage
 */
function buildCompanyNextCommand(companyId, motionId, stage) {
  switch (stage) {
    case "needs-company-identity":
    case "needs-company-research":
      return `exo companies research-brief ${companyId} --motion ${motionId} --json`;
    case "needs-prospect-selection":
    case "needs-cadence":
      return `exo companies cadence show ${companyId} --motion ${motionId} --json`;
    default:
      return `exo companies prospects show ${companyId} --motion ${motionId} --json`;
  }
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 */
function buildProfilePreview(profile) {
  return {
    id: profile.id,
    label: profile.label,
    browser: profile.browser,
    profileDirectory: profile.profileDirectory,
    verifiedCapabilities: profile.verifiedCapabilities
  };
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} left
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} right
 */
function compareProfilesForResolution(left, right) {
  if (left.status !== right.status) {
    return left.status === "ready" ? -1 : 1;
  }

  return left.label.localeCompare(right.label);
}
