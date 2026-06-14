// @ts-check

import { browserProfileCapabilitySchema } from "../schema/browser-profile.js";
import { userSchema } from "../schema/user.js";
import { inboundSyncPlanModeSchema, inboundSyncRunStatusSchema, inboundSurfaceStateSchema } from "../schema/inbound.js";
import { CAPABILITY_SEAM_STATES, buildCapabilitySeamResult } from "./capability-seam-contract.js";
import { findBackendCapability } from "../lib/backend-capability-registry.js";
import { findInboundSurfaceDefinition, listInboundSurfaceCatalog } from "../lib/inbound-surface-catalog.js";
import { classifyWorkingHoursWindow } from "./working-hours.js";

export const INBOUND_SYNC_STALE_MS = 6 * 60 * 60 * 1000;
export const INBOUND_SYNC_FAILED_RETRY_MS = 30 * 60 * 1000;
export const INBOUND_SYNC_LINKEDIN_MESSAGE_OPEN_WINDOW_MS = 15 * 60 * 1000;
export const INBOUND_SURFACE_MIXED_BASELINE_REASON = "mixed_baseline_due_to_out_of_band_reconciliation";
const WEEKDAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DEFAULT_LINKEDIN_RETRIEVAL_WINDOW = {
  weekdays: WEEKDAY_ORDER,
  startLocalTime: "07:00",
  endLocalTime: "22:00",
};
const QUICK_MODE_SUPPLEMENTARY_SURFACES = new Set([
  "linkedin-followers-list"
]);

/**
 * @param {unknown} rawUser
 * @param {{
 *   capability?: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type | null
 * }} [options]
 */
export function buildUserInboundSyncView(rawUser, options = {}) {
  const user = userSchema.parse(rawUser);
  const capability = options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null;
  const accounts = user.accounts
    .filter((account) => !capability || account.capability === capability)
    .map((account) => buildAccountInboundView(account));

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    counts: {
      accountCount: accounts.length,
      enabledSurfaceCount: accounts.reduce((sum, account) => sum + account.enabledSurfaceCount, 0),
      staleSurfaceCount: accounts.reduce((sum, account) => sum + account.staleSurfaceCount, 0),
      failedSurfaceCount: accounts.reduce((sum, account) => sum + account.failedSurfaceCount, 0)
    },
    accounts
  };
}

/**
 * @param {unknown} rawUser
 * @param {{ capability?: string | null, metadata?: Record<string, unknown> | null }} rawAccount
 * @param {string} now
 */
export function classifyInboundRetrievalWindow(rawUser, rawAccount, now) {
  const user = userSchema.parse(rawUser);
  const capability = String(rawAccount?.capability ?? "").trim().toLowerCase();
  if (capability === "gmail") {
    const nowDate = new Date(now);
    return {
      mode: "always",
      openNow: true,
      nextOpenAt: Number.isNaN(nowDate.getTime()) ? now : nowDate.toISOString(),
      summary: "Gmail retrieval is always open for autonomous inbox truth."
    };
  }

  if (capability === "linkedin") {
    return classifyWorkingHoursWindow(resolveLinkedinRetrievalWindow(user, rawAccount), now);
  }

  return classifyWorkingHoursWindow(user.workingHours, now);
}

/**
 * Enumerate enabled inbound surfaces that Exo knows it cannot retrieve
 * autonomously in the background yet. This is the rollout guard for moving the
 * detached worker from proof to action.
 *
 * @param {unknown[]} rawUsers
 */
export function buildInboundAutomationWarnings(rawUsers) {
  const warnings = [];
  for (const rawUser of rawUsers ?? []) {
    const syncView = buildUserInboundSyncView(rawUser);
    for (const account of syncView.accounts) {
      for (const surface of account.surfaces) {
        if (!surface.enabled || surface.autonomousBackgroundRetrieval !== false) continue;
        warnings.push({
          userId: syncView.user.id,
          userLabel: syncView.user.label,
          accountId: account.accountId,
          capability: account.capability,
          handle: account.handle,
          surfaceKey: surface.key,
          surfaceLabel: surface.label,
          reason: surface.autonomousBackgroundReason ?? "This surface is enabled, but Exo cannot retrieve it autonomously in the background yet.",
          disableCommand: `exo inbound sync set ${syncView.user.id} --account ${account.accountId} --disable-surface ${surface.key} --json`,
        });
      }
    }
  }
  return warnings;
}

/**
 * Enumerate enabled inbound surfaces that Exo can retrieve autonomously, but
 * whose current recorded truth is stale, failed, partial, or still never run.
 * This is the rollout guard for promoting the detached worker into live-send
 * modes while background truth is degraded.
 *
 * @param {unknown[]} rawUsers
 * @param {string} [now]
 */
export function buildInboundAutomationHealthWarnings(rawUsers, now = new Date().toISOString()) {
  const warnings = [];
  for (const rawUser of rawUsers ?? []) {
    const user = userSchema.parse(rawUser);
    const syncView = buildUserInboundSyncView(user);
    for (const account of syncView.accounts) {
      const retrievalWindowStatus = classifyInboundRetrievalWindow(user, account, now);
      for (const surface of account.surfaces) {
        if (!surface.enabled || surface.autonomousBackgroundRetrieval === false) continue;
        const healthState = classifyInboundAutomationHealthState(surface, now, { workingHoursStatus: retrievalWindowStatus });
        if (!healthState) continue;
        warnings.push({
          userId: syncView.user.id,
          userLabel: syncView.user.label,
          accountId: account.accountId,
          capability: account.capability,
          handle: account.handle,
          surfaceKey: surface.key,
          surfaceLabel: surface.label,
          freshnessState: healthState.reason,
          reason: describeAutomationHealthWarningReason(healthState.reason, healthState.inRetryBackoff === true),
          inspectCommand: `exo inbound sync show ${syncView.user.id} --json`,
        });
      }
    }
  }
  return warnings;
}

/**
 * Summarize the autonomous retrieval lane so the background worker can explain
 * whether retrieval is due now, healthy, or merely waiting for the next stale
 * threshold or failed-retry window.
 *
 * @param {unknown[]} rawUsers
 * @param {string} [now]
 */
