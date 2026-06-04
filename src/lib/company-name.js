// @ts-check

const PLACEHOLDER_COMPANY_NAMES = new Set([
  "unknown company",
  "unknown",
  "n/a",
  "na",
  "none",
]);

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeCompanyName(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeCompanyNameKey(value) {
  return normalizeCompanyName(value)?.toLowerCase() ?? null;
}

/**
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
export function isPlaceholderCompanyName(value) {
  const normalized = normalizeCompanyName(value);
  if (!normalized) {
    return false;
  }

  return PLACEHOLDER_COMPANY_NAMES.has(normalized.toLowerCase());
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeResolvableCompanyName(value) {
  const normalized = normalizeCompanyName(value);
  if (!normalized || isPlaceholderCompanyName(normalized)) {
    return null;
  }

  return normalized;
}
