// @ts-check

import { inboundObservationSchema } from "../schema/inbound.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { buildUserInboundSyncView } from "./user-inbound-sync.js";

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawObservations
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 * @param {{ accountId?: string | null }} [options]
 */
export function buildInboxView(rawUser, rawObservations, rawMotions, rawCompanies, options = {}) {
  const user = userSchema.parse(rawUser);
  const observations = rawObservations.map((item) => inboundObservationSchema.parse(item));
  const motions = rawMotions.map((item) => motionSchema.parse(item));
  const companiesById = new Map(
    rawCompanies
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => [item.id, item])
  );
  const prospectContextById = new Map();

  for (const motion of motions) {
    for (const account of motion.targetMap.accounts) {
      for (const prospect of account.prospects) {
        prospectContextById.set(prospect.id, {
          motion,
          account,
          prospect
        });
      }
    }
  }

  const items = observations
    .map((observation) => buildInboxItem(observation, motions, companiesById, prospectContextById))
    .sort(compareInboxItems);
  const syncView = buildUserInboundSyncView(user);
  const accounts = syncView.accounts
    .filter((account) => !options.accountId || account.accountId === options.accountId)
    .map((account) => ({
      accountId: account.accountId,
      capability: account.capability,
      handle: account.handle,
      label: account.label,
      preferred: account.preferred,
      actionableSurfaceCount: account.surfaces.filter((surface) => isActionableSurface(surface)).length,
      quietSurfaceCount: account.surfaces.filter((surface) => isQuietSurface(surface)).length,
      uncheckedSurfaceCount: account.surfaces.filter((surface) => surface.enabled && surface.lastRunStatus === "never").length,
      surfaces: account.surfaces
        .filter((surface) => surface.enabled)
        .map((surface) => ({
          key: surface.key,
          label: surface.label,
          truthLevel: surface.truthLevel,
          lastRunStatus: surface.lastRunStatus,
          lastSyncedAt: surface.lastSyncedAt,
          lastObservedAt: surface.lastObservedAt,
          lastItemCount: surface.lastItemCount,
          summary: summarizeSurfaceState(surface),
          recommendedAction: recommendSurfaceAction(surface)
        }))
    }));

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    counts: {
      itemCount: items.length,
      highPriorityCount: items.filter((item) => item.priority === "high").length,
      mediumPriorityCount: items.filter((item) => item.priority === "medium").length,
      lowPriorityCount: items.filter((item) => item.priority === "low").length
    },
    surfaces: {
      accountCount: accounts.length,
      enabledSurfaceCount: accounts.reduce((sum, account) => sum + account.surfaces.length, 0),
      actionableSurfaceCount: accounts.reduce((sum, account) => sum + account.actionableSurfaceCount, 0),
      quietSurfaceCount: accounts.reduce((sum, account) => sum + account.quietSurfaceCount, 0),
      uncheckedSurfaceCount: accounts.reduce((sum, account) => sum + account.uncheckedSurfaceCount, 0),
      accounts
    },
    items
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {import("../schema/motion.js").motionSchema._type[]} motions
 * @param {Map<string, any>} companiesById
 * @param {Map<string, { motion: import("../schema/motion.js").motionSchema._type, account: any, prospect: any }>} prospectContextById
 */
