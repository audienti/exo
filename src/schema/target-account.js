// @ts-check

import { z } from "zod";

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

export const throughLineSchema = z.object({
  status: z.enum(["pending", "ready"]).default("pending"),
  specificToThem: nullableString.default(null),
  sharedProblem: nullableString.default(null),
  whyNow: nullableString.default(null),
  legitimateWedge: nullableString.default(null),
  compressionLine: nullableString.default(null),
  signalMatchIds: stringArray,
  updatedAt: z.string().datetime().nullable().default(null)
});

export const openingPlanSchema = z.object({
  status: z.enum(["pending", "ready"]).default("pending"),
  supportingProspectIds: stringArray,
  signalMatchIds: stringArray,
  whyNow: nullableString.default(null),
  angle: nullableString.default(null),
  replyPath: nullableString.default(null),
  primaryChannel: channelSchema.nullable().default(null),
  fallbackChannel: channelSchema.nullable().default(null),
  fallbackTrigger: nullableString.default(null),
  preflightActions: stringArray,
  firstMove: nullableString.default(null),
  firstMessageGoal: nullableString.default(null),
  talkingPoints: stringArray,
  notes: nullableString.default(null),
  updatedAt: z.string().datetime().nullable().default(null)
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

export const prospectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  linkedinProfileUrl: z.string().url().nullable(),
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
  liveSignal: liveSignalSchema.default({}),
  notes: nullableString.default(null),
  signalMatchIds: stringArray,
  touches: z.array(touchSchema).default([]),
  throughLine: throughLineSchema.default({}),
  openingPlan: openingPlanSchema.default({}),
  cadenceState: cadenceStateSchema.default({})
});

export const targetAccountSchema = z.object({
  companyId: z.string().min(1),
  companyName: z.string().trim().min(1),
  domain: nullableString,
  websiteUrl: z.string().url().nullable(),
  linkedinCompanyUrl: z.string().url().nullable(),
  signalMatches: z.array(signalMatchSchema).default([]),
  prospects: z.array(prospectSchema).default([]),
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
    ? z.array(prospectSchema).parse(source.prospects)
    : buildProspectsFromLegacy(source, signalMatches);

  return targetAccountSchema.parse({
    companyId: source.companyId,
    companyName: source.companyName,
    domain: source.domain ?? null,
    websiteUrl: source.websiteUrl ?? null,
    linkedinCompanyUrl: source.linkedinCompanyUrl ?? null,
    signalMatches,
    prospects,
    lastResearchAt: source.lastResearchAt ?? null,
    notes: source.notes ?? null
  });
}

/**
 * @param {Record<string, any>} source
 * @param {import("./target-account.js").signalMatchSchema._type[]} signalMatches
 * @returns {import("./target-account.js").prospectSchema._type[]}
 */
function buildProspectsFromLegacy(source, signalMatches) {
  const stakeholders = z.array(legacyStakeholderSchema).parse(source.stakeholders ?? []);
  const legacyPlan = legacyOutreachPlanSchema.parse(source.outreachPlan ?? {});
  const prospects = stakeholders.map((stakeholder) => prospectSchema.parse({
    id: stakeholder.id,
    name: stakeholder.name,
    title: stakeholder.title,
    linkedinProfileUrl: stakeholder.linkedinProfileUrl,
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
    throughLine: {},
    openingPlan: {},
    cadenceState: {}
  }));

  if (legacyPlan.status !== "ready" || !legacyPlan.primaryStakeholderId) {
    return prospects;
  }

  const prospectIds = new Set(prospects.map((prospect) => prospect.id));
  const primaryIndex = prospects.findIndex((prospect) => prospect.id === legacyPlan.primaryStakeholderId);
  if (primaryIndex === -1) {
    return prospects;
  }

  const primary = prospects[primaryIndex];
  const supportingProspectIds = legacyPlan.stakeholderIds.filter((id) => id !== primary.id && prospectIds.has(id));
  const mergedSignalMatchIds = [...new Set([...primary.signalMatchIds, ...legacyPlan.signalMatchIds])];
  const compressionLine = buildLegacyCompressionLine(primary, legacyPlan);

  prospects[primaryIndex] = prospectSchema.parse({
    ...primary,
    signalMatchIds: mergedSignalMatchIds,
    throughLine: {
      status: legacyPlan.whyNow || legacyPlan.angle || legacyPlan.replyPath ? "ready" : "pending",
      specificToThem: primary.whyRelevant,
      sharedProblem: legacyPlan.angle,
      whyNow: legacyPlan.whyNow,
      legitimateWedge: legacyPlan.replyPath,
      compressionLine,
      signalMatchIds: legacyPlan.signalMatchIds,
      updatedAt: legacyPlan.updatedAt
    },
    openingPlan: {
      status: "ready",
      supportingProspectIds,
      signalMatchIds: legacyPlan.signalMatchIds,
      whyNow: legacyPlan.whyNow,
      angle: legacyPlan.angle,
      replyPath: legacyPlan.replyPath,
      primaryChannel: legacyPlan.primaryChannel,
      fallbackChannel: legacyPlan.fallbackChannel,
      fallbackTrigger: legacyPlan.fallbackTrigger,
      preflightActions: legacyPlan.preflightActions,
      firstMove: legacyPlan.firstMove,
      firstMessageGoal: legacyPlan.firstMessageGoal,
      talkingPoints: legacyPlan.talkingPoints,
      notes: legacyPlan.notes,
      updatedAt: legacyPlan.updatedAt
    },
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
      notes: null,
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
