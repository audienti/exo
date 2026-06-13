// @ts-check

import { listActionCatalog } from "./action-catalog.js";
import { listInboundSurfaceCatalog } from "./inbound-surface-catalog.js";

const SYNC_APPLY_OWNER = "src/core/inbound-sync-run.js";
const MUTATION_WRITEBACK_OWNER = "src/core/record-action-result.js";
const CONNECTION_REQUEST_RECONCILIATION_OWNER = "src/core/connection-request-reconciliation.js";
const EMAIL_SEND_RECONCILIATION_OWNER = "src/core/email-send-reconciliation.js";
const GMAIL_THREAD_RECONCILIATION_OWNER = "src/core/gmail-thread-reconciliation.js";
const LINKEDIN_PRIVATE_MESSAGE_RECONCILIATION_OWNER = "src/core/linkedin-private-message-reconciliation.js";
const INMAIL_RECONCILIATION_OWNER = "src/core/inmail-reconciliation.js";
const LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER = "src/core/linkedin-social-graph-reconciliation.js";
const PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER = "src/core/public-engagement-reconciliation.js";
const HUBSPOT_CAPABILITY_RECONCILIATION_OWNER = "src/core/hubspot-capability-reconciliation.js";
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
    reconcileOwner: LINKEDIN_PRIVATE_MESSAGE_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Thread count and actionable observations need separate backend semantics.",
  },
  "linkedin-profile-views": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "partial",
    },
    reconcileOwner: LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER,
    kanbanLane: "next",
    gap: "Visible-total discrepancies should not look equally complete to an operator.",
  },
  "linkedin-followers-list": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "n/a",
    },
    reconcileOwner: LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Continuation exists, but incomplete page-budget runs must resume without broad repeated scraping.",
  },
  "linkedin-following-list": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "partial",
    },
    reconcileOwner: LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER,
    kanbanLane: "next",
    gap: "Follow and unfollow state changes need a single reconciliation owner.",
  },
  "linkedin-comment-replies": {
    status: {
      sync: "missing",
      reconcile: "missing",
      mutate: "partial",
    },
    reconcileOwner: PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER,
    kanbanLane: "later",
    gap: "Cataloged as disabled browser capture. Autonomous public reply retrieval is not wired.",
  },
  "linkedin-catch-up-updates": {
    status: {
      sync: "missing",
      reconcile: "missing",
      mutate: "partial",
    },
    reconcileOwner: PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER,
    kanbanLane: "later",
    gap: "Public engagement mutations exist, but this truth surface is disabled.",
  },
  "gmail-inbox-threads": {
    status: {
      sync: "partial",
      reconcile: "partial",
      mutate: "n/a",
    },
    reconcileOwner: GMAIL_THREAD_RECONCILIATION_OWNER,
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
    reconcileOwner: EMAIL_SEND_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Email send writeback exists, but no Gmail sent-mail or delivery-proof surface reconciles it.",
  },
  send_direct_message: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: LINKEDIN_PRIVATE_MESSAGE_RECONCILIATION_OWNER,
    kanbanLane: "now",
    gap: "Private-message sends need proof through LinkedIn messaging sync.",
  },
  in_mail_message: {
    status: {
      mutate: "partial",
      reconcile: "missing",
    },
    reconcileOwner: INMAIL_RECONCILIATION_OWNER,
    kanbanLane: "next",
    gap: "Outbound InMail can be recorded, but InMail inbox and sent proof surfaces are missing.",
  },
  follow: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER,
    kanbanLane: "next",
    gap: "Follow writeback should reconcile against the following-list surface.",
  },
  unfollow: {
    status: {
      mutate: "partial",
      reconcile: "partial",
    },
    reconcileOwner: LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER,
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

const ACCOUNT_CAPABILITY_HEALTH_STATE_KEYS = [
  "checked",
  "unchecked",
  "stale",
  "failed",
  "unsupported",
  "disabled",
  "unconfigured",
];

const ACTION_PROOF_SURFACES = {
  connection_request: ["linkedin-sent-invitations"],
  withdraw_connection: ["linkedin-sent-invitations"],
  accept_connection: ["linkedin-received-invitations"],
  decline_connection: ["linkedin-received-invitations"],
  send_email: ["gmail-sent-mail", "gmail-inbox-threads"],
  send_direct_message: ["linkedin-messaging-inbox"],
  in_mail_message: ["linkedin-inmail-sent", "linkedin-inmail-inbox"],
  follow: ["linkedin-following-list"],
  unfollow: ["linkedin-following-list"],
  profile_view: ["linkedin-profile-views"],
  like_post: ["linkedin-catch-up-updates"],
  unlike_post: ["linkedin-catch-up-updates"],
  create_post_comment: ["linkedin-comment-replies", "linkedin-catch-up-updates"],
  share_post: ["linkedin-catch-up-updates"],
  create_comment_comment: ["linkedin-comment-replies"],
  create_comment_reaction: ["linkedin-comment-replies"],
};

const ACTION_RECONCILIATION_STRATEGIES = {
  connection_request: "connection-request-sent-invitation-proof",
  withdraw_connection: "connection-request-withdrawal-proof",
  accept_connection: "received-invitation-transition-proof",
  decline_connection: "received-invitation-transition-proof",
  send_email: "gmail-thread-and-sent-mail-proof",
  send_direct_message: "linkedin-private-message-thread-proof",
  in_mail_message: "inmail-entitlement-and-thread-proof",
  follow: "linkedin-following-list-proof",
  unfollow: "linkedin-following-list-proof",
  profile_view: "profile-view-attention-proof",
};

const ACTION_MUTATION_DEBT_POLICIES = {
  connection_request: "pending until linkedin-sent-invitations proves pending, accepted, withdrawn, or no-longer-pending",
  withdraw_connection: "pending until linkedin-sent-invitations proves the invite was withdrawn or disappeared",
  accept_connection: "clears inbound invitation debt when received-invitation state transitions to accepted",
  decline_connection: "clears inbound invitation debt when received-invitation state transitions to declined",
  send_email: "pending external proof until gmail-sent-mail or gmail thread proof is available",
  send_direct_message: "pending external proof until linkedin-messaging-inbox confirms the thread update",
  in_mail_message: "pending external proof, but current InMail proof surfaces are missing",
  follow: "pending external proof until linkedin-following-list confirms followed state",
  unfollow: "pending external proof until linkedin-following-list confirms removed state",
  profile_view: "local writeback plus profile-view proof when the surface observes attention after touch",
};

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
 *   proofSurfaces: string[],
 *   stateKeys: string[],
 *   syncStrategy: string,
 *   reconciliationStrategy: string,
 *   mutationDebtPolicy: string,
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
      proofSurfaces: [surface.key],
      stateKeys: surface.observationKinds.length ? [...surface.observationKinds] : [surface.key],
      syncStrategy: buildSurfaceSyncStrategy(surface),
      reconciliationStrategy: buildSurfaceReconciliationStrategy(surface.key),
      mutationDebtPolicy: buildSurfaceMutationDebtPolicy(status),
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
      proofSurfaces: buildActionProofSurfaces(action.key),
      stateKeys: action.activityKeys.length ? [...action.activityKeys] : [action.key],
      syncStrategy: "not-applicable-mutation-starts-at-writeback",
      reconciliationStrategy: buildActionReconciliationStrategy(action.key),
      mutationDebtPolicy: buildActionMutationDebtPolicy(action.key),
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
        reconcile: "working",
        mutate: "n/a",
      },
      proofSurfaces: ["connected-account-inbound-sync-state"],
      stateKeys: ACCOUNT_CAPABILITY_HEALTH_STATE_KEYS,
      syncStrategy: "connected-account-sync-state-read",
      reconciliationStrategy: "account-capability-health-classification",
      mutationDebtPolicy: "not-applicable",
      kanbanLane: "now",
      gap: "Backend account health now distinguishes checked, unchecked, stale, failed, unsupported, disabled, and unconfigured states.",
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
        reconcile: "working",
        mutate: "n/a",
      },
      proofSurfaces: ["agent-last-pass", "agent-host-state", "agent-log"],
      stateKeys: ["run-id", "status", "lane", "task-kind"],
      syncStrategy: "local-runtime-artifact-read",
      reconciliationStrategy: "agent-run-artifact-normalization",
      mutationDebtPolicy: "not-applicable",
      kanbanLane: "now",
      gap: "Agent host artifacts now have one backend query contract before the UI can show job history.",
    },
    {
      id: "support:hubspot",
      kind: "backend_support",
      service: "hubspot",
      capabilityKey: "hubspot",
      label: "HubSpot capability support",
      sync: { owner: null },
      reconcile: { owner: HUBSPOT_CAPABILITY_RECONCILIATION_OWNER },
      mutate: { owner: null },
      status: {
        sync: "n/a",
        reconcile: "partial",
        mutate: "n/a",
      },
      proofSurfaces: ["hubspot-managed-account", "hubspot-runtime-probe"],
      stateKeys: ["configured", "runtime_probe", "preferred_account", "failed_runtime_probe"],
      syncStrategy: "runtime-managed-account-and-probe-read",
      reconciliationStrategy: "hubspot-capability-support-classification",
      mutationDebtPolicy: "not-applicable",
      kanbanLane: "now",
      gap: "HubSpot has managed-account support but no inbound truth surfaces; capability support must not collapse to unchecked.",
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
      reconcileOwner: PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER,
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
      reconcileOwner: LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER,
      kanbanLane: "next",
      gap: "Profile-view writeback exists, but profile-view truth has visible-total discrepancies.",
    };
  }

  return {};
}

