// @ts-check

import { z } from "zod";
import {
  buildCanonicalSurfaceResultSchema,
  canonicalActorSchema,
  canonicalSourceIdentitySchema,
  canonicalTimestampSchema
} from "./shared.js";

export const canonicalMessageItemSchema = z.object({
  identity: canonicalSourceIdentitySchema,
  observedAt: canonicalTimestampSchema,
  receivedAt: canonicalTimestampSchema,
  threadId: z.string().trim().min(1),
  threadIdSource: z.enum(["native", "derived_composite"]),
  messageId: z.string().trim().min(1).nullable().default(null),
  messageIdSource: z.enum(["native", "derived_composite"]).nullable().default(null),
  direction: z.enum(["inbound", "outbound"]),
  actor: canonicalActorSchema,
  threadUrl: z.string().url().nullable().default(null),
  sourceUrl: z.string().url().nullable().default(null),
  subject: z.string().trim().min(1).nullable().default(null),
  summary: z.string().trim().min(1).max(280),
  bodyPreview: z.string().trim().min(1).nullable().default(null),
  unread: z.boolean().nullable().default(null),
  providerDetails: z.record(z.unknown()).nullable().default(null)
});

export const canonicalMessageSurfaceResultSchema = buildCanonicalSurfaceResultSchema(canonicalMessageItemSchema).extend({
  surface: z.literal("messages")
});
