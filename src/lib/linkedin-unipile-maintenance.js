// @ts-check

import { execFileSync } from "node:child_process";
import { findInboundObservationById, findUserById } from "../db/database.js";
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

  const invitationId = normalizeNullableString(observation.externalId);
  if (!invitationId) {
    return {
      status: "blocked",
      reason: `${task.kind} requires a native invitation id on observation ${observation.id}.`,
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

  if (task.kind === "withdraw_connection") {
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
 * @param {{
 *   method: "DELETE" | "POST",
 *   url: string,
 *   apiKey: string,
 *   bodyText?: string | undefined,
 *   httpDeleteImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpPostImpl?: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null,
 * }} input
 */
function requestUnipileJson(input) {
  try {
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
 * @param {"withdraw_connection" | "reject_connection_request"} taskKind
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
