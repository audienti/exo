// @ts-check

import { inboundCueSchema } from "../schema/inbound.js";
import { buildInboxView } from "./build-inbox-view.js";
import { buildInboundReviewView } from "./build-inbound-review-view.js";
import { buildUserInboundSyncView, classifyInboundSurfaceFreshness } from "./user-inbound-sync.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { classifyUserWorkingHours } from "./working-hours.js";
import { buildPlannerGuidance } from "../lib/planner-guidance.js";
import { selectParallelSupportAction } from "./planner-support-actions.js";
import { isExecutionEligibleMotionStatus } from "../lib/motion-status.js";
import { hasUsableEmailFallback } from "../lib/prospect-contacts.js";
import { isConnectionRequestInFlight } from "../lib/cadence-helpers.js";
import { buildOutboundCapacityView } from "./build-outbound-capacity-view.js";

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 * @param {unknown[]} rawProfiles
 * @param {unknown[]} rawObservations
 * @param {{
 *   now?: string | null | undefined,
 *   rawCues?: unknown[] | undefined,
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined,
 *   limit?: number | null | undefined
 * }} [options]
 */
export function buildDailyView(rawUser, rawMotions, rawCompanies, rawProfiles, rawObservations, options = {}) {
  const user = userSchema.parse(rawUser);
  const motions = rawMotions
    .map((item) => motionSchema.parse(item))
    .filter((motion) => isExecutionEligibleMotionStatus(motion.status));
  const companies = rawCompanies.map((item) => companySchema.parse(item));
  const now = options.now ?? new Date().toISOString();
  const inbox = buildInboxView(user, rawObservations, motions, companies);
  const inboundReview = buildInboundReviewView(user, rawObservations, motions, companies, {
    motionId: options.motionId ?? null,
    companyId: options.companyId ?? null,
    prospectId: options.prospectId ?? null
  });
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
  const outboundCapacity = buildOutboundCapacityView(user, motions, companies, rawProfiles, {
    now,
    motionId: options.motionId ?? null,
    companyId: options.companyId ?? null,
    prospectId: options.prospectId ?? null
  });
  const cues = (options.rawCues ?? []).map((cue) => inboundCueSchema.parse(cue));

  const syncPlannerItem = buildSyncPlannerItem({
    user,
    motions,
    assignedCompanyIds,
    observationCount: rawObservations.length,
    cues,
    now,
    options
  });

  const items = dedupeDailyItems([
    syncPlannerItem,
    buildOutboundCapacityPlannerItem(outboundCapacity, {
      motionId: options.motionId ?? null,
      motions
    }),
    ...buildInboundReviewPlannerItems(inboundReview),
    ...motions
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
      advancedByInboundCount: limitedItems.filter((item) => item.cadenceEffect === "advanced_by_inbound").length
    },
    capacity: {
      linkedin: outboundCapacity
    },
    items: limitedItems
  };
}

/**
 * @param {Array<ReturnType<typeof buildDailyItem> | ReturnType<typeof buildInboundReviewPlannerItems>[number] | ReturnType<typeof buildSyncPlannerItem> | ReturnType<typeof buildOutboundCapacityPlannerItem> | null>} items
 */
