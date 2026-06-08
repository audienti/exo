// @ts-check

import { z } from "zod";
import { withDerivedTargetAccountQueueState } from "../lib/motion-queue.js";
import { withDerivedProspectContacts } from "../lib/prospect-contacts.js";

const WRITER_SIGNAL_SUMMARY_MAX_LENGTH = 160;
const nullableString = z.string().trim().min(1).nullable();
const confidenceSchema = z.enum(["low", "moderate", "high", "unknown"]);
const stringArray = z.array(z.string().trim().min(1)).default([]);
const channelSchema = z.enum(["connection-request", "direct-message", "inmail", "email", "none"]);
const cadenceStepSchema = z.enum([
  "connection-request",
  "direct-message",
  "inmail",
  "value-add-email",
  "quarterly-retouch",
  "done"
]);
const touchSurfaceSchema = z.enum([
  "connection_request",
  "post_accept_message",
  "follow_up_direct_message",
  "email",
  "inbound_reply",
  "public_comment",
  "comment_reply",
  "profile_view",
  "follow",
  "unfollow",
  "like_post",
  "unlike_post",
  "share_post",
  "in_mail_message",
  "withdraw_connection",
  "accept_connection",
  "decline_connection",
  "create_comment_reaction",
  "voicemail_outreach",
  "video_outreach"
]);
const touchDirectionSchema = z.enum(["outbound", "inbound", "system"]);
const touchOutcomeSchema = z.enum([
  "pending",
  "sent",
  "accepted",
  "ignored",
  "opened-no-reply",
  "replied",
  "blocked",
  "nurture"
]);
const buyingCommitteeRoleSchema = z.enum([
  "primary_business_owner",
  "primary_technical_owner",
  "economic_buyer",
  "commercial_owner",
  "risk_blocker",
  "technical_evaluator",
  "executive_sponsor",
  "operator_champion",
  "other"
]);
const decisionAuthoritySchema = z.enum(["buys", "blocks", "sponsors", "influences", "observes", "unknown"]);
const tenureBandSchema = z.enum(["under-6-months", "6-to-24-months", "24-to-60-months", "60-plus-months", "unknown"]);
const freshnessBandSchema = z.enum(["0-14-days", "15-30-days", "31-60-days", "61-90-days", "stale", "unknown"]);
const publicEngagementTargetKindSchema = z.enum(["post", "comment"]);
const publicEngagementRecommendationSchema = z.enum(["reaction", "comment"]);
const contactPointKindSchema = z.enum([
  "linkedin_profile",
  "linkedin_public_id",
  "linkedin_member_id",
  "email",
  "phone",
  "x_profile",
  "instagram_profile",
  "facebook_profile",
  "tiktok_profile",
  "reddit_profile",
  "website",
  "generic_contact"
]);
const contactPointMatchStatusSchema = z.enum([
  "same_person_verified",
  "same_person_probable",
  "same_person_possible",
  "rejected"
]);
const contactPointVerificationStatusSchema = z.enum([
  "verified",
  "observed",
  "inferred",
  "rejected",
  "unknown"
]);
export const queueStatusSchema = z.enum([
  "discovered",
  "queued_for_research",
  "researched",
  "selected",
  "ready",
  "suppressed",
  "exhausted"
]);

export const signalMatchSubjectSchema = z.object({
  type: z.enum(["company", "person"]),
  personName: nullableString,
  personTitle: nullableString
}).superRefine((subject, context) => {
  if (subject.type === "company" && (subject.personName || subject.personTitle)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Company signal-match subjects cannot carry person details."
    });
  }

  if (subject.type === "person" && !subject.personName && !subject.personTitle) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Person signal-match subjects must include a person name or title."
    });
  }
});

