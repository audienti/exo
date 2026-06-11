// @ts-check

/**
 * @param {{
 *   source: { type: string, kind: string },
 *   prospect: { name: string, title: string },
 *   company: { name: string },
 *   recommendedAction: string
 * }} item
 * @returns {string | null}
 */
export function buildOperatorPromptFromDailyItem(item) {
  if (item.source.type === "packet_review") {
    const packetLabel = item.context?.packetLabel ?? item.source.kind?.replaceAll("_", " ") ?? "packet";
    const subject = item.prospect.id === item.source.packetId
      ? item.company.name
      : `${item.prospect.name} at ${item.company.name}`;
    return `Review the ${packetLabel.toLowerCase()} packet for ${subject}: accept, amend, or return?`;
  }

  if (item.source.type === "inbound_review") {
    switch (item.source.kind) {
      case "needs_claim":
        return `${item.prospect.name} sent you an inbound LinkedIn connection request. Claim them into transition backlog or leave them in global intake?`;
      case "needs_decision":
        return `${item.prospect.name} sent you an inbound LinkedIn connection request. Accept or decline?`;
      case "needs_status_reconciliation":
        return `${item.prospect.name}'s inbound connection request left the pending list. Was it accepted, declined, or resolved another way?`;
      case "needs_reply":
        return `${item.prospect.name} replied on ${item.company.name}. Reply now?`;
      case "ready_for_reply":
        return `Review the drafted reply to ${item.prospect.name} on ${item.company.name} now?`;
      case "ready_for_post_accept":
        return `${item.prospect.name} accepted your connection request. Send the first follow-up message now or wait?`;
      default:
        return null;
    }
  }

  return null;
}

/**
 * @param {{
 *   kind: string,
 *   company: { companyName: string },
 *   prospect: { name: string }
 * }} action
 * @returns {string | null}
 */
export function buildOperatorPromptFromExecutionAction(action) {
  switch (action.kind) {
    case "execute_first_touch":
    case "parallel_same_account_first_touch":
    case "parallel_motion_first_touch":
      return `${action.prospect.name} at ${action.company.companyName} is ready for the next touch. Do you want to do it now?`;
    case "wait_for_connection_response":
      return `${action.prospect.name} at ${action.company.companyName} is waiting on a reply. Hold the branch or move to a support action?`;
    case "post_accept_message":
      return `${action.prospect.name} at ${action.company.companyName} accepted the connection. Send the first follow-up message now?`;
    case "parallel_contact_enrichment":
    case "parallel_same_account_reserve_enrichment":
      return `${action.prospect.name} at ${action.company.companyName} is waiting on a reply. Do you want to strengthen the fallback path in parallel?`;
    case "parallel_motion_inventory":
      return `${action.prospect.name} at ${action.company.companyName} is waiting on a reply. Do you want to build more ready branches while it waits?`;
    default:
      return null;
  }
}

/**
 * @param {{
 *   kind: string,
 *   actorName?: string | null,
 *   prospect?: { name: string, title: string } | null,
 *   recommendedAction: string
 * }} item
 * @returns {string | null}
 */
export function buildOperatorPromptFromInboxItem(item) {
  if (
    item.status === "queued"
    || item.status === "resolved"
    || item.status === "agent-draft"
    || item.status === "global-intake"
    || item.status === "claimed-elsewhere"
    || item.reviewState === "needs_claim"
    || item.reviewState === "claimed_elsewhere"
  ) {
    return null;
  }
  const actorName = item.prospect?.name ?? item.actorName ?? "This person";

  if (item.reviewState === "ready_for_reply") {
    return `Review the drafted reply to ${actorName} now?`;
  }

  switch (item.kind) {
    case "connection_request_received":
      return `${actorName} sent you an inbound LinkedIn connection request. Accept or decline?`;
    case "connection_request_received_no_longer_pending":
      return `${actorName}'s inbound connection request left the pending list. Was it accepted, declined, or resolved another way?`;
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
      if (item.messageContext === "first_inbound") {
        return `${actorName} sent you a private message. Reply or ignore?`;
      }
      return `${actorName} replied. Reply now?`;
    case "thread_updated":
    case "email_thread_updated":
      return `${actorName}'s thread changed. Reply, note the change, or ignore it?`;
    case "connection_request_accepted":
      return `${actorName} accepted your connection request. Send the first follow-up message now?`;
    default:
      return null;
  }
}
