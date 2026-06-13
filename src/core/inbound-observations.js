// @ts-check

import crypto from "node:crypto";
import { browserProfileCapabilitySchema } from "../schema/browser-profile.js";
import { inboundObservationKindSchema, inboundObservationSchema, inboundSurfaceKeySchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { findInboundSurfaceDefinition } from "../lib/inbound-surface-catalog.js";
import { buildEmailIdentityValues } from "../lib/email-identity.js";
import { normalizeImageProxyFields } from "../lib/image-proxy.js";
import { listInboundObservations } from "../db/database.js";
import {
  buildLinkedinProfileUrlFromPublicId,
  extractLinkedinPublicId,
  normalizeContactValue
} from "../lib/prospect-contacts.js";
import { resolveInboundObservationLinks } from "./resolve-inbound-observation-links.js";

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId: string,
 *   surfaceKey: string,
 *   kind: string,
 *   observedAt: string,
 *   eventAt?: string | null,
 *   summary: string,
 *   externalId?: string | null,
 *   actorName?: string | null,
 *   actorTitle?: string | null,
 *   actorCompanyName?: string | null,
 *   actorHandle?: string | null,
 *   actorProfileUrl?: string | null,
 *   actorLinkedinPublicId?: string | null,
 *   actorLinkedinMemberId?: string | null,
 *   actorAvatarSourceUrl?: string | null,
 *   threadUrl?: string | null,
 *   sourceUrl?: string | null,
 *   subject?: string | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   providerSharedSecret?: string | null,
 *   actorCompanyProfile?: {
 *     name?: string | null,
 *     domain?: string | null,
 *     websiteUrl?: string | null,
 *     linkedinCompanyUrl?: string | null,
 *     logoSourceUrl?: string | null,
 *   } | null,
 *   identityResolutionStatus?: "pending" | "resolved" | "no_match" | "blocked" | null,
 *   identityResolutionCheckedAt?: string | null,
 *   identityResolutionReason?: string | null,
 *   notes?: string | null,
 *   messages?: Array<{
 *     id?: string | null,
 *     direction?: "inbound" | "outbound" | "unknown",
 *     sentAt?: string | null,
 *     fromName?: string | null,
 *     fromHandle?: string | null,
 *     body: string
 *   }> | null
 * }} input
 * @param {{ rawMotions?: unknown[] | undefined }} [options]
 */
