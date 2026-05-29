// @ts-check

import { targetAccountSchema } from "../schema/target-account.js";
import { applyManualTargetAccountQueueState, withDerivedTargetAccountQueueState } from "./motion-queue.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 * @param {{
 *   companyId?: string | null | undefined,
 *   status?: "claimable" | "claimed" | null | undefined
 * }} [options]
 */
export function buildMotionPacketSummary(rawMotion, rawCompanies, options = {}) {
  const motion = /** @type {Record<string, any>} */ (rawMotion ?? {});
  const motionId = typeof motion.id === "string" ? motion.id : "";
  const companies = Array.isArray(rawCompanies) ? rawCompanies : [];
  const accounts = Array.isArray(motion.targetMap?.accounts)
    ? motion.targetMap.accounts.map((account) => withDerivedTargetAccountQueueState(account))
    : [];
  const accountByCompanyId = new Map(accounts.map((account) => [account.companyId, account]));

  const items = companies
    .filter((company) => Array.isArray(company.motionIds) && company.motionIds.includes(motionId))
    .filter((company) => !options.companyId || company.id === options.companyId)
    .map((company) => buildCompanyResearchPacket(company, accountByCompanyId.get(company.id) ?? null))
    .filter(Boolean)
    .filter((item) => !options.status || item.claimState === options.status);

  return {
    motion: {
      id: motion.id,
      name: motion.name,
      status: motion.status
    },
    counts: {
      packetCount: items.length,
      claimableCount: items.filter((item) => item.claimState === "claimable").length,
      claimedCount: items.filter((item) => item.claimState === "claimed").length
    },
    items
  };
}

/**
 * @param {unknown} rawAccount
 * @param {{ workerLabel: string, notes?: string | null | undefined }} input
 * @param {string} now
 */
export function applyClaimCompanyResearchPacket(rawAccount, input, now) {
  const account = withDerivedTargetAccountQueueState(rawAccount, now);
  const queueStatus = account.queueState?.status ?? "discovered";

  if (!["discovered", "queued_for_research"].includes(queueStatus)) {
    throw new Error(`Company research packets can only be claimed from discovered or queued_for_research state, not ${queueStatus}.`);
  }

  if (account.packetState?.kind === "company_research" && account.packetState.status === "claimed") {
    throw new Error(`Company research packet is already claimed by ${account.packetState.workerLabel ?? "another worker"}.`);
  }

  const queuedAccount = applyManualTargetAccountQueueState(account, {
    status: "queued_for_research",
    notes: account.queueState?.notes ?? null
  }, now);

  return targetAccountSchema.parse({
    ...queuedAccount,
    packetState: {
      kind: "company_research",
      status: "claimed",
      workerLabel: input.workerLabel,
      claimedAt: now,
      completedAt: null,
      notes: normalizeNullableString(input.notes)
    }
  });
}

/**
 * @param {unknown} rawAccount
 * @param {{ workerLabel?: string | null | undefined, nextStatus?: "researched" | "suppressed" | "exhausted" | undefined, notes?: string | null | undefined }} input
 * @param {string} now
 */
export function applyCompleteCompanyResearchPacket(rawAccount, input, now) {
  const account = withDerivedTargetAccountQueueState(rawAccount, now);

  if (!(account.packetState?.kind === "company_research" && account.packetState.status === "claimed")) {
    throw new Error("Company research packet is not currently claimed.");
  }

  if (input.workerLabel && account.packetState.workerLabel && input.workerLabel !== account.packetState.workerLabel) {
    throw new Error(`Company research packet is claimed by ${account.packetState.workerLabel}, not ${input.workerLabel}.`);
  }

  const nextStatus = input.nextStatus ?? "researched";
  const advancedAccount = applyManualTargetAccountQueueState(account, {
    status: nextStatus,
    notes: account.queueState?.notes ?? null
  }, now);

  return targetAccountSchema.parse({
    ...advancedAccount,
    lastResearchAt: now,
    packetState: {
      ...account.packetState,
      status: "completed",
      completedAt: now,
      notes: normalizeNullableString(input.notes) ?? account.packetState.notes ?? null
    }
  });
}

/**
 * @param {Record<string, any>} company
 * @param {import("../schema/target-account.js").targetAccountSchema._type | null} account
 */
function buildCompanyResearchPacket(company, account) {
  const queueStatus = account?.queueState?.status ?? "discovered";

  if (!["discovered", "queued_for_research"].includes(queueStatus)) {
    return null;
  }

  const claimed = account?.packetState?.kind === "company_research" && account.packetState.status === "claimed";

  return {
    packetKind: "company_research",
    claimState: claimed ? "claimed" : "claimable",
    companyId: company.id,
    companyName: company.name,
    queueStatus,
    signalMatchCount: account?.signalMatches.length ?? 0,
    prospectCount: account?.prospects.length ?? 0,
    workerLabel: account?.packetState?.workerLabel ?? null,
    claimedAt: account?.packetState?.claimedAt ?? null,
    notes: account?.packetState?.notes ?? null
  };
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
