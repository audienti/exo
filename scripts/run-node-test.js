#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildNodeTestEnv } from "./node-test-runtime.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const liveDatabasePath = path.join(repoRoot, ".exo", "exo.db");

// Tripwire: tests must never write into the live workspace database. Users and
// motions are only created by tests and the operator — never by the background
// worker — so their counts are a stable sentinel even if the launchd worker
// happens to sync observations mid-suite.
function snapshotLiveWorkspaceSentinel() {
  if (!fs.existsSync(liveDatabasePath)) {
    return null;
  }

  try {
    const database = new DatabaseSync(liveDatabasePath, { readOnly: true });
    try {
      const users = /** @type {any} */ (database.prepare("SELECT COUNT(*) AS count FROM users").get());
      const motions = /** @type {any} */ (database.prepare("SELECT COUNT(*) AS count FROM motions").get());
      return { userCount: users?.count ?? 0, motionCount: motions?.count ?? 0 };
    } finally {
      database.close();
    }
  } catch {
    // Missing tables or an unreadable file means there is nothing to protect.
    return null;
  }
}

const sentinelBefore = snapshotLiveWorkspaceSentinel();

// Strip inherited state-dir overrides at the suite boundary: the launchd agent
// environment (and stray shells) export EXO_STATE_DIR pointing at the live
// workspace, which would redirect every test write into the live database.
// Tests that need a state dir set one explicitly on the env they construct.
const suiteEnv = buildNodeTestEnv(process.env);
delete suiteEnv.EXO_STATE_DIR;
delete suiteEnv.EXO_HOME_STATE_DIR;

const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: suiteEnv
});

if (result.error) {
  throw result.error;
}

const sentinelAfter = snapshotLiveWorkspaceSentinel();
if (
  sentinelBefore
  && sentinelAfter
  && (sentinelBefore.userCount !== sentinelAfter.userCount
    || sentinelBefore.motionCount !== sentinelAfter.motionCount)
) {
  console.error(
    `Test suite wrote into the live workspace database (${liveDatabasePath}): `
    + `users ${sentinelBefore.userCount} -> ${sentinelAfter.userCount}, `
    + `motions ${sentinelBefore.motionCount} -> ${sentinelAfter.motionCount}. `
    + "A test is missing state isolation (EXO_STATE_DIR / withIsolatedExoState)."
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
