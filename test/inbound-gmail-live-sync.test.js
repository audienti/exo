// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLiveGmailInboundSyncPayload } from "../src/core/inbound-gmail-live-sync.js";

const TIMESTAMP = "2026-06-09T12:00:00.000Z";

const SUCCESS_CAPTURE = {
  mode: "quick",
  status: "success",
  checkedAt: TIMESTAMP,
  itemCount: 0,
  error: null,
  threads: []
};

// Mirrors the live claude/codex CLI behavior that motivated the stdin fix:
// the child reads stdin to EOF before answering. If the caller leaves the
// stdin pipe open, this guard fails the capture with a concrete error after
// the watchdog elapses instead of hanging the suite. When stdin is closed
// (the fix), EOF arrives effectively instantly, so the watchdog is generous
// enough to never fire under parallel-suite CPU contention — it only bounds
// the broken path, whose execFile options set no timeout of their own.
const STDIN_WATCHDOG_MS = 20000;
const STDIN_EOF_GUARD = `"${process.execPath}" -e 'const watchdog = setTimeout(() => { console.error("stdin was left open by the gmail live sync caller"); process.exit(7); }, ${STDIN_WATCHDOG_MS}); process.stdin.resume(); process.stdin.on("end", () => { clearTimeout(watchdog); process.exit(0); });' || exit 7`;

/**
 * @param {string} runtime
 */
function buildGmailUser(runtime) {
  return {
    id: "user-1",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    label: `gmail-live-${runtime}-stdin-user`,
    owner: "william",
    notes: null,
    accounts: [
      {
        id: "gmail-account-1",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        capability: "gmail",
        handle: "operator@example.com",
        label: "Gmail via harness",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        preferred: true
      }
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        runtime,
        connector: "gmail",
        label: `${runtime}:gmail`,
        status: "available",
        notes: null
      }
    ]
  };
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
    structured_output: SUCCESS_CAPTURE
  });
  const lines = [
    "#!/bin/sh",
    'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then',
    '  echo "Installed plugins:"',
    '  echo "  ❯ gmail"',
    "  exit 0",
    "fi",
    'if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then',
    "  echo 'plugin:gmail:gmail: connected - ✓ Connected'",
    "  exit 0",
    "fi",
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
    JSON.stringify(SUCCESS_CAPTURE, null, 2),
    "JSON",
    ""
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
  fs.chmodSync(filePath, 0o755);
}

test("gmail-live claude capture closes the CLI's stdin so the runtime does not block", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-gmail-live-claude-stdin-"));
  const fakeClaudePath = path.join(tempDir, "fake-claude");
  writeStdinGuardedClaudeScript(fakeClaudePath);

  try {
    const result = await buildLiveGmailInboundSyncPayload(buildGmailUser("claude"), [], {
      accountId: "gmail-account-1",
      claudeCli: fakeClaudePath
    });

    assert.equal(result.probe.detectedStatus, "available");
    assert.equal(result.transport.kind, "direct_runtime");
    assert.equal(result.capture.error, null);
    assert.equal(result.capture.status, "success");
    assert.equal(result.capture.itemCount, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("gmail-live codex capture closes the CLI's stdin so the runtime does not block", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-gmail-live-codex-stdin-"));
  const fakeCodexPath = path.join(tempDir, "fake-codex");
  const codexHome = path.join(tempDir, ".codex");
  writeStdinGuardedCodexScript(fakeCodexPath);
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    '[plugins."gmail@openai-curated"]',
    "enabled = true",
    ""
  ].join("\n"));

  const previousCodexShell = process.env.CODEX_SHELL;
  delete process.env.CODEX_SHELL;
  try {
    const result = await buildLiveGmailInboundSyncPayload(buildGmailUser("codex"), [], {
      accountId: "gmail-account-1",
      codexCli: fakeCodexPath,
      codexHome
    });

    assert.equal(result.probe.detectedStatus, "available");
    assert.equal(result.transport.kind, "direct_runtime");
    assert.equal(result.capture.error, null);
    assert.equal(result.capture.status, "success");
    assert.equal(result.capture.itemCount, 0);
  } finally {
    if (previousCodexShell === undefined) {
      delete process.env.CODEX_SHELL;
    } else {
      process.env.CODEX_SHELL = previousCodexShell;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