export const signalMatchSchema = z.object({
  id: z.string().min(1),
  signalId: z.string().min(1),
  signalName: z.string().trim().min(1),
  signalScope: z.enum(["company", "person", "both"]),
  summary: z.string().trim().min(1).max(WRITER_SIGNAL_SUMMARY_MAX_LENGTH),
  sourceUrl: z.string().url().nullable(),
  sourceLabel: nullableString,
  observedAt: z.string().datetime().nullable(),
  recordedAt: z.string().datetime(),
  confidence: confidenceSchema,
  evidenceSnippet: nullableString,
  notes: nullableString,
  subject: signalMatchSubjectSchema
});

export const legacyStakeholderSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  linkedinProfileUrl: z.string().url().nullable(),
  email: z.string().email().nullable().default(null),
  roleType: z.enum(["primary-owner", "adjacent-operator", "sponsor", "other"]),
  fitConfidence: confidenceSchema,
  whyRelevant: z.string().trim().min(1).max(200),
  sourceUrl: z.string().url().nullable(),
  observedAt: z.string().datetime().nullable(),
  profileViewedAt: z.string().datetime().nullable().default(null),
  recentActivityChannel: z.string().trim().min(1).max(60).nullable().default(null),
  recentActivitySummary: z.string().trim().min(1).max(200).nullable().default(null),
  recentActivityUrl: z.string().url().nullable().default(null),
  recentActivityObservedAt: z.string().datetime().nullable().default(null),
  recentActivityEngagementRationale: z.string().trim().min(1).max(200).nullable().default(null),
  notes: nullableString,
  signalMatchIds: stringArray
});

export const legacyOutreachPlanSchema = z.object({
  status: z.enum(["pending", "ready"]).default("pending"),
  primaryStakeholderId: z.string().min(1).nullable().default(null),
  stakeholderIds: stringArray,
  signalMatchIds: stringArray,
  whyNow: z.string().trim().min(1).nullable().default(null),
  angle: z.string().trim().min(1).nullable().default(null),
  replyPath: z.string().trim().min(1).nullable().default(null),
  primaryChannel: channelSchema.nullable().default(null),
  fallbackChannel: channelSchema.nullable().default(null),
  fallbackTrigger: z.string().trim().min(1).nullable().default(null),
  preflightActions: stringArray,
  firstMove: z.string().trim().min(1).nullable().default(null),
  firstMessageGoal: z.string().trim().min(1).nullable().default(null),
  talkingPoints: stringArray,
  notes: z.string().trim().min(1).nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null)
});

export const roleTruthSchema = z.object({
  currentRoleDescription: nullableString.default(null),
  summary: nullableString.default(null),
  operatingMode: nullableString.default(null),
  scope: nullableString.default(null),
  evidence: stringArray
});

export const triggerWindowSchema = z.object({
  summary: nullableString.default(null),
  tenureMonths: z.number().int().min(0).nullable().default(null),
  tenureBand: tenureBandSchema.nullable().default(null),
  whyNowAnchor: nullableString.default(null),
  personTriggers: stringArray,
  companyTriggers: stringArray
});

export const identityTellsSchema = z.object({
  summary: nullableString.default(null),
  headline: nullableString.default(null),
  aboutQuotes: stringArray,
  frameworks: stringArray,
  certifications: stringArray,
  quantifiedReceipts: stringArray,
  selfImageVerbs: stringArray,
  metaphors: stringArray
});

export const liveSignalSchema = z.object({
  channel: nullableString.default(null),
  activityType: nullableString.default(null),
  summary: nullableString.default(null),
  url: z.string().url().nullable().default(null),
  observedAt: z.string().datetime().nullable().default(null),
  freshnessBand: freshnessBandSchema.nullable().default(null),
  hookStrength: confidenceSchema.nullable().default(null),
  engagementRationale: nullableString.default(null)
});

