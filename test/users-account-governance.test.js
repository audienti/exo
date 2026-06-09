// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { mapUserRuntimeAccounts } from "../src/core/map-user-runtime-accounts.js";
import { resolveUserConnection } from "../src/core/resolve-user-connection.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

function baseUser() {
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
    accounts: [],
    harnessConnections: [],
    managedAccountExclusions: [],
    inboundIgnoreRules: [],
  };
}

test("mapUserRuntimeAccounts honors explicitly excluded managed identities", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-user-account-exclusion-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.unipile]",
      "enabled = true",
      "",
    ].join("\n"),
  );

  try {
    const result = mapUserRuntimeAccounts({
      ...baseUser(),
      managedAccountExclusions: [
        {
          id: "exclude-1",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-2",
          handle: "knit-operator",
          label: "Knit Operator",
          notes: null,
        },
      ],
    }, {
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

    assert.equal(result.counts.mappedCount, 1);
    assert.equal(result.counts.excludedCount, 1);
    assert.equal(
      result.mappings.find((mapping) => mapping.discoveredAccount?.providerAccountId === "acct-linkedin-2")?.action,
      "excluded_identity",
    );
    assert.deepEqual(
      result.updatedUser.accounts.map((account) => account.providerAccountId),
      ["acct-linkedin-1"],
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveUserConnection ignores a stored managed identity once it is excluded", () => {
  const result = resolveUserConnection({
    ...baseUser(),
    accounts: [
      {
        id: "linkedin-managed",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "linkedin",
        handle: "williamflanagan",
        label: "William Flanagan",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        providerAccountId: "acct-linkedin-1",
        preferred: true,
        metadata: null,
        notes: null,
        inboundSync: {
          surfaces: [],
        },
      },
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        runtime: "codex",
        connector: "unipile",
        label: null,
        status: "available",
        notes: null,
      },
    ],
    managedAccountExclusions: [
      {
        id: "exclude-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        runtime: "codex",
        connector: "unipile",
        capability: "linkedin",
        providerAccountId: "acct-linkedin-1",
        handle: "williamflanagan",
        label: "William Flanagan",
        notes: null,
      },
    ],
  }, [], { capability: "linkedin" });

  assert.equal(result.resolutionStatus, "not_found");
  assert.match(result.reason, /No connected linkedin account is stored/i);
});

test("users accounts remove can exclude a removed managed identity and users remove deletes the user", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-users-remove-governance-"));

  try {
    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "operator-main", "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );

    const updated = JSON.parse(
      execFileSync("node", [
        cliPath,
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "williamflanagan",
        "--runtime",
        "codex",
        "--connector",
        "unipile",
        "--provider-account-id",
        "acct-linkedin-1",
        "--preferred",
        "--json",
      ], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );
    const accountId = updated.accounts.find((account) => account.capability === "linkedin").id;

    const removal = JSON.parse(
      execFileSync("node", [
        cliPath,
        "users",
        "accounts",
        "remove",
        user.id,
        accountId,
        "--exclude",
        "--json",
      ], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );

    assert.equal(removal.removedAccount.id, accountId);
    assert.equal(removal.updatedUser.accounts.length, 0);
    assert.equal(removal.updatedUser.managedAccountExclusions.length, 1);
    assert.equal(removal.exclusion.providerAccountId, "acct-linkedin-1");

    const unexcluded = JSON.parse(
      execFileSync("node", [
        cliPath,
        "users",
        "accounts",
        "unexclude",
        user.id,
        removal.exclusion.id,
        "--json",
      ], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );
    assert.equal(unexcluded.managedAccountExclusions.length, 0);

    const removedUser = JSON.parse(
      execFileSync("node", [cliPath, "users", "remove", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );
    assert.equal(removedUser.removed, true);

    const remainingUsers = JSON.parse(
      execFileSync("node", [cliPath, "users", "list", "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );
    assert.equal(remainingUsers.length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
