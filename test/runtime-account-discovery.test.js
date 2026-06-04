// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { discoverRuntimeConnectorAccounts } from "../src/core/discover-runtime-account-identities.js";

test("discoverRuntimeConnectorAccounts enumerates multiple Codex Gmail links as unresolved accounts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-discovery-gmail-"));
  const codexHome = path.join(tempDir, ".codex");
  const cacheDir = path.join(codexHome, "cache", "codex_apps_tools");

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "tools.json"), JSON.stringify({
    tools: [
      {
        tool_namespace: "codex_apps__gmail",
        tool_name: "_get_profile",
        tool: {
          _meta: {
            link_id: "link_gmail_one",
            connector_id: "connector_gmail",
            _codex_apps: {
              resource_uri: "/connector_gmail/link_gmail_one/get_profile",
            },
          },
        },
      },
      {
        tool_namespace: "codex_apps__gmail",
        tool_name: "_send_email",
        tool: {
          _meta: {
            link_id: "link_gmail_two",
            connector_id: "connector_gmail",
            _codex_apps: {
              resource_uri: "/connector_gmail/link_gmail_two/send_email",
            },
          },
        },
      },
    ],
  }, null, 2));

  try {
    const result = discoverRuntimeConnectorAccounts({
      runtime: "codex",
      connector: "gmail",
      capability: "gmail",
      codexHome,
    });

    assert.equal(result.length, 2);
    assert.deepEqual(result.map((item) => item.providerAccountId).sort(), ["link_gmail_one", "link_gmail_two"]);
    assert.ok(result.every((item) => item.identityState === "unresolved"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("discoverRuntimeConnectorAccounts prefers explicit runtime account hints", () => {
  const result = discoverRuntimeConnectorAccounts({
    runtime: "codex",
    connector: "gmail",
    capability: "gmail",
    hints: [
      {
        runtime: "codex",
        connector: "gmail",
        capability: "gmail",
        providerAccountId: "link_gmail_live",
        handle: "wflanagan@audienti.com",
        label: "William Flanagan",
      },
    ],
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].identityState, "confirmed");
  assert.equal(result[0].handle, "wflanagan@audienti.com");
  assert.equal(result[0].providerAccountId, "link_gmail_live");
});

test("discoverRuntimeConnectorAccounts reads shared runtime account hints from the Exo state dir", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-discovery-state-hints-"));
  const stateDir = path.join(tempDir, ".exo");
  const previousStateDir = process.env.EXO_STATE_DIR;

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "runtime-account-hints.json"),
    JSON.stringify({
      syncedAt: "2026-06-03T18:00:00.000Z",
      accounts: [
        {
          runtime: "codex",
          connector: "gmail",
          capability: "gmail",
          providerAccountId: "link_gmail_state",
          handle: "wflanagan@audienti.com",
          label: "William Flanagan",
        },
      ],
    }, null, 2),
  );

  process.env.EXO_STATE_DIR = stateDir;

  try {
    const result = discoverRuntimeConnectorAccounts({
      runtime: "codex",
      connector: "gmail",
      capability: "gmail",
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].identityState, "confirmed");
    assert.equal(result[0].handle, "wflanagan@audienti.com");
    assert.equal(result[0].providerAccountId, "link_gmail_state");
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("discoverRuntimeConnectorAccounts surfaces Unipile session-unavailable state", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-discovery-unipile-session-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), '[mcp_servers.unipile.env]\nUNIPILE_API_KEY = "test-key"\n');

  try {
    const result = discoverRuntimeConnectorAccounts({
      runtime: "codex",
      connector: "unipile",
      capability: "linkedin",
      codexHome,
      httpGetImpl: () => ({
        status: 503,
        bodyText: JSON.stringify({
          type: "errors/no_client_session",
          title: "No client session",
        }),
      }),
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].identityState, "session_unavailable");
    assert.match(result[0].reason, /no live client session/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("discoverRuntimeConnectorAccounts returns multiple confirmed LinkedIn accounts from Unipile", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-discovery-unipile-live-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), '[mcp_servers.unipile.env]\nUNIPILE_API_KEY = "test-key"\n');

  try {
    const result = discoverRuntimeConnectorAccounts({
      runtime: "codex",
      connector: "unipile",
      capability: "linkedin",
      codexHome,
      httpGetImpl: () => ({
        status: 200,
        bodyText: JSON.stringify({
          object: "AccountList",
          items: [
            {
              id: "acct-linkedin-1",
              type: "LINKEDIN",
              name: "William Flanagan",
              connection_params: {
                im: {
                  id: "urn:li:member:1",
                  username: "William Flanagan",
                  publicIdentifier: "williamflanagan",
                },
              },
            },
            {
              id: "acct-linkedin-2",
              type: "LINKEDIN",
              name: "Knit Account",
              connection_params: {
                im: {
                  id: "urn:li:member:2",
                  username: "Knit Operator",
                  publicIdentifier: "knit-operator",
                },
              },
            },
          ],
        }),
      }),
    });

    assert.equal(result.length, 2);
    assert.ok(result.every((item) => item.identityState === "confirmed"));
    assert.deepEqual(result.map((item) => item.handle).sort(), ["knit-operator", "williamflanagan"]);
    assert.deepEqual(result.map((item) => item.providerAccountId).sort(), ["acct-linkedin-1", "acct-linkedin-2"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("discoverRuntimeConnectorAccounts returns multiple confirmed mail accounts from Unipile", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-discovery-unipile-mail-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), '[mcp_servers.unipile.env]\nUNIPILE_API_KEY = "test-key"\n');

  try {
    const result = discoverRuntimeConnectorAccounts({
      runtime: "codex",
      connector: "unipile",
      capability: "gmail",
      codexHome,
      httpGetImpl: () => ({
        status: 200,
        bodyText: JSON.stringify({
          object: "AccountList",
          items: [
            {
              id: "acct-mail-1",
              type: "GOOGLE_OAUTH",
              name: "William Flanagan",
              connection_params: {
                mail: {
                  id: "mail-1",
                  username: "wflanagan@audienti.com",
                },
                calendar: {
                  id: "cal-1",
                  username: "wflanagan@audienti.com",
                },
              },
            },
            {
              id: "acct-mail-2",
              type: "GOOGLE_OAUTH",
              name: "William Flanagan Knit",
              connection_params: {
                mail: {
                  id: "mail-2",
                  username: "william.flanagan@knitit.ai",
                },
                calendar: {
                  id: "cal-2",
                  username: "william.flanagan@knitit.ai",
                },
              },
            },
            {
              id: "acct-linkedin-1",
              type: "LINKEDIN",
              name: "William Flanagan",
              connection_params: {
                im: {
                  id: "urn:li:member:1",
                  username: "William Flanagan",
                  publicIdentifier: "williamflanagan",
                },
              },
            },
          ],
        }),
      }),
    });

    assert.equal(result.length, 2);
    assert.ok(result.every((item) => item.identityState === "confirmed"));
    assert.deepEqual(result.map((item) => item.handle).sort(), ["wflanagan@audienti.com", "william.flanagan@knitit.ai"]);
    assert.deepEqual(result.map((item) => item.providerAccountId).sort(), ["acct-mail-1", "acct-mail-2"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("discoverRuntimeConnectorAccounts uses the configured Unipile DSN instead of the schema default", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-discovery-unipile-dsn-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      '[mcp_servers.unipile.env]',
      'UNIPILE_API_KEY = "test-key"',
      'UNIPILE_DSN = "https://api14.unipile.com:14465"',
      "",
    ].join("\n"),
  );

  let seenUrl = null;

  try {
    discoverRuntimeConnectorAccounts({
      runtime: "codex",
      connector: "unipile",
      capability: "linkedin",
      codexHome,
      httpGetImpl: (url) => {
        seenUrl = url;
        return {
          status: 503,
          bodyText: JSON.stringify({
            type: "errors/no_client_session",
            title: "No client session",
          }),
        };
      },
    });

    assert.equal(seenUrl, "https://api14.unipile.com:14465/api/v1/accounts?limit=250");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
