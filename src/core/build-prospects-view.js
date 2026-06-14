// @ts-check
//
// Prospects view model (Exo UI Build Spec — canonical people inventory).
//
// Reshapes the workspace projection (prospectPrepLanes + engagementLanes +
// motionDetails) into:
//   - a flat inventory (the dense "All" table)
//   - by-company groups (the "By company" view)
//   - rich per-person detail models (identity, key-facts, signal, premise,
//     recommended next step, colleagues at the same company)
//
// Field vocabulary is aligned with Audienti v10's production prospects surface
// (fit, surfacing signal, branch/stage, assignee, age, same-company targets),
// mapped onto Exo's governed schema. Pure data — no rendering.

import { buildLinkedinProfileUrlFromPublicId } from "../lib/prospect-contacts.js";
import { buildProspectActionIntents } from "./build-action-intents.js";
import { derivePreConnectState } from "./select-linkedin-public-engagement.js";

/** engagement-lane key → record-state axis */
const BRANCH_STATE = {
  ready: "ready",
  "sent-pending": "connection-requested",
  waiting: "waiting",
  "reply-accepted": "reply-accepted",
  blocked: "blocked",
  exhausted: "archived",
};

const CONTACT_VERIFICATION_SCORE = {
  verified: 4,
  observed: 3,
  inferred: 2,
  unknown: 1,
  rejected: 0,
};

const CONTACT_CONFIDENCE_SCORE = {
  high: 4,
  moderate: 3,
  low: 2,
  unknown: 1,
};

/**
 * @param {{ prospectPrepLanes: any[], engagementLanes: any[], motionDetails: any[], now?: string, query?: string | null }} input
 */
