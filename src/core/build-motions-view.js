// @ts-check
//
// Motions view model (Exo UI Build Spec — the redesigned centerpiece).
//
// Reshapes the workspace projection's motionSummaries + motionDetails into:
//   - a list of motion cards (state, truth, readiness bar, counts, blocker)
//   - per-motion detail models in strict spec order:
//       offer → premise → signals → audiences → matches (co/people) → plan
//
// Pure data. The renderer turns this into HTML using the shared primitives.

/**
 * Stage → readiness fraction. Honest, monotonic ordering of the targeting loop.
 * @type {Record<string, number>}
 */
const STAGE_READINESS = {
  "needs-motion-definition": 0.08,
  "needs-company-targeting": 0.2,
  "needs-company-identity": 0.3,
  "needs-company-research": 0.42,
  "needs-prospect-selection": 0.55,
  "needs-cadence": 0.74,
  "targeting-ready": 0.92,
  paused: 0.5,
  archived: 0.0,
};

/** strategyState.tone → truth axis */
const TONE_TRUTH = {
  success: "checked",
  accent: "partial",
  warning: "partial",
  danger: "failed",
  quiet: "quiet",
  neutral: "unchecked",
};

/** record state from motion status */
const STATUS_STATE = {
  active: "active",
  draft: "draft",
  paused: "paused",
  archived: "archived",
};

/**
 * @param {{ motionSummaries: any[], motionDetails: any[], rawMotions?: any[] }} input
 */
export function buildMotionsViewModel(input) {
  const detailById = new Map(input.motionDetails.map((detail) => [detail.motionId, detail]));
  const rawMotionById = new Map((input.rawMotions ?? []).map((motion) => [motion.id, motion]));

  const motions = input.motionSummaries.map((summary) => {
    const readiness = STAGE_READINESS[summary.overallStage] ?? 0.15;
    const detail = detailById.get(summary.id) ?? null;
    const rawMotion = rawMotionById.get(summary.id) ?? null;
    return {
      id: summary.id,
      name: summary.name,
      state: STATUS_STATE[summary.status] ?? "draft",
      sourceUrl: detail?.offer?.url ?? null,
      truth: deriveTruth(detail),
      readiness,
      // Concise strategy summary for the card: what the offer is, what the
      // premise claims, and how many signals back it.
      offerTitle: detail?.offer?.title ?? null,
      offerProblem: detail?.offer?.problem ?? null,
      premise: detail?.premise?.statement ?? null,
      premiseStatus: detail?.premise?.truth ?? "unchecked",
      audienceCount: (detail?.audiences ?? []).length,
      premiseTruth: detail ? mapPremiseTruth(detail.premise?.status, detail.strategyState?.tone) : "unchecked",
      signalCount: (detail?.signals ?? []).length,
      companyCount: summary.companyCount ?? 0,
      prospectCount: summary.prospectCount ?? 0,
      actionCount: summary.dueNowCount ?? 0,
      blocker: deriveListBlocker(summary, detail),
      activity: summarizeMotionActivity(rawMotion),
    };
  });

  const details = input.motionSummaries
    .map((summary) => ({
      detail: detailById.get(summary.id),
      rawMotion: rawMotionById.get(summary.id) ?? null,
    }))
    .filter((entry) => entry.detail)
    .map(({ detail, rawMotion }) => shapeDetail(detail, detailById.size, rawMotion));

  return { motions, details };
}

/** @param {any} detail */
function deriveTruth(detail) {
  if (!detail) return "unchecked";
  if (detail.truth) return detail.truth;
  return TONE_TRUTH[detail.strategyState?.tone] ?? "unchecked";
}

/**
 * @param {any} summary
 * @param {any} detail
 */
function deriveListBlocker(summary, detail) {
  if (detail?.blocker) return summarizeListBlocker(detail.blocker);
  if (summary.overallStage === "needs-company-targeting") return "No companies targeted yet.";
  if (summary.overallStage === "needs-company-research") return "Research backlog open.";
  if (summary.overallStage === "needs-prospect-selection") return "Prospect selection still open.";
  if (summary.overallStage === "targeting-ready" && summary.readyToEngage === false && summary.dueNowCount > 0) {
    return "Launch owner not pinned yet.";
  }
  return null;
}

/**
 * @param {any} detail
 * @param {number} _total
 * @param {any} rawMotion
 */
