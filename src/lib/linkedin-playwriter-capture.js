// @ts-check

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildLinkedinQuickCaptureEvaluateSource,
} from "./linkedin-quick-capture-scaffold.js";
import { buildLinkedinQuickSurfaceHints } from "./live-surface-hints.js";

const LINKEDIN_PLAYWRITER_OUTPUT_MARKER = "__EXO_LINKEDIN_PLAYWRITER_JSON__";
const DEFAULT_LIMIT = 20;
const DEFAULT_TOTAL_TIMEOUT_MS = 300000;
const MIN_SURFACE_TIMEOUT_MS = 15000;
const MAX_PLAYWRITER_ROWS_PER_SURFACE_QUICK = 8;
const MIN_PLAYWRITER_ROWS_PER_SURFACE_FULL = 50;
const MAX_PLAYWRITER_ROWS_PER_SURFACE_FULL = 100;
const READY_WAIT_TIMEOUT_MS = 12000;
const READY_POLL_INTERVAL_MS = 500;
const READY_SETTLE_MS = 1500;
const INVITATION_READY_MIN_SIGNAL_COUNT = 2;
const INVITATION_READY_MIN_STABLE_POLLS = 2;
const INVITATION_READY_MIN_ELAPSED_MS = 2500;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const LINKEDIN_QUICK_SURFACE_DEFINITIONS = [
  {
    surfaceKey: "sentInvitations",
    resolveTargetUrl: (hint) =>
      hint?.entryHints?.sentManagerUrls?.[0]
      ?? hint?.entryHints?.startUrls?.at(-1)
      ?? "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
  },
  {
    surfaceKey: "receivedInvitations",
    resolveTargetUrl: (hint) =>
      hint?.entryHints?.receivedManagerUrls?.[0]
      ?? hint?.entryHints?.startUrls?.at(-1)
      ?? "https://www.linkedin.com/mynetwork/invitation-manager/received/",
  },
  {
    surfaceKey: "messagingInbox",
    resolveTargetUrl: (hint) =>
      hint?.entryHints?.startUrls?.find((candidate) => typeof candidate === "string" && candidate.includes("/messaging"))
      ?? "https://www.linkedin.com/messaging/",
  },
  {
    surfaceKey: "profileViews",
    resolveTargetUrl: (hint) =>
      hint?.entryHints?.directProfileViewsUrl
      ?? hint?.entryHints?.startUrls?.at(-1)
      ?? "https://www.linkedin.com/analytics/profile-views/",
  },
  {
    surfaceKey: "followersList",
    resolveTargetUrl: (hint) =>
      hint?.entryHints?.directFollowersUrl
      ?? hint?.entryHints?.startUrls?.at(-1)
      ?? "https://www.linkedin.com/mynetwork/network-manager/people-follow/followers/",
  },
  {
    surfaceKey: "followingList",
    resolveTargetUrl: (hint) =>
      hint?.entryHints?.directFollowingUrl
      ?? hint?.entryHints?.startUrls?.at(-1)
      ?? "https://www.linkedin.com/mynetwork/network-manager/people-follow/following/",
  },
];

/**
 * @param {{
 *   sessionId: string,
 *   playwriterBin: string,
 *   mode?: "quick" | "full" | null,
 *   limit?: number | null,
 *   timeoutMs?: number | null,
 *   surfaceHints?: Record<string, any> | null,
 * }} input
 */