export function buildInboundAutomationStatus(rawUsers, now = new Date().toISOString()) {
  let enabledAutonomousSurfaceCount = 0;
  let dueNowCount = 0;
  let freshCount = 0;
  let retryBackoffCount = 0;
  /** @type {null | { dueAt: string, userId: string, userLabel: string, accountId: string, capability: string, handle: string, surfaceKey: string, surfaceLabel: string }} */
  let nextDueSurface = null;

  for (const rawUser of rawUsers ?? []) {
    const user = userSchema.parse(rawUser);
    const syncView = buildUserInboundSyncView(user);
    for (const account of syncView.accounts) {
      const retrievalWindowStatus = classifyInboundRetrievalWindow(user, account, now);
      for (const surface of account.surfaces) {
        if (!surface.enabled || surface.autonomousBackgroundRetrieval === false) continue;
        enabledAutonomousSurfaceCount += 1;
        const freshness = classifyInboundSurfaceFreshness(surface, now, {
          workingHoursStatus: retrievalWindowStatus,
          deferOutsideWorkingHours: true,
        });
        if (freshness) {
          dueNowCount += 1;
          continue;
        }
        freshCount += 1;
        if (surface.lastRunStatus === "failed" && !isAutonomousSurfaceUnsupported(surface)) {
          retryBackoffCount += 1;
        }
        const dueAt = computeInboundAutomationNextDueAt(surface, { workingHoursStatus: retrievalWindowStatus });
        if (!dueAt) continue;
        if (!nextDueSurface || Date.parse(dueAt) < Date.parse(nextDueSurface.dueAt)) {
          nextDueSurface = {
            dueAt,
            userId: syncView.user.id,
            userLabel: syncView.user.label,
            accountId: account.accountId,
            capability: account.capability,
            handle: account.handle,
            surfaceKey: surface.key,
            surfaceLabel: surface.label,
          };
        }
      }
    }
  }

  return {
    enabledAutonomousSurfaceCount,
    dueNowCount,
    freshCount,
    retryBackoffCount,
    nextDueSurface,
  };
}

/**
 * @param {unknown} rawUser
 * @param {{
 *   capability?: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type | null,
 *   accountId?: string | null,
 *   mode?: import("../schema/inbound.js").inboundSyncPlanModeSchema._type | null,
 *   now?: string | null
 * }} [options]
 */
export function buildUserInboundSyncPlan(rawUser, options = {}) {
  const user = userSchema.parse(rawUser);
  const capability = options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null;
  const mode = inboundSyncPlanModeSchema.parse(options.mode ?? "quick");
  const now = options.now ?? new Date().toISOString();
  const syncView = buildUserInboundSyncView(user, { capability });
  const accountId = options.accountId ?? null;

  if (accountId && !syncView.accounts.some((account) => account.accountId === accountId)) {
    throw new Error(`User account not found: ${accountId}`);
  }

  const accounts = syncView.accounts
    .filter((account) => !accountId || account.accountId === accountId)
    .map((account) => buildAccountSyncPlan(user.id, account, {
      mode,
      now,
      workingHoursStatus: classifyInboundRetrievalWindow(user, account, now),
    }))
    .filter((account) => account.includedSurfaceCount > 0);

  const includedSurfaces = accounts.flatMap((account) => account.phases.flatMap((phase) => phase.surfaces));
  const freshnessCounts = includedSurfaces.reduce(
    (counts, surface) => ({
      disabled: counts.disabled + (surface.freshnessState === "disabled" ? 1 : 0),
      failed: counts.failed + (surface.freshnessState === "failed" ? 1 : 0),
      fresh: counts.fresh + (surface.freshnessState === "fresh" ? 1 : 0),
      never: counts.never + (surface.freshnessState === "never" ? 1 : 0),
      stale: counts.stale + (surface.freshnessState === "stale" ? 1 : 0),
      warning: counts.warning + (surface.freshnessState === "warning" ? 1 : 0)
    }),
    { disabled: 0, failed: 0, fresh: 0, never: 0, stale: 0, warning: 0 }
  );
  const dueSurfaceCount = freshnessCounts.never + freshnessCounts.failed + freshnessCounts.warning + freshnessCounts.stale;
  const capabilityLabels = [...new Set(accounts.map((account) => humanizeCapability(account.capability)))];

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    generatedAt: now,
    mode,
    headline: buildPlanHeadline(mode, capabilityLabels),
    counts: {
      accountCount: accounts.length,
      includedSurfaceCount: includedSurfaces.length,
      primarySurfaceCount: includedSurfaces.filter((surface) => surface.phase === "primary").length,
      secondarySurfaceCount: includedSurfaces.filter((surface) => surface.phase === "secondary").length,
      optionalSurfaceCount: includedSurfaces.filter((surface) => surface.phase === "optional").length,
      dueSurfaceCount,
      freshSurfaceCount: freshnessCounts.fresh,
      freshness: freshnessCounts
    },
    rules: [
      "Start with the canonical truth surfaces, not the LinkedIn notifications bell.",
      "Write one observation per real inbound change. Do not stop at surface-level counts when concrete items exist.",
      "Record every checked surface, even if it was empty, so Exo can distinguish silence from unchecked state.",
      "After the pass, rerun inbox, daily, and next so Exo recomputes from the fresh truth."
    ],
    followUpCommands: [
      `exo inbox --user ${user.id} --json`,
      `exo daily --user ${user.id} --json`,
      "exo next --json"
    ],
    accounts
  };
}

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId: string,
 *   enableSurfaceKeys?: string[],
 *   disableSurfaceKeys?: string[]
 * }} input
 */
export function setUserInboundSyncPolicy(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const now = new Date().toISOString();
  const account = user.accounts.find((candidate) => candidate.id === input.accountId);

  if (!account) {
    throw new Error(`User account not found: ${input.accountId}`);
  }

  const allowedSurfaces = listInboundSurfaceCatalog({ capability: account.capability }).map((surface) => surface.key);
  const enabledKeys = normalizeSurfaceKeys(input.enableSurfaceKeys ?? [], allowedSurfaces, account.capability);
  const disabledKeys = normalizeSurfaceKeys(input.disableSurfaceKeys ?? [], allowedSurfaces, account.capability);
  const nextSurfaceKeys = new Set([...enabledKeys, ...disabledKeys]);
  const currentStates = materializeSurfaceStates(account);

  const nextAccounts = user.accounts.map((candidate) => {
    if (candidate.id !== input.accountId) {
      return candidate;
    }

    const surfaces = currentStates.map((surface) => {
      if (enabledKeys.includes(surface.surfaceKey)) {
        return inboundSurfaceStateSchema.parse({ ...surface, enabled: true });
      }

      if (disabledKeys.includes(surface.surfaceKey)) {
        return inboundSurfaceStateSchema.parse({ ...surface, enabled: false });
      }

      return surface;
    });

    for (const surfaceKey of nextSurfaceKeys) {
      if (surfaces.some((surface) => surface.surfaceKey === surfaceKey)) {
        continue;
      }

      surfaces.push(inboundSurfaceStateSchema.parse({
        surfaceKey,
        enabled: enabledKeys.includes(surfaceKey)
      }));
    }

    return {
      ...candidate,
      updatedAt: now,
      inboundSync: {
        surfaces
      }
    };
  });

  return userSchema.parse({
    ...user,
    updatedAt: now,
    accounts: nextAccounts
  });
}

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId: string,
 *   surfaceKey: string,
 *   status: "never" | "success" | "warning" | "failed",
 *   observedAt?: string | null,
 *   itemCount?: number | null,
 *   visibleTotalCount?: number | null,
 *   captureCompleteness?: import("../schema/inbound.js").inboundCaptureCompletenessSchema._type | null,
 *   requestedMode?: import("../schema/inbound.js").inboundSyncPlanModeSchema._type | null,
 *   actualMode?: import("../schema/inbound.js").inboundSyncPlanModeSchema._type | null,
 *   reconcileRequired?: boolean | null,
 *   reconcileReason?: string | null,
 *   continuationStartedAt?: string | null,
 *   nextCursor?: string | null,
 *   nextStartOffset?: number | null,
 *   providerCursor?: string | null,
 *   highWatermarkAt?: string | null,
 *   highWatermarkId?: string | null,
 *   lastCompleteSnapshotId?: string | null,
 *   nextAllowedSyncAt?: string | null,
 *   backoffReason?: string | null,
 *   syncTrustStatus?: "trusted" | "degraded" | "untrusted" | null,
 *   observationCount?: number | null,
 *   itemizationGapCount?: number | null,
 *   error?: string | null
 * }} input
 */
