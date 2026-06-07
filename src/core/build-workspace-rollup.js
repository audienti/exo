// @ts-check
//
// Workspace rollup view model (Exo UI Build Spec — the composed analytics
// overview). NOT another canonical domain: it reuses the same status language
// across a stat strip (pool / connect / engage / meet) and four panels —
// operator pulse, motions readiness, surface freshness, execution & capability.
// Every panel links back into its domain.
//
// Pure data — no rendering.

import { isCleanupLaneItem } from "./cleanup-lane.js";

/** stage → readiness fraction (mirrors build-motions-view) */
const STAGE_READINESS = {
  "needs-motion-definition": 0.08,
  "needs-company-targeting": 0.2,
  "needs-company-identity": 0.3,
  "needs-company-research": 0.42,
  "needs-prospect-selection": 0.55,
  "needs-cadence": 0.74,
  "targeting-ready": 0.92,
  paused: 0.5,
  archived: 0.0,
};

/**
 * @param {{
 *   operatorSummary: any,
 *   decisionQueue: any,
 *   agentQueue: any,
 *   blockedQueue?: any,
 *   motionSummaries: any[],
 *   truthAccounts: any[],
 *   reviewItems: any[],
 *   itemizationGaps?: any[],
 *   executionUsers: any[],
 * }} input
 */
export function buildWorkspaceRollup(input) {
  return {
    stats: buildStats(input),
    pulse: buildPulse(input),
    motions: buildMotions(input.motionSummaries),
    surfaces: buildSurfaces(input.truthAccounts),
    reconciliation: buildReconciliation(input.itemizationGaps),
    execution: buildExecution(input.executionUsers),
  };
}

/** @param {any} input */
function buildStats(input) {
  const reviewItems = input.reviewItems ?? [];
  const countByKind = (predicate) => reviewItems.filter(predicate).length;

  const poolTotal = (input.motionSummaries ?? []).reduce((sum, m) => sum + (m.prospectCount ?? 0), 0);
  const poolActive = (input.motionSummaries ?? []).reduce((sum, m) => sum + (m.readyToSendCount ?? 0), 0);
  const poolPre = Math.max(0, poolTotal - poolActive);

  const requested = countByKind((i) => i.surfaceKey === "linkedin-sent-invitations");
  const connected = countByKind((i) => i.kind === "connection_request_accepted");
  const sent = countByKind((i) => i.surfaceKey === "linkedin-messaging-inbox" || i.surfaceKey === "gmail-inbox-threads");
  const replied = countByKind((i) =>
    ["inbound_reply_received", "message_received", "email_reply_received"].includes(i.kind),
  );

  return {
    pool: { total: poolTotal, active: poolActive, preConnect: poolPre },
    connect: { requested, connected, rate: rate(connected, requested), healthy: "25–45%" },
    engage: { sent, replied, rate: rate(replied, sent || replied), target: "> 2%" },
    meet: { requested: 0, accepted: 0, declined: 0, rate: "0%" },
  };
}

/** @param {any} input */
function buildPulse(input) {
  const decisionItems = (input.decisionQueue?.items ?? []).filter((item) => !isCleanupLaneItem(item));
  const topDecision = decisionItems[0] ?? null;
  const topAgent = (input.agentQueue?.items ?? [])[0] ?? null;
  const blockers = input.blockedQueue?.items ?? input.agentQueue?.blockers ?? [];
  const topBlocker = blockers[0] ?? null;
  return {
    counts: {
      decisions: decisionItems.length,
      agentReady: input.agentQueue?.itemCount ?? (input.agentQueue?.items ?? []).length,
      blocked: input.blockedQueue?.itemCount ?? blockers.length,
    },
    topDecision: topDecision
      ? {
          name: topDecision.subject,
          prospectId: topDecision.prospectId ?? null,
          personId: topDecision.id ?? null,
          sub: topDecision.actorCompanyName ?? topDecision.companyName ?? topDecision.actorTitle ?? "",
          action: "needs decision",
        }
      : null,
    topAgent: topAgent
      ? {
          name: topAgent.subject,
          sub: shorten(topAgent.action ?? "", 40),
        }
      : null,
    topBlocker: topBlocker
      ? {
          name: topBlocker.subject ?? topBlocker.firstCompanyName ?? `${topBlocker.channel ?? "channel"} blocked`,
          sub: topBlocker.detail ?? `${topBlocker.blockedReadyCount} ready · ${topBlocker.blockedCompanyCount} companies`,
          status: topBlocker.blockType ? `blocked · ${String(topBlocker.blockType).replaceAll("_", " ")}` : "blocked · assignment",
        }
      : null,
  };
}

