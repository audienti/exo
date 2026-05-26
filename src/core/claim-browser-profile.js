// @ts-check

import {
  browserProfileAutomationControlsSchema,
  browserProfileIdentitySchema,
  browserProfileSchema
} from "../schema/browser-profile.js";

/**
 * @param {unknown} rawProfile
 * @param {{
 *   label?: string | null,
 *   owner?: string | null,
 *   workspace?: string | null,
 *   scope?: "unknown" | "work" | "personal" | "shared" | null,
 *   accounts?: Array<{ capability: string, handle: string }> | null,
 *   automationControls?: {
 *     weeklyQuotas?: {
 *       profileVisits?: number | null,
 *       invitations?: number | null,
 *       messages?: number | null
 *     }
 *   } | null
 * }} input
 */
export function claimBrowserProfile(rawProfile, input) {
  const profile = browserProfileSchema.parse(rawProfile);
  const now = new Date().toISOString();
  const currentIdentity = browserProfileIdentitySchema.parse(profile.identity ?? {});
  const currentAutomationControls = browserProfileAutomationControlsSchema.parse(profile.automationControls ?? {});

  const nextIdentity = browserProfileIdentitySchema.parse({
    owner: normalizeNullableString(input.owner) ?? currentIdentity.owner,
    workspace: normalizeNullableString(input.workspace) ?? currentIdentity.workspace,
    scope: input.scope ?? currentIdentity.scope,
    accounts: input.accounts?.length ? input.accounts : currentIdentity.accounts
  });
  const nextAutomationControls = browserProfileAutomationControlsSchema.parse({
    ...currentAutomationControls,
    ...(input.automationControls ?? {}),
    weeklyQuotas: {
      ...currentAutomationControls.weeklyQuotas,
      ...(input.automationControls?.weeklyQuotas ?? {})
    }
  });

  return browserProfileSchema.parse({
    ...profile,
    updatedAt: now,
    label: normalizeNullableString(input.label) ?? profile.label,
    identity: nextIdentity,
    automationControls: nextAutomationControls
  });
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
