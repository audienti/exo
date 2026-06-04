// @ts-check
//
// The agent's autonomous work queue — everything that's been approved/queued and
// can be executed WITHOUT further operator input. This is what an agent loop
// drains: for each task it performs the real-world action (e.g. sends the
// LinkedIn message via its browser runtime) and then writes the result back with
// the `writeback` command, which marks the draft sent and records the touch.
//
// Task kinds today:
//   - run_inbound_sync           — refresh stale or under-itemized inbound truth
//                                  surfaces with no operator input.
//   - company_research          — run one governed company-research packet
//                                 against the motion signal contract. Claimable
//                                 packets live in the same queue as already-
//                                 claimed packets so there is only one
//                                 executable research lane.
//   - write_draft               — write the next governed draft with no
//                                 operator input.
//   - send_message              — fire a send-ready outbound message.
//   - reject_connection_request — decline an inbound invite the operator
//                                 already rejected in Exo.
//   - withdraw_connection       — clear a stale outbound invite automatically.
//   - unfollow_profile          — remove the paired follow after a withdrawn
//                                 connection branch is cleaned up.
//
// Blockers cover send-ready drafts that became stale after they were queued
// (e.g. the prospect replied before send). Those are NOT auto-sent — the
// operator has to re-review.

import { accountRefsCanAttachConnectionNote } from "../schema/browser-profile.js";
import { inboundCueSchema } from "../schema/inbound.js";
import { isConnectionRequestInFlight, isStalePendingConnectionRequest } from "../lib/cadence-helpers.js";
import {
  draftWritebackStatusForSurface,
  extractUsableDraftBody,
  isSendableDraftStatus,
  isStructuredDraftEnvelope,
} from "../lib/draft-policy.js";
import { buildSendHandoff } from "./build-send-handoff.js";
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

const LIVE_SYNC_TASK_CAPABILITIES = new Set(["linkedin", "gmail"]);

