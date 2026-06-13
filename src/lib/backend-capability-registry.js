// @ts-check

import { listActionCatalog } from "./action-catalog.js";
import { listInboundSurfaceCatalog } from "./inbound-surface-catalog.js";

const SYNC_APPLY_OWNER = "src/core/inbound-sync-run.js";
const MUTATION_WRITEBACK_OWNER = "src/core/record-action-result.js";
const CONNECTION_REQUEST_RECONCILIATION_OWNER = "src/core/connection-request-reconciliation.js";
const ACCOUNT_HEALTH_OWNER = "src/core/account-capability-health.js";
const AGENT_RUN_LOG_OWNER = "src/core/agent-run-log.js";

const DEFAULT_SURFACE_RECONCILIATION_OWNER = "src/core/inbound-sync-run.js";
const DEFAULT_ACTION_RECONCILIATION_OWNER = "src/core/record-action-result.js";

const INBOUND_SURFACE_OVERLAYS = {
  "linkedin-sent-invitations": {
    status: {
      sync: "wrong-risk",
      reconcile: "partial",
      mutate: "partial",
    },
    reconcileOwner: CONNECTION_REQUEST_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Current live state can report complete zero sent invitations while the agent queue still has 54 reconciliation tasks.",
  },
  "linkedin-received-invitations": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "partial",
    },
    reconcileOwner: CONNECTION_REQUEST_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Accept and decline requested/final states need one reconciliation owner.",
  },
  "linkedin-messaging-inbox": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "partial",
    },
    reconcileOwner: "src/core/private-inbound-message-classification.js",
    kanbanLane: "now",
    gap: "Thread count and actionable observations need separate backend semantics.",
  },
  "linkedin-profile-views": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "partial",
    },
    reconcileOwner: DEFAULT_SURFACE_RECONCILIATION_OWNER,
    kanbanLane: "next",
    gap: "Visible-total discrepancies should not look equally complete to an operator.",
  },
  "linkedin-followers-list": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "n/a",
    },
    reconcileOwner: DEFAULT_SURFACE_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Continuation exists, but incomplete page-budget runs must resume without broad repeated scraping.",
  },
  "linkedin-following-list": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "partial",
    },
    reconcileOwner: "src/core/follow-state-reconciliation.js",
    kanbanLane: "next",
    gap: "Follow and unfollow state changes need a single reconciliation owner.",
  },
  "linkedin-comment-replies": {
    status: {
      sync: "missing",
      reconcile: "missing",
      mutate: "partial",
    },
    reconcileOwner: "src/core/public-engagement-reconciliation.js",
    kanbanLane: "later",
    gap: "Cataloged as disabled browser capture. Autonomous public reply retrieval is not wired.",
  },
  "linkedin-catch-up-updates": {
    status: {
      sync: "missing",
      reconcile: "missing",
      mutate: "partial",
    },
    reconcileOwner: "src/core/public-engagement-reconciliation.js",
    kanbanLane: "later",
    gap: "Public engagement mutations exist, but this truth surface is disabled.",
  },
  "gmail-inbox-threads": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "n/a",
    },
    reconcileOwner: "src/core/inbound-identity-resolution.js",
    kanbanLane: "now",
    gap: "Some Gmail accounts sync, while the preferred Gmail account can remain never checked.",
  },
};

