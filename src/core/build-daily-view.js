// @ts-check

import { buildInboxView } from "./build-inbox-view.js";
import { buildInboundReviewView } from "./build-inbound-review-view.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { buildPlannerGuidance } from "../lib/planner-guidance.js";
import { selectParallelSupportAction } from "./planner-support-actions.js";
import { isPlannerEligibleMotionStatus } from "../lib/motion-status.js";
import { hasUsableEmailFallback } from "../lib/prospect-contacts.js";
import {
  isConnectionRequestInFlight,
  summarizeObservedConnectionRequestState,
} from "../lib/cadence-helpers.js";
import { buildPacketReviewView } from "./build-packet-review-view.js";
import { buildOutboundCapacityView } from "./build-outbound-capacity-view.js";
import { buildMotionCompanyScopeKey, buildUserAssignedExecutionScopeIndex } from "./user-execution-scope.js";
import { isAutonomousSendReadyDraft } from "../lib/draft-policy.js";

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 * @param {unknown[]} rawProfiles
 * @param {unknown[]} rawObservations
 * @param {{
 *   now?: string | null | undefined,
 *   rawCues?: unknown[] | undefined,
 *   rawUsers?: unknown[] | undefined,
 *   inbox?: ReturnType<typeof buildInboxView> | undefined,
 *   inboundReview?: ReturnType<typeof buildInboundReviewView> | undefined,
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined,
 *   capacityAccounts?: Array<{ motion: any, account: any }> | undefined,
 *   prospectBranches?: Array<{ motion: any, account: any, prospect: any }> | undefined,
 *   limit?: number | null | undefined
 * }} [options]
 */
export function buildDailyView(rawUser, rawMotions, rawCompanies, rawProfiles, rawObservations, options = {}) {
  const user = userSchema.parse(rawUser);
  const motions = rawMotions
    .map((item) => motionSchema.parse(item))
    .filter((motion) => isPlannerEligibleMotionStatus(motion.status));
  const companies = rawCompanies.map((item) => companySchema.parse(item));
  const profiles = rawProfiles;
  const allUsers = (options.rawUsers ?? [rawUser]).map((item) => userSchema.parse(item));
  const now = options.now ?? new Date().toISOString();
  const inbox = options.inbox ?? buildInboxView(user, rawObservations, motions, companies);
  const inboundReview = options.inboundReview ?? buildInboundReviewView(user, rawObservations, motions, companies, {
    motionId: options.motionId ?? null,
    companyId: options.companyId ?? null,
    prospectId: options.prospectId ?? null
  });
  const inboxByProspectId = new Map();
  const inboxItemsByProspectId = new Map();

  for (const item of inbox.items) {
    const prospectId = item.prospect?.id ?? null;
    if (!prospectId) {
      continue;
    }
    const items = inboxItemsByProspectId.get(prospectId) ?? [];
    items.push(item);
    inboxItemsByProspectId.set(prospectId, items);
    if (!inboxByProspectId.has(prospectId)) {
      inboxByProspectId.set(prospectId, item);
    }
  }

  const { assignedExecutionScopeKeys } = buildUserAssignedExecutionScopeIndex(user, motions, companies, {
    users: allUsers,
    profiles,
    motionId: options.motionId ?? null,
    companyId: options.companyId ?? null
  });
  const outboundCapacity = buildOutboundCapacityView(user, motions, companies, rawProfiles, {
    now,
    rawUsers: allUsers,
    motionId: options.motionId ?? null,
    companyId: options.companyId ?? null,
    prospectId: options.prospectId ?? null,
    rawObservations,
    capacityAccounts: options.capacityAccounts
  });
  const packetReview = buildPacketReviewView(motions, companies, {
    now,
    motionId: options.motionId ?? null,
    companyId: options.companyId ?? null,
    prospectId: options.prospectId ?? null
  });
  const prospectBranches = Array.isArray(options.prospectBranches)
    ? normalizeProspectBranches(options.prospectBranches, {
        motionId: options.motionId ?? null,
        companyId: options.companyId ?? null,
        prospectId: options.prospectId ?? null,
        assignedExecutionScopeKeys,
      })
    : buildProspectBranchesFromMotions(motions, {
        motionId: options.motionId ?? null,
        companyId: options.companyId ?? null,
        prospectId: options.prospectId ?? null,
        assignedExecutionScopeKeys,
      });
  const supportProspectsByMotionId = buildSupportProspectsByMotionId(prospectBranches);
  const items = dedupeDailyItems([
    ...buildPacketReviewPlannerItems(packetReview),
    buildOutboundCapacityPlannerItem(outboundCapacity, {
      motionId: options.motionId ?? null,
      motions
    }),
    ...buildInboundReviewPlannerItems(inboundReview),
    ...prospectBranches.map(({ motion, account, prospect }) => buildDailyItem({
      motion,
      account,
      prospect,
      motionSupportProspects: supportProspectsByMotionId.get(motion.id) ?? [],
      latestInboxItem: inboxByProspectId.get(prospect.id) ?? null,
      prospectInboxItems: inboxItemsByProspectId.get(prospect.id) ?? [],
      now
    }))
  ])
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
      advancedByInboundCount: limitedItems.filter((item) => item.cadenceEffect === "advanced_by_inbound").length,
      packetReviewCount: packetReview.count
    },
    capacity: {
      linkedin: outboundCapacity
    },
    packetReview,
    items: limitedItems
  };
}

