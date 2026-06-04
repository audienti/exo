// @ts-check

import { fileURLToPath } from "node:url";

export const LINKEDIN_RETRIEVAL_TOOL_VERSION = "exo-linkedin-retrieval-tool-v1";
export const LINKEDIN_RETRIEVAL_TOOL_MODULE_PATH = fileURLToPath(import.meta.url);

export function buildLinkedinRetrievalToolDescriptor() {
  return {
    version: LINKEDIN_RETRIEVAL_TOOL_VERSION,
    modulePath: LINKEDIN_RETRIEVAL_TOOL_MODULE_PATH,
    purpose: "Normalize LinkedIn retrieval output from governed network bodies or bounded page snapshots into Exo-ready invitation identities.",
    runtime: "network_body_normalizer",
    supportedSurfaces: [
      "sentInvitations",
      "receivedInvitations",
    ],
    usage: [
      "Use this tool when LinkedIn invitation manager traffic is available from the browser runtime.",
      "Prefer these extractors before inventing a fresh invitation parser in task prompts.",
      "This tool normalizes raw retrieval evidence into invitation identities. Exo still owns capture policy, writeback, and verification."
    ],
    entrypoints: {
      extractReceivedInvitationsFromNetworkBodies: "extractReceivedInvitationsFromNetworkBodies",
      extractSentInvitationsFromNetworkBodies: "extractSentInvitationsFromNetworkBodies",
    },
    outputs: {
      receivedInvitations: "Array<{ invitationId, validationToken, profilePlatformId, username, profileUrl, firstName, lastName, displayName, actionsSupported }>",
      sentInvitations: "Array<{ profilePlatformId, inviteeMemberId, username, profileUrl, inviterActionType, firstName, lastName, invitationId }>",
    },
  };
}

/**
 * @param {unknown[]} bodies
 */
export function extractReceivedInvitationsFromNetworkBodies(bodies) {
  const rows = Array.isArray(bodies)
    ? bodies.flatMap((body) => extractReceivedInvitationsFromBody(body))
    : [];

  /** @type {Map<string, any>} */
  const deduped = new Map();
  for (const row of rows) {
    const key = normalizeNullableString(row.invitationId) ?? `${normalizeNullableString(row.username) ?? "unknown"}|${normalizeNullableString(row.profilePlatformId) ?? "unknown"}`;
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }
  return Array.from(deduped.values());
}

/**
 * @param {unknown[]} bodies
 */
export function extractSentInvitationsFromNetworkBodies(bodies) {
  const rows = Array.isArray(bodies)
    ? bodies.flatMap((body) => extractSentInvitationsFromBody(body))
    : [];

  /** @type {Map<string, any>} */
  const deduped = new Map();
  for (const row of rows) {
    const key = [
      normalizeNullableString(row.username) ?? "",
      normalizeNullableString(row.profilePlatformId) ?? "",
      normalizeNullableString(row.invitationId) ?? "",
    ].join("|");
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }
  return Array.from(deduped.values());
}

/**
 * @param {unknown} body
 */
function extractReceivedInvitationsFromBody(body) {
  const text = normalizeEmbeddedJsonText(body);
  if (!text) return [];

  /** @type {Map<string, any>} */
  const grouped = new Map();
  const actionPattern = /"inviteeActionType":"(InviteeActionType_[^"]+)"/g;

  for (const match of text.matchAll(actionPattern)) {
    const inviteeActionType = normalizeNullableString(match[1]);
    if (!inviteeActionType) continue;

    const start = Math.max(0, (match.index ?? 0) - 1400);
    const end = Math.min(text.length, (match.index ?? 0) + 2800);
    const windowText = text.slice(start, end);

    const invitationId = firstCapture(windowText, /"invitationUrn":\{"invitationId":"([^"]+)"/);
    const validationToken = firstCapture(windowText, /"validationToken":"([^"]+)"/);
    const firstName = firstCapture(windowText, /"firstName":"([^"]+)"/);
    const lastName = firstCapture(windowText, /"lastName":"([^"]+)"/);
    const profilePlatformId = firstCapture(windowText, /"profileUrn":\{"profileId":"([^"]+)"/);
    const profileUrl = canonicalLinkedinProfileUrl(extractProfileUrlFromText(windowText));
    const username = extractUsernameFromProfileUrl(profileUrl);

    if (!invitationId || !validationToken || !firstName || !lastName) {
      continue;
    }

    const existing = grouped.get(invitationId) ?? {
      invitationId,
      validationToken,
      profilePlatformId: profilePlatformId ?? null,
      username: username ?? null,
      profileUrl: profileUrl ?? null,
      firstName,
      lastName,
      displayName: buildDisplayName(firstName, lastName),
      actionsSupported: [],
    };

    existing.actionsSupported = dedupeStrings([...existing.actionsSupported, inviteeActionType]);
    if (!existing.profilePlatformId && profilePlatformId) existing.profilePlatformId = profilePlatformId;
    if (!existing.username && username) existing.username = username;
    if (!existing.profileUrl && profileUrl) existing.profileUrl = profileUrl;

    grouped.set(invitationId, existing);
  }

  return Array.from(grouped.values());
}

