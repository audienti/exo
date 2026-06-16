// @ts-check

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveStatePaths } from "../db/paths.js";
import { inboundCueSchema, inboundObservationSchema, inboundSurfaceKeySchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

const policyScopeSchema = z.enum(["global", "local", "effective"]);
const policyKindSchema = z.enum([
  "ignore_identity",
  "unignore_identity",
  "hide_surface",
  "show_surface",
  "suppress_identity",
  "unsuppress_identity",
]);

const policyAccountSelectorSchema = z.object({
  providerAccountId: z.string().trim().min(1).nullable().default(null),
  capability: z.string().trim().min(1).nullable().default(null),
  handle: z.string().trim().min(1).nullable().default(null),
});

const policyPersonSelectorSchema = z.object({
  actorHandle: z.string().trim().min(1).nullable().default(null),
  actorLinkedinMemberId: z.string().trim().min(1).nullable().default(null),
  actorLinkedinPublicId: z.string().trim().min(1).nullable().default(null),
  actorProfileUrl: z.string().trim().min(1).nullable().default(null),
  threadUrl: z.string().trim().min(1).nullable().default(null),
});

const policySurfaceSelectorSchema = z.object({
  capability: z.string().trim().min(1),
  surfaceKey: inboundSurfaceKeySchema,
});

const policyEventSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  kind: policyKindSchema,
  reason: z.string().trim().min(1).nullable().default(null),
  account: policyAccountSelectorSchema.nullable().default(null),
  person: policyPersonSelectorSchema.nullable().default(null),
  surface: policySurfaceSelectorSchema.nullable().default(null),
}).superRefine((value, context) => {
  if (value.kind === "hide_surface" || value.kind === "show_surface") {
    if (!value.surface) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.kind} requires a surface selector.`,
      });
    }
    return;
  }

  if (!value.account && !value.person) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.kind} requires an account or person selector.`,
    });
  }
});

/**
 * @typedef {z.infer<typeof policyEventSchema>} PolicyEvent
 */

/**
 * @param {"global" | "local"} scope
 * @param {Omit<PolicyEvent, "id" | "createdAt"> & Partial<Pick<PolicyEvent, "id" | "createdAt">>} input
 * @param {{ statePaths?: ReturnType<typeof resolveStatePaths> | undefined }} [options]
 * @returns {PolicyEvent}
 */
