#!/usr/bin/env node
// @ts-check

import {
  applyInstallScope,
  buildOnboardingState,
  completeOnboardingUser,
} from "../../core/onboarding.js";

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
`
    )
    .action((options) => {
      if (!options.apply) {
        const state = buildOnboardingState({ preferredUserId: options.user ?? null });
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

      const state = buildOnboardingState({
        preferredUserId: applied.user?.user?.id ?? options.user ?? null,
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
  if (state.next.commands.length) {
    lines.push("Commands:");
    for (const command of state.next.commands) {
      lines.push(`  - ${command}`);
    }
  }

  return lines.join("\n");
}
