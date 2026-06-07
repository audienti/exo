// @ts-check
//
// Discovery for a running Exo UI server. `exo ui` writes a lockfile under the
// state dir on start and removes it on exit; another agent can read it (and
// probe the port) to learn whether the UI is already up, and where — instead of
// blindly starting a second one.

import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "../db/paths.js";

export const UI_LOCK_VERSION = 1;
export const DEFAULT_UI_STATUS_TIMEOUT_MS = 5000;

/** @returns {string} */
export function getUiLockPath() {
  return path.join(getStateDir(), "ui.lock");
}

/**
 * @param {{ host: string, port: number, url: string, userId: string | null }} info
 */
export function writeUiLock(info) {
  const lockPath = getUiLockPath();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload = {
    version: UI_LOCK_VERSION,
    service: "exo-ui",
    pid: process.pid,
    host: info.host,
    port: info.port,
    url: info.url,
    userId: info.userId,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

export function removeUiLock() {
  try {
    fs.rmSync(getUiLockPath(), { force: true });
  } catch {
    // best-effort
  }
}

/**
 * @returns {{ version?: number, service?: string, pid?: number, host?: string, port?: number, url?: string, userId?: string | null, startedAt?: string } | null}
 */
export function readUiLock() {
  try {
    const raw = fs.readFileSync(getUiLockPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Is the process referenced by the lock still alive?
 * @param {number | undefined} pid
 */
export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = no such process; EPERM = exists but not ours (still alive).
    return /** @type {any} */ (error)?.code === "EPERM";
  }
}

/**
 * Probe the UI's /status endpoint to confirm it is actually serving.
 * @param {string} url  base url, e.g. http://127.0.0.1:4317/
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<any | null>}
 */
export async function probeUiStatus(url, options = {}) {
  if (typeof fetch !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_UI_STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/status", url), { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