export function captureLinkedinQuickSurfacesWithPlaywriter(input) {
  const mode = input.mode === "full" ? "full" : "quick";
  const limit = resolveLinkedinPlaywriterLimit(mode, input.limit);
  const totalTimeoutMs = normalizePositiveInteger(input.timeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
  const perSurfaceTimeoutMs = Math.max(
    MIN_SURFACE_TIMEOUT_MS,
    Math.floor(totalTimeoutMs / LINKEDIN_QUICK_SURFACE_DEFINITIONS.length),
  );
  const surfaceHints = input.surfaceHints ?? buildLinkedinQuickSurfaceHints({ limit });
  const sections = {};

  for (const definition of LINKEDIN_QUICK_SURFACE_DEFINITIONS) {
    const hint = surfaceHints?.[definition.surfaceKey] ?? null;
    const targetUrl = definition.resolveTargetUrl(hint);

    try {
      const rawResult = runLinkedinSurfaceSnapshotThroughPlaywriter({
        sessionId: input.sessionId,
        playwriterBin: input.playwriterBin,
        surfaceKey: definition.surfaceKey,
        hint,
        targetUrl,
        mode,
        limit,
        timeoutMs: perSurfaceTimeoutMs,
      });
      sections[definition.surfaceKey] = buildLinkedinSurfaceCaptureFromSnapshot({
        surfaceKey: definition.surfaceKey,
        rawResult,
        mode,
      });
    } catch (error) {
      sections[definition.surfaceKey] = buildFailedLinkedinSurfaceCapture(
        mode,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const summary = summarizeLinkedinSurfaceCaptures(sections);
  return {
    mode,
    status: summary.status,
    checkedAt: summary.checkedAt,
    itemCount: summary.itemCount,
    error: summary.error,
    ...sections,
  };
}

/**
 * @param {{
 *   sessionId: string,
 *   playwriterBin: string,
 *   surfaceKey: string,
 *   hint: any,
 *   targetUrl: string,
 *   mode: "quick" | "full",
  *   limit: number,
  *   timeoutMs: number,
 * }} input
 */
function runLinkedinSurfaceSnapshotThroughPlaywriter(input) {
  const outputPath = path.join(
    os.tmpdir(),
    `exo-linkedin-playwriter-${input.surfaceKey}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`,
  );
  try {
    const script = buildLinkedinPlaywriterSurfaceScript({
      ...input,
      outputPath,
    });
    const stdout = execFileSync(input.playwriterBin, [
      "-s",
      input.sessionId,
      "--timeout",
      String(input.timeoutMs),
      "-e",
      script,
    ], {
      encoding: "utf8",
      maxBuffer: MAX_BUFFER_BYTES,
      env: {
        ...process.env,
        PLAYWRITER_AUTO_ENABLE: "1",
      },
      timeout: input.timeoutMs + 10000,
    });
    const markerPayload = parsePlaywriterMarkerJson(stdout, LINKEDIN_PLAYWRITER_OUTPUT_MARKER);
    const resolvedOutputPath = typeof markerPayload?.outputPath === "string" && markerPayload.outputPath.trim().length
      ? markerPayload.outputPath
      : outputPath;
    if (!fs.existsSync(resolvedOutputPath)) {
      throw new Error(`Playwriter did not materialize ${input.surfaceKey} snapshot output at ${resolvedOutputPath}.`);
    }
    return JSON.parse(fs.readFileSync(resolvedOutputPath, "utf8"));
  } finally {
    safeUnlink(outputPath);
  }
}

/**
 * @param {{
 *   surfaceKey: string,
 *   hint: any,
 *   targetUrl: string,
 *   mode: "quick" | "full",
 *   limit: number,
 *   timeoutMs: number,
 *   outputPath: string,
 * }} input
 */
export function buildLinkedinPlaywriterSurfaceScript(input) {
  const evaluateSource = buildLinkedinQuickCaptureEvaluateSource({
    surfaceKey: /** @type {any} */ (input.surfaceKey),
    requestedMode: input.mode,
    limit: input.limit,
    hint: input.hint,
  });
  const readySelectors = collectReadySelectors(input.hint);
  const navigationTimeoutMs = Math.max(MIN_SURFACE_TIMEOUT_MS, Math.floor(input.timeoutMs * 0.75));
  const readiness = buildLinkedinSurfaceReadinessPolicy(input.surfaceKey);

  return [
    "state.page = state.page && !state.page.isClosed() ? state.page : await context.newPage();",
    `await state.page.goto(${JSON.stringify(input.targetUrl)}, { waitUntil: "domcontentloaded", timeout: ${navigationTimeoutMs} });`,
    "await state.page.waitForLoadState('domcontentloaded');",
    `const readySelectors = ${JSON.stringify(readySelectors)};`,
    `const readiness = ${JSON.stringify(readiness)};`,
    `const readyDeadline = Date.now() + ${READY_WAIT_TIMEOUT_MS};`,
    "let readySelector = null;",
    "let readySignalCount = 0;",
    "let previousReadySignalCount = null;",
    "let stableReadySignalPolls = 0;",
    "const readyStartedAt = Date.now();",
    "while (Date.now() < readyDeadline) {",
    "  const readyState = await state.page.evaluate(({ selectors, readiness }) => {",
    "    let resolvedSelector = null;",
    "    for (const selector of selectors) {",
    "      try {",
    "        if (selector && document.querySelector(selector)) {",
    "          resolvedSelector = selector;",
    "          break;",
    "        }",
    "      } catch (_error) {",
    "        continue;",
    "      }",
    "    }",
    "    if (!resolvedSelector) {",
    "      return { readySelector: null, readySignalCount: 0 };",
    "    }",
    "    if (!readiness?.controlPattern) {",
    "      return { readySelector: resolvedSelector, readySignalCount: 0 };",
    "    }",
    "    const root = document.querySelector(resolvedSelector) || document.querySelector('main') || document.body;",
    "    const pattern = new RegExp(readiness.controlPattern, 'i');",
    "    const controlCount = Array.from(root.querySelectorAll('button, a, span')).filter((node) => {",
    "      const text = typeof node.textContent === 'string' ? node.textContent : '';",
    "      const label = typeof node.getAttribute === 'function' ? node.getAttribute('aria-label') || '' : '';",
    "      return pattern.test(`${text} ${label}`.replace(/\\s+/g, ' ').trim());",
    "    }).length;",
    "    const anchorCount = root.querySelectorAll('a[href*=\"/in/\"]').length;",
    "    return { readySelector: resolvedSelector, readySignalCount: Math.max(controlCount, anchorCount) };",
    "  }, { selectors: readySelectors, readiness });",
    "  readySelector = readyState.readySelector || readySelector;",
    "  readySignalCount = Number.isFinite(readyState.readySignalCount) ? readyState.readySignalCount : 0;",
    "  if (readySelector) {",
    "    if (readiness?.controlPattern) {",
    "      stableReadySignalPolls = readySignalCount === previousReadySignalCount && readySignalCount > 0",
    "        ? stableReadySignalPolls + 1",
    "        : 0;",
    "      previousReadySignalCount = readySignalCount;",
    "      const elapsed = Date.now() - readyStartedAt;",
    "      const enoughRows = readySignalCount >= (readiness.minimumSignalCount || 1);",
    "      const stableEnough = stableReadySignalPolls >= (readiness.minimumStablePolls || 0);",
    "      const elapsedEnough = elapsed >= (readiness.minimumElapsedMs || 0);",
    "      if (enoughRows && stableEnough && elapsedEnough) break;",
    "    } else {",
    "      break;",
    "    }",
    "  }",
    `  await new Promise((resolve) => setTimeout(resolve, ${READY_POLL_INTERVAL_MS}));`,
    "}",
    `await new Promise((resolve) => setTimeout(resolve, ${READY_SETTLE_MS}));`,
    `const snapshot = await state.page.evaluate(${JSON.stringify(evaluateSource)});`,
    "const pageUrl = state.page.url();",
    "const pageTitle = await state.page.title();",
    `const outputPath = ${JSON.stringify(input.outputPath)};`,
    "require('node:fs').writeFileSync(outputPath, JSON.stringify({ snapshot, pageUrl, pageTitle, readySelector }));",
    `console.log(${JSON.stringify(LINKEDIN_PLAYWRITER_OUTPUT_MARKER)} + JSON.stringify({ outputPath }));`,
  ].join("\n");
}

/**
 * @param {string} surfaceKey
 */
function buildLinkedinSurfaceReadinessPolicy(surfaceKey) {
  if (surfaceKey === "sentInvitations") {
    return {
      controlPattern: "withdraw",
      minimumSignalCount: INVITATION_READY_MIN_SIGNAL_COUNT,
      minimumStablePolls: INVITATION_READY_MIN_STABLE_POLLS,
      minimumElapsedMs: INVITATION_READY_MIN_ELAPSED_MS,
    };
  }
  if (surfaceKey === "receivedInvitations") {
    return {
      controlPattern: "(accept|ignore)",
      minimumSignalCount: INVITATION_READY_MIN_SIGNAL_COUNT,
      minimumStablePolls: INVITATION_READY_MIN_STABLE_POLLS,
      minimumElapsedMs: INVITATION_READY_MIN_ELAPSED_MS,
    };
  }
  return {
    controlPattern: null,
    minimumSignalCount: 0,
    minimumStablePolls: 0,
    minimumElapsedMs: 0,
  };
}

/**
 * @param {any} hint
 */
function collectReadySelectors(hint) {
  const selectors = [
    ...(hint?.readyHints?.finiteScrollSelectors ?? []),
    ...(hint?.readyHints?.conversationListScrollSelectors ?? []),
    ...(hint?.readyHints?.domFallbackRootSelectors ?? []),
    ...(hint?.readyHints?.rowSelectors ?? []),
    hint?.readyHints?.conversationRowsSelector ?? null,
    "main[role='main']",
    "main",
  ];
  const seen = new Set();
  return selectors.filter((selector) => {
    if (typeof selector !== "string" || !selector.trim() || seen.has(selector)) {
      return false;
    }
    seen.add(selector);
    return true;
  });
}

/**
 * @param {{ surfaceKey: string, rawResult: any, mode: "quick" | "full" }} input
 */
export function buildLinkedinSurfaceCaptureFromSnapshot(input) {
  const checkedAt = normalizeIsoDatetime(input.rawResult?.snapshot?.capturedAt) ?? new Date().toISOString();
  const snapshot = input.rawResult?.snapshot ?? null;
  const readySelector = normalizeNullableString(input.rawResult?.readySelector);
  const pageUrl = normalizeNullableString(input.rawResult?.pageUrl);
  const pageTitle = normalizeNullableString(input.rawResult?.pageTitle);

  if (!snapshot || snapshot.unsupported) {
    return buildFailedLinkedinSurfaceCapture(
      input.mode,
      snapshot?.reason ?? `${input.surfaceKey} capture is unsupported.`,
      checkedAt,
    );
  }

  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const items = rows.map((row) =>
    buildLinkedinObservationItem(input.surfaceKey, row, checkedAt, pageUrl),
  );
  const visibleTotalCount = deriveVisibleTotalCount(snapshot, items.length);
  const partial = visibleTotalCount !== null && visibleTotalCount > items.length;

  if (!readySelector && !items.length) {
    return buildFailedLinkedinSurfaceCapture(
      input.mode,
      `${input.surfaceKey} did not render a usable LinkedIn surface at ${pageUrl ?? "unknown url"}${pageTitle ? ` (${pageTitle})` : ""}.`,
      checkedAt,
    );
  }

  return {
    status: partial ? "warning" : "success",
    checkedAt,
    itemCount: items.length,
    visibleTotalCount,
    captureCompleteness: partial ? "partial_visible_slice" : "complete",
    requestedMode: input.mode,
    actualMode: input.mode,
    reconcileRequired: partial ? true : null,
    reconcileReason: partial ? "Visible surface total exceeded the bounded itemized slice." : null,
    exhaustionStatus: partial ? "incomplete" : "complete",
    exhaustionReason: partial ? "visible_total_exceeds_itemized_rows" : null,
    paginationAttempted: false,
    terminalSignalSeen: partial ? false : true,
    stalledPassCount: 0,
    error: partial ? "Visible surface total exceeded the bounded itemized slice." : null,
    items,
  };
}

/**
 * @param {string} surfaceKey
 * @param {any} row
 * @param {string} observedAt
 * @param {string | null} pageUrl
 */
function buildLinkedinObservationItem(surfaceKey, row, observedAt, pageUrl) {
  const actorProfileUrl = normalizeNullableString(row?.actorProfileUrl ?? row?.profileUrl) ?? null;
  const actorLinkedinPublicId = normalizeNullableString(row?.actorLinkedinPublicId) ?? null;
  const actorName = resolveLinkedinActorName(surfaceKey, row);
  const base = {
    observedAt,
    summary: truncateSummary(resolveLinkedinRowSummary(surfaceKey, row, actorName)),
    actorName,
    actorTitle: normalizeNullableString(row?.actorTitle) ?? null,
    actorCompanyName: normalizeNullableString(row?.actorCompanyName) ?? null,
    actorHandle: actorLinkedinPublicId,
    actorProfileUrl,
    actorLinkedinPublicId,
    actorLinkedinMemberId: normalizeNullableString(row?.actorLinkedinMemberId) ?? null,
    actorAvatarSourceUrl: normalizeNullableString(row?.actorAvatarSourceUrl) ?? null,
    sourceUrl: pageUrl,
    motionId: null,
    companyId: null,
    prospectId: null,
    notes: resolveLinkedinRowNotes(surfaceKey, row),
  };

  if (surfaceKey === "sentInvitations") {
    return {
      invitationId: normalizeNullableString(row?.invitationId ?? row?.rowKey) ?? "sent-invitation",
      kind: "connection_request_pending",
      eventAt: deriveRelativeEventAt(base.summary, observedAt),
      ...base,
    };
  }

  if (surfaceKey === "receivedInvitations") {
    return {
      invitationId: normalizeNullableString(row?.invitationId ?? row?.rowKey) ?? "received-invitation",
      kind: "connection_request_received",
      ...base,
    };
  }

  if (surfaceKey === "messagingInbox") {
    return {
      threadId: normalizeNullableString(row?.threadId ?? row?.rowKey) ?? "thread",
      kind: "thread_updated",
      threadUrl: normalizeNullableString(row?.threadUrl) ?? null,
      ...base,
    };
  }

  if (surfaceKey === "profileViews") {
    return {
      viewId: normalizeNullableString(row?.viewId ?? row?.rowKey) ?? "profile-view",
      kind: "profile_view_received",
      eventAt: deriveRelativeEventAt(base.summary, observedAt),
      ...base,
    };
  }

  if (surfaceKey === "followersList") {
    return {
      entryId: normalizeNullableString(row?.entryId ?? row?.rowKey) ?? "follower",
      kind: "follower_confirmed",
      ...base,
    };
  }

  return {
    entryId: normalizeNullableString(row?.entryId ?? row?.rowKey) ?? "following",
    kind: "follow_state_confirmed",
    ...base,
  };
}

/**
 * @param {Record<string, any>} sections
 */
export function summarizeLinkedinSurfaceCaptures(sections) {
  const entries = LINKEDIN_QUICK_SURFACE_DEFINITIONS
    .map((definition) => ({
      surfaceKey: definition.surfaceKey,
      capture: sections[definition.surfaceKey],
    }))
    .filter((entry) => entry.capture);
  const captures = entries.map((entry) => entry.capture);

  const checkedAt = captures
    .map((capture) => normalizeIsoDatetime(capture?.checkedAt))
    .filter(Boolean)
    .sort()
    .at(-1) ?? new Date().toISOString();
  const itemCount = captures.reduce(
    (sum, capture) => sum + (Number.isInteger(capture?.itemCount) ? capture.itemCount : 0),
    0,
  );
  const failedCaptures = entries.filter((entry) => entry.capture?.status === "failed");
  const warningCaptures = captures.filter((capture) => capture?.status === "warning");

  const status = failedCaptures.length === captures.length
    ? "failed"
    : (failedCaptures.length || warningCaptures.length ? "warning" : "success");
  const error = failedCaptures.length
    ? failedCaptures
      .map((entry) => {
        return `${entry.surfaceKey}: ${entry.capture.error}`;
      })
      .join(" | ")
    : null;

  return {
    status,
    checkedAt,
    itemCount,
    error,
  };
}

/**
 * @param {string} mode
 * @param {string} error
 * @param {string | null} [checkedAt]
 */
function buildFailedLinkedinSurfaceCapture(mode, error, checkedAt = null) {
  return {
    status: "failed",
    checkedAt: checkedAt ?? new Date().toISOString(),
    itemCount: 0,
    visibleTotalCount: 0,
    captureCompleteness: "failed",
    requestedMode: mode,
    actualMode: mode,
    reconcileRequired: null,
    reconcileReason: null,
    exhaustionStatus: "blocked",
    exhaustionReason: "transport_failure",
    paginationAttempted: false,
    terminalSignalSeen: false,
    stalledPassCount: 0,
    error,
    items: [],
  };
}

/**
 * @param {any} snapshot
 * @param {number} itemCount
 */
function deriveVisibleTotalCount(snapshot, itemCount) {
  const counts = [
    Number.isInteger(snapshot?.visibleTotalCount) ? snapshot.visibleTotalCount : null,
    Number.isInteger(snapshot?.rowCount) ? snapshot.rowCount : null,
    itemCount,
  ].filter((value) => Number.isInteger(value) && value >= 0);
  return counts.length ? Math.max(...counts) : null;
}

/**
 * @param {string} stdout
 * @param {string} marker
 */
export function parsePlaywriterMarkerJson(stdout, marker) {
  const line = String(stdout ?? "")
    .split("\n")
    .find((candidate) => candidate.includes(marker));
  if (!line) {
    throw new Error(`Playwriter output did not include ${marker}.`);
  }
  const start = line.indexOf(marker);
  const jsonText = line.slice(start + marker.length).trim();
  return JSON.parse(jsonText);
}

/**
 * @param {"quick" | "full"} mode
 * @param {number | string | null | undefined} requestedLimit
 */
function resolveLinkedinPlaywriterLimit(mode, requestedLimit) {
  const normalized = normalizePositiveInteger(requestedLimit, DEFAULT_LIMIT);
  if (mode === "full") {
    return Math.min(
      Math.max(normalized, MIN_PLAYWRITER_ROWS_PER_SURFACE_FULL),
      MAX_PLAYWRITER_ROWS_PER_SURFACE_FULL,
    );
  }
  return Math.min(normalized, MAX_PLAYWRITER_ROWS_PER_SURFACE_QUICK);
}

/**
 * @param {string} surfaceKey
 * @param {string | null} actorName
 */
function defaultLinkedinRowSummary(surfaceKey, actorName) {
  const subject = actorName ?? "A LinkedIn profile";
  switch (surfaceKey) {
    case "sentInvitations":
      return `${subject} is still in the sent invitations queue.`;
    case "receivedInvitations":
      return `${subject} sent an inbound connection request.`;
    case "messagingInbox":
      return `${subject} has a LinkedIn thread update.`;
    case "profileViews":
      return `${subject} viewed the LinkedIn profile.`;
    case "followersList":
      return `${subject} is following the LinkedIn account.`;
    default:
      return `${subject} is in the LinkedIn following list.`;
  }
}

/**
 * @param {string} surfaceKey
 * @param {any} row
 */
function resolveLinkedinActorName(surfaceKey, row) {
  const candidates = [
    normalizeNullableString(row?.actorName),
    normalizeNullableString(row?.summary),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeLinkedinActorNameCandidate(surfaceKey, candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

/**
 * @param {string} surfaceKey
 * @param {string | null | undefined} candidate
 */
function normalizeLinkedinActorNameCandidate(surfaceKey, candidate) {
  const text = normalizeNullableString(candidate);
  if (!text) {
    return null;
  }

  if (surfaceKey === "sentInvitations") {
    const sentMatch = text.match(/^withdraw invitation sent to (.+)$/i);
    if (sentMatch) {
      return normalizeNullableString(sentMatch[1]) ?? null;
    }
  }

  if (surfaceKey === "receivedInvitations") {
    const receivedMatch = text.match(/^(?:accept|ignore)\s+(.+?)'s invitation$/i);
    if (receivedMatch) {
      return normalizeNullableString(receivedMatch[1]) ?? null;
    }
  }

  if (looksLikeLinkedinControlLabel(text)) {
    return null;
  }

  return text;
}

/**
 * @param {string} surfaceKey
 * @param {any} row
 * @param {string | null} actorName
 */
function resolveLinkedinRowSummary(surfaceKey, row, actorName) {
  const summary = normalizeNullableString(row?.summary);
  if (summary && !looksLikeLinkedinControlOnlySummary(summary)) {
    return summary;
  }
  return defaultLinkedinRowSummary(surfaceKey, actorName);
}

/**
 * @param {string} surfaceKey
 * @param {any} row
 */
function resolveLinkedinRowNotes(surfaceKey, row) {
  if (surfaceKey !== "sentInvitations" && surfaceKey !== "receivedInvitations") {
    return null;
  }
  return normalizeNullableString(row?.invitationNote ?? row?.notes) ?? null;
}

/**
 * @param {string | null | undefined} value
 */
function looksLikeLinkedinControlOnlySummary(value) {
  const text = normalizeNullableString(value);
  if (!text) {
    return true;
  }
  return looksLikeLinkedinControlLabel(text);
}

/**
 * @param {string | null | undefined} value
 */
function looksLikeLinkedinControlLabel(value) {
  const text = normalizeNullableString(value);
  if (!text) {
    return false;
  }
  return /^(withdraw|accept|ignore)\b/i.test(text);
}

/**
 * @param {string} value
 */
function truncateSummary(value) {
  if (value.length <= 280) {
    return value;
  }
  return `${value.slice(0, 277).trimEnd()}...`;
}

/**
 * @param {string | null | undefined} text
 * @param {string} observedAt
 */
function deriveRelativeEventAt(text, observedAt) {
  const observedDate = new Date(observedAt);
  if (!text || Number.isNaN(observedDate.getTime())) {
    return null;
  }

  const lowered = text.toLowerCase();
  let offsetMs = null;
  if (/\b(today)\b/.test(lowered)) {
    offsetMs = 0;
  } else if (/\b(yesterday|last day)\b/.test(lowered)) {
    offsetMs = 24 * 60 * 60 * 1000;
  } else if (/\b(last week)\b/.test(lowered)) {
    offsetMs = 7 * 24 * 60 * 60 * 1000;
  } else if (/\b(last month)\b/.test(lowered)) {
    offsetMs = 30 * 24 * 60 * 60 * 1000;
  } else {
    const match = lowered.match(/\b(\d+)\s+(hour|day|week|month|year)s?\s+ago\b/);
    if (match) {
      const count = Number.parseInt(match[1], 10);
      const unit = match[2];
      const unitMs = unit === "hour"
        ? 60 * 60 * 1000
        : unit === "day"
          ? 24 * 60 * 60 * 1000
          : unit === "week"
            ? 7 * 24 * 60 * 60 * 1000
            : unit === "month"
              ? 30 * 24 * 60 * 60 * 1000
              : 365 * 24 * 60 * 60 * 1000;
      offsetMs = count * unitMs;
    }
  }

  if (offsetMs === null) {
    return null;
  }

  return new Date(observedDate.getTime() - offsetMs).toISOString();
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeIsoDatetime(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

/**
 * @param {number | string | null | undefined} value
 * @param {number} fallback
 */
function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.trunc(parsed);
}

/**
 * @param {string} filePath
 */
function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_error) {
    // Best-effort cleanup only.
  }
}
