// @ts-check
//
// Person view model — an internal show page for ANY person Exo has seen, not
// just tracked prospects.
//
// A person is an identity aggregated across inbound observations (received
// invites, profile views, replies, follows, …). The view merges everything we
// know — identity, LinkedIn, the surfaces they appeared on, the observation
// timeline — and detects whether they're already a tracked prospect (in which
// case the UI routes to the richer prospect show page instead).
//
// Pure data — no rendering.

import { inboundObservationsSharePersonIdentity } from "./inbound-observations.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { companySchema } from "../schema/company.js";
import { STALE_CONNECTION_REQUEST_DAYS, isStalePendingConnectionRequest } from "../lib/cadence-helpers.js";
import { deriveLinkedinRelativeEventAt } from "../lib/linkedin-relative-time.js";
import { extractLinkedinPublicId } from "../lib/prospect-contacts.js";
import { motionSchema } from "../schema/motion.js";
import { deriveLinkedinCompanyName } from "../lib/linkedin-headline.js";
import { classifyPrivateInboundMessage } from "./private-inbound-message-classification.js";
import { isTransitionMotion } from "./ensure-transition-motion.js";
import { normalizeCompanyNameKey, normalizeResolvableCompanyName } from "../lib/company-name.js";

const SURFACE_LABELS = {
  "linkedin-received-invitations": "Received invitation",
  "linkedin-sent-invitations": "Sent invitation",
  "linkedin-following-list": "Following",
  "linkedin-followers-list": "Follower",
  "linkedin-profile-views": "Profile view",
  "linkedin-messaging-inbox": "LinkedIn message",
  "linkedin-comment-replies": "Comment reply",
  "linkedin-catch-up-updates": "Catch-up update",
  "gmail-inbox-threads": "Email thread",
};

const KIND_LABELS = {
  email_reply_received: "Email reply",
  email_thread_updated: "Email thread",
  inbound_reply_received: "Reply",
  message_received: "LinkedIn message",
  thread_updated: "LinkedIn thread",
  public_reply_received: "Comment reply",
  comment_thread_updated: "Comment thread",
};

const MESSAGE_OBSERVATION_KINDS = new Set([
  "email_reply_received",
  "email_thread_updated",
  "inbound_reply_received",
  "message_received",
  "thread_updated",
  "public_reply_received",
  "comment_thread_updated",
]);

/**
 * @param {{ observationId: string, rawObservations: unknown[], rawMotions: unknown[], rawCompanies?: unknown[] | undefined }} input
 * @returns {ReturnType<typeof shapePerson> | null}
 */
export function buildPersonView(input) {
  const observations = (input.rawObservations ?? []).map((raw) => inboundObservationSchema.parse(raw));
  const seed = observations.find((observation) => observation.id === input.observationId);
  if (!seed) {
    return null;
  }

  const related = observations.filter(
    (observation) => observation.id === seed.id || inboundObservationsSharePersonIdentity(observation, seed),
  );
  const motions = (input.rawMotions ?? []).map((raw) => motionSchema.parse(raw));
  const companies = (input.rawCompanies ?? []).map((raw) => companySchema.parse(raw));
  return shapePerson(seed, related, motions, companies);
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} seed
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} related
 * @param {import("../schema/motion.js").motionSchema._type[]} motions
 * @param {import("../schema/company.js").companySchema._type[]} companies
 */
