// @ts-check

import { buildCompanyExecutionView } from "./build-company-execution-view.js";
import { buildLinkedinSendHandoff } from "./build-linkedin-send.js";
import { extractUsableDraftBody, isAutonomousSendReadyDraft } from "../lib/draft-policy.js";

const EMAIL_ACTION = "send_email";
const AUTONOMOUS_LINKEDIN_PUBLIC_SURFACES = new Set(["like_post", "create_comment_reaction"]);

/**
 * Build the governed send contract for whichever channel owns the current
 * send-ready draft surface.
 *
 * @param {any} rawCompany
 * @param {any} rawMotion
 * @param {any[]} rawProfiles
 * @param {any[]} rawUsers
 * @param {{ prospectId: string, surface?: string|null, runtime?: string|null, branches?: Array<{ motion: any, account: any, prospect: any }>, now?: string | null }} input
 */
export function buildSendHandoff(rawCompany, rawMotion, rawProfiles, rawUsers, input) {
  if (AUTONOMOUS_LINKEDIN_PUBLIC_SURFACES.has(String(input.surface ?? ""))) {
    return buildLinkedinSendHandoff(rawCompany, rawMotion, rawProfiles, rawUsers, input);
  }
  const context = resolveSendDraftContext(rawCompany, rawMotion, input);
  const channel = resolveDraftChannel(context.draft);
  if (channel === "email") {
    return buildEmailSendHandoff(rawCompany, rawMotion, rawProfiles, rawUsers, {
      ...context,
      runtime: input.runtime ?? null,
    });
  }
  return buildLinkedinSendHandoff(rawCompany, rawMotion, rawProfiles, rawUsers, {
    ...input,
    surface: context.draft.surface,
  });
}

/**
 * @param {any} rawCompany
 * @param {any} rawMotion
 * @param {{ prospectId: string, surface?: string|null }} input
 */
function resolveSendDraftContext(rawCompany, rawMotion, input) {
  const company = rawCompany;
  const motion = rawMotion;
  const account = (motion.targetMap?.accounts ?? []).find((item) => item.companyId === company.id);
  const prospect = (account?.prospects ?? []).find((item) => item.id === input.prospectId);
  if (!prospect) throw new Error(`Prospect ${input.prospectId} is not targeted on ${company.name}.`);

  const sendReady = (prospect.drafts ?? []).filter(
    (draft) => isAutonomousSendReadyDraft(draft) && (!input.surface || draft.surface === input.surface),
  );
  if (!sendReady.length) {
    throw new Error("No send-ready draft to send for this prospect" + (input.surface ? ` on surface ${input.surface}.` : "."));
  }
  if (sendReady.length > 1) throw new Error("Multiple send-ready drafts — pass a surface to choose one.");

  return {
    company,
    motion,
    prospect,
    draft: sendReady[0],
  };
}

/**
 * @param {any} rawCompany
 * @param {any} rawMotion
 * @param {any[]} rawProfiles
 * @param {any[]} rawUsers
 * @param {{
 *   company: any,
 *   motion: any,
 *   prospect: any,
 *   draft: any,
 *   runtime?: string | null,
 * }} context
 */