const ACTION_OVERLAYS = {
  connection_request: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: CONNECTION_REQUEST_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Send writeback exists, but external invite state must be reconciled against sent invitations.",
  },
  withdraw_connection: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: CONNECTION_REQUEST_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Withdraw writeback needs sync proof from sent invitations.",
  },
  accept_connection: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: CONNECTION_REQUEST_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Accept writeback needs one requested/final-state owner.",
  },
  decline_connection: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: CONNECTION_REQUEST_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Decline writeback needs one requested/final-state owner.",
  },
  send_email: {
    status: {
      mutate: "partial",
      reconcile: "missing",
    },
    reconcileOwner: "src/core/email-send-reconciliation.js",
    kanbanLane: "now",
    gap: "Email send writeback exists, but no Gmail sent-mail or delivery-proof surface reconciles it.",
  },
  send_direct_message: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: "src/core/private-inbound-message-classification.js",
    kanbanLane: "now",
    gap: "Private-message sends need proof through LinkedIn messaging sync.",
  },
  in_mail_message: {
    status: {
      mutate: "partial",
      reconcile: "missing",
    },
    reconcileOwner: "src/core/inmail-reconciliation.js",
    kanbanLane: "next",
    gap: "Outbound InMail can be recorded, but InMail inbox and sent proof surfaces are missing.",
  },
  follow: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: "src/core/follow-state-reconciliation.js",
    kanbanLane: "next",
    gap: "Follow writeback should reconcile against the following-list surface.",
  },
  unfollow: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: "src/core/follow-state-reconciliation.js",
    kanbanLane: "next",
    gap: "Unfollow writeback should reconcile against the following-list surface.",
  },
};

const PUBLIC_ENGAGEMENT_ACTIONS = new Set([
  "like_post",
  "unlike_post",
  "create_post_comment",
  "share_post",
  "create_comment_comment",
  "create_comment_reaction",
]);

const OFFLINE_ACTIONS = new Set(["voicemail_outreach", "video_outreach"]);

/**
 * @typedef {{
 *   owner: string | null,
 *   producers?: string[],
 * }} CapabilityOwner
 *
 * @typedef {{
 *   sync?: string,
 *   reconcile?: string,
 *   mutate?: string,
 * }} CapabilityStatus
 *
 * @typedef {{
 *   id: string,
 *   kind: "inbound_surface" | "mutation_action" | "backend_support",
 *   service: string,
 *   capabilityKey: string,
 *   label: string,
 *   surfaceKey?: string,
 *   actionKey?: string,
 *   sync: CapabilityOwner,
 *   reconcile: CapabilityOwner,
 *   mutate: CapabilityOwner,
 *   status: CapabilityStatus,
 *   kanbanLane: "now" | "next" | "later",
 *   gap: string,
 * }} BackendCapabilityRow
 */

/**
 * @returns {BackendCapabilityRow[]}
 */
export function listBackendCapabilityRegistry() {
  return [
    ...buildInboundSurfaceRows(),
    ...buildMutationActionRows(),
    ...buildSupportRows(),
  ].map(cloneRow);
}

/**
 * @param {string} capabilityKey
 * @returns {BackendCapabilityRow | null}
 */
export function findBackendCapability(capabilityKey) {
  const normalized = String(capabilityKey ?? "").trim().toLowerCase();
  const row = listBackendCapabilityRegistry().find((candidate) =>
    candidate.capabilityKey === normalized
    || candidate.surfaceKey === normalized
    || candidate.actionKey === normalized
  );

  return row ?? null;
}

/**
 * @returns {BackendCapabilityRow[]}
 */
function buildInboundSurfaceRows() {
  return listInboundSurfaceCatalog().map((surface) => {
    const overlay = INBOUND_SURFACE_OVERLAYS[surface.key] ?? {};
    const status = {
      sync: "partial",
      reconcile: "partial",
      mutate: "n/a",
      ...(overlay.status ?? {}),
    };

    return {
      id: `surface:${surface.key}`,
      kind: "inbound_surface",
      service: surface.capability,
      capabilityKey: surface.key,
      label: surface.label,
      surfaceKey: surface.key,
      sync: {
        owner: SYNC_APPLY_OWNER,
        producers: surface.capability === "gmail"
          ? ["src/core/inbound-gmail-live-sync.js", "src/core/inbound-gmail-sync.js"]
          : ["src/core/inbound-linkedin-live-sync.js", "src/core/inbound-linkedin-sync.js"],
      },
      reconcile: {
        owner: overlay.reconcileOwner ?? DEFAULT_SURFACE_RECONCILIATION_OWNER,
      },
      mutate: {
        owner: status.mutate === "n/a" ? null : MUTATION_WRITEBACK_OWNER,
      },
      status,
      kanbanLane: overlay.kanbanLane ?? "next",
      gap: overlay.gap ?? "Registry row needs a sharper capability-specific gap before the surface can be called working.",
    };
  });
}

