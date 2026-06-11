// @ts-check
//
// The agent's autonomous work queue — everything that is truly send-ready or
// can be executed WITHOUT further operator input. This is what an agent loop
// drains: for each task it performs the real-world action (e.g. sends the
// LinkedIn message via its governed connector path) and then writes the result back with
// the `writeback` command, which marks the draft sent and records the touch.
//
// Task kinds today:
//   - run_inbound_sync           — refresh stale or under-itemized inbound truth
//                                  surfaces with no operator input.
//   - company_discovery         — replenish thin motion inventory by finding
//                                 new companies that match the motion thesis
//                                 and signal contract.
//   - company_research          — run one governed company-research packet
//                                 against the motion signal contract. Claimable
//                                 packets live in the same queue as already-
//                                 claimed packets so there is only one
//                                 executable research lane.
//   - prospect_selection        — pick the smallest credible stakeholder set
//                                 for one researched account and land the
//                                 governed writebacks needed to complete the
//                                 selection packet.
//   - prospect_research         — complete one selected prospect's research,
//                                 enrichment, and cadence packet until the
//                                 branch is genuinely ready or terminal.
//   - write_draft               — write the next governed draft with no
//                                 operator input.
//   - send_message              — fire a send-ready outbound message.
//   - reject_connection_request — decline an inbound invite the operator
//                                 already rejected in Exo.
//   - withdraw_connection       — clear a stale outbound invite automatically.
// Cleanup stops at the invitation state change. Exo no longer synthesizes a
// follow/unfollow cleanup branch when the connector path cannot prove it.
//
// Blockers cover send-ready drafts that became stale after they were approved
// (e.g. the prospect replied before send). Those are NOT auto-sent — the
// operator has to re-review.

import { inboundCueSchema } from "../schema/inbound.js";
import {
  createTaskLeaseFingerprint,
  getActiveTaskLease,
  getRecentMotionRunAt,
} from "../lib/agent-host-state.js";
import { isConnectionRequestInFlight, isStalePendingConnectionRequest } from "../lib/cadence-helpers.js";
import {
  draftWritebackStatusForSurface,
  extractUsableDraftBody,
  isAutonomousSendReadyDraft,
  isStructuredDraftEnvelope,
} from "../lib/draft-policy.js";
import { withDerivedProspectQueueState } from "../lib/motion-queue.js";
import { isExecutionEligibleMotionStatus } from "../lib/motion-status.js";
import { buildSendHandoff } from "./build-send-handoff.js";
import { buildMotionDiscoveryDemand } from "./build-motion-discovery-brief.js";
import { buildInboundReviewView } from "./build-inbound-review-view.js";
import { steerSuppression } from "./prospect-steer.js";
import {
  classifyDraftStaleness,
  isDraftActive,
  selectNextDraftSurface,
} from "./select-next-draft-surface.js";
import {
  buildUserInboundSyncView,
  classifyInboundSurfaceFreshness,
  computeInboundAutomationNextDueAt,
} from "./user-inbound-sync.js";
import { classifyUserWorkingHours } from "./working-hours.js";
import { resolveScopedExecutionAssignment } from "./resolve-scoped-execution-assignment.js";
import { resolveConnectionNoteCapability } from "./connection-note-capability.js";
import {
  buildLinkedinPublicEngagementPlan,
  buildPublicEngagementMetadata,
} from "./select-linkedin-public-engagement.js";

const LIVE_SYNC_TASK_CAPABILITIES = new Set(["linkedin", "gmail"]);
const SUBJECT_DRAFT_SURFACES = new Set(["email", "in_mail_message"]);
const AUTONOMOUS_FULL_SURFACE_PAGE_CONFIG = {
  "linkedin-followers-list": { maxPages: 1, pageSize: 10 },
  "linkedin-following-list": { maxPages: 1, pageSize: 10 },
  "linkedin-profile-views": { maxPages: 1, pageSize: 10 },
  "linkedin-sent-invitations": { maxPages: 1, pageSize: 10 },
  "linkedin-received-invitations": { maxPages: 1, pageSize: 10 },
  "linkedin-messaging-inbox": { maxPages: 1, pageSize: 10 },
};
// Every full-mode (backfill) sync task runs as a bounded slice: the sync stops
// at the page budget with `page_budget_stopped_early`, persists `nextCursor`,
// and the still-open itemization gap requeues the next slice with
// `resumeCursor`. This keeps backfill interleavable instead of one
// multi-hour task that starves motion work.
const DEFAULT_AUTONOMOUS_FULL_SURFACE_MAX_PAGES = 2;
const MOTION_ROUND_ROBIN_TASK_KINDS = new Set([
  "company_discovery",
  "company_research",
  "prospect_selection",
  "prospect_research",
]);
const PUBLIC_ENGAGEMENT_DRAFT_SURFACES = new Set(["public_comment", "comment_reply"]);

/**
 * @param {{
 *   motions: any[],
 *   companies?: any[],
 *   profiles?: any[],
 *   users?: any[],
 *   observations?: any[],
 *   cues?: any[],
 *   hostState?: any,
 *   includeWaitingRetrieval?: boolean,
 *   now?: string | null
 * }} input
 * @returns {{
 *   count: number,
 *   itemCount: number,
 *   waitingCount: number,
 *   tasks: Array<Record<string, any>>,
 *   waiting: Array<Record<string, any>>,
 *   blockers: Array<Record<string, any>>
 * }}
 */