/**
 * @param {Array<{ motion: any, account: any, prospect: any }>} branches
 * @param {{
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   assignedExecutionScopeKeys: Set<string>
 * }} filters
 */
function normalizeProspectBranches(branches, filters) {
  return branches
    .map((branch) => ({
      motion: motionSchema.parse(branch.motion),
      account: branch.account,
      prospect: branch.prospect,
    }))
    .filter((branch) => shouldUseProspectBranch(branch, filters));
}

/**
 * @param {import("../schema/motion.js").motionSchema._type[]} motions
 * @param {{
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   assignedExecutionScopeKeys: Set<string>
 * }} filters
 */
function buildProspectBranchesFromMotions(motions, filters) {
  return motions.flatMap((motion) =>
    motion.targetMap.accounts.flatMap((account) =>
      account.prospects.map((prospect) => ({ motion, account, prospect }))
    )
  )
    .filter((branch) => shouldUseProspectBranch(branch, filters));
}

/**
 * @param {{ motion: any, account: any, prospect: any }} branch
 * @param {{
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   assignedExecutionScopeKeys: Set<string>
 * }} filters
 */
function shouldUseProspectBranch({ motion, account, prospect }, filters) {
  if (filters.motionId && motion.id !== filters.motionId) return false;
  if (filters.companyId && account.companyId !== filters.companyId) return false;
  if (filters.prospectId && prospect.id !== filters.prospectId) return false;
  if (!filters.assignedExecutionScopeKeys.has(buildMotionCompanyScopeKey(motion.id, account.companyId))) return false;
  if (hasQueuedAutonomousSend(prospect)) return false;
  return prospect.cadenceState.status === "ready";
}

/**
 * Once the operator has approved an outbound draft, the branch is no longer an
 * open operator decision. It belongs to the send lane until writeback marks it
 * sent or discarded.
 *
 * @param {any} prospect
 */
function hasQueuedAutonomousSend(prospect) {
  return Array.isArray(prospect?.drafts)
    && prospect.drafts.some((draft) => isAutonomousSendReadyDraft(draft));
}

/**
 * @param {Array<{ motion: any, account: any, prospect: any }>} branches
 */
function buildSupportProspectsByMotionId(branches) {
  const supportProspectsByMotionId = new Map();
  for (const { motion, account, prospect } of branches) {
    const prospects = supportProspectsByMotionId.get(motion.id) ?? [];
    prospects.push(toSupportProspect(account, prospect));
    supportProspectsByMotionId.set(motion.id, prospects);
  }
  return supportProspectsByMotionId;
}

