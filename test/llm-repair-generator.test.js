// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createLlmRepairGenerator,
  resolveRepairGeneratorRuntime
} from "../src/core/llm-repair-generator.js";

const FAILURE_ARTIFACT = {
  kind: "postcondition",
  issues: [],
  postconditionKey: "daily_count_matches_items",
  errorName: null
};

function failedDailyContract() {
  return {
    user: { id: "user-1", label: "Repair User" },
    generatedAt: "2026-06-09T12:00:00.000Z",
    counts: { itemCount: 99 },
    capacity: {},
    items: [{ prospectName: "Alicia Buyer" }]
  };
}

/** What the CLI runtimes emit: the contract JSON-encoded as a string. */
function repairedDailyPayload() {
  return {
    replacementContractJson: JSON.stringify({ ...failedDailyContract(), counts: { itemCount: 1 } }),
    summary: "Recomputed itemCount from the items array.",
    explanation: "counts.itemCount disagreed with items.length; recomputed it."
  };
}

/** What the generator returns to the executor: the contract parsed back. */
function expectedDailyRepair() {
  return {
    replacementContract: { ...failedDailyContract(), counts: { itemCount: 1 } },
    summary: "Recomputed itemCount from the items array.",
    explanation: "counts.itemCount disagreed with items.length; recomputed it."
  };
}

/** Claude CLI `--output-format json` envelope. */
function claudeStdout(structuredOutput) {
  return JSON.stringify({ type: "result", structured_output: structuredOutput });
}

test("resolveRepairGeneratorRuntime honors EXO_REPAIR_GENERATOR", () => {
  assert.equal(resolveRepairGeneratorRuntime({ EXO_REPAIR_GENERATOR: "off" }), null);
  assert.equal(resolveRepairGeneratorRuntime({ EXO_REPAIR_GENERATOR: "none" }), null);
  assert.equal(resolveRepairGeneratorRuntime({ EXO_REPAIR_GENERATOR: "0" }), null);

  const claudeOnly = resolveRepairGeneratorRuntime({ EXO_REPAIR_GENERATOR: "claude", EXO_CLAUDE_CLI: "/opt/claude" });
  assert.deepEqual(claudeOnly, { runtime: "claude", cli: "/opt/claude", fallback: null });

  const codexOnly = resolveRepairGeneratorRuntime({ EXO_REPAIR_GENERATOR: "codex", EXO_CODEX_CLI: "/opt/codex" });
  assert.deepEqual(codexOnly, { runtime: "codex", cli: "/opt/codex", fallback: null });

  const auto = resolveRepairGeneratorRuntime({ EXO_CODEX_CLI: "/opt/codex" });
  assert.equal(auto?.runtime, "claude");
  assert.equal(auto?.cli, "claude");
  assert.deepEqual(auto?.fallback, { runtime: "codex", cli: "/opt/codex" });

  assert.equal(createLlmRepairGenerator({ env: { EXO_REPAIR_GENERATOR: "off" } }), null);
});

test("the claude runtime repairs from the failed contract and failure artifact only", async () => {
  /** @type {Array<{ cli: string, args: string[], options: any }>} */
  const calls = [];
  const generator = createLlmRepairGenerator({
    env: { EXO_REPAIR_GENERATOR: "claude", EXO_CLAUDE_CLI: "claude-test" },
    execFileImpl: /** @type {any} */ (async (cli, args, options) => {
      calls.push({ cli, args, options });
      return { stdout: claudeStdout(repairedDailyPayload()), stderr: "" };
    })
  });
  assert.ok(generator);

  const generated = await generator({
    contractKind: "daily",
    failedContract: failedDailyContract(),
    failureArtifact: FAILURE_ARTIFACT,
    normalizedInputs: { secretWorkspaceBlob: "must-not-be-sent" }
  });

  assert.deepEqual(generated, expectedDailyRepair());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cli, "claude-test");
  assert.ok(calls[0].args.includes("-p"));
  assert.ok(calls[0].args.includes("--json-schema"));
  assert.equal(calls[0].args[calls[0].args.indexOf("--tools") + 1], "", "all built-in tools must be disabled");
  assert.ok(calls[0].args.includes("--strict-mcp-config"), "configured MCP servers must be ignored");
  assert.equal(calls[0].options.timeout, 180000);

  const prompt = calls[0].args[calls[0].args.length - 1];
  assert.match(prompt, /"daily" contract that failed validation/);
  assert.match(prompt, /daily_count_matches_items/);
  assert.match(prompt, /Alicia Buyer/, "the failed contract itself is in the prompt");
  assert.ok(!prompt.includes("must-not-be-sent"), "raw normalized inputs must never reach the generator prompt");
  assert.match(prompt, /Do not use any tools/);
});

test("EXO_REPAIR_GENERATOR_TIMEOUT_MS overrides the CLI timeout", async () => {
  /** @type {any} */
  let seenOptions = null;
  const generator = createLlmRepairGenerator({
    env: { EXO_REPAIR_GENERATOR: "claude", EXO_REPAIR_GENERATOR_TIMEOUT_MS: "5000" },
    execFileImpl: /** @type {any} */ (async (cli, args, options) => {
      seenOptions = options;
      return { stdout: claudeStdout(repairedDailyPayload()), stderr: "" };
    })
  });
  assert.ok(generator);
  await generator({
    contractKind: "daily",
    failedContract: failedDailyContract(),
    failureArtifact: FAILURE_ARTIFACT,
    normalizedInputs: {}
  });
  assert.equal(seenOptions.timeout, 5000);
});

