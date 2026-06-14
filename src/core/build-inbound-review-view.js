// @ts-check

import { motionSchema } from "../schema/motion.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { isAutonomousSendReadyDraft } from "../lib/draft-policy.js";
import { buildUserInboundSyncView } from "./user-inbound-sync.js";
import {
  summarizeSurfaceState,
  recommendSurfaceAction,
  resolveInboundWorkspaceContext,
  shouldSuppressOperationalObservation
} from "./build-inbox-view.js";
import { isStalePendingConnectionRequest, STALE_CONNECTION_REQUEST_DAYS } from "../lib/cadence-helpers.js";
import { steerSuppression } from "./prospect-steer.js";
import {
  classifyPrivateInboundMessage,
  describePrivateInboundResponse,
} from "./private-inbound-message-classification.js";
import {
  needsInboundIdentityResolution,
  resolveManagedLinkedinAccount,
} from "./inbound-identity-resolution.js";
import { summarizeSentInvitationSurfaceReconciliation } from "./connection-request-reconciliation.js";

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
  const backgroundIdentityResolutionAvailable = Boolean(
    resolveManagedLinkedinAccount(user, {
      runtime: "codex",
      connector: "unipile",
      availableOnly: true,
    }),
  );
  const observations = rawObservations
    .map((item) => inboundObservationSchema.parse(item))
    .filter((observation) => !shouldSuppressOperationalObservation(observation));
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
        const surfaceObservations = filteredObservations.filter((observation) =>
          observation.accountId === account.accountId && observation.surfaceKey === surface.key
        );
        const connectionRequestSummary = surface.key === "linkedin-sent-invitations"
          ? summarizeSentInvitationSurfaceReconciliation({ surface, observations: surfaceObservations })
          : null;
        const viewSurface = connectionRequestSummary?.reconcileRequired
          ? {
            ...surface,
            lastReconcileRequired: true,
            lastReconcileReason: connectionRequestSummary.reason,
          }
          : surface;
        const derivedObservationCount = derivedSurfaceObservationCounts.get(`${account.accountId}:${surface.key}`) ?? 0;
        const observationCount = viewSurface.lastObservationCount ?? derivedObservationCount;
        const reportedItemCount = viewSurface.lastVisibleTotalCount ?? viewSurface.lastItemCount ?? 0;
        const missingObservationCount = viewSurface.lastItemizationGapCount
          ?? (reportedItemCount > 0 ? Math.max(reportedItemCount - observationCount, 0) : 0);
        const needsItemization = surfaceNeedsReconciliation(viewSurface, missingObservationCount);

        return {
          key: viewSurface.key,
          label: viewSurface.label,
          truthLevel: viewSurface.truthLevel,
          lastRunStatus: viewSurface.lastRunStatus,
          lastSyncedAt: viewSurface.lastSyncedAt,
          lastObservedAt: viewSurface.lastObservedAt,
          lastItemCount: viewSurface.lastItemCount,
          lastVisibleTotalCount: viewSurface.lastVisibleTotalCount,
          lastCaptureCompleteness: viewSurface.lastCaptureCompleteness,
          lastRequestedMode: viewSurface.lastRequestedMode,
          lastActualMode: viewSurface.lastActualMode,
          lastReconcileRequired: viewSurface.lastReconcileRequired,
          lastReconcileReason: viewSurface.lastReconcileReason,
          lastExhaustionStatus: viewSurface.lastExhaustionStatus,
          lastExhaustionReason: viewSurface.lastExhaustionReason,
          summary: summarizeSurfaceState(viewSurface),
          recommendedAction: recommendSurfaceAction(viewSurface),
          observationCount,
          missingObservationCount,
          needsItemization
        };
      })
  }));

  const reviewItems = filteredObservations
    .map((observation) => buildReviewItem(
      observation,
      motions,
      companiesById,
      prospectContextById,
      { backgroundIdentityResolutionAvailable },
    ))
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
        exhaustionStatus: surface.lastExhaustionStatus ?? null,
        exhaustionReason: surface.lastExhaustionReason ?? null,
        summary: buildItemizationGapSummary(surface),
        recommendedAction: buildItemizationGapAction(
          surface.label,
          surface.missingObservationCount,
          surface.lastReconcileRequired,
          surface.lastCaptureCompleteness,
          surface.lastExhaustionReason,
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
 * @param {{
 *   label: string,
 *   lastVisibleTotalCount: number | null,
 *   lastItemCount: number | null,
 *   observationCount: number,
 *   missingObservationCount: number,
 *   lastCaptureCompleteness: string | null,
 *   lastReconcileRequired: boolean | null,
 *   lastExhaustionStatus: string | null,
 *   lastExhaustionReason?: string | null,
 * }} surface
 */
function buildItemizationGapSummary(surface) {
  const label = surface.label;
  const itemCount = surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0;
  const observationCount = surface.observationCount;
  if (
    surface.lastReconcileRequired === true
    && surface.missingObservationCount === 0
    && surface.lastExhaustionStatus !== "complete"
  ) {
    if (surface.lastExhaustionReason === "page_budget_stopped_early") {
      return `${label} wrote back ${observationCount} itemized observation${observationCount === 1 ? "" : "s"}, but the last full reconciliation stopped at the configured page budget. Exo still needs the remaining pages before silence or disappearance is trustworthy.`;
    }
    return `${label} wrote back ${observationCount} itemized observation${observationCount === 1 ? "" : "s"}, but the last sync only proved a bounded quick-pass slice. Exo still needs a full reconciliation before silence or disappearance is trustworthy.`;
  }

  if (observationCount === 0) {
    return `${label} reported ${itemCount} item${itemCount === 1 ? "" : "s"} in the last sync, but no individual observations were written back.`;
  }

  return `${label} reported ${itemCount} item${itemCount === 1 ? "" : "s"} in the last sync, but only ${observationCount} individual observation${observationCount === 1 ? "" : "s"} ${observationCount === 1 ? "was" : "were"} written back.`;
}

/**
 * @param {string} label
 * @param {number} missingObservationCount
 * @param {boolean | null} reconcileRequired
 * @param {string | null} captureCompleteness
 * @param {string | null | undefined} exhaustionReason
 */
function buildItemizationGapAction(label, missingObservationCount, reconcileRequired, captureCompleteness, exhaustionReason) {
  if (reconcileRequired === true && missingObservationCount === 0) {
    const completeness = exhaustionReason === "page_budget_stopped_early"
      ? "the current pass stopped at the configured page budget"
      : captureCompleteness === "partial_visible_slice"
        ? "the current pass stopped at the bounded quick-pass limit"
        : "the current pass did not fully exhaust the live surface";
    return `Rerun ${label} in full mode and reconcile until the surface is exhausted. ${completeness}, so Exo cannot yet treat disappearance or silence as trustworthy.`;
  }

  if (missingObservationCount <= 0) {
    return `Rerun ${label} and write each concrete item back as its own observation so Exo can tell the operator what to review.`;
  }

  if (missingObservationCount > 0) {
    return `Rerun ${label} and write the remaining ${missingObservationCount} concrete item${missingObservationCount === 1 ? "" : "s"} back as individual observations so Exo can tell the operator what to review.`;
  }

  return `Rerun ${label} and reconcile the live surface until Exo can trust the result.`;
}

/**
 * @param {{
 *   lastRunStatus: string | null,
 *   lastReconcileRequired: boolean | null,
 *   lastExhaustionStatus: string | null,
 * }} surface
 * @param {number} missingObservationCount
 */
function surfaceNeedsReconciliation(surface, missingObservationCount) {
  const checked = surface.lastRunStatus === "success" || surface.lastRunStatus === "warning";
  if (!checked) {
    return false;
  }

  if (missingObservationCount > 0) {
    return true;
  }

  return surface.lastReconcileRequired === true && surface.lastExhaustionStatus !== "complete";
}
/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {import("../schema/motion.js").motionSchema._type[]} motions
 * @param {Map<string, any>} companiesById
 * @param {Map<string, { motion: import("../schema/motion.js").motionSchema._type, account: any, prospect: any }>} prospectContextById
 * @param {{ backgroundIdentityResolutionAvailable?: boolean }} [options]
 */
function buildReviewItem(observation, motions, companiesById, prospectContextById, options = {}) {
  const workspaceContext = resolveInboundWorkspaceContext(observation, motions, companiesById, prospectContextById);
  const { claimState, motion, account, company, prospect } = workspaceContext;
  const ageDays = calculateAgeDays(observation.observedAt);
  if (claimState === "claimed_elsewhere") {
    return buildClaimedElsewhereReviewItem(observation, ageDays, motion, company, prospect);
  }
  let triage = classifyReviewObservation(
    observation,
    ageDays,
    observation.observedAt,
    prospect?.name ?? observation.actorName ?? "this person",
  );
  if (
    claimState === "unclaimed"
    && options.backgroundIdentityResolutionAvailable === true
    && needsInboundIdentityResolution(observation)
  ) {
    triage = buildBackgroundIdentityResolutionWaitingState(
      observation,
      prospect?.name ?? observation.actorName ?? "this person",
    );
  }
  if (claimState === "unclaimed" && shouldEscalateUnclaimedReviewItem(observation, triage)) {
    triage = buildNeedsClaimReviewState(observation, triage, prospect?.name ?? observation.actorName ?? "this person");
  }
  if (claimState === "unclaimed" && observation.kind === "connection_request_accepted") {
    triage = buildAcceptedUnroutedReviewState(observation.actorName ?? "this person");
  }

  const handledPrivateInbound = classifyHandledPrivateInboundStage(
    observation,
    prospect,
    prospect?.name ?? observation.actorName ?? "this person",
  );
  if (handledPrivateInbound && claimState !== "unclaimed") {
    triage = handledPrivateInbound;
  }

  // Reconcile against what's already been done: if the accepted-invite's first
  // post-accept message has already been sent, it's no longer a decision —
  // we're now waiting on their reply. Without this it stays a live "send the
  // first message" decision forever (the Operator next-move bug).
  if (observation.kind === "connection_request_accepted" && hasSentPostAcceptMessage(prospect)) {
    const name = prospect?.name ?? observation.actorName ?? "this prospect";
    triage = {
      category: "accepted_invite",
      priority: "low",
      state: "post_accept_sent",
      whyItMatters: "The first post-accept message was already sent. The branch is now waiting on their reply.",
      recommendedAction: `First message already sent to ${name} — waiting for a reply.`,
      decisionOptions: [],
    };
  }

  // A send-ready first message means the decision is DONE — it now lives in
  // the agent send queue, not the operator decision lane. Without this, the
  // prospect sits as the live next move forever because the message isn't SENT
  // yet (that's the agent's step).
  if (observation.kind === "connection_request_accepted" && hasQueuedPostAcceptMessage(prospect)) {
    const name = prospect?.name ?? observation.actorName ?? "this prospect";
    triage = {
      category: "accepted_invite",
      priority: "low",
      state: "queued_for_send",
      whyItMatters: "The first message is already send-ready in the agent queue. No operator action needed.",
      recommendedAction: `First message queued for ${name} — the agent will send it.`,
      decisionOptions: [],
    };
  }

  if (observation.kind === "connection_request_accepted" && hasReviewablePostAcceptDraft(prospect)) {
    const name = prospect?.name ?? observation.actorName ?? "this prospect";
    triage = {
      category: "accepted_invite",
      priority: "high",
      state: "ready_for_post_accept",
      whyItMatters: "The agent already drafted the first post-accept message. The operator can review the actual copy instead of deciding in the abstract.",
      recommendedAction: `Review the drafted first post-accept message for ${name} and decide whether to queue it for send.`,
      decisionOptions: ["message", "wait"],
    };
  }

  if (observation.kind === "connection_request_accepted" && prospect && !hasSentPostAcceptMessage(prospect) && !hasQueuedPostAcceptMessage(prospect) && !hasReviewablePostAcceptDraft(prospect)) {
    const name = prospect?.name ?? observation.actorName ?? "this prospect";
    triage = {
      category: "accepted_invite",
      priority: "low",
      state: "agent_draft_due",
      whyItMatters: "The connection is accepted, but the operator should not get a send decision until the agent has written the first message.",
      recommendedAction: `Agent should draft the first post-accept message for ${name} before this returns to the operator lane.`,
      decisionOptions: [],
    };
  }

  // Operator steers are binding here too: a "do not contact / works for us"
  // steer pulls the prospect out of the operator decision queue entirely, so
  // the Operator view stays consistent with the agent queue.
  const suppression = steerSuppression(prospect);
  if (suppression.suppressed) {
    triage = {
      category: "operator_excluded",
      priority: "low",
      state: "excluded_by_steer",
      whyItMatters: `Excluded by an operator steer: ${suppression.reason}`,
      recommendedAction: `No outreach — operator steer says do not contact ${prospect?.name ?? observation.actorName ?? "this person"}.`,
      decisionOptions: [],
    };
  }

  const preview = buildReviewPreview(observation, prospect, triage.state);

  return {
    id: observation.id,
    observedAt: observation.observedAt,
    eventAt: observation.eventAt,
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
    previewLabel: preview.label,
    previewSubject: preview.subject,
    previewText: preview.text,
    category: triage.category,
    priority: triage.priority,
    state: triage.state,
    whyItMatters: triage.whyItMatters,
    recommendedAction: triage.recommendedAction,
    decisionOptions: triage.decisionOptions,
    claimState,
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
 * When Exo already has the managed Gmail + LinkedIn connector path needed to
 * resolve an email-first sender, this item should wait in background instead of
 * surfacing as fake claim/reply work for the operator.
 *
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {string} actorName
 */
function buildBackgroundIdentityResolutionWaitingState(observation, actorName) {
  const status = normalizeNullableString(observation.identityResolutionStatus);
  if (status === "blocked") {
    return {
      category: "global_intake",
      priority: "low",
      state: "waiting",
      whyItMatters: "Exo still needs a governed LinkedIn identity for this email-first sender, and the background connector path is currently blocked.",
      recommendedAction: `No operator claim or reply action for ${actorName} yet. Exo must clear the background identity-resolution blocker first.`,
      decisionOptions: [],
    };
  }
  if (status === "no_match") {
    return {
      category: "global_intake",
      priority: "low",
      state: "waiting",
      whyItMatters: "Exo could not match this email-first sender confidently yet, so it is retrying through the managed Gmail and LinkedIn connectors.",
      recommendedAction: `No operator claim or reply action for ${actorName} yet. Exo will retry the background identity resolution first.`,
      decisionOptions: [],
    };
  }
  return {
    category: "global_intake",
    priority: "low",
    state: "waiting",
    whyItMatters: "Exo is already resolving this email-first sender through the managed Gmail and LinkedIn connectors before claim or reply unlocks.",
    recommendedAction: `No operator action for ${actorName} yet. Wait for Exo to finish the background identity resolution before claiming or replying here.`,
    decisionOptions: [],
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {ReturnType<typeof classifyReviewObservation>} triage
 * @param {string} actorName
 */
function buildNeedsClaimReviewState(observation, triage, actorName) {
  return {
    category: "global_intake",
    priority: triage.priority,
    state: "needs_claim",
    whyItMatters: "This inbound person is still global intake. Keep them visible, but do not let them drive this folder's motion flow until this workspace explicitly claims them.",
    recommendedAction: buildNeedsClaimAction(observation.kind, actorName),
    decisionOptions: ["claim"],
  };
}

/**
 * @param {string} actorName
 */
function buildAcceptedUnroutedReviewState(actorName) {
  return {
    category: "accepted_invite",
    priority: "low",
    state: "accepted_unrouted",
    whyItMatters: "LinkedIn shows the connection is accepted, but Exo has not resolved a company or motion route for this person yet.",
    recommendedAction: `Resolve ${actorName}'s company or motion route before drafting the first post-accept message.`,
    decisionOptions: [],
  };
}

/**
 * Pending outbound invites are already in a governed waiting state even when
 * they have not been attached to a local workspace yet. Forcing them into
 * "needs claim" turns passive waiting into fake operator work and obscures the
 * stale-withdraw threshold.
 *
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {ReturnType<typeof classifyReviewObservation>} triage
 */
function shouldEscalateUnclaimedReviewItem(observation, triage) {
  if (observation.kind === "connection_request_pending") {
    return false;
  }
  if (observation.kind === "connection_request_received") {
    return false;
  }
  if (observation.kind === "connection_request_accept_requested") {
    return false;
  }
  if (observation.kind === "connection_request_accepted") {
    return false;
  }
  return ![
    "waiting",
    "agent_withdraw_due",
    "agent_status_reconciliation_due",
    "resolved_not_accepted",
    "attention_signal",
    "visibility_signal",
    "public_engagement_review",
    "informational",
  ].includes(triage.state);
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {number} ageDays
 * @param {any | null} motion
 * @param {any | null} company
 * @param {any | null} prospect
 */
function buildClaimedElsewhereReviewItem(observation, ageDays, motion, company, prospect) {
  const preview = buildReviewPreview(observation, prospect, "claimed_elsewhere");
  return {
    id: observation.id,
    observedAt: observation.observedAt,
    eventAt: observation.eventAt,
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
    previewLabel: preview.label,
    previewSubject: preview.subject,
    previewText: preview.text,
    category: "global_intake",
    priority: "low",
    state: "claimed_elsewhere",
    whyItMatters: "This inbound person is already claimed in another workspace. Do not fork them into this folder's motion flow.",
    recommendedAction: `Leave ${observation.actorName ?? "this inbound person"} in the owning workspace. Do not add them to a motion here.`,
    decisionOptions: [],
    claimState: "claimed_elsewhere",
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
 * @param {string} actorName
 */
function buildNeedsClaimAction(kind, actorName) {
  switch (kind) {
    case "connection_request_received":
    case "connection_request_received_no_longer_pending":
      return `Claim ${actorName} into this workspace's transition backlog if the invite belongs here. Until then, keep it in global intake instead of routing it into a local motion.`;
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
    case "thread_updated":
    case "email_thread_updated":
      return `Claim ${actorName} into this workspace's transition backlog if this thread belongs here. Do not treat it as local motion work until this workspace claims it.`;
    default:
      return `Claim ${actorName} into this workspace's transition backlog if they belong here. Otherwise leave the item in global intake.`;
  }
}

/**
 * Has an outbound post-accept message already gone out to this prospect?
 * (a sent touch or a sent draft on the post-accept / follow-up DM surfaces).
 * @param {any} prospect
 */
function hasSentPostAcceptMessage(prospect) {
  if (!prospect) return false;
  const surfaces = new Set(["post_accept_message", "follow_up_direct_message"]);
  const touchSent = (prospect.touches ?? []).some(
    (t) => surfaces.has(t.surface) && t.direction !== "inbound" && ["sent", "accepted", "replied"].includes(t.outcome),
  );
  const draftSent = (prospect.drafts ?? []).some((d) => surfaces.has(d.surface) && d.status === "sent");
  return touchSent || draftSent;
}

/**
 * Has a send-ready post-accept message already been staged for this prospect?
 * Only operator-approved or explicitly operator-queued drafts should leave the
 * review lane. Agent-written ready/legacy-queued drafts still need review.
 * @param {any} prospect
 */
function hasQueuedPostAcceptMessage(prospect) {
  if (!prospect) return false;
  const surfaces = new Set(["post_accept_message", "follow_up_direct_message"]);
  return (prospect.drafts ?? []).some(
    (d) => surfaces.has(d.surface) && isAutonomousSendReadyDraft(d),
  );
}

/**
 * Has the agent already written a reviewable post-accept draft for this
 * prospect? `ready` means the operator can open the compose panel and inspect
 * the actual copy immediately.
 * @param {any} prospect
 */
function hasReviewablePostAcceptDraft(prospect) {
  return Boolean(findReviewablePostAcceptDraft(prospect));
}

/**
 * @param {any} prospect
 */
function findReviewablePostAcceptDraft(prospect) {
  if (!prospect) return null;
  const surfaces = new Set(["post_accept_message", "follow_up_direct_message"]);
  return (prospect.drafts ?? []).find(
    (d) => surfaces.has(d.surface) && d.status === "ready",
  ) ?? null;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {any | null} prospect
 * @param {string} actorName
 * @returns {{ category: string, priority: string, state: string, whyItMatters: string, recommendedAction: string, decisionOptions: string[] } | null}
 */
function classifyHandledPrivateInboundStage(observation, prospect, actorName) {
  const response = describePrivateInboundResponse(observation, prospect);
  const responseState = response.state;
  const privateInboundState = classifyPrivateInboundMessage(observation);
  const category = privateInboundState === "first_inbound" ? "inbound_message" : "reply";
  const responseLabel = privateInboundState === "first_inbound" ? "response" : "reply";
  if (responseState === "queued") {
    return {
      category,
      priority: "low",
      state: "queued_for_send",
      whyItMatters: "The reply is already send-ready in the agent queue. No operator action is still pending.",
      recommendedAction: `Reply queued for ${actorName} — the agent will send it.`,
      decisionOptions: [],
    };
  }
  if (responseState === "sent") {
    return {
      category,
      priority: "low",
      state: "reply_sent",
      whyItMatters: "A reply was already sent after this inbound message. The branch is now waiting on them.",
      recommendedAction: `Reply already sent to ${actorName} — waiting for their next message.`,
      decisionOptions: [],
    };
  }
  if (responseState === "blocked") {
    const detail = summarizeUnavailableReplyReason(response.touch?.notes);
    return {
      category,
      priority: "low",
      state: "reply_unavailable",
      whyItMatters: detail,
      recommendedAction: `Reply unavailable for ${actorName} — ${detail}`,
      decisionOptions: [],
    };
  }
  if (responseState === "ready") {
    return {
      category,
      priority: "high",
      state: "ready_for_reply",
      whyItMatters: `The agent already drafted the ${responseLabel}. The operator can review the actual copy now.`,
      recommendedAction: `Review the drafted ${responseLabel} for ${actorName} and decide whether to queue it for send.`,
      decisionOptions: ["message", "wait"],
    };
  }
  if (responseState === "open") {
    return {
      category,
      priority: "low",
      state: "agent_draft_due",
      whyItMatters: `The private inbound thread is linked to this prospect, but the operator should not have to decide in the abstract. The agent needs to draft the ${responseLabel} first.`,
      recommendedAction: `Have the agent draft the ${responseLabel} for ${actorName}.`,
      decisionOptions: [],
    };
  }
  return null;
}

/**
 * @param {string} kind
 * @param {number} ageDays
 * @param {string} observedAt
 * @param {string} actorName
 */
function classifyReviewObservation(observation, ageDays, observedAt, actorName) {
  const kind = observation.kind;
  const privateInboundState = classifyPrivateInboundMessage(observation);
  switch (kind) {
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
      if (privateInboundState === "first_inbound") {
        return {
          category: "inbound_message",
          priority: "high",
          state: "needs_triage",
          whyItMatters: "A private inbound message arrived, but Exo does not have evidence that it is a reply to your prior message.",
          recommendedAction: `Review ${actorName}'s inbound message and decide whether to reply or ignore it.`,
          decisionOptions: ["reply-now", "ignore"]
        };
      }
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
    case "connection_request_accept_requested":
      return {
        category: "accepted_invite",
        priority: "low",
        state: "accept_queued",
        whyItMatters: "The operator already approved this invite. The live LinkedIn accept is queued for the agent.",
        recommendedAction: `Acceptance queued for ${actorName} — the agent will accept the invite on LinkedIn.`,
        decisionOptions: []
      };
    case "connection_request_accepted":
      return {
        category: "accepted_invite",
        priority: "low",
        state: "agent_draft_due",
        whyItMatters: "The connection gate opened. The next step is for the agent to draft the first post-accept private message before asking the operator to review anything.",
        recommendedAction: `Have the agent draft the first post-accept direct message for ${actorName}.`,
        decisionOptions: []
      };
    case "connection_request_decline_requested":
      return {
        category: "declined_invite",
        priority: "low",
        state: "decline_queued",
        whyItMatters: "The operator queued this invite for rejection. The agent will decline it on LinkedIn. Nothing for the operator to do.",
        recommendedAction: `Rejection queued for ${actorName} — the agent will decline the invite.`,
        decisionOptions: []
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
      if (!hasLinkedinProfileIdentity(observation)) {
        return {
          category: "sent_invite",
          priority: "low",
          state: "informational",
          whyItMatters: "The pending invitation row disappeared, but the stored row has no LinkedIn profile identity to verify relationship state.",
          recommendedAction: `No operator action for ${actorName}; Exo cannot classify this further without a LinkedIn profile identity.`,
          decisionOptions: []
        };
      }
      return {
        category: "sent_invite",
        priority: "high",
        state: "agent_status_reconciliation_due",
        whyItMatters: "A previously pending outbound invite disappeared from the full live pending list. Exo must verify the profile relationship and invitation state before changing the branch.",
        recommendedAction: `Agent should verify ${actorName}'s LinkedIn profile state and write back whether the request is still pending, accepted, or not accepted.`,
        decisionOptions: []
      };
    case "connection_request_not_accepted":
      return {
        category: "sent_invite",
        priority: "low",
        state: "resolved_not_accepted",
        whyItMatters: "LinkedIn profile state shows the sent invite is not pending and this person is not a connection.",
        recommendedAction: `No connection gate opened for ${actorName}; keep this branch closed unless new evidence appears.`,
        decisionOptions: []
      };
    case "connection_request_pending":
      if (isStalePendingConnectionRequest({ kind, observedAt })) {
        return {
          category: "sent_invite",
          priority: "high",
          state: "agent_withdraw_due",
          whyItMatters: `This sent invite has been pending for ${ageDays} days, which crosses the ${STALE_CONNECTION_REQUEST_DAYS}-day auto-withdraw threshold.`,
          recommendedAction: `Agent should withdraw ${actorName}'s stale pending connection request now.`,
          decisionOptions: []
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
      return {
        category: "signal",
        priority: "low",
        state: "attention_signal",
        whyItMatters: "A pending invite already got attention. That is a reason to stay patient, not a reason to force another touch.",
        recommendedAction: `Do not add another touch to ${actorName} right now. Keep the pending invite patient and move to the next ready branch.`,
        decisionOptions: []
      };
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

/** @param {string | null | undefined} notes */
function summarizeUnavailableReplyReason(notes) {
  const normalized = String(notes ?? "").trim();
  if (/disabledfeatures/i.test(normalized) && /reply/i.test(normalized)) {
    return "The governed LinkedIn thread is read-only and reply is disabled.";
  }
  if (/read[ -]?only/i.test(normalized)) {
    return "The governed LinkedIn thread is read-only.";
  }
  return "The governed reply path is not writable on this thread.";
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {any | null} prospect
 * @param {string} state
 * @returns {{ label: string | null, subject: string | null, text: string | null }}
 */
function buildReviewPreview(observation, prospect, state) {
  if (state === "ready_for_reply") {
    const draft = findReviewablePrivateReplyDraft(observation, prospect);
    const text = compactPreviewText(draft?.body ?? null);
    if (text) {
      return {
        label: "Draft message",
        subject: normalizeNullableString(draft?.subject) ?? null,
        text,
      };
    }
  }

  if (state === "ready_for_post_accept") {
    const draft = findReviewablePostAcceptDraft(prospect);
    const text = compactPreviewText(draft?.body ?? null);
    if (text) {
      return {
        label: "Draft message",
        subject: normalizeNullableString(draft?.subject) ?? null,
        text,
      };
    }
  }

  const parsedNotes = parseObservationNotes(observation.notes);
  const latestMessage = pickLatestMeaningfulMessage(observation);
  const previewSubject = normalizeNullableString(observation.subject) ?? parsedNotes.subject;
  const latestText = compactPreviewText(latestMessage?.body ?? null);
  if (latestText) {
    return {
      label: "Latest message",
      subject: previewSubject,
      text: latestText,
    };
  }

  const noteText = compactPreviewText(parsedNotes.body);
  if (noteText) {
    const syncEvidence = isGenericOperatorSurfaceNote(noteText)
      ? null
      : buildSyncEvidencePreview(noteText);
    if (syncEvidence) {
      return {
        label: syncEvidence.label,
        subject: previewSubject,
        text: syncEvidence.text,
      };
    }
    if (!isGenericOperatorSurfaceNote(noteText)) {
      return {
        label: observation.kind === "connection_request_received" ? "Invitation note" : "Thread context",
        subject: previewSubject,
        text: noteText,
      };
    }
  }

  const summaryText = compactPreviewText(humanizeObservationSummary(observation));
  if (summaryText) {
    return {
      label: "Engagement",
      subject: previewSubject,
      text: summaryText,
    };
  }

  return { label: null, subject: previewSubject, text: null };
}

/**
 * @param {string} noteText
 */
function isGenericOperatorSurfaceNote(noteText) {
  return noteText.trim() === "Recorded from the operator surface.";
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
function humanizeObservationSummary(observation) {
  const summary = normalizeNullableString(observation.summary);
  if (!summary) return null;
  const actorName = observation.actorName ?? "This person";
  if (
    observation.kind === "connection_request_accepted"
    && /was marked accepted from (the )?(action-result path|workspace)/i.test(summary)
  ) {
    return `${actorName} is now a LinkedIn connection.`;
  }
  return summary;
}

/**
 * @param {string} noteText
 * @returns {{ label: string, text: string } | null}
 */
function buildSyncEvidencePreview(noteText) {
  const normalized = noteText.trim();
  const syncEvidenceByNote = {
    "Derived from a complete sent-invitations reconciliation pass.":
      "Exo checked the full pending sent-invitations list. This invite is no longer pending, so the outcome needs review.",
    "Derived from a complete received-invitations reconciliation pass.":
      "Exo checked the full received-invitations list. This invite is no longer pending, so the outcome needs review.",
    "Derived from a complete followers reconciliation pass.":
      "Exo checked the full followers list. This person is no longer listed as a follower.",
    "Derived from a complete following-list reconciliation pass.":
      "Exo checked the full following list. This profile is no longer in the following list.",
    "Derived from a complete followers reconciliation pass against the prior complete snapshot.":
      "Exo compared the full followers list with the prior complete snapshot. This person newly appeared as a follower.",
    "Derived from a complete following-list reconciliation pass against the prior complete snapshot.":
      "Exo compared the full following list with the prior complete snapshot. This profile newly appeared in the following list.",
  };
  const translated = syncEvidenceByNote[normalized] ?? null;
  if (translated) {
    return { label: "Sync evidence", text: translated };
  }
  if (/^Exo (checked|compared) the full /.test(normalized)) {
    return { label: "Sync evidence", text: normalized };
  }
  const profileTruth = buildProfileTruthPreview(normalized);
  if (profileTruth) {
    return profileTruth;
  }
  return null;
}

/**
 * @param {string} noteText
 * @returns {{ label: string, text: string } | null}
 */
function buildProfileTruthPreview(noteText) {
  if (!/^LinkedIn profile truth check through the resolved account returned /i.test(noteText)) {
    return null;
  }

  if (/network_distance=FIRST_DEGREE/i.test(noteText) || /is_relationship=true/i.test(noteText)) {
    return {
      label: "LinkedIn status",
      text: "LinkedIn shows you are connected now.",
    };
  }

  if (/invitation\.type=SENT/i.test(noteText) && /invitation\.status=PENDING/i.test(noteText)) {
    return {
      label: "LinkedIn status",
      text: "LinkedIn still shows the sent connection request as pending.",
    };
  }

  if (/is_relationship=false/i.test(noteText)) {
    return {
      label: "LinkedIn status",
      text: "LinkedIn shows this person is not a connection and has no pending sent request.",
    };
  }

  return {
    label: "LinkedIn status",
    text: "Exo checked the LinkedIn profile relationship state.",
  };
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
    ready_for_reply: 1,
    needs_decision: 2,
    needs_status_reconciliation: 3,
    agent_status_reconciliation_due: 4,
    agent_withdraw_due: 5,
    ready_for_post_accept: 6,
    agent_draft_due: 7,
    thread_change_review: 8,
    needs_claim: 9,
    accepted_unrouted: 10,
    attention_signal: 11,
    visibility_signal: 12,
    public_engagement_review: 13,
    claimed_elsewhere: 14,
    waiting: 15,
    resolved_not_accepted: 16,
    informational: 17
  };

  return (
    priorityRank[left.priority] - priorityRank[right.priority]
    || (stateRank[left.state] ?? 99) - (stateRank[right.state] ?? 99)
    || right.observedAt.localeCompare(left.observedAt)
    || right.recordedAt.localeCompare(left.recordedAt)
  );
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
function pickLatestMeaningfulMessage(observation) {
  const messages = (observation.messages ?? [])
    .filter((message) => typeof message?.body === "string" && message.body.trim().length > 0)
    .slice()
    .sort((left, right) => (Date.parse(left.sentAt ?? "") || 0) - (Date.parse(right.sentAt ?? "") || 0));
  return messages.findLast((message) => String(message.direction ?? "").toLowerCase() === "inbound")
    ?? messages.at(-1)
    ?? null;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {any | null} prospect
 */
function findReviewablePrivateReplyDraft(observation, prospect) {
  const response = describePrivateInboundResponse(observation, prospect);
  return response.state === "ready" ? response.draft ?? null : null;
}

/**
 * @param {string | null | undefined} notes
 * @returns {{ subject: string | null, body: string | null }}
 */
function parseObservationNotes(notes) {
  const normalized = normalizeNullableString(notes);
  if (!normalized) {
    return { subject: null, body: null };
  }

  const subjectMatch = normalized.match(/^Subject:\s*(.+?)(?:\r?\n|$)/i);
  const subject = normalizeNullableString(subjectMatch?.[1] ?? null);
  const body = subjectMatch
    ? normalizeNullableString(normalized.slice(subjectMatch[0].length))
    : normalized;

  return {
    subject,
    body,
  };
}

/**
 * @param {string | null | undefined} value
 */
function compactPreviewText(value) {
  const normalized = normalizeNullableString(value)?.replace(/\s+/g, " ") ?? null;
  if (!normalized) return null;
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 217).replace(/\s+\S*$/, "").trimEnd()}...`;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

/** @param {import("../schema/inbound.js").inboundObservationSchema._type} observation */
function hasLinkedinProfileIdentity(observation) {
  return Boolean(
    normalizeNullableString(observation.actorLinkedinPublicId)
      || normalizeNullableString(observation.actorHandle)
      || normalizeNullableString(observation.actorLinkedinMemberId)
      || normalizeNullableString(observation.actorProfileUrl)
  );
}
