// @ts-check

import { prospectSchema, targetAccountSchema } from "../schema/target-account.js";
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
  const stakeholderTargetCount = Number.isInteger(motion.targetingProfile?.stakeholderTargetCount)
    ? motion.targetingProfile.stakeholderTargetCount
    : 3;
  const companies = Array.isArray(rawCompanies) ? rawCompanies : [];
  const accounts = Array.isArray(motion.targetMap?.accounts)
    ? motion.targetMap.accounts.map((account) => withDerivedTargetAccountQueueState(account))
    : [];
  const accountByCompanyId = new Map(accounts.map((account) => [account.companyId, account]));

  const items = companies
    .filter((company) => Array.isArray(company.motionIds) && company.motionIds.includes(motionId))
    .filter((company) => !options.companyId || company.id === options.companyId)
    .flatMap((company) => {
      const packet = buildMotionPacket(company, accountByCompanyId.get(company.id) ?? null, stakeholderTargetCount);
      if (!packet) {
        return [];
      }

      return Array.isArray(packet) ? packet : [packet];
    })
    .map((item) => ({
      ...item,
      packetId: buildMotionPacketId(item)
    }))
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
 * @param {{
 *   packetKind: string,
 *   companyId: string,
 *   prospectId?: string | null
 * }} packet
 */
export function buildMotionPacketId(packet) {
  if (packet.packetKind === "prospect_research" && packet.prospectId) {
    return `${packet.packetKind}:${packet.companyId}:${packet.prospectId}`;
  }

  return `${packet.packetKind}:${packet.companyId}`;
}

/**
 * @param {unknown} rawAccount
 * @param {{ workerLabel: string, notes?: string | null | undefined }} input
 * @param {string} now
 */
