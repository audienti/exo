// @ts-check

import { z } from "zod";
import { motionSchema } from "./motion.js";
import { browserProfileSchema } from "./browser-profile.js";
import { companySchema } from "./company.js";
import { userSchema } from "./user.js";

export const configBundleSchema = z.object({
  kind: z.literal("exo-config"),
  schemaVersion: z.literal("1"),
  exportedAt: z.string().datetime(),
  exoVersion: z.string().min(1),
  motions: z.array(motionSchema).default([]),
  browserProfiles: z.array(browserProfileSchema).default([]),
  companies: z.array(companySchema).default([]),
  users: z.array(userSchema).default([])
});