/**
 * @param {ReturnType<typeof listInboundSurfaceCatalog>[number]} surface
 */
function buildSurfaceSyncStrategy(surface) {
  if (surface.autonomousBackgroundRetrieval === false) {
    return `${surface.retrievalMode}-unsupported-autonomous-capture`;
  }

  return `${surface.retrievalMode}-itemized-truth-sync`;
}

/**
 * @param {string} surfaceKey
 */
function buildSurfaceReconciliationStrategy(surfaceKey) {
  switch (surfaceKey) {
    case "linkedin-sent-invitations":
      return "connection-request-sent-invitation-owner";
    case "linkedin-received-invitations":
      return "connection-request-received-invitation-owner";
    case "linkedin-messaging-inbox":
      return "linkedin-private-message-thread-owner";
    case "linkedin-profile-views":
      return "profile-view-attention-reconciliation";
    case "linkedin-followers-list":
      return "social-graph-follower-reconciliation";
    case "linkedin-following-list":
      return "follow-state-reconciliation";
    case "linkedin-comment-replies":
    case "linkedin-catch-up-updates":
      return "public-engagement-proof-reconciliation";
    case "gmail-inbox-threads":
      return "gmail-thread-identity-reconciliation";
    default:
      return "surface-observation-reconciliation";
  }
}

