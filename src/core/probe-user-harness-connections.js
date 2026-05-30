// @ts-check

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { upsertUserHarnessConnection } from "./upsert-user-harness-connection.js";
import { userSchema } from "../schema/user.js";

const CODEX_PLUGIN_CONNECTOR_MAP = {
  browser: ["browser@openai-bundled"],
  "browser-use": ["browser@openai-bundled"],
  canva: ["canva@openai-curated"],
  chrome: ["chrome@openai-bundled"],
  coderabbit: ["coderabbit@openai-curated"],
  documents: ["documents@openai-primary-runtime"],
  expo: ["expo@openai-curated"],
  figma: ["figma@openai-curated"],
  github: ["github@openai-curated"],
  gmail: ["gmail@openai-curated"],
  "google-calendar": ["google-calendar@openai-curated"],
  "google-drive": ["google-drive@openai-curated"],
  hubspot: ["hubspot@openai-curated"],
  netlify: ["netlify@openai-curated"],
  notion: ["notion@openai-curated"],
  posthog: ["posthog", "posthog@posthog"],
  presentations: ["presentations@openai-primary-runtime"],
  slack: ["slack@openai-curated"],
  spreadsheets: ["spreadsheets@openai-primary-runtime"],
  superpowers: ["superpowers@openai-curated"]
};

const CLAUDE_PLUGIN_CONNECTOR_MAP = {
  chrome: ["chrome-devtools-mcp@claude-plugins-official", "chrome-devtools-mcp", "chrome-devtools", "chrome"],
  gmail: ["gmail"]
};

/**
 * @param {unknown} rawUser
 * @param {{
 *   runtime?: string | null | undefined,
 *   connector?: string | null | undefined,
 *   writeback?: boolean | undefined,
 *   codexHome?: string | null | undefined,
 *   claudeCli?: string | null | undefined
 * }} [options]
 */
export function probeUserHarnessConnections(rawUser, options = {}) {
  const user = userSchema.parse(rawUser);
  const inspectedAt = new Date().toISOString();
  const runtimeFilter = normalizeNullableString(options.runtime)?.toLowerCase() ?? null;
  const connectorFilter = normalizeNullableString(options.connector)?.toLowerCase() ?? null;
  const selectedConnections = user.harnessConnections.filter((connection) =>
    (!runtimeFilter || connection.runtime.toLowerCase() === runtimeFilter)
    && (!connectorFilter || connection.connector.toLowerCase() === connectorFilter)
  );

  let updatedUser = user;
  const probes = selectedConnections.map((connection) => {
    const probe = probeHarnessConnection(connection, {
      codexHome: options.codexHome ?? null,
      claudeCli: options.claudeCli ?? null
    });

    if (options.writeback && probe.detectedStatus !== connection.status) {
      updatedUser = upsertUserHarnessConnection(updatedUser, {
        runtime: connection.runtime,
        connector: connection.connector,
        label: connection.label,
        notes: connection.notes,
        status: probe.detectedStatus
      });
    }

    return probe;
  });

  return {
    user: {
      id: updatedUser.id,
      label: updatedUser.label,
      owner: updatedUser.owner
    },
    inspectedAt,
    filters: {
      runtime: runtimeFilter,
      connector: connectorFilter
    },
    counts: {
      connectionCount: probes.length,
      availableCount: probes.filter((probe) => probe.detectedStatus === "available").length,
      unavailableCount: probes.filter((probe) => probe.detectedStatus === "unavailable").length,
      unknownCount: probes.filter((probe) => probe.detectedStatus === "unknown").length,
      updatedCount: probes.filter((probe) => probe.willWriteback).length
    },
    probes,
    updatedUser
  };
}

/**
 * @param {string} runtime
 * @param {string} connector
 * @param {{ codexHome?: string | null | undefined, claudeCli?: string | null | undefined }} [options]
 */
export function probeRuntimeConnectorAvailability(runtime, connector, options = {}) {
  const normalizedRuntime = normalizeNullableString(runtime) ?? "";
  const normalizedConnector = normalizeNullableString(connector) ?? "";

  return probeHarnessConnection(
    {
      id: `runtime-probe:${normalizedRuntime}:${normalizedConnector}`,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      runtime: normalizedRuntime,
      connector: normalizedConnector,
      label: null,
      status: "unknown",
      notes: null
    },
    options
  );
}

/**
 * @param {import("../schema/user.js").userHarnessConnectionSchema._type} connection
 * @param {{ codexHome?: string | null | undefined, claudeCli?: string | null | undefined }} [options]
 */
function probeHarnessConnection(connection, options = {}) {
  const runtime = connection.runtime.trim().toLowerCase();

  if (runtime === "codex") {
    return probeCodexHarnessConnection(connection, options);
  }

  if (runtime === "claude") {
    return probeClaudeHarnessConnection(connection, options);
  }

  return {
    connectionId: connection.id,
    runtime: connection.runtime,
    connector: connection.connector,
    label: connection.label,
    storedStatus: connection.status,
    detectedStatus: "unknown",
    willWriteback: false,
    supported: false,
    source: {
      kind: "runtime-probe",
      path: null
    },
    reason: `No runtime probe is implemented for ${connection.runtime} yet.`,
    evidence: []
  };
}

