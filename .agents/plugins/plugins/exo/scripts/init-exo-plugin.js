#!/usr/bin/env node
// @ts-check

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

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{
   *   workspace: string,
   *   scope: string | null,
   *   label: string | null,
   *   user: string | null,
   *   runtime: string,
   *   apply: boolean,
   *   json: boolean,
   *   installMode: string,
   * }} */
  const options = {
    workspace: process.cwd(),
    scope: null,
    label: null,
    user: null,
    runtime: "codex",
    apply: false,
    json: false,
    installMode: "if-needed",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--workspace") {
      options.workspace = requireValue(token, next);
      index += 1;
      continue;
    }
    if (token === "--scope") {
      options.scope = requireValue(token, next);
      index += 1;
      continue;
    }
    if (token === "--label") {
      options.label = requireValue(token, next);
      index += 1;
      continue;
    }
    if (token === "--user") {
      options.user = requireValue(token, next);
      index += 1;
      continue;
    }
    if (token === "--runtime") {
      options.runtime = requireValue(token, next);
      index += 1;
      continue;
    }
    if (token === "--install-mode") {
      options.installMode = requireValue(token, next);
      index += 1;
      continue;
    }
    if (token === "--apply") {
      options.apply = true;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

/**
 * @param {string} flag
 * @param {string | undefined} value
 */
function requireValue(flag, value) {
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

/**
 * @param {Awaited<ReturnType<typeof buildPayload>>} payload
 */
function renderHuman(payload) {
  const lines = [
    `Workspace: ${payload.workspace.workspace}`,
    `Repo root: ${payload.repoRoot}`,
    `Dependencies: ${payload.dependencies.ranInstall ? "installed" : "ready"}`,
    `Onboarding status: ${payload.onboarding.status ?? payload.onboarding.onboarding?.status ?? "unknown"}`,
  ];

  if (payload.recognizedServices.available.length) {
    lines.push(
      `Recognized services: ${payload.recognizedServices.available.map((probe) => `${probe.runtime}:${probe.connector}`).join(", ")}`
    );
  } else {
    lines.push("Recognized services: none currently available");
  }

  const install = payload.onboarding.install ?? payload.onboarding.onboarding?.install ?? null;
  if (install?.question?.prompt) {
    lines.push(`Next question: ${install.question.prompt}`);
  }

  return lines.join("\n");
}

async function buildPayload() {
  const options = parseArgs(process.argv.slice(2));
  const pluginRoot = resolvePluginRoot(import.meta.url);
  const repoRoot = resolveRepoRoot(pluginRoot);
  const workspace = buildWorkspacePaths({ workspace: options.workspace });
  const dependencies = ensureRepoDependencies({
    repoRoot,
    installMode: options.installMode,
  });
  const onboarding = runOnboardingCommand({
    repoRoot,
    workspace: workspace.workspace,
    scope: options.scope,
    label: options.label,
    user: options.user,
    runtime: options.runtime,
    apply: options.apply,
  });
  const recognizedServices = await collectRecognizedServices({
    repoRoot,
    runtimes: [options.runtime],
  });

  return {
    ok: true,
    pluginRoot,
    repoRoot,
    workspace,
    dependencies,
    onboarding,
    recognizedServices,
  };
}

try {
  const payload = await buildPayload();
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
