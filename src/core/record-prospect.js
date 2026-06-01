// @ts-check

import crypto from "node:crypto";
import { prospectSchema, targetAccountSchema } from "../schema/target-account.js";
import {
  mergeContactPointLists,
  withDerivedProspectContacts
} from "../lib/prospect-contacts.js";
import { applyManualProspectQueueState, isMotionQueueStatus } from "../lib/motion-queue.js";
import { normalizeImageProxyFields } from "../lib/image-proxy.js";
import {
  finalizeTargetAccountUpdate,
  normalizeNullableString,
  normalizeStringArray,
  prepareTargetAccountContext
} from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   name: string,
 *   title: string,
 *   linkedinProfileUrl?: string | null | undefined,
 *   avatarSourceUrl?: string | null | undefined,
 *   email?: string | null | undefined,
 *   buyingCommitteeRole?: import("../schema/target-account.js").prospectSchema._type["buyingCommitteeRole"],
 *   decisionAuthority?: import("../schema/target-account.js").prospectSchema._type["decisionAuthority"],
 *   fitConfidence?: "low" | "moderate" | "high" | "unknown",
 *   whyRelevant: string,
 *   sourceUrl?: string | null | undefined,
 *   observedAt?: string | null | undefined,
 *   profileViewedAt?: string | null | undefined,
 *   roleTruth?: {
 *     currentRoleDescription?: string | null | undefined,
 *     summary?: string | null | undefined,
 *     operatingMode?: string | null | undefined,
 *     scope?: string | null | undefined,
 *     evidence?: string[]
 *   },
 *   triggerWindow?: {
 *     summary?: string | null | undefined,
 *     tenureMonths?: number | null | undefined,
 *     tenureBand?: import("../schema/target-account.js").triggerWindowSchema._type["tenureBand"],
 *     whyNowAnchor?: string | null | undefined,
 *     personTriggers?: string[],
 *     companyTriggers?: string[]
 *   },
 *   identityTells?: {
 *     summary?: string | null | undefined,
 *     headline?: string | null | undefined,
 *     aboutQuotes?: string[],
 *     frameworks?: string[],
 *     certifications?: string[],
 *     quantifiedReceipts?: string[],
 *     selfImageVerbs?: string[],
 *     metaphors?: string[]
 *   },
 *   linkedinProfileSnapshot?: {
 *     capturedAt?: string | null | undefined,
 *     profileUrl?: string | null | undefined,
 *     publicId?: string | null | undefined,
 *     memberId?: string | null | undefined,
 *     displayName?: string | null | undefined,
 *     currentRoleTitle?: string | null | undefined,
 *     currentCompanyName?: string | null | undefined,
 *     headline?: string | null | undefined,
 *     location?: string | null | undefined,
 *     about?: string | null | undefined,
 *     followerCount?: number | null | undefined,
 *     connectionCount?: number | null | undefined,
 *     recentPosts?: Array<{
 *       activityType?: string | null | undefined,
 *       url?: string | null | undefined,
 *       postedAt?: string | null | undefined,
 *       freshnessBand?: import("../schema/target-account.js").linkedinRecentPostSchema._type["freshnessBand"],
 *       summary?: string | null | undefined,
 *       snippet?: string | null | undefined
 *     }>
 *   },
 *   liveSignal?: {
 *     channel?: string | null | undefined,
 *     activityType?: string | null | undefined,
 *     summary?: string | null | undefined,
 *     url?: string | null | undefined,
 *     observedAt?: string | null | undefined,
 *     freshnessBand?: import("../schema/target-account.js").liveSignalSchema._type["freshnessBand"],
 *     hookStrength?: "low" | "moderate" | "high" | "unknown" | null | undefined,
 *     engagementRationale?: string | null | undefined
 *   },
 *   contactPoints?: Array<{
 *     id?: string | null | undefined,
 *     kind: import("../schema/target-account.js").contactPointSchema._type["kind"],
 *     value: string,
 *     label?: string | null | undefined,
 *     matchStatus?: import("../schema/target-account.js").contactPointSchema._type["matchStatus"],
 *     verificationStatus?: import("../schema/target-account.js").contactPointSchema._type["verificationStatus"],
 *     confidence?: "low" | "moderate" | "high" | "unknown",
 *     source?: string | null | undefined,
 *     sourceUrl?: string | null | undefined,
 *     observedAt?: string | null | undefined,
 *     notes?: string | null | undefined,
 *     evidence?: Array<{
 *       type: string,
 *       summary: string,
 *       sourceUrl?: string | null | undefined,
 *       observedAt?: string | null | undefined
 *     }>,
 *     usableForOutreach?: boolean | undefined,
 *     usableForResearch?: boolean | undefined,
 *     usableForWarmup?: boolean | undefined
 *   }>,
 *   contactEnrichmentState?: {
 *     status?: import("../schema/target-account.js").contactEnrichmentStateSchema._type["status"],
 *     sourcesTried?: string[],
 *     missingChannels?: string[],
 *     bestDirectChannels?: string[],
 *     lastEnrichedAt?: string | null | undefined,
 *     notes?: string | null | undefined
 *   },
 *   notes?: string | null | undefined,
 *   signalMatchIds?: string[],
 *   queueState?: {
 *     status?: string | null | undefined,
 *     notes?: string | null | undefined
 *   }
 * }} input
 */
