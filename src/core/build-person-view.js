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

import { inboundObservationsShareIdentity } from "./inbound-observations.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { deriveLinkedinCompanyName } from "../lib/linkedin-headline.js";
import { classifyPrivateInboundMessage } from "./private-inbound-message-classification.js";
import { isTransitionMotion } from "./ensure-transition-motion.js";

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
    (observation) => observation.id === seed.id || inboundObservationsShareIdentity(observation, seed),
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
  const sorted = related
    .slice()
    .sort((a, b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0));

  // Merge identity field-by-field, preferring the most recent non-null value.
  const identity = {
    name: pick(sorted, "actorName") ?? "Unknown person",
    title: pick(sorted, "actorTitle"),
    company: pick(sorted, "actorCompanyName") ?? deriveLinkedinCompanyName(pick(sorted, "actorTitle")),
    avatarUrl: pick(sorted, "actorAvatarUrl") ?? pick(sorted, "actorAvatarSourceUrl"),
    linkedinUrl: pick(sorted, "actorProfileUrl"),
    publicId: pick(sorted, "actorLinkedinPublicId"),
    handle: pick(sorted, "actorHandle"),
  };
  const email = identity.handle && identity.handle.includes("@") ? identity.handle : null;
  const hasDurableIdentity =
    Boolean(email || identity.linkedinUrl || identity.publicId || !isPlaceholderIdentityName(identity.name));

  const matchedProspect = resolveMatchedProspect(related, motions);
  const matchedCompany = resolveMatchedCompany(related, companies, matchedProspect);
  const motionContext = resolveMotionContext(related, motions, companies, matchedProspect, matchedCompany);
  const timeline = buildTimeline(sorted);
  const latestMessage = timeline.find((entry) => entry.isMessage && entry.direction !== "outbound")
    ?? timeline.find((entry) => entry.isMessage)
    ?? null;

  const surfaces = [...new Set(timeline.map((entry) => entry.surfaceLabel))];
  const firstSeen = sorted.length ? sorted[sorted.length - 1].observedAt : null;
  const lastSeen = sorted.length ? sorted[0].observedAt : null;

  // The right first message depends on where the relationship stands: an
  // accepted invite → first direct message; a reply → continue the thread;
  // otherwise → a connection request.
  const suggested = suggestSurface(sorted, identity, email);
  const connection = resolveConnectionStatus(sorted);
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
    suggestedSurface: suggested.surface,
    suggestedChannel: suggested.channel,
    connection,
    source: identity.linkedinUrl ? "linkedin" : email ? "email" : "unknown",
    counts: {
      observations: sorted.length,
      surfaces: surfaces.length,
    },
    surfaces,
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
        observedAt: message.sentAt ?? observation.observedAt,
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
    const isInviteMessage = observation.kind === "connection_request_received";
    return [{
      id: observation.id,
      sourceObservationId: observation.id,
      surfaceKey: observation.surfaceKey,
      surfaceLabel,
      kind: observation.kind,
      summary: observation.summary,
      observedAt: observation.observedAt,
      href,
      subject,
      detail: isInviteMessage ? (inviteNote ?? "No invitation note was included with this request.") : parsedNotes.body,
      isMessage: MESSAGE_OBSERVATION_KINDS.has(observation.kind) || isInviteMessage,
      channel,
      direction: MESSAGE_OBSERVATION_KINDS.has(observation.kind) || isInviteMessage ? "inbound" : "unknown",
      fromName: observation.actorName,
      fromHandle: observation.actorHandle,
      showSummary: isInviteMessage
        ? Boolean(inviteNote ? inviteNote !== observation.summary : observation.summary)
        : Boolean(parsedNotes.body && parsedNotes.body !== observation.summary),
    }];
  });

  return entries.sort((left, right) => (Date.parse(right.observedAt) || 0) - (Date.parse(left.observedAt) || 0));
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
    return { key: "in-conversation", state: "connected", label: "In conversation · they replied", nextMove: "Continue the conversation." };
  }
  if (privateInboundState === "first_inbound") {
    return { key: "inbound-message", state: "identified", label: "Inbound message · they messaged you", nextMove: "Review the message and decide whether to reply." };
  }
  if (kinds.has("connection_request_received")) {
    return { key: "invite-received", state: "pre-connect", label: "Invited you · not yet accepted", nextMove: "Accept (or decline) their connection request." };
  }
  if (kinds.has("connection_request_pending")) {
    return { key: "invite-sent", state: "connection-requested", label: "Invite sent · awaiting their accept", nextMove: "Wait for them to accept; follow up once they do." };
  }
  if (kinds.has("follow_state_confirmed")) {
    return { key: "following", state: "pre-connect", label: "Following you", nextMove: "Warm via recent activity, then send a connection request." };
  }
  if (kinds.has("profile_view_received")) {
    return { key: "viewed", state: "pre-connect", label: "Viewed your profile", nextMove: "They showed interest — send a connection request." };
  }
  return { key: "inbound", state: "identified", label: "Inbound contact", nextMove: "Review and decide how to engage." };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} sorted  newest-first
 * @param {{ linkedinUrl: string|null }} identity
 * @param {string|null} email
 * @returns {{ surface: string, channel: "linkedin"|"email" }}
 */
function suggestSurface(sorted, identity, email) {
  const kinds = new Set(sorted.map((observation) => observation.kind));
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
  return { prospectId, name: null, motionId: null, motionName: null, companyId: null, companyName: null };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type[]} related
 * @param {import("../schema/company.js").companySchema._type[]} companies
 * @param {{ companyId: string | null, companyName: string | null } | null} matchedProspect
 */
function resolveMatchedCompany(related, companies, matchedProspect) {
  const companyId = matchedProspect?.companyId ?? related.map((observation) => observation.companyId).find(Boolean) ?? null;
  if (!companyId) {
    return null;
  }

  const matched = companies.find((candidate) => candidate.id === companyId) ?? null;
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

  return {
    companyId,
    name: matchedProspect?.companyName ?? null,
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
