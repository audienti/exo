// @ts-check

import { execFileSync } from "node:child_process";
import {
  findInboundObservationByDedupeKey,
  findInboundObservationById,
  findUserById,
  listMotions,
  updateUser,
  upsertInboundObservation,
} from "../db/database.js";
import { mergeInboundObservation, recordInboundObservation } from "../core/inbound-observations.js";
import { classifyConnectionRequestProfileStatus } from "../core/connection-request-reconciliation.js";
import { markUserInboundSurfaceMixedAfterOutOfBandReconciliation } from "../core/user-inbound-sync.js";
import { extractLinkedinPublicId } from "./prospect-contacts.js";
import { readUnipileConfig } from "./unipile-config.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

const UNIPILE_HTTP_TIMEOUT_MS = normalizePositiveInteger(
  process.env.EXO_UNIPILE_HTTP_TIMEOUT_MS ? Number.parseInt(process.env.EXO_UNIPILE_HTTP_TIMEOUT_MS, 10) : null,
  30000,
);
const UNIPILE_HTTP_CONNECT_TIMEOUT_SECONDS = Math.max(1, Math.min(10, Math.ceil(UNIPILE_HTTP_TIMEOUT_MS / 1000)));
const UNIPILE_HTTP_MAX_TIME_SECONDS = Math.max(1, Math.ceil(UNIPILE_HTTP_TIMEOUT_MS / 1000));

/**
 * @param {any} task
 * @param {{
 *   codexHome?: string | null,
 *   findObservationById?: ((id: string) => unknown | null) | null,
 *   findUserById?: ((id: string) => unknown | null) | null,
 *   findObservationByDedupeKey?: ((dedupeKey: string) => unknown | null) | null,
 *   listMotions?: (() => unknown[]) | null,
 *   upsertObservation?: ((observation: any) => void) | null,
 *   updateUser?: ((user: any) => void) | null,
 *   baseUrl?: string | null,
 *   allowDirectUnipileHttp?: boolean | null,
 *   httpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpDeleteImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpPostImpl?: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null,
 * }} [options]
 */
export function runLinkedinMaintenanceWithUnipile(task, options = {}) {
  const context = resolveLinkedinMaintenanceContext(task, options);
  if (context.status !== "ready") {
    return context;
  }
  const { observation, user, providerAccountId, baseUrl } = context;
  const { apiKey } = readUnipileConfig(options.codexHome ?? null);
  if (!apiKey) {
    return {
      status: "blocked",
      reason: `${task.kind} requires UNIPILE_API_KEY in the local Codex environment.`,
    };
  }

  if (task.kind === "reconcile_connection_request_status") {
    const profileIdentity = resolveLinkedinProfileIdentity(observation);
    if (!profileIdentity) {
      return {
        status: "blocked",
        reason: `reconcile_connection_request_status requires a LinkedIn profile identity on observation ${observation.id}.`,
      };
    }

    const url = new URL(`/api/v1/users/${encodeURIComponent(profileIdentity)}`, baseUrl);
    url.searchParams.set("account_id", providerAccountId);
    url.searchParams.append("linkedin_sections", "experience");
    const response = requestUnipileJson({
      method: "GET",
      url: url.toString(),
      apiKey,
      allowDirectUnipileHttp: options.allowDirectUnipileHttp === true,
      httpGetImpl: options.httpGetImpl ?? null,
    });
    if (!response.ok) {
      return {
        status: "blocked",
        reason: buildMaintenanceFailureReason("reconcile_connection_request_status", response),
      };
    }

    const resolution = classifyConnectionRequestProfileStatus(response.parsed);
    if (!resolution.nextKind) {
      return {
        status: "blocked",
        reason: `reconcile_connection_request_status could not classify LinkedIn profile state for ${observation.actorName ?? observation.id}.`,
        provider: "unipile",
        profileStatus: resolution.profileStatus,
      };
    }

    const writeback = writeInboundObservationStatusResolution({
      observation,
      user,
      nextKind: resolution.nextKind,
      profile: response.parsed,
      profileStatus: resolution.profileStatus,
      findObservationByDedupeKeyImpl: options.findObservationByDedupeKey ?? null,
      listMotionsImpl: options.listMotions ?? null,
      upsertObservationImpl: options.upsertObservation ?? null,
    });
    const mixedSurface = markUserInboundSurfaceMixedAfterOutOfBandReconciliation(user, {
      accountId: observation.accountId,
      surfaceKey: observation.surfaceKey,
    });
    if (mixedSurface.changed) {
      if (options.updateUser) {
        options.updateUser(mixedSurface.user);
      } else {
        updateUser(mixedSurface.user);
      }
    }
    return {
      status: "completed",
      provider: "unipile",
      observationId: writeback.observation.id,
      resolvedKind: writeback.observation.kind,
      profileStatus: resolution.profileStatus,
      result: {
        profileIdentity,
        observationId: writeback.observation.id,
      },
    };
  }

  if (task.kind === "withdraw_connection") {
    const invitationId = normalizeNullableString(observation.externalId);
    if (!invitationId) {
      return {
        status: "blocked",
        reason: `${task.kind} requires a native invitation id on observation ${observation.id}.`,
      };
    }
    const url = new URL(`/api/v1/users/invite/sent/${encodeURIComponent(invitationId)}`, baseUrl);
    url.searchParams.set("account_id", providerAccountId);
    const response = requestUnipileJson({
      method: "DELETE",
      url: url.toString(),
      apiKey,
      allowDirectUnipileHttp: options.allowDirectUnipileHttp === true,
      httpDeleteImpl: options.httpDeleteImpl ?? null,
    });
    if (!response.ok) {
      return {
        status: "blocked",
        reason: buildMaintenanceFailureReason("withdraw_connection", response),
      };
    }
    return {
      status: "completed",
      provider: "unipile",
      invitationId,
      responseStatus: response.status,
      result: response.parsed,
    };
  }

  if (task.kind === "accept_connection_request" || task.kind === "reject_connection_request") {
    const invitationId = normalizeNullableString(observation.externalId);
    if (!invitationId) {
      return {
        status: "blocked",
        reason: `${task.kind} requires a native invitation id on observation ${observation.id}.`,
      };
    }
    const sharedSecret = normalizeNullableString(observation.providerSharedSecret);
    if (!sharedSecret) {
      return {
        status: "blocked",
        reason: `${task.kind} requires a stored Unipile shared_secret on observation ${observation.id}. Re-run LinkedIn invite sync before retrying.`,
      };
    }
    const action = task.kind === "accept_connection_request" ? "accept" : "decline";
    const response = requestUnipileJson({
      method: "POST",
      url: new URL(`/api/v1/users/invite/received/${encodeURIComponent(invitationId)}`, baseUrl).toString(),
      apiKey,
      bodyText: JSON.stringify({
        provider: "LINKEDIN",
        account_id: providerAccountId,
        shared_secret: sharedSecret,
        action,
      }),
      allowDirectUnipileHttp: options.allowDirectUnipileHttp === true,
      httpPostImpl: options.httpPostImpl ?? null,
    });
    if (!response.ok) {
      return {
        status: "blocked",
        reason: buildMaintenanceFailureReason(task.kind, response),
      };
    }
    return {
      status: "completed",
      provider: "unipile",
      invitationId,
      responseStatus: response.status,
      result: response.parsed,
    };
  }

  return {
    status: "blocked",
    reason: `Unsupported LinkedIn maintenance task kind: ${task.kind ?? "unknown"}.`,
  };
}

