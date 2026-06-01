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

export const inboundSyncPlanModeSchema = z.enum(["quick", "normal", "full"]);
export const inboundCaptureCompletenessSchema = z.enum(["complete", "partial_visible_slice", "failed"]);
export const inboundSurfaceExhaustionStatusSchema = z.enum(["complete", "incomplete", "blocked"]);

export const inboundSyncWriteStatusSchema = z.enum(["success", "warning", "failed"]);
export const inboundCueKindSchema = z.enum([
  "unread_message_badge",
  "invite_badge",
  "notification_dot",
  "attention_hint",
  "thread_change_hint"
]);
export const inboundCueSourceSchema = z.enum(["action_glance", "manual_hint", "runtime_capture"]);
export const inboundCueStatusSchema = z.enum(["open", "resolved", "dismissed"]);

export const inboundObservationKindSchema = z.enum([
  "connection_request_pending",
  "connection_request_no_longer_pending",
  "connection_request_accepted",
  "connection_request_withdrawn",
  "connection_request_received",
  "connection_request_received_no_longer_pending",
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
  "follow_state_removed",
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
  lastVisibleTotalCount: z.coerce.number().int().min(0).nullable().default(null),
  lastCaptureCompleteness: inboundCaptureCompletenessSchema.nullable().default(null),
  lastRequestedMode: inboundSyncPlanModeSchema.nullable().default(null),
  lastActualMode: inboundSyncPlanModeSchema.nullable().default(null),
  lastReconcileRequired: z.boolean().nullable().default(null),
  lastReconcileReason: z.string().trim().min(1).nullable().default(null),
  lastExhaustionStatus: inboundSurfaceExhaustionStatusSchema.nullable().default(null),
  lastExhaustionReason: z.string().trim().min(1).nullable().default(null),
  lastPaginationAttempted: z.boolean().nullable().default(null),
  lastTerminalSignalSeen: z.boolean().nullable().default(null),
  lastStalledPassCount: z.coerce.number().int().min(0).nullable().default(null),
  lastObservationCount: z.coerce.number().int().min(0).nullable().default(null),
  lastItemizationGapCount: z.coerce.number().int().min(0).nullable().default(null),
  lastCountDiscrepancyCount: z.coerce.number().int().min(0).nullable().default(null),
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
  actorLinkedinPublicId: z.string().trim().min(1).nullable().default(null),
  actorLinkedinMemberId: z.string().trim().min(1).nullable().default(null),
  actorAvatarSourceUrl: z.string().url().nullable().default(null),
  actorAvatarUrl: z.string().url().nullable().default(null),
  threadUrl: z.string().url().nullable().default(null),
  sourceUrl: z.string().url().nullable().default(null),
  summary: z.string().trim().min(1).max(280),
  motionId: z.string().min(1).nullable().default(null),
  companyId: z.string().min(1).nullable().default(null),
  prospectId: z.string().min(1).nullable().default(null),
  notes: z.string().trim().min(1).nullable().default(null)
});

export const inboundCueSchema = z.object({
  id: z.string().min(1),
  dedupeKey: z.string().min(1),
  userId: z.string().min(1),
  accountId: z.string().min(1),
  capability: z.string().trim().min(1),
  platform: z.string().trim().min(1),
  surfaceKey: inboundSurfaceKeySchema,
  kind: inboundCueKindSchema,
  source: inboundCueSourceSchema.default("manual_hint"),
  status: inboundCueStatusSchema.default("open"),
  observedAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().default(null),
  summary: z.string().trim().min(1).max(280),
  motionId: z.string().min(1).nullable().default(null),
  companyId: z.string().min(1).nullable().default(null),
  prospectId: z.string().min(1).nullable().default(null),
  notes: z.string().trim().min(1).nullable().default(null)
});

