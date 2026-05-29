// @ts-check

import { browserProfileCapabilitySchema } from "../schema/browser-profile.js";
import { userSchema } from "../schema/user.js";
import { inboundSyncRunStatusSchema, inboundSurfaceStateSchema } from "../schema/inbound.js";
import { findInboundSurfaceDefinition, listInboundSurfaceCatalog } from "../lib/inbound-surface-catalog.js";

/**
 * @param {unknown} rawUser
 * @param {{
 *   capability?: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type | null
 * }} [options]
 */
export function buildUserInboundSyncView(rawUser, options = {}) {
  const user = userSchema.parse(rawUser);
  const capability = options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null;
  const accounts = user.accounts
    .filter((account) => !capability || account.capability === capability)
    .map((account) => buildAccountInboundView(account));

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    counts: {
      accountCount: accounts.length,
      enabledSurfaceCount: accounts.reduce((sum, account) => sum + account.enabledSurfaceCount, 0),
      staleSurfaceCount: accounts.reduce((sum, account) => sum + account.staleSurfaceCount, 0),
      failedSurfaceCount: accounts.reduce((sum, account) => sum + account.failedSurfaceCount, 0)
    },
    accounts
  };
}

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId: string,
 *   enableSurfaceKeys?: string[],
 *   disableSurfaceKeys?: string[]
 * }} input
 */
export function setUserInboundSyncPolicy(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const now = new Date().toISOString();
  const account = user.accounts.find((candidate) => candidate.id === input.accountId);

  if (!account) {
    throw new Error(`User account not found: ${input.accountId}`);
  }

  const allowedSurfaces = listInboundSurfaceCatalog({ capability: account.capability }).map((surface) => surface.key);
  const enabledKeys = normalizeSurfaceKeys(input.enableSurfaceKeys ?? [], allowedSurfaces, account.capability);
  const disabledKeys = normalizeSurfaceKeys(input.disableSurfaceKeys ?? [], allowedSurfaces, account.capability);
  const nextSurfaceKeys = new Set([...enabledKeys, ...disabledKeys]);
  const currentStates = materializeSurfaceStates(account);

  const nextAccounts = user.accounts.map((candidate) => {
    if (candidate.id !== input.accountId) {
      return candidate;
    }

    const surfaces = currentStates.map((surface) => {
      if (enabledKeys.includes(surface.surfaceKey)) {
        return inboundSurfaceStateSchema.parse({ ...surface, enabled: true });
      }

      if (disabledKeys.includes(surface.surfaceKey)) {
        return inboundSurfaceStateSchema.parse({ ...surface, enabled: false });
      }

      return surface;
    });

    for (const surfaceKey of nextSurfaceKeys) {
      if (surfaces.some((surface) => surface.surfaceKey === surfaceKey)) {
        continue;
      }

      surfaces.push(inboundSurfaceStateSchema.parse({
        surfaceKey,
        enabled: enabledKeys.includes(surfaceKey)
      }));
    }

    return {
      ...candidate,
      updatedAt: now,
      inboundSync: {
        surfaces
      }
    };
  });

  return userSchema.parse({
    ...user,
    updatedAt: now,
    accounts: nextAccounts
  });
}

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId: string,
 *   surfaceKey: string,
 *   status: "never" | "success" | "warning" | "failed",
 *   observedAt?: string | null,
 *   itemCount?: number | null,
 *   error?: string | null
 * }} input
 */
