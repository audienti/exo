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
