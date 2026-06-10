// @ts-check

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveCodexCliCommand } from "../lib/codex-cli.js";

const execFileAsync = promisify(execFile);

const GENERATOR_TIMEOUT_MS = 180000;
const GENERATOR_MAX_BUFFER = 32 * 1024 * 1024;
// A failed contract bigger than this is not something an LLM can repair
// reliably in one shot; fail closed instead of truncating silently.
const MAX_FAILED_CONTRACT_BYTES = 400 * 1024;

/**
 * LLM-backed repair generator: "we see the problem, and we fix it."
 *
 * This is the injectable `repairGenerator` for executeRepairableContract. It
 * shells out to a local agent CLI (claude or codex — the same runtimes Exo
 * already uses for live capture) with the failed contract and the structured
 * failure artifact, and asks for a corrected full-replacement contract.
 *
 * Safety properties, all enforced OUTSIDE this module by the executor:
 * - the replacement is revalidated against the contract schema and all
 *   postconditions (including agent_queue subset-only) before it is ever used;
 * - exactly one generation attempt per failure per invocation;
 * - any error here resolves to null, which fails closed.
 *
 * Properties enforced HERE:
 * - repairs only reshape what the builder actually produced: when the builder
 *   threw and there is no failed contract to work from, this generator
 *   declines (returns null) rather than synthesizing a contract from raw
 *   workspace inputs;
 * - the prompt forbids tool use — the repair is pure reasoning over the JSON
 *   in the prompt, no browsing, shell, or file access;
 * - raw normalized inputs are never sent, only the failed contract and the
 *   failure artifact.
 */

const REPAIR_GENERATOR_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["replacementContract", "summary", "explanation"],
  properties: {
    replacementContract: {
      type: "object",
      description: "The complete corrected contract, same shape as the failed contract."
    },
    summary: {
      type: "string",
      minLength: 1,
      description: "One sentence describing the repair."
    },
    explanation: {
      type: "string",
      minLength: 1,
      description: "Plain-language explanation of what was wrong and how the repair fixes it."
    }
  }
};

const CONTRACT_REPAIR_RULES = {
  next: [
    "The contract must keep non-empty string fields source, headline, and nextMove, and an object status with a string kind."
  ],
  daily: [
    "counts.itemCount must equal items.length exactly.",
    "user.id and user.label must be non-empty strings and generatedAt must be an ISO datetime."
  ],
  inbox: [
    "counts.itemCount must equal items.length exactly."
  ],
  agent_queue: [
    "You may ONLY drop or reorder entries in tasks and waiting. Never modify a task object and never add one that is not present, byte-for-byte, in the failed contract.",
    "count and itemCount must both equal tasks.length, and waitingCount must equal waiting.length.",
    "Every task with kind run_inbound_sync must keep a contractCommand starting with \"exo inbound sync \"."
  ]
};

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ runtime: "claude" | "codex", cli: string, fallback: { runtime: "codex", cli: string } | null } | null}
 */
export function resolveRepairGeneratorRuntime(env = process.env) {
  const requested = (env.EXO_REPAIR_GENERATOR ?? "").trim().toLowerCase();
  if (["off", "none", "0"].includes(requested)) {
    return null;
  }

  const claudeCli = (env.EXO_CLAUDE_CLI ?? "").trim() || "claude";
  const codexCli = resolveCodexCliCommand({ env });

  if (requested === "codex") {
    return { runtime: "codex", cli: codexCli, fallback: null };
  }
  if (requested === "claude") {
    return { runtime: "claude", cli: claudeCli, fallback: null };
  }
  // Default: claude first, codex as the not-installed fallback.
  return { runtime: "claude", cli: claudeCli, fallback: { runtime: "codex", cli: codexCli } };
}

/**
 * @param {{
 *   contractKind: string,
 *   failedContract: unknown,
 *   failureArtifact: unknown
 * }} context
 */
function buildRepairPrompt(context) {
  const rules = CONTRACT_REPAIR_RULES[/** @type {keyof typeof CONTRACT_REPAIR_RULES} */ (context.contractKind)] ?? [];
  return [
    `Exo (a governed GTM execution agent) built a structured "${context.contractKind}" contract that failed validation. Repair it.`,
    "",
    "Work ONLY from the JSON in this message. Do not use any tools, browsers, web search, shell commands, connectors, or files.",
    "",
    "The structured failure artifact (what validation rejected):",
    JSON.stringify(context.failureArtifact, null, 2),
    "",
    "The failed contract:",
    JSON.stringify(context.failedContract, null, 2),
    "",
    "Repair rules:",
    "- Return the COMPLETE corrected contract as replacementContract, in exactly the same shape.",
    "- Fix only what the failure artifact identifies. Leave every other field byte-identical.",
    "- Never invent data: every value in the replacement must come from the failed contract itself (fixing a count, removing a malformed entry, correcting an obviously wrong type). When in doubt, drop the broken entry and fix the counts.",
    ...rules.map((rule) => `- ${rule}`),
    "",
    "Return only JSON matching the provided schema: replacementContract, a one-sentence summary, and a plain-language explanation of what was wrong and what you changed."
  ].join("\n");
}

