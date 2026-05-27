// @ts-check

import fs from "node:fs";

/**
 * The Exo action catalog mirrors the real action vocabulary already present in
 * Audienti. This is not a browser automation layer. It is the governed list of
 * GTM actions an agent can reason about, brief, and then write back after the
 * operator or agent actually performs them.
 */

export const ACTION_CATALOG = [
  {
    key: "connection_request",
    label: "Connect Request",
    summary: "Send a LinkedIn connection request, optionally with a short note.",
    platform: "linkedin",
    category: "private-outreach",
    executionActionType: "connect_request",
    rateLimitActionType: "connect_request",
    requiredCapability: "linkedin",
    entityRequirement: "profile",
    fields: ["text"],
    draftSurface: "connection_request",
    activityKeys: ["action.profile.connect_request_sent"],
    aliases: ["connect_request"],
    knowledgeRefs: defaultKnowledgeRefs("Connection Request", { key: "connection_request", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "connection_request", platform: "linkedin" })
  },
  {
    key: "profile_view",
    label: "View Profile",
    summary: "Open and inspect the prospect profile as a warmup or verification step before outreach.",
    platform: "linkedin",
    category: "warmup",
    executionActionType: "view_profile",
    rateLimitActionType: "view_profile",
    requiredCapability: "linkedin",
    entityRequirement: "profile",
    fields: [],
    draftSurface: null,
    activityKeys: ["action.profile.view"],
    aliases: ["view_profile"],
    knowledgeRefs: defaultKnowledgeRefs("Profile View", { key: "profile_view", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "profile_view", platform: "linkedin" })
  },
  {
    key: "follow",
    label: "Follow",
    summary: "Follow the prospect profile without sending a private message.",
    platform: "linkedin",
    category: "warmup",
    executionActionType: "follow",
    rateLimitActionType: "follow",
    requiredCapability: "linkedin",
    entityRequirement: "profile",
    fields: [],
    draftSurface: null,
    activityKeys: ["action.profile.follow"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Follow", { key: "follow", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "follow", platform: "linkedin" })
  },
  {
    key: "unfollow",
    label: "Unfollow",
    summary: "Undo a previous follow on the prospect profile.",
    platform: "linkedin",
    category: "profile-maintenance",
    executionActionType: "unfollow",
    rateLimitActionType: "unfollow",
    requiredCapability: "linkedin",
    entityRequirement: "profile",
    fields: [],
    draftSurface: null,
    activityKeys: ["action.profile.un_follow"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Unfollow", { key: "unfollow", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "unfollow", platform: "linkedin" })
  },
  {
    key: "send_direct_message",
    label: "Send Direct Message",
    summary: "Send a private LinkedIn message after connection or in reply to an inbound touch.",
    platform: "linkedin",
    category: "private-outreach",
    executionActionType: "send_direct_message",
    rateLimitActionType: "send_direct_message",
    requiredCapability: "linkedin",
    entityRequirement: "message-thread",
    fields: ["text"],
    draftSurface: null,
    activityKeys: ["messaging.message_sent"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Direct Message", { key: "send_direct_message", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "send_direct_message", platform: "linkedin" })
  },
  {
    key: "in_mail_message",
    label: "Send LinkedIn InMail",
    summary: "Send an InMail when direct connection is unavailable and entitlement exists.",
    platform: "linkedin",
    category: "private-outreach",
    executionActionType: "in_mail_message",
    rateLimitActionType: "in_mail_message",
    requiredCapability: "linkedin",
    entityRequirement: "profile",
    fields: ["subject", "text", "attachments:optional"],
    draftSurface: null,
    activityKeys: ["action.profile.in_mail_message"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("InMail", { key: "in_mail_message", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "in_mail_message", platform: "linkedin" })
  },
  {
    key: "send_email",
    label: "Send Email",
    summary: "Send a direct email when the motion has a verified fallback address.",
    platform: "email",
    category: "private-outreach",
    executionActionType: "send_email",
    rateLimitActionType: "send_email",
    requiredCapability: "gmail",
    entityRequirement: "email-address",
    fields: ["subject", "text", "attachments:optional"],
    draftSurface: "email",
    activityKeys: ["messaging.message_sent", "messaging.email_sent"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Email", { key: "send_email", platform: "email" }),
    hintDocPath: defaultHintDocPath({ key: "send_email", platform: "email" })
  },
  {
    key: "like_post",
    label: "Like Post",
    summary: "Leave a lightweight positive reaction on a recent post.",
    platform: "linkedin",
    category: "public-engagement",
    executionActionType: "create_post_reaction",
    rateLimitActionType: "create_post_reaction",
    requiredCapability: "linkedin",
    entityRequirement: "post",
    fields: [],
    draftSurface: null,
    activityKeys: ["action.post.like"],
    aliases: ["create_post_reaction"],
    knowledgeRefs: defaultKnowledgeRefs("Like Post", { key: "like_post", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "like_post", platform: "linkedin" })
  },
  {
    key: "unlike_post",
    label: "Unlike Post",
    summary: "Remove a prior like from a post.",
    platform: "linkedin",
    category: "public-engagement",
    executionActionType: "unlike_post",
    rateLimitActionType: "unlike_post",
    requiredCapability: "linkedin",
    entityRequirement: "post",
    fields: [],
    draftSurface: null,
    activityKeys: ["action.post.un_like"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Unlike Post", { key: "unlike_post", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "unlike_post", platform: "linkedin" })
  },
  {
    key: "create_post_comment",
    label: "Comment on Post",
    summary: "Write a public comment on a recent post when the hook is legitimate.",
    platform: "linkedin",
    category: "public-engagement",
    executionActionType: "create_post_comment",
    rateLimitActionType: "create_post_comment",
    requiredCapability: "linkedin",
    entityRequirement: "post",
    fields: ["text"],
    draftSurface: "public_comment",
    activityKeys: ["action.post.comment"],
    aliases: ["comment_on_post"],
    knowledgeRefs: defaultKnowledgeRefs("Public Comment", { key: "create_post_comment", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "create_post_comment", platform: "linkedin" })
  },
  {
    key: "share_post",
    label: "Share Post",
    summary: "Share a post, optionally with short framing text.",
    platform: "linkedin",
    category: "public-engagement",
    executionActionType: "share_post",
    rateLimitActionType: "share_post",
    requiredCapability: "linkedin",
    entityRequirement: "post",
    fields: ["text:optional"],
    draftSurface: null,
    activityKeys: ["action.post.share"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Share Post", { key: "share_post", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "share_post", platform: "linkedin" })
  },
  {
    key: "create_comment_comment",
    label: "Reply to Comment",
    summary: "Reply inside an existing public comment thread.",
    platform: "linkedin",
    category: "public-engagement",
    executionActionType: "create_comment_comment",
    rateLimitActionType: "create_comment_comment",
    requiredCapability: "linkedin",
    entityRequirement: "comment",
    fields: ["text"],
    draftSurface: "comment_reply",
    activityKeys: ["action.post.comment.reply.outbound"],
    aliases: ["comment_reply_outbound"],
    knowledgeRefs: defaultKnowledgeRefs("Comment Reply", { key: "create_comment_comment", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "create_comment_comment", platform: "linkedin" })
  },
  {
    key: "create_comment_reaction",
    label: "React to Comment",
    summary: "Leave a lightweight reaction on an existing comment.",
    platform: "linkedin",
    category: "public-engagement",
    executionActionType: "create_comment_reaction",
    rateLimitActionType: "create_comment_reaction",
    requiredCapability: "linkedin",
    entityRequirement: "comment",
    fields: [],
    draftSurface: null,
    activityKeys: ["action.post.comment.react.outbound"],
    aliases: ["comment_react_outbound"],
    knowledgeRefs: defaultKnowledgeRefs("Comment Reaction", { key: "create_comment_reaction", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "create_comment_reaction", platform: "linkedin" })
  },
  {
    key: "withdraw_connection",
    label: "Withdraw Connection Request",
    summary: "Withdraw a previously sent connection request.",
    platform: "linkedin",
    category: "profile-maintenance",
    executionActionType: "withdraw_connection",
    rateLimitActionType: "withdraw_connection",
    requiredCapability: "linkedin",
    entityRequirement: "profile",
    fields: [],
    draftSurface: null,
    activityKeys: ["action.profile.withdraw_connection"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Withdraw Connection", { key: "withdraw_connection", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "withdraw_connection", platform: "linkedin" })
  },
  {
    key: "accept_connection",
    label: "Accept Connection",
    summary: "Accept an inbound connection request when that context exists.",
    platform: "linkedin",
    category: "inbound-handling",
    executionActionType: "accept_connection",
    rateLimitActionType: "accept_connection",
    requiredCapability: "linkedin",
    entityRequirement: "inbound-request",
    fields: [],
    draftSurface: null,
    activityKeys: ["action.profile.connect_request_accept"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Accept Connection", { key: "accept_connection", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "accept_connection", platform: "linkedin" })
  },
  {
    key: "decline_connection",
    label: "Decline Connection",
    summary: "Decline an inbound connection request when that context exists.",
    platform: "linkedin",
    category: "inbound-handling",
    executionActionType: "decline_connection",
    rateLimitActionType: "decline_connection",
    requiredCapability: "linkedin",
    entityRequirement: "inbound-request",
    fields: [],
    draftSurface: null,
    activityKeys: ["action.profile.connect_request_decline"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Decline Connection", { key: "decline_connection", platform: "linkedin" }),
    hintDocPath: defaultHintDocPath({ key: "decline_connection", platform: "linkedin" })
  },
  {
    key: "voicemail_outreach",
    label: "Leave Voicemail",
    summary: "Leave a voicemail when the motion has the right phone context and operator approval.",
    platform: "phone",
    category: "offline-outreach",
    executionActionType: "voicemail_outreach",
    rateLimitActionType: "voicemail_outreach",
    requiredCapability: "generic-web",
    entityRequirement: "phone-number",
    fields: ["text"],
    draftSurface: null,
    activityKeys: ["action.voicemail.outbound"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Voicemail", { key: "voicemail_outreach", platform: "phone" }),
    hintDocPath: defaultHintDocPath({ key: "voicemail_outreach", platform: "phone" })
  },
  {
    key: "video_outreach",
    label: "Record Video",
    summary: "Record a short personalized video when the motion has the right delivery path.",
    platform: "video",
    category: "offline-outreach",
    executionActionType: "video_outreach",
    rateLimitActionType: "video_outreach",
    requiredCapability: "generic-web",
    entityRequirement: "delivery-path",
    fields: ["text"],
    draftSurface: null,
    activityKeys: ["action.video.outbound"],
    aliases: [],
    knowledgeRefs: defaultKnowledgeRefs("Video Outreach", { key: "video_outreach", platform: "video" }),
    hintDocPath: defaultHintDocPath({ key: "video_outreach", platform: "video" })
  }
];

/**
 * @param {{ platform?: string | null }} [options]
 */
export function listActionCatalog(options = {}) {
  const platform = options.platform?.trim().toLowerCase();
  const actions = platform
    ? ACTION_CATALOG.filter((action) => action.platform === platform)
    : ACTION_CATALOG;

  return actions.map(cloneActionDefinition).sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * @param {string} key
 */
export function findActionDefinition(key) {
  const normalized = normalizeActionKey(key);
  const action = ACTION_CATALOG.find((candidate) =>
    candidate.key === normalized || candidate.aliases.includes(normalized)
  );

  return action ? cloneActionDefinition(action) : null;
}

/**
 * @param {string} value
 */
export function normalizeActionKey(value) {
  return value.toString().trim().toLowerCase();
}

/**
 * @param {string} section
 */
function defaultKnowledgeRefs(section, action = null) {
  const refs = [
    {
      path: "docs/action-catalog.md",
      section
    },
    {
      path: "docs/agent-usage.md",
      section: "Action Execution"
    }
  ];

  if (action) {
    refs.push({
      path: defaultHintDocPath(action),
      section: "Execution Hints"
    });
  }

  return refs;
}

/**
 * @param {{ key: string, platform: string }} action
 */
function defaultHintDocPath(action) {
  return `docs/${action.platform}/${action.key}.md`;
}

/**
 * @param {{
 *   affordances?: string[],
 *   fallbacks?: string[],
 *   successProofs?: string[],
 *   failureSignatures?: string[],
 *   cleanup?: string[]
 * }} [input]
 */
function hints(input = {}) {
  return {
    affordances: [...(input.affordances ?? [])],
    fallbacks: [...(input.fallbacks ?? [])],
    successProofs: [...(input.successProofs ?? [])],
    failureSignatures: [...(input.failureSignatures ?? [])],
    cleanup: [...(input.cleanup ?? [])]
  };
}

/**
 * @param {typeof ACTION_CATALOG[number]} action
 */
function cloneActionDefinition(action) {
  return {
    ...action,
    fields: [...action.fields],
    activityKeys: [...action.activityKeys],
    aliases: [...action.aliases],
    knowledgeRefs: action.knowledgeRefs.map((reference) => ({ ...reference })),
    executionHints: loadActionHints(action.hintDocPath ?? defaultHintDocPath(action))
  };
}

const ACTION_HINT_CACHE = new Map();

/**
 * @param {string} relativePath
 */
function loadActionHints(relativePath) {
  if (ACTION_HINT_CACHE.has(relativePath)) {
    return hints(ACTION_HINT_CACHE.get(relativePath));
  }

  const fileUrl = new URL(`../../${relativePath}`, import.meta.url);

  if (!fs.existsSync(fileUrl)) {
    const empty = hints();
    ACTION_HINT_CACHE.set(relativePath, empty);
    return hints(empty);
  }

  const raw = fs.readFileSync(fileUrl, "utf8");
  const parsed = parseHintFrontmatter(raw);
  ACTION_HINT_CACHE.set(relativePath, parsed);
  return hints(parsed);
}

/**
 * @param {string} raw
 */
function parseHintFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    return hints();
  }

  /** @type {{ affordances?: string[], fallbacks?: string[], successProofs?: string[], failureSignatures?: string[], cleanup?: string[] }} */
  const parsed = {};
  /** @type {keyof typeof parsed | null} */
  let currentKey = null;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trim() === "---") {
      break;
    }

    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      if (!(currentKey in parsed)) {
        parsed[currentKey] = [];
      }
      continue;
    }

    const itemMatch = line.match(/^\s*-\s+(.*)$/);
    if (itemMatch && currentKey) {
      parsed[currentKey].push(itemMatch[1].trim());
    }
  }

  return hints(parsed);
}
