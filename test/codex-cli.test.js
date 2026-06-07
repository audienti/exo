// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodexCliCommand } from "../src/lib/codex-cli.js";

test("resolveCodexCliCommand prefers an explicit argument", () => {
  const resolved = resolveCodexCliCommand({
    codexCli: "/tmp/custom-codex",
    env: { EXO_CODEX_CLI: "/tmp/env-codex" },
    appCliPath: "/tmp/app-codex"
  });

  assert.equal(resolved, "/tmp/custom-codex");
});

test("resolveCodexCliCommand prefers EXO_CODEX_CLI when present", () => {
  const resolved = resolveCodexCliCommand({
    env: { EXO_CODEX_CLI: "/tmp/env-codex" },
    appCliPath: "/tmp/app-codex"
  });

  assert.equal(resolved, "/tmp/env-codex");
});

test("resolveCodexCliCommand falls back to the bundled app binary when available", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-codex-cli-"));
  const appCliPath = path.join(tempDir, "codex");
  fs.writeFileSync(appCliPath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(appCliPath, 0o755);

  try {
    const resolved = resolveCodexCliCommand({
      env: {},
      appCliPath
    });

    assert.equal(resolved, appCliPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveCodexCliCommand falls back to codex when no override or bundled app exists", () => {
  const resolved = resolveCodexCliCommand({
    env: {},
    appCliPath: "/tmp/definitely-missing-codex"
  });

  assert.equal(resolved, "codex");
});