export function buildAgentQueue(input) {
  const now = normalizeNowIso(input.now);
  const includeWaitingRetrieval = input.includeWaitingRetrieval === true;
  const activeMotions = (input.motions ?? []).filter((motion) => isExecutionEligibleMotionStatus(motion?.status));
  const activeMotionIds = new Set(activeMotions.map((motion) => motion.id));
  const normalizedCues = normalizeInboundCues(input.cues ?? []);
  const profilesById = new Map((input.profiles ?? []).map((profile) => [profile.id, profile]));
  const companiesById = new Map((input.companies ?? []).map((company) => [company.id, company]));
  // Sender premium status per motion+company scope, which gates
  // Premium→Premium messaging to non-connections.
  const senderPremiumByScope = new Map();
  const senderPremiumByCompany = new Map();
  for (const motion of activeMotions) {
    for (const account of motion.targetMap?.accounts ?? []) {
      const rawCompany = companiesById.get(account.companyId) ?? null;
      if (!rawCompany) {
        continue;
      }

      let resolution = null;
      try {
        resolution = resolveScopedExecutionAssignment({
          rawCompany,
          rawMotion: motion,
          rawProfiles: input.profiles ?? [],
          rawUsers: input.users ?? [],
          capability: "linkedin",
        });
      } catch {
        resolution = null;
      }
      const fallbackResolvedAccount = resolution?.resolvedAccount ?? resolveAssignedLinkedinAccount(
        rawCompany.engagementUserAssignment,
        input.users ?? [],
      );
      const premiumStatus = resolveConnectionNoteCapability({
        resolvedAccount: fallbackResolvedAccount,
        accountRefs: resolution?.userAssignmentRecord?.accountRefs ?? rawCompany.engagementUserAssignment?.accountRefs ?? [],
      }) === true;
      senderPremiumByScope.set(`${motion.id}:${account.companyId}`, premiumStatus);
      if (!senderPremiumByCompany.has(account.companyId)) {
        senderPremiumByCompany.set(account.companyId, premiumStatus);
      }
    }
  }
  const queueProspectBranches = buildQueueProspectBranches(input, activeMotions, activeMotionIds, now);
  const queueProspectBranchesByAccount = groupBy(
    queueProspectBranches,
    (branch) => `${branch.motion.id}:${branch.account.companyId}`,
  );
  const prospectContextById = new Map();
  for (const { motion, account, prospect } of queueProspectBranches) {
    prospectContextById.set(prospect.id, { motion, account, prospect });
  }
  const tasks = [];
  const waiting = [];
  const blockers = [];
  const queuedCleanupKeys = new Set();

  for (const rawUser of input.users ?? []) {
    const syncView = buildUserInboundSyncView(rawUser);
    const workingHoursStatus = classifyUserWorkingHours(rawUser, now);
    const review = buildInboundReviewView(rawUser, input.observations ?? [], activeMotions, input.companies ?? []);
    const itemizationGapsByAccountId = groupBy(review.itemizationGaps, (gap) => gap.accountId);
    const openCuesByAccountId = groupBy(
      normalizedCues.filter((cue) => cue.userId === syncView.user.id && cue.status === "open"),
      (cue) => cue.accountId,
    );

    for (const account of syncView.accounts) {
      if (!LIVE_SYNC_TASK_CAPABILITIES.has(account.capability)) continue;
      if (!supportsAutonomousInboundSync(rawUser, account, profilesById)) continue;

      const itemizationGaps = itemizationGapsByAccountId.get(account.accountId) ?? [];
      const openCues = openCuesByAccountId.get(account.accountId) ?? [];
      const staleSurfaces = account.surfaces
        .filter((surface) => surface.enabled && surface.autonomousBackgroundRetrieval !== false)
        .map((surface) => ({
          ...surface,
          freshness: classifyInboundSurfaceFreshness(surface, now, { workingHoursStatus }),
        }))
        .filter((surface) => surface.freshness);

      if (!itemizationGaps.length && !openCues.length && !staleSurfaces.length) {
        if (!includeWaitingRetrieval) {
          continue;
        }
        const nextDueSurfaces = account.surfaces
          .filter((surface) => surface.enabled && surface.autonomousBackgroundRetrieval !== false)
          .map((surface) => ({
            ...surface,
            nextDueAt: computeInboundAutomationNextDueAt(surface, { workingHoursStatus }),
          }))
          .filter((surface) => typeof surface.nextDueAt === "string" && surface.nextDueAt.length > 0)
          .sort((left, right) => String(left.nextDueAt).localeCompare(String(right.nextDueAt)));
        if (!nextDueSurfaces.length) {
          continue;
        }
        const nextDueAt = nextDueSurfaces[0].nextDueAt;
        const scheduledSurfaces = nextDueSurfaces
          .filter((surface) => surface.nextDueAt === nextDueAt)
          .map((surface) => ({
            key: surface.key,
            label: surface.label,
          }));
        for (const scheduledSurface of scheduledSurfaces) {
          placeTask(buildInboundSyncTask({
            user: syncView.user,
            account,
            mode: "quick",
            itemizationSurfaceCount: 0,
            staleSurfaceCount: 0,
            cueCount: 0,
            surfaceKeys: [scheduledSurface.key],
            surfaceLabels: [scheduledSurface.label],
            dueAt: !workingHoursStatus.openNow && workingHoursStatus.nextOpenAt
              ? workingHoursStatus.nextOpenAt
              : nextDueAt,
            forceRetrieval: true,
            waitingReason: !workingHoursStatus.openNow && workingHoursStatus.nextOpenAt
              ? "outside_working_hours"
              : null,
          }), { now, tasks, waiting });
        }
        continue;
      }

      const gapsBySurfaceKey = groupBy(itemizationGaps, (gap) => gap.surfaceKey);
      const cuesBySurfaceKey = groupBy(openCues, (cue) => cue.surfaceKey);
      const staleSurfaceByKey = new Map(staleSurfaces.map((surface) => [surface.key, surface]));
      const fullSurfaceKeys = unique(itemizationGaps.map((gap) => gap.surfaceKey));

      for (const surfaceKey of fullSurfaceKeys) {
        const gapSurface = account.surfaces.find((surface) => surface.key === surfaceKey) ?? null;
        const staleSurface = staleSurfaceByKey.get(surfaceKey) ?? null;
        const surfaceCueCount = (cuesBySurfaceKey.get(surfaceKey) ?? []).length;
        const oldestDueAt = normalizeOptionalIso(
          unique(
            [
              gapSurface?.lastObservedAt ?? gapSurface?.lastSyncedAt ?? null,
              staleSurface?.freshness?.dueAt ?? staleSurface?.lastObservedAt ?? staleSurface?.lastSyncedAt ?? null,
              ...(cuesBySurfaceKey.get(surfaceKey) ?? []).map((cue) => cue.observedAt),
            ],
          )
            .filter(Boolean)
            .sort()[0] ?? now,
        ) ?? now;

        placeTask(buildInboundSyncTask({
          user: syncView.user,
          account,
          mode: "full",
          itemizationSurfaceCount: 1,
          staleSurfaceCount: staleSurface ? 1 : 0,
          cueCount: surfaceCueCount,
          surfaceKeys: [surfaceKey],
          surfaceLabels: [cueLabelForAccount(account, surfaceKey)],
          dueAt: !workingHoursStatus.openNow && workingHoursStatus.nextOpenAt
            ? workingHoursStatus.nextOpenAt
            : oldestDueAt,
          resumeCursor: normalizeNullableString(gapSurface?.nextCursor) ?? null,
          resumeStartOffset: Number.isInteger(gapSurface?.nextStartOffset) ? gapSurface.nextStartOffset : null,
          ...resolveAutonomousInboundPaginationConfig(surfaceKey),
          waitingReason: !workingHoursStatus.openNow && workingHoursStatus.nextOpenAt
            ? "outside_working_hours"
            : null,
        }), { now, tasks, waiting });
      }

      const quickSurfaceKeys = unique(
        staleSurfaces.map((surface) => surface.key)
          .concat(openCues.map((cue) => cue.surfaceKey)),
      ).filter((surfaceKey) => !fullSurfaceKeys.includes(surfaceKey));

      for (const surfaceKey of quickSurfaceKeys) {
        const staleSurface = staleSurfaceByKey.get(surfaceKey) ?? null;
        const surfaceCueCount = (cuesBySurfaceKey.get(surfaceKey) ?? []).length;
        const oldestDueAt = normalizeOptionalIso(
          unique(
            [
              staleSurface?.freshness?.dueAt ?? staleSurface?.lastObservedAt ?? staleSurface?.lastSyncedAt ?? null,
              ...(cuesBySurfaceKey.get(surfaceKey) ?? []).map((cue) => cue.observedAt),
            ],
          )
            .filter(Boolean)
            .sort()[0] ?? now,
        ) ?? now;

        placeTask(buildInboundSyncTask({
          user: syncView.user,
          account,
          mode: "quick",
          itemizationSurfaceCount: 0,
          staleSurfaceCount: staleSurface ? 1 : 0,
          cueCount: surfaceCueCount,
          surfaceKeys: [surfaceKey],
          surfaceLabels: [cueLabelForAccount(account, surfaceKey)],
          dueAt: !workingHoursStatus.openNow && workingHoursStatus.nextOpenAt
            ? workingHoursStatus.nextOpenAt
            : oldestDueAt,
          waitingReason: !workingHoursStatus.openNow && workingHoursStatus.nextOpenAt
            ? "outside_working_hours"
            : null,
        }), { now, tasks, waiting });
      }
    }
  }

  // Reject tasks: inbound invites the operator queued for rejection. The agent
  // performs the real decline on LinkedIn, then writes back the final declined
  // state. These need no prospect/motion — they act directly on the invite.
  for (const observation of input.observations ?? []) {
    if (observation?.kind !== "connection_request_decline_requested") continue;
    placeTask({
      kind: "reject_connection_request",
      action: "decline_connection",
      needsOperatorInput: false,
      observationId: observation.id,
      prospectName: observation.actorName ?? "inbound invite",
      companyName: observation.actorCompanyName ?? null,
      recipientUrl: observation.actorProfileUrl ?? null,
      surface: "received_invitation",
      // Run AFTER the invite is actually declined on LinkedIn: it transitions the
      // observation to connection_request_declined so it drops out for good.
      writeback: `exo actions result --action decline_connection --result declined --observation ${observation.id}`,
      queuedAt: observation.observedAt ?? null,
      dueAt: observation.observedAt ?? now,
    }, { now, tasks, waiting });
    continue;
  }

  // Operator-requested withdraws are already an explicit cleanup decision.
  // They should queue immediately, even if the stale auto-withdraw logic would
  // also match the older pending observation.
  for (const observation of input.observations ?? []) {
    if (observation?.kind !== "connection_request_withdraw_requested") continue;
    const context = observation?.prospectId ? prospectContextById.get(observation.prospectId) ?? null : null;
    const motion = context?.motion ?? null;
    const account = context?.account ?? null;
    const prospect = context?.prospect ?? null;
    const recipientUrl = prospect?.linkedinProfileUrl ?? observation.actorProfileUrl ?? observation.sourceUrl ?? null;
    if (!recipientUrl) continue;

    const cleanupKey = buildWithdrawCleanupKey(observation);
    if (queuedCleanupKeys.has(cleanupKey)) continue;
    queuedCleanupKeys.add(cleanupKey);

    placeTask({
      kind: "withdraw_connection",
      action: "withdraw_connection",
      needsOperatorInput: false,
      observationId: observation.id,
      motionId: motion?.id ?? observation.motionId ?? null,
      motionName: motion?.name ?? null,
      companyId: account?.companyId ?? observation.companyId ?? null,
      companyName: account?.companyName ?? observation.actorCompanyName ?? null,
      prospectId: prospect?.id ?? observation.prospectId ?? null,
      prospectName: prospect?.name ?? observation.actorName ?? "pending invite",
      recipientUrl,
      surface: "connection_request",
      reason: "operator_requested_withdraw",
      queuedAt: observation.observedAt ?? null,
      dueAt: observation.observedAt ?? now,
      writeback: buildActionResultWriteback({
        action: "withdraw_connection",
        result: "sent",
        motionId: motion?.id ?? observation.motionId ?? null,
        companyId: account?.companyId ?? observation.companyId ?? null,
        prospectId: prospect?.id ?? observation.prospectId ?? null,
        observationId: observation.id,
        surface: "withdraw_connection",
      }),
    }, { now, tasks, waiting });
  }

  // Stale outbound invites belong in the agent queue, not the operator
  // decision lane. Once the invite crosses policy age, the cleanup move is to
  // withdraw it automatically and let governed writeback collapse the branch.
  for (const observation of input.observations ?? []) {
    if (!isStalePendingConnectionRequest(observation)) continue;
    const context = observation?.prospectId ? prospectContextById.get(observation.prospectId) ?? null : null;
    const motion = context?.motion ?? null;
    const account = context?.account ?? null;
    const prospect = context?.prospect ?? null;
    if (prospect && (hasRecordedTouch(prospect, "withdraw_connection") || isConnected(prospect))) continue;
    const recipientUrl = prospect?.linkedinProfileUrl ?? observation.actorProfileUrl ?? observation.sourceUrl ?? null;
    if (!recipientUrl) continue;

    const cleanupKey = buildWithdrawCleanupKey(observation);
    if (queuedCleanupKeys.has(cleanupKey)) continue;
    queuedCleanupKeys.add(cleanupKey);

    placeTask({
      kind: "withdraw_connection",
      action: "withdraw_connection",
      needsOperatorInput: false,
      observationId: observation.id,
      motionId: motion?.id ?? observation.motionId ?? null,
      motionName: motion?.name ?? null,
      companyId: account?.companyId ?? observation.companyId ?? null,
      companyName: account?.companyName ?? observation.actorCompanyName ?? null,
      prospectId: prospect?.id ?? observation.prospectId ?? null,
      prospectName: prospect?.name ?? observation.actorName ?? "pending invite",
      recipientUrl,
      surface: "connection_request",
      reason: "stale_pending_invite",
      queuedAt: observation.observedAt ?? null,
      dueAt: observation.observedAt ?? now,
      writeback: buildActionResultWriteback({
        action: "withdraw_connection",
        result: "sent",
        motionId: motion?.id ?? observation.motionId ?? null,
        companyId: account?.companyId ?? observation.companyId ?? null,
        prospectId: prospect?.id ?? observation.prospectId ?? null,
        observationId: observation.id,
        surface: "withdraw_connection",
      }),
    }, { now, tasks, waiting });
  }
  for (const motion of activeMotions) {
    const discoveryTask = buildCompanyDiscoveryTask({
      motion,
      companies: input.companies ?? [],
    });
    if (discoveryTask) {
      placeTask(discoveryTask, { now, tasks, waiting });
    }

    for (const account of (motion.targetMap?.accounts ?? []).map((item) => normalizeAccountForAgentQueue(item, now))) {
      if (!isActiveDisposition(account?.disposition)) {
        continue;
      }
      const senderPremium = senderPremiumByScope.get(`${motion.id}:${account.companyId}`)
        ?? senderPremiumByCompany.get(account.companyId)
        ?? false;
      if (
        (account?.packetState?.kind === "company_research" && account.packetState?.status === "claimed")
        || isClaimableCompanyResearchAccount(account)
      ) {
        placeTask(buildCompanyResearchTask({
          motion,
          account,
        }), { now, tasks, waiting });
      }
      if (
        (account?.packetState?.kind === "prospect_selection" && account.packetState?.status === "claimed")
        || isClaimableProspectSelectionAccount(account)
      ) {
        placeTask(buildProspectSelectionTask({
          motion,
          account,
        }), { now, tasks, waiting });
      }
      const queueBranches = queueProspectBranchesByAccount.get(`${motion.id}:${account.companyId}`) ?? [];
      for (const branch of queueBranches) {
        const prospect = branch.prospect;
        if (!isActiveDisposition(prospect?.disposition)) continue;
        // Honor operator steers FIRST. A "do not contact / works for us" steer
        // removes the prospect from the loop entirely — the unattended agent
        // must never draft for or message someone the operator excluded.
        if (steerSuppression(prospect).suppressed) continue;
        if (
          !isAccountProspectSelectionClaimed(account)
          && (
            (prospect?.packetState?.kind === "prospect_research" && prospect.packetState?.status === "claimed")
            || isClaimableProspectResearchProspect(prospect)
          )
        ) {
          placeTask(buildProspectResearchTask({
            motion,
            account,
            prospect,
          }), { now, tasks, waiting });
        }
        const drafts = Array.isArray(prospect.drafts) ? prospect.drafts : [];
        const touches = Array.isArray(prospect.touches) ? prospect.touches : [];
        const publicEngagementPlan = buildLinkedinPublicEngagementPlan(prospect, now);
        handlePublicEngagementPlan({
          motion,
          account,
          prospect,
          publicEngagementPlan,
          drafts,
          now,
          tasks,
          waiting,
        });
        const publicDraftSurface = publicEngagementPlan.kind === "draft"
          ? publicEngagementPlan.selection?.surface ?? null
          : null;
        const candidateSurface = selectNextDraftSurface(prospect);
        const nextSurface = isQueueDraftSurfaceAvailable(prospect, candidateSurface)
          && !(publicDraftSurface && publicDraftSurface === candidateSurface)
          ? candidateSurface
          : null;
        const cadenceWindow = nextSurface ? resolveCadenceExecutionWindow(prospect, nextSurface, now) : null;
        const draftOnNextSurface = nextSurface
          ? drafts.find((draft) => draft.surface === nextSurface && isDraftActive(draft))
          : null;

        // 1) write_draft: the prospect's next message hasn't been drafted yet.
        //    Skip if any active draft (drafting/ready/queued/approved) already sits on
        //    the right surface — that one is either being worked or already
        //    queued in the current send path.
        if (nextSurface) {
          const needsRewrite = draftOnNextSurface ? isStructuredDraftEnvelope(draftOnNextSurface.body) : false;
          if (!draftOnNextSurface || needsRewrite) {
            placeTask(buildWriteDraftTask({
              motion,
              account,
              prospect,
              surface: nextSurface,
              reason: needsRewrite ? "rewrite_malformed_draft" : "no_draft",
              dueAt: cadenceWindow?.eligible === false ? (cadenceWindow.dueAt ?? null) : (cadenceWindow?.dueAt ?? now),
              waitingReason: cadenceWindow?.eligible === false ? cadenceWindow.reason : null,
            }), { now, tasks, waiting });
          }
        }

        // 2) Discard stale non-send-ready drafts on the wrong surface by
        //    queueing a rewrite. The agent picks the latest write_draft task
        //    for the prospect and writes on the current surface; old surface
        //    drafts get marked discarded via the writeback contract.
        for (const draft of drafts) {
          if (isAutonomousSendReadyDraft(draft) || draft.status === "sent" || draft.status === "discarded") continue;
          const staleness = classifyDraftStaleness(draft, nextSurface);
          if (!staleness.stale) continue;
          // Don't double-queue — the no_draft task above already covers
          // writing on the new surface. Just note the prior draft needs to
          // be discarded as part of the rewrite.
        }

        // 3) send_message: send-ready drafts ready to fire.
        for (const draft of drafts) {
          if (!isAutonomousSendReadyDraft(draft)) continue;
          if (isStructuredDraftEnvelope(draft.body)) continue;
          if (PUBLIC_ENGAGEMENT_DRAFT_SURFACES.has(String(draft.surface ?? ""))) continue;

          const staleness = classifyDraftStaleness(draft, nextSurface);
          if (staleness.stale) {
            // If the branch has already been re-drafted on the live surface,
            // the older send-ready draft is obsolete history, not a live
            // blocker. Keep the current draft flowing and drop the stale card.
            if (draftOnNextSurface) {
              continue;
            }
            // Once the inbound has already been answered, an old send-ready
            // draft on a dead surface is just stale history.
            if (!nextSurface && hasAnsweredInbound(touches)) {
              continue;
            }
            // The prospect did something after queueing that moved the next
            // surface. Don't auto-send — surface as a blocker so the
            // operator re-reviews.
            blockers.push({
              kind: "stale_send_ready_draft",
              reason: staleness.reason,
              motionId: motion.id,
              motionName: motion.name,
              companyId: account.companyId,
              companyName: account.companyName,
              prospectId: prospect.id,
              prospectName: prospect.name,
              sendReadySurface: draft.surface,
              nextSurface,
              queuedAt: draft.approvedAt ?? null,
              draftStatus: draft.status,
              resolveHint:
                nextSurface
                  ? `Re-review and re-queue on ${nextSurface.replaceAll("_", " ")}`
                  : "Re-review — no surface is currently writeable",
            });
            continue;
          }

          // A direct message needs a reachable recipient: a 1st-degree
          // connection, OR an Open Profile, OR Premium→Premium. If none hold,
          // it's not sendable — skip it so the loop never fires at an
          // unreachable recipient. (connection_request is exempt.)
          const requiresConnection = draft.surface === "post_accept_message" || draft.surface === "follow_up_direct_message";
          const reach = directMessageReach(prospect, senderPremium);
          if (requiresConnection && !reach) continue;
          if (Array.isArray(input.profiles)) {
            const rawCompany = companiesById.get(account.companyId) ?? null;
            const sendContract = rawCompany
              ? tryBuildSendHandoff(rawCompany, motion, input.profiles, input.users ?? [], {
                  prospectId: prospect.id,
                  surface: draft.surface,
                })
              : {
                  status: "blocked",
                  reason: `Company ${account.companyName} is not available for governed send resolution.`,
                };
            if (sendContract && sendContract.status !== "ready") {
              blockers.push({
                kind: "send_transport_blocked",
                reason: "execution_path_blocked",
                motionId: motion.id,
                motionName: motion.name,
                companyId: account.companyId,
                companyName: account.companyName,
                prospectId: prospect.id,
                prospectName: prospect.name,
                sendReadySurface: draft.surface,
                nextSurface,
                queuedAt: draft.approvedAt ?? null,
                draftStatus: draft.status,
                transportReason: sendContract.reason ?? "No governed send path is currently available.",
                resolveHint: sendContract.reason ?? "Repair the execution path before retrying this send.",
              });
              continue;
            }
          }
          const executionWindow = resolveCadenceExecutionWindow(prospect, draft.surface, now);
          const action = resolveSendTaskAction(draft);
          placeTask(buildSendMessageTask({
            motion,
            account,
            prospect,
            draft,
            action,
            via: resolveSendTaskVia(draft, requiresConnection ? reach : "connection"),
            dueAt: executionWindow.eligible === false ? (executionWindow.dueAt ?? null) : (executionWindow.dueAt ?? draft.approvedAt ?? now),
            waitingReason: executionWindow.eligible === false ? executionWindow.reason : null,
          }), { now, tasks, waiting });
        }
      }
    }
  }
  // Autonomous truth refresh and packet work first, then discovery refill,
  // then cleanup, then sends, then drafting. Discovery cards bias toward the
  // thinnest motion inventory first; other task classes still use oldest work.
  const taskComparator = (left, right) => taskOrder(left, right, input.hostState ?? null);
  tasks.sort(taskComparator);
  waiting.sort(taskComparator);
  const annotatedTasks = annotateTaskCheckouts(tasks, input.hostState ?? null, now);
  const annotatedWaiting = annotateTaskCheckouts(waiting, input.hostState ?? null, now);
  return {
    count: annotatedTasks.length,
    itemCount: annotatedTasks.length,
    waitingCount: annotatedWaiting.length,
    tasks: annotatedTasks,
    waiting: annotatedWaiting,
    blockers,
  };
}

