// @ts-check
//
// Connections view model (Exo UI Build Spec — first-class inbound truth).
//
// Inbound relationship truth as a first-class domain (not buried in activity):
// tabs for received / sent / following / followers / views, each an itemized
// list of people with tab-specific actions and per-surface freshness. Surfaces
// each carry the Empty / Partial / Failed distinction explicitly.
//
// Pure data — no rendering.

import { deriveLinkedinRelativeEventAt } from "../lib/linkedin-relative-time.js";
import { isStalePendingConnectionRequest } from "../lib/cadence-helpers.js";
import { isPrivateModeAggregateProfileViewObservation } from "./build-inbox-view.js";

const TABS = [
  { key: "received", label: "Received", icon: "userPlus", surfaceKey: "linkedin-received-invitations" },
  { key: "sent", label: "Sent", icon: "arrowR", surfaceKey: "linkedin-sent-invitations" },
  { key: "following", label: "Following", icon: "link", surfaceKey: "linkedin-following-list" },
  { key: "followers", label: "Followers", icon: "users", surfaceKey: "linkedin-followers-list" },
  { key: "views", label: "Views", icon: "eye", surfaceKey: "linkedin-profile-views" },
];

const TAB_ACTION = {
  received: "accept-decline",
  sent: "withdraw",
  following: "unfollow",
  followers: "follow-back",
  views: "connect",
};

const PRESENT_KINDS_BY_TAB = {
  received: new Set(["connection_request_received"]),
  sent: new Set(["connection_request_pending", "connection_request_withdraw_requested"]),
  following: new Set(["follow_state_confirmed", "follow_state_changed"]),
  followers: new Set(["follower_confirmed", "follower_added"]),
  views: new Set(["profile_view_received"]),
};

/**
 * @param {{
 *   reviewItems?: any[],
 *   observations?: any[],
 *   truthAccounts: any[],
 *   agentQueue?: { tasks?: any[], items?: any[] } | null,
 *   degreeByProfile?: Map<string, { degree: number, prospectId?: string|null }> | Record<string, { degree: number, prospectId?: string|null }>,
 *   sentAtByProfile?: Map<string, string> | Record<string, string>
 * }} input
 */
export function buildConnectionsViewModel(input) {
  const observations = (input.observations ?? input.reviewItems ?? [])
    .filter((item) => item && !isPrivateModeAggregateProfileViewObservation(item));
  // Profile-URL → captured connection degree (the authoritative truth for
  // connection status). 1st-degree ⇒ connected/accepted, regardless of which
  // surface the person was itemized on.
  const degreeByProfile =
    input.degreeByProfile instanceof Map
      ? input.degreeByProfile
      : new Map(Object.entries(input.degreeByProfile ?? {}));
  // Profile-URL → the exact moment Exo itself sent the connection request,
  // taken from our own outbound touch record. This is authoritative and precise
  // — far better than LinkedIn's rounded "Sent X ago" label — so the Sent tab
  // prefers it whenever the invitee maps to a prospect we sent from here.
  const sentAtByProfile =
    input.sentAtByProfile instanceof Map
      ? input.sentAtByProfile
      : new Map(Object.entries(input.sentAtByProfile ?? {}));
  const profileViewAfterTouchByIdentity = buildProfileViewAfterTouchIndex(observations);
  const surfaceByKey = new Map();
  for (const account of input.truthAccounts ?? []) {
    for (const surface of account.surfaces ?? []) {
      surfaceByKey.set(surface.key, { surface, account });
    }
  }
  const repairTaskBySurfaceKey = buildRepairTaskIndex(input.agentQueue ?? null);

  const tabs = TABS.map((tab) => {
    const entry = surfaceByKey.get(tab.surfaceKey);
    const surface = entry?.surface ?? null;
    const truth = surface ? mapSurfaceTruth(surface.lastRunStatus, surface.meta) : "unchecked";
    let items = observations.filter((item) =>
      item.surfaceKey === tab.surfaceKey && PRESENT_KINDS_BY_TAB[tab.key]?.has(item.kind),
    );
    if (tab.key === "received") {
      items = items.filter((item) => resolutionOf(item, lookupDegree(item, degreeByProfile).degree) === "pending");
    }
    const people = items
      .map((item) => shapePerson(item, degreeByProfile, tab.key, sentAtByProfile, profileViewAfterTouchByIdentity))
      .sort((a, b) => comparePeopleForTab(a, b, tab.key));
    const gapState = deriveGapState(surface, people.length);

    return {
      key: tab.key,
      label: tab.label,
      icon: tab.icon,
      surfaceKey: tab.surfaceKey,
      action: TAB_ACTION[tab.key],
      count: people.length,
      truth,
      lastChecked: relative(surface?.lastSyncedAt ?? surface?.lastObservedAt),
      gap: gapState.message,
      gapKind: gapState.kind,
      autoRepairable: gapState.autoRepairable,
      repairTask: gapState.autoRepairable ? repairTaskBySurfaceKey.get(tab.surfaceKey) ?? null : null,
      title: tabTitle(tab.key),
      filters: tab.key === "sent" ? buildSentFilters(people) : null,
      people,
    };
  });

  // Surface freshness footer — every itemizable surface plus messaging/email.
  const extraKeys = ["linkedin-messaging-inbox", "linkedin-comment-replies", "gmail-inbox-threads", "linkedin-catch-up-updates"];
  const freshness = [
    ...TABS.map((tab) => freshnessChip(tab.label, surfaceByKey.get(tab.surfaceKey)?.surface)),
    ...extraKeys
      .map((key) => surfaceByKey.get(key))
      .filter(Boolean)
      .map((entry) => freshnessChip(entry.surface.label, entry.surface)),
  ];

  return {
    counts: {
      tabs: tabs.length,
      itemized: tabs.reduce((sum, tab) => sum + tab.count, 0),
    },
    tabs,
    freshness,
  };
}

