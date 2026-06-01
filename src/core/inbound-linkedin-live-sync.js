// @ts-check

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLinkedinQuickSurfaceHints } from "../lib/live-surface-hints.js";
import { browserProfileSchema } from "../schema/browser-profile.js";
import { linkedinInboundSyncCaptureSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { buildLinkedinInboundSyncPayload, resolveLinkedinAccount } from "./inbound-linkedin-sync.js";
import {
  buildCodexAgentHandoffTransport,
  buildDirectLiveTransport,
  shouldUseCodexAgentHandoff
} from "./live-agent-handoff.js";
import { probeUserHarnessConnections } from "./probe-user-harness-connections.js";
import { resolveRuntimeHarnessConnection } from "./runtime-harness-resolution.js";

const DEFAULT_LINKEDIN_ITEM_LIMIT = 20;

const linkedinActorFieldsSchema = {
  actorName: { type: ["string", "null"] },
  actorTitle: { type: ["string", "null"] },
  actorCompanyName: { type: ["string", "null"] },
  actorHandle: { type: ["string", "null"] },
  actorProfileUrl: { type: ["string", "null"], format: "uri" },
  actorLinkedinPublicId: { type: ["string", "null"] },
  actorLinkedinMemberId: { type: ["string", "null"] },
  actorAvatarSourceUrl: { type: ["string", "null"], format: "uri" },
  sourceUrl: { type: ["string", "null"], format: "uri" },
  motionId: { type: ["string", "null"] },
  companyId: { type: ["string", "null"] },
  prospectId: { type: ["string", "null"] },
  notes: { type: ["string", "null"] }
};

const linkedinSurfaceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "checkedAt",
    "itemCount",
    "visibleTotalCount",
    "captureCompleteness",
    "requestedMode",
    "actualMode",
    "reconcileRequired",
    "reconcileReason",
    "error",
    "items"
  ],
  properties: {
    status: {
      type: "string",
      enum: ["success", "warning", "failed"]
    },
    checkedAt: {
      type: ["string", "null"],
      format: "date-time"
    },
    itemCount: {
      type: ["integer", "null"],
      minimum: 0
    },
    visibleTotalCount: {
      type: ["integer", "null"],
      minimum: 0
    },
    captureCompleteness: {
      type: ["string", "null"],
      enum: ["complete", "partial_visible_slice", "failed", null]
    },
    requestedMode: {
      type: ["string", "null"],
      enum: ["quick", "normal", "full", null]
    },
    actualMode: {
      type: ["string", "null"],
      enum: ["quick", "normal", "full", null]
    },
    reconcileRequired: {
      type: ["boolean", "null"]
    },
    reconcileReason: {
      type: ["string", "null"]
    },
    error: {
      type: ["string", "null"]
    },
    items: {
      type: "array"
    }
  }
};

const linkedinLiveCaptureOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "sentInvitations",
    "receivedInvitations",
    "messagingInbox",
    "profileViews",
    "followingList"
  ],
  properties: {
    mode: {
      type: "string",
      enum: ["quick", "full"]
    },
    sentInvitations: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["invitationId", "kind", "observedAt", "summary", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              invitationId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["connection_request_pending", "connection_request_accepted", "connection_request_withdrawn"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    },
    receivedInvitations: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["invitationId", "kind", "observedAt", "summary", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              invitationId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["connection_request_received", "connection_request_accepted", "connection_request_declined"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    },
    messagingInbox: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["threadId", "kind", "observedAt", "summary", "threadUrl", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              threadId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["message_received", "thread_updated", "inbound_reply_received"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              threadUrl: { type: ["string", "null"], format: "uri" },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    },
    profileViews: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["viewId", "kind", "observedAt", "summary", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              viewId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["profile_view_after_touch", "profile_view_received"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    },
    followingList: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["entryId", "kind", "observedAt", "summary", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              entryId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["follow_state_changed", "follow_state_confirmed"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    }
  }
};

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawProfiles
 * @param {{
 *   accountId?: string | null,
 *   mode?: import("../schema/inbound.js").inboundSyncPlanModeSchema._type | null,
 *   runtime?: string | null,
 *   connector?: string | null,
 *   limit?: number | null,
 *   codexCli?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null
 * }} [options]
 */
export async function buildLiveLinkedinInboundSyncPayload(rawUser, rawProfiles, options = {}) {
  const user = userSchema.parse(rawUser);
  const profiles = rawProfiles.map((profile) => browserProfileSchema.parse(profile));
  const account = resolveLinkedinAccount(user, normalizeNullableString(options.accountId));
  const mode = options.mode ?? "quick";
  const profile = resolveLinkedinBrowserProfile(user, profiles, account);
  const resolvedHarness = resolveLinkedinRuntimeHarnessConnection(user, {
    runtime: options.runtime ?? null,
    connector: options.connector ?? null,
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });
  const harnessConnection = resolvedHarness.harnessConnection;
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LINKEDIN_ITEM_LIMIT, "limit");

  const probe = resolvedHarness.probe ?? buildStoredHarnessProbe(user, harnessConnection, {
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });

  const runtime = harnessConnection.runtime.trim().toLowerCase();
  const connector = harnessConnection.connector.trim().toLowerCase();
  const transportBase = {
    runtime,
    connector,
    source: resolvedHarness.source
  };

  /** @type {unknown} */
  let rawCapture;
  let transport = buildDirectLiveTransport(transportBase);
  if (probe.detectedStatus !== "available") {
    rawCapture = buildFailedLinkedinCapture(
      mode,
      `${harnessConnection.runtime}:${harnessConnection.connector} is not available for LinkedIn live sync: ${probe.reason}`
    );
  } else {
    const prompt = buildLinkedinLiveCapturePrompt(account.handle, profile, limit, { mode });
    if (shouldUseCodexAgentHandoff({
      runtime,
      codexCli: options.codexCli ?? null
    })) {
      const surfaceHints = buildLinkedinQuickSurfaceHints({ limit });

      return {
        user: {
          id: user.id,
          label: user.label,
          owner: user.owner
        },
        account: {
          id: account.id,
          handle: account.handle,
          capability: account.capability,
          sourceType: account.sourceType,
          browserProfileId: account.browserProfileId
        },
        profile: {
          id: profile.id,
          label: profile.label,
          browser: profile.browser,
          profileDirectory: profile.profileDirectory,
          profilePath: profile.profilePath,
          identityAccounts: profile.identity.accounts
        },
        probe,
        transport: buildCodexAgentHandoffTransport({
          capability: "linkedin",
          runtime,
          connector,
          source: resolvedHarness.source,
          prompt: buildLinkedinLiveCapturePrompt(account.handle, profile, limit, {
            mode,
            mentionStructuredHints: true
          }),
          outputSchema: linkedinLiveCaptureOutputSchema,
          buildPayloadCommand: `exo inbound sync linkedin ${user.id} --account ${account.id} --input - --json`,
          surfaceHints
        }),
        capture: null,
        payload: null
      };
    }

    try {
      rawCapture = await captureLinkedinQuickSurfaces({
        runtime,
        handle: account.handle,
        profile,
        limit,
        codexCli: options.codexCli ?? normalizeNullableString(process.env.EXO_CODEX_CLI) ?? "codex",
        codexHome: options.codexHome ?? normalizeNullableString(process.env.CODEX_HOME) ?? null,
        claudeCli: options.claudeCli ?? normalizeNullableString(process.env.EXO_CLAUDE_CLI) ?? "claude",
        prompt
      });
    } catch (error) {
      rawCapture = buildFailedLinkedinCapture(mode, error instanceof Error ? error.message : String(error));
    }
  }

  const built = buildLinkedinInboundSyncPayload(user, {
    accountId: account.id,
    capture: rawCapture
  });

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    account: {
      id: account.id,
      handle: account.handle,
      capability: account.capability,
      sourceType: account.sourceType,
      browserProfileId: account.browserProfileId
    },
    profile: {
      id: profile.id,
      label: profile.label,
      browser: profile.browser,
      profileDirectory: profile.profileDirectory,
      profilePath: profile.profilePath,
      identityAccounts: profile.identity.accounts
    },
    probe,
    transport,
    capture: built.capture,
    payload: built.payload
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function resolveLinkedinBrowserProfile(user, profiles, account) {
  if (account.sourceType !== "browser-profile") {
    throw new Error(`LinkedIn live sync currently requires a browser-profile-backed LinkedIn account. Account ${account.id} is ${account.sourceType}.`);
  }

  const profile = profiles.find((candidate) => candidate.id === account.browserProfileId) ?? null;
  if (!profile) {
    throw new Error(`Browser profile not found for LinkedIn account ${account.id}.`);
  }

  if (profile.browser !== "chrome") {
    throw new Error(`LinkedIn live sync currently supports Chrome-backed profiles only. ${profile.label} is ${profile.browser}.`);
  }

  if (profile.status !== "ready" || !profile.verifiedCapabilities.includes("linkedin")) {
    throw new Error(`LinkedIn live sync requires a trusted Chrome profile with verified linkedin capability. ${profile.label} is ${profile.status}.`);
  }

  return profile;
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {{ runtime?: string | null, connector?: string | null }} input
 */
function resolveLinkedinRuntimeHarnessConnection(user, input) {
  const runtimeFilter = normalizeNullableString(input.runtime)?.toLowerCase() ?? null;
  const connectorFilter = normalizeNullableString(input.connector)?.toLowerCase() ?? "chrome";

  if (connectorFilter !== "chrome") {
    throw new Error(`LinkedIn live sync currently supports runtime:chrome harness connections only. Received connector ${connectorFilter}.`);
  }

  return resolveRuntimeHarnessConnection(user, {
    runtime: runtimeFilter,
    connector: connectorFilter,
    codexHome: input.codexHome ?? null,
    claudeCli: input.claudeCli ?? null,
    multipleMessage: (choices) =>
      `Multiple supported LinkedIn browser harnesses exist for ${user.label} (${choices.join(", ")}). Pass --runtime explicitly.`
  });
}

/**
 * @param {{
 *   runtime: string,
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type,
 *   limit: number,
 *   codexCli: string,
 *   codexHome: string | null,
 *   claudeCli: string
 * }} input
 */
async function captureLinkedinQuickSurfaces(input) {
  if (input.runtime === "codex") {
    return captureLinkedinQuickSurfacesThroughCodex(input);
  }

  if (input.runtime === "claude") {
    return captureLinkedinQuickSurfacesThroughClaude(input);
  }

  throw new Error(`LinkedIn live sync is not implemented for runtime ${input.runtime}.`);
}

/**
 * @param {{
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type,
 *   limit: number,
 *   codexCli: string,
 *   codexHome: string | null,
 *   prompt: string
 * }} input
 */
async function captureLinkedinQuickSurfacesThroughCodex(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-linkedin-live-"));
  const schemaPath = path.join(tempDir, "linkedin-capture.schema.json");
  const outputPath = path.join(tempDir, "linkedin-capture.json");
  fs.writeFileSync(schemaPath, JSON.stringify(linkedinLiveCaptureOutputSchema, null, 2));

  try {
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
      input.prompt
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
      maxBuffer: 10 * 1024 * 1024
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Codex LinkedIn capture did not produce an output file.");
    }

    const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    return linkedinInboundSyncCaptureSchema.parse(parsed);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type,
 *   limit: number,
 *   claudeCli: string
 * }} input
 */
async function captureLinkedinQuickSurfacesThroughClaude(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-linkedin-live-claude-"));
  const schema = JSON.stringify(linkedinLiveCaptureOutputSchema);
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    schema,
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    input.prompt
  ];

  try {
    const { stdout } = await execFileAsync(input.claudeCli, args, {
      cwd: tempDir,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });

    let parsed;
    try {
      parsed = JSON.parse(String(stdout));
    } catch (error) {
      throw new Error(`Claude LinkedIn capture returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const capture = parsed?.structured_output;
    if (!capture) {
      throw new Error("Claude LinkedIn capture did not return structured_output.");
    }

    return linkedinInboundSyncCaptureSchema.parse(capture);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {string} handle
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type} profile
 * @param {number} limit
 * @param {{ mentionStructuredHints?: boolean, mode?: string | null }} [options]
 */
function buildLinkedinLiveCapturePrompt(handle, profile, limit, options = {}) {
  const requestedMode = normalizeNullableString(options.mode)?.toLowerCase() === "full" ? "full" : "quick";
  const identityAccounts = profile.identity.accounts.length
    ? profile.identity.accounts.map((account) => `${account.capability}:${account.handle}`).join(", ")
    : "none recorded in Exo";

  return [
    "Use the native Chrome/browser-control surface available in this runtime to inspect one live LinkedIn account for Exo.",
    `The intended LinkedIn handle is ${handle}.`,
    `The resolved Chrome profile is label ${profile.label}, directory ${profile.profileDirectory}, path ${profile.profilePath}.`,
    `Recorded profile identity accounts: ${identityAccounts}.`,
    options.mentionStructuredHints
      ? "Use the structured surfaceHints attached to this capture request as the canonical retrieval playbook, especially for the messaging inbox, sent invitations, and profile views when pagination or partial-capture behavior appears."
      : null,
    "Before inspecting any LinkedIn surface, verify that the active signed-in LinkedIn identity matches the intended profile context. If you cannot verify the correct signed-in identity or cannot control the correct Chrome profile, return failed for every surface with a concrete error.",
    "Do not use shell commands, local files, or web search.",
    requestedMode === "full"
      ? "Fully reconcile each authoritative quick LinkedIn surface. Do not stop at the visible top slice when the surfaceHints say pagination or load-more is required."
      : `Inspect up to ${limit} items per LinkedIn surface unless the attached surfaceHints tell you that reconcile escalation is required to land authoritative state.`,
    "Inspect these five quick surfaces only: sent invitations, received invitations, messaging inbox, profile views, and following list.",
    "Return only JSON that matches the provided schema.",
    requestedMode === "full"
      ? "Requested mode is full. Fully exhaust each authoritative quick surface enough that disappearance or silence is trustworthy, and set requestedMode and actualMode to full."
      : "Requested mode is quick. If a surfaceHint says reconcile is required because the visible total exceeds the itemized rows, you may continue paginating that one surface and set actualMode to full while keeping requestedMode quick.",
    "For each surface: set status to success when the surface was checked, warning when it was only partially checked or itemized, and failed when it could not be checked.",
    "Set checkedAt to when you finished that surface. Set itemCount to the number of rows or concrete items you actually itemized. Set visibleTotalCount to the full count visibly shown by LinkedIn for that surface when the UI exposes one; otherwise use itemCount when the surface is fully exhausted or null when no trustworthy total is visible. Use 0 or null fields consistently on failed surfaces.",
    "Set captureCompleteness to complete only when the relevant live surface was exhausted enough that disappearance or silence is trustworthy. Use partial_visible_slice when you only itemized the visible slice or otherwise stopped before a full reconciliation. Use failed only when the surface could not be checked.",
    "Set requestedMode and actualMode for every surface. Set reconcileRequired true whenever the visible total is larger than the itemized rows or the surfaceHints told you the operator still needs a full reconciliation. Set reconcileReason to a short snake_case explanation such as visible_total_exceeds_itemized_rows or bounded_capture_stopped_early.",
    "Use clear operator-ready summaries under 280 characters.",
    "Use actorProfileUrl whenever visible. Use actorLinkedinPublicId whenever the live surface exposes a stable vanity/public identifier. Use actorLinkedinMemberId whenever the live surface exposes the internal member id or equivalent stable LinkedIn profile id. Use actorAvatarSourceUrl whenever LinkedIn exposes a concrete avatar image URL for the person. Do not invent motionId, companyId, or prospectId. Set them to null unless you truly know them from the LinkedIn surface itself.",
    "Ignore noisy suggestions, ads, or unrelated feed items. Only include items that materially change operator action."
  ].filter(Boolean).join("\n");
}

/**
 * @param {string} error
 */
function buildFailedLinkedinCapture(mode, error) {
  const checkedAt = new Date().toISOString();
  return {
    mode,
    sentInvitations: buildFailedSurface(error, checkedAt, mode),
    receivedInvitations: buildFailedSurface(error, checkedAt, mode),
    messagingInbox: buildFailedSurface(error, checkedAt, mode),
    profileViews: buildFailedSurface(error, checkedAt, mode),
    followingList: buildFailedSurface(error, checkedAt, mode)
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/user.js").userHarnessConnectionSchema._type} harnessConnection
 * @param {{ codexHome?: string | null, claudeCli?: string | null }} options
 */
function buildStoredHarnessProbe(user, harnessConnection, options) {
  const probeResult = probeUserHarnessConnections(user, {
    runtime: harnessConnection.runtime,
    connector: harnessConnection.connector,
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });
  return probeResult.probes.find((candidate) => candidate.connectionId === harnessConnection.id) ?? {
    connectionId: harnessConnection.id,
    runtime: harnessConnection.runtime,
    connector: harnessConnection.connector,
    label: harnessConnection.label,
    storedStatus: harnessConnection.status,
    detectedStatus: "unknown",
    willWriteback: false,
    supported: true,
    source: {
      kind: "runtime-probe",
      path: null
    },
    reason: `No probe result was produced for ${harnessConnection.runtime}:${harnessConnection.connector}.`,
    evidence: []
  };
}

/**
 * @param {string} error
 * @param {string} checkedAt
 */
function buildFailedSurface(error, checkedAt, mode) {
  return {
    status: "failed",
    checkedAt,
    itemCount: 0,
    visibleTotalCount: null,
    captureCompleteness: "failed",
    requestedMode: mode,
    actualMode: mode,
    reconcileRequired: false,
    reconcileReason: null,
    error,
    items: []
  };
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
 * @param {number | null | undefined} value
 * @param {number} fallback
 * @param {string} label
 */
function normalizePositiveInteger(value, fallback, label) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
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
