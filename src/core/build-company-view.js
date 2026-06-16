// @ts-check
//
// Company detail view-model for the interactive UI.
//
// A focused record page: identity + transport assignment, the motions the
// company is targeted in, and the tracked prospects at the company (with their
// engagement stage). Per-prospect branch is derived from disposition, cadence,
// and connection degree (see deriveCompanyProspectBranch), unless the caller
// supplies prospects that already carry a branch.

import { buildMotionProspectView } from "./build-motion-prospect-view.js";

/**
 * @param {{ company: any, prospects?: any[] | null, motions: any[], users?: any[] }} input
 */
export function buildCompanyViewModel(input) {
  const { company, prospects = null, motions = [] } = input;
  const motionById = new Map(motions.map((m) => [m.id, m]));

  const inMotions = (company.motionIds ?? [])
    .map((id) => motionById.get(id))
    .filter(Boolean)
    .map((m) => {
      const account = (m.targetMap?.accounts ?? []).find((item) => item.companyId === company.id) ?? null;
      return {
        id: m.id,
        name: m.name,
        status: m.status,
        rawMotion: m,
        engagementUserAssignment: m.engagementUserAssignment ?? null,
        queueStatus: account?.queueState?.status ?? "discovered",
        packetKind: account?.packetState?.kind ?? null,
        packetStatus: account?.packetState?.status ?? null,
        packetWorkerLabel: account?.packetState?.workerLabel ?? null,
      };
    });

  const people = resolveCompanyProspects(company, inMotions, prospects)
    .filter((p) => p.companyId === company.id)
    .map((p) => {
      const branchState = deriveCompanyProspectBranch(p);
      return {
        id: p.id ?? p.prospectId,
        name: p.name,
        initials: p.initials ?? initials(p.name),
        avatarUrl: p.avatarUrl ?? p.avatarSourceUrl ?? null,
        title: p.title ?? null,
        branch: p.branch ?? branchState.branch,
        branchLabel: p.branchLabel ?? branchState.label,
        owner: p.owner ?? p.ownerLabel ?? null,
        motionName: p.motionName ?? null,
        connectionDegree: p.connectionDegree ?? p.linkedinProfileSnapshot?.connectionDegree ?? null,
        fit: p.fit ?? p.fitConfidence ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: company.id,
    name: company.name,
    domain: company.domain ?? null,
    websiteUrl: company.websiteUrl ?? null,
    linkedinCompanyUrl: company.linkedinCompanyUrl ?? null,
    logoUrl: company.logoUrl ?? company.logoSourceUrl ?? null,
    tags: company.tags ?? [],
    ownerLabel: company.engagementUserAssignment?.label ?? null,
    ownerUserId: company.engagementUserAssignment?.userId ?? null,
    ownerOwner: company.engagementUserAssignment?.owner ?? null,
    accountRefs: company.engagementUserAssignment?.accountRefs ?? [],
    motions: inMotions,
    prospects: people,
    counts: { prospects: people.length, motions: inMotions.length },
  };
}

/**
 * @param {any} company
 * @param {Array<{ id: string, name: string, status: string, queueStatus: string, packetKind: string | null, packetStatus: string | null, packetWorkerLabel: string | null }>} motionSummaries
 * @param {any[] | null | undefined} providedProspects
 */
function resolveCompanyProspects(company, motionSummaries, providedProspects) {
  if (Array.isArray(providedProspects)) {
    return providedProspects;
  }

  return motionSummaries.flatMap((motionSummary) => {
    const rawMotion = motionSummary.rawMotion ?? null;
    const motionTargetsCompany = (rawMotion?.targetMap?.accounts ?? []).some((account) => account.companyId === company.id);
    if (!rawMotion || !motionTargetsCompany) {
      return [];
    }
    const view = buildMotionProspectView(rawMotion, { companyId: company.id });
    const fallbackOwner = company.engagementUserAssignment?.label ?? motionSummary.engagementUserAssignment?.label ?? null;
    return view.prospects.map((prospect) => {
      const branchState = deriveCompanyProspectBranch(prospect);
      return {
        id: prospect.prospectId,
        companyId: prospect.companyId,
        motionName: motionSummary.name ?? null,
        name: prospect.name,
        initials: initials(prospect.name),
        avatarUrl: prospect.avatarUrl ?? prospect.avatarSourceUrl ?? null,
        title: prospect.title ?? null,
        branch: branchState.branch,
        branchLabel: branchState.label,
        owner: fallbackOwner,
        connectionDegree: prospect.linkedinProfileSnapshot?.connectionDegree ?? null,
        fit: prospect.fitConfidence ?? null,
      };
    });
  });
}

/**
 * @param {any} prospect
 * @returns {{ branch: string, label: string | null }}
 */
function deriveCompanyProspectBranch(prospect) {
  const disposition = normalizeString(prospect?.disposition) ?? "active";
  if (disposition === "nurture") return { branch: "waiting", label: "Nurture" };
  if (disposition === "not_a_fit") return { branch: "archived", label: "Not a fit" };
  if (disposition === "no_longer_target") return { branch: "archived", label: "No longer target" };
  if (disposition === "exhausted") return { branch: "archived", label: "Exhausted" };

  if (normalizeString(prospect?.queueStatus) === "held_cross_motion") {
    return { branch: "held-cross-motion", label: "Held behind owner" };
  }

  const connectionDegree = prospect?.connectionDegree ?? prospect?.linkedinProfileSnapshot?.connectionDegree ?? null;
  if (connectionDegree === 1) {
    return { branch: "connected", label: "Connected" };
  }

  const currentStep = normalizeString(prospect?.cadenceState?.currentStep);
  if (currentStep === "connection_request" || currentStep === "pending_invite_followup") {
    return { branch: "connection-requested", label: "Request sent" };
  }

  const cadenceStatus = normalizeString(prospect?.cadenceState?.status);
  if (cadenceStatus === "ready") return { branch: "ready", label: "Ready" };
  if (cadenceStatus === "waiting") return { branch: "waiting", label: "Waiting" };

  return { branch: "identified", label: null };
}

/** @param {string | null | undefined} value */
function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

/** @param {string | null | undefined} name */
function initials(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
