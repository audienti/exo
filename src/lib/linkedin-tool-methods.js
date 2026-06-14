// @ts-check

import { z } from "zod";
import {
  extractReceivedInvitationsFromNetworkBodies,
  extractSentInvitationsFromNetworkBodies
} from "./linkedin-retrieval-tool.js";
import { registerToolMethod } from "./tool-registry.js";
import { linkedinReceivedInvitationCaptureSchema, linkedinSentInvitationCaptureSchema, linkedinSurfaceCaptureSchema } from "../schema/linkedin-capture.js";
import {
  canonicalInvitationSurfaceInputSchema,
  canonicalReceivedInvitationSurfaceResultSchema,
  canonicalSentInvitationSurfaceResultSchema
} from "../schema/surfaces/index.js";

export const LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD = "linkedin.syncReceivedInvitations";
export const LINKEDIN_SYNC_SENT_INVITATIONS_METHOD = "linkedin.syncSentInvitations";
const linkedinSurfaceRawBodiesSchema = z.array(z.unknown());

const linkedinSentInvitationToolInputSchema = canonicalInvitationSurfaceInputSchema.extend({
  legacyCapture: linkedinSurfaceCaptureSchema.extend({
    items: z.array(linkedinSentInvitationCaptureSchema).default([])
  }).optional(),
  networkBodies: linkedinSurfaceRawBodiesSchema.optional()
});

const linkedinReceivedInvitationToolInputSchema = canonicalInvitationSurfaceInputSchema.extend({
  legacyCapture: linkedinSurfaceCaptureSchema.extend({
    items: z.array(linkedinReceivedInvitationCaptureSchema).default([])
  }).optional(),
  networkBodies: linkedinSurfaceRawBodiesSchema.optional()
});

const REGISTERED_METHOD_IDS = new Set();

/**
 * @typedef {{
 *   runtime?: string,
 *   connector?: string,
 *   mode?: "production" | "development"
 * }} LinkedinToolSession
 */

export function ensureLinkedinToolMethodsRegistered() {
  if (REGISTERED_METHOD_IDS.size) {
    return;
  }

  REGISTERED_METHOD_IDS.add(registerToolMethod({
    toolMethodId: LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
    provider: "linkedin",
    publicMethodName: "syncReceivedInvitations",
    mode: "sync",
    capability: "linkedin",
    inputSchemaRef: "src/schema/surfaces/invitations.js#canonicalInvitationSurfaceInputSchema",
    outputSchemaRef: "src/schema/surfaces/invitations.js#canonicalReceivedInvitationSurfaceResultSchema",
    runtimeRequirements: {
      connector: "unipile",
      browser: null,
      signedInIdentityRequired: true
    },
    lifecycleHooksRequired: true,
    implementationRef: "src/lib/linkedin-tool-methods.js#runSyncReceivedInvitations",
    development: {
      artifactPostmortem: true,
      liveContinuation: true,
      repairNotes: true
    },
    batching: null,
    inputSchema: linkedinReceivedInvitationToolInputSchema,
    outputSchema: canonicalReceivedInvitationSurfaceResultSchema,
    execute: runSyncReceivedInvitations
  }).toolMethodId);

  REGISTERED_METHOD_IDS.add(registerToolMethod({
    toolMethodId: LINKEDIN_SYNC_SENT_INVITATIONS_METHOD,
    provider: "linkedin",
    publicMethodName: "syncSentInvitations",
    mode: "sync",
    capability: "linkedin",
    inputSchemaRef: "src/schema/surfaces/invitations.js#canonicalInvitationSurfaceInputSchema",
    outputSchemaRef: "src/schema/surfaces/invitations.js#canonicalSentInvitationSurfaceResultSchema",
    runtimeRequirements: {
      connector: "unipile",
      browser: null,
      signedInIdentityRequired: true
    },
    lifecycleHooksRequired: true,
    implementationRef: "src/lib/linkedin-tool-methods.js#runSyncSentInvitations",
    development: {
      artifactPostmortem: true,
      liveContinuation: true,
      repairNotes: true
    },
    batching: null,
    inputSchema: linkedinSentInvitationToolInputSchema,
    outputSchema: canonicalSentInvitationSurfaceResultSchema,
    execute: runSyncSentInvitations
  }).toolMethodId);
}

