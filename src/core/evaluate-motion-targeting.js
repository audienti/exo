// @ts-check

import { browserProfileCapabilitySchema, browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { buildMotionQueueSummary, withDerivedTargetAccountQueueState } from "../lib/motion-queue.js";
import { resolveUserConnection } from "./resolve-user-connection.js";

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
  const queue = buildMotionQueueSummary(motion, companies);
  const overallStage = deriveOverallStage(motionPreflight, companyLoop);
  const readyToTarget = overallStage === "targeting-ready";
  const readyToEngage = readyToTarget
    && browserGate.status === "ready"
    && companyLoop.every((company) => company.stage !== "targeting-ready" || company.executionIdentity.status === "pinned-ready");

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
    browserGate,
    companyLoop: {
      companyCount: companyLoop.length,
      readyCount: companyLoop.filter((company) => company.stage === "targeting-ready").length,
      items: companyLoop
    },
    queue,
    overallStage,
    readyToTarget,
    readyToEngage,
    nextActions: buildNextActions(motion, motionPreflight, browserGate, companyLoop)
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
  const trustedProfiles = profiles
    .filter((profile) => profile.status === "ready")
    .filter((profile) => profile.verifiedCapabilities.includes(capability))
    .sort(compareProfilesForResolution);
  const resolved = trustedProfiles[0] ?? null;

  if (!resolved) {
    return {
      status: "blocked",
      capability,
      blocksEngagement: true,
      message: `No trusted browser profile is verified for ${capability}. Research can continue, but browser-backed engagement cannot launch yet.`,
      resolvedProfile: null,
      trustedProfileCount: 0
    };
  }

  return {
    status: "ready",
    capability,
    blocksEngagement: true,
    message: `A trusted ${capability} browser identity is available for engagement.`,
    resolvedProfile: buildProfilePreview(resolved),
    trustedProfileCount: trustedProfiles.length
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
  const readyThroughLineCount = prospects.filter((prospect) => prospect.throughLine.status === "ready").length;
  const readyOpeningPlanCount = prospects.filter((prospect) => prospect.openingPlan.status === "ready").length;
  const readyCadenceCount = prospects.filter((prospect) => prospect.cadenceState.status === "ready").length;
  const missingEmailFallbackCount = prospects.filter(
    (prospect) => !prospect.email && (!prospect.openingPlan.fallbackChannel || prospect.openingPlan.fallbackChannel === "none")
  ).length;
  const executionIdentity = resolveCompanyExecutionIdentity(company, profiles, users, capability, browserGate.resolvedProfile);

  let stage = "targeting-ready";
  if (!company.websiteUrl || !company.linkedinCompanyUrl) {
    stage = "needs-company-identity";
  } else if (!account || account.signalMatches.length === 0) {
    stage = "needs-company-research";
  } else if (prospects.length === 0) {
    stage = "needs-prospect-selection";
  } else if (readyThroughLineCount < prospects.length) {
    stage = "needs-through-line";
  } else if (readyOpeningPlanCount < prospects.length) {
    stage = "needs-opening-plan";
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
    signalMatchCount: account?.signalMatches.length ?? 0,
    prospectCount: prospects.length,
    readyThroughLineCount,
    readyOpeningPlanCount,
    readyCadenceCount,
    missingEmailFallbackCount,
    executionIdentity,
    nextCommand: buildCompanyNextCommand(company.id, motion.id, stage)
  };
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/user.js").userSchema._type[]} users
 * @param {import("../schema/browser-profile.js").browserProfileCapabilitySchema._type} capability
 * @param {{ id: string, label: string, browser: string, profileDirectory: string, verifiedCapabilities: string[] } | null} globalResolvedProfile
 */
function resolveCompanyExecutionIdentity(company, profiles, users, capability, globalResolvedProfile) {
  const assignedUser = company.engagementUserAssignment
    ? users.find((user) => user.id === company.engagementUserAssignment.userId) ?? null
    : null;
  const assignedUserResolution = assignedUser
    ? resolveUserConnection(assignedUser, profiles, { capability }).resolved
    : null;

  if (assignedUserResolution) {
    if (assignedUserResolution.browserProfile) {
      const profile = profiles.find((candidate) => candidate.id === assignedUserResolution.browserProfile.id) ?? null;
      const trusted = Boolean(profile && profile.status === "ready" && profile.verifiedCapabilities.includes(capability));
      return {
        status: trusted ? "pinned-ready" : "pinned-untrusted",
        message: trusted
          ? `Company is pinned to user ${assignedUser.label} for ${capability} through ${profile.label}.`
          : `Company is pinned to user ${assignedUser.label}, but the resolved browser profile is not trusted for ${capability}.`,
        profile: profile ? buildProfilePreview(profile) : null,
        user: {
          id: assignedUser.id,
          label: assignedUser.label
        }
      };
    }

    return {
      status: assignedUserResolution.status === "ready" ? "pinned-ready" : "pinned-untrusted",
      message: assignedUserResolution.status === "ready"
        ? `Company is pinned to user ${assignedUser.label} for ${capability} through ${assignedUserResolution.harnessConnection.runtime}:${assignedUserResolution.harnessConnection.connector}.`
        : `Company is pinned to user ${assignedUser.label}, but the resolved harness connection is not ready for ${capability}.`,
      profile: null,
      user: {
        id: assignedUser.id,
        label: assignedUser.label
      }
    };
  }

  const assigned = company.engagementProfileAssignment
    ? profiles.find((profile) => profile.id === company.engagementProfileAssignment.profileId) ?? null
    : null;

  if (assigned) {
    const trusted = assigned.status === "ready" && assigned.verifiedCapabilities.includes(capability);
    return {
      status: trusted ? "pinned-ready" : "pinned-untrusted",
      message: trusted
        ? `Company is pinned to ${assigned.label} for ${capability}.`
        : `Company is pinned to ${assigned.label}, but that profile is not trusted for ${capability}.`,
      profile: buildProfilePreview(assigned),
      user: null
    };
  }

  if (globalResolvedProfile) {
    return {
      status: "unassigned-global-ready",
      message: `A trusted ${capability} profile exists, but it is not pinned to this company yet.`,
      profile: globalResolvedProfile,
      user: null
    };
  }

  return {
    status: "unassigned-no-global-profile",
    message: `No trusted ${capability} browser identity is available for this company yet.`,
    profile: null,
    user: null
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

  if (companyLoop.some((company) => company.stage === "needs-through-line")) {
    return "needs-through-line";
  }

  if (companyLoop.some((company) => company.stage === "needs-opening-plan")) {
    return "needs-opening-plan";
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
 */
function buildNextActions(motion, motionPreflight, browserGate, companyLoop) {
  /** @type {string[]} */
  const actions = [];

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
    actions.push("Register, claim, and test a trusted browser profile before launch. You will need it to engage, even if research can continue now.");
  }

  if (!companyLoop.length) {
    actions.push(`Link target companies to ${motion.name} before trying to build prospect plans.`);
    return actions;
  }

  for (const company of companyLoop) {
    if (company.stage === "needs-company-identity") {
      actions.push(`Complete canonical website and LinkedIn company identity for ${company.companyName}. Then run exo companies research-brief ${company.companyId} --motion ${motion.id} --json.`);
      continue;
    }

    if (company.stage === "needs-company-research") {
      actions.push(`Run the company research loop for ${company.companyName}: company site first, then Google/news, and persist only strong recent signal matches.`);
      continue;
    }

    if (company.stage === "needs-prospect-selection") {
      actions.push(`Select up to ${motion.targetingProfile.stakeholderTargetCount} best-fit prospects for ${company.companyName} and persist them before planning outreach.`);
      continue;
    }

    if (company.stage === "needs-through-line") {
      actions.push(`Complete the remaining prospect through-lines for ${company.companyName} before launch.`);
      continue;
    }

    if (company.stage === "needs-opening-plan") {
      actions.push(`Complete the remaining prospect opening plans for ${company.companyName} before launch.`);
      continue;
    }

    if (company.stage === "needs-cadence") {
      actions.push(`Complete the remaining prospect cadence state for ${company.companyName} before launch.`);
      continue;
    }

    if (company.executionIdentity.status !== "pinned-ready") {
      actions.push(`Pin a trusted ${browserGate.capability} profile to ${company.companyName} before engagement so the motion launches from one consistent identity.`);
    }

    if (company.missingEmailFallbackCount > 0) {
      actions.push(`Find verified direct-email fallbacks for ${company.companyName} where possible. LinkedIn is still the only ready channel for some chosen prospects.`);
    }
  }

  if (!actions.length) {
    actions.push("The motion is targeting-ready. Wait for operator approval, then let the agent execute the stored prospect opening plans.");
  }

  return actions;
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
      return `exo companies prospects show ${companyId} --motion ${motionId} --json`;
    case "needs-through-line":
      return `exo companies through-line show ${companyId} --motion ${motionId} --json`;
    case "needs-opening-plan":
      return `exo companies opening-plan show ${companyId} --motion ${motionId} --json`;
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
