// @ts-check

import { probeRuntimeConnectorAvailability } from "./probe-user-harness-connections.js";

const DEFAULT_SUPPORTED_RUNTIMES = ["codex", "claude"];
const SYNTHETIC_TIMESTAMP = "1970-01-01T00:00:00.000Z";

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {{
 *   runtime?: string | null,
 *   connector: string,
 *   supportedRuntimes?: string[] | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null,
 *   multipleMessage?: ((choices: string[]) => string) | null
 * }} options
 */
export function resolveRuntimeHarnessConnection(user, options) {
  const runtimeFilter = normalizeNullableString(options.runtime)?.toLowerCase() ?? null;
  const connector = normalizeNullableString(options.connector)?.toLowerCase() ?? null;
  const supportedRuntimes = (options.supportedRuntimes ?? DEFAULT_SUPPORTED_RUNTIMES)
    .map((runtime) => normalizeNullableString(runtime)?.toLowerCase() ?? null)
    .filter(Boolean);

  if (!connector) {
    throw new Error("Runtime harness resolution requires a connector.");
  }

  if (runtimeFilter && !supportedRuntimes.includes(runtimeFilter)) {
    const supportedText = supportedRuntimes.join(", ");
    throw new Error(`Runtime ${runtimeFilter} is not supported here. Supported runtimes: ${supportedText}.`);
  }

  const stored = user.harnessConnections.filter((connection) =>
    supportedRuntimes.includes(connection.runtime.trim().toLowerCase())
    && connection.connector.trim().toLowerCase() === connector
    && (!runtimeFilter || connection.runtime.trim().toLowerCase() === runtimeFilter)
  );

  if (stored.length) {
    const selectedStored = selectStoredHarnessConnection(stored);
    if (!selectedStored) {
      const choices = stored.map((connection) => `${connection.runtime.trim().toLowerCase()}:${connection.connector.trim().toLowerCase()}`);
      throw new Error(options.multipleMessage ? options.multipleMessage(choices) : `Multiple supported harnesses exist (${choices.join(", ")}). Pass --runtime explicitly.`);
    }

    return {
      harnessConnection: selectedStored,
      probe: null,
      source: "stored_harness_connection"
    };
  }

  const probeOptions = {
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  };
  const preferredRuntime = !runtimeFilter ? detectCurrentAgentRuntime() : null;
  if (preferredRuntime && supportedRuntimes.includes(preferredRuntime)) {
    const preferredProbe = probeRuntimeConnectorAvailability(preferredRuntime, connector, probeOptions);
    return {
      harnessConnection: {
        id: preferredProbe.connectionId,
        createdAt: SYNTHETIC_TIMESTAMP,
        updatedAt: SYNTHETIC_TIMESTAMP,
        runtime: preferredProbe.runtime,
        connector: preferredProbe.connector,
        label: preferredProbe.label,
        status: preferredProbe.detectedStatus,
        notes: null
      },
      probe: preferredProbe,
      source: "runtime_probe"
    };
  }

  const probes = (runtimeFilter ? [runtimeFilter] : supportedRuntimes).map((runtime) =>
    probeRuntimeConnectorAvailability(runtime, connector, probeOptions)
  );
  const selectedProbe = selectProbe(probes);
  if (!selectedProbe) {
    const supportedText = supportedRuntimes.join(", ");
    throw new Error(`No supported runtime probe exists for connector ${connector}. Supported runtimes: ${supportedText}.`);
  }

  return {
    harnessConnection: {
      id: selectedProbe.connectionId,
      createdAt: SYNTHETIC_TIMESTAMP,
      updatedAt: SYNTHETIC_TIMESTAMP,
      runtime: selectedProbe.runtime,
      connector: selectedProbe.connector,
      label: selectedProbe.label,
      status: selectedProbe.detectedStatus,
      notes: null
    },
    probe: selectedProbe,
    source: "runtime_probe"
  };
}

/**
 * @param {import("../schema/user.js").userHarnessConnectionSchema._type[]} connections
 */
function selectStoredHarnessConnection(connections) {
  if (connections.length === 1) {
    return connections[0];
  }

  const preferredRuntime = detectCurrentAgentRuntime();
  if (!preferredRuntime) {
    return null;
  }

  const matches = connections.filter((connection) => connection.runtime.trim().toLowerCase() === preferredRuntime);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * @param {ReturnType<typeof probeRuntimeConnectorAvailability>[]} probes
 */
function selectProbe(probes) {
  if (!probes.length) {
    return null;
  }

  const available = probes.filter((probe) => probe.detectedStatus === "available");
  if (available.length === 1) {
    return available[0];
  }

  const preferredRuntime = detectCurrentAgentRuntime();
  if (preferredRuntime) {
    const preferredAvailable = available.filter((probe) => probe.runtime.trim().toLowerCase() === preferredRuntime);
    if (preferredAvailable.length === 1) {
      return preferredAvailable[0];
    }

    const preferredAny = probes.filter((probe) => probe.runtime.trim().toLowerCase() === preferredRuntime);
    if (preferredAny.length === 1) {
      return preferredAny[0];
    }
  }

  return available[0] ?? probes[0];
}

function detectCurrentAgentRuntime() {
  return process.env.CODEX_SHELL === "1" ? "codex" : null;
}

/**
 * @param {unknown} value
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