/**
 * @param {Array<ReturnType<typeof buildDailyItem> | ReturnType<typeof buildInboundReviewPlannerItems>[number] | ReturnType<typeof buildOutboundCapacityPlannerItem> | null>} items
 */
function dedupeDailyItems(items) {
  const deduped = [];
  const seenProspectActions = new Set();
  const seenInboundItems = new Set();

  for (const item of items) {
    if (!item) {
      continue;
    }

    const inboundKey = buildInboundDailyDedupKey(item);
    if (inboundKey) {
      if (seenInboundItems.has(inboundKey)) {
        continue;
      }
      seenInboundItems.add(inboundKey);
    }

    const sourceType = item.source?.type ?? "";
    const shouldDedupeProspectAction = item.state === "due_now"
      && item.prospect?.id
      && item.recommendedAction
      && (sourceType === "parallel_support_action" || sourceType === "cadence");

    if (shouldDedupeProspectAction) {
      const key = `${item.prospect.id}::${item.recommendedAction}`;
      if (seenProspectActions.has(key)) {
        continue;
      }
      seenProspectActions.add(key);
    }

    deduped.push(item);
  }

  return deduped;
}

/**
 * @param {ReturnType<typeof buildOutboundCapacityView> | null} capacity
 * @param {{ motionId: string | null | undefined, motions: import("../schema/motion.js").motionSchema._type[] }} input
 */
function buildOutboundCapacityPlannerItem(capacity, { motionId, motions }) {
  if (!capacity?.plannerItem) {
    return null;
  }

  const filteredMotion = motionId
    ? motions.find((motion) => motion.id === motionId) ?? null
    : null;
  const dueAt = capacity.plannerItem.dueAt;

  return {
    motion: filteredMotion
      ? {
          id: filteredMotion.id,
          name: filteredMotion.name
        }
      : {
          id: "outbound-capacity:linkedin",
          name: "LinkedIn outbound capacity"
    },
    company: {
      id: "outbound-capacity:linkedin",
      name: capacity.account.displayLabel ?? capacity.account.profileLabel ?? capacity.account.handle
    },
    prospect: {
      id: "outbound-capacity:linkedin",
      name: "LinkedIn invitation target",
      title: capacity.status === "needs_configuration" ? "Quota configuration needed" : "Daily deficit"
    },
    cadence: {
      currentStep: null,
      nextAction: capacity.plannerItem.recommendedAction,
      nextActionDueAt: dueAt,
      lastTouchOutcome: null
    },
    guidance: buildPlannerGuidance(capacity.plannerItem.guidanceKey, {
      motionId: filteredMotion?.id ?? "",
      motionName: filteredMotion?.name ?? "active motions",
      companyName: capacity.account.displayLabel ?? capacity.account.profileLabel ?? capacity.account.handle,
      prospectName: "LinkedIn invitation target",
      prospectTitle: capacity.status === "needs_configuration" ? "Quota configuration needed" : "Daily deficit",
      recommendedAction: capacity.plannerItem.recommendedAction,
      dueAt,
      whyItMatters: capacity.plannerItem.whyItMatters,
      ...capacity.plannerItem.context
    }),
    state: "due_now",
    priority: capacity.plannerItem.priority,
    priorityRank: capacity.plannerItem.priorityRank,
    cadenceEffect: capacity.status === "needs_configuration" ? "capacity_configuration_needed" : "capacity_deficit",
    dueAt,
    whyItMatters: capacity.plannerItem.whyItMatters,
    recommendedAction: capacity.plannerItem.recommendedAction,
    context: capacity.plannerItem.context,
    source: {
      type: "outbound_capacity",
      kind: capacity.plannerItem.kind,
      channel: capacity.channel
    }
  };
}

/**
 * @param {ReturnType<typeof buildInboundReviewView>} review
 */
