// @ts-check

import { motionSchema } from "../schema/motion.js";
import { evaluateMotionTargeting } from "./evaluate-motion-targeting.js";
import { buildMotionProspectView } from "./build-motion-prospect-view.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 * @param {unknown[]} rawProfiles
 * @param {unknown[]} rawUsers
 * @param {{
 *   capability?: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type
 * }} [options]
 */
export function buildMotionReport(rawMotion, rawCompanies, rawProfiles, rawUsers, options = {}) {
  const motion = motionSchema.parse(rawMotion);
  const targeting = evaluateMotionTargeting(rawMotion, rawCompanies, rawProfiles, rawUsers, options);
  const prospects = buildMotionProspectView(rawMotion);
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