/**
 * @param {unknown} session
 * @param {import("zod").infer<typeof linkedinReceivedInvitationToolInputSchema>} input
 */
function runSyncReceivedInvitations(session, input) {
  const normalizedSession = normalizeSession(session);
  if (input.legacyCapture) {
    return buildCanonicalReceivedSurfaceFromLegacyCapture(input.legacyCapture, input.mode, normalizedSession);
  }

  if (input.networkBodies?.length) {
    return buildCanonicalReceivedSurfaceFromNetworkBodies(input.networkBodies, input.mode, normalizedSession, input.diagnostics.includeEvidenceRefs);
  }

  return buildToolContractViolationSurface({
    mode: input.mode,
    toolMethodId: LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
    currentUrl: null,
    message: "Received invitations require legacyCapture, networkBodies, or a future browser-control implementation."
  });
}

/**
 * @param {unknown} session
 * @param {import("zod").infer<typeof linkedinSentInvitationToolInputSchema>} input
 */
function runSyncSentInvitations(session, input) {
  const normalizedSession = normalizeSession(session);
  if (input.legacyCapture) {
    return buildCanonicalSentSurfaceFromLegacyCapture(input.legacyCapture, input.mode, normalizedSession);
  }

  if (input.networkBodies?.length) {
    return buildCanonicalSentSurfaceFromNetworkBodies(input.networkBodies, input.mode, normalizedSession, input.diagnostics.includeEvidenceRefs);
  }

  return buildToolContractViolationSurface({
    mode: input.mode,
    toolMethodId: LINKEDIN_SYNC_SENT_INVITATIONS_METHOD,
    currentUrl: null,
    message: "Sent invitations require legacyCapture, networkBodies, or a future browser-control implementation."
  });
}

/**
 * @param {import("../schema/linkedin-capture.js").linkedinSurfaceCaptureSchema._type & { items: import("../schema/linkedin-capture.js").linkedinReceivedInvitationCaptureSchema._type[] }} capture
 * @param {"full" | "quick"} mode
 * @param {Required<LinkedinToolSession>} session
 */
function buildCanonicalReceivedSurfaceFromLegacyCapture(capture, mode, session) {
  const checkedAt = capture.checkedAt ?? newestIsoDatetime(null, capture.items.map((item) => item.observedAt).sort().at(-1) ?? null);
  return {
    surface: "invitations",
    status: capture.status,
    checkedAt,
    requestedMode: normalizeMode(capture.requestedMode, mode),
    actualMode: normalizeMode(capture.actualMode, mode),
    itemCount: capture.status === "failed" ? capture.itemCount : capture.itemCount ?? capture.items.length,
    visibleTotalCount: normalizeLegacyVisibleTotalCount(capture),
    exhaustionStatus: normalizeExhaustionStatus(capture),
    exhaustionReason: capture.exhaustionReason ?? null,
    captureCompleteness: normalizeCaptureCompleteness(capture),
    backoffReason: capture.backoffReason ?? null,
    syncTrustStatus: capture.syncTrustStatus ?? null,
    reconcileRequired: capture.reconcileRequired ?? false,
    reconcileReason: capture.reconcileReason ?? null,
    paginationAttempted: capture.paginationAttempted ?? false,
    terminalSignalSeen: capture.terminalSignalSeen ?? null,
    stalledPassCount: capture.stalledPassCount ?? null,
    nextCursor: capture.nextCursor ?? null,
    nextStartOffset: capture.nextStartOffset ?? null,
    items: capture.items.map((item) => ({
      identity: {
        sourceItemId: item.invitationId,
        sourceItemIdSource: "native"
      },
      observedAt: {
        value: item.observedAt,
        source: "exact",
        evidence: "capture_time_backfill",
        rawLabel: null
      },
      eventAt: null,
      direction: "received",
      state: mapLegacyReceivedKindToState(item.kind),
      actor: {
        displayName: item.actorName,
        handle: item.actorHandle,
        profileUrl: item.actorProfileUrl,
        publicId: item.actorLinkedinPublicId ?? item.actorHandle ?? null,
        memberId: item.actorLinkedinMemberId,
        title: item.actorTitle,
        companyName: item.actorCompanyName,
        avatarUrl: item.actorAvatarSourceUrl
      },
      summary: item.summary,
      sourceUrl: item.sourceUrl,
      profileUrl: item.actorProfileUrl,
      actionsSupported: mapInvitationActionsForState("received", mapLegacyReceivedKindToState(item.kind)),
      providerDetails: buildInvitationProviderDetails(item)
    })),
    diagnostics: {
      currentUrl: capture.items[0]?.sourceUrl ?? null,
      signedInIdentityObserved: null,
      evidenceRefs: [],
      hints: capture.status === "warning" && capture.error ? [capture.error] : [],
      suggestedNextAction: capture.reconcileRequired ? "run_full_reconciliation" : null
    },
    lifecycleSummary: buildSyntheticLifecycleSummary(LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD, capture.checkedAt ?? checkedAt),
    escalation: null,
    error: capture.status === "failed" && capture.error
      ? {
        code: "unexpected_runtime_error",
        message: capture.error,
        retryable: true,
        phase: "capture"
      }
      : null
  };
}

