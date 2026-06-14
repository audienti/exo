// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  EMAIL_SEND_RECONCILIATION_OWNER,
  buildEmailSendMutationReconciliation,
  reconcileEmailSendDebt,
} from "../src/core/email-send-reconciliation.js";
import { buildSeamRegistryRow } from "./support/capability-seam-fixtures.js";

const localSend = {
  actionKey: "send_email",
  resultKey: "sent",
  surface: "email",
  motionId: "motion-1",
  companyId: "company-1",
  prospectId: "prospect-1",
  recipientEmail: "alicia@buyer.example",
  occurredAt: "2026-06-04T16:00:00.000Z",
};

test("buildEmailSendMutationReconciliation records local sends as pending external Gmail proof", () => {
  assert.deepEqual(
    buildEmailSendMutationReconciliation({
      actionKey: "send_email",
      resultKey: "sent",
      surface: "email",
      observationId: null,
    }),
    {
      state: "pending_external_proof",
      owner: EMAIL_SEND_RECONCILIATION_OWNER,
      actionKey: "send_email",
      resultKey: "sent",
      surface: "email",
      proofSurface: null,
      missingProofSurface: "gmail-sent-mail",
      externalState: "email_sent",
      reason: "send_email_recorded_waiting_for_gmail_proof",
      observationId: null,
      clearedBy: null,
    },
  );
});

test("reconcileEmailSendDebt keeps a local send pending until Gmail proof is checked", () => {
  const result = reconcileEmailSendDebt({
    row: buildSeamRegistryRow(),
    localSend,
    sentMailProofs: [],
    threadObservations: [],
    checkedAt: "2026-06-04T16:05:00.000Z",
  });

  assert.equal(result.capabilityKey, "send_email");
  assert.equal(result.owner, EMAIL_SEND_RECONCILIATION_OWNER);
  assert.equal(result.state, "pending_proof");
  assert.equal(result.requiresAction, true);
  assert.deepEqual(result.missingProofSurfaces, []);
  assert.deepEqual(result.debt.awaitingProofSurfaces, ["gmail-sent-mail", "gmail-inbox-threads"]);
  assert.equal(result.debt.localState, "email_sent");
});

test("reconcileEmailSendDebt makes checked-but-absent Gmail sent-mail proof explicit", () => {
  const result = reconcileEmailSendDebt({
    row: buildSeamRegistryRow(),
    localSend,
    sentMailProofs: [],
    sentMailSurface: {
      supported: true,
      lastRunStatus: "success",
      lastSyncedAt: "2026-06-04T16:06:00.000Z",
      lastItemCount: 0,
    },
  });

  assert.equal(result.state, "missing_proof");
  assert.equal(result.reason, "gmail_sent_mail_proof_missing_after_checked_surface");
  assert.equal(result.requiresAction, true);
  assert.deepEqual(result.missingProofSurfaces, ["gmail-sent-mail"]);
  assert.equal(result.debt.kind, "sent_mail_proof_missing");
  assert.equal(result.debt.localState, "email_sent");
});

test("reconcileEmailSendDebt reports unsupported sent-mail proof as explicit reconciliation debt", () => {
  const result = reconcileEmailSendDebt({
    row: buildSeamRegistryRow(),
    localSend,
    sentMailProofs: [],
    sentMailSurface: {
      supported: false,
      lastRunStatus: "failed",
      lastSyncedAt: "2026-06-04T16:06:00.000Z",
      lastExhaustionReason: "connector_surface_unsupported",
    },
  });

  assert.equal(result.state, "unsupported");
  assert.equal(result.supported, false);
  assert.equal(result.reason, "gmail_sent_mail_proof_unsupported");
  assert.deepEqual(result.debt.unsupportedProofSurfaces, ["gmail-sent-mail"]);
  assert.equal(result.debt.kind, "sent_mail_proof_unsupported");
});

test("reconcileEmailSendDebt reconciles local email debt when sent-mail proof is observed", () => {
  const result = reconcileEmailSendDebt({
    row: buildSeamRegistryRow(),
    localSend,
    sentMailProofs: [
      {
        surfaceKey: "gmail-sent-mail",
        externalId: "gmail-msg-1",
        recipientEmail: "alicia@buyer.example",
        sentAt: "2026-06-04T16:00:03.000Z",
      },
    ],
    checkedAt: "2026-06-04T16:06:00.000Z",
  });

  assert.equal(result.state, "reconciled");
  assert.equal(result.checked, true);
  assert.equal(result.reason, "gmail_sent_mail_proof_observed");
  assert.deepEqual(result.evidence, [
    {
      surface: "gmail-sent-mail",
      externalId: "gmail-msg-1",
      observedAt: "2026-06-04T16:00:03.000Z",
    },
  ]);
  assert.equal(result.debt.kind, "cleared_by_sent_mail_proof");
});
