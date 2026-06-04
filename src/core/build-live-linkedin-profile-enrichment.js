// @ts-check

import { buildCompanyExecutionView } from "./build-company-execution-view.js";
import { buildMotionProspectView } from "./build-motion-prospect-view.js";
import {
  buildChromeProfileSelection,
  buildCodexAgentHandoffTransport,
  shouldUseCodexAgentHandoff
} from "./live-agent-handoff.js";
import {
  buildLinkedinProfilePageSurfaceHint
} from "../lib/live-surface-hints.js";
import {
  buildLinkedinProfileUrlFromPublicId,
  selectBestLinkedinContactPoint
} from "../lib/prospect-contacts.js";
import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";

const LINKEDIN_PROFILE_ENRICHMENT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "capturedAt",
    "profileUrl",
    "publicId",
    "memberId",
    "displayName",
    "currentRoleTitle",
    "currentCompanyName",
    "headline",
    "location",
    "about",
    "followerCount",
    "connectionCount",
    "avatarSourceUrl",
    "recentPosts"
  ],
  properties: {
    capturedAt: { type: ["string", "null"], format: "date-time" },
    profileUrl: { type: ["string", "null"], format: "uri" },
    publicId: { type: ["string", "null"] },
    memberId: { type: ["string", "null"] },
    displayName: { type: ["string", "null"] },
    currentRoleTitle: { type: ["string", "null"] },
    currentCompanyName: { type: ["string", "null"] },
    headline: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    about: { type: ["string", "null"] },
    followerCount: { type: ["integer", "null"], minimum: 0 },
    connectionCount: { type: ["integer", "null"], minimum: 0 },
    avatarSourceUrl: { type: ["string", "null"], format: "uri" },
    isPremium: { type: ["boolean", "null"] },
    isOpenProfile: { type: ["boolean", "null"] },
    connectionDegree: { type: ["integer", "null"], minimum: 1, maximum: 3 },
    recentPosts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["activityType", "url", "postedAt", "freshnessBand", "summary", "snippet"],
        properties: {
          activityType: { type: ["string", "null"] },
          url: { type: ["string", "null"], format: "uri" },
          postedAt: { type: ["string", "null"], format: "date-time" },
          freshnessBand: {
            type: ["string", "null"],
            enum: ["0-14-days", "15-30-days", "31-60-days", "61-90-days", "stale", "unknown", null]
          },
          summary: { type: ["string", "null"] },
          snippet: { type: ["string", "null"] }
        }
      }
    }
  }
};

/**
 * @param {unknown} rawCompany
 * @param {unknown} rawMotion
 * @param {unknown[]} rawProfiles
 * @param {unknown[]} rawUsers
 * @param {{
 *   prospectId: string,
 *   runtime?: string | null,
 *   codexCli?: string | null
 * }} input
 */
export function buildLiveLinkedinProfileEnrichmentView(rawCompany, rawMotion, rawProfiles, rawUsers, input) {
  const company = companySchema.parse(rawCompany);
  const motion = motionSchema.parse(rawMotion);
  const profiles = rawProfiles.map((profile) => browserProfileSchema.parse(profile));
  const prospectView = buildMotionProspectView(motion, {
    companyId: company.id,
    prospectId: input.prospectId
  });

  if (!prospectView.prospect) {
    throw new Error(`Prospect ${input.prospectId} is not targeted in motion ${motion.id}.`);
  }

  const execution = buildCompanyExecutionView(rawCompany, null, rawProfiles, {
    capability: "linkedin",
    rawMotion,
    rawUsers
  });
  const targetProfileUrl = resolveTargetLinkedinProfileUrl(prospectView.prospect);

  if (!targetProfileUrl) {
    throw new Error(`Prospect ${prospectView.prospect.name} does not have a usable LinkedIn profile identity yet.`);
  }

  if (execution.transport.status === "blocked") {
    return {
      company: execution.company,
      motion: execution.motion,
      prospect: normalizeProspectView(prospectView.prospect),
      execution,
      transport: {
        kind: "blocked",
        status: "blocked",
        reason: execution.transport.blocker ?? "No governed LinkedIn execution path exists for this company.",
        captureRequest: null
      }
    };
  }

  const runtime = normalizeNullableString(input.runtime) ?? "codex";
  const prompt = buildLinkedinProfileEnrichmentPrompt({
    companyName: execution.company.name,
    motionName: execution.motion?.name ?? motion.name,
    prospectName: prospectView.prospect.name,
    prospectTitle: prospectView.prospect.title,
    targetProfileUrl,
    preferredTransport: execution.transport.preferredTransport?.tool ?? "chrome"
  });
  const surfaceHints = {
    profilePage: buildLinkedinProfilePageSurfaceHint({
      profileUrl: targetProfileUrl,
      recentPostLimit: 3
    })
  };
  const resolvedProfile = execution.resolvedProfile
    ? profiles.find((candidate) => candidate.id === execution.resolvedProfile.id) ?? null
    : null;

  if (shouldUseCodexAgentHandoff({
    runtime,
    codexCli: input.codexCli ?? null
  })) {
    return {
      company: execution.company,
      motion: execution.motion,
      prospect: normalizeProspectView(prospectView.prospect),
      execution,
      transport: buildCodexAgentHandoffTransport({
        capability: "linkedin",
        runtime,
        connector: "chrome",
        source: "company_execution",
        prompt,
        outputSchema: LINKEDIN_PROFILE_ENRICHMENT_OUTPUT_SCHEMA,
        buildPayloadCommand: `exo companies prospects enrich-linkedin-profile ${company.id} --motion ${motion.id} --prospect ${input.prospectId} --input - --json`,
        applyCommand: null,
        verificationCommands: [
          `exo companies prospects show ${company.id} --motion ${motion.id} --prospect ${input.prospectId} --json`
        ],
        surfaceHints,
        profileSelection: resolvedProfile
          ? buildChromeProfileSelection({
              capability: "linkedin",
              expectedHandle: execution.resolvedAccount?.handle ?? null,
              profile: resolvedProfile
            })
          : null
      })
    };
  }

  return {
    company: execution.company,
    motion: execution.motion,
    prospect: normalizeProspectView(prospectView.prospect),
    execution,
    transport: {
      kind: "capture_plan",
      runtime,
      connector: "chrome",
      source: "company_execution",
      status: "capture_required",
      reason: "The outer agent should inspect the live LinkedIn profile page and land the governed payload through Exo.",
      captureRequest: {
        capability: "linkedin",
        prompt,
        outputSchema: LINKEDIN_PROFILE_ENRICHMENT_OUTPUT_SCHEMA,
        buildPayloadCommand: `exo companies prospects enrich-linkedin-profile ${company.id} --motion ${motion.id} --prospect ${input.prospectId} --input - --json`,
        surfaceHints
      }
    }
  };
}

