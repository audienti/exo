// @ts-check

import crypto from "node:crypto";
import { EXO_VERSION } from "../lib/exo-version.js";
import { hashJsonStable, stableStringify } from "../lib/stable-hash.js";
import { STRUCTURED_CONTRACT_SCHEMAS } from "../schema/structured-contracts.js";
import {
  repairableContractKindSchema,
  repairFailureArtifactSchema
} from "../schema/contract-repair.js";
import {
  appendRepairNote,
  appendRepairRecord,
  appendRepairSubmission,
  findMatchingRepairRecord,
  loadActiveRepairRecords
} from "./contract-repair-store.js";

const REPAIR_EXPIRY_DAYS = 14;

/**
 * The repair layer is opt-in and fail-closed:
 * - Disabled (the default) it is fully inert — the builder output is returned
 *   untouched, with no validation, no store reads, and no behavior change.
 * - `EXO_DISABLE_REPAIR=1` is a hard kill switch that wins over everything.
 * - Enabled, a builder output that fails its contract gets exactly one repair
 *   attempt per invocation: an exact-match stored repair if one exists,
 *   otherwise one replacement from the injected repair generator. If the
 *   replacement fails validation too, the original failure is rethrown.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveRepairRuntimeConfig(env = process.env) {
  const killed = env.EXO_DISABLE_REPAIR === "1";
  const enabled = !killed && env.EXO_REPAIR_ENABLED === "1";
  const endpoint = typeof env.EXO_REPAIR_SUBMISSION_ENDPOINT === "string" && env.EXO_REPAIR_SUBMISSION_ENDPOINT.trim().length
    ? env.EXO_REPAIR_SUBMISSION_ENDPOINT.trim()
    : null;
  return {
    enabled,
    submitUpstream: enabled && env.EXO_REPAIR_SUBMIT_UPSTREAM === "1" && endpoint !== null,
    submissionEndpoint: endpoint
  };
}

export class ContractRepairError extends Error {
  /**
   * @param {string} message
   * @param {{ contractKind: string, fingerprint: string | null, failureArtifact: unknown, cause?: unknown }} details
   */
  constructor(message, details) {
    super(message);
    this.name = "ContractRepairError";
    this.contractKind = details.contractKind;
    this.fingerprint = details.fingerprint;
    this.failureArtifact = details.failureArtifact;
    this.cause = details.cause;
  }
}

/**
 * Postconditions a contract must satisfy beyond its schema. Keys are stable —
 * they feed the failure hash, so renaming one mints new fingerprints.
 *
 * @type {Record<string, Array<{ key: string, check: (contract: any) => boolean }>>}
 */
const CONTRACT_POSTCONDITIONS = {
  next: [],
  daily: [
    { key: "daily_count_matches_items", check: (contract) => contract.counts.itemCount === contract.items.length }
  ],
  inbox: [
    { key: "inbox_count_matches_items", check: (contract) => contract.counts.itemCount === contract.items.length }
  ],
  agent_queue: [
    { key: "queue_count_matches_tasks", check: (contract) => contract.count === contract.tasks.length && contract.itemCount === contract.tasks.length },
    { key: "queue_waiting_count_matches", check: (contract) => contract.waitingCount === contract.waiting.length },
    {
      key: "queue_sync_contract_commands_well_formed",
      check: (contract) => [...contract.tasks, ...contract.waiting].every((task) =>
        task.kind !== "run_inbound_sync" || (typeof task.contractCommand === "string" && /^exo inbound sync /.test(task.contractCommand))
      )
    }
  ]
};

/**
 * Extra postconditions that only apply to a repaired contract, checked against
 * the failed builder output it replaces. The agent_queue feeds the host pass
 * executor, so a repaired queue may only drop or reorder what the real
 * builder produced — never synthesize tasks or novel contract commands.
 *
 * @type {Record<string, Array<{ key: string, check: (repaired: any, failed: any) => boolean }>>}
 */
const REPAIRED_CONTRACT_POSTCONDITIONS = {
  next: [],
  daily: [],
  inbox: [],
  agent_queue: [
    {
      key: "queue_repair_subset_only",
      check: (repaired, failed) => {
        if (!failed || !Array.isArray(failed.tasks) || !Array.isArray(failed.waiting)) {
          return false;
        }
        const allowed = new Set(
          [...failed.tasks, ...failed.waiting]
            .map((task) => safeStableStringify(task))
            .filter((key) => key !== null)
        );
        return [...repaired.tasks, ...repaired.waiting].every((task) => {
          const key = safeStableStringify(task);
          return key !== null && allowed.has(key);
        });
      }
    }
  ]
};

