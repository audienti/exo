// @ts-check

import { listInboundSurfaceCatalog } from "../lib/inbound-surface-catalog.js";
import { inboundSurfaceStateSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { classifyInboundSurfaceFreshness } from "./user-inbound-sync.js";

/** @typedef {ReturnType<typeof listInboundSurfaceCatalog>[number]} InboundSurfaceDefinition */

export const ACCOUNT_CAPABILITY_HEALTH_STATUSES = [
  "checked",
  "unchecked",
  "stale",
  "failed",
  "unsupported",
  "disabled",
  "unconfigured",
];

const UNHEALTHY_SURFACE_STATUSES = new Set(["failed", "stale", "unchecked"]);
const STATUS_PRIORITY = ["failed", "stale", "unchecked"];

/**
 * Build a backend-owned account health view from connected account mappings,
 * configured inbound surfaces, and the last recorded sync facts.
 *
 * @param {unknown} rawUser
 * @param {{
 *   now?: string | null,
 *   surfaceCatalog?: InboundSurfaceDefinition[] | null
 * }} [options]
 */
export function buildAccountCapabilityHealth(rawUser, options = {}) {
  const user = userSchema.parse(rawUser);
  const now = options.now ?? new Date().toISOString();
  const surfaceCatalog = Array.isArray(options.surfaceCatalog) ? options.surfaceCatalog : null;
  const accounts = user.accounts.map((account) => buildConnectedAccountHealth(
    account,
    now,
    surfaceCatalog
      ? surfaceCatalog.filter((definition) => definition.capability === account.capability)
      : listInboundSurfaceCatalog({ capability: account.capability }),
  ));
  const byStatus = Object.fromEntries(ACCOUNT_CAPABILITY_HEALTH_STATUSES.map((status) => [status, 0]));

  for (const account of accounts) {
    byStatus[account.status] += 1;
  }

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner,
    },
    generatedAt: now,
    counts: {
      accountCount: accounts.length,
      healthyAccountCount: accounts.filter((account) => account.healthy).length,
      unhealthyAccountCount: accounts.filter((account) => !account.healthy).length,
      byStatus,
    },
    accounts,
  };
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {string} now
 * @param {InboundSurfaceDefinition[]} definitions
 */
