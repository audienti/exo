// @ts-check
//
// Outbound live-send executor — the outbound twin of the inbound live capture
// handoff. For a send-ready message it resolves WHICH governed connector path
// sends, and produces a connector-native execution contract the agent runtime
// fires. Exo never sends on its own: this builds the contract; the runtime
// performs the real send, then runs the write-back, which records the "Sent"
// touch, marks the draft sent, and parks cadence at "wait for a reply".

import { buildCompanyExecutionView } from "./build-company-execution-view.js";
import { extractUsableDraftBody, isAutonomousSendReadyDraft } from "../lib/draft-policy.js";
import { evaluateOutboundDispatchGate } from "./outbound-dispatch-gate.js";
import {
  buildLinkedinPublicEngagementPlan,
  latestReactiveCommentSourceUrl,
  normalizePublicEngagementSelection,
  selectLinkedinPublicEngagementTarget,
} from "./select-linkedin-public-engagement.js";

const DM_ACTION = "send_direct_message";
const CONNECT_ACTION = "send_connection_request";
const POST_COMMENT_ACTION = "create_post_comment";
const COMMENT_REPLY_ACTION = "create_comment_comment";
const POST_REACTION_ACTION = "like_post";
const COMMENT_REACTION_ACTION = "create_comment_reaction";
const AUTONOMOUS_PUBLIC_SURFACES = new Set(["like_post", "create_comment_reaction"]);

/**
 * @param {any} rawCompany
 * @param {any} rawMotion
 * @param {any[]} rawProfiles
 * @param {any[]} rawUsers
 * @param {{ prospectId: string, surface?: string|null, runtime?: string|null, branches?: Array<{ motion: any, account: any, prospect: any }>, now?: string | null }} input
 * @returns {Record<string, any>}
 */
