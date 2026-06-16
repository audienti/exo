// @ts-check

import { motionSchema } from "../schema/motion.js";
import { buildEmailIdentityValues } from "../lib/email-identity.js";
import {
  buildLinkedinProfileUrlFromPublicId,
  extractLinkedinPublicId,
  normalizeContactValue,
  withDerivedProspectContacts
} from "../lib/prospect-contacts.js";

/**
 * @param {unknown[]} rawMotions
 */
export function buildInboundObservationLinkContext(rawMotions) {
  const motions = rawMotions.map((item) => motionSchema.parse(item));
  const companyContexts = [];
  const companyContextsByCompanyId = new Map();
  const prospectContexts = [];
  const prospectContextById = new Map();
  const identityMatchesByKey = new Map();
  const motionById = new Map();
  const accountByMotionCompanyKey = new Map();

  for (const motion of motions) {
    motionById.set(motion.id, motion);
    for (const account of motion.targetMap.accounts) {
      const companyContext = {
        motionId: motion.id,
        companyId: account.companyId,
      };
      companyContexts.push(companyContext);
      const existingCompanyContexts = companyContextsByCompanyId.get(account.companyId) ?? [];
      existingCompanyContexts.push(companyContext);
      companyContextsByCompanyId.set(account.companyId, existingCompanyContexts);
      accountByMotionCompanyKey.set(`${motion.id}:${account.companyId}`, account);

      for (const rawProspect of account.prospects) {
        const prospect = withDerivedProspectContacts(rawProspect);
        const prospectContext = {
          motionId: motion.id,
          companyId: account.companyId,
          prospectId: prospect.id,
          motion,
          account,
          prospect,
          identityKeys: buildProspectIdentityKeys(prospect),
        };
        prospectContexts.push(prospectContext);
        prospectContextById.set(prospect.id, prospectContext);
        for (const key of prospectContext.identityKeys) {
          const matches = identityMatchesByKey.get(key) ?? [];
          matches.push(prospectContext);
          identityMatchesByKey.set(key, matches);
        }
      }
    }
  }

  return {
    motions,
    companyContexts,
    companyContextsByCompanyId,
    prospectContexts,
    prospectContextById,
    identityMatchesByKey,
    motionById,
    accountByMotionCompanyKey,
  };
}

/**
 * Explicit links are allowed. Only conversation surfaces that are already
 * defined as prospect-scoped may inherit a unique exact identity match from
 * current motion state. Invite and attention surfaces stay global until the
 * operator explicitly claims them into the local transition backlog.
 *
 * @param {unknown[]} rawMotions
 * @param {{
 *   surfaceKey?: string | null | undefined,
 *   motionId?: string | null | undefined,
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined,
 *   actorHandle?: string | null | undefined,
 *   actorProfileUrl?: string | null | undefined,
 *   actorLinkedinPublicId?: string | null | undefined,
 *   actorLinkedinMemberId?: string | null | undefined
 * }} input
 * @param {ReturnType<typeof buildInboundObservationLinkContext> | null} [linkContext]
 */
export function resolveInboundObservationLinks(rawMotions, input, linkContext = null) {
  const context = linkContext ?? buildInboundObservationLinkContext(rawMotions);
  const prospectContextById = context.prospectContextById;

  const resolved = {
    motionId: normalizeNullableString(input.motionId),
    companyId: normalizeNullableString(input.companyId),
    prospectId: normalizeNullableString(input.prospectId),
  };

  if (resolved.prospectId) {
    const explicitProspect = prospectContextById.get(resolved.prospectId) ?? null;
    if (!explicitProspect) {
      throw new Error(`Inbound observation prospect not found in current motions: ${resolved.prospectId}`);
    }

    return mergeResolvedLinks(resolved, explicitProspect);
  }

  if (resolved.companyId && !resolved.motionId) {
    const companyMatches = context.companyContextsByCompanyId.get(resolved.companyId) ?? [];
    if (companyMatches.length === 1) {
      resolved.motionId = companyMatches[0].motionId;
    }
  }

  const identityMatchedProspect = supportsDeterministicIdentityBinding(input.surfaceKey)
    ? resolveProspectContextByIdentity(context.identityMatchesByKey, resolved, input)
    : null;
  if (identityMatchedProspect) {
    return mergeResolvedLinks(resolved, identityMatchedProspect);
  }

  return resolved;
}

/**
 * @param {Map<string, Array<{
 *   motionId: string,
 *   companyId: string,
 *   prospectId: string,
 *   motion: import("../schema/motion.js").motionSchema._type,
 *   account: import("../schema/target-account.js").targetAccountSchema._type,
 *   prospect: ReturnType<typeof withDerivedProspectContacts>,
 *   identityKeys: Set<string>
 * }>>} identityMatchesByKey
 * @param {{ motionId: string | null, companyId: string | null, prospectId: string | null }} resolved
 * @param {{
 *   surfaceKey?: string | null | undefined,
 *   actorHandle?: string | null | undefined,
 *   actorProfileUrl?: string | null | undefined,
 *   actorLinkedinPublicId?: string | null | undefined,
 *   actorLinkedinMemberId?: string | null | undefined
 * }} input
 */
