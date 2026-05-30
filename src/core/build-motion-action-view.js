// @ts-check

import { buildMotionDraftView } from "./build-motion-draft-view.js";
import { buildMotionProspectView } from "./build-motion-prospect-view.js";
import { listActionCatalog, normalizeActionKey } from "../lib/action-catalog.js";

/**
 * @param {unknown} rawMotion
 * @param {{
 *   companyId?: string | null,
 *   prospectId: string,
 *   includeUnavailable?: boolean
 * }} options
 * @param {unknown | null} [rawCompany]
 */
export function buildMotionActionView(rawMotion, options, rawCompany = null) {
  const prospectView = buildMotionProspectView(rawMotion, {
    companyId: options.companyId ?? null,
    prospectId: options.prospectId
  });

  if (!prospectView.writingBrief) {
    throw new Error(`Prospect ${options.prospectId} does not have a writing brief in this motion.`);
  }

  const draftView = buildMotionDraftView(rawMotion, {
    companyId: options.companyId ?? null,
    prospectId: options.prospectId
  });

  const brief = prospectView.writingBrief;
  const draftSurfaces = new Map(draftView.surfaces.map((surface) => [surface.key, surface]));
  const executionIdentity = buildExecutionIdentity(rawCompany);

  const actions = listActionCatalog()
    .map((definition) => buildActionState(brief, definition, draftSurfaces, executionIdentity))
    .filter((action) => options.includeUnavailable === false ? action.available : true)
    .sort(compareActionState);

  return {
    motion: prospectView.motion,
    company: brief.company,
    prospect: {
      prospectId: brief.prospect.prospectId,
      name: brief.prospect.name,
      title: brief.prospect.title,
      linkedinProfileUrl: brief.prospect.linkedinProfileUrl,
      email: brief.prospect.email,
      profileViewedAt: brief.prospect.profileViewedAt
    },
    executionIdentity,
    actions
  };
}

/**
 * @param {unknown} rawMotion
 * @param {{
 *   companyId?: string | null,
 *   prospectId: string,
 *   action: string
 * }} options
 * @param {unknown | null} [rawCompany]
 */
export function buildMotionActionBrief(rawMotion, options, rawCompany = null) {
  const prospectView = buildMotionProspectView(rawMotion, {
    companyId: options.companyId ?? null,
    prospectId: options.prospectId
  });

  if (!prospectView.writingBrief) {
    throw new Error(`Prospect ${options.prospectId} does not have a writing brief in this motion.`);
  }

  const normalizedAction = normalizeActionKey(options.action);
  const actionView = buildMotionActionView(rawMotion, {
    companyId: options.companyId ?? null,
    prospectId: options.prospectId
  }, rawCompany);
  const action = actionView.actions.find((candidate) => candidate.key === normalizedAction);

  if (!action) {
    throw new Error(`Unsupported action: ${options.action}`);
  }

  return {
    motion: actionView.motion,
    company: actionView.company,
    prospect: actionView.prospect,
    executionIdentity: actionView.executionIdentity,
    action,
    execution: {
      task: `Perform ${action.label} for ${actionView.prospect.name} at ${actionView.company.name}.`,
      preferredHarness: action.platform === "linkedin" ? "chrome" : "runtime-native",
      draftCommand: action.draftSurface
        ? `exo motion draft-brief ${actionView.motion.id} --prospect ${actionView.prospect.prospectId} --surface ${action.draftSurface.key} --json`
        : null,
      steps: buildExecutionSteps(actionView, action),
      contextualHints: buildContextualHints(prospectView.writingBrief, action),
      writeback: {
        command: buildWritebackCommand(actionView, action)
      },
      knowledgeRefs: action.knowledgeRefs
    }
  };
}

/**
 * @param {NonNullable<ReturnType<typeof buildMotionProspectView>["writingBrief"]>} brief
 * @param {ReturnType<typeof listActionCatalog>[number]} definition
 * @param {Map<string, ReturnType<typeof buildMotionDraftView>["surfaces"][number]>} draftSurfaces
 * @param {{ status: string, message: string, label: string | null, profileId: string | null, browser: string | null, profileDirectory: string | null }} executionIdentity
 */