export const linkedinRecentPostSchema = z.object({
  activityType: nullableString.default(null),
  url: z.string().url().nullable().default(null),
  postedAt: z.string().datetime().nullable().default(null),
  freshnessBand: freshnessBandSchema.nullable().default(null),
  summary: nullableString.default(null),
  snippet: nullableString.default(null),
  targetKind: publicEngagementTargetKindSchema.nullable().default(null),
  authoredByProspect: z.boolean().nullable().default(null),
  hasOriginalCommentary: z.boolean().nullable().default(null),
  businessRelevance: confidenceSchema.nullable().default(null),
  recommendedAction: publicEngagementRecommendationSchema.nullable().default(null),
  rationale: nullableString.default(null)
});

export const publicEngagementSelectionSchema = z.object({
  url: z.string().url(),
  targetKind: publicEngagementTargetKindSchema,
  activityType: nullableString.default(null),
  postedAt: z.string().datetime().nullable().default(null),
  freshnessBand: freshnessBandSchema.nullable().default(null),
  summary: nullableString.default(null),
  snippet: nullableString.default(null),
  businessRelevance: confidenceSchema.nullable().default(null),
  recommendedAction: publicEngagementRecommendationSchema.nullable().default(null),
  rationale: nullableString.default(null),
  selectionReason: nullableString.default(null),
  selectedAt: z.string().datetime().nullable().default(null)
});

export const linkedinProfileSnapshotSchema = z.object({
  capturedAt: z.string().datetime().nullable().default(null),
  profileUrl: z.string().url().nullable().default(null),
  avatarSourceUrl: z.string().url().nullable().default(null),
  avatarChecked: z.boolean().default(false),
  publicId: nullableString.default(null),
  memberId: nullableString.default(null),
  displayName: nullableString.default(null),
  currentRoleTitle: nullableString.default(null),
  currentCompanyName: nullableString.default(null),
  headline: nullableString.default(null),
  location: nullableString.default(null),
  about: nullableString.default(null),
  followerCount: z.number().int().min(0).nullable().default(null),
  connectionCount: z.number().int().min(0).nullable().default(null),
  // Premium signals read off the profile page during enrichment:
  // isPremium  — a LinkedIn Premium badge is visible on the profile.
  // isOpenProfile — Open Profile is on, so any Premium member can DM them free
  //   (no InMail credit, no Sales Navigator required).
  isPremium: z.boolean().nullable().default(null),
  isOpenProfile: z.boolean().nullable().default(null),
  // Network distance badge shown next to their name: 1 = 1st-degree (you are
  // connected — i.e. a connection request was accepted), 2 = 2nd, 3 = 3rd/3rd+.
  // This is the AUTHORITATIVE truth for connection status: if there is ever a
  // dispute about whether a request was accepted, the degree settles it.
  // 1st ⇒ accepted/connected; anything else ⇒ not yet, still in the sent queue.
  connectionDegree: z.number().int().min(1).max(3).nullable().default(null),
  recentPosts: z.array(linkedinRecentPostSchema).default([])
});

export const contactPointEvidenceSchema = z.object({
  type: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  sourceUrl: z.string().url().nullable().default(null),
  observedAt: z.string().datetime().nullable().default(null)
});

export const contactPointSchema = z.object({
  id: z.string().min(1),
  kind: contactPointKindSchema,
  value: z.string().trim().min(1),
  label: nullableString.default(null),
  matchStatus: contactPointMatchStatusSchema.default("same_person_possible"),
  verificationStatus: contactPointVerificationStatusSchema.default("unknown"),
  confidence: confidenceSchema.default("unknown"),
  source: nullableString.default(null),
  sourceUrl: z.string().url().nullable().default(null),
  observedAt: z.string().datetime().nullable().default(null),
  notes: nullableString.default(null),
  evidence: z.array(contactPointEvidenceSchema).default([]),
  usableForOutreach: z.boolean().default(false),
  usableForResearch: z.boolean().default(true),
  usableForWarmup: z.boolean().default(false)
});

