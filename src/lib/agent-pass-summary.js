// @ts-check

import fs from "node:fs";
import path from "node:path";

import { withAgentHostStateLock } from "./agent-host-state-lock.js";

const LEGACY_PASS_SUMMARY_FILE = "agent-last-pass.json";
const LANE_PASS_SUMMARY_RE = /^agent-last-pass\.([^.]+)\.json$/;

// Worst lane status wins the merged pass status.
const PASS_STATUS_SEVERITY = ["failed", "blocked", "mixed", "partial", "completed", "noop"];

/**
 * Merge per-lane host-pass summaries into the legacy whole-host summary shape.
 * @param {any[]} laneSummaries
 */
export function mergeLanePassSummaries(laneSummaries) {
  const lanes = (laneSummaries ?? []).filter(Boolean);
  if (lanes.length === 1) {
    return { ...lanes[0], lanes };
  }

  const status = PASS_STATUS_SEVERITY.find((candidate) => lanes.some((lane) => lane?.status === candidate))
    ?? "noop";
  const reasonLanes = lanes.some((lane) => lane?.status && lane.status !== "noop")
    ? lanes.filter((lane) => lane?.status !== "noop")
    : lanes;
  const distinctReasons = [...new Set(reasonLanes.map((lane) => lane?.reason).filter(Boolean))];
  const reason = distinctReasons.length <= 1
    ? distinctReasons[0] ?? null
    : reasonLanes
      .filter((lane) => lane?.reason)
      .map((lane) => `${lane.lane ?? "lane"}: ${lane.reason}`)
      .join(" | ");
  const startedAt = lanes.map((lane) => lane?.startedAt).filter(Boolean).sort()[0] ?? null;
  const endedAt = lanes.map((lane) => lane?.endedAt).filter(Boolean).sort().at(-1) ?? null;
  // The lane that finished last saw the freshest queue.
  const freshestQueueLane = lanes
    .filter((lane) => lane?.finalQueueCounts)
    .sort((left, right) => String(left?.endedAt ?? "").localeCompare(String(right?.endedAt ?? "")))
    .at(-1);
  const packetReviewWarnings = mergePacketReviewWarnings(lanes);

  return {
    status,
    reason,
    startedAt,
    endedAt,
    lanes,
    results: lanes.flatMap((lane) => (Array.isArray(lane?.results) ? lane.results : [])),
    finalQueueCounts: freshestQueueLane?.finalQueueCounts
      ?? { dueTaskCount: 0, waitingTaskCount: 0, blockerCount: 0 },
    browserReady: lanes.find((lane) => lane?.browserReady !== undefined)?.browserReady,
    preflightPath: lanes.find((lane) => lane?.preflightPath)?.preflightPath ?? null,
    ...(packetReviewWarnings ? { packetReviewWarnings } : {}),
  };
}

/**
 * @param {{ stateDir: string, summary: any, lane?: string | null }} input
 */
export function writeAgentPassSummary(input) {
  const lane = normalizeLane(input.lane ?? input.summary?.lane ?? null);
  return withAgentHostStateLock(input.stateDir, () => {
    const summary = lane ? { ...input.summary, lane } : input.summary;
    writeJsonFile(buildAgentPassSummaryPath(input.stateDir, lane), summary);
    if (!lane) {
      return summary;
    }
    return refreshMergedAgentPassSummaryUnlocked(input.stateDir);
  });
}

/** @param {string} stateDir */
export function refreshMergedAgentPassSummary(stateDir) {
  return withAgentHostStateLock(stateDir, () => refreshMergedAgentPassSummaryUnlocked(stateDir));
}

/**
 * @param {string} stateDir
 * @param {string | null} [lane]
 */
export function buildAgentPassSummaryPath(stateDir, lane = null) {
  const normalizedLane = normalizeLane(lane);
  return path.join(stateDir, normalizedLane ? `agent-last-pass.${normalizedLane}.json` : LEGACY_PASS_SUMMARY_FILE);
}

/** @param {string} stateDir */
function refreshMergedAgentPassSummaryUnlocked(stateDir) {
  const laneSummaries = readLanePassSummaries(stateDir);
  if (!laneSummaries.length) return null;
  const merged = mergeLanePassSummaries(laneSummaries);
  writeJsonFile(buildAgentPassSummaryPath(stateDir), merged);
  return merged;
}

/** @param {string} stateDir */
function readLanePassSummaries(stateDir) {
  if (!fs.existsSync(stateDir)) return [];
  return fs.readdirSync(stateDir)
    .map((filename) => {
      const match = filename.match(LANE_PASS_SUMMARY_RE);
      if (!match) return null;
      const summary = readJsonIfExists(path.join(stateDir, filename));
      if (!summary) return null;
      return { ...summary, lane: normalizeLane(summary.lane) ?? match[1] };
    })
    .filter(Boolean)
    .sort((left, right) => String(left?.lane ?? "").localeCompare(String(right?.lane ?? "")));
}

/**
 * @param {string} filePath
 * @param {any} payload
 */
function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

/** @param {string} filePath */
function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {any[]} lanes
 */
function mergePacketReviewWarnings(lanes) {
  const warningSets = lanes
    .map((lane) => lane?.packetReviewWarnings)
    .filter((warnings) => warnings && typeof warnings === "object");
  if (!warningSets.length) return null;

  const itemById = new Map();
  for (const warningSet of warningSets) {
    for (const item of Array.isArray(warningSet.items) ? warningSet.items : []) {
      if (!item?.id) continue;
      itemById.set(item.id, item);
    }
  }
  const items = [...itemById.values()]
    .sort((left, right) =>
      String(left.submittedAt ?? "").localeCompare(String(right.submittedAt ?? ""))
      || String(left.id ?? "").localeCompare(String(right.id ?? ""))
    );
  const first = warningSets[0];
  const oldest = items[0] ?? null;

  return {
    kind: first.kind ?? "stale_packet_reviews",
    thresholdHours: first.thresholdHours ?? null,
    thresholdSeconds: first.thresholdSeconds ?? null,
    count: items.length,
    oldestSubmittedAt: oldest?.submittedAt ?? null,
    oldestAgeSeconds: oldest?.ageSeconds ?? null,
    oldestAgeLabel: oldest?.ageLabel ?? null,
    items,
  };
}

/** @param {unknown} lane */
function normalizeLane(lane) {
  return typeof lane === "string" && lane.trim().length ? lane.trim() : null;
}
