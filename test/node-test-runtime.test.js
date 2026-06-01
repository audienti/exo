// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { buildNodeTestEnv, EXPERIMENTAL_WARNING_DISABLE_FLAG } from "../scripts/node-test-runtime.js";

test("buildNodeTestEnv adds the experimental warning suppression flag once and preserves existing node options", () => {
  const env = buildNodeTestEnv({
    PATH: process.env.PATH ?? "",
    NODE_OPTIONS: "--trace-warnings --max-old-space-size=2048"
  });

  assert.ok(env.NODE_OPTIONS);
  assert.match(env.NODE_OPTIONS, /--trace-warnings/);
  assert.match(env.NODE_OPTIONS, /--max-old-space-size=2048/);
  assert.match(env.NODE_OPTIONS, new RegExp(EXPERIMENTAL_WARNING_DISABLE_FLAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const repeated = buildNodeTestEnv(env);
  const occurrences = repeated.NODE_OPTIONS
    .split(/\s+/)
    .filter((part) => part === EXPERIMENTAL_WARNING_DISABLE_FLAG).length;

  assert.equal(occurrences, 1);
});
