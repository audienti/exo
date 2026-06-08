// @ts-check

import { buildMotionProspectView } from "./build-motion-prospect-view.js";
import { prospectGuidanceContext } from "./prospect-steer.js";
import {
  hasAcceptedConnection,
  hasPriorPrivateOutbound,
  isFirstPrivateDirectMessagePath,
} from "./select-next-draft-surface.js";

const SUBJECT_SURFACES = new Set(["email", "in_mail_message"]);

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
 *   rawObservations?: unknown[] | null,
 *   surface?: string | null
 * }} options
 */
export function buildMotionDraftView(rawMotion, options) {
  const prospectView = buildMotionProspectView(rawMotion, {
    companyId: options.companyId ?? null,
    prospectId: options.prospectId,
    rawObservations: options.rawObservations ?? null,
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
 *   rawObservations?: unknown[] | null,
 *   surface: string
 * }} options
 */
export function buildMotionDraftBrief(rawMotion, options) {
  const draftView = buildMotionDraftView(rawMotion, options);
  const surface = draftView.surfaces[0];

  // Operator notes + steers are binding. Pull them from the raw prospect so the
  // agent reads them before writing a word.
  const rawProspect = (rawMotion?.targetMap?.accounts ?? [])
    .flatMap((account) => account.prospects ?? [])
    .find((prospect) => prospect.id === options.prospectId) ?? null;
  const operatorGuidance = prospectGuidanceContext(rawProspect);

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
    // Front and center: the operator's notes/steers for this prospect. Honor
    // them over everything else. A "don't contact / works for us" steer means
    // do not draft at all.
    operatorGuidance,
    draftRequest: {
      doNotSend: true,
      task: `Write one unsent ${surface.stage.toLowerCase()} draft for ${draftView.prospect.name} at ${draftView.company.name}.`,
      rules: buildDraftRules(surface),
      sourceOfTruth: [
        "Honor the operatorGuidance (operator notes + steers) before anything else. If a steer says not to contact this person, do not draft.",
        "Write from the operator stance: a market operator networking, never a salesperson pitching (see docs/writing-voice.md).",
        "Stay inside the stored why-relevant, signal-match, cadence, and live-signal evidence.",
        "When threadMessages exist, answer the actual conversation instead of resetting it.",
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
  const stage = resolveDraftStage(brief, definition);

  return {
    key: definition.key,
    stage,
    channel: definition.channel,
    usesSubject: SUBJECT_SURFACES.has(definition.key),
    replySubject: brief.prospect.replySubject ?? null,
    available: availability.available,
    missingReason: availability.reason,
    contextSummary: {
      whyRelevant: brief.prospect.whyRelevant,
      nextAction: brief.prospect.cadenceState.nextAction,
      latestSignal: brief.signalMatches[0]?.summary ?? null,
      liveSignal: brief.prospect.liveSignal.summary,
      recentPostReady: brief.recentPost.engageable
    },
    priorTouches: brief.prospect.touches.slice(-5).reverse().map((touch) => ({
      id: touch.id,
      surface: touch.surface,
      direction: touch.direction,
      outcome: touch.outcome,
      occurredAt: touch.occurredAt,
      summary: touch.summary,
      subject: touch.subject ?? null,
      body: touch.body ?? null,
    })),
    threadMessages: brief.prospect.threadMessages,
    latestInboundMessage: brief.prospect.latestInboundMessage,
    signalMatches: brief.signalMatches.map((match) => ({
      id: match.id,
      signalName: match.signalName,
      summary: match.summary,
      observedAt: match.observedAt,
      sourceUrl: match.sourceUrl
    })),
    writingInputs: {
      cadenceState: brief.prospect.cadenceState,
      liveSignal: brief.prospect.liveSignal,
      recentPost: brief.recentPost,
      whyRelevant: brief.prospect.whyRelevant,
      signalMatches: brief.signalMatches,
      threadMessages: brief.prospect.threadMessages,
      latestInboundMessage: brief.prospect.latestInboundMessage,
      replySubject: brief.prospect.replySubject ?? null,
      email: brief.prospect.email,
      profileViewedAt: brief.prospect.profileViewedAt
    }
  };
}

/**
 * @param {string} surface
 */
function buildDraftRules(surface) {
  switch (surface.key) {
    case "connection_request":
      return [
        "Keep it short, warm, and not salesy.",
        "Do not ask for a meeting or pitch anything.",
        "Give one genuine human reason to connect, grounded only in the stored signal and why-relevant context."
      ];
    case "post_accept_message":
      return [
        "Relationship-first: just say it's good to connect and you're looking forward to chatting.",
        "Do NOT pitch, ask for a meeting, introduce the product, or include a link. No setup question, no agenda.",
        "One or two plain sentences. The real conversation happens on their reply or a later follow-up, not here."
      ];
    case "follow_up_direct_message":
      if (isFirstPrivateDirectMessageStage(surface)) {
        return [
          "This is the first private LinkedIn message on an open-profile direct-message path. Do not write it like a follow-up to an accepted invite.",
          "Lead with the actual reason to reach out, grounded in the stored signal and why-relevant context.",
          "Keep it tight, human, and low-friction. One concrete point and one simple next step."
        ];
      }
      return [
        "This is where you engage directly: they connected and went quiet, so now bring the actual reason.",
        "Lead with one concrete, relevant point and a single low-friction next step.",
        "Keep it tight and human. Reference the prior note without restating it."
      ];
    case "email":
      return [
        "Write for direct inbox reading, not LinkedIn.",
        "If surface.replySubject exists, this is a reply. Keep that exact subject line.",
        "If surface.replySubject does not exist, generate a concise subject line that fits the ask.",
        "Use the stored signal and why-relevant context as the spine.",
        "Keep the ask narrow and concrete."
      ];
    case "inbound_reply":
      return [
        "Respond conversationally to the inbound context.",
        "Respond to the actual inbound thread when threadMessages are present. Do not reset the conversation with a fresh opener.",
        "If they answered a question, build on their answer instead of asking a generic discovery question.",
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
      if (brief.prospect.cadenceState.status !== "ready" || brief.prospect.cadenceState.currentStep !== "connection-request") {
        return { available: false, reason: "Cadence is not currently ready for a connection-request branch." };
      }
      if (!brief.prospect.linkedinProfileUrl) {
        return { available: false, reason: "No LinkedIn profile URL is stored for this prospect." };
      }
      return { available: true, reason: null };
    case "post_accept_message":
      return hasAcceptedConnection(brief.prospect, touches)
        ? { available: true, reason: null }
        : { available: false, reason: "No accepted connection request is recorded for this prospect yet." };
    case "follow_up_direct_message":
      return hasPrivateTouch(touches) || isFirstPrivateDirectMessagePath(brief.prospect, touches)
        ? { available: true, reason: null }
        : { available: false, reason: "No governed direct-message branch is writable for this prospect yet." };
    case "email":
      return brief.prospect.email
        ? { available: true, reason: null }
        : { available: false, reason: "No direct email is stored for this prospect yet." };
    case "inbound_reply":
      return touches.some((touch) => touch.direction === "inbound")
        ? { available: true, reason: null }
        : { available: false, reason: "No inbound touch is recorded for this prospect yet." };
    case "public_comment":
      return brief.recentPost.engageable && brief.recentPost.selectedTarget?.recommendedAction === "comment" && brief.recentPost.selectedTarget?.targetKind === "post"
        ? { available: true, reason: null }
        : { available: false, reason: brief.recentPost.reason };
    case "comment_reply":
      return touches.some((touch) => touch.surface === "public_comment" || touch.surface === "comment_reply")
        || (
          brief.recentPost.engageable
          && brief.recentPost.selectedTarget?.recommendedAction === "comment"
          && brief.recentPost.selectedTarget?.targetKind === "comment"
        )
        ? { available: true, reason: null }
        : { available: false, reason: "No comment-thread context is recorded for this prospect yet." };
    default:
      return { available: false, reason: "Unsupported draft surface." };
  }
}

/**
 * @param {NonNullable<ReturnType<typeof buildMotionProspectView>["writingBrief"]>} brief
 * @param {{ key: string, stage: string, channel: string }} definition
 */
function resolveDraftStage(brief, definition) {
  if (definition.key === "follow_up_direct_message" && isFirstPrivateDirectMessagePath(brief.prospect, brief.prospect.touches)) {
    return "First private message";
  }
  return definition.stage;
}

/**
 * @param {Array<{ surface: string }>} touches
 */
function hasPrivateTouch(touches) {
  return hasPriorPrivateOutbound(touches) || touches.some((touch) => touch.surface === "inbound_reply");
}

/**
 * @param {{ key: string, stage: string }} surface
 */
function isFirstPrivateDirectMessageStage(surface) {
  return surface.key === "follow_up_direct_message" && surface.stage === "First private message";
}