export function recordMotionProspect(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const normalizedSignalMatchIds = normalizeSignalMatchIds(baseAccount, company.name, input.signalMatchIds);
  const avatar = normalizeImageProxyFields(input.avatarSourceUrl);

  const nextProspect = {
    id: crypto.randomUUID(),
    name: input.name,
    title: input.title,
    linkedinProfileUrl: normalizeOptionalNullableString(input.linkedinProfileUrl),
    avatarSourceUrl: avatar.sourceUrl,
    avatarUrl: avatar.proxyUrl,
    email: normalizeOptionalNullableString(input.email),
    buyingCommitteeRole: input.buyingCommitteeRole,
    decisionAuthority: input.decisionAuthority,
    fitConfidence: input.fitConfidence,
    whyRelevant: input.whyRelevant,
    sourceUrl: normalizeOptionalNullableString(input.sourceUrl),
    observedAt: normalizeOptionalNullableString(input.observedAt),
    profileViewedAt: normalizeOptionalNullableString(input.profileViewedAt),
    roleTruth: {
      currentRoleDescription: normalizeOptionalNullableString(input.roleTruth?.currentRoleDescription),
      summary: normalizeOptionalNullableString(input.roleTruth?.summary),
      operatingMode: normalizeOptionalNullableString(input.roleTruth?.operatingMode),
      scope: normalizeOptionalNullableString(input.roleTruth?.scope),
      evidence: input.roleTruth?.evidence !== undefined ? normalizeStringArray(input.roleTruth.evidence) : undefined
    },
    triggerWindow: {
      summary: normalizeOptionalNullableString(input.triggerWindow?.summary),
      tenureMonths: input.triggerWindow?.tenureMonths === undefined ? undefined : input.triggerWindow.tenureMonths,
      tenureBand: input.triggerWindow?.tenureBand,
      whyNowAnchor: normalizeOptionalNullableString(input.triggerWindow?.whyNowAnchor),
      personTriggers:
        input.triggerWindow?.personTriggers !== undefined
          ? normalizeStringArray(input.triggerWindow.personTriggers)
          : undefined,
      companyTriggers:
        input.triggerWindow?.companyTriggers !== undefined
          ? normalizeStringArray(input.triggerWindow.companyTriggers)
          : undefined
    },
    identityTells: {
      summary: normalizeOptionalNullableString(input.identityTells?.summary),
      headline: normalizeOptionalNullableString(input.identityTells?.headline),
      aboutQuotes:
        input.identityTells?.aboutQuotes !== undefined
          ? normalizeStringArray(input.identityTells.aboutQuotes)
          : undefined,
      frameworks:
        input.identityTells?.frameworks !== undefined
          ? normalizeStringArray(input.identityTells.frameworks)
          : undefined,
      certifications:
        input.identityTells?.certifications !== undefined
          ? normalizeStringArray(input.identityTells.certifications)
          : undefined,
      quantifiedReceipts:
        input.identityTells?.quantifiedReceipts !== undefined
          ? normalizeStringArray(input.identityTells.quantifiedReceipts)
          : undefined,
      selfImageVerbs:
        input.identityTells?.selfImageVerbs !== undefined
          ? normalizeStringArray(input.identityTells.selfImageVerbs)
          : undefined,
      metaphors:
        input.identityTells?.metaphors !== undefined
          ? normalizeStringArray(input.identityTells.metaphors)
          : undefined
    },
    linkedinProfileSnapshot: buildLinkedinProfileSnapshotInput(input.linkedinProfileSnapshot),
    liveSignal: {
      channel: normalizeOptionalNullableString(input.liveSignal?.channel),
      activityType: normalizeOptionalNullableString(input.liveSignal?.activityType),
      summary: normalizeOptionalNullableString(input.liveSignal?.summary),
      url: normalizeOptionalNullableString(input.liveSignal?.url),
      observedAt: normalizeOptionalNullableString(input.liveSignal?.observedAt),
      freshnessBand: input.liveSignal?.freshnessBand,
      hookStrength: input.liveSignal?.hookStrength,
      engagementRationale: normalizeOptionalNullableString(input.liveSignal?.engagementRationale)
    },
    contactPoints: buildContactPointInputs(input.contactPoints),
    contactEnrichmentState: buildContactEnrichmentStateInput(input.contactEnrichmentState),
    notes: normalizeOptionalNullableString(input.notes),
    signalMatchIds: normalizedSignalMatchIds,
    queueState: buildProspectQueueStateInput(input.queueState)
  };

  const prospects = upsertProspect(baseAccount.prospects, nextProspect, motion.targetingProfile.stakeholderTargetCount, now);
  const updatedAccount = targetAccountSchema.parse({
    ...baseAccount,
    companyName: company.name,
    domain: company.domain,
    websiteUrl: company.websiteUrl,
    linkedinCompanyUrl: company.linkedinCompanyUrl,
    companyLogoSourceUrl: company.logoSourceUrl,
    companyLogoUrl: company.logoUrl,
    lastResearchAt: now,
    prospects
  });

  return finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
}

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   prospectId: string,
 *   name?: string | undefined,
 *   title?: string | undefined,
 *   linkedinProfileUrl?: string | null | undefined,
 *   avatarSourceUrl?: string | null | undefined,
 *   email?: string | null | undefined,
 *   buyingCommitteeRole?: import("../schema/target-account.js").prospectSchema._type["buyingCommitteeRole"],
 *   decisionAuthority?: import("../schema/target-account.js").prospectSchema._type["decisionAuthority"],
 *   fitConfidence?: "low" | "moderate" | "high" | "unknown",
 *   whyRelevant?: string | undefined,
 *   sourceUrl?: string | null | undefined,
 *   observedAt?: string | null | undefined,
 *   profileViewedAt?: string | null | undefined,
 *   roleTruth?: {
 *     currentRoleDescription?: string | null | undefined,
 *     summary?: string | null | undefined,
 *     operatingMode?: string | null | undefined,
 *     scope?: string | null | undefined,
 *     evidence?: string[]
 *   },
 *   triggerWindow?: {
 *     summary?: string | null | undefined,
 *     tenureMonths?: number | null | undefined,
 *     tenureBand?: import("../schema/target-account.js").triggerWindowSchema._type["tenureBand"],
 *     whyNowAnchor?: string | null | undefined,
 *     personTriggers?: string[],
 *     companyTriggers?: string[]
 *   },
 *   identityTells?: {
 *     summary?: string | null | undefined,
 *     headline?: string | null | undefined,
 *     aboutQuotes?: string[],
 *     frameworks?: string[],
 *     certifications?: string[],
 *     quantifiedReceipts?: string[],
 *     selfImageVerbs?: string[],
 *     metaphors?: string[]
 *   },
 *   linkedinProfileSnapshot?: {
 *     capturedAt?: string | null | undefined,
 *     profileUrl?: string | null | undefined,
 *     publicId?: string | null | undefined,
 *     memberId?: string | null | undefined,
 *     displayName?: string | null | undefined,
 *     currentRoleTitle?: string | null | undefined,
 *     currentCompanyName?: string | null | undefined,
 *     headline?: string | null | undefined,
 *     location?: string | null | undefined,
 *     about?: string | null | undefined,
 *     followerCount?: number | null | undefined,
 *     connectionCount?: number | null | undefined,
 *     recentPosts?: Array<{
 *       activityType?: string | null | undefined,
 *       url?: string | null | undefined,
 *       postedAt?: string | null | undefined,
 *       freshnessBand?: import("../schema/target-account.js").linkedinRecentPostSchema._type["freshnessBand"],
 *       summary?: string | null | undefined,
 *       snippet?: string | null | undefined
 *     }>
 *   },
 *   liveSignal?: {
 *     channel?: string | null | undefined,
 *     activityType?: string | null | undefined,
 *     summary?: string | null | undefined,
 *     url?: string | null | undefined,
 *     observedAt?: string | null | undefined,
 *     freshnessBand?: import("../schema/target-account.js").liveSignalSchema._type["freshnessBand"],
 *     hookStrength?: "low" | "moderate" | "high" | "unknown" | null | undefined,
 *     engagementRationale?: string | null | undefined
 *   },
 *   contactPoints?: Array<{
 *     id?: string | null | undefined,
 *     kind: import("../schema/target-account.js").contactPointSchema._type["kind"],
 *     value: string,
 *     label?: string | null | undefined,
 *     matchStatus?: import("../schema/target-account.js").contactPointSchema._type["matchStatus"],
 *     verificationStatus?: import("../schema/target-account.js").contactPointSchema._type["verificationStatus"],
 *     confidence?: "low" | "moderate" | "high" | "unknown",
 *     source?: string | null | undefined,
 *     sourceUrl?: string | null | undefined,
 *     observedAt?: string | null | undefined,
 *     notes?: string | null | undefined,
 *     evidence?: Array<{
 *       type: string,
 *       summary: string,
 *       sourceUrl?: string | null | undefined,
 *       observedAt?: string | null | undefined
 *     }>,
 *     usableForOutreach?: boolean | undefined,
 *     usableForResearch?: boolean | undefined,
 *     usableForWarmup?: boolean | undefined
 *   }>,
 *   contactEnrichmentState?: {
 *     status?: import("../schema/target-account.js").contactEnrichmentStateSchema._type["status"],
 *     sourcesTried?: string[],
 *     missingChannels?: string[],
 *     bestDirectChannels?: string[],
 *     lastEnrichedAt?: string | null | undefined,
 *     notes?: string | null | undefined
 *   },
 *   notes?: string | null | undefined,
 *   signalMatchIds?: string[],
 *   queueState?: {
 *     status?: string | null | undefined,
 *     notes?: string | null | undefined
 *   }
 * }} input
 */
