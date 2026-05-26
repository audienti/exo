// @ts-check

import crypto from "node:crypto";
import { prospectSchema, targetAccountSchema } from "../schema/target-account.js";
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
 *   notes?: string | null | undefined,
 *   signalMatchIds?: string[]
 * }} input
 */
export function recordMotionProspect(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const normalizedSignalMatchIds = normalizeStringArray(input.signalMatchIds);
  const knownSignalIds = new Set(baseAccount.signalMatches.map((match) => match.id));

  for (const signalMatchId of normalizedSignalMatchIds) {
    if (!knownSignalIds.has(signalMatchId)) {
      throw new Error(`Signal match not found on ${company.name}: ${signalMatchId}`);
    }
  }

  const nextProspect = {
    id: crypto.randomUUID(),
    name: input.name,
    title: input.title,
    linkedinProfileUrl: normalizeOptionalNullableString(input.linkedinProfileUrl),
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
    notes: normalizeOptionalNullableString(input.notes),
    signalMatchIds: normalizedSignalMatchIds
  };

  const prospects = upsertProspect(baseAccount.prospects, nextProspect, motion.targetingProfile.stakeholderTargetCount);
  const updatedAccount = targetAccountSchema.parse({
    ...baseAccount,
    companyName: company.name,
    domain: company.domain,
    websiteUrl: company.websiteUrl,
    linkedinCompanyUrl: company.linkedinCompanyUrl,
    lastResearchAt: now,
    prospects
  });

  return finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type[]} prospects
 * @param {ReturnType<typeof buildMergeSeed>} nextProspect
 * @param {number} limit
 */
function upsertProspect(prospects, nextProspect, limit) {
  const index = prospects.findIndex((prospect) => prospectsReferToSamePerson(prospect, nextProspect));

  if (index === -1) {
    if (prospects.length >= limit) {
      throw new Error(`Prospect limit reached (${limit}). Raise stakeholderTargetCount on the motion before adding another person.`);
    }

    return [
      ...prospects,
      prospectSchema.parse({
        id: nextProspect.id,
        name: nextProspect.name,
        title: nextProspect.title,
        linkedinProfileUrl: nextProspect.linkedinProfileUrl ?? null,
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
        liveSignal: buildLiveSignalUpdate({}, nextProspect.liveSignal),
        notes: nextProspect.notes ?? null,
        signalMatchIds: nextProspect.signalMatchIds,
        throughLine: {},
        openingPlan: {},
        cadenceState: {}
      })
    ];
  }

  const existing = prospects[index];
  return prospects.map((prospect, prospectIndex) => {
    if (prospectIndex !== index) {
      return prospect;
    }

    return prospectSchema.parse({
      ...existing,
      name: nextProspect.name,
      title: nextProspect.title,
      linkedinProfileUrl: nextProspect.linkedinProfileUrl ?? existing.linkedinProfileUrl,
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
      liveSignal: buildLiveSignalUpdate(existing.liveSignal, nextProspect.liveSignal),
      notes: nextProspect.notes ?? existing.notes,
      signalMatchIds: mergeStringLists(existing.signalMatchIds, nextProspect.signalMatchIds)
    });
  });
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

function buildMergeSeed() {
  return /** @type {const} */ ({});
}
