// @ts-check

import { inboundObservationSchema } from "../schema/inbound.js";
import { userSchema } from "../schema/user.js";
import {
  applyViewPolicyToUser,
  filterInboundCuesForPolicy,
  filterInboundObservationsForPolicy,
  loadEffectivePolicy,
} from "./policy-ledger.js";

/**
 * @param {unknown} rawUser
 * @param {{
 *   rawObservations?: unknown[] | undefined,
 *   rawCues?: unknown[] | undefined,
 *   effectivePolicy?: ReturnType<typeof loadEffectivePolicy> | undefined,
 * }} [options]
 */
export function buildUserWorkspaceContext(rawUser, options = {}) {
  const user = userSchema.parse(rawUser);
  const effectivePolicy = options.effectivePolicy ?? loadEffectivePolicy();

  return {
    rawUser: user,
    user: applyViewPolicyToUser(user, effectivePolicy),
    observations: filterInboundObservationsForPolicy(options.rawObservations ?? [], user, effectivePolicy),
    cues: filterInboundCuesForPolicy(options.rawCues ?? [], user, effectivePolicy),
    effectivePolicy,
  };
}

/**
 * @param {unknown[]} rawObservations
 * @param {unknown} rawUser
 * @param {ReturnType<typeof loadEffectivePolicy>} effectivePolicy
 */
export function filterWorkspaceObservationsForUser(rawObservations, rawUser, effectivePolicy) {
  const user = userSchema.parse(rawUser);
  const userObservations = [];
  const otherObservations = [];

  for (const rawObservation of rawObservations) {
    const observation = inboundObservationSchema.parse(rawObservation);
    if (observation.userId === user.id) {
      userObservations.push(observation);
    } else {
      otherObservations.push(observation);
    }
  }

  return [
    ...otherObservations,
    ...filterInboundObservationsForPolicy(userObservations, user, effectivePolicy),
  ];
}
