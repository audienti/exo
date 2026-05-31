// @ts-check

import { z } from "zod";
import { browserProfileCapabilitySchema } from "./browser-profile.js";
import { inboundSyncPolicySchema } from "./inbound.js";

export const userHarnessConnectionStatusSchema = z.enum(["available", "unavailable", "unknown"]);

export const userAccountSourceTypeSchema = z.enum(["browser-profile", "harness-connection"]);
export const userWorkingHoursModeSchema = z.enum(["always", "scheduled"]);
export const userWorkingHoursWeekdaySchema = z.enum(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);

const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM 24-hour local time.");

export const userWorkingHoursSchema = z.object({
  mode: userWorkingHoursModeSchema.default("always"),
  timezone: z.string().trim().min(1).default("America/New_York"),
  weekdays: z.array(userWorkingHoursWeekdaySchema).default(["mon", "tue", "wed", "thu", "fri"]),
  startLocalTime: localTimeSchema.default("09:00"),
  endLocalTime: localTimeSchema.default("17:00")
}).superRefine((value, context) => {
  if (value.mode !== "scheduled") {
    return;
  }

  if (value.weekdays.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Scheduled working hours require at least one weekday."
    });
  }

  if (value.startLocalTime >= value.endLocalTime) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Scheduled working hours require startLocalTime to be earlier than endLocalTime."
    });
  }
});

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
    notes: z.string().nullable().default(null),
    inboundSync: inboundSyncPolicySchema.default({
      surfaces: []
    })
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
  workingHours: userWorkingHoursSchema.default({
    mode: "always",
    timezone: "America/New_York",
    weekdays: ["mon", "tue", "wed", "thu", "fri"],
    startLocalTime: "09:00",
    endLocalTime: "17:00"
  }),
  accounts: z.array(userConnectedAccountSchema).default([]),
  harnessConnections: z.array(userHarnessConnectionSchema).default([])
});