export const contactEnrichmentStateSchema = z.object({
  status: z.enum(["pending", "in_progress", "complete", "exhausted"]).default("pending"),
  sourcesTried: stringArray,
  missingChannels: stringArray,
  bestDirectChannels: stringArray,
  lastEnrichedAt: z.string().datetime().nullable().default(null),
  notes: nullableString.default(null)
});

export const queueStateSchema = z.object({
  status: queueStatusSchema.default("discovered"),
  source: z.enum(["derived", "manual"]).default("derived"),
  updatedAt: z.string().datetime().nullable().default(null),
  notes: nullableString.default(null)
});

export const packetStateSchema = z.object({
  kind: z.enum(["company_research", "prospect_selection", "prospect_research"]),
  status: z.enum(["claimed", "completed"]),
  workerLabel: nullableString.default(null),
  claimedAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
  notes: nullableString.default(null)
});

export const cadenceStateSchema = z.object({
  status: z.enum(["pending", "ready"]).default("pending"),
  currentStep: cadenceStepSchema.nullable().default(null),
  lastTouchChannel: channelSchema.nullable().default(null),
  lastTouchOutcome: touchOutcomeSchema.nullable().default(null),
  lastTouchAt: z.string().datetime().nullable().default(null),
  nextAction: nullableString.default(null),
  nextActionDueAt: z.string().datetime().nullable().default(null),
  blockedChannels: stringArray,
  requireNewHook: z.boolean().default(false),
  notes: nullableString.default(null),
  updatedAt: z.string().datetime().nullable().default(null)
});

export const touchSchema = z.object({
  id: z.string().min(1),
  surface: touchSurfaceSchema,
  direction: touchDirectionSchema,
  outcome: touchOutcomeSchema,
  occurredAt: z.string().datetime(),
  summary: z.string().trim().min(1).max(240),
  subject: nullableString.default(null),
  body: nullableString.default(null),
  sourceUrl: z.string().url().nullable().default(null),
  notes: nullableString.default(null)
});

// A message draft for one outreach surface. The core agent writes the body
// (and subject for email/inmail). `ready` means written but not sendable yet;
// `queued` means send-ready under agent policy; `approved` means explicitly
// operator-reviewed and send-ready; `sent` and `discarded` are terminal.
export const prospectDraftStatusSchema = z.enum(["drafting", "ready", "queued", "approved", "sent", "discarded"]);
export const prospectDraftChannelSchema = z.enum(["linkedin", "email"]);
export const prospectDraftSchema = z.object({
  id: z.string().min(1),
  surface: touchSurfaceSchema,
  channel: prospectDraftChannelSchema,
  subject: nullableString.default(null),
  body: z.string().default(""),
  status: prospectDraftStatusSchema.default("drafting"),
  authoredBy: z.enum(["agent", "operator"]).default("agent"),
  editedByOperator: z.boolean().default(false),
  approvedByOperator: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable().default(null),
  sentAt: z.string().datetime().nullable().default(null),
  notes: nullableString.default(null)
});

// Operator-authored timeline entries. A "note" is context/observation; a
// "steer" is a directive for the agent (what to do or avoid on the next action).
// Both render as timestamped entries in the engagement timeline.
export const prospectTimelineNoteKindSchema = z.enum(["note", "steer", "system"]);
export const prospectTimelineNoteSchema = z.object({
  id: z.string().min(1),
  kind: prospectTimelineNoteKindSchema.default("note"),
  body: z.string().trim().min(1).max(2000),
  author: nullableString.default(null),
  createdAt: z.string().datetime()
});