/**
 * @param {{
 *   motion: any,
 *   companies: any[],
 * }} input
 */
function buildCompanyDiscoveryTask({ motion, companies }) {
  let demand;
  try {
    demand = buildMotionDiscoveryDemand(motion, companies);
  } catch {
    return null;
  }
  if (!demand.autonomousEligible || !demand.needsDiscovery || demand.targetCompanyCount < 1) {
    return null;
  }

  return {
    kind: "company_discovery",
    action: "discover_companies",
    needsOperatorInput: false,
    reason: "inventory_shortfall",
    motionId: demand.motion.id,
    motionName: demand.motion.name,
    companyId: null,
    companyName: demand.motion.name,
    prospectId: null,
    prospectName: `Discover at least ${demand.targetCompanyCount} compan${demand.targetCompanyCount === 1 ? "y" : "ies"}`,
    packetId: `company_discovery:${demand.motion.id}`,
    packetKind: "company_discovery",
    claimState: "claimable",
    surface: "company_discovery",
    queueStatus: null,
    targetCompanyCount: demand.targetCompanyCount,
    minimumAvailableProspects: demand.minimumAvailableProspects ?? undefined,
    availableProspectCount: demand.availableProspectCount,
    projectedAvailableProspectCount: demand.projectedAvailableProspectCount,
    deficitAfterBacklog: demand.deficitAfterBacklog,
    stakeholderTargetCount: demand.stakeholderTargetCount,
    expectedProspectYieldPerCompany: demand.expectedProspectYieldPerCompany,
    linkedCompanyCount: demand.linkedCompanyCount,
    whyItMatters: `${demand.motion.name} can only project ${demand.projectedAvailableProspectCount} available prospects against a floor of ${demand.minimumAvailableProspects}. Find at least ${demand.targetCompanyCount} more companies now so downstream research has real backlog instead of forcing weak-fit branches.`,
    briefCommand: `exo motion discovery-brief ${demand.motion.id} --companies ${demand.targetCompanyCount} --json`,
    queuedAt: demand.motion.updatedAt ?? demand.motion.createdAt ?? null,
    dueAt: demand.motion.updatedAt ?? demand.motion.createdAt ?? null,
    waitingReason: null,
  };
}

