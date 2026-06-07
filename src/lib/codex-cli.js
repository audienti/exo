// @ts-check

import fs from "node:fs";

export const DEFAULT_CODEX_APP_CLI = "/Applications/Codex.app/Contents/Resources/codex";

/**
 * @param {{
 *   codexCli?: string | null,
 *   env?: NodeJS.ProcessEnv | null,
 *   appCliPath?: string | null
 * }} [input]
 */
export function resolveCodexCliCommand(input = {}) {
  const env = input.env ?? process.env;
  const explicit = normalizeNullableString(input.codexCli)
    ?? normalizeNullableString(env.EXO_CODEX_CLI);
  if (explicit) {
    return explicit;
  }

  const bundledAppCli = normalizeNullableString(input.appCliPath) ?? DEFAULT_CODEX_APP_CLI;
  if (isExecutableFile(bundledAppCli)) {
    return bundledAppCli;
  }

  return "codex";
}

/**
 * @param {string} filePath
 */
function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
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
