// @ts-check

import { buildDailyView } from "./build-daily-view.js";
import { buildInboxView } from "./build-inbox-view.js";
import { matchesAnyInboundIgnoreRule } from "./inbound-ignore-rules.js";
import {
  buildInboundObservationIdentityKeys,
  inboundObservationsShareIdentity,
  mergeInboundObservation,
  recordInboundObservation
} from "./inbound-observations.js";
import { buildNextView } from "./build-next-view.js";
import { buildUserInboundSyncPlan, recordUserInboundSyncRun } from "./user-inbound-sync.js";
import { describeExo } from "./what-is-this.js";
import { isExecutionEligibleMotionStatus } from "../lib/motion-status.js";
import { findInboundSurfaceDefinition } from "../lib/inbound-surface-catalog.js";
import { inboundObservationSchema, inboundSyncRunPayloadSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

/**
 * @param {unknown} rawUser
 * @param {unknown} rawPayload
 * @param {{ rawMotions?: unknown[] | undefined, rawExistingObservations?: unknown[] | undefined }} [options]
 */
export function prepareUserInboundSyncRun(rawUser, rawPayload, options = {}) {
  const user = userSchema.parse(rawUser);
  const payload = inboundSyncRunPayloadSchema.parse(rawPayload);
  const processedAt = new Date().toISOString();
  const seenAccountIds = new Set();
  const observationDraftsByDedupeKey = new Map();
  const companyEnrichmentDraftsByDedupeKey = new Map();
  const existingObservations = (options.rawExistingObservations ?? []).map((item) => inboundObservationSchema.parse(item));
  let updatedUser = user;

  const accounts = payload.accounts.map((accountInput) => {
    if (seenAccountIds.has(accountInput.accountId)) {
      throw new Error(`Inbound sync run repeated the same account: ${accountInput.accountId}`);
    }
    seenAccountIds.add(accountInput.accountId);

    const account = updatedUser.accounts.find((candidate) => candidate.id === accountInput.accountId);
    if (!account) {
      throw new Error(`User account not found: ${accountInput.accountId}`);
    }

    const allowedSurfaceKeys = new Set(
      buildUserInboundSyncPlan(updatedUser, {
        accountId: account.id,
        mode: payload.mode
      }).accounts
        .flatMap((plannedAccount) => plannedAccount.phases.flatMap((phase) => phase.surfaces))
        .map((surface) => surface.key)
    );
    const seenSurfaceKeys = new Set();

    const surfaces = accountInput.surfaces.map((surfaceInput) => {
      if (seenSurfaceKeys.has(surfaceInput.surfaceKey)) {
        throw new Error(`Inbound sync run repeated the same surface on one account: ${surfaceInput.surfaceKey}`);
      }
      seenSurfaceKeys.add(surfaceInput.surfaceKey);

      if (!allowedSurfaceKeys.has(surfaceInput.surfaceKey)) {
        throw new Error(`Inbound surface ${surfaceInput.surfaceKey} is not enabled for ${payload.mode} mode on account ${account.id}.`);
      }

      if (surfaceInput.status === "success" && surfaceInput.error) {
        throw new Error(`Successful inbound sync surfaces cannot carry an error: ${surfaceInput.surfaceKey}`);
      }

      if (surfaceInput.status !== "success" && !surfaceInput.error) {
        throw new Error(`Inbound sync surface ${surfaceInput.surfaceKey} needs an error detail for ${surfaceInput.status}.`);
      }

      if (surfaceInput.status === "failed" && surfaceInput.observations.length) {
        throw new Error(`Failed inbound sync surfaces cannot include observations: ${surfaceInput.surfaceKey}`);
      }

      const priorSurfaceState = account.inboundSync?.surfaces?.find(
        (surface) => surface.surfaceKey === surfaceInput.surfaceKey
      ) ?? null;
      const rawVisibleTotalCount = surfaceInput.visibleTotalCount ?? null;
      const exhaustionStatus = normalizeExhaustionStatus(surfaceInput);
      const rawPreparedObservations = surfaceInput.observations.map((observationInput) => {
        const observation = recordInboundObservation(updatedUser, {
          accountId: account.id,
          surfaceKey: surfaceInput.surfaceKey,
          kind: observationInput.kind,
          observedAt: observationInput.observedAt,
          eventAt: observationInput.eventAt,
          summary: observationInput.summary,
          externalId: observationInput.externalId,
          actorName: observationInput.actorName,
          actorTitle: observationInput.actorTitle,
          actorCompanyName: observationInput.actorCompanyName,
          actorHandle: observationInput.actorHandle,
          actorProfileUrl: observationInput.actorProfileUrl,
          actorLinkedinPublicId: observationInput.actorLinkedinPublicId,
          actorLinkedinMemberId: observationInput.actorLinkedinMemberId,
          actorAvatarSourceUrl: observationInput.actorAvatarSourceUrl,
          threadUrl: observationInput.threadUrl,
          sourceUrl: observationInput.sourceUrl,
          subject: observationInput.subject,
          motionId: observationInput.motionId,
          companyId: observationInput.companyId,
          prospectId: observationInput.prospectId,
          providerSharedSecret: observationInput.providerSharedSecret,
          notes: observationInput.notes,
          messages: observationInput.messages
        }, {
          rawMotions: options.rawMotions
        });
        const existingCompanyEnrichment = companyEnrichmentDraftsByDedupeKey.get(observation.dedupeKey) ?? null;
        companyEnrichmentDraftsByDedupeKey.set(
          observation.dedupeKey,
          mergeInboundObservationCompanyProfile(existingCompanyEnrichment, observationInput.actorCompanyProfile),
        );
        return observation;
      });
      const candidateCurrentObservations = buildContinuationAwareCurrentObservations({
        accountId: account.id,
        surfaceKey: surfaceInput.surfaceKey,
        surfaceStatus: surfaceInput.status,
        captureCompleteness: surfaceInput.captureCompleteness ?? null,
        exhaustionStatus,
        priorSurfaceState,
        currentObservations: rawPreparedObservations,
        rawExistingObservations: existingObservations,
      });
      const currentObservations = promoteCurrentSurfaceDeltaObservations({
        rawUser: updatedUser,
        rawMotions: options.rawMotions ?? [],
        rawExistingObservations: existingObservations,
        accountId: account.id,
        surfaceKey: surfaceInput.surfaceKey,
        surfaceStatus: surfaceInput.status,
        captureCompleteness: surfaceInput.captureCompleteness ?? null,
        exhaustionStatus,
        priorSurfaceState,
        currentObservations: candidateCurrentObservations.filter((observation) => !matchesAnyInboundIgnoreRule(updatedUser, observation))
      });
      const ignoredObservationCount = Math.max(0, candidateCurrentObservations.length - currentObservations.length);
      for (const observation of currentObservations) {
        const existingDraft = observationDraftsByDedupeKey.get(observation.dedupeKey) ?? null;
        observationDraftsByDedupeKey.set(observation.dedupeKey, mergeInboundObservation(existingDraft, observation));
      }

      const derivedItemCount = surfaceInput.status === "failed"
        ? surfaceInput.itemCount
        : Math.max(surfaceInput.itemCount ?? 0, currentObservations.length);
      const visibleTotalCount = surfaceInput.status === "failed"
        ? rawVisibleTotalCount
        : normalizeVisibleTotalCount(rawVisibleTotalCount, derivedItemCount);
      const countDiscrepancyCount = Math.max((visibleTotalCount ?? derivedItemCount ?? 0) - (derivedItemCount ?? 0), 0);
      const surfaceDefinition = findInboundSurfaceDefinition(surfaceInput.surfaceKey);
      const isAuthoritative = surfaceDefinition?.truthLevel === "authoritative";
      if (derivedItemCount !== null && derivedItemCount < currentObservations.length) {
        throw new Error(
          `Inbound sync surface ${surfaceInput.surfaceKey} reported ${derivedItemCount} items but included ${currentObservations.length} observations.`
        );
      }

      if (surfaceInput.status === "failed" && derivedItemCount && derivedItemCount > 0) {
        throw new Error(`Failed inbound sync surfaces cannot report positive item counts: ${surfaceInput.surfaceKey}`);
      }

      if (surfaceInput.status === "failed" && visibleTotalCount && visibleTotalCount > 0) {
        throw new Error(`Failed inbound sync surfaces cannot report positive visible totals: ${surfaceInput.surfaceKey}`);
      }

      if (surfaceInput.status === "failed" && exhaustionStatus !== "blocked") {
        throw new Error(`Failed inbound sync surfaces must mark exhaustionStatus as blocked: ${surfaceInput.surfaceKey}`);
      }

      if (surfaceInput.status !== "failed" && exhaustionStatus === "blocked") {
        throw new Error(`Only failed inbound sync surfaces can mark exhaustionStatus as blocked: ${surfaceInput.surfaceKey}`);
      }

      if (surfaceInput.captureCompleteness === "complete" && exhaustionStatus !== "complete") {
        throw new Error(`Complete inbound sync surfaces must mark exhaustionStatus as complete: ${surfaceInput.surfaceKey}`);
      }

      if (exhaustionStatus === "complete" && surfaceInput.captureCompleteness !== "complete") {
        throw new Error(`Inbound sync surfaces with complete exhaustion must mark captureCompleteness as complete: ${surfaceInput.surfaceKey}`);
      }

      if (
        payload.mode === "full"
        && isAuthoritative
        && surfaceInput.status !== "failed"
        && exhaustionStatus !== "complete"
      ) {
        if (!surfaceInput.reconcileRequired) {
          throw new Error(
            `Full authoritative inbound sync surfaces must mark reconcileRequired when exhaustion is incomplete: ${surfaceInput.surfaceKey}.`
          );
        }

        if (surfaceInput.status !== "warning") {
          throw new Error(
            `Full authoritative inbound sync surfaces must use warning status when exhaustion is incomplete: ${surfaceInput.surfaceKey}.`
          );
        }
      }

      const newestObservationAt = newestObservedAt(currentObservations);
      const observedAt = newestIsoDatetime(surfaceInput.observedAt, newestObservationAt);
      const reportedCount = visibleTotalCount ?? derivedItemCount;
      if (surfaceInput.status !== "failed" && reportedCount && reportedCount > 0 && !observedAt) {
        throw new Error(`Inbound sync surface ${surfaceInput.surfaceKey} needs observedAt when items were found.`);
      }

      const rawDerivedDeltaObservations = deriveReconciledSurfaceDeltaObservations({
        rawUser: updatedUser,
        rawMotions: options.rawMotions ?? [],
        rawExistingObservations: existingObservations,
        accountId: account.id,
        surfaceKey: surfaceInput.surfaceKey,
        surfaceStatus: surfaceInput.status,
        captureCompleteness: surfaceInput.captureCompleteness ?? null,
        exhaustionStatus,
        observedAt: observedAt ?? processedAt,
        currentObservations
      });
      const derivedDeltaObservations = rawDerivedDeltaObservations.filter(
        (observation) => !matchesAnyInboundIgnoreRule(updatedUser, observation),
      );

      for (const observation of derivedDeltaObservations) {
        const existingDraft = observationDraftsByDedupeKey.get(observation.dedupeKey) ?? null;
        observationDraftsByDedupeKey.set(observation.dedupeKey, mergeInboundObservation(existingDraft, observation));
      }

      const itemizationGapCount = exhaustionStatus === "complete"
        ? 0
        : Math.max(0, (visibleTotalCount ?? derivedItemCount ?? 0) - currentObservations.length - ignoredObservationCount);

      updatedUser = recordUserInboundSyncRun(updatedUser, {
        accountId: account.id,
        surfaceKey: surfaceInput.surfaceKey,
        status: surfaceInput.status,
        observedAt,
        itemCount: derivedItemCount,
        visibleTotalCount,
        captureCompleteness: surfaceInput.captureCompleteness,
        requestedMode: surfaceInput.requestedMode,
        actualMode: surfaceInput.actualMode,
        reconcileRequired: surfaceInput.reconcileRequired,
        reconcileReason: surfaceInput.reconcileReason,
        exhaustionStatus,
        exhaustionReason: surfaceInput.exhaustionReason,
        paginationAttempted: surfaceInput.paginationAttempted,
        terminalSignalSeen: surfaceInput.terminalSignalSeen,
        stalledPassCount: surfaceInput.stalledPassCount,
        continuationStartedAt: surfaceInput.continuationStartedAt,
        nextCursor: surfaceInput.nextCursor,
        nextStartOffset: surfaceInput.nextStartOffset,
        observationCount: currentObservations.length,
        itemizationGapCount,
        countDiscrepancyCount,
        error: surfaceInput.error
      });

      return {
        surfaceKey: surfaceInput.surfaceKey,
        status: surfaceInput.status,
        observedAt,
        itemCount: derivedItemCount,
        visibleTotalCount,
        captureCompleteness: surfaceInput.captureCompleteness,
        requestedMode: surfaceInput.requestedMode,
        actualMode: surfaceInput.actualMode,
        reconcileRequired: surfaceInput.reconcileRequired,
        reconcileReason: surfaceInput.reconcileReason,
        exhaustionStatus,
        exhaustionReason: surfaceInput.exhaustionReason,
        paginationAttempted: surfaceInput.paginationAttempted,
        terminalSignalSeen: surfaceInput.terminalSignalSeen,
        stalledPassCount: surfaceInput.stalledPassCount,
        continuationStartedAt: surfaceInput.continuationStartedAt,
        nextCursor: surfaceInput.nextCursor,
        nextStartOffset: surfaceInput.nextStartOffset,
        error: surfaceInput.error,
        observationCount: currentObservations.length,
        itemizationGapCount,
        countDiscrepancyCount
      };
    });

    return {
      accountId: account.id,
      capability: account.capability,
      handle: account.handle,
      label: account.label,
      preferred: account.preferred,
      sourceType: account.sourceType,
      checkedSurfaceCount: surfaces.length,
      observationCount: surfaces.reduce((sum, surface) => sum + surface.observationCount, 0),
      surfaces
    };
  });

  const observationDrafts = [...observationDraftsByDedupeKey.values()];
  const companyEnrichments = [...companyEnrichmentDraftsByDedupeKey.entries()]
    .filter(([, companyProfile]) => companyProfile)
    .map(([dedupeKey, companyProfile]) => ({
      dedupeKey,
      companyProfile
    }));

  return {
    user: {
      id: updatedUser.id,
      label: updatedUser.label,
      owner: updatedUser.owner
    },
    processedAt,
    mode: payload.mode,
    counts: {
      accountCount: accounts.length,
      checkedSurfaceCount: accounts.reduce((sum, account) => sum + account.checkedSurfaceCount, 0),
      successSurfaceCount: accounts.reduce(
        (sum, account) => sum + account.surfaces.filter((surface) => surface.status === "success").length,
        0
      ),
      warningSurfaceCount: accounts.reduce(
        (sum, account) => sum + account.surfaces.filter((surface) => surface.status === "warning").length,
        0
      ),
      failedSurfaceCount: accounts.reduce(
        (sum, account) => sum + account.surfaces.filter((surface) => surface.status === "failed").length,
        0
      ),
      observationCount: observationDrafts.length,
      itemizationGapCount: accounts.reduce(
        (sum, account) => sum + account.surfaces.reduce((surfaceSum, surface) => surfaceSum + surface.itemizationGapCount, 0),
        0
      )
    },
    followUpCommands: [
      `exo inbox --user ${updatedUser.id} --json`,
      `exo daily --user ${updatedUser.id} --json`,
      `exo next --user ${updatedUser.id} --json`
    ],
    accounts,
    companyEnrichments,
    observations: observationDrafts,
    updatedUser
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationCompanyProfileSchema._type | null | undefined} left
 * @param {import("../schema/inbound.js").inboundObservationCompanyProfileSchema._type | null | undefined} right
 */
function mergeInboundObservationCompanyProfile(left, right) {
  if (!left && !right) {
    return null;
  }
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }
  return {
    name: right.name ?? left.name,
    domain: right.domain ?? left.domain,
    websiteUrl: right.websiteUrl ?? left.websiteUrl,
    linkedinCompanyUrl: right.linkedinCompanyUrl ?? left.linkedinCompanyUrl,
    logoSourceUrl: right.logoSourceUrl ?? left.logoSourceUrl,
  };
}

/**
 * @param {{
 *   rawUser: unknown,
 *   rawUsers: unknown[],
 *   rawMotions: unknown[],
 *   rawCompanies: unknown[],
 *   rawProfiles: unknown[],
 *   rawObservations: unknown[],
 *   rawCues?: unknown[]
 * }} input
 */
export function buildInboundSyncRefreshSummary(input) {
  const inbox = buildInboxView(input.rawUser, input.rawObservations, input.rawMotions, input.rawCompanies);
  const daily = buildDailyView(input.rawUser, input.rawMotions, input.rawCompanies, input.rawProfiles, input.rawObservations, {
    rawUsers: input.rawUsers,
    rawCues: input.rawCues ?? []
  });
  const rawMotion = resolvePreferredNextMotion(input.rawMotions);
  const next = buildNextView({
    rawUser: input.rawUser,
    rawMotion,
    rawMotions: input.rawMotions,
    rawCompanies: input.rawCompanies,
    rawProfiles: input.rawProfiles,
    rawUsers: input.rawUsers,
    rawObservations: input.rawObservations,
    rawCues: input.rawCues ?? []
  });

  return {
    inbox: {
      itemCount: inbox.counts.itemCount,
      highPriorityCount: inbox.counts.highPriorityCount,
      uncheckedSurfaceCount: inbox.surfaces.uncheckedSurfaceCount,
      topItem: inbox.items[0]
        ? {
            summary: inbox.items[0].summary,
            recommendedAction: inbox.items[0].recommendedAction,
            priority: inbox.items[0].priority,
            status: inbox.items[0].status
          }
        : null
    },
    daily: {
      itemCount: daily.counts.itemCount,
      dueNowCount: daily.counts.dueNowCount,
      waitingCount: daily.counts.waitingCount,
      topItem: daily.items[0]
        ? {
            recommendedAction: daily.items[0].recommendedAction,
            priority: daily.items[0].priority,
            state: daily.items[0].state,
            cadenceEffect: daily.items[0].cadenceEffect
          }
        : null
    },
    next: {
      headline: next.headline,
      nextMove: next.nextMove,
      why: next.why,
      source: next.source,
      status: next.status
    }
  };
}

/**
 * @param {{
 *   accountId: string,
 *   surfaceKey: string,
 *   surfaceStatus: "success" | "warning" | "failed",
 *   captureCompleteness: import("../schema/inbound.js").inboundCaptureCompletenessSchema._type | null,
 *   exhaustionStatus: import("../schema/inbound.js").inboundSurfaceExhaustionStatusSchema._type,
 *   priorSurfaceState: import("../schema/inbound.js").inboundSurfaceStateSchema._type | null,
 *   currentObservations: import("../schema/inbound.js").inboundObservationSchema._type[],
 *   rawExistingObservations: import("../schema/inbound.js").inboundObservationSchema._type[],
 * }} input
 */
function buildContinuationAwareCurrentObservations(input) {
  const continuationStartedAt = normalizeNullableString(input.priorSurfaceState?.continuationStartedAt);
  if (
    input.surfaceStatus === "failed"
    || !continuationStartedAt
    || !surfaceHasPendingContinuation(input.priorSurfaceState)
  ) {
    return input.currentObservations;
  }

  const carryforwardKinds = resolveContinuationCarryforwardKinds(input.surfaceKey);
  if (!carryforwardKinds.length) {
    return input.currentObservations;
  }

  const mergedByDedupeKey = new Map();
  for (const observation of input.rawExistingObservations) {
    if (
      observation.accountId !== input.accountId
      || observation.surfaceKey !== input.surfaceKey
      || !carryforwardKinds.includes(observation.kind)
      || observation.observedAt < continuationStartedAt
    ) {
      continue;
    }
    mergedByDedupeKey.set(observation.dedupeKey, mergeInboundObservation(mergedByDedupeKey.get(observation.dedupeKey) ?? null, observation));
  }

  for (const observation of input.currentObservations) {
    mergedByDedupeKey.set(observation.dedupeKey, mergeInboundObservation(mergedByDedupeKey.get(observation.dedupeKey) ?? null, observation));
  }

  return [...mergedByDedupeKey.values()];
}

/**
 * @param {{
 *   rawUser: unknown,
 *   rawMotions: unknown[],
 *   rawExistingObservations: import("../schema/inbound.js").inboundObservationSchema._type[],
 *   accountId: string,
 *   surfaceKey: string,
 *   surfaceStatus: "success" | "warning" | "failed",
 *   captureCompleteness: import("../schema/inbound.js").inboundCaptureCompletenessSchema._type | null,
 *   exhaustionStatus: import("../schema/inbound.js").inboundSurfaceExhaustionStatusSchema._type,
 *   priorSurfaceState: import("../schema/inbound.js").inboundSurfaceStateSchema._type | null,
 *   currentObservations: import("../schema/inbound.js").inboundObservationSchema._type[]
 * }} input
 */
function promoteCurrentSurfaceDeltaObservations(input) {
  if (input.surfaceStatus === "failed" || input.captureCompleteness !== "complete" || input.exhaustionStatus !== "complete") {
    return input.currentObservations;
  }

  const promotionDefinition = additiveObservationDefinitionBySurfaceKey[input.surfaceKey] ?? null;
  if (!promotionDefinition || !surfaceStateHasCompleteBaseline(input.priorSurfaceState)) {
    return input.currentObservations;
  }

  return input.currentObservations.map((observation) => {
    if (observation.kind !== promotionDefinition.steadyKind || !buildObservationHasReconcilableIdentity(observation)) {
      return observation;
    }

    const latestMatchingObservation = input.rawExistingObservations
      .filter((candidate) =>
        candidate.accountId === input.accountId
        && candidate.surfaceKey === input.surfaceKey
        && promotionDefinition.relevantKinds.includes(candidate.kind)
        && buildObservationHasReconcilableIdentity(candidate)
        && inboundObservationsShareIdentity(candidate, observation)
      )
      .reduce(chooseMoreRecentObservation, null);

    if (latestMatchingObservation && promotionDefinition.presentKinds.includes(latestMatchingObservation.kind)) {
      return observation;
    }

    return recordInboundObservation(input.rawUser, {
      accountId: observation.accountId,
      surfaceKey: observation.surfaceKey,
      kind: promotionDefinition.deltaKind,
      observedAt: observation.observedAt,
      eventAt: observation.eventAt,
      summary: promotionDefinition.buildSummary(observation),
      externalId: observation.externalId,
      actorName: observation.actorName,
      actorTitle: observation.actorTitle,
      actorCompanyName: observation.actorCompanyName,
      actorHandle: observation.actorHandle,
      actorProfileUrl: observation.actorProfileUrl,
      actorLinkedinPublicId: observation.actorLinkedinPublicId,
      actorLinkedinMemberId: observation.actorLinkedinMemberId,
      actorAvatarSourceUrl: observation.actorAvatarSourceUrl,
      threadUrl: observation.threadUrl,
      sourceUrl: observation.sourceUrl,
      subject: observation.subject,
      motionId: observation.motionId,
      companyId: observation.companyId,
      prospectId: observation.prospectId,
      notes: promotionDefinition.notes,
      messages: observation.messages
    }, {
      rawMotions: input.rawMotions
    });
  });
}

/**
 * @param {Array<{ observedAt: string }>} observations
 */
function newestObservedAt(observations) {
  return observations
    .map((observation) => observation.observedAt)
    .sort()
    .at(-1) ?? null;
}

/**
 * @param {{
 *   rawUser: unknown,
 *   rawMotions: unknown[],
 *   rawExistingObservations: import("../schema/inbound.js").inboundObservationSchema._type[],
 *   accountId: string,
 *   surfaceKey: string,
 *   surfaceStatus: "success" | "warning" | "failed",
 *   captureCompleteness: import("../schema/inbound.js").inboundCaptureCompletenessSchema._type | null,
 *   exhaustionStatus: import("../schema/inbound.js").inboundSurfaceExhaustionStatusSchema._type,
 *   observedAt: string,
 *   currentObservations: import("../schema/inbound.js").inboundObservationSchema._type[]
 * }} input
 */
function deriveReconciledSurfaceDeltaObservations(input) {
  if (input.surfaceStatus === "failed" || input.captureCompleteness !== "complete" || input.exhaustionStatus !== "complete") {
    return [];
  }

  const currentExternalIds = new Set(
    input.currentObservations.flatMap((observation) => [...buildInboundObservationIdentityKeys(observation)])
  );

  const deltaDefinition = deltaObservationDefinitionBySurfaceKey[input.surfaceKey] ?? null;
  if (!deltaDefinition) {
    return [];
  }

  return input.rawExistingObservations
    .filter((observation) =>
      observation.accountId === input.accountId
      && observation.surfaceKey === input.surfaceKey
      && deltaDefinition.previousKinds.includes(observation.kind)
      && buildObservationHasReconcilableIdentity(observation)
      && ![...buildInboundObservationIdentityKeys(observation)].some((key) => currentExternalIds.has(key))
    )
    .map((observation) => recordInboundObservation(input.rawUser, {
      accountId: input.accountId,
      surfaceKey: input.surfaceKey,
      kind: deltaDefinition.nextKind,
      observedAt: input.observedAt,
      eventAt: observation.eventAt ?? null,
      summary: deltaDefinition.buildSummary(observation),
      externalId: observation.externalId,
      actorName: observation.actorName,
      actorTitle: observation.actorTitle,
      actorCompanyName: observation.actorCompanyName,
      actorHandle: observation.actorHandle,
      actorProfileUrl: observation.actorProfileUrl,
      actorLinkedinPublicId: observation.actorLinkedinPublicId,
      actorLinkedinMemberId: observation.actorLinkedinMemberId,
      actorAvatarSourceUrl: observation.actorAvatarSourceUrl,
      sourceUrl: observation.sourceUrl,
      motionId: observation.motionId,
      companyId: observation.companyId,
      prospectId: observation.prospectId,
      notes: deltaDefinition.notes
    }, {
      rawMotions: input.rawMotions
    }));
}

/**
 * @param {import("../schema/inbound.js").inboundSurfaceStateSchema._type | null} surfaceState
 */
function surfaceHasPendingContinuation(surfaceState) {
  if (!surfaceState) {
    return false;
  }

  return normalizeNullableString(surfaceState.nextCursor) !== null
    || (Number.isInteger(surfaceState.nextStartOffset) && surfaceState.nextStartOffset >= 0);
}

/**
 * @param {string} surfaceKey
 */
function resolveContinuationCarryforwardKinds(surfaceKey) {
  const additiveDefinition = additiveObservationDefinitionBySurfaceKey[surfaceKey] ?? null;
  if (Array.isArray(additiveDefinition?.presentKinds) && additiveDefinition.presentKinds.length) {
    return additiveDefinition.presentKinds;
  }

  const deltaDefinition = deltaObservationDefinitionBySurfaceKey[surfaceKey] ?? null;
  return Array.isArray(deltaDefinition?.previousKinds) ? deltaDefinition.previousKinds : [];
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 */
function buildObservationHasReconcilableIdentity(observation) {
  return buildInboundObservationIdentityKeys(observation).size > 0;
}

/**
 * @param {{
 *   status: "success" | "warning" | "failed",
 *   captureCompleteness: import("../schema/inbound.js").inboundCaptureCompletenessSchema._type | null,
 *   exhaustionStatus?: import("../schema/inbound.js").inboundSurfaceExhaustionStatusSchema._type | null
 * }} input
 */
function normalizeExhaustionStatus(input) {
  if (input.exhaustionStatus) {
    return input.exhaustionStatus;
  }

  if (input.status === "failed" || input.captureCompleteness === "failed") {
    return "blocked";
  }

  if (input.captureCompleteness === "complete") {
    return "complete";
  }

  return "incomplete";
}

/**
 * @param {number | null} visibleTotalCount
 * @param {number | null} itemCount
 */
function normalizeVisibleTotalCount(visibleTotalCount, itemCount) {
  if (visibleTotalCount === null || itemCount === null) return visibleTotalCount;
  return Math.max(visibleTotalCount, itemCount);
}

const deltaObservationDefinitionBySurfaceKey = {
  "linkedin-sent-invitations": {
    previousKinds: ["connection_request_pending"],
    nextKind: "connection_request_no_longer_pending",
    notes: "Derived from a complete sent-invitations reconciliation pass.",
    buildSummary: (observation) => `${observation.actorName ?? "A pending invite"} is no longer present in the live pending invitations list.`
  },
  "linkedin-received-invitations": {
    previousKinds: ["connection_request_received"],
    nextKind: "connection_request_received_no_longer_pending",
    notes: "Derived from a complete received-invitations reconciliation pass.",
    buildSummary: (observation) => `${observation.actorName ?? "An inbound invite"} is no longer present in the live received invitations list.`
  },
  "linkedin-followers-list": {
    previousKinds: ["follower_added", "follower_confirmed"],
    nextKind: "follower_removed",
    notes: "Derived from a complete followers reconciliation pass.",
    buildSummary: (observation) => `${observation.actorName ?? "A follower"} is no longer present in the live followers list.`
  },
  "linkedin-following-list": {
    previousKinds: ["follow_state_changed", "follow_state_confirmed"],
    nextKind: "follow_state_removed",
    notes: "Derived from a complete following-list reconciliation pass.",
    buildSummary: (observation) => `${observation.actorName ?? "A followed profile"} is no longer present in the live following list.`
  }
};

const additiveObservationDefinitionBySurfaceKey = {
  "linkedin-followers-list": {
    steadyKind: "follower_confirmed",
    deltaKind: "follower_added",
    presentKinds: ["follower_added", "follower_confirmed"],
    relevantKinds: ["follower_added", "follower_confirmed", "follower_removed"],
    notes: "Derived from a complete followers reconciliation pass against the prior complete snapshot.",
    buildSummary: (observation) => `${observation.actorName ?? "A follower"} newly appeared in the live followers list.`
  },
  "linkedin-following-list": {
    steadyKind: "follow_state_confirmed",
    deltaKind: "follow_state_changed",
    presentKinds: ["follow_state_changed", "follow_state_confirmed"],
    relevantKinds: ["follow_state_changed", "follow_state_confirmed", "follow_state_removed"],
    notes: "Derived from a complete following-list reconciliation pass against the prior complete snapshot.",
    buildSummary: (observation) => `${observation.actorName ?? "A followed profile"} newly appeared in the live following list.`
  }
};

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type | null} left
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} right
 */