/**
 * @param {{
 *   motion: any,
 *   account: any,
 * }} input
 */
function buildCompanyResearchTask({ motion, account }) {
  const packetId = `company_research:${account.companyId}`;
  const packetState = account?.packetState?.kind === "company_research" ? account.packetState : null;
  const claimState = packetState?.status === "claimed"
    ? "claimed"
    : "claimable";
  const returned = packetState?.status === "returned";
  const queuedAt = packetState?.returnedAt ?? packetState?.claimedAt ?? account?.queueState?.updatedAt ?? null;
  return {
    kind: "company_research",
    action: "research_company",
    needsOperatorInput: false,
    reason: claimState === "claimed"
      ? "claimed_company_packet"
      : returned
        ? "returned_company_packet"
        : "claimable_company_packet",
    motionId: motion.id,
    motionName: motion.name,
    companyId: account.companyId,
    companyName: account.companyName,
    prospectName: account.companyName,
    packetId,
    packetKind: "company_research",
    claimState,
    surface: "company_research",
    workerLabel: claimState === "claimed" ? packetState?.workerLabel ?? null : null,
    queueStatus: account?.queueState?.status ?? null,
    whyItMatters: companyResearchTaskReason(account, claimState, returned),
    claimCommand: `exo companies queue claim ${account.companyId} --motion ${motion.id} --worker <worker-label> --json`,
    briefCommand: `exo motion packet-brief ${motion.id} --packet ${packetId} --json`,
    notes: packetReviewNotes(packetState),
    queuedAt,
    dueAt: queuedAt,
    waitingReason: null,
  };
}

/**
 * @param {any} account
 */
function isClaimableCompanyResearchAccount(account) {
  const queueStatus = account?.queueState?.status ?? "discovered";
  return isActiveDisposition(account?.disposition)
    && ["discovered", "queued_for_research"].includes(queueStatus)
    && !isPacketUnavailableForWorker(account?.packetState);
}

/**
 * Preserve stored account-level queue state and packet ownership, but derive
 * prospect queue state when older state snapshots or tests left it implicit.
 *
 * @param {any} rawAccount
 * @param {string} now
 */
function normalizeAccountForAgentQueue(rawAccount, now) {
  const account = /** @type {Record<string, any>} */ (rawAccount ?? {});
  return {
    ...account,
    prospects: Array.isArray(account.prospects)
      ? account.prospects.map((prospect) => withDerivedProspectQueueState(prospect, now))
      : [],
  };
}

/**
 * @param {any} account
 */
function isClaimableProspectSelectionAccount(account) {
  return isActiveDisposition(account?.disposition)
    && account?.queueState?.status === "researched"
    && !isPacketUnavailableForWorker(account?.packetState);
}

/**
 * @param {any} account
 */
function isAccountProspectSelectionClaimed(account) {
  return account?.packetState?.kind === "prospect_selection"
    && account?.packetState?.status === "claimed";
}

/**
 * @param {any} input
 * @param {any[]} activeMotions
 * @param {Set<string>} activeMotionIds
 * @param {string} now
 */
function buildQueueProspectBranches(input, activeMotions, activeMotionIds, now) {
  if (Array.isArray(input.prospectBranches)) {
    return input.prospectBranches
      .map((branch) => {
        const motion = branch?.motion ?? null;
        const prospect = branch?.prospect ? withDerivedProspectQueueState(branch.prospect, now) : null;
        const account = branch?.account
          ? {
              ...normalizeAccountForAgentQueue(branch.account, now),
              prospects: prospect ? [prospect] : [],
            }
          : null;
        return motion && account && prospect ? { motion, account, prospect } : null;
      })
      .filter((branch) =>
        branch
        && (
          activeMotionIds.size
            ? activeMotionIds.has(branch.motion.id)
            : isExecutionEligibleMotionStatus(branch.motion?.status)
        )
      );
  }

  return activeMotions.flatMap((motion) =>
    (motion.targetMap?.accounts ?? [])
      .map((item) => normalizeAccountForAgentQueue(item, now))
      .flatMap((account) =>
        (account.prospects ?? []).map((prospect) => ({ motion, account, prospect }))
      )
  );
}

/**
 * @param {any} prospect
 */
function isClaimableProspectResearchProspect(prospect) {
  return isActiveDisposition(prospect?.disposition)
    && prospect?.queueState?.status === "selected"
    && !isPacketUnavailableForWorker(prospect?.packetState);
}

/**
 * @param {unknown} disposition
 */
function isActiveDisposition(disposition) {
  return disposition == null || disposition === "active";
}

/**
 * @param {{
 *   motion: any,
 *   account: any,
 * }} input
 */
function buildProspectSelectionTask({ motion, account }) {
  const packetId = `prospect_selection:${account.companyId}`;
  const packetState = account?.packetState?.kind === "prospect_selection" ? account.packetState : null;
  const claimState = packetState?.status === "claimed"
    ? "claimed"
    : "claimable";
  const returned = packetState?.status === "returned";
  const queuedAt = packetState?.returnedAt ?? packetState?.claimedAt ?? account?.queueState?.updatedAt ?? null;
  return {
    kind: "prospect_selection",
    action: "select_prospects",
    needsOperatorInput: false,
    reason: claimState === "claimed"
      ? "claimed_prospect_selection_packet"
      : returned
        ? "returned_prospect_selection_packet"
        : "claimable_prospect_selection_packet",
    motionId: motion.id,
    motionName: motion.name,
    companyId: account.companyId,
    companyName: account.companyName,
    prospectName: account.companyName,
    packetId,
    packetKind: "prospect_selection",
    claimState,
    surface: "prospect_selection",
    workerLabel: claimState === "claimed" ? packetState?.workerLabel ?? null : null,
    queueStatus: account?.queueState?.status ?? null,
    whyItMatters: prospectSelectionTaskReason(account, claimState, returned),
    claimCommand: `exo companies queue claim ${account.companyId} --motion ${motion.id} --worker <worker-label> --json`,
    briefCommand: `exo motion packet-brief ${motion.id} --packet ${packetId} --json`,
    notes: packetReviewNotes(packetState),
    queuedAt,
    dueAt: queuedAt,
    waitingReason: null,
  };
}

/**
 * @param {{
 *   motion: any,
 *   account: any,
 *   prospect: any,
 * }} input
 */
function buildProspectResearchTask({ motion, account, prospect }) {
  const packetId = `prospect_research:${account.companyId}:${prospect.id}`;
  const packetState = prospect?.packetState?.kind === "prospect_research" ? prospect.packetState : null;
  const claimState = packetState?.status === "claimed"
    ? "claimed"
    : "claimable";
  const returned = packetState?.status === "returned";
  const queuedAt = packetState?.returnedAt ?? packetState?.claimedAt ?? prospect?.queueState?.updatedAt ?? account?.queueState?.updatedAt ?? null;
  return {
    kind: "prospect_research",
    action: "research_prospect",
    needsOperatorInput: false,
    reason: claimState === "claimed"
      ? "claimed_prospect_research_packet"
      : returned
        ? "returned_prospect_research_packet"
        : "claimable_prospect_research_packet",
    motionId: motion.id,
    motionName: motion.name,
    companyId: account.companyId,
    companyName: account.companyName,
    prospectId: prospect.id,
    prospectName: prospect.name,
    packetId,
    packetKind: "prospect_research",
    claimState,
    surface: "prospect_research",
    workerLabel: claimState === "claimed" ? packetState?.workerLabel ?? null : null,
    queueStatus: prospect?.queueState?.status ?? null,
    whyItMatters: prospectResearchTaskReason(prospect, claimState, returned),
    claimCommand: `exo companies prospects claim ${account.companyId} --motion ${motion.id} --prospect ${prospect.id} --worker <worker-label> --json`,
    briefCommand: `exo motion packet-brief ${motion.id} --packet ${packetId} --json`,
    notes: packetReviewNotes(packetState),
    queuedAt,
    dueAt: queuedAt,
    waitingReason: null,
  };
}

