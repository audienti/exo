// @ts-check

import { z } from "zod";
import {
  inboundCaptureCompletenessSchema,
  inboundObservationCompanyProfileSchema,
  inboundSurfaceExhaustionStatusSchema,
  inboundThreadMessageSchema,
  inboundSyncPlanModeSchema,
  inboundSyncWriteStatusSchema
} from "./inbound.js";

const linkedinCaptureActorFields = {
  actorName: z.string().trim().min(1).nullable().default(null),
  actorTitle: z.string().trim().min(1).nullable().default(null),
  actorCompanyName: z.string().trim().min(1).nullable().default(null),
  actorHandle: z.string().trim().min(1).nullable().default(null),
  actorProfileUrl: z.string().url().nullable().default(null),
  actorLinkedinPublicId: z.string().trim().min(1).nullable().default(null),
  actorLinkedinMemberId: z.string().trim().min(1).nullable().default(null),
  actorAvatarSourceUrl: z.string().url().nullable().default(null),
  sourceUrl: z.string().url().nullable().default(null),
  motionId: z.string().min(1).nullable().default(null),
  companyId: z.string().min(1).nullable().default(null),
  prospectId: z.string().min(1).nullable().default(null),
  actorCompanyProfile: inboundObservationCompanyProfileSchema.nullable().default(null),
  notes: z.string().trim().min(1).nullable().default(null)
};

export const linkedinSurfaceCaptureSchema = z.object({
  status: inboundSyncWriteStatusSchema.default("success"),
  checkedAt: z.string().datetime().nullable().default(null),
  itemCount: z.coerce.number().int().min(0).nullable().default(null),
  visibleTotalCount: z.coerce.number().int().min(0).nullable().default(null),
  captureCompleteness: inboundCaptureCompletenessSchema.nullable().default(null),
  requestedMode: inboundSyncPlanModeSchema.nullable().default(null),
  actualMode: inboundSyncPlanModeSchema.nullable().default(null),
  reconcileRequired: z.boolean().nullable().default(null),
  reconcileReason: z.string().trim().min(1).nullable().default(null),
  exhaustionStatus: inboundSurfaceExhaustionStatusSchema.nullable().default(null),
  exhaustionReason: z.string().trim().min(1).nullable().default(null),
  paginationAttempted: z.boolean().nullable().default(null),
  terminalSignalSeen: z.boolean().nullable().default(null),
  stalledPassCount: z.coerce.number().int().min(0).nullable().default(null),
  continuationStartedAt: z.string().datetime().nullable().default(null),
  nextCursor: z.string().trim().min(1).nullable().default(null),
  nextStartOffset: z.coerce.number().int().min(0).nullable().default(null),
  error: z.string().trim().min(1).nullable().default(null)
});

export const linkedinSentInvitationCaptureSchema = z.object({
  invitationId: z.string().trim().min(1),
  kind: z.enum(["connection_request_pending", "connection_request_accepted", "connection_request_withdrawn"]).default("connection_request_pending"),
  observedAt: z.string().datetime(),
  eventAt: z.string().datetime().nullable().default(null),
  summary: z.string().trim().min(1).max(280),
  providerSharedSecret: z.string().trim().min(1).nullable().default(null),
  ...linkedinCaptureActorFields
});

export const linkedinReceivedInvitationCaptureSchema = z.object({
  invitationId: z.string().trim().min(1),
  kind: z.enum(["connection_request_received", "connection_request_accepted", "connection_request_declined"]).default("connection_request_received"),
  observedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(280),
  providerSharedSecret: z.string().trim().min(1).nullable().default(null),
  ...linkedinCaptureActorFields
});

export const linkedinMessageThreadCaptureSchema = z.object({
  threadId: z.string().trim().min(1),
  kind: z.enum(["message_received", "thread_updated", "inbound_reply_received"]).default("thread_updated"),
  observedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(280),
  threadUrl: z.string().url().nullable().default(null),
  subject: z.string().trim().min(1).nullable().default(null),
  messages: z.array(inboundThreadMessageSchema).default([]),
  ...linkedinCaptureActorFields
});

export const linkedinProfileViewCaptureSchema = z.object({
  viewId: z.string().trim().min(1),
  kind: z.enum(["profile_view_after_touch", "profile_view_received"]).default("profile_view_received"),
  observedAt: z.string().datetime(),
  eventAt: z.string().datetime().nullable().default(null),
  summary: z.string().trim().min(1).max(280),
  ...linkedinCaptureActorFields
});

export const linkedinFollowerCaptureSchema = z.object({
  entryId: z.string().trim().min(1),
  kind: z.enum(["follower_added", "follower_confirmed"]).default("follower_confirmed"),
  observedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(280),
  ...linkedinCaptureActorFields
});

export const linkedinFollowingCaptureSchema = z.object({
  entryId: z.string().trim().min(1),
  kind: z.enum(["follow_state_changed", "follow_state_confirmed"]).default("follow_state_confirmed"),
  observedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(280),
  ...linkedinCaptureActorFields
});

export const linkedinInboundSyncCaptureSchema = z.object({
  mode: inboundSyncPlanModeSchema.default("quick"),
  sentInvitations: linkedinSurfaceCaptureSchema.extend({
    items: z.array(linkedinSentInvitationCaptureSchema).default([])
  }),
  receivedInvitations: linkedinSurfaceCaptureSchema.extend({
    items: z.array(linkedinReceivedInvitationCaptureSchema).default([])
  }),
  messagingInbox: linkedinSurfaceCaptureSchema.extend({
    items: z.array(linkedinMessageThreadCaptureSchema).default([])
  }),
  profileViews: linkedinSurfaceCaptureSchema.extend({
    items: z.array(linkedinProfileViewCaptureSchema).default([])
  }),
  followersList: linkedinSurfaceCaptureSchema.extend({
    items: z.array(linkedinFollowerCaptureSchema).default([])
  }),
  followingList: linkedinSurfaceCaptureSchema.extend({
    items: z.array(linkedinFollowingCaptureSchema).default([])
  })
});
