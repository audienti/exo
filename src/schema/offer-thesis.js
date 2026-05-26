// @ts-check

import { z } from "zod";

export const offerThesisSchema = z.object({
  sourceUrl: z.string().url(),
  sourceTitle: z.string().nullable(),
  sourceDescription: z.string().nullable(),
  sourceSummary: z.string(),
  offerNotes: z.string().nullable(),
  problemThesis: z.string().nullable(),
  buyerImpactThesis: z.string().nullable(),
  likelyTriggerThesis: z.string().nullable(),
  likelyRoleThesis: z.string().nullable(),
  likelySegmentThesis: z.string().nullable(),
  status: z.enum(["seeded", "needs_inference"])
});

