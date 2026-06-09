// @ts-check

import { findInboundSurfaceDefinitionByToolMethodId } from "../lib/inbound-surface-catalog.js";
import {
  ensureLinkedinToolMethodsRegistered,
  LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
  LINKEDIN_SYNC_SENT_INVITATIONS_METHOD
} from "../lib/linkedin-tool-methods.js";

ensureLinkedinToolMethodsRegistered();

/**
 * @param {{
 *   accountId: string,
 *   mode: "full" | "quick",
 *   results: Array<{ toolMethodId: string, output: any }>
 * }} input
 */
export function buildInboundSyncPayloadFromCanonicalToolResults(input) {
  const surfaces = input.results.map((result) => buildInboundSurfaceFromToolResult(result));
  return {
    capture: buildCaptureSummary(input.mode, surfaces),
    payload: {
      mode: input.mode,
      accounts: [
        {
          accountId: input.accountId,
          surfaces
        }
      ]
    }
  };
}

/**
 * @param {{ toolMethodId: string, output: any }} input
 */
function buildInboundSurfaceFromToolResult(input) {
  const surfaceDefinition = findInboundSurfaceDefinitionByToolMethodId(input.toolMethodId);
  if (!surfaceDefinition) {
    throw new Error(`No inbound surface is bound to tool method ${input.toolMethodId}.`);
  }

  if (input.toolMethodId === LINKEDIN_SYNC_SENT_INVITATIONS_METHOD || input.toolMethodId === LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD) {
    return buildInvitationInboundSurface(surfaceDefinition.key, input.output);
  }

  throw new Error(`No canonical inbound adapter is registered for ${input.toolMethodId}.`);
}

/**
 * @param {string} surfaceKey
 * @param {any} result
 */
function buildInvitationInboundSurface(surfaceKey, result) {
  const observedAt = newestIsoDatetime(
    result.checkedAt ?? null,
    result.items
      .map((item) => item?.observedAt?.value ?? null)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null
  );
  const itemCount = result.status === "failed"
    ? result.itemCount ?? 0
    : result.itemCount ?? result.items.length;
  const visibleTotalCount = result.visibleTotalCount ?? itemCount;
  const surfaceError = result.error?.message
    ?? (result.status !== "success" ? result.diagnostics?.hints?.[0] ?? null : null);

  return {
    surfaceKey,
    status: result.status,
    observedAt,
    itemCount,
    visibleTotalCount,
    captureCompleteness: result.captureCompleteness,
    requestedMode: result.requestedMode,
    actualMode: result.actualMode,
    reconcileRequired: result.reconcileRequired,
    reconcileReason: result.reconcileReason,
    exhaustionStatus: result.exhaustionStatus,
    exhaustionReason: result.error?.code ?? result.reconcileReason,
    paginationAttempted: result.paginationAttempted,
    terminalSignalSeen: result.terminalSignalSeen,
    stalledPassCount: result.stalledPassCount,
    nextCursor: result.nextCursor ?? null,
    nextStartOffset: result.nextStartOffset ?? null,
    error: surfaceError,
    observations: result.items.map((item) => ({
      kind: mapInvitationObservationKind(surfaceKey, item),
      observedAt: item.observedAt.value,
      eventAt: item.eventAt?.value ?? null,
      summary: item.summary,
      externalId: item.identity.sourceItemId,
      actorName: item.actor.displayName,
      actorTitle: item.actor.title,
      actorCompanyName: item.actor.companyName,
      actorHandle: item.actor.handle ?? item.actor.publicId ?? null,
      actorProfileUrl: item.profileUrl ?? item.actor.profileUrl,
      actorLinkedinPublicId: item.actor.publicId,
      actorLinkedinMemberId: item.actor.memberId,
      actorAvatarSourceUrl: item.actor.avatarUrl,
      threadUrl: null,
      sourceUrl: item.sourceUrl,
      motionId: null,
      companyId: null,
      prospectId: null,
      providerSharedSecret: normalizeInvitationObservationSharedSecret(item.providerDetails),
      actorCompanyProfile: normalizeInvitationObservationCompanyProfile(item.providerDetails),
      notes: normalizeInvitationObservationNotes(item.providerDetails)
    }))
  };
}

/**
 * @param {"full" | "quick"} mode
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
 * @param {string} surfaceKey
 * @param {any} item
 */
function mapInvitationObservationKind(surfaceKey, item) {
  if (surfaceKey === "linkedin-sent-invitations") {
    switch (item.state) {
      case "pending":
        return "connection_request_pending";
      case "accepted_visible":
        return "connection_request_accepted";
      case "withdrawn_visible":
        return "connection_request_withdrawn";
      default:
        throw new Error(`Unsupported sent invitation state: ${item.state}`);
    }
  }

  switch (item.state) {
    case "pending":
      return "connection_request_received";
    case "accepted_visible":
      return "connection_request_accepted";
    case "declined_visible":
      return "connection_request_declined";
    default:
      throw new Error(`Unsupported received invitation state: ${item.state}`);
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} providerDetails
 */
function normalizeInvitationObservationNotes(providerDetails) {
  if (!providerDetails || typeof providerDetails !== "object") {
    return null;
  }
  const invitationNote = providerDetails.invitationNote;
  if (typeof invitationNote !== "string") {
    return null;
  }
  const normalized = invitationNote.trim();
  return normalized ? normalized : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} providerDetails
 */
function normalizeInvitationObservationCompanyProfile(providerDetails) {
  if (!providerDetails || typeof providerDetails !== "object") {
    return null;
  }
  const companyProfile = providerDetails.companyProfile;
  if (!companyProfile || typeof companyProfile !== "object") {
    return null;
  }

  return {
    name: normalizeNullableString(companyProfile.name),
    domain: normalizeNullableString(companyProfile.domain),
    websiteUrl: normalizeNullableString(companyProfile.websiteUrl),
    linkedinCompanyUrl: normalizeNullableString(companyProfile.linkedinCompanyUrl),
    logoSourceUrl: normalizeNullableString(companyProfile.logoSourceUrl),
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} providerDetails
 */
function normalizeInvitationObservationSharedSecret(providerDetails) {
  if (!providerDetails || typeof providerDetails !== "object") {
    return null;
  }
  return normalizeNullableString(providerDetails.sharedSecret);
}

/**
 * @param {unknown} value
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
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
