// @ts-check

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browserProfileSchema } from "../schema/browser-profile.js";
import { gmailInboundSyncCaptureSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { buildGmailInboundSyncPayload, resolveGmailAccount } from "./inbound-gmail-sync.js";
import {
  buildCodexAgentHandoffTransport,
  buildDirectLiveTransport,
  shouldUseCodexAgentHandoff
} from "./live-agent-handoff.js";
import { probeUserHarnessConnections } from "./probe-user-harness-connections.js";
import { resolveRuntimeHarnessConnection } from "./runtime-harness-resolution.js";

const DEFAULT_GMAIL_THREAD_LIMIT = 20;

const gmailCaptureOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "status", "checkedAt", "itemCount", "error", "threads"],
  properties: {
    mode: {
      type: "string",
      enum: ["quick", "full"]
    },
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
    error: {
      type: ["string", "null"]
    },
    threads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "threadId",
          "kind",
          "observedAt",
          "summary",
          "subject",
          "fromName",
          "fromEmail",
          "actorTitle",
          "actorCompanyName",
          "threadUrl",
          "sourceUrl",
          "motionId",
          "companyId",
          "prospectId",
          "notes"
        ],
        properties: {
          threadId: {
            type: "string",
            minLength: 1
          },
          kind: {
            type: "string",
            enum: ["email_reply_received", "email_thread_updated"]
          },
          observedAt: {
            type: "string",
            format: "date-time"
          },
          summary: {
            type: "string",
            minLength: 1,
            maxLength: 280
          },
          subject: {
            type: ["string", "null"]
          },
          fromName: {
            type: ["string", "null"]
          },
          fromEmail: {
            type: ["string", "null"]
          },
          actorTitle: {
            type: ["string", "null"]
          },
          actorCompanyName: {
            type: ["string", "null"]
          },
          threadUrl: {
            type: ["string", "null"],
            format: "uri"
          },
          sourceUrl: {
            type: ["string", "null"],
            format: "uri"
          },
          motionId: {
            type: ["string", "null"]
          },
          companyId: {
            type: ["string", "null"]
          },
          prospectId: {
            type: ["string", "null"]
          },
          notes: {
            type: ["string", "null"]
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
 *   since?: string | null,
 *   codexCli?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null
 * }} [options]
 */