/**
 * @param {import("../schema/linkedin-capture.js").linkedinSurfaceCaptureSchema._type & { items: import("../schema/linkedin-capture.js").linkedinSentInvitationCaptureSchema._type[] }} capture
 * @param {"full" | "quick"} mode
 * @param {Required<LinkedinToolSession>} session
 */
function buildCanonicalSentSurfaceFromLegacyCapture(capture, mode, session) {
  const checkedAt = capture.checkedAt ?? newestIsoDatetime(null, capture.items.map((item) => item.observedAt).sort().at(-1) ?? null);
  return {
    surface: "invitations",
    status: capture.status,
    checkedAt,
    requestedMode: normalizeMode(capture.requestedMode, mode),
    actualMode: normalizeMode(capture.actualMode, mode),
    itemCount: capture.status === "failed" ? capture.itemCount : capture.itemCount ?? capture.items.length,
    visibleTotalCount: normalizeLegacyVisibleTotalCount(capture),
    exhaustionStatus: normalizeExhaustionStatus(capture),
    exhaustionReason: capture.exhaustionReason ?? null,
    captureCompleteness: normalizeCaptureCompleteness(capture),
    backoffReason: capture.backoffReason ?? null,
    syncTrustStatus: capture.syncTrustStatus ?? null,
    reconcileRequired: capture.reconcileRequired ?? false,
    reconcileReason: capture.reconcileReason ?? null,
    paginationAttempted: capture.paginationAttempted ?? false,
    terminalSignalSeen: capture.terminalSignalSeen ?? null,
    stalledPassCount: capture.stalledPassCount ?? null,
    nextCursor: capture.nextCursor ?? null,
    nextStartOffset: capture.nextStartOffset ?? null,
    items: capture.items.map((item) => ({
      identity: {
        sourceItemId: item.invitationId,
        sourceItemIdSource: "native"
      },
      observedAt: {
        value: item.observedAt,
        source: "exact",
        evidence: "capture_time_backfill",
        rawLabel: null
      },
      eventAt: item.eventAt
        ? {
          value: item.eventAt,
          source: "estimated",
          evidence: "surface_label",
          rawLabel: null
        }
        : null,
      direction: "sent",
      state: mapLegacySentKindToState(item.kind),
      actor: {
        displayName: item.actorName,
        handle: item.actorHandle,
        profileUrl: item.actorProfileUrl,
        publicId: item.actorLinkedinPublicId ?? item.actorHandle ?? null,
        memberId: item.actorLinkedinMemberId,
        title: item.actorTitle,
        companyName: item.actorCompanyName,
        avatarUrl: item.actorAvatarSourceUrl
      },
      summary: item.summary,
      sourceUrl: item.sourceUrl,
      profileUrl: item.actorProfileUrl,
      actionsSupported: mapInvitationActionsForState("sent", mapLegacySentKindToState(item.kind)),
      providerDetails: buildInvitationProviderDetails(item)
    })),
    diagnostics: {
      currentUrl: capture.items[0]?.sourceUrl ?? null,
      signedInIdentityObserved: null,
      evidenceRefs: [],
      hints: capture.status === "warning" && capture.error ? [capture.error] : [],
      suggestedNextAction: capture.reconcileRequired ? "run_full_reconciliation" : null
    },
    lifecycleSummary: buildSyntheticLifecycleSummary(LINKEDIN_SYNC_SENT_INVITATIONS_METHOD, capture.checkedAt ?? checkedAt),
    escalation: null,
    error: capture.status === "failed" && capture.error
      ? {
        code: "unexpected_runtime_error",
        message: capture.error,
        retryable: true,
        phase: "capture"
      }
      : null
  };
}

