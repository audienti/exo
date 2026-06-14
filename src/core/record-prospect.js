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
  findMotionById,
  findCompanyById,
  findCrossMotionOwner,
  insertCompany,
  resolvePersonIdentity,
  upsertEmployment,
  upsertMotionAccount,
  upsertProspect as upsertProspectRow,
} from "../db/database.js";
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
 *     avatarSourceUrl?: string | null | undefined,
 *     avatarChecked?: boolean | undefined,
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
 *     isPremium?: boolean | null | undefined,
 *     isOpenProfile?: boolean | null | undefined,
 *     connectionDegree?: import("../schema/target-account.js").linkedinProfileSnapshotSchema._type["connectionDegree"],
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
 *   preConnectDecision?: {
 *     mode?: "skip" | "bypass" | null | undefined,
 *     reason?: string | null | undefined,
 *     decidedAt?: string | null | undefined
 *   } | null | undefined,
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
 *   },
 *   ignoreStakeholderTargetLimit?: boolean | undefined
 * }} input
 */
export function recordMotionProspect(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const normalizedSignalMatchIds = normalizeSignalMatchIds(baseAccount, company.name, input.signalMatchIds);
  const avatar = resolveProspectAvatarFields(input.avatarSourceUrl, input.linkedinProfileSnapshot?.avatarSourceUrl);

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
    publicEngagementSelection: buildPublicEngagementSelectionInput(input.publicEngagementSelection),
    preConnectDecision: buildPreConnectDecisionInput(input.preConnectDecision),
    contactPoints: buildContactPointInputs(input.contactPoints),
    contactEnrichmentState: buildContactEnrichmentStateInput(input.contactEnrichmentState),
    notes: normalizeOptionalNullableString(input.notes),
    signalMatchIds: normalizedSignalMatchIds,
    queueState: buildProspectQueueStateInput(input.queueState)
  };

  const prospectLimit = input.ignoreStakeholderTargetLimit
    ? Number.MAX_SAFE_INTEGER
    : motion.targetingProfile.stakeholderTargetCount;
  const prospects = upsertProspect(baseAccount.prospects, nextProspect, prospectLimit, now);
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

  const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
  const persistedProspect = prospects.find((prospect) => prospectsReferToSamePerson(prospect, nextProspect))
    ?? prospects.find((prospect) => prospect.id === nextProspect.id)
    ?? prospects[prospects.length - 1];
  persistProspectRows({
    motion: updatedMotion,
    company,
    account: updatedAccount,
    prospect: persistedProspect,
    now,
  });

  return findMotionById(motion.id) ?? updatedMotion;
}

/**
 * @param {{
 *   motion: any,
 *   company: any,
 *   account: import("../schema/target-account.js").targetAccountSchema._type,
 *   prospect: import("../schema/target-account.js").prospectSchema._type,
 *   now: string
 * }} input
 */
export function persistProspectRows(input) {
  if (!findCompanyById(input.company.id)) {
    insertCompany(input.company);
  }
  const motionAccount = upsertMotionAccount({
    id: buildMotionAccountId(input.motion.id, input.company.id),
    motionId: input.motion.id,
    companyId: input.company.id,
    executionUserId: input.motion.engagementUserAssignment?.userId ?? null,
    queueStatus: input.account.queueState?.status ?? "selected",
    disposition: input.account.disposition,
    packetStatus: input.account.packetStatus,
    lastResearchAt: input.account.lastResearchAt,
    payload: {
      ...input.account,
      prospects: undefined,
      signalMatches: undefined,
    },
    now: input.now,
  });
  const person = resolvePersonIdentity({
    name: input.prospect.name,
    contactPoints: buildIdentityContactPoints(input.prospect),
  }).person;
  const queueState = queueStateWithCrossMotionHold(input.prospect.queueState, {
    owner: findCrossMotionOwner({ personId: person.id, excludeMotionId: input.motion.id }),
    now: input.now,
  });
  upsertEmployment({
    personId: person.id,
    companyId: input.company.id,
    title: input.prospect.title,
    source: "motion-prospect",
    observedAt: input.prospect.observedAt ?? input.now,
  });
  upsertProspectRow({
    id: input.prospect.id,
    motionId: input.motion.id,
    companyId: input.company.id,
    personId: person.id,
    motionAccountId: motionAccount.id,
    queueStatus: queueState?.status ?? "selected",
    disposition: input.prospect.disposition,
    packetStatus: input.prospect.packetStatus,
    cadenceStatus: input.prospect.cadenceState?.status ?? "pending",
    cadenceCurrentStep: input.prospect.cadenceState?.currentStep ?? null,
    cadenceNextActionDueAt: input.prospect.cadenceState?.nextActionDueAt ?? null,
    cadenceLastTouchAt: input.prospect.cadenceState?.lastTouchAt ?? null,
    cadenceLastTouchOutcome: input.prospect.cadenceState?.lastTouchOutcome ?? null,
    payload: {
      ...input.prospect,
      personId: person.id,
      queueState,
      touches: undefined,
      drafts: undefined,
      timelineNotes: undefined,
    },
    now: input.now,
  });
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type["queueState"] | undefined} queueState
 * @param {{ owner: ReturnType<typeof findCrossMotionOwner> | null, now: string }} input
 */
