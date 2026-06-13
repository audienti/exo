// @ts-check

import { buildEmailIdentityValues } from "../lib/email-identity.js";
import { extractLinkedinPublicId } from "../lib/prospect-contacts.js";
import {
  inboundObservationCompanyProfileSchema,
  inboundObservationSchema,
} from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { mergeInboundObservationCompanyProfile } from "./inbound-observations.js";
import { resolveInboundObservationCompany } from "./resolve-inbound-observation-company.js";

export const INBOUND_IDENTITY_RESOLUTION_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

/**
 * @param {unknown} rawObservation
 */
export function hasResolvedLinkedinIdentity(rawObservation) {
  const observation = inboundObservationSchema.parse(rawObservation);
  return Boolean(
    normalizeText(observation.actorProfileUrl)
    || normalizeText(observation.actorLinkedinPublicId)
    || normalizeText(observation.actorLinkedinMemberId),
  );
}

/**
 * @param {unknown} rawObservation
 */
export function needsInboundIdentityResolution(rawObservation) {
  const observation = inboundObservationSchema.parse(rawObservation);
  if (observation.surfaceKey !== "gmail-inbox-threads") {
    return false;
  }
  if (!buildEmailIdentityValues(observation.actorHandle).length) {
    return false;
  }
  return !hasResolvedLinkedinIdentity(observation);
}

/**
 * @param {unknown} rawObservation
 * @returns {string | null}
 */
export function buildInboundIdentityResolutionGroupKey(rawObservation) {
  const observation = inboundObservationSchema.parse(rawObservation);
  const email = buildEmailIdentityValues(observation.actorHandle)[0] ?? null;
  if (!email) {
    return null;
  }
  return `${observation.userId}:${email}`;
}

/**
 * @param {unknown} rawObservation
 * @param {string} [fallbackNow]
 * @returns {string | null}
 */
export function computeInboundIdentityResolutionDueAt(rawObservation, fallbackNow = new Date().toISOString()) {
  const observation = inboundObservationSchema.parse(rawObservation);
  if (!needsInboundIdentityResolution(observation)) {
    return null;
  }

  const status = normalizeText(observation.identityResolutionStatus);
  if ((status === "no_match" || status === "blocked") && normalizeIsoDatetime(observation.identityResolutionCheckedAt)) {
    return new Date(
      Date.parse(normalizeIsoDatetime(observation.identityResolutionCheckedAt))
        + INBOUND_IDENTITY_RESOLUTION_RETRY_DELAY_MS,
    ).toISOString();
  }

  return normalizeIsoDatetime(observation.observedAt) ?? fallbackNow;
}

/**
 * @param {unknown} rawUser
 * @param {{
 *   runtime?: string | null,
 *   connector?: string | null,
 *   availableOnly?: boolean,
 * }} [options]
 */
export function resolveManagedLinkedinAccount(rawUser, options = {}) {
  if (!rawUser) {
    return null;
  }

  const user = userSchema.parse(rawUser);
  const runtime = normalizeText(options.runtime)?.toLowerCase() ?? null;
  const connector = normalizeText(options.connector)?.toLowerCase() ?? null;
  const availableOnly = options.availableOnly === true;
  const candidates = (user.accounts ?? []).filter(
    (account) => account?.capability === "linkedin" && normalizeText(account.providerAccountId),
  );

  const runnable = candidates.filter((account) => {
    if (!runtime && !connector && !availableOnly) {
      return true;
    }
    if (account.sourceType !== "harness-connection" || !account.harnessConnectionId) {
      return false;
    }
    const harness = (user.harnessConnections ?? []).find(
      (candidate) => candidate.id === account.harnessConnectionId,
    ) ?? null;
    if (!harness) {
      return false;
    }
    if (runtime && normalizeText(harness.runtime)?.toLowerCase() !== runtime) {
      return false;
    }
    if (connector && normalizeText(harness.connector)?.toLowerCase() !== connector) {
      return false;
    }
    if (availableOnly && normalizeText(harness.status)?.toLowerCase() !== "available") {
      return false;
    }
    return true;
  });

  return runnable.find((account) => account.preferred) ?? runnable[0] ?? null;
}

/**
 * @param {{
 *   status: "resolved" | "no_match" | "blocked",
 *   reason?: string | null,
 *   checkedAt?: string | null,
 *   actorName?: string | null,
 *   actorTitle?: string | null,
 *   actorCompanyName?: string | null,
 *   linkedinProfileUrl?: string | null,
 *   linkedinPublicId?: string | null,
 *   linkedinMemberId?: string | null,
 *   companyDomain?: string | null,
 *   companyWebsiteUrl?: string | null,
 *   linkedinCompanyUrl?: string | null,
 * }} resolution
 */
