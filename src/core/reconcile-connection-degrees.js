// @ts-check
//
// Reconcile connection degree from authoritative accept events.
//
// An accepted connection request is proof we are a 1st-degree connection. This
// backfills connectionDegree=1 onto every tracked prospect that has a recorded
// `connection_request_accepted` observation but no captured degree yet — so the
// connection-state reconciliation (prospect pipeline, Connections Sent/Received)
// reflects reality without waiting on a fresh profile capture. A later capture
// that reads the real degree badge can still override it.

import {
  findCompanyById,
  findMotionById,
  listInboundObservations,
} from "../db/database.js";
import { updateMotionProspect } from "./record-prospect.js";

/**
 * @returns {Array<{ prospectId: string, name: string, motionId: string }>} the prospects that were set to 1st-degree
 */
export function reconcileConnectionDegreesFromAccepts() {
  const accepts = listInboundObservations().filter(
    (observation) =>
      observation.kind === "connection_request_accepted" &&
      observation.prospectId &&
      observation.motionId &&
      observation.companyId,
  );

  const updated = [];
  for (const observation of accepts) {
    // Re-read each iteration so sequential updates to the same motion compound.
    const rawMotion = findMotionById(observation.motionId);
    const rawCompany = findCompanyById(observation.companyId);
    if (!rawMotion || !rawCompany) continue;

    const account = (rawMotion.targetMap?.accounts ?? []).find((a) => a.companyId === observation.companyId);
    const prospect = (account?.prospects ?? []).find((p) => p.id === observation.prospectId);
    if (!prospect) continue;
    if (prospect.linkedinProfileSnapshot?.connectionDegree === 1) continue; // already reconciled

    const next = updateMotionProspect(rawMotion, rawCompany, {
      prospectId: observation.prospectId,
      linkedinProfileSnapshot: { connectionDegree: 1 },
    });
    if (next) {
      updated.push({ prospectId: observation.prospectId, name: prospect.name, motionId: observation.motionId });
    }
  }

  return updated;
}