export function recordUserInboundSyncRun(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const now = new Date().toISOString();
  const account = user.accounts.find((candidate) => candidate.id === input.accountId);

  if (!account) {
    throw new Error(`User account not found: ${input.accountId}`);
  }

  const definition = findInboundSurfaceDefinition(input.surfaceKey);
  if (!definition) {
    throw new Error(`Inbound surface not found: ${input.surfaceKey}`);
  }

  if (definition.capability !== account.capability) {
    throw new Error(`Inbound surface ${definition.key} does not apply to capability ${account.capability}.`);
  }

  const status = inboundSyncRunStatusSchema.parse(input.status);
  const currentStates = materializeSurfaceStates(account);
  const nextObservationCount = input.observationCount ?? null;
  const nextVisibleTotalCount = input.visibleTotalCount ?? null;
  const nextExhaustionStatus = input.exhaustionStatus ?? inferExhaustionStatus({
    status,
    captureCompleteness: input.captureCompleteness ?? null
  });
  const nextAllowedSyncAt = normalizeNullableIso(input.nextAllowedSyncAt);
  const nextSyncTrustStatus = normalizeSyncTrustStatus(input.syncTrustStatus)
    ?? inferSyncTrustStatus({
      status,
      captureCompleteness: input.captureCompleteness ?? null,
      exhaustionStatus: nextExhaustionStatus,
    });
  const nextCountDiscrepancyCount = input.countDiscrepancyCount
    ?? Math.max((nextVisibleTotalCount ?? input.itemCount ?? 0) - (input.itemCount ?? 0), 0);
  const nextItemizationGapCount = input.itemizationGapCount
    ?? (nextExhaustionStatus === "complete"
      ? 0
      : nextObservationCount == null
        ? null
        : Math.max((nextVisibleTotalCount ?? input.itemCount ?? 0) - nextObservationCount, 0));

  const nextAccounts = user.accounts.map((candidate) => {
    if (candidate.id !== input.accountId) {
      return candidate;
    }

    const surfaces = currentStates.map((surface) => {
      if (surface.surfaceKey !== definition.key) {
        return surface;
      }

      const continuationActive = status !== "failed"
        && nextExhaustionStatus !== "complete"
        && (
          normalizeNullableString(input.nextCursor) !== null
          || (Number.isInteger(input.nextStartOffset) && input.nextStartOffset >= 0)
        );
      const continuationStartedAt = continuationActive
        ? normalizeNullableString(input.continuationStartedAt) ?? surface.continuationStartedAt ?? input.observedAt ?? now
        : null;
      const providerCursor = normalizeNullableString(input.providerCursor) ?? surface.providerCursor ?? null;
      const highWatermarkAt = normalizeNullableIso(input.highWatermarkAt) ?? surface.highWatermarkAt ?? null;
      const highWatermarkId = normalizeNullableString(input.highWatermarkId) ?? surface.highWatermarkId ?? null;
      const lastCompleteSnapshotId = normalizeNullableString(input.lastCompleteSnapshotId) ?? surface.lastCompleteSnapshotId ?? null;
      const backoffReason = normalizeNullableString(input.backoffReason) ?? (
        nextAllowedSyncAt ? normalizeNullableString(input.exhaustionReason) ?? normalizeNullableString(input.reconcileReason) : null
      );

      return inboundSurfaceStateSchema.parse({
        ...surface,
        enabled: true,
        lastSyncedAt: now,
        lastObservedAt: input.observedAt ?? surface.lastObservedAt,
        lastRunStatus: status,
        lastItemCount: input.itemCount ?? surface.lastItemCount,
        lastVisibleTotalCount: nextVisibleTotalCount,
        lastCaptureCompleteness: input.captureCompleteness ?? null,
        lastRequestedMode: input.requestedMode ?? null,
        lastActualMode: input.actualMode ?? null,
        lastReconcileRequired: input.reconcileRequired ?? null,
        lastReconcileReason: normalizeNullableString(input.reconcileReason),
        lastExhaustionStatus: nextExhaustionStatus,
        lastExhaustionReason: normalizeNullableString(input.exhaustionReason),
        lastPaginationAttempted: typeof input.paginationAttempted === "boolean" ? input.paginationAttempted : null,
        lastTerminalSignalSeen: typeof input.terminalSignalSeen === "boolean" ? input.terminalSignalSeen : null,
        lastStalledPassCount: Number.isInteger(input.stalledPassCount) ? input.stalledPassCount : null,
        continuationStartedAt,
        nextCursor: continuationActive ? normalizeNullableString(input.nextCursor) : null,
        nextStartOffset: continuationActive && Number.isInteger(input.nextStartOffset) && input.nextStartOffset >= 0
          ? input.nextStartOffset
          : null,
        providerCursor,
        highWatermarkAt,
        highWatermarkId,
        lastCompleteSnapshotId,
        nextAllowedSyncAt,
        backoffReason,
        syncTrustStatus: nextSyncTrustStatus,
        lastObservationCount: nextObservationCount,
        lastItemizationGapCount: nextItemizationGapCount,
        lastCountDiscrepancyCount: nextCountDiscrepancyCount,
        lastError: status === "failed"
          ? normalizeNullableString(input.error) ?? surface.lastError
          : status === "warning"
            ? normalizeNullableString(input.error) ?? surface.lastError
            : null
      });
    });

    if (!surfaces.some((surface) => surface.surfaceKey === definition.key)) {
      const continuationActive = status !== "failed"
        && nextExhaustionStatus !== "complete"
        && (
          normalizeNullableString(input.nextCursor) !== null
          || (Number.isInteger(input.nextStartOffset) && input.nextStartOffset >= 0)
        );
      surfaces.push(inboundSurfaceStateSchema.parse({
        surfaceKey: definition.key,
        enabled: true,
        lastSyncedAt: now,
        lastObservedAt: input.observedAt ?? null,
        lastRunStatus: status,
        lastItemCount: input.itemCount ?? null,
        lastVisibleTotalCount: nextVisibleTotalCount,
        lastCaptureCompleteness: input.captureCompleteness ?? null,
        lastRequestedMode: input.requestedMode ?? null,
        lastActualMode: input.actualMode ?? null,
        lastReconcileRequired: input.reconcileRequired ?? null,
        lastReconcileReason: normalizeNullableString(input.reconcileReason),
        lastExhaustionStatus: nextExhaustionStatus,
        lastExhaustionReason: normalizeNullableString(input.exhaustionReason),
        lastPaginationAttempted: typeof input.paginationAttempted === "boolean" ? input.paginationAttempted : null,
        lastTerminalSignalSeen: typeof input.terminalSignalSeen === "boolean" ? input.terminalSignalSeen : null,
        lastStalledPassCount: Number.isInteger(input.stalledPassCount) ? input.stalledPassCount : null,
        continuationStartedAt: continuationActive
          ? normalizeNullableString(input.continuationStartedAt) ?? input.observedAt ?? now
          : null,
        nextCursor: continuationActive ? normalizeNullableString(input.nextCursor) : null,
        nextStartOffset: continuationActive && Number.isInteger(input.nextStartOffset) && input.nextStartOffset >= 0
          ? input.nextStartOffset
          : null,
        providerCursor: normalizeNullableString(input.providerCursor),
        highWatermarkAt: normalizeNullableIso(input.highWatermarkAt),
        highWatermarkId: normalizeNullableString(input.highWatermarkId),
        lastCompleteSnapshotId: normalizeNullableString(input.lastCompleteSnapshotId),
        nextAllowedSyncAt,
        backoffReason: normalizeNullableString(input.backoffReason) ?? (
          nextAllowedSyncAt ? normalizeNullableString(input.exhaustionReason) ?? normalizeNullableString(input.reconcileReason) : null
        ),
        syncTrustStatus: nextSyncTrustStatus,
        lastObservationCount: nextObservationCount,
        lastItemizationGapCount: nextItemizationGapCount,
        lastCountDiscrepancyCount: nextCountDiscrepancyCount,
        lastError: status === "failed" || status === "warning" ? normalizeNullableString(input.error) : null
      }));
    }

    return {
      ...candidate,
      updatedAt: now,
      inboundSync: {
        surfaces
      }
    };
  });

  return userSchema.parse({
    ...user,
    updatedAt: now,
    accounts: nextAccounts
  });
}

