// @ts-check

import fs from "node:fs";
import path from "node:path";

export const WORKSPACE_SETTINGS_FILENAME = "exo.toml";

/**
 * @param {{ cwd?: string | null | undefined }} [options]
 */
export function readWorkspaceSettings(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const settingsPath = path.join(cwd, WORKSPACE_SETTINGS_FILENAME);

  if (!fs.existsSync(settingsPath)) {
    return buildWorkspaceSettingsResult({
      cwd,
      path: settingsPath,
      exists: false,
      raw: {},
    });
  }

  const raw = fs.readFileSync(settingsPath, "utf8");
  return buildWorkspaceSettingsResult({
    cwd,
    path: settingsPath,
    exists: true,
    raw: parseSimpleToml(raw),
  });
}

/**
 * @param {ReturnType<typeof readWorkspaceSettings> | null | undefined} settings
 */
export function resolveWorkspaceLinkedinConnectionRequestTarget(settings) {
  const value = settings?.workspace?.targets?.linkedin?.connectionRequestsPerDay ?? null;
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * @param {{
 *   cwd: string,
 *   path: string,
 *   exists: boolean,
 *   raw: Record<string, any>
 * }} input
 */
function buildWorkspaceSettingsResult(input) {
  const connectionRequestsPerDay = normalizePositiveInteger(
    input.raw?.workspace?.targets?.linkedin?.connection_requests_per_day,
  );

  return {
    cwd: input.cwd,
    path: input.path,
    exists: input.exists,
    workspace: {
      targets: {
        linkedin: {
          connectionRequestsPerDay,
        },
      },
    },
  };
}

/**
 * Minimal TOML parser for Exo workspace settings.
 * Supports dotted table headers and scalar string/boolean/integer values.
 *
 * @param {string} raw
 */
function parseSimpleToml(raw) {
  const root = {};
  let currentPath = [];

  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = stripComments(sourceLine).trim();
    if (!line) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentPath = sectionMatch[1]
        .split(".")
        .map((part) => part.trim())
        .filter(Boolean);
      ensurePath(root, currentPath);
      continue;
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!keyValueMatch) {
      continue;
    }

    const [, rawKey, rawValue] = keyValueMatch;
    const target = ensurePath(root, currentPath);
    target[rawKey] = parseTomlScalar(rawValue.trim());
  }

  return root;
}

/**
 * @param {string} line
 */
function stripComments(line) {
  let inQuote = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\" && inQuote && !escaped) {
      escaped = true;
      continue;
    }
    if (character === "\"" && !escaped) {
      inQuote = !inQuote;
      continue;
    }
    if (character === "#" && !inQuote) {
      return line.slice(0, index);
    }
    escaped = false;
  }

  return line;
}

/**
 * @param {Record<string, any>} root
 * @param {string[]} pathParts
 */
function ensurePath(root, pathParts) {
  let cursor = root;

  for (const part of pathParts) {
    if (!cursor[part] || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }

  return cursor;
}

/**
 * @param {string} rawValue
 */
function parseTomlScalar(rawValue) {
  if (/^".*"$/.test(rawValue)) {
    return rawValue.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }

  if (/^(true|false)$/i.test(rawValue)) {
    return rawValue.toLowerCase() === "true";
  }

  if (/^[+-]?\d+$/.test(rawValue)) {
    return Number.parseInt(rawValue, 10);
  }

  return rawValue;
}

/**
 * @param {unknown} value
 */
function normalizePositiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? Number(value) : null;
}
