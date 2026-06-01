// @ts-check

import { listBrowserProfiles } from "../db/database.js";
import { buildDailyView } from "./build-daily-view.js";
import { buildMotionReport } from "./build-motion-report.js";
import { describeExo } from "./what-is-this.js";
import { buildPlannerGuidance } from "../lib/planner-guidance.js";
import { selectParallelSupportAction } from "./planner-support-actions.js";
import { isConnectionRequestInFlight } from "../lib/cadence-helpers.js";
import { buildOperatorPromptFromDailyItem, buildOperatorPromptFromExecutionAction } from "../lib/operator-prompts.js";

/**
 * @param {{
 *   rawUser?: unknown | null | undefined,
 *   rawMotion?: unknown | null | undefined,
 *   rawMotions: unknown[],
 *   rawCompanies: unknown[],
 *   rawProfiles: unknown[],
 *   rawUsers: unknown[],
 *   rawObservations: unknown[],
 *   rawCues?: unknown[] | undefined,
 *   filters?: {
 *     motionId?: string | null | undefined,
 *     companyId?: string | null | undefined,
 *     prospectId?: string | null | undefined
 *   } | undefined
 * }} input
 */
export function buildNextView(input) {
  const description = describeExo();
  const filters = input.filters ?? {};

  if (input.rawUser) {
    const daily = buildDailyView(input.rawUser, input.rawMotions, input.rawCompanies, input.rawProfiles, input.rawObservations, {
      rawCues: input.rawCues ?? [],
      motionId: filters.motionId ?? null,
      companyId: filters.companyId ?? null,
      prospectId: filters.prospectId ?? null,
      limit: 1
    });
    const topDailyItem = daily.items[0] ?? null;

    if (topDailyItem && topDailyItem.state === "due_now") {
      const operatorPrompt = buildOperatorPromptFromDailyItem(topDailyItem);
      return {
        source: "daily",
        headline: `Next move for ${daily.user.label}`,
        nextMove: topDailyItem.recommendedAction,
        operatorPrompt,
        why: topDailyItem.whyItMatters,
        status: {
          kind: topDailyItem.state,
          priority: topDailyItem.priority,
          effect: topDailyItem.cadenceEffect,
          dueAt: topDailyItem.dueAt
        },
        guidance: topDailyItem.guidance,
        context: {
          ...(topDailyItem.context ?? {}),
          user: daily.user,
          motion: topDailyItem.motion,
          company: topDailyItem.company,
          prospect: topDailyItem.prospect,
          source: topDailyItem.source,
          waitingBranch: topDailyItem.waitingBranch ?? null
        }
      };
    }
  }

  if (input.rawMotion) {
    const report = buildMotionReport(
      input.rawMotion,
      input.rawCompanies,
      listBrowserProfiles(),
      input.rawUsers
    );
    const executionNext = report.targeting.readyToEngage
      ? selectExecutionNext(report.prospects.prospects)
      : null;

    if (executionNext) {
      const supportAction = executionNext.priority === "wait"
        ? selectParallelSupportAction(report.prospects.prospects, executionNext.prospect)
        : null;
      const selectedAction = supportAction ?? executionNext;
      const guidance = buildPlannerGuidance(selectedAction.guidanceKey, {
        motionId: report.motion.id,
        motionName: report.motion.name,
        companyId: selectedAction.company.companyId,
        companyName: selectedAction.company.companyName,
        prospectId: selectedAction.prospect.prospectId,
        prospectName: selectedAction.prospect.name,
        prospectTitle: selectedAction.prospect.title,
        currentStep: selectedAction.prospect.cadenceState.currentStep ?? "",
        recommendedAction: selectedAction.nextMove,
        dueAt: selectedAction.dueAt ?? "",
        whyItMatters: selectedAction.why
      });
      return {
        source: "motion",
        headline: `Next move for ${report.motion.name}`,
        nextMove: selectedAction.nextMove,
        operatorPrompt: buildOperatorPromptFromExecutionAction(selectedAction),
        why: selectedAction.why,
        status: {
          kind: report.targeting.overallStage,
          priority: selectedAction.priority,
          effect: selectedAction.effect,
          dueAt: selectedAction.dueAt
        },
        guidance,
        context: {
          user: null,
          motion: {
            id: report.motion.id,
            name: report.motion.name
          },
          company: {
            id: selectedAction.company.companyId,
            name: selectedAction.company.companyName
          },
          prospect: {
            id: selectedAction.prospect.prospectId,
            name: selectedAction.prospect.name,
            title: selectedAction.prospect.title
          },
          source: {
            type: supportAction ? "parallel_support_action" : "prospect_execution_branch",
            kind: selectedAction.kind
          },
          waitingBranch: supportAction ? {
            kind: executionNext.kind,
            nextMove: executionNext.nextMove,
            why: executionNext.why,
            prospect: {
              id: executionNext.prospect.prospectId,
              name: executionNext.prospect.name,
              title: executionNext.prospect.title
            },
            company: {
              id: executionNext.company.companyId,
              name: executionNext.company.companyName
            }
          } : null
        }
      };
    }

    return {
      source: "motion",
      headline: `Next move for ${report.motion.name}`,
      nextMove: selectMotionNextMove(report),
      operatorPrompt: null,
      why: summarizeMotionWhy(report),
      status: {
        kind: report.targeting.overallStage,
        priority: "action",
        effect: report.targeting.readyToEngage ? "ready_to_engage" : report.targeting.readyToTarget ? "ready_to_target" : "blocked",
        dueAt: null
      },
      guidance: buildPlannerGuidance(motionGuidanceKey(report.targeting.overallStage), {
        motionId: report.motion.id,
        motionName: report.motion.name,
        recommendedAction: selectMotionNextMove(report),
        whyItMatters: summarizeMotionWhy(report)
      }),
      context: {
        user: null,
        motion: {
          id: report.motion.id,
          name: report.motion.name
        },
        company: null,
        prospect: null,
        source: {
          type: "motion_report",
          kind: report.targeting.overallStage
        }
      }
    };
  }

  return {
    source: "operator-call",
    headline: description.operatorInterface.currentCall.headline,
    nextMove: description.operatorInterface.currentCall.nextMove,
    operatorPrompt: description.operatorInterface.currentCall.operatorPrompt ?? null,
    why: description.agentUsage.recommendedPath.reason,
    status: {
      kind: description.agentUsage.recommendedPath.mode,
      priority: description.agentUsage.recommendedPath.blockers.length ? "action" : "wait",
      effect: description.agentUsage.recommendedPath.blockers.length ? "blocked" : "guided",
      dueAt: null
    },
    guidance: buildPlannerGuidance("reinitialize_context", {
      motionName: description.agentUsage.recommendedPath.focusMotionName ?? "",
      recommendedAction: description.operatorInterface.currentCall.nextMove,
      whyItMatters: description.agentUsage.recommendedPath.reason
    }),
    context: {
      user: null,
      motion: description.agentUsage.recommendedPath.focusMotionId
        ? {
            id: description.agentUsage.recommendedPath.focusMotionId,
            name: description.agentUsage.recommendedPath.focusMotionName
          }
        : null,
      company: null,
      prospect: null,
      source: {
        type: "operator_interface",
        kind: description.agentUsage.recommendedPath.mode
      }
    }
  };
}

