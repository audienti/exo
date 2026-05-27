// @ts-check

import { buildMotionProspectView } from "./build-motion-prospect-view.js";

const CARD_DEFINITIONS = [
  { key: "connection_request", stage: "Connection request", channel: "linkedin" },
  { key: "post_accept_message", stage: "First direct message", channel: "linkedin" },
  { key: "follow_up_direct_message", stage: "Follow-up direct message", channel: "linkedin" },
  { key: "email", stage: "Email", channel: "email" },
  { key: "inbound_reply", stage: "Inbound reply", channel: "linkedin" },
  { key: "public_comment", stage: "Public comment", channel: "linkedin" },
  { key: "comment_reply", stage: "Comment reply", channel: "linkedin" }
];

/**
 * @param {unknown} rawMotion
 * @param {{
 *   companyId?: string | null,
 *   prospectId: string,
 *   surface?: string | null
 * }} options
 */
export function buildMotionDraftView(rawMotion, options) {
  const prospectView = buildMotionProspectView(rawMotion, {
    companyId: options.companyId ?? null,
    prospectId: options.prospectId
  });

  if (!prospectView.writingBrief) {
    throw new Error(`Prospect ${options.prospectId} does not have a writing brief in this motion.`);
  }

  const selectedDefinitions = options.surface
    ? CARD_DEFINITIONS.filter((definition) => definition.key === options.surface)
    : CARD_DEFINITIONS;

  if (!selectedDefinitions.length) {
    throw new Error(`Unsupported draft surface: ${options.surface}`);
  }

  return {
    motion: prospectView.motion,
    prospect: prospectView.writingBrief.prospect,
    company: prospectView.writingBrief.company,
    surfaces: selectedDefinitions.map((definition) => buildDraftCard(prospectView.writingBrief, definition))
  };
}

/**
 * @param {unknown} rawMotion
 * @param {{
 *   companyId?: string | null,
 *   prospectId: string,
 *   surface: string
 * }} options
 */
export function buildMotionDraftBrief(rawMotion, options) {
  const draftView = buildMotionDraftView(rawMotion, options);
  const surface = draftView.surfaces[0];

  return {
    motion: draftView.motion,
    company: draftView.company,
    prospect: {
      prospectId: draftView.prospect.prospectId,
      name: draftView.prospect.name,
      title: draftView.prospect.title,
      linkedinProfileUrl: draftView.prospect.linkedinProfileUrl,
      email: draftView.prospect.email,
      profileViewedAt: draftView.prospect.profileViewedAt
    },
    surface,
    draftRequest: {
      doNotSend: true,
      task: `Write one unsent ${surface.stage.toLowerCase()} draft for ${draftView.prospect.name} at ${draftView.company.name}.`,
      rules: buildDraftRules(surface.key),
      sourceOfTruth: [
        "Use the stored through-line as the narrative spine.",
        "Stay inside the stored signal matches and live-signal evidence.",
        "Respect prior touches so the message fits what already happened.",
        "If the surface is unavailable, explain why instead of drafting."
      ]
    }
  };
}

/**
 * @param {NonNullable<ReturnType<typeof buildMotionProspectView>["writingBrief"]>} brief
 * @param {{ key: string, stage: string, channel: string }} definition
 */
function buildDraftCard(brief, definition) {
  const availability = availabilityFor(brief, definition.key);

  return {
    key: definition.key,
    stage: definition.stage,
    channel: definition.channel,
    available: availability.available,
    missingReason: availability.reason,
    contextSummary: {
      compressionLine: brief.prospect.throughLine.compressionLine,
      whyNow: brief.prospect.openingPlan.whyNow,
      angle: brief.prospect.openingPlan.angle,
      replyPath: brief.prospect.openingPlan.replyPath,
      firstMessageGoal: brief.prospect.openingPlan.firstMessageGoal,
      recentPostReady: brief.recentPost.engageable
    },
    priorTouches: brief.prospect.touches.slice(-5).reverse().map((touch) => ({
      id: touch.id,
      surface: touch.surface,
      direction: touch.direction,
      outcome: touch.outcome,
      occurredAt: touch.occurredAt,
      summary: touch.summary
    })),
    signalMatches: brief.signalMatches.map((match) => ({
      id: match.id,
      signalName: match.signalName,
      summary: match.summary,
      observedAt: match.observedAt,
      sourceUrl: match.sourceUrl
    })),
    writingInputs: {
      throughLine: brief.prospect.throughLine,
      openingPlan: brief.prospect.openingPlan,
      cadenceState: brief.prospect.cadenceState,
      liveSignal: brief.prospect.liveSignal,
      recentPost: brief.recentPost,
      email: brief.prospect.email,
      profileViewedAt: brief.prospect.profileViewedAt
    }
  };
}

