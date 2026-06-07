// @ts-check

import { CONNECTION_NOTE_CAPABILITIES, accountRefsCanAttachConnectionNote } from "../schema/browser-profile.js";

const NOTE_PREMIUM_FEATURES = new Set([
  "sales-navigator",
  "linkedin-premium",
  "premium",
]);

/**
 * @param {unknown} rawAccount
 * @returns {boolean}
 */
export function accountCanAttachConnectionNote(rawAccount) {
  if (!rawAccount || typeof rawAccount !== "object") {
    return false;
  }

  const capability = normalizeNullableString(rawAccount.capability)?.toLowerCase() ?? null;
  if (capability && CONNECTION_NOTE_CAPABILITIES.includes(capability)) {
    return true;
  }

  if (capability !== "linkedin") {
    return false;
  }

  if (rawAccount.metadata?.isPremium === true) {
    return true;
  }

  const premiumFeatures = normalizePremiumFeatures(rawAccount.metadata?.premiumFeatures);
  return premiumFeatures.some((feature) => NOTE_PREMIUM_FEATURES.has(feature));
}

/**
 * @param {{
 *   resolvedAccount?: unknown,
 *   accountRefs?: string[] | null | undefined,
 * }} input
 * @returns {boolean | null}
 */
export function resolveConnectionNoteCapability(input) {
  if (input.resolvedAccount) {
    return accountCanAttachConnectionNote(input.resolvedAccount);
  }

  if (Array.isArray(input.accountRefs)) {
    return accountRefsCanAttachConnectionNote(input.accountRefs);
  }

  return null;
}

/**
 * @param {unknown} rawFeatures
 * @returns {string[]}
 */
function normalizePremiumFeatures(rawFeatures) {
  if (!Array.isArray(rawFeatures)) {
    return [];
  }

  return rawFeatures
    .map((value) => normalizeNullableString(value)?.toLowerCase().replace(/[_\s]+/g, "-") ?? null)
    .filter(Boolean);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
