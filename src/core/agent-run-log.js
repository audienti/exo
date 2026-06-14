// @ts-check

import fs from "node:fs";
import path from "node:path";

import { pruneExpiredBrowserBackoffs } from "../lib/agent-host-state.js";
import { getTaskExecutionLane } from "../lib/agent-task-lanes.js";

const HOST_STATE_FILE = "agent-host-state.json";
const LAST_PASS_FILE = "agent-last-pass.json";
const AGENT_LOG_FILE = "agent.log";
const LANE_PASS_RE = /^agent-last-pass\.([^.]+)\.json$/;
const AGENT_LOG_TAIL_BYTES = 1024 * 1024;

/**
 * @param {{
 *   stateDir: string,
 *   limit?: number | string | null,
 *   now?: string | null,
 * }} input
 */
export function buildAgentRunLog(input) {
  const checkedAt = normalizeIsoDatetime(input.now) ?? new Date().toISOString();
  const stateDir = input.stateDir;
  const limit = normalizeLimit(input.limit);
  const warnings = [];
  const artifacts = {
    hostState: buildArtifactState(path.join(stateDir, HOST_STATE_FILE), "agent-host-state"),
    lastPass: buildArtifactState(path.join(stateDir, LAST_PASS_FILE), "agent-last-pass"),
    agentLog: buildArtifactState(path.join(stateDir, AGENT_LOG_FILE), "agent.log"),
  };
  const entries = [];

  const lastPass = readJsonArtifact(artifacts.lastPass, warnings);
  if (lastPass) {
    entries.push(...buildPassEntries(lastPass, {
      kind: "agent-last-pass",
      path: artifacts.lastPass.path,
    }));
  }

  for (const laneArtifact of readLanePassArtifacts(stateDir)) {
    const lanePass = readJsonArtifact(laneArtifact, warnings);
    if (!lanePass) continue;
    entries.push(...buildPassEntries({
      ...lanePass,
      lane: normalizeText(lanePass.lane) ?? laneArtifact.lane,
    }, {
      kind: "agent-last-pass",
      path: laneArtifact.path,
      lane: laneArtifact.lane,
    }));
  }

  const hostState = readJsonArtifact(artifacts.hostState, warnings);
  if (hostState) {
    entries.push(...buildHostStateEntries(hostState, artifacts.hostState.path, checkedAt));
  }

  if (artifacts.agentLog.exists) {
    entries.push(...buildAgentLogEntries(artifacts.agentLog.path, warnings));
  }

  const sortedEntries = dedupeEntries(entries)
    .sort(compareEntriesNewestFirst)
    .slice(0, limit);

  return {
    checkedAt,
    stateDir,
    entries: sortedEntries,
    artifacts,
    warnings,
  };
}

/**
 * @param {string} filePath
 * @param {string} kind
 */
function buildArtifactState(filePath, kind) {
  return {
    kind,
    path: filePath,
    exists: fs.existsSync(filePath),
  };
}

