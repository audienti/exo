// @ts-check

import { z } from "zod";

export const browserProfileCapabilitySchema = z.enum([
  "generic-web",
  "linkedin",
  "linkedin-premium",
  "sales-navigator",
  "gmail",
  "hubspot"
]);

// Identity tiers that can attach a note to a LinkedIn connection request.
// Free LinkedIn effectively cannot; Premium and Sales Navigator can (subject to
// monthly note credits, which are a separate live observation).
export const CONNECTION_NOTE_CAPABILITIES = ["linkedin-premium", "sales-navigator"];

/**
 * @param {string[] | null | undefined} accountRefs  e.g. ["linkedin:handle","sales-navigator:handle"]
 * @returns {boolean}
 */
export function accountRefsCanAttachConnectionNote(accountRefs) {
  if (!Array.isArray(accountRefs)) return false;
  return accountRefs.some((ref) => CONNECTION_NOTE_CAPABILITIES.some((cap) => String(ref).startsWith(`${cap}:`)));
}

export const browserProfileStatusSchema = z.enum(["untested", "ready", "warning", "invalid"]);

export const browserKeySchema = z.enum([
  "chrome",
  "chrome-beta",
  "chromium",
  "brave",
  "arc",
  "edge"
]);

export const browserProfileCheckSchema = z.object({
  name: z.string().min(1),
  ok: z.boolean(),
  details: z.string().min(1)
});

export const browserProfileCapabilityCheckSchema = z.object({
  capability: browserProfileCapabilitySchema,
  verified: z.boolean(),
  details: z.string().min(1)
});

export const browserProfileAuthCapabilityCheckSchema = z.object({
  capability: browserProfileCapabilitySchema,
  verified: z.boolean(),
  details: z.string().min(1),
  expectedHandle: z.string().trim().min(1).nullable().default(null),
  detectedHandle: z.string().trim().min(1).nullable().default(null),
  sourceUrl: z.string().trim().min(1).nullable().default(null)
});

export const browserProfileIdentityScopeSchema = z.enum(["unknown", "work", "personal", "shared"]);

export const browserProfileIdentityAccountSchema = z.object({
  capability: browserProfileCapabilitySchema,
  handle: z.string().trim().min(1)
});

const nullableQuotaSchema = z.coerce.number().int().min(0).nullable();

export const browserProfileAutomationControlsSchema = z.object({
  weeklyQuotas: z.object({
    profileVisits: nullableQuotaSchema.default(null),
    invitations: nullableQuotaSchema.default(null),
    messages: nullableQuotaSchema.default(null)
  }).default({
    profileVisits: null,
    invitations: null,
    messages: null
  })
});

export const browserProfileIdentitySchema = z.object({
  owner: z.string().trim().min(1).nullable().default(null),
  workspace: z.string().trim().min(1).nullable().default(null),
  scope: browserProfileIdentityScopeSchema.default("unknown"),
  accounts: z.array(browserProfileIdentityAccountSchema).default([])
});

export const browserProfileTestResultSchema = z.object({
  status: browserProfileStatusSchema,
  summary: z.string().min(1),
  checks: z.array(browserProfileCheckSchema).default([]),
  capabilityChecks: z.array(browserProfileCapabilityCheckSchema).default([]),
  warnings: z.array(z.string()).default([])
});

export const browserProfileAuthProbeResultSchema = z.object({
  status: browserProfileStatusSchema,
  summary: z.string().min(1),
  runtime: z.string().trim().min(1),
  checkedAt: z.string().datetime(),
  capabilityChecks: z.array(browserProfileAuthCapabilityCheckSchema).default([]),
  warnings: z.array(z.string()).default([])
});

export const browserProfileSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  label: z.string().min(1),
  browser: browserKeySchema,
  browserCommand: z.string().nullable(),
  userDataDir: z.string().min(1),
  profileDirectory: z.string().min(1),
  profilePath: z.string().min(1),
  detectedProfileName: z.string().nullable(),
  capabilities: z.array(browserProfileCapabilitySchema).default(["generic-web"]),
  verifiedCapabilities: z.array(browserProfileCapabilitySchema).default([]),
  identity: browserProfileIdentitySchema.default({
    owner: null,
    workspace: null,
    scope: "unknown",
    accounts: []
  }),
  automationControls: browserProfileAutomationControlsSchema.default({
    weeklyQuotas: {
      profileVisits: null,
      invitations: null,
      messages: null
    }
  }),
  notes: z.string().nullable(),
  status: browserProfileStatusSchema,
  lastTestedAt: z.string().datetime().nullable(),
  lastTestResult: browserProfileTestResultSchema.nullable(),
  lastAuthProbedAt: z.string().datetime().nullable().default(null),
  lastAuthProbeResult: browserProfileAuthProbeResultSchema.nullable().default(null)
});
