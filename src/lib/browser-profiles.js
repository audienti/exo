// @ts-check

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  browserKeySchema,
  browserProfileCapabilitySchema,
  browserProfileTestResultSchema
} from "../schema/browser-profile.js";

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

export const supportedBrowserProfileCapabilities = browserProfileCapabilitySchema.options;

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
 *   userDataDir?: string | null,
 *   browserCommand?: string | null
 * }} input
 */
export function discoverBrowserProfiles(input) {
  const browser = parseBrowser(input.browser);
  const defaults = browserDefaults(browser);
  const userDataDir = expandPath(input.userDataDir || defaults.userDataDir);
  const browserCommand = input.browserCommand ? expandPath(input.browserCommand) : defaults.browserCommand;
  const localStatePath = path.join(userDataDir, "Local State");
  const profileDirectories = discoverProfileDirectories(userDataDir, localStatePath);

  return profileDirectories.map((profileDirectory) => {
    const profilePath = path.join(userDataDir, profileDirectory);
    const structural = testBrowserProfile({
      browser,
      userDataDir,
      profileDirectory,
      browserCommand,
      profilePath,
      capabilities: ["generic-web"]
    });
    const capabilityChecks = supportedBrowserProfileCapabilities.map((capability) =>
      verifyCapability(capability, {
        cookiesPath: path.join(profilePath, "Cookies"),
        historyPath: path.join(profilePath, "History"),
        profileStatus: structural.result.status === "invalid" ? "invalid" : "ready"
      })
    );

    return {
      browser,
      browserCommand,
      userDataDir,
      profileDirectory,
      profilePath,
      label: `${browser}:${profileDirectory}`,
      detectedProfileName: structural.detectedProfileName,
      structuralStatus: structural.result.status,
      structuralSummary: structural.result.summary,
      observedCapabilities: capabilityChecks.filter((check) => check.verified).map((check) => check.capability),
      capabilityChecks
    };
  });
}

/**
 * @param {{
 *   browser: unknown,
 *   userDataDir: string,
 *   profileDirectory: string,
 *   browserCommand: string | null,
 *   profilePath: string,
 *   capabilities?: string[]
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
  const declaredCapabilities = normalizeCapabilities(input.capabilities);
  const capabilityChecks = declaredCapabilities.map((capability) =>
    verifyCapability(capability, {
      cookiesPath,
      historyPath,
      profileStatus: criticalFailures.length ? "invalid" : "ready"
    })
  );
  const unverifiedCapabilities = capabilityChecks.filter((check) => !check.verified);

  let status = "ready";
  if (criticalFailures.length) {
    status = "invalid";
  } else if (!browserCommandExists || !cookiesExists || !historyExists || warnings.length || unverifiedCapabilities.length) {
    status = "warning";
  }

  const summary =
    status === "invalid"
      ? "Profile registration is incomplete. Exo should not try to drive this browser context yet."
      : status === "warning"
        ? buildWarningSummary(unverifiedCapabilities)
        : "Profile looks usable for browser-backed Exo work.";

  return {
    browser,
    detectedProfileName,
    verifiedCapabilities: capabilityChecks.filter((check) => check.verified).map((check) => check.capability),
    result: browserProfileTestResultSchema.parse({
      status,
      summary,
      checks,
      capabilityChecks,
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
 * @param {string} userDataDir
 * @param {string} localStatePath
 * @returns {string[]}
 */
function discoverProfileDirectories(userDataDir, localStatePath) {
  if (!fs.existsSync(userDataDir)) {
    return [];
  }

  const directories = new Set();
  const localState = readJsonFile(localStatePath);
  if (localState && typeof localState === "object") {
    const infoCache = localState.profile?.info_cache;
    if (infoCache && typeof infoCache === "object") {
      for (const key of Object.keys(infoCache)) {
        directories.add(key);
      }
    }
  }

  try {
    const entries = fs.readdirSync(userDataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === "Default" || entry.name.startsWith("Profile ")) {
        directories.add(entry.name);
      }
    }
  } catch {
    return [];
  }

  return [...directories]
    .filter((profileDirectory) => profileDirectory && isUsableProfileDirectory(userDataDir, profileDirectory))
    .sort(compareProfileDirectories);
}

/**
 * @param {string} userDataDir
 * @param {string} profileDirectory
 */
