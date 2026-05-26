// @ts-check

import { z } from "zod";

export const browserProfileCapabilitySchema = z.enum([
  "generic-web",
  "linkedin",
  "sales-navigator",
  "gmail",
  "hubspot"
]);

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
  lastTestResult: browserProfileTestResultSchema.nullable()
});
