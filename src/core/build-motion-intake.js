// @ts-check

import { motionSchema } from "../schema/motion.js";

export const MOTION_INTAKE_PROMPTS = {
  url: "What are we promoting? Give me the offer URL first.",
  existingStrategy: "This URL already has a motion. Do you want to continue it, clone it, or create a new one?",
  sourceMotion: "More than one motion already uses this URL. Which one are we continuing or cloning?",
  premise: "What is the premise? In one sentence, why should this offer matter right now?",
  audience: "Who should care first? Name the primary audience or ICP you want to target.",
  signals: "What recent evidence would make this motion talkable? Add one or more signal questions.",
  launchUser: "Who should own launch for this motion? Pick the execution user before it can go live.",
  targetingSpecifics: "Do you already know any titles, role families, industries, geographies, or segment specifics worth biasing the motion toward?",
  suppression: "Are there any accounts, domains, contacts, or DNC entries we should exclude before launch?",
};

/**
 * @param {{
 *   url?: string | null,
 *   premise?: { statement?: string | null, notes?: string | null, source?: "operator" | "inferred" | "mixed" } | null,
 *   audienceHypotheses?: Array<unknown>,
 *   signals?: Array<unknown>,
 *   targetingProfile?: {
 *     geolocations?: string[],
 *     icpTypes?: string[],
 *     industries?: string[],
 *     companyTypes?: string[],
 *     companyShapes?: string[],
 *     companySizes?: string[],
 *     targetTitles?: string[],
 *     roleFamilies?: string[],
 *     segmentVariants?: string[],
 *     stakeholderTargetCount?: number | string | null | undefined
 *   } | null,
 *   suppressionPolicy?: {
 *     excludedAccounts?: string[],
 *     excludedDomains?: string[],
 *     excludedContacts?: string[],
 *     doNotContactEntries?: string[]
 *   } | null,
 *   launchUserId?: string | null | undefined,
 *   existingStrategy?: "continue" | "clone" | "new" | null | undefined,
 *   sourceMotionId?: string | null | undefined
 * }} input
 * @param {unknown[]} storedMotions
 */
export function buildMotionIntake(input, storedMotions) {
  const existingMotions = input.url
    ? storedMotions
      .map((motion) => motionSchema.parse(motion))
      .filter((motion) => motion.offer.sourceUrl === input.url)
      .map((motion) => ({
        id: motion.id,
        name: motion.name,
        status: motion.status,
        premiseStatus: motion.premise.status,
        audienceCount: motion.audienceHypotheses.length,
        signalCount: motion.signals.length,
        assignedUserId: motion.engagementUserAssignment?.userId ?? null,
        assignedUserLabel: motion.engagementUserAssignment?.label ?? null,
      }))
    : [];

  const hasRequiredTargetingSpecifics = Boolean(
    input.targetingProfile?.targetTitles?.length
    || input.targetingProfile?.roleFamilies?.length
    || input.targetingProfile?.industries?.length
    || input.targetingProfile?.geolocations?.length
    || input.targetingProfile?.segmentVariants?.length
  );
  const hasSuppressionSpecifics = Boolean(
    input.suppressionPolicy?.excludedAccounts?.length
    || input.suppressionPolicy?.excludedDomains?.length
    || input.suppressionPolicy?.excludedContacts?.length
    || input.suppressionPolicy?.doNotContactEntries?.length
  );
  const reuseStrategy = input.existingStrategy === "continue" || input.existingStrategy === "clone";
  const requiresSourceMotion = existingMotions.length > 1 && reuseStrategy && !input.sourceMotionId;
  const requiresFreshDefinition = existingMotions.length === 0 || input.existingStrategy === "new";
  const selectedExistingMotion = resolveSelectedExistingMotion(existingMotions, input.existingStrategy, input.sourceMotionId);
  const requiresLaunchUser = requiresFreshDefinition
    || input.existingStrategy === "clone"
    || (input.existingStrategy === "continue" && !selectedExistingMotion?.assignedUserId);

  /** @type {Array<{ key: string, prompt: string, required: boolean }>} */
  const questions = [];

  if (!input.url) {
    questions.push({
      key: "url",
      prompt: MOTION_INTAKE_PROMPTS.url,
      required: true
    });
  } else if (existingMotions.length > 0 && !input.existingStrategy) {
    questions.push({
      key: "existing-strategy",
      prompt: MOTION_INTAKE_PROMPTS.existingStrategy,
      required: true
    });
  } else if (requiresSourceMotion) {
    questions.push({
      key: "source-motion",
      prompt: MOTION_INTAKE_PROMPTS.sourceMotion,
      required: true,
    });
  } else if (requiresFreshDefinition && !input.premise?.statement) {
    questions.push({
      key: "premise",
      prompt: MOTION_INTAKE_PROMPTS.premise,
      required: true
    });
  } else if (requiresFreshDefinition && !input.audienceHypotheses?.length) {
    questions.push({
      key: "audience",
      prompt: MOTION_INTAKE_PROMPTS.audience,
      required: true
    });
  } else if (requiresFreshDefinition && !input.signals?.length) {
    questions.push({
      key: "signals",
      prompt: MOTION_INTAKE_PROMPTS.signals,
      required: true
    });
  } else if (requiresLaunchUser && !input.launchUserId) {
    questions.push({
      key: "launch-user",
      prompt: MOTION_INTAKE_PROMPTS.launchUser,
      required: true
    });
  } else if (requiresFreshDefinition && !hasRequiredTargetingSpecifics) {
    questions.push({
      key: "targeting-specifics",
      prompt: MOTION_INTAKE_PROMPTS.targetingSpecifics,
      required: false
    });
  } else if (requiresFreshDefinition && !hasSuppressionSpecifics) {
    questions.push({
      key: "suppression",
      prompt: MOTION_INTAKE_PROMPTS.suppression,
      required: false
    });
  }

  const readyToLaunch = Boolean(
    input.url
    && (
      reuseStrategy
        ? (!requiresSourceMotion && (!requiresLaunchUser || input.launchUserId))
        : (
          input.premise?.statement
          && input.audienceHypotheses?.length
          && input.signals?.length
          && (!requiresLaunchUser || input.launchUserId)
        )
    )
  );

  return {
    status: readyToLaunch ? "ready-to-launch" : questions.length ? "needs-question" : "needs-review",
    readyToLaunch,
    nextQuestion: questions[0] ?? null,
    remainingQuestions: questions,
    existingMotions,
    knownSpecifics: {
      url: input.url ?? null,
      premiseDefined: Boolean(input.premise?.statement),
      audienceCount: input.audienceHypotheses?.length ?? 0,
      signalCount: input.signals?.length ?? 0,
      launchUserAssigned: Boolean(input.launchUserId),
      targetingSpecificCount: countTargetingSpecifics(input.targetingProfile ?? null),
      suppressionSpecificCount: countSuppressionSpecifics(input.suppressionPolicy ?? null)
    },
    launchCommandHint: readyToLaunch
      ? buildLaunchCommandHint(input)
      : null
  };
}

