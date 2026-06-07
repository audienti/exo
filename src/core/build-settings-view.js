// @ts-check

import { probeRuntimeConnectorAvailability } from "./probe-user-harness-connections.js";
import {
  readWorkspaceSettings,
  resolveWorkspaceEnrichmentPolicy,
  WORKSPACE_ENRICHMENT_PROVIDER_CATALOG,
} from "../lib/workspace-settings.js";

const HARNESS_TRUTH = {
  available: "checked",
  unavailable: "failed",
  unknown: "unchecked",
};

/**
 * @param {{
 *   settingsCwd?: string | null,
 *   runtimeAccountDiscovery?: {
 *     runtime: string,
 *     connector?: string | null,
 *     codexHome?: string | null,
 *     claudeCli?: string | null,
 *     runtimeAccountHints?: unknown[] | null
 *   } | null
 * }} [input]
 */
export function buildSettingsViewModel(input = {}) {
  const workspaceSettings = readWorkspaceSettings({ cwd: input.settingsCwd ?? process.cwd() });
  return {
    workspacePolicy: buildWorkspaceEnrichmentPolicyView(workspaceSettings, input.runtimeAccountDiscovery),
  };
}

/**
 * @param {string | null} reason
 */
function formatProviderProbeReason(reason) {
  if (!reason) {
    return "No runtime probe was requested for this provider.";
  }
  if (/No Codex plugin or MCP server mapping is defined/i.test(reason)) {
    return "The direct Codex plugin and MCP probe did not surface this provider in the current runtime.";
  }
  if (/Claude runtime did not expose a plugin or MCP server/i.test(reason)) {
    return "The direct Claude plugin and MCP probe did not surface this provider in the current runtime.";
  }
  return reason;
}

/**
 * @param {"available" | "unavailable" | "unknown"} status
 * @returns {string}
 */
function formatProviderRuntimeLabel(status) {
  if (status === "available") return "runtime checked";
  if (status === "unavailable") return "runtime not surfaced";
  return "runtime unprobed";
}

/**
 * @param {ReturnType<typeof readWorkspaceSettings>} settings
 * @param {{
 *   runtime: string,
 *   connector?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null,
 *   runtimeAccountHints?: unknown[] | null
 * } | null | undefined} runtimeOptions
 */
function buildWorkspaceEnrichmentPolicyView(settings, runtimeOptions) {
  const policy = resolveWorkspaceEnrichmentPolicy(settings);
  const byKey = new Map(
    WORKSPACE_ENRICHMENT_PROVIDER_CATALOG.map((provider) => [provider.key, provider]),
  );
  const runtime = runtimeOptions?.runtime ?? null;
  const probeOptions = {
    codexHome: runtimeOptions?.codexHome ?? null,
    claudeCli: runtimeOptions?.claudeCli ?? null,
  };

  return {
    path: settings.path,
    exists: settings.exists,
    runtime,
    emailProviders: shapePolicyProviders(policy.email.providers, "email", byKey, runtime, probeOptions),
    validators: shapePolicyProviders(policy.email.validators, "validation", byKey, runtime, probeOptions),
    phoneProviders: shapePolicyProviders(policy.phone.providers, "phone", byKey, runtime, probeOptions),
    phone: {
      mobileOnly: policy.phone.mobileOnly,
      preferWhatsappCapable: policy.phone.preferWhatsappCapable,
    },
  };
}

/**
 * @param {string[]} enabledProviders
 * @param {"email" | "phone" | "validation"} lane
 * @param {Map<string, { key: string, label: string, description: string, lanes: string[] }>} catalogByKey
 * @param {string | null} runtime
 * @param {{ codexHome?: string | null, claudeCli?: string | null }} probeOptions
 */
function shapePolicyProviders(enabledProviders, lane, catalogByKey, runtime, probeOptions) {
  const enabledSet = new Set(enabledProviders);
  const catalog = [...catalogByKey.values()].filter((provider) => provider.lanes.includes(lane));

  return catalog.map((provider) => {
    const probe = runtime
      ? probeRuntimeConnectorAvailability(runtime, provider.key, probeOptions)
      : null;
    const status = probe?.detectedStatus ?? "unknown";
    return {
      key: provider.key,
      label: provider.label,
      description: provider.description,
      enabled: enabledSet.has(provider.key),
      runtime,
      status,
      truth: HARNESS_TRUTH[status] ?? "unchecked",
      runtimeLabel: formatProviderRuntimeLabel(status),
      reason: formatProviderProbeReason(probe?.reason ?? null),
      toggleArgs: {
        lane,
        provider: provider.key,
        enabled: !enabledSet.has(provider.key),
      },
    };
  });
}
