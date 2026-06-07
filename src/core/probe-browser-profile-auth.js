// @ts-check

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodexCliCommand } from "../lib/codex-cli.js";
import {
  browserProfileAuthProbeResultSchema,
  browserProfileCapabilitySchema,
  browserProfileSchema
} from "../schema/browser-profile.js";
import { probeRuntimeConnectorAvailability } from "./probe-user-harness-connections.js";

const browserProfileAuthProbeOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "summary", "runtime", "checkedAt", "warnings", "capabilityChecks"],
  properties: {
    status: {
      type: "string",
      enum: ["untested", "ready", "warning", "invalid"]
    },
    summary: {
      type: "string",
      minLength: 1
    },
    runtime: {
      type: "string",
      minLength: 1
    },
    checkedAt: {
      type: "string",
      format: "date-time"
    },
    warnings: {
      type: "array",
      items: {
        type: "string"
      }
    },
    capabilityChecks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["capability", "verified", "details", "expectedHandle", "detectedHandle", "sourceUrl"],
        properties: {
          capability: {
            type: "string",
            enum: browserProfileCapabilitySchema.options
          },
          verified: {
            type: "boolean"
          },
          details: {
            type: "string",
            minLength: 1
          },
          expectedHandle: {
            type: ["string", "null"],
            minLength: 1
          },
          detectedHandle: {
            type: ["string", "null"],
            minLength: 1
          },
          sourceUrl: {
            type: ["string", "null"],
            minLength: 1
          }
        }
      }
    }
  }
};

/**
 * @param {unknown} rawProfile
 * @param {{
 *   runtime: string,
 *   codexCli?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null
 * }} input
 */