/**
 * @param {import("../schema/user.js").userHarnessConnectionSchema._type} connection
 * @param {{ codexHome?: string | null | undefined }} [options]
 */
function probeCodexHarnessConnection(connection, options = {}) {
  const codexHome = normalizeNullableString(options.codexHome)
    ?? normalizeNullableString(process.env.CODEX_HOME)
    ?? path.join(os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  const base = {
    connectionId: connection.id,
    runtime: connection.runtime,
    connector: connection.connector,
    label: connection.label,
    storedStatus: connection.status,
    source: {
      kind: "codex-config",
      path: configPath
    }
  };

  if (!fs.existsSync(configPath)) {
    return {
      ...base,
      detectedStatus: "unknown",
      willWriteback: false,
      supported: true,
      reason: `Codex config was not found at ${configPath}.`,
      evidence: []
    };
  }

  const summary = readCodexConfigSummary(configPath);
  const pluginProbe = findCodexPluginProbe(connection.connector, summary.plugins);
  if (pluginProbe) {
    return {
      ...base,
      detectedStatus: pluginProbe.enabled ? "available" : "unavailable",
      willWriteback: connection.status !== (pluginProbe.enabled ? "available" : "unavailable"),
      supported: true,
      reason: pluginProbe.enabled
        ? `Codex plugin ${pluginProbe.pluginId} is enabled for ${connection.connector}.`
        : `Codex plugin ${pluginProbe.pluginId} is disabled for ${connection.connector}.`,
      evidence: [`plugin:${pluginProbe.pluginId} enabled=${pluginProbe.enabled}`]
    };
  }

  const mcpProbe = findCodexMcpProbe(connection.connector, summary.mcpServers);
  if (mcpProbe) {
    return {
      ...base,
      detectedStatus: mcpProbe.enabled ? "available" : "unavailable",
      willWriteback: connection.status !== (mcpProbe.enabled ? "available" : "unavailable"),
      supported: true,
      reason: mcpProbe.enabled
        ? `Codex MCP server ${mcpProbe.serverName} is enabled for ${connection.connector}.`
        : `Codex MCP server ${mcpProbe.serverName} is disabled for ${connection.connector}.`,
      evidence: [`mcp_server:${mcpProbe.serverName} enabled=${mcpProbe.enabled}`]
    };
  }

  return {
    ...base,
    detectedStatus: "unknown",
    willWriteback: false,
    supported: true,
    reason: `No Codex plugin or MCP server mapping is defined for connector ${connection.connector}.`,
    evidence: []
  };
}

/**
 * @param {import("../schema/user.js").userHarnessConnectionSchema._type} connection
 * @param {{ claudeCli?: string | null | undefined }} [options]
 */
function probeClaudeHarnessConnection(connection, options = {}) {
  const claudeCli = normalizeNullableString(options.claudeCli)
    ?? normalizeNullableString(process.env.EXO_CLAUDE_CLI)
    ?? "claude";
  const base = {
    connectionId: connection.id,
    runtime: connection.runtime,
    connector: connection.connector,
    label: connection.label,
    storedStatus: connection.status,
    source: {
      kind: "claude-cli",
      path: claudeCli
    }
  };

  let summary;
  try {
    summary = readClaudeRuntimeSummary(claudeCli);
  } catch (error) {
    return {
      ...base,
      detectedStatus: "unknown",
      willWriteback: false,
      supported: true,
      reason: error instanceof Error ? error.message : String(error),
      evidence: []
    };
  }

  const pluginProbe = findClaudePluginProbe(connection.connector, summary.plugins);
  if (pluginProbe) {
    return {
      ...base,
      detectedStatus: "available",
      willWriteback: connection.status !== "available",
      supported: true,
      reason: `Claude plugin ${pluginProbe.pluginId} is installed for ${connection.connector}.`,
      evidence: [`plugin:${pluginProbe.pluginId}`]
    };
  }

  const mcpProbe = findClaudeMcpProbe(connection.connector, summary.mcpServers);
  if (mcpProbe) {
    return {
      ...base,
      detectedStatus: "available",
      willWriteback: connection.status !== "available",
      supported: true,
      reason: `Claude MCP server ${mcpProbe.serverName} is available for ${connection.connector}.`,
      evidence: [`mcp_server:${mcpProbe.serverName}`]
    };
  }

  const candidates = CLAUDE_PLUGIN_CONNECTOR_MAP[connection.connector.trim().toLowerCase()] ?? [];
  const candidateText = candidates.length ? candidates.join(", ") : connection.connector;
  return {
    ...base,
    detectedStatus: "unavailable",
    willWriteback: connection.status !== "unavailable",
    supported: true,
    reason: `Claude runtime did not expose a plugin or MCP server matching ${candidateText} for ${connection.connector}.`,
    evidence: []
  };
}

/**
 * @param {string} configPath
 */
function readCodexConfigSummary(configPath) {
  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  /** @type {{ kind: "plugin" | "mcp", name: string } | null} */
  let currentSection = null;
  /** @type {Map<string, { pluginId: string, enabled: boolean }>} */
  const plugins = new Map();
  /** @type {Map<string, { serverName: string, enabled: boolean }>} */
  const mcpServers = new Map();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const pluginMatch = line.match(/^\[plugins\."([^"]+)"\]$/);
    if (pluginMatch) {
      currentSection = { kind: "plugin", name: pluginMatch[1] };
      continue;
    }

    const mcpMatch = line.match(/^\[mcp_servers\.([^.]+)\]$/);
    if (mcpMatch) {
      currentSection = { kind: "mcp", name: mcpMatch[1] };
      continue;
    }

    if (line.startsWith("[")) {
      currentSection = null;
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const enabledMatch = line.match(/^enabled\s*=\s*(true|false)\s*$/);
    if (!enabledMatch) {
      continue;
    }

    const enabled = enabledMatch[1] === "true";
    if (currentSection.kind === "plugin") {
      plugins.set(currentSection.name.toLowerCase(), {
        pluginId: currentSection.name,
        enabled
      });
      continue;
    }

    mcpServers.set(currentSection.name.toLowerCase(), {
      serverName: currentSection.name,
      enabled
    });
  }

  return { plugins, mcpServers };
}

/**
 * @param {string} connector
 * @param {Map<string, { pluginId: string, enabled: boolean }>} plugins
 */
function findCodexPluginProbe(connector, plugins) {
  const candidates = CODEX_PLUGIN_CONNECTOR_MAP[connector.trim().toLowerCase()] ?? [];
  for (const pluginId of candidates) {
    const match = plugins.get(pluginId.toLowerCase()) ?? null;
    if (match) {
      return match;
    }
  }

  return null;
}

/**
 * @param {string} connector
 * @param {Map<string, { serverName: string, enabled: boolean }>} mcpServers
 */
function findCodexMcpProbe(connector, mcpServers) {
  return mcpServers.get(connector.trim().toLowerCase()) ?? null;
}

/**
 * @param {string} claudeCli
 */
function readClaudeRuntimeSummary(claudeCli) {
  const pluginOutput = execFileSync(claudeCli, ["plugins", "list"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  const mcpOutput = execFileSync(claudeCli, ["mcp", "list"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });

  return {
    plugins: parseClaudePluginList(pluginOutput),
    mcpServers: parseClaudeMcpList(mcpOutput)
  };
}

/**
 * @param {string} output
 */
function parseClaudePluginList(output) {
  /** @type {Map<string, { pluginId: string, enabled: boolean }>} */
  const plugins = new Map();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^[❯*-]?\s*([a-z0-9._-]+(?:@[a-z0-9._-]+)?)$/i);
    if (!match) {
      continue;
    }

    const pluginId = match[1];
    plugins.set(pluginId.toLowerCase(), {
      pluginId,
      enabled: true
    });
    const basePluginId = pluginId.split("@")[0];
    if (basePluginId && basePluginId !== pluginId) {
      plugins.set(basePluginId.toLowerCase(), {
        pluginId,
        enabled: true
      });
    }
  }

  return plugins;
}

/**
 * @param {string} output
 */
function parseClaudeMcpList(output) {
  /** @type {Map<string, { serverName: string, enabled: boolean }>} */
  const mcpServers = new Map();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.length) {
      continue;
    }

    const pluginMatch = line.match(/^plugin:([^:]+):([^:]+):/i);
    if (pluginMatch) {
      const serverName = pluginMatch[2];
      mcpServers.set(serverName.toLowerCase(), {
        serverName,
        enabled: true
      });
      continue;
    }

    const directMatch = line.match(/^([a-z0-9._-]+)\s*:/i);
    if (directMatch) {
      const serverName = directMatch[1];
      mcpServers.set(serverName.toLowerCase(), {
        serverName,
        enabled: true
      });
    }
  }

  return mcpServers;
}

/**
 * @param {string} connector
 * @param {Map<string, { pluginId: string, enabled: boolean }>} plugins
 */
function findClaudePluginProbe(connector, plugins) {
  const candidates = CLAUDE_PLUGIN_CONNECTOR_MAP[connector.trim().toLowerCase()] ?? [];
  for (const pluginId of candidates) {
    const match = plugins.get(pluginId.toLowerCase()) ?? null;
    if (match) {
      return match;
    }
  }

  return null;
}

/**
 * @param {string} connector
 * @param {Map<string, { serverName: string, enabled: boolean }>} mcpServers
 */
function findClaudeMcpProbe(connector, mcpServers) {
  const candidates = CLAUDE_PLUGIN_CONNECTOR_MAP[connector.trim().toLowerCase()] ?? [];
  for (const candidate of candidates) {
    const match = mcpServers.get(candidate.toLowerCase()) ?? null;
    if (match) {
      return match;
    }
  }

  return null;
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