export const prospectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  linkedinProfileUrl: z.string().url().nullable(),
  avatarSourceUrl: z.string().url().nullable().default(null),
  avatarUrl: z.string().url().nullable().default(null),
  email: z.string().email().nullable().default(null),
  buyingCommitteeRole: buyingCommitteeRoleSchema.default("other"),
  decisionAuthority: decisionAuthoritySchema.default("unknown"),
  fitConfidence: confidenceSchema.default("unknown"),
  whyRelevant: z.string().trim().min(1).max(200),
  sourceUrl: z.string().url().nullable(),
  observedAt: z.string().datetime().nullable(),
  profileViewedAt: z.string().datetime().nullable().default(null),
  roleTruth: roleTruthSchema.default({}),
  triggerWindow: triggerWindowSchema.default({}),
  identityTells: identityTellsSchema.default({}),
  linkedinProfileSnapshot: linkedinProfileSnapshotSchema.default({}),
  liveSignal: liveSignalSchema.default({}),
  publicEngagementSelection: publicEngagementSelectionSchema.nullable().default(null),
  contactPoints: z.array(contactPointSchema).default([]),
  contactEnrichmentState: contactEnrichmentStateSchema.default({}),
  queueState: queueStateSchema.default({ status: "selected" }),
  packetState: packetStateSchema.nullable().default(null),
  notes: nullableString.default(null),
  signalMatchIds: stringArray,
  touches: z.array(touchSchema).default([]),
  cadenceState: cadenceStateSchema.default({}),
  drafts: z.array(prospectDraftSchema).default([]),
  timelineNotes: z.array(prospectTimelineNoteSchema).default([])
});

export const targetAccountSchema = z.object({
  companyId: z.string().min(1),
  companyName: z.string().trim().min(1),
  domain: nullableString,
  websiteUrl: z.string().url().nullable(),
  linkedinCompanyUrl: z.string().url().nullable(),
  companyLogoSourceUrl: z.string().url().nullable().default(null),
  companyLogoUrl: z.string().url().nullable().default(null),
  signalMatches: z.array(signalMatchSchema).default([]),
  prospects: z.array(prospectSchema).default([]),
  queueState: queueStateSchema.default({}),
  packetState: packetStateSchema.nullable().default(null),
  lastResearchAt: z.string().datetime().nullable(),
  notes: z.string().nullable().default(null)
});

/**
 * @param {unknown} rawAccount
 * @returns {import("./target-account.js").targetAccountSchema._type}
 */
export function rehydrateTargetAccount(rawAccount) {
  if (!rawAccount || typeof rawAccount !== "object" || Array.isArray(rawAccount)) {
    throw new Error("Target-account payload must be an object.");
  }

  const source = /** @type {Record<string, any>} */ (rawAccount);
  const signalMatches = z.array(signalMatchSchema).parse(source.signalMatches ?? []);
  const prospects = Array.isArray(source.prospects)
    ? z.array(prospectSchema).parse(source.prospects.map((prospect) => withDerivedProspectContacts(prospect)))
    : buildProspectsFromLegacy(source, signalMatches);

  return targetAccountSchema.parse(withDerivedTargetAccountQueueState({
    companyId: source.companyId,
    companyName: source.companyName,
    domain: source.domain ?? null,
    websiteUrl: source.websiteUrl ?? null,
    linkedinCompanyUrl: source.linkedinCompanyUrl ?? null,
    companyLogoSourceUrl: source.companyLogoSourceUrl ?? null,
    companyLogoUrl: source.companyLogoUrl ?? null,
    signalMatches,
    prospects,
    queueState: source.queueState ?? {},
    packetState: source.packetState ?? null,
    lastResearchAt: source.lastResearchAt ?? null,
    notes: source.notes ?? null
  }));
}

/**
 * @param {Record<string, any>} source
 * @param {import("./target-account.js").signalMatchSchema._type[]} signalMatches
 * @returns {import("./target-account.js").prospectSchema._type[]}
 */