function shapeDetail(detail, _total, rawMotion = null) {
  const signals = (detail.signals ?? []).map((signal, index) => ({
    id: signal.id,
    index: index + 1,
    question: signal.question || signal.name,
    scope: signal.scope ?? "company",
    whyItMatters: signal.whyItMatters ?? defaultWhy(signal),
    matchRule: signal.matchRule ?? defaultMatchRule(signal),
    methods: methodsFor(signal),
    window: deriveWindow(signal),
    truth: signalTruth(signal),
    matchLabel: signal.matchLabel ?? `${signal.companyCount ?? 0} lit`,
  }));

  const audiences = (detail.audiences ?? []).map((audience, index) => ({
    index: index + 1,
    statement: audience.name,
    roles: audience.rolesLine && !/no explicit/i.test(audience.rolesLine) ? audience.rolesLine : null,
    matched: audience.matchedCount ?? 0,
  }));

  const companies = (detail.companies ?? []).map((company) => ({
    id: company.companyId,
    name: company.companyName,
    industry: company.domain ?? company.websiteUrl ?? "",
    prospectCount: company.prospectCount ?? 0,
    matchedSignalIndexes: company.matchedSignalIndexes ?? [],
    topMatch: (company.matchedSignals ?? [])[0]?.summary ?? null,
    enrichment: company.executionIdentity?.status === "pinned-ready" ? "ready" : "waiting",
    enrichmentLabel: company.executionIdentity?.status === "pinned-ready" ? "assigned" : "unassigned",
  }));
  const backlogCompanies = (detail.backlogCompanies ?? []).map((company) => ({
    id: company.companyId,
    name: company.companyName,
    industry: company.domain ?? company.websiteUrl ?? "",
    prospectCount: company.prospectCount ?? 0,
    stage: company.stage ?? "needs-company-research",
    queueStatus: company.queueStatus ?? "discovered",
    enrichment: company.executionIdentity?.status === "pinned-ready" ? "ready" : "waiting",
    enrichmentLabel: company.executionIdentity?.status === "pinned-ready" ? "assigned" : "research backlog",
  }));

  const people = (detail.people ?? []).map((person) => ({
    id: person.prospectId,
    name: person.name,
    initials: initials(person.name),
    avatarUrl: person.avatarUrl ?? null,
    title: person.title,
    company: person.companyName,
    signal: person.signalLabel ?? person.signalQuestion ?? "",
    branch: mapBranchState(person.branchState?.key),
    branchLabel: person.branchState?.label ?? null,
    owner: person.ownerLabel ?? null,
  }));

  const plan = detail.plan ?? {};
  const readiness = STAGE_READINESS[detail.overallStage] ?? 0.15;

  return {
    id: detail.motionId,
    name: detail.motionName,
    state: STATUS_STATE[detail.motionStatus] ?? "draft",
    truth: deriveTruth(detail),
    offer: {
      title: detail.offer?.title ?? detail.motionName,
      url: detail.offer?.url ?? null,
      urlLabel: detail.offer?.urlLabel ?? detail.offer?.url ?? null,
      summary: detail.offer?.summary ?? "",
      problem: detail.offer?.problem ?? "",
      feltBy: detail.offer?.feltBy ?? "",
      triggers: detail.offer?.triggers ?? "",
    },
    premise: {
      statement: detail.premise?.statement ?? "No premise authored yet.",
      note: detail.premise?.note ?? null,
      source: detail.premise?.source ?? "operator",
      truth: mapPremiseTruth(detail.premise?.status, detail.strategyState?.tone),
    },
    signals,
    audiences,
    companies,
    backlogCompanies,
    people,
    blocker: detail.blocker ?? null,
    activity: summarizeMotionActivity(rawMotion),
    plan: {
      nextSteps: (plan.nextSteps ?? []).map((step) => ({
        text: step.text,
        tag: step.tag ?? null,
        tone: mapStepTone(step.tone),
      })),
      actionsRun: plan.dueNowCount ?? 0,
      drafts: plan.messageTestReadyCount ?? 0,
      readiness,
      readyToSend: plan.readyToSendCount ?? 0,
      packet: derivePacketState(plan),
    },
  };
}

/** @param {string} text */
function summarizeListBlocker(text) {
  if (!text) return text;
  if (/cannot yet resolve one ready execution identity/i.test(text)) {
    return "Launch owner not pinned yet.";
  }
  if (/reconcile these in-flight relationships and re-home them into real motions/i.test(text)) {
    return "Transition backlog still needs re-homing.";
  }
  return text;
}

/**
 * @param {any} rawMotion
 */
function summarizeMotionActivity(rawMotion) {
  const summary = {
    touchCount: 0,
    inboundTouchCount: 0,
    outboundTouchCount: 0,
    stagedDraftCount: 0,
    latestAt: null,
    events: [],
  };
  if (!rawMotion?.targetMap?.accounts?.length) return summary;

  for (const account of rawMotion.targetMap.accounts ?? []) {
    for (const prospect of account.prospects ?? []) {
      for (const touch of prospect.touches ?? []) {
        summary.touchCount += 1;
        if (touch.direction === "inbound") summary.inboundTouchCount += 1;
        if (touch.direction === "outbound") summary.outboundTouchCount += 1;
        const event = shapeTouchEvent(touch, prospect, account);
        if (event) {
          summary.events.push(event);
          if (!summary.latestAt || event.at > summary.latestAt) summary.latestAt = event.at;
        }
      }

      for (const draft of prospect.drafts ?? []) {
        if (draft.status === "sent" || draft.status === "discarded") continue;
        summary.stagedDraftCount += 1;
        const event = shapeDraftEvent(draft, prospect, account);
        if (event) {
          summary.events.push(event);
          if (!summary.latestAt || event.at > summary.latestAt) summary.latestAt = event.at;
        }
      }
    }
  }

  summary.events.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
  summary.events = summary.events.slice(0, 5);
  return summary;
}