export function updateMotionProspect(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const existing = baseAccount.prospects.find((prospect) => prospect.id === input.prospectId);

  if (!existing) {
    throw new Error(`Prospect not found on ${company.name}: ${input.prospectId}`);
  }

  const normalizedSignalMatchIds = input.signalMatchIds === undefined
    ? undefined
    : normalizeSignalMatchIds(baseAccount, company.name, input.signalMatchIds);
  const avatar = normalizeImageProxyFields(input.avatarSourceUrl);

  const updatedProspects = baseAccount.prospects.map((prospect) => {
    if (prospect.id !== input.prospectId) {
      return prospect;
    }

    const updatedProspect = prospectSchema.parse(withDerivedProspectContacts({
      ...existing,
      name: input.name ?? existing.name,
      title: input.title ?? existing.title,
      linkedinProfileUrl:
        normalizeOptionalNullableString(input.linkedinProfileUrl) === undefined
          ? existing.linkedinProfileUrl
          : normalizeOptionalNullableString(input.linkedinProfileUrl),
      avatarSourceUrl:
        avatar.sourceUrl === undefined
          ? existing.avatarSourceUrl
          : avatar.sourceUrl,
      avatarUrl:
        avatar.proxyUrl === undefined
          ? existing.avatarUrl
          : avatar.proxyUrl,
      email:
        normalizeOptionalNullableString(input.email) === undefined
          ? existing.email
          : normalizeOptionalNullableString(input.email),
      buyingCommitteeRole: input.buyingCommitteeRole ?? existing.buyingCommitteeRole,
      decisionAuthority: input.decisionAuthority ?? existing.decisionAuthority,
      fitConfidence: input.fitConfidence ?? existing.fitConfidence,
      whyRelevant: input.whyRelevant ?? existing.whyRelevant,
      sourceUrl:
        normalizeOptionalNullableString(input.sourceUrl) === undefined
          ? existing.sourceUrl
          : normalizeOptionalNullableString(input.sourceUrl),
      observedAt:
        normalizeOptionalNullableString(input.observedAt) === undefined
          ? existing.observedAt
          : normalizeOptionalNullableString(input.observedAt),
      profileViewedAt:
        normalizeOptionalNullableString(input.profileViewedAt) === undefined
          ? existing.profileViewedAt
          : normalizeOptionalNullableString(input.profileViewedAt),
      roleTruth: buildRoleTruthUpdate(existing.roleTruth, {
        currentRoleDescription: normalizeOptionalNullableString(input.roleTruth?.currentRoleDescription),
        summary: normalizeOptionalNullableString(input.roleTruth?.summary),
        operatingMode: normalizeOptionalNullableString(input.roleTruth?.operatingMode),
        scope: normalizeOptionalNullableString(input.roleTruth?.scope),
        evidence: input.roleTruth?.evidence !== undefined ? normalizeStringArray(input.roleTruth.evidence) : undefined
      }),
      triggerWindow: buildTriggerWindowUpdate(existing.triggerWindow, {
        summary: normalizeOptionalNullableString(input.triggerWindow?.summary),
        tenureMonths: input.triggerWindow?.tenureMonths === undefined ? undefined : input.triggerWindow.tenureMonths,
        tenureBand: input.triggerWindow?.tenureBand,
        whyNowAnchor: normalizeOptionalNullableString(input.triggerWindow?.whyNowAnchor),
        personTriggers:
          input.triggerWindow?.personTriggers !== undefined
            ? normalizeStringArray(input.triggerWindow.personTriggers)
            : undefined,
        companyTriggers:
          input.triggerWindow?.companyTriggers !== undefined
            ? normalizeStringArray(input.triggerWindow.companyTriggers)
            : undefined
      }),
      identityTells: buildIdentityTellsUpdate(existing.identityTells, {
        summary: normalizeOptionalNullableString(input.identityTells?.summary),
        headline: normalizeOptionalNullableString(input.identityTells?.headline),
        aboutQuotes:
          input.identityTells?.aboutQuotes !== undefined
            ? normalizeStringArray(input.identityTells.aboutQuotes)
            : undefined,
        frameworks:
          input.identityTells?.frameworks !== undefined
            ? normalizeStringArray(input.identityTells.frameworks)
            : undefined,
        certifications:
          input.identityTells?.certifications !== undefined
            ? normalizeStringArray(input.identityTells.certifications)
            : undefined,
        quantifiedReceipts:
          input.identityTells?.quantifiedReceipts !== undefined
            ? normalizeStringArray(input.identityTells.quantifiedReceipts)
            : undefined,
        selfImageVerbs:
          input.identityTells?.selfImageVerbs !== undefined
            ? normalizeStringArray(input.identityTells.selfImageVerbs)
            : undefined,
        metaphors:
          input.identityTells?.metaphors !== undefined
            ? normalizeStringArray(input.identityTells.metaphors)
            : undefined
      }),
      linkedinProfileSnapshot: buildLinkedinProfileSnapshotUpdate(
        existing.linkedinProfileSnapshot,
        buildLinkedinProfileSnapshotInput(input.linkedinProfileSnapshot)
      ),
      liveSignal: buildLiveSignalUpdate(existing.liveSignal, {
        channel: normalizeOptionalNullableString(input.liveSignal?.channel),
        activityType: normalizeOptionalNullableString(input.liveSignal?.activityType),
        summary: normalizeOptionalNullableString(input.liveSignal?.summary),
        url: normalizeOptionalNullableString(input.liveSignal?.url),
        observedAt: normalizeOptionalNullableString(input.liveSignal?.observedAt),
        freshnessBand: input.liveSignal?.freshnessBand,
        hookStrength: input.liveSignal?.hookStrength,
        engagementRationale: normalizeOptionalNullableString(input.liveSignal?.engagementRationale)
      }),
      contactPoints:
        input.contactPoints === undefined
          ? existing.contactPoints
          : mergeContactPointLists(existing.contactPoints, buildContactPointInputs(input.contactPoints)),
      contactEnrichmentState: buildContactEnrichmentStateUpdate(existing.contactEnrichmentState, buildContactEnrichmentStateInput(input.contactEnrichmentState)),
      notes:
        normalizeOptionalNullableString(input.notes) === undefined
          ? existing.notes
          : normalizeOptionalNullableString(input.notes),
      signalMatchIds:
        normalizedSignalMatchIds === undefined
          ? existing.signalMatchIds
          : mergeStringLists(existing.signalMatchIds, normalizedSignalMatchIds)
    }));

    return input.queueState?.status
      ? prospectSchema.parse(applyManualProspectQueueState(updatedProspect, input.queueState, now))
      : updatedProspect;
  });

  const updatedAccount = targetAccountSchema.parse({
    ...baseAccount,
    companyName: company.name,
    domain: company.domain,
    websiteUrl: company.websiteUrl,
    linkedinCompanyUrl: company.linkedinCompanyUrl,
    companyLogoSourceUrl: company.logoSourceUrl,
    companyLogoUrl: company.logoUrl,
    lastResearchAt: now,
    prospects: updatedProspects
  });

  return finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type[]} prospects
 * @param {ReturnType<typeof buildMergeSeed>} nextProspect
 * @param {number} limit
 * @param {string} now
 */
