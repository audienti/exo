// @ts-check

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getHomeStateDir } from "../db/paths.js";
import { readUnipileConfig } from "../lib/unipile-config.js";
const DEFAULT_RUNTIME_ACCOUNT_HINTS_FILENAME = "runtime-account-hints.json";

/**
 * @typedef {{
 *   runtime: string,
 *   connector: string,
 *   capability: string,
 *   providerAccountId: string | null,
 *   handle: string | null,
 *   label: string | null,
 *   identityState: "confirmed" | "unresolved" | "session_unavailable",
 *   reason: string,
 *   metadata?: Record<string, unknown> | null
 * }} RuntimeConnectorAccountIdentity
 */

/**
 * @param {{
 *   runtime: string,
 *   connector: string,
 *   capability: string,
 *   codexHome?: string | null | undefined,
 *   hints?: unknown[] | null | undefined,
 *   httpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null | undefined
 * }} input
 * @returns {RuntimeConnectorAccountIdentity[]}
 */
export function discoverRuntimeConnectorAccounts(input) {
  const runtime = normalizeRequiredString(input.runtime, "Runtime is required.");
  const connector = normalizeRequiredString(input.connector, "Connector is required.");
  const capability = normalizeRequiredString(input.capability, "Capability is required.");
  const normalizedRuntime = runtime.toLowerCase();
  const normalizedConnector = connector.toLowerCase();
  const normalizedCapability = capability.toLowerCase();

  const hinted = selectRuntimeAccountHints(input.hints ?? loadRuntimeAccountHints(input.codexHome ?? null), {
    runtime: normalizedRuntime,
    connector: normalizedConnector,
    capability: normalizedCapability,
  });
  if (hinted.length) {
    return hinted;
  }

  if (normalizedRuntime !== "codex") {
    return [];
  }

  if (normalizedConnector === "gmail") {
    return discoverCodexAppsLinkedAccounts({
      codexHome: input.codexHome ?? null,
      namespace: "codex_apps__gmail",
      connectorLabel: "Gmail",
      capability: normalizedCapability,
      identityNoun: "mailbox",
    });
  }

  if (normalizedConnector === "hubspot") {
    return discoverCodexAppsLinkedAccounts({
      codexHome: input.codexHome ?? null,
      namespace: "codex_apps__hubspot",
      connectorLabel: "HubSpot",
      capability: normalizedCapability,
      identityNoun: "portal",
    });
  }

  if (normalizedConnector === "unipile" && (normalizedCapability === "linkedin" || normalizedCapability === "gmail")) {
    return discoverCodexUnipileAccounts({
      capability: normalizedCapability,
      codexHome: input.codexHome ?? null,
      httpGetImpl: input.httpGetImpl ?? null,
    });
  }

  return [];
}

/**
 * @param {unknown[] | null | undefined} rawHints
 * @param {{ runtime: string, connector: string, capability: string }} filter
 * @returns {RuntimeConnectorAccountIdentity[]}
 */
function selectRuntimeAccountHints(rawHints, filter) {
  if (!Array.isArray(rawHints)) {
    return [];
  }

  return rawHints.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const runtime = normalizeNullableString(item.runtime)?.toLowerCase() ?? null;
    const connector = normalizeNullableString(item.connector)?.toLowerCase() ?? null;
    const capability = normalizeNullableString(item.capability)?.toLowerCase() ?? null;
    if (runtime !== filter.runtime || connector !== filter.connector || capability !== filter.capability) {
      return [];
    }

    return [{
      runtime: filter.runtime,
      connector: filter.connector,
      capability: filter.capability,
      providerAccountId: normalizeNullableString(item.providerAccountId) ?? normalizeNullableString(item.externalAccountId) ?? null,
      handle: normalizeNullableString(item.handle) ?? null,
      label: normalizeNullableString(item.label) ?? null,
      identityState: "confirmed",
      reason: normalizeNullableString(item.reason) ?? `Resolved ${filter.capability} identity through runtime hints for ${filter.runtime}:${filter.connector}.`,
      metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : null,
    }];
  });
}

/**
 * @param {string | null | undefined} codexHome
 * @returns {unknown[]}
 */
function loadRuntimeAccountHints(codexHome) {
  const raw = normalizeNullableString(process.env.EXO_RUNTIME_ACCOUNT_HINTS);
  if (raw) {
    const parsed = coerceRuntimeAccountHintsPayload(parseJson(raw));
    if (parsed.length) {
      return parsed;
    }
  }

  return readRuntimeAccountHintsFile(codexHome);
}

