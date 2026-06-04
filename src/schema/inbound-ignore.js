// @ts-check

import { z } from "zod";
import { inboundSurfaceKeySchema } from "./inbound.js";

export const inboundIgnoreRuleSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  accountId: z.string().min(1),
  capability: z.string().trim().min(1),
  surfaceKey: inboundSurfaceKeySchema.nullable().default(null),
  actorHandle: z.string().trim().min(1).nullable().default(null),
  externalId: z.string().trim().min(1).nullable().default(null),
  threadUrl: z.string().url().nullable().default(null),
  reason: z.string().trim().min(1).nullable().default(null),
});
