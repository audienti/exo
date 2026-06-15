// @ts-check

import { userSchema } from "../schema/user.js";

/**
 * Collapse duplicate Gmail mappings for the same mailbox onto one canonical
 * account. This keeps inbox truth anchored to the real Gmail connector path
 * even when the same mailbox is also discovered through Unipile.
 *
 * @param {unknown} rawUser
 * @param {{
 *   accounts?: import("../schema/user.js").userConnectedAccountSchema._type[] | null
 * }} [options]
 */
export function buildCanonicalGmailAccountSelection(rawUser, options = {}) {
  const user = userSchema.parse(rawUser);
  const scopedAccounts = Array.isArray(options.accounts) ? options.accounts : user.accounts;
  const gmailAccounts = scopedAccounts.filter((account) => account.capability === "gmail");
  const groupedAccounts = groupGmailAccountsByMailbox(gmailAccounts);
  const canonicalAccounts = [];
  const accountIdAliases = new Map();

  for (const group of groupedAccounts.values()) {
    const canonical = [...group].sort((left, right) => compareCanonicalGmailAccounts(user, left, right))[0] ?? null;
    if (!canonical) {
      continue;
    }

    canonicalAccounts.push(canonical);
    for (const account of group) {
      accountIdAliases.set(account.id, canonical.id);
    }
  }

  canonicalAccounts.sort((left, right) => {
    const handleCompare = normalizeMailboxIdentity(left).localeCompare(normalizeMailboxIdentity(right));
    if (handleCompare !== 0) {
      return handleCompare;
    }
    return left.id.localeCompare(right.id);
  });

  return {
    user,
    canonicalAccounts,
    accountIdAliases,
  };
}

/**
 * @param {unknown} rawUser
 * @param {string | null | undefined} accountId
 */
export function resolveCanonicalGmailAccountId(rawUser, accountId) {
  const normalizedAccountId = normalizeNullableString(accountId);
  if (!normalizedAccountId) {
    return null;
  }

  const { user, accountIdAliases } = buildCanonicalGmailAccountSelection(rawUser);
  const account = user.accounts.find((candidate) => candidate.id === normalizedAccountId) ?? null;
  if (!account || account.capability !== "gmail") {
    return normalizedAccountId;
  }

  return accountIdAliases.get(account.id) ?? account.id;
}

/**
 * @param {unknown} rawUser
 * @param {string | null | undefined} accountId
 */
export function resolveCanonicalGmailAccount(rawUser, accountId = null) {
  const { user, canonicalAccounts, accountIdAliases } = buildCanonicalGmailAccountSelection(rawUser);
  const normalizedAccountId = normalizeNullableString(accountId);
  if (normalizedAccountId) {
    const requested = user.accounts.find((candidate) => candidate.id === normalizedAccountId) ?? null;
    if (!requested) {
      throw new Error(`User account not found: ${normalizedAccountId}`);
    }
    if (requested.capability !== "gmail") {
      throw new Error(`Account ${normalizedAccountId} is not a Gmail account.`);
    }

    const canonicalId = accountIdAliases.get(requested.id) ?? requested.id;
    return canonicalAccounts.find((candidate) => candidate.id === canonicalId) ?? requested;
  }

  if (!canonicalAccounts.length) {
    throw new Error(`User ${user.label} does not have a Gmail account.`);
  }

  if (canonicalAccounts.length === 1) {
    return canonicalAccounts[0];
  }

  throw new Error(`User ${user.label} has multiple Gmail accounts. Pass --account explicitly.`);
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type[]} accounts
 */
function groupGmailAccountsByMailbox(accounts) {
  const grouped = new Map();
  for (const account of accounts) {
    const identity = normalizeMailboxIdentity(account);
    const existing = grouped.get(identity) ?? [];
    existing.push(account);
    grouped.set(identity, existing);
  }
  return grouped;
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} left
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} right
 */
function compareCanonicalGmailAccounts(user, left, right) {
  const leftHarness = resolveHarnessConnection(user, left);
  const rightHarness = resolveHarnessConnection(user, right);
  const leftGmailConnector = isNativeGmailHarness(left, leftHarness);
  const rightGmailConnector = isNativeGmailHarness(right, rightHarness);

  if (leftGmailConnector !== rightGmailConnector) {
    return leftGmailConnector ? -1 : 1;
  }

  const leftAvailable = isAvailableHarness(leftHarness);
  const rightAvailable = isAvailableHarness(rightHarness);
  if (leftAvailable !== rightAvailable) {
    return leftAvailable ? -1 : 1;
  }

  const leftExact = Boolean(normalizeNullableString(left.providerAccountId));
  const rightExact = Boolean(normalizeNullableString(right.providerAccountId));
  if (leftExact !== rightExact) {
    return leftExact ? -1 : 1;
  }

  if (left.preferred !== right.preferred) {
    return left.preferred ? -1 : 1;
  }

  if (left.sourceType !== right.sourceType) {
    return left.sourceType === "harness-connection" ? -1 : 1;
  }

  const leftConnector = normalizeNullableString(leftHarness?.connector) ?? "zzzz";
  const rightConnector = normalizeNullableString(rightHarness?.connector) ?? "zzzz";
  if (leftConnector !== rightConnector) {
    return leftConnector.localeCompare(rightConnector);
  }

  return left.id.localeCompare(right.id);
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function resolveHarnessConnection(user, account) {
  if (account.sourceType !== "harness-connection" || !account.harnessConnectionId) {
    return null;
  }
  return user.harnessConnections.find((candidate) => candidate.id === account.harnessConnectionId) ?? null;
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {import("../schema/user.js").userHarnessConnectionSchema._type | null} harnessConnection
 */
function isNativeGmailHarness(account, harnessConnection) {
  return account.sourceType === "harness-connection"
    && normalizeNullableString(harnessConnection?.connector)?.toLowerCase() === "gmail";
}

/** @param {import("../schema/user.js").userHarnessConnectionSchema._type | null} harnessConnection */
function isAvailableHarness(harnessConnection) {
  return normalizeNullableString(harnessConnection?.status)?.toLowerCase() === "available";
}

/**
 * @param {{ handle?: string | null, providerAccountId?: string | null, id?: string | null }} account
 */
function normalizeMailboxIdentity(account) {
  const handle = normalizeNullableString(account.handle)?.toLowerCase();
  if (handle) {
    return `handle:${handle}`;
  }

  const providerAccountId = normalizeNullableString(account.providerAccountId);
  if (providerAccountId) {
    return `provider:${providerAccountId}`;
  }

  return `account:${normalizeNullableString(account.id) ?? "unknown"}`;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