/**
 * @param {string | null | undefined} codexHome
 * @returns {unknown[]}
 */
function readRuntimeAccountHintsFile(codexHome) {
  for (const filePath of listRuntimeAccountHintPaths(codexHome)) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const parsed = coerceRuntimeAccountHintsPayload(parseJson(fs.readFileSync(filePath, "utf8")));
    if (parsed.length) {
      return parsed;
    }
  }

  return [];
}

/**
 * @param {string | null | undefined} codexHome
 * @returns {string[]}
 */
function listRuntimeAccountHintPaths(codexHome) {
  const explicitPath = normalizeNullableString(process.env.EXO_RUNTIME_ACCOUNT_HINTS_PATH);
  const codexDir = normalizeNullableString(codexHome)
    ?? normalizeNullableString(process.env.CODEX_HOME)
    ?? path.join(os.homedir(), ".codex");

  return Array.from(new Set([
    ...(explicitPath ? [path.resolve(explicitPath)] : []),
    path.join(getHomeStateDir(), DEFAULT_RUNTIME_ACCOUNT_HINTS_FILENAME),
    path.join(codexDir, DEFAULT_RUNTIME_ACCOUNT_HINTS_FILENAME),
  ]));
}

/**
 * @param {any} parsed
 * @returns {unknown[]}
 */
function coerceRuntimeAccountHintsPayload(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  for (const key of ["accounts", "hints", "items"]) {
    if (Array.isArray(parsed[key])) {
      return parsed[key];
    }
  }

  return [];
}

/**
 * @param {{
 *   codexHome?: string | null | undefined,
 *   namespace: string,
 *   connectorLabel: string,
 *   capability: string,
 *   identityNoun: string
 * }} input
 * @returns {RuntimeConnectorAccountIdentity[]}
 */
function discoverCodexAppsLinkedAccounts(input) {
  const links = listCodexAppLinks(input.codexHome ?? null, input.namespace);
  if (!links.length) {
    return [];
  }

  const multiple = links.length > 1;
  return links.map((link, index) => {
    const ref = shortOpaqueId(link.linkId ?? link.connectorId ?? `${index + 1}`);
    return {
      runtime: "codex",
      connector: normalizeNamespaceConnector(input.namespace),
      capability: input.capability,
      providerAccountId: link.linkId ?? link.connectorId ?? null,
      handle: null,
      label: multiple ? `${input.connectorLabel} linked account ${index + 1}` : `Connected ${input.connectorLabel} account`,
      identityState: "unresolved",
      reason: `${input.connectorLabel} is linked in Codex (${ref}), but the local runtime does not expose which ${input.identityNoun} that link represents.`,
      metadata: {
        linkId: link.linkId,
        connectorId: link.connectorId,
        resourceUri: link.resourceUri,
      },
    };
  });
}

/**
 * @param {{
 *   codexHome?: string | null | undefined,
 *   httpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null | undefined
 * }} input
 *   capability: string,
 * }} input
 * @returns {RuntimeConnectorAccountIdentity[]}
 */
function discoverCodexUnipileAccounts(input) {
  const { apiKey, baseUrl } = readUnipileConfig(input.codexHome ?? null);
  if (!apiKey) {
    return [buildUnipileFallbackIdentity(
      input.capability,
      "unresolved",
      `Unipile is configured in Codex, but no local API key was found to inspect connected ${describeUnipileCapabilityTarget(input.capability)} yet.`,
      null,
    )];
  }

  return readUnipileAccounts(input.httpGetImpl ?? null, apiKey, input.capability, baseUrl);
}

/**
 * @param {((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null} httpGetImpl
 * @param {string} apiKey
 * @param {string} capability
 * @param {string} baseUrl
 * @returns {RuntimeConnectorAccountIdentity[]}
 */
