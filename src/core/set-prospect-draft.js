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
import {
  findActiveProspectDraftBySurface,
  findMotionById,
  findProspectById,
  transitionProspectDraftStatus,
  upsertProspectDraft,
} from "../db/database.js";
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
  const { motion } = writeProspectDraft(rawMotion, rawCompany, input, {
    defaultAuthoredBy: input.authoredBy ?? "agent",
  });
  return motion;
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
  const existing = findActiveProspectDraftBySurface(input.prospectId, input.surface);
  const subject = SURFACE_HAS_SUBJECT.has(input.surface) ? (input.subject ?? null) : null;
  // Approving with no prior draft creates one straight to approved. Authorship
  // is whoever actually wrote the text (the caller declares it) — NOT "whoever
  // approved it". Approval itself is still an operator-controlled send signal.
  const authoredBy = input.authoredBy === "agent" ? "agent" : input.authoredBy === "operator" ? "operator" : "operator";
  const { motion } = writeProspectDraft(rawMotion, rawCompany, {
    ...input,
    status: "approved",
    authoredBy,
    notes: null,
  }, {
    approvedByOperator: true,
    editedByOperator: Boolean(
      existing?.editedByOperator
      || (existing && (existing.body !== input.body || (existing.subject ?? null) !== subject))
      || (!existing && authoredBy === "operator")
    ),
  });
  return motion;
}

/**
 * Agent marks a send-ready draft as sent (after the real send).
 *
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{ prospectId: string, surface: string }} input
 */
export function markMotionProspectDraftSent(rawMotion, rawCompany, input) {
  const { motion, prospect } = loadDraftContext(rawMotion, rawCompany, input.prospectId);
  const existing = findActiveProspectDraftBySurface(prospect.id, input.surface);
  if (existing && isSendableDraftStatus(existing.status)) {
    transitionProspectDraftStatus(existing.id, { status: "sent" });
  }
  return findMotionById(motion.id) ?? motion;
}

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {{ prospectId: string, surface: string, body: string, subject?: string|null, status?: string, authoredBy?: "agent"|"operator", notes?: string|null }} input
 * @param {{ approvedByOperator?: boolean, editedByOperator?: boolean, defaultAuthoredBy?: "agent" | "operator" }} options
 */
function writeProspectDraft(rawMotion, rawCompany, input, options) {
  const { motion, prospect, rowProspect } = loadDraftContext(rawMotion, rawCompany, input.prospectId);
  const now = new Date().toISOString();
  const channel = SURFACE_CHANNEL[input.surface] ?? "linkedin";
  const subject = SURFACE_HAS_SUBJECT.has(input.surface) ? (input.subject ?? null) : null;
  const status = input.status ?? "ready";
  const sendReadyAt = isSendableDraftStatus(status) ? now : null;
  const existing = findActiveProspectDraftBySurface(rowProspect.id, input.surface);
  const id = existing?.id ?? crypto.randomUUID();
  const authoredBy = input.authoredBy ?? existing?.authoredBy ?? options.defaultAuthoredBy ?? "agent";
  const editedByOperator = options.editedByOperator ?? existing?.editedByOperator ?? false;
  const approvedByOperator = options.approvedByOperator ?? existing?.approvedByOperator ?? false;

  upsertProspectDraft({
    id,
    prospectId: rowProspect.id,
    motionId: motion.id,
    personId: rowProspect.personId,
    surface: input.surface,
    channel,
    status,
    authoredBy,
    subject,
    body: input.body,
    editedByOperator,
    approvedByOperator,
    approvedAt: sendReadyAt,
    sentAt: existing?.sentAt ?? null,
    payload: {
      ...(existing ?? {}),
      id,
      surface: input.surface,
      channel,
      subject,
      body: input.body,
      status,
      authoredBy,
      editedByOperator,
      approvedByOperator,
      approvedAt: sendReadyAt,
      sentAt: existing?.sentAt ?? null,
      notes: input.notes ?? existing?.notes ?? null,
    },
    now,
  });

  return {
    motion: findMotionById(motion.id) ?? motion,
    prospect,
  };
}

/**
 * @param {unknown} rawMotion
 * @param {unknown} rawCompany
 * @param {string} prospectId
 */
function loadDraftContext(rawMotion, rawCompany, prospectId) {
  const { motion, baseAccount } = prepareTargetAccountContext(rawMotion, rawCompany);
  const index = baseAccount.prospects.findIndex((prospect) => prospect.id === prospectId);
  if (index === -1) {
    throw new Error(`Prospect not found: ${prospectId}`);
  }
  const rowProspect = findProspectById(prospectId);
  if (!rowProspect) {
    throw new Error(`Prospect row not found: ${prospectId}`);
  }
  return {
    motion,
    prospect: baseAccount.prospects[index],
    rowProspect,
  };
}