export function buildInboundIdentityResolutionCompanyProfile(resolution) {
  const candidate = {
    name: normalizeText(resolution.actorCompanyName),
    domain: normalizeText(resolution.companyDomain),
    websiteUrl: normalizeUrl(resolution.companyWebsiteUrl),
    linkedinCompanyUrl: normalizeUrl(resolution.linkedinCompanyUrl),
    logoSourceUrl: null,
  };
  if (!candidate.name && !candidate.domain && !candidate.websiteUrl && !candidate.linkedinCompanyUrl) {
    return null;
  }
  return inboundObservationCompanyProfileSchema.parse(candidate);
}

/**
 * @param {{
 *   seedObservation: unknown,
 *   relatedObservations: unknown[],
 *   rawCompanies: unknown[],
 *   resolution: {
 *     status: "resolved" | "no_match" | "blocked",
 *     reason?: string | null,
 *     checkedAt?: string | null,
 *     actorName?: string | null,
 *     actorTitle?: string | null,
 *     actorCompanyName?: string | null,
 *     linkedinProfileUrl?: string | null,
 *     linkedinPublicId?: string | null,
 *     linkedinMemberId?: string | null,
 *   },
 *   companyProfile?: {
 *     name?: string | null,
 *     domain?: string | null,
 *     websiteUrl?: string | null,
 *     linkedinCompanyUrl?: string | null,
 *     logoSourceUrl?: string | null,
 *   } | null,
 * }} input
 */
export function applyInboundIdentityResolutionResult(input) {
  const seedObservation = inboundObservationSchema.parse(input.seedObservation);
  const relatedObservations = (input.relatedObservations ?? []).map((raw) => inboundObservationSchema.parse(raw));
  const checkedAt = normalizeIsoDatetime(input.resolution.checkedAt) ?? new Date().toISOString();
  const companyProfile = mergeInboundObservationCompanyProfile(
    buildInboundIdentityResolutionCompanyProfile(input.resolution),
    input.companyProfile ?? null,
  );
  const companies = [...(input.rawCompanies ?? [])];
  const createdCompanyIds = new Set();
  const updatedObservations = [];
  const companiesToCreate = [];
  const companiesToUpdate = [];

  for (const observation of relatedObservations) {
    const patchedBase = inboundObservationSchema.parse({
      ...observation,
      actorName: input.resolution.status === "resolved"
        ? normalizeText(input.resolution.actorName) ?? observation.actorName
        : observation.actorName,
      actorTitle: input.resolution.status === "resolved"
        ? normalizeText(input.resolution.actorTitle) ?? observation.actorTitle
        : observation.actorTitle,
      actorCompanyName: input.resolution.status === "resolved"
        ? normalizeText(input.resolution.actorCompanyName) ?? observation.actorCompanyName
        : observation.actorCompanyName,
      actorProfileUrl: input.resolution.status === "resolved"
        ? normalizeText(input.resolution.linkedinProfileUrl) ?? observation.actorProfileUrl
        : observation.actorProfileUrl,
      actorLinkedinPublicId: input.resolution.status === "resolved"
        ? normalizeText(input.resolution.linkedinPublicId)
          ?? extractLinkedinPublicId(input.resolution.linkedinProfileUrl)
          ?? observation.actorLinkedinPublicId
        : observation.actorLinkedinPublicId,
      actorLinkedinMemberId: input.resolution.status === "resolved"
        ? normalizeText(input.resolution.linkedinMemberId) ?? observation.actorLinkedinMemberId
        : observation.actorLinkedinMemberId,
      actorCompanyProfile: input.resolution.status === "resolved"
        ? mergeInboundObservationCompanyProfile(observation.actorCompanyProfile, companyProfile)
        : observation.actorCompanyProfile,
      identityResolutionStatus: input.resolution.status,
      identityResolutionCheckedAt: checkedAt,
      identityResolutionReason: normalizeText(input.resolution.reason),
    });

    if (input.resolution.status !== "resolved") {
      updatedObservations.push(patchedBase);
      continue;
    }

    const companyResolution = resolveInboundObservationCompany(patchedBase, companies, {
      createIfMissing: true,
      companyProfile: patchedBase.actorCompanyProfile,
    });
    updatedObservations.push(companyResolution.observation);

    if (!companyResolution.company) {
      continue;
    }

    if (companyResolution.companyCreated && !createdCompanyIds.has(companyResolution.company.id)) {
      createdCompanyIds.add(companyResolution.company.id);
      companies.push(companyResolution.company);
      companiesToCreate.push(companyResolution.company);
      continue;
    }

    const existingIndex = companies.findIndex((candidate) => candidate?.id === companyResolution.company.id);
    if (existingIndex >= 0) {
      companies.splice(existingIndex, 1, companyResolution.company);
    } else {
      companies.push(companyResolution.company);
    }
    companiesToUpdate.push(companyResolution.company);
  }

  return {
    seedObservation,
    updatedObservations,
    companiesToCreate,
    companiesToUpdate,
    checkedAt,
  };
}

/** @param {unknown} value */
function normalizeText(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

/** @param {unknown} value */
function normalizeIsoDatetime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

/** @param {unknown} value */
function normalizeUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}