/**
 * A full surface sync established a clean baseline, but a later row-level
 * reconciliation changed one person on that surface. Preserve the stored
 * baseline timestamps and counts, but mark the surface as mixed so Exo stops
 * treating silence or totals as fully trustworthy until the next governed full
 * sync lands.
 *
 * @param {unknown} rawUser
 * @param {{
 *   accountId: string,
 *   surfaceKey: string,
 * }} input
 * @returns {{ user: import("../schema/user.js").userSchema._type, changed: boolean }}
 */
export function markUserInboundSurfaceMixedAfterOutOfBandReconciliation(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const account = user.accounts.find((candidate) => candidate.id === input.accountId);
  if (!account) {
    throw new Error(`User account not found: ${input.accountId}`);
  }

  const currentStates = materializeSurfaceStates(account);
  let changed = false;

  const nextAccounts = user.accounts.map((candidate) => {
    if (candidate.id !== input.accountId) {
      return candidate;
    }

    const surfaces = currentStates.map((surface) => {
      if (surface.surfaceKey !== input.surfaceKey) {
        return surface;
      }

      const alreadyMixed = hasMixedInboundBaseline(surface);
      const hadTrustedFullBaseline = surface.lastRunStatus === "success"
        && surface.lastCaptureCompleteness === "complete"
        && surface.lastExhaustionStatus === "complete";
      if (alreadyMixed || !hadTrustedFullBaseline) {
        return surface;
      }

      changed = true;
      return inboundSurfaceStateSchema.parse({
        ...surface,
        lastReconcileReason: INBOUND_SURFACE_MIXED_BASELINE_REASON,
        lastExhaustionReason: INBOUND_SURFACE_MIXED_BASELINE_REASON,
      });
    });

    return {
      ...candidate,
      updatedAt: changed ? new Date().toISOString() : candidate.updatedAt,
      inboundSync: {
        surfaces
      }
    };
  });

  return {
    user: changed
      ? userSchema.parse({
        ...user,
        updatedAt: new Date().toISOString(),
        accounts: nextAccounts,
      })
      : user,
    changed,
  };
}

/**
 * @param {{
 *   key?: string | null,
 *   lastRunStatus: "never" | "success" | "warning" | "failed",
 *   lastObservedAt?: string | null,
 *   lastSyncedAt?: string | null
 * }} surface
 * @param {string} now
 * @param {{
 *   workingHoursStatus?: { openNow: boolean, nextOpenAt: string | null } | null,
 *   deferOutsideWorkingHours?: boolean
 * }} [options]
 */