function buildInboundReviewPlannerItems(review) {
  return review.reviewItems
    .filter((item) => shouldSurfaceInboundReviewItem(item))
    .map((item) => {
      const dueAt = item.observedAt;
      const plannerMeta = inboundReviewPlannerMeta(item.state);
      const guidanceKey = item.state === "needs_reply"
        || item.state === "ready_for_reply"
        ? "reply_to_inbound"
        : item.state === "ready_for_post_accept"
          ? "advance_after_connection_accept"
          : "review_inbound_item";
      return {
        motion: item.motion ?? {
          id: `inbound-review:${item.account.id}`,
          name: "Inbound review"
        },
        company: item.company ?? {
          id: `inbound-review:${item.account.id}`,
          name: item.account.capability
        },
        prospect: item.prospect ?? {
          id: item.id,
          name: item.actorName ?? "Inbound item",
          title: humanizeReviewState(item.state)
        },
        cadence: {
          currentStep: null,
          nextAction: item.recommendedAction,
          nextActionDueAt: dueAt,
          lastTouchOutcome: null
        },
        guidance: buildPlannerGuidance(guidanceKey, {
          motionId: item.motion?.id ?? "",
          motionName: item.motion?.name ?? "inbound review",
          companyId: item.company?.id ?? "",
          companyName: item.company?.name ?? item.account.capability,
          prospectId: item.prospect?.id ?? "",
          prospectName: item.prospect?.name ?? item.actorName ?? "this inbound item",
          prospectTitle: item.prospect?.title ?? humanizeReviewState(item.state),
          recommendedAction: item.recommendedAction,
          dueAt,
          whyItMatters: item.whyItMatters,
          inboundKind: item.kind,
          inboundChoices: item.decisionOptions.join(", "),
          inboundState: item.state
        }),
        state: "due_now",
        priority: plannerMeta.priority,
        priorityRank: plannerMeta.priorityRank,
        cadenceEffect: plannerMeta.cadenceEffect,
        dueAt,
        whyItMatters: item.whyItMatters,
        recommendedAction: item.recommendedAction,
        source: {
          type: "inbound_review",
          kind: item.state,
          observationId: item.id
        }
      };
    });
}

/**
 * @param {ReturnType<typeof buildPacketReviewView>} review
 */
function buildPacketReviewPlannerItems(review) {
  return review.items.map((item) => {
    const proposal = item.proposal?.action ? ` Proposed outcome: ${item.proposal.action}.` : "";
    const reason = item.proposal?.reason ? ` Reason: ${item.proposal.reason}` : "";
    const whyItMatters = `${item.packetLabel} packet for ${item.subject} is awaiting operator review.${proposal}${reason}`;
    const recommendedAction = `Review ${item.packetLabel.toLowerCase()} packet ${item.packetId}: accept, amend, or return it.`;
    return {
      motion: item.motion,
      company: item.company,
      prospect: item.prospect ?? {
        id: item.packetId,
        name: item.company.name,
        title: item.packetLabel
      },
      cadence: {
        currentStep: null,
        nextAction: recommendedAction,
        nextActionDueAt: item.submittedAt,
        lastTouchOutcome: null
      },
      guidance: buildPlannerGuidance("review_packet", {
        motionId: item.motion.id,
        motionName: item.motion.name,
        companyId: item.company.id,
        companyName: item.company.name,
        prospectId: item.prospect?.id ?? "",
        prospectName: item.prospect?.name ?? item.company.name,
        prospectTitle: item.prospect?.title ?? item.packetLabel,
        packetId: item.packetId,
        packetKind: item.packetKind,
        packetLabel: item.packetLabel,
        recommendedAction,
        dueAt: item.submittedAt,
        whyItMatters,
        proposal: item.proposal?.action ?? "",
        proposalReason: item.proposal?.reason ?? "",
        acceptCommand: item.commands.accept,
        amendCommand: item.commands.amend,
        returnCommand: item.commands.return
      }),
      state: "due_now",
      priority: "action",
      priorityRank: 0.2,
      cadenceEffect: "packet_review_needed",
      dueAt: item.submittedAt,
      whyItMatters,
      recommendedAction,
      context: {
        packetId: item.packetId,
        packetKind: item.packetKind,
        packetLabel: item.packetLabel,
        submittedAt: item.submittedAt,
        ageSeconds: item.ageSeconds,
        ageLabel: item.ageLabel,
        proposal: item.proposal,
        commands: item.commands,
        actions: item.actions
      },
      operatorActions: buildPacketReviewOperatorActions(item),
      source: {
        type: "packet_review",
        kind: item.packetKind,
        packetId: item.packetId,
        submittedAt: item.submittedAt
      }
    };
  });
}

