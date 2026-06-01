// @ts-check

import { motionSchema } from "../schema/motion.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { buildUserInboundSyncView } from "./user-inbound-sync.js";
import { summarizeSurfaceState, recommendSurfaceAction } from "./build-inbox-view.js";

const STALE_CONNECTION_REQUEST_DAYS = 21;

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawObservations
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 * @param {{
 *   accountId?: string | null,
 *   capability?: string | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null
 * }} [options]
 */
export function buildInboundReviewView(rawUser, rawObservations, rawMotions, rawCompanies, options = {}) {
  const user = userSchema.parse(rawUser);
  const observations = rawObservations.map((item) => inboundObservationSchema.parse(item));
  const motions = rawMotions.map((item) => motionSchema.parse(item));
  const companiesById = new Map(
    rawCompanies
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => [item.id, item])
  );
  const prospectContextById = new Map();

  for (const motion of motions) {
    for (const account of motion.targetMap.accounts) {
      for (const prospect of account.prospects) {
        prospectContextById.set(prospect.id, {
          motion,
          account,
          prospect
        });
      }
    }
  }

  const syncView = buildUserInboundSyncView(rawUser, {
    capability: options.capability ?? null
  });
  const accounts = syncView.accounts.filter((account) => !options.accountId || account.accountId === options.accountId);
  const enabledSurfaces = accounts.flatMap((account) =>
    account.surfaces
      .filter((surface) => surface.enabled)
      .map((surface) => ({
        ...surface,
        accountId: account.accountId,
        capability: account.capability,
        handle: account.handle
      }))
  );

  const filteredObservations = observations.filter((observation) =>
    (!options.accountId || observation.accountId === options.accountId)
    && (!options.capability || observation.capability === options.capability)
    && (!options.motionId || observation.motionId === options.motionId)
    && (!options.companyId || observation.companyId === options.companyId)
    && (!options.prospectId || observation.prospectId === options.prospectId)
  );

  const derivedSurfaceObservationCounts = new Map();
  for (const observation of filteredObservations) {
    const key = `${observation.accountId}:${observation.surfaceKey}`;
    derivedSurfaceObservationCounts.set(key, (derivedSurfaceObservationCounts.get(key) ?? 0) + 1);
  }

  const surfaceState = accounts.map((account) => ({
    accountId: account.accountId,
    capability: account.capability,
    handle: account.handle,
    label: account.label,
    preferred: account.preferred,
    surfaces: account.surfaces
      .filter((surface) => surface.enabled)
      .map((surface) => {
        const derivedObservationCount = derivedSurfaceObservationCounts.get(`${account.accountId}:${surface.key}`) ?? 0;
        const observationCount = surface.lastObservationCount ?? derivedObservationCount;
        const reportedItemCount = surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0;
        const missingObservationCount = surface.lastItemizationGapCount
          ?? (reportedItemCount > 0 ? Math.max(reportedItemCount - observationCount, 0) : 0);
        const needsItemization = (
          surface.lastRunStatus === "success"
          || surface.lastRunStatus === "warning"
        ) && missingObservationCount > 0;

        return {
          key: surface.key,
          label: surface.label,
          truthLevel: surface.truthLevel,
          lastRunStatus: surface.lastRunStatus,
          lastSyncedAt: surface.lastSyncedAt,
          lastObservedAt: surface.lastObservedAt,
          lastItemCount: surface.lastItemCount,
          lastVisibleTotalCount: surface.lastVisibleTotalCount,
          lastCaptureCompleteness: surface.lastCaptureCompleteness,
          lastRequestedMode: surface.lastRequestedMode,
          lastActualMode: surface.lastActualMode,
          lastReconcileRequired: surface.lastReconcileRequired,
          lastReconcileReason: surface.lastReconcileReason,
          summary: summarizeSurfaceState(surface),
          recommendedAction: recommendSurfaceAction(surface),
          observationCount,
          missingObservationCount,
          needsItemization
        };
      })
  }));

  const reviewItems = filteredObservations
    .map((observation) => buildReviewItem(observation, motions, companiesById, prospectContextById))
    .sort(compareReviewItems);

  const itemizationGaps = surfaceState.flatMap((account) =>
    account.surfaces
      .filter((surface) => surface.needsItemization)
      .map((surface) => ({
        accountId: account.accountId,
        capability: account.capability,
        handle: account.handle,
        surfaceKey: surface.key,
        label: surface.label,
        itemCount: surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0,
        itemizedCount: surface.lastItemCount ?? 0,
        observationCount: surface.observationCount,
        missingObservationCount: surface.missingObservationCount,
        captureCompleteness: surface.lastCaptureCompleteness ?? null,
        requestedMode: surface.lastRequestedMode ?? null,
        actualMode: surface.lastActualMode ?? null,
        reconcileRequired: surface.lastReconcileRequired ?? null,
        reconcileReason: surface.lastReconcileReason ?? null,
        summary: buildItemizationGapSummary(
          surface.label,
          surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0,
          surface.observationCount
        ),
        recommendedAction: buildItemizationGapAction(
          surface.label,
          surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0,
          surface.observationCount,
          surface.missingObservationCount
        )
      }))
  );

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    counts: {
      reviewItemCount: reviewItems.length,
      highPriorityCount: reviewItems.filter((item) => item.priority === "high").length,
      mediumPriorityCount: reviewItems.filter((item) => item.priority === "medium").length,
      lowPriorityCount: reviewItems.filter((item) => item.priority === "low").length,
      decisionItemCount: reviewItems.filter((item) =>
        item.state === "needs_decision"
        || item.state === "stale_withdraw_review"
        || item.state === "needs_status_reconciliation"
      ).length,
      signalItemCount: reviewItems.filter((item) => item.category === "signal" || item.category === "visibility").length,
      itemizationGapCount: itemizationGaps.length
    },
    surfaces: {
      accountCount: surfaceState.length,
      enabledSurfaceCount: surfaceState.reduce((sum, account) => sum + account.surfaces.length, 0),
      uncheckedSurfaceCount: surfaceState.reduce(
        (sum, account) => sum + account.surfaces.filter((surface) => surface.lastRunStatus === "never").length,
        0
      ),
      itemizationGapCount: itemizationGaps.length,
      accounts: surfaceState
    },
    reviewItems,
    itemizationGaps
  };
}

