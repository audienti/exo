// @ts-check

import crypto from "node:crypto";
import { prospectSchema, targetAccountSchema, touchSchema } from "../schema/target-account.js";
import {
  finalizeTargetAccountUpdate,
  prepareTargetAccountContext
} from "./target-account-state.js";

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
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const index = baseAccount.prospects.findIndex((prospect) => prospect.id === input.prospectId);

  if (index === -1) {
    throw new Error(`Prospect not found on ${company.name}: ${input.prospectId}`);
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

  const prospects = baseAccount.prospects.map((prospect, prospectIndex) => {
    if (prospectIndex !== index) {
      return prospect;
    }

    const touches = [...prospect.touches, touch].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const shouldRefreshLastTouch = !prospect.cadenceState.lastTouchAt || prospect.cadenceState.lastTouchAt <= touch.occurredAt;

    return prospectSchema.parse({
      ...prospect,
      touches,
      cadenceState: {
        ...prospect.cadenceState,
        lastTouchChannel: shouldRefreshLastTouch ? deriveCadenceChannel(touch.surface) : prospect.cadenceState.lastTouchChannel,
        lastTouchOutcome: shouldRefreshLastTouch ? touch.outcome : prospect.cadenceState.lastTouchOutcome,
        lastTouchAt: shouldRefreshLastTouch ? touch.occurredAt : prospect.cadenceState.lastTouchAt,
        updatedAt: now
      }
    });
  });

  const updatedAccount = targetAccountSchema.parse({
    ...baseAccount,
    companyName: company.name,
    domain: company.domain,
    websiteUrl: company.websiteUrl,
    linkedinCompanyUrl: company.linkedinCompanyUrl,
    lastResearchAt: now,
    prospects
  });

  return finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
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

  if (surface === "post_accept_message" || surface === "follow_up_direct_message" || surface === "inbound_reply") {
    return "direct-message";
  }

  return null;
}