/**
 * @param {any} handoff
 * @param {{
 *   codexHome?: string | null,
 *   baseUrl?: string | null,
 *   apiKey?: string | null,
 *   allowDirectUnipileHttp?: boolean | null,
 *   httpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpPostImpl?: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null,
 * }} [options]
 */
export function runLinkedinSendWithUnipile(handoff, options = {}) {
  const action = normalizeNullableString(handoff?.action);
  if (action === "send_connection_request") {
    const context = resolveLinkedinConnectionRequestSendContext(handoff, options);
    if (context.status !== "ready") {
      return context;
    }

    const { apiKey: configuredApiKey } = readUnipileConfig(options.codexHome ?? null);
    const apiKey = normalizeNullableString(options.apiKey) ?? configuredApiKey;
    if (!apiKey) {
      return {
        status: "blocked",
        reason: "send_connection_request requires UNIPILE_API_KEY in the local Codex environment.",
      };
    }

    const requestBody = {
      provider_id: context.recipientProviderId,
      account_id: context.providerAccountId,
    };
    if (context.message) {
      requestBody.message = context.message;
    }

    const response = requestUnipileJson({
      method: "POST",
      url: new URL("/api/v1/users/invite", context.baseUrl).toString(),
      apiKey,
      bodyText: JSON.stringify(requestBody),
      allowDirectUnipileHttp: options.allowDirectUnipileHttp === true,
      httpPostImpl: options.httpPostImpl ?? null,
    });
    if (!response.ok) {
      return {
        status: "blocked",
        reason: buildMaintenanceFailureReason("send_connection_request", response),
        provider: "unipile",
        responseStatus: response.status,
        result: response.parsed,
      };
    }

    return {
      status: "sent",
      provider: "unipile",
      responseStatus: response.status,
      invitationId: normalizeNullableString(response.parsed?.id)
        ?? normalizeNullableString(response.parsed?.invitation_id)
        ?? normalizeNullableString(response.parsed?.invitationId)
        ?? null,
      result: response.parsed,
    };
  }

  if (action === "like_post" || action === "create_comment_reaction") {
    const context = resolveLinkedinPublicReactionSendContext(handoff, options);
    if (context.status !== "ready") {
      return context;
    }

    const { apiKey: configuredApiKey } = readUnipileConfig(options.codexHome ?? null);
    const apiKey = normalizeNullableString(options.apiKey) ?? configuredApiKey;
    if (!apiKey) {
      return {
        status: "blocked",
        reason: `${action} requires UNIPILE_API_KEY in the local Codex environment.`,
      };
    }

    const postUrl = new URL(`/api/v1/posts/${encodeURIComponent(context.postLookupId)}`, context.baseUrl);
    postUrl.searchParams.set("account_id", context.providerAccountId);
    const postResponse = requestUnipileJson({
      method: "GET",
      url: postUrl.toString(),
      apiKey,
      allowDirectUnipileHttp: options.allowDirectUnipileHttp === true,
      httpGetImpl: options.httpGetImpl ?? null,
    });
    if (!postResponse.ok) {
      return {
        status: "blocked",
        reason: buildMaintenanceFailureReason(`${action}_post_lookup`, postResponse),
        provider: "unipile",
        responseStatus: postResponse.status,
        result: postResponse.parsed,
      };
    }

    const post = Array.isArray(postResponse.parsed) ? postResponse.parsed[0] : postResponse.parsed;
    const socialId = normalizeNullableString(post?.social_id);
    if (!socialId) {
      return {
        status: "unsupported",
        reason: `${action} requires the Unipile post lookup response to include social_id.`,
        provider: "unipile",
        responseStatus: postResponse.status,
        result: postResponse.parsed,
      };
    }
    if (post?.permissions && post.permissions.can_react === false) {
      return {
        status: "unavailable",
        reason: "Unipile reports that the stored LinkedIn post cannot be reacted to by the governed account.",
        provider: "unipile",
        responseStatus: postResponse.status,
        usedTargetUrl: context.targetUrl,
        result: postResponse.parsed,
      };
    }

    let commentId = context.commentId;
    let commentResolution = null;
    if (action === "create_comment_reaction" && !commentId) {
      commentResolution = resolveLinkedinPublicReactionCommentId({
        socialId,
        context,
        apiKey,
        httpGetImpl: options.httpGetImpl ?? null,
        allowDirectUnipileHttp: options.allowDirectUnipileHttp === true,
      });
      if (commentResolution.status !== "ready") {
        return commentResolution;
      }
      commentId = commentResolution.commentId;
    }

    const requestBody = {
      account_id: context.providerAccountId,
      post_id: socialId,
      reaction_type: "like",
    };
    if (commentId) {
      requestBody.comment_id = commentId;
    }
    const reactionResponse = requestUnipileJson({
      method: "POST",
      url: new URL("/api/v1/posts/reaction", context.baseUrl).toString(),
      apiKey,
      bodyText: JSON.stringify(requestBody),
      allowDirectUnipileHttp: options.allowDirectUnipileHttp === true,
      httpPostImpl: options.httpPostImpl ?? null,
    });
    if (!reactionResponse.ok) {
      return {
        status: "blocked",
        reason: buildMaintenanceFailureReason(action, reactionResponse),
        provider: "unipile",
        responseStatus: reactionResponse.status,
        usedTargetUrl: context.targetUrl,
        result: reactionResponse.parsed,
      };
    }

    return {
      status: "sent",
      provider: "unipile",
      responseStatus: reactionResponse.status,
      postSocialId: socialId,
      commentId,
      commentResolution,
      usedTargetUrl: context.targetUrl,
      result: reactionResponse.parsed,
    };
  }

  return {
    status: "unsupported",
    reason: "Direct Unipile send supports send_connection_request and resolvable public LinkedIn reactions only.",
  };
}

