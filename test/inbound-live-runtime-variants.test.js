// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadJsonCassette } from "./support/cassettes.js";
import {
  runCliJson,
  setupReadyChromeProfile,
  writeFakeCodexCaptureScript,
  writeFakeClaudeScript,
  createLinkedProspectContext
} from "./support/live-runtime.js";

function writeCodexChromeConfig(codexHome, enabled) {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [`[plugins."chrome@openai-bundled"]`, `enabled = ${enabled ? "true" : "false"}`, ""].join("\n"));
}

function createGmailChromeProfile(tempDir, label) {
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".google.com", "mail.google.com"],
    historyUrls: ["https://mail.google.com/mail/u/0/#inbox"]
  });

  return runCliJson(tempDir, [
    "profiles",
    "add",
    "--browser",
    "chrome",
    "--label",
    label,
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
}

function createLinkedinChromeProfile(tempDir, label) {
  const chrome = setupReadyChromeProfile(tempDir, {
    historyUrls: ["https://www.linkedin.com/feed/", "https://www.linkedin.com/mynetwork/"]
  });

  const profile = runCliJson(tempDir, [
    "profiles",
    "add",
    "--browser",
    "chrome",
    "--label",
    label,
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

  return { chrome, profile };
}

test("inbound sync gmail-live uses a Claude Gmail cassette and applies governed writeback", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-gmail-live-claude-cassette-"));
  const fakeClaudePath = path.join(tempDir, "fake-claude");

  writeFakeClaudeScript(fakeClaudePath, {
    plugins: ["gmail"],
    mcpLines: ["plugin:gmail:gmail: connected - ✓ Connected"],
    structuredOutput: loadJsonCassette("inbound/gmail-live/claude-success.json")
  });

  try {
    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when outbound operators need governed inbox truth.",
      signal: "company::Is there active revenue complexity that makes a reply operationally important?",
      prospectName: "Alicia Buyer",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the operational workflow pain that makes the inbound email relevant.",
      email: "alicia@buyer.example"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-live-claude-user", "--owner", "william", "--json"]);
    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "gmail-live-claude-user@example.com",
      "--runtime",
      "claude",
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
      "--limit",
      "10",
      "--since",
      "2026-05-30T00:00:00.000Z",
      "--apply",
      "--refresh",
      "--json"
    ], {
      EXO_CLAUDE_CLI: fakeClaudePath
    });

    assert.equal(result.probe.detectedStatus, "available");
    assert.match(result.probe.reason, /Claude plugin gmail/i);
    assert.equal(result.capture.status, "success");
    assert.equal(result.capture.threadCount, 1);
    assert.equal(result.applied.refreshed.inbox.itemCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.observations[0].actorHandle, "alicia@buyer.example");
    assert.equal(observations.observations[0].motionId, motion.id);
    assert.equal(observations.observations[0].companyId, company.id);
    assert.equal(observations.observations[0].prospectId, prospect.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync gmail-live uses a profile-backed Claude cassette and applies governed writeback", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-gmail-live-profile-claude-cassette-"));
  const fakeClaudePath = path.join(tempDir, "fake-claude");

  writeFakeClaudeScript(fakeClaudePath, {
    plugins: ["chrome-devtools-mcp@claude-plugins-official"],
    mcpLines: ["plugin:chrome-devtools-mcp:chrome-devtools: connected - ✓ Connected"],
    structuredOutput: loadJsonCassette("inbound/gmail-live/profile-claude-success.json")
  });

  try {
    const profile = createGmailChromeProfile(tempDir, "gmail-live-profile-claude");
    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when outbound operators need governed inbox truth.",
      signal: "company::Is there active revenue complexity that makes a reply operationally important?",
      prospectName: "Alicia Buyer",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the operational workflow pain that makes the inbound email relevant.",
      email: "alicia@buyer.example"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-live-profile-claude-user", "--owner", "william", "--json"]);
    runCliJson(tempDir, ["users", "harness", "add", user.id, "--runtime", "claude", "--connector", "chrome", "--status", "unknown", "--json"]);
    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "gmail-live-profile-claude-user@example.com",
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
      "claude",
      "--limit",
      "10",
      "--since",
      "2026-05-30T00:00:00.000Z",
      "--apply",
      "--refresh",
      "--json"
    ], {
      EXO_CLAUDE_CLI: fakeClaudePath
    });

    assert.equal(result.probe.detectedStatus, "available");
    assert.match(result.probe.reason, /Claude (plugin|MCP server)/i);
    assert.equal(result.capture.status, "success");
    assert.equal(result.capture.threadCount, 1);
    assert.equal(result.applied.refreshed.inbox.itemCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.observations[0].actorHandle, "alicia@buyer.example");
    assert.equal(observations.observations[0].motionId, motion.id);
    assert.equal(observations.observations[0].companyId, company.id);
    assert.equal(observations.observations[0].prospectId, prospect.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync gmail-live uses a profile-backed Codex cassette and applies governed writeback", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-gmail-live-profile-codex-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");

  writeCodexChromeConfig(codexHome, true);
  writeFakeCodexCaptureScript(fakeCodexPath, loadJsonCassette("inbound/gmail-live/profile-codex-success.json"));

  try {
    const profile = createGmailChromeProfile(tempDir, "gmail-live-profile");
    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when outbound operators need governed inbox truth.",
      signal: "company::Is there active revenue complexity that makes a reply operationally important?",
      prospectName: "Alicia Buyer",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the operational workflow pain that makes the inbound email relevant.",
      email: "alicia@buyer.example"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-live-profile-user", "--owner", "william", "--json"]);
    runCliJson(tempDir, ["users", "harness", "add", user.id, "--runtime", "codex", "--connector", "chrome", "--status", "unknown", "--json"]);
    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "gmail-live-profile-user@example.com",
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
      "--limit",
      "10",
      "--since",
      "2026-05-30T00:00:00.000Z",
      "--apply",
      "--refresh",
      "--json"
    ], {
      CODEX_HOME: codexHome,
      EXO_CODEX_CLI: fakeCodexPath
    });

    assert.equal(result.probe.detectedStatus, "available");
    assert.match(result.probe.reason, /chrome@openai-bundled/);
    assert.equal(result.capture.status, "success");
    assert.equal(result.capture.threadCount, 1);
    assert.equal(result.applied.refreshed.inbox.itemCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.observations[0].actorHandle, "alicia@buyer.example");
    assert.equal(observations.observations[0].motionId, motion.id);
    assert.equal(observations.observations[0].companyId, company.id);
    assert.equal(observations.observations[0].prospectId, prospect.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live uses a Codex cassette and applies governed writeback", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-codex-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");

  writeCodexChromeConfig(codexHome, true);
  writeFakeCodexCaptureScript(fakeCodexPath, loadJsonCassette("inbound/linkedin-live/codex-success.json"));

  try {
    const { profile } = createLinkedinChromeProfile(tempDir, "linkedin-live-profile");
    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when inbound LinkedIn truth has to land on the right branch automatically.",
      signal: "company::Is there active GTM pressure that makes inbound connection requests important?",
      prospectName: "Alicia Buyer",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the workflow pain that makes the inbound connection request worth routing immediately.",
      linkedinProfileUrl: "https://www.linkedin.com/in/alicia-buyer/"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-live-user", "--owner", "william", "--json"]);
    runCliJson(tempDir, ["users", "harness", "add", user.id, "--runtime", "codex", "--connector", "chrome", "--status", "unknown", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-live-user",
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
      "--limit",
      "10",
      "--apply",
      "--refresh",
      "--json"
    ], {
      CODEX_HOME: codexHome,
      EXO_CODEX_CLI: fakeCodexPath
    });

    assert.equal(result.probe.detectedStatus, "available");
    assert.match(result.probe.reason, /chrome@openai-bundled/);
    assert.equal(result.capture.mode, "quick");
    assert.equal(result.capture.sections[1].surfaceKey, "linkedin-received-invitations");
    assert.equal(result.capture.sections[1].observationCount, 1);
    assert.equal(result.applied.refreshed.inbox.itemCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.observations[0].kind, "connection_request_received");
    assert.equal(observations.observations[0].motionId, motion.id);
    assert.equal(observations.observations[0].companyId, company.id);
    assert.equal(observations.observations[0].prospectId, prospect.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live uses a Claude cassette and applies governed writeback", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-claude-cassette-"));
  const fakeClaudePath = path.join(tempDir, "fake-claude");

  writeFakeClaudeScript(fakeClaudePath, {
    plugins: ["chrome-devtools-mcp@claude-plugins-official"],
    mcpLines: ["plugin:chrome-devtools-mcp:chrome-devtools: connected - ✓ Connected"],
    structuredOutput: loadJsonCassette("inbound/linkedin-live/claude-success.json")
  });

  try {
    const { profile } = createLinkedinChromeProfile(tempDir, "linkedin-live-claude-profile");
    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when inbound LinkedIn truth has to land on the right branch automatically.",
      signal: "company::Is there active GTM pressure that makes inbound connection requests important?",
      prospectName: "Alicia Buyer",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the workflow pain that makes the inbound connection request worth routing immediately.",
      linkedinProfileUrl: "https://www.linkedin.com/in/alicia-buyer/"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-live-claude-user", "--owner", "william", "--json"]);
    runCliJson(tempDir, ["users", "harness", "add", user.id, "--runtime", "claude", "--connector", "chrome", "--status", "unknown", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-live-claude-user",
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
      "claude",
      "--limit",
      "10",
      "--apply",
      "--refresh",
      "--json"
    ], {
      EXO_CLAUDE_CLI: fakeClaudePath
    });

    assert.equal(result.probe.detectedStatus, "available");
    assert.match(result.probe.reason, /Claude (plugin|MCP server)/i);
    assert.equal(result.capture.mode, "quick");
    assert.equal(result.capture.sections[1].surfaceKey, "linkedin-received-invitations");
    assert.equal(result.capture.sections[1].observationCount, 1);
    assert.equal(result.applied.refreshed.inbox.itemCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.observations[0].kind, "connection_request_received");
    assert.equal(observations.observations[0].motionId, motion.id);
    assert.equal(observations.observations[0].companyId, company.id);
    assert.equal(observations.observations[0].prospectId, prospect.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
