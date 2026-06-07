// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginInitScript = path.join(
  repoRoot,
  ".agents",
  "plugins",
  "plugins",
  "exo",
  "scripts",
  "init-exo-plugin.js",
);

test("plugin init surfaces the real onboarding scope question on a fresh workspace", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-plugin-marketplace-init-"));

  try {
    const result = JSON.parse(
      execFileSync(process.execPath, [
        pluginInitScript,
        "--workspace",
        tempDir,
        "--install-mode",
        "if-needed",
        "--json",
      ], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.onboarding.status, "needs-scope");
    assert.deepEqual(
      result.onboarding.install.question.options.map((option) => option.value),
      ["local-folder", "global-install"],
    );
    assert.ok(Array.isArray(result.recognizedServices.probes));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("plugin init can persist a local-folder choice through the wrapper", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-plugin-marketplace-scope-"));

  try {
    const result = JSON.parse(
      execFileSync(process.execPath, [
        pluginInitScript,
        "--workspace",
        tempDir,
        "--install-mode",
        "if-needed",
        "--scope",
        "local-folder",
        "--apply",
        "--json",
      ], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.onboarding.ok, true);
    assert.equal(result.onboarding.onboarding.status, "needs-user");
    assert.equal(result.onboarding.onboarding.install.choice, "local-folder");

    const workspaceConfig = JSON.parse(fs.readFileSync(path.join(tempDir, ".exo", "workspace.json"), "utf8"));
    assert.equal(workspaceConfig.installScope, "local-folder");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