/**
 * @param {{
 *   motions: any[],
 *   companies?: any[],
 *   profiles?: any[],
 *   users?: any[],
 *   observations?: any[],
 *   cues?: any[],
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
  const normalizedCues = normalizeInboundCues(input.cues ?? []);
  const profilesById = new Map((input.profiles ?? []).map((profile) => [profile.id, profile]));
  // Sender premium status per company (Sales Navigator / LinkedIn Premium),
  // which gates Premium→Premium messaging to non-connections.
  const senderPremiumByCompany = new Map(
    (input.companies ?? []).map((c) => [c.id, accountRefsCanAttachConnectionNote(c.engagementUserAssignment?.accountRefs ?? [])]),
  );
  const companiesById = new Map((input.companies ?? []).map((company) => [company.id, company]));
  const prospectContextById = new Map();
  for (const motion of input.motions ?? []) {
    for (const account of motion.targetMap?.accounts ?? []) {
      for (const prospect of account.prospects ?? []) {
        prospectContextById.set(prospect.id, { motion, account, prospect });
      }
    }
  }
  const tasks = [];
  const waiting = [];
  const blockers = [];
  const queuedCleanupKeys = new Set();

  for (const rawUser of input.users ?? []) {
    const syncView = buildUserInboundSyncView(rawUser);
    const review = buildInboundReviewView(rawUser, input.observations ?? [], input.motions ?? [], input.companies ?? []);
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
        .filter((surface) => surface.enabled && surface.truthLevel === "authoritative")
        .map((surface) => ({
          ...surface,
          freshness: classifyInboundSurfaceFreshness(surface, now),
        }))
        .filter((surface) => surface.freshness);

      if (!itemizationGaps.length && !openCues.length && !staleSurfaces.length) {
        if (!includeWaitingRetrieval) {
          continue;
        }
        const nextDueSurfaces = account.surfaces
          .filter((surface) => surface.enabled && surface.truthLevel === "authoritative" && surface.autonomousBackgroundRetrieval !== false)
          .map((surface) => ({
            ...surface,
            nextDueAt: computeInboundAutomationNextDueAt(surface),
          }))
          .filter((surface) => typeof surface.nextDueAt === "string" && surface.nextDueAt.length > 0)
          .sort((left, right) => String(left.nextDueAt).localeCompare(String(right.nextDueAt)));
        if (!nextDueSurfaces.length) {
          continue;
        }
        const nextDueAt = nextDueSurfaces[0].nextDueAt;
        const scheduledSurfaceLabels = nextDueSurfaces
          .filter((surface) => surface.nextDueAt === nextDueAt)
          .map((surface) => surface.label);
        const scheduledSurfaceKeys = nextDueSurfaces
          .filter((surface) => surface.nextDueAt === nextDueAt)
          .map((surface) => surface.key);
        placeTask(buildInboundSyncTask({
          user: syncView.user,
          account,
          mode: "quick",
          itemizationSurfaceCount: 0,
          staleSurfaceCount: 0,
          cueCount: 0,
          surfaceKeys: scheduledSurfaceKeys,
          surfaceLabels: scheduledSurfaceLabels,
          dueAt: nextDueAt,
          forceRetrieval: true,
        }), { now, tasks, waiting });
        continue;
      }

      const surfaceKeys = unique(
        itemizationGaps.map((gap) => gap.surfaceKey)
          .concat(staleSurfaces.map((surface) => surface.key))
          .concat(openCues.map((cue) => cue.surfaceKey)),
      );
      const surfaceLabels = surfaceKeys.map((surfaceKey) => cueLabelForAccount(account, surfaceKey));
      const syncMode = itemizationGaps.length ? "full" : "quick";
      const itemizationSurfaceCount = itemizationGaps.length;
      const staleSurfaceCount = staleSurfaces.length;
      const cueCount = openCues.length;
      const oldestDueAt = normalizeOptionalIso(
        unique(
          itemizationGaps
            .map((gap) => account.surfaces.find((surface) => surface.key === gap.surfaceKey)?.lastObservedAt
              ?? account.surfaces.find((surface) => surface.key === gap.surfaceKey)?.lastSyncedAt
              ?? null)
            .concat(staleSurfaces.map((surface) => surface.freshness?.dueAt ?? surface.lastObservedAt ?? surface.lastSyncedAt ?? null))
            .concat(openCues.map((cue) => cue.observedAt)),
        )
          .filter(Boolean)
          .sort()[0] ?? now,
      ) ?? now;

      placeTask(buildInboundSyncTask({
        user: syncView.user,
        account,
        mode: syncMode,
        itemizationSurfaceCount,
        staleSurfaceCount,
        cueCount,
        surfaceKeys,
        surfaceLabels,
        dueAt: oldestDueAt,
      }), { now, tasks, waiting });
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

    const cleanupKey = observation.prospectId
      ? `withdraw::${observation.prospectId}`
      : observation.externalId
        ? `withdraw::${observation.externalId}`
        : observation.actorProfileUrl
          ? `withdraw::${observation.actorProfileUrl}`
          : `withdraw::${observation.id}`;
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
  for (const motion of input.motions ?? []) {
    for (const account of motion.targetMap?.accounts ?? []) {
      const senderPremium = senderPremiumByCompany.get(account.companyId) ?? false;
      if (
        (account?.packetState?.kind === "company_research" && account.packetState?.status === "claimed")
        || isClaimableCompanyResearchAccount(account)
      ) {
        placeTask(buildCompanyResearchTask({
          motion,
          account,
        }), { now, tasks, waiting });
      }
      for (const prospect of account.prospects ?? []) {
        // Honor operator steers FIRST. A "do not contact / works for us" steer
        // removes the prospect from the loop entirely — the unattended agent
        // must never draft for or message someone the operator excluded.
        if (steerSuppression(prospect).suppressed) continue;
        if (hasRecordedTouch(prospect, "withdraw_connection") && hasRecordedTouch(prospect, "follow") && !hasRecordedTouch(prospect, "unfollow")) {
          const unfollowTask = buildUnfollowTask({ motion, account, prospect });
          if (unfollowTask) placeTask(unfollowTask, { now, tasks, waiting });
        }
        const candidateSurface = selectNextDraftSurface(prospect);
        const nextSurface = isQueueDraftSurfaceAvailable(prospect, candidateSurface) ? candidateSurface : null;
        const drafts = Array.isArray(prospect.drafts) ? prospect.drafts : [];
        const cadenceWindow = nextSurface ? resolveCadenceExecutionWindow(prospect, nextSurface, now) : null;

        // 1) write_draft: the prospect's next message hasn't been drafted yet.
        //    Skip if any active draft (drafting/ready/queued/approved) already sits on
        //    the right surface — that one is either being worked or already
        //    queued in the current send path.
        if (nextSurface) {
          const draftOnNextSurface = drafts.find((d) => d.surface === nextSurface && isDraftActive(d));
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
          if (isSendableDraftStatus(draft.status) || draft.status === "sent" || draft.status === "discarded") continue;
          const staleness = classifyDraftStaleness(draft, nextSurface);
          if (!staleness.stale) continue;
          // Don't double-queue — the no_draft task above already covers
          // writing on the new surface. Just note the prior draft needs to
          // be discarded as part of the rewrite.
        }

        // 3) send_message: send-ready drafts ready to fire.
        for (const draft of drafts) {
          if (!isSendableDraftStatus(draft.status)) continue;
          if (isStructuredDraftEnvelope(draft.body)) continue;

          const staleness = classifyDraftStaleness(draft, nextSurface);
          if (staleness.stale) {
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
  // Autonomous truth refresh and claimed research first, then cleanup, then
  // sends, then drafting. Within each task class, oldest queued work wins.
  tasks.sort(taskOrder);
  waiting.sort(taskOrder);
  return {
    count: tasks.length,
    itemCount: tasks.length,
    waitingCount: waiting.length,
    tasks,
    waiting,
    blockers,
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
  const claimState = account?.packetState?.kind === "company_research" && account.packetState?.status === "claimed"
    ? "claimed"
    : "claimable";
  const queuedAt = account?.packetState?.claimedAt ?? account?.queueState?.updatedAt ?? null;
  return {
    kind: "company_research",
    action: "research_company",
    needsOperatorInput: false,
    reason: claimState === "claimed" ? "claimed_company_packet" : "claimable_company_packet",
    motionId: motion.id,
    motionName: motion.name,
    companyId: account.companyId,
    companyName: account.companyName,
    prospectName: account.companyName,
    packetId,
    packetKind: "company_research",
    claimState,
    surface: "company_research",
    workerLabel: account?.packetState?.workerLabel ?? null,
    queueStatus: account?.queueState?.status ?? null,
    whyItMatters: claimState === "claimed"
      ? `${account.companyName} was explicitly claimed for governed company research and is still blocking downstream prospect inventory.`
      : `${account.companyName} is already in the motion backlog and can be claimed and researched now without operator input.`,
    claimCommand: `exo companies queue claim ${account.companyId} --motion ${motion.id} --worker <worker-label> --json`,
    briefCommand: `exo motion packet-brief ${motion.id} --packet ${packetId} --json`,
    notes: account?.packetState?.notes ?? null,
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
  return ["discovered", "queued_for_research"].includes(queueStatus)
    && !(account?.packetState?.status === "claimed");
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
 * }} input
 */
