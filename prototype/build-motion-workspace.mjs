#!/usr/bin/env node

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = "/Users/williamflanagan/Projects/omalab/exo";
const EXO_STATE_DIR = "/Users/williamflanagan/Projects/omalab/exo/.exo";
const USER_ID = "00d08a04-c0b5-457c-8cb0-205c81593224";
const CLI_PATH = path.join(REPO_ROOT, "src/cli/index.js");
const OUTPUT_PATH = path.join(REPO_ROOT, "prototype/motion-workspace.html");
const STALE_HOURS = 24;
const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_REGENERATE_COMMAND = `exo report workspace --user ${USER_ID} --out ./prototype/motion-workspace.html`;
const DEFAULT_WORKSPACE_ACTION_WORKER = "codex-workspace";

async function runJson(args) {
  const { stdout } = await execFileAsync("node", [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      EXO_STATE_DIR,
    },
    maxBuffer: MAX_BUFFER,
  });

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse JSON for exo ${args.join(" ")}\n${stdout}\n${error.message}`);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function startCase(value) {
  const normalized = String(value ?? "")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());

  return normalized
    .replaceAll("Linkedin", "LinkedIn")
    .replaceAll("Inmail", "InMail")
    .replaceAll("Gtm", "GTM");
}

function titleizeStatus(value) {
  if (!value) {
    return "Unknown";
  }

  return startCase(value).replace(/\bAvp\b/g, "AVP");
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(items, keyFn) {
  return items.reduce((accumulator, item) => {
    const key = keyFn(item) ?? "unknown";
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function sortByName(items, key = "name") {
  return items.slice().sort((left, right) => {
    const leftValue = String(left[key] ?? "");
    const rightValue = String(right[key] ?? "");
    return leftValue.localeCompare(rightValue);
  });
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestDate(values) {
  return values
    .map((value) => parseDate(value))
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

function hoursSince(value, now) {
  const date = parseDate(value);
  if (!date) {
    return null;
  }

  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

function formatTimestamp(value) {
  const date = parseDate(value);
  if (!date) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(value, now) {
  const date = parseDate(value);
  if (!date) {
    return "never";
  }

  const deltaMs = now.getTime() - date.getTime();
  const minutes = Math.round(deltaMs / (1000 * 60));
  const absMinutes = Math.abs(minutes);

  if (absMinutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  const absHours = Math.abs(hours);

  if (absHours < 48) {
    return `${hours}h`;
  }

  const days = Math.round(hours / 24);
  return `${days}d`;
}

function formatCount(value, label) {
  const number = Number(value ?? 0);
  return `${number} ${label}${number === 1 ? "" : "s"}`;
}

function formatListInline(values) {
  return uniqueValues(values).join(" / ") || "None";
}

function compactCountLine(counts) {
  return Object.entries(counts)
    .filter(([, value]) => Number(value) > 0)
    .sort((left, right) => right[1] - left[1])
    .map(([key, value]) => `${value} ${titleizeStatus(key)}`)
    .join(" · ");
}

function latestTouch(prospect) {
  return toArray(prospect.touches)
    .slice()
    .sort((left, right) => {
      const leftAt = parseDate(left.occurredAt)?.getTime() ?? 0;
      const rightAt = parseDate(right.occurredAt)?.getTime() ?? 0;
      return leftAt - rightAt;
    })
    .at(-1) ?? null;
}

function plannerKey(item) {
  return [item.motion?.id, item.company?.id, item.prospect?.id].join("::");
}

function truthSurfaceKey(accountId, surfaceKey) {
  return `${accountId}::${surfaceKey}`;
}

function humanizeCapability(value) {
  if (!value) {
    return "unknown";
  }

  return value.replaceAll("-", " ");
}

function humanizeChannel(value) {
  if (!value || value === "none") {
    return "none";
  }

  return value.replaceAll("-", " ");
}

function initialsFromLabel(value, limit = 2) {
  const tokens = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return "?";
  }

  if (tokens.length === 1) {
    return tokens[0].slice(0, limit).toUpperCase();
  }

  return tokens
    .slice(0, limit)
    .map((token) => token[0])
    .join("")
    .toUpperCase();
}

function stableThemeIndex(value, size) {
  const source = String(value ?? "");
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return size > 0 ? hash % size : 0;
}

function extractHost(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function proxiedImageUrl(value, size = "160x160") {
  const url = String(value ?? "").trim();
  if (!url) {
    return null;
  }

  if (/^https?:\/\/imageproxy\.bizzbridge\.com\//i.test(url)) {
    return url;
  }

  if (!/^https?:\/\//i.test(url)) {
    return null;
  }

  return `https://imageproxy.bizzbridge.com/${size}/${url}`;
}

function renderAvatar(label, imageUrl, kind = "person") {
  const proxied = proxiedImageUrl(imageUrl);
  const themeIndex = stableThemeIndex(`${kind}:${label}`, 6);

  if (proxied) {
    return `
      <span class="avatar avatar-${escapeHtml(kind)} avatar-theme-${themeIndex}">
        <img src="${escapeHtml(proxied)}" alt="${escapeHtml(label)}" loading="lazy">
      </span>
    `;
  }

  return `
    <span class="avatar avatar-${escapeHtml(kind)} avatar-theme-${themeIndex}">
      <span class="avatar-fallback">${escapeHtml(initialsFromLabel(label, kind === "company" ? 1 : 2))}</span>
    </span>
  `;
}

function renderCompanyPill(companyName, websiteUrl, logoUrl = null) {
  const host = extractHost(websiteUrl);

  return `
    <div class="company-pill">
      ${renderAvatar(companyName, logoUrl, "company")}
      <div class="company-pill-copy">
        <strong>${escapeHtml(companyName)}</strong>
        <span>${escapeHtml(host ?? "company identity")}</span>
      </div>
    </div>
  `;
}

function deriveSurfaceMeta(surface, now) {
  const lastMeaningfulAt = latestDate([surface.lastObservedAt, surface.lastSyncedAt]);
  const stale = lastMeaningfulAt
    ? hoursSince(lastMeaningfulAt.toISOString(), now) >= STALE_HOURS
    : false;
  const never = surface.lastRunStatus === "never";
  const disabled = surface.enabled === false;
  const unchecked = never;
  const actionable = Number(surface.lastItemCount ?? 0) > 0 || Boolean(surface.needsItemization);
  const itemizationGap = Boolean(surface.needsItemization);

  let tone = "quiet";
  if (disabled) {
    tone = "disabled";
  } else if (itemizationGap || unchecked) {
    tone = "danger";
  } else if (actionable) {
    tone = "accent";
  } else if (stale) {
    tone = "warning";
  } else if (surface.lastRunStatus === "success") {
    tone = "good";
  }

  const chips = [
    {
      tone: surface.lastRunStatus === "success" ? "good" : unchecked ? "danger" : "warning",
      label: surface.lastRunStatus ?? "unknown",
    },
  ];

  if (unchecked) {
    chips.push({ tone: "danger", label: "unchecked" });
  }

  if (actionable) {
    chips.push({ tone: "accent", label: "actionable" });
  }

  if (itemizationGap) {
    chips.push({ tone: "danger", label: "itemization gap" });
  }

  if (stale && !unchecked) {
    chips.push({ tone: "warning", label: "stale" });
  }

  if (disabled) {
    chips.push({ tone: "disabled", label: "disabled" });
  }

  let freshnessLabel = "Quiet";
  if (unchecked) {
    freshnessLabel = "Never checked";
  } else if (actionable) {
    freshnessLabel = stale ? "Actionable and stale" : "Actionable";
  } else if (stale) {
    freshnessLabel = "Stale";
  } else if (surface.lastRunStatus === "success") {
    freshnessLabel = "Fresh";
  }

  return {
    tone,
    chips,
    actionable,
    unchecked,
    stale,
    itemizationGap,
    freshnessLabel,
    lastMeaningfulAt,
  };
}

function mergeTruthAccounts(user, inboundReview, inbox, now) {
  const reviewAccounts = new Map(
    toArray(inboundReview?.surfaces?.accounts).map((account) => [account.accountId, account]),
  );
  const inboxAccounts = new Map(
    toArray(inbox?.surfaces?.accounts).map((account) => [account.accountId, account]),
  );
  const itemizationGapKeys = new Set(
    toArray(inboundReview?.itemizationGaps).map((gap) => truthSurfaceKey(gap.account?.id, gap.surfaceKey)),
  );

  return toArray(user?.accounts).map((account) => {
    const reviewAccount = reviewAccounts.get(account.id);
    const inboxAccount = inboxAccounts.get(account.id);
    const userSurfaces = new Map(
      toArray(account.inboundSync?.surfaces).map((surface) => [surface.surfaceKey, surface]),
    );
    const reviewSurfaces = new Map(
      toArray(reviewAccount?.surfaces).map((surface) => [surface.key, surface]),
    );
    const inboxSurfaces = new Map(
      toArray(inboxAccount?.surfaces).map((surface) => [surface.key, surface]),
    );

    const surfaceKeys = uniqueValues([
      ...userSurfaces.keys(),
      ...reviewSurfaces.keys(),
      ...inboxSurfaces.keys(),
    ]);

    const surfaces = surfaceKeys.map((key) => {
      const base = userSurfaces.get(key);
      const review = reviewSurfaces.get(key);
      const inboxSurface = inboxSurfaces.get(key);
      const surface = {
        key,
        label: review?.label ?? inboxSurface?.label ?? startCase(key),
        enabled: base?.enabled ?? true,
        truthLevel: review?.truthLevel ?? inboxSurface?.truthLevel ?? "unknown",
        lastRunStatus: review?.lastRunStatus ?? inboxSurface?.lastRunStatus ?? base?.lastRunStatus ?? "never",
        lastSyncedAt: review?.lastSyncedAt ?? inboxSurface?.lastSyncedAt ?? base?.lastSyncedAt ?? null,
        lastObservedAt:
          review?.lastObservedAt ?? inboxSurface?.lastObservedAt ?? base?.lastObservedAt ?? null,
        lastItemCount:
          review?.lastItemCount ?? inboxSurface?.lastItemCount ?? base?.lastItemCount ?? null,
        summary: review?.summary ?? inboxSurface?.summary ?? null,
        recommendedAction:
          review?.recommendedAction ?? inboxSurface?.recommendedAction ?? null,
        observationCount: review?.observationCount ?? 0,
        needsItemization:
          Boolean(review?.needsItemization) ||
          itemizationGapKeys.has(truthSurfaceKey(account.id, key)),
      };

      return {
        ...surface,
        meta: deriveSurfaceMeta(surface, now),
      };
    });

    const orderedSurfaces = surfaces.slice().sort((left, right) => {
      const toneRank = {
        danger: 0,
        accent: 1,
        warning: 2,
        good: 3,
        quiet: 4,
        disabled: 5,
      };
      const leftRank = toneRank[left.meta.tone] ?? 9;
      const rightRank = toneRank[right.meta.tone] ?? 9;

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.label.localeCompare(right.label);
    });

    return {
      id: account.id,
      capability: account.capability,
      handle: account.handle,
      label: account.label,
      preferred: account.preferred,
      sourceType: account.sourceType,
      surfaces: orderedSurfaces,
      actionableSurfaceCount:
        inboxAccount?.actionableSurfaceCount ??
        orderedSurfaces.filter((surface) => surface.meta.actionable).length,
      quietSurfaceCount:
        inboxAccount?.quietSurfaceCount ??
        orderedSurfaces.filter((surface) => !surface.meta.actionable && !surface.meta.unchecked).length,
      uncheckedSurfaceCount:
        inboxAccount?.uncheckedSurfaceCount ??
        orderedSurfaces.filter((surface) => surface.meta.unchecked).length,
    };
  });
}

function deriveCompanyPrepLane(company) {
  if (company.stage === "needs-company-identity" || !company.websiteUrl || !company.linkedinCompanyUrl) {
    return {
      key: "needs-company-identity",
      label: "Needs company identity",
      description: "Canonical website or LinkedIn identity is still missing.",
    };
  }

  if (company.queueStatus === "queued_for_research") {
    return {
      key: "queued-for-research",
      label: "Queued for research",
      description: "Canonical identity exists, but company research is not complete yet.",
    };
  }

  if (company.queueStatus === "researched") {
    return {
      key: "researched",
      label: "Researched / pick prospects",
      description: "Company signals are in, but prospect selection is not complete yet.",
    };
  }

  if (company.queueStatus === "selected") {
    return {
      key: "selected",
      label: "Selected / build branches",
      description: "Prospects exist, but through-lines or opening plans still need work.",
    };
  }

  if (company.queueStatus === "suppressed") {
    return {
      key: "suppressed",
      label: "Suppressed",
      description: "This company is intentionally out of play.",
    };
  }

  if (company.queueStatus === "exhausted") {
    return {
      key: "exhausted",
      label: "Exhausted",
      description: "This company is out of viable next moves right now.",
    };
  }

  return {
    key: "targeting-ready",
    label: "Targeting ready",
    description: "Company identity, signal work, and branch scaffolding are already in place.",
  };
}

