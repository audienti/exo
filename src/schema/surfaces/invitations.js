// @ts-check

import { z } from "zod";
import {
  buildCanonicalSurfaceResultSchema,
  canonicalActorSchema,
  canonicalSourceIdentitySchema,
  canonicalTimestampSchema,
  canonicalSurfaceModeSchema
} from "./shared.js";

export const canonicalInvitationDirectionSchema = z.enum(["received", "sent"]);
export const canonicalInvitationStateSchema = z.enum([
  "pending",
  "accepted_visible",
  "declined_visible",
  "withdrawn_visible"
]);

export const canonicalInvitationActionSchema = z.enum([
  "acceptConnectionRequest",
  "rejectConnectionRequest",
  "withdrawConnectionRequest"
]);

export const canonicalInvitationItemSchema = z.object({
  identity: canonicalSourceIdentitySchema,
  observedAt: canonicalTimestampSchema,
  eventAt: canonicalTimestampSchema.nullable().default(null),
  direction: canonicalInvitationDirectionSchema,
  state: canonicalInvitationStateSchema,
  actor: canonicalActorSchema,
  summary: z.string().trim().min(1).max(280),
  sourceUrl: z.string().url().nullable().default(null),
  profileUrl: z.string().url().nullable().default(null),
  actionsSupported: z.array(canonicalInvitationActionSchema).default([]),
  providerDetails: z.record(z.unknown()).nullable().default(null)
});

export const canonicalSentInvitationItemSchema = canonicalInvitationItemSchema.extend({
  direction: z.literal("sent"),
  state: z.enum(["pending", "accepted_visible", "withdrawn_visible"])
});

export const canonicalReceivedInvitationItemSchema = canonicalInvitationItemSchema.extend({
  direction: z.literal("received"),
  state: z.enum(["pending", "accepted_visible", "declined_visible"])
});

export const canonicalInvitationSurfaceInputSchema = z.object({
  mode: canonicalSurfaceModeSchema.default("full"),
  maxRows: z.coerce.number().int().min(1).nullable().default(null),
  evidencePolicy: z.object({
    allowDom: z.boolean().default(true),
    allowNetworkBodies: z.boolean().default(true)
  }).default({
    allowDom: true,
    allowNetworkBodies: true
  }),
  diagnostics: z.object({
    includeEvidenceRefs: z.boolean().default(false)
  }).default({
    includeEvidenceRefs: false
  })
});

export const canonicalInvitationSurfaceResultSchema = buildCanonicalSurfaceResultSchema(canonicalInvitationItemSchema).extend({
  surface: z.literal("invitations")
});

export const canonicalSentInvitationSurfaceResultSchema = buildCanonicalSurfaceResultSchema(canonicalSentInvitationItemSchema).extend({
  surface: z.literal("invitations")
});

export const canonicalReceivedInvitationSurfaceResultSchema = buildCanonicalSurfaceResultSchema(canonicalReceivedInvitationItemSchema).extend({
  surface: z.literal("invitations")
});