function readUnipileAccounts(httpGetImpl, apiKey, capability, baseUrl) {
  const url = new URL("/api/v1/accounts", baseUrl);
  url.searchParams.set("limit", "250");

  const response = httpGetImpl
    ? httpGetImpl(url.toString(), { "X-API-KEY": apiKey })
    : execHttpGet(url.toString(), { "X-API-KEY": apiKey });
  if (!response) {
    return [buildUnipileFallbackIdentity(
      capability,
      "unresolved",
      "Unipile account discovery failed before a response was returned.",
      null,
    )];
  }

  const parsed = parseJson(response.bodyText);
  if (response.status === 503 && parsed?.type === "errors/no_client_session") {
    return [buildUnipileFallbackIdentity(
      capability,
      "session_unavailable",
      `Unipile is configured, but no live client session is running, so Exo cannot inspect the connected ${describeUnipileCapabilityTarget(capability)} yet.`,
      {
        status: response.status,
        type: parsed.type,
      },
    )];
  }

  if (response.status < 200 || response.status >= 300 || !parsed || !Array.isArray(parsed.items)) {
    return [buildUnipileFallbackIdentity(
      capability,
      "unresolved",
      buildUnipileFailureReason(response.status, parsed),
      {
        status: response.status,
        type: parsed?.type ?? null,
      },
    )];
  }

  const accounts = selectUnipileCapabilityAccounts(parsed.items, capability);

  if (accounts.length) {
    return accounts;
  }

  return [buildUnipileFallbackIdentity(
    capability,
    "unresolved",
    `Unipile responded, but no connected ${describeUnipileCapabilityTarget(capability)} were returned.`,
    {
      status: response.status,
    },
  )];
}

/**
 * @param {any[]} items
 * @param {string} capability
 * @returns {RuntimeConnectorAccountIdentity[]}
 */
function selectUnipileCapabilityAccounts(items, capability) {
  if (capability === "linkedin") {
    return items
      .filter((item) => item?.type === "LINKEDIN")
      .map((item) => {
        const im = item?.connection_params?.im ?? {};
        const handle = normalizeNullableString(im.publicIdentifier)
          ?? normalizeNullableString(im.username)
          ?? normalizeNullableString(im.id)
          ?? null;
        const label = normalizeNullableString(item.name)
          ?? normalizeNullableString(im.username)
          ?? normalizeNullableString(im.publicIdentifier)
          ?? "LinkedIn via Unipile";
        // Unipile reports the plan tier under connection_params.im. The key is
        // present even for free accounts (an empty array), so a present-but-empty
        // list means "verified free tier" while an absent key means unverified.
        const rawPremiumFeatures = Array.isArray(im?.premiumFeatures)
          ? im.premiumFeatures
          : Array.isArray(item?.premiumFeatures)
            ? item.premiumFeatures
            : null;
        const premiumId = normalizeNullableString(im?.premiumId);
        const metadata = {
          accountType: item.type ?? null,
          publicIdentifier: normalizeNullableString(im.publicIdentifier) ?? null,
          username: normalizeNullableString(im.username) ?? null,
        };
        if (rawPremiumFeatures) {
          metadata.premiumFeatures = rawPremiumFeatures
            .map((feature) => normalizeNullableString(feature))
            .filter(Boolean);
        }
        if (premiumId) {
          metadata.isPremium = true;
        }
        return {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: normalizeNullableString(item.id) ?? null,
          handle,
          label,
          identityState: "confirmed",
          reason: `Resolved LinkedIn account identity from Unipile for ${label}.`,
          metadata,
        };
      });
  }

  if (capability === "gmail") {
    return items.flatMap((item) => {
      const accountType = normalizeNullableString(item?.type)?.toUpperCase() ?? null;
      const mail = item?.connection_params?.mail ?? {};
      const handle = normalizeNullableString(mail.username)
        ?? normalizeNullableString(mail.imap_user)
        ?? normalizeNullableString(mail.smtp_user)
        ?? normalizeNullableString(mail.id)
        ?? null;

      if (!handle) {
        return [];
      }

      if (accountType !== "GOOGLE_OAUTH" && accountType !== "MAIL") {
        return [];
      }

      const label = normalizeNullableString(item.name)
        ?? normalizeNullableString(mail.username)
        ?? normalizeNullableString(mail.imap_user)
        ?? "Mail via Unipile";
      return [{
        runtime: "codex",
        connector: "unipile",
        capability: "gmail",
        providerAccountId: normalizeNullableString(item.id) ?? null,
        handle,
        label,
        identityState: "confirmed",
        reason: `Resolved mail account identity from Unipile for ${handle}.`,
        metadata: {
          accountType,
          mailId: normalizeNullableString(mail.id) ?? null,
          username: normalizeNullableString(mail.username) ?? null,
          imapUser: normalizeNullableString(mail.imap_user) ?? null,
          smtpUser: normalizeNullableString(mail.smtp_user) ?? null,
        },
      }];
    });
  }

  return [];
}

