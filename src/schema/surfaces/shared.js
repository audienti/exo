// @ts-check

import { z } from "zod";

export const canonicalTimestampSchema = z.object({
  value: z.string().datetime(),
  source: z.enum(["exact", "estimated"]),
  evidence: z.enum([
    "surface_label",
    "provider_timestamp",
    "thread_order",
    "capture_time_backfill",
    "derived_composite"
  ]),
  rawLabel: z.string().trim().min(1).nullable().default(null)
});

export const canonicalSourceIdentitySchema = z.object({
  sourceItemId: z.string().trim().min(1),
  sourceItemIdSource: z.enum([
    "native",
    "derived_profile",
    "derived_thread",
    "derived_composite"
  ])
});

export const canonicalActorSchema = z.object({
  displayName: z.string().trim().min(1).nullable().default(null),
  handle: z.string().trim().min(1).nullable().default(null),
  profileUrl: z.string().url().nullable().default(null),
  publicId: z.string().trim().min(1).nullable().default(null),
  memberId: z.string().trim().min(1).nullable().default(null),
  title: z.string().trim().min(1).nullable().default(null),
  companyName: z.string().trim().min(1).nullable().default(null),
  avatarUrl: z.string().url().nullable().default(null)
});

export const canonicalSurfaceModeSchema = z.enum(["full", "quick"]);
export const canonicalSurfaceStatusSchema = z.enum(["success", "warning", "failed"]);
export const canonicalSurfaceExhaustionStatusSchema = z.enum(["complete", "incomplete", "blocked"]);
export const canonicalSurfaceCaptureCompletenessSchema = z.enum(["complete", "partial_visible_slice", "failed"]);

export const toolLifecyclePhaseSchema = z.enum([
  "binding",
  "navigation",
  "capture",
  "extraction",
  "normalization",
  "finalization",
  "escalation"
]);

export const toolLifecycleStatusSchema = z.enum(["started", "checkpoint", "completed", "failed"]);

export const toolEvidenceRefSchema = z.object({
  kind: z.enum(["network_body", "dom_snapshot", "url", "console_note", "artifact"]),
  ref: z.string().trim().min(1),
  surface: z.string().trim().min(1).nullable().default(null),
  capturedAt: z.string().datetime().nullable().default(null)
});

export const toolDiagnosticsSchema = z.object({
  currentUrl: z.string().url().nullable().default(null),
  signedInIdentityObserved: z.string().trim().min(1).nullable().default(null),
  evidenceRefs: z.array(toolEvidenceRefSchema).default([]),
  hints: z.array(z.string().trim().min(1)).default([]),
  suggestedNextAction: z.string().trim().min(1).nullable().default(null)
});

export const toolErrorSchema = z.object({
  code: z.enum([
    "profile_selection_mismatch",
    "not_signed_in",
    "surface_not_reachable",
    "surface_not_rendered",
    "network_capture_unavailable",
    "dom_capture_unavailable",
    "rate_limited",
    "tool_contract_violation",
    "unexpected_runtime_error"
  ]),
  message: z.string().trim().min(1),
  retryable: z.boolean(),
  phase: toolLifecyclePhaseSchema.exclude(["escalation"])
});

export const toolLifecycleEventSchema = z.object({
  runId: z.string().trim().min(1),
  toolMethodId: z.string().trim().min(1),
  surface: z.string().trim().min(1),
  phase: toolLifecyclePhaseSchema,
  status: toolLifecycleStatusSchema,
  emittedAt: z.string().datetime(),
  currentUrl: z.string().url().nullable().default(null),
  itemCount: z.coerce.number().int().min(0).nullable().default(null),
  visibleTotalCount: z.coerce.number().int().min(0).nullable().default(null),
  message: z.string().trim().min(1).nullable().default(null),
  failureCode: toolErrorSchema.shape.code.nullable().default(null),
  evidenceRefs: z.array(toolEvidenceRefSchema).default([]),
  metadata: z.record(z.unknown()).nullable().default(null)
});

export const toolLifecycleSummarySchema = z.object({
  runId: z.string().trim().min(1),
  lastPhase: toolLifecyclePhaseSchema.nullable().default(null),
  lastStatus: toolLifecycleStatusSchema.nullable().default(null),
  lastEmittedAt: z.string().datetime().nullable().default(null),
  eventCount: z.coerce.number().int().min(0)
});

export const toolRepairNoteSchema = z.object({
  createdAt: z.string().datetime(),
  phase: toolLifecyclePhaseSchema,
  author: z.enum(["agent", "operator"]),
  summary: z.string().trim().min(1),
  evidenceRefs: z.array(toolEvidenceRefSchema).default([]),
  outcome: z.enum(["continued", "resolved", "aborted", "unresolved"]).default("continued")
});

export const toolEscalationSchema = z.object({
  mode: z.enum(["artifact_postmortem", "live_continuation"]).nullable().default(null),
  status: z.enum(["not_requested", "requested", "in_progress", "resolved", "aborted"]).nullable().default(null),
  reason: z.string().trim().min(1).nullable().default(null),
  repairNotes: z.array(toolRepairNoteSchema).default([])
}).nullable().default(null);

/**
 * @template {z.ZodTypeAny} TItemSchema
 * @param {TItemSchema} itemSchema
 */
export function buildCanonicalSurfaceResultSchema(itemSchema) {
  return z.object({
    surface: z.string().trim().min(1),
    status: canonicalSurfaceStatusSchema,
    checkedAt: z.string().datetime().nullable().default(null),
    requestedMode: canonicalSurfaceModeSchema.nullable().default(null),
    actualMode: canonicalSurfaceModeSchema.nullable().default(null),
    itemCount: z.coerce.number().int().min(0).nullable().default(null),
    visibleTotalCount: z.coerce.number().int().min(0).nullable().default(null),
    exhaustionStatus: canonicalSurfaceExhaustionStatusSchema.nullable().default(null),
    captureCompleteness: canonicalSurfaceCaptureCompletenessSchema.nullable().default(null),
    reconcileRequired: z.boolean().nullable().default(null),
    reconcileReason: z.string().trim().min(1).nullable().default(null),
    paginationAttempted: z.boolean().nullable().default(null),
    terminalSignalSeen: z.boolean().nullable().default(null),
    stalledPassCount: z.coerce.number().int().min(0).nullable().default(null),
    nextCursor: z.string().trim().min(1).nullable().default(null),
    nextStartOffset: z.coerce.number().int().min(0).nullable().default(null),
    items: z.array(itemSchema).default([]),
    diagnostics: toolDiagnosticsSchema.nullable().default(null),
    lifecycleSummary: toolLifecycleSummarySchema.nullable().default(null),
    escalation: toolEscalationSchema,
    error: toolErrorSchema.nullable().default(null)
  });
}
