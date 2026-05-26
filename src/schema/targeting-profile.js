// @ts-check

import { z } from "zod";

const stringArray = z.array(z.string().trim().min(1)).default([]);

export const targetingProfileSchema = z.object({
  geolocations: stringArray,
  icpTypes: stringArray,
  industries: stringArray,
  companyTypes: stringArray,
  companyShapes: stringArray,
  companySizes: stringArray,
  targetTitles: stringArray,
  roleFamilies: stringArray,
  segmentVariants: stringArray,
  stakeholderTargetCount: z.coerce.number().int().min(1).max(10).default(3)
});