export function appendPolicyEvent(scope, input, options = {}) {
  const normalizedScope = policyScopeSchema.exclude(["effective"]).parse(scope);
  const statePaths = options.statePaths ?? resolveStatePaths();
  const event = normalizePolicyEvent({
    id: input.id ?? crypto.randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    kind: input.kind,
    reason: input.reason ?? null,
    account: input.account ?? null,
    person: input.person ?? null,
    surface: input.surface ?? null,
  });
  const targetPath = getPolicyPathForScope(normalizedScope, statePaths);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.appendFileSync(targetPath, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

/**
 * @param {"global" | "local" | "effective"} scope
 * @param {{ statePaths?: ReturnType<typeof resolveStatePaths> | undefined }} [options]
 * @returns {Array<PolicyEvent & { scope?: "global" | "local" }>}
 */
export function listPolicyEvents(scope, options = {}) {
  const normalizedScope = policyScopeSchema.parse(scope);
  const statePaths = options.statePaths ?? resolveStatePaths();

  if (normalizedScope === "effective") {
    return [
      ...readPolicyEventsFile(statePaths.homePolicyPath).map((event) => ({ ...event, scope: "global" })),
      ...readPolicyEventsFile(statePaths.repoPolicyPath).map((event) => ({ ...event, scope: "local" })),
    ];
  }

  return readPolicyEventsFile(getPolicyPathForScope(normalizedScope, statePaths));
}

/**
 * @param {{
 *   globalEvents?: unknown[] | undefined,
 *   localEvents?: unknown[] | undefined,
 * }} input
 */
export function compileEffectivePolicy(input) {
  const globalEvents = (input.globalEvents ?? []).map((event) => normalizePolicyEvent(event));
  const localEvents = (input.localEvents ?? []).map((event) => normalizePolicyEvent(event));
  const globalIgnored = new Map();
  const globalSuppressed = new Map();
  const globalHidden = new Map();
  const localSuppressed = new Map();
  const localHidden = new Map();

  for (const event of globalEvents) {
    applyPolicyEvent(globalIgnored, globalSuppressed, globalHidden, event);
  }

  for (const event of localEvents) {
    applyPolicyEvent(null, localSuppressed, localHidden, event, { allowHide: true, allowIgnore: false });
  }

  return {
    global: {
      ignoredIdentities: [...globalIgnored.values()],
      suppressedIdentities: [...globalSuppressed.values()],
      hiddenSurfaces: [...globalHidden.values()],
    },
    local: {
      ignoredIdentities: [],
      suppressedIdentities: [...localSuppressed.values()],
      hiddenSurfaces: [...localHidden.values()],
    },
    effective: {
      ignoredIdentities: [...globalIgnored.values()],
      suppressedIdentities: [...globalSuppressed.values(), ...localSuppressed.values()],
      hiddenSurfaces: [...globalHidden.values(), ...localHidden.values()],
    },
    counts: {
      globalEventCount: globalEvents.length,
      localEventCount: localEvents.length,
      eventCount: globalEvents.length + localEvents.length,
    },
  };
}

/**
 * @param {unknown[]} observations
 * @param {unknown} rawUser
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 */
export function filterInboundObservationsForPolicy(observations, rawUser, effectivePolicy) {
  const hasIdentityPolicies = hasEffectiveIdentityPolicies(effectivePolicy);
  const hasHiddenSurfacePolicies = hasEffectiveHiddenSurfacePolicies(effectivePolicy);
  if (!hasIdentityPolicies && !hasHiddenSurfacePolicies) {
    return observations;
  }

  const user = hasIdentityPolicies ? userSchema.parse(rawUser) : null;
  const accountsById = user ? buildUserAccountIndex(user) : null;
  const filtered = [];

  for (const rawObservation of observations) {
    if (hasHiddenSurfacePolicies && matchesSurfaceAgainstPolicy(rawObservation, effectivePolicy)) {
      continue;
    }

    if (user && accountsById) {
      const observation = inboundObservationSchema.parse(rawObservation);
      if (matchesParsedObservationAgainstPolicy(observation, user, effectivePolicy, accountsById)) {
        continue;
      }
    }

    filtered.push(rawObservation);
  }

  return filtered;
}

/**
 * @param {unknown[]} cues
 * @param {unknown} rawUser
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 */
export function filterInboundCuesForPolicy(cues, rawUser, effectivePolicy) {
  const hasIdentityPolicies = hasEffectiveIdentityPolicies(effectivePolicy);
  const hasHiddenSurfacePolicies = hasEffectiveHiddenSurfacePolicies(effectivePolicy);
  if (!hasIdentityPolicies && !hasHiddenSurfacePolicies) {
    return cues;
  }

  const user = hasIdentityPolicies ? userSchema.parse(rawUser) : null;
  const accountsById = user ? buildUserAccountIndex(user) : null;
  const filtered = [];

  for (const rawCue of cues) {
    if (hasHiddenSurfacePolicies && matchesSurfaceAgainstPolicy(rawCue, effectivePolicy)) {
      continue;
    }

    if (user && accountsById) {
      const cue = inboundCueSchema.parse(rawCue);
      if (matchesCueAgainstPolicyWithUser(cue, user, effectivePolicy, accountsById)) {
        continue;
      }
    }

    filtered.push(rawCue);
  }

  return filtered;
}

/**
 * @param {unknown} rawObservation
 * @param {unknown} rawUser
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 */
export function matchesObservationAgainstPolicy(rawObservation, rawUser, effectivePolicy) {
  const observation = inboundObservationSchema.parse(rawObservation);
  const user = userSchema.parse(rawUser);
  return matchesParsedObservationAgainstPolicy(observation, user, effectivePolicy, buildUserAccountIndex(user));
}

/**
 * @param {unknown} rawUser
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 */
export function applyViewPolicyToUser(rawUser, effectivePolicy) {
  const user = userSchema.parse(rawUser);
  if (!hasEffectiveHiddenSurfacePolicies(effectivePolicy)) {
    return user;
  }

  return {
    ...user,
    accounts: user.accounts.map((account) => ({
      ...account,
      inboundSync: {
        ...account.inboundSync,
        surfaces: account.inboundSync.surfaces.map((surface) => (
          matchesHiddenSurface(account.capability, surface.surfaceKey, effectivePolicy)
            ? { ...surface, enabled: false }
            : surface
        )),
      },
    })),
  };
}

/**
 * @param {{ statePaths?: ReturnType<typeof resolveStatePaths> | undefined }} [options]
 */
export function loadEffectivePolicy(options = {}) {
  const statePaths = options.statePaths ?? resolveStatePaths();
  return compileEffectivePolicy({
    globalEvents: listPolicyEvents("global", { statePaths }),
    localEvents: listPolicyEvents("local", { statePaths }),
  });
}

/**
 * @param {unknown} rawEvent
 * @returns {PolicyEvent}
 */
function normalizePolicyEvent(rawEvent) {
  const normalized = policyEventSchema.parse(rawEvent);
  return {
    ...normalized,
    account: normalized.account ? normalizeAccountSelector(normalized.account) : null,
    person: normalized.person ? normalizePersonSelector(normalized.person) : null,
    surface: normalized.surface ? normalizeSurfaceSelector(normalized.surface) : null,
  };
}

/**
 * @param {"global" | "local"} scope
 * @param {ReturnType<typeof resolveStatePaths>} statePaths
 */
function getPolicyPathForScope(scope, statePaths) {
  return scope === "global" ? statePaths.homePolicyPath : statePaths.repoPolicyPath;
}

/**
 * @param {string} filePath
 * @returns {PolicyEvent[]}
 */
function readPolicyEventsFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizePolicyEvent(JSON.parse(line)));
}

