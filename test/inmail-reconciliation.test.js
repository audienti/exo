// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_SEAM_STATES,
} from "../src/core/capability-seam-contract.js";
import {
  INMAIL_RECONCILIATION_OWNER,
  reconcileInmailInboxSurface,
  reconcileInmailMutation,
} from "../src/core/inmail-reconciliation.js";
import { buildSeamRegistryRow } from "./support/capability-seam-fixtures.js";

const checkedAt = "2026-06-13T15:00:00.000Z";

test("InMail entitlement missing is unavailable without pretending proof was checked", () => {
  const result = reconcileInmailMutation({
    row: buildInmailActionRow(),
    actionKey: "in_mail_message",
    resultKey: "unavailable",
    surface: "in_mail_message",
    entitlement: {
      available: false,
      reason: "no_inmail_credits",
    },
    checkedAt,
  });

  assert.equal(result.capabilityKey, "in_mail_message");
  assert.equal(result.owner, INMAIL_RECONCILIATION_OWNER);
  assert.equal(result.state, CAPABILITY_SEAM_STATES.UNSUPPORTED);
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.supported, false);
  assert.equal(result.requiresAction, false);
  assert.deepEqual(result.proofSurfaces, ["linkedin-inmail-sent", "linkedin-inmail-inbox"]);
  assert.deepEqual(result.missingProofSurfaces, []);
  assert.equal(result.reason, "inmail_entitlement_missing");
  assert.equal(result.checkedAt, checkedAt);
  assert.equal(result.debt.entitlementStatus, "missing");
});

test("InMail sent proof is missing when the proof surfaces are unavailable", () => {
  const result = reconcileInmailMutation({
    row: buildInmailActionRow(),
    actionKey: "in_mail_message",
    resultKey: "sent",
    surface: "in_mail_message",
    occurredAt: "2026-06-13T14:30:00.000Z",
    missingProofSurfaces: ["linkedin-inmail-sent", "linkedin-inmail-inbox"],
  });

  assert.equal(result.state, CAPABILITY_SEAM_STATES.MISSING_PROOF);
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.requiresAction, true);
  assert.deepEqual(result.missingProofSurfaces, ["linkedin-inmail-sent", "linkedin-inmail-inbox"]);
  assert.equal(result.reason, "inmail_sent_proof_surfaces_missing");
  assert.equal(result.debt.surfaceStatus, "missing");
});

test("InMail sent writeback remains pending proof without marking the seam checked", () => {
  const result = reconcileInmailMutation({
    row: buildInmailActionRow(),
    actionKey: "in_mail_message",
    resultKey: "sent",
    surface: "in_mail_message",
    occurredAt: "2026-06-13T14:30:00.000Z",
    entitlement: {
      available: true,
      reason: "operator_reported_credit_available",
    },
    proofFacts: [],
  });

  assert.equal(result.state, CAPABILITY_SEAM_STATES.PENDING_PROOF);
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.requiresAction, true);
  assert.deepEqual(result.missingProofSurfaces, []);
  assert.equal(result.reason, "inmail_external_proof_pending");
  assert.equal(result.debt.externalState, "inmail_sent");
});

test("unsupported InMail inbox stays unsupported instead of quiet", () => {
  const result = reconcileInmailInboxSurface({
    row: buildInmailInboxRow(),
    checkedAt,
  });

  assert.equal(result.capabilityKey, "linkedin-inmail-inbox");
  assert.equal(result.owner, INMAIL_RECONCILIATION_OWNER);
  assert.equal(result.state, CAPABILITY_SEAM_STATES.UNSUPPORTED);
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.supported, false);
  assert.equal(result.requiresAction, false);
  assert.deepEqual(result.proofSurfaces, ["linkedin-inmail-inbox"]);
  assert.equal(result.reason, "inmail_inbox_surface_unsupported");
  assert.equal(result.debt.surfaceKey, "linkedin-inmail-inbox");
});

function buildInmailActionRow() {
  return buildSeamRegistryRow({
    id: "action:in_mail_message",
    kind: "mutation_action",
    service: "linkedin",
    capabilityKey: "in_mail_message",
    label: "Send LinkedIn InMail",
    actionKey: "in_mail_message",
    reconcile: { owner: INMAIL_RECONCILIATION_OWNER },
    proofSurfaces: ["linkedin-inmail-sent", "linkedin-inmail-inbox"],
    stateKeys: ["action.profile.in_mail_message", "messaging.message_received"],
    reconciliationStrategy: "inmail-entitlement-and-thread-proof",
    mutationDebtPolicy: "pending external proof, but current InMail proof surfaces are missing",
  });
}

function buildInmailInboxRow() {
  return buildSeamRegistryRow({
    id: "surface:linkedin-inmail-inbox",
    kind: "inbound_truth_surface",
    service: "linkedin",
    capabilityKey: "linkedin-inmail-inbox",
    label: "LinkedIn InMail Inbox",
    surfaceKey: "linkedin-inmail-inbox",
    reconcile: { owner: INMAIL_RECONCILIATION_OWNER },
    proofSurfaces: ["linkedin-inmail-inbox"],
    stateKeys: ["inmail_reply_received", "inmail_thread_updated"],
    syncStrategy: "unsupported-until-inmail-inbox-capture-exists",
    reconciliationStrategy: "inmail-entitlement-and-thread-proof",
    mutationDebtPolicy: "unsupported until InMail inbox proof is available",
  });
}