function buildActionState(brief, definition, draftSurfaces, executionIdentity) {
  const context = {
    brief,
    definition,
    draftSurfaces,
    executionIdentity
  };
  const availability = availabilityForAction(context);
  const draftSurface = resolveDraftSurface(context, availability);

  return {
    key: definition.key,
    label: definition.label,
    summary: definition.summary,
    platform: definition.platform,
    category: definition.category,
    executionActionType: definition.executionActionType,
    rateLimitActionType: definition.rateLimitActionType,
    requiredCapability: definition.requiredCapability,
    entityRequirement: definition.entityRequirement,
    fields: definition.fields,
    aliases: definition.aliases,
    activityKeys: definition.activityKeys,
    knowledgeRefs: definition.knowledgeRefs,
    executionHints: definition.executionHints,
    recommended: isRecommendedAction(brief, definition.key),
    available: availability.available,
    status: availability.status,
    reason: availability.reason,
    draftSurface,
    executionIdentity
  };
}

/**
 * @param {{
 *   brief: NonNullable<ReturnType<typeof buildMotionProspectView>["writingBrief"]>,
 *   definition: ReturnType<typeof listActionCatalog>[number],
 *   draftSurfaces: Map<string, ReturnType<typeof buildMotionDraftView>["surfaces"][number]>,
 *   executionIdentity: { status: string }
 * }} context
 */
function availabilityForAction(context) {
  const { brief, definition } = context;
  const touches = brief.prospect.touches;

  switch (definition.key) {
    case "connection_request":
      return fromDraftSurface(context.draftSurfaces.get("connection_request"));
    case "send_direct_message": {
      const surfaceKey = resolveDirectMessageSurface(brief);
      if (!surfaceKey) {
        return {
          available: false,
          status: "blocked",
          reason: "No accepted connection or inbound thread is recorded for this prospect yet."
        };
      }

      return fromDraftSurface(context.draftSurfaces.get(surfaceKey), { surfaceKey });
    }
    case "send_email":
      return fromDraftSurface(context.draftSurfaces.get("email"));
    case "create_post_comment":
      return fromDraftSurface(context.draftSurfaces.get("public_comment"));
    case "create_comment_comment":
      return fromDraftSurface(context.draftSurfaces.get("comment_reply"));
    case "profile_view":
      if (brief.prospect.profileViewedAt || hasSurface(touches, "profile_view")) {
        return { available: false, status: "completed", reason: "The profile is already viewed and recorded." };
      }
      return brief.prospect.linkedinProfileUrl
        ? { available: true, status: "available", reason: "The prospect profile is stored and can be viewed now." }
        : { available: false, status: "blocked", reason: "No LinkedIn profile URL is stored for this prospect." };
    case "follow":
      if (!brief.prospect.linkedinProfileUrl) {
        return { available: false, status: "blocked", reason: "No LinkedIn profile URL is stored for this prospect." };
      }
      if (hasNonBlockedSurface(touches, "follow") && !hasNonBlockedSurface(touches, "unfollow")) {
        return { available: false, status: "completed", reason: "A follow is already recorded for this prospect." };
      }
      if (countSurfaceOutcome(touches, "follow", "blocked") > 0) {
        const blockedCount = countSurfaceOutcome(touches, "follow", "blocked");
        return {
          available: false,
          status: "blocked",
          reason: blockedCount === 1
            ? "LinkedIn already rejected a follow attempt for this prospect. Do not keep using Follow as the warmup path."
            : `LinkedIn already rejected ${blockedCount} follow attempts for this prospect. Do not keep using Follow as the warmup path.`
        };
      }
      return { available: true, status: "available", reason: "A follow can be used as a lightweight warmup step." };
    case "unfollow":
      return hasNonBlockedSurface(touches, "follow") && !hasNonBlockedSurface(touches, "unfollow")
        ? { available: true, status: "available", reason: "A follow is already recorded and can be undone." }
        : { available: false, status: "blocked", reason: "No current follow is recorded for this prospect." };
    case "like_post":
      if (!brief.recentPost.engageable) {
        return { available: false, status: "blocked", reason: brief.recentPost.reason };
      }
      if (hasNonBlockedSurface(touches, "like_post") && !hasNonBlockedSurface(touches, "unlike_post")) {
        return { available: false, status: "completed", reason: "A post-like is already recorded for this prospect." };
      }
      return { available: true, status: "available", reason: "A fresh recent-post warmup exists for a lightweight like." };
    case "unlike_post":
      return hasNonBlockedSurface(touches, "like_post") && !hasNonBlockedSurface(touches, "unlike_post")
        ? { available: true, status: "available", reason: "A prior like exists and can be removed." }
        : { available: false, status: "blocked", reason: "No current post-like is recorded for this prospect." };
    case "share_post":
      return brief.recentPost.engageable
        ? { available: true, status: "available", reason: "A fresh recent post exists if sharing is the right move." }
        : { available: false, status: "blocked", reason: brief.recentPost.reason };
    case "in_mail_message":
      if (!brief.prospect.linkedinProfileUrl) {
        return { available: false, status: "blocked", reason: "No LinkedIn profile URL is stored for this prospect." };
      }
      if (hasAcceptedConnection(touches)) {
        return { available: false, status: "blocked", reason: "A connection is already accepted. Use direct message instead of InMail." };
      }
      if (!brief.messageTestReady) {
        return { available: false, status: "blocked", reason: "Through-line, opening plan, and cadence must all be ready before testing InMail." };
      }
      return {
        available: true,
        status: "available",
        reason: "LinkedIn identity and prospect context are ready. Live entitlement still needs to be confirmed in the browser."
      };
    case "withdraw_connection":
      if (!hasNonBlockedSurface(touches, "connection_request")) {
        return { available: false, status: "blocked", reason: "No connection request is recorded for this prospect." };
      }
      if (hasAcceptedConnection(touches)) {
        return { available: false, status: "blocked", reason: "The connection is already accepted, so there is nothing to withdraw." };
      }
      if (hasSurface(touches, "withdraw_connection")) {
        return { available: false, status: "completed", reason: "A withdrawal is already recorded for this prospect." };
      }
      return { available: true, status: "available", reason: "A pending or ignored connection request can still be withdrawn." };
    case "create_comment_reaction":
      return hasSurface(touches, "public_comment") || hasSurface(touches, "comment_reply")
        ? { available: true, status: "available", reason: "A public thread exists, so a comment reaction is plausible." }
        : { available: false, status: "blocked", reason: "No comment-thread context is stored for this prospect yet." };
    case "accept_connection":
    case "decline_connection":
      return { available: false, status: "blocked", reason: "No inbound connection-request state is stored for this prospect yet." };
    case "voicemail_outreach":
      return { available: false, status: "unsupported", reason: "The motion does not yet store phone-number context for this prospect." };
    case "video_outreach":
      return { available: false, status: "unsupported", reason: "The motion does not yet store a governed video-delivery path for this prospect." };
    default:
      return { available: false, status: "unsupported", reason: "Unsupported action." };
  }
}