/**
 * @param {Map<string, any> | null} ignored
 * @param {Map<string, any>} suppressed
 * @param {Map<string, any>} hidden
 * @param {PolicyEvent} event
 * @param {{ allowHide?: boolean | undefined, allowIgnore?: boolean | undefined }} [options]
 */
function applyPolicyEvent(ignored, suppressed, hidden, event, options = {}) {
  const allowHide = options.allowHide ?? true;
  const allowIgnore = options.allowIgnore ?? true;

  if ((event.kind === "hide_surface" || event.kind === "show_surface") && allowHide) {
    const key = surfaceSelectorKey(event.surface);
    if (!key) {
      return;
    }
    if (event.kind === "hide_surface") {
      hidden.set(key, event.surface);
    } else {
      hidden.delete(key);
    }
    return;
  }

  const key = identitySelectorKey(event.account, event.person);
  if (!key) {
    return;
  }

  if (event.kind === "ignore_identity" && allowIgnore && ignored) {
    ignored.set(key, buildIdentitySelector(event.account, event.person));
    return;
  }

  if (event.kind === "unignore_identity" && allowIgnore && ignored) {
    ignored.delete(key);
    return;
  }

  if (event.kind === "suppress_identity") {
    suppressed.set(key, buildIdentitySelector(event.account, event.person));
    return;
  }

  if (event.kind === "unsuppress_identity") {
    suppressed.delete(key);
  }
}

/**
 * @param {unknown} rawCue
 * @param {unknown} rawUser
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 */
function matchesCueAgainstPolicy(rawCue, rawUser, effectivePolicy) {
  const cue = inboundCueSchema.parse(rawCue);
  const user = userSchema.parse(rawUser);
  return matchesCueAgainstPolicyWithUser(cue, user, effectivePolicy, buildUserAccountIndex(user));
}

/**
 * @param {unknown} rawSurfaceCarrier
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 */
function matchesSurfaceAgainstPolicy(rawSurfaceCarrier, effectivePolicy) {
  const capability = normalizeNullableString(rawSurfaceCarrier?.capability);
  const surfaceKey = normalizeNullableString(rawSurfaceCarrier?.surfaceKey);
  if (!capability || !surfaceKey) {
    return false;
  }
  return matchesHiddenSurface(capability, surfaceKey, effectivePolicy);
}

