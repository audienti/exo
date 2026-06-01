// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadJsonCassette } from "./support/cassettes.js";
import {
  cliPath,
  runCliJson,
  setupReadyChromeProfile,
  writeFakeCodexCaptureScript,
  writeFakeClaudeScript,
  createLinkedProspectContext
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
    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-live-fail-user", "--owner", "william", "--json"]);
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

test("inbound sync gmail-live records governed failure when the selected runtime chrome harness is unavailable for a profile-backed Gmail account", () => {
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

    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-live-profile-fail-user", "--owner", "william", "--json"]);
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

    const result = runCliJson(tempDir, [
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

test("inbound sync linkedin-live records governed failure when the selected runtime chrome harness is unavailable", () => {
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

    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-live-fail-user", "--owner", "william", "--json"]);
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

    const result = runCliJson(tempDir, [
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

    assert.equal(result.probe.detectedStatus, "unavailable");
    assert.equal(result.capture.mode, "quick");
    assert.equal(result.capture.sectionCount, 5);
    assert.equal(result.capture.sections.every((section) => section.status === "failed"), true);
    assert.equal(result.applied.counts.failedSurfaceCount, 5);
    assert.equal(result.applied.counts.observationCount, 0);

    const syncView = runCliJson(tempDir, ["inbound", "sync", "show", user.id, "--json"]);
    const linkedinSurface = syncView.accounts
      .find((account) => account.accountId === linkedinAccountId)
      .surfaces.find((surface) => surface.key === "linkedin-received-invitations");
    assert.equal(linkedinSurface.lastRunStatus, "failed");
    assert.match(linkedinSurface.lastError, /not available/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync live auto-discovers codex chrome for browser-backed accounts and returns an agent handoff contract in Codex shell", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-live-codex-handoff-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com", ".google.com"],
    historyUrls: ["https://www.linkedin.com/feed/", "https://mail.google.com/mail/u/0/#inbox"]
  });

  writeCodexPluginConfig(codexHome, "chrome@openai-bundled", true);

  try {
    const profile = runCliJson(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "codex-handoff-profile",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--capability",
      "gmail",
      "--json"
    ]);

    const user = runCliJson(tempDir, ["users", "add", "--label", "codex-handoff-user", "--owner", "william", "--json"]);
    runCliJson(tempDir, ["users", "accounts", "add", user.id, "--capability", "linkedin", "--handle", "codex-handoff-user", "--profile", profile.id, "--preferred", "--json"]);
    runCliJson(tempDir, ["users", "accounts", "add", user.id, "--capability", "gmail", "--handle", "codex-handoff-user@example.com", "--profile", profile.id, "--preferred", "--json"]);

    const result = runCliJson(tempDir, ["inbound", "sync", "live", user.id, "--json"], {
      CODEX_HOME: codexHome,
      CODEX_SHELL: "1"
    });

    assert.equal(result.transportStatus, "agent_capture_required");
    assert.equal(result.canApply, false);
    assert.equal(result.payload, null);
    assert.equal(result.landingPlan.accountCount, 2);
    assert.match(result.landingPlan.applyCommand, new RegExp(`exo inbound sync run ${user.id}`));

    const linkedin = result.accounts.find((account) => account.account.capability === "linkedin");
    const gmail = result.accounts.find((account) => account.account.capability === "gmail");

    assert.equal(linkedin.probe.detectedStatus, "available");
    assert.equal(linkedin.transport.kind, "agent_handoff");
    assert.equal(linkedin.transport.runtime, "codex");
    assert.equal(linkedin.transport.connector, "chrome");
    assert.match(linkedin.transport.captureRequest.prompt, /native Chrome\/browser-control surface/i);
    assert.match(linkedin.transport.captureRequest.buildPayloadCommand, /exo inbound sync linkedin .* --input - --json/i);

    assert.equal(gmail.probe.detectedStatus, "available");
    assert.equal(gmail.transport.kind, "agent_handoff");
    assert.equal(gmail.transport.runtime, "codex");
    assert.equal(gmail.transport.connector, "chrome");
    assert.match(gmail.transport.captureRequest.prompt, /inspect one live Gmail inbox/i);
    assert.match(gmail.transport.captureRequest.buildPayloadCommand, /exo inbound sync gmail .* --input - --json/i);

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
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/", "https://www.linkedin.com/mynetwork/invitation-manager/sent/"]
  });

  writeCodexPluginConfig(codexHome, "chrome@openai-bundled", true);

  try {
    const profile = runCliJson(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "codex-full-handoff-profile",
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

    const user = runCliJson(tempDir, ["users", "add", "--label", "codex-full-handoff-user", "--owner", "william", "--json"]);
    runCliJson(tempDir, ["users", "accounts", "add", user.id, "--capability", "linkedin", "--handle", "codex-full-handoff-user", "--profile", profile.id, "--preferred", "--json"]);

    const result = runCliJson(tempDir, ["inbound", "sync", "live", user.id, "--capability", "linkedin", "--mode", "full", "--json"], {
      CODEX_HOME: codexHome,
      CODEX_SHELL: "1"
    });

    assert.equal(result.mode, "full");
    assert.equal(result.transportStatus, "agent_capture_required");
    assert.equal(result.canApply, false);
    assert.equal(result.accounts.length, 1);
    assert.equal(result.accounts[0].account.capability, "linkedin");
    assert.equal(result.accounts[0].transport.kind, "agent_handoff");
    assert.match(result.accounts[0].transport.captureRequest.prompt, /requested mode is full/i);
    assert.match(result.accounts[0].transport.captureRequest.prompt, /fully reconcile|full reconciliation|reconcile/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync live preserves mixed-account partial failure when Gmail fails and LinkedIn succeeds", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-live-partial-fail-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");
  const fakeClaudePath = path.join(tempDir, "fake-claude");
  const chrome = setupReadyChromeProfile(tempDir, {
    historyUrls: ["https://www.linkedin.com/feed/", "https://www.linkedin.com/mynetwork/"]
  });

  writeCodexPluginConfig(codexHome, "gmail@openai-curated", false);
  writeFakeCodexCaptureScript(fakeCodexPath, {}, { exitCode: 91 });
  writeFakeClaudeScript(fakeClaudePath, {
    plugins: ["chrome-devtools-mcp@claude-plugins-official"],
    mcpLines: ["plugin:chrome-devtools-mcp:chrome-devtools: connected - ✓ Connected"],
    structuredOutput: loadJsonCassette("inbound/linkedin-live/claude-partial-failure-success.json")
  });

  try {
    const profile = runCliJson(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "combined-live-partial-profile",
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

    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when inbound truth has to survive partial connector failure.",
      signal: "company::Is there active workflow pressure that makes inbound replies or invites important?",
      prospectName: "Alicia Buyer",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the workflow pain that makes inbound routing operationally relevant.",
      email: "alicia@buyer.example",
      linkedinProfileUrl: "https://www.linkedin.com/in/alicia-buyer/"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "combined-live-partial-user", "--owner", "william", "--json"]);
    runCliJson(tempDir, ["users", "harness", "add", user.id, "--runtime", "codex", "--connector", "gmail", "--status", "unknown", "--json"]);
    runCliJson(tempDir, ["users", "harness", "add", user.id, "--runtime", "claude", "--connector", "chrome", "--status", "unknown", "--json"]);

    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "combined-live-partial-user",
      "--profile",
      profile.id,
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

    const result = runCliJson(tempDir, ["inbound", "sync", "live", user.id, "--apply", "--refresh", "--json"], {
      CODEX_HOME: codexHome,
      EXO_CODEX_CLI: fakeCodexPath,
      EXO_CLAUDE_CLI: fakeClaudePath
    });

    assert.equal(result.accounts.length, 2);
    assert.equal(result.accounts.find((account) => account.account.id === gmailAccountId).probe.detectedStatus, "unavailable");
    assert.equal(result.accounts.find((account) => account.account.id === linkedinAccountId).probe.detectedStatus, "available");
    assert.equal(result.applied.counts.checkedSurfaceCount, 6);
    assert.equal(result.applied.counts.successSurfaceCount, 5);
    assert.equal(result.applied.counts.failedSurfaceCount, 1);
    assert.equal(result.applied.counts.observationCount, 1);

    const syncView = runCliJson(tempDir, ["inbound", "sync", "show", user.id, "--json"]);
    const gmailSurface = syncView.accounts
      .find((account) => account.accountId === gmailAccountId)
      .surfaces.find((surface) => surface.key === "gmail-inbox-threads");
    const linkedinSurface = syncView.accounts
      .find((account) => account.accountId === linkedinAccountId)
      .surfaces.find((surface) => surface.key === "linkedin-received-invitations");
    assert.equal(gmailSurface.lastRunStatus, "failed");
    assert.match(gmailSurface.lastError, /not available/i);
    assert.equal(linkedinSurface.lastRunStatus, "success");
    assert.equal(linkedinSurface.lastItemCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.counts.observationCount, 1);
    assert.equal(observations.observations[0].kind, "connection_request_received");
    assert.equal(observations.observations[0].motionId, motion.id);
    assert.equal(observations.observations[0].companyId, company.id);
    assert.equal(observations.observations[0].prospectId, prospect.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