function upsertProspect(prospects, nextProspect, limit, now) {
  const index = prospects.findIndex((prospect) => prospectsReferToSamePerson(prospect, nextProspect));

  if (index === -1) {
    if (prospects.length >= limit) {
      throw new Error(`Prospect limit reached (${limit}). Raise stakeholderTargetCount on the motion before adding another person.`);
    }

    const createdProspect = prospectSchema.parse(withDerivedProspectContacts({
        id: nextProspect.id,
        name: nextProspect.name,
        title: nextProspect.title,
        linkedinProfileUrl: nextProspect.linkedinProfileUrl ?? null,
        avatarSourceUrl: nextProspect.avatarSourceUrl ?? null,
        avatarUrl: nextProspect.avatarUrl ?? null,
        email: nextProspect.email ?? null,
        buyingCommitteeRole: nextProspect.buyingCommitteeRole ?? "other",
        decisionAuthority: nextProspect.decisionAuthority ?? "unknown",
        fitConfidence: nextProspect.fitConfidence ?? "unknown",
        whyRelevant: nextProspect.whyRelevant,
        sourceUrl: nextProspect.sourceUrl ?? null,
        observedAt: nextProspect.observedAt ?? null,
        profileViewedAt: nextProspect.profileViewedAt ?? null,
        roleTruth: buildRoleTruthUpdate({}, nextProspect.roleTruth),
        triggerWindow: buildTriggerWindowUpdate({}, nextProspect.triggerWindow),
        identityTells: buildIdentityTellsUpdate({}, nextProspect.identityTells),
        linkedinProfileSnapshot: buildLinkedinProfileSnapshotUpdate({}, nextProspect.linkedinProfileSnapshot),
        liveSignal: buildLiveSignalUpdate({}, nextProspect.liveSignal),
        contactPoints: nextProspect.contactPoints,
        contactEnrichmentState: buildContactEnrichmentStateUpdate({}, nextProspect.contactEnrichmentState),
        queueState: nextProspect.queueState ?? {},
        packetState: null,
        notes: nextProspect.notes ?? null,
        signalMatchIds: nextProspect.signalMatchIds,
        throughLine: {},
        openingPlan: {},
        cadenceState: {}
      }));

    return [
      ...prospects,
      nextProspect.queueState?.status
        ? prospectSchema.parse(applyManualProspectQueueState(createdProspect, nextProspect.queueState, now))
        : createdProspect
    ];
  }

  const existing = prospects[index];
  return prospects.map((prospect, prospectIndex) => {
    if (prospectIndex !== index) {
      return prospect;
    }

    const updatedProspect = prospectSchema.parse(withDerivedProspectContacts({
      ...existing,
      name: nextProspect.name,
      title: nextProspect.title,
      linkedinProfileUrl: nextProspect.linkedinProfileUrl ?? existing.linkedinProfileUrl,
      avatarSourceUrl: nextProspect.avatarSourceUrl ?? existing.avatarSourceUrl,
      avatarUrl: nextProspect.avatarUrl ?? existing.avatarUrl,
      email: nextProspect.email ?? existing.email,
      buyingCommitteeRole: nextProspect.buyingCommitteeRole ?? existing.buyingCommitteeRole,
      decisionAuthority: nextProspect.decisionAuthority ?? existing.decisionAuthority,
      fitConfidence: nextProspect.fitConfidence ?? existing.fitConfidence,
      whyRelevant: nextProspect.whyRelevant,
      sourceUrl: nextProspect.sourceUrl ?? existing.sourceUrl,
      observedAt: nextProspect.observedAt ?? existing.observedAt,
      profileViewedAt: nextProspect.profileViewedAt ?? existing.profileViewedAt,
      roleTruth: buildRoleTruthUpdate(existing.roleTruth, nextProspect.roleTruth),
      triggerWindow: buildTriggerWindowUpdate(existing.triggerWindow, nextProspect.triggerWindow),
      identityTells: buildIdentityTellsUpdate(existing.identityTells, nextProspect.identityTells),
      linkedinProfileSnapshot: buildLinkedinProfileSnapshotUpdate(
        existing.linkedinProfileSnapshot,
        nextProspect.linkedinProfileSnapshot
      ),
      liveSignal: buildLiveSignalUpdate(existing.liveSignal, nextProspect.liveSignal),
      contactPoints: mergeContactPointLists(existing.contactPoints, nextProspect.contactPoints),
      contactEnrichmentState: buildContactEnrichmentStateUpdate(existing.contactEnrichmentState, nextProspect.contactEnrichmentState),
      queueState: nextProspect.queueState ?? existing.queueState,
      packetState: existing.packetState,
      notes: nextProspect.notes ?? existing.notes,
      signalMatchIds: mergeStringLists(existing.signalMatchIds, nextProspect.signalMatchIds)
    }));

    return nextProspect.queueState?.status
      ? prospectSchema.parse(applyManualProspectQueueState(updatedProspect, nextProspect.queueState, now))
      : updatedProspect;
  });
}

