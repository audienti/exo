// @ts-check

import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import {
  deleteMotion,
  findMotionById,
  listCompanies,
  listInboundObservations,
  moveProspectToMotionRows,
  updateCompany,
  upsertInboundObservation,
} from "../db/database.js";
import { ensureTransitionMotion, isTransitionMotion } from "./ensure-transition-motion.js";
import { rehomeProspect } from "./rehome-prospect.js";
import { updateCompanyRecord } from "./update-company.js";

/**
 * @param {{ motionId: string }} input
 */
export async function removeMotionGoverned(input) {
  if (!input.motionId) {
    throw new Error("removeMotionGoverned requires motionId.");
  }

  const rawMotion = findMotionById(input.motionId);
  if (!rawMotion) {
    throw new Error(`Motion not found: ${input.motionId}`);
  }

  const motion = motionSchema.parse(rawMotion);
  if (isTransitionMotion(motion)) {
    throw new Error("Transition backlog cannot be deleted.");
  }

  const companiesById = new Map(
    listCompanies()
      .map((rawCompany) => companySchema.parse(rawCompany))
      .map((company) => [company.id, company]),
  );
  const relatedCompanyIds = new Set(
    Array.from(companiesById.values())
      .filter((company) => company.motionIds.includes(motion.id))
      .map((company) => company.id),
  );
  const prospectRefs = (motion.targetMap.accounts ?? []).flatMap((account) =>
    (account.prospects ?? []).map((prospect) => ({
      prospectId: prospect.id,
      prospectName: prospect.name,
      companyId: account.companyId,
    })),
  );

  /** @type {import("../schema/motion.js").motionSchema._type | null} */
  let transitionMotion = null;
  /** @type {import("../schema/motion.js").motionSchema._type | null} */
  let workingTransitionMotion = null;
  let workingFromMotion = motion;
  /** @type {Array<{ id: string, name: string, companyId: string, companyName: string }>} */
  const migratedProspects = [];
  /** @type {import("../schema/inbound.js").inboundObservationSchema._type[]} */
  const relinkedObservations = [];

  if (prospectRefs.length > 0) {
    workingTransitionMotion = motionSchema.parse(await ensureTransitionMotion());

    for (const ref of prospectRefs) {
      const relatedObservations = listInboundObservations({
        motionId: motion.id,
        prospectId: ref.prospectId,
      });
      const result = rehomeProspect({
        rawFromMotion: workingFromMotion,
        rawToMotion: workingTransitionMotion,
        rawCompanies: Array.from(companiesById.values()),
        prospectId: ref.prospectId,
        relatedObservations,
      });

      workingFromMotion = result.fromMotion;
      workingTransitionMotion = result.toMotion;
      moveProspectToMotionRows({
        prospectId: ref.prospectId,
        toMotionId: workingTransitionMotion.id,
      });
      companiesById.set(result.company.id, result.company);
      relatedCompanyIds.add(result.company.id);
      relinkedObservations.push(...result.observations);
      migratedProspects.push({
        id: result.prospectId,
        name: result.prospectName,
        companyId: result.company.id,
        companyName: result.company.name,
      });
    }
  }

  const updatedCompanies = [];
  for (const companyId of relatedCompanyIds) {
    const company = companiesById.get(companyId);
    if (!company) {
      continue;
    }

    const nextMotionIds = company.motionIds.filter((candidateId) => candidateId !== motion.id);
    const updatedCompany = nextMotionIds.length === company.motionIds.length
      ? company
      : updateCompanyRecord(company, { motionIds: nextMotionIds });
    updateCompany(updatedCompany);
    companiesById.set(updatedCompany.id, updatedCompany);
    updatedCompanies.push(updatedCompany);
  }

  if (workingTransitionMotion) {
    transitionMotion = findMotionById(workingTransitionMotion.id);
  }

  for (const observation of relinkedObservations) {
    upsertInboundObservation(observation);
  }

  deleteMotion(motion.id);

  return {
    removedMotion: motion,
    updatedCompanies,
    transitionMotion,
    migratedProspectCount: migratedProspects.length,
    migratedProspects,
    message: buildRemovalMessage(motion.name, migratedProspects.length),
  };
}

/**
 * @param {string} motionName
 * @param {number} migratedProspectCount
 */
function buildRemovalMessage(motionName, migratedProspectCount) {
  if (migratedProspectCount <= 0) {
    return `Deleted motion ${motionName}.`;
  }

  return `Deleted motion ${motionName}. Moved ${migratedProspectCount} ${pluralize(migratedProspectCount, "prospect")} into transition backlog.`;
}

/**
 * @param {number} count
 * @param {string} singular
 */
function pluralize(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}
