// @ts-check

import path from "node:path";

import { pruneExpiredBrowserBackoffs } from "../lib/agent-host-state.js";
import { inspectAgentRunLock } from "../lib/agent-run-lock.js";
import { AGENT_EXECUTION_LANES, getTaskExecutionLane } from "../lib/agent-task-lanes.js";
import { buildUserInboundSyncView } from "./user-inbound-sync.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{
 *   stateDir: string,
 *   queue?: { tasks?: any[], waiting?: any[], blockers?: any[], count?: number, waitingCount?: number } | null,
 *   hostState?: any,
 *   users?: any[],
 *   lastPass?: any,
 *   now?: string,
 * }} input
 */
export function buildAgentStatusReport(input) {
  const now = normalizeIsoDatetime(input.now) ?? new Date().toISOString();
  const queue = normalizeQueue(input.queue);
  const hostState = pruneExpiredBrowserBackoffs(input.hostState ?? null, now);
  const activeTasks = buildActiveTaskSummaries(queue, hostState, now);
  const lockSummary = buildRunLockSummary(input.stateDir, activeTasks);
  const backlog = buildBacklogSummary(queue);
  const throughput = buildThroughputSummary(input.lastPass ?? null, hostState, now);
  const partial = buildPartialSummary(input.lastPass ?? null, backlog);
  const inboundSurfaces = buildInboundSurfaceSummaries(input.users ?? []);
  const holds = buildHostHoldSummary(hostState, now);

  return {
    checkedAt: now,
    stateDir: input.stateDir,
    state: resolveAgentStatusState({
      activeTasks,
      lockSummary,
      backlog,
      holds,
      partial,
    }),
    current: {
      active: activeTasks.length > 0 || lockSummary.active,
      activeTaskCount: activeTasks.length,
      tasks: activeTasks,
      locks: lockSummary,
    },
    backlog,
    throughput,
    partial,
    inboundSurfaces,
    holds,
    artifacts: {
      hostStatePath: path.join(input.stateDir, "agent-host-state.json"),
      lastPassPath: path.join(input.stateDir, "agent-last-pass.json"),
      agentLogPath: path.join(input.stateDir, "agent.log"),
    },
  };
}

/**
 * @param {ReturnType<typeof buildAgentStatusReport>} report
 */
