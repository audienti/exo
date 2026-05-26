// @ts-check

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browserKeySchema, browserProfileTestResultSchema } from "../schema/browser-profile.js";

const DEFAULTS = {
  chrome: {
    userDataDir: "~/Library/Application Support/Google/Chrome",
    browserCommand: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  },
  "chrome-beta": {
    userDataDir: "~/Library/Application Support/Google/Chrome Beta",
    browserCommand: "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"
  },
  chromium: {
    userDataDir: "~/Library/Application Support/Chromium",
    browserCommand: "/Applications/Chromium.app/Contents/MacOS/Chromium"
  },
  brave: {
    userDataDir: "~/Library/Application Support/BraveSoftware/Brave-Browser",
    browserCommand: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  },
  arc: {
    userDataDir: "~/Library/Application Support/Arc/User Data",
    browserCommand: "/Applications/Arc.app/Contents/MacOS/Arc"
  },
  edge: {
    userDataDir: "~/Library/Application Support/Microsoft Edge",
    browserCommand: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  }
};

/**
 * @param {string} value
 * @returns {string}
 */
export function expandPath(value) {
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
}

/**
 * @param {unknown} browser
 * @returns {keyof typeof DEFAULTS}
 */
function parseBrowser(browser) {
  return browserKeySchema.parse(browser);
}

/**
 * @param {keyof typeof DEFAULTS} browser
 * @returns {{ userDataDir: string, browserCommand: string }}
 */
function browserDefaults(browser) {
  return DEFAULTS[browser];
}

/**
 * @param {{
 *   browser: unknown,
 *   userDataDir?: string | null,
 *   profileDirectory?: string | null,
 *   browserCommand?: string | null,
 *   label?: string | null
 * }} input
 */
export function resolveBrowserProfilePaths(input) {
  const browser = parseBrowser(input.browser);
  const defaults = browserDefaults(browser);
  const userDataDir = expandPath(input.userDataDir || defaults.userDataDir);
  const profileDirectory = (input.profileDirectory || "Default").trim();
  const browserCommand = input.browserCommand ? expandPath(input.browserCommand) : defaults.browserCommand;
  const profilePath = path.join(userDataDir, profileDirectory);
  const label = input.label?.trim() || `${browser}:${profileDirectory}`;

  return {
    browser,
    userDataDir,
    profileDirectory,
    browserCommand,
    profilePath,
    label
  };
}

/**
 * @param {{
 *   browser: unknown,
 *   userDataDir: string,
 *   profileDirectory: string,
 *   browserCommand: string | null,
 *   profilePath: string
 * }} input
 */
export function testBrowserProfile(input) {
  const browser = parseBrowser(input.browser);
  const warnings = [];
  const checks = [];
  const localStatePath = path.join(input.userDataDir, "Local State");
  const preferencesPath = path.join(input.profilePath, "Preferences");
  const cookiesPath = path.join(input.profilePath, "Cookies");
  const historyPath = path.join(input.profilePath, "History");
  const singletonLockPath = path.join(input.userDataDir, "SingletonLock");

  const userDataDirExists = fs.existsSync(input.userDataDir);
  checks.push({
    name: "user_data_dir_exists",
    ok: userDataDirExists,
    details: userDataDirExists ? input.userDataDir : `Missing user data dir: ${input.userDataDir}`
  });

  const profilePathExists = fs.existsSync(input.profilePath);
  checks.push({
    name: "profile_path_exists",
    ok: profilePathExists,
    details: profilePathExists ? input.profilePath : `Missing profile path: ${input.profilePath}`
  });

  const browserCommandExists = input.browserCommand ? fs.existsSync(input.browserCommand) : false;
  checks.push({
    name: "browser_command_exists",
    ok: browserCommandExists,
    details: input.browserCommand
      ? browserCommandExists
        ? input.browserCommand
        : `Missing browser executable: ${input.browserCommand}`
      : "No browser command configured"
  });

  const localStateExists = fs.existsSync(localStatePath);
  checks.push({
    name: "local_state_exists",
    ok: localStateExists,
    details: localStateExists ? localStatePath : `Missing Local State file: ${localStatePath}`
  });

  const preferencesExists = fs.existsSync(preferencesPath);
  checks.push({
    name: "preferences_exists",
    ok: preferencesExists,
    details: preferencesExists ? preferencesPath : `Missing Preferences file: ${preferencesPath}`
  });

  const cookiesExists = fs.existsSync(cookiesPath);
  checks.push({
    name: "cookies_store_exists",
    ok: cookiesExists,
    details: cookiesExists ? cookiesPath : `Missing Cookies database: ${cookiesPath}`
  });

  const historyExists = fs.existsSync(historyPath);
  checks.push({
    name: "history_store_exists",
    ok: historyExists,
    details: historyExists ? historyPath : `Missing History database: ${historyPath}`
  });

  if (fs.existsSync(singletonLockPath)) {
    warnings.push(`Profile root appears live or locked: ${singletonLockPath}`);
  }

  const detectedProfileName =
    readProfileNameFromPreferences(preferencesPath) ||
    readProfileNameFromLocalState(localStatePath, input.profileDirectory) ||
    null;

  const criticalChecks = ["user_data_dir_exists", "profile_path_exists", "preferences_exists"];
  const criticalFailures = checks.filter((check) => criticalChecks.includes(check.name) && !check.ok);

  let status = "ready";
  if (criticalFailures.length) {
    status = "invalid";
  } else if (!browserCommandExists || !cookiesExists || !historyExists || warnings.length) {
    status = "warning";
  }

  const summary =
    status === "invalid"
      ? "Profile registration is incomplete. Exo should not try to drive this browser context yet."
      : status === "warning"
        ? "Profile is present but not fully trusted yet. Browser-driven work should be cautious until warnings are cleared."
        : "Profile looks usable for browser-backed Exo work.";

  return {
    browser,
    detectedProfileName,
    result: browserProfileTestResultSchema.parse({
      status,
      summary,
      checks,
      warnings
    })
  };
}

/**
 * @param {string} preferencesPath
 * @returns {string | null}
 */
function readProfileNameFromPreferences(preferencesPath) {
  const json = readJsonFile(preferencesPath);
  if (!json || typeof json !== "object") return null;

  const profile = json.profile;
  if (!profile || typeof profile !== "object") return null;

  return typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : null;
}

/**
 * @param {string} localStatePath
 * @param {string} profileDirectory
 * @returns {string | null}
 */
function readProfileNameFromLocalState(localStatePath, profileDirectory) {
  const json = readJsonFile(localStatePath);
  if (!json || typeof json !== "object") return null;

  const profile = json.profile;
  if (!profile || typeof profile !== "object") return null;

  const infoCache = profile.info_cache;
  if (!infoCache || typeof infoCache !== "object") return null;

  const entry = infoCache[profileDirectory];
  if (!entry || typeof entry !== "object") return null;

  return typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : null;
}

/**
 * @param {string} filePath
 * @returns {any | null}
 */
function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
