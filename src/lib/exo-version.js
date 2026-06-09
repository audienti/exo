// @ts-check

import fs from "node:fs";
import path from "node:path";

const packageJsonPath = path.resolve(import.meta.dirname, "..", "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
  throw new Error(`Expected a package version in ${packageJsonPath}.`);
}

export const EXO_VERSION = packageJson.version;