/**
 * @param {CapabilityStatus} status
 */
function buildSurfaceMutationDebtPolicy(status) {
  if (status.mutate === "n/a") {
    return "not-applicable";
  }

  if (status.mutate === "missing") {
    return "cannot-clear-mutation-debt-until-proof-surface-exists";
  }

  return "surface-observations-can-confirm-or-clear-related-mutation-debt";
}

/**
 * @param {string} actionKey
 */
function buildActionProofSurfaces(actionKey) {
  if (ACTION_PROOF_SURFACES[actionKey]) {
    return [...ACTION_PROOF_SURFACES[actionKey]];
  }

  if (PUBLIC_ENGAGEMENT_ACTIONS.has(actionKey)) {
    return ["linkedin-catch-up-updates", "linkedin-comment-replies"];
  }

  if (OFFLINE_ACTIONS.has(actionKey)) {
    return ["local-activity-log"];
  }

  return ["activity-event-log"];
}

/**
 * @param {string} actionKey
 */
function buildActionReconciliationStrategy(actionKey) {
  if (ACTION_RECONCILIATION_STRATEGIES[actionKey]) {
    return ACTION_RECONCILIATION_STRATEGIES[actionKey];
  }

  if (PUBLIC_ENGAGEMENT_ACTIONS.has(actionKey)) {
    return "public-engagement-proof-reconciliation";
  }

  if (OFFLINE_ACTIONS.has(actionKey)) {
    return "local-activity-proof-reconciliation";
  }

  return "action-result-reconciliation";
}

/**
 * @param {string} actionKey
 */
function buildActionMutationDebtPolicy(actionKey) {
  if (ACTION_MUTATION_DEBT_POLICIES[actionKey]) {
    return ACTION_MUTATION_DEBT_POLICIES[actionKey];
  }

  if (PUBLIC_ENGAGEMENT_ACTIONS.has(actionKey)) {
    return "pending or missing external proof until public engagement capture is supported";
  }

  if (OFFLINE_ACTIONS.has(actionKey)) {
    return "local proof only unless a future external proof surface is added";
  }

  return "local writeback creates reconciliation metadata when an external proof surface is known";
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
    proofSurfaces: [...row.proofSurfaces],
    stateKeys: [...row.stateKeys],
  };
}
