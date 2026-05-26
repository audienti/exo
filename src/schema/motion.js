// @ts-check

import { z } from "zod";
import { targetingProfileSchema } from "./targeting-profile.js";
import { suppressionPolicySchema } from "./suppression-policy.js";
import { offerThesisSchema } from "./offer-thesis.js";

const statusSchema = z.enum(["draft", "active", "archived"]);

export const motionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: statusSchema,
  offer: z.object({
    sourceUrl: z.string().url(),
    offerNotes: z.string().nullable()
  }),
  targetingProfile: targetingProfileSchema,
  suppressionPolicy: suppressionPolicySchema,
  offerThesis: offerThesisSchema,
  signalSet: z.object({
    status: z.enum(["pending", "ready"]),
    items: z.array(z.unknown()).default([])
  }),
  targetMap: z.object({
    status: z.enum(["pending", "ready"]),
    accounts: z.array(z.unknown()).default([]),
    segments: z.array(z.string()).default([])
  }),
  stakeholderMap: z.object({
    status: z.enum(["pending", "ready"]),
    stakeholders: z.array(z.unknown()).default([])
  }),
  motionPlan: z.object({
    status: z.enum(["pending", "ready"]),
    variants: z.array(z.unknown()).default([])
  }),
  nextSteps: z.array(z.string()).default([])
});