export function buildProspectsViewModel(input) {
  const now = input.now ?? new Date().toISOString();
  const ownerByProspect = new Map();
  const ownerByCompany = new Map();
  const industryByCompany = new Map();
  const premiseByMotion = new Map();
  const signalMetaByMotion = new Map();

  for (const detail of input.motionDetails ?? []) {
    premiseByMotion.set(detail.motionId, {
      motionId: detail.motionId,
      motionName: detail.motionName,
      motionStatus: detail.motionStatus,
      statement: detail.premise?.statement ?? null,
      truth: detail.premise?.status === "defined" ? "partial" : detail.premise?.status === "checked" ? "checked" : "unchecked",
    });
    signalMetaByMotion.set(
      detail.motionId,
      new Map(
        (detail.signals ?? []).map((signal) => [
          signal.id,
          {
            id: signal.id,
            question: signal.question ?? signal.name ?? null,
            whyItMatters: signal.whyItMatters ?? defaultSignalWhy(signal),
            scope: signal.scope ?? "company",
          },
        ]),
      ),
    );
    for (const person of detail.people ?? []) {
      if (person.ownerLabel) {
        ownerByProspect.set(person.prospectId, person.ownerLabel);
      }
    }
    for (const company of [...(detail.companies ?? []), ...(detail.backlogCompanies ?? [])]) {
      const ownerLabel = company.executionIdentity?.user?.label ?? null;
      if (ownerLabel) {
        ownerByCompany.set(company.companyId, ownerLabel);
      }
      if (company.domain || company.websiteUrl) {
        industryByCompany.set(company.companyId, company.domain ?? company.websiteUrl);
      }
    }
  }

  // Merge prospects from both lane sets; engagement lane wins for branch state.
  /** @type {Map<string, any>} */
  const merged = new Map();
  const ingest = (laneset, isEngagement) => {
    for (const lane of laneset ?? []) {
      for (const raw of lane.items ?? []) {
        const key = raw.prospectId;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, { ...raw, _engagementKey: isEngagement ? raw.engagementLane?.key ?? lane.key : null });
        } else if (isEngagement && raw.engagementLane?.key) {
          existing._engagementKey = raw.engagementLane.key;
          existing.engagementLane = raw.engagementLane;
          if (!existing.cadenceState && raw.cadenceState) existing.cadenceState = raw.cadenceState;
        }
      }
    }
  };
  ingest(input.prospectPrepLanes, false);
  ingest(input.engagementLanes, true);

  const baseInventory = [...merged.values()]
    .map((raw) => ({
      raw,
      prospect: shapeProspect(raw, { ownerByProspect, ownerByCompany, industryByCompany, premiseByMotion, signalMetaByMotion, now }),
    }))
    .filter(({ raw, prospect }) => shouldIncludeProspect(raw, prospect))
    .map(({ prospect }) => prospect)
    .sort((a, b) => a.companyName.localeCompare(b.companyName) || a.name.localeCompare(b.name));
  const normalizedQuery = normalizeProspectSearchQuery(input.query);
  const totalProspectCount = baseInventory.length;
  const totalCompanyCount = new Set(baseInventory.map((prospect) => prospect.companyId)).size;
  const inventory = normalizedQuery
    ? baseInventory.filter((prospect) => matchesProspectSearchQuery(prospect, normalizedQuery))
    : baseInventory;

  // By-company grouping.
  /** @type {Map<string, any>} */
  const groupMap = new Map();
  for (const prospect of inventory) {
    let group = groupMap.get(prospect.companyId);
    if (!group) {
      group = {
        companyId: prospect.companyId,
        companyName: prospect.companyName,
        industry: prospect.companyIndustry,
        motionName: prospect.motionName,
        companyLinkedinUrl: prospect.companyLinkedinUrl,
        prospects: [],
      };
      groupMap.set(prospect.companyId, group);
    }
    group.prospects.push(prospect);
  }
  const groups = [...groupMap.values()].sort((a, b) => b.prospects.length - a.prospects.length || a.companyName.localeCompare(b.companyName));

  // Person detail models with same-company colleagues.
  const byCompany = new Map();
  for (const prospect of inventory) {
    const list = byCompany.get(prospect.companyId) ?? [];
    list.push(prospect);
    byCompany.set(prospect.companyId, list);
  }
  const details = inventory.map((prospect) => ({
    ...prospect,
    sameCompany: (byCompany.get(prospect.companyId) ?? []).filter((other) => other.id !== prospect.id),
  }));

  return {
    counts: {
      prospects: inventory.length,
      companies: groups.length,
    },
    search: {
      query: normalizeDisplaySearchQuery(input.query),
      active: Boolean(normalizedQuery),
      totalProspects: totalProspectCount,
      totalCompanies: totalCompanyCount,
    },
    groups,
    all: inventory,
    details,
  };
}

/**
 * @param {any} raw
 * @param {{
 *   ownerByProspect: Map<string,string>,
 *   ownerByCompany: Map<string,string>,
 *   industryByCompany: Map<string,string>,
 *   premiseByMotion: Map<string,any>,
 *   signalMetaByMotion: Map<string, Map<string, { id: string, question: string | null, whyItMatters: string, scope: string }>>,
 *   now?: string
 * }} ctx
 */
