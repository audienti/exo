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
import { prospectSchema, targetAccountSchema } from "../schema/target-account.js";

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{ prospectId: string, kind?: "note"|"steer", body: string, author?: string|null }} input
 * @returns {{ motion: any, note: { id: string, kind: "note"|"steer", body: string, author: string|null, createdAt: string } }}
 */
export function addMotionProspectTimelineNote(rawMotion, rawCompany, input) {
  const { motion, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const index = baseAccount.prospects.findIndex((prospect) => prospect.id === input.prospectId);
  if (index === -1) {
    throw new Error(`Prospect not found: ${input.prospectId}`);
  }

  const note = {
    id: crypto.randomUUID(),
    kind: input.kind === "steer" ? "steer" : "note",
    body: input.body,
    author: input.author ?? null,
    createdAt: now,
  };

  const prospects = baseAccount.prospects.map((prospect, i) =>
    i === index
      ? prospectSchema.parse({ ...prospect, timelineNotes: [...(prospect.timelineNotes ?? []), note] })
      : prospect,
  );
  const updatedAccount = targetAccountSchema.parse({ ...baseAccount, prospects });
  const exists = accounts.some((account) => account.companyId === updatedAccount.companyId);
  const nextAccounts = exists
    ? accounts.map((account) => (account.companyId === updatedAccount.companyId ? updatedAccount : account))
    : [...accounts, updatedAccount];

  return {
    motion: { ...motion, targetMap: { ...motion.targetMap, accounts: nextAccounts }, updatedAt: now },
    note,
  };
}
