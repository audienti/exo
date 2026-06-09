// @ts-check

import { buildMotionIntake, MOTION_INTAKE_DEFINITIONS } from "./build-motion-intake.js";
import { buildOnboardingState } from "./onboarding.js";

/**
 * @param {{
 *   message?: string | null | undefined,
 *   rawUsers?: unknown[] | undefined,
 *   rawProfiles?: unknown[] | undefined,
 *   rawMotions?: unknown[] | undefined,
 *   rawCompanies?: unknown[] | undefined,
 *   preferredUserId?: string | null | undefined,
 * }} [input]
 * @param {{ cwd?: string | null | undefined, env?: NodeJS.ProcessEnv | null | undefined }} [options]
 */
export function buildSetupIntake(input = {}, options = {}) {
  const message = normalizeOptionalString(input.message) ?? "";
  const onboarding = buildOnboardingState({
    rawUsers: input.rawUsers,
    rawProfiles: input.rawProfiles,
    rawMotions: input.rawMotions,
    rawCompanies: input.rawCompanies,
    preferredUserId: input.preferredUserId ?? null,
  }, options);
  const detectedIntent = detectSetupIntent(message, onboarding.status);
  const extractedUserLabel = extractUserLabel(message);
  const extractedMotionUrl = extractFirstUrl(message);

  if (detectedIntent.kind === "new-user") {
    const onboardingRoute = onboarding.status === "needs-user" ? "onboarding-user" : "add-user";
    return {
      status: extractedUserLabel ? "ready-to-apply" : "needs-question",
      route: onboardingRoute,
      detectedIntent,
      nextQuestion: extractedUserLabel
        ? null
        : {
            key: "user-label",
            prompt: onboarding.status === "needs-user"
              ? onboarding.user.nextQuestion?.prompt ?? "Who is the first user we're managing in Exo?"
              : "Who is the new user we should add to this workspace?",
          },
      definitions: [],
      extracted: {
        userLabel: extractedUserLabel,
        url: null,
      },
      applyCommandHint: extractedUserLabel
        ? onboarding.status === "needs-user"
          ? `exo onboarding --label ${shellQuote(extractedUserLabel)} --apply --json`
          : `exo users add --label ${shellQuote(extractedUserLabel)} --json`
        : null,
      onboarding,
      suggestedCommands: onboarding.status === "needs-user"
        ? ["exo onboarding --json", "exo onboarding --label operator-main --apply --json"]
        : ["exo users add --label operator-main --json", "exo users list --json"],
    };
  }

  if (onboarding.status === "needs-scope") {
    return {
      status: "needs-question",
      route: "onboarding-scope",
      detectedIntent,
      nextQuestion: {
        key: "install-scope",
        prompt: onboarding.install.question?.prompt ?? onboarding.next.prompt,
      },
      definitions: [],
      extracted: {
        userLabel: null,
        url: extractedMotionUrl,
      },
      applyCommandHint: null,
      onboarding,
      suggestedCommands: onboarding.next.commands,
    };
  }

  if (onboarding.status === "needs-user") {
    return {
      status: "needs-question",
      route: "onboarding-user",
      detectedIntent,
      nextQuestion: onboarding.user.nextQuestion,
      definitions: [],
      extracted: {
        userLabel: extractedUserLabel,
        url: extractedMotionUrl,
      },
      applyCommandHint: extractedUserLabel
        ? `exo onboarding --label ${shellQuote(extractedUserLabel)} --apply --json`
        : null,
      onboarding,
      suggestedCommands: onboarding.next.commands,
    };
  }

  if (onboarding.status === "needs-account-mapping") {
    return {
      status: "needs-question",
      route: "onboarding-account",
      detectedIntent,
      nextQuestion: {
        key: "managed-account",
        prompt: onboarding.next.prompt,
      },
      definitions: [],
      extracted: {
        userLabel: extractedUserLabel,
        url: extractedMotionUrl,
      },
      applyCommandHint: null,
      onboarding,
      suggestedCommands: onboarding.next.commands,
    };
  }

  if (detectedIntent.kind === "new-motion" || onboarding.status === "needs-motion") {
    const motionIntake = buildMotionIntake(
      {
        url: extractedMotionUrl,
        launchUserId: onboarding.motion.launchUserId,
        targetingProfile: {},
        suppressionPolicy: {},
      },
      input.rawMotions ?? [],
    );

    return {
      status: motionIntake.readyToLaunch ? "ready-to-apply" : motionIntake.status,
      route: "onboarding-motion",
      detectedIntent,
      nextQuestion: motionIntake.nextQuestion,
      definitions: MOTION_INTAKE_DEFINITIONS,
      extracted: {
        userLabel: extractedUserLabel,
        url: extractedMotionUrl,
      },
      applyCommandHint: motionIntake.readyToLaunch && onboarding.motion.launchUserId
        ? buildOnboardingMotionApplyHint({
            userId: onboarding.motion.launchUserId,
            url: extractedMotionUrl,
          })
        : null,
      onboarding,
      suggestedCommands: onboarding.next.commands,
    };
  }

  return {
    status: "configured",
    route: "continue-motion",
    detectedIntent,
    nextQuestion: null,
    definitions: [],
    extracted: {
      userLabel: extractedUserLabel,
      url: extractedMotionUrl,
    },
    applyCommandHint: null,
    onboarding,
    suggestedCommands: ["exo next --json", "exo ui"],
  };
}

/**
 * @param {{ userId: string, url: string | null }} input
 */
function buildOnboardingMotionApplyHint(input) {
  if (!input.url) {
    return null;
  }
  return `exo onboarding --user ${shellQuote(input.userId)} --url ${shellQuote(input.url)} --apply --json`;
}

/**
 * @param {string} message
 * @param {string} onboardingStatus
 */
function detectSetupIntent(message, onboardingStatus) {
  const normalized = message.toLowerCase();
  const hasUrl = Boolean(extractFirstUrl(message));
  if (/\b(add|new|another|second)\s+user\b/.test(normalized) || /\buser named\b/.test(normalized)) {
    return { kind: "new-user", source: "chat-message" };
  }
  if (hasUrl || /\b(new|first|another)\s+motion\b/.test(normalized) || /\b(premise|signals?|offer|audience)\b/.test(normalized)) {
    return { kind: "new-motion", source: "chat-message" };
  }
  if (onboardingStatus === "needs-motion") {
    return { kind: "new-motion", source: "onboarding-state" };
  }
  return { kind: "unknown", source: "fallback" };
}

/**
 * @param {string} message
 */
function extractFirstUrl(message) {
  const match = message.match(/(?:https?:\/\/\S+|data:[^\s]+)/i);
  return match ? match[0].replace(/[),.;]+$/, "") : null;
}

/**
 * @param {string} message
 */
function extractUserLabel(message) {
  const match = message.match(/\b(?:user named|named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/);
  return match ? match[1].trim() : null;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeOptionalString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string} value
 */
function shellQuote(value) {
  return JSON.stringify(value);
}