/**
 * @param {{ status?: string | null | undefined, notes?: string | null | undefined } | undefined} input
 */
function buildProspectQueueStateInput(input) {
  if (!input) {
    return undefined;
  }

  return {
    status: isMotionQueueStatus(input.status) ? input.status : undefined,
    notes: normalizeOptionalNullableString(input.notes)
  };
}

/**
 * @param {Partial<import("../schema/target-account.js").prospectSchema._type>} left
 * @param {ReturnType<typeof buildMergeSeed>} right
 */
function prospectsReferToSamePerson(left, right) {
  if (left.linkedinProfileUrl && right.linkedinProfileUrl) {
    return left.linkedinProfileUrl === right.linkedinProfileUrl;
  }

  return (
    left.name?.trim().toLowerCase() === right.name.trim().toLowerCase()
    && left.title?.trim().toLowerCase() === right.title.trim().toLowerCase()
  );
}

/**
 * @param {import("../schema/target-account.js").roleTruthSchema._type | Record<string, never>} existing
 * @param {ReturnType<typeof buildMergeSeed>["roleTruth"]} [patch]
 */
function buildRoleTruthUpdate(existing, patch = {}) {
  return {
    currentRoleDescription: patch.currentRoleDescription ?? existing.currentRoleDescription ?? null,
    summary: patch.summary ?? existing.summary ?? null,
    operatingMode: patch.operatingMode ?? existing.operatingMode ?? null,
    scope: patch.scope ?? existing.scope ?? null,
    evidence:
      patch.evidence !== undefined
        ? mergeStringLists(existing.evidence ?? [], patch.evidence)
        : existing.evidence ?? []
  };
}

