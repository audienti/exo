// @ts-check
//
// Auto-promote inbound connection ACCEPTS into the transition-inbound-backlog.
//
// A manual "promote this person" step whose only sane outcome is "promote" is
// busywork. Once someone accepts a connection, they're a real relationship: this
// pulls every un-promoted accept into the backlog motion as a tracked prospect,
// carrying its in-flight state. From there the normal pipeline takes over — the
// agent drafts a first message and the operator's only decision is approve-and-
// send (or steer/ignore). The operator never clicks "promote".
//
// An observation that has already been promoted carries a prospectId (promotion
// relinks all of a person's observations to the new prospect), so we skip those.
// runTransitionPromote groups a person's observations by identity and relinks
// them together, so we also skip any seed that a prior promote in this pass
// already absorbed — that prevents creating duplicate prospects for one person.

import { ensureTransitionMotion } from "./ensure-transition-motion.js";
import { runTransitionPromote } from "./run-transition-promote.js";
import { findInboundObservationById, listInboundObservations } from "../db/database.js";

/** Inbound kinds that mean "there is now a live connection to work". */
const ACCEPT_KINDS = new Set(["connection_request_accepted"]);

/**
 * @param {{ userId?: string | null, motionId?: string | null }} [input]
 * @returns {Promise<{ count: number, motionId: string, promoted: Array<{ observationId: string, prospectId: string, prospectName: string }> }>}
 */
export async function autoPromoteInboundAccepts(input = {}) {
  // Pin to the transition backlog unless the caller names a motion.
  const motionId = input.motionId ?? (await ensureTransitionMotion()).id;

  const seeds = listInboundObservations({ userId: input.userId ?? undefined }).filter(
    (observation) => ACCEPT_KINDS.has(observation.kind) && !observation.prospectId,
  );

  const promoted = [];
  const handled = new Set();
  for (const seed of seeds) {
    if (handled.has(seed.id)) continue;
    // A prior promote in this pass may have already absorbed this person's
    // observations (identity grouping). Re-read the live row to be sure.
    const fresh = findInboundObservationById(seed.id);
    if (fresh?.prospectId) {
      handled.add(seed.id);
      continue;
    }
    const result = await runTransitionPromote({
      observationId: seed.id,
      userId: input.userId ?? undefined,
      motionId,
    });
    for (const observation of result.observations ?? []) handled.add(observation.id);
    handled.add(seed.id);
    promoted.push({ observationId: seed.id, prospectId: result.prospectId, prospectName: result.prospectName });
  }

  return { count: promoted.length, motionId, promoted };
}