export function buildLinkedinSendHandoff(rawCompany, rawMotion, rawProfiles, rawUsers, input) {
  const company = rawCompany;
  const motion = rawMotion;
  const account = (motion.targetMap?.accounts ?? []).find((a) => a.companyId === company.id);
  const prospect = (account?.prospects ?? []).find((p) => p.id === input.prospectId);
  if (!prospect) throw new Error(`Prospect ${input.prospectId} is not targeted on ${company.name}.`);

  const requestedSurface = normalizeNullableString(input.surface);
  const isAutonomousPublicSurface = AUTONOMOUS_PUBLIC_SURFACES.has(String(requestedSurface ?? ""));
  const sendReady = isAutonomousPublicSurface
    ? []
    : (prospect.drafts ?? []).filter(
        (d) => isAutonomousSendReadyDraft(d) && (!requestedSurface || d.surface === requestedSurface),
      );
  if (!isAutonomousPublicSurface && !sendReady.length) {
    throw new Error("No send-ready draft to send for this prospect" + (requestedSurface ? ` on surface ${requestedSurface}.` : "."));
  }
  if (!isAutonomousPublicSurface && sendReady.length > 1) throw new Error("Multiple send-ready drafts — pass a surface to choose one.");
  const draft = sendReady[0] ?? null;
  const surface = requestedSurface ?? draft?.surface ?? null;
  const normalizedMessage = draft
    ? (extractUsableDraftBody(draft.body) ?? (typeof draft.body === "string" ? draft.body : ""))
    : "";

  const action = resolveLinkedinActionForSurface(surface);
  if (!action || !surface) {
    throw new Error(`No governed LinkedIn action is mapped for surface ${input.surface ?? "unknown"}.`);
  }
  const writeback = `exo actions result --action ${action} --result sent --company ${company.id} --prospect ${prospect.id} --motion ${motion.id} --surface ${surface}`;
  const recipientUrl = prospect.linkedinProfileUrl ?? prospect.linkedinProfileSnapshot?.profileUrl ?? null;
  const publicTarget = resolveLinkedinPublicTarget(prospect, surface);
  const publicEngagementPlan = isAutonomousPublicSurface
    ? buildLinkedinPublicEngagementPlan(prospect, new Date().toISOString())
    : null;
  const fallbackTarget = isAutonomousPublicSurface && publicEngagementPlan?.fallbackSelection?.targetUrl
    ? {
        url: publicEngagementPlan.fallbackSelection.targetUrl,
        targetKind: publicEngagementPlan.fallbackSelection.targetKind,
        summary: publicEngagementPlan.fallbackSelection.summary ?? null,
        rationale: publicEngagementPlan.fallbackSelection.selectionReason ?? null,
      }
    : null;

  const blocked = (reason, extra = {}) => ({
    status: "blocked",
    action,
    prospectName: prospect.name,
    reason,
    writeback: null,
    ...extra,
  });
  if (!recipientUrl && !publicTarget?.url) return blocked(`${prospect.name} has no LinkedIn profile URL to message.`);
  if ((action === DM_ACTION || action === POST_COMMENT_ACTION || action === COMMENT_REPLY_ACTION) && !normalizedMessage.trim().length) {
    return blocked(`${prospect.name} has no sendable LinkedIn draft body for ${surface}.`);
  }
  if ((action === POST_COMMENT_ACTION || action === COMMENT_REPLY_ACTION || action === POST_REACTION_ACTION || action === COMMENT_REACTION_ACTION) && !publicTarget?.url) {
    return blocked(`${prospect.name} has no persisted public-engagement target for ${surface}.`);
  }

  const execution = buildCompanyExecutionView(rawCompany, null, rawProfiles, {
    capability: "linkedin",
    rawMotion,
    rawUsers,
  });
  const transport = execution.transport ?? {};
  if (transport.status === "blocked") {
    return blocked(transport.blocker ?? transport.reason ?? "No governed LinkedIn execution path — assign a user/profile to this company first.");
  }

  const identity = execution.assignments?.user ?? null;
  const browserProfile = execution.assignments?.profile ?? null;
  const connector = normalizeNullableString(transport.preferredTransport?.tool);
  const connectorKey = normalizeConnectorKey(connector);
  if (!connector || !connectorKey) {
    return blocked("No governed LinkedIn connector is available for this send.");
  }
  if (connectorKey !== "unipile") {
    return blocked(`LinkedIn send requires a governed Unipile account. Resolved connector ${connector} is not supported.`);
  }
  const dispatchGate = evaluateOutboundDispatchGate({
    now: input.now ?? null,
    motion,
    account,
    prospect,
    draft: draft ?? { surface, channel: "linkedin" },
    action,
    senderAccount: execution.resolvedAccount,
    branches: input.branches ?? [],
  });
  if (dispatchGate.status !== "allow") {
    return blocked(dispatchGate.reason, {
      reasonCode: dispatchGate.reasonCode,
      blockReason: dispatchGate.blockReason,
      waitingReason: dispatchGate.waitingReason,
      nextDueAt: dispatchGate.nextDueAt,
      dispatchGate,
    });
  }
  // Runtime-agnostic: the same contract is executable by either a Codex agent
  // or a Claude agent (or any runtime with native browser tools). --runtime is
  // just which one is driving this pass; the guardrails apply to all.
  const runtime = normalizeRuntime(input.runtime);

  return {
    status: "ready",
    action,
    runtime,
    supportedRuntimes: ["codex", "claude"],
    connector,
    // Governed execution policy — enforced regardless of which agent runs it.
    executionPolicy: {
      mode: "native_connector_tools_only",
      shellFallbackAllowed: false,
      disallowedFallbacks: ["shell_subprocess", "another_linkedin_identity", "native_browser_tools", "paraphrasing_the_message"],
      pinnedIdentity: identity ? { label: identity.label, accountRefs: identity.accountRefs } : null,
      pinnedBrowserProfile: browserProfile?.label ?? null,
      writeBackOnlyAfterRealSend: true,
    },
    motionId: motion.id,
    motionName: motion.name,
    sender: identity
      ? { userId: identity.userId, label: identity.label, owner: identity.owner, accountRefs: identity.accountRefs }
      : null,
    browserProfile,
    recipient: { name: prospect.name, profileUrl: recipientUrl ?? publicTarget?.url ?? null },
    publicTarget,
    fallbackTarget,
    dispatchGate,
    channel: draft?.channel ?? "linkedin",
    surface,
    subject: draft?.subject ?? null,
    message: normalizedMessage,
    instructions: buildLinkedinSendInstructions({
      connector,
      identityLabel: identity?.label ?? "(assigned connector)",
      action,
      prospectName: prospect.name,
      recipientUrl,
      publicTarget,
      fallbackTarget,
      writeback,
      hasConnectionNote: Boolean(draft?.body),
    }),
    writeback,
  };
}

/** @param {string|null|undefined} runtime */
function normalizeRuntime(runtime) {
  const value = String(runtime ?? "").trim().toLowerCase();
  return value === "codex" || value === "claude" ? value : "any";
}

