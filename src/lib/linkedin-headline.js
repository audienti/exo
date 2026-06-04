// @ts-check

/**
 * Best-effort extraction of a company name from a LinkedIn-style headline.
 * This is a fallback for provider payloads that expose only a headline string
 * like "Founder & CEO @ LeadsCampaign | ..." without a separate company field.
 *
 * @param {string | null | undefined} headline
 * @returns {string | null}
 */
export function deriveLinkedinCompanyName(headline) {
  const normalized = normalizeNullableString(headline);
  if (!normalized) {
    return null;
  }

  const atSignCandidate = normalizeNullableString(normalized.match(/@\s*([^|•·–—,\n]+)/u)?.[1] ?? null);
  if (atSignCandidate) {
    return atSignCandidate;
  }

  const atCandidate = normalizeNullableString(normalized.match(/\bat\s+([^|•·–—,\n]+)/iu)?.[1] ?? null);
  if (atCandidate && /^[A-Z0-9]/.test(atCandidate)) {
    return atCandidate;
  }

  return null;
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length ? normalized : null;
}