/** @param {unknown} value */
function safeStableStringify(value) {
  try {
    return stableStringify(value);
  } catch {
    return null;
  }
}

/**
 * @param {string} contractKind
 * @param {unknown} contract
 * @param {unknown} failedContract The original failed output when validating a
 *   replacement; null when validating fresh builder output.
 * @returns {{ ok: true } | { ok: false, artifact: import("zod").infer<typeof repairFailureArtifactSchema> }}
 */
export function validateStructuredContract(contractKind, contract, failedContract = null) {
  const schema = STRUCTURED_CONTRACT_SCHEMAS[/** @type {keyof typeof STRUCTURED_CONTRACT_SCHEMAS} */ (contractKind)];
  const parsed = schema.safeParse(contract);
  if (!parsed.success) {
    return {
      ok: false,
      artifact: repairFailureArtifactSchema.parse({
        kind: "schema_validation",
        issues: parsed.error.issues.slice(0, 50).map((issue) => ({
          path: issue.path.length ? issue.path.join(".") : "(root)",
          code: issue.code,
          message: issue.message ?? null
        }))
      })
    };
  }

  const postconditions = [
    ...CONTRACT_POSTCONDITIONS[contractKind],
    ...(failedContract !== null ? REPAIRED_CONTRACT_POSTCONDITIONS[contractKind] : [])
  ];
  for (const postcondition of postconditions) {
    let holds = false;
    try {
      holds = failedContract !== null
        ? /** @type {(repaired: any, failed: any) => boolean} */ (postcondition.check)(parsed.data, failedContract)
        : postcondition.check(parsed.data);
    } catch {
      holds = false;
    }
    if (!holds) {
      return {
        ok: false,
        artifact: repairFailureArtifactSchema.parse({
          kind: "postcondition",
          postconditionKey: postcondition.key
        })
      };
    }
  }

  return { ok: true };
}

/**
 * @param {import("zod").infer<typeof repairFailureArtifactSchema>} artifact
 */
function hashFailureArtifact(artifact) {
  // Paths, codes, and postcondition keys only — never message text, so
  // run-specific details in messages do not mint new fingerprints.
  return hashJsonStable({
    kind: artifact.kind,
    issues: artifact.issues.map((issue) => ({ path: normalizeIssuePathForHash(issue.path), code: issue.code })),
    postconditionKey: artifact.postconditionKey,
    errorName: artifact.errorName
  });
}

/** @param {string} issuePath */
function normalizeIssuePathForHash(issuePath) {
  // tasks.3.kind and tasks.11.kind are the same failure shape.
  return issuePath.replace(/(^|\.)\d+(?=\.|$)/g, "$1*");
}

/**
 * Redaction before anything is persisted for upstream submission: every string
 * leaf is replaced with a salted sha256 marker. Structure, numbers, booleans,
 * and nulls survive so upstream triage can see the shape of the failure
 * without workspace content (names, emails, message bodies) leaving the
 * machine.
 *
 * @param {unknown} value
 * @returns {{ redacted: unknown, redactedFieldPaths: string[] }}
 */
export function redactForSubmission(value) {
  /** @type {string[]} */
  const redactedFieldPaths = [];

  /** @param {unknown} node @param {string} nodePath @returns {unknown} */
  const walk = (node, nodePath) => {
    if (typeof node === "string") {
      redactedFieldPaths.push(nodePath || "(root)");
      return `redacted:sha256:${crypto.createHash("sha256").update(node).digest("hex").slice(0, 16)}`;
    }
    if (Array.isArray(node)) {
      return node.map((entry, index) => walk(entry, nodePath ? `${nodePath}.${index}` : String(index)));
    }
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, entryValue]) => [key, walk(entryValue, nodePath ? `${nodePath}.${key}` : key)])
      );
    }
    return node;
  };

  return { redacted: walk(value, ""), redactedFieldPaths: redactedFieldPaths.slice(0, 2000) };
}

/**
 * Run a structured builder with the V1 self-repair harness around it.
 *
 * @param {{
 *   contractKind: import("zod").infer<typeof repairableContractKindSchema>,
 *   build: () => unknown,
 *   normalizedInputs: unknown,
 *   stateDir?: string | null,
 *   repairConfig?: { enabled: boolean, submitUpstream: boolean, submissionEndpoint: string | null } | null,
 *   repairGenerator?: ((context: {
 *     contractKind: string,
 *     failedContract: unknown,
 *     failureArtifact: unknown,
 *     normalizedInputs: unknown
 *   }) => Promise<{ replacementContract: unknown, summary: string, explanation: string } | null>) | null,
 *   exoVersion?: string,
 *   now?: string | null
 * }} input
 * @returns {Promise<{ contract: any, repair: null | import("zod").infer<typeof import("../schema/contract-repair.js").repairBlockSchema> }>}
 */
