// @ts-check

import { linkedinInboundSyncCaptureSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

const QUICK_SURFACE_BUILDERS = [
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

  if (capture.mode !== "quick") {
    throw new Error(`LinkedIn capture currently supports quick mode only. Received: ${capture.mode}`);
  }

  const builtSurfaces = QUICK_SURFACE_BUILDERS.map((definition) =>
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
  if (derivedItemCount !== null && derivedItemCount < section.items.length) {
    throw new Error(
      `LinkedIn capture reported ${derivedItemCount} items but included ${section.items.length} items for ${definition.surfaceKey}.`
    );
  }

  if (section.status === "failed" && derivedItemCount && derivedItemCount > 0) {
    throw new Error(`Failed LinkedIn captures cannot report positive item counts: ${definition.surfaceKey}`);
  }

  const newestItemAt = section.items.map((item) => item.observedAt).sort().at(-1) ?? null;
  const observedAt = newestIsoDatetime(section.checkedAt, newestItemAt);
  if (section.status !== "failed" && derivedItemCount && derivedItemCount > 0 && !observedAt) {
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
    error: section.error,
    observations
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {string | null} accountId
 */
function resolveLinkedinAccount(user, accountId) {
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