/**
 * @param {any} packetState
 */
function isPacketUnavailableForWorker(packetState) {
  return packetState?.status === "claimed" || packetState?.status === "submitted";
}

/**
 * @param {any} packetState
 */
function packetReviewNotes(packetState) {
  if (!packetState) return null;
  return packetState.returnNotes ?? packetState.notes ?? null;
}

/**
 * @param {any} account
 * @param {"claimed" | "claimable"} claimState
 * @param {boolean} returned
 */
function companyResearchTaskReason(account, claimState, returned) {
  if (claimState === "claimed") {
    return `${account.companyName} was explicitly claimed for governed company research and is still blocking downstream prospect inventory.`;
  }
  if (returned) {
    return `${account.companyName} has returned company-research review notes and can be claimed for redo now.`;
  }
  return `${account.companyName} is already in the motion backlog and can be claimed and researched now without operator input.`;
}

/**
 * @param {any} account
 * @param {"claimed" | "claimable"} claimState
 * @param {boolean} returned
 */
function prospectSelectionTaskReason(account, claimState, returned) {
  if (claimState === "claimed") {
    return `${account.companyName} already has a claimed stakeholder-selection packet and still needs the chosen prospect set landed before deeper research can start.`;
  }
  if (returned) {
    return `${account.companyName} has returned stakeholder-selection review notes and can be claimed for redo now.`;
  }
  return `${account.companyName} is already researched and can advance now by storing the smallest credible stakeholder set without operator input.`;
}

/**
 * @param {any} prospect
 * @param {"claimed" | "claimable"} claimState
 * @param {boolean} returned
 */
function prospectResearchTaskReason(prospect, claimState, returned) {
  if (claimState === "claimed") {
    return `${prospect.name} already has a claimed prospect-research packet and still needs governed research, enrichment, and cadence before the branch can become usable inventory.`;
  }
  if (returned) {
    return `${prospect.name} has returned prospect-research review notes and can be claimed for redo now.`;
  }
  return `${prospect.name} is already selected and can advance now through governed research, enrichment, and cadence planning without operator input.`;
}

/**
 * @param {{
 *   motion: any,
 *   account: any,
 *   prospect: any,
 *   publicEngagementPlan: any,
 *   drafts: any[],
 *   now: string,
 *   tasks: Array<Record<string, any>>,
 *   waiting: Array<Record<string, any>>,
 * }} input
 */
function handlePublicEngagementPlan({ motion, account, prospect, publicEngagementPlan, drafts, now, tasks, waiting }) {
  if (!publicEngagementPlan || publicEngagementPlan.kind === "none" || publicEngagementPlan.kind === "skip") {
    return;
  }

  const selection = publicEngagementPlan.selection ?? null;
  if (!selection) {
    return;
  }

  if (publicEngagementPlan.kind === "draft") {
    const activeDraft = drafts.find((draft) => draft.surface === selection.surface && isDraftActive(draft)) ?? null;
    const metadataNotes = buildPublicEngagementMetadata({
      mode: publicEngagementPlan.mode,
      phase: publicEngagementPlan.phase ?? null,
      targetUrl: selection.targetUrl ?? null,
      targetKind: selection.targetKind ?? null,
      actionKey: selection.actionKey ?? null,
      detail: selection.selectionReason ?? null,
    });

    if (!activeDraft || isStructuredDraftEnvelope(activeDraft.body)) {
      placeTask(buildWriteDraftTask({
        motion,
        account,
        prospect,
        surface: selection.surface,
        reason: publicEngagementPlan.reason ?? "public_engagement",
        dueAt: publicEngagementPlan.dueAt ?? now,
        waitingReason: null,
        notes: metadataNotes,
      }), { now, tasks, waiting });
      return;
    }

    if (isAutonomousSendReadyDraft(activeDraft)) {
      placeTask(buildSendMessageTask({
        motion,
        account,
        prospect,
        draft: activeDraft,
        action: selection.actionKey,
        via: "public-engagement",
        dueAt: publicEngagementPlan.dueAt ?? activeDraft.approvedAt ?? now,
        waitingReason: null,
        recipientUrl: selection.targetUrl,
        postSendNextAction: publicEngagementPlan.phase === "pre_connect"
          ? "Wait 48 hours, then queue the connection-request draft for review."
          : null,
        postSendDelayMs: publicEngagementPlan.phase === "pre_connect" ? 48 * 60 * 60 * 1000 : null,
        writeback: buildPublicEngagementResultWriteback({
          motion,
          account,
          prospect,
          action: selection.actionKey,
          surface: selection.surface,
          result: "sent",
          sourceUrl: selection.targetUrl,
          summary: buildPublicEngagementSummary(selection, publicEngagementPlan),
          notes: metadataNotes,
        }),
        unavailableWriteback: buildPublicEngagementResultWriteback({
          motion,
          account,
          prospect,
          action: selection.actionKey,
          surface: selection.surface,
          result: "unavailable",
          sourceUrl: selection.targetUrl,
          summary: `Stored LinkedIn ${selection.targetKind} target was no longer writable for ${prospect.name}.`,
          notes: metadataNotes,
        }),
      }), { now, tasks, waiting });
    }
    return;
  }

  if (publicEngagementPlan.kind === "send") {
    const metadataNotes = buildPublicEngagementMetadata({
      mode: publicEngagementPlan.mode,
      phase: publicEngagementPlan.phase ?? null,
      targetUrl: selection.targetUrl ?? null,
      targetKind: selection.targetKind ?? null,
      actionKey: selection.actionKey ?? null,
      detail: selection.selectionReason ?? null,
    });
    const writebackByTargetUrl = {
      [selection.targetUrl]: buildPublicEngagementResultWriteback({
        motion,
        account,
        prospect,
        action: selection.actionKey,
        surface: selection.surface,
        result: "sent",
        sourceUrl: selection.targetUrl,
        summary: buildPublicEngagementSummary(selection, publicEngagementPlan),
        notes: metadataNotes,
      }),
    };
    if (publicEngagementPlan.fallbackSelection?.targetUrl) {
      const fallbackSelection = publicEngagementPlan.fallbackSelection;
      writebackByTargetUrl[fallbackSelection.targetUrl] = buildPublicEngagementResultWriteback({
        motion,
        account,
        prospect,
        action: fallbackSelection.actionKey,
        surface: fallbackSelection.surface,
        result: "sent",
        sourceUrl: fallbackSelection.targetUrl,
        summary: buildPublicEngagementSummary(fallbackSelection, publicEngagementPlan),
        notes: buildPublicEngagementMetadata({
          mode: publicEngagementPlan.mode,
          phase: publicEngagementPlan.phase ?? null,
          targetUrl: fallbackSelection.targetUrl,
          targetKind: fallbackSelection.targetKind ?? null,
          actionKey: fallbackSelection.actionKey ?? null,
          detail: `${fallbackSelection.selectionReason ?? "Fallback public target."} Original target was unavailable.`,
        }),
      });
    }
    placeTask(buildSendMessageTask({
      motion,
      account,
      prospect,
      action: selection.actionKey,
      via: "public-engagement",
      surface: selection.surface,
      channel: "linkedin",
      body: "",
      subject: null,
      queuedAt: publicEngagementPlan.dueAt ?? now,
      dueAt: publicEngagementPlan.dueAt ?? now,
      waitingReason: null,
      recipientUrl: selection.targetUrl,
      postSendNextAction: publicEngagementPlan.phase === "pre_connect"
        ? "Wait 48 hours, then queue the connection-request draft for review."
        : null,
      postSendDelayMs: publicEngagementPlan.phase === "pre_connect" ? 48 * 60 * 60 * 1000 : null,
      writeback: writebackByTargetUrl[selection.targetUrl],
      writebackByTargetUrl,
      unavailableWriteback: buildPublicEngagementResultWriteback({
        motion,
        account,
        prospect,
        action: selection.actionKey,
        surface: selection.surface,
        result: "unavailable",
        sourceUrl: selection.targetUrl,
        summary: `Stored LinkedIn ${selection.targetKind} target was unavailable for ${prospect.name}.`,
        notes: metadataNotes,
      }),
    }), { now, tasks, waiting });
  }
}

/**
 * @param {{
 *   motion: any,
  *   account: any,
  *   prospect: any,
  *   surface: string,
  *   reason: string,
 *   dueAt: string | null,
 *   waitingReason: string | null,
 *   notes?: string | null,
 * }} input
 */
function buildWriteDraftTask({ motion, account, prospect, surface, reason, dueAt, waitingReason, notes = null }) {
  const motionFlag = motion.id ? ` --motion ${motion.id}` : "";
  const status = draftWritebackStatusForSurface(surface);
  const subjectFlag = SUBJECT_DRAFT_SURFACES.has(surface) ? ' --subject "<written-subject>"' : "";
  const notesFlag = notes ? ` --notes ${shellQuote(notes)}` : "";
  return {
    kind: "write_draft",
    needsOperatorInput: false,
    reason,
    motionId: motion.id,
    motionName: motion.name,
    companyId: account.companyId,
    companyName: account.companyName,
    prospectId: prospect.id,
    prospectName: prospect.name,
    surface,
    // The brief is everything the agent needs to write in-voice: signals,
    // cadence, prior touches, surface rules. The writeback leaves the draft
    // in `ready` so the operator can review and approve it before send.
    briefCommand: `exo motion draft-brief ${motion.id} --prospect ${prospect.id} --surface ${surface} --json`,
    writeback: `exo companies prospects draft set ${account.companyId} --prospect ${prospect.id}${motionFlag} --surface ${surface} --status ${status}${subjectFlag}${notesFlag} --body "<written-body>"`,
    postWriteStatus: status,
    dueAt,
    waitingReason,
    // No approvedAt for these — they sort ahead of send tasks by default,
    // because nothing can be sent until something is drafted.
    queuedAt: prospect?.cadenceState?.updatedAt ?? null,
  };
}

