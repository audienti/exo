// @ts-check

import fs from "node:fs";
import path from "node:path";
import { repairRecordSchema, repairSubmissionSchema } from "../schema/contract-repair.js";

const REPAIR_OVERRIDES_FILENAME = "repair-overrides.jsonl";
const REPAIR_SUBMISSIONS_FILENAME = "repair-submissions.jsonl";
const STORE_LOCK_DIRNAME = "repair-store.lock";
const STORE_LOCK_STALE_MS = 30000;
const STORE_LOCK_TIMEOUT_MS = 5000;
const STORE_LOCK_RETRY_MS = 25;
const DEFAULT_RETENTION_DAYS = 30;

/**
 * @param {string} stateDir
 */
export function resolveRepairStorePaths(stateDir) {
  return {
    overridesPath: path.join(stateDir, REPAIR_OVERRIDES_FILENAME),
    submissionsPath: path.join(stateDir, REPAIR_SUBMISSIONS_FILENAME),
    lockDir: path.join(stateDir, STORE_LOCK_DIRNAME)
  };
}

/**
 * @param {number} ms
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Lanes run concurrently, so every mutation of either JSONL file happens under
 * the same short-lived mkdir lock. Stale locks (crashed holder) are taken over
 * after STORE_LOCK_STALE_MS.
 *
 * @template T
 * @param {string} stateDir
 * @param {() => T} fn
 * @returns {T}
 */