function shapeProspect(raw, ctx) {
  const branchKey = raw._engagementKey ?? raw.engagementLane?.key ?? null;
  const signal = pickSignal(raw);
  const signalRationale = pickSignalRationale(raw, ctx);
  const signalMatchCount = raw.signalMatchCount ?? (raw.signalMatches ?? []).length;
  const branch = BRANCH_STATE[branchKey] ?? "identified";
  const intents = buildProspectActionIntents(
    {
      prospectId: raw.prospectId,
      companyId: raw.companyId,
      motionId: raw.motionId,
      name: raw.name,
      branch,
      nextAction: raw.nextAction ?? raw.cadenceState?.nextAction ?? null,
      primaryChannel: raw.primaryChannel ?? raw.cadenceState?.currentStep ?? null,
    },
    { now: ctx.now },
  );
  return {
    id: raw.prospectId,
    name: raw.name ?? "Unknown",
    initials: initials(raw.name),
    avatarUrl: raw.avatarUrl ?? raw.avatarSourceUrl ?? null,
    title: raw.title ?? null,
    companyId: raw.companyId,
    companyName: raw.companyName ?? "—",
    companyIndustry: ctx.industryByCompany.get(raw.companyId) ?? domainFromUrl(raw.websiteUrl) ?? "",
    companyLinkedinUrl: raw.linkedinCompanyUrl ?? null,
    linkedinProfileUrl: raw.linkedinProfileUrl ?? null,
    motionId: raw.motionId,
    motionName: raw.motionName ?? null,
    signal,
    signalHref: pickSignalHref(raw),
    signalRationale,
    signalTruth: deriveSignalTruth(signalMatchCount, raw.fitConfidence),
    fit: raw.fitConfidence ?? null,
    branch,
    branchLabel: normalizeBranchLabel(branch, raw.engagementLane?.label ?? null),
    actionIntents: intents,
    owner: ctx.ownerByProspect.get(raw.prospectId) ?? ctx.ownerByCompany.get(raw.companyId) ?? null,
    ageLabel: relativeDays(raw.profileViewedAt),
    premise: ctx.premiseByMotion.get(raw.motionId) ?? null,
    whyRelevant: raw.whyRelevant ?? null,
    nextAction: raw.nextAction ?? raw.cadenceState?.nextAction ?? null,
    cadenceState: raw.cadenceState ?? null,
    primaryChannel: raw.primaryChannel ?? raw.cadenceState?.currentStep ?? null,
    hasEmailFallback: Boolean(raw.hasEmailFallback),
    email: normalizeNonEmptyString(raw.email)
      ?? normalizeNonEmptyString(raw.bestEmailContactPoint?.value ?? raw.bestEmailContactPoint ?? null),
    // At-a-glance set of channels we believe we can reach this person on.
    // Drives the row icons in the prospect list. LinkedIn comes from a profile
    // URL (the most common "we found them" signal); email/phone are derived
    // from typed contact points or the direct email field.
    channels: deriveChannels(raw),
    buyingCommitteeRole: humanize(raw.buyingCommitteeRole),
    decisionAuthority: humanize(raw.decisionAuthority),
    // Recipient Premium signals captured during LinkedIn enrichment.
    recipientPremium: raw.linkedinProfileSnapshot?.isPremium ?? null,
    recipientOpenProfile: raw.linkedinProfileSnapshot?.isOpenProfile ?? null,
    // Network distance from the profile page — the authoritative truth for
    // connection status. 1 = connected (request accepted); 2/3 = not yet.
    connectionDegree: raw.linkedinProfileSnapshot?.connectionDegree ?? null,
    drafts: Array.isArray(raw.drafts) ? raw.drafts : [],
    touches: Array.isArray(raw.touches) ? raw.touches : [],
    capturedPublicActivity: Array.isArray(raw.capturedPublicActivity)
      ? raw.capturedPublicActivity
      : Array.isArray(raw.linkedinProfileSnapshot?.recentPosts)
        ? raw.linkedinProfileSnapshot.recentPosts.slice(0, 5)
        : [],
    publicEngagementSelection: raw.publicEngagementSelection ?? null,
    preConnect: derivePreConnectState(raw, ctx.now),
    timelineNotes: Array.isArray(raw.timelineNotes) ? raw.timelineNotes : [],
    handledNotification: raw.handledNotification ?? null,
  };
}

/**
 * Hide dead-end research artifacts from the prospects surface. If a branch is
 * already archived/exhausted, has no stored reachable channel, and never
 * recorded any touch history, it is not an actionable prospect for the
 * operator-facing list.
 *
 * @param {any} raw
 * @param {ReturnType<typeof shapeProspect>} prospect
 */
function shouldIncludeProspect(raw, prospect) {
  const touchCount = Array.isArray(raw.touches) ? raw.touches.length : 0;
  return !(prospect.branch === "archived" && prospect.channels.length === 0 && touchCount === 0);
}

/**
 * Keep operator-facing branch copy consistent across the prospects index and
 * detail routes. Internal engagement-lane labels are too implementation-flavored.
 *
 * @param {string} branch
 * @param {string | null} label
 */
