// @ts-check

import { execFileSync } from "node:child_process";
import {
  findInboundObservationByDedupeKey,
  findInboundObservationById,
  findUserById,
  listMotions,
  upsertInboundObservation,
} from "../db/database.js";
import { mergeInboundObservation, recordInboundObservation } from "../core/inbound-observations.js";
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
 *   httpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpDeleteImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpPostImpl?: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null,
 * }} [options]
 */
export function runLinkedinMaintenanceWithUnipile(task, options = {}) {
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

  const { apiKey, baseUrl } = readUnipileConfig(options.codexHome ?? null);
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
      httpGetImpl: options.httpGetImpl ?? null,
    });
    if (!response.ok) {
      return {
        status: "blocked",
        reason: buildMaintenanceFailureReason("reconcile_connection_request_status", response),
      };
    }

    const resolution = classifyProfileStatus(response.parsed);
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

  if (task.kind === "reject_connection_request") {
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
        reason: `reject_connection_request requires a stored Unipile shared_secret on observation ${observation.id}. Re-run LinkedIn invite sync before retrying.`,
      };
    }
    const response = requestUnipileJson({
      method: "POST",
      url: new URL(`/api/v1/users/invite/received/${encodeURIComponent(invitationId)}`, baseUrl).toString(),
      apiKey,
      bodyText: JSON.stringify({
        provider: "LINKEDIN",
        account_id: providerAccountId,
        shared_secret: sharedSecret,
        action: "decline",
      }),
      httpPostImpl: options.httpPostImpl ?? null,
    });
    if (!response.ok) {
      return {
        status: "blocked",
        reason: buildMaintenanceFailureReason("reject_connection_request", response),
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
 * @param {string} observationId
 * @param {((id: string) => unknown | null) | null} findObservationById
 */
function resolveObservation(observationId, findObservationById) {
  const raw = findObservationById ? findObservationById(observationId) : findInboundObservationById(observationId);
  return raw ? inboundObservationSchema.parse(raw) : null;
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
 * @param {any} profile
 * @returns {{
 *   nextKind: "connection_request_pending" | "connection_request_accepted" | "connection_request_not_accepted" | null,
 *   profileStatus: {
 *     networkDistance: string | null,
 *     isRelationship: boolean | null,
 *     invitationType: string | null,
 *     invitationStatus: string | null,
 *   }
 * }}
 */
function classifyProfileStatus(profile) {
  const networkDistance = normalizeNullableString(profile?.network_distance)?.toUpperCase() ?? null;
  const isRelationship = typeof profile?.is_relationship === "boolean" ? profile.is_relationship : null;
  const invitationType = normalizeNullableString(profile?.invitation?.type)?.toUpperCase() ?? null;
  const invitationStatus = normalizeNullableString(profile?.invitation?.status)?.toUpperCase() ?? null;
  const profileStatus = {
    networkDistance,
    isRelationship,
    invitationType,
    invitationStatus,
  };

  if (isRelationship === true || networkDistance === "FIRST_DEGREE" || invitationStatus === "ACCEPTED") {
    return { nextKind: "connection_request_accepted", profileStatus };
  }

  if (invitationType === "SENT" && invitationStatus === "PENDING") {
    return { nextKind: "connection_request_pending", profileStatus };
  }

  if (isRelationship === false && networkDistance && networkDistance !== "FIRST_DEGREE") {
    return { nextKind: "connection_request_not_accepted", profileStatus };
  }

  if (invitationStatus && invitationStatus !== "PENDING") {
    return { nextKind: "connection_request_not_accepted", profileStatus };
  }

  return { nextKind: null, profileStatus };
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
 * @param {"withdraw_connection" | "reject_connection_request" | "reconcile_connection_request_status"} taskKind
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

/** @param {number | null | undefined} value @param {number} fallback */
function normalizePositiveInteger(value, fallback) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}
