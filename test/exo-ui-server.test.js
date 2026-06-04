// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildUiStateRevision } from "../src/cli/exo-ui-server.js";
import { buildAgentRunLockDir } from "../src/lib/agent-run-lock.js";

test("ui state revision changes when agent runtime artifacts change without a DB write", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-rev-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const stateDir = path.join(tmpDir, ".exo");
  fs.mkdirSync(stateDir, { recursive: true });

  const dbPath = path.join(stateDir, "exo.db");
  fs.writeFileSync(dbPath, "seed");

  const statePaths = {
    localDatabasePath: dbPath,
    homeDatabasePath: dbPath,
    repoPolicyPath: path.join(tmpDir, "repo-policy.json"),
    homePolicyPath: path.join(tmpDir, "home-policy.json"),
    homeStateDir: stateDir,
  };

  const rev1 = buildUiStateRevision(statePaths);

  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(path.join(stateDir, "agent-last-pass.json"), JSON.stringify({ status: "blocked" }));
  const rev2 = buildUiStateRevision(statePaths);
  assert.notEqual(rev2, rev1);

  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(path.join(stateDir, "agent-host-state.json"), JSON.stringify({
    browserBackoff: {
      execution: {
        unavailableUntil: "2099-06-04T10:22:27.465Z",
        reason: "blocked",
      },
    },
  }));
  const rev3 = buildUiStateRevision(statePaths);
  assert.notEqual(rev3, rev2);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const lockDir = buildAgentRunLockDir({ stateDir });
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "pid"), "4242\n");
  const rev4 = buildUiStateRevision(statePaths);
  assert.notEqual(rev4, rev3);
});
