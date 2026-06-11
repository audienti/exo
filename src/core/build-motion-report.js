// @ts-check

import { motionSchema } from "../schema/motion.js";
import { evaluateMotionTargeting } from "./evaluate-motion-targeting.js";
import { buildMotionProspectView } from "./build-motion-prospect-view.js";
import { buildPacketReviewView } from "./build-packet-review-view.js";

const TERMINAL_DISPOSITIONS = new Set(["not_a_fit", "no_longer_target", "exhausted"]);

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 * @param {unknown[]} rawProfiles
 * @param {unknown[]} rawUsers
 * @param {{
 *   capability?: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type,
 *   now?: string | null,
 *   rawActivityEvents?: unknown[] | null
 * }} [options]
 */
export function buildMotionReport(rawMotion, rawCompanies, rawProfiles, rawUsers, options = {}) {
  const motion = motionSchema.parse(rawMotion);
  const targeting = evaluateMotionTargeting(rawMotion, rawCompanies, rawProfiles, rawUsers, options);
  const prospects = buildMotionProspectView(rawMotion);
  const packetReview = buildPacketReviewView([motion], rawCompanies, {
    now: options.now,
    motionId: motion.id,
  });
  const lifecycle = buildMotionLifecycleReport(motion, prospects, packetReview, options.rawActivityEvents ?? []);
  const executionByCompanyId = new Map(
    (targeting.companyLoop?.items ?? []).map((item) => [item.companyId, item]),
  );
  const signalIndex = new Map(
    motion.signals.map((signal, index) => [signal.id, { signal, index: index + 1 }]),
  );

  return {
    motion: {
      id: motion.id,
      name: motion.name,
      status: motion.status,
      sourceUrl: motion.offer.sourceUrl,
      createdAt: motion.createdAt,
      updatedAt: motion.updatedAt,
      offer: {
        sourceUrl: motion.offer.sourceUrl,
        offerNotes: motion.offer.offerNotes,
      },
      offerThesis: {
        sourceUrl: motion.offerThesis.sourceUrl,
        sourceTitle: motion.offerThesis.sourceTitle,
        sourceDescription: motion.offerThesis.sourceDescription,
        sourceSummary: motion.offerThesis.sourceSummary,
        offerNotes: motion.offerThesis.offerNotes,
        problemThesis: motion.offerThesis.problemThesis,
        buyerImpactThesis: motion.offerThesis.buyerImpactThesis,
        likelyTriggerThesis: motion.offerThesis.likelyTriggerThesis,
        likelyRoleThesis: motion.offerThesis.likelyRoleThesis,
        likelySegmentThesis: motion.offerThesis.likelySegmentThesis,
        status: motion.offerThesis.status,
      },
      premise: {
        status: motion.premise.status,
        statement: motion.premise.statement,
        notes: motion.premise.notes,
        source: motion.premise.source,
      },
      setup: {
        audienceHypotheses: motion.audienceHypotheses.map((audience) => ({
          id: audience.id,
          name: audience.name,
          companyCriteria: audience.companyCriteria,
          roleCriteria: audience.roleCriteria,
          notes: audience.notes,
          confidence: audience.confidence,
        })),
        signals: motion.signals.map((signal) => ({
          id: signal.id,
          name: signal.name,
          question: signal.question,
          scope: signal.scope,
          whyItMatters: signal.whyItMatters,
          matchRule: signal.matchRule,
          audienceIds: signal.audienceIds,
          observationMethods: signal.observationMethods,
          status: signal.status,
        })),
        targetingProfile: {
          stakeholderTargetCount: motion.targetingProfile.stakeholderTargetCount,
          targetTitles: motion.targetingProfile.targetTitles,
          roleFamilies: motion.targetingProfile.roleFamilies,
          industries: motion.targetingProfile.industries,
          geolocations: motion.targetingProfile.geolocations,
          segmentVariants: motion.targetingProfile.segmentVariants
        },
        suppression: {
          excludedAccountsCount: motion.suppressionPolicy.excludedAccounts.length,
          excludedDomainsCount: motion.suppressionPolicy.excludedDomains.length,
          excludedContactsCount: motion.suppressionPolicy.excludedContacts.length,
          doNotContactEntryCount: motion.suppressionPolicy.doNotContactEntries.length
        },
        nextSteps: motion.nextSteps,
      },
      assignments: {
        pinnedUser: motion.engagementUserAssignment,
        pinnedProfile: motion.engagementProfileAssignment,
      },
    },
    targeting,
    prospects,
    lifecycle,
    matches: {
      companies: motion.targetMap.accounts.map((account) => {
        const execution = executionByCompanyId.get(account.companyId) ?? null;
        return {
          companyId: account.companyId,
          companyName: account.companyName,
          domain: account.domain,
          websiteUrl: account.websiteUrl,
          linkedinCompanyUrl: account.linkedinCompanyUrl,
          companyLogoSourceUrl: account.companyLogoSourceUrl,
          companyLogoUrl: account.companyLogoUrl,
          queueStatus: account.queueState.status,
          disposition: account.disposition,
          packetStatus: account.packetStatus,
          prospectCount: account.prospects.length,
          signalMatchCount: account.signalMatches.length,
          latestMatchAt: latestSignalTimestamp(account.signalMatches),
          matchedSignals: buildMatchedSignals(account.signalMatches, signalIndex),
          executionIdentity: execution?.executionIdentity ?? null,
        };
      }),
      people: prospects.prospects.map((prospect) => {
        const execution = executionByCompanyId.get(prospect.companyId) ?? null;
        return {
          companyId: prospect.companyId,
          companyName: prospect.companyName,
          prospectId: prospect.prospectId,
          name: prospect.name,
          title: prospect.title,
          linkedinProfileUrl: prospect.linkedinProfileUrl,
          avatarSourceUrl: prospect.avatarSourceUrl,
          avatarUrl: prospect.avatarUrl,
          queueStatus: prospect.queueStatus,
          crossMotionOwner: prospect.crossMotionOwner ?? null,
          accountDisposition: prospect.accountDisposition,
          disposition: prospect.disposition,
          packetStatus: prospect.packetStatus,
          fitConfidence: prospect.fitConfidence,
          whyRelevant: prospect.whyRelevant,
          lastTouchAt: prospect.cadenceState?.lastTouchAt ?? null,
          matchedSignals: buildMatchedSignals(prospect.signalMatches, signalIndex),
          executionIdentity: execution?.executionIdentity ?? null,
          ownerLabel: execution?.executionIdentity?.user?.label
            ?? execution?.executionIdentity?.profile?.label
            ?? null,
        };
      }),
    },
    execution: {
      readyToTarget: targeting.readyToTarget,
      readyToEngage: targeting.readyToEngage,
      companyCount: targeting.companyLoop?.companyCount ?? 0,
      readyCompanyCount: targeting.companyLoop?.readyCount ?? 0,
      prospectCount: prospects.counts?.prospectCount ?? 0,
      readyToSendCount: targeting.queue?.readyToSendCount ?? 0,
      messageTestReadyCount: prospects.counts?.messageTestReadyCount ?? 0,
      recentPostReadyCount: prospects.counts?.recentPostReadyCount ?? 0,
      emailFallbackCount: prospects.counts?.emailFallbackCount ?? 0,
    },
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {ReturnType<typeof buildMotionProspectView>} prospects
 * @param {ReturnType<typeof buildPacketReviewView>} packetReview
 * @param {unknown[]} rawActivityEvents
 */
function buildMotionLifecycleReport(motion, prospects, packetReview, rawActivityEvents) {
  const dispositionEvents = rawActivityEvents
    .filter((event) => event && typeof event === "object" && !Array.isArray(event))
    .filter((event) => event.payload?.type === "disposition_changed");
  const accountEventsByCompanyId = buildDispositionEventIndex(dispositionEvents, "account");
  const prospectEventsByProspectId = buildDispositionEventIndex(dispositionEvents, "prospect");
  const accountBranches = motion.targetMap.accounts.map((account) =>
    buildAccountLifecycleBranch(account, accountEventsByCompanyId.get(account.companyId) ?? [])
  );
  const prospectBranches = prospects.prospects.map((prospect) =>
    buildProspectLifecycleBranch(prospect, prospectEventsByProspectId.get(prospect.prospectId) ?? [])
  );
  const nurtureAccounts = accountBranches.filter((branch) => branch.disposition === "nurture");
  const nurtureProspects = prospectBranches.filter((branch) => branch.disposition === "nurture");
  const accountByCompanyId = new Map(accountBranches.map((branch) => [branch.companyId, branch]));
  const prospectByProspectId = new Map(prospectBranches.map((branch) => [branch.prospectId, branch]));

  return {
    counts: {
      accounts: buildLifecycleCounts(accountBranches),
      prospects: buildLifecycleCounts(prospectBranches),
    },
    review: {
      pendingCount: packetReview.count,
      oldestSubmittedAt: packetReview.oldestSubmittedAt,
      oldestAgeSeconds: packetReview.oldestAgeSeconds,
      oldestAgeLabel: packetReview.items[0]?.ageLabel ?? null,
      items: packetReview.items.map((item) => ({
        packetId: item.packetId,
        packetKind: item.packetKind,
        packetLabel: item.packetLabel,
        subject: item.subject,
        motion: item.motion,
        company: item.company,
        prospect: item.prospect,
        submittedAt: item.submittedAt,
        ageSeconds: item.ageSeconds,
        ageLabel: item.ageLabel,
        proposal: item.proposal,
        commands: item.commands,
      })),
    },
    nurtureShelf: {
      count: nurtureAccounts.length + nurtureProspects.length,
      accounts: nurtureAccounts,
      prospects: nurtureProspects,
    },
    branchEndedTimeline: dispositionEvents
      .filter((event) => event.payload?.to && event.payload.to !== "active")
      .map((event) => buildBranchEndedTimelineEntry(event, accountByCompanyId, prospectByProspectId))
      .filter(Boolean),
  };
}

/**
 * @param {unknown[]} events
 * @param {"account" | "prospect"} subject
 */
function buildDispositionEventIndex(events, subject) {
  const index = new Map();
  for (const event of events) {
    if (event.payload?.subject !== subject) continue;
    const key = subject === "account" ? event.companyId : event.prospectId;
    if (!key) continue;
    const existing = index.get(key) ?? [];
    existing.push(event);
    index.set(key, existing);
  }
  return index;
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {any[]} events
 */
function buildAccountLifecycleBranch(account, events) {
  const event = latestDispositionEventFor(events, account.disposition);
  return {
    type: "account",
    companyId: account.companyId,
    companyName: account.companyName,
    prospectId: null,
    prospectName: null,
    prospectTitle: null,
    disposition: account.disposition,
    queueStatus: account.queueState.status,
    packetStatus: account.packetStatus,
    reason: event?.payload?.reason ?? null,
    actor: event?.payload?.actor ?? null,
    changedAt: event?.occurredAt ?? null,
  };
}

/**
 * @param {ReturnType<typeof buildMotionProspectView>["prospects"][number]} prospect
 * @param {any[]} events
 */
function buildProspectLifecycleBranch(prospect, events) {
  const event = latestDispositionEventFor(events, prospect.disposition);
  return {
    type: "prospect",
    companyId: prospect.companyId,
    companyName: prospect.companyName,
    prospectId: prospect.prospectId,
    prospectName: prospect.name,
    prospectTitle: prospect.title,
    disposition: prospect.disposition,
    accountDisposition: prospect.accountDisposition,
    queueStatus: prospect.queueStatus,
    packetStatus: prospect.packetStatus,
    reason: event?.payload?.reason ?? null,
    actor: event?.payload?.actor ?? null,
    changedAt: event?.occurredAt ?? null,
  };
}

/**
 * @param {any[]} events
 * @param {string} disposition
 */
function latestDispositionEventFor(events, disposition) {
  return events.find((event) => event.payload?.to === disposition) ?? null;
}

/**
 * @param {Array<{ disposition: string, reason?: string | null }>} branches
 */
function buildLifecycleCounts(branches) {
  const byDisposition = branches.reduce((counts, branch) => {
    counts[branch.disposition] = (counts[branch.disposition] ?? 0) + 1;
    return counts;
  }, /** @type {Record<string, number>} */ ({}));
  const terminalBranches = branches.filter((branch) => TERMINAL_DISPOSITIONS.has(branch.disposition));
  const nurtureBranches = branches.filter((branch) => branch.disposition === "nurture");

  return {
    total: branches.length,
    active: byDisposition.active ?? 0,
    nurture: byDisposition.nurture ?? 0,
    terminal: terminalBranches.length,
    byDisposition,
    nurtureByReason: buildReasonCounts(nurtureBranches),
    terminalByReason: buildReasonCounts(terminalBranches),
  };
}

/**
 * @param {Array<{ reason?: string | null }>} branches
 */
function buildReasonCounts(branches) {
  return branches.reduce((counts, branch) => {
    const reason = branch.reason ?? "unspecified";
    counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
  }, /** @type {Record<string, number>} */ ({}));
}

/**
 * @param {any} event
 * @param {Map<string, any>} accountByCompanyId
 * @param {Map<string, any>} prospectByProspectId
 */
function buildBranchEndedTimelineEntry(event, accountByCompanyId, prospectByProspectId) {
  const subjectType = event.payload?.subject;
  if (subjectType !== "account" && subjectType !== "prospect") return null;
  const account = event.companyId ? accountByCompanyId.get(event.companyId) ?? null : null;
  const prospect = event.prospectId ? prospectByProspectId.get(event.prospectId) ?? null : null;

  return {
    id: event.id,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    subjectType,
    companyId: event.companyId ?? account?.companyId ?? prospect?.companyId ?? null,
    companyName: account?.companyName ?? prospect?.companyName ?? null,
    prospectId: event.prospectId ?? null,
    prospectName: prospect?.prospectName ?? null,
    prospectTitle: prospect?.prospectTitle ?? null,
    from: event.payload?.from ?? null,
    to: event.payload?.to ?? null,
    reason: event.payload?.reason ?? null,
    actor: event.payload?.actor ?? null,
  };
}

/**
 * @param {Array<{
 *   signalId: string,
 *   signalName: string,
 *   signalScope: string,
 *   summary: string,
 *   observedAt: string | null,
 *   recordedAt: string,
 *   subject: { type: string, personName: string | null, personTitle: string | null }
 * }>} signalMatches
 */
function latestSignalTimestamp(signalMatches) {
  return signalMatches
    .map((match) => match.observedAt ?? match.recordedAt)
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}

/**
 * @param {Array<{
 *   signalId: string,
 *   signalName: string,
 *   signalScope: string,
 *   summary: string,
 *   observedAt: string | null,
 *   recordedAt: string,
 *   subject: { type: string, personName: string | null, personTitle: string | null }
 * }>} signalMatches
 * @param {Map<string, { signal: import("../schema/signal.js").signalSchema._type, index: number }>} signalIndex
 */
function buildMatchedSignals(signalMatches, signalIndex) {
  const seen = new Set();

  return signalMatches
    .filter((match) => {
      if (seen.has(match.id ?? `${match.signalId}:${match.summary}`)) {
        return false;
      }
      seen.add(match.id ?? `${match.signalId}:${match.summary}`);
      return true;
    })
    .map((match) => {
      const indexed = signalIndex.get(match.signalId);
      return {
        signalId: match.signalId,
        signalIndex: indexed?.index ?? null,
        signalName: match.signalName,
        question: indexed?.signal.question ?? match.signalName,
        scope: match.signalScope,
        summary: match.summary,
        observedAt: match.observedAt ?? match.recordedAt,
        subject: match.subject,
      };
    })
    .sort((left, right) => {
      const leftAt = left.observedAt ? new Date(left.observedAt).getTime() : 0;
      const rightAt = right.observedAt ? new Date(right.observedAt).getTime() : 0;
      return rightAt - leftAt;
    });
}