/**
 * @param {unknown[]} networkBodies
 * @param {"full" | "quick"} mode
 * @param {Required<LinkedinToolSession>} session
 * @param {boolean} includeEvidenceRefs
 */
function buildCanonicalReceivedSurfaceFromNetworkBodies(networkBodies, mode, session, includeEvidenceRefs) {
  const checkedAt = new Date().toISOString();
  const items = extractReceivedInvitationsFromNetworkBodies(networkBodies).map((item) => ({
    identity: {
      sourceItemId: item.invitationId,
      sourceItemIdSource: "native"
    },
    observedAt: {
      value: checkedAt,
      source: "exact",
      evidence: "capture_time_backfill",
      rawLabel: null
    },
    eventAt: null,
    direction: "received",
    state: "pending",
    actor: {
      displayName: item.displayName ?? ([item.firstName, item.lastName].filter(Boolean).join(" ") || null),
      handle: item.username ?? null,
      profileUrl: item.profileUrl ?? null,
      publicId: item.username ?? null,
      memberId: item.profilePlatformId ?? null,
      title: null,
      companyName: null,
      avatarUrl: null
    },
    summary: `${item.displayName ?? item.firstName ?? "A LinkedIn user"} sent an inbound connection request.`,
    sourceUrl: null,
    profileUrl: item.profileUrl ?? null,
    actionsSupported: normalizeReceivedActions(item.actionsSupported),
    providerDetails: {
      validationToken: item.validationToken ?? null
    }
  }));

  return {
    surface: "invitations",
    status: "success",
    checkedAt,
    requestedMode: mode,
    actualMode: mode,
    itemCount: items.length,
    visibleTotalCount: items.length,
    exhaustionStatus: "complete",
    captureCompleteness: "complete",
    reconcileRequired: false,
    reconcileReason: null,
    paginationAttempted: false,
    terminalSignalSeen: true,
    stalledPassCount: 0,
    items,
    diagnostics: {
      currentUrl: null,
      signedInIdentityObserved: null,
      evidenceRefs: includeEvidenceRefs
        ? networkBodies.map((_body, index) => ({
          kind: "network_body",
          ref: `network_body_${index + 1}`,
          surface: "invitations",
          capturedAt: checkedAt
        }))
        : [],
      hints: [],
      suggestedNextAction: null
    },
    lifecycleSummary: buildSyntheticLifecycleSummary(LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD, checkedAt),
    escalation: null,
    error: null
  };
}

/**
 * @param {unknown[]} networkBodies
 * @param {"full" | "quick"} mode
 * @param {Required<LinkedinToolSession>} session
 * @param {boolean} includeEvidenceRefs
 */
