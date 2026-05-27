// @ts-check

import { motionSchema } from "../schema/motion.js";

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
        signalCount: motion.signals.length
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

  /** @type {Array<{ key: string, prompt: string, required: boolean }>} */
  const questions = [];

  if (!input.url) {
    questions.push({
      key: "url",
      prompt: "What are we promoting? Give me the offer URL first.",
      required: true
    });
  } else if (existingMotions.length > 0 && !input.existingStrategy) {
    questions.push({
      key: "existing-strategy",
      prompt: "This URL already has a motion. Do you want to continue it, clone it, or create a new one?",
      required: true
    });
  } else if (!input.premise?.statement) {
    questions.push({
      key: "premise",
      prompt: "What is the premise? In one sentence, why should this offer matter right now?",
      required: true
    });
  } else if (!input.audienceHypotheses?.length) {
    questions.push({
      key: "audience",
      prompt: "Who should care first? Name the primary audience or ICP you want to target.",
      required: true
    });
  } else if (!input.signals?.length) {
    questions.push({
      key: "signals",
      prompt: "What recent evidence would make this motion talkable? Give me the first signal question.",
      required: true
    });
  } else if (!hasRequiredTargetingSpecifics) {
    questions.push({
      key: "targeting-specifics",
      prompt: "Do you already know any titles, role families, industries, geographies, or segment specifics worth biasing the motion toward?",
      required: false
    });
  } else if (!hasSuppressionSpecifics) {
    questions.push({
      key: "suppression",
      prompt: "Are there any accounts, domains, contacts, or DNC entries we should exclude before launch?",
      required: false
    });
  }

  const readyToLaunch = Boolean(
    input.url
    && (!existingMotions.length || input.existingStrategy)
    && input.premise?.statement
    && input.audienceHypotheses?.length
    && input.signals?.length
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