/**
 * @param {ReturnType<typeof buildMotionReport>} report
 */
function summarizeMotionWhy(report) {
  if (report.targeting.readyToEngage) {
    return "The motion is structurally ready to engage, so the next move should come from its highest-priority governed action branch.";
  }

  if (report.targeting.readyToTarget) {
    return "The motion is structurally ready to target, but it still has an execution gate before live engagement should start.";
  }

  return `The motion is still in ${report.targeting.overallStage}, so the next move should clear the top blocker rather than forcing execution.`;
}

/**
 * @param {ReturnType<typeof buildMotionReport>} report
 */
function selectMotionNextMove(report) {
  const actions = report.targeting.nextActions;
  if (!actions.length) {
    return "Continue the motion using the highest-priority governed next action.";
  }

  if (
    report.targeting.overallStage === "needs-company-targeting"
    || report.targeting.overallStage === "needs-company-research"
    || report.targeting.overallStage === "needs-prospect-selection"
    || report.targeting.overallStage === "needs-through-line"
    || report.targeting.overallStage === "needs-opening-plan"
    || report.targeting.overallStage === "needs-cadence"
  ) {
    return actions.find((action) => !/trusted browser profile|email fallback/i.test(action)) ?? actions[0];
  }

  return actions[0];
}

/**
 * @param {string} stage
 */
