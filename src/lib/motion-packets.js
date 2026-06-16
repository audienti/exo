// @ts-check

import { prospectSchema, targetAccountSchema } from "../schema/target-account.js";
import { selectBestEmailContactPoint, selectBestLinkedinContactPoint } from "./prospect-contacts.js";
import { applyManualTargetAccountQueueState, withDerivedTargetAccountQueueState } from "./motion-queue.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 * @param {{
 *   companyId?: string | null | undefined,
 *   status?: "claimable" | "claimed" | "submitted" | "returned" | null | undefined
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
    .filter((item) => matchesPacketStatus(item, options.status));

  return {
    motion: {
      id: motion.id,
      name: motion.name,
      status: motion.status
    },
    counts: {
      packetCount: items.length,
      claimableCount: items.filter((item) => item.claimState === "claimable").length,
      claimedCount: items.filter((item) => item.claimState === "claimed").length,
      submittedCount: items.filter((item) => item.reviewState === "submitted").length,
      returnedCount: items.filter((item) => item.reviewState === "returned").length
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
  if (account.packetState?.status && account.packetState.status !== "returned") {
    throw new Error(`${formatPacketKind(account.packetState.kind)} packet is already ${account.packetState.status}.`);
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
      packetStatus: null,
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

    if (!input.nextStatus) {
      const missingLinkedinProfileEnrichment = listSelectedProspectsMissingLinkedinProfileEnrichment(account);
      if (missingLinkedinProfileEnrichment.length) {
        throw new Error(
          `Cannot complete Prospect selection packet: selected LinkedIn prospect${missingLinkedinProfileEnrichment.length === 1 ? "" : "s"} ` +
          `missing stored profile enrichment: ${missingLinkedinProfileEnrichment.map((prospect) => prospect.name).join(", ")}. ` +
          "Store the governed LinkedIn profile viewback and avatar capture before completing selection."
        );
      }
    }

    const advancedAccount = input.nextStatus
      ? applyManualTargetAccountQueueState(account, {
        status: input.nextStatus,
        notes: account.queueState?.notes ?? null
      }, now)
      : withDerivedTargetAccountQueueState(account, now);

    return targetAccountSchema.parse({
      ...advancedAccount,
      packetStatus: null,
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
  if (prospect.packetState?.status && prospect.packetState.status !== "returned") {
    throw new Error(`${formatPacketKind(prospect.packetState.kind)} packet is already ${prospect.packetState.status}.`);
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

  if (!input.nextStatus && hasLinkedinProfileIdentity(prospect) && !hasStoredLinkedinProfileEnrichment(prospect)) {
    throw new Error(
      `Cannot complete Prospect research packet: LinkedIn-backed prospect missing stored profile enrichment and avatar capture: ${prospect.name}. ` +
      "Store the governed LinkedIn profile viewback before completing research."
    );
  }

  if (
    input.nextStatus === "exhausted"
    && !hasReachableProspectChannel(prospect)
    && !hasAttemptedGovernedLinkedinSearch(prospect)
  ) {
    throw new Error(
      "Cannot mark a no-channel prospect exhausted until governed LinkedIn search is attempted and recorded as source-tried linkedin_connected_search."
    );
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
    packetStatus: null,
    packetState: {
      ...prospect.packetState,
      status: "completed",
      completedAt: now,
      notes: normalizeNullableString(input.notes) ?? prospect.packetState.notes ?? null
    }
  });
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function hasReachableProspectChannel(prospect) {
  if (selectBestLinkedinContactPoint(prospect) || selectBestEmailContactPoint(prospect)) {
    return true;
  }

  return (prospect.contactPoints ?? []).some((point) => (
    point.kind === "phone"
    && point.matchStatus !== "rejected"
    && point.verificationStatus !== "rejected"
    && (point.usableForOutreach || point.verificationStatus === "verified" || point.verificationStatus === "observed")
  ));
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function hasAttemptedGovernedLinkedinSearch(prospect) {
  return (prospect.contactEnrichmentState?.sourcesTried ?? []).some((source) => source === "linkedin_connected_search");
}

/**
 * @param {Record<string, any>} company
 * @param {import("../schema/target-account.js").targetAccountSchema._type | null} account
 * @param {number} stakeholderTargetCount
 */
function buildMotionPacket(company, account, stakeholderTargetCount) {
  const activeAccountPacket = activePacketState(account?.packetState);
  if (activeAccountPacket?.kind === "company_research") {
    return buildAccountPacketItem(company, account, stakeholderTargetCount, {
      packetKind: "company_research",
      packetState: activeAccountPacket,
      fallbackQueueStatus: "discovered"
    });
  }

  if (activeAccountPacket?.kind === "prospect_selection") {
    return buildAccountPacketItem(company, account, stakeholderTargetCount, {
      packetKind: "prospect_selection",
      packetState: activeAccountPacket,
      fallbackQueueStatus: "researched"
    });
  }

  const queueStatus = account?.queueState?.status ?? "discovered";

  if (!["discovered", "queued_for_research"].includes(queueStatus)) {
    if (queueStatus === "researched") {
      return {
        packetKind: "prospect_selection",
        claimState: "claimable",
        reviewState: null,
        companyId: company.id,
        companyName: company.name,
        queueStatus,
        signalMatchCount: account?.signalMatches.length ?? 0,
        prospectCount: account?.prospects.length ?? 0,
        targetProspectCount: stakeholderTargetCount,
        workerLabel: null,
        claimedAt: null,
        completedAt: null,
        returnedAt: null,
        reviewer: null,
        proposal: null,
        returnNotes: null,
        notes: null
      };
    }

    const prospectResearchPackets = (account?.prospects ?? [])
      .filter((prospect) => prospect.queueState?.status === "selected")
      .map((prospect) => buildProspectResearchPacketItem(company, account, prospect, stakeholderTargetCount));
    if (prospectResearchPackets.length) {
      return prospectResearchPackets;
    }

    return null;
  }

  return {
    packetKind: "company_research",
    claimState: "claimable",
    reviewState: null,
    companyId: company.id,
    companyName: company.name,
    queueStatus,
    signalMatchCount: account?.signalMatches.length ?? 0,
    prospectCount: account?.prospects.length ?? 0,
    targetProspectCount: stakeholderTargetCount,
    workerLabel: null,
    claimedAt: null,
    completedAt: null,
    returnedAt: null,
    reviewer: null,
    proposal: null,
    returnNotes: null,
    notes: null
  };
}

/**
 * @param {unknown} item
 * @param {"claimable" | "claimed" | "submitted" | "returned" | null | undefined} status
 */
function matchesPacketStatus(item, status) {
  if (!status) return true;
  const packet = /** @type {Record<string, any>} */ (item);
  if (status === "returned") return packet.reviewState === "returned";
  if (status === "submitted") return packet.reviewState === "submitted";
  return packet.claimState === status;
}

/**
 * @param {unknown} packetState
 */
function activePacketState(packetState) {
  if (!packetState || typeof packetState !== "object" || Array.isArray(packetState)) {
    return null;
  }
  const state = /** @type {Record<string, any>} */ (packetState);
  return ["claimed", "submitted", "returned"].includes(state.status) ? state : null;
}

/**
 * @param {Record<string, any>} company
 * @param {import("../schema/target-account.js").targetAccountSchema._type | null} account
 * @param {number} stakeholderTargetCount
 * @param {{
 *   packetKind: "company_research" | "prospect_selection",
 *   packetState: Record<string, any>,
 *   fallbackQueueStatus: string
 * }} input
 */
function buildAccountPacketItem(company, account, stakeholderTargetCount, input) {
  return {
    packetKind: input.packetKind,
    ...packetStateSummaryFields(input.packetState),
    companyId: company.id,
    companyName: company.name,
    queueStatus: account?.queueState?.status ?? input.fallbackQueueStatus,
    signalMatchCount: account?.signalMatches.length ?? 0,
    prospectCount: account?.prospects.length ?? 0,
    targetProspectCount: stakeholderTargetCount
  };
}

/**
 * @param {Record<string, any>} company
 * @param {import("../schema/target-account.js").targetAccountSchema._type | null} account
 * @param {Record<string, any>} prospect
 * @param {number} stakeholderTargetCount
 */
function buildProspectResearchPacketItem(company, account, prospect, stakeholderTargetCount) {
  const packetState = prospect.packetState?.kind === "prospect_research"
    ? activePacketState(prospect.packetState)
    : null;
  return {
    packetKind: "prospect_research",
    ...packetStateSummaryFields(packetState),
    companyId: company.id,
    companyName: company.name,
    prospectId: prospect.id,
    prospectName: prospect.name,
    prospectTitle: prospect.title,
    queueStatus: prospect.queueState?.status ?? "selected",
    signalMatchCount: account?.signalMatches.length ?? 0,
    prospectCount: account?.prospects.length ?? 0,
    targetProspectCount: stakeholderTargetCount
  };
}

/**
 * @param {Record<string, any> | null} packetState
 */
function packetStateSummaryFields(packetState) {
  if (!packetState) {
    return {
      claimState: "claimable",
      reviewState: null,
      workerLabel: null,
      claimedAt: null,
      completedAt: null,
      returnedAt: null,
      reviewer: null,
      proposal: null,
      returnNotes: null,
      notes: null
    };
  }

  const returned = packetState.status === "returned";
  const submitted = packetState.status === "submitted";
  return {
    claimState: returned ? "claimable" : packetState.status,
    reviewState: returned ? "returned" : submitted ? "submitted" : null,
    workerLabel: packetState.workerLabel ?? null,
    claimedAt: packetState.claimedAt ?? null,
    completedAt: packetState.completedAt ?? null,
    returnedAt: packetState.returnedAt ?? null,
    reviewer: packetState.reviewer ?? null,
    proposal: packetState.proposal ?? null,
    returnNotes: packetState.returnNotes ?? null,
    notes: returned ? packetState.returnNotes ?? packetState.notes ?? null : packetState.notes ?? null
  };
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 */
function listSelectedProspectsMissingLinkedinProfileEnrichment(account) {
  return (account.prospects ?? [])
    .map((prospect) => prospectSchema.parse(prospect))
    .filter((prospect) => prospect.queueState?.status === "selected")
    .filter((prospect) => hasLinkedinProfileIdentity(prospect))
    .filter((prospect) => !hasStoredLinkedinProfileEnrichment(prospect));
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function hasLinkedinProfileIdentity(prospect) {
  if (normalizeNullableString(prospect.linkedinProfileUrl)) {
    return true;
  }

  return Array.isArray(prospect.contactPoints) && prospect.contactPoints.some((point) => (
    point.kind === "linkedin_profile"
    || point.kind === "linkedin_public_id"
    || point.kind === "linkedin_member_id"
  ));
}

/**
 * @param {import("../schema/target-account.js").prospectSchema._type} prospect
 */
function hasStoredLinkedinProfileEnrichment(prospect) {
  const snapshot = prospect.linkedinProfileSnapshot ?? {};
  return Boolean(
    normalizeNullableString(prospect.profileViewedAt)
    && normalizeNullableString(snapshot.capturedAt)
    && normalizeNullableString(snapshot.profileUrl)
    && snapshot.avatarChecked === true
  );
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
