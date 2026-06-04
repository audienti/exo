// @ts-check

import { motionSchema } from "../schema/motion.js";
import { buildNextSteps, buildSignals } from "./motion-support.js";
import { rehydrateMotion } from "./rehydrate-motion.js";

/**
 * @param {unknown} rawMotion
 * @param {{ signal: unknown }} input
 */
export function addMotionSignals(rawMotion, input) {
  const { motion } = rehydrateMotion(rawMotion);
  const entries = normalizeSignalEntries(input.signal);
  if (!entries.length) {
    throw new Error("Add signal questions requires at least one question.");
  }

  const seenIds = new Set(motion.signals.map((signal) => signal.id));
  const addedSignals = [];
  for (const signal of buildSignals(entries)) {
    if (seenIds.has(signal.id)) continue;
    seenIds.add(signal.id);
    addedSignals.push(signal);
  }

  if (!addedSignals.length) {
    throw new Error("All provided signal questions already exist on this motion.");
  }

  return {
    motion: rebuildMotion(motion, {
      signals: [...motion.signals, ...addedSignals],
      targetAccounts: motion.targetMap.accounts,
    }),
    addedSignals,
  };
}

/**
 * @param {unknown} rawMotion
 * @param {{ signalId: unknown }} input
 */
export function removeMotionSignal(rawMotion, input) {
  const { motion } = rehydrateMotion(rawMotion);
  const signalId = String(input.signalId ?? "").trim();
  if (!signalId) {
    throw new Error("removeMotionSignal requires signalId.");
  }

  const removedSignal = motion.signals.find((signal) => signal.id === signalId);
  if (!removedSignal) {
    throw new Error(`Signal not found on motion ${motion.id}: ${signalId}`);
  }

  const nextSignals = motion.signals.filter((signal) => signal.id !== signalId);
  const nextAccounts = motion.targetMap.accounts.map((account) => pruneSignalFromAccount(account, signalId));

  return {
    motion: rebuildMotion(motion, {
      signals: nextSignals,
      targetAccounts: nextAccounts,
    }),
    removedSignal,
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {{ signals: import("../schema/signal.js").signalSchema._type[], targetAccounts: import("../schema/target-account.js").targetAccountSchema._type[] }} next
 */
function rebuildMotion(motion, next) {
  return motionSchema.parse({
    ...motion,
    updatedAt: new Date().toISOString(),
    signals: next.signals,
    targetMap: {
      ...motion.targetMap,
      accounts: next.targetAccounts,
    },
    nextSteps: buildNextSteps(
      motion.targetingProfile,
      motion.suppressionPolicy,
      motion.premise,
      motion.audienceHypotheses,
      next.signals,
      summarizeReadiness(next.targetAccounts),
    ),
  });
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type} account
 * @param {string} signalId
 */
function pruneSignalFromAccount(account, signalId) {
  const removedMatchIds = new Set(
    account.signalMatches
      .filter((match) => match.signalId === signalId)
      .map((match) => match.id),
  );

  if (!removedMatchIds.size) {
    return account;
  }

  return {
    ...account,
    signalMatches: account.signalMatches.filter((match) => match.signalId !== signalId),
    prospects: account.prospects.map((prospect) => ({
      ...prospect,
      signalMatchIds: prospect.signalMatchIds.filter((matchId) => !removedMatchIds.has(matchId)),
    })),
  };
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type[]} targetAccounts
 */
function summarizeReadiness(targetAccounts) {
  const prospects = targetAccounts.flatMap((account) => account.prospects);
  return {
    accountCount: targetAccounts.length,
    hasSignalMatches: targetAccounts.some((account) => account.signalMatches.length > 0),
    prospectCount: prospects.length,
    readyCadenceCount: prospects.filter((prospect) => prospect.cadenceState.status === "ready").length,
    missingEmailFallbackCount: prospects.filter((prospect) => !prospect.email).length,
  };
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeSignalEntries(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