/** @param {any[]} motionSummaries */
function buildMotions(motionSummaries) {
  const motions = (motionSummaries ?? []).map((m) => {
    const readiness = STAGE_READINESS[m.overallStage] ?? 0.15;
    return {
      id: m.id,
      name: m.name,
      state: m.status,
      truth: m.premiseStatus === "checked" ? "checked" : m.premiseStatus === "defined" ? "partial" : "unchecked",
      readiness,
      companyCount: m.companyCount ?? 0,
      prospectCount: m.prospectCount ?? 0,
      actionCount: m.dueNowCount ?? 0,
      blocker: m.overallStage === "needs-company-targeting" ? "No companies targeted yet." : null,
    };
  });
  const avg = motions.length ? motions.reduce((sum, m) => sum + m.readiness, 0) / motions.length : 0;
  return { avg, items: motions };
}

/** @param {any[]} truthAccounts */
function buildSurfaces(truthAccounts) {
  /** @type {any[]} */
  const surfaces = [];
  let toReconcile = 0;
  for (const account of truthAccounts ?? []) {
    for (const surface of account.surfaces ?? []) {
      const truth = mapSurfaceTruth(surface.lastRunStatus, surface.meta);
      if (truth === "partial" || truth === "unchecked" || truth === "failed") toReconcile += 1;
      surfaces.push({
        name: surface.label,
        truth,
        at: relative(surface.lastSyncedAt ?? surface.lastObservedAt),
        note: surface.summary ?? "",
      });
    }
  }
  return { toReconcile, items: surfaces };
}

/** @param {any[] | null | undefined} itemizationGaps */
function buildReconciliation(itemizationGaps) {
  const items = (itemizationGaps ?? []).map((gap) => {
    const visibleCount = Number.isFinite(gap.itemCount) ? Number(gap.itemCount) : 0;
    const writtenBackCount = Number.isFinite(gap.observationCount)
      ? Number(gap.observationCount)
      : Number.isFinite(gap.itemizedCount)
        ? Number(gap.itemizedCount)
        : 0;
    const missingCount = Number.isFinite(gap.missingObservationCount)
      ? Number(gap.missingObservationCount)
      : Math.max(visibleCount - writtenBackCount, 0);
    const reason = gap.exhaustionReason === "page_budget_stopped_early"
      ? "page-budgeted full reconcile"
      : gap.reconcileReason === "bounded_capture_stopped_early"
        ? "quick-pass bounded"
        : humanizeReason(gap.reconcileReason ?? gap.exhaustionReason ?? "needs_reconciliation");

    return {
      label: gap.label ?? "Surface",
      accountHandle: gap.handle ?? null,
      visibleCount,
      writtenBackCount,
      missingCount,
      reason,
      note: gap.summary ?? "",
      action: gap.recommendedAction ?? "",
    };
  }).sort((left, right) => {
    if (right.missingCount !== left.missingCount) return right.missingCount - left.missingCount;
    if (right.visibleCount !== left.visibleCount) return right.visibleCount - left.visibleCount;
    return left.label.localeCompare(right.label);
  });

  return {
    gapCount: items.length,
    missingCount: items.reduce((sum, item) => sum + item.missingCount, 0),
    items,
  };
}

/** @param {any[]} executionUsers */
function buildExecution(executionUsers) {
  const accounts = [];
  let blockedNote = null;
  for (const user of executionUsers ?? []) {
    for (const account of user.accounts ?? []) {
      accounts.push({ handle: account.handle, capability: account.capability, kind: account.kind, truth: account.truth });
    }
    for (const harness of user.harness ?? []) {
      accounts.push({ handle: `${harness.runtime} · ${harness.connector}`, capability: "runtime harness", kind: "generic", truth: harness.truth });
    }
    if (!blockedNote && user.assignedMotions?.some((m) => m.blocker)) {
      blockedNote = "Some assigned motions are blocked on assignment or capability.";
    }
  }
  return { accounts, blockedNote };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * @param {number} num
 * @param {number} den
 */
function rate(num, den) {
  if (!den) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}

/**
 * @param {string | null | undefined} lastRunStatus
 * @param {any} meta
 * @returns {"unchecked" | "partial" | "failed" | "checked" | "quiet"}
 */
function mapSurfaceTruth(lastRunStatus, meta) {
  if (lastRunStatus === "error" || lastRunStatus === "failure") return "failed";
  if (lastRunStatus === "never" || meta?.unchecked) return "unchecked";
  if (meta?.itemizationGap || meta?.stale || lastRunStatus === "warning") return "partial";
  if (lastRunStatus === "success") return "checked";
  return "quiet";
}

/** @param {string | null | undefined} iso */
function relative(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const diff = Date.now() - target.getTime();
  const abs = Math.abs(diff);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  if (abs < hour) return `${Math.round(abs / minute)}m ago`;
  if (abs < day) return `${Math.round(abs / hour)}h ago`;
  return `${Math.round(abs / day)}d ago`;
}

/**
 * @param {string} text
 * @param {number} max
 */
function shorten(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** @param {string} value */
function humanizeReason(value) {
  return String(value ?? "")
    .replaceAll(/[-_]+/g, " ")
    .trim() || "needs reconciliation";
}
