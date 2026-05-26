// @ts-check

/**
 * @param {string} html
 * @returns {string | null}
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? sanitize(match[1]) : null;
}

/**
 * @param {string} html
 * @returns {string | null}
 */
function extractMetaDescription(html) {
  const match = html.match(
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i
  );
  return match ? sanitize(match[1]) : null;
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitize(value) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * @param {string} url
 * @returns {Promise<{ title: string | null, description: string | null }>}
 */
export async function fetchPageSnapshot(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Exo/0.1 (+https://github.com/omalab/exo)"
      }
    });

    if (!response.ok) {
      return { title: null, description: null };
    }

    const html = await response.text();
    return {
      title: extractTitle(html),
      description: extractMetaDescription(html)
    };
  } catch {
    return { title: null, description: null };
  }
}

