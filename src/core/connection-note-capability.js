// @ts-check

import { CONNECTION_NOTE_CAPABILITIES, accountRefsCanAttachConnectionNote } from "../schema/browser-profile.js";

const NOTE_PREMIUM_FEATURES = new Set([
  "sales-navigator",
  "linkedin-premium",
  "premium",
]);

/**
 * Tri-state plan-tier verdict for the sending LinkedIn account.
 *
 * - true: verified Premium / Sales Navigator (notes available)
 * - false: verified free tier (the connector reported a plan with no premium
 *   features, or the account is explicitly marked non-premium)
 * - null: tier unverified (no plan evidence stored or discovered yet)
 *
 * The distinction matters in the UI: asserting "free tier" without evidence
 * misleads operators whose account is actually premium but undiscovered.
 *
 * @param {unknown} rawAccount
 * @returns {boolean | null}
 */
export function connectionNoteCapabilityForAccount(rawAccount) {
  if (!rawAccount || typeof rawAccount !== "object") {
    return null;
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

  const rawPremiumFeatures = rawAccount.metadata?.premiumFeatures;
  const premiumFeatures = normalizePremiumFeatures(rawPremiumFeatures);
  if (premiumFeatures.some((feature) => NOTE_PREMIUM_FEATURES.has(feature))) {
    return true;
  }

  if (rawAccount.metadata?.isPremium === false) {
    return false;
  }

  // A premiumFeatures array that is present but carries no note-capable
  // feature is positive evidence of a free (or non-note) plan. An absent
  // array means the tier was never verified.
  if (Array.isArray(rawPremiumFeatures)) {
    return false;
  }

  return null;
}

/**
 * Boolean view of the tri-state verdict for call sites that gate behavior:
 * only a verified premium account counts as note-capable.
 *
 * @param {unknown} rawAccount
 * @returns {boolean}
 */
export function accountCanAttachConnectionNote(rawAccount) {
  return connectionNoteCapabilityForAccount(rawAccount) === true;
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
    return connectionNoteCapabilityForAccount(input.resolvedAccount);
  }

  if (Array.isArray(input.accountRefs)) {
    // Account refs can prove premium (a sales-navigator: or linkedin-premium:
    // ref) but a plain linkedin:handle ref says nothing about the plan tier.
    return accountRefsCanAttachConnectionNote(input.accountRefs) ? true : null;
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
