// @ts-check

import crypto from "node:crypto";
import { browserProfileCapabilitySchema } from "../schema/browser-profile.js";
import { inboundObservationKindSchema, inboundObservationSchema, inboundSurfaceKeySchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { findInboundSurfaceDefinition } from "../lib/inbound-surface-catalog.js";
import { resolveInboundObservationLinks } from "./resolve-inbound-observation-links.js";

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId: string,
 *   surfaceKey: string,
 *   kind: string,
 *   observedAt: string,
 *   summary: string,
 *   externalId?: string | null,
 *   actorName?: string | null,
 *   actorTitle?: string | null,
 *   actorCompanyName?: string | null,
 *   actorHandle?: string | null,
 *   actorProfileUrl?: string | null,
 *   threadUrl?: string | null,
 *   sourceUrl?: string | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   notes?: string | null
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

  const resolvedLinks = resolveInboundObservationLinks(options.rawMotions ?? [], {
    motionId: input.motionId,
    companyId: input.companyId,
    prospectId: input.prospectId,
    actorHandle: input.actorHandle,
    actorProfileUrl: input.actorProfileUrl
  });
  const now = new Date().toISOString();
  const normalizedExternalId = normalizeNullableString(input.externalId);
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
    externalId: normalizedExternalId,
    actorName: normalizeNullableString(input.actorName),
    actorTitle: normalizeNullableString(input.actorTitle),
    actorCompanyName: normalizeNullableString(input.actorCompanyName),
    actorHandle: normalizeNullableString(input.actorHandle),
    actorProfileUrl: normalizeNullableString(input.actorProfileUrl),
    threadUrl: normalizeNullableString(input.threadUrl),
    sourceUrl: normalizeNullableString(input.sourceUrl),
    summary: input.summary.trim(),
    motionId: resolvedLinks.motionId,
    companyId: resolvedLinks.companyId,
    prospectId: resolvedLinks.prospectId,
    notes: normalizeNullableString(input.notes)
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
  if (existing.dedupeKey !== nextObservation.dedupeKey) {
    return nextObservation;
  }

  return inboundObservationSchema.parse({
    ...existing,
    ...nextObservation,
    id: existing.id,
    actorName: nextObservation.actorName ?? existing.actorName,
    actorTitle: nextObservation.actorTitle ?? existing.actorTitle,
    actorCompanyName: nextObservation.actorCompanyName ?? existing.actorCompanyName,
    actorHandle: nextObservation.actorHandle ?? existing.actorHandle,
    actorProfileUrl: nextObservation.actorProfileUrl ?? existing.actorProfileUrl,
    threadUrl: nextObservation.threadUrl ?? existing.threadUrl,
    sourceUrl: nextObservation.sourceUrl ?? existing.sourceUrl,
    motionId: nextObservation.motionId ?? existing.motionId,
    companyId: nextObservation.companyId ?? existing.companyId,
    prospectId: nextObservation.prospectId ?? existing.prospectId,
    notes: nextObservation.notes ?? existing.notes
  });
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
