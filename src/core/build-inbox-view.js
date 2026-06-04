// @ts-check

import { inboundObservationSchema } from "../schema/inbound.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";
import { buildUserInboundSyncView } from "./user-inbound-sync.js";
import {
  classifyPrivateInboundMessage,
  describePrivateInboundResponse,
} from "./private-inbound-message-classification.js";

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
          lastVisibleTotalCount: surface.lastVisibleTotalCount,
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
  const messageContext = classifyPrivateInboundMessage(observation);
  const triage = classifyObservation(observation, messageContext);
  const acceptedStage = observation.kind === "connection_request_accepted"
    ? classifyAcceptedConnectionStage(prospect, observation.actorName ?? null)
    : null;
  const handledPrivateInboundStage = classifyHandledPrivateInboundStage(
    observation,
    prospect,
    observation.actorName ?? null,
  );

  return {
    id: observation.id,
    observedAt: observation.observedAt,
    recordedAt: observation.recordedAt,
    kind: observation.kind,
    surfaceKey: observation.surfaceKey,
    summary: observation.summary,
    actorName: observation.actorName,
    actorTitle: observation.actorTitle,
    actorCompanyName: observation.actorCompanyName,
    actorProfileUrl: observation.actorProfileUrl,
    actorLinkedinPublicId: observation.actorLinkedinPublicId,
    actorLinkedinMemberId: observation.actorLinkedinMemberId,
    actorAvatarUrl: observation.actorAvatarUrl,
    priority: acceptedStage?.priority ?? handledPrivateInboundStage?.priority ?? triage.priority,
    status: acceptedStage?.status ?? handledPrivateInboundStage?.status ?? triage.status,
    whyItMatters: acceptedStage?.whyItMatters ?? handledPrivateInboundStage?.whyItMatters ?? triage.whyItMatters,
    recommendedAction: acceptedStage?.recommendedAction ?? handledPrivateInboundStage?.recommendedAction ?? recommendAction(observation, prospect, messageContext),
    reviewState: acceptedStage?.state ?? handledPrivateInboundStage?.state ?? null,
    messageContext,
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
 * @param {any} observation
 * @param {"reply" | "first_inbound" | "not_private_inbound"} messageContext
 */
function classifyObservation(observation, messageContext) {
  const kind = observation.kind;
  switch (kind) {
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
      if (messageContext === "first_inbound") {
        return {
          priority: "high",
          status: "needs-triage",
          whyItMatters: "A private inbound message arrived, but Exo does not have evidence that it is a reply to your prior message."
        };
      }
      return {
        priority: "high",
        status: "needs-reply",
        whyItMatters: "A prospect replied on a direct channel. This is no longer speculative outreach; it needs a live response."
      };
    case "connection_request_received":
    case "connection_request_received_no_longer_pending":
    case "connection_request_accepted":
    case "connection_request_no_longer_pending":
      return {
        priority: "high",
        status: "needs-triage",
        whyItMatters: "The connection state changed, which can unlock or require the next private move."
      };
    case "connection_request_declined":
      return {
        priority: "low",
        status: "resolved",
        whyItMatters: "The inbound connection request was explicitly declined, so the branch no longer needs a yes-or-no decision."
      };
    case "thread_updated":
    case "email_thread_updated":
      return {
        priority: "medium",
        status: "needs-triage",
        whyItMatters: "A private thread moved, but the newest visible state is not yet strong enough to classify as a direct reply. It still needs review."
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
    case "follower_removed":
    case "follower_confirmed":
    case "follow_state_changed":
    case "follow_state_removed":
    case "follow_state_confirmed":
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
 * @param {any} observation
 * @param {any | null} prospect
 * @param {"reply" | "first_inbound" | "not_private_inbound"} messageContext
 */
function recommendAction(observation, prospect, messageContext) {
  const kind = observation.kind;
  switch (kind) {
    case "connection_request_pending":
      return `Keep the branch patient for now. If the pending invite crosses policy age, the agent should withdraw it automatically.`;
    case "connection_request_no_longer_pending":
      return `Review whether the invite was accepted, rejected, or otherwise left the pending list before continuing the old waiting branch.`;
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
      if (messageContext === "first_inbound") {
        return `Review ${prospect?.name ?? "this person"}'s inbound message and decide whether to reply or ignore it.`;
      }
      return `Reply to ${prospect?.name ?? "the prospect"} and move the cadence branch into a live conversation.`;
    case "connection_request_received":
      return `Decide whether to accept or decline the inbound connection request.`;
    case "connection_request_received_no_longer_pending":
      return `Review whether the inbound connection request was accepted, declined, withdrawn, or otherwise resolved before continuing from stale assumptions.`;
    case "thread_updated":
    case "email_thread_updated":
      return `Review the updated thread and decide whether it now needs a reply, a state change, or no action.`;
    case "connection_request_accepted":
      return `Send the first post-accept direct message for ${prospect?.name ?? "this prospect"}.`;
    case "connection_request_declined":
      return `No next move is required unless this declined invite should be linked to a governed branch or audited.`;
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
    case "follower_removed":
    case "follower_confirmed":
    case "follow_state_changed":
    case "follow_state_removed":
    case "follow_state_confirmed":
      return `Record the visibility signal and consider whether a public follow-up move is now more legitimate.`;
    default:
      return `Review this observation and decide whether it changes the motion state.`;
  }
}

/**
 * @param {any} observation
 * @param {any | null} prospect
 * @param {string | null} actorName
 * @returns {{ priority: string, status: string, state: string, whyItMatters: string, recommendedAction: string } | null}
 */
function classifyHandledPrivateInboundStage(observation, prospect, actorName) {
  const response = describePrivateInboundResponse(observation, prospect);
  const responseState = response.state;
  const name = prospect?.name ?? actorName ?? "this person";
  if (responseState === "queued") {
    return {
      priority: "low",
      status: "queued",
      state: "queued_for_send",
      whyItMatters: "The reply is already send-ready in the agent queue.",
      recommendedAction: `Reply queued for ${name} — the agent will send it.`,
    };
  }
  if (responseState === "sent") {
    return {
      priority: "low",
      status: "resolved",
      state: "reply_sent",
      whyItMatters: "A reply was already sent after this inbound message. The branch is now waiting on them.",
      recommendedAction: `Reply already sent to ${name} — waiting for their next message.`,
    };
  }
  if (responseState === "blocked") {
    const detail = summarizeUnavailableReplyReason(response.touch?.notes);
    return {
      priority: "low",
      status: "resolved",
      state: "reply_unavailable",
      whyItMatters: detail,
      recommendedAction: `Reply unavailable for ${name} — ${detail}`,
    };
  }
  return null;
}

/**
 * @param {any | null} prospect
 * @param {string | null} actorName
 */
function classifyAcceptedConnectionStage(prospect, actorName) {
  const name = prospect?.name ?? actorName ?? "this prospect";
  if (hasSentPostAcceptMessage(prospect)) {
    return {
      priority: "low",
      status: "resolved",
      state: "post_accept_sent",
      whyItMatters: "The first post-accept message was already sent. The branch is now waiting on their reply.",
      recommendedAction: `First message already sent to ${name} — waiting for a reply.`,
    };
  }
  if (hasQueuedPostAcceptMessage(prospect)) {
    return {
      priority: "low",
      status: "queued",
      state: "queued_for_send",
      whyItMatters: "The first message is already send-ready in the agent queue.",
      recommendedAction: `First message queued for ${name} — the agent will send it.`,
    };
  }
  if (hasReviewablePostAcceptDraft(prospect)) {
    return {
      priority: "high",
      status: "needs-triage",
      state: "ready_for_post_accept",
      whyItMatters: "The agent already drafted the first post-accept message. The operator can review the actual copy now.",
      recommendedAction: `Review the drafted first post-accept direct message for ${name} and decide whether to queue it for send.`,
    };
  }
  return {
    priority: "low",
    status: "agent-draft",
    state: "agent_draft_due",
    whyItMatters: "The connection is accepted, but the operator should not get a send decision until the agent has drafted the first message.",
    recommendedAction: `Agent should draft the first post-accept direct message for ${name} before this returns to the operator lane.`,
  };
}

/** @param {any | null} prospect */
function hasSentPostAcceptMessage(prospect) {
  if (!prospect) return false;
  const surfaces = new Set(["post_accept_message", "follow_up_direct_message"]);
  const touchSent = (prospect.touches ?? []).some(
    (t) => surfaces.has(t.surface) && t.direction !== "inbound" && ["sent", "accepted", "replied"].includes(t.outcome),
  );
  const draftSent = (prospect.drafts ?? []).some((d) => surfaces.has(d.surface) && d.status === "sent");
  return touchSent || draftSent;
}

/** @param {string | null | undefined} notes */
function summarizeUnavailableReplyReason(notes) {
  const normalized = String(notes ?? "").trim();
  if (/disabledfeatures/i.test(normalized) && /reply/i.test(normalized)) {
    return "the governed LinkedIn thread is read-only and reply is disabled.";
  }
  if (/read[ -]?only/i.test(normalized)) {
    return "the governed LinkedIn thread is read-only.";
  }
  return "the governed reply path is not writable on this thread.";
}

/** @param {any | null} prospect */
function hasQueuedPostAcceptMessage(prospect) {
  if (!prospect) return false;
  const surfaces = new Set(["post_accept_message", "follow_up_direct_message"]);
  return (prospect.drafts ?? []).some(
    (d) => surfaces.has(d.surface) && (d.status === "approved" || d.status === "queued"),
  );
}

/** @param {any | null} prospect */
function hasReviewablePostAcceptDraft(prospect) {
  if (!prospect) return false;
  const surfaces = new Set(["post_accept_message", "follow_up_direct_message"]);
  return (prospect.drafts ?? []).some(
    (d) => surfaces.has(d.surface) && d.status === "ready",
  );
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
 *   lastItemCount: number | null,
 *   lastVisibleTotalCount?: number | null
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

  const count = surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0;
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
 *   lastItemCount: number | null,
 *   lastVisibleTotalCount?: number | null
 * }} surface
 */
export function recommendSurfaceAction(surface) {
  if (surface.lastRunStatus === "never") {
    return "Run this surface check before trusting silence.";
  }

  if (surface.lastRunStatus === "failed" || surface.lastRunStatus === "warning") {
    return "Rerun this surface check and fix the capture path before trusting silence.";
  }

  const count = surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0;
  if (count === 0) {
    return "No action from this surface right now.";
  }

  switch (surface.key) {
    case "linkedin-sent-invitations":
      return "Review changed invite outcomes and reconciliation gaps. Stale pending invites should be withdrawn automatically.";
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
 * @param {{ enabled?: boolean, lastRunStatus: string, lastItemCount: number | null, lastVisibleTotalCount?: number | null }} surface
 */
export function isActionableSurface(surface) {
  return surface.enabled !== false && surface.lastRunStatus === "success" && ((surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0) > 0);
}

/**
 * @param {{ enabled?: boolean, lastRunStatus: string, lastItemCount: number | null, lastVisibleTotalCount?: number | null }} surface
 */
export function isQuietSurface(surface) {
  return surface.enabled !== false && surface.lastRunStatus === "success" && ((surface.lastVisibleTotalCount ?? surface.lastItemCount ?? 0) === 0);
}
