// @ts-check
//
// Transition: promote an inbound person into a tracked prospect.
//
// When you migrate to Exo from prior tooling, in-flight relationships (e.g. 75
// outstanding LinkedIn connection requests) arrive only as inbound observations
// — not prospects. This operation pulls one person into a motion as a prospect
// AND carries their in-flight state, so you resume where you left off instead of
// starting cold:
//
//   sent invitation      → prospect, cadence "connection-requested, awaiting accept" + recorded outbound touch
//   accepted invitation  → prospect, cadence "connected, send first message"
//   reply received       → prospect, cadence "in conversation"
//   follow / profile view → prospect, warmup cadence
//
// All of the person's observations are relinked to the new prospect so future
// inbound (their reply/accept) reconciles to them.
//
// Pure-ish: it mutates motion/company/observation objects and returns them for
// the caller to persist (no direct DB writes).

import { linkCompanyToMotion } from "./link-company-to-motion.js";
import { recordMotionProspect } from "./record-prospect.js";
import { resolveInboundObservationCompany } from "./resolve-inbound-observation-company.js";
import { recordMotionProspectTouch } from "./record-prospect-touch.js";
import { setMotionProspectCadence } from "./set-prospect-cadence.js";
import { companySchema } from "../schema/company.js";
import { isPlaceholderCompanyName } from "../lib/company-name.js";

/**
 * Observation kind → carried state (cadence step + the touch to record).
 * @type {Record<string, { step: string|null, surface: string|null, direction: string, outcome: string, next: string, label: string }>}
 */
const STATE_MAP = {
  connection_request_pending: {
    step: "connection-request",
    surface: "connection_request",
    direction: "outbound",
    outcome: "sent",
    next: "Connection request is outstanding — follow up once it is accepted.",
    label: "connection request awaiting accept",
  },
  connection_request_accepted: {
    step: "direct-message",
    surface: "accept_connection",
    direction: "inbound",
    outcome: "accepted",
    next: "Connection accepted — send the first post-accept message.",
    label: "connected (post-accept)",
  },
  inbound_reply_received: {
    step: "direct-message",
    surface: "inbound_reply",
    direction: "inbound",
    outcome: "replied",
    next: "Live reply — continue the conversation.",
    label: "in conversation",
  },
  message_received: {
    step: "direct-message",
    surface: "inbound_reply",
    direction: "inbound",
    outcome: "replied",
    next: "Live message — continue the conversation.",
    label: "in conversation",
  },
  follow_state_confirmed: {
    step: "connection-request",
    surface: "follow",
    direction: "outbound",
    outcome: "sent",
    next: "Following — warm via recent activity, then connect.",
    label: "following (warmup)",
  },
  profile_view_received: {
    step: "connection-request",
    surface: "profile_view",
    direction: "inbound",
    outcome: "opened-no-reply",
    next: "They viewed your profile — send a connection request.",
    label: "profile view (warm)",
  },
};

const DEFAULT_STATE = {
  step: null,
  surface: null,
  direction: "system",
  outcome: "pending",
  next: "Review this inbound person and choose the next move.",
  label: "inbound",
};

/**
 * @param {{
 *   rawMotion: unknown,
 *   rawCompanies: unknown[],
 *   seedObservation: any,
 *   relatedObservations: any[],
 *   resolvedCompanyProfile?: {
 *     name?: string | null | undefined,
 *     domain?: string | null | undefined,
 *     websiteUrl?: string | null | undefined,
 *     linkedinCompanyUrl?: string | null | undefined,
 *     logoSourceUrl?: string | null | undefined,
 *   } | null | undefined,
 *   now?: string,
 * }} input
 */