function buildCanonicalSentSurfaceFromNetworkBodies(networkBodies, mode, session, includeEvidenceRefs) {
  const checkedAt = new Date().toISOString();
  const items = extractSentInvitationsFromNetworkBodies(networkBodies).map((item) => ({
    identity: {
      sourceItemId: item.invitationId ?? [item.username, item.profilePlatformId, item.profileUrl].filter(Boolean).join("|"),
      sourceItemIdSource: item.invitationId ? "native" : "derived_composite"
    },
    observedAt: {
      value: checkedAt,
      source: "exact",
      evidence: "capture_time_backfill",
      rawLabel: null
    },
    eventAt: null,
    direction: "sent",
    state: "pending",
    actor: {
      displayName: [item.firstName, item.lastName].filter(Boolean).join(" ") || null,
      handle: item.username ?? null,
      profileUrl: item.profileUrl ?? null,
      publicId: item.username ?? null,
      memberId: item.profilePlatformId ?? null,
      title: null,
      companyName: null,
      avatarUrl: null
    },
    summary: `${[item.firstName, item.lastName].filter(Boolean).join(" ") || item.username || "A LinkedIn user"} is still in the sent invitations queue.`,
    sourceUrl: null,
    profileUrl: item.profileUrl ?? null,
    actionsSupported: item.inviterActionType ? ["withdrawConnectionRequest"] : [],
    providerDetails: {
      invitationId: item.invitationId ?? null,
      inviterActionType: item.inviterActionType ?? null,
      inviteeMemberId: item.inviteeMemberId ?? null
    }
  }));

  return {
    surface: "invitations",
    status: "success",
    checkedAt,
    requestedMode: mode,
    actualMode: mode,
    itemCount: items.length,
    visibleTotalCount: items.length,
    exhaustionStatus: "complete",
    captureCompleteness: "complete",
    reconcileRequired: false,
    reconcileReason: null,
    paginationAttempted: false,
    terminalSignalSeen: true,
    stalledPassCount: 0,
    items,
    diagnostics: {
      currentUrl: null,
      signedInIdentityObserved: null,
      evidenceRefs: includeEvidenceRefs
        ? networkBodies.map((_body, index) => ({
          kind: "network_body",
          ref: `network_body_${index + 1}`,
          surface: "invitations",
          capturedAt: checkedAt
        }))
        : [],
      hints: [],
      suggestedNextAction: null
    },
    lifecycleSummary: buildSyntheticLifecycleSummary(LINKEDIN_SYNC_SENT_INVITATIONS_METHOD, checkedAt),
    escalation: null,
    error: null
  };
}

/**
 * @param {{
 *   mode: "full" | "quick",
 *   toolMethodId: string,
 *   currentUrl: string | null,
 *   message: string
 * }} input
 */
function buildToolContractViolationSurface(input) {
  const checkedAt = new Date().toISOString();
  return {
    surface: "invitations",
    status: "failed",
    checkedAt,
    requestedMode: input.mode,
    actualMode: input.mode,
    itemCount: 0,
    visibleTotalCount: 0,
    exhaustionStatus: "blocked",
    exhaustionReason: "tool_contract_violation",
    captureCompleteness: "failed",
    backoffReason: "tool_contract_violation",
    syncTrustStatus: "untrusted",
    reconcileRequired: false,
    reconcileReason: null,
    paginationAttempted: null,
    terminalSignalSeen: null,
    stalledPassCount: null,
    items: [],
    diagnostics: {
      currentUrl: input.currentUrl,
      signedInIdentityObserved: null,
      evidenceRefs: [],
      hints: [],
      suggestedNextAction: null
    },
    lifecycleSummary: buildSyntheticLifecycleSummary(input.toolMethodId, checkedAt),
    escalation: {
      mode: null,
      status: "not_requested",
      reason: null,
      repairNotes: []
    },
    error: {
      code: "tool_contract_violation",
      message: input.message,
      retryable: false,
      phase: "binding"
    }
  };
}

/**
 * @param {{ notes?: string | null, actorCompanyProfile?: unknown, providerSharedSecret?: string | null }} item
 */
function buildInvitationProviderDetails(item) {
  const providerDetails = {};
  if (typeof item.notes === "string" && item.notes.trim()) {
    providerDetails.invitationNote = item.notes.trim();
  }
  if (typeof item.providerSharedSecret === "string" && item.providerSharedSecret.trim()) {
    providerDetails.sharedSecret = item.providerSharedSecret.trim();
  }
  if (item.actorCompanyProfile && typeof item.actorCompanyProfile === "object") {
    providerDetails.companyProfile = item.actorCompanyProfile;
  }
  return Object.keys(providerDetails).length ? providerDetails : null;
}

/**
 * @param {LinkedinToolSession | unknown} session
 * @returns {Required<LinkedinToolSession>}
 */
