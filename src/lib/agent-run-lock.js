// @ts-check

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { buildLaunchAgentLabel } from "./agent-routine.js";

const DEFAULT_AGENT_RUN_LOCK_ROOT = "/tmp";

/**
 * @param {{ username?: string | null, tempDir?: string | null, stateDir?: string | null, lane?: string | null }} [input]
 */
export function buildAgentRunLockDir(input = {}) {
  const username = input.username?.trim() || os.userInfo().username;
  const envTempDir = typeof process.env.EXO_AGENT_RUN_LOCK_TEMP_DIR === "string"
    ? process.env.EXO_AGENT_RUN_LOCK_TEMP_DIR.trim()
    : "";
  const tempDir = input.tempDir?.trim() || envTempDir || DEFAULT_AGENT_RUN_LOCK_ROOT;
  const stateSuffix = buildStateDirSuffix(input.stateDir);
  // Each execution lane holds its own lock so a transport pass and a research
  // pass can run concurrently; the lane-less form is the legacy whole-host lock.
  const laneSuffix = input.lane?.trim() ? `.${input.lane.trim()}` : "";
  return path.join(tempDir, `${buildLaunchAgentLabel(username)}${stateSuffix}${laneSuffix}.lock`);
}

/**
 * @param {{ username?: string | null, tempDir?: string | null, stateDir?: string | null, lane?: string | null }} [input]
 */
export function inspectAgentRunLock(input = {}) {
  const lockDir = buildAgentRunLockDir(input);
  const pidPath = path.join(lockDir, "pid");
  if (!fs.existsSync(lockDir)) {
    return {
      exists: false,
      active: false,
      stale: false,
      lockDir,
      pidPath,
      pid: null,
    };
  }

  const pid = readLockPid(pidPath);
  const active = pid != null && isPidAlive(pid);
  return {
    exists: true,
    active,
    stale: !active,
    lockDir,
    pidPath,
    pid: active ? pid : null,
  };
}

/**
 * @param {{ username?: string | null, tempDir?: string | null, stateDir?: string | null, lane?: string | null, pid?: number | null }} [input]
 */
export function tryAcquireAgentRunLock(input = {}) {
  const lockDir = buildAgentRunLockDir(input);
  const pidPath = path.join(lockDir, "pid");
  const pid = Number.isFinite(input.pid) ? Number(input.pid) : process.pid;

  const attempt = () => {
    fs.mkdirSync(path.dirname(lockDir), { recursive: true });
    fs.mkdirSync(lockDir);
    fs.writeFileSync(pidPath, `${pid}\n`, "utf8");
    return {
      acquired: true,
      lockDir,
      pidPath,
      pid,
    };
  };

  try {
    return attempt();
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  const existing = inspectAgentRunLock(input);
  if (existing.active) {
    return {
      acquired: false,
      reason: "already_active",
      ...existing,
    };
  }

  fs.rmSync(lockDir, { recursive: true, force: true });
  try {
    return attempt();
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    return {
      acquired: false,
      reason: "already_active",
      ...inspectAgentRunLock(input),
    };
  }
}

/**
 * @param {{ lockDir?: string | null }} lock
 */
export function releaseAgentRunLock(lock) {
  const lockDir = lock?.lockDir?.trim();
  if (!lockDir) return;
  fs.rmSync(lockDir, { recursive: true, force: true });
}

/**
 * @param {string} pidPath
 */
function readLockPid(pidPath) {
  if (!fs.existsSync(pidPath)) return null;
  const raw = fs.readFileSync(pidPath, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** @param {unknown} error */
function isAlreadyExistsError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

/** @param {number} pid */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string | null | undefined} stateDir
 */
function buildStateDirSuffix(stateDir) {
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
