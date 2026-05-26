// @ts-check

import crypto from "node:crypto";
import { motionSchema } from "../schema/motion.js";
import { signalMatchSchema, targetAccountSchema } from "../schema/target-account.js";
import {
  finalizeTargetAccountUpdate,
  normalizeNullableString,
  prepareTargetAccountContext
} from "./target-account-state.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{
 *   signalId: string,
 *   summary: string,
 *   sourceUrl?: string | null,
 *   sourceLabel?: string | null,
 *   observedAt?: string | null,
 *   confidence?: "low" | "moderate" | "high" | "unknown",
 *   evidenceSnippet?: string | null,
 *   notes?: string | null,
 *   personName?: string | null,
 *   personTitle?: string | null
 * }} input
 */
export function recordMotionSignalMatch(rawMotion, rawCompany, input) {
  const { motion, company, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const signal = motion.signals.find((item) => item.id === input.signalId);

  if (!signal) {
    throw new Error(`Signal not found on motion ${motion.id}: ${input.signalId}`);
  }

  const subject = buildSubject(signal.scope, input.personName, input.personTitle);
  const nextMatch = signalMatchSchema.parse({
    id: crypto.randomUUID(),
    signalId: signal.id,
    signalName: signal.name,
    signalScope: signal.scope,
    summary: input.summary,
    sourceUrl: normalizeNullableString(input.sourceUrl),
    sourceLabel: normalizeNullableString(input.sourceLabel),
    observedAt: normalizeNullableString(input.observedAt),
    recordedAt: now,
    confidence: input.confidence ?? "unknown",
    evidenceSnippet: normalizeNullableString(input.evidenceSnippet),
    notes: normalizeNullableString(input.notes),
    subject
  });

  const signalMatches = upsertSignalMatch(baseAccount.signalMatches, nextMatch);
  const updatedAccount = targetAccountSchema.parse({
    ...baseAccount,
    companyName: company.name,
    domain: company.domain,
    websiteUrl: company.websiteUrl,
    linkedinCompanyUrl: company.linkedinCompanyUrl,
    lastResearchAt: now,
    signalMatches
  });
  return finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now);
}

/**
 * @param {import("../schema/target-account.js").signalMatchSchema._type[]} matches
 * @param {import("../schema/target-account.js").signalMatchSchema._type} nextMatch
 */
function upsertSignalMatch(matches, nextMatch) {
  const index = matches.findIndex((match) => matchesReferToSameObservation(match, nextMatch));
  if (index === -1) {
    return [...matches, nextMatch];
  }

  const existing = matches[index];
  return matches.map((match, matchIndex) => {
    if (matchIndex !== index) {
      return match;
    }

    return signalMatchSchema.parse({
      ...nextMatch,
      id: existing.id,
      recordedAt: nextMatch.recordedAt
    });
  });
}

/**
 * @param {"company" | "person" | "both"} signalScope
 * @param {string | null | undefined} personName
 * @param {string | null | undefined} personTitle
 */
function buildSubject(signalScope, personName, personTitle) {
  const normalizedPersonName = normalizeNullableString(personName);
  const normalizedPersonTitle = normalizeNullableString(personTitle);

  if (normalizedPersonName || normalizedPersonTitle) {
    if (signalScope === "company") {
      throw new Error("Company-scoped signal matches cannot carry --person-name or --person-title.");
    }

    return {
      type: "person",
      personName: normalizedPersonName,
      personTitle: normalizedPersonTitle
    };
  }

  if (signalScope === "person") {
    throw new Error("Person-scoped signal matches require --person-name or --person-title.");
  }

  return {
    type: "company",
    personName: null,
    personTitle: null
  };
}

/**
 * @param {import("../schema/target-account.js").signalMatchSchema._type} left
 * @param {import("../schema/target-account.js").signalMatchSchema._type} right
 */
function matchesReferToSameObservation(left, right) {
  return (
    left.signalId === right.signalId &&
    left.subject.type === right.subject.type &&
    left.subject.personName === right.subject.personName &&
    left.subject.personTitle === right.subject.personTitle &&
    left.sourceUrl === right.sourceUrl
  );
}