function deriveProspectPrepLane(prospect) {
  if (prospect.throughLineStatus !== "ready") {
    return {
      key: "needs-through-line",
      label: "Needs through-line",
      description: "The branch still lacks a defensible reason-to-talk line.",
    };
  }

  if (prospect.openingPlanStatus !== "ready") {
    return {
      key: "needs-opening-plan",
      label: "Needs opening plan",
      description: "The branch lacks a concrete first move and reply path.",
    };
  }

  if (prospect.cadenceStatus !== "ready") {
    return {
      key: "needs-cadence",
      label: "Needs cadence state",
      description: "Exo does not yet have a usable current step and next action.",
    };
  }

  if (prospect.contactEnrichmentState?.status === "pending") {
    return {
      key: "contact-enrichment-pending",
      label: "Contact enrichment pending",
      description: "Core branch logic exists, but direct-channel fallback work is still open.",
    };
  }

  if (prospect.contactEnrichmentState?.status === "exhausted" && !prospect.hasEmailFallback) {
    return {
      key: "primary-only-ready",
      label: "Ready but weak fallback",
      description: "The branch is ready on the primary path, but direct fallback coverage is still thin.",
    };
  }

  return {
    key: "prep-complete",
    label: "Prep complete",
    description: "Through-line, opening plan, cadence, and fallback coverage are all in decent shape.",
  };
}

function deriveEngagementLane(prospect, dailyItem) {
  const cadence = prospect.cadenceState ?? {};
  const lastTouch = latestTouch(prospect);
  const lastOutcome = cadence.lastTouchOutcome ?? lastTouch?.outcome ?? null;
  const nextAction = (dailyItem?.recommendedAction ?? prospect.nextAction ?? cadence.nextAction ?? "").toLowerCase();
  const queueStatus = prospect.queueStatus ?? cadence.status;

  if (queueStatus === "suppressed" || queueStatus === "exhausted" || cadence.status === "exhausted") {
    return {
      key: "exhausted",
      label: "Exhausted",
      description: "No viable branch remains here without new truth.",
    };
  }

  if (["accepted", "replied", "reply", "positive_reply"].includes(lastOutcome)) {
    return {
      key: "reply-accepted",
      label: "Reply / accepted",
      description: "The branch already moved off the cold start problem and into live response handling.",
    };
  }

  if (lastOutcome === "blocked" || nextAction.includes("blocked")) {
    return {
      key: "blocked",
      label: "Blocked",
      description: "The primary path failed or the channel is blocked.",
    };
  }

  if (
    dailyItem?.state === "waiting_until" ||
    (!lastOutcome && /wait|hold|patient|reserve/.test(nextAction))
  ) {
    return {
      key: "waiting",
      label: "Waiting",
      description: "This branch is intentionally being held, not actively pushed.",
    };
  }

  if (["sent", "pending"].includes(lastOutcome)) {
    return {
      key: "sent-pending",
      label: "Sent / pending",
      description: "A touch is already in flight and the branch is now waiting on the other side.",
    };
  }

  return {
    key: "ready",
    label: "Ready",
    description: "The branch is prepped and still waiting for its first governed move.",
  };
}

function buildMotionSummaries(reports, daily, inboundReview) {
  const dailyItems = toArray(daily.items);
  const reviewItems = toArray(inboundReview.reviewItems);

  return reports.map((report) => {
    const motion = report.motion;
    const targeting = report.targeting ?? {};
    const queue = targeting.queue ?? {};
    const companyLoop = targeting.companyLoop ?? {};
    const motionDailyItems = dailyItems.filter((item) => item.motion?.id === motion.id);
    const motionReviewItems = reviewItems.filter((item) => item.motion?.id === motion.id);
    const identityCounts = countBy(toArray(companyLoop.items), (item) => item.executionIdentity?.status ?? "unknown");

    return {
      id: motion.id,
      name: motion.name,
      status: motion.status,
      updatedAt: motion.updatedAt,
      premiseStatus: motion.premise?.status ?? "unknown",
      overallStage: targeting.overallStage ?? "unknown",
      readyToTarget: Boolean(targeting.readyToTarget),
      readyToEngage: Boolean(targeting.readyToEngage),
      companyCount: companyLoop.companyCount ?? queue.companyCount ?? 0,
      prospectCount: queue.prospectCount ?? report.prospects?.counts?.prospectCount ?? 0,
      readyToSendCount: queue.readyToSendCount ?? 0,
      browserGate: targeting.browserGate ?? null,
      executionIdentityCounts: identityCounts,
      dueNowCount: motionDailyItems.filter((item) => item.state === "due_now").length,
      waitingCount: motionDailyItems.filter((item) => item.state === "waiting_until").length,
      reviewCount: motionReviewItems.length,
      nextActions: toArray(targeting.nextActions).slice(0, 3),
      queueCompanyStatusCounts: queue.companyStatusCounts ?? {},
      queueProspectStatusCounts: queue.prospectStatusCounts ?? {},
    };
  });
}

function flattenCompanyPrep(reports) {
  return reports.flatMap((report) => {
    const motion = report.motion;
    return toArray(report.targeting?.companyLoop?.items).map((company) => ({
      motionId: motion.id,
      motionName: motion.name,
      motionStatus: motion.status,
      ...company,
      lane: deriveCompanyPrepLane(company),
    }));
  });
}

function buildDailyIndex(dailyItems) {
  return new Map(toArray(dailyItems).map((item) => [plannerKey(item), item]));
}

function buildReviewIndex(reviewItems) {
  return new Map(toArray(reviewItems).map((item) => [plannerKey(item), item]));
}

function flattenProspects(reports, dailyIndex, reviewIndex) {
  return reports.flatMap((report) => {
    const motion = report.motion;
    return toArray(report.prospects?.prospects).map((prospect) => {
      const key = [motion.id, prospect.companyId, prospect.prospectId].join("::");
      const dailyItem = dailyIndex.get(key) ?? null;
      const reviewItem = reviewIndex.get(key) ?? null;

      return {
        motionId: motion.id,
        motionName: motion.name,
        motionStatus: motion.status,
        ...prospect,
        lane: deriveProspectPrepLane(prospect),
        engagementLane: deriveEngagementLane(prospect, dailyItem),
        dailyItem,
        reviewItem,
      };
    });
  });
}

function buildGapNotes(truthAccounts, prospects) {
  const notes = [
    {
      title: "Freshness still uses a simple clock",
      body: "Fresh vs stale is currently based on elapsed time since the last sync or observed item, not a surface-specific service level.",
    },
    {
      title: "Prep stages are inferred",
      body: "Company and prospect prep still have to be assembled from queue status, through-lines, opening plans, cadence state, and contact enrichment because there is no single prep-stage field yet.",
    },
  ];

  const accountsWithoutSurfaces = truthAccounts.filter((account) => account.surfaces.length === 0);
  if (accountsWithoutSurfaces.length > 0) {
    notes.push({
      title: "Some accounts still have no visible truth inventory",
      body: `${accountsWithoutSurfaces
        .map((account) => `${account.capability}:${account.handle}`)
        .join(", ")} expose no visible inbound surfaces here, so quiet cannot yet be separated from not instrumented.`,
    });
  }

  const launchStateAmbiguity = prospects.filter((prospect) => {
    const lastOutcome = prospect.cadenceState?.lastTouchOutcome ?? null;
    const nextAction = (prospect.nextAction ?? "").toLowerCase();
    return Boolean(lastOutcome) && /first planned touch|first touch|once launch is approved/.test(nextAction);
  });
  if (launchStateAmbiguity.length > 0) {
    notes.push({
      title: "Some branches still have launch-state ambiguity",
      body: `${launchStateAmbiguity.length} branch${launchStateAmbiguity.length === 1 ? "" : "es"} still read like a first-touch plan even though touches are already recorded. A canonical launch-state field would remove that ambiguity.`,
    });
  }

  return notes;
}

function artifactStatusSeverity(status) {
  if (status === "ready" || status === "live") {
    return "good";
  }

  if (status === "partial" || status === "in-progress") {
    return "warning";
  }

  return "danger";
}

function summarizeArtifactStatus(hasAny, isComplete) {
  if (isComplete) {
    return "ready";
  }

  if (hasAny) {
    return "partial";
  }

  return "missing";
}

function pickFocusMotion(motionSummaries) {
  return motionSummaries
    .slice()
    .sort((left, right) => {
      if (left.status === "active" && right.status !== "active") {
        return -1;
      }

      if (left.status !== "active" && right.status === "active") {
        return 1;
      }

      if (left.dueNowCount !== right.dueNowCount) {
        return right.dueNowCount - left.dueNowCount;
      }

      if (left.readyToSendCount !== right.readyToSendCount) {
        return right.readyToSendCount - left.readyToSendCount;
      }

      const leftUpdated = parseDate(left.updatedAt)?.getTime() ?? 0;
      const rightUpdated = parseDate(right.updatedAt)?.getTime() ?? 0;
      return rightUpdated - leftUpdated;
    })[0] ?? null;
}

function buildOperatorSummary({ user, daily, motionSummaries, truthAccounts, reviewItems, now }) {
  const dueNowItems = toArray(daily.items).filter((item) => item.state === "due_now");
  const waitingItems = toArray(daily.items).filter((item) => item.state === "waiting_until");
  const focusMotion = pickFocusMotion(motionSummaries);
  const allSurfaces = truthAccounts.flatMap((account) => account.surfaces);
  const actionableSurfaceCount = allSurfaces.filter((surface) => surface.meta.actionable).length;
  const staleSurfaceCount = allSurfaces.filter((surface) => surface.meta.stale && !surface.meta.unchecked).length;
  const uncheckedSurfaceCount = allSurfaces.filter((surface) => surface.meta.unchecked).length;
  const topDueItem = dueNowItems[0] ?? null;
  const topWaitingItem = waitingItems[0] ?? null;

  let headline = `Operator call for ${user.label}`;
  let nextMove = "No governed move is exposed right now.";
  let why = "The planner does not currently expose due work, so the operator should inspect the focus motion and truth surfaces.";

  if (topDueItem) {
    headline = `Next move for ${user.label}`;
    nextMove = topDueItem.recommendedAction ?? nextMove;
    why = topDueItem.whyItMatters ?? why;
  } else if (focusMotion) {
    headline = `Focus ${focusMotion.name}`;
    nextMove = focusMotion.nextActions[0] ?? "Continue the focus motion using its highest-priority governed next action.";
    why = focusMotion.readyToEngage
      ? "This motion already has usable execution inventory, so the next move should come from its ready branches."
      : `This motion is still in ${focusMotion.overallStage}, so the next move should clear its top blocker instead of forcing execution.`;
  } else if (topWaitingItem) {
    headline = `Held work for ${user.label}`;
    nextMove = topWaitingItem.recommendedAction ?? nextMove;
    why = topWaitingItem.whyItMatters ?? why;
  }

  const checklist = dueNowItems.slice(0, 4).map((item) => {
    const capacityItem = String(item.prospect?.id ?? "") === "outbound-capacity:linkedin";
    const subjectParts = [
      item.motion?.name && !String(item.motion.id ?? "").startsWith("outbound-capacity:") ? item.motion.name : null,
      item.company?.name && !String(item.company.id ?? "").startsWith("outbound-capacity:") ? item.company.name : null,
      item.prospect?.name && !String(item.prospect.id ?? "").startsWith("outbound-capacity:") ? item.prospect.name : null,
    ].filter(Boolean);

    return {
      subject: capacityItem
        ? "LinkedIn capacity deficit"
        : subjectParts.join(" / ") || item.prospect?.name || item.company?.name || item.motion?.name || "General",
      action: item.recommendedAction ?? item.cadence?.nextAction ?? "No governed action exposed.",
      dueAt: item.dueAt ?? null,
    };
  });

  return {
    headline,
    nextMove,
    why,
    generatedAt: now.toISOString(),
    focusMotion,
    checklist,
    counts: {
      dueNow: dueNowItems.length,
      waiting: waitingItems.length,
      review: reviewItems.length,
      actionableSurfaces: actionableSurfaceCount,
      staleSurfaces: staleSurfaceCount,
      uncheckedSurfaces: uncheckedSurfaceCount,
    },
  };
}

