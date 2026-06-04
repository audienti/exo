// @ts-check

export const BIZBRIDGE_IMAGE_PROXY_BASE_URL = "https://imageproxy.bizzbridge.com";
export const DEFAULT_BIZBRIDGE_IMAGE_PROXY_SIZE = "200x200";

/**
 * @param {string | null | undefined} value
 * @param {{ size?: string | null | undefined }} [options]
 */
export function normalizeImageProxyFields(value, options = {}) {
  if (value === undefined) {
    return {
      sourceUrl: undefined,
      proxyUrl: undefined
    };
  }

  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return {
      sourceUrl: null,
      proxyUrl: null
    };
  }

  const sourceUrl = unwrapBizBridgeImageProxyUrl(normalized) ?? normalized;

  return {
    sourceUrl,
    proxyUrl: buildBizBridgeImageProxyUrl(sourceUrl, options)
  };
}

/**
 * @param {string | null | undefined} value
 */
export function isBizBridgeImageProxyUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.origin.toLowerCase() === BIZBRIDGE_IMAGE_PROXY_BASE_URL;
  } catch {
    return false;
  }
}

/**
 * @param {string} sourceUrl
 * @param {{ size?: string | null | undefined }} [options]
 */
export function buildBizBridgeImageProxyUrl(sourceUrl, options = {}) {
  const normalized = normalizeNullableString(sourceUrl);
  if (!normalized) {
    throw new Error("Cannot build a proxied image URL without a source URL.");
  }

  const canonicalSourceUrl = unwrapBizBridgeImageProxyUrl(normalized) ?? normalized;
  const size = normalizeNullableString(options.size) ?? DEFAULT_BIZBRIDGE_IMAGE_PROXY_SIZE;
  return `${BIZBRIDGE_IMAGE_PROXY_BASE_URL}/${size}/${canonicalSourceUrl}`;
}

/**
 * @param {string | null | undefined} value
 */
export function unwrapBizBridgeImageProxyUrl(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized || !isBizBridgeImageProxyUrl(normalized)) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    if (pathSegments.length < 2) {
      return null;
    }

    let sourceUrl = pathSegments.slice(1).join("/");
    try {
      sourceUrl = decodeURIComponent(sourceUrl);
    } catch {
      // Keep the raw path when the source URL was not encoded.
    }

    return `${sourceUrl}${url.search}${url.hash}`;
  } catch {
    return null;
  }
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
 * Source image URLs from LinkedIn (and similar) are short-lived and
 * authenticated, so they must be pushed through our image proxy *while they are
 * still valid* — i.e. at capture time. `warmImageProxy` "touches" a proxied URL
 * with a GET so the proxy fetches and caches the underlying image now; later
 * displays then serve the cached copy even after the source URL has expired.
 *
 * Best-effort: never throws, times out, and only ever touches our own proxy
 * (never an arbitrary source host). No-op when `EXO_DISABLE_IMAGE_WARMING` is
 * set (the test runner sets it).
 *
 * @param {string | null | undefined} proxyUrl
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, status?: number, skipped?: boolean, error?: string }>}
 */
export async function warmImageProxy(proxyUrl, options = {}) {
  if (isImageWarmingDisabled()) {
    return { ok: false, skipped: true };
  }
  const target = normalizeNullableString(proxyUrl);
  if (!target || !isBizBridgeImageProxyUrl(target)) {
    return { ok: false, skipped: true };
  }
  if (typeof fetch !== "function") {
    return { ok: false, skipped: true };
  }

  const timeoutMs = options.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { method: "GET", redirect: "follow", signal: controller.signal });
    // Drain the body so the proxy completes the fetch-and-cache.
    try {
      await response.arrayBuffer();
    } catch {
      // ignore body read failures — the cache fill is what matters
    }
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Warm a batch of proxied image URLs with bounded concurrency. De-duplicates,
 * skips blanks, and only touches our proxy. Best-effort — resolves with how
 * many warmed.
 *
 * @param {Array<string | null | undefined>} proxyUrls
 * @param {{ timeoutMs?: number, concurrency?: number }} [options]
 * @returns {Promise<{ warmed: number, total: number, skipped?: boolean }>}
 */
export async function warmImageProxies(proxyUrls, options = {}) {
  if (isImageWarmingDisabled()) {
    return { warmed: 0, total: 0, skipped: true };
  }
  const distinct = [
    ...new Set((proxyUrls ?? []).map((value) => normalizeNullableString(value)).filter(Boolean)),
  ].filter((value) => isBizBridgeImageProxyUrl(value));
  if (!distinct.length) {
    return { warmed: 0, total: 0 };
  }

  const concurrency = Math.max(1, options.concurrency ?? 4);
  let cursor = 0;
  let warmed = 0;
  async function worker() {
    while (cursor < distinct.length) {
      const index = cursor;
      cursor += 1;
      const result = await warmImageProxy(distinct[index], options);
      if (result.ok) {
        warmed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, distinct.length) }, () => worker()));
  return { warmed, total: distinct.length };
}

function isImageWarmingDisabled() {
  const value = process.env.EXO_DISABLE_IMAGE_WARMING;
  return Boolean(value && value !== "0" && value.toLowerCase() !== "false");
}