export function applyClaimTargetAccountPacket(rawAccount, input, now) {
  const account = withDerivedTargetAccountQueueState(rawAccount, now);
  const existingClaim = account.packetState?.status === "claimed" ? account.packetState : null;
  if (existingClaim) {
    throw new Error(`${formatPacketKind(existingClaim.kind)} packet is already claimed by ${existingClaim.workerLabel ?? "another worker"}.`);
  }

  const queueStatus = account.queueState?.status ?? "discovered";

  if (queueStatus === "discovered" || queueStatus === "queued_for_research") {
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

  if (queueStatus === "researched") {
    return targetAccountSchema.parse({
      ...account,
      packetState: {
        kind: "prospect_selection",
        status: "claimed",
        workerLabel: input.workerLabel,
        claimedAt: now,
        completedAt: null,
        notes: normalizeNullableString(input.notes)
      }
    });
  }

  throw new Error(`No claimable motion packet exists for queue state ${queueStatus}.`);
}

/**
 * @param {unknown} rawAccount
 * @param {{ workerLabel?: string | null | undefined, nextStatus?: "researched" | "suppressed" | "exhausted" | undefined, notes?: string | null | undefined }} input
 * @param {string} now
 */
export function applyCompleteTargetAccountPacket(rawAccount, input, now) {
  const account = withDerivedTargetAccountQueueState(rawAccount, now);

  if (!account.packetState || account.packetState.status !== "claimed") {
    throw new Error("No motion packet is currently claimed.");
  }

  if (input.workerLabel && account.packetState.workerLabel && input.workerLabel !== account.packetState.workerLabel) {
    throw new Error(`${formatPacketKind(account.packetState.kind)} packet is claimed by ${account.packetState.workerLabel}, not ${input.workerLabel}.`);
  }

  if (account.packetState.kind === "company_research") {
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

  if (account.packetState.kind === "prospect_selection") {
    if (input.nextStatus && !["suppressed", "exhausted"].includes(input.nextStatus)) {
      throw new Error(`Prospect selection packets can only complete into suppressed or exhausted override states, not ${input.nextStatus}.`);
    }

    const advancedAccount = input.nextStatus
      ? applyManualTargetAccountQueueState(account, {
        status: input.nextStatus,
        notes: account.queueState?.notes ?? null
      }, now)
      : withDerivedTargetAccountQueueState(account, now);

    return targetAccountSchema.parse({
      ...advancedAccount,
      packetState: {
        ...account.packetState,
        status: "completed",
        completedAt: now,
        notes: normalizeNullableString(input.notes) ?? account.packetState.notes ?? null
      }
    });
  }

  throw new Error(`Unsupported packet kind: ${account.packetState.kind}`);
}

/**
 * @param {unknown} rawProspect
 * @param {{ workerLabel: string, notes?: string | null | undefined }} input
 * @param {string} now
 */
export function applyClaimMotionProspectPacket(rawProspect, input, now) {
  const prospect = prospectSchema.parse(rawProspect);
  const existingClaim = prospect.packetState?.status === "claimed" ? prospect.packetState : null;
  if (existingClaim) {
    throw new Error(`${formatPacketKind(existingClaim.kind)} packet is already claimed by ${existingClaim.workerLabel ?? "another worker"}.`);
  }

  const queueStatus = prospect.queueState?.status ?? "selected";
  if (queueStatus !== "selected") {
    throw new Error(`No claimable prospect packet exists for queue state ${queueStatus}.`);
  }

  return prospectSchema.parse({
    ...prospect,
    packetState: {
      kind: "prospect_research",
      status: "claimed",
      workerLabel: input.workerLabel,
      claimedAt: now,
      completedAt: null,
      notes: normalizeNullableString(input.notes)
    }
  });
}

/**
 * @param {unknown} rawProspect
 * @param {{ workerLabel?: string | null | undefined, nextStatus?: "suppressed" | "exhausted" | undefined, notes?: string | null | undefined }} input
 * @param {string} now
 */
export function applyCompleteMotionProspectPacket(rawProspect, input, now) {
  const prospect = prospectSchema.parse(rawProspect);

  if (!prospect.packetState || prospect.packetState.status !== "claimed") {
    throw new Error("No prospect packet is currently claimed.");
  }

  if (prospect.packetState.kind !== "prospect_research") {
    throw new Error(`Unsupported packet kind: ${prospect.packetState.kind}`);
  }

  if (input.workerLabel && prospect.packetState.workerLabel && input.workerLabel !== prospect.packetState.workerLabel) {
    throw new Error(`${formatPacketKind(prospect.packetState.kind)} packet is claimed by ${prospect.packetState.workerLabel}, not ${input.workerLabel}.`);
  }

  const nextQueueState = input.nextStatus
    ? {
        status: input.nextStatus,
        source: "manual",
        updatedAt: now,
        notes: prospect.queueState?.notes ?? null
      }
    : prospect.queueState;

  return prospectSchema.parse({
    ...prospect,
    queueState: nextQueueState,
    packetState: {
      ...prospect.packetState,
      status: "completed",
      completedAt: now,
      notes: normalizeNullableString(input.notes) ?? prospect.packetState.notes ?? null
    }
  });
}

/**
 * @param {Record<string, any>} company
 * @param {import("../schema/target-account.js").targetAccountSchema._type | null} account
 * @param {number} stakeholderTargetCount
 */
function buildMotionPacket(company, account, stakeholderTargetCount) {
  const claimedPacket = account?.packetState?.status === "claimed"
    ? account.packetState
    : null;
  if (claimedPacket?.kind === "company_research") {
    return {
      packetKind: "company_research",
      claimState: "claimed",
      companyId: company.id,
      companyName: company.name,
      queueStatus: account?.queueState?.status ?? "discovered",
      signalMatchCount: account?.signalMatches.length ?? 0,
      prospectCount: account?.prospects.length ?? 0,
      targetProspectCount: stakeholderTargetCount,
      workerLabel: claimedPacket.workerLabel ?? null,
      claimedAt: claimedPacket.claimedAt ?? null,
      notes: claimedPacket.notes ?? null
    };
  }

  if (claimedPacket?.kind === "prospect_selection") {
    return {
      packetKind: "prospect_selection",
      claimState: "claimed",
      companyId: company.id,
      companyName: company.name,
      queueStatus: account?.queueState?.status ?? "researched",
      signalMatchCount: account?.signalMatches.length ?? 0,
      prospectCount: account?.prospects.length ?? 0,
      targetProspectCount: stakeholderTargetCount,
      workerLabel: claimedPacket.workerLabel ?? null,
      claimedAt: claimedPacket.claimedAt ?? null,
      notes: claimedPacket.notes ?? null
    };
  }

  const queueStatus = account?.queueState?.status ?? "discovered";

  if (!["discovered", "queued_for_research"].includes(queueStatus)) {
    if (queueStatus === "researched") {
      return {
        packetKind: "prospect_selection",
        claimState: "claimable",
        companyId: company.id,
        companyName: company.name,
        queueStatus,
        signalMatchCount: account?.signalMatches.length ?? 0,
        prospectCount: account?.prospects.length ?? 0,
        targetProspectCount: stakeholderTargetCount,
        workerLabel: null,
        claimedAt: null,
        notes: null
      };
    }

    const prospectResearchPackets = (account?.prospects ?? [])
      .filter((prospect) => prospect.queueState?.status === "selected")
      .map((prospect) => ({
        packetKind: "prospect_research",
        claimState:
          prospect.packetState?.status === "claimed" && prospect.packetState?.kind === "prospect_research"
            ? "claimed"
            : "claimable",
        companyId: company.id,
        companyName: company.name,
        prospectId: prospect.id,
        prospectName: prospect.name,
        prospectTitle: prospect.title,
        queueStatus: prospect.queueState?.status ?? "selected",
        signalMatchCount: account?.signalMatches.length ?? 0,
        prospectCount: account?.prospects.length ?? 0,
        targetProspectCount: stakeholderTargetCount,
        workerLabel:
          prospect.packetState?.status === "claimed" && prospect.packetState?.kind === "prospect_research"
            ? prospect.packetState?.workerLabel ?? null
            : null,
        claimedAt:
          prospect.packetState?.status === "claimed" && prospect.packetState?.kind === "prospect_research"
            ? prospect.packetState?.claimedAt ?? null
            : null,
        notes: prospect.packetState?.notes ?? null
      }));
    if (prospectResearchPackets.length) {
      return prospectResearchPackets;
    }

    return null;
  }

  return {
    packetKind: "company_research",
    claimState: "claimable",
    companyId: company.id,
    companyName: company.name,
    queueStatus,
    signalMatchCount: account?.signalMatches.length ?? 0,
    prospectCount: account?.prospects.length ?? 0,
    targetProspectCount: stakeholderTargetCount,
    workerLabel: null,
    claimedAt: null,
    notes: null
  };
}

/**
 * @param {"company_research" | "prospect_selection" | "prospect_research"} kind
 */
function formatPacketKind(kind) {
  if (kind === "prospect_selection") {
    return "Prospect selection";
  }

  if (kind === "prospect_research") {
    return "Prospect research";
  }

  return "Company research";
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
