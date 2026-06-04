// @ts-check

import path from "node:path";

const DEFAULT_LOCAL_STATE_DIRNAME = ".exo";
const DEFAULT_REPO_POLICY_FILENAME = "exo-policy.jsonl";
const HOME_POLICY_FILENAME = "policy.jsonl";
const DATABASE_FILENAME = "exo.db";

/**
 * @param {{ cwd?: string | null | undefined, env?: NodeJS.ProcessEnv | null | undefined }} [options]
 */
export function resolveStatePaths(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const localStateDir = resolveLocalStateDir({ cwd, env });
  const configuredHomeStateDir = normalizeDir(env.EXO_HOME_STATE_DIR, cwd);
  const homeStateDir = configuredHomeStateDir ?? localStateDir;
  const layered = homeStateDir !== localStateDir;

  return {
    cwd,
    localStateDir,
    homeStateDir,
    localDatabasePath: path.join(localStateDir, DATABASE_FILENAME),
    homeDatabasePath: path.join(homeStateDir, DATABASE_FILENAME),
    repoPolicyPath: path.join(cwd, DEFAULT_REPO_POLICY_FILENAME),
    homePolicyPath: path.join(homeStateDir, HOME_POLICY_FILENAME),
    layered,
    singleStore: !layered,
  };
}

/**
 * @returns {string}
 */
export function getStateDir() {
  return getLocalStateDir();
}

/**
 * @returns {string}
 */
export function getLocalStateDir() {
  return resolveStatePaths().localStateDir;
}

/**
 * @returns {string}
 */
export function getHomeStateDir() {
  return resolveStatePaths().homeStateDir;
}

/**
 * @returns {string}
 */
export function getDatabasePath() {
  return getLocalDatabasePath();
}

/**
 * @returns {string}
 */
export function getLocalDatabasePath() {
  return resolveStatePaths().localDatabasePath;
}

/**
 * @returns {string}
 */
export function getHomeDatabasePath() {
  return resolveStatePaths().homeDatabasePath;
}

/**
 * @returns {string}
 */
export function getRepoPolicyPath() {
  return resolveStatePaths().repoPolicyPath;
}

/**
 * @returns {string}
 */
export function getHomePolicyPath() {
  return resolveStatePaths().homePolicyPath;
}

/**
 * @returns {string}
 */
export function describeStatePathRule() {
  return "Exo uses EXO_STATE_DIR when set; otherwise it uses ./.exo relative to the current working directory. Set EXO_HOME_STATE_DIR to enable layered mode with a separate home/global store and policy ledger.";
}

/**
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} input
 */
function resolveLocalStateDir(input) {
  return normalizeDir(input.env.EXO_STATE_DIR, input.cwd)
    ?? path.join(input.cwd, DEFAULT_LOCAL_STATE_DIRNAME);
}

/**
 * @param {string | null | undefined} value
 * @param {string} cwd
 * @returns {string | null}
 */
function normalizeDir(value, cwd) {
  if (!value || !value.trim()) {
    return null;
  }

  return path.resolve(cwd, value.trim());
}
