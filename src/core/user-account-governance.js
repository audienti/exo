// @ts-check

import crypto from "node:crypto";
import { userManagedAccountExclusionSchema, userSchema } from "../schema/user.js";

/**
 * @param {unknown} rawUser
 * @param {{
 *   runtime: string,
 *   connector: string,
 *   capability: string,
 *   providerAccountId?: string | null,
 *   handle?: string | null,
 *   label?: string | null,
 *   notes?: string | null,
 * }} input
 */
export function upsertManagedAccountExclusion(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const now = new Date().toISOString();
  const runtime = normalizeRequiredString(input.runtime, "Managed account exclusions require runtime.");
  const connector = normalizeRequiredString(input.connector, "Managed account exclusions require connector.");
  const capability = normalizeRequiredString(input.capability, "Managed account exclusions require capability.");
  const providerAccountId = normalizeNullableString(input.providerAccountId);
  const handle = normalizeNullableString(input.handle);
  if (!providerAccountId && !handle) {
    throw new Error("Managed account exclusions require --provider-account-id or --handle.");
  }

  const existing = (user.managedAccountExclusions ?? []).find((candidate) =>
    managedAccountExclusionMatches(candidate, {
      runtime,
      connector,
      capability,
      providerAccountId,
      handle,
    })
  ) ?? null;

  const exclusion = userManagedAccountExclusionSchema.parse({
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    runtime,
    connector,
    capability,
    providerAccountId,
    handle,
    label: normalizeNullableString(input.label) ?? existing?.label ?? null,
    notes: normalizeNullableString(input.notes) ?? existing?.notes ?? null,
  });

  return userSchema.parse({
    ...user,
    updatedAt: now,
    managedAccountExclusions: upsertById(user.managedAccountExclusions ?? [], exclusion),
  });
}

/**
 * @param {unknown} rawUser
 * @param {string} exclusionId
 */
export function removeManagedAccountExclusion(rawUser, exclusionId) {
  const user = userSchema.parse(rawUser);
  const normalizedExclusionId = normalizeRequiredString(exclusionId, "Managed account exclusion id is required.");
  const nextExclusions = (user.managedAccountExclusions ?? []).filter((candidate) => candidate.id !== normalizedExclusionId);
  if (nextExclusions.length === (user.managedAccountExclusions ?? []).length) {
    throw new Error(`Managed account exclusion not found: ${normalizedExclusionId}`);
  }
  return userSchema.parse({
    ...user,
    updatedAt: new Date().toISOString(),
    managedAccountExclusions: nextExclusions,
  });
}

/**
 * @param {unknown} rawUser
 * @param {string} accountId
 * @param {{ excludeManagedIdentity?: boolean }} [options]
 */
export function removeUserConnectedAccount(rawUser, accountId, options = {}) {
  const user = userSchema.parse(rawUser);
  const normalizedAccountId = normalizeRequiredString(accountId, "Account id is required.");
  const account = user.accounts.find((candidate) => candidate.id === normalizedAccountId) ?? null;
  if (!account) {
    throw new Error(`Connected account not found: ${normalizedAccountId}`);
  }

  let nextUser = userSchema.parse({
    ...user,
    updatedAt: new Date().toISOString(),
    accounts: user.accounts.filter((candidate) => candidate.id !== normalizedAccountId),
  });
  let exclusion = null;

  if (options.excludeManagedIdentity && account.sourceType === "harness-connection") {
    const harnessConnection = user.harnessConnections.find((candidate) => candidate.id === account.harnessConnectionId) ?? null;
    if (!harnessConnection) {
      throw new Error(`Cannot exclude removed managed account ${normalizedAccountId} because its harness connection is missing.`);
    }
    nextUser = upsertManagedAccountExclusion(nextUser, {
      runtime: harnessConnection.runtime,
      connector: harnessConnection.connector,
      capability: account.capability,
      providerAccountId: account.providerAccountId ?? null,
      handle: account.handle,
      label: account.label ?? null,
      notes: account.notes ?? null,
    });
    exclusion = nextUser.managedAccountExclusions.find((candidate) =>
      managedAccountExclusionMatches(candidate, {
        runtime: harnessConnection.runtime,
        connector: harnessConnection.connector,
        capability: account.capability,
        providerAccountId: account.providerAccountId ?? null,
        handle: account.handle,
      })
    ) ?? null;
  }

  return {
    updatedUser: nextUser,
    removedAccount: account,
    exclusion,
  };
}

/**
 * @param {unknown} rawUser
 * @param {{
 *   runtime: string,
 *   connector: string,
 *   capability: string,
 *   providerAccountId?: string | null,
 *   handle?: string | null,
 * }} input
 */
export function isManagedAccountExcluded(rawUser, input) {
  const user = userSchema.parse(rawUser);
  return (user.managedAccountExclusions ?? []).some((candidate) => managedAccountExclusionMatches(candidate, input));
}

/**
 * @param {unknown} rawUser
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {import("../schema/user.js").userHarnessConnectionSchema._type | null | undefined} harnessConnection
 */
export function isStoredManagedAccountExcluded(rawUser, account, harnessConnection) {
  if (account.sourceType !== "harness-connection" || !harnessConnection) {
    return false;
  }
  return isManagedAccountExcluded(rawUser, {
    runtime: harnessConnection.runtime,
    connector: harnessConnection.connector,
    capability: account.capability,
    providerAccountId: account.providerAccountId ?? null,
    handle: account.handle,
  });
}

/**
 * @param {import("../schema/user.js").userManagedAccountExclusionSchema._type} exclusion
 * @param {{
 *   runtime: string,
 *   connector: string,
 *   capability: string,
 *   providerAccountId?: string | null,
 *   handle?: string | null,
 * }} input
 */
function managedAccountExclusionMatches(exclusion, input) {
  const runtime = normalizeNullableString(input.runtime);
  const connector = normalizeNullableString(input.connector);
  const capability = normalizeNullableString(input.capability);
  const providerAccountId = normalizeNullableString(input.providerAccountId);
  const handle = normalizeNullableString(input.handle);
  if (
    !runtime
    || !connector
    || !capability
    || exclusion.runtime.trim().toLowerCase() !== runtime
    || exclusion.connector.trim().toLowerCase() !== connector
    || exclusion.capability.trim().toLowerCase() !== capability
  ) {
    return false;
  }

  const excludedProviderAccountId = normalizeNullableString(exclusion.providerAccountId);
  if (excludedProviderAccountId && providerAccountId && excludedProviderAccountId === providerAccountId) {
    return true;
  }

  const excludedHandle = normalizeNullableString(exclusion.handle);
  return Boolean(excludedHandle && handle && excludedHandle === handle);
}

/**
 * @template T extends { id: string }
 * @param {T[]} items
 * @param {T} item
 */
function upsertById(items, item) {
  const existingIndex = items.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex === -1) {
    return [...items, item];
  }
  return items.map((candidate, index) => (index === existingIndex ? item : candidate));
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized.length ? normalized : null;
}

/**
 * @param {string | null | undefined} value
 * @param {string} message
 */
function normalizeRequiredString(value, message) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}
