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

import { buildProspectActionIntents } from "./build-action-intents.js";

/** engagement-lane key → record-state axis */
const BRANCH_STATE = {
  ready: "ready",
  "sent-pending": "connection-requested",
  waiting: "waiting",
  "reply-accepted": "connected",
  blocked: "blocked",
  exhausted: "archived",
};

/**
 * @param {{ prospectPrepLanes: any[], engagementLanes: any[], motionDetails: any[], now?: string }} input
 */
export function buildProspectsViewModel(input) {
  const now = input.now ?? new Date().toISOString();
  const ownerByCompany = new Map();
  const industryByCompany = new Map();
  const premiseByMotion = new Map();

  for (const detail of input.motionDetails ?? []) {
    premiseByMotion.set(detail.motionId, {
      motionId: detail.motionId,
      motionName: detail.motionName,
      motionStatus: detail.motionStatus,
      statement: detail.premise?.statement ?? null,
      truth: detail.premise?.status === "defined" ? "partial" : detail.premise?.status === "checked" ? "checked" : "unchecked",
    });
    for (const company of detail.companies ?? []) {
      if (company.executionIdentity?.user?.label) {
        ownerByCompany.set(company.companyId, company.executionIdentity.user.label);
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

  const inventory = [...merged.values()]
    .map((raw) => shapeProspect(raw, { ownerByCompany, industryByCompany, premiseByMotion, now }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName) || a.name.localeCompare(b.name));

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
    groups,
    all: inventory,
    details,
  };
}

/**
 * @param {any} raw
 * @param {{ ownerByCompany: Map<string,string>, industryByCompany: Map<string,string>, premiseByMotion: Map<string,any>, now?: string }} ctx
 */
function shapeProspect(raw, ctx) {
  const branchKey = raw._engagementKey ?? raw.engagementLane?.key ?? null;
  const signal = pickSignal(raw);
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
    signalTruth: deriveSignalTruth(signalMatchCount, raw.fitConfidence),
    fit: raw.fitConfidence ?? null,
    branch,
    branchLabel: raw.engagementLane?.label ?? null,
    actionIntents: intents,
    owner: ctx.ownerByCompany.get(raw.companyId) ?? null,
    ageLabel: relativeDays(raw.profileViewedAt),
    premise: ctx.premiseByMotion.get(raw.motionId) ?? null,
    whyRelevant: raw.whyRelevant ?? null,
    nextAction: raw.nextAction ?? raw.cadenceState?.nextAction ?? null,
    primaryChannel: raw.primaryChannel ?? raw.cadenceState?.currentStep ?? null,
    hasEmailFallback: Boolean(raw.hasEmailFallback),
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
  };
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
 * @param {any} raw
 * @returns {Array<"linkedin" | "email" | "phone">}
 */
function deriveChannels(raw) {
  const points = Array.isArray(raw.contactPoints) ? raw.contactPoints : [];
  const hasKind = (kind) => points.some((point) => point && point.kind === kind && point.value);
  const out = [];
  if (raw.linkedinProfileUrl || hasKind("linkedin_profile")) out.push("linkedin");
  if (raw.email || hasKind("email")) out.push("email");
  if (hasKind("phone")) out.push("phone");
  return out;
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
