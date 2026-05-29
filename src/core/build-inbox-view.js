// @ts-check

import { inboundObservationSchema } from "../schema/inbound.js";
import { motionSchema } from "../schema/motion.js";
import { userSchema } from "../schema/user.js";

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawObservations
 * @param {unknown[]} rawMotions
 * @param {unknown[]} rawCompanies
 */
export function buildInboxView(rawUser, rawObservations, rawMotions, rawCompanies) {
  const user = userSchema.parse(rawUser);
  const observations = rawObservations.map((item) => inboundObservationSchema.parse(item));
  const motions = rawMotions.map((item) => motionSchema.parse(item));
  const companiesById = new Map(
    rawCompanies
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => [item.id, item])
  );
  const prospectContextById = new Map();

  for (const motion of motions) {
    for (const account of motion.targetMap.accounts) {
      for (const prospect of account.prospects) {
        prospectContextById.set(prospect.id, {
          motion,
          account,
          prospect
        });
      }
    }
  }

  const items = observations
    .map((observation) => buildInboxItem(observation, motions, companiesById, prospectContextById))
    .sort(compareInboxItems);

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    counts: {
      itemCount: items.length,
      highPriorityCount: items.filter((item) => item.priority === "high").length,
      mediumPriorityCount: items.filter((item) => item.priority === "medium").length,
      lowPriorityCount: items.filter((item) => item.priority === "low").length
    },
    items
  };
}

/**
 * @param {import("../schema/inbound.js").inboundObservationSchema._type} observation
 * @param {import("../schema/motion.js").motionSchema._type[]} motions
 * @param {Map<string, any>} companiesById
 * @param {Map<string, { motion: import("../schema/motion.js").motionSchema._type, account: any, prospect: any }>} prospectContextById
 */
function buildInboxItem(observation, motions, companiesById, prospectContextById) {
  const prospectContext = observation.prospectId ? prospectContextById.get(observation.prospectId) ?? null : null;
  const motion = observation.motionId
    ? motions.find((candidate) => candidate.id === observation.motionId) ?? prospectContext?.motion ?? null
    : prospectContext?.motion ?? null;
  const account = prospectContext?.account ?? (motion && observation.companyId
    ? motion.targetMap.accounts.find((candidate) => candidate.companyId === observation.companyId) ?? null
    : null);
  const company = observation.companyId
    ? companiesById.get(observation.companyId) ?? account ?? null
    : account ?? null;
  const prospect = prospectContext?.prospect ?? (account && observation.prospectId
    ? account.prospects.find((candidate) => candidate.id === observation.prospectId) ?? null
    : null);
  const triage = classifyObservation(observation.kind);

  return {
    id: observation.id,
    observedAt: observation.observedAt,
    recordedAt: observation.recordedAt,
    kind: observation.kind,
    surfaceKey: observation.surfaceKey,
    summary: observation.summary,
    actorName: observation.actorName,
    priority: triage.priority,
    status: triage.status,
    whyItMatters: triage.whyItMatters,
    recommendedAction: recommendAction(observation.kind, prospect),
    account: {
      id: observation.accountId,
      capability: observation.capability
    },
    motion: motion ? { id: motion.id, name: motion.name } : null,
    company: company ? { id: company.id, name: company.name ?? company.companyName ?? null } : null,
    prospect: prospect ? { id: prospect.id, name: prospect.name, title: prospect.title } : null
  };
}

/**
 * @param {string} kind
 */
function classifyObservation(kind) {
  switch (kind) {
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
      return {
        priority: "high",
        status: "needs-reply",
        whyItMatters: "A prospect replied on a direct channel. This is no longer speculative outreach; it needs a live response."
      };
    case "connection_request_received":
    case "connection_request_accepted":
      return {
        priority: "high",
        status: "needs-triage",
        whyItMatters: "The connection state changed, which can unlock or require the next private move."
      };
    case "public_reply_received":
    case "comment_thread_updated":
    case "public_engagement_opportunity":
    case "catch_up_update_detected":
      return {
        priority: "medium",
        status: "visibility-opportunity",
        whyItMatters: "A public conversation moved. This may create a legitimate visibility or engagement opening."
      };
    case "profile_view_after_touch":
    case "profile_view_received":
    case "follower_added":
    case "follower_confirmed":
      return {
        priority: "medium",
        status: "attention-signal",
        whyItMatters: "Attention happened, even if the person has not accepted or replied yet."
      };
    default:
      return {
        priority: "low",
        status: "informational",
        whyItMatters: "This is useful state, but it does not obviously demand an immediate move by itself."
      };
  }
}

/**
 * @param {string} kind
 * @param {any | null} prospect
 */
function recommendAction(kind, prospect) {
  switch (kind) {
    case "inbound_reply_received":
    case "email_reply_received":
    case "message_received":
      return `Reply to ${prospect?.name ?? "the prospect"} and move the cadence branch into a live conversation.`;
    case "connection_request_received":
      return `Decide whether to accept or decline the inbound connection request.`;
    case "connection_request_accepted":
      return `Send the first post-accept direct message for ${prospect?.name ?? "this prospect"}.`;
    case "public_reply_received":
    case "comment_thread_updated":
      return `Review the public thread and reply only if there is a legitimate contribution to make.`;
    case "public_engagement_opportunity":
    case "catch_up_update_detected":
      return `Review the public update and decide whether it is worth an inbound-motion engagement move.`;
    case "profile_view_after_touch":
    case "profile_view_received":
      return `Treat this as attention evidence and decide whether cadence should stay patient or advance.`;
    case "follower_added":
    case "follower_confirmed":
      return `Record the visibility signal and consider whether a public follow-up move is now more legitimate.`;
    default:
      return `Review this observation and decide whether it changes the motion state.`;
  }
}

/**
 * @param {ReturnType<typeof buildInboxItem>} left
 * @param {ReturnType<typeof buildInboxItem>} right
 */
function compareInboxItems(left, right) {
  const priorityRank = {
    high: 0,
    medium: 1,
    low: 2
  };

  return (
    priorityRank[left.priority] - priorityRank[right.priority]
    || right.observedAt.localeCompare(left.observedAt)
    || right.recordedAt.localeCompare(left.recordedAt)
  );
}