function motionGuidanceKey(stage) {
  if (
    stage === "needs-company-targeting"
    || stage === "needs-company-research"
    || stage === "needs-prospect-selection"
    || stage === "needs-through-line"
    || stage === "needs-opening-plan"
    || stage === "needs-cadence"
  ) {
    return "clear_motion_blocker";
  }

  return "reinitialize_context";
}

/**
 * @param {ReturnType<typeof buildMotionReport>["prospects"]["prospects"]} prospects
 */
function selectExecutionNext(prospects) {
  for (const prospect of prospects) {
    const cadence = prospect.cadenceState;
    const lastOutcome = cadence.lastTouchOutcome;
    const step = cadence.currentStep;
    const notes = cadence.notes?.toLowerCase() ?? "";

    if (
      !lastOutcome
      && (notes.includes("on hold") || notes.includes("held behind") || notes.includes("wait for operator"))
    ) {
      continue;
    }

    if (!lastOutcome) {
      return {
        kind: "first_touch",
        guidanceKey: "execute_first_touch",
        priority: "action",
        effect: "ready_to_engage",
        dueAt: cadence.nextActionDueAt ?? null,
        nextMove: prospect.nextAction ?? prospect.openingPlan.firstMove ?? `Execute the first planned touch for ${prospect.name}.`,
        why: `The motion is already engagement-ready, and ${prospect.name} is the strongest ready prospect branch that has not been worked yet.`,
        company: prospect,
        prospect
      };
    }

    if (isConnectionRequestInFlight(cadence)) {
      return {
        kind: "wait_for_connection_response",
        guidanceKey: "wait_for_connection_response",
        priority: "wait",
        effect: "waiting_on_outbound",
        dueAt: cadence.nextActionDueAt ?? null,
        nextMove: `Wait for ${prospect.name} to accept or reply to the connection request before escalating. Keep the fallback path ready, but do not treat it as the primary move yet.`,
        why: `${prospect.name} already has the primary touch in flight. The right next move is to hold the branch and watch for acceptance or inbound, not to jump straight to fallback-channel work.`,
        company: prospect,
        prospect
      };
    }

    if (lastOutcome === "accepted" && step === "connection-request") {
      return {
        kind: "post_accept_message",
        guidanceKey: "send_post_accept_message",
        priority: "action",
        effect: "advanced_by_outcome",
        dueAt: cadence.nextActionDueAt ?? null,
        nextMove: `Send the first post-accept direct message to ${prospect.name}.`,
        why: `${prospect.name} accepted the connection path, so the branch should advance into the first private message.`,
        company: prospect,
        prospect
      };
    }

    if (lastOutcome === "sent") {
      return {
        kind: "wait_for_response",
        guidanceKey: "wait_for_response",
        priority: "wait",
        effect: "waiting_on_outbound",
        dueAt: cadence.nextActionDueAt ?? null,
        nextMove: `Wait on ${prospect.name}'s current outbound branch unless a stronger inbound event or due checkpoint changes the plan.`,
        why: `${prospect.name} already has an outbound branch in flight. Exo should not replace that with generic setup work unless the branch actually stalls or a checkpoint becomes due.`,
        company: prospect,
        prospect
      };
    }
  }

  return null;
}
