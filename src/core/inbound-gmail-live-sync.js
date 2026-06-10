// @ts-check

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodexCliCommand } from "../lib/codex-cli.js";
import { execWithClosedStdin } from "../lib/exec-with-closed-stdin.js";
import { gmailInboundSyncCaptureSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { buildGmailInboundSyncPayload, normalizeGmailInboundSyncCapture, resolveGmailAccount } from "./inbound-gmail-sync.js";
import {
  buildCodexAgentHandoffTransport,
  buildDirectLiveTransport,
  shouldUseCodexAgentHandoff
} from "./live-agent-handoff.js";
import { probeUserHarnessConnections } from "./probe-user-harness-connections.js";

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
          "notes",
          "messagesCompleteness",
          "messages"
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
          },
          messagesCompleteness: {
            type: "string",
            enum: ["complete", "partial_visible_slice"]
          },
          messages: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["direction", "sentAt", "fromName", "fromHandle", "body"],
              properties: {
                id: {
                  type: ["string", "null"]
                },
                direction: {
                  type: "string",
                  enum: ["inbound", "outbound", "unknown"]
                },
                sentAt: {
                  type: ["string", "null"],
                  format: "date-time"
                },
                fromName: {
                  type: ["string", "null"]
                },
                fromHandle: {
                  type: ["string", "null"]
                },
                body: {
                  type: "string",
                  minLength: 1
                }
              }
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
 *   since?: string | null,
 *   codexCli?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null
 * }} [options]
 */
export async function buildLiveGmailInboundSyncPayload(rawUser, rawProfiles, options = {}) {
  const user = userSchema.parse(rawUser);
  const account = resolveGmailAccount(user, normalizeNullableString(options.accountId));
  const mode = options.mode ?? "quick";
  const liveSource = resolveGmailLiveSource(user, account, {
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
        profile: null,
        probe,
        transport: buildCodexAgentHandoffTransport({
          capability: "gmail",
          runtime,
          connector,
          source: liveSource.source,
          captureTransportMode: "connector_native_only",
          prompt,
          outputSchema: gmailCaptureOutputSchema,
          buildPayloadCommand: `exo inbound sync gmail ${user.id} --account ${account.id} --input - --json`,
          applyCommand: `exo inbound sync run ${user.id} --input <combined-inbound-sync.json> --refresh --json`,
          verificationCommands: [
            `exo inbound sync show ${user.id} --json`,
            `exo inbox --user ${user.id} --json`,
            `exo next --user ${user.id} --json`
          ],
          profileSelection: null
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
        limit,
        since,
        codexCli: resolveCodexCliCommand({ codexCli: options.codexCli ?? null }),
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
    profile: null,
    probe,
    transport,
    capture: built.capture,
    payload: built.payload
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {{ runtime?: string | null, connector?: string | null }} input
 */
function resolveGmailLiveSource(user, account, input) {
  if (account.sourceType === "browser-profile") {
    throw new Error("Profile-backed Gmail accounts are no longer supported for live sync. Map a managed connector account instead.");
  }

  return {
    profile: null,
    harnessConnection: requireGmailHarnessConnection(user, account, input),
    probe: null,
    source: "stored_harness_connection"
  };
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

    await execWithClosedStdin(execFileAsync, input.codexCli, args, {
      cwd: tempDir,
      env,
      maxBuffer: 10 * 1024 * 1024
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Codex Gmail capture did not produce an output file.");
    }

    const parsed = normalizeGmailInboundSyncCapture(JSON.parse(fs.readFileSync(outputPath, "utf8")));
    return gmailInboundSyncCaptureSchema.parse(parsed);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   connector: string,
 *   handle: string,
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
    const { stdout } = await execWithClosedStdin(execFileAsync, input.claudeCli, args, {
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

    const structuredOutput = parsed?.structured_output;
    if (!structuredOutput) {
      throw new Error("Claude Gmail capture did not return structured_output.");
    }
    const capture = normalizeGmailInboundSyncCapture(structuredOutput);

    return gmailInboundSyncCaptureSchema.parse(capture);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   connector: string,
 *   handle: string,
 *   limit: number,
 *   since: string | null
 * }} input
 */
function buildGmailLiveCapturePrompt(input) {
  const sinceInstruction = input.since
    ? `Only include threads whose newest relevant message is at or after ${input.since}. If the active surface cannot filter directly, inspect recent inbox threads and exclude anything older from the final JSON.`
    : "Inspect the most recent inbox threads and include only the threads that are meaningfully relevant to GTM execution.";
  const lines = [
    `Use the native ${input.connector} connector available in this runtime to inspect one live Gmail inbox for Exo.`,
    `The mailbox handle is ${input.handle}.`,
    "Use connector-native Gmail retrieval only. Do not use browser tools, web search, shell commands, or local files.",
    "Before inspecting the inbox, verify that the connected Gmail identity matches the intended mailbox handle. If the connector is bound to another mailbox, return failed with a concrete account_selection_mismatch error.",
    "Use the structured captureGuide and verificationCommands attached to this capture request as the governed writeback contract after capture.",
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
    "Each thread must include threadId, kind, observedAt, summary, subject, fromName, fromEmail, actorTitle, actorCompanyName, threadUrl, sourceUrl, motionId, companyId, prospectId, notes, messagesCompleteness, and messages.",
    "Do not invent motionId, companyId, or prospectId. Set them to null unless you truly know them from the inbox itself.",
    "Use kind email_reply_received when the newest relevant change is an external reply in an existing outreach thread. Otherwise use email_thread_updated.",
    "Prefer short operator-usable summaries under 280 characters.",
    "For messages, include the full visible participant-authored thread the operator or CRM would need later. Use chronological order, oldest to newest. Do not truncate to a recent slice.",
    "Set messagesCompleteness to complete only when you captured the full visible participant-authored thread history for that returned thread. If you only have a partial visible slice, set messagesCompleteness to partial_visible_slice and do not return that thread as a successful capture.",
    "Each message must include direction, sentAt, fromName, fromHandle, and body. Use direction inbound for external mail and outbound for the operator's sent mail when visible.",
    "If you cannot retrieve at least one structured message body or cannot capture the full visible participant-authored thread for a returned thread, do not return that thread as a successful capture. Return warning or failed instead of landing a partial or notes-only thread.",
    "Do not paste the entire quoted chain into every message body. Keep each body to the visible message text itself, trimming repeated signatures or quoted history when it is clearly duplicated.",
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
 * Like promisify(execFile), the returned promise exposes the spawned process
 * as `child` so execWithClosedStdin can close its stdin pipe.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileOptions} options
 */
function execFileAsync(command, args, options) {
  /** @type {import("node:child_process").ChildProcess} */
  let child;
  const pending = new Promise((resolve, reject) => {
    child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(buildExecErrorMessage(command, stdout, stderr, error)));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
  return Object.assign(pending, { child });
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
