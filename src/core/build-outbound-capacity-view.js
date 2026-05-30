// @ts-check

import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { isExecutionEligibleMotionStatus } from "../lib/motion-status.js";
import { buildMotionQueueSummary, isReadyConnectionRequestProspect } from "../lib/motion-queue.js";
import { buildMotionPacketSummary } from "../lib/motion-packets.js";
import { isConnectionRequestInFlight } from "../lib/cadence-helpers.js";

const BUSINESS_DAYS_PER_WEEK = 5;

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 * @param {unknown[]} rawProfiles
 * @param {{
 *   now?: string | null | undefined,
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined
 * }} [options]
 */
export function buildOutboundCapacityView(rawUser, rawMotions, rawCompanies, rawProfiles, options = {}) {
  const user = userSchema.parse(rawUser);
  const motions = rawMotions
    .map((item) => motionSchema.parse(item))
    .filter((motion) => isExecutionEligibleMotionStatus(motion.status));
  const companies = rawCompanies.map((item) => companySchema.parse(item));
  const profiles = rawProfiles.map((item) => browserProfileSchema.parse(item));
  const now = new Date(options.now ?? new Date().toISOString());
  const linkedinAccount = user.accounts.find((account) => account.capability === "linkedin" && account.preferred)
    ?? user.accounts.find((account) => account.capability === "linkedin")
    ?? null;

  if (!linkedinAccount) {
    return null;
  }

  const assignedCompanyIds = new Set(
    companies
      .filter((company) => company.engagementUserAssignment?.userId === user.id)
      .map((company) => company.id)
  );
  const operatorVisibleCompanies = companies.filter((company) =>
    assignedCompanyIds.has(company.id) || !company.engagementUserAssignment
  );
  const scopedAccounts = motions.flatMap((motion) =>
    motion.targetMap.accounts
      .filter((account) => assignedCompanyIds.has(account.companyId))
      .filter((account) => !options.motionId || motion.id === options.motionId)
      .filter((account) => !options.companyId || account.companyId === options.companyId)
      .map((account) => ({ motion, account }))
  );
  const queueSummaries = motions
    .filter((motion) => !options.motionId || motion.id === options.motionId)
    .map((motion) => buildMotionQueueSummary(motion, operatorVisibleCompanies, {
      companyId: options.companyId ?? null
    }));
  const packetSummaries = motions
    .filter((motion) => !options.motionId || motion.id === options.motionId)
    .map((motion) => buildMotionPacketSummary(motion, operatorVisibleCompanies, {
      companyId: options.companyId ?? null
    }));
  const scopedProspects = scopedAccounts.flatMap(({ motion, account }) =>
    account.prospects
      .filter((prospect) => !options.prospectId || prospect.id === options.prospectId)
      .map((prospect) => ({ motion, account, prospect }))
  );
  const sentToday = scopedProspects.reduce((count, item) => (
    count
    + item.prospect.touches.filter((touch) =>
      touch.surface === "connection_request"
      && touch.direction === "outbound"
      && touch.outcome === "sent"
      && isSameLocalDate(touch.occurredAt, now)
    ).length
  ), 0);
  const pendingInvitations = scopedProspects.filter(({ prospect }) => isPendingInvitationFromPriorWork(prospect, now)).length;
  const readyConnectionRequests = scopedProspects.filter(({ prospect }) => isReadyConnectionRequestProspect(prospect)).length;
  const consideredMotionCount = new Set(scopedAccounts.map(({ motion }) => motion.id)).size;
  const consideredCompanyCount = new Set(scopedAccounts.map(({ account }) => account.companyId)).size;
  const consideredProspectCount = scopedProspects.length;
  const queue = queueSummaries.reduce((summary, item) => {
    summary.companyCount += item.companyCount;
    summary.prospectCount += item.prospectCount;
    summary.readyToSendCount += item.readyToSendCount;
    for (const [status, count] of Object.entries(item.companyStatusCounts)) {
      summary.companyStatusCounts[status] = (summary.companyStatusCounts[status] ?? 0) + count;
    }
    for (const [status, count] of Object.entries(item.prospectStatusCounts)) {
      summary.prospectStatusCounts[status] = (summary.prospectStatusCounts[status] ?? 0) + count;
    }
    return summary;
  }, {
    companyCount: 0,
    prospectCount: 0,
    readyToSendCount: 0,
    companyStatusCounts: {},
    prospectStatusCounts: {}
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
    pendingInvitations,
    readyConnectionRequests,
    consideredMotionCount,
    consideredCompanyCount,
    consideredProspectCount,
    queue,
    packets
  };

  if (linkedinAccount.sourceType !== "browser-profile") {
    return {
      channel: "linkedin",
      status: "unavailable",
      reason: "The LinkedIn account is not resolved through a claimed browser profile, so Exo has no durable quota source for connection-request pacing yet.",
      account: {
        id: linkedinAccount.id,
        handle: linkedinAccount.handle,
        sourceType: linkedinAccount.sourceType,
        profileId: null,
        profileLabel: null
      },
      quota: {
        weeklyInvitations: null,
        dailyInvitationsTarget: null
      },
      execution,
      plannerItem: null
    };
  }

  const profile = profiles.find((candidate) => candidate.id === linkedinAccount.browserProfileId) ?? null;
  if (!profile) {
    return {
      channel: "linkedin",
      status: "unavailable",
      reason: "The LinkedIn account points at a browser profile that is missing from Exo state, so quota-driven pacing cannot be computed.",
      account: {
        id: linkedinAccount.id,
        handle: linkedinAccount.handle,
        sourceType: linkedinAccount.sourceType,
        profileId: linkedinAccount.browserProfileId,
        profileLabel: null
      },
      quota: {
        weeklyInvitations: null,
        dailyInvitationsTarget: null
      },
      execution,
      plannerItem: null
    };
  }

  const weeklyInvitations = profile.automationControls.weeklyQuotas.invitations;
  if (weeklyInvitations === null) {
    return {
      channel: "linkedin",
      status: "needs_configuration",
      reason: "The claimed LinkedIn browser profile has no connection-request quota stored, so Exo cannot compute today's invitation deficit yet.",
      account: {
        id: linkedinAccount.id,
        handle: linkedinAccount.handle,
        sourceType: linkedinAccount.sourceType,
        profileId: profile.id,
        profileLabel: profile.label
      },
      quota: {
        weeklyInvitations: null,
        dailyInvitationsTarget: null
      },
      execution,
      plannerItem: {
        kind: "configure_connection_request_quota",
        priority: "action",
        priorityRank: 0.9,
        dueAt: now.toISOString(),
        whyItMatters: `Exo cannot tell whether ${user.label} is filling today's LinkedIn invitation capacity because ${profile.label} has no stored connection-request quota.`,
        recommendedAction: `Set a durable LinkedIn connection-request quota on ${profile.label}, then rerun daily and next so Exo can compute today's deficit.`,
        guidanceKey: "configure_connection_request_quota",
        context: {
          userLabel: user.label,
          profileId: profile.id,
          profileLabel: profile.label,
          accountHandle: linkedinAccount.handle
        }
      }
    };
  }

  const dailyInvitationsTarget = Math.ceil(weeklyInvitations / BUSINESS_DAYS_PER_WEEK);
  const remainingInvitationsToday = Math.max(dailyInvitationsTarget - sentToday, 0);
  const inventoryShortfall = Math.max(remainingInvitationsToday - readyConnectionRequests, 0);
  const configuredResult = {
    channel: "linkedin",
    status: "configured",
    reason: remainingInvitationsToday > 0
      ? `${remainingInvitationsToday} invitation${remainingInvitationsToday === 1 ? "" : "s"} remain against today's target.`
      : "Today's invitation target is already satisfied from stored touch state.",
    account: {
      id: linkedinAccount.id,
      handle: linkedinAccount.handle,
      sourceType: linkedinAccount.sourceType,
      profileId: profile.id,
      profileLabel: profile.label
    },
    quota: {
      weeklyInvitations,
      dailyInvitationsTarget
    },
    execution: {
      ...execution,
      remainingInvitationsToday,
      inventoryShortfall
    },
    plannerItem: null
  };

  if (remainingInvitationsToday === 0) {
    return configuredResult;
  }

  const backlogAction = inventoryShortfall > 0
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
  const whyItMatters = `LinkedIn target is ${dailyInvitationsTarget} invitation${dailyInvitationsTarget === 1 ? "" : "s"} today. ${sentToday} ${sentToday === 1 ? "has" : "have"} been sent today, ${pendingInvitations} ${pendingInvitations === 1 ? "is" : "are"} still pending from prior work, ${readyConnectionRequests} more branch${readyConnectionRequests === 1 ? "" : "es"} ${readyConnectionRequests === 1 ? "is" : "are"} ready right now, and ${remainingInvitationsToday} invitation${remainingInvitationsToday === 1 ? "" : "s"} still need to be filled today.`;

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
        profileId: profile.id,
        profileLabel: profile.label,
        accountHandle: linkedinAccount.handle,
        dailyInvitationTarget: String(dailyInvitationsTarget),
        sentTodayCount: String(sentToday),
        pendingInvitationCount: String(pendingInvitations),
        readyConnectionRequestCount: String(readyConnectionRequests),
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
        firstClaimableProspectResearchProspectName: packets.claimableItemsByKind.prospect_research?.[0]?.prospectName ?? ""
      }
    }
  };
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

  if (selectedCount > 0) {
    return {
      kind: "fill_connection_request_deficit",
      guidanceKey: "fill_connection_request_deficit",
      recommendedAction: `Finish through-lines, opening plans, and cadence on ${selectedCount} selected prospect${selectedCount === 1 ? "" : "s"} so the motion can close ${inventoryShortfall} more ready branch${inventoryShortfall === 1 ? "" : "es"} today.`
    };
  }

  if (researchedCount > 0) {
    return {
      kind: "fill_connection_request_deficit",
      guidanceKey: "fill_connection_request_deficit",
      recommendedAction: `Select prospects from ${researchedCount} researched account${researchedCount === 1 ? "" : "s"} so the motion can refill ${inventoryShortfall} ready branch${inventoryShortfall === 1 ? "" : "es"} for today's invitation target.`
    };
  }

  if (queuedResearchCount > 0) {
    return {
      kind: "fill_connection_request_deficit",
      guidanceKey: "fill_connection_request_deficit",
      recommendedAction: `Research ${queuedResearchCount} discovered or queued company${queuedResearchCount === 1 ? "" : "ies"} so the motion can manufacture ${remainingInvitationsToday} more ready LinkedIn connection-request branch${remainingInvitationsToday === 1 ? "" : "es"} today.`
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
 * @param {string} value
 */
function lowercaseSentenceStart(value) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}