function chooseMoreRecentObservation(left, right) {
  if (!left) {
    return right;
  }

  const leftObservedAt = left.observedAt ?? "";
  const rightObservedAt = right.observedAt ?? "";
  if (rightObservedAt > leftObservedAt) {
    return right;
  }

  if (rightObservedAt < leftObservedAt) {
    return left;
  }

  return (right.recordedAt ?? "") > (left.recordedAt ?? "")
    ? right
    : left;
}

/**
 * @param {import("../schema/inbound.js").inboundSurfaceStateSchema._type | null} surfaceState
 */
function surfaceStateHasCompleteBaseline(surfaceState) {
  if (!surfaceState) {
    return false;
  }

  return surfaceState.lastCaptureCompleteness === "complete"
    && surfaceState.lastExhaustionStatus === "complete"
    && surfaceState.lastRunStatus !== "never";
}

/**
 * @param {string | null} left
 * @param {string | null} right
 */
function newestIsoDatetime(left, right) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left >= right ? left : right;
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {unknown[]} rawMotions
 */
function resolvePreferredNextMotion(rawMotions) {
  const activeMotions = rawMotions.filter((motion) => isExecutionEligibleMotionStatus(motion.status));
  if (activeMotions.length === 1) {
    return activeMotions[0];
  }

  const focusMotionId = describeExo().agentUsage.recommendedPath.focusMotionId ?? null;
  if (!focusMotionId) {
    return null;
  }

  return activeMotions.find((motion) => motion.id === focusMotionId) ?? null;
}
