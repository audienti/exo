// @ts-check

const QUEUE_STATUSES = [
  "discovered",
  "queued_for_research",
  "researched",
  "selected",
  "ready",
  "suppressed",
  "exhausted"
];

const ACCOUNT_MANUAL_HOLD_STATUSES = new Set(["queued_for_research", "suppressed", "exhausted"]);
const PROSPECT_MANUAL_HOLD_STATUSES = new Set(["suppressed", "exhausted"]);
const TERMINAL_TOUCH_OUTCOMES = new Set(["blocked", "nurture"]);

/**
 * @param {unknown} value
 */
export function isMotionQueueStatus(value) {
  return typeof value === "string" && QUEUE_STATUSES.includes(value);
}

/**
 * @param {unknown} rawAccount
 * @param {string | null | undefined} [now]
 */
export function withDerivedTargetAccountQueueState(rawAccount, now = undefined) {
  const account = /** @type {Record<string, any>} */ (rawAccount ?? {});
  const prospects = Array.isArray(account.prospects)
    ? account.prospects.map((prospect) => withDerivedProspectQueueState(prospect, now))
    : [];

  return {
    ...account,
    prospects,
    queueState: deriveTargetAccountQueueState({
      ...account,
      prospects
    }, now)
  };
}

/**
 * @param {unknown} rawProspect
 * @param {string | null | undefined} [now]
 */
export function withDerivedProspectQueueState(rawProspect, now = undefined) {
  const prospect = /** @type {Record<string, any>} */ (rawProspect ?? {});
  return {
    ...prospect,
    queueState: deriveProspectQueueState(prospect, now)
  };
}

/**
 * @param {unknown} rawAccount
 * @param {{ status: string, notes?: string | null | undefined }} input
 * @param {string} now
 */
export function applyManualTargetAccountQueueState(rawAccount, input, now) {
  const account = withDerivedTargetAccountQueueState(rawAccount, now);
  return {
    ...account,
    queueState: {
      status: input.status,
      source: "manual",
      updatedAt: now,
      notes: normalizeNullableString(input.notes) ?? account.queueState?.notes ?? null
    }
  };
}

/**
 * @param {unknown} rawProspect
 * @param {{ status: string, notes?: string | null | undefined }} input
 * @param {string} now
 */
export function applyManualProspectQueueState(rawProspect, input, now) {
  const prospect = withDerivedProspectQueueState(rawProspect, now);
  return {
    ...prospect,
    queueState: {
      status: input.status,
      source: "manual",
      updatedAt: now,
      notes: normalizeNullableString(input.notes) ?? prospect.queueState?.notes ?? null
    }
  };
}

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 * @param {{
 *   companyId?: string | null | undefined,
 *   prospectId?: string | null | undefined
 * }} [options]
 */
export function buildMotionQueueSummary(rawMotion, rawCompanies, options = {}) {
  const motion = /** @type {Record<string, any>} */ (rawMotion ?? {});
  const motionId = typeof motion.id === "string" ? motion.id : "";
  const companies = Array.isArray(rawCompanies) ? rawCompanies : [];
  const accounts = Array.isArray(motion.targetMap?.accounts)
    ? motion.targetMap.accounts.map((account) => withDerivedTargetAccountQueueState(account))
    : [];
  const accountByCompanyId = new Map(accounts.map((account) => [account.companyId, account]));

  const companyItems = companies
    .filter((company) => Array.isArray(company.motionIds) && company.motionIds.includes(motionId))
    .filter((company) => !options.companyId || company.id === options.companyId)
    .map((company) => {
      const account = accountByCompanyId.get(company.id) ?? null;
      const prospects = (account?.prospects ?? [])
        .filter((prospect) => !options.prospectId || prospect.id === options.prospectId);
      const prospectStatusCounts = buildStatusCounts(prospects.map((prospect) => prospect.queueState?.status));
      const readyToSendCount = prospects.filter((prospect) => isReadyConnectionRequestProspect(prospect)).length;

      return {
        companyId: company.id,
        companyName: company.name,
        queueStatus: account?.queueState?.status ?? "discovered",
        queueSource: account?.queueState?.source ?? "derived",
        signalMatchCount: account?.signalMatches?.length ?? 0,
        prospectCount: prospects.length,
        readyToSendCount,
        prospectStatusCounts,
        prospects
      };
    });

  const allProspects = companyItems.flatMap((item) => item.prospects);
  const companyStatusCounts = buildStatusCounts(companyItems.map((item) => item.queueStatus));
  const prospectStatusCounts = buildStatusCounts(allProspects.map((prospect) => prospect.queueState?.status));
  const availableProspectCount = allProspects.filter((prospect) => isAvailableProspect(prospect)).length;

  return {
    companyCount: companyItems.length,
    prospectCount: allProspects.length,
    availableProspectCount,
    companyStatusCounts,
    prospectStatusCounts,
    readyToSendCount: companyItems.reduce((sum, item) => sum + item.readyToSendCount, 0),
    items: companyItems
  };
}