/**
 * @returns {BackendCapabilityRow[]}
 */
function buildMutationActionRows() {
  return listActionCatalog().map((action) => {
    const overlay = ACTION_OVERLAYS[action.key] ?? inferActionOverlay(action.key);

    return {
      id: `action:${action.key}`,
      kind: "mutation_action",
      service: action.requiredCapability,
      capabilityKey: action.key,
      label: action.label,
      actionKey: action.key,
      sync: {
        owner: null,
      },
      reconcile: {
        owner: overlay.reconcileOwner ?? DEFAULT_ACTION_RECONCILIATION_OWNER,
      },
      mutate: {
        owner: MUTATION_WRITEBACK_OWNER,
      },
      status: {
        sync: "n/a",
        reconcile: overlay.status?.reconcile ?? "partial",
        mutate: overlay.status?.mutate ?? "partial",
      },
      kanbanLane: overlay.kanbanLane ?? "next",
      gap: overlay.gap ?? "Mutation writeback exists, but external proof and reconciliation semantics still need a dedicated owner.",
    };
  });
}

/**
 * @returns {BackendCapabilityRow[]}
 */
function buildSupportRows() {
  return [
    {
      id: "support:account-capability-health",
      kind: "backend_support",
      service: "workspace",
      capabilityKey: "account-capability-health",
      label: "Account capability health",
      sync: { owner: null },
      reconcile: { owner: ACCOUNT_HEALTH_OWNER },
      mutate: { owner: null },
      status: {
        sync: "n/a",
        reconcile: "missing",
        mutate: "n/a",
      },
      kanbanLane: "now",
      gap: "Backend needs one account health model for checked, unchecked, stale, failed, unsupported, and unconfigured states.",
    },
    {
      id: "support:agent-run-log",
      kind: "backend_support",
      service: "workspace",
      capabilityKey: "agent-run-log",
      label: "Agent run log",
      sync: { owner: null },
      reconcile: { owner: AGENT_RUN_LOG_OWNER },
      mutate: { owner: null },
      status: {
        sync: "n/a",
        reconcile: "missing",
        mutate: "n/a",
      },
      kanbanLane: "now",
      gap: "Existing agent host artifacts need one query contract before the UI can show job history.",
    },
  ];
}

/**
 * @param {string} actionKey
 */
function inferActionOverlay(actionKey) {
  if (PUBLIC_ENGAGEMENT_ACTIONS.has(actionKey)) {
    return {
      status: {
        mutate: "partial",
        reconcile: "missing",
      },
      reconcileOwner: "src/core/public-engagement-reconciliation.js",
      kanbanLane: "later",
      gap: "Public engagement mutation exists, but public reply and catch-up truth surfaces are disabled.",
    };
  }

  if (OFFLINE_ACTIONS.has(actionKey)) {
    return {
      status: {
        mutate: "partial",
        reconcile: "partial",
      },
      reconcileOwner: DEFAULT_ACTION_RECONCILIATION_OWNER,
      kanbanLane: "later",
      gap: "Offline action writeback is local proof unless a future external proof surface is added.",
    };
  }

  if (actionKey === "profile_view") {
    return {
      status: {
        mutate: "partial",
        reconcile: "partial",
      },
      reconcileOwner: DEFAULT_ACTION_RECONCILIATION_OWNER,
      kanbanLane: "next",
      gap: "Profile-view writeback exists, but profile-view truth has visible-total discrepancies.",
    };
  }

  return {};
}

/**
 * @param {BackendCapabilityRow} row
 * @returns {BackendCapabilityRow}
 */
function cloneRow(row) {
  return {
    ...row,
    sync: {
      ...row.sync,
      producers: row.sync.producers ? [...row.sync.producers] : undefined,
    },
    reconcile: { ...row.reconcile },
    mutate: { ...row.mutate },
    status: { ...row.status },
  };
}