function buildArtifactSummaries(reports, motionSummaries) {
  const summaryIndex = new Map(motionSummaries.map((motion) => [motion.id, motion]));

  return reports
    .map((report) => {
      const motionSummary = summaryIndex.get(report.motion.id) ?? null;
      const prospects = toArray(report.prospects?.prospects);
      const audienceCount = toArray(report.motion.setup?.audienceHypotheses).length;
      const signalCount = toArray(report.motion.setup?.signals).length;
      const throughLineReadyCount = prospects.filter((prospect) => prospect.throughLineStatus === "ready").length;
      const openingPlanReadyCount = prospects.filter((prospect) => prospect.openingPlanStatus === "ready").length;
      const cadenceReadyCount = prospects.filter((prospect) => prospect.cadenceStatus === "ready").length;
      const messageTestReadyCount = report.prospects?.counts?.messageTestReadyCount ?? 0;
      const companyCount = motionSummary?.companyCount ?? report.targeting?.companyLoop?.companyCount ?? 0;
      const prospectCount = motionSummary?.prospectCount ?? report.prospects?.counts?.prospectCount ?? 0;

      return {
        motionId: report.motion.id,
        motionName: report.motion.name,
        motionStatus: report.motion.status,
        overallStage: motionSummary?.overallStage ?? report.targeting?.overallStage ?? "unknown",
        frame: {
          status: summarizeArtifactStatus(
            report.motion.premise?.status === "defined" || audienceCount > 0 || signalCount > 0,
            report.motion.premise?.status === "defined" && audienceCount > 0 && signalCount > 0,
          ),
          premiseStatus: report.motion.premise?.status ?? "unknown",
          audienceCount,
          signalCount,
        },
        targetMap: {
          status: summarizeArtifactStatus(companyCount > 0 || prospectCount > 0, companyCount > 0 && prospectCount > 0),
          companyCount,
          prospectCount,
        },
        branchLogic: {
          status: summarizeArtifactStatus(
            throughLineReadyCount > 0 || openingPlanReadyCount > 0 || cadenceReadyCount > 0,
            prospectCount > 0
              && throughLineReadyCount === prospectCount
              && openingPlanReadyCount === prospectCount
              && cadenceReadyCount === prospectCount,
          ),
          throughLineReadyCount,
          openingPlanReadyCount,
          cadenceReadyCount,
          messageTestReadyCount,
        },
        execution: {
          status: summarizeArtifactStatus(
            (motionSummary?.readyToSendCount ?? 0) > 0
              || (motionSummary?.waitingCount ?? 0) > 0
              || (motionSummary?.dueNowCount ?? 0) > 0,
            (motionSummary?.readyToSendCount ?? 0) > 0,
          ),
          readyToSendCount: motionSummary?.readyToSendCount ?? 0,
          dueNowCount: motionSummary?.dueNowCount ?? 0,
          waitingCount: motionSummary?.waitingCount ?? 0,
          reviewCount: motionSummary?.reviewCount ?? 0,
        },
      };
    })
    .sort((left, right) => {
      if (left.motionStatus === "active" && right.motionStatus !== "active") {
        return -1;
      }

      if (left.motionStatus !== "active" && right.motionStatus === "active") {
        return 1;
      }

      return left.motionName.localeCompare(right.motionName);
    });
}

function reviewPriorityRank(value) {
  if (value === "high") {
    return 0;
  }

  if (value === "medium") {
    return 1;
  }

  return 2;
}

function isInboundReviewDailyItem(item) {
  return item?.source?.type === "inbound_review" || String(item?.motion?.id ?? "").startsWith("inbound-review:");
}

function isDecisionReviewItem(item) {
  if (["needs_reply", "needs_decision"].includes(item?.state)) {
    return true;
  }

  return toArray(item?.decisionOptions).some((option) => !["wait", "hold", "note-signal"].includes(option));
}

function plannerSubject(item) {
  const capacityItem = String(item?.prospect?.id ?? "") === "outbound-capacity:linkedin";

  if (capacityItem) {
    return "LinkedIn capacity";
  }

  return [item?.company?.name, item?.prospect?.name].filter(Boolean).join(" / ") || item?.motion?.name || "General";
}

function reviewSubject(item) {
  return item?.prospect?.name || item?.actorName || item?.company?.name || "Unknown";
}

function buildPacketAction(channel, kind, item, workerLabel) {
  const packetSubject = item.prospectName ?? item.companyName ?? "Unknown";

  if (kind === "prospect_research" && item.prospectId) {
    return {
      kind: "claim_motion_prospect_packet",
      label: `Claim ${packetSubject}`,
      confirm: `Claim the ${kind.replaceAll("_", " ")} packet for ${packetSubject}?`,
      companyId: item.companyId,
      motionId: item.motionId,
      prospectId: item.prospectId,
      workerLabel,
      notes: `Claimed from the Exo workspace for ${channel} ${kind}.`,
    };
  }

  return {
    kind: "claim_target_account_packet",
    label: `Claim ${packetSubject}`,
    confirm: `Claim the ${kind.replaceAll("_", " ")} packet for ${packetSubject}?`,
    companyId: item.companyId,
    motionId: item.motionId,
    workerLabel,
    notes: `Claimed from the Exo workspace for ${channel} ${kind}.`,
  };
}

function buildWorkspaceStateActions({ user, reports, daily, workerLabel = DEFAULT_WORKSPACE_ACTION_WORKER }) {
  const firstBlockedCompanyName = Object.values(daily.capacity ?? {})
    .map((entry) => entry?.plannerItem?.context?.firstAssignmentBlockedCompanyName ?? null)
    .find(Boolean) ?? null;

  const blockedReadyCompanies = reports
    .flatMap((report) => toArray(report.targeting?.companyLoop?.items))
    .filter((company) =>
      company.queueStatus === "ready"
      && company.executionIdentity?.status === "unassigned-global-ready"
      && Number(company.readyCadenceCount ?? 0) > 0,
    )
    .map((company) => ({
      kind: "assign_company_user",
      label: `Pin ${company.companyName}`,
      confirm: `Pin ${company.companyName} to ${user.label}?`,
      companyId: company.companyId,
      companyName: company.companyName,
      userId: user.id,
      userLabel: user.label,
      browserCapability: "linkedin",
      reason: "Make ready outbound branches executable",
    }))
    .sort((left, right) => {
      if (left.companyName === firstBlockedCompanyName) {
        return -1;
      }

      if (right.companyName === firstBlockedCompanyName) {
        return 1;
      }

      return right.companyName.localeCompare(left.companyName);
    });

  const packetActionsByKey = new Map();

  Object.entries(daily.capacity ?? {}).forEach(([channel, entry]) => {
    const claimableItemsByKind = entry?.execution?.packets?.claimableItemsByKind ?? {};

    Object.entries(claimableItemsByKind).forEach(([kind, items]) => {
      const actions = toArray(items)
        .slice(0, 3)
        .map((item) => buildPacketAction(channel, kind, item, workerLabel));

      packetActionsByKey.set(`${channel}::${kind}`, actions);
    });
  });

  return {
    blockedReadyCompanies,
    packetActionsByKey,
  };
}

function buildDecisionLinks(item) {
  const links = [];

  if (item.actorProfileUrl) {
    links.push({
      label: "Profile",
      href: item.actorProfileUrl,
    });
  }

  if (item.sourceUrl && item.sourceUrl !== item.actorProfileUrl) {
    links.push({
      label: "Invites",
      href: item.sourceUrl,
    });
  }

  return links;
}

function buildDecisionActions(item) {
  if (item.kind !== "connection_request_received" || item.state !== "needs_decision") {
    return [];
  }

  const subject = item.actorName ?? item.prospect?.name ?? item.company?.name ?? "this inbound invite";

  return [
    {
      kind: "record_inbound_observation",
      label: "Mark accepted",
      confirm: `Record ${subject} as accepted in Exo? This updates governed state only; it does not click LinkedIn for you.`,
      observationId: item.id,
      nextKind: "connection_request_accepted",
    },
    {
      kind: "record_inbound_observation",
      label: "Mark declined",
      confirm: `Record ${subject} as declined in Exo? This updates governed state only; it does not click LinkedIn for you.`,
      observationId: item.id,
      nextKind: "connection_request_declined",
    },
  ];
}