/**
 * @param {{
 *   key: string,
 *   stage: string,
 *   channel: string,
 *   available: boolean,
 *   missingReason: string | null
 * } | undefined} surface
 * @param {{ surfaceKey?: string }} [options]
 */
function fromDraftSurface(surface, options = {}) {
  if (!surface) {
    return { available: false, status: "unsupported", reason: "No draft surface is mapped for this action." };
  }

  if (!surface.available) {
    return {
      available: false,
      status: /already recorded/i.test(surface.missingReason ?? "") ? "completed" : "blocked",
      reason: surface.missingReason ?? "This surface is not available yet.",
      surfaceKey: options.surfaceKey ?? surface.key
    };
  }

  return {
    available: true,
    status: "available",
    reason: null,
    surfaceKey: options.surfaceKey ?? surface.key
  };
}

/**
 * @param {{
 *   definition: ReturnType<typeof listActionCatalog>[number],
 *   draftSurfaces: Map<string, ReturnType<typeof buildMotionDraftView>["surfaces"][number]>,
 *   brief: NonNullable<ReturnType<typeof buildMotionProspectView>["writingBrief"]>
 * }} context
 * @param {{ available: boolean, status: string, reason: string | null, surfaceKey?: string }} availability
 */
function resolveDraftSurface(context, availability) {
  if (!availability.surfaceKey) {
    return null;
  }

  const surface = context.draftSurfaces.get(availability.surfaceKey);
  return surface
    ? {
        key: surface.key,
        stage: surface.stage,
        channel: surface.channel,
        available: surface.available,
        missingReason: surface.missingReason
      }
    : null;
}

/**
 * @param {NonNullable<ReturnType<typeof buildMotionProspectView>["writingBrief"]>} brief
 */
function resolveDirectMessageSurface(brief) {
  if (brief.prospect.touches.some((touch) => touch.direction === "inbound")) {
    return "inbound_reply";
  }

  if (brief.prospect.touches.some((touch) => touch.surface === "post_accept_message" || touch.surface === "follow_up_direct_message" || touch.surface === "in_mail_message")) {
    return "follow_up_direct_message";
  }

  if (hasAcceptedConnection(brief.prospect.touches)) {
    return "post_accept_message";
  }

  return null;
}