/**
 * @param {unknown} rawProspect
 */
export function isReadyConnectionRequestProspect(rawProspect) {
  const prospect = /** @type {Record<string, any>} */ (rawProspect ?? {});
  return (
    prospect.cadenceState?.status === "ready"
    && prospect.cadenceState?.currentStep === "connection-request"
    && !prospect.cadenceState?.lastTouchOutcome
    && Boolean(prospect.linkedinProfileUrl)
  );
}

/**
 * @param {Record<string, any>} account
 * @param {string | null | undefined} now
 */
function deriveTargetAccountQueueState(account, now) {
  const existing = normalizeQueueState(account.queueState);
  if (existing && existing.source === "manual" && ACCOUNT_MANUAL_HOLD_STATUSES.has(existing.status)) {
    return existing;
  }

  let status = "discovered";
  if (account.prospects?.length) {
    status = account.prospects.some((prospect) => prospect.queueState?.status === "ready")
      ? "ready"
      : "selected";
  } else if (account.signalMatches?.length || account.lastResearchAt) {
    status = "researched";
  }

  return buildDerivedQueueState(existing, status, now);
}

/**
 * @param {Record<string, any>} prospect
 * @param {string | null | undefined} now
 */
function deriveProspectQueueState(prospect, now) {
  const existing = normalizeQueueState(prospect.queueState);
  if (existing && existing.source === "manual" && PROSPECT_MANUAL_HOLD_STATUSES.has(existing.status)) {
    return existing;
  }

  let status = "selected";
  if (isTerminalProspect(prospect)) {
    status = "exhausted";
  } else if (isInventoryReadyProspect(prospect)) {
    status = "ready";
  }

  return buildDerivedQueueState(existing, status, now);
}

/**
 * @param {Record<string, any> | null} existing
 * @param {string} status
 * @param {string | null | undefined} now
 */
function buildDerivedQueueState(existing, status, now) {
  return {
    status,
    source: "derived",
    updatedAt: existing?.status === status ? existing.updatedAt ?? now ?? null : now ?? existing?.updatedAt ?? null,
    notes: existing?.source === "manual" ? existing.notes ?? null : existing?.notes ?? null
  };
}

/**
 * @param {Record<string, any>} prospect
 */
function isAvailableProspect(prospect) {
  return !["suppressed", "exhausted"].includes(prospect.queueState?.status);
}

/**
 * @param {unknown} rawState
 */
function normalizeQueueState(rawState) {
  if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
    return null;
  }

  const state = /** @type {Record<string, any>} */ (rawState);
  if (!isMotionQueueStatus(state.status)) {
    return null;
  }

  return {
    status: state.status,
    source: state.source === "manual" ? "manual" : "derived",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
    notes: normalizeNullableString(state.notes)
  };
}

/**
 * @param {Record<string, any>} prospect
 */
function isInventoryReadyProspect(prospect) {
  return (
    prospect.cadenceState?.status === "ready"
  );
}

/**
 * @param {Record<string, any>} prospect
 */
function isTerminalProspect(prospect) {
  return (
    prospect.cadenceState?.currentStep === "done"
    || TERMINAL_TOUCH_OUTCOMES.has(prospect.cadenceState?.lastTouchOutcome)
  );
}

/**
 * @param {Array<string | null | undefined>} statuses
 */
function buildStatusCounts(statuses) {
  const counts = Object.fromEntries(QUEUE_STATUSES.map((status) => [status, 0]));
  for (const status of statuses) {
    if (status && Object.hasOwn(counts, status)) {
      counts[status] += 1;
    }
  }
  return counts;
}

/**
 * @param {unknown} value
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
