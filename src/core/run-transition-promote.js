// @ts-check
//
// Orchestrate promote + persist for the transition flow. Shared by the CLI
// (`exo transition promote`) and the interactive UI ("Add as prospect" button).

import { ensureTransitionMotion } from "./ensure-transition-motion.js";
import { inboundObservationsShareIdentity } from "./inbound-observations.js";
import { promoteInboundPersonToProspect } from "./promote-inbound-person.js";
import { warmImageProxies } from "../lib/image-proxy.js";
import {
  findInboundObservationById,
  findMotionById,
  insertCompany,
  listCompanies,
  listInboundObservations,
  updateCompany,
  updateMotion,
  upsertInboundObservation,
} from "../db/database.js";

/**
 * @param {{ observationId: string, userId?: string | null, motionId?: string | null }} input
 */
export async function runTransitionPromote(input) {
  const seed = findInboundObservationById(input.observationId);
  if (!seed) {
    throw new Error(`Inbound observation not found: ${input.observationId}`);
  }
  const userId = input.userId ?? seed.userId;

  const rawMotion = input.motionId ? findMotionById(input.motionId) : await ensureTransitionMotion();
  if (!rawMotion) {
    throw new Error(`Motion not found: ${input.motionId}`);
  }

  const all = listInboundObservations({ userId });
  const related = all.filter(
    (observation) => observation.id === seed.id || inboundObservationsShareIdentity(observation, seed),
  );

  const result = promoteInboundPersonToProspect({
    rawMotion: findMotionById(rawMotion.id),
    rawCompanies: listCompanies(),
    seedObservation: seed,
    relatedObservations: related,
  });

  if (result.companyCreated) {
    insertCompany(result.company);
  } else {
    updateCompany(result.company);
  }
  updateMotion(result.motion);
  for (const observation of result.observations) {
    upsertInboundObservation(observation);
  }

  const account = result.motion.targetMap.accounts.find((a) => a.companyId === result.company.id);
  const prospect = account?.prospects.find((p) => p.id === result.prospectId);
  await warmImageProxies([prospect?.avatarUrl]);

  return { ok: true, ...result };
}