/**
 * @param {import("../schema/target-account.js").triggerWindowSchema._type | Record<string, never>} existing
 * @param {ReturnType<typeof buildMergeSeed>["triggerWindow"]} [patch]
 */
function buildTriggerWindowUpdate(existing, patch = {}) {
  return {
    summary: patch.summary ?? existing.summary ?? null,
    tenureMonths: patch.tenureMonths ?? existing.tenureMonths ?? null,
    tenureBand: patch.tenureBand ?? existing.tenureBand ?? null,
    whyNowAnchor: patch.whyNowAnchor ?? existing.whyNowAnchor ?? null,
    personTriggers:
      patch.personTriggers !== undefined
        ? mergeStringLists(existing.personTriggers ?? [], patch.personTriggers)
        : existing.personTriggers ?? [],
    companyTriggers:
      patch.companyTriggers !== undefined
        ? mergeStringLists(existing.companyTriggers ?? [], patch.companyTriggers)
        : existing.companyTriggers ?? []
  };
}

/**
 * @param {import("../schema/target-account.js").identityTellsSchema._type | Record<string, never>} existing
 * @param {ReturnType<typeof buildMergeSeed>["identityTells"]} [patch]
 */
function buildIdentityTellsUpdate(existing, patch = {}) {
  return {
    summary: patch.summary ?? existing.summary ?? null,
    headline: patch.headline ?? existing.headline ?? null,
    aboutQuotes:
      patch.aboutQuotes !== undefined
        ? mergeStringLists(existing.aboutQuotes ?? [], patch.aboutQuotes)
        : existing.aboutQuotes ?? [],
    frameworks:
      patch.frameworks !== undefined
        ? mergeStringLists(existing.frameworks ?? [], patch.frameworks)
        : existing.frameworks ?? [],
    certifications:
      patch.certifications !== undefined
        ? mergeStringLists(existing.certifications ?? [], patch.certifications)
        : existing.certifications ?? [],
    quantifiedReceipts:
      patch.quantifiedReceipts !== undefined
        ? mergeStringLists(existing.quantifiedReceipts ?? [], patch.quantifiedReceipts)
        : existing.quantifiedReceipts ?? [],
    selfImageVerbs:
      patch.selfImageVerbs !== undefined
        ? mergeStringLists(existing.selfImageVerbs ?? [], patch.selfImageVerbs)
        : existing.selfImageVerbs ?? [],
    metaphors:
      patch.metaphors !== undefined
        ? mergeStringLists(existing.metaphors ?? [], patch.metaphors)
        : existing.metaphors ?? []
  };
}

