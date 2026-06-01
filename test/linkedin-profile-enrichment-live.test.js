// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

/**
 * @param {string} profilePath
 * @param {{ cookieHosts?: string[], historyUrls?: string[] }} input
 */
function seedBrowserEvidence(profilePath, input) {
  const cookiesDb = new DatabaseSync(path.join(profilePath, "Cookies"));
  cookiesDb.exec("CREATE TABLE cookies (host_key TEXT);");
  for (const host of input.cookieHosts ?? []) {
    cookiesDb.prepare("INSERT INTO cookies (host_key) VALUES (?)").run(host);
  }
  cookiesDb.close();

  const historyDb = new DatabaseSync(path.join(profilePath, "History"));
  historyDb.exec("CREATE TABLE urls (url TEXT);");
  for (const url of input.historyUrls ?? []) {
    historyDb.prepare("INSERT INTO urls (url) VALUES (?)").run(url);
  }
  historyDb.close();
}

/**
 * @param {string} tempDir
 */
function setupReadyChromeProfile(tempDir) {
  const userDataDir = path.join(tempDir, "Chrome");
  const profileDirectory = "Profile 4";
  const profileName = "LinkedIn Main";
  const profilePath = path.join(userDataDir, profileDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(browserCommand, 0o755);
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: { name: profileName }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: profileName } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  return {
    userDataDir,
    profileDirectory,
    browserCommand
  };
}

/**
 * @param {string} tempDir
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
function runCli(tempDir, args, extraEnv = {}) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv, EXO_STATE_DIR: tempDir },
    encoding: "utf8"
  });
}

test("companies prospects enrich-linkedin-profile-live returns a governed Codex profile-page capture handoff", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-linkedin-profile-live-"));
  const chrome = setupReadyChromeProfile(tempDir);
  const codexHome = path.join(tempDir, ".codex");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      '[plugins."chrome@openai-bundled"]',
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const motion = JSON.parse(runCli(tempDir, [
      "motion",
      "add",
      "--url",
      "https://example.com/credit-risk-kernel",
      "--premise",
      "This offer matters when risk operators need a governed way to inspect live LinkedIn profile context before writing.",
      "--audience",
      "Risk leaders",
      "--signal",
      "company::Is there recent evidence that the company widened credit, merchant, or GTM surface area?",
      "--json"
    ]));

    const company = JSON.parse(runCli(tempDir, [
      "companies",
      "add",
      "--name",
      "BillEase",
      "--domain",
      "billease.ph",
      "--website-url",
      "https://billease.ph",
      "--motion",
      motion.id,
      "--json"
    ]));

    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "omalab-main",
      "--browser-command",
      chrome.browserCommand,
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--capability",
      "linkedin",
      "--json"
    ]));

    runCli(tempDir, [
      "profiles",
      "claim",
      profile.id,
      "--label",
      "omalab-main",
      "--workspace",
      "omalab",
      "--owner",
      "william",
      "--scope",
      "work",
      "--account",
      "linkedin:william-main",
      "--json"
    ]);

    const user = JSON.parse(runCli(tempDir, [
      "users",
      "add",
      "--label",
      "william-main",
      "--owner",
      "William",
      "--json"
    ]));

    runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "william-main",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]);

    runCli(tempDir, [
      "companies",
      "user",
      "assign",
      company.id,
      "--user",
      user.id,
      "--reason",
      "LinkedIn prospect research should run from william-main",
      "--json"
    ]);

    const prospectResult = JSON.parse(runCli(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Minh Le",
      "--title",
      "Head of Risk",
      "--linkedin-profile-url",
      "https://www.linkedin.com/in/minh-le-risk/",
      "--why-relevant",
      "Primary operator for lending controls and decisioning quality.",
      "--json"
    ]));

    const prospectId = prospectResult.prospects[0].id;
    const result = JSON.parse(runCli(tempDir, [
      "companies",
      "prospects",
      "enrich-linkedin-profile-live",
      company.id,
      "--motion",
      motion.id,
      "--prospect",
      prospectId,
      "--runtime",
      "codex",
      "--json"
    ], {
      CODEX_HOME: codexHome,
      CODEX_SHELL: "1"
    }));

    assert.equal(result.transport.kind, "agent_handoff");
    assert.match(result.transport.captureRequest.prompt, /inspect the real linkedin profile page/i);
    assert.match(result.transport.captureRequest.prompt, /captureGuide/i);
    assert.match(result.transport.captureRequest.prompt, /surfaceHints, profileSelection, and captureGuide/i);
    assert.match(result.transport.captureRequest.prompt, /Use captureGuide\.writebackRules and verificationCommands/i);
    assert.equal(result.transport.captureRequest.executionMode, "native_tools_only");
    assert.equal(result.transport.captureRequest.captureTransportMode, "browser_native_only");
    assert.equal(result.transport.captureRequest.shellFallbackAllowed, false);
    assert.equal(result.transport.captureRequest.exoCliWritebackRequired, true);
    assert.equal(result.transport.captureRequest.coldStartReady, true);
    assert.equal(result.transport.captureRequest.noRepoRediscoveryRequired, true);
    assert.ok(result.transport.captureRequest.captureGuide.captureRules.some((line) => /Do not shell out through codex exec, EXO_CODEX_CLI/i.test(line)));
    assert.match(result.transport.captureRequest.captureGuide.rediscoveryPolicy, /Do not reopen repo source files, CLI help, or prior chat history/i);
    assert.match(result.transport.captureRequest.buildPayloadCommand, /exo companies prospects enrich-linkedin-profile .* --input - --json/i);
    assert.equal(result.transport.captureRequest.buildPayloadInputMode, "normalized_capture_json_stdin");
    assert.equal(result.transport.captureRequest.rawNetworkBodiesRequired, false);
    assert.equal(result.transport.captureRequest.applyCommand, null);
    assert.equal(result.transport.captureRequest.applyInputMode, null);
    assert.equal(result.transport.captureRequest.applyStdinContract, null);
    assert.ok(result.transport.captureRequest.verificationCommands.some((command) => new RegExp(`exo companies prospects show ${company.id} --motion ${motion.id} --prospect ${prospectId} --json`).test(command)));
    assert.equal(result.transport.captureRequest.surfaceHints.profilePage.surface, "linkedin-profile-page");
    assert.equal(result.transport.captureRequest.profileSelection.expectedProfile.profileDirectory, chrome.profileDirectory);
    assert.equal(result.transport.captureRequest.profileSelection.expectedHandle, "william-main");
    assert.ok(result.transport.captureRequest.surfaceHints.profilePage.entryHints.startUrls.includes("https://www.linkedin.com/in/minh-le-risk/"));
    assert.ok(result.transport.captureRequest.surfaceHints.profilePage.extractionHints.identityFields.includes("public_identifier"));
    assert.ok(result.transport.captureRequest.surfaceHints.profilePage.extractionHints.recentPostFields.includes("post_url"));
    assert.equal(result.prospect.id, prospectId);
    assert.equal(result.prospect.linkedinProfileUrl, "https://www.linkedin.com/in/minh-le-risk/");
    assert.equal(result.execution.transport.preferredTransport.tool, "chrome");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