export async function executeRepairableContract(input) {
  const config = input.repairConfig ?? resolveRepairRuntimeConfig();
  if (!config.enabled) {
    // Fully inert: no validation, no store access, byte-identical output.
    return { contract: input.build(), repair: null };
  }

  const contractKind = repairableContractKindSchema.parse(input.contractKind);
  const exoVersion = input.exoVersion ?? EXO_VERSION;
  const now = input.now ?? new Date().toISOString();

  /** @type {import("zod").infer<typeof repairFailureArtifactSchema> | null} */
  let failureArtifact = null;
  /** @type {unknown} */
  let failedContract = null;
  /** @type {unknown} */
  let builderError = null;

  try {
    const contract = input.build();
    const validation = validateStructuredContract(contractKind, contract);
    if (validation.ok) {
      return { contract, repair: null };
    }
    failureArtifact = validation.artifact;
    failedContract = contract;
  } catch (error) {
    builderError = error;
    failureArtifact = repairFailureArtifactSchema.parse({
      kind: "builder_threw",
      errorName: error instanceof Error ? error.name : "UnknownError"
    });
  }

  const failClosed = (/** @type {string} */ message, /** @type {string | null} */ fingerprint) => {
    if (builderError) {
      throw builderError;
    }
    throw new ContractRepairError(message, {
      contractKind,
      fingerprint,
      failureArtifact,
      cause: builderError ?? undefined
    });
  };

  if (!input.stateDir) {
    failClosed(`The ${contractKind} contract failed validation and no repair store is available.`, null);
  }
  const stateDir = /** @type {string} */ (input.stateDir);

  const inputHash = hashJsonStable(input.normalizedInputs ?? null);
  const failureHash = hashFailureArtifact(/** @type {any} */ (failureArtifact));
  const exoVersionRange = { minimum: exoVersion, maximum: exoVersion };
  const fingerprint = hashJsonStable({ contractKind, exoVersionRange, failureHash });

  const records = loadActiveRepairRecords({ stateDir, exoVersion, now });
  const stored = findMatchingRepairRecord({ records, contractKind, inputHash, failureHash });

  /** @type {unknown} */
  let replacementContract = null;
  let summary = "";
  let explanation = "";
  let fromStore = false;

  if (stored) {
    replacementContract = stored.replacementContract;
    summary = stored.summary;
    fromStore = true;
  } else if (input.repairGenerator) {
    let generated = null;
    try {
      generated = await input.repairGenerator({
        contractKind,
        failedContract,
        failureArtifact,
        normalizedInputs: input.normalizedInputs ?? null
      });
    } catch {
      generated = null;
    }
    if (!generated || generated.replacementContract === undefined) {
      failClosed(`The ${contractKind} contract failed validation and the repair generator produced no replacement (fingerprint ${fingerprint}).`, fingerprint);
    }
    replacementContract = /** @type {{ replacementContract: unknown }} */ (generated).replacementContract;
    summary = /** @type {{ summary?: string }} */ (generated).summary?.trim()
      || `Temporary local repair for a failed ${contractKind} contract.`;
    explanation = /** @type {{ explanation?: string }} */ (generated).explanation?.trim() || summary;
  } else {
    failClosed(`The ${contractKind} contract failed validation and no matching local repair exists (fingerprint ${fingerprint}).`, fingerprint);
  }

  // One retry, validated as strictly as the original — including
  // repaired-only postconditions like the agent_queue subset rule.
  const revalidation = validateStructuredContract(contractKind, replacementContract, failedContract ?? { tasks: [], waiting: [] });
  if (!revalidation.ok) {
    failClosed(`The ${contractKind} repair candidate failed validation too (fingerprint ${fingerprint}); failing closed.`, fingerprint);
  }

  const failedContractHash = failedContract === null ? null : hashJsonStable(failedContract);
  const repairedContractHash = hashJsonStable(replacementContract);
  /** @type {string | null} */
  let submissionId = null;

  if (!fromStore) {
    submissionId = `repair-submission-${crypto.randomUUID()}`;
    const recordId = `repair-${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.parse(now) + REPAIR_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

    appendRepairRecord({
      stateDir,
      record: {
        id: recordId,
        fingerprint,
        contractKind,
        exoVersionRange,
        inputHash,
        failureHash,
        failureArtifact,
        replacementContract,
        failedContractHash,
        repairedContractHash,
        summary,
        createdAt: now,
        expiresAt,
        submissionId,
        submissionStatus: "pending"
      }
    });

    const redactedInputs = redactForSubmission(input.normalizedInputs ?? null);
    const redactedFailed = failedContract === null ? null : redactForSubmission(failedContract);
    const redactedRepaired = redactForSubmission(replacementContract);
    appendRepairSubmission({
      stateDir,
      submission: {
        submissionId,
        fingerprint,
        exoVersion,
        contractKind,
        inputHash,
        failureHash,
        failureArtifact,
        normalizedInputs: redactedInputs.redacted,
        failedContract: redactedFailed ? redactedFailed.redacted : null,
        repairedContract: redactedRepaired.redacted,
        redaction: {
          redactedFieldPaths: [
            ...redactedInputs.redactedFieldPaths.map((fieldPath) => `normalizedInputs.${fieldPath}`),
            ...(redactedFailed ? redactedFailed.redactedFieldPaths.map((fieldPath) => `failedContract.${fieldPath}`) : []),
            ...redactedRepaired.redactedFieldPaths.map((fieldPath) => `repairedContract.${fieldPath}`)
          ].slice(0, 2000),
          strategy: "hash"
        },
        explanation,
        createdAt: now,
        submittedAt: null,
        submissionStatus: config.submitUpstream ? "pending" : "disabled"
      }
    });

    // "When I fix it, I document what I did": one durable note per fix, in
    // the same shape the tool escalation surface uses for repair notes.
    appendRepairNote({
      stateDir,
      noteRecord: {
        id: `repair-note-${crypto.randomUUID()}`,
        contractKind,
        fingerprint,
        recordId,
        note: {
          createdAt: now,
          phase: "escalation",
          author: "agent",
          summary: buildRepairNoteSummary({ contractKind, failureArtifact, summary }),
          evidenceRefs: [
            { kind: "artifact", ref: `repair-overrides.jsonl#${recordId}`, surface: contractKind, capturedAt: now },
            { kind: "artifact", ref: `repair-submissions.jsonl#${submissionId}`, surface: contractKind, capturedAt: now }
          ],
          outcome: "continued"
        }
      }
    });
  } else {
    submissionId = stored?.submissionId ?? null;
  }

  return {
    contract: {
      ...(/** @type {Record<string, unknown>} */ (replacementContract)),
      repair: {
        applied: true,
        fingerprint,
        summary,
        failedContractHash,
        repairedContractHash,
        submissionId
      }
    },
    repair: {
      applied: true,
      fingerprint,
      summary,
      failedContractHash,
      repairedContractHash,
      submissionId
    }
  };
}

