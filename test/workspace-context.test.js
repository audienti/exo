// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveStatePaths } from "../src/db/paths.js";

test("resolveStatePaths stays in single-store mode when EXO_HOME_STATE_DIR is unset", () => {
  const cwd = path.join("/tmp", "exo-project");
  const local = path.join(cwd, ".exo-local");
  const resolved = resolveStatePaths({
    cwd,
    env: {
      EXO_STATE_DIR: local,
    },
  });

  assert.equal(resolved.localStateDir, path.resolve(local));
  assert.equal(resolved.homeStateDir, path.resolve(local));
  assert.equal(resolved.layered, false);
  assert.equal(resolved.singleStore, true);
  assert.equal(resolved.repoPolicyPath, path.join(path.resolve(cwd), "exo-policy.jsonl"));
  assert.equal(resolved.homePolicyPath, path.join(path.resolve(local), "policy.jsonl"));
});

test("resolveStatePaths enables layered mode when EXO_HOME_STATE_DIR points elsewhere", () => {
  const cwd = path.join("/tmp", "exo-project");
  const local = path.join(cwd, ".exo");
  const home = path.join("/tmp", "exo-home");
  const resolved = resolveStatePaths({
    cwd,
    env: {
      EXO_STATE_DIR: local,
      EXO_HOME_STATE_DIR: home,
    },
  });

  assert.equal(resolved.localStateDir, path.resolve(local));
  assert.equal(resolved.homeStateDir, path.resolve(home));
  assert.equal(resolved.layered, true);
  assert.equal(resolved.singleStore, false);
  assert.equal(resolved.homePolicyPath, path.join(path.resolve(home), "policy.jsonl"));
});
