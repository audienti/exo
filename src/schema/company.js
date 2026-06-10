// @ts-check

import { z } from "zod";

const stringArray = z.array(z.string().trim().min(1)).default([]);

export const companyEngagementProfileAssignmentSchema = z.object({
  profileId: z.string().min(1),
  label: z.string().trim().min(1),
  browser: z.string().trim().min(1),
  profileDirectory: z.string().trim().min(1),
  owner: z.string().trim().min(1).nullable(),
  workspace: z.string().trim().min(1).nullable(),
  accountRefs: stringArray,
  assignedAt: z.string().datetime(),
  assignedBy: z.string().trim().min(1).nullable(),
  reason: z.string().trim().min(1).nullable(),
  sticky: z.boolean().default(true)
});

export const companyEngagementUserAssignmentSchema = z.object({
  userId: z.string().min(1),
  label: z.string().trim().min(1),
  owner: z.string().trim().min(1).nullable(),
  accountRefs: stringArray,
  assignedAt: z.string().datetime(),
  assignedBy: z.string().trim().min(1).nullable(),
  reason: z.string().trim().min(1).nullable(),
  sticky: z.boolean().default(true)
});

export const companySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  name: z.string().trim().min(1),
  domain: z.string().trim().min(1).nullable(),
  websiteUrl: z.string().url().nullable(),
  linkedinCompanyUrl: z.string().url().nullable(),
  logoSourceUrl: z.string().url().nullable().default(null),
  logoUrl: z.string().url().nullable().default(null),
  notes: z.string().nullable().default(null),
  tags: stringArray,
  motionIds: stringArray,
  engagementProfileAssignment: companyEngagementProfileAssignmentSchema.nullable().default(null),
  engagementUserAssignment: companyEngagementUserAssignmentSchema.nullable().default(null)
});
