// @ts-check
//
// Orchestrate promote + persist for the transition flow. Shared by the CLI
// (`exo transition promote`) and the interactive UI ("Claim to backlog" button).

import { ensureTransitionMotion, isTransitionMotion } from "./ensure-transition-motion.js";
import { inboundObservationsSharePersonIdentity } from "./inbound-observations.js";
import { resolveLinkedinActorCompanyProfile } from "./inbound-linkedin-live-sync.js";
import { promoteInboundPersonToProspect } from "./promote-inbound-person.js";
import { warmImageProxies } from "../lib/image-proxy.js";
import { normalizeResolvableCompanyName } from "../lib/company-name.js";
import {
  findInboundObservationById,
  findMotionById,
  findUserById,
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
  const all = listInboundObservations({ userId });
  const related = all.filter(
    (observation) => observation.id === seed.id || inboundObservationsSharePersonIdentity(observation, seed),
  );
  const claimed = resolveClaimedContext(related);
  if (claimed) {
    const alreadyClaimed = buildAlreadyClaimedResult(claimed, related);
    if (alreadyClaimed) {
      for (const observation of alreadyClaimed.observations) {
        upsertInboundObservation(observation);
      }
      await warmImageProxies([alreadyClaimed.avatarUrl]);
      return alreadyClaimed.result;
    }

    throw new Error(`${seed.actorName ?? "This person"} is already claimed in another workspace. Re-home them from there instead of promoting them here.`);
  }

  const rawMotion = input.motionId ? findMotionById(input.motionId) : await ensureTransitionMotion();
  if (!rawMotion) {
    throw new Error(`Motion not found: ${input.motionId}`);
  }
  if (!isTransitionMotion(rawMotion)) {
    throw new Error("Inbound claim must land in this workspace's transition backlog first. Promote into the backlog, then re-home into a real motion.");
  }

  const rawUser = findUserById(userId);
  const resolvedCompanyProfile = await resolveTransitionObservationCompanyProfile(rawUser, seed);

  const result = promoteInboundPersonToProspect({
    rawMotion: findMotionById(rawMotion.id),
    rawCompanies: listCompanies(),
    seedObservation: seed,
    relatedObservations: related,
    resolvedCompanyProfile,
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

/**
 * @param {unknown | null} rawUser
 * @param {any} observation
 */
async function resolveTransitionObservationCompanyProfile(rawUser, observation) {
  if (!rawUser) {
    return null;
  }
  if (normalizeResolvableCompanyName(observation.actorCompanyName)) {
    return null;
  }
  if (observation.actorCompanyProfile?.name || observation.actorCompanyProfile?.domain || observation.actorCompanyProfile?.linkedinCompanyUrl) {
    return observation.actorCompanyProfile;
  }

  const linkedinAccount = rawUser.accounts?.find(
    (account) => account.id === observation.accountId && account.capability === "linkedin",
  ) ?? null;
  if (!linkedinAccount?.providerAccountId) {
    return null;
  }

  return await resolveLinkedinActorCompanyProfile({
    providerAccountId: linkedinAccount.providerAccountId,
    actorTitle: observation.actorTitle ?? null,
    actorCompanyName: observation.actorCompanyName ?? null,
    actorHandle: observation.actorHandle ?? null,
    actorProfileUrl: observation.actorProfileUrl ?? null,
    actorLinkedinPublicId: observation.actorLinkedinPublicId ?? null,
    actorLinkedinMemberId: observation.actorLinkedinMemberId ?? null,
    actorAvatarSourceUrl: observation.actorAvatarSourceUrl ?? null,
  });
}

/**
 * @param {ReturnType<typeof listInboundObservations>} related
 */
function resolveClaimedContext(related) {
  return related.find((observation) => observation.motionId && observation.companyId && observation.prospectId) ?? null;
}

/**
 * @param {{ motionId: string, companyId: string, prospectId: string }} claimed
 * @param {ReturnType<typeof listInboundObservations>} related
 */
function buildAlreadyClaimedResult(claimed, related) {
  const motion = findMotionById(claimed.motionId);
  if (!motion) {
    return null;
  }

  const company = listCompanies().find((candidate) => candidate.id === claimed.companyId) ?? null;
  const account = motion.targetMap.accounts.find((candidate) => candidate.companyId === claimed.companyId) ?? null;
  const prospect = account?.prospects.find((candidate) => candidate.id === claimed.prospectId) ?? null;
  if (!company || !prospect) {
    return null;
  }

  const now = new Date().toISOString();
  const observations = related.map((observation) => ({
    ...observation,
    motionId: claimed.motionId,
    companyId: claimed.companyId,
    prospectId: claimed.prospectId,
    updatedAt: now,
  }));

  return {
    avatarUrl: prospect.avatarUrl ?? null,
    observations,
    result: {
      ok: true,
      prospectId: prospect.id,
      prospectName: prospect.name,
      motion,
      company,
      companyCreated: false,
      observations,
      carriedState: "already claimed",
      message: `${prospect.name} is already claimed in this workspace on ${motion.name}.`,
    },
  };
}
