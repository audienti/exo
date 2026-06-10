// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashJsonStable, stableStringify } from "../src/lib/stable-hash.js";
import {
  appendRepairRecord,
  compareExoVersions,
  findMatchingRepairRecord,
  gcContractRepairStore,
  loadActiveRepairRecords,
  loadRepairNotes,
  loadRepairSubmissions,
  resolveRepairStorePaths,
  updateRepairSubmissionStatus,
  versionRangeIncludes
} from "../src/core/contract-repair-store.js";
import {
  ContractRepairError,
  executeRepairableContract,
  redactForSubmission,
  resolveRepairRuntimeConfig,
  validateStructuredContract
} from "../src/core/execute-repairable-contract.js";
import { flushRepairSubmissions } from "../src/core/repair-submission-sender.js";

const NOW = "2026-06-09T12:00:00.000Z";

const ENABLED_CONFIG = { enabled: true, submitUpstream: false, submissionEndpoint: null };
const DISABLED_CONFIG = { enabled: false, submitUpstream: false, submissionEndpoint: null };

function makeTempStateDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `exo-contract-repair-${label}-`));
}

function validDailyContract() {
  return {
    user: { id: "user-1", label: "Repair User", owner: "william" },
    generatedAt: NOW,
    counts: { itemCount: 1 },
    capacity: { linkedin: null },
    items: [{ prospectName: "Alicia Buyer", priority: "action" }]
  };
}

function validQueueContract() {
  return {
    count: 2,
    itemCount: 2,
    waitingCount: 0,
    tasks: [
      { kind: "company_research", companyName: "Acme", briefCommand: "exo companies brief company-1" },
      { kind: "run_inbound_sync", contractCommand: "exo inbound sync linkedin-live user-1 --json" }
    ],
    waiting: [],
    blockers: []
  };
}

test("stableStringify is key-order independent and hashJsonStable matches", () => {
  const left = { b: 1, a: { d: [1, 2], c: "x" } };
  const right = { a: { c: "x", d: [1, 2] }, b: 1 };
  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(hashJsonStable(left), hashJsonStable(right));
  assert.notEqual(hashJsonStable(left), hashJsonStable({ ...left, b: 2 }));
});

test("compareExoVersions and versionRangeIncludes order numerically", () => {
  assert.equal(compareExoVersions("0.2.0", "0.10.0"), -1);
  assert.equal(compareExoVersions("0.2.0", "0.2.0"), 0);
  assert.equal(versionRangeIncludes({ minimum: "0.2.0", maximum: "0.2.0" }, "0.2.0"), true);
  assert.equal(versionRangeIncludes({ minimum: "0.2.0", maximum: "0.2.0" }, "0.2.1"), false);
});

test("validateStructuredContract enforces schema and postconditions", () => {
  assert.equal(validateStructuredContract("daily", validDailyContract()).ok, true);

  const missingUser = validateStructuredContract("daily", { ...validDailyContract(), user: null });
  assert.equal(missingUser.ok, false);
  assert.equal(missingUser.artifact.kind, "schema_validation");

  const badCounts = validateStructuredContract("daily", { ...validDailyContract(), counts: { itemCount: 5 } });
  assert.equal(badCounts.ok, false);
  assert.equal(badCounts.artifact.kind, "postcondition");
  assert.equal(badCounts.artifact.postconditionKey, "daily_count_matches_items");

  const malformedSyncCommand = validQueueContract();
  malformedSyncCommand.tasks[1].contractCommand = "rm -rf /";
  const badQueue = validateStructuredContract("agent_queue", malformedSyncCommand);
  assert.equal(badQueue.ok, false);
  assert.equal(badQueue.artifact.postconditionKey, "queue_sync_contract_commands_well_formed");
});

