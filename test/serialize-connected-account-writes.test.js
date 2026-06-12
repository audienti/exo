// @ts-check
//
// Regression test for issue #31.
//
// Before the fix, parallel `claimRuntimeAccount` writers against the same
// execution user could both read the same starting snapshot, attach
// different connected accounts in memory, and overwrite each other on the
// final `updateUser` write. That dropped one of the two newly-claimed
// LinkedIn / Gmail accounts in the field.
//
// This test reproduces the race: two child processes barrier together to
// guarantee they both read the same empty-accounts snapshot, then race to
// commit one LinkedIn and one Gmail upsert. With the serialization fix in
// place both accounts survive; without it one is lost.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { addUser } from "../src/core/add-user.js";
import { findUserById, insertUser, mutateUserById } from "../src/db/database.js";
import { withIsolatedExoState } from "./support/normalized-fixtures.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const dbModuleUrl = pathToFileURL(path.join(repoRoot, "src", "db", "database.js")).href;
const upsertModuleUrl = pathToFileURL(
  path.join(repoRoot, "src", "core", "upsert-user-harness-connection.js"),
).href;

test("mutateUserById serializes parallel connected-account writes so neither is lost", async () => {
  await withIsolatedExoState(async ({ stateDir }) => {
    const user = addUser({ label: "race-target-user", owner: "operator" });
    insertUser(user);

    const barrierDir = path.join(stateDir, "connected-account-barrier");
    const outputs = await Promise.all([
      runUpsertChild({
        stateDir,
        barrierDir,
        userId: user.id,
        workerLabel: "linkedin-worker",
        capability: "linkedin",
        handle: "operator-linkedin",
        connector: "unipile",
        providerAccountId: "acct-linkedin-1",
      }),
      runUpsertChild({
        stateDir,
        barrierDir,
        userId: user.id,
        workerLabel: "gmail-worker",
        capability: "gmail",
        handle: "operator@example.com",
        connector: "gmail",
        providerAccountId: "acct-gmail-1",
      }),
    ]);

    const results = outputs.map(parseJsonOutput);
    for (const result of results) {
      assert.equal(result.ok, true, `Child ${result.workerLabel} failed: ${result.message ?? ""}`);
    }

    const stored = /** @type {any} */ (findUserById(user.id));
    assert.ok(stored, "user row is still in the home database after the race");

    const capabilities = stored.accounts.map((account) => account.capability).sort();
    assert.deepEqual(
      capabilities,
      ["gmail", "linkedin"],
      "both linkedin and gmail accounts survived the parallel write",
    );

    const linkedin = stored.accounts.find((account) => account.capability === "linkedin");
    const gmail = stored.accounts.find((account) => account.capability === "gmail");
    assert.equal(linkedin.handle, "operator-linkedin");
    assert.equal(gmail.handle, "operator@example.com");

    const runtimes = stored.harnessConnections.map((connection) => connection.connector).sort();
    assert.deepEqual(
      runtimes,
      ["gmail", "unipile"],
      "both harness connections were preserved alongside the accounts",
    );
  }, { prefix: "exo-connected-account-race-" });
});

test("mutateUserById rolls back the row on a mutator throw and surfaces the error", () => {
  withIsolatedExoState(() => {
    const user = addUser({ label: "rollback-target-user", owner: "operator" });
    insertUser(user);

    assert.throws(
      () => mutateUserById(user.id, () => {
        throw new Error("synthetic mutator failure");
      }),
      /synthetic mutator failure/,
    );

    const stored = /** @type {any} */ (findUserById(user.id));
    assert.ok(stored);
    assert.deepEqual(stored.accounts, [], "no partial mutation was committed");
    assert.equal(stored.label, "rollback-target-user");
  }, { prefix: "exo-connected-account-rollback-" });
});

test("mutateUserById throws when the user no longer exists", () => {
  withIsolatedExoState(() => {
    assert.throws(
      () => mutateUserById("missing-user-id", () => ({
        user: /** @type {any} */ ({ id: "missing-user-id" }),
      })),
      /User not found: missing-user-id/,
    );
  }, { prefix: "exo-connected-account-missing-" });
});

/**
 * @param {{
 *   stateDir: string,
 *   barrierDir: string,
 *   userId: string,
 *   workerLabel: string,
 *   capability: string,
 *   handle: string,
 *   connector: string,
 *   providerAccountId: string,
 * }} input
 */
function runUpsertChild(input) {
  const script = `
    import fs from "node:fs";
    import path from "node:path";
    import { setTimeout as sleep } from "node:timers/promises";
    import { mutateUserById } from ${JSON.stringify(dbModuleUrl)};
    import {
      upsertUserConnectedAccount,
      upsertUserHarnessConnection,
    } from ${JSON.stringify(upsertModuleUrl)};

    await waitForBarrier(${JSON.stringify(input.barrierDir)}, ${JSON.stringify(input.workerLabel)}, 2);

    try {
      const { user } = mutateUserById(${JSON.stringify(input.userId)}, (latest) => {
        // Force a window between the read and the write so a parallel writer
        // racing without the BEGIN IMMEDIATE serialization would have time to
        // commit on top of the same starting snapshot.
        const start = Date.now();
        while (Date.now() - start < 100) {}

        const withHarness = upsertUserHarnessConnection(latest, {
          runtime: "codex",
          connector: ${JSON.stringify(input.connector)},
          status: "available",
        });
        const connection = withHarness.harnessConnections.find((row) =>
          row.connector.toLowerCase() === ${JSON.stringify(input.connector)}.toLowerCase()
        );
        const next = upsertUserConnectedAccount(withHarness, {
          capability: ${JSON.stringify(input.capability)},
          handle: ${JSON.stringify(input.handle)},
          harnessConnectionId: connection.id,
          providerAccountId: ${JSON.stringify(input.providerAccountId)},
          preferred: true,
        });
        return { user: next };
      });
      console.log(JSON.stringify({
        ok: true,
        workerLabel: ${JSON.stringify(input.workerLabel)},
        accountCount: user.accounts.length,
      }));
    } catch (error) {
      console.log(JSON.stringify({
        ok: false,
        workerLabel: ${JSON.stringify(input.workerLabel)},
        message: error instanceof Error ? error.message : String(error),
      }));
    }

    async function waitForBarrier(dir, label, expected) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, label + ".ready"), "1");
      while (fs.readdirSync(dir).filter((name) => name.endsWith(".ready")).length < expected) {
        await sleep(10);
      }
    }
  `;

  return execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    env: { ...process.env, EXO_STATE_DIR: input.stateDir },
    encoding: "utf8",
  }).then((result) => result.stdout);
}

/**
 * @param {string} output
 */
function parseJsonOutput(output) {
  const line = output.trim().split(/\n/).at(-1);
  assert.ok(line, "child process returned JSON output");
  return JSON.parse(line);
}