/**
 * @param {{
 *   user: { id: string, label: string },
 *   account: ReturnType<typeof buildUserInboundSyncView>["accounts"][number],
 *   mode: "quick" | "full",
 *   itemizationSurfaceCount: number,
 *   staleSurfaceCount: number,
 *   cueCount: number,
 *   surfaceKeys: string[],
 *   surfaceLabels: string[],
 *   dueAt: string | null,
 *   resumeCursor?: string | null,
 *   resumeStartOffset?: number | null,
 *   maxPages?: number | null,
 *   pageSize?: number | null,
 *   forceRetrieval?: boolean,
 *   waitingReason?: string | null,
 * }} input
 */
function buildInboundSyncTask({
  user,
  account,
  mode,
  itemizationSurfaceCount,
  staleSurfaceCount,
  cueCount,
  surfaceKeys,
  surfaceLabels,
  dueAt,
  resumeCursor = null,
  resumeStartOffset = null,
  maxPages = null,
  pageSize = null,
  forceRetrieval = false,
  waitingReason = null,
}) {
  const capabilityLabel = humanizeCapability(account.capability);
  const reason = forceRetrieval
    ? "manual_force_retrieval"
    : itemizationSurfaceCount > 0
      ? "itemization_gap"
      : cueCount > 0
        ? "sync_hint"
        : "stale_surface";
  const whyItMatters = forceRetrieval
    ? `This manual host pass is forcing an early ${capabilityLabel} truth refresh for ${surfaceLabels.join(", ")} instead of waiting for the next stale window.`
    : itemizationSurfaceCount > 0
      ? `${surfaceLabels.join(", ")} still ${itemizationSurfaceCount === 1 ? "has" : "have"} concrete inbound items that were counted but not itemized, so Exo cannot tell the operator exactly what changed.`
      : cueCount > 0
        ? `Ambient inbound cues suggest something changed on ${surfaceLabels.join(", ")}. Exo should refresh canonical truth before trusting silence.`
        : `${surfaceLabels.join(", ")} ${staleSurfaceCount === 1 ? "is" : "are"} stale enough that Exo should refresh canonical truth before trusting the current inbox state.`;

  return {
    kind: "run_inbound_sync",
    action: "run_inbound_sync",
    needsOperatorInput: false,
    reason,
    whyItMatters,
    userId: user.id,
    userLabel: user.label,
    accountId: account.accountId,
    accountHandle: account.handle,
    capability: account.capability,
    motionId: null,
    motionName: null,
    companyId: account.accountId,
    companyName: `${capabilityLabel}:${account.handle}`,
    prospectName: `${capabilityLabel} inbound truth`,
    surface: surfaceKeys[0] ?? null,
    surfaceKeys,
    surfaceLabels,
    mode,
    resumeCursor,
    resumeStartOffset,
    maxPages,
    pageSize,
    queuedAt: dueAt,
    dueAt,
    waitingReason,
    contractCommand: buildInboundSyncContractCommand({
      userId: user.id,
      accountId: account.accountId,
      capability: account.capability,
      surfaceKeys,
      mode,
      resumeCursor,
      resumeStartOffset,
      maxPages,
      pageSize,
    }),
    applyCommand: `exo inbound sync run ${user.id} --input <combined-inbound-sync.json> --refresh --json`,
    verificationCommands: [
      `exo inbox --user ${user.id} --json`,
      `exo daily --user ${user.id} --json`,
      `exo next --user ${user.id} --json`,
    ],
  };
}

/**
 * @param {{
 *   motion: any,
 *   account: any,
 *   prospect: any,
 *   draft?: any,
 *   action: string,
 *   via: string,
 *   dueAt: string | null,
 *   waitingReason: string | null,
 *   surface?: string | null,
 *   channel?: string | null,
 *   subject?: string | null,
 *   body?: string | null,
 *   queuedAt?: string | null,
 *   recipientUrl?: string | null,
 *   writeback?: string | null,
 *   writebackByTargetUrl?: Record<string, string> | null,
 *   unavailableWriteback?: string | null,
 *   postSendNextAction?: string | null,
 *   postSendDelayMs?: number | null,
 * }} input
 */
function buildSendMessageTask({
  motion,
  account,
  prospect,
  draft = null,
  action,
  via,
  dueAt,
  waitingReason,
  surface = null,
  channel = null,
  subject = null,
  body = null,
  queuedAt = null,
  recipientUrl = null,
  writeback = null,
  writebackByTargetUrl = null,
  unavailableWriteback = null,
  postSendNextAction = null,
  postSendDelayMs = null,
}) {
  const authoredBy = draft?.authoredBy === "operator" ? "operator" : "agent";
  const editedByOperator = draft?.editedByOperator === true;
  const approvedByOperator = draft?.approvedByOperator === true || draft?.status === "approved";
  const resolvedSurface = draft?.surface ?? surface;
  return {
    kind: "send_message",
    action,
    needsOperatorInput: false,
    motionId: motion.id,
    motionName: motion.name,
    companyId: account.companyId,
    companyName: account.companyName,
    prospectId: prospect.id,
    prospectName: prospect.name,
    recipientUrl: recipientUrl ?? resolveSendTaskRecipient(prospect, draft),
    recipientEmail: resolveSendTaskRecipientEmail(prospect, draft),
    surface: resolvedSurface,
    channel: draft?.channel ?? channel,
    via,
    subject: draft?.subject ?? subject,
    body: draft ? (extractUsableDraftBody(draft.body) ?? (draft.body ?? "")) : (body ?? ""),
    authoredBy,
    editedByOperator,
    approvedByOperator,
    queuedAt: draft?.approvedAt ?? queuedAt,
    dueAt,
    waitingReason,
    // Run this AFTER the send actually happens — it records the outbound
    // touch (so the timeline shows "Sent"), marks the draft sent, and
    // advances cadence to "wait for a reply before the next step".
    writeback: writeback ?? `exo actions result --action ${action} --result sent --company ${account.companyId} --prospect ${prospect.id} --motion ${motion.id} --surface ${resolvedSurface}`,
    writebackByTargetUrl,
    unavailableWriteback,
    postSendNextAction,
    postSendDelayMs: Number.isFinite(postSendDelayMs) ? Number(postSendDelayMs) : null,
  };
}

/**
 * @param {any} selection
 * @param {any} plan
 */
function buildPublicEngagementSummary(selection, plan) {
  if (selection.actionKey === "create_post_comment") {
    return `Published a checked public comment on ${selection.targetKind === "comment" ? "the comment thread" : "the LinkedIn post"} for warmup.`;
  }
  if (selection.actionKey === "create_comment_comment") {
    return plan.mode === "reactive"
      ? "Published a checked in-thread reply after the prospect answered our public comment."
      : "Published a checked public reply on the prospect's LinkedIn comment thread.";
  }
  return selection.targetKind === "comment"
    ? "Left a lightweight reaction on the stored LinkedIn comment thread."
    : "Left a lightweight reaction on the stored LinkedIn post.";
}

/**
 * @param {{
 *   motion: any,
 *   account: any,
 *   prospect: any,
 *   action: string,
 *   surface: string,
 *   result: string,
 *   sourceUrl?: string | null,
 *   summary?: string | null,
 *   notes?: string | null,
 *   nextAction?: string | null,
 *   nextActionDueAt?: string | null,
 * }} input
 */
function buildPublicEngagementResultWriteback(input) {
  return buildActionResultWriteback({
    action: input.action,
    result: input.result,
    motionId: input.motion?.id ?? null,
    companyId: input.account?.companyId ?? null,
    prospectId: input.prospect?.id ?? null,
    surface: input.surface,
    sourceUrl: input.sourceUrl ?? null,
    summary: input.summary ?? null,
    notes: input.notes ?? null,
    nextAction: input.nextAction ?? null,
    nextActionDueAt: input.nextActionDueAt ?? null,
  });
}

/**
 * @param {any} rawCompany
 * @param {any} rawMotion
 * @param {any[]} rawProfiles
 * @param {any[]} rawUsers
 * @param {{ prospectId: string, surface: string }} input
 */
function tryBuildSendHandoff(rawCompany, rawMotion, rawProfiles, rawUsers, input) {
  try {
    return buildSendHandoff(rawCompany, rawMotion, rawProfiles, rawUsers, input);
  } catch {
    return null;
  }
}

/** @param {any} draft */
function resolveSendTaskAction(draft) {
  if (draft?.surface === "connection_request") return "send_connection_request";
  if (draft?.surface === "in_mail_message") return "in_mail_message";
  if (draft?.surface === "email" || draft?.channel === "email") return "send_email";
  if (draft?.surface === "public_comment") return "create_post_comment";
  if (draft?.surface === "comment_reply") return "create_comment_comment";
  return "send_direct_message";
}

/**
 * @param {any} draft
 * @param {string} fallback
 */
function resolveSendTaskVia(draft, fallback) {
  if (draft?.surface === "email" || draft?.channel === "email") return "email";
  return fallback;
}

/**
 * @param {any} prospect
 * @param {any} draft
 */
function resolveSendTaskRecipient(prospect, draft) {
  if (draft?.surface === "email" || draft?.channel === "email") {
    return normalizeRecipientString(prospect?.sourceUrl)
      ?? normalizeRecipientString(prospect?.email)
      ?? null;
  }
  return normalizeRecipientString(prospect?.linkedinProfileUrl) ?? null;
}

