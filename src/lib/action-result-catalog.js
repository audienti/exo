// @ts-check

/**
 * The governed outcome vocabulary for canonical actions.
 *
 * This is intentionally narrower than the touch-outcome enum. It models the
 * operator-visible result keys Exo should accept on the public action-result
 * surface, then maps them back onto cadence / touch / inbound reconciliation
 * behavior.
 */

const DM_SURFACES = ["post_accept_message", "follow_up_direct_message", "inbound_reply"];

const ACTION_RESULT_CATALOG = {
  connection_request: [
    {
      key: "sent",
      label: "Sent",
      summary: "Record that the connection request was actually sent.",
      defaultSurface: "connection_request",
      touchDirection: "outbound",
      touchOutcome: "sent",
      cadenceStep: "connection-request",
      defaultNextAction: "Wait for acceptance or reply before escalating the branch.",
      markDraftSent: true,
    },
  ],
  profile_view: [
    {
      key: "sent",
      label: "Viewed",
      summary: "Record that the profile was opened and inspected.",
      defaultSurface: "profile_view",
      touchDirection: "outbound",
      touchOutcome: "sent",
    },
  ],
  follow: [
    {
      key: "sent",
      label: "Followed",
      summary: "Record that the profile follow was performed.",
      defaultSurface: "follow",
      touchDirection: "outbound",
      touchOutcome: "sent",
    },
  ],
  unfollow: [
    {
      key: "sent",
      label: "Unfollowed",
      summary: "Record that the prior follow was removed.",
      defaultSurface: "unfollow",
      touchDirection: "outbound",
      touchOutcome: "sent",
    },
  ],
  send_direct_message: [
    {
      key: "sent",
      label: "Sent",
      summary: "Record that the LinkedIn private message was actually sent.",
      allowedSurfaces: DM_SURFACES,
      touchDirection: "outbound",
      touchOutcome: "sent",
      cadenceStep: "direct-message",
      defaultNextAction: "Wait for a LinkedIn reply before forcing a new branch.",
      markDraftSent: true,
    },
    {
      key: "unavailable",
      label: "Unavailable",
      summary: "Record that the governed private-message thread could not accept a reply.",
      allowedSurfaces: DM_SURFACES,
      touchDirection: "outbound",
      touchOutcome: "blocked",
      cadenceStep: "direct-message",
      defaultNextAction: null,
      markDraftDiscarded: true,
    },
  ],
  in_mail_message: [
    {
      key: "sent",
      label: "Sent",
      summary: "Record that the InMail was actually sent.",
      defaultSurface: "in_mail_message",
      touchDirection: "outbound",
      touchOutcome: "sent",
      cadenceStep: "inmail",
      defaultNextAction: "Wait for an InMail reply before escalating.",
      markDraftSent: true,
    },
  ],
  send_email: [
    {
      key: "sent",
      label: "Sent",
      summary: "Record that the email was actually sent.",
      defaultSurface: "email",
      touchDirection: "outbound",
      touchOutcome: "sent",
      cadenceStep: "value-add-email",
      defaultNextAction: "Wait for an email reply before changing channels again.",
      markDraftSent: true,
    },
  ],
  like_post: [
    {
      key: "sent",
      label: "Liked",
      summary: "Record that the post like was performed.",
      defaultSurface: "like_post",
      touchDirection: "outbound",
      touchOutcome: "sent",
    },
    {
      key: "unavailable",
      label: "Unavailable",
      summary: "Record that the stored post target was gone or unwritable before the like landed.",
      defaultSurface: "like_post",
      touchDirection: "outbound",
      touchOutcome: "blocked",
    },
  ],
  unlike_post: [
    {
      key: "sent",
      label: "Unliked",
      summary: "Record that the prior like was removed.",
      defaultSurface: "unlike_post",
      touchDirection: "outbound",
      touchOutcome: "sent",
    },
  ],
  create_post_comment: [
    {
      key: "sent",
      label: "Sent",
      summary: "Record that the public post comment was posted.",
      defaultSurface: "public_comment",
      touchDirection: "outbound",
      touchOutcome: "sent",
      markDraftSent: true,
    },
    {
      key: "unavailable",
      label: "Unavailable",
      summary: "Record that the stored public post target was gone or unwritable before the comment could be posted.",
      defaultSurface: "public_comment",
      touchDirection: "outbound",
      touchOutcome: "blocked",
      markDraftDiscarded: true,
    },
  ],
  share_post: [
    {
      key: "sent",
      label: "Shared",
      summary: "Record that the post share was performed.",
      defaultSurface: "share_post",
      touchDirection: "outbound",
      touchOutcome: "sent",
    },
  ],
  create_comment_comment: [
    {
      key: "sent",
      label: "Sent",
      summary: "Record that the comment reply was posted.",
      defaultSurface: "comment_reply",
      touchDirection: "outbound",
      touchOutcome: "sent",
      markDraftSent: true,
    },
    {
      key: "unavailable",
      label: "Unavailable",
      summary: "Record that the stored comment thread was gone or unwritable before the reply could be posted.",
      defaultSurface: "comment_reply",
      touchDirection: "outbound",
      touchOutcome: "blocked",
      markDraftDiscarded: true,
    },
  ],
  create_comment_reaction: [
    {
      key: "sent",
      label: "Reacted",
      summary: "Record that the comment reaction was performed.",
      defaultSurface: "create_comment_reaction",
      touchDirection: "outbound",
      touchOutcome: "sent",
    },
    {
      key: "unavailable",
      label: "Unavailable",
      summary: "Record that the stored comment target was gone or unwritable before the reaction landed.",
      defaultSurface: "create_comment_reaction",
      touchDirection: "outbound",
      touchOutcome: "blocked",
    },
  ],
  withdraw_connection: [
    {
      key: "sent",
      label: "Withdrew",
      summary: "Record that the outstanding connection request was withdrawn.",
      defaultSurface: "withdraw_connection",
      touchDirection: "outbound",
      touchOutcome: "sent",
      cadenceStep: "done",
      defaultNextAction: null,
      inboundTransitionKind: "connection_request_withdrawn",
    },
  ],
  accept_connection: [
    {
      key: "accepted",
      label: "Accepted",
      summary: "Record that the inbound connection request was accepted.",
      defaultSurface: "accept_connection",
      touchDirection: "inbound",
      touchOutcome: "accepted",
      cadenceStep: "direct-message",
      defaultNextAction: "Connection accepted — send the first post-accept message.",
      requiresObservation: true,
      inboundTransitionKind: "connection_request_accepted",
    },
  ],
  decline_connection: [
    {
      key: "declined",
      label: "Declined",
      summary: "Record that the inbound connection request was declined.",
      defaultSurface: "decline_connection",
      touchDirection: "inbound",
      touchOutcome: "blocked",
      cadenceStep: "done",
      defaultNextAction: null,
      requiresObservation: true,
      inboundTransitionKind: "connection_request_declined",
    },
  ],
  voicemail_outreach: [
    {
      key: "sent",
      label: "Sent",
      summary: "Record that the voicemail outreach was completed.",
      defaultSurface: "voicemail_outreach",
      touchDirection: "outbound",
      touchOutcome: "sent",
    },
  ],
  video_outreach: [
    {
      key: "sent",
      label: "Sent",
      summary: "Record that the personalized video outreach was completed.",
      defaultSurface: "video_outreach",
      touchDirection: "outbound",
      touchOutcome: "sent",
    },
  ],
};

