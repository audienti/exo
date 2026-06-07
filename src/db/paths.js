// @ts-check

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LOCAL_STATE_DIRNAME = ".exo";
const DEFAULT_REPO_POLICY_FILENAME = "exo-policy.jsonl";
const HOME_POLICY_FILENAME = "policy.jsonl";
const DATABASE_FILENAME = "exo.db";
const WORKSPACE_CONFIG_FILENAME = "workspace.json";
const DEFAULT_GLOBAL_HOME_STATE_DIRNAME = ".exo";

/**
 * @param {{ cwd?: string | null | undefined, env?: NodeJS.ProcessEnv | null | undefined }} [options]
 */
export function resolveStatePaths(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const workspaceConfig = readWorkspaceStateConfig({ cwd });
  const localStateDir = resolveLocalStateDir({ cwd, env });
  const configuredHomeStateDir = normalizeDir(env.EXO_HOME_STATE_DIR, cwd)
    ?? workspaceConfig?.homeStateDir
    ?? null;
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
    workspaceConfigPath: getWorkspaceConfigPath({ cwd }),
    workspaceConfig,
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
  return "Exo uses EXO_STATE_DIR when set; otherwise it uses ./.exo relative to the current working directory. Set EXO_HOME_STATE_DIR to enable layered mode with a separate home/global store and policy ledger, or persist that home-store choice in ./.exo/workspace.json for this folder.";
}

/**
 * @param {{ cwd?: string | null | undefined }} [options]
 */
export function getWorkspaceConfigPath(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  return path.join(cwd, DEFAULT_LOCAL_STATE_DIRNAME, WORKSPACE_CONFIG_FILENAME);
}

/**
 * @returns {string}
 */
export function getDefaultGlobalHomeStateDir() {
  return path.join(os.homedir(), DEFAULT_GLOBAL_HOME_STATE_DIRNAME);
}

/**
 * @param {{ cwd?: string | null | undefined }} [options]
 * @returns {{ version: number, homeStateDir: string | null, installScope: "local-folder" | "global-install" | null } | null}
 */
export function readWorkspaceStateConfig(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = getWorkspaceConfigPath({ cwd });
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const homeStateDir = normalizeDir(raw?.homeStateDir, cwd);
  const installScope = normalizeInstallScope(raw?.installScope);
  if (!homeStateDir && !installScope) {
    return null;
  }

  return {
    version: Number.isInteger(raw?.version) ? raw.version : 1,
    homeStateDir,
    installScope,
  };
}

/**
 * @param {{ homeStateDir?: string | null | undefined, installScope?: "local-folder" | "global-install" | null | undefined }} input
 * @param {{ cwd?: string | null | undefined }} [options]
 */
export function writeWorkspaceStateConfig(input, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configPath = getWorkspaceConfigPath({ cwd });
  const installScope = normalizeInstallScope(input.installScope) ?? null;
  const normalizedHomeStateDir = normalizeDir(input.homeStateDir, cwd);
  if (!installScope && !normalizedHomeStateDir) {
    throw new Error("Workspace install scope or home state dir is required.");
  }
  if (installScope === "global-install" && !normalizedHomeStateDir) {
    throw new Error("Global-install workspace config requires a home state dir.");
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  /** @type {{ version: number, installScope?: "local-folder" | "global-install", homeStateDir?: string }} */
  const payload = { version: 1 };
  if (installScope) {
    payload.installScope = installScope;
  }
  if (normalizedHomeStateDir) {
    payload.homeStateDir = normalizedHomeStateDir;
  }
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  return configPath;
}

/**
 * @param {{ cwd?: string | null | undefined }} [options]
 */
export function clearWorkspaceStateConfig(options = {}) {
  const configPath = getWorkspaceConfigPath(options);
  try {
    fs.rmSync(configPath, { force: true });
  } catch {
    // best-effort
  }
  return configPath;
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

/**
 * @param {unknown} value
 * @returns {"local-folder" | "global-install" | null}
 */
function normalizeInstallScope(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "local-folder" || normalized === "global-install") {
    return normalized;
  }
  return null;
}
