// @ts-check

import { buildInboxView } from "./build-inbox-view.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { buildPlannerGuidance } from "../lib/planner-guidance.js";
import { selectParallelSupportAction } from "./planner-support-actions.js";
import { isExecutionEligibleMotionStatus } from "../lib/motion-status.js";
import { hasUsableEmailFallback } from "../lib/prospect-contacts.js";

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 * @param {unknown[]} rawObservations
 * @param {{
 *   now?: string | null | undefined,
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined,
 *   limit?: number | null | undefined
 * }} [options]
 */
export function buildDailyView(rawUser, rawMotions, rawCompanies, rawObservations, options = {}) {
  const user = userSchema.parse(rawUser);
  const motions = rawMotions
    .map((item) => motionSchema.parse(item))
    .filter((motion) => isExecutionEligibleMotionStatus(motion.status));
  const companies = rawCompanies.map((item) => companySchema.parse(item));
  const now = options.now ?? new Date().toISOString();
  const inbox = buildInboxView(user, rawObservations, motions, companies);
  const inboxByProspectId = new Map();

  for (const item of inbox.items) {
    const prospectId = item.prospect?.id ?? null;
    if (prospectId && !inboxByProspectId.has(prospectId)) {
      inboxByProspectId.set(prospectId, item);
    }
  }

  const assignedCompanyIds = new Set(
    companies
      .filter((company) => company.engagementUserAssignment?.userId === user.id)
      .map((company) => company.id)
  );

  const items = motions
    .flatMap((motion) =>
      motion.targetMap.accounts.flatMap((account) =>
        account.prospects.map((prospect) => {
          if (!assignedCompanyIds.has(account.companyId)) {
            return null;
          }

          if (options.motionId && motion.id !== options.motionId) {
            return null;
          }

          if (options.companyId && account.companyId !== options.companyId) {
            return null;
          }

          if (options.prospectId && prospect.id !== options.prospectId) {
            return null;
          }

          if (prospect.cadenceState.status !== "ready") {
            return null;
          }

          return buildDailyItem({
            motion,
            account,
            prospect,
            motionSupportProspects: motion.targetMap.accounts.flatMap((candidateAccount) =>
              candidateAccount.prospects.map((candidateProspect) => toSupportProspect(candidateAccount, candidateProspect))
            ),
            latestInboxItem: inboxByProspectId.get(prospect.id) ?? null,
            now
          });
        })
      )
    )
    .filter(Boolean)
    .sort(compareDailyItems);

  const limitedItems = options.limit ? items.slice(0, options.limit) : items;

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    generatedAt: now,
    counts: {
      itemCount: limitedItems.length,
      replyPriorityCount: limitedItems.filter((item) => item.priority === "reply").length,
      actionPriorityCount: limitedItems.filter((item) => item.priority === "action").length,
      waitPriorityCount: limitedItems.filter((item) => item.priority === "wait").length,
      dueNowCount: limitedItems.filter((item) => item.state === "due_now").length,
      waitingCount: limitedItems.filter((item) => item.state === "waiting_until").length,
      overriddenByInboundCount: limitedItems.filter((item) => item.cadenceEffect === "overridden_by_inbound").length,
      advancedByInboundCount: limitedItems.filter((item) => item.cadenceEffect === "advanced_by_inbound").length
    },
    items: limitedItems
  };
}

/**
 * @param {{
 *   motion: import("../schema/motion.js").motionSchema._type,
 *   account: import("../schema/target-account.js").targetAccountSchema._type,
 *   prospect: import("../schema/target-account.js").prospectSchema._type,
 *   motionSupportProspects: ReturnType<typeof toSupportProspect>[],
 *   latestInboxItem: ReturnType<typeof buildInboxView>["items"][number] | null,
 *   now: string
 * }} context
 */
