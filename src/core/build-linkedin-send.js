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

const DM_ACTION = "send_direct_message";
const CONNECT_ACTION = "send_connection_request";

/**
 * @param {any} rawCompany
 * @param {any} rawMotion
 * @param {any[]} rawProfiles
 * @param {any[]} rawUsers
 * @param {{ prospectId: string, surface?: string|null, runtime?: string|null }} input
 * @returns {Record<string, any>}
 */
export function buildLinkedinSendHandoff(rawCompany, rawMotion, rawProfiles, rawUsers, input) {
  const company = rawCompany;
  const motion = rawMotion;
  const account = (motion.targetMap?.accounts ?? []).find((a) => a.companyId === company.id);
  const prospect = (account?.prospects ?? []).find((p) => p.id === input.prospectId);
  if (!prospect) throw new Error(`Prospect ${input.prospectId} is not targeted on ${company.name}.`);

  const sendReady = (prospect.drafts ?? []).filter(
    (d) => isAutonomousSendReadyDraft(d) && (!input.surface || d.surface === input.surface),
  );
  if (!sendReady.length) {
    throw new Error("No send-ready draft to send for this prospect" + (input.surface ? ` on surface ${input.surface}.` : "."));
  }
  if (sendReady.length > 1) throw new Error("Multiple send-ready drafts — pass a surface to choose one.");
  const draft = sendReady[0];
  const normalizedMessage = extractUsableDraftBody(draft.body) ?? (typeof draft.body === "string" ? draft.body : "");

  const action = draft.surface === "connection_request" ? CONNECT_ACTION : DM_ACTION;
  const writeback = `exo actions result --action ${action} --result sent --company ${company.id} --prospect ${prospect.id} --surface ${draft.surface}`;
  const recipientUrl = prospect.linkedinProfileUrl ?? prospect.linkedinProfileSnapshot?.profileUrl ?? null;

  const blocked = (reason) => ({ status: "blocked", action, prospectName: prospect.name, reason, writeback: null });
  if (!recipientUrl) return blocked(`${prospect.name} has no LinkedIn profile URL to message.`);
  if (action === DM_ACTION && !normalizedMessage.trim().length) {
    return blocked(`${prospect.name} has no sendable direct-message draft body.`);
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
    recipient: { name: prospect.name, profileUrl: recipientUrl },
    channel: draft.channel ?? "linkedin",
    surface: draft.surface,
    subject: draft.subject ?? null,
    message: normalizedMessage,
    instructions: [
      `Send as the assigned identity ${identity?.label ?? "(assigned connector)"} through the governed ${connector} connector only — do not drift to another LinkedIn account or another transport.`,
      action === CONNECT_ACTION
        ? `Open ${recipientUrl} and send a connection request${draft.body ? " with the note below" : " (no note)"}.`
        : `Open the LinkedIn message thread with ${prospect.name} at ${recipientUrl} and send the message below verbatim.`,
      `Use the governed ${connector} connector only. Do not shell out, fall back to a browser session, or paraphrase or add anything beyond the stored draft.`,
      `ONLY after it is actually sent, run the write-back: ${writeback}`,
    ],
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