/**
 * @param {{ tasks?: any[], items?: any[] } | null} agentQueue
 */
function buildRepairTaskIndex(agentQueue) {
  const index = new Map();
  const tasks = []
    .concat(Array.isArray(agentQueue?.tasks) ? agentQueue.tasks : [])
    .concat(Array.isArray(agentQueue?.waiting) ? agentQueue.waiting : [])
    .concat(Array.isArray(agentQueue?.items) ? agentQueue.items : [])
    .concat(Array.isArray(agentQueue?.waitingItems) ? agentQueue.waitingItems : []);

  for (const task of tasks) {
    const kind = String(task?.kind ?? task?.taskKind ?? "").trim().toLowerCase();
    const reason = String(task?.reason ?? task?.sourceType ?? "").trim().toLowerCase();
    if (kind !== "run_inbound_sync") {
      continue;
    }
    if (reason !== "itemization_gap" && reason !== "inbound_itemization_gap") {
      continue;
    }
    const surfaceKeys = Array.isArray(task?.surfaceKeys) && task.surfaceKeys.length
      ? task.surfaceKeys
      : [task?.surface].filter(Boolean);
    for (const surfaceKey of surfaceKeys) {
      if (typeof surfaceKey !== "string" || !surfaceKey.trim()) {
        continue;
      }
      index.set(surfaceKey, {
        mode: typeof task?.mode === "string" ? task.mode : null,
        dueAt: task?.dueAt ?? task?.queuedAt ?? null,
        waitingReason: typeof task?.waitingReason === "string" ? task.waitingReason : null,
        whyItMatters: task?.whyItMatters ?? task?.why ?? null,
      });
    }
  }

  return index;
}

/**
 * Resolution state of a connection request: has it already been accepted or
 * declined, or is it still pending? Connection degree is authoritative — a
 * 1st-degree connection means the request was accepted, full stop.
 * @param {any} item
 * @param {number | null | undefined} degree
 * @returns {"pending" | "accepted" | "declined"}
 */
function resolutionOf(item, degree) {
  if (degree === 1) return "accepted";
  const kind = String(item.kind ?? "");
  const state = String(item.state ?? "");
  // "decline" covers both the queued decline_requested and the final declined —
  // once the operator hits Reject, the row leaves the actionable list even while
  // the agent is still executing the real decline on LinkedIn.
  if (kind.includes("decline") || state.includes("decline")) return "declined";
  if (kind.includes("accepted") || state === "ready_for_post_accept") return "accepted";
  return "pending";
}

