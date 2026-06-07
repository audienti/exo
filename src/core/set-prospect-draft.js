// @ts-check
//
// Message draft loop for a prospect.
//
//   agent writes  → setMotionProspectDraft   (status: ready | queued)
//   operator edits/approves in the panel → approveMotionProspectDraft (status: approved)
//   agent sends   → markMotionProspectDraftSent (status: sent) + records the touch separately
//
// One active draft per surface: writing again updates the same draft unless it
// was already sent (then a new one is started). Pure transforms — the caller
// persists the returned motion.

import crypto from "node:crypto";
import { prepareTargetAccountContext } from "./target-account-state.js";
import { prospectSchema, targetAccountSchema } from "../schema/target-account.js";
import { isSendableDraftStatus } from "../lib/draft-policy.js";

/** linkedin vs email by surface */
const SURFACE_CHANNEL = {
  connection_request: "linkedin",
  post_accept_message: "linkedin",
  follow_up_direct_message: "linkedin",
  inbound_reply: "linkedin",
  public_comment: "linkedin",
  comment_reply: "linkedin",
  in_mail_message: "linkedin",
  email: "email",
};

/** surfaces that carry a subject line */
const SURFACE_HAS_SUBJECT = new Set(["email", "in_mail_message"]);

/**
 * Agent (or operator) writes a draft for one surface.
 *
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{ prospectId: string, surface: string, body: string, subject?: string|null, status?: string, authoredBy?: "agent"|"operator", notes?: string|null }} input
 */
export function setMotionProspectDraft(rawMotion, rawCompany, input) {
  return mutateDraft(rawMotion, rawCompany, input.prospectId, (drafts, now) => {
    const channel = SURFACE_CHANNEL[input.surface] ?? "linkedin";
    const subject = SURFACE_HAS_SUBJECT.has(input.surface) ? (input.subject ?? null) : null;
    const status = input.status ?? "ready";
    const sendReadyAt = isSendableDraftStatus(status) ? now : null;
    const existing = drafts.find((draft) => draft.surface === input.surface && draft.status !== "sent" && draft.status !== "discarded");
    if (existing) {
      return drafts.map((draft) =>
        draft === existing
          ? {
              ...draft,
              channel,
              subject,
              body: input.body,
              status,
              authoredBy: input.authoredBy ?? draft.authoredBy ?? "agent",
              notes: input.notes ?? draft.notes ?? null,
              approvedAt: sendReadyAt,
              updatedAt: now,
            }
          : draft,
      );
    }
    return [
      ...drafts,
      {
        id: crypto.randomUUID(),
        surface: input.surface,
        channel,
        subject,
        body: input.body,
        status,
        authoredBy: input.authoredBy ?? "agent",
        editedByOperator: false,
        approvedByOperator: false,
        createdAt: now,
        updatedAt: now,
        approvedAt: sendReadyAt,
        sentAt: null,
        notes: input.notes ?? null,
      },
    ];
  });
}

/**
 * Operator approves a draft from the compose panel — applies the (possibly
 * edited) text and queues it for the agent to send.
 *
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{ prospectId: string, surface: string, body: string, subject?: string|null, authoredBy?: "agent"|"operator" }} input
 */
export function approveMotionProspectDraft(rawMotion, rawCompany, input) {
  return mutateDraft(rawMotion, rawCompany, input.prospectId, (drafts, now) => {
    const channel = SURFACE_CHANNEL[input.surface] ?? "linkedin";
    const subject = SURFACE_HAS_SUBJECT.has(input.surface) ? (input.subject ?? null) : null;
    const existing = drafts.find((draft) => draft.surface === input.surface && draft.status !== "sent" && draft.status !== "discarded");
    if (existing) {
      return drafts.map((draft) =>
        draft === existing
          ? {
              ...draft,
              channel,
              subject,
              body: input.body,
              status: "approved",
              editedByOperator: draft.editedByOperator || existing.body !== input.body || (existing.subject ?? null) !== subject,
              approvedByOperator: true,
              approvedAt: now,
              updatedAt: now,
            }
          : draft,
      );
    }
    // Approving with no prior draft creates one straight to approved. Authorship
    // is whoever actually wrote the text (the caller declares it) — NOT "whoever
    // approved it". Approval itself is still an operator-controlled send signal.
    const authoredBy = input.authoredBy === "agent" ? "agent" : input.authoredBy === "operator" ? "operator" : "operator";
    return [
      ...drafts,
      {
        id: crypto.randomUUID(),
        surface: input.surface,
        channel,
        subject,
        body: input.body,
        status: "approved",
        authoredBy,
        editedByOperator: authoredBy === "operator",
        approvedByOperator: true,
        createdAt: now,
        updatedAt: now,
        approvedAt: now,
        sentAt: null,
        notes: null,
      },
    ];
  });
}

/**
 * Agent marks a send-ready draft as sent (after the real send).
 *
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{ prospectId: string, surface: string }} input
 */
export function markMotionProspectDraftSent(rawMotion, rawCompany, input) {
  return mutateDraft(rawMotion, rawCompany, input.prospectId, (drafts, now) =>
    drafts.map((draft) =>
      draft.surface === input.surface && isSendableDraftStatus(draft.status)
        ? { ...draft, status: "sent", sentAt: now, updatedAt: now }
        : draft,
    ),
  );
}

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {string} prospectId
 * @param {(drafts: any[], now: string) => any[]} transform
 */
function mutateDraft(rawMotion, rawCompany, prospectId, transform) {
  const { motion, now, accounts, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const index = baseAccount.prospects.findIndex((prospect) => prospect.id === prospectId);
  if (index === -1) {
    throw new Error(`Prospect not found: ${prospectId}`);
  }

  const prospects = baseAccount.prospects.map((prospect, i) =>
    i === index
      ? prospectSchema.parse({ ...prospect, drafts: transform(prospect.drafts ?? [], now) })
      : prospect,
  );
  const updatedAccount = targetAccountSchema.parse({ ...baseAccount, prospects });
  const exists = accounts.some((account) => account.companyId === updatedAccount.companyId);
  const nextAccounts = exists
    ? accounts.map((account) => (account.companyId === updatedAccount.companyId ? updatedAccount : account))
    : [...accounts, updatedAccount];

  return {
    ...motion,
    targetMap: { ...motion.targetMap, accounts: nextAccounts },
    updatedAt: now,
  };
}
