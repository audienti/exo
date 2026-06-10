// @ts-check
//
// Append an operator-authored timeline entry to a prospect.
//
//   note  — context/observation the operator wants on the record
//   steer — a directive for the agent (what to do or avoid on the next action)
//
// Both are timestamped entries that render in the engagement timeline. Pure
// transform — the caller persists the returned motion.

import crypto from "node:crypto";
import { prepareTargetAccountContext } from "./target-account-state.js";
import {
  appendActivityEvent,
  findMotionById,
  findProspectById,
} from "../db/database.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{ prospectId: string, kind?: "note"|"steer"|"system", body: string, author?: string|null }} input
 * @returns {{ motion: any, note: { id: string, kind: "note"|"steer"|"system", body: string, author: string|null, createdAt: string } }}
 */
export function addMotionProspectTimelineNote(rawMotion, rawCompany, input) {
  const { motion, company, now, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const index = baseAccount.prospects.findIndex((prospect) => prospect.id === input.prospectId);
  if (index === -1) {
    throw new Error(`Prospect not found: ${input.prospectId}`);
  }
  const rowProspect = findProspectById(input.prospectId);
  if (!rowProspect) {
    throw new Error(`Prospect row not found: ${input.prospectId}`);
  }

  const note = {
    id: crypto.randomUUID(),
    kind: input.kind === "steer" ? "steer" : input.kind === "system" ? "system" : "note",
    body: input.body,
    author: input.author ?? null,
    createdAt: now,
  };

  appendActivityEvent({
    id: note.id,
    dedupeKey: `timeline-note:${motion.id}:${rowProspect.id}:${note.id}`,
    kind: "timeline_note",
    personId: rowProspect.personId,
    prospectId: rowProspect.id,
    motionId: motion.id,
    companyId: company.id,
    surface: null,
    direction: "system",
    outcome: null,
    occurredAt: note.createdAt,
    payload: note,
  });

  return {
    motion: findMotionById(motion.id) ?? motion,
    note,
  };
}
