// @ts-check

import { normalizeContactValue } from "../lib/prospect-contacts.js";
import { motionSchema } from "../schema/motion.js";

/**
 * @param {unknown[]} rawMotions
 * @param {{
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined,
 *   actorHandle?: string | null | undefined,
 *   actorProfileUrl?: string | null | undefined
 * }} input
 */
export function resolveInboundObservationLinks(rawMotions, input) {
  const motions = rawMotions.map((item) => motionSchema.parse(item));
  const prospectContexts = [];
  const companyContexts = [];

  for (const motion of motions) {
    for (const account of motion.targetMap.accounts) {
      companyContexts.push({
        motionId: motion.id,
        companyId: account.companyId
      });

      for (const prospect of account.prospects) {
        prospectContexts.push({
          motionId: motion.id,
          companyId: account.companyId,
          prospectId: prospect.id,
          prospect
        });
      }
    }
  }

  const resolved = {
    motionId: normalizeNullableString(input.motionId),
    companyId: normalizeNullableString(input.companyId),
    prospectId: normalizeNullableString(input.prospectId)
  };

  if (resolved.prospectId) {
    const explicitProspect = prospectContexts.find((context) => context.prospectId === resolved.prospectId) ?? null;
    if (!explicitProspect) {
      throw new Error(`Inbound observation prospect not found in current motions: ${resolved.prospectId}`);
    }

    return mergeResolvedLinks(resolved, explicitProspect);
  }

  const filteredProspects = prospectContexts.filter((context) =>
    (!resolved.motionId || context.motionId === resolved.motionId)
    && (!resolved.companyId || context.companyId === resolved.companyId)
  );

  const matchedByProfile = findMatchingProspectsByProfile(filteredProspects, input.actorProfileUrl ?? null);
  const matchedByEmail = findMatchingProspectsByEmail(filteredProspects, input.actorHandle ?? null);
  const resolvedProspect = chooseResolvedProspect(matchedByProfile, matchedByEmail);

  if (resolvedProspect) {
    return mergeResolvedLinks(resolved, resolvedProspect);
  }

  if (resolved.companyId && !resolved.motionId) {
    const companyMatches = companyContexts.filter((context) => context.companyId === resolved.companyId);
    if (companyMatches.length === 1) {
      resolved.motionId = companyMatches[0].motionId;
    }
  }

  return resolved;
}

/**
 * @param {Array<{
 *   motionId: string,
 *   companyId: string,
 *   prospectId: string,
 *   prospect: {
 *     email?: string | null,
 *     linkedinProfileUrl?: string | null,
 *     contactPoints?: Array<{ kind: string, value: string }>
 *   }
 * }>} prospectContexts
 * @param {string | null} actorProfileUrl
 */
function findMatchingProspectsByProfile(prospectContexts, actorProfileUrl) {
  const normalizedProfileUrl = normalizeNullableString(actorProfileUrl);
  if (!normalizedProfileUrl) {
    return [];
  }

  const normalizedValue = normalizeContactValue("linkedin_profile", normalizedProfileUrl);
  return prospectContexts.filter((context) => hasMatchingContactPoint(context.prospect, "linkedin_profile", normalizedValue));
}

/**
 * @param {Array<{
 *   motionId: string,
 *   companyId: string,
 *   prospectId: string,
 *   prospect: {
 *     email?: string | null,
 *     linkedinProfileUrl?: string | null,
 *     contactPoints?: Array<{ kind: string, value: string }>
 *   }
 * }>} prospectContexts
 * @param {string | null} actorHandle
 */
function findMatchingProspectsByEmail(prospectContexts, actorHandle) {
  const normalizedHandle = normalizeNullableString(actorHandle);
  if (!normalizedHandle || !normalizedHandle.includes("@")) {
    return [];
  }

  const normalizedValue = normalizeContactValue("email", normalizedHandle);
  return prospectContexts.filter((context) => hasMatchingContactPoint(context.prospect, "email", normalizedValue));
}

/**
 * @param {{
 *   email?: string | null,
 *   linkedinProfileUrl?: string | null,
 *   contactPoints?: Array<{ kind: string, value: string }>
 * }} prospect
 * @param {"email" | "linkedin_profile"} kind
 * @param {string} normalizedValue
 */
function hasMatchingContactPoint(prospect, kind, normalizedValue) {
  if (!normalizedValue) {
    return false;
  }

  const directValue = kind === "email" ? prospect.email : prospect.linkedinProfileUrl;
  if (directValue && normalizeContactValue(kind, directValue) === normalizedValue) {
    return true;
  }

  return (prospect.contactPoints ?? []).some((point) =>
    point.kind === kind && normalizeContactValue(point.kind, point.value) === normalizedValue
  );
}

/**
 * @param {Array<{ motionId: string, companyId: string, prospectId: string }>} profileMatches
 * @param {Array<{ motionId: string, companyId: string, prospectId: string }>} emailMatches
 */
function chooseResolvedProspect(profileMatches, emailMatches) {
  const uniqueProfile = profileMatches.length === 1 ? profileMatches[0] : null;
  const uniqueEmail = emailMatches.length === 1 ? emailMatches[0] : null;

  if (uniqueProfile && uniqueEmail) {
    return sameResolvedProspect(uniqueProfile, uniqueEmail) ? uniqueProfile : null;
  }

  return uniqueProfile ?? uniqueEmail;
}

/**
 * @param {{ motionId: string | null, companyId: string | null, prospectId: string | null }} existing
 * @param {{ motionId: string, companyId: string, prospectId: string }} resolved
 */
function mergeResolvedLinks(existing, resolved) {
  if (existing.motionId && existing.motionId !== resolved.motionId) {
    throw new Error(`Inbound observation motion ${existing.motionId} conflicts with resolved prospect context ${resolved.motionId}.`);
  }

  if (existing.companyId && existing.companyId !== resolved.companyId) {
    throw new Error(`Inbound observation company ${existing.companyId} conflicts with resolved prospect context ${resolved.companyId}.`);
  }

  if (existing.prospectId && existing.prospectId !== resolved.prospectId) {
    throw new Error(`Inbound observation prospect ${existing.prospectId} conflicts with resolved prospect context ${resolved.prospectId}.`);
  }

  return {
    motionId: existing.motionId ?? resolved.motionId,
    companyId: existing.companyId ?? resolved.companyId,
    prospectId: existing.prospectId ?? resolved.prospectId
  };
}

/**
 * @param {{ motionId: string, companyId: string, prospectId: string }} left
 * @param {{ motionId: string, companyId: string, prospectId: string }} right
 */
function sameResolvedProspect(left, right) {
  return left.motionId === right.motionId && left.companyId === right.companyId && left.prospectId === right.prospectId;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
