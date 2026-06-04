// @ts-check

import { buildPlannerGuidance } from "./planner-guidance.js";

/**
 * @param {{
 *   surface: "daily" | "inbox",
 *   reason: "no_users" | "no_execution_capable_users"
 * }} input
 */
export function buildUserScopedBootstrapView(input) {
  const surfaceLabel = input.surface === "daily" ? "daily agenda" : "inbox";
  const headline = input.reason === "no_users"
    ? `Register the first execution user before using the ${surfaceLabel}.`
    : `Register a governed account before using the ${surfaceLabel}.`;
  const nextMove = input.reason === "no_users"
    ? `Inspect discovered accounts and runtime connectors, then register the first execution user before using the ${surfaceLabel}.`
    : `Map at least one governed account onto an existing execution user before using the ${surfaceLabel}.`;
  const operatorPrompt = input.reason === "no_users"
    ? "Who is the first user we're managing?"
    : "No execution-capable user exists yet. Do you want to map a live account now?";
  const why = input.reason === "no_users"
    ? `The ${surfaceLabel} is user-scoped, but no execution users exist in the current Exo state store yet.`
    : `Execution users exist, but none of them has a governed connected account path yet, so Exo cannot build the ${surfaceLabel}.`;

  return {
    source: "operator-call",
    headline,
    nextMove,
    operatorPrompt,
    why,
    status: {
      kind: "configure_execution_connectors",
      priority: "wait",
      effect: "guided",
      dueAt: null
    },
    guidance: buildPlannerGuidance("configure_execution_connectors", {
      surfaceName: surfaceLabel,
      recommendedAction: nextMove,
      whyItMatters: why
    }),
    context: {
      user: null,
      motion: null,
      company: null,
      prospect: null,
      source: {
        type: "user_scope_bootstrap",
        kind: input.reason,
        surface: input.surface
      }
    }
  };
}
