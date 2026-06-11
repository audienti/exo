// @ts-check

import { buildInboundSyncPayloadFromCanonicalToolResults } from "./canonical-inbound-sync-adapter.js";
import { executeToolMethodSync, parseToolMethodResultBatch } from "../lib/tool-registry.js";
import {
  ensureLinkedinToolMethodsRegistered,
  LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
  LINKEDIN_SYNC_SENT_INVITATIONS_METHOD
} from "../lib/linkedin-tool-methods.js";
import { linkedinInboundSyncCaptureSchema } from "../schema/linkedin-capture.js";
import { userSchema } from "../schema/user.js";

ensureLinkedinToolMethodsRegistered();

export const LINKEDIN_CAPTURE_SURFACE_DEFINITIONS = [
  {
    surfaceKey: "linkedin-sent-invitations",
    sectionKey: "sentInvitations",
    canonicalToolMethodId: LINKEDIN_SYNC_SENT_INVITATIONS_METHOD,
    externalIdField: "invitationId"
  },
  {
    surfaceKey: "linkedin-received-invitations",
    sectionKey: "receivedInvitations",
    canonicalToolMethodId: LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
    externalIdField: "invitationId"
  },
  {
    surfaceKey: "linkedin-messaging-inbox",
    sectionKey: "messagingInbox",
    canonicalToolMethodId: null,
    externalIdField: "threadId",
    threadUrlField: "threadUrl"
  },
  {
    surfaceKey: "linkedin-profile-views",
    sectionKey: "profileViews",
    canonicalToolMethodId: null,
    externalIdField: "viewId"
  },
  {
    surfaceKey: "linkedin-followers-list",
    sectionKey: "followersList",
    canonicalToolMethodId: null,
    externalIdField: "entryId"
  },
  {
    surfaceKey: "linkedin-following-list",
    sectionKey: "followingList",
    canonicalToolMethodId: null,
    externalIdField: "entryId"
  }
];
const LINKEDIN_CAPTURE_SURFACE_KEYS = new Set(
  LINKEDIN_CAPTURE_SURFACE_DEFINITIONS.map((definition) => definition.surfaceKey),
);

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId?: string | null,
 *   surfaceKeys?: string[] | null,
 *   capture: unknown
 * }} input
 */
export function buildLinkedinInboundSyncPayload(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const account = resolveLinkedinAccount(user, input.accountId ?? null);
  const normalized = normalizeLinkedinCaptureInput(input.capture);
  const requestedSurfaceKeys = normalizeLinkedinCaptureSurfaceKeys(input.surfaceKeys ?? null);
  const requestedSurfaceKeySet = new Set(requestedSurfaceKeys);

  const canonicalBuilt = buildInboundSyncPayloadFromCanonicalToolResults({
    accountId: account.id,
    mode: normalized.mode,
    results: normalized.results
  });
  const legacySurfaces = normalized.legacyCapture
    ? LINKEDIN_CAPTURE_SURFACE_DEFINITIONS
      .filter((definition) => !definition.canonicalToolMethodId)
      .map((definition) =>
      buildLegacySurface(definition, normalized.legacyCapture[definition.sectionKey])
    )
    : [];
  const builtSurfaces = [
    ...canonicalBuilt.payload.accounts[0].surfaces,
    ...legacySurfaces
  ].filter((surface) => requestedSurfaceKeySet.has(surface.surfaceKey));

  return {
    capture: buildCaptureSummary(normalized.mode, builtSurfaces),
    payload: {
      mode: normalized.mode,
      accounts: [
        {
          accountId: account.id,
          surfaces: builtSurfaces
        }
      ]
    }
  };
}

/**
 * @param {string[] | null | undefined} surfaceKeys
 */
export function normalizeLinkedinCaptureSurfaceKeys(surfaceKeys) {
  if (!surfaceKeys?.length) {
    return LINKEDIN_CAPTURE_SURFACE_DEFINITIONS.map((definition) => definition.surfaceKey);
  }

  const normalized = [...new Set(
    surfaceKeys
      .map((surfaceKey) => normalizeNullableString(surfaceKey)?.toLowerCase() ?? null)
      .filter(Boolean)
  )];

  for (const surfaceKey of normalized) {
    if (!LINKEDIN_CAPTURE_SURFACE_KEYS.has(surfaceKey)) {
      throw new Error(`Unsupported LinkedIn surface key: ${surfaceKey}`);
    }
  }

  return LINKEDIN_CAPTURE_SURFACE_DEFINITIONS
    .map((definition) => definition.surfaceKey)
    .filter((surfaceKey) => normalized.includes(surfaceKey));
}

/**
 * @param {unknown} rawCapture
 */