function buildConnectedAccountHealth(account, now, definitions) {
  if (definitions.length === 0) {
    return buildAccountHealthResult(account, {
      status: "unsupported",
      healthy: true,
      reason: "No backend inbound surfaces are defined for this account capability.",
      surfaces: [],
    });
  }

  const surfaces = materializeAccountSurfaces(account, definitions)
    .map(({ definition, state, explicitlyConfigured }) =>
      buildSurfaceHealth(definition, state, { explicitlyConfigured, now })
    );
  const enabledSurfaces = surfaces.filter((surface) => surface.enabled);

  if (enabledSurfaces.length === 0) {
    const status = surfaces.some((surface) => surface.explicitlyConfigured && surface.status === "disabled")
      ? "disabled"
      : "unconfigured";
    return buildAccountHealthResult(account, {
      status,
      healthy: true,
      reason: status === "disabled"
        ? "All backend inbound surfaces are disabled for this account."
        : "Backend inbound surfaces exist for this account capability, but none are enabled.",
      surfaces,
    });
  }

  const unhealthySurfaceCount = surfaces.filter((surface) => UNHEALTHY_SURFACE_STATUSES.has(surface.status)).length;
  const priorityStatus = STATUS_PRIORITY.find((status) => surfaces.some((surface) => surface.status === status));
  const onlyUnsupportedEnabledSurfaces = enabledSurfaces.every((surface) => surface.status === "unsupported");
  const status = priorityStatus ?? (onlyUnsupportedEnabledSurfaces ? "unsupported" : "checked");

  return buildAccountHealthResult(account, {
    status,
    healthy: unhealthySurfaceCount === 0,
    reason: describeAccountHealth(status, unhealthySurfaceCount),
    surfaces,
  });
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {{ status: string, healthy: boolean, reason: string, surfaces: ReturnType<typeof buildSurfaceHealth>[] }} health
 */
function buildAccountHealthResult(account, health) {
  const unhealthySurfaceCount = health.surfaces.filter((surface) => UNHEALTHY_SURFACE_STATUSES.has(surface.status)).length;

  return {
    accountId: account.id,
    capability: account.capability,
    handle: account.handle,
    label: account.label,
    preferred: account.preferred,
    sourceType: account.sourceType,
    status: health.status,
    healthy: health.healthy,
    reason: health.reason,
    surfaceCount: health.surfaces.length,
    enabledSurfaceCount: health.surfaces.filter((surface) => surface.enabled).length,
    disabledSurfaceCount: health.surfaces.filter((surface) => surface.status === "disabled").length,
    unhealthySurfaceCount,
    surfaces: health.surfaces,
  };
}

/**
 * @param {InboundSurfaceDefinition} definition
 * @param {import("../schema/inbound.js").inboundSurfaceStateSchema._type} state
 * @param {{ explicitlyConfigured: boolean, now: string }} input
 */
function buildSurfaceHealth(definition, state, input) {
  const base = {
    key: definition.key,
    label: definition.label,
    capability: definition.capability,
    truthLevel: definition.truthLevel,
    retrievalMode: definition.retrievalMode,
    autonomousBackgroundRetrieval: definition.autonomousBackgroundRetrieval !== false,
    enabled: state.enabled,
    explicitlyConfigured: input.explicitlyConfigured,
    lastRunStatus: state.lastRunStatus,
    lastSyncedAt: state.lastSyncedAt,
    lastObservedAt: state.lastObservedAt,
    lastError: state.lastError,
  };

  if (!state.enabled) {
    return {
      ...base,
      status: "disabled",
      healthy: true,
      reason: "This backend inbound surface is disabled by account policy.",
    };
  }

  if (definition.autonomousBackgroundRetrieval === false || isBackendSurfaceUnsupported(state)) {
    return {
      ...base,
      status: "unsupported",
      healthy: true,
      reason: "This backend inbound surface is not currently supported for autonomous checking.",
    };
  }

  if (state.lastRunStatus === "failed") {
    return {
      ...base,
      status: "failed",
      healthy: false,
      reason: "The last backend check failed.",
    };
  }

  const freshness = classifyInboundSurfaceFreshness({
    ...state,
    key: definition.key,
    automationCadenceMs: definition.automationCadenceMs,
  }, input.now);

  if (freshness) {
    const status = freshness.reason === "never"
      ? "unchecked"
      : freshness.reason === "failed"
        ? "failed"
        : "stale";
    return {
      ...base,
      status,
      healthy: false,
      reason: describeSurfaceFreshness(status, freshness.reason),
      dueAt: freshness.dueAt,
    };
  }

  return {
    ...base,
    status: "checked",
    healthy: true,
    reason: "This backend inbound surface has fresh checked facts.",
  };
}

/**
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {InboundSurfaceDefinition[]} definitions
 */
function materializeAccountSurfaces(account, definitions) {
  const configuredStates = new Map((account.inboundSync?.surfaces ?? []).map((surface) => [surface.surfaceKey, surface]));

  return definitions.map((definition) => {
    const configured = configuredStates.get(definition.key);
    return {
      definition,
      explicitlyConfigured: Boolean(configured),
      state: inboundSurfaceStateSchema.parse({
        ...configured,
        surfaceKey: definition.key,
        enabled: configured?.enabled ?? definition.defaultEnabled,
      }),
    };
  });
}

/**
 * @param {string} status
 * @param {number} unhealthySurfaceCount
 */
function describeAccountHealth(status, unhealthySurfaceCount) {
  switch (status) {
    case "checked":
      return "All enabled supported backend inbound surfaces have fresh checked facts.";
    case "failed":
      return `${unhealthySurfaceCount} enabled backend inbound surface failed its last check.`;
    case "stale":
      return `${unhealthySurfaceCount} enabled backend inbound surface is stale or partial.`;
    case "unchecked":
      return `${unhealthySurfaceCount} enabled backend inbound surface has not been checked yet.`;
    case "unsupported":
      return "Enabled backend inbound surfaces exist, but none are currently supported for autonomous checking.";
    default:
      return "Backend account capability health is available.";
  }
}

/**
 * @param {string} status
 * @param {string} freshnessReason
 */
function describeSurfaceFreshness(status, freshnessReason) {
  if (status === "unchecked") {
    return "This enabled backend inbound surface has never been checked.";
  }
  if (status === "failed") {
    return "The last backend check failed.";
  }
  if (freshnessReason === "warning") {
    return "The last backend check completed with a warning, so facts may be partial.";
  }
  return "This enabled backend inbound surface is older than its freshness window.";
}

/**
 * @param {{
 *   lastExhaustionStatus?: string | null,
 *   lastExhaustionReason?: string | null,
 *   lastError?: string | null,
 * }} surface
 */
function isBackendSurfaceUnsupported(surface) {
  const exhaustionStatus = String(surface?.lastExhaustionStatus ?? "").trim().toLowerCase();
  const exhaustionReason = String(surface?.lastExhaustionReason ?? "").trim().toLowerCase();
  const lastError = String(surface?.lastError ?? "").trim().toLowerCase();

  if (exhaustionStatus !== "blocked") {
    return false;
  }

  return exhaustionReason === "connector_surface_unsupported"
    || lastError.includes("feature_not_implemented");
}