/** @param {string|null|undefined} value */
function normalizeNullableString(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

/** @param {string|null|undefined} connector */
function normalizeConnectorKey(connector) {
  const normalized = normalizeNullableString(connector)?.toLowerCase() ?? null;
  if (!normalized) return null;
  const parts = normalized.split(":").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

/**
 * @param {string | null} surface
 */
function resolveLinkedinActionForSurface(surface) {
  switch (surface) {
    case "connection_request":
      return CONNECT_ACTION;
    case "post_accept_message":
    case "follow_up_direct_message":
    case "inbound_reply":
      return DM_ACTION;
    case "public_comment":
      return POST_COMMENT_ACTION;
    case "comment_reply":
      return COMMENT_REPLY_ACTION;
    case "like_post":
      return POST_REACTION_ACTION;
    case "create_comment_reaction":
      return COMMENT_REACTION_ACTION;
    default:
      return null;
  }
}

/**
 * @param {any} prospect
 * @param {string | null} surface
 */
function resolveLinkedinPublicTarget(prospect, surface) {
  if (surface === "comment_reply" && !normalizePublicEngagementSelection(prospect?.publicEngagementSelection)) {
    const targetUrl = latestReactiveCommentSourceUrl(prospect);
    return targetUrl
      ? {
          url: targetUrl,
          targetKind: "comment",
          summary: null,
          rationale: "Reply inside the live public thread that answered us.",
        }
      : null;
  }

  const selection = normalizePublicEngagementSelection(prospect?.publicEngagementSelection)
    ?? selectLinkedinPublicEngagementTarget(prospect);
  if (!selection?.targetUrl) {
    return null;
  }
  return {
    url: selection.targetUrl,
    targetKind: selection.targetKind,
    summary: selection.summary ?? null,
    rationale: selection.selectionReason ?? selection.rationale ?? null,
  };
}

/**
 * @param {{
 *   connector: string,
 *   identityLabel: string,
 *   action: string,
 *   prospectName: string,
 *   recipientUrl: string | null,
 *   publicTarget: { url: string, targetKind: string, summary: string | null, rationale: string | null } | null,
 *   fallbackTarget: { url: string, targetKind: string, summary: string | null, rationale: string | null } | null,
 *   writeback: string,
 *   hasConnectionNote: boolean,
 * }} input
 */
function buildLinkedinSendInstructions(input) {
  const prefix = `Send as the assigned identity ${input.identityLabel} through the governed ${input.connector} connector only — do not drift to another LinkedIn account or another transport.`;
  const guardrail = `Use the governed ${input.connector} connector only. Do not shell out, fall back to a browser session, or paraphrase or add anything beyond the stored draft.`;
  const writeback = `ONLY after it is actually sent, run the write-back: ${input.writeback}`;

  switch (input.action) {
    case CONNECT_ACTION:
      return [
        prefix,
        `Open ${input.recipientUrl} and send a connection request${input.hasConnectionNote ? " with the note below" : " (no note)"}.`,
        guardrail,
        writeback,
      ];
    case POST_COMMENT_ACTION:
      return [
        prefix,
        `Open the stored LinkedIn post at ${input.publicTarget?.url} and publish the checked comment below verbatim.`,
        input.publicTarget?.rationale ? `Target rationale: ${input.publicTarget.rationale}` : "Target rationale: stored public-engagement target.",
        guardrail,
        writeback,
      ];
    case COMMENT_REPLY_ACTION:
      return [
        prefix,
        `Open the stored LinkedIn comment thread at ${input.publicTarget?.url} and publish the checked reply below verbatim.`,
        input.publicTarget?.rationale ? `Target rationale: ${input.publicTarget.rationale}` : "Target rationale: stored public-engagement target.",
        guardrail,
        writeback,
      ];
    case POST_REACTION_ACTION:
      return [
        prefix,
        `Open the stored LinkedIn post at ${input.publicTarget?.url} and leave one lightweight positive reaction only.`,
        input.publicTarget?.rationale ? `Target rationale: ${input.publicTarget.rationale}` : "Target rationale: stored public-engagement target.",
        input.fallbackTarget?.url
          ? `If that exact target is gone or unwritable, try the one stored fallback target at ${input.fallbackTarget.url} exactly once. If neither works, return unavailable instead of switching to anything else.`
          : "If that exact target is gone or unwritable, return unavailable instead of switching to anything else.",
        `Use the governed ${input.connector} connector only. Do not comment, do not message, and do not switch to another target.`,
        writeback,
      ];
    case COMMENT_REACTION_ACTION:
      return [
        prefix,
        `Open the stored LinkedIn comment thread at ${input.publicTarget?.url} and leave one lightweight reaction only.`,
        input.publicTarget?.rationale ? `Target rationale: ${input.publicTarget.rationale}` : "Target rationale: stored public-engagement target.",
        input.fallbackTarget?.url
          ? `If that exact target is gone or unwritable, try the one stored fallback target at ${input.fallbackTarget.url} exactly once. If neither works, return unavailable instead of switching to anything else.`
          : "If that exact target is gone or unwritable, return unavailable instead of switching to anything else.",
        `Use the governed ${input.connector} connector only. Do not reply with text, do not message, and do not switch to another target.`,
        writeback,
      ];
    default:
      return [
        prefix,
        `Open the LinkedIn message thread with ${input.prospectName} at ${input.recipientUrl} and send the message below verbatim.`,
        guardrail,
        writeback,
      ];
  }
}