test("repair store appends, filters by version and expiry, and garbage-collects", () => {
  const stateDir = makeTempStateDir("store");
  try {
    const baseRecord = {
      id: "repair-1",
      fingerprint: "fp-1",
      contractKind: "daily",
      exoVersionRange: { minimum: "0.2.0", maximum: "0.2.0" },
      inputHash: "in-1",
      failureHash: "fail-1",
      failureArtifact: { kind: "postcondition", postconditionKey: "daily_count_matches_items" },
      replacementContract: validDailyContract(),
      failedContractHash: null,
      repairedContractHash: "out-1",
      summary: "Recomputed the daily counts.",
      createdAt: NOW,
      expiresAt: "2026-06-23T12:00:00.000Z",
      submissionId: null,
      submissionStatus: "pending"
    };
    appendRepairRecord({ stateDir, record: baseRecord });
    appendRepairRecord({ stateDir, record: { ...baseRecord, id: "repair-2", fingerprint: "fp-2", expiresAt: "2026-06-01T12:00:00.000Z" } });

    const active = loadActiveRepairRecords({ stateDir, exoVersion: "0.2.0", now: NOW });
    assert.deepEqual(active.map((record) => record.id), ["repair-1"]);
    assert.equal(loadActiveRepairRecords({ stateDir, exoVersion: "0.2.1", now: NOW }).length, 0);

    assert.equal(findMatchingRepairRecord({ records: active, contractKind: "daily", inputHash: "in-1", failureHash: "fail-1" })?.id, "repair-1");
    assert.equal(findMatchingRepairRecord({ records: active, contractKind: "daily", inputHash: "other", failureHash: "fail-1" }), null);

    const gc = gcContractRepairStore({ stateDir, exoVersion: "0.2.0", now: "2026-08-01T12:00:00.000Z", retentionDays: 30 });
    assert.equal(gc.recordsRemoved, 2);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("executeRepairableContract is fully inert when repair is disabled", async () => {
  const stateDir = makeTempStateDir("inert-disabled");
  try {
    const broken = { not: "a daily contract at all" };
    const result = await executeRepairableContract({
      contractKind: "daily",
      build: () => broken,
      normalizedInputs: { anything: true },
      stateDir,
      repairConfig: DISABLED_CONFIG
    });
    assert.equal(result.contract, broken);
    assert.equal(result.repair, null);
    const { overridesPath, submissionsPath } = resolveRepairStorePaths(stateDir);
    assert.equal(fs.existsSync(overridesPath), false);
    assert.equal(fs.existsSync(submissionsPath), false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("executeRepairableContract passes valid output through untouched when enabled", async () => {
  const stateDir = makeTempStateDir("inert-valid");
  try {
    const contract = validDailyContract();
    const result = await executeRepairableContract({
      contractKind: "daily",
      build: () => contract,
      normalizedInputs: { anything: true },
      stateDir,
      repairConfig: ENABLED_CONFIG,
      repairGenerator: async () => {
        throw new Error("generator must not run for valid output");
      },
      now: NOW
    });
    assert.equal(result.contract, contract);
    assert.equal(result.repair, null);
    const { overridesPath, submissionsPath } = resolveRepairStorePaths(stateDir);
    assert.equal(fs.existsSync(overridesPath), false);
    assert.equal(fs.existsSync(submissionsPath), false);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("executeRepairableContract fails closed with a fingerprint when no repair exists", async () => {
  const stateDir = makeTempStateDir("fail-closed");
  try {
    await assert.rejects(
      executeRepairableContract({
        contractKind: "daily",
        build: () => ({ ...validDailyContract(), counts: { itemCount: 99 } }),
        normalizedInputs: { seed: 1 },
        stateDir,
        repairConfig: ENABLED_CONFIG,
        now: NOW
      }),
      (error) => {
        assert.ok(error instanceof ContractRepairError);
        assert.equal(error.contractKind, "daily");
        assert.match(String(error.fingerprint), /^[0-9a-f]{64}$/);
        return true;
      }
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("executeRepairableContract rethrows the original error when the builder throws and no repair exists", async () => {
  const stateDir = makeTempStateDir("builder-threw");
  try {
    const boom = new TypeError("builder exploded");
    await assert.rejects(
      executeRepairableContract({
        contractKind: "inbox",
        build: () => {
          throw boom;
        },
        normalizedInputs: { seed: 2 },
        stateDir,
        repairConfig: ENABLED_CONFIG,
        now: NOW
      }),
      (error) => error === boom
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a generated repair is applied once, persisted, and spooled with redaction", async () => {
  const stateDir = makeTempStateDir("golden-daily");
  try {
    const failed = { ...validDailyContract(), counts: { itemCount: 99 } };
    const repairedDaily = validDailyContract();
    let generatorCalls = 0;

    const result = await executeRepairableContract({
      contractKind: "daily",
      build: () => failed,
      normalizedInputs: { rawUser: { id: "user-1", label: "Repair User" }, prospectEmail: "alicia@buyer.example" },
      stateDir,
      repairConfig: ENABLED_CONFIG,
      repairGenerator: async (context) => {
        generatorCalls += 1;
        assert.equal(context.contractKind, "daily");
        assert.equal(context.failureArtifact.postconditionKey, "daily_count_matches_items");
        return {
          replacementContract: repairedDaily,
          summary: "Recomputed itemCount from the items array.",
          explanation: "counts.itemCount disagreed with items.length; recomputed it."
        };
      },
      exoVersion: "0.2.0",
      now: NOW
    });

    assert.equal(generatorCalls, 1);
    assert.equal(result.repair?.applied, true);
    assert.equal(result.contract.counts.itemCount, 1);
    assert.equal(result.contract.repair.applied, true);
    assert.equal(result.contract.repair.summary, "Recomputed itemCount from the items array.");
    assert.match(result.contract.repair.fingerprint, /^[0-9a-f]{64}$/);

    const records = loadActiveRepairRecords({ stateDir, exoVersion: "0.2.0", now: NOW });
    assert.equal(records.length, 1);
    assert.equal(records[0].contractKind, "daily");
    assert.deepEqual(records[0].exoVersionRange, { minimum: "0.2.0", maximum: "0.2.0" });

    const submissions = loadRepairSubmissions({ stateDir });
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].submissionStatus, "disabled");
    const submissionText = JSON.stringify(submissions[0].normalizedInputs) + JSON.stringify(submissions[0].repairedContract);
    assert.ok(!submissionText.includes("alicia@buyer.example"));
    assert.ok(!submissionText.includes("Repair User"));
    assert.ok(submissions[0].redaction.redactedFieldPaths.length > 0);

    // "When I fix it, I document what I did": one repair note in the shared
    // toolRepairNoteSchema shape, linked to the override record by evidence.
    const notes = loadRepairNotes({ stateDir });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].contractKind, "daily");
    assert.equal(notes[0].fingerprint, result.contract.repair.fingerprint);
    assert.equal(notes[0].recordId, records[0].id);
    assert.equal(notes[0].note.author, "agent");
    assert.equal(notes[0].note.phase, "escalation");
    assert.equal(notes[0].note.outcome, "continued");
    assert.match(notes[0].note.summary, /daily contract broke/);
    assert.match(notes[0].note.summary, /daily_count_matches_items/);
    assert.match(notes[0].note.summary, /Recomputed itemCount from the items array\./);
    const evidenceRefs = notes[0].note.evidenceRefs.map((/** @type {{ ref: string }} */ evidence) => evidence.ref);
    assert.ok(evidenceRefs.includes(`repair-overrides.jsonl#${records[0].id}`));
    assert.ok(evidenceRefs.includes(`repair-submissions.jsonl#${submissions[0].submissionId}`));

    // Same failure + same input in a later invocation: the stored repair
    // applies without a generator.
    const replayed = await executeRepairableContract({
      contractKind: "daily",
      build: () => failed,
      normalizedInputs: { rawUser: { id: "user-1", label: "Repair User" }, prospectEmail: "alicia@buyer.example" },
      stateDir,
      repairConfig: ENABLED_CONFIG,
      exoVersion: "0.2.0",
      now: NOW
    });
    assert.equal(replayed.repair?.applied, true);
    assert.equal(replayed.contract.counts.itemCount, 1);
    assert.equal(loadRepairSubmissions({ stateDir }).length, 1, "a replayed stored repair must not spool a duplicate submission");
    assert.equal(loadRepairNotes({ stateDir }).length, 1, "a replayed stored repair must not write a duplicate note");
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a stored repair is ignored after a version bump", async () => {
  const stateDir = makeTempStateDir("upgrade");
  try {
    const failed = { ...validDailyContract(), counts: { itemCount: 99 } };
    const sharedInput = { seed: "upgrade" };
    await executeRepairableContract({
      contractKind: "daily",
      build: () => failed,
      normalizedInputs: sharedInput,
      stateDir,
      repairConfig: ENABLED_CONFIG,
      repairGenerator: async () => ({
        replacementContract: validDailyContract(),
        summary: "fixed counts",
        explanation: "fixed counts"
      }),
      exoVersion: "0.2.0",
      now: NOW
    });

    // Same failure on the upgraded version: the 0.2.0-bounded repair must be
    // ignored and the run fails closed (no generator available this time).
    await assert.rejects(
      executeRepairableContract({
        contractKind: "daily",
        build: () => failed,
        normalizedInputs: sharedInput,
        stateDir,
        repairConfig: ENABLED_CONFIG,
        exoVersion: "0.2.1",
        now: NOW
      }),
      ContractRepairError
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("the repair generator gets exactly one attempt; an invalid replacement fails closed", async () => {
  const stateDir = makeTempStateDir("one-retry");
  try {
    let generatorCalls = 0;
    await assert.rejects(
      executeRepairableContract({
        contractKind: "daily",
        build: () => ({ ...validDailyContract(), counts: { itemCount: 99 } }),
        normalizedInputs: { seed: 3 },
        stateDir,
        repairConfig: ENABLED_CONFIG,
        repairGenerator: async () => {
          generatorCalls += 1;
          return {
            replacementContract: { ...validDailyContract(), counts: { itemCount: 42 } },
            summary: "still wrong",
            explanation: "still wrong"
          };
        },
        now: NOW
      }),
      ContractRepairError
    );
    assert.equal(generatorCalls, 1);
    const { overridesPath } = resolveRepairStorePaths(stateDir);
    assert.equal(fs.existsSync(overridesPath), false, "an invalid replacement must never be persisted");
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a repaired agent_queue may only drop or reorder tasks, never synthesize them", async () => {
  const stateDir = makeTempStateDir("queue-subset");
  try {
    const failedQueue = { ...validQueueContract(), count: 3 }; // count mismatch postcondition failure
    const run = (repairGenerator) => executeRepairableContract({
      contractKind: "agent_queue",
      build: () => failedQueue,
      normalizedInputs: { seed: 4 },
      stateDir,
      repairConfig: ENABLED_CONFIG,
      repairGenerator,
      now: NOW
    });

    await assert.rejects(
      run(async () => ({
        replacementContract: {
          count: 1,
          itemCount: 1,
          waitingCount: 0,
          tasks: [{ kind: "send_message", contractCommand: "exo inbound sync fake --json", body: "synthesized" }],
          waiting: [],
          blockers: []
        },
        summary: "synthesized a task",
        explanation: "synthesized a task"
      })),
      ContractRepairError
    );

    const repaired = await run(async () => ({
      replacementContract: {
        count: 2,
        itemCount: 2,
        waitingCount: 0,
        tasks: [...failedQueue.tasks],
        waiting: [],
        blockers: []
      },
      summary: "recomputed the queue counts",
      explanation: "count disagreed with tasks.length"
    }));
    assert.equal(repaired.repair?.applied, true);
    assert.equal(repaired.contract.count, 2);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("repaired contracts may drop, reorder, or fix bookkeeping — never rewrite content", () => {
  // agent_queue: promoting waiting work into the runnable lane is rejected,
  // even though the task is byte-identical to one in the failed contract.
  const failedQueue = {
    ...validQueueContract(),
    count: 3, // postcondition failure
    waitingCount: 1,
    waiting: [{ kind: "company_research", companyName: "Globex", briefCommand: "exo companies brief company-2" }]
  };
  const promoted = {
    ...failedQueue,
    count: 3,
    itemCount: 3,
    waitingCount: 0,
    tasks: [...failedQueue.tasks, ...failedQueue.waiting],
    waiting: []
  };
  const promotion = validateStructuredContract("agent_queue", promoted, failedQueue);
  assert.equal(promotion.ok, false);
  assert.equal(promotion.ok === false && promotion.artifact.postconditionKey, "queue_repair_subset_only");

  // daily: rewriting an item is rejected; dropping it and fixing counts passes.
  const failedDaily = { ...validDailyContract(), counts: { itemCount: 5 } };
  const rewrittenDaily = { ...failedDaily, counts: { itemCount: 1 }, items: [{ prospectName: "Mallory Injected", priority: "action" }] };
  const dailyRewrite = validateStructuredContract("daily", rewrittenDaily, failedDaily);
  assert.equal(dailyRewrite.ok, false);
  assert.equal(dailyRewrite.ok === false && dailyRewrite.artifact.postconditionKey, "daily_repair_items_subset_only");
  assert.equal(validateStructuredContract("daily", { ...failedDaily, counts: { itemCount: 0 }, items: [] }, failedDaily).ok, true);

  // inbox: same subset rule.
  const failedInbox = { user: { id: "u1", label: "Op" }, counts: { itemCount: 9 }, surfaces: {}, items: [{ subject: "Re: pricing" }] };
  const inboxRewrite = validateStructuredContract("inbox", { ...failedInbox, counts: { itemCount: 1 }, items: [{ subject: "Injected" }] }, failedInbox);
  assert.equal(inboxRewrite.ok, false);
  assert.equal(inboxRewrite.ok === false && inboxRewrite.artifact.postconditionKey, "inbox_repair_items_subset_only");

  // next: operator guidance that was already valid must survive byte-identical.
  const failedNext = {
    source: "pipeline",
    headline: "Follow up with Acme",
    nextMove: "Send the proposal recap to Alicia.",
    status: { kind: "ready" },
    guidance: null,
    context: { extra: true }
  };
  const nextRewrite = validateStructuredContract("next", { ...failedNext, nextMove: "Do something else entirely." }, failedNext);
  assert.equal(nextRewrite.ok, false);
  assert.equal(nextRewrite.ok === false && nextRewrite.artifact.postconditionKey, "next_repair_preserves_valid_fields");
  assert.equal(
    validateStructuredContract("next", failedNext, { ...failedNext, headline: "" }).ok,
    true,
    "a repair may fill a field that was invalid in the failed contract"
  );

  // With no baseline (builder threw → {} sentinel), structural repairs fail closed.
  assert.equal(validateStructuredContract("daily", validDailyContract(), {}).ok, false);
  assert.equal(validateStructuredContract("agent_queue", validQueueContract(), {}).ok, false);
});

test("redactForSubmission hashes every string leaf and records the paths", () => {
  const { redacted, redactedFieldPaths } = redactForSubmission({
    name: "Alicia Buyer",
    nested: { email: "alicia@buyer.example", count: 3, flag: true, nothing: null },
    list: ["LinkedIn message body"]
  });
  const text = JSON.stringify(redacted);
  assert.ok(!text.includes("Alicia"));
  assert.ok(!text.includes("alicia@buyer.example"));
  assert.ok(!text.includes("LinkedIn message body"));
  assert.equal(/** @type {any} */ (redacted).nested.count, 3);
  assert.equal(/** @type {any} */ (redacted).nested.flag, true);
  assert.equal(/** @type {any} */ (redacted).nested.nothing, null);
  assert.deepEqual(redactedFieldPaths.sort(), ["list.0", "name", "nested.email"]);
});

test("resolveRepairRuntimeConfig honors the kill switch and endpoint gating", () => {
  assert.deepEqual(resolveRepairRuntimeConfig({}), { enabled: false, submitUpstream: false, submissionEndpoint: null });
  assert.equal(resolveRepairRuntimeConfig({ EXO_REPAIR_ENABLED: "1" }).enabled, true);
  assert.equal(resolveRepairRuntimeConfig({ EXO_REPAIR_ENABLED: "1", EXO_DISABLE_REPAIR: "1" }).enabled, false);
  assert.equal(
    resolveRepairRuntimeConfig({ EXO_REPAIR_ENABLED: "1", EXO_REPAIR_SUBMIT_UPSTREAM: "1" }).submitUpstream,
    false,
    "submission requires an endpoint"
  );
  const full = resolveRepairRuntimeConfig({
    EXO_REPAIR_ENABLED: "1",
    EXO_REPAIR_SUBMIT_UPSTREAM: "1",
    EXO_REPAIR_SUBMISSION_ENDPOINT: "https://repairs.example/intake"
  });
  assert.deepEqual(full, { enabled: true, submitUpstream: true, submissionEndpoint: "https://repairs.example/intake" });
});

test("flushRepairSubmissions is endpoint-optional and retries failed pushes later", async () => {
  const stateDir = makeTempStateDir("sender");
  try {
    const failed = { ...validDailyContract(), counts: { itemCount: 99 } };
    await executeRepairableContract({
      contractKind: "daily",
      build: () => failed,
      normalizedInputs: { seed: 5 },
      stateDir,
      repairConfig: { enabled: true, submitUpstream: true, submissionEndpoint: "https://repairs.example/intake" },
      repairGenerator: async () => ({
        replacementContract: validDailyContract(),
        summary: "fixed counts",
        explanation: "fixed counts"
      }),
      now: NOW
    });

    const noop = await flushRepairSubmissions({
      stateDir,
      config: { submitUpstream: false, submissionEndpoint: null }
    });
    assert.deepEqual(noop, { attempted: 0, submitted: 0, failed: 0 });

    const seenRequests = [];
    const failedFlush = await flushRepairSubmissions({
      stateDir,
      config: { submitUpstream: true, submissionEndpoint: "https://repairs.example/intake" },
      httpPostImpl: async (url, headers, bodyText) => {
        seenRequests.push({ url, contentType: headers["content-type"], body: JSON.parse(bodyText) });
        return { status: 503 };
      },
      now: NOW
    });
    assert.deepEqual(failedFlush, { attempted: 1, submitted: 0, failed: 1 });
    assert.equal(loadRepairSubmissions({ stateDir })[0].submissionStatus, "pending");

    const okFlush = await flushRepairSubmissions({
      stateDir,
      config: { submitUpstream: true, submissionEndpoint: "https://repairs.example/intake" },
      httpPostImpl: async () => ({ status: 202 }),
      now: NOW
    });
    assert.deepEqual(okFlush, { attempted: 1, submitted: 1, failed: 0 });
    const settled = loadRepairSubmissions({ stateDir })[0];
    assert.equal(settled.submissionStatus, "submitted");
    assert.equal(settled.submittedAt, NOW);
    assert.equal(seenRequests[0].url, "https://repairs.example/intake");
    assert.equal(seenRequests[0].body.contractKind, "daily");

    const idleFlush = await flushRepairSubmissions({
      stateDir,
      config: { submitUpstream: true, submissionEndpoint: "https://repairs.example/intake" },
      httpPostImpl: async () => {
        throw new Error("must not be called: nothing pending");
      }
    });
    assert.deepEqual(idleFlush, { attempted: 0, submitted: 0, failed: 0 });

    const status = updateRepairSubmissionStatus({ stateDir, submissionId: settled.submissionId, submissionStatus: "submitted" });
    assert.equal(status?.submissionStatus, "submitted");
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
