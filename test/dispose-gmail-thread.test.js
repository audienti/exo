// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-dispose-gmail-"));
process.env.EXO_STATE_DIR = stateDir;

const { disposeGmailThread } = await import("../src/core/dispose-gmail-thread.js");

// Mirrors the live claude/codex CLI behavior that motivated the stdin fix:
// the child reads stdin to EOF before answering. If the caller leaves the
// stdin pipe open, this guard fails the disposal with a concrete error after
// 4s instead of hanging the suite.
const STDIN_EOF_GUARD = `"${process.execPath}" -e 'const watchdog = setTimeout(() => { console.error("stdin was left open by the gmail disposal caller"); process.exit(7); }, 4000); process.stdin.resume(); process.stdin.on("end", () => { clearTimeout(watchdog); process.exit(0); });' || exit 7`;

const DISPOSE_RESULT = {
  status: "deleted",
  disposedThreadId: "thread-1",
  detail: "Moved to trash."
};

/** @param {string[]} args */
function cliJson(args) {
  const out = execFileSync("node", [cliPath, ...args, "--json"], {
    cwd: repoRoot,
    env: { ...process.env, EXO_STATE_DIR: stateDir }
  }).toString();
  return JSON.parse(out);
}

/**
 * @param {string} runtime
 * @returns {{ observation: any }}
 */
function seedGmailObservation(runtime) {
  const user = cliJson(["users", "add", "--label", `dispose-${runtime}-user`, "--owner", "William"]);
  const userWithAccount = cliJson([
    "users", "accounts", "add", user.id,
    "--capability", "gmail",
    "--handle", "operator@example.com",
    "--runtime", runtime,
    "--connector", "gmail",
    "--preferred"
  ]);
  const gmailAccount = userWithAccount.accounts.find((/** @type {any} */ account) => account.capability === "gmail");
  assert.ok(gmailAccount, "gmail account exists");

  const observation = cliJson([
    "inbound", "observations", "add", user.id,
    "--account", gmailAccount.id,
    "--surface", "gmail-inbox-threads",
    "--kind", "email_thread_updated",
    "--observed-at", "2026-06-04T16:20:00.000Z",
    "--summary", "Repeated follow-up on an RFP thread.",
    "--actor-name", "Lina Park",
    "--actor-handle", "lpark@govpointeoffice.us",
    "--thread-url", "https://mail.google.com/mail/#all/thread-1",
    "--external-id", "thread-1",
    "--notes", "Subject: Re: Halfmoon Hillcrest Fire Dept. RFP\n\nExternal follow-up thread."
  ]).observation;

  return { observation };
}

/**
 * @param {string} filePath
 */
function writeStdinGuardedClaudeScript(filePath) {
  const envelope = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    structured_output: DISPOSE_RESULT
  });
  const lines = [
    "#!/bin/sh",
    'if [ "$1" = "-p" ]; then',
    `  ${STDIN_EOF_GUARD}`,
    "  cat <<'JSON'",
    envelope,
    "JSON",
    "  exit 0",
    "fi",
    'echo "unsupported fake claude invocation" >&2',
    "exit 2",
    ""
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
  fs.chmodSync(filePath, 0o755);
}

/**
 * @param {string} filePath
 */
function writeStdinGuardedCodexScript(filePath) {
  const lines = [
    "#!/bin/sh",
    'out=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    "    -o)",
    '      out="$2"',
    "      shift 2",
    "      ;;",
    "    *)",
    "      shift",
    "      ;;",
    "  esac",
    "done",
    'if [ -z "$out" ]; then',
    '  echo "missing output file" >&2',
    "  exit 2",
    "fi",
    STDIN_EOF_GUARD,
    `cat > "$out" <<'JSON'`,
    JSON.stringify(DISPOSE_RESULT, null, 2),
    "JSON",
    ""
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
  fs.chmodSync(filePath, 0o755);
}

test.after(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test("gmail disposal (claude) closes the CLI's stdin so the runtime does not block", async () => {
  const { observation } = seedGmailObservation("claude");
  const fakeClaudePath = path.join(stateDir, "fake-claude-dispose");
  writeStdinGuardedClaudeScript(fakeClaudePath);

  const result = await disposeGmailThread({ observation, claudeCli: fakeClaudePath });
  assert.equal(result.status, "deleted");
  assert.equal(result.disposedThreadId, "thread-1");
});

test("gmail disposal (codex) closes the CLI's stdin so the runtime does not block", async () => {
  const { observation } = seedGmailObservation("codex");
  const fakeCodexPath = path.join(stateDir, "fake-codex-dispose");
  writeStdinGuardedCodexScript(fakeCodexPath);

  const result = await disposeGmailThread({ observation, codexCli: fakeCodexPath });
  assert.equal(result.status, "deleted");
  assert.equal(result.disposedThreadId, "thread-1");
});
