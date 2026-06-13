// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  GMAIL_THREAD_RECONCILIATION_OWNER,
  reconcileGmailThreadTruth,
} from "../src/core/gmail-thread-reconciliation.js";
import { buildSeamRegistryRow } from "./support/capability-seam-fixtures.js";

const threadRow = buildSeamRegistryRow({
  id: "surface:gmail-inbox-threads",
  kind: "inbound_surface",
  service: "gmail",
  capabilityKey: "gmail-inbox-threads",
  actionKey: null,
  sync: { owner: "src/core/user-inbound-sync.js" },
  reconcile: { owner: GMAIL_THREAD_RECONCILIATION_OWNER },
  mutate: { owner: null },
  status: {
    sync: "partial",
    reconcile: "missing",
    mutate: "n/a",
  },
  proofSurfaces: ["gmail-inbox-threads"],
  stateKeys: ["email_reply_received", "email_thread_updated"],
  syncStrategy: "connector-itemized-truth-sync",
  reconciliationStrategy: "gmail-thread-identity-reconciliation",
  mutationDebtPolicy: "not-applicable",
  gap: "Gmail inbox threads need a pure owner that can resolve local waiting state.",
});

test("reconcileGmailThreadTruth resolves local waiting state when an inbound Gmail reply is observed", () => {
  const result = reconcileGmailThreadTruth({
    row: threadRow,
    localWaitingSends: [
      {
        actionKey: "send_email",
        resultKey: "sent",
        motionId: "motion-1",
        companyId: "company-1",
        prospectId: "prospect-1",
        recipientEmail: "alicia@buyer.example",
        occurredAt: "2026-06-04T16:00:00.000Z",
      },
    ],
    observations: [
      {
        id: "obs-gmail-reply",
        surfaceKey: "gmail-inbox-threads",
        kind: "email_reply_received",
        observedAt: "2026-06-04T16:18:00.000Z",
        externalId: "thread-1",
        actorHandle: "alicia@buyer.example",
        motionId: "motion-1",
        companyId: "company-1",
        prospectId: "prospect-1",
        messages: [
          {
            id: "outbound-1",
            direction: "outbound",
            sentAt: "2026-06-04T16:00:03.000Z",
            fromHandle: "william@example.com",
            body: "Here is the workflow overview.",
          },
          {
            id: "inbound-1",
            direction: "inbound",
            sentAt: "2026-06-04T16:17:00.000Z",
            fromHandle: "alicia@buyer.example",
            body: "Thanks, this helps.",
          },
        ],
      },
    ],
    checkedAt: "2026-06-04T16:20:00.000Z",
  });

  assert.equal(result.capabilityKey, "gmail-inbox-threads");
  assert.equal(result.owner, GMAIL_THREAD_RECONCILIATION_OWNER);
  assert.equal(result.state, "reconciled");
  assert.equal(result.reason, "inbound_gmail_reply_overrides_local_waiting_state");
  assert.equal(result.debt.kind, "local_waiting_overridden_by_inbound_reply");
  assert.equal(result.debt.localWaitingCount, 1);
  assert.deepEqual(result.evidence, [
    {
      surface: "gmail-inbox-threads",
      externalId: "thread-1",
      observedAt: "2026-06-04T16:18:00.000Z",
      kind: "email_reply_received",
    },
  ]);
});

test("reconcileGmailThreadTruth treats fresh complete zero-item thread sync as quiet", () => {
  const result = reconcileGmailThreadTruth({
    row: threadRow,
    surface: {
      surfaceKey: "gmail-inbox-threads",
      lastRunStatus: "success",
      lastSyncedAt: "2026-06-04T16:20:00.000Z",
      lastObservedAt: null,
      lastItemCount: 0,
      lastCaptureCompleteness: "complete",
      lastExhaustionStatus: "complete",
    },
    observations: [],
    now: "2026-06-04T16:25:00.000Z",
    staleAfterMs: 60 * 60 * 1000,
  });

  assert.equal(result.state, "quiet");
  assert.equal(result.checked, true);
  assert.equal(result.reason, "fresh_gmail_thread_sync_quiet");
  assert.equal(result.checkedAt, "2026-06-04T16:20:00.000Z");
  assert.equal(result.debt.kind, "none");
});

test("reconcileGmailThreadTruth classifies old Gmail thread checks as stale proof", () => {
  const result = reconcileGmailThreadTruth({
    row: threadRow,
    surface: {
      surfaceKey: "gmail-inbox-threads",
      lastRunStatus: "success",
      lastSyncedAt: "2026-06-04T12:00:00.000Z",
      lastObservedAt: null,
      lastItemCount: 0,
      lastCaptureCompleteness: "complete",
      lastExhaustionStatus: "complete",
    },
    observations: [],
    now: "2026-06-04T16:25:00.000Z",
    staleAfterMs: 60 * 60 * 1000,
  });

  assert.equal(result.state, "stale");
  assert.equal(result.requiresAction, true);
  assert.equal(result.reason, "gmail_thread_truth_stale");
  assert.equal(result.debt.kind, "thread_truth_stale");
  assert.equal(result.debt.lastCheckedAt, "2026-06-04T12:00:00.000Z");
});
