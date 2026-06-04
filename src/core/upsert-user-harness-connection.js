// @ts-check

import crypto from "node:crypto";
import { browserProfileAutomationControlsSchema } from "../schema/browser-profile.js";
import { userHarnessConnectionSchema, userSchema } from "../schema/user.js";
import { listInboundSurfaceCatalog } from "../lib/inbound-surface-catalog.js";

/**
 * @param {unknown} rawUser
 * @param {{
 *   runtime: string,
 *   connector: string,
 *   label?: string | null,
 *   status?: "available" | "unavailable" | "unknown" | null,
 *   notes?: string | null
 * }} input
 */
export function upsertUserHarnessConnection(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const now = new Date().toISOString();

  const existing = user.harnessConnections.find(
    (connection) =>
      connection.runtime.toLowerCase() === input.runtime.trim().toLowerCase()
      && connection.connector.toLowerCase() === input.connector.trim().toLowerCase()
  );

  const connection = userHarnessConnectionSchema.parse({
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    runtime: input.runtime,
    connector: input.connector,
    label: normalizeNullableString(input.label) ?? existing?.label ?? null,
    status: input.status ?? existing?.status ?? "unknown",
    notes: normalizeNullableString(input.notes) ?? existing?.notes ?? null
  });

  return userSchema.parse({
    ...user,
    updatedAt: now,
    harnessConnections: upsertById(user.harnessConnections, connection)
  });
}

/**
 * @param {unknown} rawUser
 * @param {{
 *   capability: string,
 *   handle: string,
 *   label?: string | null,
 *   browserProfileId?: string | null,
 *   harnessConnectionId?: string | null,
 *   providerAccountId?: string | null,
 *   preferred?: boolean | null,
 *   automationControls?: {
 *     weeklyQuotas?: {
 *       profileVisits?: number | null,
 *       invitations?: number | null,
 *       messages?: number | null
 *     }
 *   } | null,
 *   notes?: string | null
 * }} input
 */
export function upsertUserConnectedAccount(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const now = new Date().toISOString();
  const sourceType = input.browserProfileId ? "browser-profile" : "harness-connection";
  const match = user.accounts.find((account) => {
    if (input.browserProfileId) {
      return account.capability === input.capability && account.browserProfileId === input.browserProfileId;
    }

    if (input.providerAccountId) {
      return account.capability === input.capability && account.providerAccountId === input.providerAccountId;
    }

    return account.capability === input.capability && account.harnessConnectionId === input.harnessConnectionId;
  });

  const nextAccounts = user.accounts.map((account) => {
    if (account.capability !== input.capability) {
      return account;
    }

    if (input.preferred) {
      return {
        ...account,
        preferred: false
      };
    }

    return account;
  });

  const currentAutomationControls = browserProfileAutomationControlsSchema.parse(match?.automationControls ?? {});
  const nextAccount = {
    id: match?.id ?? crypto.randomUUID(),
    createdAt: match?.createdAt ?? now,
    updatedAt: now,
    capability: input.capability,
    handle: input.handle,
    label: normalizeNullableString(input.label) ?? match?.label ?? null,
    sourceType,
    browserProfileId: input.browserProfileId ?? null,
    harnessConnectionId: input.harnessConnectionId ?? null,
    providerAccountId: input.providerAccountId ?? match?.providerAccountId ?? null,
    preferred: input.preferred ?? match?.preferred ?? false,
    automationControls: browserProfileAutomationControlsSchema.parse({
      ...currentAutomationControls,
      ...(input.automationControls ?? {}),
      weeklyQuotas: {
        ...currentAutomationControls.weeklyQuotas,
        ...(input.automationControls?.weeklyQuotas ?? {})
      }
    }),
    notes: normalizeNullableString(input.notes) ?? match?.notes ?? null,
    inboundSync: match?.inboundSync ?? {
      surfaces: listInboundSurfaceCatalog({ capability: input.capability })
        .filter((surface) => surface.defaultEnabled)
        .map((surface) => ({
          surfaceKey: surface.key,
          enabled: true
        }))
    }
  };

  return userSchema.parse({
    ...user,
    updatedAt: now,
    accounts: upsertById(nextAccounts, nextAccount)
  });
}

/**
 * @template T extends { id: string }
 * @param {T[]} items
 * @param {T} item
 * @returns {T[]}
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
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