/**
 * @param {string} capability
 * @param {string} surfaceKey
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 */
function matchesHiddenSurface(capability, surfaceKey, effectivePolicy) {
  const normalizedCapability = normalizeNullableString(capability);
  const normalizedSurfaceKey = normalizeNullableString(surfaceKey);
  if (!normalizedCapability || !normalizedSurfaceKey) {
    return false;
  }

  return effectivePolicy.effective.hiddenSurfaces.some((surface) =>
    surface.capability === normalizedCapability
    && surface.surfaceKey === normalizedSurfaceKey
  );
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 */
function buildUserAccountIndex(user) {
  return new Map(user.accounts.map((account) => [account.id, account]));
}

/**
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 */
function hasEffectiveIdentityPolicies(effectivePolicy) {
  return effectivePolicy.effective.ignoredIdentities.length > 0
    || effectivePolicy.effective.suppressedIdentities.length > 0;
}

/**
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 */
function hasEffectiveHiddenSurfacePolicies(effectivePolicy) {
  return effectivePolicy.effective.hiddenSurfaces.length > 0;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 * @param {Map<string, import("../schema/user.js").userConnectedAccountSchema._type>} accountsById
 */
function matchesParsedObservationAgainstPolicy(observation, user, effectivePolicy, accountsById) {
  const account = accountsById.get(observation.accountId) ?? null;
  return effectivePolicy.effective.ignoredIdentities.some((selector) => matchesIdentitySelector(selector, observation, account))
    || effectivePolicy.effective.suppressedIdentities.some((selector) => matchesIdentitySelector(selector, observation, account));
}

/**
 * @param {import("../schema/inbound.js").inboundCueSchema._type} cue
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {ReturnType<typeof compileEffectivePolicy>} effectivePolicy
 * @param {Map<string, import("../schema/user.js").userConnectedAccountSchema._type>} accountsById
 */
function matchesCueAgainstPolicyWithUser(cue, user, effectivePolicy, accountsById) {
  return matchesParsedObservationAgainstPolicy(
    buildCuePseudoObservation(cue),
    user,
    effectivePolicy,
    accountsById,
  );
}

/**
 * @param {import("../schema/inbound.js").inboundCueSchema._type} cue
 */
function buildCuePseudoObservation(cue) {
  return {
    ...cue,
    truthLevel: "authoritative",
    kind: "thread_updated",
    eventAt: null,
    externalId: null,
    actorName: null,
    actorTitle: null,
    actorCompanyName: null,
    actorHandle: null,
    actorProfileUrl: null,
    actorLinkedinPublicId: null,
    actorLinkedinMemberId: null,
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: null,
    sourceUrl: null,
    subject: null,
    notes: cue.notes ?? null,
    messages: [],
  };
}

/**
 * @param {ReturnType<typeof normalizeAccountSelector> | null} accountSelector
 * @param {ReturnType<typeof normalizePersonSelector> | null} personSelector
 */
function buildIdentitySelector(accountSelector, personSelector) {
  return {
    account: accountSelector,
    person: personSelector,
  };
}

/**
 * @param {ReturnType<typeof normalizeAccountSelector> | null} accountSelector
 * @param {ReturnType<typeof normalizePersonSelector> | null} personSelector
 */
function identitySelectorKey(accountSelector, personSelector) {
  const accountKey = accountSelector
    ? [
        accountSelector.providerAccountId ?? "",
        accountSelector.capability ?? "",
        accountSelector.handle ?? "",
      ].join("::")
    : "";
  const personKey = personSelector
    ? [
        personSelector.actorHandle ?? "",
        personSelector.actorLinkedinMemberId ?? "",
        personSelector.actorLinkedinPublicId ?? "",
        personSelector.actorProfileUrl ?? "",
        personSelector.threadUrl ?? "",
      ].join("::")
    : "";
  const key = `${accountKey}##${personKey}`;
  return key === "##" ? null : key;
}

/**
 * @param {ReturnType<typeof normalizeSurfaceSelector> | null} surface
 */
function surfaceSelectorKey(surface) {
  if (!surface) {
    return null;
  }
  return `${surface.capability}::${surface.surfaceKey}`;
}

/**
 * @param {{ account: ReturnType<typeof normalizeAccountSelector> | null, person: ReturnType<typeof normalizePersonSelector> | null }} selector
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {import("../schema/user.js").userConnectedAccountSchema._type | null} account
 */
function matchesIdentitySelector(selector, observation, account) {
  if (selector.account && !matchesAccountSelector(selector.account, observation, account)) {
    return false;
  }

  if (selector.person && !matchesPersonSelector(selector.person, observation)) {
    return false;
  }

  return true;
}

/**
 * @param {ReturnType<typeof normalizeAccountSelector>} selector
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {import("../schema/user.js").userConnectedAccountSchema._type | null} account
 */
function matchesAccountSelector(selector, observation, account) {
  if (selector.providerAccountId) {
    return selector.providerAccountId === normalizeNullableString(account?.providerAccountId);
  }

  if (selector.capability && selector.capability !== normalizeNullableString(observation.capability)) {
    return false;
  }

  if (selector.handle) {
    const accountHandle = normalizeNullableString(account?.handle) ?? normalizeNullableString(observation.actorHandle);
    return selector.handle === accountHandle;
  }

  return true;
}

/**
 * @param {ReturnType<typeof normalizePersonSelector>} selector
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
function matchesPersonSelector(selector, observation) {
  return Boolean(
    (selector.actorHandle && selector.actorHandle === normalizeEmailHandle(observation.actorHandle))
    || (selector.actorLinkedinMemberId && selector.actorLinkedinMemberId === normalizeNullableString(observation.actorLinkedinMemberId))
    || (selector.actorLinkedinPublicId && selector.actorLinkedinPublicId === normalizeNullableString(observation.actorLinkedinPublicId))
    || (selector.actorProfileUrl && selector.actorProfileUrl === normalizeProfileUrl(observation.actorProfileUrl))
    || (selector.threadUrl && selector.threadUrl === normalizeThreadUrl(observation.threadUrl))
  );
}

/**
 * @param {z.infer<typeof policyAccountSelectorSchema>} selector
 */
function normalizeAccountSelector(selector) {
  return {
    providerAccountId: normalizeNullableString(selector.providerAccountId),
    capability: normalizeNullableString(selector.capability),
    handle: normalizeNullableString(selector.handle),
  };
}

/**
 * @param {z.infer<typeof policyPersonSelectorSchema>} selector
 */
function normalizePersonSelector(selector) {
  return {
    actorHandle: normalizeEmailHandle(selector.actorHandle),
    actorLinkedinMemberId: normalizeNullableString(selector.actorLinkedinMemberId),
    actorLinkedinPublicId: normalizeNullableString(selector.actorLinkedinPublicId),
    actorProfileUrl: normalizeProfileUrl(selector.actorProfileUrl),
    threadUrl: normalizeThreadUrl(selector.threadUrl),
  };
}

/**
 * @param {z.infer<typeof policySurfaceSelectorSchema>} selector
 */
function normalizeSurfaceSelector(selector) {
  return {
    capability: normalizeNullableString(selector.capability),
    surfaceKey: selector.surfaceKey,
  };
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeEmailHandle(value) {
  const normalized = normalizeNullableString(value);
  return normalized ? normalized.toLowerCase() : null;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeProfileUrl(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }

  return normalized
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/**
 * Thread URLs can carry their stable identity in the fragment, especially for
 * Gmail (`#all/<thread-id>`). Do not strip fragments here or unrelated inbox
 * threads collapse to the same mailbox root.
 *
 * @param {string | null | undefined} value
 */
function normalizeThreadUrl(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    const hash = parsed.hash ? parsed.hash.toLowerCase() : "";
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase().replace(/^www\./, "")}${pathname}${hash}`;
  } catch {
    return normalized.toLowerCase();
  }
}
