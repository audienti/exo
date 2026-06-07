// @ts-check

import { companySchema } from "../schema/company.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { addCompany } from "./add-company.js";
import { linkCompanyToMotion } from "./link-company-to-motion.js";
import { updateCompanyRecord } from "./update-company.js";
import {
  isPlaceholderCompanyName,
  normalizeCompanyName,
  normalizeCompanyNameKey,
  normalizeResolvableCompanyName,
} from "../lib/company-name.js";

/**
 * Resolve an inbound observation onto a canonical company record when the
 * inbound payload carries a durable company identity. In writeback mode this
 * can also create the missing canonical company or link an existing one to the
 * observation's motion.
 *
 * @param {unknown} rawObservation
 * @param {unknown[]} rawCompanies
 * @param {{
 *   createIfMissing?: boolean | undefined,
 *   companyProfile?: {
 *     name?: string | null | undefined,
 *     domain?: string | null | undefined,
 *     websiteUrl?: string | null | undefined,
 *     linkedinCompanyUrl?: string | null | undefined,
 *     logoSourceUrl?: string | null | undefined,
 *   } | null | undefined
 * }} [options]
 */
export function resolveInboundObservationCompany(rawObservation, rawCompanies, options = {}) {
  const observation = inboundObservationSchema.parse(rawObservation);
  const companies = (rawCompanies ?? []).map((raw) => companySchema.parse(raw));
  const createIfMissing = options.createIfMissing === true;
  const companyProfile = normalizeCompanyProfile(options.companyProfile ?? null);

  let company = observation.companyId
    ? companies.find((candidate) => candidate.id === observation.companyId) ?? null
    : null;
  let companyCreated = false;
  let companyLinkedToMotion = false;

  if (company && isPlaceholderCompanyName(company.name)) {
    company = null;
  }

  if (!company) {
    const resolved = resolveCompanyFromObservationIdentity(observation, companies, companyProfile, createIfMissing);
    company = resolved.company;
    companyCreated = resolved.companyCreated;
    companyLinkedToMotion = resolved.companyLinkedToMotion;
  }

  if (!company) {
    return {
      observation,
      company: null,
      companyCreated,
      companyLinkedToMotion,
    };
  }

  if (companyProfile) {
    const hydrated = hydrateCompanyWithProfile(company, companyProfile);
    if (hydrated.changed) {
      company = hydrated.company;
    }
  }

  if (
    createIfMissing
    && observation.motionId
    && !company.motionIds.includes(observation.motionId)
  ) {
    company = linkCompanyToMotion(company, observation.motionId);
    companyLinkedToMotion = true;
  }

  return {
    observation: inboundObservationSchema.parse({
      ...observation,
      companyId: observation.companyId ?? company.id,
      motionId: observation.motionId ?? (company.motionIds.length === 1 ? company.motionIds[0] : null),
    }),
    company,
    companyCreated,
    companyLinkedToMotion,
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {import("../schema/company.js").companySchema._type[]} companies
 * @param {{
 *   name: string | null,
 *   domain: string | null,
 *   websiteUrl: string | null,
 *   linkedinCompanyUrl: string | null,
 *   logoSourceUrl: string | null,
 * } | null} companyProfile
 * @param {boolean} createIfMissing
 */
function resolveCompanyFromObservationIdentity(observation, companies, companyProfile, createIfMissing) {
  const companyName = normalizeResolvableCompanyName(observation.actorCompanyName) ?? companyProfile?.name ?? null;
  const domain = companyProfile?.domain ?? null;
  const linkedinCompanyUrl = normalizeLinkedinCompanyUrl(companyProfile?.linkedinCompanyUrl ?? null);

  let company = companies.find((candidate) => companyMatchesIdentity(candidate, companyName, domain, linkedinCompanyUrl)) ?? null;
  let companyCreated = false;
  let companyLinkedToMotion = false;

  if (!company) {
    if (!createIfMissing || !companyName) {
      return {
        company: null,
        companyCreated,
        companyLinkedToMotion,
      };
    }

    company = addCompany({
      name: companyName,
      domain,
      websiteUrl: companyProfile?.websiteUrl ?? null,
      linkedinCompanyUrl,
      logoSourceUrl: companyProfile?.logoSourceUrl ?? null,
      motionIds: observation.motionId ? [observation.motionId] : [],
    });
    companyCreated = true;
    companyLinkedToMotion = Boolean(observation.motionId);
  }

  return {
    company,
    companyCreated,
    companyLinkedToMotion,
  };
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {{
 *   name: string | null,
 *   domain: string | null,
 *   websiteUrl: string | null,
 *   linkedinCompanyUrl: string | null,
 *   logoSourceUrl: string | null,
 * }} companyProfile
 */
function hydrateCompanyWithProfile(company, companyProfile) {
  const patch = {};

  if (companyProfile.name && isPlaceholderCompanyName(company.name)) {
    patch.name = companyProfile.name;
  }
  if (companyProfile.domain && companyProfile.domain !== company.domain) {
    patch.domain = companyProfile.domain;
  }
  if (companyProfile.websiteUrl && companyProfile.websiteUrl !== company.websiteUrl) {
    patch.websiteUrl = companyProfile.websiteUrl;
  }
  if (companyProfile.linkedinCompanyUrl && companyProfile.linkedinCompanyUrl !== company.linkedinCompanyUrl) {
    patch.linkedinCompanyUrl = companyProfile.linkedinCompanyUrl;
  }
  if (companyProfile.logoSourceUrl && companyProfile.logoSourceUrl !== company.logoSourceUrl) {
    patch.logoSourceUrl = companyProfile.logoSourceUrl;
  }

  if (Object.keys(patch).length === 0) {
    return { company, changed: false };
  }

  return {
    company: updateCompanyRecord(company, patch),
    changed: true,
  };
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 * @param {string | null} companyName
 * @param {string | null} domain
 * @param {string | null} linkedinCompanyUrl
 */
function companyMatchesIdentity(company, companyName, domain, linkedinCompanyUrl) {
  if (isPlaceholderCompanyName(company.name)) {
    return false;
  }
  if (companyName && normalizeCompanyNameKey(company.name) === normalizeCompanyNameKey(companyName)) {
    return true;
  }
  if (domain && normalizeNullableString(company.domain)?.toLowerCase() === domain.toLowerCase()) {
    return true;
  }
  if (linkedinCompanyUrl && normalizeLinkedinCompanyUrl(company.linkedinCompanyUrl) === linkedinCompanyUrl) {
    return true;
  }
  return false;
}

/**
 * @param {{
 *   name?: string | null | undefined,
 *   domain?: string | null | undefined,
 *   websiteUrl?: string | null | undefined,
 *   linkedinCompanyUrl?: string | null | undefined,
 *   logoSourceUrl?: string | null | undefined,
 * } | null | undefined} profile
 */
function normalizeCompanyProfile(profile) {
  if (!profile) {
    return null;
  }

  const normalized = {
    name: normalizeResolvableCompanyName(profile.name ?? null),
    domain: normalizeNullableString(profile.domain ?? null),
    websiteUrl: normalizeNullableString(profile.websiteUrl ?? null),
    linkedinCompanyUrl: normalizeLinkedinCompanyUrl(profile.linkedinCompanyUrl ?? null),
    logoSourceUrl: normalizeNullableString(profile.logoSourceUrl ?? null),
  };

  if (
    !normalized.name
    && !normalized.domain
    && !normalized.websiteUrl
    && !normalized.linkedinCompanyUrl
    && !normalized.logoSourceUrl
  ) {
    return null;
  }

  return normalized;
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  return normalizeCompanyName(value);
}

/**
 * @param {string | null | undefined} value
 */
function normalizeLinkedinCompanyUrl(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "/");
  } catch {
    return normalized.replace(/\/+$/, "/");
  }
}