export function formatAgentStatusReport(report) {
  const lines = [];

  lines.push(`Agent status checked at ${report.checkedAt}.`);
  lines.push(`State: ${report.state}.`);
  lines.push(`Queue: ${report.backlog.dueTaskCount} due, ${report.backlog.waitingTaskCount} waiting, ${report.backlog.blockerCount} blockers.`);

  lines.push("");
  lines.push("Current work:");
  if (!report.current.activeTaskCount) {
    const activeLocks = report.current.locks.lanes.filter((lane) => lane.active);
    if (activeLocks.length) {
      for (const lane of activeLocks) {
        lines.push(`- ${lane.lane}: active pass${lane.pid ? ` pid ${lane.pid}` : ""}; no task lease is checked out yet.`);
      }
    } else {
      lines.push("- No task is checked out right now.");
    }
  } else {
    for (const task of report.current.tasks) {
      lines.push(`- ${task.lane}: ${task.kind} -> ${task.subject}`);
      lines.push(`  started: ${task.startedAt}${Number.isFinite(task.elapsedSeconds) ? ` (${formatDurationSeconds(task.elapsedSeconds)} elapsed)` : ""}`);
      if (task.surface || task.surfaceLabels.length) {
        lines.push(`  surface: ${task.surfaceLabels.join(", ") || task.surface}`);
      }
      const resumeParts = [
        task.progress.resumeCursor ? `cursor ${task.progress.resumeCursor}` : null,
        Number.isInteger(task.progress.resumeStartOffset) ? `offset ${task.progress.resumeStartOffset}` : null,
        Number.isInteger(task.progress.maxPages) ? `page budget ${task.progress.maxPages}` : null,
      ].filter(Boolean);
      if (resumeParts.length) {
        lines.push(`  resume: ${resumeParts.join(", ")}`);
      }
    }
  }

  if (report.backlog.dueByKind.length) {
    lines.push("");
    lines.push("Due backlog:");
    for (const group of report.backlog.dueByKind) {
      lines.push(`- ${group.kind}: ${group.count}`);
    }
  }

  if (report.backlog.waitingByReason.length) {
    lines.push("");
    lines.push("Waiting backlog:");
    for (const group of report.backlog.waitingByReason) {
      lines.push(`- ${group.waitingReason}: ${group.count}${group.nextDueAt ? `, next due ${group.nextDueAt}` : ""}`);
    }
  }

  if (report.backlog.blockersByReason.length) {
    lines.push("");
    lines.push("Blockers:");
    for (const group of report.backlog.blockersByReason) {
      lines.push(`- ${group.reason}: ${group.count}`);
    }
  }

  lines.push("");
  lines.push("Throughput:");
  if (report.throughput.lastPass) {
    const pass = report.throughput.lastPass;
    lines.push(`- last pass: ${pass.status ?? "unknown"}, ${pass.resultCount} results, ${pass.completedCount} completed, ${pass.blockedCount} blocked, ${pass.failedCount} failed${Number.isFinite(pass.durationSeconds) ? ` in ${formatDurationSeconds(pass.durationSeconds)}` : ""}.`);
  } else {
    lines.push("- last pass: not recorded yet.");
  }
  lines.push(`- last 24h: ${report.throughput.last24Hours.resultCount} results from recorded pass summaries; ${report.throughput.last24Hours.recentMotionRunCount} recent motion task runs.`);

  if (report.partial.active) {
    lines.push("");
    lines.push("Partial state:");
    lines.push(`- reason: ${report.partial.reason}`);
    if (report.partial.nextAction) {
      lines.push(`- next: ${report.partial.nextAction}`);
    }
  }

  const interestingSurfaces = report.inboundSurfaces.items
    .filter((surface) =>
      surface.lastError
      || surface.resumeCursor
      || Number.isInteger(surface.resumeStartOffset)
      || Number(surface.itemizationGapCount ?? 0) > 0
      || Number(surface.countDiscrepancyCount ?? 0) > 0
      || surface.capturedItemCount !== null
    )
    .slice(0, 8);
  lines.push("");
  lines.push("Inbound surfaces:");
  if (!interestingSurfaces.length) {
    lines.push("- No surface telemetry is recorded yet.");
  } else {
    for (const surface of interestingSurfaces) {
      const count = surface.visibleTotalCount !== null && surface.visibleTotalCount !== surface.capturedItemCount
        ? `${surface.capturedItemCount ?? "unknown"}/${surface.visibleTotalCount}`
        : `${surface.capturedItemCount ?? "unknown"}`;
      lines.push(`- ${surface.capability}:${surface.accountHandle} / ${surface.surfaceLabel}: ${surface.lastRunStatus}, captured ${count}`);
      const details = [
        surface.observationCount !== null ? `${surface.observationCount} observations` : null,
        surface.pagesWalked !== null ? `${surface.pagesWalked} pages` : surface.pageWalkStatus,
        surface.resumeCursor ? `resume cursor ${surface.resumeCursor}` : null,
        Number.isInteger(surface.resumeStartOffset) ? `resume offset ${surface.resumeStartOffset}` : null,
        surface.lastError ? `last error: ${surface.lastError}` : null,
      ].filter(Boolean);
      if (details.length) {
        lines.push(`  ${details.join("; ")}`);
      }
    }
    if (report.inboundSurfaces.items.length > interestingSurfaces.length) {
      lines.push(`- ${report.inboundSurfaces.items.length - interestingSurfaces.length} additional enabled surface(s) omitted.`);
    }
  }

  if (report.holds.items.length) {
    lines.push("");
    lines.push("Active holds:");
    for (const hold of report.holds.items) {
      lines.push(`- ${hold.kind}: until ${hold.unavailableUntil ?? "unknown"}${hold.reason ? ` (${hold.reason})` : ""}`);
    }
  }

  lines.push("");
  lines.push("Artifacts:");
  lines.push(`- host state: ${report.artifacts.hostStatePath}`);
  lines.push(`- last pass: ${report.artifacts.lastPassPath}`);
  lines.push(`- agent log: ${report.artifacts.agentLogPath}`);

  return lines.join("\n");
}

