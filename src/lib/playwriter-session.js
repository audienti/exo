// @ts-check

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CHROME_USER_DATA_DIR = path.join(os.homedir(), "Library/Application Support/Google/Chrome");
const DEFAULT_PLAYWRITER_BIN = process.env.EXO_PLAYWRITER_BIN || path.join(os.homedir(), ".npm-global", "bin", "playwriter");
const PLAYWRITER_EXTENSION_ID = "jfeammnjpkecdekppnclgkkffahnhfhe";
const PLAYWRITER_RELAY_PORT = Number(process.env.EXO_PLAYWRITER_RELAY_PORT || "19988");
const CHROME_APP = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PLAYWRITER_SESSION_COMMAND_TIMEOUT_MS = Number(process.env.EXO_PLAYWRITER_SESSION_COMMAND_TIMEOUT_MS || "60000");
const CHROME_WINDOW_LAUNCH_TIMEOUT_MS = Number(process.env.EXO_CHROME_WINDOW_LAUNCH_TIMEOUT_MS || "15000");
const RELAY_CLEANUP_COMMAND_TIMEOUT_MS = Number(process.env.EXO_PLAYWRITER_RELAY_CLEANUP_TIMEOUT_MS || "10000");
const NEW_SESSION_SETTLE_MS = Number(process.env.EXO_PLAYWRITER_NEW_SESSION_SETTLE_MS || "1250");
const STALE_RELAY_PATTERNS = [
  "failed to start cdp relay server",
  "multiple browsers detected",
  "listen eperm",
  "eaddrinuse",
  "operation not permitted",
];
const TRANSIENT_PAGE_PROBE_PATTERNS = [
  "fetch failed",
  "econnreset",
  "econnrefused",
  "socket hang up",
  "target page, context or browser has been closed",
];

/**
 * @param {{ capability: string }} input
 */
export function buildPlaywriterTargetUrl(input) {
  return input.capability === "gmail"
    ? "https://mail.google.com/mail/u/0/#inbox"
    : "https://www.linkedin.com/feed/";
}

/**
 * @param {string} stdout
 */
export function parsePlaywriterSessionList(stdout) {
  return String(stdout ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("ID  ") || /^-+$/.test(trimmed)) {
        return [];
      }
      const parts = trimmed.split(/\s{2,}/);
      if (parts.length < 4 || !/^\d+$/.test(parts[0])) {
        return [];
      }
      return [{
        sessionId: parts[0],
        browser: parts[1] ?? "",
        profile: parts[2] ?? "",
        browserKey: parts[3] ?? "",
        stateKeys: parts[4] ?? "",
      }];
    });
}

/**
 * @param {string} stdout
 */