/**
 * @param {any} handoff
 * @param {{ codexHome?: string | null, baseUrl?: string | null }} [options]
 */
function resolveLinkedinPublicReactionSendContext(handoff, options = {}) {
  const action = normalizeNullableString(handoff?.action);
  if (action !== "like_post" && action !== "create_comment_reaction") {
    return {
      status: "unsupported",
      reason: "Direct Unipile public reactions only support like_post and create_comment_reaction.",
    };
  }

  const channel = normalizeNullableString(handoff?.channel)?.toLowerCase() ?? null;
  if (channel && channel !== "linkedin") {
    return {
      status: "unsupported",
      reason: `Direct Unipile public reaction requires a LinkedIn handoff. Resolved channel ${channel}.`,
    };
  }

  const connector = normalizeConnectorKey(handoff?.connector);
  if (connector && connector !== "unipile") {
    return {
      status: "unsupported",
      reason: `Direct Unipile public reaction requires a Unipile connector. Resolved connector ${handoff.connector}.`,
    };
  }

  const providerAccountId = normalizeNullableString(handoff?.senderAccount?.providerAccountId)
    ?? normalizeNullableString(handoff?.providerAccountId)
    ?? normalizeNullableString(handoff?.executionPolicy?.sameCredentialHttpFallbackAccountId);
  if (!providerAccountId) {
    return {
      status: "blocked",
      reason: `${action} requires senderAccount.providerAccountId for the governed LinkedIn account.`,
    };
  }

  const targetUrl = normalizeNullableString(handoff?.publicTarget?.url)
    ?? normalizeNullableString(handoff?.recipient?.profileUrl)
    ?? normalizeNullableString(handoff?.recipientUrl);
  if (!targetUrl) {
    return {
      status: "unsupported",
      reason: `${action} requires a stored LinkedIn public target URL.`,
    };
  }

  const targetKind = normalizeNullableString(handoff?.publicTarget?.targetKind)?.toLowerCase() ?? null;
  if (action === "like_post" && targetKind === "comment") {
    return {
      status: "unsupported",
      reason: "like_post direct reaction requires a post target, not a comment target.",
    };
  }
  if (action === "create_comment_reaction" && targetKind && targetKind !== "comment") {
    return {
      status: "unsupported",
      reason: "create_comment_reaction direct reaction requires a comment target.",
    };
  }

  const commentId = normalizeNullableString(handoff?.publicTarget?.commentId)
    ?? normalizeNullableString(handoff?.publicTarget?.comment_id)
    ?? normalizeNullableString(handoff?.commentId)
    ?? null;

  const postLookupId = extractLinkedinPostLookupId(targetUrl);
  if (!postLookupId) {
    return {
      status: "unsupported",
      reason: `${action} requires a LinkedIn post URL containing an activity, ugcPost, or share id.`,
    };
  }

  const config = readUnipileConfig(options.codexHome ?? null);
  const baseUrl = normalizeNullableString(options.baseUrl)
    ?? (config.baseUrlSource === "default" ? null : config.baseUrl);
  if (!baseUrl) {
    return {
      status: "blocked",
      reason: `${action} requires a configured Unipile base URL.`,
    };
  }

  return {
    status: "ready",
    providerAccountId,
    targetUrl,
    targetKind,
    postLookupId,
    commentId,
    commentHints: buildCommentResolutionHints(handoff),
    baseUrl,
  };
}

/**
 * @param {{
 *   socialId: string,
 *   context: {
 *     baseUrl: string,
 *     providerAccountId: string,
 *     targetUrl: string,
 *     commentHints?: ReturnType<typeof buildCommentResolutionHints>,
 *   },
 *   apiKey: string,
 *   allowDirectUnipileHttp?: boolean,
 *   httpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 * }} input
 */
function resolveLinkedinPublicReactionCommentId(input) {
  const commentsUrl = new URL(`/api/v1/posts/${encodeURIComponent(input.socialId)}/comments`, input.context.baseUrl);
  commentsUrl.searchParams.set("account_id", input.context.providerAccountId);
  commentsUrl.searchParams.set("limit", "100");
  commentsUrl.searchParams.set("sort_by", "MOST_RECENT");
  const commentsResponse = requestUnipileJson({
    method: "GET",
    url: commentsUrl.toString(),
    apiKey: input.apiKey,
    allowDirectUnipileHttp: input.allowDirectUnipileHttp === true,
    httpGetImpl: input.httpGetImpl ?? null,
  });
  if (!commentsResponse.ok) {
    return {
      status: "blocked",
      reason: buildMaintenanceFailureReason("create_comment_reaction_comment_lookup", commentsResponse),
      provider: "unipile",
      responseStatus: commentsResponse.status,
      result: commentsResponse.parsed,
    };
  }

  const comments = extractUnipileItems(commentsResponse.parsed);
  const match = selectLinkedinCommentMatch(comments, input.context.commentHints);
  if (!match.commentId) {
    return {
      status: "unsupported",
      reason: match.reason,
      provider: "unipile",
      responseStatus: commentsResponse.status,
      usedTargetUrl: input.context.targetUrl,
      result: {
        commentCount: comments.length,
      },
    };
  }

  return {
    status: "ready",
    provider: "unipile",
    responseStatus: commentsResponse.status,
    commentId: match.commentId,
    matchReason: match.reason,
    result: {
      commentCount: comments.length,
    },
  };
}

