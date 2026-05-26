// @ts-check

import { z } from "zod";

export const premiseSchema = z.object({
  statement: z.string().trim().min(1).nullable(),
  notes: z.string().trim().min(1).nullable(),
  source: z.enum(["operator", "inferred", "mixed"]),
  status: z.enum(["missing", "defined"])
});
