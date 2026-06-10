// @ts-check

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { findUserById } from "../db/database.js";
import { resolveCodexCliCommand } from "../lib/codex-cli.js";
import { execWithClosedStdin } from "../lib/exec-with-closed-stdin.js";
import { inboundObservationSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

const gmailDisposeOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "disposedThreadId", "detail"],
  properties: {
    status: {
      type: "string",
      enum: ["deleted", "already_missing", "failed"],
    },
    disposedThreadId: {
      type: ["string", "null"],
    },
    detail: {
      type: ["string", "null"],
    },
  },
};

/**
 * @param {{
 *   observation: unknown,
 *   codexCli?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null,
 * }} input
 */
export async function disposeGmailThread(input) {
  const observation = inboundObservationSchema.parse(input.observation);
  if (observation.capability !== "gmail" || observation.surfaceKey !== "gmail-inbox-threads") {
    throw new Error("disposeGmailThread only supports Gmail inbox-thread observations.");
  }

  const rawUser = findUserById(observation.userId);
  if (!rawUser) {
    throw new Error(`User not found: ${observation.userId}`);
  }
  const user = userSchema.parse(rawUser);
  const account = user.accounts.find((candidate) => candidate.id === observation.accountId) ?? null;
  if (!account) {
    throw new Error(`Gmail account not found: ${observation.accountId}`);
  }
  if (account.sourceType !== "harness-connection" || !account.harnessConnectionId) {
    throw new Error("Gmail thread disposal currently requires a managed harness-backed Gmail account.");
  }

  const harnessConnection = user.harnessConnections.find((candidate) => candidate.id === account.harnessConnectionId) ?? null;
  if (!harnessConnection) {
    throw new Error(`Harness connection not found: ${account.harnessConnectionId}`);
  }

  const runtime = String(harnessConnection.runtime ?? "").trim().toLowerCase();
  const connector = String(harnessConnection.connector ?? "").trim().toLowerCase();
  if (connector !== "gmail") {
    throw new Error(`Gmail thread disposal currently requires a gmail connector, found ${harnessConnection.runtime}:${harnessConnection.connector}.`);
  }

  const prompt = buildGmailThreadDisposalPrompt({
    mailboxHandle: account.handle,
    actorHandle: observation.actorHandle,
    subject: observation.subject ?? parseObservationSubject(observation.notes),
    threadUrl: observation.threadUrl,
    externalId: observation.externalId,
    summary: observation.summary,
  });

  if (runtime === "codex") {
    return runDisposeThroughCodex({
      prompt,
      codexCli: resolveCodexCliCommand({ codexCli: input.codexCli ?? null }),
      codexHome: input.codexHome ?? normalizeNullableString(process.env.CODEX_HOME) ?? null,
    });
  }

  if (runtime === "claude") {
    return runDisposeThroughClaude({
      prompt,
      claudeCli: input.claudeCli ?? normalizeNullableString(process.env.EXO_CLAUDE_CLI) ?? "claude",
    });
  }

  throw new Error(`Gmail thread disposal is not implemented for runtime ${harnessConnection.runtime}.`);
}

/**
 * @param {{
 *   prompt: string,
 *   codexCli: string,
 *   codexHome: string | null,
 * }} input
 */
async function runDisposeThroughCodex(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-gmail-dispose-"));
  const schemaPath = path.join(tempDir, "gmail-dispose.schema.json");
  const outputPath = path.join(tempDir, "gmail-dispose.json");
  fs.writeFileSync(schemaPath, JSON.stringify(gmailDisposeOutputSchema, null, 2));

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
      input.prompt,
    ];
    const env = { ...process.env };
    if (input.codexHome) {
      env.CODEX_HOME = input.codexHome;
    }

    await execWithClosedStdin(execFileAsync, input.codexCli, args, { cwd: tempDir, env, maxBuffer: 10 * 1024 * 1024 });
    if (!fs.existsSync(outputPath)) {
      throw new Error("Codex Gmail disposal did not produce an output file.");
    }

    const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    return parseGmailDisposeResult(parsed);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   prompt: string,
 *   claudeCli: string,
 * }} input
 */
async function runDisposeThroughClaude(input) {
  const schema = JSON.stringify(gmailDisposeOutputSchema);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-gmail-dispose-claude-"));
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    schema,
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    input.prompt,
  ];

  try {
    const { stdout } = await execWithClosedStdin(execFileAsync, input.claudeCli, args, {
      cwd: tempDir,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = JSON.parse(String(stdout));
    return parseGmailDisposeResult(parsed?.structured_output);
  } catch (error) {
    throw new Error(`Claude Gmail disposal failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {unknown} raw
 */
function parseGmailDisposeResult(raw) {
  const parsed = /** @type {{ status?: string, disposedThreadId?: string | null, detail?: string | null }} */ (raw ?? {});
  if (!parsed || !["deleted", "already_missing", "failed"].includes(String(parsed.status ?? ""))) {
    throw new Error("Gmail disposal returned an invalid structured result.");
  }
  if (parsed.status === "failed") {
    throw new Error(parsed.detail?.trim() || "Gmail thread disposal failed.");
  }
  return {
    status: parsed.status,
    disposedThreadId: normalizeNullableString(parsed.disposedThreadId) ?? null,
    detail: normalizeNullableString(parsed.detail) ?? null,
  };
}

/**
 * @param {{
 *   mailboxHandle: string,
 *   actorHandle: string | null,
 *   subject: string | null,
 *   threadUrl: string | null,
 *   externalId: string | null,
 *   summary: string,
 * }} input
 */
function buildGmailThreadDisposalPrompt(input) {
  return [
    "Use the Gmail connector available in this runtime to remove one live Gmail thread for Exo.",
    `The mailbox handle is ${input.mailboxHandle}.`,
    input.actorHandle ? `The external sender is ${input.actorHandle}.` : null,
    input.subject ? `The subject is ${input.subject}.` : null,
    input.threadUrl ? `The Gmail thread URL is ${input.threadUrl}.` : null,
    input.externalId ? `The source thread id is ${input.externalId}.` : null,
    `The operator summary is: ${input.summary}`,
    "Move the matching thread to trash or otherwise delete it from the mailbox.",
    "If the thread is already gone, return status already_missing.",
    "Use Gmail connector actions only. Do not use browser tools, shell commands, local files, or web search.",
    "Return only JSON that matches the provided schema.",
  ].filter(Boolean).join("\n");
}

/**
 * @param {string | null | undefined} notes
 */
function parseObservationSubject(notes) {
  if (!notes) {
    return null;
  }
  const match = notes.match(/^Subject:\s*(.+?)(?:\r?\n|$)/i);
  return normalizeNullableString(match?.[1] ?? null);
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
  const detail = bufferToTrimmedString(stderr) || bufferToTrimmedString(stdout) || error.message;
  return `${command} exec failed: ${detail}`;
}

/**
 * @param {string | Buffer} value
 */
function bufferToTrimmedString(value) {
  const text = String(value ?? "").trim();
  return text.length ? text : "";
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
