// @ts-check

import { recordInboundObservation, mergeInboundObservation } from "./inbound-observations.js";
import { updateMotionProspect } from "./record-prospect.js";
import {
  findCompanyById,
  findInboundObservationByDedupeKey,
  findInboundObservationById,
  findMotionById,
  findUserById,
  listMotions,
  upsertInboundObservation,
} from "../db/database.js";

const SUPPORTED_TRANSITIONS = new Set([
  "connection_request_accept_requested",
  "connection_request_accepted",
  "connection_request_withdraw_requested",
  "connection_request_withdrawn",
  // Operator queued a reject — the agent declines it on LinkedIn, then writes
  // back the final connection_request_declined. decline_requested is the "queued
  // for the agent" intermediate state.
  "connection_request_decline_requested",
  "connection_request_declined",
]);

/**
 * @param {{
 *   observationId: string,
 *   nextKind: string,
 *   observedAt?: string | null,
 *   summary?: string | null,
 *   notes?: string | null,
 * }} args
 */
export function transitionInboundObservation(args) {
  if (!args.observationId || !args.nextKind) {
    throw new Error("Inbound observation transition requires observationId and nextKind.");
  }

  if (!SUPPORTED_TRANSITIONS.has(args.nextKind)) {
    throw new Error(`Unsupported inbound transition: ${args.nextKind}`);
  }

  const existing = findInboundObservationById(args.observationId);
  if (!existing) {
    throw new Error(`Inbound observation not found: ${args.observationId}`);
  }

  const rawUser = findUserById(existing.userId);
  if (!rawUser) {
    throw new Error(`User not found: ${existing.userId}`);
  }

  const observedAt = args.observedAt ?? new Date().toISOString();
  const next = recordInboundObservation(
    rawUser,
    {
      accountId: existing.accountId,
      surfaceKey: existing.surfaceKey,
      kind: args.nextKind,
      observedAt,
      summary: args.summary ?? buildTransitionSummary(existing.actorName, args.nextKind),
      externalId: existing.externalId,
      actorName: existing.actorName,
      actorTitle: existing.actorTitle,
      actorCompanyName: existing.actorCompanyName,
      actorHandle: existing.actorHandle,
      actorProfileUrl: existing.actorProfileUrl,
      actorLinkedinPublicId: existing.actorLinkedinPublicId,
      actorLinkedinMemberId: existing.actorLinkedinMemberId,
      actorAvatarSourceUrl: existing.actorAvatarSourceUrl,
      threadUrl: existing.threadUrl,
      sourceUrl: existing.sourceUrl,
      motionId: existing.motionId,
      companyId: existing.companyId,
      prospectId: existing.prospectId,
      notes: args.notes ?? existing.notes,
      messages: existing.messages,
    },
    { rawMotions: listMotions() },
  );

  // Identity-only rows may not carry a stable external id, so their transition
  // still needs to mutate the original observation instead of creating a second
  // sibling row for the same person and surface.
  const existingForDedupe = findInboundObservationByDedupeKey(next.dedupeKey) ?? existing;
  const merged = mergeInboundObservation(existingForDedupe, next);
  upsertInboundObservation(merged);

  let connectionDegreeMarked = false;
  if (args.nextKind === "connection_request_accepted" && existing.prospectId && existing.motionId && existing.companyId) {
    const rawMotion = findMotionById(existing.motionId);
    const rawCompany = findCompanyById(existing.companyId);
    if (rawMotion && rawCompany) {
      try {
        const updated = updateMotionProspect(rawMotion, rawCompany, {
          prospectId: existing.prospectId,
          linkedinProfileSnapshot: { connectionDegree: 1 },
        });
        connectionDegreeMarked = Boolean(updated);
      } catch {
        connectionDegreeMarked = false;
      }
    }
  }

  return {
    existing,
    observation: merged,
    connectionDegreeMarked,
  };
}

/**
 * @param {string | null | undefined} actorName
 * @param {string} nextKind
 */
function buildTransitionSummary(actorName, nextKind) {
  const subject = actorName?.trim() || "This inbound invite";
  switch (nextKind) {
    case "connection_request_accept_requested":
      return `${subject} is queued for acceptance on LinkedIn.`;
    case "connection_request_accepted":
      return `${subject} is now a LinkedIn connection.`;
    case "connection_request_decline_requested":
      return `${subject} is queued for rejection on LinkedIn.`;
    case "connection_request_declined":
      return `${subject}'s inbound connection request was declined.`;
    case "connection_request_withdraw_requested":
      return `${subject}'s pending connection request is queued for withdrawal.`;
    case "connection_request_withdrawn":
      return `${subject}'s pending connection request was withdrawn.`;
    default:
      return `${subject} was marked ${humanizeInboundObservationKind(nextKind)}.`;
  }
}

/**
 * @param {string} kind
 */
function humanizeInboundObservationKind(kind) {
  return kind.replace(/^connection_request_/, "").replaceAll("_", " ");
}