/**
 * @param {{ tasks?: any[], waiting?: any[], blockers?: any[] } | null | undefined} queue
 */
function normalizeQueue(queue) {
  return {
    tasks: Array.isArray(queue?.tasks) ? queue.tasks : [],
    waiting: Array.isArray(queue?.waiting) ? queue.waiting : [],
    blockers: Array.isArray(queue?.blockers) ? queue.blockers : [],
  };
}

/**
 * @param {ReturnType<typeof normalizeQueue>} queue
 * @param {any} hostState
 * @param {string} now
 */
function buildActiveTaskSummaries(queue, hostState, now) {
  const taskByFingerprint = new Map();
  for (const task of [...queue.tasks, ...queue.waiting]) {
    if (typeof task?.checkoutFingerprint === "string" && task.checkoutFingerprint.trim().length) {
      taskByFingerprint.set(task.checkoutFingerprint, task);
    }
  }

  return (hostState.taskLeases ?? []).map((lease) => {
    const task = taskByFingerprint.get(lease.fingerprint) ?? null;
    const startedAtMs = Date.parse(lease.acquiredAt);
    const nowMs = Date.parse(now);
    return {
      kind: lease.taskKind,
      action: lease.action ?? task?.action ?? lease.taskKind,
      lane: getTaskExecutionLane(lease.taskKind),
      subject: lease.subject ?? formatTaskSubject(task),
      workerLabel: lease.workerLabel,
      startedAt: lease.acquiredAt,
      elapsedSeconds: Number.isFinite(startedAtMs) && Number.isFinite(nowMs)
        ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1000))
        : null,
      expiresAt: lease.expiresAt,
      motionId: lease.motionId ?? task?.motionId ?? null,
      companyId: lease.companyId ?? task?.companyId ?? null,
      prospectId: lease.prospectId ?? task?.prospectId ?? null,
      userId: lease.userId ?? task?.userId ?? null,
      accountId: lease.accountId ?? task?.accountId ?? null,
      capability: lease.capability ?? task?.capability ?? null,
      surface: lease.surface ?? task?.surface ?? null,
      surfaceLabels: Array.isArray(task?.surfaceLabels) ? task.surfaceLabels : [],
      dueAt: task?.dueAt ?? null,
      waitingReason: task?.waitingReason ?? null,
      checkoutFingerprint: lease.fingerprint,
      progress: {
        capturedItemCount: null,
        pagesWalked: null,
        resumeCursor: task?.resumeCursor ?? null,
        resumeStartOffset: Number.isInteger(task?.resumeStartOffset) ? task.resumeStartOffset : null,
        maxPages: Number.isInteger(task?.maxPages) ? task.maxPages : null,
        pageSize: Number.isInteger(task?.pageSize) ? task.pageSize : null,
      },
    };
  });
}

/**
 * @param {string} stateDir
 * @param {ReturnType<typeof buildActiveTaskSummaries>} activeTasks
 */
function buildRunLockSummary(stateDir, activeTasks) {
  const agentLock = normalizeRunLock(inspectAgentRunLock({ stateDir }));
  const lanes = AGENT_EXECUTION_LANES.map((lane) => {
    const lock = normalizeRunLock(inspectAgentRunLock({ stateDir, lane }));
    const laneTasks = activeTasks.filter((task) => task.lane === lane);
    return {
      lane,
      ...lock,
      activeTaskCount: laneTasks.length,
      currentTask: laneTasks[0] ?? null,
    };
  });

  return {
    active: agentLock.active || lanes.some((lane) => lane.active),
    agent: agentLock,
    lanes,
  };
}

/** @param {ReturnType<typeof inspectAgentRunLock>} lock */
function normalizeRunLock(lock) {
  return {
    exists: Boolean(lock.exists),
    active: Boolean(lock.active),
    stale: Boolean(lock.stale),
    pid: lock.pid ?? null,
    lockDir: lock.lockDir,
  };
}

