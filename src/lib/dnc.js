// @ts-check

import fs from "node:fs";

/**
 * @param {string | undefined} filePath
 * @returns {string[]}
 */
export function loadDoNotContactEntries(filePath) {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) {
    throw new Error(`DNC file not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");

  return [...new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(",")[0]?.trim() ?? "")
      .filter(Boolean)
  )];
}

