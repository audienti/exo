// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { isPlannerEligibleMotionStatus } from "../lib/motion-status.js";
import { buildMotionQueueSummary, isReadyConnectionRequestProspect } from "../lib/motion-queue.js";
import { buildMotionPacketSummary } from "../lib/motion-packets.js";
import { isConnectionRequestInFlight } from "../lib/cadence-helpers.js";
import { readWorkspaceSettings, resolveWorkspaceLinkedinConnectionRequestTarget } from "../lib/workspace-settings.js";
import { buildUserInboundSyncView } from "./user-inbound-sync.js";
import {
  buildMotionCompanyScopeKey,
  buildUserAssignedExecutionScopeIndex,
  classifyUserExecutionScope
} from "./user-execution-scope.js";
import { resolveUserConnection } from "./resolve-user-connection.js";

const BUSINESS_DAYS_PER_WEEK = 5;

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 * @param {unknown[]} rawProfiles
 * @param {{
 *   now?: string | null | undefined,
 *   rawUsers?: unknown[] | undefined,
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined,
 *   rawObservations?: unknown[] | undefined,
 *   workspaceSettings?: ReturnType<typeof readWorkspaceSettings> | undefined
 * }} [options]
 */
export function buildOutboundCapacityView(rawUser, rawMotions, rawCompanies, rawProfiles, options = {}) {
  const user = userSchema.parse(rawUser);
  const motions = rawMotions
    .map((item) => motionSchema.parse(item))
    .filter((motion) => isPlannerEligibleMotionStatus(motion.status));
  const companies = rawCompanies.map((item) => companySchema.parse(item));
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const profiles = rawProfiles.map((item) => browserProfileSchema.parse(item));
  const allUsers = (options.rawUsers ?? [rawUser]).map((item) => userSchema.parse(item));
  const observations = (options.rawObservations ?? []).map((item) => inboundObservationSchema.parse(item));
  const workspaceSettings = options.workspaceSettings ?? readWorkspaceSettings();
  const workspaceDailyInvitationsTarget = resolveWorkspaceLinkedinConnectionRequestTarget(workspaceSettings);
  const now = new Date(options.now ?? new Date().toISOString());
  const linkedinResolution = resolveUserConnection(user, profiles, { capability: "linkedin" });
  const fallbackLinkedinAccount = user.accounts.find((account) => account.capability === "linkedin" && account.preferred)
    ?? user.accounts.find((account) => account.capability === "linkedin")
    ?? null;
  const linkedinAccount = linkedinResolution.resolved
    ? user.accounts.find((account) => account.id === linkedinResolution.resolved?.accountId) ?? fallbackLinkedinAccount
    : fallbackLinkedinAccount;
  const {
    assignedExecutionScopeKeys,
    assignedMotionIds
  } = buildUserAssignedExecutionScopeIndex(user, motions, companies, {
    users: allUsers,
    profiles,
    motionId: options.motionId ?? null,
    companyId: options.companyId ?? null
  });

  if (!linkedinAccount) {
    return null;
  }

  const linkedinSyncAccount = buildUserInboundSyncView(user, { capability: "linkedin" }).accounts
    .find((account) => account.accountId === linkedinAccount.id) ?? null;
  const sentInvitationsSurface = linkedinSyncAccount?.surfaces.find((surface) => surface.key === "linkedin-sent-invitations") ?? null;

  const scopedAccounts = motions.flatMap((motion) =>
    motion.targetMap.accounts
      .filter((account) => !options.motionId || motion.id === options.motionId)
      .filter((account) => !options.companyId || account.companyId === options.companyId)
      .map((account) => {
        const company = companyById.get(account.companyId);
        if (!company) {
          return null;
        }

        return {
          motion,
          account,
          company,
          executionScope: classifyUserExecutionScope(user, motion, company)
        };
      })
      .filter(Boolean)
  );
  const executableScopedAccounts = scopedAccounts.filter(({ executionScope }) => executionScope.assignedToUser);

  const queueSummaries = motions
    .filter((motion) => assignedMotionIds.has(motion.id))
    .map((motion) => buildMotionQueueSummary(
      motion,
      companies.filter((company) =>
        company.motionIds.includes(motion.id)
        && (!options.companyId || company.id === options.companyId)
      ),
      {
        companyId: options.companyId ?? null
      }
    ));
  const packetSummaries = motions
    .filter((motion) => assignedMotionIds.has(motion.id))
    .map((motion) => buildMotionPacketSummary(
      motion,
      companies.filter((company) =>
        company.motionIds.includes(motion.id)
        && (!options.companyId || company.id === options.companyId)
      ),
      {
        companyId: options.companyId ?? null
      }
    ));
  const scopedProspects = scopedAccounts.flatMap(({ motion, account, company, executionScope }) =>
    account.prospects
      .filter((prospect) => !options.prospectId || prospect.id === options.prospectId)
      .map((prospect) => ({ motion, account, company, prospect, executionScope }))
  );
  const executableScopedProspects = scopedProspects.filter(({ motion, account }) =>
    assignedExecutionScopeKeys.has(buildMotionCompanyScopeKey(motion.id, account.companyId))
  );
  const assignmentBlockedReadyProspects = scopedProspects.filter(({ executionScope, prospect }) =>
    executionScope.blockedByMissingAssignment && isReadyConnectionRequestProspect(prospect)
  );
  const sentToday = executableScopedProspects.reduce((count, item) => (
    count
    + item.prospect.touches.filter((touch) =>
      touch.surface === "connection_request"
      && touch.direction === "outbound"
      && touch.outcome === "sent"
      && isSameLocalDate(touch.occurredAt, now)
    ).length
  ), 0);
  const trackedPendingInvitations = executableScopedProspects.filter(({ prospect }) => isPendingInvitationFromPriorWork(prospect, now)).length;
  const itemizedPendingInvitations = sentInvitationsSurface
    && (sentInvitationsSurface.lastRunStatus === "success" || sentInvitationsSurface.lastRunStatus === "warning")
    ? sentInvitationsSurface.lastItemCount ?? null
    : null;
  const visiblePendingInvitationCount = sentInvitationsSurface
    && (sentInvitationsSurface.lastRunStatus === "success" || sentInvitationsSurface.lastRunStatus === "warning")
    ? sentInvitationsSurface.lastVisibleTotalCount ?? null
    : null;
  const observedPendingInvitations = visiblePendingInvitationCount ?? itemizedPendingInvitations;
  const pendingInvitationObservationCount = sentInvitationsSurface?.lastObservationCount
    ?? (observedPendingInvitations === null
      ? null
      : observations.filter((observation) =>
        observation.accountId === linkedinAccount.id
        && observation.surfaceKey === "linkedin-sent-invitations"
      ).length);
  const pendingInvitationCaptureCompleteness = sentInvitationsSurface?.lastCaptureCompleteness ?? null;
  const pendingInvitationRequestedMode = sentInvitationsSurface?.lastRequestedMode ?? null;
  const pendingInvitationActualMode = sentInvitationsSurface?.lastActualMode ?? null;
  const pendingInvitationReconcileRequired = sentInvitationsSurface?.lastReconcileRequired ?? null;
  const pendingInvitationReconcileReason = sentInvitationsSurface?.lastReconcileReason ?? null;
  const pendingInvitationItemizationGapCount = sentInvitationsSurface?.lastItemizationGapCount
    ?? (observedPendingInvitations === null || pendingInvitationObservationCount === null
      ? null
      : Math.max(observedPendingInvitations - pendingInvitationObservationCount, 0));
  const pendingInvitations = Math.max(trackedPendingInvitations, observedPendingInvitations ?? 0);
  const pendingInvitationReconciliationBlocked = (pendingInvitationItemizationGapCount ?? 0) > 0;
  const readyConnectionRequests = executableScopedProspects.filter(({ prospect }) => isReadyConnectionRequestProspect(prospect)).length;
  const assignmentBlockedReadyConnectionRequests = assignmentBlockedReadyProspects.length;
  const assignmentBlockedCompanyCount = new Set(assignmentBlockedReadyProspects.map(({ account }) => account.companyId)).size;
  const consideredMotionCount = new Set(executableScopedAccounts.map(({ motion }) => motion.id)).size;
  const consideredCompanyCount = new Set(executableScopedAccounts.map(({ account }) => account.companyId)).size;
  const consideredProspectCount = executableScopedProspects.length;
  const queue = queueSummaries.reduce((summary, item) => {
    summary.companyCount += item.companyCount;
    summary.prospectCount += item.prospectCount;
    summary.availableProspectCount += item.availableProspectCount ?? 0;
    summary.readyToSendCount += item.readyToSendCount;
    for (const [status, count] of Object.entries(item.companyStatusCounts)) {
      summary.companyStatusCounts[status] = (summary.companyStatusCounts[status] ?? 0) + count;
    }
    for (const [status, count] of Object.entries(item.prospectStatusCounts)) {
      summary.prospectStatusCounts[status] = (summary.prospectStatusCounts[status] ?? 0) + count;
    }
    summary.items.push(...(item.items ?? []));
    return summary;
  }, {
    companyCount: 0,
    prospectCount: 0,
    availableProspectCount: 0,
    readyToSendCount: 0,
    companyStatusCounts: {},
    prospectStatusCounts: {},
    items: []
  });
  const packets = packetSummaries.reduce((summary, item) => {
    summary.packetCount += item.counts.packetCount;
    summary.claimableCount += item.counts.claimableCount;
    summary.claimedCount += item.counts.claimedCount;
    for (const packet of item.items) {
      const targetBucket = packet.claimState === "claimed" ? summary.claimedByKind : summary.claimableByKind;
      targetBucket[packet.packetKind] = (targetBucket[packet.packetKind] ?? 0) + 1;
      const previewBucket = packet.claimState === "claimed" ? summary.claimedItemsByKind : summary.claimableItemsByKind;
      previewBucket[packet.packetKind] = previewBucket[packet.packetKind] ?? [];
      previewBucket[packet.packetKind].push({
        motionId: item.motion.id,
        motionName: item.motion.name,
        packetId: packet.packetId,
        companyId: packet.companyId,
        companyName: packet.companyName,
        prospectId: packet.prospectId ?? null,
        prospectName: packet.prospectName ?? null
      });
    }
    return summary;
  }, {
    packetCount: 0,
    claimableCount: 0,
    claimedCount: 0,
    claimableByKind: {},
    claimedByKind: {},
    claimableItemsByKind: {},
    claimedItemsByKind: {}
  });
  const execution = {
      sentToday,
      trackedPendingInvitations,
      itemizedPendingInvitations,
      observedPendingInvitations,
      pendingInvitationVisibleTotalCount: visiblePendingInvitationCount,
      pendingInvitationCaptureCompleteness,
      pendingInvitationRequestedMode,
      pendingInvitationActualMode,
      pendingInvitationReconcileRequired,
      pendingInvitationReconcileReason,
      pendingInvitationObservationCount,
      pendingInvitationItemizationGapCount,
      pendingInvitationReconciliationBlocked,
      pendingInvitations,
      readyConnectionRequests,
    assignmentBlockedReadyConnectionRequests,
    assignmentBlockedCompanyCount,
    consideredMotionCount,
    consideredCompanyCount,
    consideredProspectCount,
    queue,
    packets
  };

  if (linkedinResolution.resolutionStatus !== "resolved") {
    return {
      channel: "linkedin",
      status: "unavailable",
      reason: linkedinResolution.reason,
      account: {
        id: linkedinAccount.id,
        handle: linkedinAccount.handle,
        displayLabel: linkedinAccount.label ?? linkedinAccount.handle,
        sourceType: linkedinAccount.sourceType,
        profileId: linkedinAccount.browserProfileId ?? null,
        profileLabel: null
      },
      quota: {
        weeklyInvitations: null,
        dailyInvitationsTarget: null,
        accountDailyInvitationsTarget: null,
        workspaceDailyInvitationsTarget
      },
      execution,
      plannerItem: null
    };
  }

  const quotaResolution = resolveLinkedinInvitationQuota({ user, linkedinAccount, profiles });
  const accountDisplayLabel = quotaResolution.displayLabel;

  if (quotaResolution.status === "unavailable") {
    return {
      channel: "linkedin",
      status: quotaResolution.status,
      reason: quotaResolution.reason,
      account: {
        id: linkedinAccount.id,
        handle: linkedinAccount.handle,
        displayLabel: accountDisplayLabel,
        sourceType: linkedinAccount.sourceType,
        profileId: quotaResolution.profile?.id ?? linkedinAccount.browserProfileId ?? null,
        profileLabel: quotaResolution.profile?.label ?? null
      },
      quota: {
        weeklyInvitations: null,
        dailyInvitationsTarget: null,
        accountDailyInvitationsTarget: null,
        workspaceDailyInvitationsTarget
      },
      execution,
      plannerItem: null
    };
  }

  if (quotaResolution.weeklyInvitations === null) {
    return {
      channel: "linkedin",
      status: "needs_configuration",
      reason: quotaResolution.reason,
      account: {
        id: linkedinAccount.id,
        handle: linkedinAccount.handle,
        displayLabel: accountDisplayLabel,
        sourceType: linkedinAccount.sourceType,
        profileId: quotaResolution.profile?.id ?? linkedinAccount.browserProfileId ?? null,
        profileLabel: quotaResolution.profile?.label ?? null
      },
      quota: {
        weeklyInvitations: null,
        dailyInvitationsTarget: null,
        accountDailyInvitationsTarget: null,
        workspaceDailyInvitationsTarget
      },
      execution,
      plannerItem: {
        kind: "configure_connection_request_quota",
        priority: "action",
        priorityRank: 0.9,
        dueAt: now.toISOString(),
        whyItMatters: workspaceDailyInvitationsTarget === null
          ? `Exo cannot tell whether ${user.label} is filling today's LinkedIn invitation capacity because ${accountDisplayLabel} has no stored connection-request quota.`
          : `This workspace requests ${workspaceDailyInvitationsTarget} LinkedIn invitation${workspaceDailyInvitationsTarget === 1 ? "" : "s"} per day, but Exo cannot measure progress against that target because ${accountDisplayLabel} has no stored connection-request quota.`,
        recommendedAction: workspaceDailyInvitationsTarget === null
          ? `Set a durable LinkedIn connection-request quota on ${accountDisplayLabel}, then rerun daily and next so Exo can compute today's deficit.`
          : `Set a durable LinkedIn connection-request quota on ${accountDisplayLabel}, then rerun daily and next so Exo can compute this workspace's ${workspaceDailyInvitationsTarget}-per-day deficit.`,
        guidanceKey: "configure_connection_request_quota",
        context: {
          userId: user.id,
          userLabel: user.label,
          profileId: quotaResolution.profile?.id ?? "",
          profileLabel: quotaResolution.profile?.label ?? "",
          accountId: linkedinAccount.id,
          accountHandle: linkedinAccount.handle,
          accountLabel: linkedinAccount.label ?? "",
          accountSourceType: linkedinAccount.sourceType,
          accountRuntime: quotaResolution.harnessConnection?.runtime ?? "",
          accountConnector: quotaResolution.harnessConnection?.connector ?? "",
          workspaceDailyInvitationTarget: workspaceDailyInvitationsTarget === null ? "" : String(workspaceDailyInvitationsTarget),
          quotaWritebackCommand: buildAccountQuotaWritebackCommand({
            user,
            account: linkedinAccount,
            harnessConnection: quotaResolution.harnessConnection
          })
        }
      }
    };
  }

  const weeklyInvitations = quotaResolution.weeklyInvitations;
  const accountDailyInvitationsTarget = Math.ceil(weeklyInvitations / BUSINESS_DAYS_PER_WEEK);
  const dailyInvitationsTarget = workspaceDailyInvitationsTarget === null
    ? accountDailyInvitationsTarget
    : Math.min(workspaceDailyInvitationsTarget, accountDailyInvitationsTarget);
  const remainingInvitationsToday = Math.max(dailyInvitationsTarget - sentToday, 0);
  const inventoryShortfall = Math.max(remainingInvitationsToday - readyConnectionRequests, 0);
  const firstAssignmentBlockedReadyProspect = assignmentBlockedReadyProspects[0] ?? null;
  const configuredResult = {
    channel: "linkedin",
    status: pendingInvitationReconciliationBlocked ? "reconciliation_needed" : "configured",
    reason: pendingInvitationReconciliationBlocked
      ? buildPendingInvitationReconciliationReason({
          observedPendingInvitations,
          itemizedPendingInvitations,
          pendingInvitationObservationCount,
          pendingInvitationCaptureCompleteness
        })
      : remainingInvitationsToday > 0
        ? `${remainingInvitationsToday} invitation${remainingInvitationsToday === 1 ? "" : "s"} remain against today's target.`
        : "Today's invitation target is already satisfied from stored touch state.",
    account: {
      id: linkedinAccount.id,
      handle: linkedinAccount.handle,
      displayLabel: accountDisplayLabel,
      sourceType: linkedinAccount.sourceType,
      profileId: quotaResolution.profile?.id ?? linkedinAccount.browserProfileId ?? null,
      profileLabel: quotaResolution.profile?.label ?? null
    },
    quota: {
      weeklyInvitations,
      dailyInvitationsTarget,
      accountDailyInvitationsTarget,
      workspaceDailyInvitationsTarget
    },
    execution: {
      ...execution,
      remainingInvitationsToday,
      inventoryShortfall
    },
    plannerItem: null
  };

  if (pendingInvitationReconciliationBlocked) {
    return configuredResult;
  }

  if (remainingInvitationsToday === 0) {
    return configuredResult;
  }

  const backlogAction = assignmentBlockedReadyConnectionRequests > 0
    ? buildAssignmentBlockedAction({
        user,
        blockedReadyProspects: assignmentBlockedReadyProspects
      })
    : inventoryShortfall > 0
      ? buildDeficitActionFromQueue(queue, packets, remainingInvitationsToday, inventoryShortfall)
    : null;
  const deficitAction = readyConnectionRequests >= remainingInvitationsToday
    ? {
        kind: "fill_connection_request_deficit",
        guidanceKey: "fill_connection_request_deficit",
        recommendedAction: `Use the ready connection-request branches to send ${remainingInvitationsToday} more LinkedIn invitation${remainingInvitationsToday === 1 ? "" : "s"} today and close the remaining deficit.`
      }
    : readyConnectionRequests > 0
      ? combineReadySendWithFollowOnAction({
          readyConnectionRequests,
          inventoryShortfall,
          followOnAction: backlogAction
        })
      : backlogAction;
  const assignmentBlockedSummary = assignmentBlockedReadyConnectionRequests > 0
    ? `, ${assignmentBlockedReadyConnectionRequests} ready branch${assignmentBlockedReadyConnectionRequests === 1 ? "" : "es"} ${assignmentBlockedReadyConnectionRequests === 1 ? "is" : "are"} blocked only by missing execution assignment`
    : "";
  const whyItMatters = `LinkedIn target is ${dailyInvitationsTarget} invitation${dailyInvitationsTarget === 1 ? "" : "s"} today. ${sentToday} ${sentToday === 1 ? "has" : "have"} been sent today, ${describePendingInvitationTruth({
    pendingInvitations,
    trackedPendingInvitations,
    itemizedPendingInvitations,
    observedPendingInvitations,
    pendingInvitationObservationCount,
    pendingInvitationItemizationGapCount
  })}, ${readyConnectionRequests} more branch${readyConnectionRequests === 1 ? "" : "es"} ${readyConnectionRequests === 1 ? "is" : "are"} executable right now${assignmentBlockedSummary}, and ${remainingInvitationsToday} invitation${remainingInvitationsToday === 1 ? "" : "s"} still need to be filled today.`;

  return {
    ...configuredResult,
    plannerItem: {
      kind: deficitAction.kind,
      priority: "action",
      priorityRank: 0.95,
      dueAt: now.toISOString(),
      whyItMatters,
      recommendedAction: deficitAction.recommendedAction,
      guidanceKey: deficitAction.guidanceKey,
      context: {
        userLabel: user.label,
        profileId: quotaResolution.profile?.id ?? "",
        profileLabel: quotaResolution.profile?.label ?? "",
        accountHandle: linkedinAccount.handle,
        dailyInvitationTarget: String(dailyInvitationsTarget),
        accountDailyInvitationTarget: String(accountDailyInvitationsTarget),
        workspaceDailyInvitationTarget: workspaceDailyInvitationsTarget === null ? "" : String(workspaceDailyInvitationsTarget),
        sentTodayCount: String(sentToday),
        trackedPendingInvitationCount: String(trackedPendingInvitations),
        itemizedPendingInvitationCount: itemizedPendingInvitations === null ? "" : String(itemizedPendingInvitations),
        observedPendingInvitationCount: observedPendingInvitations === null ? "" : String(observedPendingInvitations),
        pendingInvitationVisibleTotalCount: visiblePendingInvitationCount === null ? "" : String(visiblePendingInvitationCount),
        pendingInvitationCaptureCompleteness: pendingInvitationCaptureCompleteness ?? "",
        pendingInvitationRequestedMode: pendingInvitationRequestedMode ?? "",
        pendingInvitationActualMode: pendingInvitationActualMode ?? "",
        pendingInvitationReconcileRequired: pendingInvitationReconcileRequired === null ? "" : String(pendingInvitationReconcileRequired),
        pendingInvitationReconcileReason: pendingInvitationReconcileReason ?? "",
        pendingInvitationObservationCount: pendingInvitationObservationCount === null ? "" : String(pendingInvitationObservationCount),
        pendingInvitationItemizationGapCount: pendingInvitationItemizationGapCount === null ? "" : String(pendingInvitationItemizationGapCount),
        pendingInvitationCount: String(pendingInvitations),
        readyConnectionRequestCount: String(readyConnectionRequests),
        assignmentBlockedReadyConnectionRequestCount: String(assignmentBlockedReadyConnectionRequests),
        assignmentBlockedCompanyCount: String(assignmentBlockedCompanyCount),
        remainingInvitationCount: String(remainingInvitationsToday),
        inventoryShortfallCount: String(inventoryShortfall),
        discoveredCompanyCount: String(queue.companyStatusCounts.discovered ?? 0),
        queuedResearchCompanyCount: String(queue.companyStatusCounts.queued_for_research ?? 0),
        researchedCompanyCount: String(queue.companyStatusCounts.researched ?? 0),
        selectedProspectCount: String(queue.prospectStatusCounts.selected ?? 0),
        readyProspectCount: String(queue.prospectStatusCounts.ready ?? 0),
        claimableCompanyResearchPacketCount: String(packets.claimableByKind.company_research ?? 0),
        claimableProspectSelectionPacketCount: String(packets.claimableByKind.prospect_selection ?? 0),
        claimableProspectResearchPacketCount: String(packets.claimableByKind.prospect_research ?? 0),
        claimedCompanyResearchPacketCount: String(packets.claimedByKind.company_research ?? 0),
        claimedProspectSelectionPacketCount: String(packets.claimedByKind.prospect_selection ?? 0),
        claimedProspectResearchPacketCount: String(packets.claimedByKind.prospect_research ?? 0),
        firstClaimableCompanyResearchPacketId: packets.claimableItemsByKind.company_research?.[0]?.packetId ?? "",
        firstClaimableCompanyResearchPacketMotionId: packets.claimableItemsByKind.company_research?.[0]?.motionId ?? "",
        firstClaimableCompanyResearchCompanyName: packets.claimableItemsByKind.company_research?.[0]?.companyName ?? "",
        firstClaimableProspectSelectionPacketId: packets.claimableItemsByKind.prospect_selection?.[0]?.packetId ?? "",
        firstClaimableProspectSelectionPacketMotionId: packets.claimableItemsByKind.prospect_selection?.[0]?.motionId ?? "",
        firstClaimableProspectSelectionCompanyName: packets.claimableItemsByKind.prospect_selection?.[0]?.companyName ?? "",
        firstClaimableProspectResearchPacketId: packets.claimableItemsByKind.prospect_research?.[0]?.packetId ?? "",
        firstClaimableProspectResearchPacketMotionId: packets.claimableItemsByKind.prospect_research?.[0]?.motionId ?? "",
        firstClaimableProspectResearchCompanyName: packets.claimableItemsByKind.prospect_research?.[0]?.companyName ?? "",
        firstClaimableProspectResearchProspectName: packets.claimableItemsByKind.prospect_research?.[0]?.prospectName ?? "",
        userId: user.id,
        firstAssignmentBlockedMotionId: firstAssignmentBlockedReadyProspect?.motion.id ?? "",
        firstAssignmentBlockedCompanyId: firstAssignmentBlockedReadyProspect?.company.id ?? "",
        firstAssignmentBlockedCompanyName: firstAssignmentBlockedReadyProspect?.company.name ?? "",
        firstAssignmentBlockedProspectId: firstAssignmentBlockedReadyProspect?.prospect.id ?? "",
        firstAssignmentBlockedProspectName: firstAssignmentBlockedReadyProspect?.prospect.name ?? ""
      }
    }
  };
}

