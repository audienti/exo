#!/usr/bin/env node
// @ts-check

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const INSTALL_MODES = new Set(["if-needed", "always", "skip"]);
const DEFAULT_INSTALL_MODE = "if-needed";
const REPO_PACKAGE_NAME = "@audienti/exo";

/**
 * @param {string} importMetaUrl
 */
export function resolvePluginRoot(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

/**
 * @param {string} startDir
 */
export function resolveRepoRoot(startDir) {
  let current = path.resolve(startDir);

  while (true) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const payload = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (payload?.name === REPO_PACKAGE_NAME) {
        return current;
      }
    }

    const next = path.dirname(current);
    if (next === current) {
      throw new Error(`Unable to resolve the Exo repo root from ${startDir}.`);
    }
    current = next;
  }
}

/**
 * @param {string | undefined} rawCommand
 */
function resolveNpmCommand(rawCommand) {
  if (rawCommand && rawCommand.trim()) {
    return rawCommand.trim();
  }
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/**
 * @param {{ repoRoot: string, installMode?: string | null | undefined, npmCommand?: string | null | undefined }} input
 */
export function ensureRepoDependencies(input) {
  const repoRoot = path.resolve(input.repoRoot);
  const installMode = normalizeInstallMode(input.installMode);
  const npmCommand = resolveNpmCommand(input.npmCommand ?? process.env.npm_execpath);
  const requiredPackages = [
    path.join(repoRoot, "node_modules", "commander"),
    path.join(repoRoot, "node_modules", "zod"),
  ];
  const needsInstall = installMode === "always"
    || (installMode === "if-needed" && requiredPackages.some((packagePath) => !fs.existsSync(packagePath)));

  if (installMode === "skip" || !needsInstall) {
    return {
      ok: true,
      installMode,
      ranInstall: false,
      npmCommand,
    };
  }

  const result = spawnSync(npmCommand, ["install"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "npm install failed.");
  }

  return {
    ok: true,
    installMode,
    ranInstall: true,
    npmCommand,
  };
}

/**
 * @param {string | null | undefined} value
 */
function normalizeInstallMode(value) {
  const normalized = value?.trim().toLowerCase() ?? DEFAULT_INSTALL_MODE;
  if (!INSTALL_MODES.has(normalized)) {
    throw new Error(`Install mode must be one of: ${Array.from(INSTALL_MODES).join(", ")}.`);
  }
  return normalized;
}

/**
 * @param {{
 *   repoRoot: string,
 *   workspace: string,
 *   scope?: string | null | undefined,
 *   label?: string | null | undefined,
 *   user?: string | null | undefined,
 *   runtime?: string | null | undefined,
 *   apply?: boolean | undefined,
 * }} input
 */
export function runOnboardingCommand(input) {
  const repoRoot = path.resolve(input.repoRoot);
  const workspace = path.resolve(input.workspace);
  const cliPath = path.join(repoRoot, "src", "cli", "index.js");
  const args = [cliPath, "onboarding"];
  const env = { ...process.env };

  delete env.EXO_STATE_DIR;
  delete env.EXO_HOME_STATE_DIR;

  if (input.scope) {
    args.push("--scope", input.scope);
  }
  if (input.label) {
    args.push("--label", input.label);
  }
  if (input.user) {
    args.push("--user", input.user);
  }
  if (input.runtime) {
    args.push("--runtime", input.runtime);
  }
  if (input.apply) {
    args.push("--apply");
  }
  args.push("--json");

  const result = spawnSync(process.execPath, args, {
    cwd: workspace,
    encoding: "utf8",
    env,
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || "exo onboarding failed.");
  }

  return JSON.parse(result.stdout);
}

/**
 * @param {{ repoRoot: string, runtimes?: string[] | null | undefined }} input
 */
export async function collectRecognizedServices(input) {
  const repoRoot = path.resolve(input.repoRoot);
  const requestedRuntimes = input.runtimes?.length ? input.runtimes : ["codex"];
  const moduleUrl = pathToFileURL(path.join(repoRoot, "src", "core", "probe-user-harness-connections.js")).href;
  const {
    listSupportedRuntimeConnectors,
    probeRuntimeConnectorAvailability,
  } = await import(moduleUrl);

  /** @type {Array<{ runtime: string, connector: string, detectedStatus: string, reason: string, evidence: string[] }>} */
  const probes = [];
  for (const runtime of requestedRuntimes) {
    for (const connector of listSupportedRuntimeConnectors(runtime)) {
      const probe = probeRuntimeConnectorAvailability(runtime, connector, {
        codexHome: process.env.CODEX_HOME ?? null,
        claudeCli: process.env.EXO_CLAUDE_CLI ?? null,
      });
      probes.push({
        runtime,
        connector,
        detectedStatus: probe.detectedStatus,
        reason: probe.reason,
        evidence: probe.evidence,
      });
    }
  }

  return {
    runtimes: requestedRuntimes,
    available: probes.filter((probe) => probe.detectedStatus === "available"),
    unavailable: probes.filter((probe) => probe.detectedStatus === "unavailable"),
    unknown: probes.filter((probe) => probe.detectedStatus === "unknown"),
    probes,
  };
}

/**
 * @param {{ workspace?: string | null | undefined }} input
 */
export function buildWorkspacePaths(input = {}) {
  const workspace = path.resolve(input.workspace ?? process.cwd());
  return {
    workspace,
    localStateDir: path.join(workspace, ".exo"),
    workspaceConfigPath: path.join(workspace, ".exo", "workspace.json"),
  };
}