/**
 * @param {string} surface
 */
function buildDraftRules(surface) {
  switch (surface) {
    case "connection_request":
      return [
        "Keep it short and low-friction.",
        "Do not ask for a meeting.",
        "Anchor on the stored why-now and the strongest relevant signal."
      ];
    case "post_accept_message":
      return [
        "Thank them briefly for connecting.",
        "Ask one genuine, easy-to-answer question.",
        "Do not jump straight into a meeting ask."
      ];
    case "follow_up_direct_message":
      return [
        "Assume they saw the earlier touch and stayed silent.",
        "Add one fresh angle or useful clarification.",
        "Keep the follow-up tighter than the first DM."
      ];
    case "email":
      return [
        "Write for direct inbox reading, not LinkedIn.",
        "Use the stored through-line and why-now as the spine.",
        "Keep the ask narrow and concrete."
      ];
    case "inbound_reply":
      return [
        "Respond conversationally to the inbound context.",
        "Advance the conversation without overexplaining.",
        "Match the prospect's apparent level of interest."
      ];
    case "public_comment":
      return [
        "Keep it native to the post.",
        "Do not pitch in the comment.",
        "React to the public signal in a way that would look normal to a peer."
      ];
    case "comment_reply":
      return [
        "Reply inside the existing thread context.",
        "Keep it short, natural, and non-promotional.",
        "Advance the thread without hijacking it."
      ];
    default:
      return ["Write from the stored context and do not invent facts."];
  }
}

/**
 * @param {NonNullable<ReturnType<typeof buildMotionProspectView>["writingBrief"]>} brief
 * @param {string} surface
 */
function availabilityFor(brief, surface) {
  const touches = brief.prospect.touches;

  switch (surface) {
    case "connection_request":
      if (touches.some((touch) => touch.surface === "connection_request")) {
        return { available: false, reason: "A connection-request touch is already recorded for this prospect." };
      }
      if (!brief.messageTestReady) {
        return { available: false, reason: "Through-line, opening plan, and cadence must all be ready before testing a connection request." };
      }
      if (!brief.prospect.linkedinProfileUrl) {
        return { available: false, reason: "No LinkedIn profile URL is stored for this prospect." };
      }
      return { available: true, reason: null };
    case "post_accept_message":
      return hasAcceptedConnection(touches)
        ? { available: true, reason: null }
        : { available: false, reason: "No accepted connection request is recorded for this prospect yet." };
    case "follow_up_direct_message":
      return hasPrivateTouch(touches)
        ? { available: true, reason: null }
        : { available: false, reason: "No prior private message touch is recorded for this prospect yet." };
    case "email":
      return brief.prospect.email
        ? { available: true, reason: null }
        : { available: false, reason: "No direct email is stored for this prospect yet." };
    case "inbound_reply":
      return touches.some((touch) => touch.direction === "inbound")
        ? { available: true, reason: null }
        : { available: false, reason: "No inbound touch is recorded for this prospect yet." };
    case "public_comment":
      return brief.recentPost.engageable
        ? { available: true, reason: null }
        : { available: false, reason: brief.recentPost.reason };
    case "comment_reply":
      return touches.some((touch) => touch.surface === "public_comment" || touch.surface === "comment_reply")
        ? { available: true, reason: null }
        : { available: false, reason: "No comment-thread context is recorded for this prospect yet." };
    default:
      return { available: false, reason: "Unsupported draft surface." };
  }
}

/**
 * @param {Array<{ surface: string, outcome: string }>} touches
 */
function hasAcceptedConnection(touches) {
  return touches.some((touch) => touch.surface === "connection_request" && touch.outcome === "accepted");
}

/**
 * @param {Array<{ surface: string }>} touches
 */
function hasPrivateTouch(touches) {
  return touches.some((touch) => touch.surface === "post_accept_message" || touch.surface === "follow_up_direct_message" || touch.surface === "inbound_reply");
}
