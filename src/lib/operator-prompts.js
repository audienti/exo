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
  if (item.source.type === "inbound_review") {
    switch (item.source.kind) {
      case "needs_decision":
        return `${item.prospect.name} sent you an inbound LinkedIn connection request. Accept or decline?`;
      case "needs_status_reconciliation":
        return `${item.prospect.name}'s inbound connection request left the pending list. Was it accepted, declined, or resolved another way?`;
      case "stale_withdraw_review":
        return `${item.prospect.name}'s pending connection request is stale. Withdraw it or keep it pending?`;
      case "needs_reply":
        return `${item.prospect.name} replied on ${item.company.name}. Reply now?`;
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
  const actorName = item.prospect?.name ?? item.actorName ?? "This person";

  switch (item.kind) {
    case "connection_request_received":
      return `${actorName} sent you an inbound LinkedIn connection request. Accept or decline?`;
    case "connection_request_received_no_longer_pending":
      return `${actorName}'s inbound connection request left the pending list. Was it accepted, declined, or resolved another way?`;
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
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