/**
 * @param {string} label
 * @param {number} itemCount
 * @param {number} observationCount
 */
function buildItemizationGapSummary(label, itemCount, observationCount) {
  if (observationCount === 0) {
    return `${label} reported ${itemCount} item${itemCount === 1 ? "" : "s"} in the last sync, but no individual observations were written back.`;
  }

  return `${label} reported ${itemCount} item${itemCount === 1 ? "" : "s"} in the last sync, but only ${observationCount} individual observation${observationCount === 1 ? "" : "s"} ${observationCount === 1 ? "was" : "were"} written back.`;
}

/**
 * @param {string} label
 * @param {number} itemCount
 * @param {number} observationCount
 * @param {number} missingObservationCount
 */
function buildItemizationGapAction(label, itemCount, observationCount, missingObservationCount) {
  if (observationCount === 0) {
    return `Rerun ${label} and write each concrete item back as its own observation so Exo can tell the operator what to review.`;
  }

  return `Rerun ${label} and write the remaining ${missingObservationCount} concrete item${missingObservationCount === 1 ? "" : "s"} back as individual observations so Exo can tell the operator what to review.`;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {import("../schema/motion.js").motionSchema._type[]} motions
 * @param {Map<string, any>} companiesById
 * @param {Map<string, { motion: import("../schema/motion.js").motionSchema._type, account: any, prospect: any }>} prospectContextById
 */
function buildReviewItem(observation, motions, companiesById, prospectContextById) {
  const prospectContext = observation.prospectId ? prospectContextById.get(observation.prospectId) ?? null : null;
  const motion = observation.motionId
    ? motions.find((candidate) => candidate.id === observation.motionId) ?? prospectContext?.motion ?? null
    : prospectContext?.motion ?? null;
  const account = prospectContext?.account ?? (motion && observation.companyId
    ? motion.targetMap.accounts.find((candidate) => candidate.companyId === observation.companyId) ?? null
    : null);
  const company = observation.companyId
    ? companiesById.get(observation.companyId) ?? account ?? null
    : account ?? null;
  const prospect = prospectContext?.prospect ?? (account && observation.prospectId
    ? account.prospects.find((candidate) => candidate.id === observation.prospectId) ?? null
    : null);
  const ageDays = calculateAgeDays(observation.observedAt);
  const triage = classifyReviewObservation(observation.kind, ageDays, prospect?.name ?? observation.actorName ?? "this person");

  return {
    id: observation.id,
    observedAt: observation.observedAt,
    recordedAt: observation.recordedAt,
    ageDays,
    kind: observation.kind,
    surfaceKey: observation.surfaceKey,
    actorName: observation.actorName,
    actorTitle: observation.actorTitle,
    actorCompanyName: observation.actorCompanyName,
    actorProfileUrl: observation.actorProfileUrl,
    actorLinkedinPublicId: observation.actorLinkedinPublicId,
    actorLinkedinMemberId: observation.actorLinkedinMemberId,
    actorAvatarSourceUrl: observation.actorAvatarSourceUrl,
    actorAvatarUrl: observation.actorAvatarUrl,
    sourceUrl: observation.sourceUrl,
    summary: observation.summary,
    category: triage.category,
    priority: triage.priority,
    state: triage.state,
    whyItMatters: triage.whyItMatters,
    recommendedAction: triage.recommendedAction,
    decisionOptions: triage.decisionOptions,
    account: {
      id: observation.accountId,
      capability: observation.capability
    },
    motion: motion ? { id: motion.id, name: motion.name } : null,
    company: company ? { id: company.id, name: company.name ?? company.companyName ?? null } : null,
    prospect: prospect ? { id: prospect.id, name: prospect.name, title: prospect.title } : null
  };
}

/**
 * @param {string} kind
 * @param {number} ageDays
 * @param {string} actorName
 */
function classifyReviewObservation(kind, ageDays, actorName) {
  switch (kind) {
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
      return {
        category: "reply",
        priority: "high",
        state: "needs_reply",
        whyItMatters: "This is a live response on a private channel. The branch is no longer speculative outreach.",
        recommendedAction: `Reply to ${actorName} and move the branch into an active conversation.`,
        decisionOptions: ["reply-now"]
      };
    case "thread_updated":
    case "email_thread_updated":
      return {
        category: "reply",
        priority: "medium",
        state: "thread_change_review",
        whyItMatters: "A private thread moved, but the newest visible state is not clearly classifiable as a reply yet. The operator still needs to review what changed.",
        recommendedAction: `Review ${actorName}'s updated thread and decide whether it needs a reply, a state change, or no action.`,
        decisionOptions: ["reply-now", "note-change", "ignore"]
      };
    case "connection_request_received":
      return {
        category: "incoming_invite",
        priority: "high",
        state: "needs_decision",
        whyItMatters: "Inbound connection requests are explicit asks for access. They need a yes or no, not passive drift.",
        recommendedAction: `Review ${actorName}'s inbound connection request and decide whether to accept or decline it.`,
        decisionOptions: ["accept", "decline"]
      };
    case "connection_request_received_no_longer_pending":
      return {
        category: "incoming_invite",
        priority: "high",
        state: "needs_status_reconciliation",
        whyItMatters: "A previously visible inbound connection request left the received-invitations list. The operator or the requester changed its state, and Exo needs that reconciled.",
        recommendedAction: `Review whether ${actorName}'s inbound connection request was accepted, declined, withdrawn, or otherwise resolved, then update the governed branch accordingly.`,
        decisionOptions: ["accepted", "declined", "other"]
      };
    case "connection_request_accepted":
      return {
        category: "accepted_invite",
        priority: "high",
        state: "ready_for_post_accept",
        whyItMatters: "The connection gate opened. This is the moment to decide whether to send the first post-accept private message.",
        recommendedAction: `Decide whether to send the first post-accept direct message to ${actorName}.`,
        decisionOptions: ["message", "wait"]
      };
    case "connection_request_declined":
      return {
        category: "declined_invite",
        priority: "low",
        state: "resolved_declined",
        whyItMatters: "The inbound connection request was explicitly declined. That branch is closed unless new evidence changes the judgment.",
        recommendedAction: `No next move is required for ${actorName} unless this decline needs to be linked or audited.`,
        decisionOptions: []
      };
    case "connection_request_no_longer_pending":
      return {
        category: "sent_invite",
        priority: "high",
        state: "needs_status_reconciliation",
        whyItMatters: "A previously pending outbound invite disappeared from the full live pending list. The waiting assumption is broken, but the exact outcome still needs classification.",
        recommendedAction: `Review whether ${actorName}'s connection request was accepted, rejected, or otherwise left the pending list, then update the governed branch accordingly.`,
        decisionOptions: ["accepted", "rejected", "other"]
      };
    case "connection_request_pending":
      if (ageDays >= STALE_CONNECTION_REQUEST_DAYS) {
        return {
          category: "sent_invite",
          priority: "high",
          state: "stale_withdraw_review",
          whyItMatters: `This sent invite has been pending for ${ageDays} days, which crosses the stale-withdraw review threshold.`,
          recommendedAction: `Review whether to withdraw ${actorName}'s pending connection request now that it is stale.`,
          decisionOptions: ["withdraw", "keep-pending"]
        };
      }

      return {
        category: "sent_invite",
        priority: "low",
        state: "waiting",
        whyItMatters: "The invite is still pending, but it has not aged into stale cleanup yet.",
        recommendedAction: `Keep ${actorName}'s connection request patient for now and recheck it later.`,
        decisionOptions: ["wait"]
      };
    case "profile_view_after_touch":
    case "profile_view_received":
      return {
        category: "signal",
        priority: "medium",
        state: "attention_signal",
        whyItMatters: "A profile view is real attention. It does not unlock a private move by itself, but it changes how patient the branch should be.",
        recommendedAction: `Review whether ${actorName}'s profile view changes the patience or escalation logic on this branch.`,
        decisionOptions: ["note-signal", "hold"]
      };
    case "follower_added":
    case "follower_removed":
    case "follower_confirmed":
    case "follow_state_changed":
    case "follow_state_removed":
    case "follow_state_confirmed":
      return {
        category: "visibility",
        priority: "medium",
        state: "visibility_signal",
        whyItMatters: "Follow-state movement is real visibility data, but it should not masquerade as connection truth.",
        recommendedAction: `Review whether this follow-state change creates a legitimate visibility or cleanup move.`,
        decisionOptions: ["note-signal", "follow-up", "ignore"]
      };
    case "public_reply_received":
    case "comment_thread_updated":
    case "public_engagement_opportunity":
    case "catch_up_update_detected":
      return {
        category: "visibility",
        priority: "medium",
        state: "public_engagement_review",
        whyItMatters: "A public thread or update moved. This may create a real public-engagement opportunity.",
        recommendedAction: `Review whether there is a legitimate public engagement move to make here.`,
        decisionOptions: ["engage", "ignore"]
      };
    default:
      return {
        category: "informational",
        priority: "low",
        state: "informational",
        whyItMatters: "This is useful state, but it does not demand immediate action by itself.",
        recommendedAction: "Review whether this changes the branch state.",
        decisionOptions: []
      };
  }
}

/**
 * @param {string} observedAt
 */
function calculateAgeDays(observedAt) {
  const observedMs = Date.parse(observedAt);
  if (Number.isNaN(observedMs)) {
    return 0;
  }

  const diffMs = Date.now() - observedMs;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * @param {ReturnType<typeof buildReviewItem>} left
 * @param {ReturnType<typeof buildReviewItem>} right
 */
function compareReviewItems(left, right) {
  const priorityRank = {
    high: 0,
    medium: 1,
    low: 2
  };
  const stateRank = {
    needs_reply: 0,
    needs_decision: 1,
    needs_status_reconciliation: 2,
    stale_withdraw_review: 3,
    ready_for_post_accept: 4,
    thread_change_review: 5,
    attention_signal: 6,
    visibility_signal: 7,
    public_engagement_review: 8,
    waiting: 9,
    informational: 10
  };

  return (
    priorityRank[left.priority] - priorityRank[right.priority]
    || (stateRank[left.state] ?? 99) - (stateRank[right.state] ?? 99)
    || right.observedAt.localeCompare(left.observedAt)
    || right.recordedAt.localeCompare(left.recordedAt)
  );
}