/**
 * @param {any} prospect
 * @param {any} draft
 */
function resolveSendTaskRecipientEmail(prospect, draft) {
  if (draft?.surface !== "email" && draft?.channel !== "email") return null;
  return normalizeRecipientString(prospect?.email) ?? null;
}

/** @param {unknown} value */
function normalizeRecipientString(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

/**
 * @param {{
 *   motion: any,
 *   account: any,
 *   prospect: any,
 * }} input
 */
/**
 * Sort by queue class, then by the oldest relevant queue timestamp.
 * @param {any} a
 * @param {any} b
 * @param {any} [hostState]
 */
function taskOrder(a, b, hostState = null) {
  // Quick inbound sync stays first: it is fast and refreshes the reply/invite
  // truth that gates safe sending. Full backfill sync (initial itemization /
  // deep history) ranks LAST so a fresh project starts motion work immediately
  // instead of grinding through hours of surface backfill. Backfill still
  // progresses via bounded slices interleaved by the host pass scheduler.
  const rank = {
    run_inbound_sync_quick: 0,
    company_research: 1,
    prospect_selection: 2,
    prospect_research: 3,
    company_discovery: 4,
    reject_connection_request: 5,
    withdraw_connection: 6,
    send_message: 7,
    write_draft: 8,
    run_inbound_sync_full: 9,
  };
  if (isMotionRoundRobinTask(a) && isMotionRoundRobinTask(b)) {
    const motionComparison = compareMotionTaskOrderAcrossKinds(a, b, hostState);
    if (motionComparison !== 0) return motionComparison;
  }
  const aRank = rank[taskRankKey(a)] ?? 99;
  const bRank = rank[taskRankKey(b)] ?? 99;
  if (aRank !== bRank) return aRank - bRank;
  if (a.kind === "company_discovery" && b.kind === "company_discovery") {
    const deficitDelta = normalizeDiscoveryDeficit(b) - normalizeDiscoveryDeficit(a);
    if (deficitDelta !== 0) return deficitDelta;
  }
  const aKey = a.dueAt ?? a.queuedAt ?? a.approvedAt ?? null;
  const bKey = b.dueAt ?? b.queuedAt ?? b.approvedAt ?? null;
  return String(aKey ?? "").localeCompare(String(bKey ?? ""));
}

/**
 * Full-mode inbound sync is backfill work (initial itemization, deep history)
 * and ranks behind motion execution; everything else ranks by kind.
 * @param {any} task
 */
function taskRankKey(task) {
  if (task?.kind !== "run_inbound_sync") return task?.kind;
  return task?.mode === "full" ? "run_inbound_sync_full" : "run_inbound_sync_quick";
}

/** @param {any} task */
export function isBackfillInboundSyncTask(task) {
  return task?.kind === "run_inbound_sync" && task?.mode === "full";
}

/** @param {any} task */
function isMotionRoundRobinTask(task) {
  return MOTION_ROUND_ROBIN_TASK_KINDS.has(task?.kind)
    && typeof task?.motionId === "string"
    && task.motionId.trim().length > 0;
}

/**
 * @param {any} left
 * @param {any} right
 * @param {any} hostState
 */
function compareMotionTaskOrderAcrossKinds(left, right, hostState) {
  if (left?.motionId === right?.motionId) {
    return 0;
  }

  const leftRunAt = getRecentMotionRunAt(hostState, left?.motionId, MOTION_ROUND_ROBIN_TASK_KINDS);
  const rightRunAt = getRecentMotionRunAt(hostState, right?.motionId, MOTION_ROUND_ROBIN_TASK_KINDS);
  if (leftRunAt !== rightRunAt) {
    if (!leftRunAt) return -1;
    if (!rightRunAt) return 1;
    return leftRunAt.localeCompare(rightRunAt);
  }

  return 0;
}

/** @param {any} task */
function normalizeDiscoveryDeficit(task) {
  const deficit = Number(task?.deficitAfterBacklog);
  return Number.isFinite(deficit) ? Math.max(0, Math.floor(deficit)) : 0;
}

/**
 * @param {Record<string, any>} task
 * @param {{ now: string, tasks: Array<Record<string, any>>, waiting: Array<Record<string, any>> }} buckets
 */
function placeTask(task, buckets) {
  const waitingReason = task.waitingReason ?? null;
  const explicitDueAt = normalizeOptionalIso(task.dueAt);
  const dueAt = waitingReason
    ? explicitDueAt ?? null
    : explicitDueAt ?? normalizeOptionalIso(task.queuedAt) ?? buckets.now;
  const queueState = waitingReason || dueAt > buckets.now ? "waiting" : "due_now";
  const enriched = {
    ...task,
    dueAt,
    waitingReason,
    queueState,
  };
  if (queueState === "waiting") {
    buckets.waiting.push(enriched);
    return;
  }
  buckets.tasks.push(enriched);
}

/**
 * @param {Array<Record<string, any>>} items
 * @param {any} hostState
 * @param {string} now
 */
function annotateTaskCheckouts(items, hostState, now) {
  return items.map((item) => annotateTaskCheckout(item, hostState, now));
}

/**
 * @param {Record<string, any>} task
 * @param {any} hostState
 * @param {string} now
 */
function annotateTaskCheckout(task, hostState, now) {
  const checkoutFingerprint = createTaskLeaseFingerprint(task);
  const lease = getActiveTaskLease(hostState, checkoutFingerprint, now);
  return {
    ...task,
    checkoutFingerprint,
    checkoutState: lease ? "checked_out" : null,
    checkedOutBy: lease?.workerLabel ?? null,
    checkedOutAt: lease?.acquiredAt ?? null,
    checkoutExpiresAt: lease?.expiresAt ?? null,
  };
}

/**
 * @param {{
 *   action: string,
 *   result: string,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   observationId?: string | null,
 *   surface?: string | null,
 *   sourceUrl?: string | null,
 *   summary?: string | null,
 *   notes?: string | null,
 *   nextAction?: string | null,
 *   nextActionDueAt?: string | null,
 * }} input
 */
function buildActionResultWriteback(input) {
  const parts = [
    `exo actions result --action ${input.action} --result ${input.result}`,
  ];
  if (input.companyId) parts.push(`--company ${input.companyId}`);
  if (input.prospectId) parts.push(`--prospect ${input.prospectId}`);
  if (input.motionId) parts.push(`--motion ${input.motionId}`);
  if (input.observationId) parts.push(`--observation ${input.observationId}`);
  if (input.surface) parts.push(`--surface ${input.surface}`);
  if (input.sourceUrl) parts.push(`--source-url ${shellQuote(input.sourceUrl)}`);
  if (input.summary) parts.push(`--summary ${shellQuote(input.summary)}`);
  if (input.notes) parts.push(`--notes ${shellQuote(input.notes)}`);
  if (input.nextAction) parts.push(`--next-action ${shellQuote(input.nextAction)}`);
  if (input.nextActionDueAt) parts.push(`--next-action-due-at ${input.nextActionDueAt}`);
  return parts.join(" ");
}

/**
 * @param {{
 *   prospectId?: string | null,
 *   externalId?: string | null,
 *   actorProfileUrl?: string | null,
 *   id?: string | null,
 * }} observation
 */
function buildWithdrawCleanupKey(observation) {
  return observation.prospectId
    ? `withdraw::${observation.prospectId}`
    : observation.externalId
      ? `withdraw::${observation.externalId}`
      : observation.actorProfileUrl
        ? `withdraw::${observation.actorProfileUrl}`
        : `withdraw::${observation.id ?? "unknown"}`;
}

/**
 * @param {any} prospect
 * @param {string} surface
 * @param {string} now
 * @returns {{ eligible: boolean, dueAt: string | null, reason: string | null }}
 */
function resolveCadenceExecutionWindow(prospect, surface, now) {
  if (surface === "inbound_reply") {
    return {
      eligible: true,
      dueAt: latestInboundOccurredAt(prospect) ?? now,
      reason: null,
    };
  }

  if (surface === "comment_reply") {
    return {
      eligible: true,
      dueAt: latestCommentInboundOccurredAt(prospect) ?? now,
      reason: null,
    };
  }

  const cadence = prospect?.cadenceState ?? {};
  const notes = normalizeCadenceNotes(cadence.notes);
  const dueAt = normalizeOptionalIso(cadence.nextActionDueAt);

  if (!cadence.lastTouchOutcome && isHeldInReserve(notes)) {
    return { eligible: false, dueAt, reason: "held_in_reserve" };
  }

  if (isConnectionRequestInFlight(cadence)) {
    return { eligible: false, dueAt, reason: "waiting_for_connection_response" };
  }

  if (cadence.lastTouchOutcome === "sent") {
    if (dueAt && dueAt <= now) {
      return { eligible: true, dueAt, reason: null };
    }
    return { eligible: false, dueAt, reason: "waiting_on_outbound" };
  }

  if (dueAt && dueAt > now) {
    return { eligible: false, dueAt, reason: "not_due_yet" };
  }

  return { eligible: true, dueAt: dueAt ?? now, reason: null };
}

/**
 * @param {any} prospect
 * @param {string} surface
 */
function hasRecordedTouch(prospect, surface) {
  return (prospect?.touches ?? []).some(
    (touch) => touch.surface === surface && touch.direction !== "inbound" && touch.outcome !== "blocked",
  );
}

/**
 * @param {any} prospect
 * @param {string} surface
 */
function latestTouchOccurredAt(prospect, surface) {
  return (prospect?.touches ?? [])
    .filter((touch) => touch.surface === surface && touch.direction !== "inbound")
    .map((touch) => touch.occurredAt ?? null)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

/**
 * @param {any} prospect
 */
function latestInboundOccurredAt(prospect) {
  return (prospect?.touches ?? [])
    .filter((touch) => touch.direction === "inbound")
    .map((touch) => touch.occurredAt ?? null)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

/**
 * @param {any} prospect
 */
function latestCommentInboundOccurredAt(prospect) {
  return (prospect?.touches ?? [])
    .filter((touch) =>
      touch.direction === "inbound" && (touch.surface === "public_comment" || touch.surface === "comment_reply"),
    )
    .map((touch) => touch.occurredAt ?? null)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

/** @param {string | null | undefined} notes */
function normalizeCadenceNotes(notes) {
  return String(notes ?? "").trim().toLowerCase();
}

/** @param {string} notes */
function isHeldInReserve(notes) {
  return notes.includes("on hold") || notes.includes("held behind") || notes.includes("wait for operator");
}

/** @param {string | null | undefined} value */
function normalizeOptionalIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {string} value
 */
function shellQuote(value) {
  if (value === "") return "''";
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** @param {string | null | undefined} value */
function normalizeNowIso(value) {
  return normalizeOptionalIso(value) ?? new Date().toISOString();
}

/** @param {string | null | undefined} value */
function normalizeNullableString(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string} surfaceKey
 */
function resolveAutonomousInboundPaginationConfig(surfaceKey) {
  const surfaceOverride = AUTONOMOUS_FULL_SURFACE_PAGE_CONFIG[surfaceKey];
  if (surfaceOverride) return surfaceOverride;
  const envMaxPages = Number.parseInt(process.env.EXO_AGENT_SYNC_SLICE_MAX_PAGES ?? "", 10);
  return {
    maxPages: Number.isInteger(envMaxPages) && envMaxPages > 0
      ? envMaxPages
      : DEFAULT_AUTONOMOUS_FULL_SURFACE_MAX_PAGES,
  };
}

/**
 * @param {any} assignment
 * @param {any[]} rawUsers
 */
function resolveAssignedLinkedinAccount(assignment, rawUsers) {
  if (!assignment) {
    return null;
  }

  const user = rawUsers.find((candidate) =>
    candidate?.id === assignment.userId
    || (assignment.label && candidate?.label === assignment.label)
  ) ?? null;
  if (!user) {
    return null;
  }

  const scopedHandles = [...new Set(
    (assignment.accountRefs ?? [])
      .filter((ref) => typeof ref === "string" && ref.startsWith("linkedin:"))
      .map((ref) => ref.slice("linkedin:".length).trim())
      .filter(Boolean)
  )];
  const candidates = (user.accounts ?? []).filter((account) => account?.capability === "linkedin");
  if (!candidates.length) {
    return null;
  }

  if (scopedHandles.length === 1) {
    return candidates.find((account) => account.handle === scopedHandles[0]) ?? null;
  }

  return candidates.find((account) => account.preferred) ?? candidates[0] ?? null;
}

/**
 * Has the latest inbound already been answered by an outbound touch?
 * If yes, stale approved drafts on dead surfaces should not keep blocking.
 * @param {any[]} touches
 */
function hasAnsweredInbound(touches) {
  const lastInbound = lastTouchWhere(touches, (touch) => touch?.direction === "inbound");
  if (!lastInbound?.occurredAt) return false;
  const lastOutbound = lastTouchWhere(touches, (touch) => touch?.direction === "outbound");
  if (!lastOutbound?.occurredAt) return false;
  return String(lastOutbound.occurredAt) > String(lastInbound.occurredAt);
}

/**
 * @param {any[]} touches
 * @param {(touch: any) => boolean} predicate
 */
function lastTouchWhere(touches, predicate) {
  let chosen = null;
  for (const touch of touches) {
    if (!predicate(touch)) continue;
    if (!chosen || String(touch?.occurredAt ?? "") > String(chosen?.occurredAt ?? "")) {
      chosen = touch;
    }
  }
  return chosen;
}

/**
 * Is this prospect a 1st-degree connection (so a direct message can be sent)?
 * @param {any} prospect
 */
function isConnected(prospect) {
  if (prospect?.linkedinProfileSnapshot?.connectionDegree === 1) return true;
  return (prospect?.touches ?? []).some(
    (t) =>
      t.surface === "accept_connection" ||
      (t.surface === "connection_request" && t.outcome === "accepted"),
  );
}

/**
 * How a direct message can reach this prospect, or null if it can't:
 *   "connection"   — they're a 1st-degree connection
 *   "open_profile" — Open Profile, anyone can message free
 *   "premium_inmail" — both sides Premium, so an InMail lands free
 * @param {any} prospect
 * @param {boolean} senderPremium
 * @returns {"connection"|"open_profile"|"premium_inmail"|null}
 */
function directMessageReach(prospect, senderPremium) {
  if (isConnected(prospect)) return "connection";
  const snap = prospect?.linkedinProfileSnapshot ?? {};
  if (snap.isOpenProfile === true) return "open_profile";
  if (snap.isPremium === true && senderPremium) return "premium_inmail";
  return null;
}

/**
 * @param {{
 *   userId: string,
 *   accountId: string,
 *   capability: string,
 *   surfaceKeys?: string[] | null,
 *   mode: "quick" | "full",
 *   resumeCursor?: string | null,
 *   resumeStartOffset?: number | null,
 *   maxPages?: number | null,
 *   pageSize?: number | null,
 * }} input
 */
function buildInboundSyncContractCommand({
  userId,
  accountId,
  capability,
  surfaceKeys = null,
  mode,
  resumeCursor = null,
  resumeStartOffset = null,
  maxPages = null,
  pageSize = null,
}) {
  const surfaceFlags = unique(surfaceKeys ?? []).map((surfaceKey) => `--surface ${surfaceKey}`).join(" ");
  const surfaceSuffix = surfaceFlags ? ` ${surfaceFlags}` : "";
  const resumeCursorSuffix = normalizeNullableString(resumeCursor) ? ` --resume-cursor ${normalizeNullableString(resumeCursor)}` : "";
  const resumeStartOffsetSuffix = Number.isInteger(resumeStartOffset) && resumeStartOffset >= 0
    ? ` --resume-start-offset ${resumeStartOffset}`
    : "";
  const maxPagesSuffix = Number.isInteger(maxPages) && maxPages > 0 ? ` --max-pages ${maxPages}` : "";
  const pageSizeSuffix = Number.isInteger(pageSize) && pageSize > 0 ? ` --page-size ${pageSize}` : "";
  switch (capability) {
    case "linkedin":
      return `exo inbound sync linkedin-live ${userId} --account ${accountId}${surfaceSuffix} --mode ${mode}${resumeCursorSuffix}${resumeStartOffsetSuffix}${maxPagesSuffix}${pageSizeSuffix} --json`;
    case "gmail":
      return `exo inbound sync gmail-live ${userId} --account ${accountId} --mode ${mode} --json`;
    default:
      return `exo inbound sync live ${userId} --account ${accountId} --mode ${mode} --json`;
  }
}

/**
 * Keep the autonomous queue aligned with draft-brief availability so it does
 * not emit first-touch draft tasks that Exo itself will reject.
 *
 * @param {any} prospect
 * @param {string | null | undefined} surface
 */
function isQueueDraftSurfaceAvailable(prospect, surface) {
  if (!surface) {
    return false;
  }

  if (surface === "connection_request") {
    const cadence = prospect?.cadenceState ?? {};
    const touches = Array.isArray(prospect?.touches) ? prospect.touches : [];
    return Boolean(
      prospect?.linkedinProfileUrl
      && cadence.status === "ready"
      && cadence.currentStep === "connection-request"
      && !touches.some((touch) => touch.surface === "connection_request"),
    );
  }

  return true;
}

/**
 * Gmail live sync has a narrower execution contract than generic account
 * mapping. Only schedule it when the bound source is actually runnable.
 *
 * @param {any} rawUser
 * @param {ReturnType<typeof buildUserInboundSyncView>["accounts"][number]} account
 * @param {Map<string, any>} profilesById
 */
function supportsAutonomousInboundSync(rawUser, account, profilesById) {
  if (account.capability !== "gmail") {
    return true;
  }

  const rawAccount = (rawUser?.accounts ?? []).find((candidate) => candidate.id === account.accountId) ?? null;
  if (!rawAccount) {
    return false;
  }

  if (rawAccount.sourceType === "harness-connection") {
    const harnessConnection = (rawUser?.harnessConnections ?? []).find(
      (candidate) => candidate.id === rawAccount.harnessConnectionId,
    ) ?? null;
    if (!harnessConnection) {
      return false;
    }
    const runtime = String(harnessConnection.runtime ?? "").trim().toLowerCase();
    const connector = String(harnessConnection.connector ?? "").trim().toLowerCase();
    const status = String(harnessConnection.status ?? "").trim().toLowerCase();
    return status === "available" && ["codex", "claude"].includes(runtime) && connector === "gmail";
  }

  if (rawAccount.sourceType === "browser-profile") {
    return false;
  }

  return false;
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyFn
 * @returns {Map<string, T[]>}
 */
function groupBy(items, keyFn) {
  const grouped = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

/**
 * @param {ReturnType<typeof buildUserInboundSyncView>["accounts"][number]} account
 * @param {string} surfaceKey
 */
function cueLabelForAccount(account, surfaceKey) {
  return account.surfaces.find((surface) => surface.key === surfaceKey)?.label ?? surfaceKey;
}

/** @param {string[]} values */
function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length))];
}

/**
 * @param {unknown[]} rawCues
 */
function normalizeInboundCues(rawCues) {
  return rawCues.flatMap((cue) => {
    try {
      return [inboundCueSchema.parse(cue)];
    } catch {
      return [];
    }
  });
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
