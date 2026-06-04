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

/**
 * @param {{ reviewItems: any[], truthAccounts: any[], degreeByProfile?: Map<string, { degree: number, prospectId?: string|null }> | Record<string, { degree: number, prospectId?: string|null }>, sentAtByProfile?: Map<string, string> | Record<string, string> }} input
 */
export function buildConnectionsViewModel(input) {
  const reviewItems = input.reviewItems ?? [];
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
  const surfaceByKey = new Map();
  for (const account of input.truthAccounts ?? []) {
    for (const surface of account.surfaces ?? []) {
      surfaceByKey.set(surface.key, { surface, account });
    }
  }

  const tabs = TABS.map((tab) => {
    const entry = surfaceByKey.get(tab.surfaceKey);
    const surface = entry?.surface ?? null;
    const truth = surface ? mapSurfaceTruth(surface.lastRunStatus, surface.meta) : "unchecked";
    let items = reviewItems.filter((item) => item.surfaceKey === tab.surfaceKey);
    // The received-invitations surface itemizes resolved outcomes too. Once a
    // request is accepted or declined, the operator's done with it here: the
    // next step (post-accept message, drop) lives in the Operator decision
    // queue, not on the inbound-truth list. Show only still-pending requests
    // so an accept click visibly clears the row.
    if (tab.key === "received") {
      items = items.filter((item) => resolutionOf(item, lookupDegree(item, degreeByProfile).degree) === "pending");
    }
    const people = items.map((item) => shapePerson(item, degreeByProfile, tab.key, sentAtByProfile)).sort((a, b) => (b.observedAtMs ?? 0) - (a.observedAtMs ?? 0));

    return {
      key: tab.key,
      label: tab.label,
      icon: tab.icon,
      action: TAB_ACTION[tab.key],
      count: people.length,
      truth,
      lastChecked: relative(surface?.lastSyncedAt ?? surface?.lastObservedAt),
      gap: deriveGap(surface, people.length),
      title: tabTitle(tab.key),
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
    return ownSentAt ?? item.eventAt ?? item.observedAt ?? null;
  }
  if (tabKey === "views") {
    return item.eventAt ?? item.observedAt ?? null;
  }
  return item.observedAt ?? null;
}

/**
 * @param {any} item
 * @param {Map<string, { degree: number, prospectId?: string|null }>} [degreeByProfile]
 * @param {string} [tabKey]
 * @param {Map<string, string>} [sentAtByProfile]
 */
function shapePerson(item, degreeByProfile = new Map(), tabKey, sentAtByProfile = new Map()) {
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
  return {
    id: item.id,
    connectionDegree: degree,
    resolution: resolutionOf(item, degree),
    name: item.actorName ?? "Unknown",
    initials: initials(item.actorName),
    avatarUrl: item.actorAvatarUrl ?? item.actorAvatarSourceUrl ?? null,
    sub: item.actorTitle ?? item.summary ?? "",
    company: item.actorCompanyName ?? null,
    when: relative(ageIso),
    observedAtMs: Number.isNaN(ageMs) ? null : ageMs,
    profileUrl: item.actorProfileUrl ?? item.sourceUrl ?? null,
    // When this inbound person is reconciled to a tracked prospect, expose the
    // id so the UI can deep-link to their prospect show page. The degree map
    // (matched by profile URL) backfills it for people itemized on outbound
    // surfaces that don't carry the prospect link.
    prospectId: item.prospect?.id ?? item.prospectId ?? degreeProspectId ?? null,
    failed,
    target: item.priority === "high",
  };
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
function deriveGap(surface, itemized) {
  if (!surface) return null;
  const meta = surface.meta ?? {};
  if (meta.unchecked) return "This surface has never been checked — run it before trusting silence.";
  // Only assert a numeric comparison when the surface's own visible count truly
  // exceeds what we itemized; otherwise the reported total lives elsewhere.
  if (surface.lastItemCount != null && surface.lastItemCount > itemized && itemized > 0) {
    return `Visible count (${surface.lastItemCount}) exceeds itemized observations (${itemized}) — reconcile to trust this surface.`;
  }
  if (meta.itemizationGap || surface.needsItemization) {
    return "More items exist than have been itemized — rerun and write back individual observations to trust this surface.";
  }
  if (surface.lastRunStatus === "warning") return "Last sync completed with warnings — reconcile before acting.";
  if (surface.lastRunStatus === "error" || surface.lastRunStatus === "failure") {
    return "Last sync failed — this surface cannot be trusted until it is re-run.";
  }
  return null;
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