function buildWriteDraftTask({ motion, account, prospect, surface, reason, dueAt, waitingReason }) {
  const motionFlag = motion.id ? ` --motion ${motion.id}` : "";
  const status = draftWritebackStatusForSurface(surface);
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
    // cadence, prior touches, surface rules. The writeback marks
    // the draft `queued` for agent-owned routine outbound surfaces, otherwise
    // `ready` for explicit operator review.
    briefCommand: `exo motion draft-brief ${motion.id} --prospect ${prospect.id} --surface ${surface} --json`,
    writeback: `exo companies prospects draft set ${account.companyId} --prospect ${prospect.id}${motionFlag} --surface ${surface} --status ${status} --body "<written-body>"`,
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
 *   forceRetrieval?: boolean,
 * }} input
 */
function buildInboundSyncTask({ user, account, mode, itemizationSurfaceCount, staleSurfaceCount, cueCount, surfaceKeys, surfaceLabels, dueAt, forceRetrieval = false }) {
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
    queuedAt: dueAt,
    dueAt,
    contractCommand: buildInboundSyncContractCommand({
      userId: user.id,
      accountId: account.accountId,
      capability: account.capability,
      mode,
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
 *   draft: any,
 *   action: string,
 *   via: string,
 *   dueAt: string | null,
 *   waitingReason: string | null,
 * }} input
 */
function buildSendMessageTask({ motion, account, prospect, draft, action, via, dueAt, waitingReason }) {
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
    recipientUrl: resolveSendTaskRecipient(prospect, draft),
    recipientEmail: resolveSendTaskRecipientEmail(prospect, draft),
    surface: draft.surface,
    channel: draft.channel,
    via,
    subject: draft.subject ?? null,
    body: extractUsableDraftBody(draft.body) ?? (draft.body ?? ""),
    queuedAt: draft.approvedAt ?? null,
    dueAt,
    waitingReason,
    // Run this AFTER the send actually happens — it records the outbound
    // touch (so the timeline shows "Sent"), marks the draft sent, and
    // advances cadence to "wait for a reply before the next step".
    writeback: `exo actions result --action ${action} --result sent --company ${account.companyId} --prospect ${prospect.id} --surface ${draft.surface}`,
  };
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
function buildUnfollowTask({ motion, account, prospect }) {
  if (!prospect.linkedinProfileUrl) {
    return null;
  }
  return {
    kind: "unfollow_profile",
    action: "unfollow",
    needsOperatorInput: false,
    reason: "withdrawn_connection_cleanup",
    motionId: motion.id,
    motionName: motion.name,
    companyId: account.companyId,
    companyName: account.companyName,
    prospectId: prospect.id,
    prospectName: prospect.name,
    recipientUrl: prospect.linkedinProfileUrl,
    surface: "follow",
    queuedAt: latestTouchOccurredAt(prospect, "withdraw_connection") ?? prospect?.cadenceState?.updatedAt ?? null,
    dueAt: latestTouchOccurredAt(prospect, "withdraw_connection") ?? prospect?.cadenceState?.updatedAt ?? null,
    writeback: buildActionResultWriteback({
      action: "unfollow",
      result: "sent",
      motionId: motion.id,
      companyId: account.companyId,
      prospectId: prospect.id,
      surface: "unfollow",
    }),
  };
}

/**
 * Sort by queue class, then by the oldest relevant queue timestamp.
 * @param {any} a
 * @param {any} b
 */
function taskOrder(a, b) {
  const rank = {
    run_inbound_sync: 0,
    company_research: 1,
    reject_connection_request: 2,
    withdraw_connection: 3,
    unfollow_profile: 4,
    send_message: 5,
    write_draft: 6,
  };
  const aRank = rank[a.kind] ?? 99;
  const bRank = rank[b.kind] ?? 99;
  if (aRank !== bRank) return aRank - bRank;
  const aKey = a.dueAt ?? a.queuedAt ?? a.approvedAt ?? null;
  const bKey = b.dueAt ?? b.queuedAt ?? b.approvedAt ?? null;
  return String(aKey ?? "").localeCompare(String(bKey ?? ""));
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
 * @param {{
 *   action: string,
 *   result: string,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   observationId?: string | null,
 *   surface?: string | null,
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
  return parts.join(" ");
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

/** @param {string | null | undefined} value */
function normalizeNowIso(value) {
  return normalizeOptionalIso(value) ?? new Date().toISOString();
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
 * @param {{ userId: string, accountId: string, capability: string, mode: "quick" | "full" }} input
 */
function buildInboundSyncContractCommand({ userId, accountId, capability, mode }) {
  switch (capability) {
    case "linkedin":
      return `exo inbound sync linkedin-live ${userId} --account ${accountId} --mode ${mode} --json`;
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
