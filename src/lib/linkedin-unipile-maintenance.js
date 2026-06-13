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
  const baseUrl = normalizeNullableString(options.baseUrl) ?? config.baseUrl;
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
 * @param {"withdraw_connection" | "accept_connection_request" | "reject_connection_request" | "reconcile_connection_request_status"} taskKind
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

/** @param {number | null | undefined} value @param {number} fallback */
function normalizePositiveInteger(value, fallback) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}
