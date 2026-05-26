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

export const browserProfileTestResultSchema = z.object({
  status: browserProfileStatusSchema,
  summary: z.string().min(1),
  checks: z.array(browserProfileCheckSchema).default([]),
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
  notes: z.string().nullable(),
  status: browserProfileStatusSchema,
  lastTestedAt: z.string().datetime().nullable(),
  lastTestResult: browserProfileTestResultSchema.nullable()
});