export function recordUserInboundSyncRun(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const now = new Date().toISOString();
  const account = user.accounts.find((candidate) => candidate.id === input.accountId);

  if (!account) {
    throw new Error(`User account not found: ${input.accountId}`);
  }

  const definition = findInboundSurfaceDefinition(input.surfaceKey);
  if (!definition) {
    throw new Error(`Inbound surface not found: ${input.surfaceKey}`);
  }

  if (definition.capability !== account.capability) {
    throw new Error(`Inbound surface ${definition.key} does not apply to capability ${account.capability}.`);
  }

  const status = inboundSyncRunStatusSchema.parse(input.status);
  const currentStates = materializeSurfaceStates(account);

  const nextAccounts = user.accounts.map((candidate) => {
    if (candidate.id !== input.accountId) {
      return candidate;
    }

    const surfaces = currentStates.map((surface) => {
      if (surface.surfaceKey !== definition.key) {
        return surface;
      }

      return inboundSurfaceStateSchema.parse({
        ...surface,
        enabled: true,
        lastSyncedAt: now,
        lastObservedAt: input.observedAt ?? surface.lastObservedAt,
        lastRunStatus: status,
        lastItemCount: input.itemCount ?? surface.lastItemCount,
        lastError: status === "failed"
          ? normalizeNullableString(input.error) ?? surface.lastError
          : status === "warning"
            ? normalizeNullableString(input.error) ?? surface.lastError
            : null
      });
    });

    if (!surfaces.some((surface) => surface.surfaceKey === definition.key)) {
      surfaces.push(inboundSurfaceStateSchema.parse({
        surfaceKey: definition.key,
        enabled: true,
        lastSyncedAt: now,
        lastObservedAt: input.observedAt ?? null,
        lastRunStatus: status,
        lastItemCount: input.itemCount ?? null,
        lastError: status === "failed" || status === "warning" ? normalizeNullableString(input.error) : null
      }));
    }

    return {
      ...candidate,
      updatedAt: now,
      inboundSync: {
        surfaces
      }
    };
  });

  return userSchema.parse({
    ...user,
    updatedAt: now,
    accounts: nextAccounts
  });
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function buildAccountInboundView(account) {
  const surfaces = materializeSurfaceStates(account).map((state) => {
    const definition = findInboundSurfaceDefinition(state.surfaceKey);
    if (!definition) {
      return null;
    }

    return {
      key: definition.key,
      label: definition.label,
      summary: definition.summary,
      truthLevel: definition.truthLevel,
      retrievalMode: definition.retrievalMode,
      observationKinds: definition.observationKinds,
      enabled: state.enabled,
      lastRunStatus: state.lastRunStatus,
      lastSyncedAt: state.lastSyncedAt,
      lastObservedAt: state.lastObservedAt,
      lastItemCount: state.lastItemCount,
      lastError: state.lastError
    };
  }).filter(Boolean);

  return {
    accountId: account.id,
    capability: account.capability,
    handle: account.handle,
    label: account.label,
    preferred: account.preferred,
    sourceType: account.sourceType,
    enabledSurfaceCount: surfaces.filter((surface) => surface.enabled).length,
    staleSurfaceCount: surfaces.filter((surface) => surface.enabled && surface.lastRunStatus === "never").length,
    failedSurfaceCount: surfaces.filter((surface) => surface.lastRunStatus === "failed").length,
    surfaces
  };
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function materializeSurfaceStates(account) {
  const catalog = listInboundSurfaceCatalog({ capability: account.capability });
  const configuredStates = new Map((account.inboundSync?.surfaces ?? []).map((surface) => [surface.surfaceKey, surface]));

  return catalog.map((definition) =>
    inboundSurfaceStateSchema.parse({
      surfaceKey: definition.key,
      enabled: configuredStates.get(definition.key)?.enabled ?? definition.defaultEnabled,
      lastSyncedAt: configuredStates.get(definition.key)?.lastSyncedAt ?? null,
      lastObservedAt: configuredStates.get(definition.key)?.lastObservedAt ?? null,
      lastRunStatus: configuredStates.get(definition.key)?.lastRunStatus ?? "never",
      lastItemCount: configuredStates.get(definition.key)?.lastItemCount ?? null,
      lastError: configuredStates.get(definition.key)?.lastError ?? null
    })
  );
}

/**
 * @param {string[]} surfaceKeys
 * @param {string[]} allowedSurfaces
 * @param {string} capability
 */
function normalizeSurfaceKeys(surfaceKeys, allowedSurfaces, capability) {
  const normalized = [...new Set(surfaceKeys.map((surfaceKey) => surfaceKey.trim().toLowerCase()).filter(Boolean))];

  for (const surfaceKey of normalized) {
    if (!allowedSurfaces.includes(surfaceKey)) {
      throw new Error(`Inbound surface ${surfaceKey} does not apply to capability ${capability}.`);
    }
  }

  return normalized;
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