/**
 * @param {ReturnType<typeof buildPacketReviewView>["items"][number]} item
 */
function buildPacketReviewOperatorActions(item) {
  const actionMeta = {
    motionId: item.motion.id,
    packetId: item.packetId,
    packetKind: item.packetKind,
    commands: item.commands
  };
  const actions = [
    {
      label: "Review packet",
      mode: "detail",
      href: item.reviewHref,
      writer: null,
      args: { ...actionMeta, command: item.commands.brief, action: "review" },
      variant: "primary",
      icon: "eye",
    },
  ];
  for (const action of item.actions) {
    if (action.kind === "review") continue;
    const fields = action.kind === "return"
      ? [{ name: "packetReviewReason", argKey: "notes", placeholder: "Return note", required: true }]
      : action.kind === "nurture" || action.kind === "terminal"
        ? [{ name: "packetReviewReason", argKey: "reason", placeholder: "Review reason", required: true }]
        : [];
    actions.push({
      label: action.label,
      mode: "detail",
      href: action.href,
      writer: action.writer ?? null,
      args: action.writer
        ? { ...action.args, command: action.command }
        : { ...actionMeta, command: action.command, action: action.kind },
      variant: action.kind === "return" ? "danger" : action.kind === "amend" ? "secondary" : "secondary",
      icon: action.kind === "return"
        ? "x"
        : action.kind === "accept"
          ? "check"
          : action.kind === "nurture"
            ? "clock"
            : action.kind === "terminal"
              ? "flag"
              : "refresh",
      fields,
    });
  }
  return actions;
}

/**
 * @param {ReturnType<typeof buildInboundReviewView>["reviewItems"][number]["state"]} state
 */
function inboundReviewPlannerMeta(state) {
  switch (state) {
    case "needs_reply":
    case "ready_for_reply":
      return { priority: "reply", priorityRank: 0, cadenceEffect: "overridden_by_inbound" };
    case "thread_change_review":
      return { priority: "action", priorityRank: 0.25, cadenceEffect: "inbound_review_needed" };
    case "ready_for_post_accept":
      return { priority: "action", priorityRank: 0.5, cadenceEffect: "advanced_by_inbound" };
    case "needs_claim":
      return { priority: "action", priorityRank: 0.75, cadenceEffect: "inbound_review_needed" };
    case "needs_decision":
      return { priority: "action", priorityRank: 0.75, cadenceEffect: "inbound_review_needed" };
    case "needs_status_reconciliation":
      return { priority: "action", priorityRank: 1, cadenceEffect: "inbound_review_needed" };
    default:
      return { priority: "action", priorityRank: 1.25, cadenceEffect: "inbound_review_needed" };
  }
}

/**
 * @param {{
 *   motion: import("../schema/motion.js").motionSchema._type,
 *   account: import("../schema/target-account.js").targetAccountSchema._type,
 *   prospect: import("../schema/target-account.js").prospectSchema._type,
 *   motionSupportProspects: ReturnType<typeof toSupportProspect>[],
 *   latestInboxItem: ReturnType<typeof buildInboxView>["items"][number] | null,
 *   prospectInboxItems: ReturnType<typeof buildInboxView>["items"],
 *   now: string
 * }} context
 */