function resolveProspectContextByIdentity(identityMatchesByKey, resolved, input) {
  const identityKeys = buildInputIdentityKeys(input);
  if (!identityKeys.size) {
    return null;
  }

  const matchesByProspectId = new Map();
  for (const key of identityKeys) {
    for (const context of identityMatchesByKey.get(key) ?? []) {
      if (resolved.motionId && context.motionId !== resolved.motionId) {
        continue;
      }

      if (resolved.companyId && context.companyId !== resolved.companyId) {
        continue;
      }

      matchesByProspectId.set(context.prospectId, context);
    }
  }

  const matches = [...matchesByProspectId.values()];
  return matches.length === 1 ? matches[0] : null;
}

/**
 * @param {string | null | undefined} surfaceKey
 */
function supportsDeterministicIdentityBinding(surfaceKey) {
  const normalized = normalizeNullableString(surfaceKey)?.toLowerCase() ?? null;
  return normalized === "linkedin-sent-invitations"
    || normalized === "linkedin-messaging-inbox"
    || normalized === "gmail-inbox-threads";
}

/**
 * @param {{
 *   email?: string | null,
 *   linkedinProfileUrl?: string | null,
 *   linkedinProfileSnapshot?: {
 *     profileUrl?: string | null,
 *     publicId?: string | null,
 *     memberId?: string | null
 *   } | null,
 *   contactPoints?: Array<Record<string, any>>
 * }} prospect
 */
function buildProspectIdentityKeys(prospect) {
  const keys = new Set();

  addEmailKey(keys, prospect.email);
  addLinkedinProfileKey(keys, prospect.linkedinProfileUrl);
  addLinkedinPublicIdKey(keys, prospect.linkedinProfileSnapshot?.publicId);
  addLinkedinMemberIdKey(keys, prospect.linkedinProfileSnapshot?.memberId);
  addLinkedinProfileKey(keys, prospect.linkedinProfileSnapshot?.profileUrl);

  for (const point of prospect.contactPoints ?? []) {
    if (!point || typeof point !== "object") {
      continue;
    }

    if (point.matchStatus === "rejected" || point.verificationStatus === "rejected") {
      continue;
    }

    switch (point.kind) {
      case "email":
        addEmailKey(keys, point.value);
        break;
      case "linkedin_profile":
        addLinkedinProfileKey(keys, point.value);
        break;
      case "linkedin_public_id":
        addLinkedinPublicIdKey(keys, point.value);
        break;
      case "linkedin_member_id":
        addLinkedinMemberIdKey(keys, point.value);
        break;
      default:
        break;
    }
  }

  return keys;
}

/**
 * @param {{
 *   actorHandle?: string | null | undefined,
 *   actorProfileUrl?: string | null | undefined,
 *   actorLinkedinPublicId?: string | null | undefined,
 *   actorLinkedinMemberId?: string | null | undefined
 * }} input
 */
function buildInputIdentityKeys(input) {
  const keys = new Set();
  const actorHandle = normalizeNullableString(input.actorHandle);
  const emailHandle = actorHandle?.includes("@") ? actorHandle : null;
  const linkedinPublicId = normalizeNullableString(input.actorLinkedinPublicId)
    ?? extractLinkedinPublicId(input.actorProfileUrl)
    ?? (actorHandle && !actorHandle.includes("@") ? actorHandle : null);

  addEmailKey(keys, emailHandle);
  addLinkedinProfileKey(keys, input.actorProfileUrl);
  addLinkedinPublicIdKey(keys, linkedinPublicId);
  addLinkedinMemberIdKey(keys, input.actorLinkedinMemberId);

  return keys;
}

/**
 * @param {Set<string>} keys
 * @param {string | null | undefined} value
 */
function addEmailKey(keys, value) {
  for (const normalized of buildEmailIdentityValues(value)) {
    keys.add(`email:${normalized}`);
  }
}

/**
 * @param {Set<string>} keys
 * @param {string | null | undefined} value
 */
function addLinkedinProfileKey(keys, value) {
  const normalized = normalizeContactKeyValue("linkedin_profile", value);
  if (!normalized) {
    return;
  }

  keys.add(`linkedin_profile:${normalized}`);
  const publicId = extractLinkedinPublicId(normalized);
  if (publicId) {
    keys.add(`linkedin_public_id:${publicId}`);
  }
}

/**
 * @param {Set<string>} keys
 * @param {string | null | undefined} value
 */
function addLinkedinPublicIdKey(keys, value) {
  const normalized = normalizeContactKeyValue("linkedin_public_id", value);
  if (!normalized) {
    return;
  }

  keys.add(`linkedin_public_id:${normalized}`);
  const profileUrl = buildLinkedinProfileUrlFromPublicId(normalized);
  if (profileUrl) {
    keys.add(`linkedin_profile:${normalizeContactValue("linkedin_profile", profileUrl)}`);
  }
}

/**
 * @param {Set<string>} keys
 * @param {string | null | undefined} value
 */
function addLinkedinMemberIdKey(keys, value) {
  const normalized = normalizeContactKeyValue("linkedin_member_id", value);
  if (normalized) {
    keys.add(`linkedin_member_id:${normalized}`);
  }
}

/**
 * @param {string} kind
 * @param {string | null | undefined} value
 */
function normalizeContactKeyValue(kind, value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }

  return normalizeContactValue(kind, normalized);
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
    prospectId: existing.prospectId ?? resolved.prospectId,
  };
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