function normalizeSession(session) {
  const raw = session && typeof session === "object" ? /** @type {LinkedinToolSession} */ (session) : {};
  return {
    runtime: typeof raw.runtime === "string" && raw.runtime.trim().length ? raw.runtime.trim() : "unknown",
    connector: typeof raw.connector === "string" && raw.connector.trim().length ? raw.connector.trim() : "unknown",
    mode: raw.mode === "production" ? "production" : "development"
  };
}

/**
 * @param {string | null | undefined} value
 * @param {"full" | "quick"} fallback
 */
function normalizeMode(value, fallback) {
  return value === "full" ? "full" : value === "quick" ? "quick" : fallback;
}

/**
 * @param {{ status: string, captureCompleteness?: string | null, exhaustionStatus?: string | null }} capture
 */
function normalizeExhaustionStatus(capture) {
  if (capture.exhaustionStatus) {
    return capture.exhaustionStatus;
  }
  if (capture.status === "failed" || capture.captureCompleteness === "failed") {
    return "blocked";
  }
  if (capture.captureCompleteness === "complete") {
    return "complete";
  }
  if (capture.captureCompleteness === "partial_visible_slice") {
    return "incomplete";
  }
  return null;
}

/**
 * @param {{ status: string, captureCompleteness?: string | null }} capture
 */
function normalizeCaptureCompleteness(capture) {
  if (capture.captureCompleteness) {
    return capture.captureCompleteness;
  }
  return capture.status === "failed" ? "failed" : null;
}

/**
 * @param {{ status: string, itemCount?: number | null, visibleTotalCount?: number | null, captureCompleteness?: string | null, exhaustionStatus?: string | null, items: unknown[] }} capture
 */
function normalizeLegacyVisibleTotalCount(capture) {
  if (capture.visibleTotalCount !== null && capture.visibleTotalCount !== undefined) {
    return capture.visibleTotalCount;
  }
  const exhaustionStatus = normalizeExhaustionStatus(capture);
  const captureCompleteness = normalizeCaptureCompleteness(capture);
  if (exhaustionStatus === "complete" || captureCompleteness === "complete") {
    return capture.itemCount ?? capture.items.length;
  }
  if (capture.status === "failed") {
    return capture.itemCount ?? 0;
  }
  return null;
}

/**
 * @param {"connection_request_received" | "connection_request_accepted" | "connection_request_declined"} kind
 */
function mapLegacyReceivedKindToState(kind) {
  switch (kind) {
    case "connection_request_accepted":
      return "accepted_visible";
    case "connection_request_declined":
      return "declined_visible";
    default:
      return "pending";
  }
}

/**
 * @param {"connection_request_pending" | "connection_request_accepted" | "connection_request_withdrawn"} kind
 */
function mapLegacySentKindToState(kind) {
  switch (kind) {
    case "connection_request_accepted":
      return "accepted_visible";
    case "connection_request_withdrawn":
      return "withdrawn_visible";
    default:
      return "pending";
  }
}

/**
 * @param {"received" | "sent"} direction
 * @param {"pending" | "accepted_visible" | "declined_visible" | "withdrawn_visible"} state
 */
function mapInvitationActionsForState(direction, state) {
  if (direction === "sent") {
    return state === "pending" ? ["withdrawConnectionRequest"] : [];
  }
  return state === "pending"
    ? ["acceptConnectionRequest", "rejectConnectionRequest"]
    : [];
}

/**
 * @param {string[] | null | undefined} actions
 */
function normalizeReceivedActions(actions) {
  const supported = new Set();
  for (const action of actions ?? []) {
    if (/accept/i.test(action)) {
      supported.add("acceptConnectionRequest");
    }
    if (/ignore|reject/i.test(action)) {
      supported.add("rejectConnectionRequest");
    }
  }
  return Array.from(supported);
}

/**
 * @param {string} toolMethodId
 * @param {string | null | undefined} emittedAt
 */
function buildSyntheticLifecycleSummary(toolMethodId, emittedAt) {
  return {
    runId: `${toolMethodId}:${emittedAt ?? "unknown"}`,
    lastPhase: "finalization",
    lastStatus: "completed",
    lastEmittedAt: emittedAt ?? null,
    eventCount: 1
  };
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 */
function newestIsoDatetime(left, right) {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return left >= right ? left : right;
}