function normalizeLinkedinCaptureInput(rawCapture) {
  if (rawCapture && typeof rawCapture === "object" && Array.isArray(rawCapture.results)) {
    const batch = parseToolMethodResultBatch(rawCapture);
    return {
      mode: batch.mode,
      results: batch.results,
      legacyCapture: null
    };
  }

  const capture = linkedinInboundSyncCaptureSchema.parse(rawCapture);
  if (!["quick", "full"].includes(capture.mode)) {
    throw new Error(`LinkedIn capture currently supports quick or full mode. Received: ${capture.mode}`);
  }

  return {
    mode: capture.mode,
    results: [
      {
        toolMethodId: LINKEDIN_SYNC_SENT_INVITATIONS_METHOD,
        output: executeToolMethodSync(
          LINKEDIN_SYNC_SENT_INVITATIONS_METHOD,
          { runtime: "legacy_capture", connector: "legacy_capture", mode: "development" },
          { mode: capture.mode, legacyCapture: capture.sentInvitations }
        )
      },
      {
        toolMethodId: LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
        output: executeToolMethodSync(
          LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
          { runtime: "legacy_capture", connector: "legacy_capture", mode: "development" },
          { mode: capture.mode, legacyCapture: capture.receivedInvitations }
        )
      }
    ],
    legacyCapture: capture
  };
}

/**
 * @param {"quick" | "full"} mode
 * @param {Array<{
 *   surfaceKey: string,
 *   status: string,
 *   itemCount: number | null,
 *   visibleTotalCount: number | null,
 *   captureCompleteness: string | null,
 *   exhaustionStatus: string | null,
 *   observations: unknown[],
 *   error: string | null
 * }>} surfaces
 */
function buildCaptureSummary(mode, surfaces) {
  return {
    mode,
    sectionCount: surfaces.length,
    itemCount: surfaces.reduce((sum, surface) => sum + (surface.itemCount ?? 0), 0),
    sections: surfaces.map((surface) => ({
      surfaceKey: surface.surfaceKey,
      status: surface.status,
      itemCount: surface.itemCount,
      visibleTotalCount: surface.visibleTotalCount,
      captureCompleteness: surface.captureCompleteness,
      exhaustionStatus: surface.exhaustionStatus,
      observationCount: surface.observations.length,
      error: surface.error
    }))
  };
}

/**
 * @param {{ surfaceKey: string, sectionKey: string, externalIdField: string, threadUrlField?: string }} definition
 * @param {any} section
 */