function shapePerson(seed, related, motions, companies) {
  const observedSorted = related
    .slice()
    .sort((a, b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0));
  const occurredSorted = related
    .slice()
    .sort((a, b) => compareIso(observationOccurredAt(a), observationOccurredAt(b))
      || (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0));

  const publicId = pickBestLinkedinPublicId(observedSorted);
  const linkedinUrl = pickBestLinkedinProfileUrl(observedSorted, publicId);

  // Merge identity field-by-field, preferring the most recent non-null value.
  const identity = {
    name: pick(observedSorted, "actorName") ?? "Unknown person",
    title: pick(observedSorted, "actorTitle"),
    company: pick(observedSorted, "actorCompanyName") ?? deriveLinkedinCompanyName(pick(observedSorted, "actorTitle")),
    avatarUrl: pick(observedSorted, "actorAvatarUrl") ?? pick(observedSorted, "actorAvatarSourceUrl"),
    linkedinUrl,
    publicId,
    handle: pickBestActorHandle(observedSorted, publicId),
  };
  const email = identity.handle && identity.handle.includes("@") ? identity.handle : null;
  const hasDurableIdentity =
    Boolean(email || identity.linkedinUrl || identity.publicId || !isPlaceholderIdentityName(identity.name));

  const matchedProspect = resolveMatchedProspect(related, motions);
  const matchedCompany = resolveMatchedCompany(related, companies, matchedProspect);
  const motionContext = resolveMotionContext(related, motions, matchedProspect, matchedCompany);
  const claimState = resolveClaimState(related, matchedProspect, matchedCompany, motionContext);
  const timeline = buildTimeline(occurredSorted);
  const latestMessage = timeline.find((entry) => entry.isMessage && entry.direction !== "outbound")
    ?? timeline.find((entry) => entry.isMessage)
    ?? null;

  const surfaces = [...new Set(timeline.map((entry) => entry.surfaceLabel))];
  const firstSeen = occurredSorted.length ? observationOccurredAt(occurredSorted[occurredSorted.length - 1]) : null;
  const lastSeen = occurredSorted.length ? observationOccurredAt(occurredSorted[0]) : null;
  const relationshipFacts = buildRelationshipFacts(occurredSorted);

  // The right first message depends on where the relationship stands: an
  // accepted invite → first direct message; a reply → continue the thread;
  // otherwise → a connection request.
  const suggested = suggestSurface(observedSorted, identity, email);
  const connection = resolveConnectionStatus(observedSorted);
  const composeDraft = buildComposeDraft({
    latestMessage,
    suggestedSurface: suggested.surface,
  });

  return {
    id: seed.id,
    identity,
    email,
    matchedProspect,
    matchedCompany,
    motionContext,
    claimState,
    suggestedSurface: suggested.surface,
    suggestedChannel: suggested.channel,
    connection,
    source: identity.linkedinUrl ? "linkedin" : email ? "email" : "unknown",
    counts: {
      observations: related.length,
      surfaces: surfaces.length,
    },
    surfaces,
    relationshipFacts,
    firstSeen,
    lastSeen,
    timeline,
    latestMessage,
    composeDraft,
    hasDurableIdentity,
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted
 */
function buildTimeline(sorted) {
  const entries = sorted.flatMap((observation) => {
    const subject = observation.subject ?? parseObservationNotes(observation.notes).subject;
    const channel = observation.surfaceKey === "gmail-inbox-threads" ? "email" : "linkedin";
    const surfaceLabel = KIND_LABELS[observation.kind] ?? SURFACE_LABELS[observation.surfaceKey] ?? observation.surfaceKey;
    const href = observation.threadUrl ?? observation.sourceUrl ?? null;
    const structuredMessages = normalizeStructuredMessages(observation);
    if (structuredMessages.length) {
      return structuredMessages.map((message, index) => ({
        id: `${observation.id}:message:${message.id ?? index}`,
        sourceObservationId: observation.id,
        surfaceKey: observation.surfaceKey,
        surfaceLabel,
        kind: observation.kind,
        summary: observation.summary,
        observedAt: message.sentAt ?? observationOccurredAt(observation),
        href,
        subject,
        detail: message.body,
        isMessage: true,
        channel,
        direction: message.direction,
        fromName: message.fromName,
        fromHandle: message.fromHandle,
        showSummary: false,
      }));
    }

    const parsedNotes = parseObservationNotes(observation.notes);
    const inviteNote = resolveInboundInviteNote(observation, parsedNotes);
    const pendingInviteStatus = observation.kind === "connection_request_pending"
      ? describePendingInvite(observation)
      : null;
    const isInviteMessage = observation.kind === "connection_request_received";
    const isPendingInviteMessage = observation.kind === "connection_request_pending" && Boolean(inviteNote);
    return [{
      id: observation.id,
      sourceObservationId: observation.id,
      surfaceKey: observation.surfaceKey,
      surfaceLabel,
      kind: observation.kind,
      summary: observation.summary,
      observedAt: observationOccurredAt(observation),
      href,
      subject,
      detail: isInviteMessage
        ? (inviteNote ?? "No invitation note was included with this request.")
        : isPendingInviteMessage
          ? inviteNote
          : parsedNotes.body ?? pendingInviteStatus,
      isMessage: MESSAGE_OBSERVATION_KINDS.has(observation.kind) || isInviteMessage || isPendingInviteMessage,
      channel,
      direction: MESSAGE_OBSERVATION_KINDS.has(observation.kind) || isInviteMessage
        ? "inbound"
        : isPendingInviteMessage
          ? "outbound"
          : "unknown",
      fromName: observation.actorName,
      fromHandle: observation.actorHandle,
      showSummary: isInviteMessage
        ? Boolean(inviteNote ? inviteNote !== observation.summary : observation.summary)
        : isPendingInviteMessage
          ? Boolean(pendingInviteStatus)
          : Boolean(parsedNotes.body && parsedNotes.body !== observation.summary),
    }];
  });

  return entries.sort((left, right) => (Date.parse(right.observedAt) || 0) - (Date.parse(left.observedAt) || 0));
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @returns {string}
 */
function observationOccurredAt(observation) {
  return observation.eventAt
    ?? deriveLinkedinRelativeEventAt(observation.summary, observation.observedAt)
    ?? observation.observedAt;
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 * @returns {number}
 */
function compareIso(left, right) {
  return (Date.parse(right ?? "") || 0) - (Date.parse(left ?? "") || 0);
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {{ subject: string | null, body: string | null }} parsedNotes
 * @returns {string | null}
 */
function resolveInboundInviteNote(observation, parsedNotes) {
  if (observation.kind !== "connection_request_received") {
    return parsedNotes.body;
  }
  return parsedNotes.body;
}

/**
 * Where the relationship stands, read off the observation history. The dot
 * colour reuses the record-state palette (connected = green, etc.).
 *
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted  newest-first
 * @returns {{ key: string, label: string, state: string, nextMove: string }}
 */
function resolveConnectionStatus(sorted) {
  const kinds = new Set(sorted.map((observation) => observation.kind));
  const surfaces = new Set(sorted.map((observation) => observation.surfaceKey));
  const hasLinkedinPrivateThread = sorted.some((observation) =>
    PRIVATE_LINKEDIN_THREAD_KINDS.has(String(observation?.kind ?? ""))
    || String(observation?.surfaceKey ?? "").startsWith("linkedin-"),
  );
  const privateInboundState = classifyPrivateInboundMessage(sorted);
  if (kinds.has("connection_request_accepted")) {
    const theyInvited = surfaces.has("linkedin-received-invitations");
    return {
      key: "connected",
      state: "connected",
      label: theyInvited ? "Connected · you accepted their invite" : "Connected · they accepted your request",
      nextMove: "Send the first direct message (you're connected — free DM, no note or InMail needed).",
    };
  }
  if (privateInboundState === "reply") {
    return {
      key: "in-conversation",
      state: "connected",
      label: hasLinkedinPrivateThread ? "Connected · they replied" : "In conversation · they replied",
      nextMove: "Continue the conversation.",
    };
  }
  if (privateInboundState === "first_inbound") {
    return {
      key: "inbound-message",
      state: "identified",
      label: hasLinkedinPrivateThread ? "LinkedIn message · they messaged you" : "Inbound message · they messaged you",
      nextMove: "Review the message and decide whether to reply.",
    };
  }
  if (kinds.has("connection_request_received")) {
    return { key: "invite-received", state: "pre-connect", label: "Invited you · not yet accepted", nextMove: "Accept (or decline) their connection request." };
  }
  if (kinds.has("connection_request_pending")) {
    const pending = sorted.find((observation) => observation.kind === "connection_request_pending") ?? null;
    const sentAt = pending ? observationOccurredAt(pending) : null;
    const ageDays = pending ? calculateAgeDays(sentAt ?? pending.observedAt) : 0;
    const isStale = pending ? isStalePendingConnectionRequest({ kind: pending.kind, observedAt: sentAt ?? pending.observedAt }) : false;
    return {
      key: "invite-sent",
      state: "connection-requested",
      label: isStale ? "Invite sent · stale pending" : "Invite sent · awaiting their accept",
      nextMove: isStale
        ? `This invite has been pending for ${ageDays} days and crossed Exo's ${STALE_CONNECTION_REQUEST_DAYS}-day withdraw threshold.`
        : `No decision is needed while this invite is pending. Wait for them to accept or for the ${STALE_CONNECTION_REQUEST_DAYS}-day withdraw threshold.`,
      sentAt,
      ageDays,
      isStale,
    };
  }
  const followsYou = hasAnyKind(sorted, ["follower_added", "follower_confirmed"]);
  const youFollowThem = hasAnyKind(sorted, ["follow_state_changed", "follow_state_confirmed"]);
  if (followsYou && youFollowThem) {
    return {
      key: "mutual-follow",
      state: "pre-connect",
      label: "You follow each other",
      nextMove: "This is visibility, not connection truth. Review the profile before deciding whether to connect or leave it alone.",
    };
  }
  if (followsYou) {
    return {
      key: "follows-you",
      state: "pre-connect",
      label: "They follow you",
      nextMove: "They follow you, but that still does not justify an automatic outreach move. Review the profile before deciding whether to connect.",
    };
  }
  if (youFollowThem) {
    return {
      key: "following",
      state: "pre-connect",
      label: "You follow them",
      nextMove: "You already follow them. That is not the same thing as connection permission. Review the profile before deciding whether to connect.",
    };
  }
  if (kinds.has("profile_view_received")) {
    return {
      key: "viewed",
      state: "pre-connect",
      label: "Viewed your profile",
      nextMove: "A profile view is weak attention, not permission. Review the profile before deciding whether to connect.",
    };
  }
  return { key: "inbound", state: "identified", label: "Inbound contact", nextMove: "Review and decide how to engage." };
}

const PRIVATE_LINKEDIN_THREAD_KINDS = new Set([
  "inbound_reply_received",
  "message_received",
  "thread_updated",
]);

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted
 * @param {string[]} kinds
 */
function hasAnyKind(sorted, kinds) {
  return sorted.some((observation) => kinds.includes(observation.kind));
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted  newest-first
 * @param {{ linkedinUrl: string|null }} identity
 * @param {string|null} email
 * @returns {{ surface: string | null, channel: "linkedin"|"email" }}
 */
function suggestSurface(sorted, identity, email) {
  const kinds = new Set(sorted.map((observation) => observation.kind));
  if (kinds.has("connection_request_pending") || kinds.has("connection_request_received")) {
    return { surface: null, channel: "linkedin" };
  }
  if (kinds.has("connection_request_accepted")) {
    return { surface: "post_accept_message", channel: "linkedin" };
  }
  if (kinds.has("inbound_reply_received") || kinds.has("message_received")) {
    return { surface: "inbound_reply", channel: "linkedin" };
  }
  if (kinds.has("email_reply_received") || kinds.has("email_thread_updated")) {
    return { surface: "email", channel: "email" };
  }
  if (!identity.linkedinUrl && email) {
    return { surface: "email", channel: "email" };
  }
  return { surface: "connection_request", channel: "linkedin" };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted
 */
function buildRelationshipFacts(sorted) {
  const facts = [];
  const followsYou = sorted.find((observation) => ["follower_added", "follower_confirmed"].includes(observation.kind)) ?? null;
  const youFollowThem = sorted.find((observation) => ["follow_state_changed", "follow_state_confirmed"].includes(observation.kind)) ?? null;
  const viewed = sorted.find((observation) => observation.kind === "profile_view_received") ?? null;

  if (followsYou) {
    facts.push({ label: "They follow you", at: observationOccurredAt(followsYou) });
  }
  if (youFollowThem) {
    facts.push({ label: "You follow them", at: observationOccurredAt(youFollowThem) });
  }
  if (viewed) {
    facts.push({ label: "Viewed your profile", at: observationOccurredAt(viewed) });
  }

  return facts;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} related
 * @param {import("../schema/motion.js").motionSchema._type[]} motions
 */
function resolveMatchedProspect(related, motions) {
  const prospectId = related.map((observation) => observation.prospectId).find(Boolean);
  if (!prospectId) {
    return null;
  }
  for (const motion of motions) {
    for (const account of motion.targetMap?.accounts ?? []) {
      const prospect = (account.prospects ?? []).find((candidate) => candidate.id === prospectId);
      if (prospect) {
        return {
          prospectId,
          name: prospect.name ?? null,
          motionId: motion.id,
          motionName: motion.name,
          companyId: account.companyId,
          companyName: account.companyName ?? null,
        };
      }
    }
  }
  return null;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} related
 * @param {import("../schema/company.js").companySchema._type[]} companies
 * @param {{ companyId: string | null, companyName: string | null } | null} matchedProspect
 */
function resolveMatchedCompany(related, companies, matchedProspect) {
  const companyId = matchedProspect?.companyId ?? related.map((observation) => observation.companyId).find(Boolean) ?? null;
  const observedCompanyName = normalizeResolvableCompanyName(
    matchedProspect?.companyName
      ?? related.map((observation) => observation.actorCompanyName).find(Boolean)
      ?? null,
  );

  if (!companyId && !observedCompanyName) {
    return null;
  }

  const matched = companyId
    ? companies.find((candidate) => candidate.id === companyId) ?? null
    : companies.find((candidate) => normalizeCompanyNameKey(candidate.name) === normalizeCompanyNameKey(observedCompanyName)) ?? null;
  if (matched) {
    return {
      companyId: matched.id,
      name: matched.name,
      websiteUrl: matched.websiteUrl ?? null,
      linkedinCompanyUrl: matched.linkedinCompanyUrl ?? null,
      notes: matched.notes ?? null,
      motionIds: matched.motionIds ?? [],
    };
  }

  if (!companyId) {
    return null;
  }

  return {
    companyId,
    name: observedCompanyName ?? matchedProspect?.companyName ?? null,
    websiteUrl: null,
    linkedinCompanyUrl: null,
    notes: null,
    motionIds: [],
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} related
 * @param {import("../schema/motion.js").motionSchema._type[]} motions
 * @param {{ motionId: string | null } | null} matchedProspect
 * @param {{ companyId: string | null, motionIds?: string[] | null } | null} matchedCompany
 */
function resolveMotionContext(related, motions, matchedProspect, matchedCompany) {
  const candidateIds = [];
  if (matchedProspect?.motionId) {
    candidateIds.push(matchedProspect.motionId);
  }
  for (const observation of related) {
    if (observation.motionId) {
      candidateIds.push(observation.motionId);
    }
  }
  for (const motionId of matchedCompany?.motionIds ?? []) {
    if (motionId) {
      candidateIds.push(motionId);
    }
  }

  const motion = candidateIds
    .map((motionId) => motions.find((candidate) => candidate.id === motionId) ?? null)
    .find(Boolean);
  if (!motion) {
    return null;
  }

  return {
    motionId: motion.id,
    name: motion.name,
    sourceUrl: motion.offer?.sourceUrl ?? null,
    offerNotes: motion.offer?.offerNotes ?? null,
    premise: motion.premise?.statement ?? null,
    isTransition: isTransitionMotion(motion),
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} related
 * @param {ReturnType<typeof resolveMatchedProspect>} matchedProspect
 * @param {ReturnType<typeof resolveMatchedCompany>} matchedCompany
 * @param {ReturnType<typeof resolveMotionContext>} motionContext
 */
function resolveClaimState(related, matchedProspect, matchedCompany, motionContext) {
  const hasStoredLink = related.some((observation) => observation.motionId || observation.companyId || observation.prospectId);
  if (!hasStoredLink) {
    return "unclaimed";
  }

  return matchedProspect || matchedCompany || motionContext ? "claimed_here" : "claimed_elsewhere";
}

/**
 * Most-recent non-null value of a field across observations.
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted
 * @param {keyof import("../schema/inbound.js").inboundObservationSchema._type} field
 * @returns {string | null}
 */
function pick(sorted, field) {
  for (const observation of sorted) {
    const value = observation[field];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

/**
 * @param {string | null | undefined} notes
 * @returns {{ subject: string | null, body: string | null }}
 */
function parseObservationNotes(notes) {
  if (!notes || !notes.trim()) {
    return { subject: null, body: null };
  }

  const normalized = notes.trim();
  const subjectMatch = normalized.match(/^Subject:\s*(.+?)(?:\r?\n|$)/i);
  const subject = subjectMatch?.[1]?.trim() || null;
  const body = subjectMatch
    ? normalized.slice(subjectMatch[0].length).trim() || null
    : normalized;

  return {
    subject,
    body,
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
function normalizeStructuredMessages(observation) {
  return (observation.messages ?? [])
    .filter((message) => typeof message?.body === "string" && message.body.trim().length > 0)
    .slice()
    .sort((left, right) => (Date.parse(left.sentAt ?? "") || 0) - (Date.parse(right.sentAt ?? "") || 0))
    .map((message) => ({
      id: message.id ?? null,
      direction: message.direction ?? inferMessageDirection(observation, message.fromHandle),
      sentAt: message.sentAt ?? null,
      fromName: normalizeNullableString(message.fromName) ?? observation.actorName ?? null,
      fromHandle: normalizeNullableString(message.fromHandle) ?? observation.actorHandle ?? null,
      body: message.body.trim(),
    }));
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {string | null | undefined} fromHandle
 */
function inferMessageDirection(observation, fromHandle) {
  const normalizedFromHandle = normalizeNullableString(fromHandle)?.toLowerCase() ?? null;
  const normalizedActorHandle = normalizeNullableString(observation.actorHandle)?.toLowerCase() ?? null;
  if (normalizedFromHandle && normalizedActorHandle && normalizedFromHandle === normalizedActorHandle) {
    return "inbound";
  }
  return "unknown";
}

/**
 * @param {{
 *   latestMessage: { subject?: string | null } | null,
 *   suggestedSurface: string,
 * }} input
 */
function buildComposeDraft(input) {
  if (input.suggestedSurface === "email") {
    return {
      subject: normalizeReplySubject(input.latestMessage?.subject ?? null),
      body: "",
    };
  }

  return { subject: null, body: "" };
}

/**
 * @param {string | null | undefined} name
 */
function isPlaceholderIdentityName(name) {
  const normalized = normalizeNullableString(name)?.toLowerCase() ?? null;
  if (!normalized) {
    return true;
  }
  return normalized === "unknown person" || normalized === "unknown linkedin user";
}

/**
 * @param {string | null | undefined} subject
 */
function normalizeReplySubject(subject) {
  const normalized = normalizeNullableString(subject);
  if (!normalized) {
    return null;
  }
  return /^re:/i.test(normalized) ? normalized : `Re: ${normalized}`;
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
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted
 */
function pickBestLinkedinPublicId(sorted) {
  const candidates = sorted
    .map((observation) => normalizeNullableString(observation.actorLinkedinPublicId) ?? extractLinkedinPublicId(observation.actorProfileUrl))
    .filter(Boolean);
  return candidates.find((value) => !isOpaqueLinkedinPublicId(value)) ?? candidates[0] ?? null;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted
 * @param {string | null} preferredPublicId
 */
function pickBestLinkedinProfileUrl(sorted, preferredPublicId) {
  const urls = sorted
    .map((observation) => normalizeNullableString(observation.actorProfileUrl))
    .filter(Boolean);
  return urls.find((url) => {
    const publicId = extractLinkedinPublicId(url);
    if (!publicId) return false;
    if (preferredPublicId && publicId === preferredPublicId) return true;
    return !isOpaqueLinkedinPublicId(publicId);
  }) ?? urls[0] ?? null;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted
 * @param {string | null} preferredPublicId
 */
function pickBestActorHandle(sorted, preferredPublicId) {
  if (preferredPublicId) {
    return preferredPublicId;
  }

  const handles = sorted
    .map((observation) => normalizeNullableString(observation.actorHandle))
    .filter(Boolean);
  return handles.find((value) => !isOpaqueLinkedinPublicId(value) && !value.includes("@")) ?? handles[0] ?? null;
}

/**
 * @param {string | null | undefined} value
 */
function isOpaqueLinkedinPublicId(value) {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return false;
  }
  return /^aco[a-z0-9_-]{10,}$/.test(normalized);
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
function describePendingInvite(observation) {
  const sentAt = observationOccurredAt(observation);
  const ageDays = calculateAgeDays(sentAt ?? observation.observedAt);
  const sentLabel = formatLongDate(sentAt);
  return [sentLabel ? `Sent ${sentLabel}.` : null, `Outstanding ${ageDays}d.`].filter(Boolean).join(" ");
}

/**
 * @param {string | null | undefined} iso
 */
function calculateAgeDays(iso) {
  if (!iso) return 0;
  const observedAt = new Date(iso);
  if (Number.isNaN(observedAt.getTime())) {
    return 0;
  }
  const diffMs = Date.now() - observedAt.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * @param {string | null | undefined} iso
 */
function formatLongDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
