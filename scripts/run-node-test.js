#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import { buildNodeTestEnv } from "./node-test-runtime.js";

const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: buildNodeTestEnv(process.env)
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
