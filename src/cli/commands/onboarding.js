#!/usr/bin/env node
// @ts-check

import {
  applyInstallScope,
  buildOnboardingState,
  completeOnboardingUser,
} from "../../core/onboarding.js";
import { startMotionFromIntakeAction } from "../../core/start-motion-from-intake.js";

/**
 * @param {import("commander").Command} program
 */
export function registerOnboarding(program) {
  program
    .command("onboarding")
    .description("Inspect or apply the first-run onboarding flow for local-folder versus global-install setup.")
    .option("--scope <scope>", "local-folder | global-install")
    .option("--label <label>", "Initial execution-user label such as william-main")
    .option("--owner <owner>", "Owner label such as operator")
    .option("--user <user-id>", "Existing execution user to continue onboarding for")
    .option("--runtime <runtime>", "Runtime to use for managed-account mapping (default codex)")
    .option("--url <url>", "Offer URL for the first motion")
    .option("--premise <premise>", "One-sentence reason the first offer matters now")
    .option("--audience <audience>", "Primary audience or ICP for the first motion")
    .option("--signal <signal>", "Signal question for the first motion; repeat or use newlines for more")
    .option("--apply", "Persist the chosen scope and/or user bootstrap step")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Examples:
  exo onboarding --json
  exo onboarding --scope local-folder --apply --json
  exo onboarding --scope global-install --label william-main --apply --json
  exo onboarding --user <user-id> --runtime codex --apply --json
  exo onboarding --user <user-id> --url https://example.com/product --premise "This offer matters when ..." --audience "Primary ICP" --signal "company::Is there recent evidence that ...?" --apply --json
`
    )
    .action(async (options) => {
      const motionInput = buildMotionInput(options);
      if (!options.apply) {
        const state = buildOnboardingState({
          preferredUserId: options.user ?? null,
          motionInput,
        });
        if (options.json) {
          console.log(JSON.stringify(state, null, 2));
          return;
        }

        console.log(renderOnboardingState(state));
        return;
      }

      /** @type {Record<string, any>} */
      const applied = {};
      if (options.scope) {
        applied.install = applyInstallScope({ scope: options.scope });
      }
      if (options.label || options.user) {
        applied.user = completeOnboardingUser({
          userId: options.user ?? null,
          label: options.label ?? null,
          owner: options.owner ?? null,
          runtime: options.runtime ?? "codex",
        });
      }

      const preferredUserId = applied.user?.user?.id ?? options.user ?? null;
      if (motionInput) {
        const stateBeforeMotion = buildOnboardingState({
          preferredUserId,
          motionInput,
        });
        const motionUserId = preferredUserId ?? stateBeforeMotion.user.focusUser?.id ?? null;
        if (motionUserId && (stateBeforeMotion.status === "needs-motion" || stateBeforeMotion.status === "ready")) {
          applied.motion = await startMotionFromIntakeAction({
            userId: motionUserId,
            url: motionInput.url ?? null,
            premise: motionInput.premise?.statement ?? null,
            audience: motionInput.audienceHypotheses?.[0] ?? null,
            signal: Array.isArray(motionInput.signals) ? motionInput.signals.join("\n") : null,
            kickoffAgentPass: true,
            sendMode: "verify",
            redirectTo: "/operator",
          });
        }
      }

      const state = buildOnboardingState({
        preferredUserId,
        motionInput,
      });
      const result = {
        ok: true,
        applied,
        onboarding: state,
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderOnboardingState(state));
      if (applied.user?.message) {
        console.log("");
        console.log(applied.user.message);
      }
    });
}

/**
 * @param {ReturnType<typeof buildOnboardingState>} state
 */
function renderOnboardingState(state) {
  const lines = [
    `Onboarding: ${state.status}`,
    `Next: ${state.next.headline}`,
    `Prompt: ${state.next.prompt}`,
    `Install scope: ${state.install.choice ?? "unconfigured"} (${state.install.source})`,
    `Local state: ${state.install.localStateDir}`,
    `Home state: ${state.install.homeStateDir}`,
  ];

  if (state.user.focusUser) {
    lines.push(`Focus user: ${state.user.focusUser.label} (${state.user.focusUser.accountCount} accounts)`);
  }
  if (state.install.question) {
    lines.push(`Options: ${state.install.question.options.map((option) => option.value).join(", ")}`);
  }
  if (state.user.nextQuestion?.prompt) {
    lines.push(`User question: ${state.user.nextQuestion.prompt}`);
  }
  if (state.motion?.intake?.nextQuestion?.prompt) {
    lines.push(`Motion question: ${state.motion.intake.nextQuestion.prompt}`);
  }
  if (state.next.commands.length) {
    lines.push("Commands:");
    for (const command of state.next.commands) {
      lines.push(`  - ${command}`);
    }
  }

  return lines.join("\n");
}

/**
 * @param {Record<string, any>} options
 */
function buildMotionInput(options) {
  const url = normalizeOptionalString(options.url);
  const premise = normalizeOptionalString(options.premise);
  const audience = normalizeOptionalString(options.audience);
  const signal = normalizeOptionalString(options.signal);
  if (!url && !premise && !audience && !signal) {
    return null;
  }

  return {
    url,
    premise: premise ? { statement: premise, source: "operator" } : null,
    audienceHypotheses: audience ? [audience] : [],
    signals: signal
      ? signal
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean)
      : [],
    targetingProfile: {},
    suppressionPolicy: {},
  };
}

/**
 * @param {string | null | undefined} value
 */
function normalizeOptionalString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}
