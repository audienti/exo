// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyConnectionRequestProfileStatus,
  CONNECTION_REQUEST_RECONCILIATION_REQUIRED_REASON,
  shouldQueueConnectionRequestStatusReconciliation,
  summarizeSentInvitationSurfaceReconciliation,
} from "../src/core/connection-request-reconciliation.js";
import { buildInboundReviewView } from "../src/core/build-inbound-review-view.js";

const timestamp = "2026-06-06T12:00:00.000Z";

test("sent invitation surface is not quiet while disappeared invites still need reconciliation", () => {
  const summary = summarizeSentInvitationSurfaceReconciliation({
    surface: {
      key: "linkedin-sent-invitations",
      lastRunStatus: "success",
      lastItemCount: 0,
      lastVisibleTotalCount: 0,
      lastCaptureCompleteness: "complete",
      lastExhaustionStatus: "complete",
      lastReconcileRequired: false,
    },
    observations: [
      {
        id: "obs-disappeared",
        kind: "connection_request_no_longer_pending",
        actorLinkedinPublicId: "dana-disappeared",
        observedAt: "2026-06-05T00:00:00.000Z",
      },
    ],
  });

  assert.equal(summary.quiet, false);
  assert.equal(summary.reconcileRequired, true);
  assert.equal(summary.reason, "unresolved_connection_request_reconciliation");
  assert.equal(summary.unresolvedObservationCount, 1);
});

test("sent invitation surface can be quiet when zero-item sync has no unresolved connection requests", () => {
  const summary = summarizeSentInvitationSurfaceReconciliation({
    surface: {
      key: "linkedin-sent-invitations",
      lastRunStatus: "success",
      lastItemCount: 0,
      lastVisibleTotalCount: 0,
      lastCaptureCompleteness: "complete",
      lastExhaustionStatus: "complete",
      lastReconcileRequired: false,
    },
    observations: [],
  });

  assert.equal(summary.quiet, true);
  assert.equal(summary.reconcileRequired, false);
  assert.equal(summary.reason, null);
});

test("connection request status reconciliation only queues disappeared sent invites with profile identity", () => {
  assert.equal(
    shouldQueueConnectionRequestStatusReconciliation({
      kind: "connection_request_no_longer_pending",
      actorLinkedinPublicId: "dana-disappeared",
    }),
    true,
  );

  assert.equal(
    shouldQueueConnectionRequestStatusReconciliation({
      kind: "connection_request_no_longer_pending",
      actorProfileUrl: "https://www.linkedin.com/in/dana-disappeared/",
    }),
    true,
  );

  assert.equal(
    shouldQueueConnectionRequestStatusReconciliation({
      kind: "connection_request_no_longer_pending",
    }),
    false,
  );

  assert.equal(
    shouldQueueConnectionRequestStatusReconciliation({
      kind: "connection_request_pending",
      actorLinkedinPublicId: "dana-disappeared",
    }),
    false,
  );
});

test("connection request profile status classification is owned outside Unipile maintenance", () => {
  assert.deepEqual(
    classifyConnectionRequestProfileStatus({
      network_distance: "FIRST_DEGREE",
      is_relationship: true,
      invitation: { status: "ACCEPTED" },
    }),
    {
      nextKind: "connection_request_accepted",
      profileStatus: {
        networkDistance: "FIRST_DEGREE",
        isRelationship: true,
        invitationType: null,
        invitationStatus: "ACCEPTED",
      },
    },
  );

  assert.deepEqual(
    classifyConnectionRequestProfileStatus({
      is_relationship: false,
      invitation: { type: "SENT", status: "PENDING" },
    }),
    {
      nextKind: "connection_request_pending",
      profileStatus: {
        networkDistance: null,
        isRelationship: false,
        invitationType: "SENT",
        invitationStatus: "PENDING",
      },
    },
  );

  assert.deepEqual(
    classifyConnectionRequestProfileStatus({
      network_distance: "SECOND_DEGREE",
      is_relationship: false,
      invitation: { status: "EXPIRED" },
    }),
    {
      nextKind: "connection_request_not_accepted",
      profileStatus: {
        networkDistance: "SECOND_DEGREE",
        isRelationship: false,
        invitationType: null,
        invitationStatus: "EXPIRED",
      },
    },
  );
});

