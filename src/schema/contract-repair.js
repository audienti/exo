// @ts-check

import { z } from "zod";

/**
 * Contract self-repair (V1).
 *
 * Scope: read/planner/queue structured contracts only. No live send, capture,
 * or writeback self-repair.
 *
 * Fingerprint semantics:
 * - `fingerprint` is the dedupe/clustering key: hash of
 *   contractKind + exoVersionRange + failureHash. It identifies "the same
 *   failure", not "the same input".
 * - `inputHash` gates re-apply only: a stored replacement contract is a
 *   concrete payload generated for one exact input, so it may only be
 *   re-applied when the input hashes identically. Across invocations that
 *   rarely happens — the local override store is primarily an audit log and
 *   upstream-submission deduper, not a recurring-repair cache.
 * - `failureHash` is computed from normalized failure structure (error paths
 *   and codes), never raw message text, so timestamps and ids in messages do
 *   not mint new fingerprints.
 */

export const repairableContractKindSchema = z.enum([
  "next",
  "daily",
  "inbox",
  "agent_queue"
]);

/**
 * V1 repairs are exact-match and version-bounded. Both bounds are inclusive;
 * V1 writers set minimum == maximum == EXO_VERSION at creation time. On
 * startup, repairs whose range does not include the running EXO_VERSION are
 * ignored immediately and garbage-collected after retention.
 */
export const repairVersionRangeSchema = z.object({
  minimum: z.string().trim().min(1),
  maximum: z.string().trim().min(1)
});

export const repairSubmissionStatusSchema = z.enum([
  "pending",
  "submitted",
  "failed",
  "disabled"
]);

/**
 * Normalized failure artifact captured when a structured builder's output
 * fails schema or postcondition validation. Paths and codes only — free-text
 * messages are retained locally for the operator but excluded from
 * `failureHash`.
 */
export const repairFailureArtifactSchema = z.object({
  kind: z.enum(["schema_validation", "postcondition", "builder_threw"]),
  issues: z.array(z.object({
    path: z.string().trim().min(1),
    code: z.string().trim().min(1),
    message: z.string().trim().min(1).nullable().default(null)
  })).default([]),
  postconditionKey: z.string().trim().min(1).nullable().default(null),
  errorName: z.string().trim().min(1).nullable().default(null)
});

/**
 * One active temporary hotfix. Stored as a line in `.exo/repair-overrides.jsonl`.
 */
export const repairRecordSchema = z.object({
  id: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
  contractKind: repairableContractKindSchema,
  exoVersionRange: repairVersionRangeSchema,
  inputHash: z.string().trim().min(1),
  failureHash: z.string().trim().min(1),
  failureArtifact: repairFailureArtifactSchema,
  /**
   * Full replacement payload in the same contract shape as the failed
   * builder output. Validated against the target contract schema and its
   * postconditions before persistence; an invalid replacement is never
   * stored. For `agent_queue`, the replacement may only be a filtered or
   * reordered subset of the failed builder output — no synthesized tasks,
   * no novel contract commands (enforced by the executor's postconditions,
   * not representable here).
   */
  replacementContract: z.unknown(),
  failedContractHash: z.string().trim().min(1).nullable().default(null),
  repairedContractHash: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  submissionId: z.string().trim().min(1).nullable().default(null),
  submissionStatus: repairSubmissionStatusSchema.default("pending")
});

/**
 * Redaction manifest for an upstream submission. Free-text bodies, emails,
 * and person/company names are hashed or dropped before the bundle leaves
 * the workspace; this records what was removed so upstream triage knows the
 * holes are intentional.
 */
export const repairRedactionSchema = z.object({
  redactedFieldPaths: z.array(z.string().trim().min(1)).default([]),
  strategy: z.enum(["hash", "drop"]).default("hash")
});

/**
 * Outbound before/after bundle. Stored as a line in
 * `.exo/repair-submissions.jsonl` and pushed fire-and-forget to the hosted
 * append-only intake when `repair.submitUpstream` is enabled and
 * `repair.submissionEndpoint` is configured; otherwise it spools locally.
 */
export const repairSubmissionSchema = z.object({
  submissionId: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
  exoVersion: z.string().trim().min(1),
  contractKind: repairableContractKindSchema,
  inputHash: z.string().trim().min(1),
  failureHash: z.string().trim().min(1),
  failureArtifact: repairFailureArtifactSchema,
  /** Redacted normalized inputs — never raw workspace state. */
  normalizedInputs: z.unknown(),
  /** Redacted failed builder output, when the builder produced one. */
  failedContract: z.unknown().nullable().default(null),
  /** Redacted repaired contract that passed schema + postconditions. */
  repairedContract: z.unknown(),
  redaction: repairRedactionSchema,
  /** Plain-language explanation from the repair generator. */
  explanation: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  submittedAt: z.string().datetime().nullable().default(null),
  submissionStatus: repairSubmissionStatusSchema.default("pending")
});

/**
 * Top-level block added to a repaired payload. The payload otherwise keeps
 * the exact contract shape of the original builder output.
 */
export const repairBlockSchema = z.object({
  applied: z.literal(true),
  fingerprint: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  failedContractHash: z.string().trim().min(1).nullable().default(null),
  repairedContractHash: z.string().trim().min(1),
  submissionId: z.string().trim().min(1).nullable().default(null)
});