/**
 * @param {{
 *   user: import("../schema/user.js").userSchema._type,
 *   linkedinAccount: import("../schema/user.js").userConnectedAccountSchema._type,
 *   profiles: import("../schema/browser-profile.js").browserProfileSchema._type[]
 * }} input
 */
function resolveLinkedinInvitationQuota({ user, linkedinAccount, profiles }) {
  const profile = linkedinAccount.browserProfileId
    ? profiles.find((candidate) => candidate.id === linkedinAccount.browserProfileId) ?? null
    : null;
  const harnessConnection = linkedinAccount.harnessConnectionId
    ? user.harnessConnections.find((candidate) => candidate.id === linkedinAccount.harnessConnectionId) ?? null
    : null;
  const accountWeeklyInvitations = linkedinAccount.automationControls?.weeklyQuotas?.invitations ?? null;
  const legacyProfileWeeklyInvitations = profile?.automationControls?.weeklyQuotas?.invitations ?? null;
  const displayLabel = profile?.label ?? linkedinAccount.label ?? linkedinAccount.handle;

  if (accountWeeklyInvitations !== null) {
    return {
      status: "configured",
      reason: "",
      weeklyInvitations: accountWeeklyInvitations,
      profile,
      harnessConnection,
      displayLabel
    };
  }

  if (legacyProfileWeeklyInvitations !== null) {
    return {
      status: "configured",
      reason: "",
      weeklyInvitations: legacyProfileWeeklyInvitations,
      profile,
      harnessConnection,
      displayLabel
    };
  }

  if (linkedinAccount.sourceType === "browser-profile" && !profile) {
    return {
      status: "unavailable",
      reason: "The LinkedIn account points at a browser profile that is missing from Exo state, so quota-driven pacing cannot be computed.",
      weeklyInvitations: null,
      profile: null,
      harnessConnection,
      displayLabel
    };
  }

  return {
    status: "needs_configuration",
    reason: "The governed LinkedIn execution account has no stored connection-request quota, so Exo cannot compute today's invitation deficit yet.",
    weeklyInvitations: null,
    profile,
    harnessConnection,
    displayLabel
  };
}

