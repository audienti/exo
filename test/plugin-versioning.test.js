// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EXO_VERSION } from "../src/lib/exo-version.js";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("plugin release surfaces stay version-aligned", () => {
  const packageJson = readJson("package.json");
  const pluginManifest = readJson(".codex-plugin/plugin.json");
  const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");

  assert.equal(EXO_VERSION, packageJson.version);
  assert.equal(pluginManifest.version, packageJson.version);
  assert.match(
    changelog,
    new RegExp(`^## \\[${escapeRegExp(packageJson.version)}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"),
  );
});

/**
 * @param {string} relativePath
 * @returns {Record<string, unknown>}
 */
function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