/**
 * @param {ReturnType<typeof normalizeQueue>} queue
 */
function buildBacklogSummary(queue) {
  return {
    dueTaskCount: queue.tasks.length,
    waitingTaskCount: queue.waiting.length,
    blockerCount: queue.blockers.length,
    nextDueAt: earliestIso(queue.waiting.map((task) => task?.dueAt)),
    dueByKind: groupCount(queue.tasks, (task) => task?.kind ?? "unknown", "kind"),
    waitingByReason: buildWaitingGroups(queue.waiting),
    blockersByReason: groupCount(queue.blockers, (blocker) =>
      blocker?.reasonCode
      ?? blocker?.blockReason
      ?? blocker?.transportReason
      ?? blocker?.resolveHint
      ?? "blocked", "reason"),
  };
}

/** @param {any[]} waiting */
function buildWaitingGroups(waiting) {
  const byReason = new Map();
  for (const task of waiting) {
    const waitingReason = task?.waitingReason ?? "not_due_yet";
    const existing = byReason.get(waitingReason) ?? {
      waitingReason,
      count: 0,
      nextDueAt: null,
      taskKinds: new Map(),
    };
    existing.count += 1;
    existing.nextDueAt = earliestIso([existing.nextDueAt, task?.dueAt]);
    const kind = task?.kind ?? "unknown";
    existing.taskKinds.set(kind, (existing.taskKinds.get(kind) ?? 0) + 1);
    byReason.set(waitingReason, existing);
  }

  return [...byReason.values()]
    .map((group) => ({
      waitingReason: group.waitingReason,
      count: group.count,
      nextDueAt: group.nextDueAt,
      taskKinds: [...group.taskKinds.entries()].map(([kind, count]) => ({ kind, count })),
    }))
    .sort((left, right) =>
      String(left.nextDueAt ?? "9999").localeCompare(String(right.nextDueAt ?? "9999"))
      || String(left.waitingReason).localeCompare(String(right.waitingReason))
    );
}

/**
 * @param {any[]} items
 * @param {(item: any) => string} keyFn
 * @param {string} keyName
 */
function groupCount(items, keyFn, keyName) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])));
}

/**
 * @param {any[]} users
 */
function buildInboundSurfaceSummaries(users) {
  const items = [];
  for (const rawUser of users) {
    let view;
    try {
      view = buildUserInboundSyncView(rawUser);
    } catch {
      continue;
    }
    for (const account of view.accounts) {
      for (const surface of account.surfaces) {
        if (!surface.enabled) continue;
        const stoppedAtPageBudget = surface.lastExhaustionReason === "page_budget_stopped_early"
          || surface.lastReconcileReason === "page_budget_stopped_early";
        items.push({
          userId: view.user.id,
          userLabel: view.user.label,
          accountId: account.accountId,
          capability: account.capability,
          accountHandle: account.handle,
          surfaceKey: surface.key,
          surfaceLabel: surface.label,
          lastRunStatus: surface.lastRunStatus,
          lastSyncedAt: surface.lastSyncedAt,
          lastObservedAt: surface.lastObservedAt,
          capturedItemCount: surface.lastItemCount,
          visibleTotalCount: surface.lastVisibleTotalCount,
          observationCount: surface.lastObservationCount,
          itemizationGapCount: surface.lastItemizationGapCount,
          countDiscrepancyCount: surface.lastCountDiscrepancyCount,
          pagesWalked: null,
          pageWalkStatus: surface.lastPaginationAttempted
            ? (stoppedAtPageBudget ? "page budget stopped early" : "pagination attempted")
            : "pages not recorded",
          resumeCursor: surface.nextCursor,
          resumeStartOffset: surface.nextStartOffset,
          lastError: surface.lastError,
        });
      }
    }
  }

  return {
    count: items.length,
    items: items.sort((left, right) =>
      String(left.capability).localeCompare(String(right.capability))
      || String(left.accountHandle).localeCompare(String(right.accountHandle))
      || String(left.surfaceKey).localeCompare(String(right.surfaceKey))
    ),
  };
}

