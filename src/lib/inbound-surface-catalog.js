// @ts-check

import { browserProfileCapabilitySchema } from "../schema/browser-profile.js";
import {
  inboundRetrievalModeSchema,
  inboundSurfaceKeySchema,
  inboundTruthLevelSchema
} from "../schema/inbound.js";
import {
  LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
  LINKEDIN_SYNC_SENT_INVITATIONS_METHOD
} from "./linkedin-tool-methods.js";

/**
 * @typedef {{
 *   key: import("../schema/inbound.js").inboundSurfaceKeySchema._type,
 *   capability: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type,
 *   platform: string,
 *   label: string,
 *   summary: string,
 *   truthLevel: import("../schema/inbound.js").inboundTruthLevelSchema._type,
 *   retrievalMode: import("../schema/inbound.js").inboundRetrievalModeSchema._type,
 *   defaultEnabled: boolean,
 *   autonomousBackgroundRetrieval: boolean,
 *   autonomousBackgroundReason: string | null,
 *   automationCadenceMs: number | null,
 *   observationKinds: string[],
 *   toolMethodId: string | null
 * }} InboundSurfaceDefinition
 */

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** @type {InboundSurfaceDefinition[]} */
const catalog = [
  {
    key: "linkedin-sent-invitations",
    capability: "linkedin",
    platform: "linkedin",
    label: "Sent Invitations",
    summary: "Outgoing connection requests plus their pending, accepted, or withdrawn outcomes.",
    truthLevel: "authoritative",
    retrievalMode: "connector",
    defaultEnabled: true,
    autonomousBackgroundRetrieval: true,
    autonomousBackgroundReason: null,
    automationCadenceMs: SIX_HOURS_MS,
    toolMethodId: LINKEDIN_SYNC_SENT_INVITATIONS_METHOD,
    observationKinds: [
      "connection_request_pending",
      "connection_request_no_longer_pending",
      "connection_request_accepted",
      "connection_request_not_accepted",
      "connection_request_withdraw_requested",
      "connection_request_withdrawn"
    ]
  },
  {
    key: "linkedin-received-invitations",
    capability: "linkedin",
    platform: "linkedin",
    label: "Received Invitations",
    summary: "Inbound connection requests waiting for accept or decline handling.",
    truthLevel: "authoritative",
    retrievalMode: "connector",
    defaultEnabled: true,
    autonomousBackgroundRetrieval: true,
    autonomousBackgroundReason: null,
    automationCadenceMs: SIX_HOURS_MS,
    toolMethodId: LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
    observationKinds: [
      "connection_request_received",
      "connection_request_received_no_longer_pending",
      "connection_request_accepted",
      "connection_request_decline_requested",
      "connection_request_declined"
    ]
  },
  {
    key: "linkedin-messaging-inbox",
    capability: "linkedin",
    platform: "linkedin",
    label: "Messaging Inbox",
    summary: "Inbox threads and direct-message changes tied to governed prospects.",
    truthLevel: "authoritative",
    retrievalMode: "connector",
    defaultEnabled: true,
    autonomousBackgroundRetrieval: true,
    autonomousBackgroundReason: null,
    automationCadenceMs: SIX_HOURS_MS,
    toolMethodId: null,
    observationKinds: ["message_received", "thread_updated", "inbound_reply_received"]
  },
  {
    key: "linkedin-profile-views",
    capability: "linkedin",
    platform: "linkedin",
    label: "Profile Views",
    summary: "Profile viewers after touches, used as a signal that attention happened even without acceptance.",
    truthLevel: "authoritative",
    retrievalMode: "connector",
    defaultEnabled: true,
    autonomousBackgroundRetrieval: true,
    autonomousBackgroundReason: null,
    automationCadenceMs: ONE_DAY_MS,
    toolMethodId: null,
    observationKinds: ["profile_view_after_touch", "profile_view_received"]
  },
  {
    key: "linkedin-followers-list",
    capability: "linkedin",
    platform: "linkedin",
    label: "Followers",
    summary: "Who follows us, used as an inbound attention signal without pretending it proves connection state.",
    truthLevel: "supplementary",
    retrievalMode: "connector",
    defaultEnabled: true,
    autonomousBackgroundRetrieval: true,
    autonomousBackgroundReason: null,
    automationCadenceMs: ONE_DAY_MS,
    toolMethodId: null,
    observationKinds: ["follower_added", "follower_removed", "follower_confirmed"]
  },
  {
    key: "linkedin-following-list",
    capability: "linkedin",
    platform: "linkedin",
    label: "Following List",
    summary: "Follow-state truth for warmup actions and clean reversals.",
    truthLevel: "authoritative",
    retrievalMode: "connector",
    defaultEnabled: true,
    autonomousBackgroundRetrieval: true,
    autonomousBackgroundReason: null,
    automationCadenceMs: ONE_DAY_MS,
    toolMethodId: null,
    observationKinds: ["follow_state_changed", "follow_state_removed", "follow_state_confirmed"]
  },
  {
    key: "linkedin-comment-replies",
    capability: "linkedin",
    platform: "linkedin",
    label: "Comment Replies",
    summary: "Public replies or comment-thread changes that matter for extrovert and inbound handling.",
    truthLevel: "supplementary",
    retrievalMode: "browser-capture",
    defaultEnabled: false,
    autonomousBackgroundRetrieval: false,
    autonomousBackgroundReason: "This surface is not yet wired through Exo's autonomous LinkedIn live-capture path.",
    automationCadenceMs: null,
    toolMethodId: null,
    observationKinds: ["public_reply_received", "comment_thread_updated"]
  },
  {
    key: "linkedin-catch-up-updates",
    capability: "linkedin",
    platform: "linkedin",
    label: "Catch-Up Updates",
    summary: "Public social changes worth engaging with to stay visible as part of an inbound motion, not as cadence truth.",
    truthLevel: "supplementary",
    retrievalMode: "browser-capture",
    defaultEnabled: false,
    autonomousBackgroundRetrieval: false,
    autonomousBackgroundReason: "This surface is not yet wired through Exo's autonomous LinkedIn live-capture path.",
    automationCadenceMs: null,
    toolMethodId: null,
    observationKinds: ["catch_up_update_detected", "public_engagement_opportunity"]
  },
  {
    key: "gmail-inbox-threads",
    capability: "gmail",
    platform: "gmail",
    label: "Inbox Threads",
    summary: "Email thread changes and inbound replies on previously touched prospects.",
    truthLevel: "authoritative",
    retrievalMode: "connector",
    defaultEnabled: true,
    autonomousBackgroundRetrieval: true,
    autonomousBackgroundReason: null,
    automationCadenceMs: SIX_HOURS_MS,
    toolMethodId: null,
    observationKinds: ["email_reply_received", "email_thread_updated"]
  }
].map((surface) => ({
  ...surface,
  autonomousBackgroundRetrieval: surface.autonomousBackgroundRetrieval !== false,
  autonomousBackgroundReason: typeof surface.autonomousBackgroundReason === "string" && surface.autonomousBackgroundReason.trim().length
    ? surface.autonomousBackgroundReason.trim()
    : null,
  automationCadenceMs: Number.isInteger(surface.automationCadenceMs) && surface.automationCadenceMs > 0
    ? surface.automationCadenceMs
    : null,
  toolMethodId: typeof surface.toolMethodId === "string" && surface.toolMethodId.trim().length
    ? surface.toolMethodId.trim()
    : null,
  key: inboundSurfaceKeySchema.parse(surface.key),
  capability: browserProfileCapabilitySchema.parse(surface.capability),
  truthLevel: inboundTruthLevelSchema.parse(surface.truthLevel),
  retrievalMode: inboundRetrievalModeSchema.parse(surface.retrievalMode)
}));

/**
 * @param {{ capability?: import("../schema/browser-profile.js").browserProfileCapabilitySchema._type | null }} [options]
 */
export function listInboundSurfaceCatalog(options = {}) {
  return catalog.filter((surface) => !options.capability || surface.capability === options.capability);
}

/**
 * @param {string} key
 * @returns {InboundSurfaceDefinition | null}
 */
export function findInboundSurfaceDefinition(key) {
  const normalized = key.trim().toLowerCase();
  return catalog.find((surface) => surface.key === normalized) ?? null;
}

/**
 * @param {string} toolMethodId
 */
export function findInboundSurfaceDefinitionByToolMethodId(toolMethodId) {
  const normalized = toolMethodId.trim();
  return catalog.find((surface) => surface.toolMethodId === normalized) ?? null;
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileCapabilitySchema._type} capability
 */
export function defaultInboundSurfacesForCapability(capability) {
  return listInboundSurfaceCatalog({ capability })
    .filter((surface) => surface.defaultEnabled)
    .map((surface) => surface.key);
}