export function recordInboundObservation(rawUser, input, options = {}) {
  const user = userSchema.parse(rawUser);
  const account = user.accounts.find((candidate) => candidate.id === input.accountId);
  if (!account) {
    throw new Error(`User account not found: ${input.accountId}`);
  }

  const surfaceKey = inboundSurfaceKeySchema.parse(input.surfaceKey);
  const kind = inboundObservationKindSchema.parse(input.kind);
  const definition = findInboundSurfaceDefinition(surfaceKey);
  if (!definition) {
    throw new Error(`Inbound surface not found: ${surfaceKey}`);
  }

  if (definition.capability !== account.capability) {
    throw new Error(`Inbound surface ${surfaceKey} does not apply to capability ${account.capability}.`);
  }

  if (!definition.observationKinds.includes(kind)) {
    throw new Error(`Observation kind ${kind} does not apply to inbound surface ${surfaceKey}.`);
  }

  const explicitLinks = resolveInboundObservationLinks(options.rawMotions ?? [], {
    surfaceKey,
    motionId: input.motionId,
    companyId: input.companyId,
    prospectId: input.prospectId,
    actorHandle: input.actorHandle,
    actorProfileUrl: input.actorProfileUrl,
    actorLinkedinPublicId: input.actorLinkedinPublicId,
    actorLinkedinMemberId: input.actorLinkedinMemberId
  });
  const claimedLinks = shouldInheritClaimedLinks(explicitLinks)
    ? resolveClaimedInboundObservationLinks(listInboundObservations({ userId: user.id }), {
        accountId: account.id,
        capability: account.capability,
        surfaceKey,
        actorHandle: input.actorHandle,
        actorProfileUrl: input.actorProfileUrl,
        actorLinkedinPublicId: input.actorLinkedinPublicId,
        actorLinkedinMemberId: input.actorLinkedinMemberId,
      })
    : null;
  const resolvedLinks = claimedLinks ?? explicitLinks;
  const now = new Date().toISOString();
  const normalizedExternalId = normalizeNullableString(input.externalId);
  const avatar = normalizeImageProxyFields(input.actorAvatarSourceUrl);
  const dedupeKey = normalizedExternalId
    ? `${account.id}:${surfaceKey}:${normalizedExternalId}`
    : crypto.randomUUID();

  return inboundObservationSchema.parse({
    id: crypto.randomUUID(),
    dedupeKey,
    userId: user.id,
    accountId: account.id,
    capability: browserProfileCapabilitySchema.parse(account.capability),
    platform: definition.platform,
    surfaceKey,
    kind,
    truthLevel: definition.truthLevel,
    observedAt: input.observedAt,
    recordedAt: now,
    eventAt: normalizeNullableString(input.eventAt) ?? null,
    externalId: normalizedExternalId,
    actorName: normalizeNullableString(input.actorName),
    actorTitle: normalizeNullableString(input.actorTitle),
    actorCompanyName: normalizeNullableString(input.actorCompanyName),
    actorHandle: normalizeNullableString(input.actorHandle),
    actorProfileUrl: normalizeNullableString(input.actorProfileUrl),
    actorLinkedinPublicId: normalizeNullableString(input.actorLinkedinPublicId) ?? extractLinkedinPublicId(input.actorProfileUrl),
    actorLinkedinMemberId: normalizeNullableString(input.actorLinkedinMemberId),
    actorAvatarSourceUrl: avatar.sourceUrl,
    actorAvatarUrl: avatar.proxyUrl,
    threadUrl: normalizeNullableString(input.threadUrl),
    sourceUrl: normalizeNullableString(input.sourceUrl),
    subject: normalizeNullableString(input.subject),
    summary: input.summary.trim(),
    motionId: resolvedLinks.motionId,
    companyId: resolvedLinks.companyId,
    prospectId: resolvedLinks.prospectId,
    providerSharedSecret: normalizeNullableString(input.providerSharedSecret),
    actorCompanyProfile: normalizeInboundObservationCompanyProfile(input.actorCompanyProfile),
    identityResolutionStatus: normalizeNullableString(input.identityResolutionStatus),
    identityResolutionCheckedAt: normalizeNullableString(input.identityResolutionCheckedAt),
    identityResolutionReason: normalizeNullableString(input.identityResolutionReason),
    notes: normalizeNullableString(input.notes),
    messages: normalizeInboundMessages(input.messages)
  });
}

/**
 * @param {unknown[]} rawObservations
 * @returns {import("../schema/inbound.js").inboundObservationSchema._type[]}
 */
export function parseInboundObservations(rawObservations) {
  return rawObservations.map((item) => inboundObservationSchema.parse(item));
}

/**
 * @param {{
 *   user: { id: string, label: string, owner: string | null },
 *   observations: import("../schema/inbound.js").inboundObservationSchema._type[]
 * }} input
 */
export function buildInboundObservationListView(input) {
  const observations = [...input.observations].sort((left, right) =>
    right.observedAt.localeCompare(left.observedAt) || right.recordedAt.localeCompare(left.recordedAt)
  );

  return {
    user: input.user,
    counts: {
      observationCount: observations.length,
      accountCount: new Set(observations.map((observation) => observation.accountId)).size,
      surfaceCount: new Set(observations.map((observation) => observation.surfaceKey)).size
    },
    observations
  };
}

/**
 * @param {unknown | null} rawExisting
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} nextObservation
 */
