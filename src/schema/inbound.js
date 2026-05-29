// @ts-check

import { z } from "zod";

export const inboundSurfaceKeySchema = z.enum([
  "linkedin-sent-invitations",
  "linkedin-received-invitations",
  "linkedin-messaging-inbox",
  "linkedin-profile-views",
  "linkedin-followers-list",
  "linkedin-following-list",
  "linkedin-comment-replies",
  "linkedin-catch-up-updates",
  "gmail-inbox-threads"
]);

export const inboundTruthLevelSchema = z.enum(["authoritative", "supplementary", "noisy"]);

export const inboundRetrievalModeSchema = z.enum(["browser-capture", "connector", "manual"]);

export const inboundSyncRunStatusSchema = z.enum(["never", "success", "warning", "failed"]);

export const inboundObservationKindSchema = z.enum([
  "connection_request_pending",
  "connection_request_accepted",
  "connection_request_withdrawn",
  "connection_request_received",
  "connection_request_declined",
  "message_received",
  "thread_updated",
  "inbound_reply_received",
  "profile_view_after_touch",
  "profile_view_received",
  "follower_added",
  "follower_removed",
  "follower_confirmed",
  "follow_state_changed",
  "follow_state_confirmed",
  "public_reply_received",
  "comment_thread_updated",
  "catch_up_update_detected",
  "public_engagement_opportunity",
  "email_reply_received",
  "email_thread_updated"
]);

export const inboundSurfaceStateSchema = z.object({
  surfaceKey: inboundSurfaceKeySchema,
  enabled: z.boolean().default(false),
  lastSyncedAt: z.string().datetime().nullable().default(null),
  lastObservedAt: z.string().datetime().nullable().default(null),
  lastRunStatus: inboundSyncRunStatusSchema.default("never"),
  lastItemCount: z.coerce.number().int().min(0).nullable().default(null),
  lastError: z.string().nullable().default(null)
});

export const inboundSyncPolicySchema = z.object({
  surfaces: z.array(inboundSurfaceStateSchema).default([])
});

export const inboundObservationSchema = z.object({
  id: z.string().min(1),
  dedupeKey: z.string().min(1),
  userId: z.string().min(1),
  accountId: z.string().min(1),
  capability: z.string().trim().min(1),
  platform: z.string().trim().min(1),
  surfaceKey: inboundSurfaceKeySchema,
  kind: inboundObservationKindSchema,
  truthLevel: inboundTruthLevelSchema,
  observedAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
  externalId: z.string().trim().min(1).nullable().default(null),
  actorName: z.string().trim().min(1).nullable().default(null),
  actorTitle: z.string().trim().min(1).nullable().default(null),
  actorCompanyName: z.string().trim().min(1).nullable().default(null),
  actorHandle: z.string().trim().min(1).nullable().default(null),
  actorProfileUrl: z.string().url().nullable().default(null),
  threadUrl: z.string().url().nullable().default(null),
  sourceUrl: z.string().url().nullable().default(null),
  summary: z.string().trim().min(1).max(280),
  motionId: z.string().min(1).nullable().default(null),
  companyId: z.string().min(1).nullable().default(null),
  prospectId: z.string().min(1).nullable().default(null),
  notes: z.string().trim().min(1).nullable().default(null)
});