/**
 * @param {{
 *   user: import("../schema/user.js").userSchema._type,
 *   account: import("../schema/user.js").userConnectedAccountSchema._type,
 *   harnessConnection: import("../schema/user.js").userHarnessConnectionSchema._type | null
 * }} input
 */
function buildAccountQuotaWritebackCommand({ user, account, harnessConnection }) {
  const preferredFlag = account.preferred ? " --preferred" : "";
  const providerAccountIdFlag = account.providerAccountId
    ? ` --provider-account-id ${account.providerAccountId}`
    : "";
  const profileFlags = account.browserProfileId
    ? ` --profile ${account.browserProfileId}`
    : "";
  const harnessFlags = harnessConnection
    ? ` --runtime ${harnessConnection.runtime} --connector ${harnessConnection.connector}`
    : "";

  return [
    "exo users accounts add",
    user.id,
    "--capability linkedin",
    `--handle ${account.handle}`,
    providerAccountIdFlag,
    profileFlags || harnessFlags,
    preferredFlag,
    "--max-connection-requests <weekly-count> --json"
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {{
 *   readyConnectionRequests: number,
 *   inventoryShortfall: number,
 *   followOnAction: {
 *     kind: string,
 *     guidanceKey: string,
 *     recommendedAction: string
 *   } | null
 * }} input
 */
function combineReadySendWithFollowOnAction({ readyConnectionRequests, inventoryShortfall, followOnAction }) {
  const sendPrefix = `Send ${readyConnectionRequests} ready LinkedIn connection request${readyConnectionRequests === 1 ? "" : "s"} now`;

  if (!followOnAction) {
    return {
      kind: "fill_connection_request_deficit",
      guidanceKey: "fill_connection_request_deficit",
      recommendedAction: `${sendPrefix}, then build ${inventoryShortfall} more ready branch${inventoryShortfall === 1 ? "" : "es"} to close today's remaining invitation deficit.`
    };
  }

  return {
    kind: followOnAction.kind,
    guidanceKey: followOnAction.guidanceKey,
    recommendedAction: `${sendPrefix}, then ${lowercaseSentenceStart(followOnAction.recommendedAction)}`
  };
}

/**
 * @param {{
 *   observedPendingInvitations: number | null,
 *   itemizedPendingInvitations: number | null,
 *   pendingInvitationObservationCount: number | null,
 *   pendingInvitationCaptureCompleteness: string | null
 * }} input
 */
function buildPendingInvitationReconciliationReason(input) {
  const visibleCount = input.observedPendingInvitations ?? 0;
  const itemizedCount = input.itemizedPendingInvitations ?? input.pendingInvitationObservationCount ?? 0;
  const completeness = input.pendingInvitationCaptureCompleteness === "partial_visible_slice"
    ? "only a visible slice was itemized"
    : "the live backlog was not fully itemized";
  return `LinkedIn sent invitations still need reconciliation: ${visibleCount} pending invite${visibleCount === 1 ? "" : "s"} are visible, ${itemizedCount} ${itemizedCount === 1 ? "row was" : "rows were"} itemized, and ${completeness}. Exo should not push new connection-request pressure until the full backlog is trustworthy.`;
}

/**
 * @param {string} iso
 * @param {Date} now
 */
function isSameLocalDate(iso, now) {
  const date = new Date(iso);
  return (
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  );
}

/**
 * @param {{
 *   cadenceState: {
 *     currentStep: string | null,
 *     lastTouchOutcome: string | null,
 *     lastTouchAt: string | null
 *   },
 *   touches: Array<{
 *     surface: string,
 *     direction: string,
 *     occurredAt: string
 *   }>
 * }} prospect
 * @param {Date} now
 */
function isPendingInvitationFromPriorWork(prospect, now) {
  if (!isConnectionRequestInFlight(prospect.cadenceState)) {
    return false;
  }

  const latestOutboundInviteTouch = [...prospect.touches]
    .filter((touch) => touch.surface === "connection_request" && touch.direction === "outbound")
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .at(-1);
  const referenceAt = latestOutboundInviteTouch?.occurredAt ?? prospect.cadenceState.lastTouchAt ?? null;

  return referenceAt ? !isSameLocalDate(referenceAt, now) : true;
}

/**
 * @param {{
 *   pendingInvitations: number,
 *   trackedPendingInvitations: number,
 *   itemizedPendingInvitations?: number | null,
 *   observedPendingInvitations: number | null,
 *   pendingInvitationObservationCount: number | null,
 *   pendingInvitationItemizationGapCount: number | null
 * }} input
 */
function describePendingInvitationTruth(input) {
  if (input.observedPendingInvitations === null) {
    return `${input.pendingInvitations} ${input.pendingInvitations === 1 ? "is" : "are"} still pending from prior work`;
  }

  if ((input.pendingInvitationItemizationGapCount ?? 0) > 0) {
    const observationCount = input.pendingInvitationObservationCount ?? 0;
    const itemizedCount = input.itemizedPendingInvitations ?? observationCount;
    return `${input.observedPendingInvitations} ${input.observedPendingInvitations === 1 ? "is" : "are"} visible on the live sent-invitations surface, but only ${itemizedCount} ${itemizedCount === 1 ? "row has" : "rows have"} been itemized and ${observationCount} individual observation${observationCount === 1 ? "" : "s"} ${observationCount === 1 ? "has" : "have"} been written back so far`;
  }

  if (input.observedPendingInvitations !== input.trackedPendingInvitations) {
    return `${input.observedPendingInvitations} ${input.observedPendingInvitations === 1 ? "is" : "are"} visible on the live sent-invitations surface, while ${input.trackedPendingInvitations} ${input.trackedPendingInvitations === 1 ? "is" : "are"} mapped to governed branches`;
  }

  return `${input.pendingInvitations} ${input.pendingInvitations === 1 ? "is" : "are"} still pending from prior work`;
}

/**
 * @param {{ companyStatusCounts: Record<string, number>, prospectStatusCounts: Record<string, number> }} queue
 * @param {{
 *   packetCount: number,
 *   claimableCount: number,
 *   claimedCount: number,
 *   claimableByKind: Record<string, number>,
 *   claimedByKind: Record<string, number>,
 *   claimableItemsByKind: Record<string, Array<{
 *     motionId: string,
 *     motionName: string,
 *     packetId: string,
 *     companyId: string,
 *     companyName: string,
 *     prospectId: string | null,
 *     prospectName: string | null
 *   }>>,
 *   claimedItemsByKind: Record<string, Array<{
 *     motionId: string,
 *     motionName: string,
 *     packetId: string,
 *     companyId: string,
 *     companyName: string,
 *     prospectId: string | null,
 *     prospectName: string | null
 *   }>>
 * }} packets
 * @param {number} remainingInvitationsToday
 * @param {number} inventoryShortfall
 */
function buildDeficitActionFromQueue(queue, packets, remainingInvitationsToday, inventoryShortfall) {
  const queuedResearchCount = (queue.companyStatusCounts.discovered ?? 0) + (queue.companyStatusCounts.queued_for_research ?? 0);
  const researchedCount = queue.companyStatusCounts.researched ?? 0;
  const selectedCount = queue.prospectStatusCounts.selected ?? 0;
  const claimableCompanyResearchPacketCount = packets.claimableByKind.company_research ?? 0;
  const claimableProspectSelectionPacketCount = packets.claimableByKind.prospect_selection ?? 0;
  const claimableProspectResearchPacketCount = packets.claimableByKind.prospect_research ?? 0;
  const firstProspectResearchPacket = packets.claimableItemsByKind.prospect_research?.[0] ?? null;
  const firstProspectSelectionPacket = packets.claimableItemsByKind.prospect_selection?.[0] ?? null;
  const firstCompanyResearchPacket = packets.claimableItemsByKind.company_research?.[0] ?? null;

  if (queuedResearchCount > 0) {
    return {
      kind: "fill_connection_request_deficit",
      guidanceKey: "fill_connection_request_deficit",
      recommendedAction: `Research ${queuedResearchCount} discovered or queued compan${queuedResearchCount === 1 ? "y" : "ies"} already in the motion so it can manufacture ${remainingInvitationsToday} more ready LinkedIn connection-request branch${remainingInvitationsToday === 1 ? "" : "es"} today.${formatQueueLead(queue, ["discovered", "queued_for_research"])}`
    };
  }

  if (researchedCount > 0) {
    return {
      kind: "fill_connection_request_deficit",
      guidanceKey: "fill_connection_request_deficit",
      recommendedAction: `Select prospects from ${researchedCount} researched account${researchedCount === 1 ? "" : "s"} so the motion can refill ${inventoryShortfall} ready branch${inventoryShortfall === 1 ? "" : "es"} for today's invitation target.${formatQueueLead(queue, ["researched"])}`
    };
  }

  if (selectedCount > 0) {
    return {
      kind: "fill_connection_request_deficit",
      guidanceKey: "fill_connection_request_deficit",
      recommendedAction: `Finish cadence on ${selectedCount} selected prospect${selectedCount === 1 ? "" : "s"} so the motion can close ${inventoryShortfall} more ready branch${inventoryShortfall === 1 ? "" : "es"} today.${formatQueueLead(queue, ["selected", "ready"])}`
    };
  }

  if (claimableProspectResearchPacketCount > 0) {
    return {
      kind: "claim_prospect_research_packets",
      guidanceKey: "claim_prospect_research_packets",
      recommendedAction: `Claim ${claimableProspectResearchPacketCount} prospect-research packet${claimableProspectResearchPacketCount === 1 ? "" : "s"} from selected stakeholders so the motion can turn them into ready branches and refill ${inventoryShortfall} connection-request slot${inventoryShortfall === 1 ? "" : "s"} today.${formatPacketLead(firstProspectResearchPacket)}`
    };
  }

  if (claimableProspectSelectionPacketCount > 0) {
    return {
      kind: "claim_prospect_selection_packets",
      guidanceKey: "claim_prospect_selection_packets",
      recommendedAction: `Claim ${claimableProspectSelectionPacketCount} prospect-selection packet${claimableProspectSelectionPacketCount === 1 ? "" : "s"} from researched account${claimableProspectSelectionPacketCount === 1 ? "" : "s"} so the motion can turn them into selected stakeholders and refill ${inventoryShortfall} ready branch${inventoryShortfall === 1 ? "" : "es"} for today's invitation target.${formatPacketLead(firstProspectSelectionPacket)}`
    };
  }

  if (claimableCompanyResearchPacketCount > 0) {
    return {
      kind: "claim_company_research_packets",
      guidanceKey: "claim_company_research_packets",
      recommendedAction: `Claim ${claimableCompanyResearchPacketCount} company-research packet${claimableCompanyResearchPacketCount === 1 ? "" : "s"} from discovered or queued accounts so the motion can manufacture ${remainingInvitationsToday} more ready LinkedIn connection-request branch${remainingInvitationsToday === 1 ? "" : "es"} today.${formatPacketLead(firstCompanyResearchPacket)}`
    };
  }

  if (inventoryShortfall > 0) {
    return {
      kind: "seed_motion_targets",
      guidanceKey: "seed_motion_targets",
      recommendedAction: `Seed more known companies or people directly into the active motion so the queue has real backlog to turn into ${remainingInvitationsToday} more ready LinkedIn connection-request branch${remainingInvitationsToday === 1 ? "" : "es"} today.`
    };
  }

  return {
    kind: "fill_connection_request_deficit",
    guidanceKey: "fill_connection_request_deficit",
    recommendedAction: `Build ${remainingInvitationsToday} more ready LinkedIn connection-request branch${remainingInvitationsToday === 1 ? "" : "es"} today so outbound does not miss the invitation target.`
  };
}

/**
 * @param {{
 *   user: import("../schema/user.js").userSchema._type,
 *   blockedReadyProspects: Array<{
 *     motion: import("../schema/motion.js").motionSchema._type,
 *     company: import("../schema/company.js").companySchema._type,
 *     prospect: {
 *       id: string,
 *       name: string
 *     }
 *   }>
 * }} input
 */
function buildAssignmentBlockedAction({ user, blockedReadyProspects }) {
  const blockedCompanyIds = [...new Set(blockedReadyProspects.map(({ company }) => company.id))];
  const blockedCompanyNames = blockedCompanyIds
    .map((companyId) => blockedReadyProspects.find(({ company }) => company.id === companyId)?.company.name ?? null)
    .filter(Boolean);

  if (blockedCompanyIds.length === 1) {
    return {
      kind: "assign_ready_execution",
      guidanceKey: "assign_ready_execution",
      recommendedAction: `Pin ${blockedCompanyNames[0]} to ${user.label} so ${blockedReadyProspects.length} ready LinkedIn connection-request branch${blockedReadyProspects.length === 1 ? "" : "es"} become executable today.`
    };
  }

  const previewNames = blockedCompanyNames.slice(0, 2).join(" and ");
  return {
    kind: "assign_ready_execution",
    guidanceKey: "assign_ready_execution",
    recommendedAction: `Pin ${blockedCompanyIds.length} ready companies to ${user.label} so ${blockedReadyProspects.length} already-prepared LinkedIn connection-request branch${blockedReadyProspects.length === 1 ? "" : "es"} become executable today. Start with ${previewNames}.`
  };
}

/**
 * @param {{
 *   motionId: string,
 *   packetId: string,
 *   companyName: string,
 *   prospectName: string | null
 * } | null} packet
 */
function formatPacketLead(packet) {
  if (!packet) {
    return "";
  }

  const subject = packet.prospectName
    ? `${packet.prospectName} at ${packet.companyName}`
    : packet.companyName;

  return ` Start with ${packet.packetId} for ${subject} via exo motion packet-brief ${packet.motionId} --packet ${packet.packetId}.`;
}

/**
 * @param {{
 *   items?: Array<{ companyName: string, queueStatus: string }>
 * }} queue
 * @param {string[]} statuses
 */
function formatQueueLead(queue, statuses) {
  const leadCompanies = (queue.items ?? [])
    .filter((item) => statuses.includes(item.queueStatus))
    .map((item) => item.companyName)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 2);

  if (leadCompanies.length === 0) {
    return "";
  }

  return ` Start with ${joinHumanList(leadCompanies)}.`;
}

/**
 * @param {string[]} values
 */
function joinHumanList(values) {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

/**
 * @param {string} value
 */
function lowercaseSentenceStart(value) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}
