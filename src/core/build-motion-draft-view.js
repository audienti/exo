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