export function mergeInboundObservation(rawExisting, nextObservation) {
  if (!rawExisting) {
    return nextObservation;
  }

  const existing = inboundObservationSchema.parse(rawExisting);
  if (existing.dedupeKey !== nextObservation.dedupeKey && !inboundObservationsShareIdentity(existing, nextObservation)) {
    return nextObservation;
  }

  const preserveDecisionState = shouldPreserveReceivedInvitationDecision(existing, nextObservation);

  return inboundObservationSchema.parse({
    ...existing,
    ...nextObservation,
    id: existing.id,
    dedupeKey: existing.dedupeKey,
    kind: preserveDecisionState ? existing.kind : nextObservation.kind,
    observedAt: preserveDecisionState ? existing.observedAt : nextObservation.observedAt,
    // Preserve the earliest eventAt we ever derived. LinkedIn's "X ago" labels
    // round to coarser buckets as a row ages (1 day → 2 weeks → 1 month), so an
    // eventAt computed at the first sighting sits closer to the real moment than
    // one computed weeks later.
    eventAt: existing.eventAt ?? nextObservation.eventAt ?? null,
    summary: preserveDecisionState ? existing.summary : nextObservation.summary,
    actorName: nextObservation.actorName ?? existing.actorName,
    actorTitle: nextObservation.actorTitle ?? existing.actorTitle,
    actorCompanyName: nextObservation.actorCompanyName ?? existing.actorCompanyName,
    actorHandle: nextObservation.actorHandle ?? existing.actorHandle,
    actorProfileUrl: nextObservation.actorProfileUrl ?? existing.actorProfileUrl,
    actorLinkedinPublicId: nextObservation.actorLinkedinPublicId ?? existing.actorLinkedinPublicId,
    actorLinkedinMemberId: nextObservation.actorLinkedinMemberId ?? existing.actorLinkedinMemberId,
    actorAvatarSourceUrl: nextObservation.actorAvatarSourceUrl ?? existing.actorAvatarSourceUrl,
    actorAvatarUrl: nextObservation.actorAvatarUrl ?? existing.actorAvatarUrl,
    threadUrl: nextObservation.threadUrl ?? existing.threadUrl,
    sourceUrl: nextObservation.sourceUrl ?? existing.sourceUrl,
    subject: nextObservation.subject ?? existing.subject,
    motionId: nextObservation.motionId ?? existing.motionId,
    companyId: nextObservation.companyId ?? existing.companyId,
    prospectId: nextObservation.prospectId ?? existing.prospectId,
    providerSharedSecret: nextObservation.providerSharedSecret ?? existing.providerSharedSecret,
    actorCompanyProfile: mergeInboundObservationCompanyProfile(existing.actorCompanyProfile, nextObservation.actorCompanyProfile),
    identityResolutionStatus: nextObservation.identityResolutionStatus ?? existing.identityResolutionStatus,
    identityResolutionCheckedAt: nextObservation.identityResolutionCheckedAt ?? existing.identityResolutionCheckedAt,
    identityResolutionReason: nextObservation.identityResolutionReason ?? existing.identityResolutionReason,
    notes: preserveDecisionState ? (existing.notes ?? nextObservation.notes) : (nextObservation.notes ?? existing.notes),
    messages: nextObservation.messages.length ? nextObservation.messages : existing.messages
  });
}

const RECEIVED_INVITATION_DECISION_KINDS = new Set([
  "connection_request_accept_requested",
  "connection_request_accepted",
  "connection_request_decline_requested",
  "connection_request_declined",
]);

/**
 * Preserve operator/agent decisions when the authoritative received-invitations
 * sync re-sees the same invite before the live action disappears from LinkedIn.
 * A fresh "received" row is newer evidence of presence, not permission to
 * downgrade a queued or final decision on the same invite.
 *
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} existing
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} nextObservation
 */
function shouldPreserveReceivedInvitationDecision(existing, nextObservation) {
  return existing.surfaceKey === "linkedin-received-invitations"
    && nextObservation.surfaceKey === "linkedin-received-invitations"
    && nextObservation.kind === "connection_request_received"
    && RECEIVED_INVITATION_DECISION_KINDS.has(existing.kind);
}

/**
 * @param {{
 *   name?: string | null,
 *   domain?: string | null,
 *   websiteUrl?: string | null,
 *   linkedinCompanyUrl?: string | null,
 *   logoSourceUrl?: string | null,
 * } | null | undefined} profile
 */
function normalizeInboundObservationCompanyProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const normalized = {
    name: normalizeNullableString(profile.name),
    domain: normalizeNullableString(profile.domain),
    websiteUrl: normalizeNullableString(profile.websiteUrl),
    linkedinCompanyUrl: normalizeNullableString(profile.linkedinCompanyUrl),
    logoSourceUrl: normalizeNullableString(profile.logoSourceUrl),
  };

  return normalized.name
    || normalized.domain
    || normalized.websiteUrl
    || normalized.linkedinCompanyUrl
    || normalized.logoSourceUrl
    ? normalized
    : null;
}