/**
 * @param {Array<{ surface: string, outcome: string }>} touches
 */
function hasAcceptedConnection(touches) {
  return touches.some((touch) => touch.surface === "connection_request" && touch.outcome === "accepted");
}

/**
 * @param {Array<{ surface: string }>} touches
 * @param {string} surface
 */
function hasSurface(touches, surface) {
  return touches.some((touch) => touch.surface === surface);
}

/**
 * @param {Array<{ surface: string, outcome: string }>} touches
 * @param {string} surface
 */
function hasNonBlockedSurface(touches, surface) {
  return touches.some((touch) => touch.surface === surface && touch.outcome !== "blocked");
}

/**
 * @param {Array<{ surface: string, outcome: string }>} touches
 * @param {string} surface
 * @param {string} outcome
 */
function countSurfaceOutcome(touches, surface, outcome) {
  return touches.filter((touch) => touch.surface === surface && touch.outcome === outcome).length;
}

/**
 * @param {NonNullable<ReturnType<typeof buildMotionProspectView>["writingBrief"]>} brief
 * @param {string} actionKey
 */
function isRecommendedAction(brief, actionKey) {
  if (actionKey === "profile_view") {
    return brief.prospect.openingPlan.preflightActions.some((action) => /view the prospect profile/i.test(action));
  }

  if (actionKey === "create_post_comment") {
    return brief.prospect.openingPlan.preflightActions.some((action) => /recent relevant linkedin post/i.test(action));
  }

  if (actionKey === "connection_request") {
    return brief.prospect.cadenceState.currentStep === "connection-request";
  }

  if (actionKey === "send_email") {
    return brief.prospect.openingPlan.fallbackChannel === "email";
  }

  return brief.prospect.openingPlan.primaryChannel?.replace(/-/g, "_") === actionKey;
}

/**
 * @param {ReturnType<typeof buildMotionActionView>} actionView
 * @param {ReturnType<typeof buildMotionActionView>["actions"][number]} action
 */
function buildExecutionSteps(actionView, action) {
  const steps = [
    "Resolve the pinned company identity first and keep the same execution user or browser profile for the whole engagement."
  ];

  if (action.platform === "linkedin" || action.platform === "email") {
    const capability = action.platform === "linkedin" ? "linkedin" : "gmail";
    steps.push(`Pull the canonical execution plan with exo companies execution show ${actionView.company.id} --capability ${capability} --json before you touch the live surface.`);
  }

  if (action.platform === "linkedin") {
    steps.push("Use the native Chrome browser harness in this runtime before any fallback browser tool.");
  }

  if (action.draftSurface) {
    steps.push(`Pull the stored drafting context with ${`exo motion draft-brief ${actionView.motion.id} --prospect ${actionView.prospect.prospectId} --surface ${action.draftSurface.key} --json`}.`);
    steps.push("Have the chat write the copy from the stored context. Do not send from Exo.");
  }

  switch (action.key) {
    case "profile_view":
      steps.push("Open the stored LinkedIn profile and verify that the right identity is active before you move on.");
      break;
    case "like_post":
    case "share_post":
    case "create_post_comment":
      steps.push("Use the stored recent-post signal as the target context. If the post no longer looks fresh or relevant, stop instead of forcing the action.");
      break;
    case "create_comment_comment":
    case "create_comment_reaction":
      steps.push("Stay inside the existing public thread. Do not create thread context that is not already there.");
      break;
    case "connection_request":
      steps.push("Keep the action low-friction. The goal is acceptance, not a meeting ask.");
      break;
    case "send_direct_message":
      steps.push("Match the actual conversation stage: first DM after acceptance, follow-up DM, or inbound reply.");
      break;
    case "send_email":
      steps.push("Treat email as the governed fallback or parallel channel only when the stored address is actually present.");
      break;
    case "in_mail_message":
      steps.push("Confirm live entitlement in the browser before using InMail. Exo only governs the context, not the entitlement.");
      break;
    default:
      break;
  }

  steps.push("After the action actually happens, write back the real touch or warmup event into Exo immediately.");
  return steps;
}

/**
 * @param {NonNullable<ReturnType<typeof buildMotionProspectView>["writingBrief"]>} brief
 * @param {ReturnType<typeof buildMotionActionView>["actions"][number]} action
 */