/**
 * @param {any} touch
 * @param {any} prospect
 * @param {any} account
 */
function shapeTouchEvent(touch, prospect, account) {
  const at = normalizeIso(touch.occurredAt);
  if (!at) return null;
  return {
    kind: "touch",
    at,
    tone: touch.outcome === "blocked" || touch.outcome === "declined"
      ? "bad"
      : touch.direction === "inbound"
        ? "in"
        : "out",
    status: touch.direction === "inbound"
      ? "received"
      : touch.outcome === "blocked" || touch.outcome === "declined"
        ? "blocked"
        : "sent",
    title: humanizeTouchTitle(touch),
    detail: touch.summary ?? [prospect?.name, account?.companyName].filter(Boolean).join(" · "),
  };
}

/**
 * @param {any} draft
 * @param {any} prospect
 * @param {any} account
 */
function shapeDraftEvent(draft, prospect, account) {
  const at = normalizeIso(draft.updatedAt ?? draft.approvedAt ?? draft.createdAt ?? null);
  if (!at) return null;
  return {
    kind: "draft",
    at,
    tone: "sys",
    status: draft.status === "queued" ? "queued" : draft.status === "drafting" ? "drafting" : "ready",
    title: `${humanizeSurface(draft.surface)} draft ${draft.status === "queued" ? "queued" : draft.status === "drafting" ? "in progress" : "ready"}`,
    detail: [prospect?.name, account?.companyName].filter(Boolean).join(" · "),
  };
}

/** @param {string | null | undefined} value */
function normalizeIso(value) {
  if (!value) return null;
  const iso = String(value);
  return /^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso : null;
}

/** @param {{ surface?: string | null, direction?: string | null, outcome?: string | null }} touch */
function humanizeTouchTitle(touch) {
  const surface = humanizeSurface(touch.surface);
  if (touch.direction === "inbound") return `Inbound ${surface}`;
  if (touch.outcome === "blocked") return `${surface} blocked`;
  if (touch.outcome === "declined") return `${surface} declined`;
  return `${surface} sent`;
}

/** @param {string | null | undefined} surface */
function humanizeSurface(surface) {
  return String(surface ?? "activity")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** @param {any} signal */
function defaultWhy(signal) {
  if (signal.scope === "person") {
    return "A recent role change or hire is concrete evidence the buying motion is live and a real why-now exists.";
  }
  return "Recent, externally observable movement is evidence the premise is live at this company right now.";
}

/** @param {any} signal */
function defaultMatchRule(signal) {
  const subject = signal.scope === "person" ? "person" : "company";
  return `evidence(${subject}) within window AND tied_to(premise) == true`;
}

/** @param {any} signal */
function methodsFor(signal) {
  const methods = signal.methods?.length ? signal.methods : signal.observationMethods ?? [];
  if (methods.length) return methods;
  return signal.scope === "person"
    ? ["LinkedIn role change", "Press / announcements"]
    : ["Job posts", "Company news", "Product pages"];
}

/** @param {any} signal */
function deriveWindow(signal) {
  if (signal.window) return signal.window;
  return "last 90d";
}

/** @param {any} signal */
function signalTruth(signal) {
  if (signal.status === "checked" || signal.status === "confirmed") return "checked";
  if ((signal.companyCount ?? 0) + (signal.personCount ?? 0) > 0) return "partial";
  return "unchecked";
}

/**
 * @param {string | undefined} status
 * @param {string | undefined} tone
 */
function mapPremiseTruth(status, tone) {
  if (status === "checked" || status === "confirmed") return "checked";
  if (status === "defined") return "partial";
  if (tone === "danger") return "failed";
  if (status === "draft") return "unchecked";
  return "unchecked";
}

/** @param {string | undefined} key */
function mapBranchState(key) {
  switch (key) {
    case "ready":
      return "ready";
    case "sent-pending":
      return "connection-requested";
    case "waiting":
      return "waiting";
    case "reply-accepted":
      return "connected";
    case "blocked":
      return "blocked";
    default:
      return "identified";
  }
}

/** @param {string | undefined} tone */
function mapStepTone(tone) {
  switch (tone) {
    case "warning":
      return "amber";
    case "danger":
      return "red";
    case "accent":
      return "blue";
    default:
      return "neutral";
  }
}

/** @param {any} plan */
function derivePacketState(plan) {
  const ready = plan.readyToSendCount ?? 0;
  const prospects = plan.prospectCount ?? 0;
  if (prospects === 0) return "draft";
  if (ready >= prospects && prospects > 0) return "ready";
  if (ready > 0) return "partial";
  return "draft";
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