function buildInboxItem(observation, motions, companiesById, prospectContextById) {
  const prospectContext = observation.prospectId ? prospectContextById.get(observation.prospectId) ?? null : null;
  const motion = observation.motionId
    ? motions.find((candidate) => candidate.id === observation.motionId) ?? prospectContext?.motion ?? null
    : prospectContext?.motion ?? null;
  const account = prospectContext?.account ?? (motion && observation.companyId
    ? motion.targetMap.accounts.find((candidate) => candidate.companyId === observation.companyId) ?? null
    : null);
  const company = observation.companyId
    ? companiesById.get(observation.companyId) ?? account ?? null
    : account ?? null;
  const prospect = prospectContext?.prospect ?? (account && observation.prospectId
    ? account.prospects.find((candidate) => candidate.id === observation.prospectId) ?? null
    : null);
  const triage = classifyObservation(observation.kind);

  return {
    id: observation.id,
    observedAt: observation.observedAt,
    recordedAt: observation.recordedAt,
    kind: observation.kind,
    surfaceKey: observation.surfaceKey,
    summary: observation.summary,
    actorName: observation.actorName,
    priority: triage.priority,
    status: triage.status,
    whyItMatters: triage.whyItMatters,
    recommendedAction: recommendAction(observation.kind, prospect),
    account: {
      id: observation.accountId,
      capability: observation.capability
    },
    motion: motion ? { id: motion.id, name: motion.name } : null,
    company: company ? { id: company.id, name: company.name ?? company.companyName ?? null } : null,
    prospect: prospect ? { id: prospect.id, name: prospect.name, title: prospect.title } : null
  };
}

/**
 * @param {string} kind
 */
function classifyObservation(kind) {
  switch (kind) {
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
      return {
        priority: "high",
        status: "needs-reply",
        whyItMatters: "A prospect replied on a direct channel. This is no longer speculative outreach; it needs a live response."
      };
    case "connection_request_received":
    case "connection_request_accepted":
      return {
        priority: "high",
        status: "needs-triage",
        whyItMatters: "The connection state changed, which can unlock or require the next private move."
      };
    case "public_reply_received":
    case "comment_thread_updated":
    case "public_engagement_opportunity":
    case "catch_up_update_detected":
      return {
        priority: "medium",
        status: "visibility-opportunity",
        whyItMatters: "A public conversation moved. This may create a legitimate visibility or engagement opening."
      };
    case "profile_view_after_touch":
    case "profile_view_received":
    case "follower_added":
    case "follower_confirmed":
      return {
        priority: "medium",
        status: "attention-signal",
        whyItMatters: "Attention happened, even if the person has not accepted or replied yet."
      };
    default:
      return {
        priority: "low",
        status: "informational",
        whyItMatters: "This is useful state, but it does not obviously demand an immediate move by itself."
      };
  }
}

/**
 * @param {string} kind
 * @param {any | null} prospect
 */
function recommendAction(kind, prospect) {
  switch (kind) {
    case "connection_request_pending":
      return `Keep the branch patient for now, but review whether the pending invite has become stale enough to withdraw under current policy.`;
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
      return `Reply to ${prospect?.name ?? "the prospect"} and move the cadence branch into a live conversation.`;
    case "connection_request_received":
      return `Decide whether to accept or decline the inbound connection request.`;
    case "connection_request_accepted":
      return `Send the first post-accept direct message for ${prospect?.name ?? "this prospect"}.`;
    case "public_reply_received":
    case "comment_thread_updated":
      return `Review the public thread and reply only if there is a legitimate contribution to make.`;
    case "public_engagement_opportunity":
    case "catch_up_update_detected":
      return `Review the public update and decide whether it is worth an inbound-motion engagement move.`;
    case "profile_view_after_touch":
    case "profile_view_received":
      return `Treat this as attention evidence and decide whether cadence should stay patient or advance.`;
    case "follower_added":
    case "follower_confirmed":
      return `Record the visibility signal and consider whether a public follow-up move is now more legitimate.`;
    default:
      return `Review this observation and decide whether it changes the motion state.`;
  }
}

/**
 * @param {ReturnType<typeof buildInboxItem>} left
 * @param {ReturnType<typeof buildInboxItem>} right
 */
function compareInboxItems(left, right) {
  const priorityRank = {
    high: 0,
    medium: 1,
    low: 2
  };

  return (
    priorityRank[left.priority] - priorityRank[right.priority]
    || right.observedAt.localeCompare(left.observedAt)
    || right.recordedAt.localeCompare(left.recordedAt)
  );
}

/**
 * @param {{
 *   key: string,
 *   label: string,
 *   truthLevel: string,
 *   lastRunStatus: string,
 *   lastSyncedAt: string | null,
 *   lastObservedAt: string | null,
 *   lastItemCount: number | null
 * }} surface
 */
