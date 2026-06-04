// @ts-check
//
// Re-home a prospect from the catch-all transition motion into a real motion,
// carrying their full state (cadence, touches, drafts) and relinking their
// inbound observations. Removes them from the source motion.
//
// Pure transform — returns the updated source motion, target motion, linked
// company, and relinked observations for the caller to persist.

import { linkCompanyToMotion } from "./link-company-to-motion.js";
import { buildTargetAccount } from "./target-account-state.js";
import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";

/**
 * @param {{
 *   rawFromMotion: unknown,
 *   rawToMotion: unknown,
 *   rawCompanies: unknown[],
 *   prospectId: string,
 *   relatedObservations?: any[],
 *   now?: string,
 * }} input
 */
export function rehomeProspect(input) {
  const now = input.now ?? new Date().toISOString();
  const fromMotion = motionSchema.parse(input.rawFromMotion);
  const toMotion = motionSchema.parse(input.rawToMotion);
  if (fromMotion.id === toMotion.id) {
    throw new Error("Cannot re-home a prospect into the same motion.");
  }

  // Locate the prospect + its account in the source motion.
  let sourceAccount = null;
  let prospect = null;
  for (const account of fromMotion.targetMap.accounts) {
    const found = account.prospects.find((candidate) => candidate.id === input.prospectId);
    if (found) {
      sourceAccount = account;
      prospect = found;
      break;
    }
  }
  if (!prospect || !sourceAccount) {
    throw new Error(`Prospect not found in source motion: ${input.prospectId}`);
  }

  // Resolve + link the company to the target motion.
  const companies = (input.rawCompanies ?? []).map((raw) => companySchema.parse(raw));
  const rawCompany = companies.find((candidate) => candidate.id === sourceAccount.companyId);
  if (!rawCompany) {
    throw new Error(`Company not found: ${sourceAccount.companyId}`);
  }
  const company = linkCompanyToMotion(rawCompany, toMotion.id);

  // Add the prospect (full state) to the target motion's account for this company.
  const targetAccounts = toMotion.targetMap.accounts.slice();
  let targetIndex = targetAccounts.findIndex((account) => account.companyId === company.id);
  if (targetIndex === -1) {
    targetAccounts.push(buildTargetAccount(company));
    targetIndex = targetAccounts.length - 1;
  }
  const alreadyThere = targetAccounts[targetIndex].prospects.some((candidate) => candidate.id === prospect.id);
  targetAccounts[targetIndex] = {
    ...targetAccounts[targetIndex],
    prospects: alreadyThere
      ? targetAccounts[targetIndex].prospects
      : [...targetAccounts[targetIndex].prospects, prospect],
    lastResearchAt: now,
  };
  const updatedToMotion = motionSchema.parse({
    ...toMotion,
    targetMap: { ...toMotion.targetMap, accounts: targetAccounts },
    updatedAt: now,
  });

  // Remove the prospect from the source motion's account.
  const updatedFromMotion = motionSchema.parse({
    ...fromMotion,
    targetMap: {
      ...fromMotion.targetMap,
      accounts: fromMotion.targetMap.accounts.map((account) =>
        account.companyId === sourceAccount.companyId
          ? { ...account, prospects: account.prospects.filter((candidate) => candidate.id !== prospect.id) }
          : account,
      ),
    },
    updatedAt: now,
  });

  // Relink the person's observations to the target motion.
  const observations = (input.relatedObservations ?? []).map((observation) => ({
    ...observation,
    motionId: toMotion.id,
    companyId: company.id,
    prospectId: prospect.id,
    updatedAt: now,
  }));

  return {
    prospectId: prospect.id,
    prospectName: prospect.name,
    company,
    fromMotion: updatedFromMotion,
    toMotion: updatedToMotion,
    observations,
    message: `Re-homed ${prospect.name} from ${fromMotion.name} into ${toMotion.name}.`,
  };
}
