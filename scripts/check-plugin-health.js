#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ json: boolean, workspace: string }} */
  const options = {
    json: false,
    workspace: repoRoot,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--workspace") {
      if (!next) {
        throw new Error("--workspace requires a value.");
      }
      options.workspace = path.resolve(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 */
function runNode(args, options = {}) {
  return runCommand(process.execPath, args, options);
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 */
function runGit(args, options = {}) {
  return runCommand("git", args, options);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 */
function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      result.stderr?.trim()
      || result.stdout?.trim()
      || `${command} ${args.join(" ")} failed.`,
    );
  }

  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

/**
 * @param {string} relativePath
 */
function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

/**
 * @param {ReturnType<typeof buildPayload>} payload
 */
function renderHuman(payload) {
  const lines = [
    `Plugin version: ${payload.version.package}`,
    `Repo: ${payload.repoRoot}`,
    `Commit: ${payload.git.branch} ${payload.git.commit}${payload.git.upstream ? ` -> ${payload.git.upstream}` : ""}`,
    `Workspace: ${payload.workspace}`,
    `Working tree: ${payload.git.workingTreeClean ? "clean" : "dirty"}`,
    `Wrapper check: ${payload.checks.pluginInit.onboardingStatus}`,
    `Recognized services: ${payload.checks.pluginInit.recognizedServices.length ? payload.checks.pluginInit.recognizedServices.join(", ") : "none"}`,
    `Fresh init verifier: ${payload.checks.freshInitVerify}`,
    `Plugin tests: ${payload.checks.pluginTests}`,
  ];

  return lines.join("\n");
}

function buildPayload() {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = readJson("package.json");
  const pluginManifest = readJson(".codex-plugin/plugin.json");
  const initResult = JSON.parse(
    runNode([
      path.join(repoRoot, ".agents", "plugins", "plugins", "exo", "scripts", "init-exo-plugin.js"),
      "--workspace",
      options.workspace,
      "--json",
    ]).stdout,
  );

  runNode([path.join(repoRoot, ".agents", "plugins", "plugins", "exo", "scripts", "verify-fresh-init.js")]);
  runNode(["--test", "test/plugin-versioning.test.js", "test/plugin-marketplace-init.test.js"]);

  let upstream = null;
  try {
    upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).stdout;
  } catch {
    upstream = null;
  }

  const gitStatus = runGit(["status", "--short"]).stdout;

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    repoRoot,
    workspace: options.workspace,
    version: {
      package: packageJson.version,
      manifest: pluginManifest.version,
    },
    git: {
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]).stdout,
      commit: runGit(["rev-parse", "--short", "HEAD"]).stdout,
      upstream,
      workingTreeClean: gitStatus.length === 0,
    },
    checks: {
      pluginInit: {
        onboardingStatus: initResult.onboarding.onboarding?.status ?? initResult.onboarding.status ?? "unknown",
        dependenciesInstalled: initResult.dependencies?.ranInstall ?? false,
        recognizedServices: Array.isArray(initResult.recognizedServices?.available)
          ? initResult.recognizedServices.available.map((probe) => `${probe.runtime}:${probe.connector}`)
          : [],
      },
      freshInitVerify: "passed",
      pluginTests: "passed",
    },
  };
}

try {
  const payload = buildPayload();
  if (payload.version.package !== payload.version.manifest) {
    throw new Error("package.json and .codex-plugin/plugin.json versions do not match.");
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(renderHuman(payload));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}
