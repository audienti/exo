// @ts-check

import { z } from "zod";

const stringArray = z.array(z.string().trim().min(1)).default([]);

export const signalObservationMethodSchema = z.object({
  surface: z.enum([
    "google",
    "sales-navigator",
    "linkedin",
    "company-site",
    "news",
    "manual",
    "other"
  ]),
  query: z.string().trim().min(1).nullable(),
  notes: z.string().trim().min(1).nullable()
});

export const signalSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  question: z.string().trim().min(1),
  scope: z.enum(["company", "person", "both"]),
  whyItMatters: z.string().trim().min(1).nullable(),
  matchRule: z.string().trim().min(1).nullable(),
  audienceIds: stringArray,
  observationMethods: z.array(signalObservationMethodSchema).default([]),
  status: z.enum(["draft", "ready"])
});
