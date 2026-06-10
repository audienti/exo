// @ts-check

import fs from "node:fs";
import path from "node:path";

export const HOST_STATE_LOCK_STALE_MS = 30_000;
export const HOST_STATE_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
export const HOST_STATE_LOCK_RETRY_DELAY_MS = 25;

/** @param {number} ms */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** @param {string} stateDir */
export function buildAgentHostStateLockDir(stateDir) {
  return `${path.join(stateDir, "agent-host-state.json")}.lock`;
}

/**
 * @template T
 * @param {string} stateDir
 * @param {() => T} fn
 * @returns {T}
 */
export function withAgentHostStateLock(stateDir, fn) {
  const lockDir = buildAgentHostStateLockDir(stateDir);
  const deadline = Date.now() + HOST_STATE_LOCK_ACQUIRE_TIMEOUT_MS;
  let acquired = false;
  while (!acquired) {
    try {
      fs.mkdirSync(path.dirname(lockDir), { recursive: true });
      fs.mkdirSync(lockDir);
      acquired = true;
      break;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }

    try {
      const lockAgeMs = Date.now() - fs.statSync(lockDir).mtimeMs;
      if (lockAgeMs > HOST_STATE_LOCK_STALE_MS) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
    } catch {
      // Lock vanished between mkdir and stat; retry immediately.
      continue;
    }

    if (Date.now() >= deadline) {
      // Proceed without the lock rather than deadlocking the pass; the worst
      // case is the pre-lock behavior (a lost concurrent update).
      break;
    }
    sleepSync(HOST_STATE_LOCK_RETRY_DELAY_MS);
  }

  try {
    return fn();
  } finally {
    if (acquired) {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  }
}