/**
 * @param {unknown} body
 */
function extractSentInvitationsFromBody(body) {
  const text = normalizeEmbeddedJsonText(body);
  if (!text) return [];

  /** @type {any[]} */
  const rows = [];
  const pattern = /"inviteeVanityName":"([^"]+)"/g;

  for (const match of text.matchAll(pattern)) {
    const vanity = normalizeNullableString(match[1]);
    if (!vanity) continue;

    const start = Math.max(0, (match.index ?? 0) - 2200);
    const end = Math.min(text.length, (match.index ?? 0) + 3200);
    const windowText = text.slice(start, end);

    const profilePlatformId = firstCapture(windowText, /"profileUrn":"([^"]+)"/);
    const inviteeMemberId = firstCapture(windowText, /"inviteeUrn":\{"memberId":"([^"]+)"/);
    const firstName = firstCapture(windowText, /"firstName":"([^"]+)"/);
    const lastName = firstCapture(windowText, /"lastName":"([^"]+)"/);
    const invitationId = firstCapture(windowText, /"invitationUrn":\{"invitationId":"([^"]+)"/);
    const inviterActionTypeRaw = firstCapture(windowText, /"inviterActionType":("[^"]+"|\d+)/);
    const inviterActionType = normalizeInviterActionType(inviterActionTypeRaw);

    if (!profilePlatformId) {
      continue;
    }

    const profileUrl = canonicalLinkedinProfileUrl(`https://www.linkedin.com/in/${vanity}/`);
    rows.push({
      profilePlatformId,
      inviteeMemberId: inviteeMemberId ?? null,
      username: extractUsernameFromProfileUrl(profileUrl) ?? vanity,
      profileUrl,
      inviterActionType: inviterActionType ?? null,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      invitationId: invitationId ?? null,
    });
  }

  return rows;
}

/**
 * @param {unknown} value
 */
function normalizeEmbeddedJsonText(value) {
  const text = String(value ?? "");
  if (!text.trim()) return "";
  return text
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll('\\"', '"');
}

/**
 * @param {string} text
 * @param {RegExp} pattern
 */
function firstCapture(text, pattern) {
  const match = text.match(pattern);
  return normalizeNullableString(match?.[1] ?? null);
}

/**
 * @param {string} text
 */
function extractProfileUrlFromText(text) {
  return firstCapture(text, /(https:\/\/www\.linkedin\.com\/in\/[^"\\\s]+\/?)/i);
}

/**
 * @param {string | null | undefined} url
 */
function canonicalLinkedinProfileUrl(url) {
  const value = normalizeNullableString(url);
  if (!value) return null;

  try {
    const parsed = new URL(value);
    const normalizedPath = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    return `https://www.linkedin.com${normalizedPath}`;
  } catch (_error) {
    return value;
  }
}

/**
 * @param {string | null | undefined} url
 */
function extractUsernameFromProfileUrl(url) {
  const value = normalizeNullableString(url);
  if (!value) return null;
  const match = value.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return normalizeNullableString(match?.[1] ?? null);
}

/**
 * @param {string | null | undefined} firstName
 * @param {string | null | undefined} lastName
 */
function buildDisplayName(firstName, lastName) {
  return [normalizeNullableString(firstName), normalizeNullableString(lastName)].filter(Boolean).join(" ") || null;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeInviterActionType(value) {
  const raw = normalizeNullableString(value);
  if (!raw) return null;
  if (raw.startsWith("\"") && raw.endsWith("\"")) {
    return normalizeNullableString(raw.slice(1, -1));
  }
  if (raw === "2") {
    return "InviterActionType_WITHDRAW";
  }
  return raw;
}

/**
 * @param {unknown[]} values
 */
function dedupeStrings(values) {
  return Array.from(new Set(
    values
      .map((value) => normalizeNullableString(value))
      .filter(Boolean),
  ));
}

/**
 * @param {unknown} value
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