export async function buildLiveGmailInboundSyncPayload(rawUser, rawProfiles, options = {}) {
  const user = userSchema.parse(rawUser);
  const profiles = rawProfiles.map((profile) => browserProfileSchema.parse(profile));
  const account = resolveGmailAccount(user, normalizeNullableString(options.accountId));
  const mode = options.mode ?? "quick";
  const liveSource = resolveGmailLiveSource(user, profiles, account, {
    runtime: options.runtime ?? null,
    connector: options.connector ?? null,
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });
  const limit = normalizePositiveInteger(options.limit, DEFAULT_GMAIL_THREAD_LIMIT, "limit");
  const since = normalizeNullableString(options.since);
  if (since) {
    assertIsoDatetime(since, "since");
  }

  const probe = liveSource.probe ?? buildStoredHarnessProbe(user, liveSource.harnessConnection, {
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });
  const runtime = liveSource.harnessConnection.runtime.trim().toLowerCase();
  const connector = liveSource.harnessConnection.connector.trim().toLowerCase();
  const transportBase = {
    runtime,
    connector,
    source: liveSource.source
  };

  /** @type {unknown} */
  let rawCapture;
  let transport = buildDirectLiveTransport(transportBase);
  if (probe.detectedStatus !== "available") {
    rawCapture = buildFailedCapture(
      mode,
      `${liveSource.harnessConnection.runtime}:${liveSource.harnessConnection.connector} is not available for Gmail live sync: ${probe.reason}`
    );
  } else {
    const prompt = buildGmailLiveCapturePrompt({
      mode,
      connector,
      handle: account.handle,
      profile: liveSource.profile,
      limit,
      since
    });
    if (shouldUseCodexAgentHandoff({
      runtime,
      codexCli: options.codexCli ?? null
    })) {
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
          browserProfileId: account.browserProfileId,
          harnessConnectionId: account.harnessConnectionId
        },
        profile: liveSource.profile
          ? {
              id: liveSource.profile.id,
              label: liveSource.profile.label,
              browser: liveSource.profile.browser,
              profileDirectory: liveSource.profile.profileDirectory,
              profilePath: liveSource.profile.profilePath,
              identityAccounts: liveSource.profile.identity.accounts
            }
          : null,
        probe,
        transport: buildCodexAgentHandoffTransport({
          capability: "gmail",
          runtime,
          connector,
          source: liveSource.source,
          prompt,
          outputSchema: gmailCaptureOutputSchema,
          buildPayloadCommand: `exo inbound sync gmail ${user.id} --account ${account.id} --input - --json`
        }),
        capture: null,
        payload: null
      };
    }

    try {
      rawCapture = await captureGmailInbox({
        runtime,
        connector,
        handle: account.handle,
        profile: liveSource.profile,
        limit,
        since,
        codexCli: options.codexCli ?? normalizeNullableString(process.env.EXO_CODEX_CLI) ?? "codex",
        codexHome: options.codexHome ?? normalizeNullableString(process.env.CODEX_HOME) ?? null,
        claudeCli: options.claudeCli ?? normalizeNullableString(process.env.EXO_CLAUDE_CLI) ?? "claude",
        prompt
      });
    } catch (error) {
      rawCapture = buildFailedCapture(mode, error instanceof Error ? error.message : String(error));
    }
  }

  const built = buildGmailInboundSyncPayload(user, {
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
      browserProfileId: account.browserProfileId,
      harnessConnectionId: account.harnessConnectionId
    },
    profile: liveSource.profile
      ? {
          id: liveSource.profile.id,
          label: liveSource.profile.label,
          browser: liveSource.profile.browser,
          profileDirectory: liveSource.profile.profileDirectory,
          profilePath: liveSource.profile.profilePath,
          identityAccounts: liveSource.profile.identity.accounts
        }
      : null,
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
 * @param {{ runtime?: string | null, connector?: string | null }} input
 */
function resolveGmailLiveSource(user, profiles, account, input) {
  if (account.sourceType === "browser-profile") {
    const runtimeSource = resolveGmailRuntimeHarnessConnection(user, input);
    return {
      profile: resolveGmailBrowserProfile(profiles, account),
      harnessConnection: runtimeSource.harnessConnection,
      probe: runtimeSource.probe,
      source: runtimeSource.source
    };
  }

  return {
    profile: null,
    harnessConnection: requireGmailHarnessConnection(user, account, input),
    probe: null,
    source: "stored_harness_connection"
  };
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function resolveGmailBrowserProfile(profiles, account) {
  const profile = profiles.find((candidate) => candidate.id === account.browserProfileId) ?? null;
  if (!profile) {
    throw new Error(`Browser profile not found for Gmail account ${account.id}.`);
  }

  if (profile.browser !== "chrome") {
    throw new Error(`Gmail live sync currently supports Chrome-backed profiles only. ${profile.label} is ${profile.browser}.`);
  }

  if (profile.status !== "ready" || !profile.verifiedCapabilities.includes("gmail")) {
    throw new Error(`Gmail live sync requires a trusted Chrome profile with verified gmail capability. ${profile.label} is ${profile.status}.`);
  }

  return profile;
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {{ runtime?: string | null, connector?: string | null }} input
 */
function resolveGmailRuntimeHarnessConnection(user, input) {
  const runtimeFilter = normalizeNullableString(input.runtime)?.toLowerCase() ?? null;
  const connectorFilter = normalizeNullableString(input.connector)?.toLowerCase() ?? "chrome";

  if (connectorFilter !== "chrome") {
    throw new Error(`Profile-backed Gmail live sync currently supports runtime:chrome harness connections only. Received connector ${connectorFilter}.`);
  }

  return resolveRuntimeHarnessConnection(user, {
    runtime: runtimeFilter,
    connector: connectorFilter,
    codexHome: input.codexHome ?? null,
    claudeCli: input.claudeCli ?? null,
    multipleMessage: (choices) =>
      `Multiple supported Gmail browser harnesses exist for ${user.label} (${choices.join(", ")}). Pass --runtime explicitly.`
  });
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {{ runtime?: string | null, connector?: string | null }} input
 */
function requireGmailHarnessConnection(user, account, input) {
  if (account.sourceType !== "harness-connection") {
    throw new Error(`Gmail account ${account.id} does not resolve through a harness connection.`);
  }

  const harnessConnection = user.harnessConnections.find((candidate) => candidate.id === account.harnessConnectionId) ?? null;
  if (!harnessConnection) {
    throw new Error(`Harness connection not found for Gmail account ${account.id}.`);
  }

  const connectorFilter = normalizeNullableString(input.connector)?.toLowerCase() ?? "gmail";
  if (harnessConnection.connector.trim().toLowerCase() !== connectorFilter) {
    throw new Error(`Gmail live sync currently requires a runtime:${connectorFilter} harness connection, found ${harnessConnection.runtime}:${harnessConnection.connector}.`);
  }

  const runtime = harnessConnection.runtime.trim().toLowerCase();
  const runtimeFilter = normalizeNullableString(input.runtime)?.toLowerCase() ?? null;
  if (runtimeFilter && runtime !== runtimeFilter) {
    throw new Error(`Gmail account ${account.id} resolves through ${harnessConnection.runtime}:${harnessConnection.connector}, not ${runtimeFilter}:${connectorFilter}.`);
  }

  if (!["codex", "claude"].includes(runtime)) {
    throw new Error(`Gmail live sync currently supports codex:${connectorFilter} or claude:${connectorFilter}, found ${harnessConnection.runtime}:${harnessConnection.connector}.`);
  }

  return harnessConnection;
}

/**
 * @param {{
 *   runtime: string,
 *   mode: string,
 *   connector: string,
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type | null,
 *   limit: number,
 *   since: string | null,
 *   codexCli: string,
 *   codexHome: string | null,
 *   claudeCli: string
 * }} input
 */
async function captureGmailInbox(input) {
  if (input.runtime === "codex") {
    return captureGmailInboxThroughCodex(input);
  }

  if (input.runtime === "claude") {
    return captureGmailInboxThroughClaude(input);
  }

  throw new Error(`Gmail live sync is not implemented for runtime ${input.runtime}.`);
}

/**
 * @param {{
 *   connector: string,
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type | null,
 *   limit: number,
 *   since: string | null,
 *   codexCli: string,
 *   codexHome: string | null,
 *   prompt: string
 * }} input
 */
async function captureGmailInboxThroughCodex(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-gmail-live-"));
  const schemaPath = path.join(tempDir, "gmail-capture.schema.json");
  const outputPath = path.join(tempDir, "gmail-capture.json");
  fs.writeFileSync(schemaPath, JSON.stringify(gmailCaptureOutputSchema, null, 2));

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
      throw new Error("Codex Gmail capture did not produce an output file.");
    }

    const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    return gmailInboundSyncCaptureSchema.parse(parsed);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   connector: string,
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type | null,
 *   limit: number,
 *   since: string | null,
 *   claudeCli: string
 *   prompt: string
 * }} input
 */
async function captureGmailInboxThroughClaude(input) {
  const schema = JSON.stringify(gmailCaptureOutputSchema);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-gmail-live-claude-"));
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
      throw new Error(`Claude Gmail capture returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const capture = parsed?.structured_output;
    if (!capture) {
      throw new Error("Claude Gmail capture did not return structured_output.");
    }

    return gmailInboundSyncCaptureSchema.parse(capture);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   connector: string,
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type | null,
 *   limit: number,
 *   since: string | null
 * }} input
 */
function buildGmailLiveCapturePrompt(input) {
  const sinceInstruction = input.since
    ? `Only include threads whose newest relevant message is at or after ${input.since}. If the active surface cannot filter directly, inspect recent inbox threads and exclude anything older from the final JSON.`
    : "Inspect the most recent inbox threads and include only the threads that are meaningfully relevant to GTM execution.";
  const profileIdentityAccounts = input.profile?.identity.accounts.length
    ? input.profile.identity.accounts.map((account) => `${account.capability}:${account.handle}`).join(", ")
    : "none recorded in Exo";

  const lines = input.connector === "chrome"
    ? [
        "Use the native Chrome/browser-control surface available in this runtime to inspect one live Gmail inbox for Exo.",
        `The intended mailbox handle is ${input.handle}.`,
        `The resolved Chrome profile is label ${input.profile?.label ?? "unknown"}, directory ${input.profile?.profileDirectory ?? "unknown"}, path ${input.profile?.profilePath ?? "unknown"}.`,
        `Recorded profile identity accounts: ${profileIdentityAccounts}.`,
        "Before inspecting the inbox, verify that the active signed-in Gmail identity matches the intended profile context. If you cannot verify the correct signed-in identity or cannot control the correct Chrome profile, return failed with a concrete error.",
        "Do not use shell commands, local files, or web search.",
        `Inspect up to ${input.limit} inbox threads, newest first.`
      ]
    : [
        "Use the Gmail connector available in this runtime to inspect one live Gmail inbox for Exo.",
        `The mailbox handle is ${input.handle}.`,
        "Do not use browser tools, web search, shell commands, or local files.",
        `Inspect up to ${input.limit} inbox threads, newest first.`
      ];

  return [
    ...lines,
    sinceInstruction,
    "Return only JSON that matches the provided schema.",
    input.mode === "full" ? "Use mode full." : "Use mode quick.",
    "Set status to success when the inbox inspection succeeds, warning when the inbox was only partially inspected, and failed when the inbox could not be inspected.",
    "Set checkedAt to the ISO timestamp when you finished the inspection.",
    "Set itemCount to the number of returned threads on success or warning. Use 0 when failed.",
    "Set error to null on success. Warning or failed must include a short concrete error string.",
    "Each thread must include threadId, kind, observedAt, summary, subject, fromName, fromEmail, actorTitle, actorCompanyName, threadUrl, sourceUrl, motionId, companyId, prospectId, and notes.",
    "Do not invent motionId, companyId, or prospectId. Set them to null unless you truly know them from the inbox itself.",
    "Use kind email_reply_received when the newest relevant change is an external reply in an existing outreach thread. Otherwise use email_thread_updated.",
    "Prefer short operator-usable summaries under 280 characters.",
    "Only include threads with external participants. Ignore obvious newsletters, spam, or automated internal noise unless they materially change operator action."
  ].join("\n");
}

/**
 * @param {string} error
 */
function buildFailedCapture(mode, error) {
  return {
    mode,
    status: "failed",
    checkedAt: new Date().toISOString(),
    itemCount: 0,
    error,
    threads: []
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
 * @param {string} value
 * @param {string} label
 */
function assertIsoDatetime(value, label) {
  if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${label} must be an ISO datetime like 2026-05-30T14:05:00.000Z.`);
  }
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
