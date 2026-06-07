// @ts-check

import { probeRuntimeConnectorAvailability } from "./probe-user-harness-connections.js";
import { upsertUserConnectedAccount, upsertUserHarnessConnection } from "./upsert-user-harness-connection.js";
import { browserProfileCapabilitySchema } from "../schema/browser-profile.js";
import { userSchema } from "../schema/user.js";

/**
 * Persist one harness-backed connected account onto an execution user.
 *
 * @param {unknown} rawUser
 * @param {{
 *   capability: string,
 *   handle: string,
 *   runtime: string,
 *   connector: string,
 *   providerAccountId?: string | null | undefined,
 *   label?: string | null | undefined,
 *   preferred?: boolean | null | undefined,
 *   metadata?: Record<string, unknown> | null | undefined,
 *   notes?: string | null | undefined,
 *   codexHome?: string | null | undefined,
 *   claudeCli?: string | null | undefined
 * }} input
 */
export function claimUserRuntimeAccount(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const capability = browserProfileCapabilitySchema.parse(input.capability);
  const handle = normalizeRequiredString(input.handle, "Claiming a runtime account requires a handle.");
  const runtime = normalizeRequiredString(input.runtime, "Claiming a runtime account requires a runtime.");
  const connector = normalizeRequiredString(input.connector, "Claiming a runtime account requires a connector.");

  const probe = probeRuntimeConnectorAvailability(runtime, connector, {
    codexHome: input.codexHome ?? null,
    claudeCli: input.claudeCli ?? null,
  });
  if (probe.detectedStatus !== "available") {
    throw new Error(`Managed ${capability} is not currently available through ${runtime}:${connector}.`);
  }

  let updatedUser = upsertUserHarnessConnection(user, {
    runtime,
    connector,
    status: probe.detectedStatus,
  });
  const harnessConnection = updatedUser.harnessConnections.find(
    (connection) =>
      connection.runtime.trim().toLowerCase() === runtime.toLowerCase()
      && connection.connector.trim().toLowerCase() === connector.toLowerCase(),
  );
  if (!harnessConnection) {
    throw new Error(`Failed to persist harness connection ${runtime}:${connector}.`);
  }

  updatedUser = upsertUserConnectedAccount(updatedUser, {
    capability,
    handle,
    label: normalizeNullableString(input.label) ?? null,
    harnessConnectionId: harnessConnection.id,
    providerAccountId: normalizeNullableString(input.providerAccountId) ?? null,
    preferred: normalizeBoolean(input.preferred),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : null,
    notes: normalizeNullableString(input.notes) ?? null,
  });
  const account = updatedUser.accounts.find(
    (candidate) =>
      candidate.capability === capability
      && candidate.sourceType === "harness-connection"
      && candidate.harnessConnectionId === harnessConnection.id
      && (normalizeNullableString(input.providerAccountId)
        ? candidate.providerAccountId === normalizeNullableString(input.providerAccountId)
        : true),
  );
  if (!account) {
    throw new Error(`Failed to persist managed ${capability} account for ${runtime}:${connector}.`);
  }

  return {
    updatedUser,
    harnessConnection,
    account,
    probe,
  };
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
 * @param {boolean | null | undefined} value
 */
function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}
