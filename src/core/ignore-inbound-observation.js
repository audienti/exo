// @ts-check

import { disposeGmailThread } from "./dispose-gmail-thread.js";
import { addInboundIgnoreRule, matchesInboundIgnoreRule } from "./inbound-ignore-rules.js";
import { appendPolicyEvent } from "./policy-ledger.js";
import {
  deleteInboundObservationById,
  findInboundObservationById,
  findUserById,
  listInboundObservations,
  updateUser,
} from "../db/database.js";

/**
 * @param {{
 *   observationId: string,
 *   reason?: string | null,
 * }} input
 */
export async function ignoreInboundObservation(input) {
  const observation = findInboundObservationById(input.observationId);
  if (!observation) {
    throw new Error(`Inbound observation not found: ${input.observationId}`);
  }

  const rawUser = findUserById(observation.userId);
  if (!rawUser) {
    throw new Error(`User not found: ${observation.userId}`);
  }

  const ignoreReason = normalizeNullableString(input.reason)
    ?? "Operator rejected this inbound thread and wants future messages from the same sender ignored.";
  const sourceAccount = rawUser.accounts.find((account) => account.id === observation.accountId) ?? null;

  const { rule, updatedUser } = addInboundIgnoreRule(rawUser, {
    accountId: observation.accountId,
    capability: observation.capability,
    surfaceKey: observation.surfaceKey,
    actorHandle: observation.actorHandle,
    externalId: observation.externalId,
    threadUrl: observation.threadUrl,
    reason: ignoreReason,
  });
  const policyEvent = appendPolicyEvent("global", {
    kind: "ignore_identity",
    reason: ignoreReason,
    account: {
      providerAccountId: sourceAccount?.providerAccountId ?? null,
      capability: sourceAccount?.providerAccountId ? null : observation.capability,
      handle: sourceAccount?.providerAccountId ? null : sourceAccount?.handle ?? null,
    },
    person: {
      actorHandle: observation.actorHandle,
      actorLinkedinMemberId: observation.actorLinkedinMemberId,
      actorLinkedinPublicId: observation.actorLinkedinPublicId,
      actorProfileUrl: observation.actorProfileUrl,
      threadUrl: observation.threadUrl,
    },
    surface: null,
  });

  let mailboxDisposition = null;
  if (observation.capability === "gmail" && observation.surfaceKey === "gmail-inbox-threads") {
    mailboxDisposition = await disposeGmailThread({ observation });
  }

  updateUser(updatedUser);

  const matched = listInboundObservations({ userId: observation.userId })
    .filter((candidate) => matchesInboundIgnoreRule(rule, candidate));
  for (const candidate of matched) {
    deleteInboundObservationById(candidate.id);
  }

  return {
    rule,
    policyEvent,
    deletedObservationCount: matched.length,
    mailboxDisposition,
    message: buildIgnoreMessage(observation.actorName, observation.actorHandle, matched.length, mailboxDisposition),
  };
}

/**
 * @param {string | null | undefined} actorName
 * @param {string | null | undefined} actorHandle
 * @param {number} count
 * @param {{ status: string, detail: string | null } | null} mailboxDisposition
 */
function buildIgnoreMessage(actorName, actorHandle, count, mailboxDisposition) {
  const label = normalizeNullableString(actorName) ?? normalizeNullableString(actorHandle) ?? "that sender";
  const mailbox = mailboxDisposition
    ? mailboxDisposition.status === "already_missing"
      ? "Gmail thread was already gone."
      : "Gmail thread moved to trash."
    : "No mailbox action was needed.";
  return `Ignoring ${label} going forward. Removed ${count} stored observation${count === 1 ? "" : "s"}. ${mailbox}`;
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
