// @ts-check

import { companySchema } from "../schema/company.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { addCompany } from "./add-company.js";
import { linkCompanyToMotion } from "./link-company-to-motion.js";
import {
  normalizeCompanyName,
  normalizeCompanyNameKey,
  normalizeResolvableCompanyName,
} from "../lib/company-name.js";

/**
 * Resolve an inbound observation onto a canonical company record when the
 * inbound payload carries a durable company name. In writeback mode this can
 * also create the missing canonical company or link an existing one to the
 * observation's motion.
 *
 * @param {unknown} rawObservation
 * @param {unknown[]} rawCompanies
 * @param {{ createIfMissing?: boolean | undefined }} [options]
 */
export function resolveInboundObservationCompany(rawObservation, rawCompanies, options = {}) {
  const observation = inboundObservationSchema.parse(rawObservation);
  const companies = (rawCompanies ?? []).map((raw) => companySchema.parse(raw));
  const createIfMissing = options.createIfMissing === true;

  let company = observation.companyId
    ? companies.find((candidate) => candidate.id === observation.companyId) ?? null
    : null;
  let companyCreated = false;
  let companyLinkedToMotion = false;

  if (!company) {
    const companyName = normalizeResolvableCompanyName(observation.actorCompanyName);
    if (!companyName) {
      return {
        observation,
        company: null,
        companyCreated,
        companyLinkedToMotion,
      };
    }

    company = companies.find((candidate) => normalizeCompanyNameKey(candidate.name) === normalizeCompanyNameKey(companyName)) ?? null;
    if (!company) {
      if (!createIfMissing || !observation.motionId) {
        return {
          observation,
          company: null,
          companyCreated,
          companyLinkedToMotion,
        };
      }

      company = addCompany({
        name: companyName,
        motionIds: observation.motionId ? [observation.motionId] : [],
      });
      companyCreated = true;
      companyLinkedToMotion = Boolean(observation.motionId);
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
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
