// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLiveLinkedinInboundSyncPayload } from "../src/core/inbound-linkedin-live-sync.js";
import { loadJsonCassette } from "./support/cassettes.js";
import {
  runCliJson,
  setupReadyChromeProfile,
  writeFakeCodexCaptureScript,
  writeFakeClaudeScript,
  createLinkedProspectContext,
  uniqueTestLabel
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

function buildManagedLinkedinUser(overrides = {}) {
  const timestamp = overrides.timestamp ?? "2026-06-04T12:00:00.000Z";
  return {
    id: "user-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    label: "linkedin-live-unipile-user",
    owner: "william",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00"
    },
    accounts: [
      {
        id: "linkedin-account-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        capability: "linkedin",
        handle: "linkedin-live-unipile-user",
        label: "LinkedIn via Unipile",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        providerAccountId: "unipile-linkedin-1",
        preferred: true,
        automationControls: {
          weeklyQuotas: {
            profileVisits: null,
            invitations: null,
            messages: null
          }
        },
        notes: null,
        inboundSync: {
          surfaces: []
        },
        ...(overrides.account ?? {})
      }
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        runtime: "codex",
        connector: "unipile",
        label: "codex:unipile",
        status: "available",
        notes: null
      }
    ],
    inboundIgnoreRules: []
  };
}

function writeUnipileCodexConfig(codexHome, envLines = []) {
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    ...(envLines.length
      ? [
          "[mcp_servers.unipile.env]",
          ...envLines,
        ]
      : []),
    ""
  ].join("\n"));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "gmail-live-claude-user"), "--owner", "william", "--json"]);
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

