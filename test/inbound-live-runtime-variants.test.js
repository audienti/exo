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

    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-live-profile-claude-user", "--owner", "william", "--json"]);
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

    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-live-profile-user", "--owner", "william", "--json"]);
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

test("inbound sync linkedin-live returns a handoff for a managed Codex chrome connector account", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-codex-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");

  writeCodexChromeConfig(codexHome, true);
  writeFakeCodexCaptureScript(fakeCodexPath, loadJsonCassette("inbound/linkedin-live/codex-success.json"));

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-live-user", "--owner", "william", "--json"]);
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
      "--json"
    ], {
      CODEX_HOME: codexHome,
      EXO_CODEX_CLI: fakeCodexPath
    });

    assert.equal(result.probe.detectedStatus, "available");
    assert.match(result.probe.reason, /chrome@openai-bundled/);
    assert.equal(result.transport.kind, "agent_handoff");
    assert.equal(result.transport.connector, "chrome");
    assert.equal(result.transport.captureRequest.captureTransportMode, "connector_native_only");
    assert.equal(result.transport.captureRequest.profileSelection, null);
    assert.equal(result.capture, null);
    assert.equal(result.payload, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live returns a handoff for a managed Claude chrome connector account", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-claude-cassette-"));
  const fakeClaudePath = path.join(tempDir, "fake-claude");

  writeFakeClaudeScript(fakeClaudePath, {
    plugins: ["chrome-devtools-mcp@claude-plugins-official"],
    mcpLines: ["plugin:chrome-devtools-mcp:chrome-devtools: connected - ✓ Connected"],
    structuredOutput: loadJsonCassette("inbound/linkedin-live/claude-success.json")
  });

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-live-claude-user", "--owner", "william", "--json"]);
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
      "--json"
    ], {
      EXO_CLAUDE_CLI: fakeClaudePath
    });

    assert.equal(result.probe.detectedStatus, "available");
    assert.match(result.probe.reason, /Claude (plugin|MCP server)/i);
    assert.equal(result.transport.kind, "agent_handoff");
    assert.equal(result.transport.connector, "chrome");
    assert.equal(result.transport.captureRequest.captureTransportMode, "connector_native_only");
    assert.equal(result.transport.captureRequest.profileSelection, null);
    assert.equal(result.capture, null);
    assert.equal(result.payload, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin-live captures LinkedIn truth directly through a mapped Unipile account", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-live-unipile-direct-"));
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
    assert.equal(result.capture.sections.find((section) => section.surfaceKey === "linkedin-profile-views")?.status, "failed");
    assert.match(result.capture.sections.find((section) => section.surfaceKey === "linkedin-profile-views")?.error ?? "", /profile views/i);
    assert.match(result.probe.reason, /unipile/i);

    const receivedInvites = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-received-invitations");
    assert.ok(receivedInvites);
    assert.equal(receivedInvites.observations[0].actorProfileUrl, "https://www.linkedin.com/in/alicia-buyer/");
    assert.equal(receivedInvites.observations[0].notes, "Would love to connect about governed inbound triage.");

    const sentInvites = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
    assert.ok(sentInvites);
    assert.equal(sentInvites.observations[0].notes, "Wanted to connect after reading the motion brief.");

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

    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/users/invite/sent" && request.apiKey === "test-key"));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/chats" && /unread=true/.test(request.search)));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/chat_attendees/member-2"));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/users/member-2" && /account_id=unipile-linkedin-1/.test(request.search)));
    assert.ok(seenRequests.some((request) => request.pathname === "/api/v1/chats/thread-1/messages"));
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
    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-live-codex-user", "--owner", "william", "--json"]);
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