function buildLegacySurface(definition, section) {
  const exhaustionStatus = normalizeSurfaceExhaustionStatus(section);
  const exhaustionReason = normalizeNullableString(section.exhaustionReason);
  const paginationAttempted = typeof section.paginationAttempted === "boolean" ? section.paginationAttempted : null;
  const terminalSignalSeen = typeof section.terminalSignalSeen === "boolean" ? section.terminalSignalSeen : null;
  const stalledPassCount = Number.isInteger(section.stalledPassCount) ? section.stalledPassCount : null;
  const continuationStartedAt = normalizeNullableString(section.continuationStartedAt);
  const nextCursor = normalizeNullableString(section.nextCursor);
  const nextStartOffset = Number.isInteger(section.nextStartOffset) && section.nextStartOffset >= 0
    ? section.nextStartOffset
    : null;

  if (section.status === "success" && section.error) {
    throw new Error(`Successful LinkedIn captures cannot include an error: ${definition.surfaceKey}`);
  }

  if (section.status !== "success" && !section.error) {
    throw new Error(`LinkedIn capture needs an error detail for ${definition.surfaceKey} (${section.status}).`);
  }

  if (section.status === "failed" && section.items.length) {
    throw new Error(`Failed LinkedIn captures cannot include items: ${definition.surfaceKey}`);
  }

  const derivedItemCount = section.status === "failed"
    ? section.itemCount
    : section.itemCount ?? section.items.length;
  const rawVisibleTotalCount = section.visibleTotalCount ?? null;
  const visibleTotalCount = section.status === "failed"
    ? rawVisibleTotalCount
    : normalizeVisibleTotalCount(rawVisibleTotalCount, derivedItemCount);
  if (derivedItemCount !== null && derivedItemCount < section.items.length) {
    throw new Error(
      `LinkedIn capture reported ${derivedItemCount} items but included ${section.items.length} items for ${definition.surfaceKey}.`
    );
  }

  if (section.status === "failed" && derivedItemCount && derivedItemCount > 0) {
    throw new Error(`Failed LinkedIn captures cannot report positive item counts: ${definition.surfaceKey}`);
  }

  if (section.status === "failed" && visibleTotalCount && visibleTotalCount > 0) {
    throw new Error(`Failed LinkedIn captures cannot report positive visible totals: ${definition.surfaceKey}`);
  }

  if (section.status === "failed" && section.captureCompleteness && section.captureCompleteness !== "failed") {
    throw new Error(`Failed LinkedIn captures must mark captureCompleteness as failed for ${definition.surfaceKey}.`);
  }

  if (section.status !== "failed" && section.captureCompleteness === "failed") {
    throw new Error(`Successful or warning LinkedIn captures cannot mark captureCompleteness as failed for ${definition.surfaceKey}.`);
  }

  if (section.status === "failed" && exhaustionStatus !== "blocked") {
    throw new Error(`Failed LinkedIn captures must mark exhaustionStatus as blocked for ${definition.surfaceKey}.`);
  }

  if (section.status !== "failed" && exhaustionStatus === "blocked") {
    throw new Error(`Only failed LinkedIn captures can mark exhaustionStatus as blocked for ${definition.surfaceKey}.`);
  }

  if (section.captureCompleteness === "complete" && exhaustionStatus !== "complete") {
    throw new Error(`Complete LinkedIn captures must mark exhaustionStatus as complete for ${definition.surfaceKey}.`);
  }

  if (exhaustionStatus === "complete" && section.captureCompleteness !== "complete") {
    throw new Error(`LinkedIn captures with complete exhaustion must mark captureCompleteness as complete for ${definition.surfaceKey}.`);
  }

  const newestItemAt = section.items.map((item) => item.observedAt).sort().at(-1) ?? null;
  const observedAt = newestIsoDatetime(section.checkedAt, newestItemAt);
  const reportedCount = visibleTotalCount ?? derivedItemCount;
  if (section.status !== "failed" && reportedCount && reportedCount > 0 && !observedAt) {
    throw new Error(`LinkedIn capture needs checkedAt or item observedAt when items were found: ${definition.surfaceKey}`);
  }

  const observations = section.items.map((item) => ({
    kind: item.kind,
    observedAt: item.observedAt,
    eventAt: item.eventAt ?? null,
    summary: item.summary,
    externalId: item[definition.externalIdField],
    actorName: item.actorName,
    actorTitle: item.actorTitle,
    actorCompanyName: item.actorCompanyName,
    actorHandle: item.actorHandle,
    actorProfileUrl: item.actorProfileUrl,
    actorLinkedinPublicId: item.actorLinkedinPublicId,
    actorLinkedinMemberId: item.actorLinkedinMemberId,
    actorAvatarSourceUrl: item.actorAvatarSourceUrl,
    threadUrl: definition.threadUrlField ? item[definition.threadUrlField] : null,
    sourceUrl: item.sourceUrl,
    subject: item.subject ?? null,
    motionId: item.motionId,
    companyId: item.companyId,
    prospectId: item.prospectId,
    actorCompanyProfile: item.actorCompanyProfile ?? null,
    notes: item.notes,
    messages: item.messages ?? []
  }));

  return {
    surfaceKey: definition.surfaceKey,
    status: section.status,
    observedAt,
    itemCount: derivedItemCount,
    visibleTotalCount,
    captureCompleteness: section.captureCompleteness,
    requestedMode: section.requestedMode,
    actualMode: section.actualMode,
    reconcileRequired: section.reconcileRequired,
    reconcileReason: section.reconcileReason,
    exhaustionStatus,
    exhaustionReason,
    paginationAttempted,
    terminalSignalSeen,
    stalledPassCount,
    continuationStartedAt,
    nextCursor,
    nextStartOffset,
    error: section.error,
    observations
  };
}

/**
 * @param {any} section
 */
function normalizeSurfaceExhaustionStatus(section) {
  if (section.exhaustionStatus) {
    return section.exhaustionStatus;
  }

  if (section.status === "failed" || section.captureCompleteness === "failed") {
    return "blocked";
  }

  if (section.captureCompleteness === "complete") {
    return "complete";
  }

  return "incomplete";
}

/**
 * @param {number | null} visibleTotalCount
 * @param {number | null} itemCount
 */
function normalizeVisibleTotalCount(visibleTotalCount, itemCount) {
  if (visibleTotalCount === null || itemCount === null) return visibleTotalCount;
  return Math.max(visibleTotalCount, itemCount);
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
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {string | null} accountId
 */
export function resolveLinkedinAccount(user, accountId) {
  if (accountId) {
    const account = user.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      throw new Error(`User account not found: ${accountId}`);
    }

    if (account.capability !== "linkedin") {
      throw new Error(`Account ${accountId} is not a LinkedIn account.`);
    }

    return account;
  }

  const linkedinAccounts = user.accounts.filter((candidate) => candidate.capability === "linkedin");
  if (linkedinAccounts.length === 1) {
    return linkedinAccounts[0];
  }

  if (!linkedinAccounts.length) {
    throw new Error(`User ${user.label} does not have a LinkedIn account.`);
  }

  throw new Error(`User ${user.label} has multiple LinkedIn accounts. Pass --account explicitly.`);
}

/**
 * @param {string | null} left
 * @param {string | null} right
 */
function newestIsoDatetime(left, right) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left >= right ? left : right;
}
