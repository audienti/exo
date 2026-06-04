// @ts-check
//
// Company detail view-model for the interactive UI.
//
// A focused record page: identity + transport assignment, the motions the
// company is targeted in, and the tracked prospects at the company (with their
// engagement stage). Reuses the prospects view-model for per-prospect branch so
// it stays consistent with the Prospects surface.

/**
 * @param {{ company: any, prospects: any[], motions: any[], users?: any[] }} input
 */
export function buildCompanyViewModel(input) {
  const { company, prospects = [], motions = [] } = input;
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
        queueStatus: account?.queueState?.status ?? "discovered",
        packetKind: account?.packetState?.kind ?? null,
        packetStatus: account?.packetState?.status ?? null,
        packetWorkerLabel: account?.packetState?.workerLabel ?? null,
      };
    });

  const people = prospects
    .filter((p) => p.companyId === company.id)
    .map((p) => ({
      id: p.id,
      name: p.name,
      initials: p.initials,
      avatarUrl: p.avatarUrl ?? null,
      title: p.title ?? null,
      branch: p.branch,
      branchLabel: p.branchLabel ?? null,
      owner: p.owner ?? null,
      motionName: p.motionName ?? null,
      connectionDegree: p.connectionDegree ?? null,
      fit: p.fit ?? null,
    }))
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
    ownerOwner: company.engagementUserAssignment?.owner ?? null,
    accountRefs: company.engagementUserAssignment?.accountRefs ?? [],
    motions: inMotions,
    prospects: people,
    counts: { prospects: people.length, motions: inMotions.length },
  };
}