export function promoteInboundPersonToProspect(input) {
  const now = input.now ?? new Date().toISOString();
  const seed = input.seedObservation;
  const related = input.relatedObservations?.length ? input.relatedObservations : [seed];
  const motionId = /** @type {any} */ (input.rawMotion).id;

  // 1 — resolve or create the company. Honor any existing company link first,
  // then try to derive one from the inbound payload before falling back.
  const companies = (input.rawCompanies ?? []).map((raw) => companySchema.parse(raw));
  let company = seed.companyId
    ? companies.find((candidate) => candidate.id === seed.companyId) ?? null
    : null;
  let companyCreated = false;
  if (company && isPlaceholderCompanyName(company.name)) {
    company = null;
  }
  if (!company) {
    const resolved = resolveInboundObservationCompany(
      {
        ...seed,
        motionId: seed.motionId ?? motionId,
      },
      companies,
      {
        createIfMissing: true,
        companyProfile: input.resolvedCompanyProfile ?? null,
      },
    );
    company = resolved.company;
    companyCreated = resolved.companyCreated;
  }
  if (!company) {
    throw new Error(`Cannot promote ${(seed.actorName ?? "this person").trim() || "this person"} until a real company is resolved. Shared placeholder company fallback is disabled.`);
  }
  // 2 — link the company to the transition motion (company-side tracking).
  company = linkCompanyToMotion(company, motionId);

  // 3 — record the prospect on the motion (auto-creates the target account).
  const surfaceLabel = humanizeSurface(seed.surfaceKey);
  let motion = recordMotionProspect(input.rawMotion, company, {
    name: (seed.actorName ?? "").trim() || "Unknown person",
    title: (seed.actorTitle ?? "").trim() || "Role unknown",
    linkedinProfileUrl: seed.actorProfileUrl ?? undefined,
    avatarSourceUrl: seed.actorAvatarSourceUrl ?? undefined,
    email: seed.actorHandle && String(seed.actorHandle).includes("@") ? seed.actorHandle : undefined,
    fitConfidence: "moderate",
    whyRelevant: truncate(`Transitioned from ${surfaceLabel} — in-flight before Exo.`, 200),
    observedAt: seed.observedAt ?? now,
    sourceUrl: seed.sourceUrl ?? seed.threadUrl ?? undefined,
  });

  // Find the prospect we just created (match on LinkedIn URL, else name).
  const account = motion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
  const prospect = pickNewProspect(account, seed);
  if (!prospect) {
    throw new Error("Promote failed: prospect was not recorded on the motion.");
  }

  // 4 — carry the in-flight state: record the original touch + set cadence.
  const state = STATE_MAP[seed.kind] ?? DEFAULT_STATE;
  const latestInboundMessage = findLatestStructuredMessage(related, "inbound");
  if (state.surface) {
    motion = recordMotionProspectTouch(motion, company, {
      prospectId: prospect.id,
      surface: state.surface,
      direction: state.direction,
      outcome: state.outcome,
      occurredAt: seed.observedAt ?? now,
      summary: truncate(seed.summary ?? `${surfaceLabel} carried in from transition.`, 240),
      subject: state.direction === "inbound" ? seed.subject ?? null : null,
      body: state.direction === "inbound" ? latestInboundMessage?.body ?? null : null,
      sourceUrl: seed.sourceUrl ?? seed.threadUrl ?? undefined,
    });
  }
  motion = setMotionProspectCadence(motion, company, {
    prospectId: prospect.id,
    currentStep: state.step ?? undefined,
    lastTouchChannel: state.surface === "connection_request" ? "connection-request" : undefined,
    lastTouchOutcome: state.outcome,
    lastTouchAt: seed.observedAt ?? now,
    nextAction: state.next,
  });

  // 5 — relink every observation for this person to the new prospect.
  const observations = related.map((observation) => ({
    ...observation,
    prospectId: prospect.id,
    companyId: company.id,
    motionId: /** @type {any} */ (input.rawMotion).id,
    updatedAt: now,
  }));

  return {
    prospectId: prospect.id,
    prospectName: prospect.name,
    motion,
    company,
    companyCreated,
    observations,
    carriedState: state.label,
    message: `Promoted ${prospect.name} into ${motion.name} as ${state.label}${companyCreated ? ` (created company ${company.name})` : ""}.`,
  };
}

/**
 * @param {any} account
 * @param {any} seed
 */
function pickNewProspect(account, seed) {
  if (!account) return null;
  const prospects = account.prospects ?? [];
  if (seed.actorProfileUrl) {
    const byUrl = prospects.find((p) => p.linkedinProfileUrl === seed.actorProfileUrl);
    if (byUrl) return byUrl;
  }
  const name = (seed.actorName ?? "").trim() || "Unknown person";
  const byName = prospects.filter((p) => p.name === name);
  // Newest matching name (the one we just added).
  return byName.length ? byName[byName.length - 1] : prospects[prospects.length - 1] ?? null;
}

/** @param {string | null | undefined} surfaceKey */
function humanizeSurface(surfaceKey) {
  if (!surfaceKey) return "inbound activity";
  return surfaceKey.replace(/^linkedin-/, "").replace(/^gmail-/, "").replaceAll("-", " ");
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * @param {Array<{ messages?: Array<{ direction?: string | null, sentAt?: string | null, body?: string | null }> | null }>} observations
 * @param {"inbound" | "outbound"} direction
 */
function findLatestStructuredMessage(observations, direction) {
  return observations
    .flatMap((observation) => observation?.messages ?? [])
    .filter((message) =>
      typeof message?.body === "string"
      && message.body.trim().length > 0
      && String(message.direction ?? "").toLowerCase() === direction
    )
    .sort((left, right) => (Date.parse(left.sentAt ?? "") || 0) - (Date.parse(right.sentAt ?? "") || 0))
    .at(-1) ?? null;
}
