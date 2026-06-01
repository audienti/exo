// @ts-check

import { browserProfileCapabilitySchema } from "../schema/browser-profile.js";
import {
  inboundRetrievalModeSchema,
  inboundSurfaceKeySchema,
  inboundTruthLevelSchema
} from "../schema/inbound.js";

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
 *   observationKinds: string[]
 * }} InboundSurfaceDefinition
 */

/** @type {InboundSurfaceDefinition[]} */
const catalog = [
  {
    key: "linkedin-sent-invitations",
    capability: "linkedin",
    platform: "linkedin",
    label: "Sent Invitations",
    summary: "Outgoing connection requests plus their pending, accepted, or withdrawn outcomes.",
    truthLevel: "authoritative",
    retrievalMode: "browser-capture",
    defaultEnabled: true,
    observationKinds: [
      "connection_request_pending",
      "connection_request_no_longer_pending",
      "connection_request_accepted",
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
    retrievalMode: "browser-capture",
    defaultEnabled: true,
    observationKinds: [
      "connection_request_received",
      "connection_request_received_no_longer_pending",
      "connection_request_accepted",
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
    retrievalMode: "browser-capture",
    defaultEnabled: true,
    observationKinds: ["message_received", "thread_updated", "inbound_reply_received"]
  },
  {
    key: "linkedin-profile-views",
    capability: "linkedin",
    platform: "linkedin",
    label: "Profile Views",
    summary: "Profile viewers after touches, used as a signal that attention happened even without acceptance.",
    truthLevel: "authoritative",
    retrievalMode: "browser-capture",
    defaultEnabled: true,
    observationKinds: ["profile_view_after_touch", "profile_view_received"]
  },
  {
    key: "linkedin-followers-list",
    capability: "linkedin",
    platform: "linkedin",
    label: "Followers",
    summary: "Who follows us, used as an inbound attention signal without pretending it proves connection state.",
    truthLevel: "supplementary",
    retrievalMode: "browser-capture",
    defaultEnabled: true,
    observationKinds: ["follower_added", "follower_removed", "follower_confirmed"]
  },
  {
    key: "linkedin-following-list",
    capability: "linkedin",
    platform: "linkedin",
    label: "Following List",
    summary: "Follow-state truth for warmup actions and clean reversals.",
    truthLevel: "authoritative",
    retrievalMode: "browser-capture",
    defaultEnabled: true,
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
    defaultEnabled: true,
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
    observationKinds: ["email_reply_received", "email_thread_updated"]
  }
].map((surface) => ({
  ...surface,
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
 * @param {import("../schema/browser-profile.js").browserProfileCapabilitySchema._type} capability
 */
export function defaultInboundSurfacesForCapability(capability) {
  return listInboundSurfaceCatalog({ capability })
    .filter((surface) => surface.defaultEnabled)
    .map((surface) => surface.key);
}