function buildProspectsFromLegacy(source, signalMatches) {
  const stakeholders = z.array(legacyStakeholderSchema).parse(source.stakeholders ?? []);
  const legacyPlan = legacyOutreachPlanSchema.parse(source.outreachPlan ?? {});
  const prospects = stakeholders.map((stakeholder) => prospectSchema.parse(withDerivedProspectContacts({
    id: stakeholder.id,
    name: stakeholder.name,
    title: stakeholder.title,
    linkedinProfileUrl: stakeholder.linkedinProfileUrl,
    avatarSourceUrl: null,
    avatarUrl: null,
    email: stakeholder.email,
    buyingCommitteeRole: mapLegacyRoleType(stakeholder.roleType),
    decisionAuthority: mapLegacyDecisionAuthority(stakeholder.roleType),
    fitConfidence: stakeholder.fitConfidence,
    whyRelevant: stakeholder.whyRelevant,
    sourceUrl: stakeholder.sourceUrl,
    observedAt: stakeholder.observedAt,
    profileViewedAt: stakeholder.profileViewedAt,
    roleTruth: {},
    triggerWindow: {},
    identityTells: {},
    liveSignal: {
      channel: stakeholder.recentActivityChannel,
      activityType: stakeholder.recentActivitySummary ? "recent-activity" : null,
      summary: stakeholder.recentActivitySummary,
      url: stakeholder.recentActivityUrl,
      observedAt: stakeholder.recentActivityObservedAt,
      freshnessBand: null,
      hookStrength: null,
      engagementRationale: stakeholder.recentActivityEngagementRationale
    },
    notes: stakeholder.notes,
    signalMatchIds: stakeholder.signalMatchIds,
    touches: [],
    cadenceState: {}
  })));

  if (legacyPlan.status !== "ready" || !legacyPlan.primaryStakeholderId) {
    return prospects;
  }

  const primaryIndex = prospects.findIndex((prospect) => prospect.id === legacyPlan.primaryStakeholderId);
  if (primaryIndex === -1) {
    return prospects;
  }

  const primary = prospects[primaryIndex];
  const mergedSignalMatchIds = [...new Set([...primary.signalMatchIds, ...legacyPlan.signalMatchIds])];
  const compressionLine = buildLegacyCompressionLine(primary, legacyPlan);

  prospects[primaryIndex] = prospectSchema.parse({
    ...primary,
    signalMatchIds: mergedSignalMatchIds,
    cadenceState: {
      status: "pending",
      currentStep: legacyPlan.primaryChannel === "connection-request" ? "connection-request" : null,
      lastTouchChannel: null,
      lastTouchOutcome: null,
      lastTouchAt: null,
      nextAction: legacyPlan.firstMove,
      nextActionDueAt: null,
      blockedChannels: [],
      requireNewHook: false,
      notes: compressionLine ?? legacyPlan.replyPath ?? legacyPlan.notes,
      updatedAt: legacyPlan.updatedAt
    }
  });

  return prospects;
}

/**
 * @param {import("./target-account.js").prospectSchema._type} prospect
 * @param {import("./target-account.js").legacyOutreachPlanSchema._type} legacyPlan
 */
function buildLegacyCompressionLine(prospect, legacyPlan) {
  const fragments = [
    prospect.whyRelevant,
    legacyPlan.whyNow,
    legacyPlan.replyPath
  ].filter(Boolean);
  return fragments.length ? fragments.join(" ") : null;
}

/**
 * @param {"primary-owner" | "adjacent-operator" | "sponsor" | "other"} roleType
 */
function mapLegacyRoleType(roleType) {
  switch (roleType) {
    case "primary-owner":
      return "primary_business_owner";
    case "adjacent-operator":
      return "operator_champion";
    case "sponsor":
      return "executive_sponsor";
    default:
      return "other";
  }
}

/**
 * @param {"primary-owner" | "adjacent-operator" | "sponsor" | "other"} roleType
 */
function mapLegacyDecisionAuthority(roleType) {
  switch (roleType) {
    case "primary-owner":
      return "influences";
    case "adjacent-operator":
      return "influences";
    case "sponsor":
      return "sponsors";
    default:
      return "unknown";
  }
}