/** @param {any} handoff */
function buildCommentResolutionHints(handoff) {
  return {
    recipientName: normalizeNullableString(handoff?.recipient?.name),
    recipientPublicId: normalizeNullableString(handoff?.recipient?.publicId),
    targetSummary: normalizeNullableString(handoff?.publicTarget?.summary),
    targetSnippet: normalizeNullableString(handoff?.publicTarget?.snippet),
    targetRationale: normalizeNullableString(handoff?.publicTarget?.rationale),
  };
}

/** @param {any} parsed */
function extractUnipileItems(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (Array.isArray(parsed?.comments)) return parsed.comments;
  if (Array.isArray(parsed?.elements)) return parsed.elements;
  return [];
}

/**
 * @param {any[]} comments
 * @param {ReturnType<typeof buildCommentResolutionHints> | null | undefined} hints
 */
function selectLinkedinCommentMatch(comments, hints) {
  const scored = comments
    .map((comment) => {
      const commentId = normalizeNullableString(comment?.id)
        ?? normalizeNullableString(comment?.comment_id)
        ?? normalizeNullableString(comment?.commentId)
        ?? normalizeNullableString(comment?.social_id)
        ?? null;
      if (!commentId) return null;
      const score = scoreLinkedinCommentMatch(comment, hints);
      return {
        commentId,
        score,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  const best = scored[0] ?? null;
  if (!best || best.score < 3) {
    return {
      commentId: null,
      reason: "create_comment_reaction could not resolve a unique LinkedIn comment id from the stored target evidence.",
    };
  }

  const tiedBest = scored.filter((candidate) => candidate.score === best.score);
  if (tiedBest.length > 1) {
    return {
      commentId: null,
      reason: "create_comment_reaction matched multiple LinkedIn comments with equal confidence; refusing to react to an ambiguous target.",
    };
  }

  return {
    commentId: best.commentId,
    reason: "matched_stored_comment_evidence",
  };
}

/**
 * @param {any} comment
 * @param {ReturnType<typeof buildCommentResolutionHints> | null | undefined} hints
 */
function scoreLinkedinCommentMatch(comment, hints) {
  let score = 0;
  const author = comment?.author ?? comment?.actor ?? comment?.user ?? null;
  const authorPublicId = normalizeNullableString(author?.public_identifier)
    ?? normalizeNullableString(author?.publicIdentifier)
    ?? normalizeNullableString(author?.public_id)
    ?? null;
  const authorName = normalizeNullableString(author?.name)
    ?? normalizeNullableString(comment?.author_name)
    ?? null;
  if (hints?.recipientPublicId && authorPublicId && normalizeTextForMatch(authorPublicId) === normalizeTextForMatch(hints.recipientPublicId)) {
    score += 100;
  }
  if (hints?.recipientName && authorName && normalizeTextForMatch(authorName) === normalizeTextForMatch(hints.recipientName)) {
    score += 50;
  }

  const text = normalizeNullableString(comment?.text)
    ?? normalizeNullableString(comment?.body)
    ?? normalizeNullableString(comment?.message)
    ?? normalizeNullableString(comment?.content)
    ?? "";
  score += countOverlappingMeaningfulTokens(text, [
    hints?.targetSnippet,
    hints?.targetSummary,
    hints?.targetRationale,
  ]);
  return score;
}

/**
 * @param {string | null | undefined} text
 * @param {Array<string | null | undefined>} hintTexts
 */
function countOverlappingMeaningfulTokens(text, hintTexts) {
  const textTokens = new Set(tokenizeMeaningfulText(text));
  if (!textTokens.size) return 0;
  const hintTokens = new Set(hintTexts.flatMap((hint) => tokenizeMeaningfulText(hint)));
  let overlap = 0;
  for (const token of hintTokens) {
    if (textTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

/** @param {string | null | undefined} value */
function tokenizeMeaningfulText(value) {
  const normalized = normalizeTextForMatch(value);
  if (!normalized) return [];
  const stopWords = new Set([
    "about",
    "after",
    "asked",
    "asking",
    "comment",
    "commented",
    "clearly",
    "connect",
    "contact",
    "email",
    "have",
    "into",
    "need",
    "reply",
    "should",
    "stored",
    "that",
    "this",
    "thread",
    "with",
  ]);
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopWords.has(token));
}

/** @param {string | null | undefined} value */
function normalizeTextForMatch(value) {
  return normalizeNullableString(value)
    ?.toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    ?? "";
}

/** @param {string | null | undefined} rawUrl */
function extractLinkedinPostLookupId(rawUrl) {
  const value = normalizeNullableString(rawUrl);
  if (!value) return null;

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }

  const ugcPost = decoded.match(/(?:urn:li:ugcPost:|ugcPost[-_:])(\d{8,})/i);
  if (ugcPost?.[1]) {
    return `urn:li:ugcPost:${ugcPost[1]}`;
  }

  const share = decoded.match(/(?:urn:li:share:|share[-_:])(\d{8,})/i);
  if (share?.[1]) {
    return `urn:li:share:${share[1]}`;
  }

  const activity = decoded.match(/(?:urn:li:activity:|activity[-_:])(\d{8,})/i);
  return activity?.[1] ?? null;
}

/**
 * @param {any} task
 * @param {{
 *   codexHome?: string | null,
 *   baseUrl?: string | null,
 *   findObservationById?: ((id: string) => unknown | null) | null,
 *   findUserById?: ((id: string) => unknown | null) | null,
 * }} [options]
 */
export function buildLinkedinMaintenanceHandoff(task, options = {}) {
  const context = resolveLinkedinMaintenanceContext(task, options);
  if (context.status !== "ready") {
    return context;
  }

  const { observation, user, harnessConnection, providerAccountId, baseUrl } = context;
  const connector = `${normalizeNullableString(harnessConnection.runtime) ?? "codex"}:${normalizeNullableString(harnessConnection.connector) ?? "unipile"}`;
  const common = {
    status: "ready",
    provider: "unipile",
    connector,
    taskKind: task.kind,
    observationId: observation.id,
    userId: user.id,
    accountId: observation.accountId,
    providerAccountId,
    actorName: observation.actorName ?? null,
    recipientUrl: observation.actorProfileUrl ?? observation.sourceUrl ?? null,
    executionPolicy: {
      mode: "native_connector_tools_only",
      shellFallbackAllowed: false,
      browserFallbackAllowed: false,
      disallowedFallbacks: ["curl", "shell_subprocess", "browser_tools", "another_linkedin_identity"],
      writeBackOnlyAfterRealAction: true,
      sameCredentialHttpFallbackAllowed: true,
      sameCredentialHttpFallbackCredentialSource: "codex_unipile_config",
      sameCredentialHttpFallbackAccountId: providerAccountId,
      sameCredentialHttpFallbackBaseUrl: baseUrl,
    },
  };

  if (task.kind === "reconcile_connection_request_status") {
    const profileIdentity = resolveLinkedinProfileIdentity(observation);
    if (!profileIdentity) {
      return {
        status: "blocked",
        reason: `reconcile_connection_request_status requires a LinkedIn profile identity on observation ${observation.id}.`,
      };
    }
    return {
      ...common,
      action: "retrieve_profile_for_connection_request_reconciliation",
      writebackMode: "profile_status_reconciliation",
      profileIdentity,
      harRequest: {
        method: "GET",
        url: new URL(`/api/v1/users/${encodeURIComponent(profileIdentity)}`, baseUrl).toString(),
        headers: [{ name: "accept", value: "application/json" }],
        queryString: [
          { name: "account_id", value: providerAccountId },
          { name: "linkedin_sections", value: "experience" },
        ],
      },
    };
  }

  if (task.kind === "withdraw_connection") {
    const invitationId = normalizeNullableString(observation.externalId);
    if (!invitationId) {
      return {
        status: "blocked",
        reason: `${task.kind} requires a native invitation id on observation ${observation.id}.`,
      };
    }
    return {
      ...common,
      action: "cancel_sent_invitation",
      writebackMode: "task_writeback_after_completion",
      invitationId,
      harRequest: {
        method: "DELETE",
        url: new URL(`/api/v1/users/invite/sent/${encodeURIComponent(invitationId)}`, baseUrl).toString(),
        headers: [{ name: "accept", value: "application/json" }],
        queryString: [
          { name: "account_id", value: providerAccountId },
        ],
      },
    };
  }

  if (task.kind === "accept_connection_request" || task.kind === "reject_connection_request") {
    const invitationId = normalizeNullableString(observation.externalId);
    if (!invitationId) {
      return {
        status: "blocked",
        reason: `${task.kind} requires a native invitation id on observation ${observation.id}.`,
      };
    }
    const sharedSecret = normalizeNullableString(observation.providerSharedSecret);
    if (!sharedSecret) {
      return {
        status: "blocked",
        reason: `${task.kind} requires a stored Unipile shared_secret on observation ${observation.id}. Re-run LinkedIn invite sync before retrying.`,
      };
    }
    const action = task.kind === "accept_connection_request" ? "accept" : "decline";
    return {
      ...common,
      action: task.kind === "accept_connection_request" ? "accept_received_invitation" : "decline_received_invitation",
      writebackMode: "task_writeback_after_completion",
      invitationId,
      harRequest: {
        method: "POST",
        url: new URL(`/api/v1/users/invite/received/${encodeURIComponent(invitationId)}`, baseUrl).toString(),
        headers: [
          { name: "accept", value: "application/json" },
          { name: "content-type", value: "application/json" },
        ],
        postData: {
          mimeType: "application/json",
          text: JSON.stringify({
            provider: "LINKEDIN",
            account_id: providerAccountId,
            shared_secret: sharedSecret,
            action,
          }),
        },
      },
    };
  }

  return {
    status: "blocked",
    reason: `Unsupported LinkedIn maintenance task kind: ${task.kind ?? "unknown"}.`,
  };
}

/**
 * @param {any} task
 * @param {any} connectorResult
 * @param {{
 *   findObservationById?: ((id: string) => unknown | null) | null,
 *   findUserById?: ((id: string) => unknown | null) | null,
 *   findObservationByDedupeKey?: ((dedupeKey: string) => unknown | null) | null,
 *   listMotions?: (() => unknown[]) | null,
 *   upsertObservation?: ((observation: any) => void) | null,
 *   updateUser?: ((user: any) => void) | null,
 * }} [options]
 */
export function applyLinkedinMaintenanceConnectorResult(task, connectorResult, options = {}) {
  const normalized = normalizeConnectorResult(connectorResult);
  if (normalized.status !== "completed") {
    return {
      status: "blocked",
      reason: normalized.reason ?? `${task?.kind ?? "linkedin_maintenance"} did not complete through Unipile MCP.`,
      provider: "unipile",
      responseStatus: normalized.responseStatus,
      result: normalized.responseBody,
    };
  }

  if (task.kind !== "reconcile_connection_request_status") {
    return {
      status: "completed",
      provider: "unipile",
      responseStatus: normalized.responseStatus,
      result: normalized.responseBody,
    };
  }

  const observation = resolveObservation(task.observationId, options.findObservationById ?? null);
  if (!observation) {
    return {
      status: "blocked",
      reason: `Could not resolve inbound observation ${task.observationId} for ${task.kind}.`,
    };
  }
  const user = resolveUser(observation.userId, options.findUserById ?? null);
  if (!user) {
    return {
      status: "blocked",
      reason: `Could not resolve execution user ${observation.userId} for ${task.kind}.`,
    };
  }

  const resolution = classifyConnectionRequestProfileStatus(normalized.responseBody);
  if (!resolution.nextKind) {
    return {
      status: "blocked",
      reason: `reconcile_connection_request_status could not classify LinkedIn profile state for ${observation.actorName ?? observation.id}.`,
      provider: "unipile",
      profileStatus: resolution.profileStatus,
    };
  }

  const writeback = writeInboundObservationStatusResolution({
    observation,
    user,
    nextKind: resolution.nextKind,
    profile: normalized.responseBody,
    profileStatus: resolution.profileStatus,
    findObservationByDedupeKeyImpl: options.findObservationByDedupeKey ?? null,
    listMotionsImpl: options.listMotions ?? null,
    upsertObservationImpl: options.upsertObservation ?? null,
  });
  const mixedSurface = markUserInboundSurfaceMixedAfterOutOfBandReconciliation(user, {
    accountId: observation.accountId,
    surfaceKey: observation.surfaceKey,
  });
  if (mixedSurface.changed) {
    if (options.updateUser) {
      options.updateUser(mixedSurface.user);
    } else {
      updateUser(mixedSurface.user);
    }
  }
  return {
    status: "completed",
    provider: "unipile",
    observationId: writeback.observation.id,
    resolvedKind: writeback.observation.kind,
    profileStatus: resolution.profileStatus,
    responseStatus: normalized.responseStatus,
    result: {
      observationId: writeback.observation.id,
    },
  };
}

/**
 * @param {string} observationId
 * @param {((id: string) => unknown | null) | null} findObservationById
 */
function resolveObservation(observationId, findObservationById) {
  const raw = findObservationById ? findObservationById(observationId) : findInboundObservationById(observationId);
  return raw ? inboundObservationSchema.parse(raw) : null;
}

/**
 * @param {any} task
 * @param {{
 *   codexHome?: string | null,
 *   baseUrl?: string | null,
 *   findObservationById?: ((id: string) => unknown | null) | null,
 *   findUserById?: ((id: string) => unknown | null) | null,
 * }} [options]
 */
function resolveLinkedinMaintenanceContext(task, options = {}) {
  if (!task?.observationId) {
    return {
      status: "blocked",
      reason: `Connector-native ${task?.kind ?? "linkedin_maintenance"} requires an inbound observation id.`,
    };
  }

  const observation = resolveObservation(task.observationId, options.findObservationById ?? null);
  if (!observation) {
    return {
      status: "blocked",
      reason: `Could not resolve inbound observation ${task.observationId} for ${task.kind}.`,
    };
  }

  const user = resolveUser(observation.userId, options.findUserById ?? null);
  if (!user) {
    return {
      status: "blocked",
      reason: `Could not resolve execution user ${observation.userId} for ${task.kind}.`,
    };
  }

  const account = user.accounts.find((candidate) => candidate.id === observation.accountId) ?? null;
  if (!account) {
    return {
      status: "blocked",
      reason: `Could not resolve LinkedIn account ${observation.accountId} for ${task.kind}.`,
    };
  }
  if (account.capability !== "linkedin") {
    return {
      status: "blocked",
      reason: `${task.kind} requires a LinkedIn account. Observation ${observation.id} resolves through ${account.capability}.`,
    };
  }
  if (account.sourceType !== "harness-connection") {
    return {
      status: "blocked",
      reason: `${task.kind} requires a managed connector account. Observation ${observation.id} resolves through ${account.sourceType}.`,
    };
  }

  const harnessConnection = user.harnessConnections.find((candidate) => candidate.id === account.harnessConnectionId) ?? null;
  if (!harnessConnection) {
    return {
      status: "blocked",
      reason: `Could not resolve harness connection ${account.harnessConnectionId ?? "unknown"} for ${task.kind}.`,
    };
  }

  const connector = normalizeNullableString(harnessConnection.connector)?.toLowerCase() ?? null;
  if (connector !== "unipile") {
    return {
      status: "blocked",
      reason: `${task.kind} requires a managed Unipile account. Observation ${observation.id} resolves through ${harnessConnection.runtime}:${harnessConnection.connector}.`,
    };
  }

  const providerAccountId = normalizeNullableString(account.providerAccountId);
  if (!providerAccountId) {
    return {
      status: "blocked",
      reason: `${task.kind} requires a providerAccountId on LinkedIn account ${account.id}.`,
    };
  }

  const config = readUnipileConfig(options.codexHome ?? null);
  const baseUrl = normalizeNullableString(options.baseUrl)
    ?? (config.baseUrlSource === "default" ? null : config.baseUrl);
  if (!baseUrl) {
    return {
      status: "blocked",
      reason: `${task.kind} requires a configured Unipile base URL.`,
    };
  }

  return {
    status: "ready",
    observation,
    user,
    account,
    harnessConnection,
    providerAccountId,
    baseUrl,
  };
}

/**
 * @param {any} handoff
 * @param {{ codexHome?: string | null, baseUrl?: string | null }} [options]
 */
function resolveLinkedinConnectionRequestSendContext(handoff, options = {}) {
  const action = normalizeNullableString(handoff?.action);
  if (action !== "send_connection_request") {
    return {
      status: "unsupported",
      reason: "Direct Unipile send only supports send_connection_request.",
    };
  }

  const channel = normalizeNullableString(handoff?.channel)?.toLowerCase() ?? null;
  if (channel && channel !== "linkedin") {
    return {
      status: "unsupported",
      reason: `Direct Unipile send requires a LinkedIn handoff. Resolved channel ${channel}.`,
    };
  }

  const connector = normalizeConnectorKey(handoff?.connector);
  if (connector && connector !== "unipile") {
    return {
      status: "unsupported",
      reason: `Direct Unipile send requires a Unipile connector. Resolved connector ${handoff.connector}.`,
    };
  }

  const providerAccountId = normalizeNullableString(handoff?.senderAccount?.providerAccountId)
    ?? normalizeNullableString(handoff?.providerAccountId)
    ?? normalizeNullableString(handoff?.executionPolicy?.sameCredentialHttpFallbackAccountId);
  if (!providerAccountId) {
    return {
      status: "blocked",
      reason: "send_connection_request requires senderAccount.providerAccountId for the governed LinkedIn account.",
    };
  }

  const recipientProviderId = normalizeNullableString(handoff?.recipient?.providerId)
    ?? normalizeNullableString(handoff?.recipientProviderId);
  if (!recipientProviderId) {
    return {
      status: "unsupported",
      reason: "send_connection_request requires recipient.providerId from synced LinkedIn profile truth.",
    };
  }

  const message = normalizeNullableString(handoff?.message);
  if (message && message.length > 300) {
    return {
      status: "blocked",
      reason: "send_connection_request note exceeds Unipile's 300 character message limit.",
    };
  }

  const config = readUnipileConfig(options.codexHome ?? null);
  const baseUrl = normalizeNullableString(options.baseUrl)
    ?? (config.baseUrlSource === "default" ? null : config.baseUrl);
  if (!baseUrl) {
    return {
      status: "blocked",
      reason: "send_connection_request requires a configured Unipile base URL.",
    };
  }

  return {
    status: "ready",
    providerAccountId,
    recipientProviderId,
    message,
    baseUrl,
  };
}

/**
 * @param {string} userId
 * @param {((id: string) => unknown | null) | null} findUser
 */
function resolveUser(userId, findUser) {
  const raw = findUser ? findUser(userId) : findUserById(userId);
  return raw ? userSchema.parse(raw) : null;
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
function resolveLinkedinProfileIdentity(observation) {
  return normalizeNullableString(observation.actorLinkedinPublicId)
    ?? normalizeNullableString(observation.actorHandle)
    ?? extractLinkedinPublicId(observation.actorProfileUrl)
    ?? normalizeNullableString(observation.actorLinkedinMemberId)
    ?? null;
}

/**
 * @param {{
 *   observation: import("../schema/inbound.js").inboundObservationSchema._type,
 *   user: import("../schema/user.js").userSchema._type,
 *   nextKind: "connection_request_pending" | "connection_request_accepted" | "connection_request_not_accepted",
 *   profile: any,
 *   profileStatus: Record<string, any>,
 *   findObservationByDedupeKeyImpl?: ((dedupeKey: string) => unknown | null) | null,
 *   listMotionsImpl?: (() => unknown[]) | null,
 *   upsertObservationImpl?: ((observation: any) => void) | null,
 * }} input
 */
function writeInboundObservationStatusResolution(input) {
  const observedAt = new Date().toISOString();
  const actorName = buildProfileDisplayName(input.profile) ?? input.observation.actorName;
  const nextObservation = recordInboundObservation(input.user, {
    accountId: input.observation.accountId,
    surfaceKey: input.observation.surfaceKey,
    kind: input.nextKind,
    observedAt,
    eventAt: input.observation.eventAt,
    summary: buildStatusResolutionSummary(actorName, input.nextKind),
    externalId: input.observation.externalId,
    actorName,
    actorTitle: normalizeNullableString(input.profile?.headline) ?? input.observation.actorTitle,
    actorCompanyName: input.observation.actorCompanyName,
    actorHandle: normalizeNullableString(input.profile?.public_identifier) ?? input.observation.actorHandle,
    actorProfileUrl: input.observation.actorProfileUrl,
    actorLinkedinPublicId: normalizeNullableString(input.profile?.public_identifier) ?? input.observation.actorLinkedinPublicId,
    actorLinkedinMemberId: normalizeNullableString(input.profile?.provider_id) ?? input.observation.actorLinkedinMemberId,
    actorAvatarSourceUrl: normalizeNullableString(input.profile?.profile_picture_url_large)
      ?? normalizeNullableString(input.profile?.profile_picture_url)
      ?? input.observation.actorAvatarSourceUrl,
    threadUrl: input.observation.threadUrl,
    sourceUrl: input.observation.sourceUrl,
    motionId: input.observation.motionId,
    companyId: input.observation.companyId,
    prospectId: input.observation.prospectId,
    providerSharedSecret: input.observation.providerSharedSecret,
    notes: buildProfileStatusNotes(input.profileStatus),
  }, {
    rawMotions: input.listMotionsImpl ? input.listMotionsImpl() : listMotions(),
  });

  const existingForDedupe = input.findObservationByDedupeKeyImpl
    ? input.findObservationByDedupeKeyImpl(nextObservation.dedupeKey)
    : findInboundObservationByDedupeKey(nextObservation.dedupeKey);
  const merged = mergeInboundObservation(existingForDedupe ?? input.observation, nextObservation);
  if (input.upsertObservationImpl) {
    input.upsertObservationImpl(merged);
  } else {
    upsertInboundObservation(merged);
  }
  return { observation: merged };
}

/** @param {any} profile */
function buildProfileDisplayName(profile) {
  const first = normalizeNullableString(profile?.first_name);
  const last = normalizeNullableString(profile?.last_name);
  return [first, last].filter(Boolean).join(" ").trim() || null;
}

/**
 * @param {string | null} actorName
 * @param {string} nextKind
 */
function buildStatusResolutionSummary(actorName, nextKind) {
  const subject = actorName || "This connection request";
  if (nextKind === "connection_request_accepted") {
    return `${subject} is now a LinkedIn connection.`;
  }
  if (nextKind === "connection_request_not_accepted") {
    return `${subject}'s connection request is not accepted on LinkedIn.`;
  }
  return `${subject} is still pending on LinkedIn.`;
}

/** @param {Record<string, any>} profileStatus */
function buildProfileStatusNotes(profileStatus) {
  if (profileStatus.networkDistance === "FIRST_DEGREE" || profileStatus.isRelationship === true) {
    return "LinkedIn shows this person is now a 1st-degree connection.";
  }

  if (profileStatus.invitationType === "SENT" && profileStatus.invitationStatus === "PENDING") {
    return "LinkedIn still shows the sent connection request as pending.";
  }

  if (profileStatus.isRelationship === false) {
    return "LinkedIn shows this person is not a connection and has no pending sent request.";
  }

  return "Exo checked the LinkedIn profile relationship state.";
}

/**
 * @param {{
 *   method: "DELETE" | "GET" | "POST",
 *   url: string,
 *   apiKey: string,
 *   bodyText?: string | undefined,
 *   allowDirectUnipileHttp?: boolean | undefined,
 *   httpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpDeleteImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpPostImpl?: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null,
 * }} input
 */
function requestUnipileJson(input) {
  try {
    if (input.method === "GET" && input.httpGetImpl) {
      const response = input.httpGetImpl(input.url, {
        accept: "application/json",
        "X-API-KEY": input.apiKey,
      });
      return normalizeUnipileResponse(response);
    }

    if (input.method === "DELETE" && input.httpDeleteImpl) {
      const response = input.httpDeleteImpl(input.url, {
        accept: "application/json",
        "X-API-KEY": input.apiKey,
      });
      return normalizeUnipileResponse(response);
    }

    if (input.method === "POST" && input.httpPostImpl) {
      const response = input.httpPostImpl(input.url, {
        accept: "application/json",
        "content-type": "application/json",
        "X-API-KEY": input.apiKey,
      }, input.bodyText ?? "");
      return normalizeUnipileResponse(response);
    }

    if (input.allowDirectUnipileHttp !== true) {
      return {
        ok: false,
        status: 0,
        parsed: null,
        error: "Direct Unipile HTTP is disabled. Use the MCP/connector-native maintenance handoff.",
      };
    }

    const curlArgs = [
      "-sS",
      "-L",
      "--connect-timeout",
      String(UNIPILE_HTTP_CONNECT_TIMEOUT_SECONDS),
      "--max-time",
      String(UNIPILE_HTTP_MAX_TIME_SECONDS),
      "-X",
      input.method,
      "-H",
      "accept: application/json",
      "-H",
      `X-API-KEY: ${input.apiKey}`,
    ];
    if (input.method === "POST") {
      curlArgs.push(
        "-H",
        "content-type: application/json",
        "--data",
        input.bodyText ?? "",
      );
    }
    curlArgs.push(
      "-w",
      "\n__EXO_STATUS__:%{http_code}",
      input.url,
    );

    const raw = execFileSync("curl", curlArgs, {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: UNIPILE_HTTP_TIMEOUT_MS,
    });
    const marker = "\n__EXO_STATUS__:";
    const index = raw.lastIndexOf(marker);
    if (index === -1) {
      return {
        ok: false,
        status: 0,
        parsed: null,
        error: "Unipile request did not return an HTTP status marker.",
      };
    }

    const bodyText = raw.slice(0, index);
    const status = Number(raw.slice(index + marker.length).trim());
    return {
      ok: Number.isFinite(status) && status >= 200 && status < 300,
      status: Number.isFinite(status) ? status : 0,
      parsed: safeJsonParse(bodyText),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      parsed: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * @param {{ status: number, bodyText: string } | null} response
 */
function normalizeUnipileResponse(response) {
  return {
    ok: !!response && response.status >= 200 && response.status < 300,
    status: response?.status ?? 0,
    parsed: safeJsonParse(response?.bodyText ?? ""),
    error: response ? null : "Unipile request failed before a response was returned.",
  };
}

/**
 * @param {"withdraw_connection" | "accept_connection_request" | "reject_connection_request" | "reconcile_connection_request_status" | "send_connection_request"} taskKind
 * @param {{ status?: number | null, error?: string | null, parsed?: any }} response
 */
function buildMaintenanceFailureReason(taskKind, response) {
  const status = Number.isFinite(response?.status) && Number(response.status) > 0
    ? `HTTP ${Number(response.status)}`
    : "no HTTP status";
  const providerMessage = normalizeNullableString(response?.parsed?.message)
    ?? normalizeNullableString(response?.parsed?.error)
    ?? normalizeNullableString(response?.parsed?.detail)
    ?? normalizeNullableString(response?.error);
  return providerMessage
    ? `${taskKind} through Unipile failed (${status}): ${providerMessage}`
    : `${taskKind} through Unipile failed (${status}).`;
}

/** @param {any} connectorResult */
function normalizeConnectorResult(connectorResult) {
  const status = normalizeNullableString(connectorResult?.status)?.toLowerCase() ?? null;
  const responseStatus = normalizePositiveInteger(
    connectorResult?.httpStatus
      ?? connectorResult?.responseStatus
      ?? connectorResult?.statusCode
      ?? connectorResult?.response?.status,
    null,
  );
  const responseBody = connectorResult?.responseBody
    ?? connectorResult?.body
    ?? connectorResult?.parsed
    ?? connectorResult?.result
    ?? connectorResult?.response?.body
    ?? null;
  const completed = status === "completed"
    || status === "success"
    || status === "sent"
    || status === "ok"
    || (responseStatus !== null && responseStatus >= 200 && responseStatus < 300);
  const reason = normalizeNullableString(connectorResult?.reason)
    ?? normalizeNullableString(responseBody?.message)
    ?? normalizeNullableString(responseBody?.error)
    ?? normalizeNullableString(responseBody?.detail)
    ?? normalizeNullableString(responseBody?.title)
    ?? null;
  return {
    status: completed ? "completed" : "blocked",
    reason,
    responseStatus,
    responseBody,
  };
}

/** @param {string} value */
function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (_error) {
    return null;
  }
}

/** @param {unknown} value */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/** @param {string | null | undefined} connector */
function normalizeConnectorKey(connector) {
  const normalized = normalizeNullableString(connector)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }
  const parts = normalized.split(":").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

/** @param {number | null | undefined} value @param {number} fallback */
function normalizePositiveInteger(value, fallback) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}