function buildContextualHints(brief, action) {
  /** @type {string[]} */
  const hints = [];
  const blockedFollowCount = countSurfaceOutcome(brief.prospect.touches, "follow", "blocked");

  if (action.key === "connection_request" && blockedFollowCount > 0) {
    hints.push(
      blockedFollowCount === 1
        ? "A blocked Follow attempt is already recorded for this prospect. Do not spend more time on Follow; go straight to the connection-request path."
        : `${blockedFollowCount} blocked Follow attempts are already recorded for this prospect. Treat Follow as spent and go straight to the connection-request path.`
    );
  }

  if (action.key === "follow" && blockedFollowCount > 0) {
    hints.push("LinkedIn already rejected Follow for this prospect. Do not keep retrying it as a warmup unless the platform state clearly changes.");
  }

  if (action.key === "connection_request" && brief.prospect.profileViewedAt) {
    hints.push("Profile view is already recorded in Exo. Do not repeat the view step unless you need to re-confirm identity state in the browser.");
  }

  if (action.platform === "linkedin" && !brief.prospect.email) {
    hints.push("No verified direct-email fallback is stored yet, so LinkedIn is still the only ready direct channel for this prospect.");
  }

  if ((action.key === "like_post" || action.key === "create_post_comment" || action.key === "share_post") && !brief.recentPost.engageable) {
    hints.push("The stored recent-post context is not currently strong enough for a legitimate warmup. Skip the public engagement move instead of forcing it.");
  }

  return hints;
}

/**
 * @param {ReturnType<typeof buildMotionActionView>} actionView
 * @param {ReturnType<typeof buildMotionActionView>["actions"][number]} action
 */
function buildWritebackCommand(actionView, action) {
  const surface = deriveWritebackSurface(action);
  return `exo companies touches add ${actionView.company.id} --motion ${actionView.motion.id} --prospect ${actionView.prospect.prospectId} --surface ${surface} --direction outbound --outcome sent --occurred-at <iso-datetime> --summary "Describe what actually happened" --json`;
}

/**
 * @param {ReturnType<typeof buildMotionActionView>["actions"][number]} action
 */
function deriveWritebackSurface(action) {
  if (action.draftSurface?.key) {
    return action.draftSurface.key;
  }

  switch (action.key) {
    case "profile_view":
    case "follow":
    case "unfollow":
    case "like_post":
    case "unlike_post":
    case "share_post":
    case "in_mail_message":
    case "withdraw_connection":
    case "accept_connection":
    case "decline_connection":
    case "create_comment_reaction":
    case "voicemail_outreach":
    case "video_outreach":
      return action.key;
    default:
      return "connection_request";
  }
}

/**
 * @param {unknown | null} rawCompany
 */
function buildExecutionIdentity(rawCompany) {
  const userAssignment = rawCompany && typeof rawCompany === "object" ? rawCompany.engagementUserAssignment : null;
  const assignment = rawCompany && typeof rawCompany === "object" ? rawCompany.engagementProfileAssignment : null;

  if (userAssignment) {
    return {
      status: "pinned-user",
      message: `Pinned to user ${userAssignment.label}. Resolve the needed account by capability before acting.`,
      label: userAssignment.label,
      userId: userAssignment.userId,
      profileId: assignment?.profileId ?? null,
      browser: assignment?.browser ?? null,
      profileDirectory: assignment?.profileDirectory ?? null
    };
  }

  if (!assignment) {
    return {
      status: "unassigned",
      message: "No sticky company profile is pinned yet. Resolve or assign one before live browser work.",
      label: null,
      userId: null,
      profileId: null,
      browser: null,
      profileDirectory: null
    };
  }

  return {
    status: "pinned",
    message: `Pinned to ${assignment.label} on ${assignment.browser} ${assignment.profileDirectory}.`,
    label: assignment.label,
    userId: null,
    profileId: assignment.profileId,
    browser: assignment.browser,
    profileDirectory: assignment.profileDirectory
  };
}

/**
 * @param {ReturnType<typeof buildMotionActionView>["actions"][number]} left
 * @param {ReturnType<typeof buildMotionActionView>["actions"][number]} right
 */
function compareActionState(left, right) {
  if (left.recommended !== right.recommended) {
    return left.recommended ? -1 : 1;
  }

  if (left.available !== right.available) {
    return left.available ? -1 : 1;
  }

  return left.key.localeCompare(right.key);
}