export function summarizeSurfaceState(surface) {
  if (surface.lastRunStatus === "never") {
    return `${surface.label} has not been checked yet.`;
  }

  if (surface.lastRunStatus === "failed") {
    return `${surface.label} failed on the last sync.`;
  }

  if (surface.lastRunStatus === "warning") {
    return `${surface.label} completed with warnings on the last sync.`;
  }

  const count = surface.lastItemCount ?? 0;
  if (count === 0) {
    return `${surface.label} was checked and is currently quiet.`;
  }

  switch (surface.key) {
    case "linkedin-sent-invitations":
      return `${surface.label} was checked and currently has ${count} pending or changed outbound invitation ${count === 1 ? "record" : "records"}.`;
    case "linkedin-received-invitations":
      return `${surface.label} was checked and currently has ${count} inbound invitation ${count === 1 ? "request" : "requests"} to review.`;
    case "linkedin-messaging-inbox":
    case "gmail-inbox-threads":
      return `${surface.label} was checked and currently has ${count} thread ${count === 1 ? "change" : "changes"} worth review.`;
    case "linkedin-profile-views":
      return `${surface.label} was checked and currently has ${count} profile-view ${count === 1 ? "signal" : "signals"}.`;
    case "linkedin-followers-list":
      return `${surface.label} was checked and currently has ${count} follower ${count === 1 ? "change" : "changes"}.`;
    case "linkedin-following-list":
      return `${surface.label} was checked and currently has ${count} follow-state ${count === 1 ? "change" : "changes"}.`;
    case "linkedin-comment-replies":
      return `${surface.label} was checked and currently has ${count} public reply ${count === 1 ? "change" : "changes"}.`;
    case "linkedin-catch-up-updates":
      return `${surface.label} was checked and currently has ${count} public update ${count === 1 ? "opportunity" : "opportunities"}.`;
    default:
      return `${surface.label} was checked and currently has ${count} relevant ${count === 1 ? "item" : "items"}.`;
  }
}

/**
 * @param {{
 *   key: string,
 *   lastRunStatus: string,
 *   lastItemCount: number | null
 * }} surface
 */
export function recommendSurfaceAction(surface) {
  if (surface.lastRunStatus === "never") {
    return "Run this surface check before trusting silence.";
  }

  if (surface.lastRunStatus === "failed" || surface.lastRunStatus === "warning") {
    return "Rerun this surface check and fix the capture path before trusting silence.";
  }

  const count = surface.lastItemCount ?? 0;
  if (count === 0) {
    return "No action from this surface right now.";
  }

  switch (surface.key) {
    case "linkedin-sent-invitations":
      return "Review pending and changed invites for accepts, withdrawals, or stale requests.";
    case "linkedin-received-invitations":
      return "Review inbound invites and decide whether to accept or decline them.";
    case "linkedin-messaging-inbox":
    case "gmail-inbox-threads":
      return "Open the changed threads and respond or triage them.";
    case "linkedin-profile-views":
      return "Review whether these attention signals justify patience or a later escalation.";
    case "linkedin-followers-list":
    case "linkedin-following-list":
      return "Review whether the follow-state change matters for visibility or cleanup.";
    case "linkedin-comment-replies":
    case "linkedin-catch-up-updates":
      return "Review whether there is a legitimate public engagement move to make.";
    default:
      return "Review this surface and decide whether it changes the next move.";
  }
}

/**
 * @param {{ enabled?: boolean, lastRunStatus: string, lastItemCount: number | null }} surface
 */
export function isActionableSurface(surface) {
  return surface.enabled !== false && surface.lastRunStatus === "success" && (surface.lastItemCount ?? 0) > 0;
}

/**
 * @param {{ enabled?: boolean, lastRunStatus: string, lastItemCount: number | null }} surface
 */
export function isQuietSurface(surface) {
  return surface.enabled !== false && surface.lastRunStatus === "success" && (surface.lastItemCount ?? 0) === 0;
}
