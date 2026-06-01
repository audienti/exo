// @ts-check

import { linkedinInboundSyncCaptureSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

const LINKEDIN_SURFACE_BUILDERS = [
  {
    surfaceKey: "linkedin-sent-invitations",
    sectionKey: "sentInvitations",
    externalIdField: "invitationId"
  },
  {
    surfaceKey: "linkedin-received-invitations",
    sectionKey: "receivedInvitations",
    externalIdField: "invitationId"
  },
  {
    surfaceKey: "linkedin-messaging-inbox",
    sectionKey: "messagingInbox",
    externalIdField: "threadId",
    threadUrlField: "threadUrl"
  },
  {
    surfaceKey: "linkedin-profile-views",
    sectionKey: "profileViews",
    externalIdField: "viewId"
  },
  {
    surfaceKey: "linkedin-following-list",
    sectionKey: "followingList",
    externalIdField: "entryId"
  }
];

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId?: string | null,
 *   capture: unknown
 * }} input
 */
export function buildLinkedinInboundSyncPayload(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const capture = linkedinInboundSyncCaptureSchema.parse(input.capture);
  const account = resolveLinkedinAccount(user, input.accountId ?? null);

  if (!["quick", "full"].includes(capture.mode)) {
    throw new Error(`LinkedIn capture currently supports quick or full mode. Received: ${capture.mode}`);
  }

  const builtSurfaces = LINKEDIN_SURFACE_BUILDERS.map((definition) =>
    buildQuickSurface(definition, capture[definition.sectionKey])
  );

  return {
    capture: {
      mode: capture.mode,
      sectionCount: builtSurfaces.length,
      itemCount: builtSurfaces.reduce((sum, surface) => sum + (surface.itemCount ?? 0), 0),
      sections: builtSurfaces.map((surface) => ({
        surfaceKey: surface.surfaceKey,
        status: surface.status,
        itemCount: surface.itemCount,
        visibleTotalCount: surface.visibleTotalCount,
        captureCompleteness: surface.captureCompleteness,
        exhaustionStatus: surface.exhaustionStatus,
        observationCount: surface.observations.length,
        error: surface.error
      }))
    },
    payload: {
      mode: capture.mode,
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
 * @param {{ surfaceKey: string, sectionKey: string, externalIdField: string, threadUrlField?: string }} definition
 * @param {any} section
 */
function buildQuickSurface(definition, section) {
  const exhaustionStatus = normalizeSurfaceExhaustionStatus(section);
  const exhaustionReason = normalizeNullableString(section.exhaustionReason);
  const paginationAttempted = typeof section.paginationAttempted === "boolean" ? section.paginationAttempted : null;
  const terminalSignalSeen = typeof section.terminalSignalSeen === "boolean" ? section.terminalSignalSeen : null;
  const stalledPassCount = Number.isInteger(section.stalledPassCount) ? section.stalledPassCount : null;

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
  const visibleTotalCount = section.visibleTotalCount ?? null;
  if (derivedItemCount !== null && derivedItemCount < section.items.length) {
    throw new Error(
      `LinkedIn capture reported ${derivedItemCount} items but included ${section.items.length} items for ${definition.surfaceKey}.`
    );
  }

  if (visibleTotalCount !== null && derivedItemCount !== null && visibleTotalCount < derivedItemCount) {
    throw new Error(
      `LinkedIn capture cannot report a visible total smaller than the itemized count for ${definition.surfaceKey}.`
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
    motionId: item.motionId,
    companyId: item.companyId,
    prospectId: item.prospectId,
    notes: item.notes
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