/**
 * @param {{
 *   linkedinProfileUrl?: string | null,
 *   contactPoints?: Array<{ kind: string, value: string }>
 * }} prospect
 */
function resolveTargetLinkedinProfileUrl(prospect) {
  if (prospect.linkedinProfileUrl) {
    return prospect.linkedinProfileUrl;
  }

  const linkedinProfilePoint = selectBestLinkedinContactPoint(prospect);
  if (linkedinProfilePoint?.value) {
    return linkedinProfilePoint.value;
  }

  const publicIdPoint = (prospect.contactPoints ?? []).find((point) => point.kind === "linkedin_public_id" && point.value);
  if (publicIdPoint?.value) {
    return buildLinkedinProfileUrlFromPublicId(publicIdPoint.value);
  }

  return null;
}

/**
 * @param {{
 *   companyName: string,
 *   motionName: string,
 *   prospectName: string,
 *   prospectTitle: string,
 *   targetProfileUrl: string,
 *   preferredTransport: string
 * }} input
 */
function buildLinkedinProfileEnrichmentPrompt(input) {
  return [
    `Inspect the real LinkedIn profile page for ${input.prospectName} (${input.prospectTitle}) at ${input.companyName}.`,
    `Use the governed target URL first: ${input.targetProfileUrl}`,
    `This work is part of motion ${input.motionName}.`,
    "Use the structured surfaceHints, profileSelection, and captureGuide attached to this capture request as the retrieval, binding, writeback, and verification contract.",
    "Chrome profile display-name drift alone is not a mismatch. If the connector is attached to another Chrome session or signed-in LinkedIn identity, stop with profile_selection_mismatch.",
    "Native-tools only applies to the live browser capture transport. Use captureGuide.writebackRules and verificationCommands for the governed Exo landing path after capture.",
    `Honor the execution plan. Preferred transport is ${input.preferredTransport}. Do not drift to another LinkedIn identity.`,
    "Capture one unified profile payload: stable identity fields, avatar source URL, and the strongest recent posts visible on the page.",
    "Record isPremium=true when a LinkedIn Premium badge is visible on the profile, and isOpenProfile=true when the profile shows Open Profile / Free to message (any Premium member can message them without an InMail credit). Use null when you cannot tell.",
    "Record connectionDegree as the network distance badge shown next to their name: 1 for a 1st-degree connection (you are connected — a connection request was accepted), 2 for 2nd, 3 for 3rd or 3rd+. Use null only if the badge is genuinely not visible. This is the authoritative signal for whether a connection request was accepted.",
    "Inspect the real LinkedIn profile page and recent activity routes directly; do not leave the result in scratch notes or ad hoc JavaScript output.",
    "Keep at most the three strongest recent posts or comments that produce legitimate writing context.",
    "If the page identity renders but recent activity does not, return the identity fields and an empty recentPosts array with no invented filler.",
    "Then send the JSON payload through the provided buildPayloadCommand."
  ].join(" ");
}

/**
 * @param {unknown} value
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * @param {ReturnType<typeof buildMotionProspectView>["prospect"]} prospect
 */
function normalizeProspectView(prospect) {
  return {
    ...prospect,
    id: prospect.prospectId
  };
}
