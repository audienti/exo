// @ts-check

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_UNIPILE_BASE_URL = "https://api1.unipile.com:13111";

/**
 * @param {string | null | undefined} codexHome
 * @returns {{ apiKey: string | null, baseUrl: string }}
 */
export function readUnipileConfig(codexHome) {
  const home = normalizeNullableString(codexHome)
    ?? normalizeNullableString(process.env.CODEX_HOME)
    ?? path.join(os.homedir(), ".codex");
  const configPath = path.join(home, "config.toml");

  if (!fs.existsSync(configPath)) {
    return {
      apiKey: normalizeNullableString(process.env.UNIPILE_API_KEY) ?? null,
      baseUrl: normalizeUnipileBaseUrl(
        normalizeNullableString(process.env.UNIPILE_DSN)
        ?? normalizeNullableString(process.env.UNIPILE_BASE_URL)
        ?? null,
      ),
    };
  }

  const config = fs.readFileSync(configPath, "utf8");
  return {
    apiKey: normalizeNullableString(process.env.UNIPILE_API_KEY)
      ?? normalizeNullableString(config.match(/UNIPILE_API_KEY\s*=\s*"([^"]+)"/)?.[1] ?? null),
    baseUrl: normalizeUnipileBaseUrl(
      normalizeNullableString(process.env.UNIPILE_DSN)
      ?? normalizeNullableString(process.env.UNIPILE_BASE_URL)
      ?? normalizeNullableString(config.match(/UNIPILE_DSN\s*=\s*"([^"]+)"/)?.[1] ?? null)
      ?? normalizeNullableString(config.match(/UNIPILE_BASE_URL\s*=\s*"([^"]+)"/)?.[1] ?? null)
      ?? null,
    ),
  };
}

/**
 * @param {string | null | undefined} value
 */
function normalizeUnipileBaseUrl(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return DEFAULT_UNIPILE_BASE_URL;
  }
  return normalized.replace(/\/+$/, "");
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