/**
 * @param {unknown} generated
 * @returns {{ replacementContract: unknown, summary: string, explanation: string } | null}
 */
function normalizeGeneratedRepair(generated) {
  if (!generated || typeof generated !== "object") {
    return null;
  }
  const candidate = /** @type {{ replacementContract?: unknown, summary?: unknown, explanation?: unknown }} */ (generated);
  if (candidate.replacementContract === undefined || candidate.replacementContract === null) {
    return null;
  }
  const summary = typeof candidate.summary === "string" ? candidate.summary.trim() : "";
  const explanation = typeof candidate.explanation === "string" ? candidate.explanation.trim() : "";
  if (!summary || !explanation) {
    return null;
  }
  return { replacementContract: candidate.replacementContract, summary, explanation };
}

/**
 * @param {{ cli: string, prompt: string, execFileImpl: typeof execFileAsync }} input
 */
async function generateThroughClaude(input) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(REPAIR_GENERATOR_OUTPUT_SCHEMA),
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    input.prompt
  ];
  const { stdout } = await input.execFileImpl(input.cli, args, {
    env: process.env,
    timeout: GENERATOR_TIMEOUT_MS,
    maxBuffer: GENERATOR_MAX_BUFFER
  });
  const parsed = JSON.parse(String(stdout));
  return normalizeGeneratedRepair(parsed?.structured_output);
}

/**
 * @param {{ cli: string, prompt: string, execFileImpl: typeof execFileAsync }} input
 */
async function generateThroughCodex(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-contract-repair-"));
  const schemaPath = path.join(tempDir, "repair-output.schema.json");
  const outputPath = path.join(tempDir, "repair-output.json");
  fs.writeFileSync(schemaPath, JSON.stringify(REPAIR_GENERATOR_OUTPUT_SCHEMA, null, 2));

  try {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ignore-rules",
      "--ephemeral",
      "--color",
      "never",
      "-C",
      tempDir,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      input.prompt
    ];
    await input.execFileImpl(input.cli, args, {
      cwd: tempDir,
      env: process.env,
      timeout: GENERATOR_TIMEOUT_MS,
      maxBuffer: GENERATOR_MAX_BUFFER
    });
    if (!fs.existsSync(outputPath)) {
      return null;
    }
    return normalizeGeneratedRepair(JSON.parse(fs.readFileSync(outputPath, "utf8")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** @param {unknown} error */
function isCliNotInstalled(error) {
  return /** @type {{ code?: string }} */ (error)?.code === "ENOENT";
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   execFileImpl?: typeof execFileAsync
 * }} [options]
 * @returns {((context: {
 *   contractKind: string,
 *   failedContract: unknown,
 *   failureArtifact: unknown,
 *   normalizedInputs: unknown
 * }) => Promise<{ replacementContract: unknown, summary: string, explanation: string } | null>) | null}
 */
export function createLlmRepairGenerator(options = {}) {
  const runtime = resolveRepairGeneratorRuntime(options.env ?? process.env);
  if (!runtime) {
    return null;
  }
  const execFileImpl = options.execFileImpl ?? execFileAsync;

  return async (context) => {
    // No failed contract means the builder threw: there is nothing safe to
    // reshape, and this generator never synthesizes contracts from raw inputs.
    if (context.failedContract === null || context.failedContract === undefined) {
      return null;
    }

    let failedContractJson;
    try {
      failedContractJson = JSON.stringify(context.failedContract);
    } catch {
      return null;
    }
    if (typeof failedContractJson !== "string" || Buffer.byteLength(failedContractJson, "utf8") > MAX_FAILED_CONTRACT_BYTES) {
      return null;
    }

    const prompt = buildRepairPrompt({
      contractKind: context.contractKind,
      failedContract: context.failedContract,
      failureArtifact: context.failureArtifact
    });

    /** @type {Array<{ runtime: "claude" | "codex", cli: string }>} */
    const attempts = [{ runtime: runtime.runtime, cli: runtime.cli }];
    if (runtime.fallback) {
      attempts.push(runtime.fallback);
    }

    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      try {
        return attempt.runtime === "claude"
          ? await generateThroughClaude({ cli: attempt.cli, prompt, execFileImpl })
          : await generateThroughCodex({ cli: attempt.cli, prompt, execFileImpl });
      } catch (error) {
        const hasFallback = index < attempts.length - 1;
        if (isCliNotInstalled(error) && hasFallback) {
          continue;
        }
        return null;
      }
    }
    return null;
  };
}
