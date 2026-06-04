// @ts-check

import crypto from "node:crypto";
import { inboundIgnoreRuleSchema } from "../schema/inbound-ignore.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId: string,
 *   capability: string,
 *   surfaceKey?: string | null,
 *   actorHandle?: string | null,
 *   externalId?: string | null,
 *   threadUrl?: string | null,
 *   reason?: string | null,
 * }} input
 */
export function addInboundIgnoreRule(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const now = new Date().toISOString();
  const candidate = inboundIgnoreRuleSchema.parse({
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    accountId: input.accountId,
    capability: input.capability,
    surfaceKey: normalizeNullableString(input.surfaceKey),
    actorHandle: normalizeEmailHandle(input.actorHandle),
    externalId: normalizeNullableString(input.externalId),
    threadUrl: normalizeNullableString(input.threadUrl),
    reason: normalizeNullableString(input.reason),
  });

  if (!candidate.actorHandle && !candidate.externalId && !candidate.threadUrl) {
    throw new Error("Inbound ignore rules require actorHandle, externalId, or threadUrl.");
  }

  const existing = (user.inboundIgnoreRules ?? []).find((rule) => sameIgnoreRule(rule, candidate)) ?? null;
  if (existing) {
    const refreshed = inboundIgnoreRuleSchema.parse({
      ...existing,
      updatedAt: now,
      reason: candidate.reason ?? existing.reason ?? null,
    });
    return {
      rule: refreshed,
      updatedUser: userSchema.parse({
        ...user,
        updatedAt: now,
        inboundIgnoreRules: upsertRule(user.inboundIgnoreRules ?? [], refreshed),
      }),
      created: false,
    };
  }

  return {
    rule: candidate,
    updatedUser: userSchema.parse({
      ...user,
      updatedAt: now,
      inboundIgnoreRules: [...(user.inboundIgnoreRules ?? []), candidate],
    }),
    created: true,
  };
}

/**
 * @param {unknown} rawUser
 * @param {unknown} rawObservation
 */
export function matchesAnyInboundIgnoreRule(rawUser, rawObservation) {
  const user = userSchema.parse(rawUser);
  const observation = inboundObservationSchema.parse(rawObservation);
  return (user.inboundIgnoreRules ?? []).some((rule) => matchesInboundIgnoreRule(rule, observation));
}

/**
 * @param {unknown} rawRule
 * @param {unknown} rawObservation
 */
export function matchesInboundIgnoreRule(rawRule, rawObservation) {
  const rule = inboundIgnoreRuleSchema.parse(rawRule);
  const observation = inboundObservationSchema.parse(rawObservation);
  if (rule.accountId !== observation.accountId || rule.capability !== observation.capability) {
    return false;
  }
  if (rule.surfaceKey && rule.surfaceKey !== observation.surfaceKey) {
    return false;
  }

  const actorHandle = normalizeEmailHandle(observation.actorHandle);
  const threadUrl = normalizeNullableString(observation.threadUrl);
  const externalId = normalizeNullableString(observation.externalId);

  return Boolean(
    (rule.actorHandle && actorHandle && rule.actorHandle === actorHandle)
    || (rule.externalId && externalId && rule.externalId === externalId)
    || (rule.threadUrl && threadUrl && rule.threadUrl === threadUrl)
  );
}

/**
 * @param {import("../schema/inbound-ignore.js").inboundIgnoreRuleSchema._type[]} rules
 * @param {import("../schema/inbound-ignore.js").inboundIgnoreRuleSchema._type} nextRule
 */
function upsertRule(rules, nextRule) {
  let replaced = false;
  const updated = rules.map((rule) => {
    if (!sameIgnoreRule(rule, nextRule)) {
      return rule;
    }
    replaced = true;
    return nextRule;
  });
  return replaced ? updated : [...updated, nextRule];
}

/**
 * @param {import("../schema/inbound-ignore.js").inboundIgnoreRuleSchema._type} left
 * @param {import("../schema/inbound-ignore.js").inboundIgnoreRuleSchema._type} right
 */
function sameIgnoreRule(left, right) {
  return left.accountId === right.accountId
    && left.capability === right.capability
    && (left.surfaceKey ?? null) === (right.surfaceKey ?? null)
    && normalizeEmailHandle(left.actorHandle) === normalizeEmailHandle(right.actorHandle)
    && (left.externalId ?? null) === (right.externalId ?? null)
    && (left.threadUrl ?? null) === (right.threadUrl ?? null);
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
 * @param {string | null | undefined} value
 */
function normalizeEmailHandle(value) {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}