export function classifyInboundSurfaceFreshness(surface, now, options = {}) {
  const freshnessWindowMs = inboundSurfaceFreshnessWindowMs(surface, options);
  const providerBackoffUntil = normalizeNullableIso(surface.nextAllowedSyncAt);
  const nowMs = Date.parse(now);
  if (providerBackoffUntil) {
    const providerBackoffMs = Date.parse(providerBackoffUntil);
    if (!Number.isNaN(providerBackoffMs) && !Number.isNaN(nowMs) && providerBackoffMs > nowMs) {
      return null;
    }
  }
  const deferDueIfClosedWindow = (candidate) => {
    if (
      !candidate
      || options.deferOutsideWorkingHours !== true
      || !options.workingHoursStatus
      || options.workingHoursStatus.openNow
    ) {
      return candidate;
    }
    const nextDueAt = computeInboundAutomationNextDueAt(surface, options);
    const nextDueMs = typeof nextDueAt === "string" ? Date.parse(nextDueAt) : Number.NaN;
    const nowMs = Date.parse(now);
    if (!Number.isNaN(nextDueMs) && !Number.isNaN(nowMs) && nextDueMs > nowMs) {
      return null;
    }
    return candidate;
  };

  if (surface.lastRunStatus === "never") {
    return deferDueIfClosedWindow({
      reason: "never",
      dueAt: "1970-01-01T00:00:00.000Z"
    });
  }

  if (surface.lastRunStatus === "failed") {
    if (isAutonomousSurfaceUnsupported(surface)) {
      return null;
    }
    const failedAt = surface.lastSyncedAt ? Date.parse(surface.lastSyncedAt) : Number.NaN;
    if (!Number.isNaN(failedAt) && !Number.isNaN(nowMs) && nowMs - failedAt < INBOUND_SYNC_FAILED_RETRY_MS) {
      return null;
    }
    return deferDueIfClosedWindow({
      reason: "failed",
      dueAt: surface.lastSyncedAt ?? "1970-01-01T00:00:00.000Z"
    });
  }

  const freshnessTime = surface.lastObservedAt ?? surface.lastSyncedAt;
  if (!freshnessTime) {
    return deferDueIfClosedWindow({
      reason: "never",
      dueAt: "1970-01-01T00:00:00.000Z"
    });
  }

  const freshnessMs = Date.parse(freshnessTime);
  if (Number.isNaN(freshnessMs) || Number.isNaN(nowMs)) {
    return null;
  }

  if (
    surface.lastRunStatus === "warning"
    && isBoundedCaptureWarning(surface)
    && nowMs - freshnessMs <= freshnessWindowMs
  ) {
    return null;
  }

  if (surface.lastRunStatus === "warning" || nowMs - freshnessMs > freshnessWindowMs) {
    return deferDueIfClosedWindow({
      reason: surface.lastRunStatus === "warning" ? "warning" : "stale",
      dueAt: freshnessTime
    });
  }

  return null;
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function buildAccountInboundView(account) {
  const surfaces = materializeSurfaceStates(account).map((state, index) => {
    const definition = findInboundSurfaceDefinition(state.surfaceKey);
    if (!definition) {
      return null;
    }

    return {
      catalogOrder: index,
      key: definition.key,
      label: definition.label,
      summary: definition.summary,
      truthLevel: definition.truthLevel,
      retrievalMode: definition.retrievalMode,
      autonomousBackgroundRetrieval: definition.autonomousBackgroundRetrieval !== false,
      autonomousBackgroundReason: definition.autonomousBackgroundReason ?? null,
      automationCadenceMs: Number.isInteger(definition.automationCadenceMs) && definition.automationCadenceMs > 0
        ? definition.automationCadenceMs
        : null,
      observationKinds: definition.observationKinds,
      enabled: state.enabled,
      lastRunStatus: state.lastRunStatus,
      lastSyncedAt: state.lastSyncedAt,
      lastObservedAt: state.lastObservedAt,
      lastItemCount: state.lastItemCount,
      lastVisibleTotalCount: state.lastVisibleTotalCount,
      lastCaptureCompleteness: state.lastCaptureCompleteness,
      lastRequestedMode: state.lastRequestedMode,
      lastActualMode: state.lastActualMode,
      lastReconcileRequired: state.lastReconcileRequired,
      lastReconcileReason: state.lastReconcileReason,
      lastExhaustionStatus: state.lastExhaustionStatus,
      lastExhaustionReason: state.lastExhaustionReason,
      lastPaginationAttempted: state.lastPaginationAttempted,
      lastTerminalSignalSeen: state.lastTerminalSignalSeen,
      lastStalledPassCount: state.lastStalledPassCount,
      continuationStartedAt: state.continuationStartedAt,
      nextCursor: state.nextCursor,
      nextStartOffset: state.nextStartOffset,
      providerCursor: state.providerCursor,
      highWatermarkAt: state.highWatermarkAt,
      highWatermarkId: state.highWatermarkId,
      lastCompleteSnapshotId: state.lastCompleteSnapshotId,
      nextAllowedSyncAt: state.nextAllowedSyncAt,
      backoffReason: state.backoffReason,
      syncTrustStatus: state.syncTrustStatus,
      lastObservationCount: state.lastObservationCount,
      lastItemizationGapCount: state.lastItemizationGapCount,
      lastCountDiscrepancyCount: state.lastCountDiscrepancyCount,
      lastError: state.lastError
    };
  }).filter(Boolean);

  return {
    accountId: account.id,
    capability: account.capability,
    handle: account.handle,
    label: account.label,
    preferred: account.preferred,
    sourceType: account.sourceType,
    metadata: account.metadata,
    enabledSurfaceCount: surfaces.filter((surface) => surface.enabled).length,
    staleSurfaceCount: surfaces.filter((surface) => surface.enabled && surface.lastRunStatus === "never").length,
    failedSurfaceCount: surfaces.filter((surface) => surface.lastRunStatus === "failed").length,
    surfaces
  };
}

/**
 * @param {string} userId
 * @param {ReturnType<typeof buildAccountInboundView>} account
 * @param {{
 *   mode: import("../schema/inbound.js").inboundSyncPlanModeSchema._type,
 *   now: string,
 *   workingHoursStatus: { openNow: boolean, nextOpenAt: string | null }
 * }} input
 */
function buildAccountSyncPlan(userId, account, input) {
  const surfaces = account.surfaces
    .map((surface) => buildSurfaceSyncPlan(userId, account, surface, input))
    .filter(Boolean)
    .sort(compareSurfaceSyncPlans);

  const phases = ["primary", "secondary", "optional"]
    .map((phase) => ({
      key: phase,
      label: phase === "primary" ? "Check now" : phase === "secondary" ? "Check after primary truth surfaces" : "Optional coverage",
      surfaces: surfaces.filter((surface) => surface.phase === phase)
    }))
    .filter((phase) => phase.surfaces.length);

  return {
    accountId: account.accountId,
    capability: account.capability,
    handle: account.handle,
    label: account.label,
    preferred: account.preferred,
    sourceType: account.sourceType,
    includedSurfaceCount: surfaces.length,
    phases
  };
}

/**
 * @param {string} userId
 * @param {ReturnType<typeof buildAccountInboundView>} account
 * @param {ReturnType<typeof buildAccountInboundView>["surfaces"][number]} surface
 * @param {{
 *   mode: import("../schema/inbound.js").inboundSyncPlanModeSchema._type,
 *   now: string,
 *   workingHoursStatus: { openNow: boolean, nextOpenAt: string | null }
 * }} input
 */
function buildSurfaceSyncPlan(userId, account, surface, input) {
  const modePolicy = classifySurfaceMode(surface, input.mode);
  if (!modePolicy) {
    return null;
  }

  const freshness = surface.enabled
    ? classifyInboundSurfaceFreshness(surface, input.now, {
        workingHoursStatus: input.workingHoursStatus,
      })
    : null;
  const freshnessState = !surface.enabled
    ? "disabled"
    : freshness?.reason ?? "fresh";
  const freshnessDueAt = freshness?.dueAt ?? null;
  const seamStatus = buildInboundSurfaceSeamStatus(surface, { freshnessState });

  return {
    key: surface.key,
    label: surface.label,
    summary: surface.summary,
    truthLevel: surface.truthLevel,
    retrievalMode: surface.retrievalMode,
    enabled: surface.enabled,
    phase: modePolicy.phase,
    phaseRank: modePolicy.phaseRank,
    catalogOrder: surface.catalogOrder,
    freshnessState,
    freshnessDueAt,
    seamStatus,
    lastRunStatus: surface.lastRunStatus,
    lastSyncedAt: surface.lastSyncedAt,
    lastObservedAt: surface.lastObservedAt,
    lastItemCount: surface.lastItemCount,
    lastObservationCount: surface.lastObservationCount,
    lastItemizationGapCount: surface.lastItemizationGapCount,
    nextAllowedSyncAt: surface.nextAllowedSyncAt,
    backoffReason: surface.backoffReason,
    syncTrustStatus: surface.syncTrustStatus,
    lastError: surface.lastError,
    whyThisPass: describeSurfacePassReason(surface, modePolicy, freshnessState),
    observationKinds: surface.observationKinds,
    inspectCommand: `exo inbound surface ${surface.key} --json`,
    exampleObservationCommand: [
      `exo inbound observations add ${userId}`,
      `--account ${account.accountId}`,
      `--surface ${surface.key}`,
      `--kind ${surface.observationKinds[0]}`,
      "--observed-at <iso-datetime>",
      '--summary "<what changed>"'
    ].join(" "),
    successRecordCommand: [
      `exo inbound sync record ${userId}`,
      `--account ${account.accountId}`,
      `--surface ${surface.key}`,
      "--status success",
      "--item-count <count>",
      "--observed-at <iso-datetime>"
    ].join(" "),
    warningRecordCommand: [
      `exo inbound sync record ${userId}`,
      `--account ${account.accountId}`,
      `--surface ${surface.key}`,
      "--status warning",
      '--error "<what was partial or ambiguous>"',
      "--item-count <count>"
    ].join(" "),
    failedRecordCommand: [
      `exo inbound sync record ${userId}`,
      `--account ${account.accountId}`,
      `--surface ${surface.key}`,
      "--status failed",
      '--error "<why the surface could not be checked>"'
    ].join(" ")
  };
}

/**
 * @param {Record<string, any>} surface
 * @param {{ freshnessState?: string | null }} [options]
 */
export function buildInboundSurfaceSeamStatus(surface, options = {}) {
  const surfaceKey = normalizeNullableString(surface.key ?? surface.surfaceKey);
  if (!surfaceKey) return null;

  const row = findBackendCapability(surfaceKey);
  if (!row) return null;

  const freshnessState = normalizeNullableString(options.freshnessState)
    ?? deriveSurfaceFreshnessState(surface);
  const state = mapFreshnessStateToSeamState(freshnessState);

  return buildCapabilitySeamResult({
    row,
    state,
    reason: buildSurfaceSeamReason(surfaceKey, freshnessState),
    checkedAt: normalizeNullableString(surface.lastSyncedAt ?? surface.lastObservedAt),
    missingProofSurfaces: state === CAPABILITY_SEAM_STATES.MISSING_PROOF ? row.proofSurfaces : [],
    debt: {
      kind: "inbound_surface_sync_review",
      surfaceKey,
      freshnessState,
      lastRunStatus: normalizeNullableString(surface.lastRunStatus),
      lastReconcileReason: normalizeNullableString(surface.lastReconcileReason),
      lastExhaustionReason: normalizeNullableString(surface.lastExhaustionReason),
    },
  });
}

/**
 * @param {Record<string, any>} surface
 */
function deriveSurfaceFreshnessState(surface) {
  if (surface.enabled === false) return "disabled";
  if (isAutonomousSurfaceUnsupported(surface)) return "unsupported";
  if (surface.lastRunStatus === "never") return "never";
  if (surface.lastRunStatus === "failed") return "failed";
  if (surface.lastRunStatus === "warning") return "warning";
  return "fresh";
}

/**
 * @param {string | null} freshnessState
 */
function mapFreshnessStateToSeamState(freshnessState) {
  switch (freshnessState) {
    case "fresh":
    case "checked":
      return CAPABILITY_SEAM_STATES.QUIET;
    case "never":
    case "unchecked":
      return CAPABILITY_SEAM_STATES.PENDING_PROOF;
    case "warning":
    case "stale":
      return CAPABILITY_SEAM_STATES.STALE;
    case "failed":
      return CAPABILITY_SEAM_STATES.CONTRADICTED;
    case "unsupported":
    case "disabled":
      return CAPABILITY_SEAM_STATES.UNSUPPORTED;
    default:
      return CAPABILITY_SEAM_STATES.PENDING_PROOF;
  }
}

/**
 * @param {string} surfaceKey
 * @param {string | null} freshnessState
 */
function buildSurfaceSeamReason(surfaceKey, freshnessState) {
  switch (freshnessState) {
    case "fresh":
    case "checked":
      return `${surfaceKey}_truth_quiet`;
    case "never":
    case "unchecked":
      return `${surfaceKey}_truth_never_checked`;
    case "warning":
      return `${surfaceKey}_truth_partial_warning`;
    case "stale":
      return `${surfaceKey}_truth_stale`;
    case "failed":
      return `${surfaceKey}_truth_check_failed`;
    case "unsupported":
    case "disabled":
      return `${surfaceKey}_truth_unsupported`;
    default:
      return `${surfaceKey}_truth_pending`;
  }
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function materializeSurfaceStates(account) {
  const catalog = listInboundSurfaceCatalog({ capability: account.capability });
  const configuredStates = new Map((account.inboundSync?.surfaces ?? []).map((surface) => [surface.surfaceKey, surface]));

  return catalog.map((definition) =>
    inboundSurfaceStateSchema.parse({
      surfaceKey: definition.key,
      enabled: configuredStates.get(definition.key)?.enabled ?? definition.defaultEnabled,
      lastSyncedAt: configuredStates.get(definition.key)?.lastSyncedAt ?? null,
      lastObservedAt: configuredStates.get(definition.key)?.lastObservedAt ?? null,
      lastRunStatus: configuredStates.get(definition.key)?.lastRunStatus ?? "never",
      lastItemCount: configuredStates.get(definition.key)?.lastItemCount ?? null,
      lastVisibleTotalCount: configuredStates.get(definition.key)?.lastVisibleTotalCount ?? null,
      lastCaptureCompleteness: configuredStates.get(definition.key)?.lastCaptureCompleteness ?? null,
      lastRequestedMode: configuredStates.get(definition.key)?.lastRequestedMode ?? null,
      lastActualMode: configuredStates.get(definition.key)?.lastActualMode ?? null,
      lastReconcileRequired: configuredStates.get(definition.key)?.lastReconcileRequired ?? null,
      lastReconcileReason: configuredStates.get(definition.key)?.lastReconcileReason ?? null,
      lastExhaustionStatus: configuredStates.get(definition.key)?.lastExhaustionStatus ?? null,
      lastExhaustionReason: configuredStates.get(definition.key)?.lastExhaustionReason ?? null,
      lastPaginationAttempted: configuredStates.get(definition.key)?.lastPaginationAttempted ?? null,
      lastTerminalSignalSeen: configuredStates.get(definition.key)?.lastTerminalSignalSeen ?? null,
      lastStalledPassCount: configuredStates.get(definition.key)?.lastStalledPassCount ?? null,
      continuationStartedAt: configuredStates.get(definition.key)?.continuationStartedAt ?? null,
      nextCursor: configuredStates.get(definition.key)?.nextCursor ?? null,
      nextStartOffset: configuredStates.get(definition.key)?.nextStartOffset ?? null,
      providerCursor: configuredStates.get(definition.key)?.providerCursor ?? null,
      highWatermarkAt: configuredStates.get(definition.key)?.highWatermarkAt ?? null,
      highWatermarkId: configuredStates.get(definition.key)?.highWatermarkId ?? null,
      lastCompleteSnapshotId: configuredStates.get(definition.key)?.lastCompleteSnapshotId ?? null,
      nextAllowedSyncAt: configuredStates.get(definition.key)?.nextAllowedSyncAt ?? null,
      backoffReason: configuredStates.get(definition.key)?.backoffReason ?? null,
      syncTrustStatus: configuredStates.get(definition.key)?.syncTrustStatus ?? null,
      lastObservationCount: configuredStates.get(definition.key)?.lastObservationCount ?? null,
      lastItemizationGapCount: configuredStates.get(definition.key)?.lastItemizationGapCount ?? null,
      lastCountDiscrepancyCount: configuredStates.get(definition.key)?.lastCountDiscrepancyCount ?? null,
      lastError: configuredStates.get(definition.key)?.lastError ?? null
    })
  );
}

/**
 * @param {{
 *   lastReconcileReason?: string | null,
 *   lastExhaustionReason?: string | null,
 * }} surface
 */
export function hasMixedInboundBaseline(surface) {
  return normalizeNullableString(surface?.lastReconcileReason) === INBOUND_SURFACE_MIXED_BASELINE_REASON
    || normalizeNullableString(surface?.lastExhaustionReason) === INBOUND_SURFACE_MIXED_BASELINE_REASON;
}

/**
 * @param {ReturnType<typeof buildAccountInboundView>["surfaces"][number]} surface
 * @param {import("../schema/inbound.js").inboundSyncPlanModeSchema._type} mode
 */
function classifySurfaceMode(surface, mode) {
  if (mode === "quick") {
    const quickEligible = surface.truthLevel === "authoritative"
      || QUICK_MODE_SUPPLEMENTARY_SURFACES.has(surface.key);
    if (!surface.enabled || !quickEligible) {
      return null;
    }

    return {
      phase: "primary",
      phaseRank: 0
    };
  }

  if (mode === "normal") {
    if (!surface.enabled) {
      return null;
    }

    return {
      phase: surface.truthLevel === "authoritative" ? "primary" : "secondary",
      phaseRank: surface.truthLevel === "authoritative" ? 0 : 1
    };
  }

  if (surface.enabled) {
    return {
      phase: surface.truthLevel === "authoritative" ? "primary" : "secondary",
      phaseRank: surface.truthLevel === "authoritative" ? 0 : 1
    };
  }

  return {
    phase: "optional",
    phaseRank: 2
  };
}

/**
 * @param {ReturnType<typeof buildAccountInboundView>["surfaces"][number]} surface
 * @param {{ phase: string }} modePolicy
 * @param {"disabled" | "failed" | "fresh" | "never" | "stale" | "warning"} freshnessState
 */
function describeSurfacePassReason(surface, modePolicy, freshnessState) {
  const freshnessReason = (() => {
    switch (freshnessState) {
      case "never":
        return "This surface has never been checked.";
      case "failed":
        return "The last sync failed, so truth here is untrusted.";
      case "warning":
        return "The last sync completed with a warning, so truth here may be partial.";
      case "stale":
        return "The last sync is older than Exo's freshness window.";
      case "disabled":
        return "This surface is disabled in sync policy and should only be included during a full reconciliation pass if you want to widen coverage.";
      default:
        return "This surface is currently fresh, but it still belongs in this sync mode.";
    }
  })();

  const modeReason = modePolicy.phase === "primary"
    ? "Treat it as a primary truth surface in this pass."
    : modePolicy.phase === "secondary"
      ? "Treat it as secondary coverage after the primary truth surfaces."
      : "Treat it as optional coverage after the enabled surfaces are done.";

  return `${freshnessReason} ${modeReason}`;
}

function describeAutomationHealthWarningReason(freshnessReason, inRetryBackoff = false) {
  switch (freshnessReason) {
    case "never":
      return "This enabled background-truth surface has never been checked yet.";
    case "failed":
      return inRetryBackoff
        ? "The last automated retrieval failed and is still in retry backoff, so truth here is currently untrusted."
        : "The last automated retrieval failed, so truth here is currently untrusted.";
    case "warning":
      return "The last automated retrieval completed with a warning, so truth here may be partial.";
    case "stale":
      return "This enabled background-truth surface is stale and due for refresh.";
    default:
      return "This enabled background-truth surface needs refresh before live rollout.";
  }
}

/**
 * Rollout health is stricter than due scheduling. A recent failed retrieval
 * should still block send rollout even while the worker is cooling down before
 * its next retry.
 *
 * @param {{
 *   key?: string | null,
 *   lastRunStatus: "never" | "success" | "warning" | "failed",
 *   lastObservedAt?: string | null,
 *   lastSyncedAt?: string | null
 * }} surface
 * @param {string} now
 * @param {{
 *   workingHoursStatus?: { openNow: boolean, nextOpenAt: string | null } | null
 * }} [options]
 */
function classifyInboundAutomationHealthState(surface, now, options = {}) {
  if (isAutonomousSurfaceUnsupported(surface)) {
    return null;
  }

  if (surface.lastRunStatus === "failed") {
    const failedAt = surface.lastSyncedAt ? Date.parse(surface.lastSyncedAt) : Number.NaN;
    const nowMs = Date.parse(now);
    const inRetryBackoff = !Number.isNaN(failedAt) && !Number.isNaN(nowMs) && nowMs - failedAt < INBOUND_SYNC_FAILED_RETRY_MS;
    return {
      reason: "failed",
      dueAt: surface.lastSyncedAt ?? "1970-01-01T00:00:00.000Z",
      inRetryBackoff,
    };
  }

  const freshness = classifyInboundSurfaceFreshness(surface, now, {
    ...options,
    deferOutsideWorkingHours: true,
  });
  if (!freshness) {
    return null;
  }
  return {
    ...freshness,
    inRetryBackoff: false,
  };
}

/**
 * @param {{
 *   key?: string | null,
 *   lastRunStatus: "never" | "success" | "warning" | "failed",
 *   lastObservedAt?: string | null,
 *   lastSyncedAt?: string | null
 * }} surface
 * @param {{
 *   workingHoursStatus?: { openNow: boolean, nextOpenAt: string | null } | null
 * }} [options]
 */
export function computeInboundAutomationNextDueAt(surface, options = {}) {
  if (isAutonomousSurfaceUnsupported(surface)) {
    return null;
  }

  let candidateDueAt = null;
  const providerBackoffUntil = normalizeNullableIso(surface.nextAllowedSyncAt);

  if (surface.lastRunStatus === "failed" && surface.lastSyncedAt) {
    const failedAt = Date.parse(surface.lastSyncedAt);
    if (!Number.isNaN(failedAt)) {
      candidateDueAt = new Date(failedAt + INBOUND_SYNC_FAILED_RETRY_MS).toISOString();
    }
  }

  if (!candidateDueAt) {
    const freshnessTime = surface.lastObservedAt ?? surface.lastSyncedAt;
    if (freshnessTime) {
      const freshnessMs = Date.parse(freshnessTime);
      if (!Number.isNaN(freshnessMs)) {
        candidateDueAt = new Date(freshnessMs + inboundSurfaceFreshnessWindowMs(surface, options)).toISOString();
      }
    }
  }

  const nextOpenAt = normalizeNextOpenAt(options.workingHoursStatus);
  if (!candidateDueAt) {
    candidateDueAt = nextOpenAt;
  } else if (nextOpenAt) {
    candidateDueAt = laterIso(candidateDueAt, nextOpenAt);
  }
  if (!candidateDueAt) {
    return providerBackoffUntil;
  }
  if (!providerBackoffUntil) {
    return candidateDueAt;
  }
  return laterIso(candidateDueAt, providerBackoffUntil);
}

/**
 * @param {{ key?: string | null, automationCadenceMs?: number | null }} surface
 * @param {{
 *   workingHoursStatus?: { openNow: boolean, nextOpenAt: string | null } | null
 * }} [options]
 */
function inboundSurfaceFreshnessWindowMs(surface, options = {}) {
  if (surface?.key === "linkedin-messaging-inbox" && options.workingHoursStatus) {
    return INBOUND_SYNC_LINKEDIN_MESSAGE_OPEN_WINDOW_MS;
  }
  const configured = Number(surface?.automationCadenceMs);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : INBOUND_SYNC_STALE_MS;
}

/**
 * @param {{ openNow?: boolean, nextOpenAt?: string | null } | null | undefined} workingHoursStatus
 */
function normalizeNextOpenAt(workingHoursStatus) {
  if (!workingHoursStatus || workingHoursStatus.openNow) {
    return null;
  }
  const nextOpenAt = String(workingHoursStatus.nextOpenAt ?? "").trim();
  return nextOpenAt.length ? nextOpenAt : null;
}

/**
 * @param {string} left
 * @param {string} right
 */
function laterIso(left, right) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs)) {
    return right;
  }
  if (Number.isNaN(rightMs)) {
    return left;
  }
  return leftMs >= rightMs ? left : right;
}