test("the generator declines when the builder threw and produced no contract", async () => {
  let execCalls = 0;
  const generator = createLlmRepairGenerator({
    env: { EXO_REPAIR_GENERATOR: "claude" },
    execFileImpl: /** @type {any} */ (async () => {
      execCalls += 1;
      return { stdout: claudeStdout(repairedDailyPayload()), stderr: "" };
    })
  });
  assert.ok(generator);

  const generated = await generator({
    contractKind: "daily",
    failedContract: null,
    failureArtifact: { kind: "builder_threw", issues: [], postconditionKey: null, errorName: "TypeError" },
    normalizedInputs: {}
  });

  assert.equal(generated, null);
  assert.equal(execCalls, 0, "no CLI run when there is nothing safe to reshape");
});

test("a broken claude CLI falls back to codex in auto mode only", async () => {
  const claudeFailureModes = {
    // not installed
    not_installed: async () => {
      throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    },
    // installed but unauthenticated: exits 0 with an error envelope and no
    // structured_output (observed live with an expired claude login)
    unauthenticated: async () => ({
      stdout: JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Failed to authenticate. API Error: 401" }),
      stderr: ""
    })
  };

  for (const [mode, claudeBehavior] of Object.entries(claudeFailureModes)) {
    /** @type {string[]} */
    const cliOrder = [];
    /** @type {string[]} */
    let codexArgs = [];
    const autoGenerator = createLlmRepairGenerator({
      env: { EXO_CODEX_CLI: "codex-test" },
      execFileImpl: /** @type {any} */ (async (cli, args) => {
        cliOrder.push(cli);
        if (cli === "claude") {
          return claudeBehavior();
        }
        // codex writes its result to the -o output path
        codexArgs = args;
        const outputPath = args[args.indexOf("-o") + 1];
        fs.writeFileSync(outputPath, JSON.stringify(repairedDailyPayload()));
        return { stdout: "", stderr: "" };
      })
    });
    assert.ok(autoGenerator);

    const generated = await autoGenerator({
      contractKind: "daily",
      failedContract: failedDailyContract(),
      failureArtifact: FAILURE_ARTIFACT,
      normalizedInputs: {}
    });
    assert.deepEqual(generated, expectedDailyRepair(), `claude ${mode} must fall back to codex`);
    assert.deepEqual(cliOrder, ["claude", "codex-test"], `claude ${mode} must try claude first, then codex`);
    assert.equal(codexArgs[codexArgs.indexOf("--sandbox") + 1], "read-only", "codex must run in a read-only sandbox");
  }

  const enoent = Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });

  // Explicitly pinned to claude: ENOENT fails closed instead of falling back.
  const pinnedGenerator = createLlmRepairGenerator({
    env: { EXO_REPAIR_GENERATOR: "claude" },
    execFileImpl: /** @type {any} */ (async () => {
      throw enoent;
    })
  });
  assert.ok(pinnedGenerator);
  assert.equal(
    await pinnedGenerator({
      contractKind: "daily",
      failedContract: failedDailyContract(),
      failureArtifact: FAILURE_ARTIFACT,
      normalizedInputs: {}
    }),
    null
  );
});

test("CLI failures and malformed output resolve to null, never throw", async () => {
  const cases = [
    // non-ENOENT CLI failure
    async () => {
      throw new Error("claude exited 1");
    },
    // stdout is not JSON
    async () => ({ stdout: "garbage", stderr: "" }),
    // missing structured_output
    async () => ({ stdout: JSON.stringify({ type: "result" }), stderr: "" }),
    // structured_output missing required fields
    async () => ({ stdout: claudeStdout({ replacementContractJson: JSON.stringify({ ok: true }), summary: "", explanation: "" }), stderr: "" }),
    // replacement contract is not valid JSON
    async () => ({ stdout: claudeStdout({ replacementContractJson: "{not json", summary: "s", explanation: "e" }), stderr: "" }),
    // replacement contract is not an object
    async () => ({ stdout: claudeStdout({ replacementContractJson: "42", summary: "s", explanation: "e" }), stderr: "" })
  ];

  for (const execFileImpl of cases) {
    const generator = createLlmRepairGenerator({
      env: { EXO_REPAIR_GENERATOR: "claude" },
      execFileImpl: /** @type {any} */ (execFileImpl)
    });
    assert.ok(generator);
    assert.equal(
      await generator({
        contractKind: "daily",
        failedContract: failedDailyContract(),
        failureArtifact: FAILURE_ARTIFACT,
        normalizedInputs: {}
      }),
      null
    );
  }
});

test("an oversized failed contract fails closed without invoking a CLI", async () => {
  let execCalls = 0;
  const generator = createLlmRepairGenerator({
    env: { EXO_REPAIR_GENERATOR: "claude" },
    execFileImpl: /** @type {any} */ (async () => {
      execCalls += 1;
      return { stdout: claudeStdout(repairedDailyPayload()), stderr: "" };
    })
  });
  assert.ok(generator);

  const generated = await generator({
    contractKind: "daily",
    failedContract: { blob: "x".repeat(500 * 1024) },
    failureArtifact: FAILURE_ARTIFACT,
    normalizedInputs: {}
  });
  assert.equal(generated, null);
  assert.equal(execCalls, 0);
});