function buildDailyItem({ motion, account, prospect, motionSupportProspects, latestInboxItem, now }) {
  const cadence = prospect.cadenceState;
  const cadenceNotes = cadence.notes?.toLowerCase() ?? "";
  const currentSupportProspect = toSupportProspect(account, prospect);
  const guidanceContext = {
    motionId: motion.id,
    motionName: motion.name,
    companyId: account.companyId,
    companyName: account.companyName,
    prospectId: prospect.id,
    prospectName: prospect.name,
    prospectTitle: prospect.title,
    currentStep: cadence.currentStep ?? "",
    recommendedAction: cadence.nextAction ?? "",
    dueAt: cadence.nextActionDueAt ?? "",
    whyItMatters: ""
  };
  const base = {
    motion: {
      id: motion.id,
      name: motion.name
    },
    company: {
      id: account.companyId,
      name: account.companyName
    },
    prospect: {
      id: prospect.id,
      name: prospect.name,
      title: prospect.title
    },
    cadence: {
      currentStep: cadence.currentStep,
      nextAction: cadence.nextAction,
      nextActionDueAt: cadence.nextActionDueAt,
      lastTouchOutcome: cadence.lastTouchOutcome
    },
    guidance: null
  };

  if (latestInboxItem) {
    if (isReplyObservation(latestInboxItem.kind)) {
      const whyItMatters = "A live reply overtook the planned cadence branch. The next move is to respond, not to continue the old follow-up.";
      const recommendedAction = latestInboxItem.recommendedAction;
      return {
        ...base,
        state: "due_now",
        priority: "reply",
        priorityRank: 0,
        cadenceEffect: "overridden_by_inbound",
        dueAt: latestInboxItem.observedAt,
        whyItMatters,
        recommendedAction,
        guidance: buildPlannerGuidance("reply_to_inbound", {
          ...guidanceContext,
          dueAt: latestInboxItem.observedAt,
          whyItMatters,
          recommendedAction
        }),
        source: {
          type: "inbound_observation",
          id: latestInboxItem.id,
          kind: latestInboxItem.kind,
          observedAt: latestInboxItem.observedAt
        }
      };
    }

    if (latestInboxItem.kind === "connection_request_accepted") {
      const whyItMatters = "Connection acceptance unlocked the next private touch. The cadence branch should advance instead of waiting on the old step.";
      const recommendedAction = latestInboxItem.recommendedAction;
      return {
        ...base,
        state: "due_now",
        priority: "action",
        priorityRank: 1,
        cadenceEffect: "advanced_by_inbound",
        dueAt: latestInboxItem.observedAt,
        whyItMatters,
        recommendedAction,
        guidance: buildPlannerGuidance("advance_after_connection_accept", {
          ...guidanceContext,
          dueAt: latestInboxItem.observedAt,
          whyItMatters,
          recommendedAction
        }),
        source: {
          type: "inbound_observation",
          id: latestInboxItem.id,
          kind: latestInboxItem.kind,
          observedAt: latestInboxItem.observedAt
        }
      };
    }

    if (latestInboxItem.kind === "connection_request_received") {
      const whyItMatters = "An inbound connection request needs triage before the old outbound branch continues.";
      const recommendedAction = latestInboxItem.recommendedAction;
      return {
        ...base,
        state: "due_now",
        priority: "action",
        priorityRank: 1,
        cadenceEffect: "advanced_by_inbound",
        dueAt: latestInboxItem.observedAt,
        whyItMatters,
        recommendedAction,
        guidance: buildPlannerGuidance("triage_inbound_connection", {
          ...guidanceContext,
          dueAt: latestInboxItem.observedAt,
          whyItMatters,
          recommendedAction
        }),
        source: {
          type: "inbound_observation",
          id: latestInboxItem.id,
          kind: latestInboxItem.kind,
          observedAt: latestInboxItem.observedAt
        }
      };
    }
  }

  if (
    !cadence.lastTouchOutcome
    && (cadenceNotes.includes("on hold") || cadenceNotes.includes("held behind") || cadenceNotes.includes("wait for operator"))
  ) {
    const holdDueAt = cadence.nextActionDueAt ?? "9999-12-31T23:59:59.999Z";
    const whyItMatters = `${prospect.name}'s branch is explicitly being held in reserve behind a stronger primary path, so it should not surface as due work until the escalation trigger is met.`;
    const recommendedAction = cadence.nextAction ?? `Keep ${prospect.name}'s reserve branch on hold until the primary path stalls or explicitly escalates.`;
    return {
      ...base,
      state: "waiting_until",
      priority: "wait",
      priorityRank: 3,
      cadenceEffect: "waiting_on_outbound",
      dueAt: holdDueAt,
      whyItMatters,
      recommendedAction,
      guidance: buildPlannerGuidance("wait_for_response", {
        ...guidanceContext,
        dueAt: cadence.nextActionDueAt ?? "",
        whyItMatters,
        recommendedAction
      }),
      source: {
        type: "cadence",
        kind: "held_in_reserve"
      }
    };
  }

  if (
    cadence.lastTouchOutcome === "sent"
    && (!cadence.nextActionDueAt || cadence.nextActionDueAt > now)
  ) {
    const waitingWhy = cadence.currentStep === "connection-request"
      ? `${prospect.name} already has a connection request in flight, so the primary branch is waiting on an external trigger.`
      : `${prospect.name} already has an outbound branch in flight, so the primary branch is waiting on an external trigger.`;
    const waitingNextMove = cadence.currentStep === "connection-request"
      ? `Wait for ${prospect.name} to accept or reply to the connection request before escalating.`
      : `Wait on ${prospect.name}'s current outbound branch unless a stronger inbound event or due checkpoint changes the plan.`;
    const supportAction = selectParallelSupportAction(motionSupportProspects, currentSupportProspect);

    if (supportAction) {
      const supportGuidanceContext = {
        motionId: motion.id,
        motionName: motion.name,
        companyId: supportAction.company.companyId,
        companyName: supportAction.company.companyName,
        prospectId: supportAction.prospect.prospectId,
        prospectName: supportAction.prospect.name,
        prospectTitle: supportAction.prospect.title,
        currentStep: supportAction.prospect.cadenceState.currentStep ?? "",
        recommendedAction: supportAction.nextMove,
        dueAt: supportAction.dueAt ?? "",
        whyItMatters: supportAction.why
      };
      const whyItMatters = supportAction.why;
      const recommendedAction = supportAction.nextMove;
      return {
        ...base,
        company: {
          id: supportAction.company.companyId,
          name: supportAction.company.companyName
        },
        prospect: {
          id: supportAction.prospect.prospectId,
          name: supportAction.prospect.name,
          title: supportAction.prospect.title
        },
        state: "due_now",
        priority: supportAction.priority,
        priorityRank: 1,
        cadenceEffect: supportAction.effect,
        dueAt: supportAction.dueAt ?? now,
        whyItMatters,
        recommendedAction,
        guidance: buildPlannerGuidance(supportAction.guidanceKey, {
          ...supportGuidanceContext
        }),
        source: {
          type: "parallel_support_action",
          kind: supportAction.kind
        },
        waitingBranch: {
          kind: cadence.currentStep === "connection-request" ? "wait_for_connection_response" : "wait_for_response",
          nextMove: waitingNextMove,
          why: waitingWhy
        }
      };
    }

    return {
      ...base,
      state: "waiting_until",
      priority: "wait",
      priorityRank: 3,
      cadenceEffect: "waiting_on_outbound",
      dueAt: cadence.nextActionDueAt ?? now,
      whyItMatters: waitingWhy,
      recommendedAction: waitingNextMove,
      guidance: buildPlannerGuidance(
        cadence.currentStep === "connection-request" ? "wait_for_connection_response" : "wait_for_response",
        {
          ...guidanceContext,
          recommendedAction: waitingNextMove,
          dueAt: cadence.nextActionDueAt ?? "",
          whyItMatters: waitingWhy
        }
      ),
      source: {
        type: "cadence",
        kind: "waiting_on_outbound"
      }
    };
  }

  if (cadence.nextActionDueAt && cadence.nextActionDueAt > now) {
    const whyItMatters = "The planned cadence move is not due yet, and nothing stronger has overtaken it.";
    const recommendedAction = `Wait until ${cadence.nextActionDueAt} before ${cadence.nextAction ?? "the next planned move"}.`;
    const guidanceKey = inferCadenceGuidanceKey(cadence, true);
    return {
      ...base,
      state: "waiting_until",
      priority: "wait",
      priorityRank: 3,
      cadenceEffect: "none",
      dueAt: cadence.nextActionDueAt,
      whyItMatters,
      recommendedAction,
      guidance: buildPlannerGuidance(guidanceKey, {
        ...guidanceContext,
        dueAt: cadence.nextActionDueAt,
        whyItMatters,
        recommendedAction
      }),
      source: {
        type: "cadence",
        kind: "planned_next_action"
      }
    };
  }

  const whyItMatters = "The planned cadence branch is due and no stronger inbound event has displaced it.";
  const recommendedAction = cadence.nextAction ?? "Take the next planned cadence move.";
  return {
    ...base,
    state: "due_now",
    priority: "action",
    priorityRank: 1,
    cadenceEffect: "none",
    dueAt: cadence.nextActionDueAt ?? now,
    whyItMatters,
    recommendedAction,
    guidance: buildPlannerGuidance(inferCadenceGuidanceKey(cadence, false), {
      ...guidanceContext,
      dueAt: cadence.nextActionDueAt ?? now,
      whyItMatters,
      recommendedAction
    }),
    source: {
      type: "cadence",
      kind: "planned_next_action"
    }
  };
}