/**
 * @param {{
 *   lastRunStatus?: string | null,
 *   lastExhaustionStatus?: string | null,
 *   lastExhaustionReason?: string | null,
 *   lastError?: string | null,
 * }} surface
 */
function isAutonomousSurfaceUnsupported(surface) {
  const exhaustionStatus = String(surface?.lastExhaustionStatus ?? "").trim().toLowerCase();
  const exhaustionReason = String(surface?.lastExhaustionReason ?? "").trim().toLowerCase();
  const lastError = String(surface?.lastError ?? "").trim().toLowerCase();

  if (exhaustionStatus !== "blocked") {
    return false;
  }

  if (exhaustionReason === "connector_surface_unsupported") {
    return true;
  }

  return lastError.includes("feature_not_implemented");
}

/**
 * @param {{
 *   lastRunStatus?: string | null,
 *   lastExhaustionStatus?: string | null,
 *   lastExhaustionReason?: string | null,
 *   lastReconcileRequired?: boolean | null,
 * }} surface
 */
function isBoundedCaptureWarning(surface) {
  return surface?.lastRunStatus === "warning"
    && surface?.lastExhaustionStatus === "incomplete"
    && surface?.lastExhaustionReason === "bounded_capture_stopped_early"
    && surface?.lastReconcileRequired === true;
}

