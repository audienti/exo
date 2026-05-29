// @ts-check

import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { rehydrateTargetAccount, targetAccountSchema } from "../schema/target-account.js";
import { rehydrateMotion } from "./rehydrate-motion.js";
import { withDerivedTargetAccountQueueState } from "../lib/motion-queue.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 */
export function prepareTargetAccountContext(rawMotion, rawCompany) {
  const { motion } = rehydrateMotion(rawMotion);
  const company = companySchema.parse(rawCompany);
  const now = new Date().toISOString();
  const accounts = motion.targetMap.accounts.map((account) => rehydrateTargetAccount(account));
  const existingAccount = accounts.find((account) => account.companyId === company.id);
  const baseAccount = existingAccount ?? buildTargetAccount(company);

  return {
    motion,
    company,
    now,
    accounts,
    baseAccount
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/target-account.js").targetAccountSchema._type[]} accounts
 * @param {import("../schema/target-account.js").targetAccountSchema._type} updatedAccount
 * @param {string} now
 */
export function finalizeTargetAccountUpdate(motion, accounts, updatedAccount, now) {
  const normalizedAccount = rehydrateTargetAccount(withDerivedTargetAccountQueueState(updatedAccount, now));
  const updatedAccounts = upsertTargetAccount(accounts, normalizedAccount);

  return motionSchema.parse({
    ...motion,
    updatedAt: now,
    targetMap: {
      ...motion.targetMap,
      status: updatedAccounts.length ? "ready" : motion.targetMap.status,
      accounts: updatedAccounts
    }
  });
}

/**
 * @param {import("../schema/company.js").companySchema._type} company
 */
export function buildTargetAccount(company) {
  return targetAccountSchema.parse(withDerivedTargetAccountQueueState({
    companyId: company.id,
    companyName: company.name,
    domain: company.domain,
    websiteUrl: company.websiteUrl,
    linkedinCompanyUrl: company.linkedinCompanyUrl,
    signalMatches: [],
    prospects: [],
    queueState: {},
    lastResearchAt: null,
    notes: null
  }));
}

/**
 * @param {import("../schema/target-account.js").targetAccountSchema._type[]} accounts
 * @param {import("../schema/target-account.js").targetAccountSchema._type} updatedAccount
 */
export function upsertTargetAccount(accounts, updatedAccount) {
  const index = accounts.findIndex((account) => account.companyId === updatedAccount.companyId);
  if (index === -1) {
    return [...accounts, updatedAccount];
  }

  return accounts.map((account, accountIndex) => accountIndex === index ? updatedAccount : account);
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string[] | null | undefined} values
 * @returns {string[]}
 */
export function normalizeStringArray(values) {
  if (!values) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