/**
 * @param {string} capability
 * @param {"confirmed" | "unresolved" | "session_unavailable"} identityState
 * @param {string} reason
 * @param {Record<string, unknown> | null} metadata
 * @returns {RuntimeConnectorAccountIdentity}
 */
function buildUnipileFallbackIdentity(capability, identityState, reason, metadata) {
  return {
    runtime: "codex",
    connector: "unipile",
    capability,
    providerAccountId: null,
    handle: null,
    label: defaultUnipileCapabilityLabel(capability),
    identityState,
    reason,
    metadata,
  };
}

/**
 * @param {string} capability
 */
function defaultUnipileCapabilityLabel(capability) {
  if (capability === "gmail") {
    return "Mail via Unipile";
  }
  if (capability === "linkedin") {
    return "LinkedIn via Unipile";
  }
  return `${capability} via Unipile`;
}

/**
 * @param {string} capability
 */
function describeUnipileCapabilityTarget(capability) {
  if (capability === "gmail") {
    return "mail accounts";
  }
  if (capability === "linkedin") {
    return "LinkedIn accounts";
  }
  return `${capability} accounts`;
}

/**
 * @param {number} status
 * @param {any} parsed
 */
function buildUnipileFailureReason(status, parsed) {
  const title = normalizeNullableString(parsed?.title);
  const type = normalizeNullableString(parsed?.type);
  if (title && type) {
    return `Unipile account discovery failed with ${status} ${type}: ${title}.`;
  }
  if (title) {
    return `Unipile account discovery failed with ${status}: ${title}.`;
  }
  return `Unipile account discovery failed with status ${status}.`;
}

function execHttpGet(url, headers) {
  const headerArgs = Object.entries(headers).flatMap(([name, value]) => ["-H", `${name}: ${value}`]);
  try {
    const raw = execFileSync("curl", [
      "-sS",
      "-L",
      ...headerArgs,
      "-w",
      "\n__EXO_STATUS__:%{http_code}",
      url,
    ], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    const marker = "\n__EXO_STATUS__:";
    const index = raw.lastIndexOf(marker);
    if (index === -1) {
      return null;
    }
    const bodyText = raw.slice(0, index);
    const status = Number(raw.slice(index + marker.length).trim());
    return Number.isFinite(status) ? { status, bodyText } : null;
  } catch (_error) {
    return null;
  }
}

/**
 * @param {string | null | undefined} codexHome
 * @param {string} namespace
 * @returns {Array<{ linkId: string | null, connectorId: string | null, resourceUri: string | null }>}
 */
function listCodexAppLinks(codexHome, namespace) {
  const home = normalizeNullableString(codexHome)
    ?? normalizeNullableString(process.env.CODEX_HOME)
    ?? path.join(os.homedir(), ".codex");
  const cacheDir = path.join(home, "cache", "codex_apps_tools");
  if (!fs.existsSync(cacheDir)) {
    return [];
  }

  /** @type {Map<string, { linkId: string | null, connectorId: string | null, resourceUri: string | null }>} */
  const links = new Map();
  for (const entry of fs.readdirSync(cacheDir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(cacheDir, entry);
    const parsed = parseJson(fs.readFileSync(filePath, "utf8"));
    const tools = Array.isArray(parsed?.tools) ? parsed.tools : [];
    for (const tool of tools) {
      if (tool?.tool_namespace !== namespace) {
        continue;
      }
      const meta = tool?.tool?._meta ?? {};
      const linkId = normalizeNullableString(meta.link_id) ?? null;
      const connectorId = normalizeNullableString(meta.connector_id ?? tool?.connector_id) ?? null;
      const resourceUri = normalizeNullableString(meta?._codex_apps?.resource_uri) ?? null;
      const key = `${connectorId ?? "connector"}:${linkId ?? resourceUri ?? "link"}`;
      links.set(key, {
        linkId,
        connectorId,
        resourceUri,
      });
    }
  }

  return Array.from(links.values());
}

/**
 * @param {string} namespace
 */
function normalizeNamespaceConnector(namespace) {
  return namespace.replace(/^codex_apps__/, "").replace(/__legacy$/, "");
}

/**
 * @param {string | null | undefined} value
 */
function shortOpaqueId(value) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return "unknown";
  }
  if (normalized.length <= 8) {
    return normalized;
  }
  return `${normalized.slice(0, 4)}…${normalized.slice(-4)}`;
}

/**
 * @param {string} raw
 * @returns {any}
 */
function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

/**
 * @param {string | null | undefined} value
 * @param {string} message
 */
function normalizeRequiredString(value, message) {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
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