function buildDailyItem({ motion, account, prospect, motionSupportProspects, latestInboxItem, prospectInboxItems, now }) {
  const cadence = prospect.cadenceState;
  const cadenceNotes = cadence.notes?.toLowerCase() ?? "";
  const observedConnectionState = summarizeObservedConnectionRequestState(prospectInboxItems);
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
      title: prospect.title,
      linkedinProfileUrl: prospect.linkedinProfileUrl ?? null,
      avatarUrl: prospect.avatarUrl ?? null,
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
    if (isHandledReplyReviewState(latestInboxItem.reviewState) || latestInboxItem.status === "queued" || latestInboxItem.status === "resolved") {
      return null;
    }

    if (isReplyReviewState(latestInboxItem.reviewState) || isReplyObservation(latestInboxItem.kind)) {
      const whyItMatters = latestInboxItem.reviewState === "ready_for_reply"
        ? "A private inbound message already has a drafted response. The operator can review the actual copy before it enters the send queue."
        : "A live reply overtook the planned cadence branch. The next move is to respond, not to continue the old follow-up.";
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
      if (latestInboxItem.reviewState !== "ready_for_post_accept") {
        return null;
      }
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
    cadence.currentStep === "connection-request"
    && !cadence.lastTouchOutcome
    && observedConnectionState
  ) {
    if (observedConnectionState.state === "accepted") {
      return null;
    }

    const attentionAfterTouch = observedConnectionState.state === "attention_after_touch";
    const needsStatusReconciliation = observedConnectionState.state === "needs_status_reconciliation";
    const notAccepted = observedConnectionState.state === "not_accepted";
    const waitingWhy = needsStatusReconciliation
      ? `${prospect.name}'s LinkedIn invite already left the pending list, so Exo should reconcile the relationship state before surfacing another first-touch send.`
      : notAccepted
        ? `${prospect.name}'s LinkedIn invite already failed to open a connection, so this stale first-touch branch should not send another connection request as if nothing happened.`
        : attentionAfterTouch
          ? `${prospect.name} viewed your profile after the connection request. Attention already happened, so the branch should stay patient while you work another ready branch.`
          : `${prospect.name} already has a connection request in flight, so the primary branch is waiting on an external trigger.`;
    const waitingNextMove = needsStatusReconciliation
      ? `Do not send another connection request to ${prospect.name} until Exo reconciles whether the prior invite was accepted, declined, or otherwise resolved.`
      : notAccepted
        ? `Do not treat ${prospect.name} as an untouched first-touch branch. Replan the next move instead of resending the same connection request.`
        : attentionAfterTouch
          ? `Do not add another touch to ${prospect.name} right now. Keep the invite patient and move to the next ready branch.`
          : `Wait for ${prospect.name} to accept or reply to the connection request before escalating.`;
    return {
      ...base,
      state: "waiting_until",
      priority: "wait",
      priorityRank: 3,
      cadenceEffect: "waiting_on_outbound",
      dueAt: cadence.nextActionDueAt ?? observedConnectionState.observedAt ?? now,
      whyItMatters: waitingWhy,
      recommendedAction: waitingNextMove,
      guidance: buildPlannerGuidance(
        (observedConnectionState.state === "pending" || attentionAfterTouch) ? "wait_for_connection_response" : "wait_for_response",
        {
          ...guidanceContext,
          recommendedAction: waitingNextMove,
          dueAt: cadence.nextActionDueAt ?? observedConnectionState.observedAt ?? now,
          whyItMatters: waitingWhy
        }
      ),
      source: {
        type: "inbound_observation",
        kind: observedConnectionState.state
      }
    };
  }

  if (
    isConnectionRequestInFlight(cadence)
    || (
      cadence.lastTouchOutcome === "sent"
      && (!cadence.nextActionDueAt || cadence.nextActionDueAt > now)
    )
  ) {
    const inviteViewedAfterTouch = latestInboxItem?.kind === "profile_view_after_touch";
    const waitingWhy = isConnectionRequestInFlight(cadence)
      ? inviteViewedAfterTouch
        ? `${prospect.name} viewed your profile after the connection request. Attention already happened, so the branch should stay patient while you work another ready branch.`
        : `${prospect.name} already has a connection request in flight, so the primary branch is waiting on an external trigger.`
      : `${prospect.name} already has an outbound branch in flight, so the primary branch is waiting on an external trigger.`;
    const waitingNextMove = isConnectionRequestInFlight(cadence)
      ? inviteViewedAfterTouch
        ? `Do not add another touch to ${prospect.name} right now. Keep the invite patient and move to the next ready branch.`
        : `Wait for ${prospect.name} to accept or reply to the connection request before escalating.`
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
          title: supportAction.prospect.title,
          linkedinProfileUrl: supportAction.prospect.linkedinProfileUrl ?? null,
          avatarUrl: supportAction.prospect.avatarUrl ?? null,
        },
        cadence: {
          currentStep: supportAction.prospect.cadenceState.currentStep ?? null,
          nextAction: supportAction.prospect.cadenceState.nextAction ?? supportAction.nextMove,
          nextActionDueAt: supportAction.prospect.cadenceState.nextActionDueAt ?? supportAction.dueAt ?? null,
          lastTouchOutcome: supportAction.prospect.cadenceState.lastTouchOutcome ?? null
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
          kind: isConnectionRequestInFlight(cadence) ? "wait_for_connection_response" : "wait_for_response",
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
        isConnectionRequestInFlight(cadence) ? "wait_for_connection_response" : "wait_for_response",
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
 * @param {string | null | undefined} reviewState
 */
function isReplyReviewState(reviewState) {
  return reviewState === "needs_reply" || reviewState === "ready_for_reply";
}

/**
 * @param {string | null | undefined} reviewState
 */
function isHandledReplyReviewState(reviewState) {
  return (
    reviewState === "queued_for_send"
    || reviewState === "reply_sent"
    || reviewState === "reply_unavailable"
    || reviewState === "agent_draft_due"
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

  if (isConnectionRequestInFlight(cadence)) {
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
 * @param {ReturnType<typeof buildInboundReviewView>["reviewItems"][number]} item
 */
function shouldSurfaceInboundReviewItem(item) {
  return (
    item.state === "needs_reply"
    || item.state === "ready_for_reply"
    || item.state === "thread_change_review"
    || item.state === "ready_for_post_accept"
    || item.state === "needs_claim"
    || item.state === "needs_decision"
    || item.state === "needs_status_reconciliation"
  );
}

/**
 * @param {string} state
 */
function humanizeReviewState(state) {
  switch (state) {
    case "needs_claim":
      return "Needs claim";
    case "needs_decision":
      return "Needs decision";
    case "needs_status_reconciliation":
      return "Needs status reconciliation";
    case "agent_withdraw_due":
      return "Agent withdraw due";
    case "needs_reply":
      return "Needs reply";
    case "ready_for_reply":
      return "Reply draft ready";
    case "ready_for_post_accept":
      return "Post-accept ready";
    case "agent_draft_due":
      return "Agent draft due";
    default:
      return state
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
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
    linkedinProfileUrl: prospect.linkedinProfileUrl ?? null,
    avatarUrl: prospect.avatarUrl ?? null,
    hasEmailFallback: hasUsableEmailFallback(prospect),
    messageTestReady: prospect.cadenceState.status === "ready",
    notes: prospect.notes,
    contactEnrichmentState: prospect.contactEnrichmentState,
    cadenceState: prospect.cadenceState,
    nextAction: prospect.cadenceState.nextAction
  };
}

/**
 * @param {ReturnType<typeof dedupeDailyItems>[number]} item
 */
function buildInboundDailyDedupKey(item) {
  const prospectId = item?.prospect?.id ?? null;
  if (!prospectId) {
    return null;
  }

  if (item.source?.type === "inbound_review") {
    switch (item.source.kind) {
      case "needs_reply":
      case "ready_for_reply":
        return `${prospectId}::reply`;
      case "ready_for_post_accept":
        return `${prospectId}::post_accept_review`;
      case "needs_claim":
        return `${prospectId}::claim`;
      case "needs_decision":
        return `${prospectId}::connection_decision`;
      default:
        return null;
    }
  }

  if (item.source?.type === "inbound_observation") {
    switch (item.source.kind) {
      case "inbound_reply_received":
      case "email_reply_received":
      case "message_received":
        return `${prospectId}::reply`;
      case "connection_request_accepted":
        return `${prospectId}::post_accept_review`;
      case "connection_request_received":
        return `${prospectId}::connection_decision`;
      default:
        return null;
    }
  }

  return null;
}
