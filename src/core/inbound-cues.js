// @ts-check

import crypto from "node:crypto";
import {
  inboundCueKindSchema,
  inboundCueSchema,
  inboundCueSourceSchema,
  inboundCueStatusSchema,
  inboundSurfaceKeySchema
} from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId?: string | null,
 *   capability?: string | null,
 *   surfaceKey: string,
 *   kind: string,
 *   source?: string | null,
 *   observedAt: string,
 *   summary: string,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null,
 *   notes?: string | null
 * }} input
 * @param {{ existingCue?: unknown | null }} [options]
 */
export function recordInboundCue(rawUser, input, options = {}) {
  const user = userSchema.parse(rawUser);
  const account = resolveCueAccount(user, {
    accountId: input.accountId ?? null,
    capability: input.capability ?? null
  });
  const surfaceKey = inboundSurfaceKeySchema.parse(input.surfaceKey);
  const kind = inboundCueKindSchema.parse(input.kind);
  const source = inboundCueSourceSchema.parse(input.source ?? "manual_hint");
  const now = new Date().toISOString();
  const existing = options.existingCue ? inboundCueSchema.parse(options.existingCue) : null;

  return inboundCueSchema.parse({
    id: existing?.id ?? crypto.randomUUID(),
    dedupeKey: buildInboundCueDedupeKey(account.id, surfaceKey, kind),
    userId: user.id,
    accountId: account.id,
    capability: account.capability,
    platform: platformForCapability(account.capability),
    surfaceKey,
    kind,
    source,
    status: "open",
    observedAt: input.observedAt,
    recordedAt: now,
    resolvedAt: null,
    summary: input.summary,
    motionId: normalizeNullableString(input.motionId),
    companyId: normalizeNullableString(input.companyId),
    prospectId: normalizeNullableString(input.prospectId),
    notes: normalizeNullableString(input.notes)
  });
}

/**
 * @param {unknown} rawCue
 * @param {{ status?: string | null }} [input]
 */
export function resolveInboundCue(rawCue, input = {}) {
  const cue = inboundCueSchema.parse(rawCue);
  const nextStatus = inboundCueStatusSchema.parse(input.status ?? "resolved");
  if (nextStatus === "open") {
    throw new Error("Inbound cue resolution cannot leave the cue open.");
  }

  return inboundCueSchema.parse({
    ...cue,
    status: nextStatus,
    resolvedAt: new Date().toISOString()
  });
}

/**
 * @param {unknown[]} rawCues
 * @param {{
 *   userId?: string | null,
 *   accountId?: string | null,
 *   capability?: string | null,
 *   status?: string | null,
 *   motionId?: string | null,
 *   companyId?: string | null,
 *   prospectId?: string | null
 * }} [filters]
 */
export function buildInboundCueListView(rawCues, filters = {}) {
  const statusFilter = filters.status ? inboundCueStatusSchema.parse(filters.status) : null;
  const cues = rawCues
    .map((cue) => inboundCueSchema.parse(cue))
    .filter((cue) =>
      (!filters.userId || cue.userId === filters.userId)
      && (!filters.accountId || cue.accountId === filters.accountId)
      && (!filters.capability || cue.capability === filters.capability)
      && (!statusFilter || cue.status === statusFilter)
      && (!filters.motionId || cue.motionId === filters.motionId)
      && (!filters.companyId || cue.companyId === filters.companyId)
      && (!filters.prospectId || cue.prospectId === filters.prospectId)
    )
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt));

  return {
    counts: {
      cueCount: cues.length,
      openCount: cues.filter((cue) => cue.status === "open").length,
      resolvedCount: cues.filter((cue) => cue.status === "resolved").length,
      dismissedCount: cues.filter((cue) => cue.status === "dismissed").length
    },
    cues
  };
}

/**
 * @param {string} accountId
 * @param {string} surfaceKey
 * @param {string} kind
 */
export function buildInboundCueDedupeKey(accountId, surfaceKey, kind) {
  return `${accountId}:${surfaceKey}:${kind}`;
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {{ accountId: string | null, capability: string | null }} input
 */
function resolveCueAccount(user, input) {
  if (input.accountId) {
    const account = user.accounts.find((candidate) => candidate.id === input.accountId);
    if (!account) {
      throw new Error(`User account not found: ${input.accountId}`);
    }
    return account;
  }

  if (!input.capability) {
    throw new Error("Inbound cues require either --account or --capability.");
  }

  const matchingAccounts = user.accounts.filter((candidate) => candidate.capability === input.capability);
  if (!matchingAccounts.length) {
    throw new Error(`No ${input.capability} account exists on user ${user.id}.`);
  }

  return matchingAccounts.find((candidate) => candidate.preferred) ?? matchingAccounts[0];
}

/**
 * @param {string} capability
 */
function platformForCapability(capability) {
  switch (capability) {
    case "gmail":
      return "gmail";
    case "linkedin":
      return "linkedin";
    default:
      return capability;
  }
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