/**
 * @param {any} lastPass
 * @param {any} hostState
 * @param {string} now
 */
function buildThroughputSummary(lastPass, hostState, now) {
  const lastPassSummary = summarizePassThroughput(lastPass);
  const cutoffMs = Date.parse(now) - DAY_MS;
  const nowMs = Date.parse(now);
  const lastPassEndedMs = lastPassSummary?.endedAt ? Date.parse(lastPassSummary.endedAt) : null;
  const lastPassInWindow = Number.isFinite(lastPassEndedMs)
    && Number(lastPassEndedMs) >= cutoffMs
    && Number(lastPassEndedMs) <= nowMs
      ? lastPassSummary
      : null;
  const recentMotionRuns = (hostState.recentMotionTaskRuns ?? [])
    .filter((entry) => {
      const recordedAtMs = Date.parse(entry.recordedAt);
      return Number.isFinite(recordedAtMs) && recordedAtMs >= cutoffMs && recordedAtMs <= nowMs;
    });

  return {
    lastPass: lastPassSummary,
    last24Hours: {
      windowStartedAt: new Date(cutoffMs).toISOString(),
      windowEndedAt: now,
      resultCount: lastPassInWindow?.resultCount ?? 0,
      completedCount: lastPassInWindow?.completedCount ?? 0,
      blockedCount: lastPassInWindow?.blockedCount ?? 0,
      failedCount: lastPassInWindow?.failedCount ?? 0,
      byKind: lastPassInWindow?.byKind ?? [],
      recentMotionRunCount: recentMotionRuns.length,
      recentMotionRunsByKind: groupCount(recentMotionRuns, (entry) => entry.taskKind ?? "unknown", "kind"),
      basis: "latest_pass_summary_plus_recent_motion_run_ledger",
    },
  };
}

/** @param {any} pass */
function summarizePassThroughput(pass) {
  if (!pass || typeof pass !== "object") return null;
  const results = Array.isArray(pass.results)
    ? pass.results
    : Array.isArray(pass.lanes)
      ? pass.lanes.flatMap((lane) => Array.isArray(lane?.results) ? lane.results : [])
      : [];
  const startedAt = normalizeIsoDatetime(pass.startedAt);
  const endedAt = normalizeIsoDatetime(pass.endedAt);
  return {
    status: pass.status ?? null,
    reason: pass.reason ?? null,
    startedAt,
    endedAt,
    durationSeconds: startedAt && endedAt
      ? Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))
      : null,
    resultCount: results.length,
    completedCount: results.filter((result) => result?.status === "completed").length,
    blockedCount: results.filter((result) => result?.status === "blocked").length,
    failedCount: results.filter((result) => result?.status === "failed").length,
    discardedCount: results.filter((result) => result?.status === "discarded").length,
    byKind: groupCount(results, (result) => result?.kind ?? "unknown", "kind"),
    lanes: Array.isArray(pass.lanes)
      ? pass.lanes.map((lane) => ({
        lane: lane?.lane ?? null,
        status: lane?.status ?? null,
        reason: lane?.reason ?? null,
        resultCount: Array.isArray(lane?.results) ? lane.results.length : 0,
      }))
      : [],
  };
}

/**
 * @param {any} lastPass
 * @param {ReturnType<typeof buildBacklogSummary>} backlog
 */
function buildPartialSummary(lastPass, backlog) {
  if (lastPass?.status !== "partial") {
    return {
      active: false,
      status: lastPass?.status ?? null,
      reason: null,
      nextAction: null,
    };
  }
  return {
    active: true,
    status: "partial",
    reason: normalizeText(lastPass.reason) ?? describePartialReason(backlog),
    nextAction: describeNextAction(backlog),
  };
}

/** @param {ReturnType<typeof buildBacklogSummary>} backlog */
function describePartialReason(backlog) {
  if (backlog.dueTaskCount > 0) {
    return `The last pass completed available work, but ${backlog.dueTaskCount} due task${backlog.dueTaskCount === 1 ? "" : "s"} remain.`;
  }
  if (backlog.blockerCount > 0) {
    return `The last pass stopped with ${backlog.blockerCount} blocker${backlog.blockerCount === 1 ? "" : "s"} still visible.`;
  }
  if (backlog.waitingTaskCount > 0) {
    return `The last pass drained due work; ${backlog.waitingTaskCount} task${backlog.waitingTaskCount === 1 ? "" : "s"} are waiting for their next due time.`;
  }
  return "The last pass was partial, but no remaining queue pressure is visible now.";
}

