// @ts-check

import crypto from "node:crypto";
import { touchSchema } from "../schema/target-account.js";
import { appendActivityEvent, findMotionById, findProspectById, updateProspectCadence } from "../db/database.js";
import { prepareTargetAccountContext } from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   prospectId: string,
 *   surface: import("../schema/target-account.js").touchSchema._type["surface"],
 *   direction: import("../schema/target-account.js").touchSchema._type["direction"],
 *   outcome: import("../schema/target-account.js").touchSchema._type["outcome"],
 *   occurredAt: string,
 *   summary: string,
 *   subject?: string | null | undefined,
 *   body?: string | null | undefined,
 *   sourceUrl?: string | null | undefined,
 *   notes?: string | null | undefined
 * }} input
 */
export function recordMotionProspectTouch(rawMotion, rawCompany, input) {
  const { motion, company, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const index = baseAccount.prospects.findIndex((prospect) => prospect.id === input.prospectId);

  if (index === -1) {
    throw new Error(`Prospect not found on ${company.name}: ${input.prospectId}`);
  }
  const prospect = baseAccount.prospects[index];
  const rowProspect = findProspectById(input.prospectId);
  if (!rowProspect) {
    throw new Error(`Prospect row not found: ${input.prospectId}`);
  }

  const touch = touchSchema.parse({
    id: crypto.randomUUID(),
    surface: input.surface,
    direction: input.direction,
    outcome: input.outcome,
    occurredAt: input.occurredAt,
    summary: input.summary,
    subject: input.subject ?? null,
    body: input.body ?? null,
    sourceUrl: input.sourceUrl ?? null,
    notes: input.notes ?? null
  });

  appendActivityEvent({
    id: touch.id,
    dedupeKey: `touch:${motion.id}:${rowProspect.id}:${touch.id}`,
    kind: "touch",
    personId: rowProspect.personId,
    prospectId: rowProspect.id,
    motionId: motion.id,
    companyId: company.id,
    surface: touch.surface,
    direction: touch.direction,
    outcome: touch.outcome,
    occurredAt: touch.occurredAt,
    payload: touch,
  });

  const shouldRefreshLastTouch = !prospect.cadenceState.lastTouchAt || prospect.cadenceState.lastTouchAt <= touch.occurredAt;
  if (shouldRefreshLastTouch) {
    updateProspectCadence(rowProspect.id, {
      lastTouchChannel: deriveCadenceChannel(touch.surface),
      lastTouchOutcome: touch.outcome,
      lastTouchAt: touch.occurredAt,
    });
  }

  return findMotionById(motion.id) ?? motion;
}

/**
 * @param {import("../schema/target-account.js").touchSchema._type["surface"]} surface
 */
function deriveCadenceChannel(surface) {
  if (surface === "email") {
    return "email";
  }

  if (surface === "connection_request") {
    return "connection-request";
  }

  if (surface === "in_mail_message") {
    return "inmail";
  }

  if (surface === "post_accept_message" || surface === "follow_up_direct_message" || surface === "inbound_reply") {
    return "direct-message";
  }

  return null;
}