/** Normalize a LinkedIn profile URL for cross-surface identity matching. */
function normalizeProfileUrl(url) {
  if (!url) return null;
  return String(url)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/** @param {string | null | undefined} value */
function normalizeIdentityValue(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized.length ? normalized : null;
}

/**
 * @param {any} item
 * @returns {string[]}
 */
function buildIdentityKeys(item) {
  const keys = [];
  const normalizedProfileUrl = normalizeProfileUrl(item.actorProfileUrl ?? item.sourceUrl ?? null);
  const prospectId = item.prospect?.id ?? item.prospectId ?? null;
  const publicId = normalizeIdentityValue(item.actorLinkedinPublicId);
  const memberId = normalizeIdentityValue(item.actorLinkedinMemberId);

  if (normalizedProfileUrl) {
    keys.push(`profile:${normalizedProfileUrl}`);
  }
  if (prospectId) {
    keys.push(`prospect:${prospectId}`);
  }
  if (publicId) {
    keys.push(`public:${publicId}`);
  }
  if (memberId) {
    keys.push(`member:${memberId}`);
  }

  return [...new Set(keys)];
}

/**
 * @param {any[]} reviewItems
 * @returns {Map<string, { occurredAt: string, label: string, summary: string | null, when: string | null }>}
 */
function buildProfileViewAfterTouchIndex(reviewItems) {
  const index = new Map();

  for (const item of reviewItems) {
    if (item?.kind !== "profile_view_after_touch") {
      continue;
    }

    const occurredAt = item.eventAt
      ?? deriveLinkedinRelativeEventAt(item.summary ?? null, item.observedAt ?? null)
      ?? item.observedAt
      ?? null;
    if (!occurredAt) {
      continue;
    }

    const signal = {
      occurredAt,
      label: "Viewed your profile after the invite",
      summary: item.summary ?? null,
      when: relative(occurredAt),
    };

    for (const key of buildIdentityKeys(item)) {
      const existing = index.get(key) ?? null;
      if (!existing || occurredAt > existing.occurredAt) {
        index.set(key, signal);
      }
    }
  }

  return index;
}

/**
 * @param {any} item
 * @param {Map<string, { occurredAt: string, label: string, summary: string | null, when: string | null }>} profileViewAfterTouchByIdentity
 */
function lookupProfileViewAfterTouch(item, profileViewAfterTouchByIdentity) {
  for (const key of buildIdentityKeys(item)) {
    const signal = profileViewAfterTouchByIdentity.get(key);
    if (signal) {
      return signal;
    }
  }
  return null;
}

/**
 * Look up the captured connection degree for an itemized person by their
 * profile URL.
 * @param {any} item
 * @param {Map<string, { degree: number, prospectId?: string|null }>} degreeByProfile
 * @returns {{ degree: number|null, prospectId: string|null }}
 */
function lookupDegree(item, degreeByProfile) {
  const key = normalizeProfileUrl(item.actorProfileUrl ?? item.sourceUrl ?? null);
  const hit = key ? degreeByProfile.get(key) : null;
  return { degree: hit?.degree ?? null, prospectId: hit?.prospectId ?? null };
}

/**
 * Resolve the timestamp that represents when this row's underlying event
 * actually happened, with a tab-specific priority. Returns an ISO string or
 * null.
 * @param {any} item
 * @param {string | undefined} tabKey
 * @param {Map<string, string>} sentAtByProfile
 * @returns {string | null}
 */
function ageIsoForTab(item, tabKey, sentAtByProfile) {
  if (tabKey === "sent") {
    const key = normalizeProfileUrl(item.actorProfileUrl ?? item.sourceUrl ?? null);
    const ownSentAt = key ? sentAtByProfile.get(key) : null;
    return ownSentAt
      ?? item.eventAt
      ?? deriveLinkedinRelativeEventAt(item.summary ?? null, item.observedAt ?? null)
      ?? item.observedAt
      ?? null;
  }
  if (tabKey === "views") {
    return item.eventAt
      ?? deriveLinkedinRelativeEventAt(item.summary ?? null, item.observedAt ?? null)
      ?? item.observedAt
      ?? null;
  }
  return item.observedAt ?? null;
}

/**
 * @param {any} item
 * @param {Map<string, { degree: number, prospectId?: string|null }>} [degreeByProfile]
 * @param {string} [tabKey]
 * @param {Map<string, string>} [sentAtByProfile]
 * @param {Map<string, { occurredAt: string, label: string, summary: string | null, when: string | null }>} [profileViewAfterTouchByIdentity]
 */
function shapePerson(item, degreeByProfile = new Map(), tabKey, sentAtByProfile = new Map(), profileViewAfterTouchByIdentity = new Map()) {
  const failed = String(item.state ?? "").includes("failed") || String(item.kind ?? "").includes("failed");
  // The moment that matters per tab is when the underlying event actually
  // happened, not when Exo last looked at the row (observedAt) — otherwise every
  // row collapses to "1d ago" after a sync.
  //  • Sent: prefer the exact send time from our own outbound touch, then the
  //    scraped "Sent X ago" label (eventAt), then observedAt.
  //  • Views: the scraped "Viewed X ago" label (eventAt), then observedAt.
  //  • Other tabs keep using observedAt.
  const ageIso = ageIsoForTab(item, tabKey, sentAtByProfile);
  const ageMs = ageIso ? new Date(ageIso).getTime() : null;
  const { degree, prospectId: degreeProspectId } = lookupDegree(item, degreeByProfile);
  const motionId = item.motion?.id ?? item.motionId ?? null;
  const companyId = item.company?.id ?? item.companyId ?? null;
  const prospectId = item.prospect?.id ?? item.prospectId ?? degreeProspectId ?? null;
  const claimState = motionId || companyId || prospectId ? "claimed" : "unclaimed";
  const withdrawQueued = tabKey === "sent" && item.kind === "connection_request_withdraw_requested";
  const sentGroup = tabKey === "sent"
    ? (withdrawQueued || isStalePendingConnectionRequest({ kind: "connection_request_pending", observedAt: ageIso ?? item.observedAt }) ? "stale" : "fresh")
    : null;
  const canWithdraw = tabKey === "sent" && item.kind === "connection_request_pending" && sentGroup === "stale";
  const attention = tabKey === "sent" && item.kind === "connection_request_pending"
    ? lookupProfileViewAfterTouch(item, profileViewAfterTouchByIdentity)
    : null;
  return {
    id: item.id,
    connectionDegree: degree,
    resolution: resolutionOf(item, degree),
    name: item.actorName ?? "Unknown",
    initials: initials(item.actorName),
    avatarUrl: item.actorAvatarUrl ?? item.actorAvatarSourceUrl ?? null,
    sub: item.actorTitle ?? item.summary ?? "",
    company: item.company?.name ?? item.actorCompanyName ?? null,
    when: relative(ageIso),
    observedAtMs: Number.isNaN(ageMs) ? null : ageMs,
    profileUrl: item.actorProfileUrl ?? item.sourceUrl ?? null,
    note: extractObservationNote(item),
    // When this inbound person is reconciled to a tracked prospect, expose the
    // id so the UI can deep-link to their prospect show page. The degree map
    // (matched by profile URL) backfills it for people itemized on outbound
    // surfaces that don't carry the prospect link.
    motionId,
    companyId,
    prospectId,
    claimState,
    canClaim: claimState === "unclaimed" && !withdrawQueued,
    canWithdraw,
    sentGroup,
    withdrawQueued,
    statusTone: withdrawQueued ? "queued" : sentGroup === "stale" ? "stale" : null,
    statusLabel: withdrawQueued ? "Withdraw queued" : sentGroup === "stale" ? "Stale" : null,
    failed,
    target: item.priority === "high",
    attention,
  };
}

/**
 * @param {any[]} people
 */
function buildSentFilters(people) {
  return {
    all: people.length,
    stale: people.filter((person) => person.sentGroup === "stale").length,
    fresh: people.filter((person) => person.sentGroup === "fresh").length,
  };
}

/**
 * @param {any} left
 * @param {any} right
 * @param {string} tabKey
 */
function comparePeopleForTab(left, right, tabKey) {
  if (tabKey === "sent") {
    const rank = sentSortRank(left) - sentSortRank(right);
    if (rank !== 0) return rank;
    return (left.observedAtMs ?? 0) - (right.observedAtMs ?? 0);
  }
  return (right.observedAtMs ?? 0) - (left.observedAtMs ?? 0);
}

/** @param {any} person */
function sentSortRank(person) {
  if (person.withdrawQueued) return 0;
  if (person.sentGroup === "stale") return 1;
  return 2;
}

/**
 * @param {{ notes?: string | null }} item
 * @returns {string | null}
 */
function extractObservationNote(item) {
  const normalized = String(item?.notes ?? "").trim();
  if (!normalized) {
    return null;
  }
  const viewerLabel = normalized.match(/^LinkedIn viewer label:\s*(.+)$/i)?.[1]?.trim() ?? null;
  if (viewerLabel) {
    return `Viewer label: ${viewerLabel}`;
  }
  return normalized;
}

/** @param {string} key */
function tabTitle(key) {
  switch (key) {
    case "received":
      return "Connection requests · received";
    case "sent":
      return "Connection requests · sent";
    case "views":
      return "Profile views";
    case "followers":
      return "People following you";
    case "following":
      return "People you're following";
    default:
      return key;
  }
}

/**
 * @param {any} surface
 * @param {number} itemized
 */
function deriveGapState(surface, itemized) {
  if (!surface) return { message: null, kind: null, autoRepairable: false };
  const meta = surface.meta ?? {};
  const reportedCount = Number.isFinite(surface.lastVisibleTotalCount)
    ? Number(surface.lastVisibleTotalCount)
    : Number.isFinite(surface.lastItemCount)
      ? Number(surface.lastItemCount)
      : null;
  const observedCount = Number.isFinite(surface.observationCount)
    ? Number(surface.observationCount)
    : Number.isFinite(surface.lastObservationCount)
      ? Number(surface.lastObservationCount)
    : null;
  const itemizationGapCount = Number.isFinite(surface.lastItemizationGapCount)
    ? Number(surface.lastItemizationGapCount)
    : null;
  const countDiscrepancyCount = Number.isFinite(surface.lastCountDiscrepancyCount)
    ? Number(surface.lastCountDiscrepancyCount)
    : null;
  const needsFullReconcile = surface.lastReconcileRequired === true && surface.lastExhaustionStatus !== "complete";
  if (meta.unchecked) {
    return {
      message: "This surface has never been checked — run it before trusting silence.",
      kind: "unchecked",
      autoRepairable: false,
    };
  }
  // Prefer the authoritative persisted observation counts from sync state. The
  // rendered tab intentionally filters some observation kinds out of view, so a
  // page-level `people.length` comparison would manufacture fake gaps on fully
  // reconciled surfaces like sent invites or profile views.
  if (reportedCount != null && observedCount != null && reportedCount > observedCount && observedCount > 0) {
    return {
      message: `Visible count (${reportedCount}) exceeds itemized observations (${observedCount}) — reconcile to trust this surface.`,
      kind: "itemization_gap",
      autoRepairable: true,
    };
  }
  if ((itemizationGapCount ?? 0) > 0 || (countDiscrepancyCount ?? 0) > 0 || needsFullReconcile) {
    return {
      message: "More items exist than have been itemized — rerun and write back individual observations to trust this surface.",
      kind: "itemization_gap",
      autoRepairable: true,
    };
  }
  // Backward-compatible fallback for older shape callers that do not carry the
  // persisted sync counters yet.
  if (meta.itemizationGap || surface.needsItemization) {
    return {
      message: "More items exist than have been itemized — rerun and write back individual observations to trust this surface.",
      kind: "itemization_gap",
      autoRepairable: true,
    };
  }
  if (reportedCount != null && reportedCount > itemized && itemized > 0 && observedCount == null) {
    return {
      message: `Visible count (${reportedCount}) exceeds itemized observations (${itemized}) — reconcile to trust this surface.`,
      kind: "itemization_gap",
      autoRepairable: true,
    };
  }
  if (surface.lastRunStatus === "warning") {
    return {
      message: "Last sync completed with warnings — reconcile before acting.",
      kind: "warning",
      autoRepairable: false,
    };
  }
  if (surface.lastRunStatus === "error" || surface.lastRunStatus === "failure") {
    return {
      message: "Last sync failed — this surface cannot be trusted until it is re-run.",
      kind: "failure",
      autoRepairable: false,
    };
  }
  return { message: null, kind: null, autoRepairable: false };
}

/**
 * @param {string} name
 * @param {any} surface
 */
function freshnessChip(name, surface) {
  if (!surface) return { name, truth: "unchecked", at: null };
  return {
    name,
    truth: mapSurfaceTruth(surface.lastRunStatus, surface.meta),
    at: relative(surface.lastSyncedAt ?? surface.lastObservedAt),
  };
}

/**
 * @param {string | null | undefined} lastRunStatus
 * @param {any} meta
 * @returns {"unchecked" | "partial" | "failed" | "checked" | "quiet"}
 */
function mapSurfaceTruth(lastRunStatus, meta) {
  if (lastRunStatus === "error" || lastRunStatus === "failure") return "failed";
  if (lastRunStatus === "never" || meta?.unchecked) return "unchecked";
  if (meta?.itemizationGap || meta?.stale || lastRunStatus === "warning") return "partial";
  if (lastRunStatus === "success") return "checked";
  return "quiet";
}

/** @param {string | null | undefined} iso */
function relative(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const diff = Date.now() - target.getTime();
  const past = diff >= 0;
  const abs = Math.abs(diff);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  if (abs < minute) return past ? "just now" : "<1m";
  if (abs < hour) return `${Math.round(abs / minute)}m${past ? " ago" : ""}`;
  if (abs < day) return `${Math.round(abs / hour)}h${past ? " ago" : ""}`;
  return `${Math.round(abs / day)}d${past ? " ago" : ""}`;
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