function isUsableProfileDirectory(userDataDir, profileDirectory) {
  const profilePath = path.join(userDataDir, profileDirectory);
  if (!fs.existsSync(profilePath)) {
    return false;
  }

  try {
    if (!fs.statSync(profilePath).isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }

  return ["Preferences", "History", "Cookies"].some((fileName) => fs.existsSync(path.join(profilePath, fileName)));
}

/**
 * @param {string} left
 * @param {string} right
 */
function compareProfileDirectories(left, right) {
  if (left === "Default" && right !== "Default") {
    return -1;
  }
  if (left !== "Default" && right === "Default") {
    return 1;
  }

  const leftMatch = left.match(/^Profile (\d+)$/);
  const rightMatch = right.match(/^Profile (\d+)$/);
  if (leftMatch && rightMatch) {
    return Number(leftMatch[1]) - Number(rightMatch[1]);
  }

  return left.localeCompare(right);
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

/**
 * @param {string[] | undefined} capabilities
 */
function normalizeCapabilities(capabilities) {
  const values = capabilities?.length ? capabilities : ["generic-web"];
  return [...new Set(values)];
}

/**
 * @param {string} capability
 * @param {{ cookiesPath: string, historyPath: string, profileStatus: "invalid" | "ready" }} input
 */
function verifyCapability(capability, input) {
  if (input.profileStatus === "invalid") {
    return {
      capability,
      verified: false,
      details: "Profile is structurally invalid, so capability verification is blocked."
    };
  }

  switch (capability) {
    case "generic-web":
      return {
        capability,
        verified: true,
        details: "Profile artifacts exist and the browser context is structurally usable."
      };
    case "linkedin":
      return verifyDomainCapability(capability, input, {
        cookies: [/\.linkedin\.com$/i],
        history: [/linkedin\.com/i]
      });
    case "sales-navigator":
      return verifyDomainCapability(capability, input, {
        cookies: [],
        history: [/linkedin\.com\/sales\b/i]
      });
    case "gmail":
      return verifyDomainCapability(capability, input, {
        cookies: [/\.google\.com$/i, /^mail\.google\.com$/i],
        history: [/mail\.google\.com/i]
      });
    case "hubspot":
      return verifyDomainCapability(capability, input, {
        cookies: [/\.hubspot\.com$/i, /^app\.hubspot\.com$/i],
        history: [/app\.hubspot\.com/i]
      });
    default:
      return {
        capability,
        verified: false,
        details: "Unsupported capability."
      };
  }
}

/**
 * @param {string} capability
 * @param {{ cookiesPath: string, historyPath: string }} input
 * @param {{ cookies: RegExp[], history: RegExp[] }} matchers
 */
function verifyDomainCapability(capability, input, matchers) {
  const cookieMatch = matchSqliteFile(
    input.cookiesPath,
    "SELECT host_key AS value FROM cookies",
    "value",
    matchers.cookies
  );
  const historyMatch = matchSqliteFile(
    input.historyPath,
    "SELECT url AS value FROM urls",
    "value",
    matchers.history
  );

  if (historyMatch.matched) {
    return {
      capability,
      verified: true,
      details: `Verified from browser history: ${historyMatch.evidence}`
    };
  }

  if (cookieMatch.matched) {
    return {
      capability,
      verified: true,
      details: `Verified from browser cookies: ${cookieMatch.evidence}`
    };
  }

  const failureParts = [historyMatch.reason, cookieMatch.reason].filter(Boolean);
  return {
    capability,
    verified: false,
    details: failureParts.length
      ? failureParts.join(" ")
      : `No local evidence found for ${capability}.`
  };
}

/**
 * @param {string} filePath
 * @param {string} query
 * @param {string} field
 * @param {RegExp[]} patterns
 */
function matchSqliteFile(filePath, query, field, patterns) {
  if (!patterns.length) {
    return {
      matched: false,
      evidence: null,
      reason: ""
    };
  }

  if (!fs.existsSync(filePath)) {
    return {
      matched: false,
      evidence: null,
      reason: `Missing SQLite file: ${filePath}`
    };
  }

  return withCopiedDatabase(filePath, (database) => {
    try {
      const rows = database.prepare(query).all();
      for (const row of rows) {
        const value = typeof row[field] === "string" ? row[field].trim() : "";
        if (!value) {
          continue;
        }

        if (patterns.some((pattern) => pattern.test(value))) {
          return {
            matched: true,
            evidence: value,
            reason: ""
          };
        }
      }

      return {
        matched: false,
        evidence: null,
        reason: `No matching local evidence found in ${path.basename(filePath)}.`
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        matched: false,
        evidence: null,
        reason: `Could not read ${path.basename(filePath)}: ${reason}`
      };
    }
  });
}

/**
 * @template T
 * @param {string} filePath
 * @param {(database: DatabaseSync) => T} reader
 * @returns {T}
 */
function withCopiedDatabase(filePath, reader) {
  const tempPath = path.join(os.tmpdir(), `exo-profile-${crypto.randomUUID()}.sqlite`);
  fs.copyFileSync(filePath, tempPath);
  const database = new DatabaseSync(tempPath);

  try {
    return reader(database);
  } finally {
    database.close();
    fs.rmSync(tempPath, { force: true });
  }
}

/**
 * @param {Array<{ capability: string, verified: boolean }>} unverifiedCapabilities
 */
function buildWarningSummary(unverifiedCapabilities) {
  if (!unverifiedCapabilities.length) {
    return "Profile is present but not fully trusted yet. Browser-driven work should be cautious until warnings are cleared.";
  }

  return `Profile is present, but Exo could not verify these declared capabilities yet: ${unverifiedCapabilities
    .map((check) => check.capability)
    .join(", ")}.`;
}
