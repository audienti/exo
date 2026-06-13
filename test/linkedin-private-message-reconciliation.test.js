// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_SEAM_STATES,
} from "../src/core/capability-seam-contract.js";
import {
  LINKEDIN_PRIVATE_MESSAGE_RECONCILIATION_OWNER,
  reconcileLinkedinMessagingInboxSurface,
  reconcileLinkedinPrivateMessageMutation,
} from "../src/core/linkedin-private-message-reconciliation.js";
import { buildSeamRegistryRow } from "./support/capability-seam-fixtures.js";

const sentAt = "2026-06-13T14:00:00.000Z";
const checkedAt = "2026-06-13T14:05:00.000Z";

test("direct-message sends remain pending proof until the messaging inbox confirms the thread", () => {
  const result = reconcileLinkedinPrivateMessageMutation({
    row: buildDirectMessageRow(),
    actionKey: "send_direct_message",
    resultKey: "sent",
    surface: "post_accept_message",
    prospectId: "prospect-1",
    occurredAt: sentAt,
    observations: [],
    checkedAt,
  });

  assert.equal(result.capabilityKey, "send_direct_message");
  assert.equal(result.owner, LINKEDIN_PRIVATE_MESSAGE_RECONCILIATION_OWNER);
  assert.equal(result.state, CAPABILITY_SEAM_STATES.PENDING_PROOF);
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.requiresAction, true);
  assert.deepEqual(result.proofSurfaces, ["linkedin-messaging-inbox"]);
  assert.deepEqual(result.missingProofSurfaces, []);
  assert.equal(result.reason, "linkedin_direct_message_external_proof_pending");
  assert.equal(result.debt.actionKey, "send_direct_message");
  assert.equal(result.debt.surface, "post_accept_message");
  assert.equal(result.debt.externalState, "direct_message_sent");
});

test("direct-message send proof is reconciled from outbound messaging inbox observations", () => {
  const proofObservation = buildMessagingObservation({
    kind: "thread_updated",
    messages: [
      {
        id: "msg-outbound-1",
        direction: "outbound",
        sentAt: "2026-06-13T14:01:00.000Z",
        fromName: "William",
        fromHandle: "william-main",
        body: "Thanks for connecting.",
      },
    ],
  });

  const result = reconcileLinkedinPrivateMessageMutation({
    row: buildDirectMessageRow(),
    actionKey: "send_direct_message",
    resultKey: "sent",
    surface: "post_accept_message",
    prospectId: "prospect-1",
    occurredAt: sentAt,
    body: "Thanks for connecting.",
    observations: [proofObservation],
    checkedAt,
  });

  assert.equal(result.state, CAPABILITY_SEAM_STATES.RECONCILED);
  assert.equal(result.quiet, true);
  assert.equal(result.checked, true);
  assert.equal(result.requiresAction, false);
  assert.equal(result.reason, "linkedin_direct_message_sent_proof_observed");
  assert.deepEqual(result.evidence, [
    {
      surface: "linkedin-messaging-inbox",
      observationId: "obs-thread-1",
      externalId: "thread-1",
      messageId: "msg-outbound-1",
      direction: "outbound",
      observedAt: "2026-06-13T14:03:00.000Z",
      sentAt: "2026-06-13T14:01:00.000Z",
    },
  ]);
});

test("inbound LinkedIn replies override outbound waiting state", () => {
  const replyObservation = buildMessagingObservation({
    kind: "inbound_reply_received",
    messages: [
      {
        id: "msg-inbound-1",
        direction: "inbound",
        sentAt: "2026-06-13T14:03:00.000Z",
        fromName: "Alicia Buyer",
        fromHandle: "alicia-buyer",
        body: "This is timely. Can you send details?",
      },
    ],
  });

  const result = reconcileLinkedinPrivateMessageMutation({
    row: buildDirectMessageRow(),
    actionKey: "send_direct_message",
    resultKey: "sent",
    surface: "follow_up_direct_message",
    prospectId: "prospect-1",
    occurredAt: sentAt,
    observations: [replyObservation],
    checkedAt,
  });

  assert.equal(result.state, CAPABILITY_SEAM_STATES.RECONCILED);
  assert.equal(result.quiet, true);
  assert.equal(result.checked, true);
  assert.equal(result.requiresAction, false);
  assert.equal(result.reason, "linkedin_inbound_reply_overrides_outbound_waiting");
  assert.equal(result.debt.clearedBy, "inbound_reply_received");
  assert.equal(result.evidence[0].direction, "inbound");
  assert.equal(result.evidence[0].messageId, "msg-inbound-1");
});

