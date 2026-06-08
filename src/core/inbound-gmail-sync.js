// @ts-check

import { gmailInboundSyncCaptureSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

/**
 * @param {unknown} rawUser
 * @param {{
 *   accountId?: string | null,
 *   capture: unknown
 * }} input
 */
export function buildGmailInboundSyncPayload(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const capture = gmailInboundSyncCaptureSchema.parse(normalizeGmailInboundSyncCapture(input.capture));
  const account = resolveGmailAccount(user, input.accountId ?? null);

  if (capture.status === "success" && capture.error) {
    throw new Error("Successful Gmail captures cannot include an error.");
  }

  if (capture.status !== "success" && !capture.error) {
    throw new Error(`Gmail capture needs an error detail for ${capture.status}.`);
  }

  if (capture.status === "failed" && capture.threads.length) {
    throw new Error("Failed Gmail captures cannot include threads.");
  }

  const derivedItemCount = capture.status === "failed"
    ? capture.itemCount
    : capture.itemCount ?? capture.threads.length;
  if (derivedItemCount !== null && derivedItemCount < capture.threads.length) {
    throw new Error(
      `Gmail capture reported ${derivedItemCount} items but included ${capture.threads.length} threads.`
    );
  }

  if (capture.status === "failed" && derivedItemCount && derivedItemCount > 0) {
    throw new Error("Failed Gmail captures cannot report positive item counts.");
  }

  if (capture.status !== "failed") {
    const missingMessages = capture.threads.filter((thread) => (thread.messages ?? []).length === 0);
    if (missingMessages.length) {
      const threadList = missingMessages.map((thread) => thread.threadId).join(", ");
      throw new Error(
        `Gmail capture must include structured messages for every returned thread. Missing messages for: ${threadList}`
      );
    }

    const incompleteThreads = capture.threads.filter((thread) => thread.messagesCompleteness !== "complete");
    if (incompleteThreads.length) {
      const threadList = incompleteThreads.map((thread) => thread.threadId).join(", ");
      throw new Error(
        `Gmail capture must include complete structured thread history for every returned thread. Incomplete threads: ${threadList}`
      );
    }
  }

  const newestThreadAt = capture.threads
    .map((thread) => thread.observedAt)
    .sort()
    .at(-1) ?? null;
  const observedAt = newestIsoDatetime(capture.checkedAt, newestThreadAt);
  if (capture.status !== "failed" && derivedItemCount && derivedItemCount > 0 && !observedAt) {
    throw new Error("Gmail capture needs checkedAt or thread observedAt when items were found.");
  }

  const observations = capture.threads.map((thread) => ({
    kind: thread.kind,
    observedAt: thread.observedAt,
    summary: thread.summary,
    externalId: thread.threadId,
    actorName: thread.fromName,
    actorHandle: thread.fromEmail,
    actorTitle: thread.actorTitle,
    actorCompanyName: thread.actorCompanyName,
    threadUrl: thread.threadUrl,
    sourceUrl: thread.sourceUrl ?? thread.threadUrl,
    subject: thread.subject,
    motionId: thread.motionId,
    companyId: thread.companyId,
    prospectId: thread.prospectId,
    notes: buildThreadNotes(thread.notes),
    messages: thread.messages
  }));

  return {
    capture: {
      mode: capture.mode,
      status: capture.status,
      checkedAt: capture.checkedAt,
      itemCount: derivedItemCount,
      error: capture.error,
      threadCount: capture.threads.length
    },
    payload: {
      mode: capture.mode,
      accounts: [
        {
          accountId: account.id,
          surfaces: [
            {
              surfaceKey: "gmail-inbox-threads",
              status: capture.status,
              observedAt,
              itemCount: derivedItemCount,
              error: capture.error,
              observations
            }
          ]
        }
      ]
    }
  };
}

/**
 * Accept Gmail connector/browser captures that use local datetimes without an
 * explicit offset and coerce them into strict ISO strings before validation.
 *
 * @param {unknown} rawCapture
 */
export function normalizeGmailInboundSyncCapture(rawCapture) {
  const checkedAt = normalizeNullableIsoDatetime(rawCapture?.checkedAt);
  const threads = Array.isArray(rawCapture?.threads)
    ? rawCapture.threads.map((thread) => normalizeGmailThreadCapture(thread, checkedAt))
    : [];

  return {
    ...(rawCapture && typeof rawCapture === "object" ? rawCapture : {}),
    checkedAt,
    threads,
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {string | null} accountId
 */
export function resolveGmailAccount(user, accountId) {
  if (accountId) {
    const account = user.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      throw new Error(`User account not found: ${accountId}`);
    }

    if (account.capability !== "gmail") {
      throw new Error(`Account ${accountId} is not a Gmail account.`);
    }

    return account;
  }

  const gmailAccounts = user.accounts.filter((candidate) => candidate.capability === "gmail");
  if (gmailAccounts.length === 1) {
    return gmailAccounts[0];
  }

  if (!gmailAccounts.length) {
    throw new Error(`User ${user.label} does not have a Gmail account.`);
  }

  throw new Error(`User ${user.label} has multiple Gmail accounts. Pass --account explicitly.`);
}

/**
 * @param {string | null} notes
 */
function buildThreadNotes(notes) {
  if (!notes) {
    return null;
  }
  const normalized = notes.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string | null} left
 * @param {string | null} right
 */
function newestIsoDatetime(left, right) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left >= right ? left : right;
}

/**
 * @param {any} thread
 * @param {string | null} checkedAt
 */
function normalizeGmailThreadCapture(thread, checkedAt) {
  const observedAt = normalizeNullableIsoDatetime(thread?.observedAt) ?? checkedAt ?? thread?.observedAt ?? null;
  const messages = Array.isArray(thread?.messages)
    ? thread.messages.map((message) => normalizeGmailThreadMessage(message))
    : [];

  return {
    ...(thread && typeof thread === "object" ? thread : {}),
    observedAt,
    messages,
  };
}

/** @param {any} message */
function normalizeGmailThreadMessage(message) {
  return {
    ...(message && typeof message === "object" ? message : {}),
    sentAt: normalizeNullableIsoDatetime(message?.sentAt),
  };
}

/** @param {unknown} value */
function normalizeNullableIsoDatetime(value) {
  if (typeof value !== "string" || !value.trim().length) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}