/**
 * One sentence of problem + one sentence of fix, readable without opening the
 * linked evidence artifacts.
 *
 * @param {{ contractKind: string, failureArtifact: any, summary: string }} input
 */
function buildRepairNoteSummary(input) {
  const artifact = input.failureArtifact ?? {};
  let failureDescription;
  if (artifact.kind === "builder_threw") {
    failureDescription = `the builder threw ${artifact.errorName ?? "an error"}`;
  } else if (artifact.kind === "postcondition") {
    failureDescription = `postcondition ${artifact.postconditionKey ?? "(unknown)"} failed`;
  } else {
    const paths = (artifact.issues ?? []).slice(0, 3).map((/** @type {{ path: string }} */ issue) => issue.path);
    failureDescription = paths.length
      ? `schema validation failed at ${paths.join(", ")}${(artifact.issues ?? []).length > 3 ? ", …" : ""}`
      : "schema validation failed";
  }
  return `The ${input.contractKind} contract broke (${failureDescription}). ${input.summary}`;
}

/**
 * Truthful operator messaging for a repaired contract. The submission line
 * only claims what actually happened.
 *
 * @param {{ contractKind: string, submitted: boolean }} input
 * @returns {string[]}
 */
export function buildRepairOperatorNotice(input) {
  return [
    `I couldn't build the ${input.contractKind} contract correctly.`,
    "I applied a temporary local repair so this run could continue.",
    input.submitted
      ? "I reported the failure upstream for a permanent fix in a future Exo version."
      : "The failure was recorded locally for a permanent fix in a future Exo version."
  ];
}