export async function probeBrowserProfileAuth(rawProfile, input) {
  const profile = browserProfileSchema.parse(rawProfile);
  const runtime = normalizeNullableString(input.runtime)?.toLowerCase() ?? "";
  if (!["codex", "claude"].includes(runtime)) {
    throw new Error(`Browser auth probe currently supports codex or claude runtimes, received ${input.runtime}.`);
  }

  if (profile.browser !== "chrome") {
    throw new Error(`Browser auth probe currently supports Chrome-backed profiles only. ${profile.label} is ${profile.browser}.`);
  }

  const capabilities = getAuthProbeCapabilities(profile);
  if (!capabilities.length) {
    throw new Error(`Browser profile ${profile.label} does not declare any browser-backed capabilities that need live auth checks.`);
  }

  const runtimeProbe = probeRuntimeConnectorAvailability(runtime, "chrome", {
    codexHome: input.codexHome ?? null,
    claudeCli: input.claudeCli ?? null
  });

  /** @type {import("../schema/browser-profile.js").browserProfileAuthProbeResultSchema._type} */
  let authResult;
  if (runtimeProbe.detectedStatus !== "available") {
    authResult = buildFailedAuthProbeResult(profile, runtime, capabilities, runtimeProbe.reason);
  } else {
    try {
      const captured = await captureBrowserProfileAuth({
        runtime,
        profile,
        capabilities,
        codexCli: resolveCodexCliCommand({ codexCli: input.codexCli ?? null }),
        codexHome: input.codexHome ?? normalizeNullableString(process.env.CODEX_HOME) ?? null,
        claudeCli: input.claudeCli ?? normalizeNullableString(process.env.EXO_CLAUDE_CLI) ?? "claude"
      });
      authResult = normalizeCapturedAuthProbe(profile, capabilities, runtime, captured);
    } catch (error) {
      authResult = buildFailedAuthProbeResult(
        profile,
        runtime,
        capabilities,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const updatedAt = new Date().toISOString();
  return browserProfileSchema.parse({
    ...profile,
    updatedAt,
    lastAuthProbedAt: authResult.checkedAt,
    lastAuthProbeResult: authResult
  });
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 */
function getAuthProbeCapabilities(profile) {
  return profile.capabilities.filter((capability) => capability !== "generic-web");
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 * @param {readonly import("../schema/browser-profile.js").browserProfileCapabilitySchema._type[]} capabilities
 * @param {string} runtime
 * @param {unknown} rawCapture
 */
function normalizeCapturedAuthProbe(profile, capabilities, runtime, rawCapture) {
  const parsed = browserProfileAuthProbeResultSchema.parse(rawCapture);
  const byCapability = new Map(parsed.capabilityChecks.map((check) => [check.capability, check]));
  const capabilityChecks = capabilities.map((capability) => {
    const existing = byCapability.get(capability) ?? {
      capability,
      verified: false,
      details: `Runtime ${runtime} did not return an auth check for ${capability}.`,
      expectedHandle: resolveExpectedHandle(profile, capability),
      detectedHandle: null,
      sourceUrl: null
    };

    if (!existing.expectedHandle && resolveExpectedHandle(profile, capability)) {
      existing.expectedHandle = resolveExpectedHandle(profile, capability);
    }

    if (existing.expectedHandle && existing.detectedHandle && !sameHandle(existing.expectedHandle, existing.detectedHandle)) {
      return {
        ...existing,
        verified: false,
        details: `${existing.details} Expected ${existing.expectedHandle} but detected ${existing.detectedHandle}.`
      };
    }

    return existing;
  });

  const computedStatus = capabilityChecks.every((check) => check.verified)
    ? "ready"
    : capabilityChecks.some((check) => check.verified)
      ? "warning"
      : "invalid";

  return browserProfileAuthProbeResultSchema.parse({
    ...parsed,
    runtime,
    status: stricterAuthProbeStatus(parsed.status, computedStatus),
    capabilityChecks
  });
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 * @param {readonly import("../schema/browser-profile.js").browserProfileCapabilitySchema._type[]} capabilities
 * @param {string} runtime
 * @param {string} reason
 */
function buildFailedAuthProbeResult(profile, runtime, capabilities, reason) {
  const checkedAt = new Date().toISOString();
  return browserProfileAuthProbeResultSchema.parse({
    status: "invalid",
    summary: `Live browser auth probe failed through ${runtime}.`,
    runtime,
    checkedAt,
    warnings: [],
    capabilityChecks: capabilities.map((capability) => ({
      capability,
      verified: false,
      details: reason,
      expectedHandle: resolveExpectedHandle(profile, capability),
      detectedHandle: null,
      sourceUrl: null
    }))
  });
}

/**
 * @param {{
 *   runtime: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type,
 *   capabilities: readonly import("../schema/browser-profile.js").browserProfileCapabilitySchema._type[],
 *   codexCli: string,
 *   codexHome: string | null,
 *   claudeCli: string
 * }} input
 */
async function captureBrowserProfileAuth(input) {
  if (input.runtime === "codex") {
    return captureBrowserProfileAuthThroughCodex(input);
  }

  if (input.runtime === "claude") {
    return captureBrowserProfileAuthThroughClaude(input);
  }

  throw new Error(`Browser auth probe is not implemented for runtime ${input.runtime}.`);
}

/**
 * @param {{
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type,
 *   capabilities: readonly import("../schema/browser-profile.js").browserProfileCapabilitySchema._type[],
 *   codexCli: string,
 *   codexHome: string | null
 * }} input
 */
async function captureBrowserProfileAuthThroughCodex(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-profile-auth-"));
  const schemaPath = path.join(tempDir, "profile-auth.schema.json");
  const outputPath = path.join(tempDir, "profile-auth.json");
  fs.writeFileSync(schemaPath, JSON.stringify(browserProfileAuthProbeOutputSchema, null, 2));

  try {
    const prompt = buildBrowserProfileAuthPrompt(input.profile, input.capabilities);
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ignore-rules",
      "--ephemeral",
      "--color",
      "never",
      "-C",
      tempDir,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      prompt
    ];
    const env = {
      ...process.env
    };
    if (input.codexHome) {
      env.CODEX_HOME = input.codexHome;
    }

    await execFileAsync(input.codexCli, args, {
      cwd: tempDir,
      env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
      killSignal: "SIGKILL"
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Codex browser auth probe did not produce an output file.");
    }

    return JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type,
 *   capabilities: readonly import("../schema/browser-profile.js").browserProfileCapabilitySchema._type[],
 *   claudeCli: string
 * }} input
 */
async function captureBrowserProfileAuthThroughClaude(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-profile-auth-claude-"));
  const schema = JSON.stringify(browserProfileAuthProbeOutputSchema);
  const prompt = buildBrowserProfileAuthPrompt(input.profile, input.capabilities);
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    schema,
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    prompt
  ];

  try {
    const { stdout } = await execFileAsync(input.claudeCli, args, {
      cwd: tempDir,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
      killSignal: "SIGKILL"
    });

    const parsed = JSON.parse(String(stdout));
    if (!parsed?.structured_output) {
      throw new Error("Claude browser auth probe did not return structured_output.");
    }

    return parsed.structured_output;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 * @param {readonly import("../schema/browser-profile.js").browserProfileCapabilitySchema._type[]} capabilities
 */
function buildBrowserProfileAuthPrompt(profile, capabilities) {
  const accountLines = capabilities.map((capability) => {
    const expectedHandle = resolveExpectedHandle(profile, capability);
    return `- ${capability}: expected handle ${expectedHandle ?? "unknown"}`;
  });

  return [
    "Use the native Chrome/browser-control surface available in this runtime to verify live signed-in readiness for one Exo browser profile.",
    `The resolved Chrome profile is label ${profile.label}, directory ${profile.profileDirectory}, path ${profile.profilePath}.`,
    `Recorded profile identity accounts: ${profile.identity.accounts.length ? profile.identity.accounts.map((account) => `${account.capability}:${account.handle}`).join(", ") : "none"}.`,
    "Check these capabilities and expected identities:",
    ...accountLines,
    "For each capability, verify whether the intended signed-in identity is currently usable in the active browser context.",
    "Use LinkedIn feed or home for linkedin, Sales Navigator home for sales-navigator, Gmail inbox for gmail, and the HubSpot app shell for hubspot.",
    "If the runtime cannot control the intended Chrome profile or cannot verify the active identity, return invalid with verified=false for the affected capabilities and a concrete details string.",
    "Do not use shell commands, local files, or web search.",
    "Return only JSON that matches the provided schema.",
    "Set sourceUrl to the page you used for the auth decision when available.",
    "Set detectedHandle to the signed-in identity or portal you actually observed when visible."
  ].join("\n");
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 * @param {import("../schema/browser-profile.js").browserProfileCapabilitySchema._type} capability
 */
function resolveExpectedHandle(profile, capability) {
  const direct = profile.identity.accounts.find((account) => account.capability === capability)?.handle ?? null;
  if (direct) {
    return direct;
  }

  if (capability === "sales-navigator") {
    return profile.identity.accounts.find((account) => account.capability === "linkedin")?.handle ?? null;
  }

  return null;
}

/**
 * @param {string | null} left
 * @param {string | null} right
 */
function sameHandle(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * @param {"untested" | "ready" | "warning" | "invalid"} left
 * @param {"untested" | "ready" | "warning" | "invalid"} right
 */
function stricterAuthProbeStatus(left, right) {
  const severity = {
    untested: 0,
    ready: 1,
    warning: 2,
    invalid: 3
  };

  return severity[left] >= severity[right] ? left : right;
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

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileOptions} options
 */
function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(buildExecErrorMessage(command, stdout, stderr, error)));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

/**
 * @param {string} command
 * @param {string | Buffer} stdout
 * @param {string | Buffer} stderr
 * @param {Error} error
 */
function buildExecErrorMessage(command, stdout, stderr, error) {
  const stderrText = bufferToTrimmedString(stderr);
  const stdoutText = bufferToTrimmedString(stdout);
  const detail = stderrText || stdoutText || error.message;
  return `${command} exec failed: ${detail}`;
}

/**
 * @param {string | Buffer} value
 */
function bufferToTrimmedString(value) {
  const text = String(value ?? "").trim();
  return text.length ? text : "";
}