/**
 * @param {{
 *   capturedAt?: string | null | undefined,
 *   profileUrl?: string | null | undefined,
 *   publicId?: string | null | undefined,
 *   memberId?: string | null | undefined,
 *   displayName?: string | null | undefined,
 *   currentRoleTitle?: string | null | undefined,
 *   currentCompanyName?: string | null | undefined,
 *   headline?: string | null | undefined,
 *   location?: string | null | undefined,
 *   about?: string | null | undefined,
 *   followerCount?: number | null | undefined,
 *   connectionCount?: number | null | undefined,
 *   recentPosts?: Array<{
 *     activityType?: string | null | undefined,
 *     url?: string | null | undefined,
 *     postedAt?: string | null | undefined,
 *     freshnessBand?: import("../schema/target-account.js").linkedinRecentPostSchema._type["freshnessBand"],
 *     summary?: string | null | undefined,
 *     snippet?: string | null | undefined
 *   }>
 * } | undefined} snapshot
 */
function buildLinkedinProfileSnapshotInput(snapshot) {
  if (!snapshot) {
    return {};
  }

  return {
    capturedAt: normalizeOptionalNullableString(snapshot.capturedAt),
    profileUrl: normalizeOptionalNullableString(snapshot.profileUrl),
    publicId: normalizeOptionalNullableString(snapshot.publicId),
    memberId: normalizeOptionalNullableString(snapshot.memberId),
    displayName: normalizeOptionalNullableString(snapshot.displayName),
    currentRoleTitle: normalizeOptionalNullableString(snapshot.currentRoleTitle),
    currentCompanyName: normalizeOptionalNullableString(snapshot.currentCompanyName),
    headline: normalizeOptionalNullableString(snapshot.headline),
    location: normalizeOptionalNullableString(snapshot.location),
    about: normalizeOptionalNullableString(snapshot.about),
    followerCount: snapshot.followerCount === undefined ? undefined : snapshot.followerCount,
    connectionCount: snapshot.connectionCount === undefined ? undefined : snapshot.connectionCount,
    recentPosts:
      snapshot.recentPosts === undefined
        ? undefined
        : snapshot.recentPosts.map((post) => ({
            activityType: normalizeOptionalNullableString(post.activityType),
            url: normalizeOptionalNullableString(post.url),
            postedAt: normalizeOptionalNullableString(post.postedAt),
            freshnessBand: post.freshnessBand,
            summary: normalizeOptionalNullableString(post.summary),
            snippet: normalizeOptionalNullableString(post.snippet)
          }))
  };
}

/**
 * @param {import("../schema/target-account.js").linkedinProfileSnapshotSchema._type | Record<string, never>} existing
 * @param {ReturnType<typeof buildLinkedinProfileSnapshotInput>} [patch]
 */
function buildLinkedinProfileSnapshotUpdate(existing, patch = {}) {
  return {
    capturedAt: patch.capturedAt ?? existing.capturedAt ?? null,
    profileUrl: patch.profileUrl ?? existing.profileUrl ?? null,
    publicId: patch.publicId ?? existing.publicId ?? null,
    memberId: patch.memberId ?? existing.memberId ?? null,
    displayName: patch.displayName ?? existing.displayName ?? null,
    currentRoleTitle: patch.currentRoleTitle ?? existing.currentRoleTitle ?? null,
    currentCompanyName: patch.currentCompanyName ?? existing.currentCompanyName ?? null,
    headline: patch.headline ?? existing.headline ?? null,
    location: patch.location ?? existing.location ?? null,
    about: patch.about ?? existing.about ?? null,
    followerCount: patch.followerCount ?? existing.followerCount ?? null,
    connectionCount: patch.connectionCount ?? existing.connectionCount ?? null,
    recentPosts:
      patch.recentPosts !== undefined
        ? patch.recentPosts.map((post) => ({
            activityType: post.activityType ?? null,
            url: post.url ?? null,
            postedAt: post.postedAt ?? null,
            freshnessBand: post.freshnessBand ?? null,
            summary: post.summary ?? null,
            snippet: post.snippet ?? null
          }))
        : existing.recentPosts ?? []
  };
}

/**
 * @param {import("../schema/target-account.js").liveSignalSchema._type | Record<string, never>} existing
 * @param {ReturnType<typeof buildMergeSeed>["liveSignal"]} [patch]
 */
function buildLiveSignalUpdate(existing, patch = {}) {
  return {
    channel: patch.channel ?? existing.channel ?? null,
    activityType: patch.activityType ?? existing.activityType ?? null,
    summary: patch.summary ?? existing.summary ?? null,
    url: patch.url ?? existing.url ?? null,
    observedAt: patch.observedAt ?? existing.observedAt ?? null,
    freshnessBand: patch.freshnessBand ?? existing.freshnessBand ?? null,
    hookStrength: patch.hookStrength ?? existing.hookStrength ?? null,
    engagementRationale: patch.engagementRationale ?? existing.engagementRationale ?? null
  };
}

