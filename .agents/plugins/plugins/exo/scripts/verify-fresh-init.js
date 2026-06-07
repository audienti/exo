#!/usr/bin/env node
// @ts-check

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  buildWorkspacePaths,
  collectRecognizedServices,
  ensureRepoDependencies,
  resolvePluginRoot,
  resolveRepoRoot,
  runOnboardingCommand,
} from "./exo-plugin-runtime.js";

const pluginRoot = resolvePluginRoot(import.meta.url);
const repoRoot = resolveRepoRoot(pluginRoot);
let workspaceDir = null;

try {
  ensureRepoDependencies({ repoRoot, installMode: "if-needed" });

  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-plugin-init-"));
  const workspace = buildWorkspacePaths({ workspace: workspaceDir });

  const firstPass = runOnboardingCommand({
    repoRoot,
    workspace: workspace.workspace,
    runtime: "codex",
    apply: false,
  });
  assert.equal(firstPass.status, "needs-scope");
  assert.deepEqual(
    firstPass.install.question.options.map((option) => option.value),
    ["local-folder", "global-install"],
  );

  const secondPass = runOnboardingCommand({
    repoRoot,
    workspace: workspace.workspace,
    runtime: "codex",
    scope: "local-folder",
    apply: true,
  });
  assert.equal(secondPass.ok, true);
  assert.equal(secondPass.onboarding.status, "needs-user");
  assert.equal(secondPass.onboarding.install.choice, "local-folder");
  assert.ok(fs.existsSync(workspace.workspaceConfigPath));

  const recognizedServices = await collectRecognizedServices({
    repoRoot,
    runtimes: ["codex"],
  });
  assert.ok(Array.isArray(recognizedServices.probes));

  console.log("Fresh init verification passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  if (workspaceDir) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
}