test("inbound sync gmail-live rejects a legacy profile-backed Gmail account even when Claude chrome is available", () => {
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

    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "gmail-live-profile-claude-user"), "--owner", "william", "--json"]);
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
    } catch (caught) {
      error = caught;
    }

    assert.ok(error);
    assert.match(String(error.stderr), /profile-backed Gmail accounts are no longer supported/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync gmail-live rejects a legacy profile-backed Gmail account even when Codex chrome is available", () => {
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

    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "gmail-live-profile-user"), "--owner", "william", "--json"]);
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
    } catch (caught) {
      error = caught;
    }

    assert.ok(error);
    assert.match(String(error.stderr), /profile-backed Gmail accounts are no longer supported/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live rejects a managed Codex chrome connector account and requires Unipile", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-codex-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");

  writeCodexChromeConfig(codexHome, true);
  writeFakeCodexCaptureScript(fakeCodexPath, loadJsonCassette("inbound/linkedin-live/codex-success.json"));

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "linkedin-live-user"), "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-live-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
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
        "--limit",
        "10",
        "--json"
      ], {
        CODEX_HOME: codexHome,
        EXO_CODEX_CLI: fakeCodexPath
      });
    } catch (caught) {
      error = caught;
    }

    assert.ok(error);
    assert.match(String(error.stderr), /requires a managed Unipile account/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live rejects a managed Claude chrome connector account and requires Unipile", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-claude-cassette-"));
  const fakeClaudePath = path.join(tempDir, "fake-claude");

  writeFakeClaudeScript(fakeClaudePath, {
    plugins: ["chrome-devtools-mcp@claude-plugins-official"],
    mcpLines: ["plugin:chrome-devtools-mcp:chrome-devtools: connected - ✓ Connected"],
    structuredOutput: loadJsonCassette("inbound/linkedin-live/claude-success.json")
  });

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "linkedin-live-claude-user"), "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-live-claude-user",
      "--runtime",
      "claude",
      "--connector",
      "chrome",
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
        "claude",
        "--limit",
        "10",
        "--json"
      ], {
        EXO_CLAUDE_CLI: fakeClaudePath
      });
    } catch (caught) {
      error = caught;
    }

    assert.ok(error);
    assert.match(String(error.stderr), /requires a managed Unipile account/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live defaults managed Unipile accounts to direct HTTP", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-direct-default-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenRequests = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const result = await buildLiveLinkedinInboundSyncPayload({
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    }, [], {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      surfaceKeys: ["linkedin-sent-invitations"],
      codexHome,
      unipileHttpGetImpl: (url, headers) => {
        const parsed = new URL(url);
        seenRequests.push({
          pathname: parsed.pathname,
          search: parsed.search,
          apiKey: headers["X-API-KEY"] ?? null
        });
        if (parsed.pathname === "/api/v1/users/invite/sent") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "InvitationList",
              items: []
            })
          };
        }
        return {
          status: 404,
          bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
        };
      },
      unipileHttpPostImpl: () => {
        throw new Error("direct Unipile HTTP POST should not run for sent invitations");
      }
    });

    assert.equal(result.transport.kind, "direct_runtime");
    assert.equal(result.transport.connector, "unipile");
    assert.ok(result.payload);
    assert.equal(result.capture.sections.find((section) => section.surfaceKey === "linkedin-sent-invitations")?.status, "success");
    assert.deepEqual(seenRequests, [
      {
        pathname: "/api/v1/users/invite/sent",
        search: "?account_id=unipile-linkedin-1&limit=100",
        apiKey: "test-key"
      }
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

for (const scenario of [
  {
    name: "missing API key",
    configEnv: ['UNIPILE_DSN = "https://api14.unipile.com:14465"'],
    account: {},
    expectedError: /requires UNIPILE_API_KEY/i,
    expectedBackoffReason: "missing_unipile_api_key",
  },
  {
    name: "missing explicit base URL",
    configEnv: ['UNIPILE_API_KEY = "test-key"'],
    account: {},
    expectedError: /requires a configured Unipile base URL/i,
    expectedBackoffReason: "missing_unipile_base_url",
  },
  {
    name: "missing provider account id",
    configEnv: [
      'UNIPILE_API_KEY = "test-key"',
      'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ],
    account: { providerAccountId: null },
    expectedError: /requires providerAccountId/i,
    expectedBackoffReason: "missing_provider_account_id",
  },
]) {
  test(`inbound sync linkedin-live returns a failed untrusted payload for ${scenario.name}`, async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `exo-inbound-sync-linkedin-live-${scenario.name.replaceAll(" ", "-")}-`));
    const codexHome = path.join(tempDir, ".codex");
    let httpCalled = false;

    writeUnipileCodexConfig(codexHome, scenario.configEnv);

    try {
      const result = await buildLiveLinkedinInboundSyncPayload(
        buildManagedLinkedinUser({ account: scenario.account }),
        [],
        {
          accountId: "linkedin-account-1",
          runtime: "codex",
          connector: "unipile",
          mode: "quick",
          surfaceKeys: ["linkedin-sent-invitations"],
          codexHome,
          allowDirectUnipileHttp: true,
          unipileHttpGetImpl: () => {
            httpCalled = true;
            return {
              status: 200,
              bodyText: "{}",
            };
          },
        },
      );

      const sentInvitations = result.payload?.accounts?.[0]?.surfaces?.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
      assert.equal(result.transport.kind, "direct_runtime");
      assert.ok(sentInvitations);
      assert.equal(sentInvitations.status, "failed");
      assert.equal(sentInvitations.exhaustionStatus, "blocked");
      assert.equal(sentInvitations.captureCompleteness, "failed");
      assert.equal(sentInvitations.syncTrustStatus, "untrusted");
      assert.equal(sentInvitations.backoffReason, scenario.expectedBackoffReason);
      assert.match(sentInvitations.error, scenario.expectedError);
      assert.equal(sentInvitations.itemCount, 0);
      assert.equal(httpCalled, false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
}

test("inbound sync linkedin-live treats provider account identity failures as untrusted failed surfaces", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-identity-mismatch-"));
  const codexHome = path.join(tempDir, ".codex");

  writeUnipileCodexConfig(codexHome, [
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
  ]);

  try {
    const result = await buildLiveLinkedinInboundSyncPayload(
      buildManagedLinkedinUser(),
      [],
      {
        accountId: "linkedin-account-1",
        runtime: "codex",
        connector: "unipile",
        mode: "quick",
        surfaceKeys: ["linkedin-sent-invitations"],
        codexHome,
        allowDirectUnipileHttp: true,
        unipileHttpGetImpl: () => ({
          status: 503,
          bodyText: JSON.stringify({
            status: 503,
            type: "errors/no_client_session",
            title: "No client session for account_id unipile-linkedin-1",
          }),
        }),
      },
    );

    const sentInvitations = result.payload?.accounts?.[0]?.surfaces?.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
    assert.equal(result.transport.kind, "direct_runtime");
    assert.ok(sentInvitations);
    assert.equal(sentInvitations.status, "failed");
    assert.equal(sentInvitations.syncTrustStatus, "untrusted");
    assert.equal(sentInvitations.backoffReason, "transport_or_surface_failure");
    assert.match(sentInvitations.error, /errors\/no_client_session/i);
    assert.match(sentInvitations.error, /unipile-linkedin-1/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live captures LinkedIn truth directly through a mapped Unipile account", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-direct-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenRequests = [];
  const seenPosts = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const result = await buildLiveLinkedinInboundSyncPayload({
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    }, [], {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url, headers) => {
        const parsed = new URL(url);
        seenRequests.push({
          pathname: parsed.pathname,
          search: parsed.search,
          apiKey: headers["X-API-KEY"] ?? null
        });

        if (parsed.pathname === "/api/v1/users/invite/sent") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "InvitationList",
              items: [
                {
                  object: "InvitationSent",
                  id: "invite-sent-1",
                  invited_user: "Jordan Cipolla",
                  invited_user_id: "member-1",
                  invited_user_public_id: "jordan-cipolla",
                  invited_user_description: "VP Revenue Operations",
                  date: "2026-05-30T18:10:00.000Z",
                  parsed_datetime: "2026-05-30T18:10:00.000Z",
                  invitation_text: "Wanted to connect after reading the motion brief.",
                  inviter: {
                    inviter_name: "William",
                    inviter_id: "self",
                    inviter_public_identifier: "william-main",
                    inviter_description: null
                  },
                  specifics: {
                    provider: "LINKEDIN",
                    shared_secret: "secret"
                  }
                }
              ],
              cursor: null
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/member-1") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserProfile",
              provider: "LINKEDIN",
              provider_id: "member-1",
              public_identifier: "jordan-cipolla",
              headline: "VP Revenue Operations",
              current_company_name: "BuyerCo",
              profile_picture_url: "https://cdn.example.test/jordan.png",
              work_experience: [
                {
                  id: "experience-1",
                  position: "VP Revenue Operations",
                  company_id: "buyerco",
                  company_url: "https://www.linkedin.com/company/buyerco/",
                  company_picture_url: "https://cdn.example.test/buyerco-logo.png",
                  company: "BuyerCo",
                  current: true,
                }
              ],
            })
          };
        }

        if (parsed.pathname === "/api/v1/linkedin/company/buyerco") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "CompanyProfile",
              id: "buyerco",
              name: "BuyerCo",
              public_identifier: "buyerco",
              profile_url: "https://www.linkedin.com/company/buyerco/",
              website: "https://buyerco.example",
              logo: "https://cdn.example.test/buyerco-logo.png",
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/invite/received") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "InvitationList",
              items: [
                {
                  object: "InvitationReceived",
                  id: "invite-received-1",
                  invited_user: "William",
                  invited_user_id: "self",
                  invited_user_public_id: "william-main",
                  invited_user_description: null,
                  date: "2026-05-30T18:12:00.000Z",
                  parsed_datetime: "2026-05-30T18:12:00.000Z",
                  invitation_text: "Would love to connect about governed inbound triage.",
                  inviter: {
                    inviter_name: "Alicia Buyer",
                    inviter_id: "member-2",
                    inviter_public_identifier: "alicia-buyer",
                    inviter_description: "VP Revenue Operations"
                  },
                  specifics: {
                    provider: "LINKEDIN",
                    shared_secret: "secret"
                  }
                }
              ],
              cursor: null
            })
          };
        }

        if (parsed.pathname === "/api/v1/chats") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "ChatList",
              items: [
                {
                  object: "Chat",
                  id: "thread-1",
                  account_id: "unipile-linkedin-1",
                  account_type: "LINKEDIN",
                  provider_id: "12345",
                  attendee_provider_id: "member-2",
                  name: "Get the clarity you've been looking for",
                  subject: "Get the clarity you've been looking for",
                  timestamp: "2026-05-30T18:14:00.000Z",
                  unread_count: 2
                }
              ],
              cursor: null
            })
          };
        }

        if (parsed.pathname === "/api/v1/chat_attendees/member-2") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "ChatAttendee",
              id: "attendee-1",
              account_id: "unipile-linkedin-1",
              provider_id: "member-2",
              is_self: false,
              hidden: false,
              name: "Alicia Buyer",
              picture_url: "https://cdn.example.test/alicia.png",
              specifics: {
                provider: "LINKEDIN",
                occupation: "VP Revenue Operations @ BuyerCo",
                public_identifier: "alicia-buyer",
                profile_url: "https://www.linkedin.com/in/alicia-buyer/"
              }
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/member-2") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserProfile",
              provider: "LINKEDIN",
              provider_id: "member-2",
              public_identifier: "alicia-buyer",
              headline: "VP Revenue Operations @ BuyerCo",
              profile_picture_url: "https://cdn.example.test/alicia.png",
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/member-3") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserProfile",
              provider: "LINKEDIN",
              provider_id: "member-3",
              public_identifier: "nina-prospect",
              headline: "Director of Demand Generation",
              current_company_name: "Signal Foundry",
              profile_picture_url: "https://cdn.example.test/nina.png",
            })
          };
        }

        if (parsed.pathname === "/api/v1/chats/thread-1/messages") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "MessageList",
              items: [
                {
                  object: "Message",
                  id: "message-1",
                  text: "Following up on the governed inbound triage thread.",
                  timestamp: "2026-05-30T18:14:00.000Z",
                  is_sender: 0,
                }
              ],
              cursor: null
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/followers") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserFollowerList",
              items: [
                {
                  object: "UserFollower",
                  id: "member-3",
                  urn: "urn:li:member:member-3",
                  name: "Nina Prospect",
                  headline: "Director of Demand Generation",
                  profile_url: "https://www.linkedin.com/in/nina-prospect/",
                  profile_picture_url: null,
                  profile_picture_url_large: null
                }
              ],
              cursor: null
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/following") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserRelationsList",
              items: [
                {
                  object: "UserRelation",
                  first_name: "Paul",
                  last_name: "Operator",
                  headline: "Head of RevOps",
                  public_identifier: "paul-operator",
                  public_profile_url: "https://www.linkedin.com/in/paul-operator/",
                  created_at: 1748628960,
                  member_id: "member-4",
                  member_urn: "urn:li:member:member-4",
                  connection_urn: "urn:li:fsd_profile:member-4",
                  profile_picture_url: "https://cdn.example.test/paul.png"
                }
              ],
              cursor: null
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/member-4") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserProfile",
              provider: "LINKEDIN",
              provider_id: "member-4",
              public_identifier: "paul-operator",
              headline: "Head of RevOps",
              current_company_name: "OperatorCo",
              profile_picture_url: "https://cdn.example.test/paul.png",
            })
          };
        }

        return {
          status: 404,
          bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
        };
      },
      unipileHttpPostImpl: (url, headers, bodyText) => {
        const parsed = new URL(url);
        const body = JSON.parse(bodyText);
        seenPosts.push({
          pathname: parsed.pathname,
          apiKey: headers["X-API-KEY"] ?? null,
          requestUrl: body.request_url ?? null
        });

        if (parsed.pathname !== "/api/v1/linkedin") {
          return {
            status: 404,
            bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
          };
        }

        if (String(body.request_url ?? "").includes("voyagerPremiumDashAnalyticsObject")) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "LinkedinRawData",
              data: {
                data: {
                  premiumDashAnalyticsObjectByAnalyticsEntity: {
                    paging: {
                      count: 1,
                      start: 0,
                      total: 0
                    },
                    elements: [
                      {
                        content: {
                          analyticsEntityLockup: {
                            entityLockup: {
                              title: { text: "Nina Prospect" },
                              subtitle: { text: "Director of Demand Generation" },
                              caption: { text: "Viewed 1d ago" },
                              label: { text: "1st" },
                              navigationUrl: "https://www.linkedin.com/in/nina-prospect?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3Anina-prospect",
                              image: {
                                attributes: [
                                  {
                                    detailData: {
                                      profilePicture: {
                                        entityUrn: "urn:li:member:member-3"
                                      }
                                    }
                                  }
                                ]
                              }
                            }
                          },
                          ctaItem: {
                            actionData: {
                              entityProfile: {
                                publicIdentifier: "nina-prospect",
                                entityUrn: "urn:li:member:member-3",
                                headline: "Director of Demand Generation"
                              }
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              }
            })
          };
        }

        if (String(body.request_url ?? "").includes("voyagerSearchDashClusters")) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "LinkedinRawData",
              data: {
                data: {
                  searchDashClustersByAll: {
                    paging: {
                      count: 1,
                      start: 0,
                      total: 1
                    },
                    metadata: {
                      totalResultCount: 1
                    },
                    elements: [
                      {
                        items: [
                          {
                            item: {
                              entityResult: {
                                title: { text: "Paul Operator" },
                                primarySubtitle: { text: "Head of RevOps" },
                                navigationUrl: "https://www.linkedin.com/in/paul-operator?miniProfileUrn=urn%3Ali%3Afs_miniProfile%3Apaul-operator",
                                trackingUrn: "urn:li:member:member-4",
                                primaryActions: [
                                  {
                                    actionDetails: {
                                      followAction: {
                                        entityUrn: "urn:li:fsd_followingState:urn:li:fsd_profile:member-4",
                                        followerCount: 711
                                      }
                                    }
                                  }
                                ]
                              }
                            }
                          }
                        ]
                      }
                    ]
                  }
                }
              }
            })
          };
        }

        return {
          status: 404,
          bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
        };
      }
    });

    assert.equal(result.transport.kind, "direct_runtime");
    assert.equal(result.transport.connector, "unipile");
    assert.equal(result.capture.mode, "quick");
    assert.ok(result.payload);
    assert.equal(result.capture.sections.find((section) => section.surfaceKey === "linkedin-sent-invitations")?.status, "success");
    assert.equal(result.capture.sections.find((section) => section.surfaceKey === "linkedin-received-invitations")?.observationCount, 1);
    assert.equal(result.capture.sections.find((section) => section.surfaceKey === "linkedin-profile-views")?.status, "success");
    assert.equal(result.capture.sections.find((section) => section.surfaceKey === "linkedin-following-list")?.status, "success");
    assert.match(result.probe.reason, /unipile/i);

    const receivedInvites = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-received-invitations");
    assert.ok(receivedInvites);
    assert.equal(receivedInvites.observations[0].actorProfileUrl, "https://www.linkedin.com/in/alicia-buyer/");
    assert.equal(receivedInvites.observations[0].providerSharedSecret, "secret");
    assert.equal(receivedInvites.observations[0].notes, "Would love to connect about governed inbound triage.");

    const sentInvites = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
    assert.ok(sentInvites);
    assert.equal(sentInvites.observations[0].providerSharedSecret, "secret");
    assert.equal(sentInvites.observations[0].notes, "Wanted to connect after reading the motion brief.");
    assert.equal(sentInvites.observations[0].actorCompanyName, "BuyerCo");
    assert.equal(sentInvites.observations[0].actorAvatarSourceUrl, "https://cdn.example.test/jordan.png");
    assert.deepEqual(sentInvites.observations[0].actorCompanyProfile, {
      name: "BuyerCo",
      domain: "buyerco.example",
      websiteUrl: "https://buyerco.example",
      linkedinCompanyUrl: "https://www.linkedin.com/company/buyerco/",
      logoSourceUrl: "https://cdn.example.test/buyerco-logo.png",
    });

    const messagingInbox = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-messaging-inbox");
    assert.ok(messagingInbox);
    assert.equal(messagingInbox.observations[0].kind, "inbound_reply_received");
    assert.equal(messagingInbox.observations[0].actorName, "Alicia Buyer");
    assert.equal(messagingInbox.observations[0].actorTitle, "VP Revenue Operations @ BuyerCo");
    assert.equal(messagingInbox.observations[0].actorCompanyName, "BuyerCo");
    assert.equal(messagingInbox.observations[0].actorProfileUrl, "https://www.linkedin.com/in/alicia-buyer/");
    assert.equal(messagingInbox.observations[0].subject, "Get the clarity you've been looking for");
    assert.match(messagingInbox.observations[0].notes ?? "", /thread subject/i);
    assert.equal(messagingInbox.observations[0].messages.length, 1);
    assert.equal(messagingInbox.observations[0].messages[0].direction, "inbound");
    assert.match(messagingInbox.observations[0].messages[0].body, /governed inbound triage thread/i);

    const profileViews = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-profile-views");
    assert.ok(profileViews);
    assert.equal(profileViews.observations[0].actorProfileUrl, "https://www.linkedin.com/in/nina-prospect");
    assert.equal(profileViews.observations[0].kind, "profile_view_received");
    assert.equal(
      profileViews.observations[0].eventAt,
      new Date(Date.parse(profileViews.observations[0].observedAt) - (24 * 60 * 60 * 1000)).toISOString(),
    );
    assert.equal(profileViews.observations[0].actorCompanyName, "Signal Foundry");
    assert.match(profileViews.observations[0].notes ?? "", /viewer label/i);

    const following = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-following-list");
    assert.ok(following);
    assert.equal(following.observations[0].actorName, "Paul Operator");
    assert.equal(following.observations[0].actorProfileUrl, "https://www.linkedin.com/in/paul-operator");
    assert.equal(following.observations[0].actorCompanyName, "OperatorCo");

    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/users/invite/sent" && request.apiKey === "test-key"));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/users/member-1" && /account_id=unipile-linkedin-1/.test(request.search)));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/linkedin/company/buyerco" && /account_id=unipile-linkedin-1/.test(request.search)));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/chats" && /unread=true/.test(request.search)));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/chat_attendees/member-2"));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/users/member-2" && /account_id=unipile-linkedin-1/.test(request.search)));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/users/member-3" && /account_id=unipile-linkedin-1/.test(request.search)));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/users/member-4" && /account_id=unipile-linkedin-1/.test(request.search)));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/chats/thread-1/messages"));
    assert.equal(seenRequests.some((request) => request.pathname === "/api/v1/users/following"), false);
    assert.ok(seenPosts.some((request) => request.pathname === "/api/v1/linkedin" && /voyagerPremiumDashAnalyticsObject/.test(request.requestUrl ?? "")));
    assert.ok(seenPosts.some((request) => request.pathname === "/api/v1/linkedin" && /voyagerSearchDashClusters/.test(request.requestUrl ?? "")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live tolerates malformed Unipile company website URLs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-bad-company-url-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenRequests = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const result = await buildLiveLinkedinInboundSyncPayload({
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    }, [], {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      surfaceKeys: ["linkedin-messaging-inbox", "linkedin-followers-list"],
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url) => {
        const parsed = new URL(url);
        seenRequests.push(parsed.pathname);

        if (parsed.pathname === "/api/v1/chats") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "ChatList",
              items: [
                {
                  object: "Chat",
                  id: "thread-1",
                  account_id: "unipile-linkedin-1",
                  account_type: "LINKEDIN",
                  provider_id: "12345",
                  attendee_provider_id: "member-2",
                  name: "Get the clarity you've been looking for",
                  subject: "Get the clarity you've been looking for",
                  timestamp: "2026-05-30T18:14:00.000Z",
                  unread_count: 1
                }
              ],
              cursor: null
            })
          };
        }

        if (parsed.pathname === "/api/v1/chat_attendees/member-2") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "ChatAttendee",
              id: "attendee-1",
              account_id: "unipile-linkedin-1",
              provider_id: "member-2",
              is_self: false,
              hidden: false,
              name: "Alicia Buyer",
              picture_url: "https://cdn.example.test/alicia.png",
              specifics: {
                provider: "LINKEDIN",
                occupation: "VP Revenue Operations @ BuyerCo",
                public_identifier: "alicia-buyer",
                profile_url: "https://www.linkedin.com/in/alicia-buyer/"
              }
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/member-2") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserProfile",
              provider: "LINKEDIN",
              provider_id: "member-2",
              public_identifier: "alicia-buyer",
              headline: "VP Revenue Operations @ BuyerCo",
              current_company_name: "BuyerCo",
              work_experience: [
                {
                  id: "experience-2",
                  position: "VP Revenue Operations",
                  company_id: "buyerco",
                  company_url: "https://www.linkedin.com/company/buyerco/",
                  company_picture_url: "https://cdn.example.test/buyerco-logo.png",
                  company: "BuyerCo",
                  current: true,
                }
              ],
              profile_picture_url: "https://cdn.example.test/alicia.png",
            })
          };
        }

        if (parsed.pathname === "/api/v1/linkedin/company/buyerco") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "CompanyProfile",
              id: "buyerco",
              name: "BuyerCo",
              public_identifier: "buyerco",
              profile_url: "https://www.linkedin.com/company/buyerco/",
              website: "buyerco.example",
              logo: "https://cdn.example.test/buyerco-logo.png",
            })
          };
        }

        if (parsed.pathname === "/api/v1/chats/thread-1/messages") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "MessageList",
              items: [
                {
                  object: "Message",
                  id: "message-1",
                  text: "Following up on the governed inbound triage thread.",
                  timestamp: "2026-05-30T18:14:00.000Z",
                  is_sender: 0,
                }
              ],
              cursor: null
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/followers") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserFollowerList",
              items: [
                {
                  object: "UserFollower",
                  id: "follower-1",
                  urn: "urn:li:member:member-3",
                  name: "Nina Prospect",
                  headline: "Director of Demand Generation",
                  profile_url: "https://www.linkedin.com/in/nina-prospect/",
                  profile_picture_url: null,
                  profile_picture_url_large: null
                }
              ],
              cursor: null
            })
          };
        }

        if (parsed.pathname === "/api/v1/users/member-3") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserProfile",
              provider: "LINKEDIN",
              provider_id: "member-3",
              public_identifier: "nina-prospect",
              headline: "Director of Demand Generation",
              current_company_name: "Signal Foundry",
              work_experience: [
                {
                  id: "experience-3",
                  position: "Director of Demand Generation",
                  company_id: "signal-foundry",
                  company_url: "https://www.linkedin.com/company/signal-foundry/",
                  company_picture_url: "https://cdn.example.test/signal-foundry-logo.png",
                  company: "Signal Foundry",
                  current: true,
                }
              ],
              profile_picture_url: "https://cdn.example.test/nina.png",
            })
          };
        }

        if (parsed.pathname === "/api/v1/linkedin/company/signal-foundry") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "CompanyProfile",
              id: "signal-foundry",
              name: "Signal Foundry",
              public_identifier: "signal-foundry",
              profile_url: "https://www.linkedin.com/company/signal-foundry/",
              website: "signal-foundry.example",
              logo: "https://cdn.example.test/signal-foundry-logo.png",
            })
          };
        }

        return {
          status: 404,
          bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
        };
      }
    });

    const messagingInbox = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-messaging-inbox");
    assert.ok(messagingInbox);
    assert.equal(result.capture.sections.find((section) => section.surfaceKey === "linkedin-messaging-inbox")?.status, "success");
    assert.deepEqual(messagingInbox.observations[0].actorCompanyProfile, {
      name: "BuyerCo",
      domain: null,
      websiteUrl: null,
      linkedinCompanyUrl: "https://www.linkedin.com/company/buyerco/",
      logoSourceUrl: "https://cdn.example.test/buyerco-logo.png",
    });

    const followers = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-followers-list");
    assert.ok(followers);
    assert.equal(result.capture.sections.find((section) => section.surfaceKey === "linkedin-followers-list")?.status, "success");
    assert.ok(seenRequests.includes("/api/v1/linkedin/company/buyerco"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live caps full followers sync to Unipile's LinkedIn page limit and tolerates an empty cursor tail", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-followers-full-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenFollowerRequests = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const result = await buildLiveLinkedinInboundSyncPayload({
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    }, [], {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-followers-list"],
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url) => {
        const parsed = new URL(url);
        if (parsed.pathname !== "/api/v1/users/followers") {
          return {
            status: 404,
            bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
          };
        }

        seenFollowerRequests.push({
          limit: parsed.searchParams.get("limit"),
          cursor: parsed.searchParams.get("cursor")
        });

        if (parsed.searchParams.get("cursor") === "page-3") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserFollowerList",
              items: [],
              cursor: "page-4"
            })
          };
        }

        if (parsed.searchParams.get("cursor") === "page-2") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserFollowerList",
              items: [
                {
                  object: "UserFollower",
                  id: "follower-2",
                  urn: "urn:li:member:member-4",
                  name: "Page Two Prospect",
                  headline: "Director of Procurement",
                  profile_url: "https://www.linkedin.com/in/page-two-prospect/",
                  profile_picture_url: null,
                  profile_picture_url_large: null
                }
              ],
              cursor: "page-3"
            })
          };
        }

        return {
          status: 200,
          bodyText: JSON.stringify({
            object: "UserFollowerList",
            items: [
              {
                object: "UserFollower",
                id: "follower-1",
                urn: "urn:li:member:member-3",
                name: "Page One Prospect",
                headline: "Director of Demand Generation",
                profile_url: "https://www.linkedin.com/in/page-one-prospect/",
                profile_picture_url: null,
                profile_picture_url_large: null
              }
            ],
            cursor: "page-2"
          })
        };
      }
    });

    assert.equal(result.transport.kind, "direct_runtime");
    assert.equal(result.capture.mode, "full");
    assert.equal(result.capture.sections.length, 1);
    assert.equal(result.capture.sections[0]?.surfaceKey, "linkedin-followers-list");
    assert.equal(result.capture.sections[0]?.status, "success");
    assert.equal(result.capture.sections[0]?.itemCount, 2);
    assert.equal(result.capture.sections[0]?.visibleTotalCount, 2);
    assert.equal(seenFollowerRequests.length, 3);
    assert.deepEqual(seenFollowerRequests, [
      { limit: "100", cursor: null },
      { limit: "100", cursor: "page-2" },
      { limit: "100", cursor: "page-3" }
    ]);

    const followers = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-followers-list");
    assert.ok(followers);
    assert.equal(followers.observations.length, 2);
    assert.equal(followers.observations[1].actorName, "Page Two Prospect");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live overlaps follower enrichment lookups with bounded concurrency", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-followers-concurrency-"));
  const codexHome = path.join(tempDir, ".codex");
  let activeUserLookups = 0;
  let maxUserLookups = 0;
  let activeCompanyLookups = 0;
  let maxCompanyLookups = 0;

  writeUnipileCodexConfig(codexHome, [
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
  ]);

  const followerItems = Array.from({ length: 4 }, (_value, index) => ({
    object: "UserFollower",
    id: `follower-${index + 1}`,
    urn: `urn:li:member:follower-${index + 1}`,
    name: `Follower ${index + 1}`,
    headline: "Director of Revenue Operations",
    profile_url: `https://www.linkedin.com/in/follower-${index + 1}/`,
    profile_picture_url: null,
    profile_picture_url_large: null,
  }));

  try {
    const result = await buildLiveLinkedinInboundSyncPayload(buildManagedLinkedinUser(), [], {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 10,
      maxPages: 1,
      pageSize: 10,
      surfaceKeys: ["linkedin-followers-list"],
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === "/api/v1/users/followers") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserFollowerList",
              items: followerItems,
            }),
          };
        }

        if (parsed.pathname.startsWith("/api/v1/users/")) {
          activeUserLookups += 1;
          maxUserLookups = Math.max(maxUserLookups, activeUserLookups);
          const providerId = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
          await delay(20);
          activeUserLookups -= 1;
          return {
            status: 200,
            bodyText: JSON.stringify({
              provider_id: providerId,
              public_identifier: providerId,
              public_profile_url: `https://www.linkedin.com/in/${providerId}/`,
              headline: `Title for ${providerId}`,
              current_company_name: `Company ${providerId}`,
              company: {
                public_identifier: `company-${providerId}`,
              },
            }),
          };
        }

        if (parsed.pathname.startsWith("/api/v1/linkedin/company/")) {
          activeCompanyLookups += 1;
          maxCompanyLookups = Math.max(maxCompanyLookups, activeCompanyLookups);
          const companyId = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
          await delay(20);
          activeCompanyLookups -= 1;
          return {
            status: 200,
            bodyText: JSON.stringify({
              name: `Company ${companyId}`,
              public_identifier: companyId,
              profile_url: `https://www.linkedin.com/company/${companyId}/`,
              website: `https://${companyId}.example.com/`,
            }),
          };
        }

        return {
          status: 404,
          bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" }),
        };
      },
    });

    assert.equal(result.capture.sections[0]?.surfaceKey, "linkedin-followers-list");
    assert.equal(result.capture.sections[0]?.status, "success");
    assert.equal(result.capture.sections[0]?.itemCount, 4);
    assert.ok(maxUserLookups > 1, `expected overlapping user lookups, saw max ${maxUserLookups}`);
    assert.ok(maxUserLookups <= 4, `expected bounded user lookups, saw max ${maxUserLookups}`);
    assert.ok(maxCompanyLookups > 1, `expected overlapping company lookups, saw max ${maxCompanyLookups}`);
    assert.ok(maxCompanyLookups <= 4, `expected bounded company lookups, saw max ${maxCompanyLookups}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live rewrites a structured followers resume cursor to the requested page size", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-followers-resume-limit-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenFollowerRequests = [];
  const originalResumeCursor = Buffer.from(JSON.stringify({ startIndex: "932", limit: 5 }), "utf8").toString("base64");
  const widenedResumeCursor = Buffer.from(JSON.stringify({ startIndex: "932", limit: 100 }), "utf8").toString("base64");
  const widenedTailCursor = Buffer.from(JSON.stringify({ startIndex: "992", limit: 100 }), "utf8").toString("base64");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  const buildFollowerItems = (startIndex, count) => Array.from({ length: count }, (_value, offset) => {
    const numericId = startIndex + offset;
    return {
      object: "UserFollower",
      id: `follower-${numericId}`,
      urn: `urn:li:member:member-${numericId}`,
      name: `Follower ${numericId}`,
      headline: "Director of Revenue Operations",
      profile_url: `https://www.linkedin.com/in/follower-${numericId}/`,
      profile_picture_url: null,
      profile_picture_url_large: null
    };
  });

  try {
    const rawUser = {
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    };

    const sharedOptions = {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-followers-list"],
      maxPages: 1,
      pageSize: 100,
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url) => {
        const parsed = new URL(url);
        if (parsed.pathname !== "/api/v1/users/followers") {
          return {
            status: 404,
            bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
          };
        }

        const requestCursor = parsed.searchParams.get("cursor");
        const decodedCursor = requestCursor ? JSON.parse(Buffer.from(requestCursor, "base64").toString("utf8")) : null;
        seenFollowerRequests.push({
          limit: parsed.searchParams.get("limit"),
          cursor: decodedCursor
        });

        if (requestCursor === widenedResumeCursor) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserFollowerList",
              items: buildFollowerItems(932, 60),
              cursor: widenedTailCursor
            })
          };
        }

        if (requestCursor === widenedTailCursor) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "UserFollowerList",
              items: buildFollowerItems(992, 8),
              cursor: null
            })
          };
        }

        return {
          status: 400,
          bodyText: JSON.stringify({
            title: "Unexpected cursor",
            status: 400,
            detail: requestCursor
          })
        };
      }
    };

    const first = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      resumeCursor: originalResumeCursor,
    });

    const firstFollowers = first.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-followers-list");
    assert.ok(firstFollowers);
    assert.equal(firstFollowers.status, "warning");
    assert.equal(firstFollowers.reconcileReason, "page_budget_stopped_early");
    assert.equal(firstFollowers.nextCursor, widenedTailCursor);
    assert.equal(firstFollowers.observations.length, 60);

    const resumed = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      resumeCursor: widenedTailCursor,
    });

    const resumedFollowers = resumed.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-followers-list");
    assert.ok(resumedFollowers);
    assert.equal(resumedFollowers.status, "success");
    assert.equal(resumedFollowers.captureCompleteness, "complete");
    assert.equal(resumedFollowers.nextCursor, null);
    assert.equal(resumedFollowers.observations.length, 8);
    assert.deepEqual(seenFollowerRequests, [
      { limit: "100", cursor: { startIndex: "932", limit: 100 } },
      { limit: "100", cursor: { startIndex: "992", limit: 100 } },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live can stop a full following reconciliation at a page budget and resume from the next offset", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-following-page-budget-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenFollowingRequests = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const rawUser = {
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    };

    const sharedOptions = {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-following-list"],
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: () => ({
        status: 404,
        bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
      }),
      unipileHttpPostImpl: (_url, _headers, bodyText) => {
        const payload = JSON.parse(bodyText);
        const requestUrl = new URL(payload.request_url);
        const variables = requestUrl.searchParams.get("variables") ?? "";
        const start = Number((variables.match(/start:(\d+)/)?.[1] ?? "-1"));
        const count = Number((variables.match(/count:(\d+)/)?.[1] ?? "-1"));
        seenFollowingRequests.push({ start, count });

        const item = (id, name, profileUrl) => ({
          item: {
            entityResult: {
              navigationUrl: profileUrl,
              title: { text: name },
              primarySubtitle: { text: "Director of Revenue Operations" },
              trackingUrn: `urn:li:member:${id}`,
              primaryActions: [
                {
                  actionDetails: {
                    followAction: {
                      entityUrn: `follow:${id}`
                    }
                  }
                }
              ]
            }
          }
        });

        if (start === 1) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              data: {
                data: {
                  searchDashClustersByAll: {
                    paging: { total: 2 },
                    elements: [
                      {
                        items: [
                          item("following-2", "Page Two Followed", "https://www.linkedin.com/in/page-two-followed/")
                        ]
                      }
                    ]
                  }
                }
              }
            })
          };
        }

        return {
          status: 200,
          bodyText: JSON.stringify({
            data: {
              data: {
                searchDashClustersByAll: {
                  paging: { total: 2 },
                  elements: [
                    {
                      items: [
                        item("following-1", "Page One Followed", "https://www.linkedin.com/in/page-one-followed/")
                      ]
                    }
                  ]
                }
              }
            }
          })
        };
      }
    };

    const first = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      maxPages: 1,
      pageSize: 1,
    });

    const firstFollowing = first.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-following-list");
    assert.ok(firstFollowing);
    assert.equal(firstFollowing.status, "warning");
    assert.equal(firstFollowing.reconcileReason, "page_budget_stopped_early");
    assert.equal(firstFollowing.nextStartOffset, 1);
    assert.equal(firstFollowing.observations.length, 1);

    const resumed = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      resumeStartOffset: 1,
      maxPages: 1,
      pageSize: 1,
    });

    const resumedFollowing = resumed.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-following-list");
    assert.ok(resumedFollowing);
    assert.equal(resumedFollowing.status, "success");
    assert.equal(resumedFollowing.nextStartOffset, null);
    assert.equal(resumedFollowing.observations.length, 1);
    assert.deepEqual(seenFollowingRequests, [
      { start: 0, count: 1 },
      { start: 1, count: 1 },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live overlaps following enrichment lookups with bounded concurrency", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-following-concurrency-"));
  const codexHome = path.join(tempDir, ".codex");
  let activeUserLookups = 0;
  let maxUserLookups = 0;

  writeUnipileCodexConfig(codexHome, [
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
  ]);

  const followingItems = Array.from({ length: 4 }, (_value, index) => ({
    item: {
      entityResult: {
        navigationUrl: `https://www.linkedin.com/in/following-${index + 1}/`,
        title: { text: `Following ${index + 1}` },
        primarySubtitle: { text: "Director of Revenue Operations" },
        trackingUrn: `following-${index + 1}`,
        primaryActions: [
          {
            actionDetails: {
              followAction: {
                entityUrn: `follow:${index + 1}`,
              },
            },
          },
        ],
      },
    },
  }));

  try {
    const result = await buildLiveLinkedinInboundSyncPayload(buildManagedLinkedinUser(), [], {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 10,
      maxPages: 1,
      pageSize: 10,
      surfaceKeys: ["linkedin-following-list"],
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.startsWith("/api/v1/users/")) {
          activeUserLookups += 1;
          maxUserLookups = Math.max(maxUserLookups, activeUserLookups);
          const providerId = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
          await delay(20);
          activeUserLookups -= 1;
          return {
            status: 200,
            bodyText: JSON.stringify({
              provider_id: providerId,
              public_identifier: providerId,
              public_profile_url: `https://www.linkedin.com/in/${providerId}/`,
              headline: `Title for ${providerId}`,
              current_company_name: `Company ${providerId}`,
            }),
          };
        }

        if (parsed.pathname.startsWith("/api/v1/linkedin/company/")) {
          const companyId = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
          await delay(20);
          return {
            status: 200,
            bodyText: JSON.stringify({
              name: `Company ${companyId}`,
              public_identifier: companyId,
              profile_url: `https://www.linkedin.com/company/${companyId}/`,
            }),
          };
        }

        return {
          status: 404,
          bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" }),
        };
      },
      unipileHttpPostImpl: async (_url, _headers, bodyText) => {
        const payload = JSON.parse(bodyText);
        const requestUrl = new URL(payload.request_url);
        assert.match(requestUrl.searchParams.get("variables") ?? "", /resultType,value:List\(PEOPLE_FOLLOW\)/);
        await delay(20);
        return {
          status: 200,
          bodyText: JSON.stringify({
            data: {
              data: {
                searchDashClustersByAll: {
                  paging: { total: followingItems.length },
                  elements: [
                    {
                      items: followingItems,
                    },
                  ],
                },
              },
            },
          }),
        };
      },
    });

    assert.equal(result.capture.sections[0]?.surfaceKey, "linkedin-following-list");
    assert.equal(result.capture.sections[0]?.status, "success");
    assert.equal(result.capture.sections[0]?.itemCount, 4);
    assert.ok(maxUserLookups > 1, `expected overlapping following lookups, saw max ${maxUserLookups}`);
    assert.ok(maxUserLookups <= 4, `expected bounded following lookups, saw max ${maxUserLookups}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live can stop a full profile-views reconciliation at a page budget and resume from the next offset", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-profile-views-page-budget-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenProfileViewRequests = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const rawUser = {
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    };

    const viewer = (name, profileUrl) => ({
      content: {
        analyticsEntityLockup: {
          entityLockup: {
            title: { text: name },
            subtitle: { text: "Director of Revenue Operations" },
            caption: { text: "Viewed your profile 2 days ago" },
            navigationUrl: profileUrl
          }
        }
      }
    });

    const sharedOptions = {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-profile-views"],
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: () => ({
        status: 404,
        bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
      }),
      unipileHttpPostImpl: (_url, _headers, bodyText) => {
        const payload = JSON.parse(bodyText);
        const requestUrl = new URL(payload.request_url);
        const variables = requestUrl.searchParams.get("variables") ?? "";
        const start = Number((variables.match(/start:(\d+)/)?.[1] ?? "-1"));
        const count = Number((variables.match(/count:(\d+)/)?.[1] ?? "-1"));
        seenProfileViewRequests.push({ start, count });

        return {
          status: 200,
          bodyText: JSON.stringify({
            data: {
              data: {
                premiumDashAnalyticsObjectByAnalyticsEntity: {
                  paging: { total: 2 },
                  elements: [
                    start === 1
                      ? viewer("Page Two Viewer", "https://www.linkedin.com/in/page-two-viewer/")
                      : viewer("Page One Viewer", "https://www.linkedin.com/in/page-one-viewer/")
                  ]
                }
              }
            }
          })
        };
      }
    };

    const first = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      maxPages: 1,
      pageSize: 1,
    });

    const firstProfileViews = first.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-profile-views");
    assert.ok(firstProfileViews);
    assert.equal(firstProfileViews.status, "warning");
    assert.equal(firstProfileViews.reconcileReason, "page_budget_stopped_early");
    assert.equal(firstProfileViews.nextStartOffset, 1);
    assert.equal(firstProfileViews.observations.length, 1);

    const resumed = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      resumeStartOffset: 1,
      maxPages: 1,
      pageSize: 1,
    });

    const resumedProfileViews = resumed.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-profile-views");
    assert.ok(resumedProfileViews);
    assert.equal(resumedProfileViews.status, "success");
    assert.equal(resumedProfileViews.nextStartOffset, null);
    assert.equal(resumedProfileViews.observations.length, 1);
    assert.deepEqual(seenProfileViewRequests, [
      { start: 0, count: 1 },
      { start: 1, count: 1 },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live can stop a full sent-invitations reconciliation at a page budget and resume from the next cursor", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-sent-invitations-page-budget-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenInvitationRequests = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const rawUser = {
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    };

    const sharedOptions = {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-sent-invitations"],
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url) => {
        const requestUrl = new URL(url);
        if (!requestUrl.pathname.endsWith("/api/v1/users/invite/sent")) {
          return {
            status: 404,
            bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
          };
        }

        const cursor = requestUrl.searchParams.get("cursor");
        const limit = Number(requestUrl.searchParams.get("limit") ?? "-1");
        seenInvitationRequests.push({ cursor, limit });

        if (cursor === "cursor-2") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              items: [
                {
                  id: "invitation-2",
                  invited_user: "Page Two Pending",
                  invited_user_public_id: "page-two-pending",
                  date: timestamp
                }
              ],
              cursor: null
            })
          };
        }

        return {
          status: 200,
          bodyText: JSON.stringify({
            items: [
              {
                id: "invitation-1",
                invited_user: "Page One Pending",
                invited_user_public_id: "page-one-pending",
                date: timestamp
              }
            ],
            cursor: "cursor-2"
          })
        };
      },
      unipileHttpPostImpl: () => ({
        status: 404,
        bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
      })
    };

    const first = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      maxPages: 1,
      pageSize: 1,
    });

    const firstInvitations = first.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
    assert.ok(firstInvitations);
    assert.equal(firstInvitations.status, "warning");
    assert.equal(firstInvitations.reconcileReason, "page_budget_stopped_early");
    assert.equal(firstInvitations.nextCursor, "cursor-2");
    assert.equal(firstInvitations.observations.length, 1);

    const resumed = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      resumeCursor: "cursor-2",
      maxPages: 1,
      pageSize: 1,
    });

    const resumedInvitations = resumed.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
    assert.ok(resumedInvitations);
    assert.equal(resumedInvitations.status, "success");
    assert.equal(resumedInvitations.nextCursor, null);
    assert.equal(resumedInvitations.observations.length, 1);
    assert.deepEqual(seenInvitationRequests, [
      { cursor: null, limit: 1 },
      { cursor: "cursor-2", limit: 1 },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live treats a structured sent-invitations cursor on a short page as terminal", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-sent-structured-tail-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenInvitationRequests = [];
  const structuredCursor = Buffer.from(JSON.stringify({ limit: 100, cursor: 2 }), "utf8").toString("base64");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const result = await buildLiveLinkedinInboundSyncPayload({
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    }, [], {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-sent-invitations"],
      maxPages: 1,
      pageSize: 100,
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url) => {
        const requestUrl = new URL(url);
        if (!requestUrl.pathname.endsWith("/api/v1/users/invite/sent")) {
          return {
            status: 404,
            bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
          };
        }

        seenInvitationRequests.push({
          cursor: requestUrl.searchParams.get("cursor"),
          limit: Number(requestUrl.searchParams.get("limit") ?? "-1")
        });

        return {
          status: 200,
          bodyText: JSON.stringify({
            items: [
              {
                id: "invitation-1",
                invited_user: "Page One Pending",
                invited_user_public_id: "page-one-pending",
                date: timestamp
              },
              {
                id: "invitation-2",
                invited_user: "Page Two Pending",
                invited_user_public_id: "page-two-pending",
                date: timestamp
              }
            ],
            cursor: structuredCursor
          })
        };
      },
      unipileHttpPostImpl: () => ({
        status: 404,
        bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
      })
    });

    const sentInvitations = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
    assert.ok(sentInvitations);
    assert.equal(sentInvitations.status, "success");
    assert.equal(sentInvitations.captureCompleteness, "complete");
    assert.equal(sentInvitations.exhaustionStatus, "complete");
    assert.equal(sentInvitations.exhaustionReason, "provider_structured_offset_short_page_terminal");
    assert.equal(sentInvitations.reconcileRequired, false);
    assert.equal(sentInvitations.nextCursor, null);
    assert.equal(sentInvitations.observations.length, 2);
    assert.deepEqual(seenInvitationRequests, [
      { cursor: null, limit: 100 },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live treats Unipile next_cursor as a continuation cursor", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-next-cursor-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const result = await buildLiveLinkedinInboundSyncPayload({
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    }, [], {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-sent-invitations"],
      maxPages: 1,
      pageSize: 1,
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url) => {
        const requestUrl = new URL(url);
        if (!requestUrl.pathname.endsWith("/api/v1/users/invite/sent")) {
          return {
            status: 404,
            bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
          };
        }

        return {
          status: 200,
          bodyText: JSON.stringify({
            items: [
              {
                id: "invitation-1",
                invited_user: "Page One Pending",
                invited_user_public_id: "page-one-pending",
                date: timestamp
              }
            ],
            next_cursor: "cursor-2"
          })
        };
      }
    });

    const sentInvitations = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
    assert.ok(sentInvitations);
    assert.equal(sentInvitations.status, "warning");
    assert.equal(sentInvitations.captureCompleteness, "partial_visible_slice");
    assert.equal(sentInvitations.exhaustionStatus, "incomplete");
    assert.equal(sentInvitations.reconcileRequired, true);
    assert.equal(sentInvitations.reconcileReason, "page_budget_stopped_early");
    assert.equal(sentInvitations.nextCursor, "cursor-2");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resumed sent-invitations reconciliation does not claim an empty terminal suffix as a complete surface", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-sent-empty-resume-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenInvitationRequests = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const result = await buildLiveLinkedinInboundSyncPayload({
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: [
              {
                surfaceKey: "linkedin-sent-invitations",
                enabled: true,
                lastRunStatus: "warning",
                lastItemCount: 10,
                lastVisibleTotalCount: 10,
                lastCaptureCompleteness: "partial_visible_slice",
                lastRequestedMode: "full",
                lastActualMode: "full",
                lastReconcileRequired: true,
                lastReconcileReason: "page_budget_stopped_early",
                lastExhaustionStatus: "incomplete",
                lastExhaustionReason: "page_budget_stopped_early",
                continuationStartedAt: timestamp,
                nextCursor: "cursor-2",
                syncTrustStatus: "degraded",
                lastObservationCount: 10,
                lastItemizationGapCount: 0,
                lastCountDiscrepancyCount: 0
              }
            ]
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    }, [], {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-sent-invitations"],
      resumeCursor: "cursor-2",
      maxPages: 1,
      pageSize: 10,
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url) => {
        const requestUrl = new URL(url);
        if (!requestUrl.pathname.endsWith("/api/v1/users/invite/sent")) {
          return {
            status: 404,
            bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
          };
        }

        seenInvitationRequests.push({
          cursor: requestUrl.searchParams.get("cursor"),
          limit: Number(requestUrl.searchParams.get("limit") ?? "-1")
        });
        return {
          status: 200,
          bodyText: JSON.stringify({
            items: [],
            cursor: null
          })
        };
      }
    });

    const sentInvitations = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
    assert.ok(sentInvitations);
    assert.equal(sentInvitations.status, "warning");
    assert.equal(sentInvitations.captureCompleteness, "partial_visible_slice");
    assert.equal(sentInvitations.exhaustionStatus, "incomplete");
    assert.equal(sentInvitations.reconcileRequired, true);
    assert.equal(sentInvitations.reconcileReason, "resume_terminal_empty_without_baseline");
    assert.equal(sentInvitations.visibleTotalCount, null);
    assert.equal(sentInvitations.nextCursor, null);
    assert.match(sentInvitations.error, /restart a full reconciliation/i);
    assert.deepEqual(seenInvitationRequests, [
      { cursor: "cursor-2", limit: 10 },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live can stop a full received-invitations reconciliation at a page budget and resume from the next cursor", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-received-invitations-page-budget-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenInvitationRequests = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const rawUser = {
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    };

    const sharedOptions = {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-received-invitations"],
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url) => {
        const requestUrl = new URL(url);
        if (!requestUrl.pathname.endsWith("/api/v1/users/invite/received")) {
          return {
            status: 404,
            bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
          };
        }

        const cursor = requestUrl.searchParams.get("cursor");
        const limit = Number(requestUrl.searchParams.get("limit") ?? "-1");
        seenInvitationRequests.push({ cursor, limit });

        if (cursor === "cursor-2") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              items: [
                {
                  id: "invitation-2",
                  inviter: {
                    inviter_name: "Page Two Inviter",
                    inviter_public_identifier: "page-two-inviter"
                  },
                  date: timestamp
                }
              ],
              cursor: null
            })
          };
        }

        return {
          status: 200,
          bodyText: JSON.stringify({
            items: [
              {
                id: "invitation-1",
                inviter: {
                  inviter_name: "Page One Inviter",
                  inviter_public_identifier: "page-one-inviter"
                },
                date: timestamp
              }
            ],
            cursor: "cursor-2"
          })
        };
      },
      unipileHttpPostImpl: () => ({
        status: 404,
        bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
      })
    };

    const first = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      maxPages: 1,
      pageSize: 1,
    });

    const firstInvitations = first.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-received-invitations");
    assert.ok(firstInvitations);
    assert.equal(firstInvitations.status, "warning");
    assert.equal(firstInvitations.reconcileReason, "page_budget_stopped_early");
    assert.equal(firstInvitations.nextCursor, "cursor-2");
    assert.equal(firstInvitations.observations.length, 1);

    const resumed = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      resumeCursor: "cursor-2",
      maxPages: 1,
      pageSize: 1,
    });

    const resumedInvitations = resumed.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-received-invitations");
    assert.ok(resumedInvitations);
    assert.equal(resumedInvitations.status, "success");
    assert.equal(resumedInvitations.nextCursor, null);
    assert.equal(resumedInvitations.observations.length, 1);
    assert.deepEqual(seenInvitationRequests, [
      { cursor: null, limit: 1 },
      { cursor: "cursor-2", limit: 1 },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live can stop a full messaging-inbox reconciliation at a page budget and resume from the next cursor", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-messaging-inbox-page-budget-"));
  const codexHome = path.join(tempDir, ".codex");
  const timestamp = "2026-06-04T12:00:00.000Z";
  const seenChatRequests = [];

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile]",
    "enabled = true",
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    ""
  ].join("\n"));

  try {
    const rawUser = {
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "linkedin-live-unipile-user",
      owner: "william",
      notes: null,
      workingHours: {
        mode: "always",
        timezone: "America/New_York",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        startLocalTime: "09:00",
        endLocalTime: "17:00"
      },
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "linkedin-live-unipile-user",
          label: "LinkedIn via Unipile",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-1",
          providerAccountId: "unipile-linkedin-1",
          preferred: true,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: null,
              messages: null
            }
          },
          notes: null,
          inboundSync: {
            surfaces: []
          }
        }
      ],
      harnessConnections: [
        {
          id: "harness-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          runtime: "codex",
          connector: "unipile",
          label: "codex:unipile",
          status: "available",
          notes: null
        }
      ],
      inboundIgnoreRules: []
    };

    const sharedOptions = {
      accountId: "linkedin-account-1",
      runtime: "codex",
      connector: "unipile",
      mode: "full",
      limit: 500,
      surfaceKeys: ["linkedin-messaging-inbox"],
      codexHome,
      allowDirectUnipileHttp: true,
      unipileHttpGetImpl: (url) => {
        const requestUrl = new URL(url);
        if (!requestUrl.pathname.endsWith("/api/v1/chats")) {
          return {
            status: 404,
            bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
          };
        }

        const cursor = requestUrl.searchParams.get("cursor");
        const limit = Number(requestUrl.searchParams.get("limit") ?? "-1");
        const unread = requestUrl.searchParams.get("unread");
        seenChatRequests.push({ cursor, limit, unread });

        if (cursor === "cursor-2") {
          return {
            status: 200,
            bodyText: JSON.stringify({
              items: [
                {
                  id: "thread-2",
                  unread_count: 1,
                  timestamp
                }
              ],
              cursor: null
            })
          };
        }

        return {
          status: 200,
          bodyText: JSON.stringify({
            items: [
              {
                id: "thread-1",
                unread_count: 2,
                timestamp
              }
            ],
            cursor: "cursor-2"
          })
        };
      },
      unipileHttpPostImpl: () => ({
        status: 404,
        bodyText: JSON.stringify({ title: "Not found", status: 404, type: "errors/not_found" })
      })
    };

    const first = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      maxPages: 1,
      pageSize: 1,
    });

    const firstInbox = first.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-messaging-inbox");
    assert.ok(firstInbox);
    assert.equal(firstInbox.status, "warning");
    assert.equal(firstInbox.reconcileReason, "page_budget_stopped_early");
    assert.equal(firstInbox.nextCursor, "cursor-2");
    assert.equal(firstInbox.observations.length, 1);

    const resumed = await buildLiveLinkedinInboundSyncPayload(rawUser, [], {
      ...sharedOptions,
      resumeCursor: "cursor-2",
      maxPages: 1,
      pageSize: 1,
    });

    const resumedInbox = resumed.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-messaging-inbox");
    assert.ok(resumedInbox);
    assert.equal(resumedInbox.status, "success");
    assert.equal(resumedInbox.nextCursor, null);
    assert.equal(resumedInbox.observations.length, 1);
    assert.deepEqual(seenChatRequests, [
      { cursor: null, limit: 1, unread: "true" },
      { cursor: "cursor-2", limit: 1, unread: "true" },
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync gmail-live returns a connector handoff for a managed Codex Gmail account", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-gmail-live-codex-handoff-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), ['[plugins."gmail@openai-curated"]', "enabled = true", ""].join("\n"));

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "gmail-live-codex-user"), "--owner", "william", "--json"]);
    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "gmail-live-codex-user@example.com",
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
      "--runtime",
      "codex",
      "--connector",
      "gmail",
      "--json"
    ], {
      CODEX_HOME: codexHome,
      CODEX_SHELL: "1"
    });

    assert.equal(result.transport.kind, "agent_handoff");
    assert.equal(result.transport.connector, "gmail");
    assert.equal(result.transport.captureRequest.captureTransportMode, "connector_native_only");
    assert.equal(result.payload, null);
    assert.equal(result.capture, null);
    assert.equal(result.transport.captureRequest.profileSelection, null);
    assert.match(result.transport.captureRequest.prompt, /gmail connector available in this runtime/i);
    assert.match(result.probe.reason, /gmail@openai-curated/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
