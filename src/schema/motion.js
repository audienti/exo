// @ts-check

import { z } from "zod";
import { targetingProfileSchema } from "./targeting-profile.js";
import { suppressionPolicySchema } from "./suppression-policy.js";
import { offerThesisSchema } from "./offer-thesis.js";
import { premiseSchema } from "./premise.js";
import { audienceHypothesisSchema } from "./audience-hypothesis.js";
import { signalSchema } from "./signal.js";
import { targetAccountSchema } from "./target-account.js";
import {
  companyEngagementProfileAssignmentSchema,
  companyEngagementUserAssignmentSchema
} from "./company.js";

const statusSchema = z.enum(["draft", "active", "paused", "archived"]);
const targetMapSchema = z.object({
  status: z.enum(["pending", "ready"]),
  accounts: z.array(targetAccountSchema).default([]),
  segments: z.array(z.string()).default([])
});

export const motionCoreSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive().default(1),
  name: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  status: statusSchema,
  offer: z.object({
    sourceUrl: z.string().url(),
    offerNotes: z.string().nullable()
  }),
  premise: premiseSchema,
  targetingProfile: targetingProfileSchema,
  suppressionPolicy: suppressionPolicySchema,
  offerThesis: offerThesisSchema,
  audienceHypotheses: z.array(audienceHypothesisSchema).default([]),
  signals: z.array(signalSchema).default([]),
  stakeholderMap: z.object({
    status: z.enum(["pending", "ready"]),
    stakeholders: z.array(z.unknown()).default([])
  }),
  motionPlan: z.object({
    status: z.enum(["pending", "ready"]),
    variants: z.array(z.unknown()).default([])
  }),
  nextSteps: z.array(z.string()).default([]),
  engagementProfileAssignment: companyEngagementProfileAssignmentSchema.nullable().default(null),
  engagementUserAssignment: companyEngagementUserAssignmentSchema.nullable().default(null)
});

export const motionViewSchema = motionCoreSchema.extend({
  targetMap: targetMapSchema
});

export const motionSchema = motionViewSchema;