test("messaging inbox truth surface is quiet only after an explicit checked empty thread run", () => {
  const result = reconcileLinkedinMessagingInboxSurface({
    row: buildMessagingInboxRow(),
    observations: [],
    checkedAt,
  });

  assert.equal(result.capabilityKey, "linkedin-messaging-inbox");
  assert.equal(result.owner, LINKEDIN_PRIVATE_MESSAGE_RECONCILIATION_OWNER);
  assert.equal(result.state, CAPABILITY_SEAM_STATES.QUIET);
  assert.equal(result.quiet, true);
  assert.equal(result.checked, true);
  assert.equal(result.requiresAction, false);
  assert.equal(result.reason, "linkedin_messaging_inbox_thread_quiet");
});

test("missing messaging proof is explicit when no inbox proof surface can be checked", () => {
  const result = reconcileLinkedinPrivateMessageMutation({
    row: buildDirectMessageRow(),
    actionKey: "send_direct_message",
    resultKey: "sent",
    surface: "inbound_reply",
    prospectId: "prospect-1",
    occurredAt: sentAt,
    missingProofSurfaces: ["linkedin-messaging-inbox"],
    observations: [],
  });

  assert.equal(result.state, CAPABILITY_SEAM_STATES.MISSING_PROOF);
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.requiresAction, true);
  assert.deepEqual(result.missingProofSurfaces, ["linkedin-messaging-inbox"]);
  assert.equal(result.reason, "linkedin_messaging_inbox_proof_missing");
  assert.equal(result.debt.surfaceStatus, "missing");
});

function buildDirectMessageRow() {
  return buildSeamRegistryRow({
    id: "action:send_direct_message",
    kind: "mutation_action",
    service: "linkedin",
    capabilityKey: "send_direct_message",
    label: "Send Direct Message",
    actionKey: "send_direct_message",
    reconcile: { owner: LINKEDIN_PRIVATE_MESSAGE_RECONCILIATION_OWNER },
    proofSurfaces: ["linkedin-messaging-inbox"],
    stateKeys: ["messaging.message_sent", "messaging.message_received"],
    reconciliationStrategy: "linkedin-private-message-thread-proof",
    mutationDebtPolicy: "pending external proof until linkedin-messaging-inbox confirms the thread update",
  });
}

function buildMessagingInboxRow() {
  return buildSeamRegistryRow({
    id: "surface:linkedin-messaging-inbox",
    kind: "inbound_truth_surface",
    service: "linkedin",
    capabilityKey: "linkedin-messaging-inbox",
    label: "LinkedIn Messaging Inbox",
    surfaceKey: "linkedin-messaging-inbox",
    reconcile: { owner: LINKEDIN_PRIVATE_MESSAGE_RECONCILIATION_OWNER },
    proofSurfaces: ["linkedin-messaging-inbox"],
    stateKeys: ["message_received", "thread_updated", "inbound_reply_received"],
    syncStrategy: "managed-connector-linkedin-messaging-inbox",
    reconciliationStrategy: "linkedin-private-message-thread-proof",
    mutationDebtPolicy: "surface-observations-can-confirm-or-clear-direct-message-debt",
  });
}

function buildMessagingObservation(overrides = {}) {
  return {
    id: "obs-thread-1",
    surfaceKey: "linkedin-messaging-inbox",
    kind: "thread_updated",
    observedAt: "2026-06-13T14:03:00.000Z",
    externalId: "thread-1",
    prospectId: "prospect-1",
    actorName: "Alicia Buyer",
    actorHandle: "alicia-buyer",
    actorProfileUrl: "https://www.linkedin.com/in/alicia-buyer/",
    actorLinkedinPublicId: "alicia-buyer",
    actorLinkedinMemberId: "member-1",
    threadUrl: "https://www.linkedin.com/messaging/thread/thread-1/",
    messages: [],
    ...overrides,
  };
}
