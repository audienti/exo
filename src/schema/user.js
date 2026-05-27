// @ts-check

import { z } from "zod";
import { browserProfileCapabilitySchema } from "./browser-profile.js";

export const userHarnessConnectionStatusSchema = z.enum(["available", "unavailable", "unknown"]);

export const userAccountSourceTypeSchema = z.enum(["browser-profile", "harness-connection"]);

export const userHarnessConnectionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  runtime: z.string().trim().min(1),
  connector: z.string().trim().min(1),
  label: z.string().trim().min(1).nullable().default(null),
  status: userHarnessConnectionStatusSchema.default("unknown"),
  notes: z.string().nullable().default(null)
});

export const userConnectedAccountSchema = z
  .object({
    id: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    capability: browserProfileCapabilitySchema,
    handle: z.string().trim().min(1),
    label: z.string().trim().min(1).nullable().default(null),
    sourceType: userAccountSourceTypeSchema,
    browserProfileId: z.string().min(1).nullable().default(null),
    harnessConnectionId: z.string().min(1).nullable().default(null),
    preferred: z.boolean().default(false),
    notes: z.string().nullable().default(null)
  })
  .superRefine((value, context) => {
    if (value.sourceType === "browser-profile") {
      if (!value.browserProfileId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Browser-profile accounts require browserProfileId."
        });
      }

      if (value.harnessConnectionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Browser-profile accounts cannot also reference a harness connection."
        });
      }
    }

    if (value.sourceType === "harness-connection") {
      if (!value.harnessConnectionId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Harness-connection accounts require harnessConnectionId."
        });
      }

      if (value.browserProfileId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Harness-connection accounts cannot also reference a browser profile."
        });
      }
    }
  });

export const userSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  label: z.string().trim().min(1),
  owner: z.string().trim().min(1).nullable().default(null),
  notes: z.string().nullable().default(null),
  accounts: z.array(userConnectedAccountSchema).default([]),
  harnessConnections: z.array(userHarnessConnectionSchema).default([])
});