/**
 * @param {string} kind
 */
function isReplyObservation(kind) {
  return (
    kind === "inbound_reply_received"
    || kind === "email_reply_received"
    || kind === "message_received"
  );
}

/**
 * @param {import("../schema/target-account.js").cadenceStateSchema._type} cadence
 * @param {boolean} waiting
 */
function inferCadenceGuidanceKey(cadence, waiting) {
  if (!waiting) {
    if (!cadence.lastTouchOutcome) {
      return "execute_first_touch";
    }

    if (cadence.lastTouchOutcome === "accepted" && cadence.currentStep === "connection-request") {
      return "send_post_accept_message";
    }
  }

  if (cadence.lastTouchOutcome === "sent" && cadence.currentStep === "connection-request") {
    return "wait_for_connection_response";
  }

  if (cadence.lastTouchOutcome === "sent") {
    return "wait_for_response";
  }

  return waiting ? "wait_for_due_checkpoint" : "execute_planned_cadence";
}

/**
 * @param {ReturnType<typeof buildDailyItem>} left
 * @param {ReturnType<typeof buildDailyItem>} right
 */
function compareDailyItems(left, right) {
  return (
    left.priorityRank - right.priorityRank
    || left.dueAt.localeCompare(right.dueAt)
    || left.prospect.name.localeCompare(right.prospect.name)
  );
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function toSupportProspect(account, prospect) {
  return {
    companyId: account.companyId,
    companyName: account.companyName,
    prospectId: prospect.id,
    name: prospect.name,
    title: prospect.title,
    hasEmailFallback: hasUsableEmailFallback(prospect),
    messageTestReady: prospect.throughLine.status === "ready"
      && prospect.openingPlan.status === "ready"
      && prospect.cadenceState.status === "ready",
    notes: prospect.notes,
    contactEnrichmentState: prospect.contactEnrichmentState,
    cadenceState: prospect.cadenceState,
    openingPlan: prospect.openingPlan,
    nextAction: prospect.cadenceState.nextAction
  };
}