export function parsePlaywriterSessionId(stdout) {
  const lines = String(stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.slice().reverse()) {
    if (/^\d+$/.test(line)) return line;
    const match = line.match(/\bSession\s+(\d+)\s+created\b/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * @param {{
 *   profileDirectory: string,
 *   expectedHandle?: string | null,
 *   chromeUserDataDir?: string | null
 * }} input
 */
export function resolvePlaywriterProfileBinding(input) {
  const chromeUserDataDir = input.chromeUserDataDir || DEFAULT_CHROME_USER_DATA_DIR;
  const localStatePath = path.join(chromeUserDataDir, "Local State");
  const preferencesPath = path.join(chromeUserDataDir, input.profileDirectory, "Preferences");
  if (!fs.existsSync(preferencesPath)) {
    throw new Error(`Chrome preferences not found for ${input.profileDirectory} under ${chromeUserDataDir}.`);
  }

  const localState = fs.existsSync(localStatePath)
    ? parseJsonFile(localStatePath)
    : {};
  const infoCache = localState?.profile?.info_cache?.[input.profileDirectory] ?? {};
  const preferences = parseJsonFile(preferencesPath);
  const accountInfo = Array.isArray(preferences?.account_info) ? preferences.account_info : [];
  const expectedHandle = typeof input.expectedHandle === "string" && input.expectedHandle.includes("@")
    ? input.expectedHandle.trim().toLowerCase()
    : null;
  const exactEntry = expectedHandle
    ? accountInfo.find((entry) => String(entry?.email ?? "").trim().toLowerCase() === expectedHandle)
    : null;
  const gaiaId = normalizeString(
    exactEntry?.gaia
    ?? exactEntry?.account_id
    ?? infoCache?.gaia_id
    ?? accountInfo.find((entry) => normalizeString(entry?.gaia) || normalizeString(entry?.account_id))?.gaia
    ?? accountInfo.find((entry) => normalizeString(entry?.account_id))?.account_id
  );
  if (!gaiaId) {
    throw new Error(`Chrome profile ${input.profileDirectory} does not expose a Gaia/account id for Playwriter browser selection.`);
  }

  const userName = normalizeString(infoCache?.user_name)
    ?? normalizeString(exactEntry?.email)
    ?? normalizeString(accountInfo.find((entry) => normalizeString(entry?.email))?.email);
  const accountEmails = accountInfo
    .map((entry) => normalizeString(entry?.email)?.toLowerCase() ?? null)
    .filter(Boolean);

  return {
    profileDirectory: input.profileDirectory,
    profilePath: path.join(chromeUserDataDir, input.profileDirectory),
    userName,
    accountEmails,
    gaiaId,
    browserKey: `profile:${gaiaId}`,
  };
}

/**
 * @param {{
 *   profileDirectory: string,
 *   expectedHandle?: string | null,
 *   capability: string,
 *   chromeUserDataDir?: string | null,
 *   playwriterBin?: string | null,
 *   targetUrl?: string | null,
 *   allowReuseExisting?: boolean | null,
 *   forceWindowPreflight?: boolean | null,
 * }} input
 */
export function ensurePlaywriterSession(input) {
  const playwriterBin = resolvePlaywriterBin(input.playwriterBin);
  const binding = resolvePlaywriterProfileBinding({
    profileDirectory: input.profileDirectory,
    expectedHandle: input.expectedHandle ?? null,
    chromeUserDataDir: input.chromeUserDataDir ?? null,
  });
  const targetUrl = input.targetUrl || buildPlaywriterTargetUrl({ capability: input.capability });
  const allowReuseExisting = input.allowReuseExisting !== false;
  const forceWindowPreflight = input.forceWindowPreflight === true;
  const listed = listPlaywriterSessions(playwriterBin);
  let windowPreflight = forceWindowPreflight
    ? ensureChromeProfileWindow(input.profileDirectory, targetUrl)
    : { attempted: false, ok: false, reason: "not_needed" };
  let cleanup = { attempted: false, reason: null };
  const attempts = [];
  const reusable = allowReuseExisting
    ? listed.records.find((record) => (
      record.browserKey === binding.browserKey
        && (!binding.userName || record.profile === binding.userName)
    ))
    : null;
  if (reusable) {
    const validation = validatePlaywriterSession(playwriterBin, reusable.sessionId, binding);
    const pageProbe = validation.ok
      ? probePlaywriterSessionPageWithRetry(playwriterBin, reusable.sessionId, targetUrl)
      : null;
    if (validation.ok && pageProbe?.ok) {
      return {
        ok: true,
        reused: true,
        playwriterBin,
        sessionId: reusable.sessionId,
        binding,
        sessionRecord: reusable,
        validation,
        pageProbe,
        targetUrl,
      };
    }
    deletePlaywriterSession({ sessionId: reusable.sessionId, playwriterBin });
    if (pageProbeNeedsWindowPreflight(pageProbe ?? { error: validation.reason })) {
      windowPreflight = ensureChromeProfileWindow(input.profileDirectory, targetUrl);
    }
    if (pageProbeNeedsFreshSession(pageProbe ?? { error: validation.reason })
      || shouldRetryTransientPlaywriterPageProbe(pageProbe ?? { error: validation.reason })
      || staleRelayError(pageProbe?.error ?? validation.reason ?? "")) {
      cleanup = cleanupPlaywriterRelay();
    }
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const created = runPlaywriter(playwriterBin, ["session", "new", "--browser", binding.browserKey]);
    const combined = [created.stdout, created.stderr].filter(Boolean).join("\n").trim();
    attempts.push({
      attempt,
      exitStatus: created.exitStatus,
      stdout: compact(created.stdout, 400),
      stderr: compact(created.stderr, 400),
    });
    const sessionId = parsePlaywriterSessionId(created.stdout);
    if (created.exitStatus === 0 && sessionId) {
      const validation = validatePlaywriterSession(playwriterBin, sessionId, binding);
      if (validation.ok) {
        sleepMs(NEW_SESSION_SETTLE_MS);

        return {
          ok: true,
          reused: false,
          playwriterBin,
          sessionId,
          binding,
          attempts,
          validation,
          pageProbe: {
            ok: true,
            deferred: true,
            reason: "fresh_session_deferred_to_first_command",
          },
          windowPreflight,
          cleanup,
          targetUrl,
        };
      }

      deletePlaywriterSession({ sessionId, playwriterBin });
      if (attempt === 1) {
        windowPreflight = ensureChromeProfileWindow(input.profileDirectory, targetUrl);
        cleanup = cleanupPlaywriterRelay();
        continue;
      }

      return {
        ok: false,
        reused: false,
        playwriterBin,
        sessionId,
        binding,
        attempts,
        validation,
        windowPreflight,
        cleanup,
        reason: validation.reason,
      };
    }

    if (attempt === 1 && staleRelayError(combined)) {
      cleanup = cleanupPlaywriterRelay();
      continue;
    }

    if (attempt === 1 && needsWindowPreflight(combined)) {
      windowPreflight = ensureChromeProfileWindow(input.profileDirectory, targetUrl);
      continue;
    }

    break;
  }

  return {
    ok: false,
    reused: false,
    playwriterBin,
    sessionId: null,
    binding,
    attempts,
    windowPreflight,
    cleanup,
    reason: "Failed to create a Playwriter session for the resolved Chrome profile.",
  };
}

/**
 * @param {{ sessionId: string, playwriterBin?: string | null }} input
 */
export function deletePlaywriterSession(input) {
  const result = runPlaywriter(resolvePlaywriterBin(input.playwriterBin), ["session", "delete", input.sessionId]);
  return {
    ok: result.exitStatus === 0,
    exitStatus: result.exitStatus,
    stdout: compact(result.stdout, 400),
    stderr: compact(result.stderr, 400),
  };
}

/**
 * @param {string | null | undefined} playwriterBin
 */
function resolvePlaywriterBin(playwriterBin) {
  const candidate = playwriterBin || DEFAULT_PLAYWRITER_BIN;
  if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
    return candidate;
  }
  return candidate;
}

/**
 * @param {string} playwriterBin
 */
function listPlaywriterSessions(playwriterBin) {
  const result = runPlaywriter(playwriterBin, ["session", "list"]);
  return {
    exitStatus: result.exitStatus,
    records: parsePlaywriterSessionList(result.stdout),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * @param {string} playwriterBin
 * @param {string} sessionId
 * @param {{ browserKey: string, userName: string | null }} binding
 */
function validatePlaywriterSession(playwriterBin, sessionId, binding) {
  const listed = listPlaywriterSessions(playwriterBin);
  const selected = listed.records.find((record) => record.sessionId === sessionId) ?? null;
  if (!selected) {
    return {
      ok: false,
      reason: `Playwriter session ${sessionId} was created but is not visible in session list.`,
      selected: null,
    };
  }
  if (selected.browserKey !== binding.browserKey) {
    return {
      ok: false,
      reason: `Playwriter session ${sessionId} bound ${selected.browserKey}, expected ${binding.browserKey}.`,
      selected,
    };
  }
  if (binding.userName && selected.profile !== binding.userName) {
    return {
      ok: false,
      reason: `Playwriter session ${sessionId} bound profile ${selected.profile}, expected ${binding.userName}.`,
      selected,
    };
  }
  return {
    ok: true,
    reason: null,
    selected,
  };
}

/**
 * @param {string} playwriterBin
 * @param {string} sessionId
 * @param {string} targetUrl
 */
function probePlaywriterSessionPage(playwriterBin, sessionId, targetUrl) {
  const script = [
    "state.page = context.pages().find((p) => p.url() === 'about:blank') ?? context.pages()[0] ?? await context.newPage();",
    `await state.page.goto(${JSON.stringify(targetUrl)}, { waitUntil: 'domcontentloaded', timeout: 45000 });`,
    "console.log('page-ok:' + state.page.url());",
  ].join(" ");
  const result = runPlaywriter(playwriterBin, ["-s", sessionId, "--timeout", "45000", "-e", script]);
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return {
    ok: result.exitStatus === 0 && /page-ok:/i.test(combined),
    exitStatus: result.exitStatus,
    stdout: compact(result.stdout, 500),
    stderr: compact(result.stderr, 500),
    error: result.exitStatus === 0 && /page-ok:/i.test(combined)
      ? null
      : combined || "Playwriter page probe failed.",
  };
}

/**
 * @param {string} playwriterBin
 * @param {string} sessionId
 * @param {string} targetUrl
 */
function probePlaywriterSessionPageWithRetry(playwriterBin, sessionId, targetUrl) {
  let probe = probePlaywriterSessionPage(playwriterBin, sessionId, targetUrl);
  if (probe.ok || pageProbeNeedsWindowPreflight(probe) || pageProbeNeedsFreshSession(probe)) {
    return probe;
  }

  for (let attempt = 2; attempt <= 3; attempt += 1) {
    if (!shouldRetryTransientPlaywriterPageProbe(probe)) {
      break;
    }
    sleepMs(750 * attempt);
    const nextProbe = probePlaywriterSessionPage(playwriterBin, sessionId, targetUrl);
    if (nextProbe.ok) {
      return {
        ...nextProbe,
        retryCount: attempt - 1,
      };
    }
    probe = nextProbe;
  }

  return probe;
}

/**
 * @param {string} profileDirectory
 * @param {string} targetUrl
 */
function ensureChromeProfileWindow(profileDirectory, targetUrl) {
  if (!profileDirectory) {
    return {
      attempted: false,
      ok: false,
      reason: "missing_profile_directory",
    };
  }
  const args = fs.existsSync(CHROME_APP)
    ? [
      CHROME_APP,
      `--profile-directory=${profileDirectory}`,
      `--allowlisted-extension-id=${PLAYWRITER_EXTENSION_ID}`,
      "--auto-accept-this-tab-capture",
      targetUrl,
    ]
    : [
      "open",
      "-a",
      "Google Chrome",
      "--args",
      `--profile-directory=${profileDirectory}`,
      `--allowlisted-extension-id=${PLAYWRITER_EXTENSION_ID}`,
      "--auto-accept-this-tab-capture",
      targetUrl,
    ];
  const command = args[0];
  try {
    const result = execFileSync(command, args.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: CHROME_WINDOW_LAUNCH_TIMEOUT_MS,
    });
    sleepMs(1000);
    return {
      attempted: true,
      ok: true,
      reason: null,
      output: compact(result, 400),
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function cleanupPlaywriterRelay() {
  const pids = listRelayListenerPids();
  if (!pids.length) {
    return {
      attempted: false,
      reason: null,
      listenerPids: [],
    };
  }
  const attempts = [];
  for (const pid of pids) {
    attempts.push(killRelayPid(pid, "TERM"));
  }
  if (listRelayListenerPids().length) {
    for (const pid of listRelayListenerPids()) {
      attempts.push(killRelayPid(pid, "KILL"));
    }
  }
  return {
    attempted: true,
    reason: "stale_relay_cleanup",
    listenerPids: pids,
    attempts,
    remainingListenerPids: listRelayListenerPids(),
  };
}

function listRelayListenerPids() {
  try {
    const output = execFileSync("lsof", [`-tiTCP:${PLAYWRITER_RELAY_PORT}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: RELAY_CLEANUP_COMMAND_TIMEOUT_MS,
    });
    return String(output)
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/**
 * @param {number} pid
 * @param {"TERM"|"KILL"} signal
 */
function killRelayPid(pid, signal) {
  try {
    execFileSync("/bin/kill", [`-${signal}`, String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: RELAY_CLEANUP_COMMAND_TIMEOUT_MS,
    });
    return { pid, signal, ok: true };
  } catch (error) {
    return {
      pid,
      signal,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {string} playwriterBin
 * @param {string[]} args
 */
function runPlaywriter(playwriterBin, args) {
  try {
    const stdout = execFileSync(playwriterBin, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PLAYWRITER_AUTO_ENABLE: "1",
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: PLAYWRITER_SESSION_COMMAND_TIMEOUT_MS,
    });
    return { exitStatus: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      exitStatus: Number(error?.status ?? 1),
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? error?.message ?? ""),
    };
  }
}

/**
 * @param {string} text
 */
function staleRelayError(text) {
  const lowered = String(text ?? "").toLowerCase();
  return STALE_RELAY_PATTERNS.some((pattern) => lowered.includes(pattern));
}

/**
 * @param {string} text
 */
function needsWindowPreflight(text) {
  const lowered = String(text ?? "").toLowerCase();
  return lowered.includes("no current window")
    || lowered.includes("no playwright pages are available")
    || !lowered.includes("extension connected");
}

/**
 * @param {{ error?: string | null }} pageProbe
 */
function pageProbeNeedsWindowPreflight(pageProbe) {
  const lowered = String(pageProbe?.error ?? "").toLowerCase();
  return lowered.includes("no current window")
    || lowered.includes("no playwright pages are available");
}

/**
 * @param {{ error?: string | null }} pageProbe
 */
export function shouldRetryTransientPlaywriterPageProbe(pageProbe) {
  const lowered = String(pageProbe?.error ?? "").toLowerCase();
  return TRANSIENT_PAGE_PROBE_PATTERNS.some((pattern) => lowered.includes(pattern));
}

/**
 * @param {{ error?: string | null }} pageProbe
 */
export function pageProbeNeedsFreshSession(pageProbe) {
  const lowered = String(pageProbe?.error ?? "").toLowerCase();
  return /session\s+\d+\s+not found/.test(lowered)
    || lowered.includes("run 'playwriter session new' first");
}

/**
 * @param {string} filePath
 */
function parseJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * @param {unknown} value
 */
function normalizeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * @param {string | undefined} text
 * @param {number} limit
 */
function compact(text, limit) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