function buildEmailSendHandoff(rawCompany, rawMotion, rawProfiles, rawUsers, context) {
  const { company, motion, prospect, draft } = context;
  const normalizedSubject = normalizeNonEmptyString(draft.subject);
  const normalizedMessage = extractUsableDraftBody(draft.body) ?? (typeof draft.body === "string" ? draft.body : "");
  const recipientEmail = resolveRecipientEmail(prospect);
  const threadUrl = resolveGmailThreadUrl(prospect);
  const writeback = `exo actions result --action ${EMAIL_ACTION} --result sent --company ${company.id} --prospect ${prospect.id} --motion ${motion.id} --surface ${draft.surface}`;

  const blocked = (reason) => ({
    status: "blocked",
    action: EMAIL_ACTION,
    prospectName: prospect.name,
    reason,
    channel: "email",
    surface: draft.surface,
    writeback: null,
  });

  if (!recipientEmail) return blocked(`${prospect.name} has no email address to message.`);
  if (!normalizedSubject) return blocked(`${prospect.name} has no sendable email subject.`);
  if (!normalizedMessage.trim().length) return blocked(`${prospect.name} has no sendable email draft body.`);

  const execution = buildCompanyExecutionView(rawCompany, null, rawProfiles, {
    capability: "gmail",
    rawMotion,
    rawUsers,
  });
  const transport = execution.transport ?? {};
  if (transport.status === "blocked") {
    return blocked(transport.blocker ?? transport.reason ?? "No governed Gmail execution path — assign a user/account to this company first.");
  }

  if (execution.resolvedAccount?.sourceType !== "harness-connection" || !execution.resolvedAccount?.harnessConnection) {
    return blocked("No governed Gmail connector path is ready for this company. Autonomous email send requires a managed gmail connector.");
  }

  const identity = execution.assignments?.user ?? null;
  const connector = transport.preferredTransport?.tool
    ?? `${execution.resolvedAccount.harnessConnection.runtime}:${execution.resolvedAccount.harnessConnection.connector}`;

  return {
    status: "ready",
    action: EMAIL_ACTION,
    runtime: normalizeRuntime(context.runtime),
    supportedRuntimes: ["codex", "claude"],
    connector,
    executionPolicy: {
      mode: "native_connector_tools_only",
      shellFallbackAllowed: false,
      disallowedFallbacks: ["shell_subprocess", "browser_session", "another_email_identity", "paraphrasing_the_message"],
      pinnedIdentity: identity ? { label: identity.label, accountRefs: identity.accountRefs } : null,
      pinnedBrowserProfile: null,
      writeBackOnlyAfterRealSend: true,
    },
    motionId: motion.id,
    motionName: motion.name,
    sender: identity
      ? { userId: identity.userId, label: identity.label, owner: identity.owner, accountRefs: identity.accountRefs }
      : null,
    browserProfile: null,
    recipient: {
      name: prospect.name,
      email: recipientEmail,
      threadUrl,
    },
    channel: "email",
    surface: draft.surface,
    subject: normalizedSubject,
    message: normalizedMessage,
    instructions: [
      `Send as the assigned identity ${identity?.label ?? "(assigned connector)"} through the governed ${connector} connector only — do not drift to another inbox or another transport.`,
      threadUrl
        ? `Reply in the existing Gmail thread at ${threadUrl} using the exact stored subject and body below.`
        : `Send a new email to ${recipientEmail} using the exact stored subject and body below.`,
      `Use native ${connectorLabel(connector)} tools only. Do not use Chrome/browser tools, shell fallbacks, or paraphrase the stored copy.`,
      `ONLY after it is actually sent, run the write-back: ${writeback}`,
    ],
    writeback,
  };
}

/** @param {any} draft */
function resolveDraftChannel(draft) {
  if (normalizeNonEmptyString(draft?.channel) === "email") return "email";
  return draft?.surface === "email" ? "email" : "linkedin";
}

/** @param {any} prospect */
function resolveRecipientEmail(prospect) {
  const topLevel = normalizeNonEmptyString(prospect?.email);
  if (topLevel) return topLevel;
  const contactPoint = (prospect?.contactPoints ?? []).find(
    (point) => point?.kind === "email" && normalizeNonEmptyString(point?.value),
  );
  return normalizeNonEmptyString(contactPoint?.value);
}

/** @param {any} prospect */
function resolveGmailThreadUrl(prospect) {
  const candidates = [
    prospect?.sourceUrl,
    ...((prospect?.contactPoints ?? []).map((point) => point?.sourceUrl)),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeNonEmptyString(candidate);
    if (normalized && /mail\.google\.com/i.test(normalized)) {
      return normalized;
    }
  }
  return null;
}

/** @param {string|null|undefined} runtime */
function normalizeRuntime(runtime) {
  const value = String(runtime ?? "").trim().toLowerCase();
  return value === "codex" || value === "claude" ? value : "any";
}

/** @param {unknown} value */
function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

/** @param {string} connector */
function connectorLabel(connector) {
  const normalized = normalizeNonEmptyString(connector) ?? "connector";
  const parts = normalized.split(":").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}
