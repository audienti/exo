// @ts-check

import path from "node:path";

/**
 * @returns {string}
 */
export function getStateDir() {
  if (process.env.EXO_STATE_DIR && process.env.EXO_STATE_DIR.trim()) {
    return path.resolve(process.env.EXO_STATE_DIR.trim());
  }

  return path.join(process.cwd(), ".exo");
}

/**
 * @returns {string}
 */
export function getDatabasePath() {
  return path.join(getStateDir(), "exo.db");
}

/**
 * @returns {string}
 */
export function describeStatePathRule() {
  return "Exo uses EXO_STATE_DIR when set; otherwise it uses ./.exo relative to the current working directory.";
}