function buildDecisionQueue(reviewItems) {
  const sorted = toArray(reviewItems).slice().sort((left, right) => {
    const priorityDelta = reviewPriorityRank(left.priority) - reviewPriorityRank(right.priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    const leftObserved = parseDate(left.observedAt)?.getTime() ?? 0;
    const rightObserved = parseDate(right.observedAt)?.getTime() ?? 0;
    return rightObserved - leftObserved;
  });

  const decisions = sorted.filter(isDecisionReviewItem);
  const signals = sorted.filter((item) => !isDecisionReviewItem(item));

  return {
    itemCount: decisions.length,
    replyCount: decisions.filter((item) => item.state === "needs_reply").length,
    decisionCount: decisions.filter((item) => item.state === "needs_decision").length,
    parkedSignalCount: signals.length,
    items: decisions.map((item) => ({
      id: item.id,
      kind: item.kind,
      subject: reviewSubject(item),
      summary: item.summary ?? "No summary recorded.",
      why: item.whyItMatters ?? null,
      priority: item.priority ?? "low",
      state: item.state ?? "unknown",
      options: toArray(item.decisionOptions),
      surfaceKey: item.surfaceKey ?? null,
      observedAt: item.observedAt ?? null,
      recommendedAction: item.recommendedAction ?? null,
      actorTitle: item.actorTitle ?? null,
      actorCompanyName: item.actorCompanyName ?? null,
      actorProfileUrl: item.actorProfileUrl ?? null,
      sourceUrl: item.sourceUrl ?? null,
      companyName: item.company?.name ?? null,
      motionName: item.motion?.name ?? null,
      links: buildDecisionLinks(item),
      actions: buildDecisionActions(item),
    })),
    signals: signals.map((item) => ({
      id: item.id,
      subject: reviewSubject(item),
      summary: item.summary ?? "No summary recorded.",
      priority: item.priority ?? "low",
      state: item.state ?? "unknown",
      surfaceKey: item.surfaceKey ?? null,
      observedAt: item.observedAt ?? null,
      recommendedAction: item.recommendedAction ?? null,
    })),
  };
}

function buildAgentQueue(daily, stateActions = { blockedReadyCompanies: [], packetActionsByKey: new Map() }) {
  const actionableItems = toArray(daily.items).filter((item) => !isInboundReviewDailyItem(item));
  const dueNowItems = actionableItems.filter((item) => item.state === "due_now");
  const waitingItems = actionableItems.filter((item) => item.state === "waiting_until");
  const capacityEntries = Object.entries(daily.capacity ?? {});

  const blockers = capacityEntries.flatMap(([channel, entry]) => {
    const execution = entry?.execution ?? {};
    const blockedReadyCount = Number(execution.assignmentBlockedReadyConnectionRequests ?? 0);
    const blockedCompanyCount = Number(execution.assignmentBlockedCompanyCount ?? 0);

    if (blockedReadyCount <= 0 && blockedCompanyCount <= 0) {
      return [];
    }

    return [
      {
        channel,
        accountHandle: entry?.account?.handle ?? null,
        blockedReadyCount,
        blockedCompanyCount,
        firstCompanyName: entry?.plannerItem?.context?.firstAssignmentBlockedCompanyName ?? null,
        firstProspectName: entry?.plannerItem?.context?.firstAssignmentBlockedProspectName ?? null,
        stateActions: stateActions.blockedReadyCompanies,
      },
    ];
  });

  const packets = capacityEntries.flatMap(([channel, entry]) => {
    const claimableItemsByKind = entry?.execution?.packets?.claimableItemsByKind ?? {};

    return Object.entries(claimableItemsByKind).flatMap(([kind, items]) => {
      const previewItems = toArray(items);
      if (previewItems.length === 0) {
        return [];
      }

      return [
        {
          channel,
          kind,
          count: previewItems.length,
          preview: previewItems
            .slice(0, 3)
            .map((item) => item.prospectName ?? item.companyName)
            .filter(Boolean),
          firstPacketId: previewItems[0].packetId ?? null,
          firstMotionName: previewItems[0].motionName ?? null,
          stateActions: stateActions.packetActionsByKey.get(`${channel}::${kind}`) ?? [],
        },
      ];
    });
  });

  const mapPlannerItem = (item) => ({
    id: plannerKey(item),
    subject: plannerSubject(item),
    action: item.recommendedAction ?? item.cadence?.nextAction ?? "No governed action exposed.",
    why: item.whyItMatters ?? null,
    motionName: item.motion?.name ?? null,
    dueAt: item.dueAt ?? null,
    sourceType: item.source?.type ?? null,
    state: item.state ?? "unknown",
  });

  return {
    itemCount: dueNowItems.length,
    waitingCount: waitingItems.length,
    blockedReadyCount: blockers.reduce((total, item) => total + item.blockedReadyCount, 0),
    blockedCompanyCount: blockers.reduce((total, item) => total + item.blockedCompanyCount, 0),
    packetCount: packets.reduce((total, item) => total + item.count, 0),
    items: dueNowItems.map(mapPlannerItem),
    waitingItems: waitingItems.map(mapPlannerItem),
    blockers,
    packets,
  };
}

function renderChips(chips) {
  return chips
    .map(
      (chip) =>
        `<span class="chip chip-${escapeHtml(chip.tone)}">${escapeHtml(titleizeStatus(chip.label))}</span>`,
    )
    .join("");
}

function renderOperatorChecklist(items, now) {
  if (!items.length) {
    return `<div class="empty-state">Nothing is due now. Use the focus motion and truth strip to decide whether the next move is waiting, cleanup, or fresh targeting work.</div>`;
  }

  return `
    <ul class="operator-list">
      ${items
        .map(
          (item) => `
            <li class="operator-item">
              <div>
                <strong>${escapeHtml(item.subject)}</strong>
                <p>${escapeHtml(item.action)}</p>
              </div>
              <span>${escapeHtml(formatRelative(item.dueAt, now))}</span>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderArtifactInventory(artifactSummaries) {
  return artifactSummaries
    .map((artifact) => {
      const rows = [
        {
          label: "Motion frame",
          status: artifact.frame.status,
          detail: `${titleizeStatus(artifact.frame.premiseStatus)} premise · ${artifact.frame.audienceCount} audience${artifact.frame.audienceCount === 1 ? "" : "s"} · ${artifact.frame.signalCount} signal${artifact.frame.signalCount === 1 ? "" : "s"}`,
        },
        {
          label: "Target map",
          status: artifact.targetMap.status,
          detail: `${artifact.targetMap.companyCount} compan${artifact.targetMap.companyCount === 1 ? "y" : "ies"} · ${artifact.targetMap.prospectCount} prospect${artifact.targetMap.prospectCount === 1 ? "" : "s"}`,
        },
        {
          label: "Branch logic",
          status: artifact.branchLogic.status,
          detail: `${artifact.branchLogic.throughLineReadyCount}/${artifact.targetMap.prospectCount || 0} through-lines · ${artifact.branchLogic.openingPlanReadyCount}/${artifact.targetMap.prospectCount || 0} opening plans · ${artifact.branchLogic.cadenceReadyCount}/${artifact.targetMap.prospectCount || 0} cadence`,
        },
        {
          label: "Execution inventory",
          status: artifact.execution.status,
          detail: `${artifact.execution.readyToSendCount} ready · ${artifact.execution.dueNowCount} due now · ${artifact.execution.waitingCount} waiting · ${artifact.execution.reviewCount} review`,
        },
      ];

      return `
        <article class="artifact-card">
          <div class="artifact-card-head">
            <div>
              <div class="mini-eyebrow">${escapeHtml(titleizeStatus(artifact.motionStatus))}</div>
              <h3>${escapeHtml(artifact.motionName)}</h3>
            </div>
            <span class="chip chip-quiet">${escapeHtml(titleizeStatus(artifact.overallStage))}</span>
          </div>
          <div class="artifact-stack">
            ${rows
              .map(
                (row) => `
                  <div class="artifact-row">
                    <div>
                      <span>${escapeHtml(row.label)}</span>
                      <strong>${escapeHtml(row.detail)}</strong>
                    </div>
                    <span class="chip chip-${artifactStatusSeverity(row.status)}">${escapeHtml(titleizeStatus(row.status))}</span>
                  </div>
                `,
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDecisionQueue(decisionQueue, now, interactive) {
  if (decisionQueue.items.length === 0) {
    return `<div class="empty-state">No operator decisions are exposed right now.</div>`;
  }

  return `
    <div class="work-stack">
      ${decisionQueue.items
        .slice(0, 6)
        .map((item) => {
          const optionsLabel = item.options.length > 0
            ? item.options.map((option) => titleizeStatus(option)).join(" / ")
            : "Review";
          const actorContext = [
            item.actorTitle,
            item.actorCompanyName
              && !String(item.actorTitle ?? "").toLowerCase().includes(String(item.actorCompanyName).toLowerCase())
              ? item.actorCompanyName
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const meta = [
            item.surfaceKey ? titleizeStatus(item.surfaceKey) : null,
            formatRelative(item.observedAt, now),
            item.companyName,
          ].filter(Boolean);
          const controlMarkup = [
            renderWorkspaceActionLinksMarkup(toArray(item.links)),
            renderWorkspaceActionButtonMarkup(toArray(item.actions), interactive),
          ].join("");

          return `
            <article class="work-card work-card-danger">
              <div class="work-card-head">
                <div>
                  <div class="mini-eyebrow">${escapeHtml(titleizeStatus(item.state))}</div>
                  <h3>${escapeHtml(item.subject)}</h3>
                </div>
                <span class="chip chip-${item.priority === "high" ? "danger" : item.priority === "medium" ? "warning" : "quiet"}">${escapeHtml(
                  optionsLabel,
                )}</span>
              </div>
              ${actorContext ? `<p class="work-card-subline">${escapeHtml(actorContext)}</p>` : ""}
              <p class="work-card-copy">${escapeHtml(item.summary)}</p>
              <div class="work-card-meta">${meta.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>
              ${controlMarkup ? `<div class="workspace-action-row">${controlMarkup}</div>` : ""}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderAgentQueueItems(items, now, emptyMessage) {
  if (items.length === 0) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }

  return `
    <div class="work-stack">
      ${items
        .slice(0, 6)
        .map((item) => {
          const meta = [
            item.motionName,
            item.sourceType ? titleizeStatus(item.sourceType.replaceAll("_", " ")) : null,
            formatRelative(item.dueAt, now),
          ].filter(Boolean);

          return `
            <article class="work-card">
              <div class="work-card-head">
                <div>
                  <div class="mini-eyebrow">${escapeHtml(titleizeStatus(item.state))}</div>
                  <h3>${escapeHtml(item.subject)}</h3>
                </div>
                <span class="chip chip-${item.state === "due_now" ? "accent" : "quiet"}">${escapeHtml(
                  formatRelative(item.dueAt, now),
                )}</span>
              </div>
              <p class="work-card-copy">${escapeHtml(item.action)}</p>
              <div class="work-card-meta">${meta.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderWorkspaceActionLinksMarkup(links) {
  return toArray(links)
    .map((link) => `
      <a
        class="action-button action-button-quiet action-link-button"
        href="${escapeHtml(link.href)}"
        target="_blank"
        rel="noreferrer"
      >${escapeHtml(link.label)}</a>
    `)
    .join("");
}

function renderWorkspaceActionButtonMarkup(actions, interactive) {
  if (!interactive?.enabled || !actions.length) {
    return "";
  }

  return actions
    .map((action) => `
      <button
        class="action-button workspace-action-button"
        type="button"
        data-action="${escapeHtml(JSON.stringify(action))}"
      >${escapeHtml(action.label)}</button>
    `)
    .join("");
}

function renderWorkspaceActionButtons(actions, interactive) {
  const buttons = renderWorkspaceActionButtonMarkup(actions, interactive);
  if (!buttons) {
    return "";
  }

  return `
    <div class="workspace-action-row">
      ${buttons}
    </div>
  `;
}

function renderBacklogQueue(agentQueue, interactive) {
  const cards = [];

  agentQueue.blockers.forEach((item) => {
    cards.push(`
      <article class="mini-card">
        <div class="mini-card-head">
          <span class="mini-eyebrow">${escapeHtml(titleizeStatus(item.channel))}</span>
          <strong>${escapeHtml(`${item.blockedReadyCount} blocked-ready`)}</strong>
        </div>
        <p>${escapeHtml(
          `${item.blockedCompanyCount} compan${item.blockedCompanyCount === 1 ? "y" : "ies"} need assignment${item.firstCompanyName ? `. Start with ${item.firstCompanyName}.` : "."}`,
        )}</p>
        ${renderWorkspaceActionButtons(toArray(item.stateActions), interactive)}
      </article>
    `);
  });

  agentQueue.packets.forEach((item) => {
    cards.push(`
      <article class="mini-card">
        <div class="mini-card-head">
          <span class="mini-eyebrow">${escapeHtml(titleizeStatus(item.channel))}</span>
          <strong>${escapeHtml(`${item.count} ${titleizeStatus(item.kind)}`)}</strong>
        </div>
        <p>${escapeHtml(item.preview.join(" / ") || item.firstMotionName || "Claimable packet backlog exposed.")}</p>
        ${renderWorkspaceActionButtons(toArray(item.stateActions), interactive)}
      </article>
    `);
  });

  if (cards.length === 0) {
    return `<div class="empty-state">No blocked-ready work or background packet backlog is exposed right now.</div>`;
  }

  return `<div class="mini-stack">${cards.join("")}</div>`;
}

function renderTruthAccounts(truthAccounts, now) {
  return truthAccounts
    .map((account) => {
      const accountSummary = [
        formatCount(account.actionableSurfaceCount, "actionable surface"),
        formatCount(account.uncheckedSurfaceCount, "unchecked surface"),
        formatCount(account.surfaces.length, "tracked surface"),
      ].join(" · ");

      const surfaceMarkup =
        account.surfaces.length === 0
          ? `<div class="empty-state">No governed inbound surfaces are exposed for this account yet.</div>`
          : account.surfaces
              .map((surface) => {
                const fields = [
                  ["lastRunStatus", surface.lastRunStatus ?? "unknown"],
                  ["lastSyncedAt", formatTimestamp(surface.lastSyncedAt)],
                  ["lastObservedAt", formatTimestamp(surface.lastObservedAt)],
                  ["lastItemCount", surface.lastItemCount ?? "none"],
                ];

                return `
                  <article class="surface-card tone-${escapeHtml(surface.meta.tone)}">
                    <div class="surface-card-head">
                      <div>
                        <div class="mini-eyebrow">${escapeHtml(surface.truthLevel)}</div>
                        <h4>${escapeHtml(surface.label)}</h4>
                      </div>
                      <div class="chip-row">${renderChips(surface.meta.chips)}</div>
                    </div>
                    <p class="surface-summary">${escapeHtml(surface.summary ?? surface.meta.freshnessLabel)}</p>
                    <div class="surface-field-grid">
                      ${fields
                        .map(
                          ([label, value]) => `
                            <div class="surface-field">
                              <span>${escapeHtml(label)}</span>
                              <strong>${escapeHtml(String(value))}</strong>
                            </div>
                          `,
                        )
                        .join("")}
                    </div>
                    <div class="surface-foot">
                      <span>${escapeHtml(surface.meta.freshnessLabel)}</span>
                      <span>${escapeHtml(formatRelative(surface.meta.lastMeaningfulAt?.toISOString(), now))}</span>
                    </div>
                    ${
                      surface.recommendedAction
                        ? `<p class="surface-action">${escapeHtml(surface.recommendedAction)}</p>`
                        : ""
                    }
                  </article>
                `;
              })
              .join("");

      return `
        <section class="account-truth-group">
          <div class="account-truth-head">
            <div>
              <div class="mini-eyebrow">${escapeHtml(account.capability)}</div>
              <h3>${escapeHtml(account.handle)}</h3>
            </div>
            <p>${escapeHtml(accountSummary)}</p>
          </div>
          <div class="surface-grid">${surfaceMarkup}</div>
        </section>
      `;
    })
    .join("");
}

function renderMotionCards(motions) {
  return motions
    .map((motion) => {
      const identitySummary = compactCountLine(motion.executionIdentityCounts) || "No execution identity data";
      const queueSummary = [
        formatCount(motion.companyCount, "company"),
        formatCount(motion.prospectCount, "prospect"),
        formatCount(motion.readyToSendCount, "ready branch"),
      ].join(" · ");
      const dailySummary = [
        formatCount(motion.dueNowCount, "due now"),
        formatCount(motion.waitingCount, "waiting"),
        formatCount(motion.reviewCount, "review item"),
      ].join(" · ");

      return `
        <article class="motion-card">
          <div class="motion-card-head">
            <div>
              <div class="mini-eyebrow">${escapeHtml(titleizeStatus(motion.status))}</div>
              <h3>${escapeHtml(motion.name)}</h3>
            </div>
            <div class="chip-row">
              <span class="chip chip-${motion.readyToEngage ? "good" : "warning"}">${escapeHtml(
                motion.readyToEngage ? "engageable" : "not engageable",
              )}</span>
              <span class="chip chip-quiet">${escapeHtml(titleizeStatus(motion.overallStage))}</span>
            </div>
          </div>
          <div class="metric-strip">
            <div>
              <span>Updated</span>
              <strong>${escapeHtml(formatTimestamp(motion.updatedAt))}</strong>
            </div>
            <div>
              <span>Motion queue</span>
              <strong>${escapeHtml(queueSummary)}</strong>
            </div>
            <div>
              <span>Planner pressure</span>
              <strong>${escapeHtml(dailySummary)}</strong>
            </div>
          </div>
          <div class="motion-note-grid">
            <div class="note-card">
              <span>Browser gate</span>
              <strong>${escapeHtml(titleizeStatus(motion.browserGate?.status ?? "unknown"))}</strong>
              <p>${escapeHtml(motion.browserGate?.message ?? "No clear execution gate is recorded for this motion yet.")}</p>
            </div>
            <div class="note-card">
              <span>Execution identity</span>
              <strong>${escapeHtml(identitySummary)}</strong>
              <p>Pinned sending identity coverage across the companies in this motion.</p>
            </div>
          </div>
          <div class="motion-actions">
            <span>Top next actions</span>
            <ul>
              ${
                motion.nextActions.length > 0
                  ? motion.nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")
                  : "<li>No motion-level next actions were exposed.</li>"
              }
            </ul>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderLaneSection(title, subtitle, lanes, renderCard) {
  return `
    <section class="lane-section">
      <div class="subsection-head">
        <div>
          <div class="mini-eyebrow">Current Exo state</div>
          <h3>${escapeHtml(title)}</h3>
        </div>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <div class="lane-grid">
        ${lanes
          .map((lane) => {
            const count = lane.items.length;
            return `
              <section class="lane-column">
                <div class="lane-head">
                  <div>
                    <h4>${escapeHtml(lane.label)}</h4>
                    <p>${escapeHtml(lane.description)}</p>
                  </div>
                  <strong>${count}</strong>
                </div>
                <div class="lane-stack">
                  ${
                    count > 0
                      ? lane.items.map(renderCard).join("")
                      : `<div class="empty-state">Nothing in this lane right now.</div>`
                  }
                </div>
              </section>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderCompanyPrepCard(company) {
  const companyLogoUrl = company.logoUrl ?? company.companyLogoUrl ?? null;

  return `
    <article class="prep-card">
      <div class="prep-card-head">
        <div class="entity-row">
          ${renderAvatar(company.companyName, companyLogoUrl, "company")}
          <div class="entity-copy">
            <div class="mini-eyebrow">${escapeHtml(company.motionName)}</div>
            <h4>${escapeHtml(company.companyName)}</h4>
            <p class="entity-subline">${escapeHtml(
              extractHost(company.websiteUrl) ?? company.domain ?? "canonical identity still incomplete",
            )}</p>
          </div>
        </div>
        <span class="chip chip-${company.executionIdentity?.status === "pinned-ready" ? "good" : "warning"}">${escapeHtml(
          titleizeStatus(company.executionIdentity?.status ?? "unknown"),
        )}</span>
      </div>
      <div class="mini-metrics">
        <span>${escapeHtml(titleizeStatus(company.queueStatus))}</span>
        <span>${escapeHtml(formatCount(company.signalMatchCount, "signal"))}</span>
        <span>${escapeHtml(formatCount(company.prospectCount, "prospect"))}</span>
      </div>
      <p>${escapeHtml(company.lane.description)}</p>
      <div class="kv-grid">
        <div><span>through-lines ready</span><strong>${company.readyThroughLineCount}</strong></div>
        <div><span>opening plans ready</span><strong>${company.readyOpeningPlanCount}</strong></div>
        <div><span>cadence ready</span><strong>${company.readyCadenceCount}</strong></div>
        <div><span>missing email fallback</span><strong>${company.missingEmailFallbackCount}</strong></div>
      </div>
    </article>
  `;
}

function renderProspectPrepCard(prospect) {
  const liveBranch = Boolean(prospect.cadenceState?.lastTouchAt || toArray(prospect.touches).length > 0);
  const channelSummary = `${humanizeChannel(prospect.primaryChannel)} → ${humanizeChannel(
    prospect.fallbackChannel,
  )}`;
  const enrichStatus = prospect.contactEnrichmentState?.status ?? "unknown";
  const avatarUrl = prospect.avatarUrl ?? prospect.profileImageUrl ?? null;

  return `
    <article class="prep-card">
      <div class="prep-card-head">
        <div class="entity-row">
          ${renderAvatar(prospect.name, avatarUrl, "person")}
          <div class="entity-copy">
            <div class="mini-eyebrow">${escapeHtml(prospect.motionName)}</div>
            <h4>${escapeHtml(prospect.name)}</h4>
            <p class="entity-subline">${escapeHtml(prospect.title)}</p>
          </div>
        </div>
        <div class="chip-row">
          <span class="chip chip-${liveBranch ? "warning" : "quiet"}">${escapeHtml(
            liveBranch ? "engagement live" : "not launched",
          )}</span>
          <span class="chip chip-${prospect.recentPost?.engageable ? "accent" : "quiet"}">${escapeHtml(
            prospect.recentPost?.engageable ? "warmup ready" : "no live warmup",
          )}</span>
        </div>
      </div>
      <div class="mini-metrics">
        <span>${escapeHtml(prospect.companyName)}</span>
        <span>${escapeHtml(channelSummary)}</span>
      </div>
      <p>${escapeHtml(prospect.lane.description)}</p>
      <div class="kv-grid">
        <div><span>queue</span><strong>${escapeHtml(titleizeStatus(prospect.queueStatus))}</strong></div>
        <div><span>through-line</span><strong>${escapeHtml(titleizeStatus(prospect.throughLineStatus))}</strong></div>
        <div><span>opening plan</span><strong>${escapeHtml(titleizeStatus(prospect.openingPlanStatus))}</strong></div>
        <div><span>contact enrichment</span><strong>${escapeHtml(titleizeStatus(enrichStatus))}</strong></div>
      </div>
    </article>
  `;
}

function renderEngagementCard(prospect, now) {
  const dailyItem = prospect.dailyItem;
  const reviewItem = prospect.reviewItem;
  const touch = latestTouch(prospect);
  const cadence = prospect.cadenceState ?? {};
  const lastOutcome = cadence.lastTouchOutcome ?? touch?.outcome ?? "not-started";
  const dueAt = dailyItem?.dueAt ?? cadence.nextActionDueAt ?? null;
  const overdue = dueAt ? parseDate(dueAt)?.getTime() <= now.getTime() : false;
  const nextAction = dailyItem?.recommendedAction ?? prospect.nextAction ?? cadence.nextAction ?? "No next action recorded.";
  const lastTouchSummary = touch?.summary ?? "No touch recorded in Exo.";
  const lastTouchTimestamp = touch?.occurredAt ?? cadence.lastTouchAt ?? null;
  const avatarUrl = prospect.avatarUrl ?? prospect.profileImageUrl ?? null;
  const companyLogoUrl = prospect.logoUrl ?? prospect.companyLogoUrl ?? null;

  return `
    <article class="engagement-card">
      <div class="engagement-card-head">
        <div class="entity-row">
          ${renderAvatar(prospect.name, avatarUrl, "person")}
          <div class="entity-copy">
            <div class="mini-eyebrow">${escapeHtml(prospect.motionName)}</div>
            <h4>${escapeHtml(prospect.name)}</h4>
            <p class="entity-subline">${escapeHtml(prospect.title)}</p>
          </div>
        </div>
        <div class="chip-row">
          <span class="chip chip-${overdue ? "danger" : dueAt ? "accent" : "quiet"}">${escapeHtml(
            overdue ? "overdue" : dueAt ? "timed" : "untimed",
          )}</span>
          ${reviewItem ? '<span class="chip chip-warning">inbound review</span>' : ""}
        </div>
      </div>
      <div class="entity-support-row">
        ${renderCompanyPill(prospect.companyName, prospect.websiteUrl, companyLogoUrl)}
      </div>
      <div class="mini-metrics">
        <span>primary: ${escapeHtml(humanizeChannel(prospect.primaryChannel))}</span>
        <span>fallback: ${escapeHtml(humanizeChannel(prospect.fallbackChannel))}</span>
      </div>
      <div class="kv-grid kv-grid-dense">
        <div><span>current step</span><strong>${escapeHtml(titleizeStatus(cadence.currentStep ?? "none"))}</strong></div>
        <div><span>last outcome</span><strong>${escapeHtml(titleizeStatus(lastOutcome))}</strong></div>
        <div><span>last touch</span><strong>${escapeHtml(formatTimestamp(lastTouchTimestamp))}</strong></div>
        <div><span>due time</span><strong>${escapeHtml(formatTimestamp(dueAt))}</strong></div>
      </div>
      <p class="tight-copy">${escapeHtml(lastTouchSummary)}</p>
      <p class="tight-copy"><strong>Next action:</strong> ${escapeHtml(nextAction)}</p>
    </article>
  `;
}

function renderRailItems(items, emptyMessage, renderer) {
  if (items.length === 0) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }

  return items.map(renderer).join("");
}

function renderDailyRailItem(item) {
  const title =
    item.prospect?.id === "outbound-capacity:linkedin"
      ? "LinkedIn capacity deficit"
      : `${item.company?.name ?? "Unknown company"} / ${item.prospect?.name ?? "Unknown prospect"}`;

  return `
    <article class="rail-card">
      <div class="rail-card-head">
        <h4>${escapeHtml(title)}</h4>
        <span class="chip chip-${item.state === "due_now" ? "danger" : "warning"}">${escapeHtml(
          titleizeStatus(item.state),
        )}</span>
      </div>
      <p>${escapeHtml(item.recommendedAction ?? item.cadence?.nextAction ?? "No action recorded.")}</p>
      <div class="rail-meta">${escapeHtml(item.motion?.name ?? "No motion")} · ${escapeHtml(
        formatTimestamp(item.dueAt),
      )}</div>
    </article>
  `;
}

function renderReviewRailItem(item) {
  const title = `${item.company?.name ?? "Unknown company"} / ${item.prospect?.name ?? item.actorName ?? "Unknown prospect"}`;

  return `
    <article class="rail-card">
      <div class="rail-card-head">
        <h4>${escapeHtml(title)}</h4>
        <span class="chip chip-${item.priority === "high" ? "danger" : item.priority === "medium" ? "warning" : "quiet"}">${escapeHtml(
          titleizeStatus(item.priority),
        )}</span>
      </div>
      <p>${escapeHtml(item.summary)}</p>
      <div class="rail-meta">${escapeHtml(item.surfaceKey)} · ${escapeHtml(formatTimestamp(item.observedAt))}</div>
      <p class="tight-copy"><strong>Recommended:</strong> ${escapeHtml(item.recommendedAction)}</p>
    </article>
  `;
}

function renderGapNotes(notes) {
  return notes
    .map(
      (note) => `
        <article class="gap-card">
          <h4>${escapeHtml(note.title)}</h4>
          <p>${escapeHtml(note.body)}</p>
        </article>
      `,
    )
    .join("");
}

function groupIntoLanes(items, laneOrder) {
  const buckets = new Map(laneOrder.map((lane) => [lane.key, { ...lane, items: [] }]));

  items.forEach((item) => {
    const existing = buckets.get(item.lane.key) ?? buckets.get(item.engagementLane?.key);
    const laneKey = item.lane?.key ?? item.engagementLane?.key;
    if (!laneKey) {
      return;
    }

    if (!buckets.has(laneKey)) {
      const fallback = item.lane ?? item.engagementLane;
      buckets.set(laneKey, { ...fallback, items: [] });
    }

    buckets.get(laneKey).items.push(item);
  });

  return [...buckets.values()];
}

function sortEngagementCards(items, now) {
  return items.slice().sort((left, right) => {
    const leftDue = parseDate(left.dailyItem?.dueAt ?? left.cadenceState?.nextActionDueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightDue = parseDate(right.dailyItem?.dueAt ?? right.cadenceState?.nextActionDueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;

    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    const leftTouch = parseDate(left.cadenceState?.lastTouchAt)?.getTime() ?? 0;
    const rightTouch = parseDate(right.cadenceState?.lastTouchAt)?.getTime() ?? 0;

    if (leftTouch !== rightTouch) {
      return rightTouch - leftTouch;
    }

    return `${left.companyName}:${left.name}`.localeCompare(`${right.companyName}:${right.name}`);
  });
}

function renderPage({
  truthAccounts,
  motionSummaries,
  operatorSummary,
  decisionQueue,
  agentQueue,
  interactive,
  artifactSummaries,
  companyPrep,
  prospectPrep,
  engagementProspects,
  daily,
  inboundReview,
  inbox,
  gapNotes,
  now,
  regenerateCommand,
}) {
  const allSurfaces = truthAccounts.flatMap((account) => account.surfaces);
  const staleSurfaceCount = allSurfaces.filter((surface) => surface.meta.stale && !surface.meta.unchecked).length;
  const uncheckedSurfaceCount = allSurfaces.filter((surface) => surface.meta.unchecked).length;
  const actionableSurfaceCount = allSurfaces.filter((surface) => surface.meta.actionable).length;
  const readyBranchCount = motionSummaries.reduce((total, motion) => total + (motion.readyToSendCount ?? 0), 0);
  const waitingBranchCount = motionSummaries.reduce((total, motion) => total + (motion.waitingCount ?? 0), 0);
  const focusMotion = operatorSummary.focusMotion;

  const companyLanes = groupIntoLanes(companyPrep, [
    { key: "needs-company-identity", label: "Needs company identity", description: "Website or LinkedIn company identity is still missing." },
    { key: "queued-for-research", label: "Queued for research", description: "Identity exists, but research is not complete yet." },
    { key: "researched", label: "Researched / pick prospects", description: "Signals are in, but prospect selection is still open." },
    { key: "selected", label: "Selected / build branches", description: "Prospects exist, but branch scaffolding is incomplete." },
    { key: "targeting-ready", label: "Targeting ready", description: "Company prep is already usable for outreach branches." },
    { key: "suppressed", label: "Suppressed", description: "This company is intentionally out of play." },
    { key: "exhausted", label: "Exhausted", description: "No more viable company work is exposed right now." },
  ]).map((lane) => ({
    ...lane,
    items: sortByName(lane.items, "companyName"),
  }));

  const prospectPrepLanes = groupIntoLanes(prospectPrep, [
    { key: "needs-through-line", label: "Needs through-line", description: "The branch still lacks a why-talk line." },
    { key: "needs-opening-plan", label: "Needs opening plan", description: "The first move is not defensible yet." },
    { key: "needs-cadence", label: "Needs cadence state", description: "Exo does not yet expose a usable current step." },
    { key: "contact-enrichment-pending", label: "Contact enrichment pending", description: "Core branch logic exists, but fallback coverage is still open." },
    { key: "primary-only-ready", label: "Ready but weak fallback", description: "Primary path exists, but direct fallback is still thin." },
    { key: "prep-complete", label: "Prep complete", description: "Prep is done; engagement state is separate." },
  ]).map((lane) => ({
    ...lane,
    items: sortByName(lane.items, "name"),
  }));

  const engagementLanes = [
    { key: "ready", label: "Ready", description: "Prepared branches that still need their first governed move." },
    { key: "sent-pending", label: "Sent / pending", description: "Touches are in flight and waiting on the other side." },
    { key: "waiting", label: "Waiting", description: "Branches intentionally held in reserve or waiting on a checkpoint." },
    { key: "blocked", label: "Blocked", description: "Primary path failed or the channel blocked." },
    { key: "reply-accepted", label: "Reply / accepted", description: "Cold-start phase is over; live response handling takes over." },
    { key: "exhausted", label: "Exhausted", description: "No further governed move is exposed here right now." },
  ].map((lane) => ({
    ...lane,
    items: sortEngagementCards(
      engagementProspects.filter((prospect) => prospect.engagementLane.key === lane.key),
      now,
    ),
  }));

  const linkedInCapacity = daily.capacity?.linkedin ?? null;
  const deficit = linkedInCapacity?.execution?.inventoryShortfall ?? null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exo Motion Workspace Projection</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090b0f;
      --panel: #11141a;
      --panel-strong: #171b23;
      --panel-soft: #0d1015;
      --line: rgba(255, 255, 255, 0.09);
      --line-strong: rgba(255, 255, 255, 0.16);
      --text: #eef2f8;
      --muted: #98a4b5;
      --cold: #667387;
      --accent: #346bff;
      --accent-soft: rgba(52, 107, 255, 0.16);
      --good: #33c28c;
      --good-soft: rgba(51, 194, 140, 0.14);
      --warn: #f0a44d;
      --warn-soft: rgba(240, 164, 77, 0.14);
      --drift: #f06f7e;
      --drift-soft: rgba(240, 111, 126, 0.14);
      --disabled: #778294;
      --disabled-soft: rgba(119, 130, 148, 0.16);
      --radius: 20px;
      --radius-sm: 13px;
      --shadow: 0 22px 60px rgba(0, 0, 0, 0.32);
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top left, rgba(52, 107, 255, 0.18), transparent 26%),
        linear-gradient(180deg, #090b0f 0%, #07090d 100%);
      color: var(--text);
      font-family: "Manrope", sans-serif;
    }

    body {
      padding: 24px;
    }

    h1, h2, h3, h4, p, ul {
      margin: 0;
    }

    ul {
      padding-left: 18px;
    }

    code {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.9em;
    }

    .page-shell {
      max-width: 1600px;
      margin: 0 auto;
      display: grid;
      gap: 18px;
    }

    .workspace-topbar {
      padding: 22px 24px;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: linear-gradient(180deg, rgba(18, 22, 28, 0.98), rgba(12, 15, 21, 0.98));
      box-shadow: var(--shadow);
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: flex-start;
    }

    .workspace-topbar h1 {
      margin-top: 10px;
      font-size: clamp(1.8rem, 3vw, 2.6rem);
      line-height: 1;
      letter-spacing: -0.05em;
    }

    .topbar-main {
      display: grid;
      gap: 12px;
    }

    .topbar-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .focus-chip {
      padding: 12px 14px;
      min-width: 160px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.03);
    }

    .focus-chip strong {
      display: block;
      margin-top: 6px;
      font-size: 0.98rem;
    }

    .topbar-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 8px;
    }

    .control-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.8fr);
      gap: 18px;
      align-items: start;
    }

    .secondary-stack {
      display: grid;
      gap: 18px;
    }

    .queue-panel {
      display: grid;
      gap: 16px;
    }

    .queue-panel-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }

    .queue-panel-head h2,
    .queue-panel-head h3 {
      margin-top: 8px;
      letter-spacing: -0.04em;
    }

    .queue-panel-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .work-stack,
    .mini-stack {
      display: grid;
      gap: 12px;
    }

    .queue-panel .work-stack {
      max-height: 680px;
      overflow: auto;
      padding-right: 4px;
    }

    .work-card,
    .mini-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(18, 21, 28, 0.98), rgba(13, 16, 21, 0.98));
    }

    .work-card {
      padding: 16px;
      display: grid;
      gap: 12px;
    }

    .mini-card {
      padding: 14px 16px;
      display: grid;
      gap: 8px;
    }

    .work-card-danger {
      border-color: rgba(239, 139, 139, 0.22);
      background: linear-gradient(180deg, rgba(41, 23, 30, 0.96), rgba(13, 16, 21, 0.98));
    }

    .work-card-head,
    .mini-card-head {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: flex-start;
    }

    .work-card-head h3 {
      margin-top: 8px;
      font-size: 1rem;
      letter-spacing: -0.03em;
    }

    .work-card-copy,
    .mini-card p {
      color: var(--text);
      line-height: 1.55;
    }

    .work-card-subline {
      margin-top: -4px;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.45;
    }

    .mini-card p {
      color: var(--muted);
    }

    .work-card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      color: var(--muted);
      font-size: 0.8rem;
      font-family: "IBM Plex Mono", monospace;
    }

    .work-card-meta span::after {
      content: "•";
      margin-left: 10px;
      color: rgba(255, 255, 255, 0.18);
    }

    .work-card-meta span:last-child::after {
      content: "";
      margin: 0;
    }

    .workspace-action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .action-button {
      appearance: none;
      border: 1px solid rgba(52, 107, 255, 0.28);
      background: rgba(52, 107, 255, 0.12);
      color: var(--text);
      border-radius: 999px;
      padding: 8px 12px;
      font: inherit;
      font-size: 0.84rem;
      cursor: pointer;
      transition: 140ms ease;
    }

    .action-link-button {
      display: inline-flex;
      align-items: center;
      text-decoration: none;
    }

    .action-button:hover {
      background: rgba(52, 107, 255, 0.18);
      border-color: rgba(52, 107, 255, 0.42);
    }

    .action-button:disabled {
      cursor: wait;
      opacity: 0.6;
    }

    .action-button-quiet {
      border-color: rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.04);
    }

    .workspace-status {
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(52, 107, 255, 0.22);
      background: rgba(52, 107, 255, 0.08);
      color: var(--text);
      font-size: 0.9rem;
    }

    .workspace-status.is-error {
      border-color: rgba(239, 139, 139, 0.24);
      background: rgba(239, 139, 139, 0.12);
    }

    .hero,
    .section,
    .rail-panel,
    .gap-section {
      border: 1px solid var(--line);
      border-radius: 24px;
      background: linear-gradient(180deg, rgba(18, 22, 28, 0.98), rgba(12, 15, 21, 0.98));
      box-shadow: var(--shadow);
    }

    .hero {
      padding: 28px;
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(320px, 1fr);
      gap: 24px;
      border-color: rgba(52, 107, 255, 0.2);
    }

    .hero h1 {
      margin-top: 10px;
      font-size: clamp(2.1rem, 4vw, 3.2rem);
      line-height: 0.98;
      letter-spacing: -0.05em;
      max-width: 12ch;
    }

    .hero-copy {
      color: var(--muted);
      max-width: 70ch;
      line-height: 1.65;
      margin-top: 14px;
    }

    .hero-main {
      display: grid;
      gap: 18px;
    }

    .hero-metrics {
      display: grid;
      gap: 12px;
      align-content: start;
    }

    .metric-card {
      padding: 16px 18px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.028), rgba(255, 255, 255, 0.012));
    }

    .metric-card span,
    .note-card span,
    .surface-field span,
    .kv-grid span,
    .mini-metrics span,
    .rail-meta,
    .mini-eyebrow,
    .section-eyebrow {
      display: block;
      color: var(--muted);
      font-size: 0.8rem;
    }

    .metric-card strong,
    .note-card strong,
    .surface-field strong,
    .kv-grid strong,
    .lane-head strong,
    .artifact-row strong,
    .operator-call strong {
      display: block;
      margin-top: 6px;
      font-size: 1rem;
    }

    .eyebrow,
    .mini-eyebrow,
    .section-eyebrow {
      color: var(--accent);
      font-family: "IBM Plex Mono", monospace;
      text-transform: uppercase;
      letter-spacing: 0.14em;
    }

    .eyebrow {
      font-size: 0.78rem;
    }

    .mini-eyebrow,
    .section-eyebrow {
      font-size: 0.7rem;
    }

    .content-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 18px;
      align-items: start;
    }

    .main-column {
      display: grid;
      gap: 18px;
    }

    .section {
      padding: 24px;
    }

    .operator-call {
      padding: 18px;
      border-radius: 18px;
      border: 1px solid rgba(52, 107, 255, 0.24);
      background:
        linear-gradient(180deg, rgba(52, 107, 255, 0.12), rgba(52, 107, 255, 0.03)),
        rgba(11, 15, 22, 0.9);
      display: grid;
      gap: 14px;
    }

    .operator-call-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }

    .operator-call h2,
    .artifact-card h3 {
      margin-top: 8px;
      letter-spacing: -0.04em;
    }

    .operator-next-move {
      font-size: 1.05rem;
      line-height: 1.6;
      color: var(--text);
    }

    .operator-why,
    .operator-focus p,
    .artifact-row > div span,
    .artifact-card p {
      color: var(--muted);
      line-height: 1.6;
    }

    .operator-focus {
      display: grid;
      gap: 8px;
      padding-top: 2px;
    }

    .operator-focus strong {
      font-size: 1rem;
    }

    .operator-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 10px;
    }

    .operator-item {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
    }

    .operator-item p {
      margin-top: 6px;
      color: var(--muted);
      line-height: 1.55;
    }

    .operator-item span {
      color: var(--cold);
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.76rem;
      white-space: nowrap;
    }

    .section-head,
    .subsection-head,
    .account-truth-head,
    .motion-card-head,
    .artifact-card-head,
    .surface-card-head,
    .prep-card-head,
    .engagement-card-head,
    .rail-card-head,
    .lane-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }

    .section-head h2,
    .subsection-head h3 {
      margin-top: 10px;
      letter-spacing: -0.04em;
    }

    .section-head p,
    .subsection-head p,
    .motion-card p,
    .prep-card p,
    .engagement-card p,
    .surface-summary,
    .surface-action,
    .gap-card p,
    .rail-card p {
      color: var(--muted);
      line-height: 1.6;
    }

    .summary-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }

    .summary-chip {
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.022);
    }

    .summary-chip strong {
      display: block;
      margin-top: 6px;
      font-size: 1rem;
    }

    .truth-stack,
    .motion-grid,
    .gap-grid,
    .artifact-grid {
      display: grid;
      gap: 16px;
      margin-top: 18px;
    }

    .account-truth-group {
      padding: 18px;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.018);
    }

    .account-truth-head h3,
    .motion-card h3 {
      margin-top: 8px;
      font-size: 1.3rem;
      letter-spacing: -0.04em;
    }

    .surface-grid,
    .motion-grid,
    .artifact-grid {
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }

    .surface-grid {
      display: grid;
      gap: 12px;
      margin-top: 14px;
    }

    .surface-card,
    .motion-card,
    .artifact-card,
    .prep-card,
    .engagement-card,
    .rail-card,
    .gap-card,
    .note-card {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(18, 21, 28, 0.98), rgba(13, 16, 21, 0.98));
    }

    .surface-card,
    .motion-card,
    .artifact-card,
    .prep-card,
    .engagement-card,
    .rail-card,
    .gap-card {
      padding: 16px;
    }

    .tone-danger {
      border-color: rgba(239, 139, 139, 0.36);
      background: linear-gradient(180deg, rgba(52, 24, 30, 0.82), rgba(18, 12, 15, 0.98));
    }

    .tone-warning {
      border-color: rgba(240, 164, 77, 0.32);
      background: linear-gradient(180deg, rgba(55, 35, 20, 0.74), rgba(18, 13, 10, 0.98));
    }

    .tone-accent {
      border-color: rgba(52, 107, 255, 0.32);
      background: linear-gradient(180deg, rgba(20, 35, 68, 0.8), rgba(12, 16, 26, 0.98));
    }

    .tone-good {
      border-color: rgba(51, 194, 140, 0.3);
      background: linear-gradient(180deg, rgba(18, 43, 35, 0.74), rgba(11, 16, 15, 0.98));
    }

    .tone-disabled {
      opacity: 0.72;
      border-color: rgba(108, 119, 133, 0.25);
    }

    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid transparent;
      font-size: 0.72rem;
      line-height: 1;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-family: "IBM Plex Mono", monospace;
    }

    .chip-good {
      color: var(--good);
      border-color: rgba(123, 220, 177, 0.26);
      background: var(--good-soft);
    }

    .chip-warning {
      color: var(--warn);
      border-color: rgba(214, 155, 109, 0.26);
      background: var(--warn-soft);
    }

    .chip-danger {
      color: var(--drift);
      border-color: rgba(239, 139, 139, 0.26);
      background: var(--drift-soft);
    }

    .chip-accent {
      color: var(--accent);
      border-color: rgba(52, 107, 255, 0.26);
      background: var(--accent-soft);
    }

    .chip-quiet {
      color: var(--muted);
      border-color: rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
    }

    .chip-disabled {
      color: var(--disabled);
      border-color: rgba(108, 119, 133, 0.24);
      background: var(--disabled-soft);
    }

    .surface-card h4,
    .prep-card h4,
    .engagement-card h4,
    .rail-card h4,
    .gap-card h4 {
      margin-top: 8px;
      font-size: 1rem;
      letter-spacing: -0.03em;
    }

    .surface-summary,
    .surface-action,
    .tight-copy {
      margin-top: 12px;
    }

    .entity-row {
      display: flex;
      gap: 12px;
      align-items: center;
      min-width: 0;
    }

    .entity-copy {
      min-width: 0;
    }

    .entity-copy h4 {
      margin-top: 6px;
    }

    .entity-subline {
      margin-top: 6px;
      color: var(--muted);
      line-height: 1.45;
    }

    .entity-support-row {
      margin-top: 14px;
    }

    .avatar {
      position: relative;
      flex: 0 0 auto;
      width: 46px;
      height: 46px;
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #131821;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
    }

    .avatar-company {
      width: 40px;
      height: 40px;
      border-radius: 14px;
    }

    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .avatar-fallback {
      font-family: "IBM Plex Mono", monospace;
      font-size: 0.9rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: rgba(255, 255, 255, 0.9);
    }

    .avatar-theme-0 { background: linear-gradient(135deg, #355cff, #182a60); }
    .avatar-theme-1 { background: linear-gradient(135deg, #00a7e1, #114168); }
    .avatar-theme-2 { background: linear-gradient(135deg, #7f4dff, #342163); }
    .avatar-theme-3 { background: linear-gradient(135deg, #13b57c, #163f38); }
    .avatar-theme-4 { background: linear-gradient(135deg, #ef8c3d, #5b2e12); }
    .avatar-theme-5 { background: linear-gradient(135deg, #f05f7a, #5e1e31); }

    .company-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
    }

    .company-pill-copy {
      min-width: 0;
    }

    .company-pill-copy strong,
    .company-pill-copy span {
      display: block;
    }

    .company-pill-copy strong {
      font-size: 0.88rem;
      line-height: 1.2;
    }

    .company-pill-copy span {
      margin-top: 4px;
      color: var(--muted);
      font-size: 0.74rem;
    }

    .surface-field-grid,
    .metric-strip,
    .motion-note-grid,
    .kv-grid,
    .gap-grid {
      display: grid;
      gap: 10px;
    }

    .surface-field-grid,
    .metric-strip,
    .motion-note-grid,
    .kv-grid {
      margin-top: 14px;
    }

    .surface-field-grid,
    .kv-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .kv-grid-dense {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .surface-field,
    .summary-chip,
    .metric-card,
    .note-card {
      padding: 12px;
      border-radius: 14px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.024);
    }

    .surface-foot,
    .mini-metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }

    .mini-metrics span,
    .surface-foot span {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--muted);
      font-size: 0.76rem;
    }

    .motion-grid {
      display: grid;
      margin-top: 18px;
    }

    .artifact-stack {
      display: grid;
      gap: 10px;
    }

    .artifact-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.02);
    }

    .motion-actions {
      margin-top: 14px;
    }

    .motion-actions span {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 0.8rem;
    }

    .motion-actions li {
      color: var(--text);
      margin-top: 6px;
      line-height: 1.45;
    }

    .lane-section + .lane-section {
      margin-top: 20px;
    }

    .lane-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
      margin-top: 18px;
    }

    .lane-column {
      padding: 0;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(18, 21, 28, 0.98), rgba(12, 15, 20, 0.98));
      min-height: 220px;
      overflow: hidden;
    }

    .lane-stack {
      display: grid;
      gap: 12px;
      padding: 14px;
      background: rgba(7, 9, 13, 0.28);
    }

    .lane-head {
      padding: 16px 16px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(255, 255, 255, 0.018);
    }

    .empty-state {
      padding: 14px;
      border-radius: 14px;
      border: 1px dashed rgba(255, 255, 255, 0.12);
      color: var(--muted);
      background: rgba(255, 255, 255, 0.02);
      line-height: 1.5;
    }

    .right-rail {
      position: sticky;
      top: 24px;
      display: grid;
      gap: 18px;
    }

    .rail-panel {
      padding: 18px;
    }

    .rail-panel h3 {
      margin-top: 8px;
      letter-spacing: -0.03em;
    }

    .rail-stack {
      display: grid;
      gap: 12px;
      margin-top: 16px;
    }

    .rail-meta {
      margin-top: 10px;
    }

    .gap-section {
      padding: 24px;
    }

    .gap-grid {
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      margin-top: 18px;
    }

    .regen {
      margin-top: 14px;
      padding: 12px;
      border-radius: 14px;
      border: 1px solid rgba(52, 107, 255, 0.2);
      background: rgba(52, 107, 255, 0.08);
      color: var(--text);
      line-height: 1.6;
    }

    @media (max-width: 1200px) {
      .content-grid,
      .hero,
      .control-grid {
        grid-template-columns: 1fr;
      }

      .workspace-topbar {
        flex-direction: column;
      }

      .right-rail {
        position: static;
      }
    }

    @media (max-width: 760px) {
      body {
        padding: 14px;
      }

      .summary-strip,
      .surface-field-grid,
      .metric-strip,
      .motion-note-grid,
      .kv-grid,
      .kv-grid-dense {
        grid-template-columns: 1fr;
      }

      .section,
      .hero,
      .workspace-topbar,
      .gap-section,
      .rail-panel {
        padding: 18px;
      }

      .topbar-meta,
      .queue-panel-head,
      .operator-item,
      .artifact-row {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <div class="page-shell">
    <header class="workspace-topbar">
      <div class="topbar-main">
        <div class="eyebrow">Workspace</div>
        <h1>Exo workspace</h1>
      </div>
      <div class="topbar-meta">
        <div class="focus-chip">
          <span>Generated</span>
          <strong>${escapeHtml(formatTimestamp(now.toISOString()))}</strong>
        </div>
        ${
          focusMotion
            ? `
              <div class="focus-chip">
                <span>Focus</span>
                <strong>${escapeHtml(focusMotion.name)}</strong>
              </div>
            `
            : ""
        }
        <div class="focus-chip">
          <span>Ready</span>
          <strong>${escapeHtml(`${readyBranchCount} branch${readyBranchCount === 1 ? "" : "es"}`)}</strong>
        </div>
        <div class="focus-chip">
          <span>LinkedIn deficit</span>
          <strong>${escapeHtml(deficit == null ? "None" : String(deficit))}</strong>
        </div>
      </div>
    </header>
    ${
      interactive?.enabled
        ? `
          <div class="topbar-controls">
            <button class="action-button action-button-quiet" type="button" data-workspace-refresh>Refresh</button>
          </div>
          <div id="workspace-status" class="workspace-status" hidden></div>
        `
        : ""
    }

    <section class="control-grid">
      <section class="section queue-panel">
        <div class="queue-panel-head">
          <div>
            <div class="section-eyebrow">Operator inbox</div>
            <h2>Need decision</h2>
          </div>
          <div class="queue-panel-stats">
            <span class="chip chip-danger">${escapeHtml(`${decisionQueue.itemCount} open`)}</span>
            <span class="chip chip-warning">${escapeHtml(`${decisionQueue.replyCount} replies`)}</span>
            <span class="chip chip-quiet">${escapeHtml(`${decisionQueue.decisionCount} yes/no`)}</span>
          </div>
        </div>
        ${renderDecisionQueue(decisionQueue, now, interactive)}
      </section>

      <div class="secondary-stack">
        <section class="section queue-panel">
          <div class="queue-panel-head">
            <div>
              <div class="section-eyebrow">Agent</div>
              <h3>Agent queue</h3>
            </div>
            <div class="queue-panel-stats">
              <span class="chip chip-accent">${escapeHtml(`${agentQueue.itemCount} due`)}</span>
              <span class="chip chip-quiet">${escapeHtml(`${agentQueue.waitingCount} waiting`)}</span>
            </div>
          </div>
          ${renderAgentQueueItems(
            agentQueue.items,
            now,
            "No background execution queue is exposed right now.",
          )}
        </section>

        <section class="section queue-panel">
          <div class="queue-panel-head">
            <div>
              <div class="section-eyebrow">Blocked / backlog</div>
              <h3>Blocked and claimable</h3>
            </div>
            <div class="queue-panel-stats">
              <span class="chip chip-warning">${escapeHtml(`${agentQueue.blockedReadyCount} blocked-ready`)}</span>
              <span class="chip chip-quiet">${escapeHtml(`${agentQueue.packetCount} packets`)}</span>
            </div>
          </div>
          ${renderBacklogQueue(agentQueue, interactive)}
        </section>
      </div>
    </section>

    <div class="summary-strip">
      <div class="summary-chip">
        <span>Need decision</span>
        <strong>${decisionQueue.itemCount}</strong>
      </div>
      <div class="summary-chip">
        <span>Watch signals</span>
        <strong>${decisionQueue.parkedSignalCount}</strong>
      </div>
      <div class="summary-chip">
        <span>Agent queue</span>
        <strong>${agentQueue.itemCount}</strong>
      </div>
      <div class="summary-chip">
        <span>Blocked-ready</span>
        <strong>${agentQueue.blockedReadyCount}</strong>
      </div>
      <div class="summary-chip">
        <span>Waiting</span>
        <strong>${waitingBranchCount}</strong>
      </div>
      <div class="summary-chip">
        <span>Unchecked surfaces</span>
        <strong>${uncheckedSurfaceCount}</strong>
      </div>
    </div>

    <section class="section">
      <div class="section-head">
        <div>
          <div class="section-eyebrow">Motions</div>
          <h2>Motion state</h2>
        </div>
      </div>
      <div class="artifact-grid">${renderArtifactInventory(artifactSummaries)}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <div class="section-eyebrow">Truth</div>
          <h2>Truth surfaces</h2>
        </div>
      </div>
      <div class="summary-strip">
        <div class="summary-chip">
          <span>Connected accounts</span>
          <strong>${truthAccounts.length}</strong>
        </div>
        <div class="summary-chip">
          <span>Enabled surfaces</span>
          <strong>${inboundReview.surfaces?.enabledSurfaceCount ?? 0}</strong>
        </div>
        <div class="summary-chip">
          <span>Unchecked surfaces</span>
          <strong>${inboundReview.surfaces?.uncheckedSurfaceCount ?? 0}</strong>
        </div>
        <div class="summary-chip">
          <span>Itemization gaps</span>
          <strong>${inboundReview.counts?.itemizationGapCount ?? 0}</strong>
        </div>
      </div>
      <div class="truth-stack">${renderTruthAccounts(truthAccounts, now)}</div>
    </section>

    <div class="content-grid">
      <div class="main-column">
        <section class="section">
          <div class="section-head">
            <div>
              <div class="section-eyebrow">Overview</div>
              <h2>Motions</h2>
            </div>
          </div>
          <div class="motion-grid">${renderMotionCards(motionSummaries)}</div>
        </section>

        <section class="section">
          <div class="section-head">
            <div>
              <div class="section-eyebrow">Prep</div>
              <h2>Prep lanes</h2>
            </div>
          </div>
          ${renderLaneSection(
            "Company prep lanes",
            "",
            companyLanes,
            renderCompanyPrepCard,
          )}
          ${renderLaneSection(
            "Prospect prep lanes",
            "",
            prospectPrepLanes,
            renderProspectPrepCard,
          )}
        </section>

        <section class="section">
          <div class="section-head">
            <div>
              <div class="section-eyebrow">Branches</div>
              <h2>Live branches</h2>
            </div>
          </div>
          <div class="lane-grid">
            ${engagementLanes
              .map(
                (lane) => `
                  <section class="lane-column">
                    <div class="lane-head">
                      <div>
                        <h4>${escapeHtml(lane.label)}</h4>
                        <p>${escapeHtml(lane.description)}</p>
                      </div>
                      <strong>${lane.items.length}</strong>
                    </div>
                    <div class="lane-stack">
                      ${renderRailItems(
                        lane.items,
                        "No prospects in this lane right now.",
                        (prospect) => renderEngagementCard(prospect, now),
                      )}
                    </div>
                  </section>
                `,
              )
              .join("")}
          </div>
        </section>

        <section class="gap-section">
          <div class="section-head">
            <div>
              <div class="section-eyebrow">Model gaps</div>
              <h2>Model gaps</h2>
            </div>
          </div>
          <div class="gap-grid">${renderGapNotes(gapNotes)}</div>
        </section>
      </div>

      <aside class="right-rail">
        <section class="rail-panel">
          <div class="section-eyebrow">Waiting</div>
          <h3>Waiting</h3>
          <div class="rail-stack">
            ${renderAgentQueueItems(
              agentQueue.waitingItems,
              now,
              "Nothing is explicitly waiting right now.",
            )}
          </div>
        </section>

        <section class="rail-panel">
          <div class="section-eyebrow">Signals</div>
          <h3>Watch signals</h3>
          <div class="rail-stack">
            ${renderRailItems(
              decisionQueue.signals.slice(0, 8),
              "No parked signals are exposed right now.",
              (item) =>
                renderReviewRailItem({
                  company: item.companyName ? { name: item.companyName } : null,
                  prospect: null,
                  actorName: item.subject,
                  priority: item.priority,
                  summary: item.summary,
                  surfaceKey: item.surfaceKey ?? "unknown",
                  observedAt: item.observedAt,
                  recommendedAction: item.recommendedAction ?? "Hold for now.",
                }),
            )}
          </div>
        </section>

        <section class="rail-panel">
          <div class="section-eyebrow">State</div>
          <h3>Workspace state</h3>
          <div class="rail-stack">
            <article class="rail-card">
              <div class="rail-card-head">
                <h4>Truth coverage</h4>
                <span class="chip chip-${uncheckedSurfaceCount > 0 ? "danger" : "quiet"}">${escapeHtml(
                  `${uncheckedSurfaceCount} unchecked`,
                )}</span>
              </div>
              <p>${escapeHtml(`${actionableSurfaceCount} actionable · ${staleSurfaceCount} stale · ${truthAccounts.length} accounts`)}</p>
            </article>
            <article class="rail-card">
              <div class="rail-card-head">
                <h4>Inbox</h4>
                <span class="chip chip-${decisionQueue.itemCount > 0 ? "danger" : "quiet"}">${escapeHtml(
                  `${decisionQueue.itemCount} decisions`,
                )}</span>
              </div>
              <p>${escapeHtml(
                `${decisionQueue.replyCount} replies · ${decisionQueue.decisionCount} yes/no items · ${decisionQueue.parkedSignalCount} watch signals`,
              )}</p>
            </article>
            <article class="rail-card">
              <div class="rail-card-head">
                <h4>Execution</h4>
                <span class="chip chip-${agentQueue.itemCount > 0 ? "accent" : "quiet"}">${escapeHtml(
                  `${agentQueue.itemCount} due`,
                )}</span>
              </div>
              <p>${escapeHtml(
                `${readyBranchCount} ready · ${agentQueue.blockedReadyCount} blocked-ready · ${agentQueue.packetCount} packets`,
              )}</p>
            </article>
          </div>
          <div class="regen">
            <div class="mini-eyebrow">Regenerate</div>
            <code>${escapeHtml(regenerateCommand)}</code>
          </div>
        </section>
      </aside>
    </div>
  </div>
  ${
    interactive?.enabled
      ? `
        <script>
          (() => {
            const actionEndpoint = ${JSON.stringify(interactive.actionEndpoint ?? "/api/action")};
            const statusEl = document.getElementById("workspace-status");
            const setStatus = (message, isError = false) => {
              if (!statusEl) return;
              statusEl.hidden = !message;
              statusEl.textContent = message || "";
              statusEl.classList.toggle("is-error", Boolean(isError));
            };

            document.querySelectorAll("[data-workspace-refresh]").forEach((button) => {
              button.addEventListener("click", () => window.location.reload());
            });

            document.querySelectorAll(".workspace-action-button").forEach((button) => {
              button.addEventListener("click", async () => {
                const payload = JSON.parse(button.dataset.action || "{}");
                const confirmMessage = payload.confirm || "Run this Exo action?";
                if (confirmMessage && !window.confirm(confirmMessage)) {
                  return;
                }

                button.disabled = true;
                setStatus("Running " + (payload.label || "workspace action") + "...");

                try {
                  const response = await fetch(actionEndpoint, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(payload),
                  });
                  const result = await response.json();

                  if (!response.ok || result.ok === false) {
                    throw new Error(result.error || result.message || "Workspace action failed.");
                  }

                  setStatus(result.message || "Workspace action complete.");
                  window.setTimeout(() => window.location.reload(), 250);
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : String(error), true);
                  button.disabled = false;
                }
              });
            });
          })();
        </script>
      `
      : ""
  }
</body>
</html>`;
}

/**
 * @param {{
 *   user: any,
 *   inboundReview: any,
 *   inbox: any,
 *   daily: any,
 *   reports: any[],
 *   regenerateCommand?: string,
 *   interactive?: { enabled?: boolean, actionEndpoint?: string, workerLabel?: string } | null
 * }} input
 */
export function buildWorkspaceModel(input) {
  const {
    user,
    inboundReview,
    inbox,
    daily,
    reports,
    regenerateCommand = DEFAULT_REGENERATE_COMMAND,
    interactive = null,
  } = input;

  const now = parseDate(daily.generatedAt) ?? new Date();
  const truthAccounts = mergeTruthAccounts(user, inboundReview, inbox, now);
  const motionSummaries = buildMotionSummaries(reports, daily, inboundReview).sort((left, right) => {
    const leftUpdated = parseDate(left.updatedAt)?.getTime() ?? 0;
    const rightUpdated = parseDate(right.updatedAt)?.getTime() ?? 0;
    return rightUpdated - leftUpdated;
  });
  const dailyIndex = buildDailyIndex(daily.items);
  const reviewIndex = buildReviewIndex(inboundReview.reviewItems);
  const companyPrep = flattenCompanyPrep(reports);
  const prospects = flattenProspects(reports, dailyIndex, reviewIndex);
  const gapNotes = buildGapNotes(truthAccounts, prospects);
  const stateActions = buildWorkspaceStateActions({
    user,
    reports,
    daily,
    workerLabel: interactive?.workerLabel ?? DEFAULT_WORKSPACE_ACTION_WORKER,
  });
  const decisionQueue = buildDecisionQueue(inboundReview.reviewItems);
  const agentQueue = buildAgentQueue(daily, stateActions);

  const companyLanes = groupIntoLanes(companyPrep, [
    { key: "needs-company-identity", label: "Needs company identity", description: "Website or LinkedIn company identity is still missing." },
    { key: "queued-for-research", label: "Queued for research", description: "Identity exists, but research is not complete yet." },
    { key: "researched", label: "Researched / pick prospects", description: "Signals are in, but prospect selection is still open." },
    { key: "selected", label: "Selected / build branches", description: "Prospects exist, but branch scaffolding is incomplete." },
    { key: "targeting-ready", label: "Targeting ready", description: "Company prep is already usable for outreach branches." },
    { key: "suppressed", label: "Suppressed", description: "This company is intentionally out of play." },
    { key: "exhausted", label: "Exhausted", description: "No more viable company work is exposed right now." },
  ]).map((lane) => ({
    ...lane,
    items: sortByName(lane.items, "companyName"),
  }));

  const prospectPrepLanes = groupIntoLanes(prospects, [
    { key: "needs-through-line", label: "Needs through-line", description: "The branch still lacks a why-talk line." },
    { key: "needs-opening-plan", label: "Needs opening plan", description: "The first move is not defensible yet." },
    { key: "needs-cadence", label: "Needs cadence state", description: "Exo does not yet expose a usable current step." },
    { key: "contact-enrichment-pending", label: "Contact enrichment pending", description: "Core branch logic exists, but fallback coverage is still open." },
    { key: "primary-only-ready", label: "Ready but weak fallback", description: "Primary path exists, but direct fallback is still thin." },
    { key: "prep-complete", label: "Prep complete", description: "Prep is done; engagement state is separate." },
  ]).map((lane) => ({
    ...lane,
    items: sortByName(lane.items, "name"),
  }));

  const engagementLanes = [
    { key: "ready", label: "Ready", description: "Prepared branches that still need their first governed move." },
    { key: "sent-pending", label: "Sent / pending", description: "Touches are in flight and waiting on the other side." },
    { key: "waiting", label: "Waiting", description: "Branches intentionally held in reserve or waiting on a checkpoint." },
    { key: "blocked", label: "Blocked", description: "Primary path failed or the channel blocked." },
    { key: "reply-accepted", label: "Reply / accepted", description: "Cold-start phase is over; live response handling takes over." },
    { key: "exhausted", label: "Exhausted", description: "No further governed move is exposed here right now." },
  ].map((lane) => ({
    ...lane,
    items: sortEngagementCards(
      prospects.filter((prospect) => prospect.engagementLane.key === lane.key),
      now,
    ),
  }));

  const dueNowItems = toArray(daily.items).filter((item) => item.state === "due_now");
  const waitingItems = toArray(daily.items).filter((item) => item.state === "waiting_until");
  const reviewItems = toArray(inboundReview.reviewItems).slice().sort((left, right) => {
    const leftObserved = parseDate(left.observedAt)?.getTime() ?? 0;
    const rightObserved = parseDate(right.observedAt)?.getTime() ?? 0;
    return rightObserved - leftObserved;
  });
  const operatorSummary = buildOperatorSummary({
    user,
    daily,
    motionSummaries,
    truthAccounts,
    reviewItems,
    now,
  });
  const artifactSummaries = buildArtifactSummaries(reports, motionSummaries);

  const html = renderPage({
    truthAccounts,
    motionSummaries,
    operatorSummary,
    decisionQueue,
    agentQueue,
    interactive,
    artifactSummaries,
    companyPrep,
    prospectPrep: prospects,
    engagementProspects: prospects,
    daily,
    inboundReview,
    inbox,
    gapNotes,
    now,
    regenerateCommand,
  });

  return {
    html,
    data: {
      generatedAt: now.toISOString(),
      user: {
        id: user.id,
        label: user.label,
        owner: user.owner ?? null,
      },
      regenerateCommand,
      truthAccounts,
      motionSummaries,
      operatorSummary,
      decisionQueue,
      agentQueue,
      interactive: interactive ? { enabled: Boolean(interactive.enabled), actionEndpoint: interactive.actionEndpoint ?? null } : null,
      artifactSummaries,
      companyLanes,
      prospectPrepLanes,
      engagementLanes,
      dueNowItems,
      waitingItems,
      reviewItems,
      gapNotes,
    },
  };
}

async function main() {
  const [users, motions] = await Promise.all([
    runJson(["users", "list", "--json"]),
    runJson(["motion", "list", "--json"]),
  ]);

  const user = toArray(users).find((candidate) => candidate.id === USER_ID) ?? toArray(users)[0];
  if (!user) {
    throw new Error("No execution users exist in Exo, so the workspace projection cannot resolve inbound or daily state.");
  }

  const [inboundReview, inbox, daily] = await Promise.all([
    runJson(["inbound", "review", user.id, "--json"]),
    runJson(["inbox", "--user", user.id, "--json"]),
    runJson(["daily", "--user", user.id, "--json"]),
  ]);

  const reports = await Promise.all(
    toArray(motions).map((motion) => runJson(["report", "motion", motion.id, "--json"])),
  );
  const { html } = buildWorkspaceModel({
    user,
    inboundReview,
    inbox,
    daily,
    reports,
    regenerateCommand: DEFAULT_REGENERATE_COMMAND,
  });

  await writeFile(OUTPUT_PATH, html, "utf8");
  process.stdout.write(`${OUTPUT_PATH}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
