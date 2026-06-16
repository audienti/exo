// @ts-check

import crypto from "node:crypto";
import path from "node:path";

/**
 * @param {string | null | undefined} stateDir
 */
export function buildStateDirSuffix(stateDir) {
  if (!stateDir || !stateDir.trim()) {
    return "";
  }

  const digest = crypto
    .createHash("sha1")
    .update(path.resolve(stateDir.trim()))
    .digest("hex")
    .slice(0, 10);
  return `.${digest}`;
}