/**
 * @param {ReturnType<typeof buildSurfaceSyncPlan>} left
 * @param {ReturnType<typeof buildSurfaceSyncPlan>} right
 */
function compareSurfaceSyncPlans(left, right) {
  return (
    left.phaseRank - right.phaseRank
    || left.catalogOrder - right.catalogOrder
  );
}

/**
 * @param {import("../schema/inbound.js").inboundSyncPlanModeSchema._type} mode
 * @param {string[]} capabilityLabels
 */
function buildPlanHeadline(mode, capabilityLabels) {
  const target = capabilityLabels.length ? capabilityLabels.join(" and ") : "connected accounts";

  switch (mode) {
    case "quick":
      return `Check the primary ${target} truth surfaces first, write back concrete observations, and refresh the planner immediately.`;
    case "normal":
      return `Run the standard ${target} inbound pass: primary truth surfaces first, supplementary coverage second, then refresh the planner.`;
    default:
      return `Run a full ${target} reconciliation pass, including optional disabled surfaces if you want wider coverage.`;
  }
}

/**
 * @param {string} capability
 */
function humanizeCapability(capability) {
  switch (capability) {
    case "linkedin":
      return "LinkedIn";
    case "gmail":
      return "Gmail";
    case "sales-navigator":
      return "Sales Navigator";
    default:
      return capability
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

/**
 * @param {string[]} surfaceKeys
 * @param {string[]} allowedSurfaces
 * @param {string} capability
 */
function normalizeSurfaceKeys(surfaceKeys, allowedSurfaces, capability) {
  const normalized = [...new Set(surfaceKeys.map((surfaceKey) => surfaceKey.trim().toLowerCase()).filter(Boolean))];

  for (const surfaceKey of normalized) {
    if (!allowedSurfaces.includes(surfaceKey)) {
      throw new Error(`Inbound surface ${surfaceKey} does not apply to capability ${capability}.`);
    }
  }

  return normalized;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableIso(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

/**
 * @param {unknown} value
 */
function normalizeSyncTrustStatus(value) {
  switch (value) {
    case "trusted":
    case "degraded":
    case "untrusted":
      return value;
    default:
      return null;
  }
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {{ metadata?: Record<string, unknown> | null }} account
 */
function resolveLinkedinRetrievalWindow(user, account) {
  const metadata = objectOrEmpty(account?.metadata);
  const policy = objectOrEmpty(metadata.inboundRetrievalPolicy ?? metadata.retrievalPolicy);
  const window = objectOrEmpty(policy.window ?? metadata.inboundRetrievalWindow ?? metadata.retrievalWindow);
  return {
    mode: "scheduled",
    timezone: normalizeNullableString(window.timezone)
      ?? normalizeNullableString(policy.timezone)
      ?? normalizeNullableString(metadata.retrievalTimezone)
      ?? normalizeNullableString(metadata.timezone)
      ?? user.workingHours.timezone,
    weekdays: normalizeWeekdays(window.weekdays ?? policy.weekdays)
      ?? DEFAULT_LINKEDIN_RETRIEVAL_WINDOW.weekdays,
    startLocalTime: normalizeLocalTime(window.startLocalTime ?? policy.startLocalTime ?? metadata.retrievalStartLocalTime)
      ?? DEFAULT_LINKEDIN_RETRIEVAL_WINDOW.startLocalTime,
    endLocalTime: normalizeLocalTime(window.endLocalTime ?? policy.endLocalTime ?? metadata.retrievalEndLocalTime)
      ?? DEFAULT_LINKEDIN_RETRIEVAL_WINDOW.endLocalTime,
  };
}

/** @param {unknown} value */
function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** @param {unknown} value */
function normalizeLocalTime(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : null;
}

/** @param {unknown} value */
function normalizeWeekdays(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const requested = new Set(
    value
      .map((item) => String(item).trim().slice(0, 3).toLowerCase())
      .filter((item) => WEEKDAY_ORDER.includes(item)),
  );
  return requested.size ? WEEKDAY_ORDER.filter((weekday) => requested.has(weekday)) : null;
}

/**
 * @param {{
 *   status: import("../schema/inbound.js").inboundSyncRunStatusSchema._type,
 *   captureCompleteness: import("../schema/inbound.js").inboundCaptureCompletenessSchema._type | null
 * }} input
 */
function inferExhaustionStatus(input) {
  if (input.status === "failed" || input.captureCompleteness === "failed") {
    return "blocked";
  }

  if (input.captureCompleteness === "complete") {
    return "complete";
  }

  return "incomplete";
}

/**
 * @param {{
 *   status: import("../schema/inbound.js").inboundSyncRunStatusSchema._type,
 *   captureCompleteness: import("../schema/inbound.js").inboundCaptureCompletenessSchema._type | null,
 *   exhaustionStatus: import("../schema/inbound.js").inboundSurfaceExhaustionStatusSchema._type | null
 * }} input
 */
function inferSyncTrustStatus(input) {
  if (input.status === "failed" || input.exhaustionStatus === "blocked" || input.captureCompleteness === "failed") {
    return "untrusted";
  }

  if (input.status === "success" && input.captureCompleteness === "complete" && input.exhaustionStatus === "complete") {
    return "trusted";
  }

  return "degraded";
}
