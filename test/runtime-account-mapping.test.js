// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { mapUserRuntimeAccounts } from "../src/core/map-user-runtime-accounts.js";

function userFixture() {
  return {
    id: "user-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "Operator",
    owner: "operator",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00",
    },
    accounts: [
      {
        id: "linkedin-browser",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "linkedin",
        handle: "operator-linkedin",
        label: null,
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        harnessConnectionId: null,
        preferred: true,
        notes: null,
        inboundSync: {
          surfaces: [],
        },
      },
      {
        id: "gmail-browser",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "gmail",
        handle: "operator@example.com",
        label: null,
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        harnessConnectionId: null,
        preferred: true,
        notes: null,
        inboundSync: {
          surfaces: [],
        },
      },
      {
        id: "hubspot-browser",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "hubspot",
        handle: "245546701",
        label: null,
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        harnessConnectionId: null,
        preferred: true,
        notes: null,
        inboundSync: {
          surfaces: [],
        },
      },
    ],
    harnessConnections: [],
  };
}

test("mapUserRuntimeAccounts discovers managed linkedin, gmail, and hubspot mappings from runtime coverage", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-mapping-discover-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      '[plugins."gmail@openai-curated"]',
      "enabled = true",
      "",
      '[plugins."hubspot@openai-curated"]',
      "enabled = true",
      "",
      "[mcp_servers.unipile]",
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const result = mapUserRuntimeAccounts(userFixture(), {
      runtime: "codex",
      codexHome,
      apply: false,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "gmail",
          capability: "gmail",
          providerAccountId: "link-gmail",
          handle: "operator@example.com",
          label: "Operator Gmail",
        },
        {
          runtime: "codex",
          connector: "hubspot",
          capability: "hubspot",
          providerAccountId: "link-hubspot",
          handle: "245546701",
          label: "Knit HubSpot",
        },
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin",
          handle: "operator-linkedin",
          label: "Operator LinkedIn",
          metadata: {
            premiumFeatures: ["sales_navigator"],
          },
        },
      ],
    });

    assert.equal(result.counts.mappingCount, 4);
    assert.equal(result.counts.readyToMapCount, 3);
    assert.equal(result.counts.mappedCount, 0);
    assert.equal(result.counts.unavailableCount, 0);
    assert.equal(result.counts.identityBlockedCount, 1);

    const linkedin = result.mappings.find((mapping) => mapping.capability === "linkedin");
    const gmail = result.mappings.find((mapping) => mapping.capability === "gmail" && mapping.connector === "gmail");
    const unipileGmail = result.mappings.find((mapping) => mapping.capability === "gmail" && mapping.connector === "unipile");
    const hubspot = result.mappings.find((mapping) => mapping.capability === "hubspot");

    assert.equal(linkedin?.connector, "unipile");
    assert.equal(linkedin?.action, "ready_to_map");
    assert.equal(linkedin?.existingAccount?.sourceType, "browser-profile");
    assert.equal(linkedin?.discoveredAccount?.providerAccountId, "acct-linkedin");

    assert.equal(gmail?.connector, "gmail");
    assert.equal(gmail?.action, "ready_to_map");
    assert.equal(gmail?.existingAccount?.handle, "operator@example.com");
    assert.equal(gmail?.discoveredAccount?.providerAccountId, "link-gmail");

    assert.equal(unipileGmail?.action, "identity_unresolved");
    assert.equal(unipileGmail?.discoveredAccount?.label, "Mail via Unipile");

    assert.equal(hubspot?.connector, "hubspot");
    assert.equal(hubspot?.action, "ready_to_map");
    assert.equal(hubspot?.existingAccount?.handle, "245546701");
    assert.equal(hubspot?.discoveredAccount?.providerAccountId, "link-hubspot");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mapUserRuntimeAccounts can persist managed mappings and optionally mark them preferred", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-mapping-apply-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      '[plugins."gmail@openai-curated"]',
      "enabled = true",
      "",
      "[mcp_servers.unipile]",
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const result = mapUserRuntimeAccounts(userFixture(), {
      runtime: "codex",
      codexHome,
      apply: true,
      preferManaged: true,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "gmail",
          capability: "gmail",
          providerAccountId: "link-gmail",
          handle: "operator@example.com",
          label: "Operator Gmail",
        },
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin",
          handle: "operator-linkedin",
          label: "Operator LinkedIn",
          metadata: {
            premiumFeatures: ["sales_navigator"],
          },
        },
      ],
    });

    assert.equal(result.counts.mappedCount, 2);
    assert.equal(result.updatedUser.harnessConnections.length, 2);

    const linkedinManaged = result.updatedUser.accounts.find((account) =>
      account.capability === "linkedin" && account.sourceType === "harness-connection"
    );
    const gmailManaged = result.updatedUser.accounts.find((account) =>
      account.capability === "gmail" && account.sourceType === "harness-connection"
    );
    const linkedinBrowser = result.updatedUser.accounts.find((account) =>
      account.id === "linkedin-browser"
    );

    assert.ok(linkedinManaged);
    assert.ok(gmailManaged);
    assert.equal(linkedinManaged?.preferred, true);
    assert.equal(gmailManaged?.preferred, true);
    assert.equal(linkedinManaged?.providerAccountId, "acct-linkedin");
    assert.equal(gmailManaged?.providerAccountId, "link-gmail");
    assert.deepEqual(linkedinManaged?.metadata?.premiumFeatures, ["sales_navigator"]);
    assert.equal(linkedinBrowser?.preferred, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mapUserRuntimeAccounts can map multiple capabilities through one unipile connector", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-mapping-unipile-multi-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.unipile]",
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const result = mapUserRuntimeAccounts(userFixture(), {
      runtime: "codex",
      codexHome,
      apply: true,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "gmail",
          providerAccountId: "acct-mail-1",
          handle: "wflanagan@audienti.com",
          label: "William Flanagan",
        },
        {
          runtime: "codex",
          connector: "unipile",
          capability: "gmail",
          providerAccountId: "acct-mail-2",
          handle: "william.flanagan@knitit.ai",
          label: "William Flanagan Knit",
        },
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-1",
          handle: "williamflanagan",
          label: "William Flanagan",
        },
      ],
    });

    const managedUnipileAccounts = result.updatedUser.accounts.filter((account) =>
      account.sourceType === "harness-connection"
      && account.harnessConnectionId
    );
    const managedHandles = managedUnipileAccounts.map((account) => account.handle).sort();

    assert.equal(result.counts.mappedCount, 3);
    assert.deepEqual(managedHandles, [
      "wflanagan@audienti.com",
      "william.flanagan@knitit.ai",
      "williamflanagan",
    ]);

    const gmailAccounts = managedUnipileAccounts.filter((account) => account.capability === "gmail");
    assert.equal(gmailAccounts.length, 2);
    assert.deepEqual(gmailAccounts.map((account) => account.providerAccountId).sort(), ["acct-mail-1", "acct-mail-2"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mapUserRuntimeAccounts is idempotent after managed mappings are attached", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-mapping-idempotent-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      '[plugins."gmail@openai-curated"]',
      "enabled = true",
      "",
      '[plugins."hubspot@openai-curated"]',
      "enabled = true",
      "",
      "[mcp_servers.unipile]",
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const runtimeAccountHints = [
      {
        runtime: "codex",
        connector: "gmail",
        capability: "gmail",
        providerAccountId: "link-gmail",
        handle: "operator@example.com",
        label: "Operator Gmail",
      },
      {
        runtime: "codex",
        connector: "hubspot",
        capability: "hubspot",
        providerAccountId: "link-hubspot",
        handle: "245546701",
        label: "Knit HubSpot",
      },
      {
        runtime: "codex",
        connector: "unipile",
        capability: "linkedin",
        providerAccountId: "acct-linkedin",
        handle: "operator-linkedin",
        label: "Operator LinkedIn",
      },
    ];
    const first = mapUserRuntimeAccounts(userFixture(), {
      runtime: "codex",
      codexHome,
      apply: true,
      runtimeAccountHints,
    });

    const second = mapUserRuntimeAccounts(first.updatedUser, {
      runtime: "codex",
      codexHome,
      apply: false,
      runtimeAccountHints,
    });

    assert.equal(second.counts.mappingCount, 4);
    assert.equal(second.counts.readyToMapCount, 0);
    assert.equal(second.counts.mappedCount, 0);
    assert.equal(second.counts.alreadyMappedCount, 3);
    assert.equal(second.counts.identityBlockedCount, 1);
    assert.equal(second.updatedUser.accounts.length, first.updatedUser.accounts.length);
    assert.equal(second.updatedUser.harnessConnections.length, first.updatedUser.harnessConnections.length);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("mapUserRuntimeAccounts can persist more than one managed account behind the same connector", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-runtime-account-mapping-multi-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.unipile]",
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const result = mapUserRuntimeAccounts(rawUserWithoutAccounts(), {
      runtime: "codex",
      codexHome,
      apply: true,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-1",
          handle: "williamflanagan",
          label: "William Flanagan",
        },
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-2",
          handle: "knit-operator",
          label: "Knit Operator",
        },
      ],
    });

    const managedLinkedin = result.updatedUser.accounts.filter((account) =>
      account.capability === "linkedin" && account.sourceType === "harness-connection"
    );

    assert.equal(result.counts.mappedCount, 2);
    assert.equal(result.updatedUser.harnessConnections.length, 1);
    assert.equal(managedLinkedin.length, 2);
    assert.deepEqual(managedLinkedin.map((account) => account.providerAccountId).sort(), ["acct-linkedin-1", "acct-linkedin-2"]);
    assert.deepEqual(managedLinkedin.map((account) => account.handle).sort(), ["knit-operator", "williamflanagan"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function rawUserWithoutAccounts() {
  return {
    ...userFixture(),
    accounts: [],
  };
}
