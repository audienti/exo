// @ts-check

import fs from "node:fs";
import path from "node:path";

const fixtureRoot = path.resolve(import.meta.dirname, "..", "fixtures");

/**
 * @param {string} relativePath
 * @param {Record<string, string>} [replacements]
 */
export function loadJsonCassette(relativePath, replacements = {}) {
  const absolutePath = path.join(fixtureRoot, relativePath);
  const raw = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  return replaceTemplateValues(raw, replacements);
}

/**
 * @param {string} tempDir
 * @param {string} filename
 * @param {string} relativePath
 * @param {Record<string, string>} [replacements]
 */
export function writeJsonCassette(tempDir, filename, relativePath, replacements = {}) {
  const absolutePath = path.join(tempDir, filename);
  const payload = loadJsonCassette(relativePath, replacements);
  fs.writeFileSync(absolutePath, JSON.stringify(payload, null, 2));
  return absolutePath;
}

/**
 * @param {unknown} value
 * @param {Record<string, string>} replacements
 * @returns {unknown}
 */
function replaceTemplateValues(value, replacements) {
  if (typeof value === "string") {
    return Object.entries(replacements).reduce(
      (result, [key, replacement]) => result.split(`__${key}__`).join(replacement),
      value
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceTemplateValues(item, replacements));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, replaceTemplateValues(nestedValue, replacements)])
    );
  }

  return value;
}