/**
 * @param {Array<{
 *   id?: string | null | undefined,
 *   kind: import("../schema/target-account.js").contactPointSchema._type["kind"],
 *   value: string,
 *   label?: string | null | undefined,
 *   matchStatus?: import("../schema/target-account.js").contactPointSchema._type["matchStatus"],
 *   verificationStatus?: import("../schema/target-account.js").contactPointSchema._type["verificationStatus"],
 *   confidence?: "low" | "moderate" | "high" | "unknown",
 *   source?: string | null | undefined,
 *   sourceUrl?: string | null | undefined,
 *   observedAt?: string | null | undefined,
 *   notes?: string | null | undefined,
 *   evidence?: Array<{
 *     type: string,
 *     summary: string,
 *     sourceUrl?: string | null | undefined,
 *     observedAt?: string | null | undefined
 *   }>,
 *   usableForOutreach?: boolean | undefined,
 *   usableForResearch?: boolean | undefined,
 *   usableForWarmup?: boolean | undefined
 * }>} [points]
 */
function buildContactPointInputs(points = []) {
  return points.map((point) => ({
    id: point.id ?? crypto.randomUUID(),
    kind: point.kind,
    value: point.value,
    label: normalizeOptionalNullableString(point.label) ?? null,
    matchStatus: point.matchStatus,
    verificationStatus: point.verificationStatus,
    confidence: point.confidence,
    source: normalizeOptionalNullableString(point.source) ?? null,
    sourceUrl: normalizeOptionalNullableString(point.sourceUrl) ?? null,
    observedAt: normalizeOptionalNullableString(point.observedAt) ?? null,
    notes: normalizeOptionalNullableString(point.notes) ?? null,
    evidence: (point.evidence ?? []).map((evidence) => ({
      type: evidence.type,
      summary: evidence.summary,
      sourceUrl: normalizeOptionalNullableString(evidence.sourceUrl) ?? null,
      observedAt: normalizeOptionalNullableString(evidence.observedAt) ?? null
    })),
    usableForOutreach: point.usableForOutreach,
    usableForResearch: point.usableForResearch,
    usableForWarmup: point.usableForWarmup
  }));
}

/**
 * @param {{
 *   status?: import("../schema/target-account.js").contactEnrichmentStateSchema._type["status"],
 *   sourcesTried?: string[],
 *   missingChannels?: string[],
 *   bestDirectChannels?: string[],
 *   lastEnrichedAt?: string | null | undefined,
 *   notes?: string | null | undefined
 * } | undefined} state
 */
function buildContactEnrichmentStateInput(state) {
  if (!state) {
    return {};
  }

  return {
    status: state.status,
    sourcesTried:
      state.sourcesTried !== undefined ? normalizeStringArray(state.sourcesTried) : undefined,
    missingChannels:
      state.missingChannels !== undefined ? normalizeStringArray(state.missingChannels) : undefined,
    bestDirectChannels:
      state.bestDirectChannels !== undefined ? normalizeStringArray(state.bestDirectChannels) : undefined,
    lastEnrichedAt: normalizeOptionalNullableString(state.lastEnrichedAt),
    notes: normalizeOptionalNullableString(state.notes)
  };
}

/**
 * @param {import("../schema/target-account.js").contactEnrichmentStateSchema._type | Record<string, never>} existing
 * @param {ReturnType<typeof buildContactEnrichmentStateInput>} [patch]
 */
function buildContactEnrichmentStateUpdate(existing, patch = {}) {
  return {
    status: patch.status ?? existing.status ?? "pending",
    sourcesTried:
      patch.sourcesTried !== undefined
        ? mergeStringLists(existing.sourcesTried ?? [], patch.sourcesTried)
        : existing.sourcesTried ?? [],
    missingChannels:
      patch.missingChannels !== undefined
        ? mergeStringLists(existing.missingChannels ?? [], patch.missingChannels)
        : existing.missingChannels ?? [],
    bestDirectChannels:
      patch.bestDirectChannels !== undefined
        ? mergeStringLists(existing.bestDirectChannels ?? [], patch.bestDirectChannels)
        : existing.bestDirectChannels ?? [],
    lastEnrichedAt: patch.lastEnrichedAt ?? existing.lastEnrichedAt ?? null,
    notes: patch.notes ?? existing.notes ?? null
  };
}

/**
 * @param {string[] | undefined} left
 * @param {string[] | undefined} right
 */
function mergeStringLists(left, right) {
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

/**
 * @param {string | null | undefined} value
 */
function normalizeOptionalNullableString(value) {
  return value === undefined ? undefined : normalizeNullableString(value);
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {string} companyName
 * @param {string[] | undefined} signalMatchIds
 */
function normalizeSignalMatchIds(account, companyName, signalMatchIds) {
  const normalizedSignalMatchIds = normalizeStringArray(signalMatchIds);
  const knownSignalIds = new Set(account.signalMatches.map((match) => match.id));

  for (const signalMatchId of normalizedSignalMatchIds) {
    if (!knownSignalIds.has(signalMatchId)) {
      throw new Error(`Signal match not found on ${companyName}: ${signalMatchId}`);
    }
  }

  return normalizedSignalMatchIds;
}

function buildMergeSeed() {
  return /** @type {const} */ ({});
}