function withRepairStoreLock(stateDir, fn) {
  const { lockDir } = resolveRepairStorePaths(stateDir);
  fs.mkdirSync(stateDir, { recursive: true });
  const deadline = Date.now() + STORE_LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code !== "EEXIST") {
        throw error;
      }
      let lockAgeMs = 0;
      try {
        lockAgeMs = Date.now() - fs.statSync(lockDir).mtimeMs;
      } catch {
        continue;
      }
      if (lockAgeMs > STORE_LOCK_STALE_MS) {
        try {
          fs.rmdirSync(lockDir);
        } catch {
          // another process won the takeover race; keep retrying
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for the contract-repair store lock at ${lockDir}.`);
      }
      sleepSync(STORE_LOCK_RETRY_MS);
    }
  }

  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lockDir);
    } catch {
      // already removed by a stale-lock takeover; nothing to release
    }
  }
}

/**
 * @param {string} filePath
 * @param {import("zod").ZodTypeAny} schema
 * @returns {Array<any>}
 */
function readJsonlRecords(filePath, schema) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const records = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsedJson;
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = schema.safeParse(parsedJson);
    if (parsed.success) {
      records.push(parsed.data);
    }
  }
  return records;
}

/**
 * @param {string} filePath
 * @param {Array<unknown>} records
 */
function writeJsonlRecords(filePath, records) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, body.length ? `${body}\n` : "");
}

/**
 * Numeric-segment version compare; non-numeric segments fall back to string
 * comparison. Returns -1 | 0 | 1.
 *
 * @param {string} left
 * @param {string} right
 */
export function compareExoVersions(left, right) {
  const leftParts = String(left).split(".");
  const rightParts = String(right).split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "0";
    const rightPart = rightParts[index] ?? "0";
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      if (leftNumber !== rightNumber) {
        return leftNumber < rightNumber ? -1 : 1;
      }
      continue;
    }
    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  return 0;
}

/**
 * @param {{ minimum: string, maximum: string }} range
 * @param {string} exoVersion
 */
export function versionRangeIncludes(range, exoVersion) {
  return compareExoVersions(range.minimum, exoVersion) <= 0
    && compareExoVersions(exoVersion, range.maximum) <= 0;
}

/**
 * Active repairs only: schema-valid, version range includes the running
 * EXO_VERSION, and not expired. Everything else is ignored immediately (and
 * garbage-collected later by gcContractRepairStore).
 *
 * @param {{ stateDir: string, exoVersion: string, now?: string | null }} input
 */
export function loadActiveRepairRecords(input) {
  const { overridesPath } = resolveRepairStorePaths(input.stateDir);
  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  return readJsonlRecords(overridesPath, repairRecordSchema).filter((record) =>
    versionRangeIncludes(record.exoVersionRange, input.exoVersion)
    && Date.parse(record.expiresAt) > nowMs
  );
}

/**
 * Exact-match lookup: the stored replacement is a concrete payload generated
 * for one exact input, so contractKind, failureHash, AND inputHash must all
 * match before it may be re-applied.
 *
 * @param {{
 *   records: Array<import("zod").infer<typeof repairRecordSchema>>,
 *   contractKind: string,
 *   inputHash: string,
 *   failureHash: string
 * }} input
 */
export function findMatchingRepairRecord(input) {
  return input.records.find((record) =>
    record.contractKind === input.contractKind
    && record.failureHash === input.failureHash
    && record.inputHash === input.inputHash
  ) ?? null;
}

/**
 * @param {{ stateDir: string, record: unknown }} input
 */
export function appendRepairRecord(input) {
  const record = repairRecordSchema.parse(input.record);
  const { overridesPath } = resolveRepairStorePaths(input.stateDir);
  withRepairStoreLock(input.stateDir, () => {
    fs.appendFileSync(overridesPath, `${JSON.stringify(record)}\n`);
  });
  return record;
}

/**
 * @param {{ stateDir: string, submission: unknown }} input
 */
export function appendRepairSubmission(input) {
  const submission = repairSubmissionSchema.parse(input.submission);
  const { submissionsPath } = resolveRepairStorePaths(input.stateDir);
  withRepairStoreLock(input.stateDir, () => {
    fs.appendFileSync(submissionsPath, `${JSON.stringify(submission)}\n`);
  });
  return submission;
}

/**
 * @param {{ stateDir: string }} input
 */
export function loadRepairSubmissions(input) {
  const { submissionsPath } = resolveRepairStorePaths(input.stateDir);
  return readJsonlRecords(submissionsPath, repairSubmissionSchema);
}

/**
 * @param {{
 *   stateDir: string,
 *   submissionId: string,
 *   submissionStatus: import("zod").infer<typeof repairSubmissionSchema>["submissionStatus"],
 *   submittedAt?: string | null
 * }} input
 */
export function updateRepairSubmissionStatus(input) {
  const { submissionsPath } = resolveRepairStorePaths(input.stateDir);
  return withRepairStoreLock(input.stateDir, () => {
    const submissions = readJsonlRecords(submissionsPath, repairSubmissionSchema);
    let updated = null;
    const next = submissions.map((submission) => {
      if (submission.submissionId !== input.submissionId) {
        return submission;
      }
      updated = {
        ...submission,
        submissionStatus: input.submissionStatus,
        submittedAt: input.submittedAt ?? submission.submittedAt ?? null
      };
      return updated;
    });
    if (updated) {
      writeJsonlRecords(submissionsPath, next);
    }
    return updated;
  });
}

/**
 * Drops repairs that are expired or whose version range no longer includes the
 * running EXO_VERSION, once they are past retention. Submissions are retained
 * until submitted (or disabled) and past retention.
 *
 * @param {{ stateDir: string, exoVersion: string, now?: string | null, retentionDays?: number }} input
 */
export function gcContractRepairStore(input) {
  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  const retentionMs = (input.retentionDays ?? DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000;
  const { overridesPath, submissionsPath } = resolveRepairStorePaths(input.stateDir);

  return withRepairStoreLock(input.stateDir, () => {
    const records = readJsonlRecords(overridesPath, repairRecordSchema);
    const keptRecords = records.filter((record) => {
      const stale = !versionRangeIncludes(record.exoVersionRange, input.exoVersion)
        || Date.parse(record.expiresAt) <= nowMs;
      if (!stale) {
        return true;
      }
      return nowMs - Date.parse(record.createdAt) < retentionMs;
    });
    if (keptRecords.length !== records.length) {
      writeJsonlRecords(overridesPath, keptRecords);
    }

    const submissions = readJsonlRecords(submissionsPath, repairSubmissionSchema);
    const keptSubmissions = submissions.filter((submission) => {
      const settled = submission.submissionStatus === "submitted" || submission.submissionStatus === "disabled";
      if (!settled) {
        return true;
      }
      return nowMs - Date.parse(submission.createdAt) < retentionMs;
    });
    if (keptSubmissions.length !== submissions.length) {
      writeJsonlRecords(submissionsPath, keptSubmissions);
    }

    return {
      recordsRemoved: records.length - keptRecords.length,
      submissionsRemoved: submissions.length - keptSubmissions.length
    };
  });
}