/**
 * @param {NonNullable<Parameters<typeof buildMotionIntake>[0]["targetingProfile"]>} targetingProfile
 */
function countTargetingSpecifics(targetingProfile) {
  if (!targetingProfile) {
    return 0;
  }

  return [
    ...(targetingProfile.geolocations ?? []),
    ...(targetingProfile.icpTypes ?? []),
    ...(targetingProfile.industries ?? []),
    ...(targetingProfile.companyTypes ?? []),
    ...(targetingProfile.companyShapes ?? []),
    ...(targetingProfile.companySizes ?? []),
    ...(targetingProfile.targetTitles ?? []),
    ...(targetingProfile.roleFamilies ?? []),
    ...(targetingProfile.segmentVariants ?? [])
  ].length;
}

/**
 * @param {NonNullable<Parameters<typeof buildMotionIntake>[0]["suppressionPolicy"]>} suppressionPolicy
 */
function countSuppressionSpecifics(suppressionPolicy) {
  if (!suppressionPolicy) {
    return 0;
  }

  return [
    ...(suppressionPolicy.excludedAccounts ?? []),
    ...(suppressionPolicy.excludedDomains ?? []),
    ...(suppressionPolicy.excludedContacts ?? []),
    ...(suppressionPolicy.doNotContactEntries ?? [])
  ].length;
}

/**
 * @param {Parameters<typeof buildMotionIntake>[0]} input
 */
function buildLaunchCommandHint(input) {
  const parts = [
    "exo motion start",
    `--url ${shellQuote(input.url ?? "")}`
  ];

  if (input.existingStrategy) {
    parts.push(`--existing ${input.existingStrategy}`);
  }

  if (input.sourceMotionId) {
    parts.push(`--from ${shellQuote(input.sourceMotionId)}`);
  }

  if (input.launchUserId) {
    parts.push(`--user ${shellQuote(input.launchUserId)}`);
  }

  if (input.premise?.statement) {
    parts.push(`--premise ${shellQuote(input.premise.statement)}`);
  }

  parts.push("--json");
  return parts.join(" ");
}

/**
 * @param {string} value
 */
function shellQuote(value) {
  return JSON.stringify(value);
}

/**
 * @param {Array<{ id: string, assignedUserId: string | null }>} existingMotions
 * @param {"continue" | "clone" | "new" | null | undefined} existingStrategy
 * @param {string | null | undefined} sourceMotionId
 */
function resolveSelectedExistingMotion(existingMotions, existingStrategy, sourceMotionId) {
  if (existingStrategy !== "continue" && existingStrategy !== "clone") {
    return null;
  }

  if (sourceMotionId) {
    return existingMotions.find((motion) => motion.id === sourceMotionId) ?? null;
  }

  return existingMotions.length === 1 ? existingMotions[0] : null;
}
