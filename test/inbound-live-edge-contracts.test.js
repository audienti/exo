// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  cliPath,
  runCliJson,
  setupReadyChromeProfile,
  uniqueTestLabel,
  writeFakeCodexCaptureScript
} from "./support/live-runtime.js";

function writeCodexPluginConfig(codexHome, pluginKey, enabled) {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [`[plugins."${pluginKey}"]`, `enabled = ${enabled ? "true" : "false"}`, ""].join("\n"));
}

test("inbound sync gmail-live records governed failure when the Codex Gmail connector is unavailable", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-gmail-live-fail-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");

  writeCodexPluginConfig(codexHome, "gmail@openai-curated", false);
  writeFakeCodexCaptureScript(fakeCodexPath, {}, { exitCode: 91 });

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "gmail-live-fail-user"), "--owner", "william", "--json"]);
    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "gmail-live-fail-user@example.com",
      "--runtime",
      "codex",
      "--connector",
      "gmail",
      "--preferred",
      "--json"
    ]);
    const gmailAccountId = withGmail.accounts.find((account) => account.capability === "gmail").id;

    const result = runCliJson(tempDir, [
      "inbound",
      "sync",
      "gmail-live",
      user.id,
      "--account",
      gmailAccountId,
      "--apply",
      "--json"
    ], {
      CODEX_HOME: codexHome,
      EXO_CODEX_CLI: fakeCodexPath
    });

    assert.equal(result.probe.detectedStatus, "unavailable");
    assert.equal(result.capture.status, "failed");
    assert.equal(result.capture.threadCount, 0);
    assert.match(result.capture.error, /not available/i);
    assert.equal(result.applied.counts.failedSurfaceCount, 1);
    assert.equal(result.applied.counts.observationCount, 0);

    const syncView = runCliJson(tempDir, ["inbound", "sync", "show", user.id, "--json"]);
    const gmailSurface = syncView.accounts
      .find((account) => account.accountId === gmailAccountId)
      .surfaces.find((surface) => surface.key === "gmail-inbox-threads");
    assert.equal(gmailSurface.lastRunStatus, "failed");
    assert.match(gmailSurface.lastError, /not available/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync gmail-live rejects a legacy profile-backed Gmail account before probing runtime availability", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-gmail-live-profile-fail-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".google.com", "mail.google.com"],
    historyUrls: ["https://mail.google.com/mail/u/0/#inbox"]
  });

  writeCodexPluginConfig(codexHome, "chrome@openai-bundled", false);
  writeFakeCodexCaptureScript(fakeCodexPath, {}, { exitCode: 91 });

  try {
    const profile = runCliJson(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "gmail-live-profile-fail",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "gmail",
      "--json"
    ]);

    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "gmail-live-profile-fail-user"), "--owner", "william", "--json"]);
    runCliJson(tempDir, ["users", "harness", "add", user.id, "--runtime", "codex", "--connector", "chrome", "--status", "unknown", "--json"]);
    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "gmail-live-profile-fail-user@example.com",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]);
    const gmailAccountId = withGmail.accounts.find((account) => account.capability === "gmail").id;

    let error = null;
    try {
      runCliJson(tempDir, [
        "inbound",
        "sync",
        "gmail-live",
        user.id,
        "--account",
        gmailAccountId,
        "--runtime",
        "codex",
        "--apply",
        "--json"
      ], {
        CODEX_HOME: codexHome,
        EXO_CODEX_CLI: fakeCodexPath
      });
    } catch (caught) {
      error = caught;
    }

    assert.ok(error);
    assert.match(String(error.stderr), /profile-backed Gmail accounts are no longer supported/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live rejects a legacy profile-backed LinkedIn account before probing runtime availability", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-fail-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");
  const chrome = setupReadyChromeProfile(tempDir, {
    historyUrls: ["https://www.linkedin.com/feed/", "https://www.linkedin.com/mynetwork/"]
  });

  writeCodexPluginConfig(codexHome, "chrome@openai-bundled", false);
  writeFakeCodexCaptureScript(fakeCodexPath, {}, { exitCode: 91 });

  try {
    const profile = runCliJson(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "linkedin-live-fail-profile",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]);

    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "linkedin-live-fail-user"), "--owner", "william", "--json"]);
    runCliJson(tempDir, ["users", "harness", "add", user.id, "--runtime", "codex", "--connector", "chrome", "--status", "unknown", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-live-fail-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    let error = null;
    try {
      runCliJson(tempDir, [
        "inbound",
        "sync",
        "linkedin-live",
        user.id,
        "--account",
        linkedinAccountId,
        "--runtime",
        "codex",
        "--apply",
        "--json"
      ], {
        CODEX_HOME: codexHome,
        EXO_CODEX_CLI: fakeCodexPath
      });
    } catch (caught) {
      error = caught;
    }

    assert.ok(error);
    assert.match(String(error.stderr), /profile-backed LinkedIn accounts are no longer supported/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync live returns managed-account handoff contracts in Codex shell", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-live-codex-handoff-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "ignored-codex-shell-binary");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "",
    '[plugins."gmail@openai-curated"]',
    "enabled = true",
    ""
  ].join("\n"));

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "codex-handoff-user"), "--owner", "william", "--json"]);
    runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "codex-handoff-user",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--preferred",
      "--json"
    ]);
    runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "codex-handoff-user@example.com",
      "--runtime",
      "codex",
      "--connector",
      "gmail",
      "--preferred",
      "--json"
    ]);

    const result = runCliJson(tempDir, ["inbound", "sync", "live", user.id, "--json"], {
      CODEX_HOME: codexHome,
      CODEX_SHELL: "1",
      EXO_CODEX_CLI: fakeCodexPath
    });

    assert.equal(result.transportStatus, "agent_capture_required");
    assert.equal(result.canApply, false);
    assert.equal(result.payload, null);
    assert.equal(result.landingPlan.contractVersion, "exo-live-landing-plan-v2");
    assert.equal(result.landingPlan.coldStartReady, true);
    assert.equal(result.landingPlan.noRepoRediscoveryRequired, true);
    assert.equal(result.landingPlan.accountCount, 2);
    assert.match(result.landingPlan.applyCommand, new RegExp(`exo inbound sync run ${user.id}`));
    assert.ok(result.landingPlan.verificationCommands.some((command) => new RegExp(`exo inbound sync show ${user.id} --json`).test(command)));
    assert.ok(result.landingPlan.verificationCommands.some((command) => new RegExp(`exo next --user ${user.id} --json`).test(command)));

    const linkedin = result.accounts.find((account) => account.account.capability === "linkedin");
    const gmail = result.accounts.find((account) => account.account.capability === "gmail");

    assert.equal(linkedin.probe.detectedStatus, "available");
    assert.equal(linkedin.transport.kind, "agent_handoff");
    assert.equal(linkedin.transport.runtime, "codex");
    assert.equal(linkedin.transport.connector, "unipile");
    assert.equal(linkedin.transport.captureRequest.executionMode, "native_tools_only");
    assert.equal(linkedin.transport.captureRequest.captureTransportMode, "connector_native_only");
    assert.equal(linkedin.transport.captureRequest.shellFallbackAllowed, false);
    assert.equal(linkedin.transport.captureRequest.exoCliWritebackRequired, true);
    assert.equal(linkedin.transport.captureRequest.noRepoRediscoveryRequired, true);
    assert.equal(linkedin.transport.captureRequest.profileSelection, null);
    assert.match(linkedin.transport.captureRequest.prompt, /native unipile connector available in this runtime/i);
    assert.match(linkedin.transport.captureRequest.prompt, /captureGuide/i);
    assert.match(linkedin.transport.captureRequest.prompt, /captureScaffold/i);
    assert.match(linkedin.transport.captureRequest.prompt, /outputGuide\.surfaceStateRules/i);
    assert.match(linkedin.transport.captureRequest.prompt, /Use captureGuide\.writebackRules and verificationCommands/i);
    assert.match(linkedin.transport.captureRequest.prompt, /start from captureScaffold/i);
    assert.ok(linkedin.transport.captureRequest.captureGuide.captureRules.some((line) => /Do not shell out through codex exec, EXO_CODEX_CLI/i.test(line)));
    assert.match(linkedin.transport.captureRequest.captureGuide.rediscoveryPolicy, /Do not reopen repo source files, CLI help, or prior chat history/i);
    assert.equal(linkedin.transport.captureRequest.captureScaffold.version, "exo-linkedin-quick-capture-v2");
    assert.equal(linkedin.transport.captureRequest.outputGuide.modePolicy.requestedMode, "quick");
    assert.match(linkedin.transport.captureRequest.buildPayloadCommand, /exo inbound sync linkedin .* --input - --json/i);
    assert.match(linkedin.transport.captureRequest.applyCommand, /exo inbound sync run .* --input <combined-inbound-sync\.json> --refresh --json/i);
    assert.ok(linkedin.transport.captureRequest.verificationCommands.some((command) => /linkedin-sent-invitations/.test(command)));

    assert.equal(gmail.probe.detectedStatus, "available");
    assert.equal(gmail.transport.kind, "agent_handoff");
    assert.equal(gmail.transport.runtime, "codex");
    assert.equal(gmail.transport.connector, "gmail");
    assert.equal(gmail.transport.captureRequest.executionMode, "native_tools_only");
    assert.equal(gmail.transport.captureRequest.captureTransportMode, "connector_native_only");
    assert.equal(gmail.transport.captureRequest.shellFallbackAllowed, false);
    assert.equal(gmail.transport.captureRequest.exoCliWritebackRequired, true);
    assert.equal(gmail.transport.captureRequest.noRepoRediscoveryRequired, true);
    assert.equal(gmail.transport.captureRequest.profileSelection, null);
    assert.match(gmail.transport.captureRequest.prompt, /inspect one live Gmail inbox/i);
    assert.match(gmail.transport.captureRequest.prompt, /gmail connector available in this runtime/i);
    assert.match(gmail.transport.captureRequest.prompt, /Return only JSON that matches the provided schema/i);
    assert.ok(gmail.transport.captureRequest.captureGuide.captureRules.some((line) => /Do not shell out through codex exec, EXO_CODEX_CLI/i.test(line)));
    assert.match(gmail.transport.captureRequest.captureGuide.rediscoveryPolicy, /Do not reopen repo source files, CLI help, or prior chat history/i);
    assert.match(gmail.transport.captureRequest.buildPayloadCommand, /exo inbound sync gmail .* --input - --json/i);
    assert.match(gmail.transport.captureRequest.applyCommand, /exo inbound sync run .* --input <combined-inbound-sync\.json> --refresh --json/i);
    assert.ok(gmail.transport.captureRequest.verificationCommands.some((command) => new RegExp(`exo inbox --user ${user.id} --json`).test(command)));

    let applyError = null;
    try {
      execFileSync("node", [cliPath, "inbound", "sync", "live", user.id, "--apply", "--json"], {
        cwd: tempDir,
        encoding: "utf8",
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          CODEX_SHELL: "1"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      applyError = error;
    }

    assert.ok(applyError);
    assert.match(String(applyError.stderr), /native agent tools/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync live supports full-mode Codex handoff for LinkedIn reconciliation", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-live-full-handoff-cassette-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    ""
  ].join("\n"));

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "codex-full-handoff-user"), "--owner", "william", "--json"]);
    runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "codex-full-handoff-user",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--preferred",
      "--json"
    ]);

    const result = runCliJson(tempDir, ["inbound", "sync", "live", user.id, "--capability", "linkedin", "--mode", "full", "--json"], {
      CODEX_HOME: codexHome,
      CODEX_SHELL: "1",
      EXO_CODEX_CLI: path.join(tempDir, "ignored-codex-shell-binary")
    });

    assert.equal(result.mode, "full");
    assert.equal(result.transportStatus, "agent_capture_required");
    assert.equal(result.canApply, false);
    assert.equal(result.accounts.length, 1);
    assert.equal(result.accounts[0].account.capability, "linkedin");
    assert.equal(result.accounts[0].transport.kind, "agent_handoff");
    assert.equal(result.accounts[0].transport.captureRequest.executionMode, "native_tools_only");
    assert.equal(result.accounts[0].transport.captureRequest.captureTransportMode, "connector_native_only");
    assert.equal(result.accounts[0].transport.captureRequest.profileSelection, null);
    assert.match(result.accounts[0].transport.captureRequest.prompt, /requested mode is full/i);
    assert.match(result.accounts[0].transport.captureRequest.prompt, /fully reconcile|full reconciliation|reconcile/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync live reports mixed-account failure plus managed-account handoff without inventing a payload", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-live-partial-fail-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "",
    '[plugins."gmail@openai-curated"]',
    "enabled = false",
    ""
  ].join("\n"));
  writeFakeCodexCaptureScript(fakeCodexPath, {}, { exitCode: 91 });

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "combined-live-partial-user"), "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "combined-live-partial-user",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--preferred",
      "--json"
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "combined-live-partial-user@buyer.example",
      "--runtime",
      "codex",
      "--connector",
      "gmail",
      "--preferred",
      "--json"
    ]);
    const gmailAccountId = withGmail.accounts.find((account) => account.capability === "gmail").id;

    const result = runCliJson(tempDir, ["inbound", "sync", "live", user.id, "--json"], {
      CODEX_HOME: codexHome,
      EXO_CODEX_CLI: fakeCodexPath
    });

    assert.equal(result.accounts.length, 2);
    assert.equal(result.transportStatus, "agent_capture_required");
    assert.equal(result.canApply, false);
    assert.equal(result.payload, null);
    assert.equal(result.accounts.find((account) => account.account.id === gmailAccountId).probe.detectedStatus, "unavailable");
    assert.equal(result.accounts.find((account) => account.account.id === linkedinAccountId).probe.detectedStatus, "available");
    assert.equal(result.accounts.find((account) => account.account.id === gmailAccountId).capture.status, "failed");
    assert.match(result.accounts.find((account) => account.account.id === gmailAccountId).capture.error, /not available/i);
    assert.equal(result.accounts.find((account) => account.account.id === linkedinAccountId).transport.kind, "agent_handoff");
    assert.equal(result.accounts.find((account) => account.account.id === linkedinAccountId).capture, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