export const inboundSyncRunObservationInputSchema = z.object({
  kind: inboundObservationKindSchema,
  observedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(280),
  externalId: z.string().trim().min(1).nullable().default(null),
  actorName: z.string().trim().min(1).nullable().default(null),
  actorTitle: z.string().trim().min(1).nullable().default(null),
  actorCompanyName: z.string().trim().min(1).nullable().default(null),
  actorHandle: z.string().trim().min(1).nullable().default(null),
  actorProfileUrl: z.string().url().nullable().default(null),
  actorLinkedinPublicId: z.string().trim().min(1).nullable().default(null),
  actorLinkedinMemberId: z.string().trim().min(1).nullable().default(null),
  actorAvatarSourceUrl: z.string().url().nullable().default(null),
  threadUrl: z.string().url().nullable().default(null),
  sourceUrl: z.string().url().nullable().default(null),
  motionId: z.string().min(1).nullable().default(null),
  companyId: z.string().min(1).nullable().default(null),
  prospectId: z.string().min(1).nullable().default(null),
  notes: z.string().trim().min(1).nullable().default(null)
});

export const inboundSyncRunSurfaceInputSchema = z.object({
  surfaceKey: inboundSurfaceKeySchema,
  status: inboundSyncWriteStatusSchema,
  observedAt: z.string().datetime().nullable().default(null),
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
  error: z.string().trim().min(1).nullable().default(null),
  observations: z.array(inboundSyncRunObservationInputSchema).default([])
});

export const inboundSyncRunAccountInputSchema = z.object({
  accountId: z.string().min(1),
  surfaces: z.array(inboundSyncRunSurfaceInputSchema).min(1)
});

export const inboundSyncRunPayloadSchema = z.object({
  mode: inboundSyncPlanModeSchema.default("quick"),
  accounts: z.array(inboundSyncRunAccountInputSchema).min(1)
});

export const gmailInboundThreadCaptureSchema = z.object({
  threadId: z.string().trim().min(1),
  kind: z.enum(["email_reply_received", "email_thread_updated"]).default("email_thread_updated"),
  observedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(280),
  subject: z.string().trim().min(1).nullable().default(null),
  fromName: z.string().trim().min(1).nullable().default(null),
  fromEmail: z.string().trim().min(1).nullable().default(null),
  actorTitle: z.string().trim().min(1).nullable().default(null),
  actorCompanyName: z.string().trim().min(1).nullable().default(null),
  threadUrl: z.string().url().nullable().default(null),
  sourceUrl: z.string().url().nullable().default(null),
  motionId: z.string().min(1).nullable().default(null),
  companyId: z.string().min(1).nullable().default(null),
  prospectId: z.string().min(1).nullable().default(null),
  notes: z.string().trim().min(1).nullable().default(null)
});

export const gmailInboundSyncCaptureSchema = z.object({
  mode: inboundSyncPlanModeSchema.default("quick"),
  status: inboundSyncWriteStatusSchema.default("success"),
  checkedAt: z.string().datetime().nullable().default(null),
  itemCount: z.coerce.number().int().min(0).nullable().default(null),
  error: z.string().trim().min(1).nullable().default(null),
  threads: z.array(gmailInboundThreadCaptureSchema).default([])
});

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
  notes: z.string().trim().min(1).nullable().default(null)
};

export const linkedinSentInvitationCaptureSchema = z.object({
  invitationId: z.string().trim().min(1),
  kind: z.enum(["connection_request_pending", "connection_request_accepted", "connection_request_withdrawn"]).default("connection_request_pending"),
  observedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(280),
  ...linkedinCaptureActorFields
});

export const linkedinReceivedInvitationCaptureSchema = z.object({
  invitationId: z.string().trim().min(1),
  kind: z.enum(["connection_request_received", "connection_request_accepted", "connection_request_declined"]).default("connection_request_received"),
  observedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(280),
  ...linkedinCaptureActorFields
});

export const linkedinMessageThreadCaptureSchema = z.object({
  threadId: z.string().trim().min(1),
  kind: z.enum(["message_received", "thread_updated", "inbound_reply_received"]).default("thread_updated"),
  observedAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(280),
  threadUrl: z.string().url().nullable().default(null),
  ...linkedinCaptureActorFields
});

export const linkedinProfileViewCaptureSchema = z.object({
  viewId: z.string().trim().min(1),
  kind: z.enum(["profile_view_after_touch", "profile_view_received"]).default("profile_view_received"),
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
  error: z.string().trim().min(1).nullable().default(null)
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
  followingList: linkedinSurfaceCaptureSchema.extend({
    items: z.array(linkedinFollowingCaptureSchema).default([])
  })
});