/** @param {ReturnType<typeof buildBacklogSummary>} backlog */
function describeNextAction(backlog) {
  if (backlog.dueTaskCount > 0) {
    return `Continue the agent pass to drain ${backlog.dueTaskCount} due task${backlog.dueTaskCount === 1 ? "" : "s"}.`;
  }
  if (backlog.waitingTaskCount > 0) {
    return backlog.nextDueAt
      ? `Resume when the next waiting task is due at ${backlog.nextDueAt}.`
      : "Wait for the next queued task to become due.";
  }
  if (backlog.blockerCount > 0) {
    return "Resolve the visible blocker before the queue can drain.";
  }
  return "Re-check the queue before starting another pass.";
}

/**
 * @param {any} hostState
 * @param {string} now
 */
function buildHostHoldSummary(hostState, now) {
  const items = [];
  for (const [lane, entry] of Object.entries(hostState.browserBackoff ?? {})) {
    if (entry?.unavailableUntil && Date.parse(entry.unavailableUntil) > Date.parse(now)) {
      items.push({
        kind: `browser_backoff:${lane}`,
        unavailableUntil: entry.unavailableUntil,
        reason: entry.reason ?? null,
      });
    }
  }
  const breaker = hostState.sendCircuitBreaker;
  if (breaker?.unavailableUntil && Date.parse(breaker.unavailableUntil) > Date.parse(now)) {
    items.push({
      kind: "send_circuit_breaker",
      unavailableUntil: breaker.unavailableUntil,
      reason: breaker.reason ?? null,
    });
  }
  const cooldown = hostState.canaryCooldown;
  if (cooldown?.unavailableUntil && Date.parse(cooldown.unavailableUntil) > Date.parse(now)) {
    items.push({
      kind: "canary_cooldown",
      unavailableUntil: cooldown.unavailableUntil,
      reason: cooldown.lastTaskLabel ?? null,
    });
  }
  const usage = hostState.runtimeUsageLimit;
  if (usage?.unavailableUntil && Date.parse(usage.unavailableUntil) > Date.parse(now)) {
    items.push({
      kind: "runtime_usage_limit",
      unavailableUntil: usage.unavailableUntil,
      reason: usage.reason ?? null,
    });
  }
  return {
    count: items.length,
    items,
  };
}

/**
 * @param {{
 *   activeTasks: any[],
 *   lockSummary: ReturnType<typeof buildRunLockSummary>,
 *   backlog: ReturnType<typeof buildBacklogSummary>,
 *   holds: ReturnType<typeof buildHostHoldSummary>,
 *   partial: ReturnType<typeof buildPartialSummary>,
 * }} input
 */
function resolveAgentStatusState(input) {
  if (input.activeTasks.length > 0 || input.lockSummary.active) return "running";
  if (input.holds.count > 0 || input.backlog.blockerCount > 0) return "blocked";
  if (input.partial.active) return "partial";
  if (input.backlog.dueTaskCount > 0) return "queued";
  if (input.backlog.waitingTaskCount > 0) return "waiting";
  return "idle";
}

/** @param {any} task */
function formatTaskSubject(task) {
  if (!task) return "unknown task";
  return [
    task.prospectName,
    task.companyName,
    task.motionName,
    task.accountHandle,
    task.userLabel,
  ].filter((value) => typeof value === "string" && value.trim().length).join(" / ") || task.kind || "unknown task";
}

/** @param {Array<unknown>} values */
function earliestIso(values) {
  return values
    .map(normalizeIsoDatetime)
    .filter(Boolean)
    .sort()[0] ?? null;
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

/** @param {number | null} seconds */
function formatDurationSeconds(seconds) {
  if (!Number.isFinite(seconds)) return "unknown";
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}
