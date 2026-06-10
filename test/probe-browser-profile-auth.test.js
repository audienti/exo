// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probeBrowserProfileAuth } from "../src/core/probe-browser-profile-auth.js";

const TIMESTAMP = "2026-06-09T12:00:00.000Z";

// The captured auth probe the fake CLIs return; it must satisfy
// browserProfileAuthProbeResultSchema so normalizeCapturedAuthProbe accepts it.
const SUCCESS_AUTH_PROBE = {
  status: "ready",
  summary: "Chrome profile is authenticated for linkedin.",
  runtime: "placeholder",
  checkedAt: TIMESTAMP,
  warnings: [],
  capabilityChecks: [
    {
      capability: "linkedin",
      verified: true,
      details: "Signed in to LinkedIn.",
      expectedHandle: null,
      detectedHandle: null,
      sourceUrl: null
    }
  ]
};

// Mirrors the live claude/codex CLI behavior that motivated the stdin fix:
// the child reads stdin to EOF before answering. If the caller leaves the
// stdin pipe open, this guard fails the capture with a concrete error after
// 4s instead of hanging the suite.
const STDIN_EOF_GUARD = `"${process.execPath}" -e 'const watchdog = setTimeout(() => { console.error("stdin was left open by the browser auth probe caller"); process.exit(7); }, 4000); process.stdin.resume(); process.stdin.on("end", () => { clearTimeout(watchdog); process.exit(0); });' || exit 7`;

/**
 * @param {string} id
 */
function buildChromeProfile(id) {
  return {
    id,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    label: `chrome-auth-probe-${id}`,
    browser: "chrome",
    browserCommand: null,
    userDataDir: "/tmp/exo-chrome-user-data",
    profileDirectory: "Default",
    profilePath: "/tmp/exo-chrome-user-data/Default",
    detectedProfileName: "Default",
    capabilities: ["linkedin"],
    verifiedCapabilities: [],
    notes: null,
    status: "untested",
    lastTestedAt: null,
    lastTestResult: null
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
    structured_output: SUCCESS_AUTH_PROBE
  });
  const lines = [
    "#!/bin/sh",
    'if [ "$1" = "plugins" ] && [ "$2" = "list" ]; then',
    '  echo "Installed plugins:"',
    "  echo '  ❯ chrome-devtools-mcp@claude-plugins-official'",
    "  exit 0",
    "fi",
    'if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then',
    "  echo 'plugin:chrome-devtools-mcp:chrome-devtools: connected - ✓ Connected'",
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
    JSON.stringify(SUCCESS_AUTH_PROBE, null, 2),
    "JSON",
    ""
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
  fs.chmodSync(filePath, 0o755);
}

test("browser auth probe (claude) closes the CLI's stdin so the runtime does not block", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-profile-auth-claude-stdin-"));
  const fakeClaudePath = path.join(tempDir, "fake-claude");
  writeStdinGuardedClaudeScript(fakeClaudePath);

  try {
    const result = await probeBrowserProfileAuth(buildChromeProfile("claude-profile"), {
      runtime: "claude",
      claudeCli: fakeClaudePath
    });

    assert.ok(result.lastAuthProbeResult, "expected an auth probe result");
    assert.equal(result.lastAuthProbeResult.status, "ready");
    assert.equal(result.lastAuthProbeResult.capabilityChecks[0].capability, "linkedin");
    assert.equal(result.lastAuthProbeResult.capabilityChecks[0].verified, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("browser auth probe (codex) closes the CLI's stdin so the runtime does not block", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-profile-auth-codex-stdin-"));
  const fakeCodexPath = path.join(tempDir, "fake-codex");
  const codexHome = path.join(tempDir, ".codex");
  writeStdinGuardedCodexScript(fakeCodexPath);
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    '[plugins."chrome@openai-bundled"]',
    "enabled = true",
    ""
  ].join("\n"));

  try {
    const result = await probeBrowserProfileAuth(buildChromeProfile("codex-profile"), {
      runtime: "codex",
      codexCli: fakeCodexPath,
      codexHome
    });

    assert.ok(result.lastAuthProbeResult, "expected an auth probe result");
    assert.equal(result.lastAuthProbeResult.status, "ready");
    assert.equal(result.lastAuthProbeResult.capabilityChecks[0].capability, "linkedin");
    assert.equal(result.lastAuthProbeResult.capabilityChecks[0].verified, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