function dedupeDailyItems(items) {
  const deduped = [];
  const seenProspectActions = new Set();

  for (const item of items) {
    if (!item) {
      continue;
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
      name: capacity.account.profileLabel ?? capacity.account.handle
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
      companyName: capacity.account.profileLabel ?? capacity.account.handle,
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
  const decisionItems = review.reviewItems
    .filter((item) => shouldSurfaceInboundReviewItem(item))
    .map((item) => {
      const dueAt = item.observedAt;
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
        guidance: buildPlannerGuidance("review_inbound_item", {
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
        priority: "action",
        priorityRank: 0.75,
        cadenceEffect: "inbound_review_needed",
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

  const itemizationGapItems = review.itemizationGaps.map((gap) => {
    const dueAt = new Date().toISOString();
    return {
      motion: {
        id: `inbound-gap:${gap.accountId}`,
        name: "Inbound itemization"
      },
      company: {
        id: `inbound-gap:${gap.accountId}`,
        name: `${gap.capability}:${gap.handle}`
      },
      prospect: {
        id: `inbound-gap:${gap.accountId}:${gap.surfaceKey}`,
        name: gap.label,
        title: "Itemization gap"
      },
      cadence: {
        currentStep: null,
        nextAction: gap.recommendedAction,
        nextActionDueAt: dueAt,
        lastTouchOutcome: null
      },
      guidance: buildPlannerGuidance("itemize_inbound_surface", {
        motionName: "inbound review",
        companyName: `${gap.capability}:${gap.handle}`,
        prospectName: gap.label,
        prospectTitle: "Itemization gap",
        recommendedAction: gap.recommendedAction,
        dueAt,
        whyItMatters: gap.summary,
        surfaceLabel: gap.label,
        itemCount: String(gap.itemCount)
      }),
      state: "due_now",
      priority: "action",
      priorityRank: 0.8,
      cadenceEffect: "inbound_itemization_needed",
      dueAt,
      whyItMatters: gap.summary,
      recommendedAction: gap.recommendedAction,
      source: {
        type: "inbound_itemization_gap",
        kind: gap.surfaceKey,
        accountId: gap.accountId
      }
    };
  });

  return [...decisionItems, ...itemizationGapItems];
}

/**
 * @param {{
 *   user: import("../schema/user.js").userSchema._type,
 *   motions: import("../schema/motion.js").motionSchema._type[],
 *   assignedCompanyIds: Set<string>,
 *   observationCount: number,
 *   cues: import("../schema/inbound.js").inboundCueSchema._type[],
 *   now: string,
 *   options: {
 *     rawCues?: unknown[] | undefined,
 *     motionId?: string | null | undefined,
 *     companyId?: string | null | undefined,
 *     prospectId?: string | null | undefined,
 *     limit?: number | null | undefined
 *   }
 * }} input
 */
function buildSyncPlannerItem({ user, motions, assignedCompanyIds, observationCount, cues, now, options }) {
  if (!assignedCompanyIds.size || options.prospectId) {
    return null;
  }

  const openCues = cues.filter((cue) =>
    cue.userId === user.id
    && cue.status === "open"
    && (!options.motionId || cue.motionId === options.motionId)
    && (!options.companyId || cue.companyId === options.companyId)
  );
  if (observationCount > 0 && !openCues.length) {
    return null;
  }

  const syncView = buildUserInboundSyncView(user);
  const relevantAccounts = syncView.accounts
    .map((account) => {
      const staleSurfaces = account.surfaces
        .filter((surface) => surface.enabled && surface.truthLevel === "authoritative")
        .map((surface) => ({
          ...surface,
          freshness: classifyInboundSurfaceFreshness(surface, now)
        }))
        .filter((surface) => surface.freshness);
      const accountCues = openCues.filter((cue) => cue.accountId === account.accountId);
      if (!staleSurfaces.length && !accountCues.length) {
        return null;
      }

      return {
        account,
        staleSurfaces,
        cues: accountCues
      };
    })
    .filter((entry) => entry && (entry.staleSurfaces.length || entry.cues.length));

  if (!relevantAccounts.length) {
    return null;
  }

  const filteredMotion = options.motionId
    ? motions.find((motion) => motion.id === options.motionId) ?? null
    : null;
  const workingHours = classifyUserWorkingHours(user, now);
  const hasCue = relevantAccounts.some((entry) => entry.cues.length > 0);
  const capabilityLabels = [...new Set(relevantAccounts.map((entry) => humanizeCapability(entry.account.capability)))];
  const staleSurfaceLabels = relevantAccounts.flatMap((entry) => entry.staleSurfaces.map((surface) => surface.label));
  const cueSurfaceLabels = relevantAccounts.flatMap((entry) => entry.cues.map((cue) => cueLabelForAccount(entry.account, cue.surfaceKey)));
  const surfaceLabels = [...new Set([...staleSurfaceLabels, ...cueSurfaceLabels])];
  const neverOrFailed = relevantAccounts.some((entry) =>
    entry.staleSurfaces.some((surface) => surface.freshness.reason === "never" || surface.freshness.reason === "failed")
  );
  const reasonSummary = hasCue
    ? "ambient cues suggest something changed on live inbound surfaces even though Exo has not checked the canonical truth yet"
    : neverOrFailed
      ? "enabled inbound surfaces have never been checked yet or have a failed sync state"
      : "enabled inbound surfaces are stale enough that the planner should refresh them before trusting silence";
  const whyItMatters = hasCue
    ? `While doing other governed work, the agent saw ambient inbound cues on ${surfaceLabels.join(", ")}. That is not canonical truth by itself, but it is enough smoke that Exo should check the real surfaces before trusting silence.`
    : `Exo has no fresh inbound truth for ${capabilityLabels.join(" and ")}, so the planner should refresh those surfaces before trusting the absence of replies, accepts, or attention signals.`;
  const baseRecommendedAction = hasCue
    ? `Run a quick inbound sync for ${capabilityLabels.join(" and ")}, starting with ${surfaceLabels.join(", ")}, because the agent saw ambient cue${openCues.length === 1 ? "" : "s"} that something may have changed.`
    : `Run a quick inbound sync for ${capabilityLabels.join(" and ")}, record any observations you find, mark the surfaces checked, and then rerun inbox, daily, and next.`;
  const naturalDueAt = relevantAccounts
    .flatMap((entry) => entry.staleSurfaces.map((surface) => surface.freshness.dueAt))
    .concat(openCues.map((cue) => cue.observedAt))
    .sort()[0] ?? now;
  const dueAt = workingHours.openNow
    ? naturalDueAt
    : workingHours.nextOpenAt ?? naturalDueAt;
  const recommendedAction = workingHours.openNow
    ? baseRecommendedAction
    : `${baseRecommendedAction} Queue that sync for the next open working hours window instead of forcing it right now.`;
  const state = workingHours.openNow ? "due_now" : "waiting_until";
  const priority = workingHours.openNow ? "action" : "wait";
  const priorityRank = workingHours.openNow ? 0.45 : 2.9;
  const cadenceEffect = workingHours.openNow
    ? hasCue ? "sync_hint_detected" : "sync_needed"
    : "sync_waiting_for_working_hours";

  return {
    motion: filteredMotion
      ? {
          id: filteredMotion.id,
          name: filteredMotion.name
        }
      : {
          id: `inbound-sync:${user.id}`,
          name: "Cross-motion inbound truth"
        },
    company: {
      id: `inbound-sync:${user.id}`,
      name: capabilityLabels.join(" + ")
    },
    prospect: {
      id: `inbound-sync:${user.id}`,
      name: "Inbound sync",
      title: hasCue
        ? `${surfaceLabels.length} surface${surfaceLabels.length === 1 ? "" : "s"} have cue-driven sync pressure`
        : `${surfaceLabels.length} authoritative surface${surfaceLabels.length === 1 ? "" : "s"} need refresh`
    },
    cadence: {
      currentStep: null,
      nextAction: recommendedAction,
      nextActionDueAt: dueAt,
      lastTouchOutcome: null
    },
    guidance: buildPlannerGuidance("sync_inbound_surfaces", {
      motionId: filteredMotion?.id ?? "",
      motionName: filteredMotion?.name ?? "active motions",
      recommendedAction,
      dueAt,
      whyItMatters,
      accountCapabilityList: capabilityLabels.join(", "),
      surfaceList: surfaceLabels.join(", "),
      syncReason: reasonSummary
    }),
    state,
    priority,
    priorityRank,
    cadenceEffect,
    dueAt,
    whyItMatters,
    recommendedAction,
    source: {
      type: "inbound_sync",
      kind: hasCue ? "sync_hint" : neverOrFailed ? "sync_needed" : "sync_stale",
      accountCount: relevantAccounts.length,
      surfaceCount: surfaceLabels.length
    }
  };
}

/**
 * @param {ReturnType<typeof buildUserInboundSyncView>["accounts"][number]} account
 * @param {string} surfaceKey
 */
function cueLabelForAccount(account, surfaceKey) {
  return account.surfaces.find((surface) => surface.key === surfaceKey)?.label ?? surfaceKey;
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
    isConnectionRequestInFlight(cadence)
    || (
      cadence.lastTouchOutcome === "sent"
      && (!cadence.nextActionDueAt || cadence.nextActionDueAt > now)
    )
  ) {
    const waitingWhy = isConnectionRequestInFlight(cadence)
      ? `${prospect.name} already has a connection request in flight, so the primary branch is waiting on an external trigger.`
      : `${prospect.name} already has an outbound branch in flight, so the primary branch is waiting on an external trigger.`;
    const waitingNextMove = isConnectionRequestInFlight(cadence)
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
 * @param {{
 *   lastRunStatus: "never" | "success" | "warning" | "failed",
 *   lastSyncedAt: string | null,
 *   lastObservedAt: string | null
 * }} surface
 * @param {string} now
 */
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
 * @param {string} capability
 */
function humanizeCapability(capability) {
  switch (capability) {
    case "linkedin":
      return "LinkedIn";
    case "gmail":
      return "Gmail";
    case "sales-navigator":
      return "Sales Navigator";
    default:
      return capability
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

/**
 * @param {ReturnType<typeof buildInboundReviewView>["reviewItems"][number]} item
 */
function shouldSurfaceInboundReviewItem(item) {
  if (item.state === "needs_reply" || item.state === "ready_for_post_accept") {
    return false;
  }

  return (
    item.state === "needs_decision"
    || item.state === "stale_withdraw_review"
  );
}

/**
 * @param {string} state
 */
function humanizeReviewState(state) {
  switch (state) {
    case "needs_decision":
      return "Needs decision";
    case "stale_withdraw_review":
      return "Stale withdraw review";
    case "needs_reply":
      return "Needs reply";
    case "ready_for_post_accept":
      return "Post-accept ready";
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