function normalizeBranchLabel(branch, label) {
  if (branch === "reply-accepted") return "In conversation";
  if (branch === "connection-requested") return "Request sent";
  return label;
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeDisplaySearchQuery(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeProspectSearchQuery(value) {
  return normalizeSearchText(normalizeDisplaySearchQuery(value));
}

/**
 * @param {ReturnType<typeof shapeProspect>} prospect
 * @param {string} normalizedQuery
 * @returns {boolean}
 */
function matchesProspectSearchQuery(prospect, normalizedQuery) {
  if (!normalizedQuery) return true;
  const haystack = buildProspectSearchHaystack(prospect);
  return normalizedQuery.split(" ").every((token) => haystack.includes(token));
}

/**
 * @param {ReturnType<typeof shapeProspect>} prospect
 * @returns {string}
 */
function buildProspectSearchHaystack(prospect) {
  return normalizeSearchText([
    prospect.name,
    prospect.title,
    prospect.companyName,
    prospect.companyIndustry,
    prospect.motionName,
    prospect.signal,
    prospect.signalRationale,
    prospect.whyRelevant,
    prospect.owner,
    prospect.buyingCommitteeRole,
    prospect.decisionAuthority,
    prospect.email,
    prospect.premise?.statement,
    ...(prospect.channels ?? []).flatMap((channel) => [channel.label, channel.value]),
  ].filter(Boolean).join(" "));
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Reachable-channels summary for the prospect list. Returns the channel keys
 * we want to render as icons, in display order (linkedin → email → phone).
 *
 * A channel counts as available when we have *any* identifier for it — even
 * unverified — because the icon row is about "what surfaces could we try",
 * not "what's outreach-grade". The detail page is where verification status
 * gets surfaced.
 *
 * @typedef {{
 *   key: "linkedin" | "email" | "phone",
 *   label: string,
 *   value: string,
 *   href: string,
 *   openInNewTab: boolean
 * }} ProspectChannel
 */

/**
 * @param {any} raw
 * @returns {ProspectChannel[]}
 */
function deriveChannels(raw) {
  const points = Array.isArray(raw.contactPoints) ? raw.contactPoints : [];
  const linkedinPoint = selectBestContactPoint(points, "linkedin_profile");
  const linkedinPublicIdPoint = selectBestContactPoint(points, "linkedin_public_id");
  const emailPoint = selectBestContactPoint(points, "email");
  const phonePoint = selectBestContactPoint(points, "phone");
  const linkedinUrl =
    normalizeNonEmptyString(raw.linkedinProfileUrl)
    ?? normalizeNonEmptyString(linkedinPoint?.value)
    ?? buildLinkedinProfileUrlFromPublicId(linkedinPublicIdPoint?.value ?? null);
  const email = normalizeNonEmptyString(raw.email) ?? normalizeNonEmptyString(emailPoint?.value);
  const phone = normalizeNonEmptyString(phonePoint?.value);
  const out = [];
  if (linkedinUrl) out.push(buildChannel({ key: "linkedin", label: "LinkedIn profile", value: linkedinUrl, href: linkedinUrl }));
  if (email) out.push(buildChannel({ key: "email", label: "Email address", value: email, href: `mailto:${email}` }));
  if (phone) out.push(buildChannel({ key: "phone", label: "Phone number", value: phone, href: buildTelHref(phone) }));
  return out;
}

/**
 * @param {Array<Record<string, any>>} points
 * @param {string} kind
 */
function selectBestContactPoint(points, kind) {
  return points
    .filter((point) => (
      point
      && point.kind === kind
      && normalizeNonEmptyString(point.value)
      && point.matchStatus !== "rejected"
      && point.verificationStatus !== "rejected"
    ))
    .sort(compareContactPoints)[0] ?? null;
}

/**
 * Prefer the contact point that is most likely to be immediately usable, then
 * the most directly observed one.
 *
 * @param {Record<string, any>} left
 * @param {Record<string, any>} right
 */
function compareContactPoints(left, right) {
  return (
    contactPointScore(right) - contactPointScore(left)
    || compareIsoDates(right.observedAt, left.observedAt)
    || String(left.value).localeCompare(String(right.value))
  );
}

/** @param {Record<string, any>} point */
function contactPointScore(point) {
  return (
    (point.usableForOutreach ? 10 : 0)
    + (CONTACT_VERIFICATION_SCORE[/** @type {keyof typeof CONTACT_VERIFICATION_SCORE} */ (point.verificationStatus)] ?? 0)
    + (CONTACT_CONFIDENCE_SCORE[/** @type {keyof typeof CONTACT_CONFIDENCE_SCORE} */ (point.confidence)] ?? 0)
  );
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 */
function compareIsoDates(left, right) {
  const leftTime = left ? Date.parse(left) : NaN;
  const rightTime = right ? Date.parse(right) : NaN;
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return 1;
  if (Number.isNaN(rightTime)) return -1;
  return leftTime - rightTime;
}

/**
 * @param {ProspectChannel} channel
 * @returns {ProspectChannel}
 */
function buildChannel(channel) {
  return {
    ...channel,
    openInNewTab: /^https?:\/\//i.test(channel.href),
  };
}

/** @param {string} value */
function buildTelHref(value) {
  return `tel:${value.replace(/[^+\d]/g, "")}`;
}

/** @param {string | null | undefined} value */
function normalizeNonEmptyString(value) {
  const normalized = value?.toString().trim();
  return normalized ? normalized : null;
}

/** @param {any} raw */
function pickSignal(raw) {
  const match = (raw.signalMatches ?? [])[0];
  if (match?.summary) return match.summary;
  if (raw.liveSignal?.summary) return raw.liveSignal.summary;
  if (raw.triggerWindow?.summary) return raw.triggerWindow.summary;
  if (raw.whyRelevant) return raw.whyRelevant;
  return "No surfacing signal recorded.";
}

/** @param {any} raw */
function pickSignalHref(raw) {
  const matchHref = normalizeNonEmptyString((raw.signalMatches ?? [])[0]?.sourceUrl);
  if (matchHref) return matchHref;

  const liveSignalHref = normalizeNonEmptyString(raw.liveSignal?.url);
  if (liveSignalHref) return liveSignalHref;

  return null;
}

/**
 * @param {any} raw
 * @param {{
 *   signalMetaByMotion: Map<string, Map<string, { id: string, question: string | null, whyItMatters: string, scope: string }>>
 * }} ctx
 */
function pickSignalRationale(raw, ctx) {
  if (raw.whyRelevant) return raw.whyRelevant;
  if (raw.triggerWindow?.whyNowAnchor) return raw.triggerWindow.whyNowAnchor;

  const match = (raw.signalMatches ?? [])[0];
  const signalMeta = match?.signalId
    ? ctx.signalMetaByMotion.get(raw.motionId)?.get(match.signalId) ?? null
    : null;
  if (signalMeta?.whyItMatters) return signalMeta.whyItMatters;

  if (raw.roleTruth?.summary) return raw.roleTruth.summary;
  if (raw.liveSignal?.engagementRationale) return raw.liveSignal.engagementRationale;
  return null;
}

/** @param {{ scope?: string | null }} signal */
function defaultSignalWhy(signal) {
  if (signal.scope === "person") {
    return "A recent role change or hire is concrete evidence the buying motion is live and a real why-now exists.";
  }
  return "Recent, externally observable movement is evidence the premise is live at this company right now.";
}

/**
 * @param {number} matchCount
 * @param {string | null | undefined} fit
 * @returns {"checked" | "partial" | "unchecked"}
 */
function deriveSignalTruth(matchCount, fit) {
  if (matchCount > 0 && fit === "high") return "checked";
  if (matchCount > 0) return "partial";
  return "unchecked";
}

/** @param {string | null | undefined} iso */
function relativeDays(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const days = Math.max(0, Math.round((Date.now() - target.getTime()) / 86_400_000));
  if (days === 0) return "today";
  return `${days}d`;
}

/** @param {string | null | undefined} url */
function domainFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** @param {string | null | undefined} value */
function humanize(value) {
  if (!value) return null;
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** @param {string | null | undefined} value */
function initials(value) {
  if (!value) return "?";
  return value
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