/** @param {string} stateDir */
function readLanePassArtifacts(stateDir) {
  if (!fs.existsSync(stateDir)) return [];
  return fs.readdirSync(stateDir)
    .map((filename) => {
      const match = filename.match(LANE_PASS_RE);
      if (!match) return null;
      return {
        kind: "agent-last-pass",
        path: path.join(stateDir, filename),
        exists: true,
        lane: match[1],
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(left?.lane ?? "").localeCompare(String(right?.lane ?? "")));
}

/**
 * @param {{ kind: string, path: string, exists: boolean }} artifact
 * @param {Array<{ sourceArtifact: any, message: string }>} warnings
 */
function readJsonArtifact(artifact, warnings) {
  if (!artifact.exists) return null;
  try {
    return JSON.parse(fs.readFileSync(artifact.path, "utf8"));
  } catch (error) {
    warnings.push({
      sourceArtifact: {
        kind: artifact.kind,
        path: artifact.path,
      },
      message: `Malformed ${artifact.kind} artifact ignored: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

/**
 * @param {any} pass
 * @param {{ kind: string, path: string, lane?: string | null }} sourceArtifact
 */
function buildPassEntries(pass, sourceArtifact) {
  if (!pass || typeof pass !== "object") return [];
  const entries = [];
  const mergedEntry = buildPassEntry(pass, sourceArtifact);
  if (mergedEntry) entries.push(mergedEntry);

  if (Array.isArray(pass.lanes)) {
    for (const lanePass of pass.lanes) {
      const entry = buildPassEntry(lanePass, {
        ...sourceArtifact,
        lane: normalizeText(lanePass?.lane) ?? null,
      });
      if (entry) entries.push(entry);
    }
  }

  return entries;
}

/**
 * @param {any} pass
 * @param {{ kind: string, path: string, lane?: string | null, lineStart?: number | null, lineEnd?: number | null }} sourceArtifact
 */
function buildPassEntry(pass, sourceArtifact) {
  const startedAt = normalizeIsoDatetime(pass?.startedAt);
  const endedAt = normalizeIsoDatetime(pass?.endedAt);
  const timestamp = endedAt ?? startedAt;
  const results = normalizeResults(pass?.results);
  const resultCounts = buildResultCounts(results);
  const runtimeTruth = buildRuntimeTruth(results);
  const taskKinds = [...new Set(results.map((result) => result.kind).filter(Boolean))];
  const taskKind = taskKinds.length === 0
    ? null
    : taskKinds.length === 1
      ? taskKinds[0]
      : "multiple";
  const status = normalizeText(pass?.status) ?? inferPassStatus(resultCounts);

  if (!timestamp && !status && resultCounts.total === 0) return null;

  const runId = normalizeText(pass?.runId) ?? normalizeText(pass?.id);
  const lane = normalizeText(pass?.lane) ?? normalizeText(sourceArtifact.lane) ?? null;
  const source = {
    kind: sourceArtifact.kind,
    path: sourceArtifact.path,
    ...(sourceArtifact.lane ? { lane: sourceArtifact.lane } : {}),
    ...(sourceArtifact.lineStart ? { lineStart: sourceArtifact.lineStart } : {}),
    ...(sourceArtifact.lineEnd ? { lineEnd: sourceArtifact.lineEnd } : {}),
  };

  return {
    id: runId ?? buildEntryId(sourceArtifact.kind, lane, taskKind, timestamp, sourceArtifact.path),
    runId,
    timestamp,
    startedAt,
    endedAt,
    status,
    lane,
    taskKind,
    taskKinds,
    resultCounts,
    queueCounts: normalizeQueueCounts(pass?.finalQueueCounts),
    runtimeTruth,
    reason: normalizeText(pass?.reason),
    sourceArtifact: source,
  };
}

/**
 * @param {any} hostState
 * @param {string} artifactPath
 * @param {string} now
 */
function buildHostStateEntries(hostState, artifactPath, now) {
  const normalized = pruneExpiredBrowserBackoffs(hostState, now);
  const entries = [];

  for (const lease of normalized.taskLeases ?? []) {
    const startedAt = normalizeIsoDatetime(lease?.acquiredAt);
    if (!startedAt) continue;
    const taskKind = normalizeText(lease?.taskKind);
    entries.push({
      id: buildEntryId("agent-host-state", getTaskExecutionLane(taskKind), taskKind, startedAt, lease?.fingerprint),
      runId: null,
      timestamp: startedAt,
      startedAt,
      endedAt: null,
      status: "running",
      lane: getTaskExecutionLane(taskKind),
      taskKind,
      taskKinds: taskKind ? [taskKind] : [],
      resultCounts: buildSingleResultCounts("running", taskKind),
      queueCounts: null,
      reason: null,
      sourceArtifact: {
        kind: "agent-host-state",
        path: artifactPath,
        section: "taskLeases",
      },
      workerLabel: normalizeText(lease?.workerLabel),
      subject: normalizeText(lease?.subject),
      action: normalizeText(lease?.action),
      expiresAt: normalizeIsoDatetime(lease?.expiresAt),
      checkoutFingerprint: normalizeText(lease?.fingerprint),
      motionId: normalizeText(lease?.motionId),
      companyId: normalizeText(lease?.companyId),
      prospectId: normalizeText(lease?.prospectId),
      userId: normalizeText(lease?.userId),
      accountId: normalizeText(lease?.accountId),
      capability: normalizeText(lease?.capability),
      surface: normalizeText(lease?.surface),
    });
  }

  for (const entry of normalized.recentMotionTaskRuns ?? []) {
    const timestamp = normalizeIsoDatetime(entry?.recordedAt);
    if (!timestamp) continue;
    const taskKind = normalizeText(entry?.taskKind);
    const status = normalizeText(entry?.status) ?? "recorded";
    entries.push({
      id: buildEntryId("agent-host-state", null, taskKind, timestamp, entry?.motionId),
      runId: null,
      timestamp,
      startedAt: null,
      endedAt: timestamp,
      status,
      lane: null,
      taskKind,
      taskKinds: taskKind ? [taskKind] : [],
      resultCounts: buildSingleResultCounts(status, taskKind),
      queueCounts: null,
      reason: null,
      sourceArtifact: {
        kind: "agent-host-state",
        path: artifactPath,
        section: "recentMotionTaskRuns",
      },
      motionId: normalizeText(entry?.motionId),
      companyId: normalizeText(entry?.companyId),
      prospectId: normalizeText(entry?.prospectId),
    });
  }

  for (const entry of normalized.recentTaskVerifications ?? []) {
    const timestamp = normalizeIsoDatetime(entry?.verifiedAt);
    if (!timestamp) continue;
    const taskKind = normalizeText(entry?.taskKind);
    const status = normalizeText(entry?.verificationStatus) ?? "verified";
    entries.push({
      id: buildEntryId("agent-host-state", null, taskKind, timestamp, entry?.fingerprint),
      runId: null,
      timestamp,
      startedAt: null,
      endedAt: timestamp,
      status,
      lane: null,
      taskKind,
      taskKinds: taskKind ? [taskKind] : [],
      resultCounts: buildSingleResultCounts(status, taskKind),
      queueCounts: null,
      reason: null,
      sourceArtifact: {
        kind: "agent-host-state",
        path: artifactPath,
        section: "recentTaskVerifications",
      },
      motionId: normalizeText(entry?.motionId),
      companyId: normalizeText(entry?.companyId),
      prospectId: normalizeText(entry?.prospectId),
    });
  }

  return entries;
}

/**
 * @param {string} logPath
 * @param {Array<{ sourceArtifact: any, message: string }>} warnings
 */
function buildAgentLogEntries(logPath, warnings) {
  const entries = [];
  const lines = readAgentLogTailLines(logPath);
  let buffer = [];
  let startLine = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (!buffer.length) {
      if (!line.startsWith("{")) continue;
      buffer = [line];
      startLine = lineNumber;
    } else if (line.startsWith("{")) {
      warnings.push(buildMalformedLogWarning(logPath, startLine, lineNumber - 1));
      buffer = [line];
      startLine = lineNumber;
    } else {
      buffer.push(line);
    }

    try {
      const parsed = JSON.parse(buffer.join("\n"));
      const entry = buildPassEntry(parsed, {
        kind: "agent.log",
        path: logPath,
        lineStart: startLine,
        lineEnd: lineNumber,
      });
      if (entry) entries.push(entry);
      buffer = [];
      startLine = null;
    } catch {
      // The scheduled runner writes pretty JSON, so keep buffering until the
      // object closes or a new top-level JSON object starts.
    }
  }

  if (buffer.length) {
    warnings.push(buildMalformedLogWarning(logPath, startLine, lines.length));
  }

  return entries;
}

/** @param {string} logPath */
function readAgentLogTailLines(logPath) {
  const stat = fs.statSync(logPath);
  if (stat.size <= AGENT_LOG_TAIL_BYTES) {
    return fs.readFileSync(logPath, "utf8").split(/\r?\n/);
  }

  const fd = fs.openSync(logPath, "r");
  try {
    const start = Math.max(0, stat.size - AGENT_LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    return start > 0 ? lines.slice(1) : lines;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @param {string} logPath
 * @param {number | null} lineStart
 * @param {number} lineEnd
 */
function buildMalformedLogWarning(logPath, lineStart, lineEnd) {
  return {
    sourceArtifact: {
      kind: "agent.log",
      path: logPath,
      ...(lineStart ? { lineStart } : {}),
      lineEnd,
    },
    message: "Malformed agent.log JSON block ignored.",
  };
}

/** @param {any} results */
function normalizeResults(results) {
  if (!Array.isArray(results)) return [];
  return results.map((result) => ({
    kind: normalizeText(result?.kind),
    status: normalizeText(result?.status),
    detail: normalizeResultDetail(result?.detail),
  }));
}

/** @param {any} detail */
function normalizeResultDetail(detail) {
  if (!detail || typeof detail !== "object") return {};
  return {
    transport: normalizeText(detail.transport),
    fallbackFrom: normalizeText(detail.fallbackFrom),
    configReason: normalizeText(detail.configReason)
      ?? normalizeText(detail.backoffReason)
      ?? inferConfigReason(detail),
    surfaceError: normalizeText(detail.surfaceError),
    captureError: normalizeText(detail.captureError),
    reason: normalizeText(detail.reason),
    reasonCode: normalizeText(detail.reasonCode),
    blockReason: normalizeText(detail.blockReason),
    directUnipileFailureReason: normalizeText(detail.directUnipileFailureReason),
    directUnipileUnsupportedReason: normalizeText(detail.directUnipileUnsupportedReason),
  };
}

/** @param {any} detail */
function inferConfigReason(detail) {
  const text = [
    detail?.surfaceError,
    detail?.captureError,
    detail?.reason,
    detail?.directUnipileFailureReason,
    detail?.directUnipileUnsupportedReason,
  ].map((value) => normalizeText(value)).filter(Boolean).join(" ");
  if (/configured Unipile base URL|missing_unipile_base_url/i.test(text)) {
    return "missing_unipile_base_url";
  }
  if (/Unipile API key|missing_unipile_api_key/i.test(text)) {
    return "missing_unipile_api_key";
  }
  if (/providerAccountId|provider account id|missing_provider_account_id/i.test(text)) {
    return "missing_provider_account_id";
  }
  return null;
}

/** @param {Array<{ kind: string | null, status: string | null, detail: Record<string, any> }>} results */
function buildRuntimeTruth(results) {
  const transports = [];
  const configReasons = [];

  for (const result of results) {
    if (result.detail.transport) {
      transports.push({
        taskKind: result.kind,
        status: result.status,
        transport: result.detail.transport,
        fallbackFrom: result.detail.fallbackFrom ?? null,
      });
    }

    if (result.detail.configReason) {
      configReasons.push({
        taskKind: result.kind,
        status: result.status,
        reason: result.detail.configReason,
        message: result.detail.surfaceError
          ?? result.detail.captureError
          ?? result.detail.reason
          ?? result.detail.directUnipileFailureReason
          ?? result.detail.directUnipileUnsupportedReason
          ?? null,
      });
    }
  }

  return { transports, configReasons };
}

/** @param {Array<{ kind: string | null, status: string | null }>} results */
function buildResultCounts(results) {
  const counts = {
    total: results.length,
    completed: 0,
    blocked: 0,
    failed: 0,
    noop: 0,
    partial: 0,
    byKind: [],
    byStatus: [],
  };
  const byKind = new Map();
  const byStatus = new Map();

  for (const result of results) {
    const status = result.status ?? "unknown";
    const kind = result.kind ?? "unknown";
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    if (status in counts) {
      counts[status] += 1;
    }
  }

  counts.byKind = [...byKind.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
  counts.byStatus = [...byStatus.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => left.status.localeCompare(right.status));

  return counts;
}

/**
 * @param {string} status
 * @param {string | null} taskKind
 */
function buildSingleResultCounts(status, taskKind) {
  return buildResultCounts([{ status, kind: taskKind }]);
}

/** @param {ReturnType<typeof buildResultCounts>} counts */
function inferPassStatus(counts) {
  if (counts.failed > 0) return "failed";
  if (counts.blocked > 0) return "blocked";
  if (counts.completed > 0) return "completed";
  return counts.total > 0 ? "recorded" : null;
}

/** @param {any} queueCounts */
function normalizeQueueCounts(queueCounts) {
  if (!queueCounts || typeof queueCounts !== "object") return null;
  const readyTaskCount = normalizeNonNegativeInteger(queueCounts.readyTaskCount)
    ?? normalizeNonNegativeInteger(queueCounts.dueTaskCount)
    ?? 0;
  const waitingTaskCount = normalizeNonNegativeInteger(queueCounts.waitingTaskCount) ?? 0;
  const blockerCount = normalizeNonNegativeInteger(queueCounts.blockerCount) ?? 0;
  const partialTaskCount = normalizeNonNegativeInteger(queueCounts.partialTaskCount)
    ?? normalizeNonNegativeInteger(queueCounts.statusCounts?.partial)
    ?? 0;
  const statusCounts = {
    ready: normalizeNonNegativeInteger(queueCounts.statusCounts?.ready) ?? readyTaskCount,
    waiting: normalizeNonNegativeInteger(queueCounts.statusCounts?.waiting) ?? waitingTaskCount,
    blocked: normalizeNonNegativeInteger(queueCounts.statusCounts?.blocked) ?? blockerCount,
    partial: normalizeNonNegativeInteger(queueCounts.statusCounts?.partial) ?? partialTaskCount,
    readyIncludesWaiting: queueCounts.statusCounts?.readyIncludesWaiting === true,
  };
  return {
    dueTaskCount: normalizeNonNegativeInteger(queueCounts.dueTaskCount) ?? readyTaskCount,
    readyTaskCount,
    waitingTaskCount,
    blockerCount,
    partialTaskCount,
    statusCounts,
  };
}

/** @param {Array<any>} entries */
function dedupeEntries(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    byKey.set(`${entry.sourceArtifact.kind}:${entry.sourceArtifact.path}:${entry.id}`, entry);
  }
  return [...byKey.values()];
}

/**
 * @param {any} left
 * @param {any} right
 */
function compareEntriesNewestFirst(left, right) {
  const leftTimestamp = left.timestamp ?? left.endedAt ?? left.startedAt ?? "";
  const rightTimestamp = right.timestamp ?? right.endedAt ?? right.startedAt ?? "";
  return rightTimestamp.localeCompare(leftTimestamp)
    || String(right.id ?? "").localeCompare(String(left.id ?? ""));
}

/**
 * @param {string} sourceKind
 * @param {string | null} lane
 * @param {string | null} taskKind
 * @param {string | null} timestamp
 * @param {unknown} fallback
 */
function buildEntryId(sourceKind, lane, taskKind, timestamp, fallback) {
  return [sourceKind, lane, taskKind, timestamp, normalizeText(fallback)]
    .filter(Boolean)
    .join(":");
}

/** @param {unknown} value */
function normalizeIsoDatetime(value) {
  if (typeof value !== "string" || !value.trim().length) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** @param {unknown} value */
function normalizeText(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

/** @param {unknown} value */
function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.floor(number);
}

/** @param {unknown} value */
function normalizeLimit(value) {
  const limit = normalizeNonNegativeInteger(value);
  return limit && limit > 0 ? limit : 25;
}
