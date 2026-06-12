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

test("users remove refuses to delete an execution user that still owns active motion or company assignments (issue 27)", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-users-remove-blocked-"));
  const offerHtml = [
    "<html>",
    "<head>",
    "<title>Issue 27 Offer</title>",
    '<meta name="description" content="Issue 27 regression offer." />',
    "</head>",
    "<body>ok</body>",
    "</html>",
  ].join("");
  const offerUrl = `data:text/html,${encodeURIComponent(offerHtml)}`;

  try {
    // Seed two users (mirrors the live state from the issue: Audienti + Ali).
    const audientiUser = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "audienti", "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );
    const aliUser = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "ali-umair", "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );

    // Create a motion and pin it to Ali, mirroring the live lucid-fierce-crow
    // motion whose engagementUserAssignment.userId pointed at Ali.
    const motion = JSON.parse(
      execFileSync("node", [
        cliPath,
        "motion",
        "add",
        "--url",
        offerUrl,
        "--premise",
        "Issue 27 regression premise.",
        "--json",
      ], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );

    const assignedMotion = JSON.parse(
      execFileSync("node", [
        cliPath,
        "motion",
        "user",
        "assign",
        motion.id,
        "--user",
        aliUser.id,
        "--reason",
        "Pin Ali on this motion",
        "--json",
      ], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );
    assert.equal(assignedMotion.engagementUserAssignment?.userId, aliUser.id);

    // Attempting to remove Ali must fail; the guard should preserve both the
    // user row and the motion assignment instead of silently deleting them.
    let removeOutput = "";
    let removeStatus = 0;
    try {
      removeOutput = execFileSync(
        "node",
        [cliPath, "users", "remove", aliUser.id, "--json"],
        { cwd: tempDir, encoding: "utf8" },
      );
    } catch (error) {
      removeOutput = error.stdout?.toString() ?? "";
      removeStatus = typeof error.status === "number" ? error.status : 1;
    }
    assert.equal(removeStatus, 1, "users remove should exit non-zero when assignments exist");
    const blocked = JSON.parse(removeOutput);
    assert.equal(blocked.removed, false);
    assert.equal(blocked.user.id, aliUser.id);
    assert.equal(blocked.blockedBy.motions.length, 1);
    assert.equal(blocked.blockedBy.motions[0].id, motion.id);
    assert.match(blocked.message, /still assigned to/i);

    // Both Audienti and Ali must still be visible, and the motion must still
    // resolve to Ali. The previous behavior would have wiped Ali and left a
    // dangling engagementUserAssignment.userId.
    const remainingUsers = JSON.parse(
      execFileSync("node", [cliPath, "users", "list", "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );
    assert.equal(remainingUsers.length, 2);
    assert.ok(remainingUsers.some((entry) => entry.id === aliUser.id));
    assert.ok(remainingUsers.some((entry) => entry.id === audientiUser.id));

    const motionAfter = JSON.parse(
      execFileSync("node", [cliPath, "motion", "user", "show", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );
    assert.equal(motionAfter.assignment?.userId, aliUser.id);
    assert.equal(motionAfter.user?.id, aliUser.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