/**
 * @param {{
 *   name?: string | null,
 *   domain?: string | null,
 *   websiteUrl?: string | null,
 *   linkedinCompanyUrl?: string | null,
 *   logoSourceUrl?: string | null,
 * } | null | undefined} left
 * @param {{
 *   name?: string | null,
 *   domain?: string | null,
 *   websiteUrl?: string | null,
 *   linkedinCompanyUrl?: string | null,
 *   logoSourceUrl?: string | null,
 * } | null | undefined} right
 */
export function mergeInboundObservationCompanyProfile(left, right) {
  const normalizedLeft = normalizeInboundObservationCompanyProfile(left);
  const normalizedRight = normalizeInboundObservationCompanyProfile(right);
  if (!normalizedLeft) {
    return normalizedRight;
  }
  if (!normalizedRight) {
    return normalizedLeft;
  }

  return {
    name: normalizedRight.name ?? normalizedLeft.name,
    domain: normalizedRight.domain ?? normalizedLeft.domain,
    websiteUrl: normalizedRight.websiteUrl ?? normalizedLeft.websiteUrl,
    linkedinCompanyUrl: normalizedRight.linkedinCompanyUrl ?? normalizedLeft.linkedinCompanyUrl,
    logoSourceUrl: normalizedRight.logoSourceUrl ?? normalizedLeft.logoSourceUrl,
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
export function buildInboundObservationIdentityKeys(observation) {
  return buildInboundIdentityKeys(observation, { includeExternalId: true, includeBroadLinkedinIdentity: false });
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type | {
 *   accountId?: string | null,
 *   capability?: string | null,
 *   surfaceKey?: string | null,
 *   actorHandle?: string | null,
 *   actorProfileUrl?: string | null,
 *   actorLinkedinPublicId?: string | null,
 *   actorLinkedinMemberId?: string | null,
 * }} observation
 */
export function buildInboundObservationPersonIdentityKeys(observation) {
  return buildInboundIdentityKeys(observation, { includeExternalId: false, includeBroadLinkedinIdentity: true });
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type | {
 *   accountId?: string | null,
 *   capability?: string | null,
 *   surfaceKey?: string | null,
 *   actorHandle?: string | null,
 *   actorProfileUrl?: string | null,
 *   actorLinkedinPublicId?: string | null,
 *   actorLinkedinMemberId?: string | null,
 *   externalId?: string | null,
 * }} observation
 * @param {{ includeExternalId: boolean, includeBroadLinkedinIdentity: boolean }} options
 */
function buildInboundIdentityKeys(observation, options) {
  const keys = new Set();
  if (options.includeExternalId && observation.externalId) {
    keys.add(`external:${observation.externalId}`);
  }

  if (supportsLinkedinIdentityKeys(observation.surfaceKey, options) && observation.actorProfileUrl) {
    keys.add(`linkedin_profile:${normalizeContactValue("linkedin_profile", observation.actorProfileUrl)}`);
  }

  if (supportsLinkedinIdentityKeys(observation.surfaceKey, options)) {
    const derivedPublicId = observation.actorLinkedinPublicId ?? extractLinkedinPublicId(observation.actorProfileUrl);
    if (derivedPublicId) {
      const normalizedPublicId = normalizeContactValue("linkedin_public_id", derivedPublicId);
      keys.add(`linkedin_public_id:${normalizedPublicId}`);
      const derivedProfileUrl = buildLinkedinProfileUrlFromPublicId(derivedPublicId);
      if (derivedProfileUrl) {
        keys.add(`linkedin_profile:${normalizeContactValue("linkedin_profile", derivedProfileUrl)}`);
      }
    }

    if (observation.actorLinkedinMemberId) {
      keys.add(`linkedin_member_id:${normalizeContactValue("linkedin_member_id", observation.actorLinkedinMemberId)}`);
    }
  }

  if (observation.actorHandle) {
    const normalizedHandle = normalizeNullableString(observation.actorHandle)?.toLowerCase() ?? null;
    if (normalizedHandle) {
      keys.add(`actor_handle:${normalizedHandle}`);
      if (normalizedHandle.includes("@")) {
        for (const email of buildEmailIdentityValues(normalizedHandle)) {
          keys.add(`email:${email}`);
        }
      }
    }
  }

  return keys;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} left
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} right
 */
export function inboundObservationsShareIdentity(left, right) {
  if (left.accountId !== right.accountId || left.surfaceKey !== right.surfaceKey) {
    return false;
  }

  const rightKeys = buildInboundObservationIdentityKeys(right);
  for (const key of buildInboundObservationIdentityKeys(left)) {
    if (rightKeys.has(key)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type | {
 *   accountId?: string | null,
 *   capability?: string | null,
 *   surfaceKey?: string | null,
 *   actorHandle?: string | null,
 *   actorProfileUrl?: string | null,
 *   actorLinkedinPublicId?: string | null,
 *   actorLinkedinMemberId?: string | null,
 * }} left
 * @param {import("../schema/inbound.js").inboundObservationSchema._type | {
 *   accountId?: string | null,
 *   capability?: string | null,
 *   surfaceKey?: string | null,
 *   actorHandle?: string | null,
 *   actorProfileUrl?: string | null,
 *   actorLinkedinPublicId?: string | null,
 *   actorLinkedinMemberId?: string | null,
 * }} right
 */
export function inboundObservationsSharePersonIdentity(left, right) {
  const rightKeys = buildInboundObservationPersonIdentityKeys(right);
  for (const key of buildInboundObservationPersonIdentityKeys(left)) {
    if (rightKeys.has(key)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {import("../schema/inbound.js").inboundSurfaceKeySchema._type | string | null | undefined} surfaceKey
 * @param {{ includeBroadLinkedinIdentity: boolean }} options
 */
function supportsLinkedinIdentityKeys(surfaceKey, options) {
  if (!surfaceKey) {
    return false;
  }

  if (options.includeBroadLinkedinIdentity) {
    return String(surfaceKey).startsWith("linkedin-");
  }

  return surfaceKey === "linkedin-sent-invitations"
    || surfaceKey === "linkedin-received-invitations"
    || surfaceKey === "linkedin-followers-list"
    || surfaceKey === "linkedin-following-list"
    || surfaceKey === "linkedin-profile-views";
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

/**
 * @param {Array<{
 *   id?: string | null,
 *   direction?: "inbound" | "outbound" | "unknown",
 *   sentAt?: string | null,
 *   fromName?: string | null,
 *   fromHandle?: string | null,
 *   body: string
 * }> | null | undefined} messages
 */
function normalizeInboundMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return [];
  }

  return messages
    .map((message) => ({
      id: normalizeNullableString(message?.id),
      direction: message?.direction ?? "unknown",
      sentAt: normalizeNullableString(message?.sentAt),
      fromName: normalizeNullableString(message?.fromName),
      fromHandle: normalizeNullableString(message?.fromHandle),
      body: String(message?.body ?? "").trim(),
    }))
    .filter((message) => message.body.length > 0);
}

/**
 * @param {{ motionId: string | null, companyId: string | null, prospectId: string | null }} links
 */
function shouldInheritClaimedLinks(links) {
  return !links.motionId && !links.companyId && !links.prospectId;
}

/**
 * @param {unknown[]} rawObservations
 * @param {{
 *   accountId: string,
 *   capability: string,
 *   surfaceKey: string,
 *   actorHandle?: string | null,
 *   actorProfileUrl?: string | null,
 *   actorLinkedinPublicId?: string | null,
 *   actorLinkedinMemberId?: string | null,
 * }} input
 */
function resolveClaimedInboundObservationLinks(rawObservations, input) {
  const observations = parseInboundObservations(rawObservations);
  const claimed = observations
    .filter((candidate) =>
      candidate.motionId
      && candidate.companyId
      && candidate.prospectId
      && inboundObservationsSharePersonIdentity(candidate, input)
    )
    .sort((left, right) =>
      right.observedAt.localeCompare(left.observedAt)
      || right.recordedAt.localeCompare(left.recordedAt)
    );

  const winner = claimed[0] ?? null;
  if (!winner) {
    return null;
  }

  return {
    motionId: winner.motionId,
    companyId: winner.companyId,
    prospectId: winner.prospectId,
  };
}
