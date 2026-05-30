// @ts-check

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gmailInboundSyncCaptureSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import { buildGmailInboundSyncPayload, resolveGmailAccount } from "./inbound-gmail-sync.js";
import { probeUserHarnessConnections } from "./probe-user-harness-connections.js";

const DEFAULT_GMAIL_THREAD_LIMIT = 20;

const gmailCaptureOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mode", "status", "checkedAt", "itemCount", "error", "threads"],
  properties: {
    mode: {
      type: "string",
      enum: ["quick"]
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
 * @param {{
 *   accountId?: string | null,
 *   limit?: number | null,
 *   since?: string | null,
 *   codexCli?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null
 * }} [options]
 */
export async function buildLiveGmailInboundSyncPayload(rawUser, options = {}) {
  const user = userSchema.parse(rawUser);
  const account = resolveGmailAccount(user, normalizeNullableString(options.accountId));
  const harnessConnection = requireGmailHarnessConnection(user, account);
  const limit = normalizePositiveInteger(options.limit, DEFAULT_GMAIL_THREAD_LIMIT, "limit");
  const since = normalizeNullableString(options.since);
  if (since) {
    assertIsoDatetime(since, "since");
  }

  const probeResult = probeUserHarnessConnections(user, {
    runtime: harnessConnection.runtime,
    connector: harnessConnection.connector,
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });
  const probe = probeResult.probes.find((candidate) => candidate.connectionId === harnessConnection.id) ?? {
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

  /** @type {unknown} */
  let rawCapture;
  if (probe.detectedStatus !== "available") {
    rawCapture = buildFailedCapture(
      `${harnessConnection.runtime} Gmail connector is not available for ${account.handle}: ${probe.reason}`
    );
  } else {
    try {
      rawCapture = await captureGmailInbox({
        runtime: harnessConnection.runtime.trim().toLowerCase(),
        handle: account.handle,
        limit,
        since,
        codexCli: options.codexCli ?? normalizeNullableString(process.env.EXO_CODEX_CLI) ?? "codex",
        codexHome: options.codexHome ?? normalizeNullableString(process.env.CODEX_HOME) ?? null,
        claudeCli: options.claudeCli ?? normalizeNullableString(process.env.EXO_CLAUDE_CLI) ?? "claude"
      });
    } catch (error) {
      rawCapture = buildFailedCapture(error instanceof Error ? error.message : String(error));
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
      harnessConnectionId: account.harnessConnectionId
    },
    probe,
    capture: built.capture,
    payload: built.payload
  };
}

/**
 * @param {{
 *   runtime: string,
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
 *   handle: string,
 *   limit: number,
 *   since: string | null,
 *   codexCli: string,
 *   codexHome: string | null
 * }} input
 */
async function captureGmailInboxThroughCodex(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-gmail-live-"));
  const schemaPath = path.join(tempDir, "gmail-capture.schema.json");
  const outputPath = path.join(tempDir, "gmail-capture.json");
  fs.writeFileSync(schemaPath, JSON.stringify(gmailCaptureOutputSchema, null, 2));

  try {
    const prompt = buildGmailLiveCapturePrompt(input.handle, input.limit, input.since);
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
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function requireGmailHarnessConnection(user, account) {
  if (account.sourceType !== "harness-connection") {
    throw new Error(`Gmail account ${account.id} does not resolve through a harness connection.`);
  }

  const harnessConnection = user.harnessConnections.find((candidate) => candidate.id === account.harnessConnectionId) ?? null;
  if (!harnessConnection) {
    throw new Error(`Harness connection not found for Gmail account ${account.id}.`);
  }

  if (harnessConnection.connector.trim().toLowerCase() !== "gmail") {
    throw new Error(`Gmail live sync currently requires a runtime:gmail harness connection, found ${harnessConnection.runtime}:${harnessConnection.connector}.`);
  }

  const runtime = harnessConnection.runtime.trim().toLowerCase();
  if (!["codex", "claude"].includes(runtime)) {
    throw new Error(`Gmail live sync currently supports codex:gmail or claude:gmail, found ${harnessConnection.runtime}:${harnessConnection.connector}.`);
  }

  return harnessConnection;
}

/**
 * @param {{
 *   handle: string,
 *   limit: number,
 *   since: string | null,
 *   claudeCli: string
 * }} input
 */
async function captureGmailInboxThroughClaude(input) {
  const prompt = buildGmailLiveCapturePrompt(input.handle, input.limit, input.since);
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
    prompt
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
 * @param {string} handle
 * @param {number} limit
 * @param {string | null} since
 */
function buildGmailLiveCapturePrompt(handle, limit, since) {
  const sinceInstruction = since
    ? `Only include threads whose newest relevant message is at or after ${since}. If the connector cannot filter directly, inspect recent inbox threads and exclude anything older from the final JSON.`
    : "Inspect the most recent inbox threads and include only the threads that are meaningfully relevant to GTM execution.";

  return [
    "Use the Gmail connector available in this runtime to inspect one live Gmail inbox for Exo.",
    `The mailbox handle is ${handle}.`,
    "Do not use browser tools, web search, shell commands, or local files.",
    `Inspect up to ${limit} inbox threads, newest first.`,
    sinceInstruction,
    "Return only JSON that matches the provided schema.",
    "Use mode quick.",
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
function buildFailedCapture(error) {
  return {
    mode: "quick",
    status: "failed",
    checkedAt: new Date().toISOString(),
    itemCount: 0,
    error,
    threads: []
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
