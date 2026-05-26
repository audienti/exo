// @ts-check

import { z } from "zod";

const stringArray = z.array(z.string().trim().min(1)).default([]);

export const audienceHypothesisSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  companyCriteria: stringArray,
  roleCriteria: stringArray,
  notes: z.string().trim().min(1).nullable(),
  confidence: z.enum(["low", "moderate", "high", "unknown"])
});