/**
 * @param {string} actionKey
 */
export function listSupportedActionResults(actionKey) {
  const normalizedActionKey = normalizeKey(actionKey);
  return (ACTION_RESULT_CATALOG[normalizedActionKey] ?? []).map(cloneResultDefinition);
}

/**
 * @param {string} actionKey
 * @param {string} resultKey
 */
export function findSupportedActionResult(actionKey, resultKey) {
  const normalizedActionKey = normalizeKey(actionKey);
  const normalizedResultKey = normalizeKey(resultKey);
  const result = (ACTION_RESULT_CATALOG[normalizedActionKey] ?? []).find((entry) => entry.key === normalizedResultKey);
  return result ? cloneResultDefinition(result) : null;
}

/**
 * @param {{
 *   surface?: string | null | undefined,
 *   direction?: string | null | undefined,
 *   outcome?: string | null | undefined,
 *   observationId?: string | null | undefined,
 * }} input
 */
export function findActionResultForTouch(input) {
  const surface = normalizeKey(input.surface);
  const direction = normalizeKey(input.direction);
  const outcome = normalizeKey(input.outcome);

  if (!surface || !direction || !outcome) {
    return null;
  }

  for (const [actionKey, results] of Object.entries(ACTION_RESULT_CATALOG)) {
    for (const entry of results) {
      const surfaceMatches = entry.defaultSurface === surface || (entry.allowedSurfaces ?? []).includes(surface);
      if (!surfaceMatches) {
        continue;
      }

      if (entry.touchDirection !== direction || entry.touchOutcome !== outcome) {
        continue;
      }

      if (entry.requiresObservation && !input.observationId) {
        continue;
      }

      return {
        actionKey,
        resultKey: entry.key,
        surface,
      };
    }
  }

  return null;
}

/**
 * @param {string} value
 */
export function normalizeActionResultKey(value) {
  return normalizeKey(value);
}

/**
 * @param {string} value
 */
function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * @param {typeof ACTION_RESULT_CATALOG[string][number]} entry
 */
function cloneResultDefinition(entry) {
  return {
    ...entry,
    allowedSurfaces: [...(entry.allowedSurfaces ?? [])],
  };
}