function queueStateWithCrossMotionHold(queueState, input) {
  if (!input.owner) return queueState;
  return {
    ...(queueState ?? {}),
    status: "held_cross_motion",
    source: "manual",
    updatedAt: input.now,
    notes: queueState?.notes ?? `Held because this person has active outbound work in motion ${input.owner.motionId}.`,
    crossMotionOwner: {
      motionId: input.owner.motionId,
      prospectId: input.owner.id,
      companyId: input.owner.companyId,
    },
  };
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function buildIdentityContactPoints(prospect) {
  const contactPoints = [...(prospect.contactPoints ?? [])].map((point) => ({
    kind: point.kind === "linkedin_profile" ? "linkedin_profile_url" : point.kind,
    value: point.value,
    verificationStatus: point.verificationStatus,
    confidence: point.confidence === "high" ? 1 : point.confidence === "moderate" ? 0.7 : point.confidence === "low" ? 0.3 : null,
    source: point.source,
    observedAt: point.observedAt,
  }));
  if (prospect.linkedinProfileUrl) {
    contactPoints.push({
      kind: "linkedin_profile_url",
      value: prospect.linkedinProfileUrl,
      verificationStatus: "observed",
      confidence: 1,
      source: "motion-prospect",
      observedAt: prospect.profileViewedAt ?? prospect.observedAt,
    });
  }
  if (prospect.email) {
    contactPoints.push({
      kind: "email",
      value: prospect.email,
      verificationStatus: "verified",
      confidence: 1,
      source: "motion-prospect",
      observedAt: prospect.observedAt,
    });
  }
  return contactPoints;
}

/**
 * @param {string} motionId
 * @param {string} companyId
 */
function buildMotionAccountId(motionId, companyId) {
  return `motion-account-${motionId}-${companyId}`;
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
 *     avatarSourceUrl?: string | null | undefined,
 *     avatarChecked?: boolean | undefined,
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
 *     isPremium?: boolean | null | undefined,
 *     isOpenProfile?: boolean | null | undefined,
 *     connectionDegree?: import("../schema/target-account.js").linkedinProfileSnapshotSchema._type["connectionDegree"],
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
 *   },
 *   preConnectDecision?: {
 *     mode?: "skip" | "bypass" | null | undefined,
 *     reason?: string | null | undefined,
 *     decidedAt?: string | null | undefined
 *   } | null | undefined
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
  const avatar = resolveProspectAvatarFields(input.avatarSourceUrl, input.linkedinProfileSnapshot?.avatarSourceUrl);

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
      publicEngagementSelection: buildPublicEngagementSelectionUpdate(
        existing.publicEngagementSelection,
        buildPublicEngagementSelectionInput(input.publicEngagementSelection),
      ),
      preConnectDecision: buildPreConnectDecisionUpdate(
        existing.preConnectDecision,
        buildPreConnectDecisionInput(input.preConnectDecision),
        now,
      ),
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

  const updatedMotion = finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
  const persistedProspect = updatedProspects.find((prospect) => prospect.id === input.prospectId);
  if (persistedProspect) {
    persistProspectRows({
      motion: updatedMotion,
      company,
      account: updatedAccount,
      prospect: persistedProspect,
      now,
    });
  }

  return findMotionById(motion.id) ?? updatedMotion;
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
        preConnectDecision: buildPreConnectDecisionUpdate(null, nextProspect.preConnectDecision, now),
        contactPoints: nextProspect.contactPoints,
        contactEnrichmentState: buildContactEnrichmentStateUpdate({}, nextProspect.contactEnrichmentState),
        queueState: nextProspect.queueState ?? {},
        packetState: null,
        notes: nextProspect.notes ?? null,
        signalMatchIds: nextProspect.signalMatchIds,
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
      preConnectDecision: buildPreConnectDecisionUpdate(existing.preConnectDecision, nextProspect.preConnectDecision, now),
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
 *   avatarSourceUrl?: string | null | undefined,
 *   avatarChecked?: boolean | undefined,
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
 *   isPremium?: boolean | null | undefined,
 *   isOpenProfile?: boolean | null | undefined,
 *   connectionDegree?: import("../schema/target-account.js").linkedinProfileSnapshotSchema._type["connectionDegree"],
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
    avatarSourceUrl: normalizeOptionalNullableString(snapshot.avatarSourceUrl),
    avatarChecked: snapshot.avatarChecked === undefined ? undefined : snapshot.avatarChecked,
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
    isPremium: snapshot.isPremium === undefined ? undefined : snapshot.isPremium,
    isOpenProfile: snapshot.isOpenProfile === undefined ? undefined : snapshot.isOpenProfile,
    connectionDegree: snapshot.connectionDegree === undefined ? undefined : snapshot.connectionDegree,
    recentPosts:
      snapshot.recentPosts === undefined
        ? undefined
        : snapshot.recentPosts.map((post) => ({
            activityType: normalizeOptionalNullableString(post.activityType),
            url: normalizeOptionalNullableString(post.url),
            postedAt: normalizeOptionalNullableString(post.postedAt),
            freshnessBand: post.freshnessBand,
            summary: normalizeOptionalNullableString(post.summary),
            snippet: normalizeOptionalNullableString(post.snippet),
            targetKind: post.targetKind === undefined ? undefined : post.targetKind,
            authoredByProspect:
              post.authoredByProspect === undefined ? undefined : post.authoredByProspect,
            hasOriginalCommentary:
              post.hasOriginalCommentary === undefined ? undefined : post.hasOriginalCommentary,
            businessRelevance: post.businessRelevance === undefined ? undefined : post.businessRelevance,
            recommendedAction: post.recommendedAction === undefined ? undefined : post.recommendedAction,
            rationale: normalizeOptionalNullableString(post.rationale),
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
    avatarSourceUrl:
      patch.avatarSourceUrl === undefined
        ? existing.avatarSourceUrl ?? null
        : patch.avatarSourceUrl,
    avatarChecked: patch.avatarChecked ?? existing.avatarChecked ?? false,
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
    isPremium: patch.isPremium ?? existing.isPremium ?? null,
    isOpenProfile: patch.isOpenProfile ?? existing.isOpenProfile ?? null,
    connectionDegree: patch.connectionDegree ?? existing.connectionDegree ?? null,
    recentPosts:
      patch.recentPosts !== undefined
        ? patch.recentPosts.map((post) => ({
            activityType: post.activityType ?? null,
            url: post.url ?? null,
            postedAt: post.postedAt ?? null,
            freshnessBand: post.freshnessBand ?? null,
            summary: post.summary ?? null,
            snippet: post.snippet ?? null,
            targetKind: post.targetKind ?? null,
            authoredByProspect:
              post.authoredByProspect === undefined ? null : post.authoredByProspect,
            hasOriginalCommentary:
              post.hasOriginalCommentary === undefined ? null : post.hasOriginalCommentary,
            businessRelevance: post.businessRelevance ?? null,
            recommendedAction: post.recommendedAction ?? null,
            rationale: post.rationale ?? null,
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
 * @param {{
 *   url?: string | null | undefined,
 *   targetKind?: import("../schema/target-account.js").publicEngagementSelectionSchema._type["targetKind"],
 *   activityType?: string | null | undefined,
 *   postedAt?: string | null | undefined,
 *   freshnessBand?: import("../schema/target-account.js").publicEngagementSelectionSchema._type["freshnessBand"],
 *   summary?: string | null | undefined,
 *   snippet?: string | null | undefined,
 *   businessRelevance?: "low" | "moderate" | "high" | "unknown" | null | undefined,
 *   recommendedAction?: import("../schema/target-account.js").publicEngagementSelectionSchema._type["recommendedAction"],
 *   rationale?: string | null | undefined,
 *   selectionReason?: string | null | undefined,
 *   selectedAt?: string | null | undefined,
 * } | null | undefined} selection
 */
function buildPublicEngagementSelectionInput(selection) {
  if (selection === undefined) {
    return undefined;
  }
  if (selection === null) {
    return null;
  }
  const url = normalizeOptionalNullableString(selection.url);
  const targetKind = selection.targetKind === undefined ? undefined : selection.targetKind;
  if (url === null || !targetKind) {
    return null;
  }
  return {
    url,
    targetKind,
    activityType: normalizeOptionalNullableString(selection.activityType),
    postedAt: normalizeOptionalNullableString(selection.postedAt),
    freshnessBand: selection.freshnessBand === undefined ? undefined : selection.freshnessBand,
    summary: normalizeOptionalNullableString(selection.summary),
    snippet: normalizeOptionalNullableString(selection.snippet),
    businessRelevance: selection.businessRelevance === undefined ? undefined : selection.businessRelevance,
    recommendedAction: selection.recommendedAction === undefined ? undefined : selection.recommendedAction,
    rationale: normalizeOptionalNullableString(selection.rationale),
    selectionReason: normalizeOptionalNullableString(selection.selectionReason),
    selectedAt: normalizeOptionalNullableString(selection.selectedAt),
  };
}

/**
 * @param {import("../schema/target-account.js").publicEngagementSelectionSchema._type | null | undefined} existing
 * @param {ReturnType<typeof buildPublicEngagementSelectionInput>} patch
 */
function buildPublicEngagementSelectionUpdate(existing, patch) {
  if (patch === undefined) {
    return existing ?? null;
  }
  if (patch === null) {
    return null;
  }
  return {
    url: patch.url,
    targetKind: patch.targetKind,
    activityType: patch.activityType ?? existing?.activityType ?? null,
    postedAt: patch.postedAt ?? existing?.postedAt ?? null,
    freshnessBand: patch.freshnessBand ?? existing?.freshnessBand ?? null,
    summary: patch.summary ?? existing?.summary ?? null,
    snippet: patch.snippet ?? existing?.snippet ?? null,
    businessRelevance: patch.businessRelevance ?? existing?.businessRelevance ?? null,
    recommendedAction: patch.recommendedAction ?? existing?.recommendedAction ?? null,
    rationale: patch.rationale ?? existing?.rationale ?? null,
    selectionReason: patch.selectionReason ?? existing?.selectionReason ?? null,
    selectedAt: patch.selectedAt ?? existing?.selectedAt ?? null,
  };
}

/**
 * @param {{
 *   mode?: "skip" | "bypass" | null | undefined,
 *   reason?: string | null | undefined,
 *   decidedAt?: string | null | undefined,
 * } | null | undefined} decision
 */
function buildPreConnectDecisionInput(decision) {
  if (decision === undefined) {
    return undefined;
  }
  if (decision === null) {
    return null;
  }
  const mode = decision.mode === "skip"
    ? "skip"
    : decision.mode === "bypass"
      ? "bypass"
      : null;
  const reason = normalizeOptionalNullableString(decision.reason);
  if (!mode) {
    return null;
  }
  if (!reason) {
    throw new Error(`Pre-connect ${mode} decisions require a reason.`);
  }
  return {
    mode,
    reason,
    decidedAt: normalizeOptionalNullableString(decision.decidedAt),
  };
}

/**
 * @param {import("../schema/target-account.js").preConnectDecisionSchema._type | null | undefined} existing
 * @param {ReturnType<typeof buildPreConnectDecisionInput>} patch
 * @param {string} now
 */
function buildPreConnectDecisionUpdate(existing, patch, now) {
  if (patch === undefined) {
    return existing ?? null;
  }
  if (patch === null) {
    return null;
  }
  return {
    mode: patch.mode,
    reason: patch.reason,
    decidedAt: patch.decidedAt ?? existing?.decidedAt ?? now,
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
        ? patch.missingChannels
        : existing.missingChannels ?? [],
    bestDirectChannels:
      patch.bestDirectChannels !== undefined
        ? patch.bestDirectChannels
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
 * Explicit avatar writes win. Otherwise, promote a non-empty profile snapshot
 * avatar into the canonical prospect avatar fields so downstream views can
 * render identity media without parsing profile snapshots.
 *
 * @param {string | null | undefined} avatarSourceUrl
 * @param {string | null | undefined} snapshotAvatarSourceUrl
 */
function resolveProspectAvatarFields(avatarSourceUrl, snapshotAvatarSourceUrl) {
  if (avatarSourceUrl !== undefined) {
    return normalizeImageProxyFields(avatarSourceUrl);
  }

  const snapshotAvatar = normalizeOptionalNullableString(snapshotAvatarSourceUrl);
  if (!snapshotAvatar) {
    return {
      sourceUrl: undefined,
      proxyUrl: undefined
    };
  }

  return normalizeImageProxyFields(snapshotAvatar);
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