test("inbound review does not summarize sent invitations as quiet with unresolved connection requests", () => {
  const review = buildInboundReviewView(
    buildUser(),
    [
      buildObservation({
        id: "obs-disappeared",
        kind: "connection_request_no_longer_pending",
        actorLinkedinPublicId: "dana-disappeared",
      }),
    ],
    [],
    [],
  );

  const sentInvitations = review.surfaces.accounts[0].surfaces.find((surface) =>
    surface.key === "linkedin-sent-invitations"
  );

  assert.ok(sentInvitations);
  assert.equal(sentInvitations.lastReconcileRequired, true);
  assert.equal(sentInvitations.lastReconcileReason, CONNECTION_REQUEST_RECONCILIATION_REQUIRED_REASON);
  assert.match(sentInvitations.summary, /unresolved connection-request reconciliation/i);
  assert.doesNotMatch(sentInvitations.summary, /currently quiet/i);
});

function buildUser() {
  return {
    id: "user-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    label: "william-main",
    owner: "William",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00",
    },
    accounts: [
      {
        id: "account-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        capability: "linkedin",
        handle: "william-main",
        label: "LinkedIn via Unipile",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        providerAccountId: "provider-linkedin-1",
        preferred: true,
        automationControls: {
          weeklyQuotas: {
            profileVisits: null,
            invitations: null,
            messages: null,
          },
        },
        notes: null,
        metadata: null,
        inboundSync: {
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              enabled: true,
              lastRunStatus: "success",
              lastSyncedAt: timestamp,
              lastObservedAt: timestamp,
              lastItemCount: 0,
              lastVisibleTotalCount: 0,
              lastCaptureCompleteness: "complete",
              lastRequestedMode: "full",
              lastActualMode: "full",
              lastReconcileRequired: false,
              lastReconcileReason: null,
              lastExhaustionStatus: "complete",
              lastExhaustionReason: null,
              lastPaginationAttempted: true,
              lastTerminalSignalSeen: true,
              lastStalledPassCount: 0,
              continuationStartedAt: null,
              nextCursor: null,
              nextStartOffset: null,
              lastObservationCount: 0,
              lastItemizationGapCount: 0,
              lastCountDiscrepancyCount: 0,
              lastError: null,
            },
          ],
        },
      },
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        runtime: "codex",
        connector: "unipile",
        label: "codex:unipile",
        status: "available",
        notes: null,
      },
    ],
    inboundIgnoreRules: [],
  };
}

function buildObservation(overrides = {}) {
  return {
    id: "observation-1",
    dedupeKey: "account-1:linkedin-sent-invitations:invite-1",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    platform: "linkedin",
    surfaceKey: "linkedin-sent-invitations",
    kind: "connection_request_no_longer_pending",
    truthLevel: "authoritative",
    observedAt: timestamp,
    recordedAt: timestamp,
    eventAt: null,
    externalId: "invite-1",
    actorName: "Dana Disappeared",
    actorTitle: "VP Revenue Operations",
    actorCompanyName: "BuyerCo",
    actorHandle: "dana-disappeared",
    actorProfileUrl: "https://www.linkedin.com/in/dana-disappeared/",
    actorLinkedinPublicId: "dana-disappeared",
    actorLinkedinMemberId: "member-1",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: null,
    sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
    subject: null,
    summary: "Dana Disappeared is no longer pending in the live sent list.",
    motionId: null,
    companyId: null,
    prospectId: null,
    providerSharedSecret: null,
    notes: null,
    messages: [],
    ...overrides,
  };
}
