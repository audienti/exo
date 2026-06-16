// @ts-check

const OUTBOUND_COPY_ACTIONS = new Set([
  "send_email",
  "send_direct_message",
  "send_connection_request",
  "in_mail_message",
  "create_post_comment",
  "create_comment_comment",
]);

const OUTBOUND_COPY_SURFACES = new Set([
  "email",
  "connection_request",
  "follow_up_direct_message",
  "post_accept_message",
  "inbound_reply",
  "in_mail_message",
  "public_comment",
  "comment_reply",
]);

/**
 * @param {any} task
 */
export function isOperatorControlledSendTask(task) {
  if (task?.kind !== "send_message") return false;
  return task?.authoredBy === "operator"
    || task?.editedByOperator === true
    || task?.approvedByOperator === true;
}

/**
 * Verify mode exists to stop unreviewed outbound copy, not to stop connector
 * retrieval, maintenance, or deterministic no-copy actions.
 *
 * @param {any} task
 */
export function requiresSendVerification(task) {
  if (task?.kind !== "send_message") return false;
  if (isOperatorControlledSendTask(task)) return false;
  const action = normalizeKey(task?.action);
  const surface = normalizeKey(task?.surface);
  return OUTBOUND_COPY_ACTIONS.has(action) || OUTBOUND_COPY_SURFACES.has(surface);
}

/**
 * @param {any} task
 */
export function isAutonomousLiveSendAllowedInVerifyMode(task) {
  return task?.kind === "send_message" && !requiresSendVerification(task);
}

/** @param {unknown} value */
function normalizeKey(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : "";
}
