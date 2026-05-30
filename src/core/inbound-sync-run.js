// @ts-check

import { buildDailyView } from "./build-daily-view.js";
import { buildInboxView } from "./build-inbox-view.js";
import { mergeInboundObservation, recordInboundObservation } from "./inbound-observations.js";
import { buildNextView } from "./build-next-view.js";
import { buildUserInboundSyncPlan, recordUserInboundSyncRun } from "./user-inbound-sync.js";
import { describeExo } from "./what-is-this.js";
import { isExecutionEligibleMotionStatus } from "../lib/motion-status.js";
import { inboundSyncRunPayloadSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";

/**
 * @param {unknown} rawUser
 * @param {unknown} rawPayload
 */
export function prepareUserInboundSyncRun(rawUser, rawPayload) {
  const user = userSchema.parse(rawUser);
  const payload = inboundSyncRunPayloadSchema.parse(rawPayload);
  const processedAt = new Date().toISOString();
  const seenAccountIds = new Set();
  const observationDraftsByDedupeKey = new Map();
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

      const preparedObservations = surfaceInput.observations.map((observationInput) => {
        const observation = recordInboundObservation(updatedUser, {
          accountId: account.id,
          surfaceKey: surfaceInput.surfaceKey,
          kind: observationInput.kind,
          observedAt: observationInput.observedAt,
          summary: observationInput.summary,
          externalId: observationInput.externalId,
          actorName: observationInput.actorName,
          actorTitle: observationInput.actorTitle,
          actorCompanyName: observationInput.actorCompanyName,
          actorHandle: observationInput.actorHandle,
          actorProfileUrl: observationInput.actorProfileUrl,
          threadUrl: observationInput.threadUrl,
          sourceUrl: observationInput.sourceUrl,
          motionId: observationInput.motionId,
          companyId: observationInput.companyId,
          prospectId: observationInput.prospectId,
          notes: observationInput.notes
        });
        const existingDraft = observationDraftsByDedupeKey.get(observation.dedupeKey) ?? null;
        observationDraftsByDedupeKey.set(observation.dedupeKey, mergeInboundObservation(existingDraft, observation));
        return observation;
      });

      const derivedItemCount = surfaceInput.status === "failed"
        ? surfaceInput.itemCount
        : surfaceInput.itemCount ?? preparedObservations.length;
      if (derivedItemCount !== null && derivedItemCount < preparedObservations.length) {
        throw new Error(
          `Inbound sync surface ${surfaceInput.surfaceKey} reported ${derivedItemCount} items but included ${preparedObservations.length} observations.`
        );
      }

      if (surfaceInput.status === "failed" && derivedItemCount && derivedItemCount > 0) {
        throw new Error(`Failed inbound sync surfaces cannot report positive item counts: ${surfaceInput.surfaceKey}`);
      }

      const newestObservationAt = newestObservedAt(preparedObservations);
      const observedAt = newestIsoDatetime(surfaceInput.observedAt, newestObservationAt);
      if (surfaceInput.status !== "failed" && derivedItemCount && derivedItemCount > 0 && !observedAt) {
        throw new Error(`Inbound sync surface ${surfaceInput.surfaceKey} needs observedAt when items were found.`);
      }

      updatedUser = recordUserInboundSyncRun(updatedUser, {
        accountId: account.id,
        surfaceKey: surfaceInput.surfaceKey,
        status: surfaceInput.status,
        observedAt,
        itemCount: derivedItemCount,
        error: surfaceInput.error
      });

      return {
        surfaceKey: surfaceInput.surfaceKey,
        status: surfaceInput.status,
        observedAt,
        itemCount: derivedItemCount,
        error: surfaceInput.error,
        observationCount: preparedObservations.length,
        itemizationGapCount: derivedItemCount === null ? 0 : Math.max(0, derivedItemCount - preparedObservations.length)
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
    observations: observationDrafts,
    updatedUser
  };
}

/**
 * @param {{
 *   rawUser: unknown,
 *   rawUsers: unknown[],
 *   rawMotions: unknown[],
 *   rawCompanies: unknown[],
 *   rawProfiles: unknown[],
 *   rawObservations: unknown[]
 * }} input
 */
export function buildInboundSyncRefreshSummary(input) {
  const inbox = buildInboxView(input.rawUser, input.rawObservations, input.rawMotions, input.rawCompanies);
  const daily = buildDailyView(input.rawUser, input.rawMotions, input.rawCompanies, input.rawProfiles, input.rawObservations);
  const rawMotion = resolvePreferredNextMotion(input.rawMotions);
  const next = buildNextView({
    rawUser: input.rawUser,
    rawMotion,
    rawMotions: input.rawMotions,
    rawCompanies: input.rawCompanies,
    rawProfiles: input.rawProfiles,
    rawUsers: input.rawUsers,
    rawObservations: input.rawObservations
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
 * @param {Array<{ observedAt: string }>} observations
 */
function newestObservedAt(observations) {
  return observations
    .map((observation) => observation.observedAt)
    .sort()
    .at(-1) ?? null;
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
