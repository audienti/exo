// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyLinkedinMaintenanceConnectorResult,
  buildLinkedinMaintenanceHandoff,
  runLinkedinSendWithUnipile,
  runLinkedinMaintenanceWithUnipile,
} from "../src/lib/linkedin-unipile-maintenance.js";
import { INBOUND_SURFACE_MIXED_BASELINE_REASON } from "../src/core/user-inbound-sync.js";

const timestamp = "2026-06-06T12:00:00.000Z";
const TEST_UNIPILE_BASE_URL = "https://api14.unipile.com:14465";

function buildUser(overrides = {}) {
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
        inboundSync: {
          surfaces: [],
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
    ...overrides,
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
    kind: "connection_request_pending",
    truthLevel: "authoritative",
    observedAt: timestamp,
    recordedAt: timestamp,
    eventAt: null,
    externalId: "invite-1",
    actorName: "Jordan Example",
    actorTitle: "VP Revenue Operations",
    actorCompanyName: "BuyerCo",
    actorHandle: "jordan-example",
    actorProfileUrl: "https://www.linkedin.com/in/jordan-example/",
    actorLinkedinPublicId: "jordan-example",
    actorLinkedinMemberId: "member-1",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: null,
    sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
    subject: null,
    summary: "Jordan Example is still pending on LinkedIn.",
    motionId: null,
    companyId: null,
    prospectId: null,
    providerSharedSecret: null,
    notes: null,
    messages: [],
    ...overrides,
  };
}

test("runLinkedinMaintenanceWithUnipile withdraws a stale invite through Unipile", () => {
  let seenUrl = null;
  const result = runLinkedinMaintenanceWithUnipile(
    {
      kind: "withdraw_connection",
      observationId: "observation-1",
    },
    {
      findObservationById: () => buildObservation(),
      findUserById: () => buildUser(),
      baseUrl: TEST_UNIPILE_BASE_URL,
      httpDeleteImpl: (url) => {
        seenUrl = new URL(url);
        return {
          status: 200,
          bodyText: JSON.stringify({
            object: "InvitationCanceled",
            provider: "LINKEDIN",
          }),
        };
      },
    },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.provider, "unipile");
  assert.equal(seenUrl?.pathname, "/api/v1/users/invite/sent/invite-1");
  assert.equal(seenUrl?.searchParams.get("account_id"), "provider-linkedin-1");
});

test("buildLinkedinMaintenanceHandoff emits a connector-native HAR request for stale invite withdrawal", () => {
  const result = buildLinkedinMaintenanceHandoff(
    {
      kind: "withdraw_connection",
      observationId: "observation-1",
    },
    {
      findObservationById: () => buildObservation(),
      findUserById: () => buildUser(),
      baseUrl: "https://api14.unipile.com:14465",
    },
  );

  assert.equal(result.status, "ready");
  assert.equal(result.provider, "unipile");
  assert.equal(result.connector, "codex:unipile");
  assert.equal(result.writebackMode, "task_writeback_after_completion");
  assert.equal(result.harRequest.method, "DELETE");
  assert.equal(result.harRequest.url, "https://api14.unipile.com:14465/api/v1/users/invite/sent/invite-1");
  assert.deepEqual(result.harRequest.queryString, [
    { name: "account_id", value: "provider-linkedin-1" },
  ]);
  assert.deepEqual(result.harRequest.headers, [
    { name: "accept", value: "application/json" },
  ]);
  assert.equal(result.executionPolicy.sameCredentialHttpFallbackAllowed, true);
  assert.equal(result.executionPolicy.sameCredentialHttpFallbackCredentialSource, "codex_unipile_config");
  assert.equal(result.executionPolicy.sameCredentialHttpFallbackAccountId, "provider-linkedin-1");
});

test("runLinkedinMaintenanceWithUnipile blocks unstubbed direct HTTP by default", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-linkedin-maintenance-direct-disabled-"));
  const codexHome = path.join(tempDir, ".codex");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    "[mcp_servers.unipile.env]",
    'UNIPILE_API_KEY = "test-key"',
    'UNIPILE_DSN = "https://api14.unipile.com:14465"',
    "",
  ].join("\n"));

  try {
    const result = runLinkedinMaintenanceWithUnipile(
      {
        kind: "withdraw_connection",
        observationId: "observation-1",
      },
      {
        codexHome,
        findObservationById: () => buildObservation(),
        findUserById: () => buildUser(),
      },
    );

    assert.equal(result.status, "blocked");
    assert.match(result.reason ?? "", /Direct Unipile HTTP is disabled/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runLinkedinMaintenanceWithUnipile blocks unsupported maintenance kinds without HTTP", () => {
  let httpCalled = false;
  const result = runLinkedinMaintenanceWithUnipile(
    {
      kind: "unsupported_maintenance",
      observationId: "observation-1",
    },
    {
      findObservationById: () => buildObservation(),
      findUserById: () => buildUser(),
      baseUrl: TEST_UNIPILE_BASE_URL,
      httpPostImpl: () => {
        httpCalled = true;
        return {
          status: 200,
          bodyText: "{}",
        };
      },
    },
  );

  assert.equal(result.status, "blocked");
  assert.match(result.reason ?? "", /Unsupported LinkedIn maintenance task kind/);
  assert.equal(httpCalled, false);
});

test("runLinkedinSendWithUnipile sends a connection invitation through Unipile", () => {
  let seenRequest = null;
  const result = runLinkedinSendWithUnipile(
    {
      action: "send_connection_request",
      channel: "linkedin",
      senderAccount: {
        providerAccountId: "provider-linkedin-1",
      },
      recipient: {
        name: "Jordan Example",
        providerId: "provider-jordan",
        profileUrl: "https://www.linkedin.com/in/jordan-example/",
      },
      message: "Jordan, worth connecting given your RevOps work.",
    },
    {
      baseUrl: TEST_UNIPILE_BASE_URL,
      apiKey: "test-key",
      httpPostImpl: (url, _headers, bodyText) => {
        seenRequest = {
          url,
          body: JSON.parse(bodyText),
        };
        return {
          status: 201,
          bodyText: JSON.stringify({
            object: "InvitationSent",
            id: "invite-123",
          }),
        };
      },
    },
  );

  assert.equal(result.status, "sent");
  assert.equal(result.provider, "unipile");
  assert.equal(result.responseStatus, 201);
  assert.equal(new URL(seenRequest?.url ?? "").pathname, "/api/v1/users/invite");
  assert.deepEqual(seenRequest?.body, {
    provider_id: "provider-jordan",
    account_id: "provider-linkedin-1",
    message: "Jordan, worth connecting given your RevOps work.",
  });
});

test("runLinkedinSendWithUnipile returns provider failure without local writeback semantics", () => {
  const result = runLinkedinSendWithUnipile(
    {
      action: "send_connection_request",
      channel: "linkedin",
      senderAccount: {
        providerAccountId: "provider-linkedin-1",
      },
      recipient: {
        providerId: "provider-jordan",
      },
      message: "Hello.",
    },
    {
      baseUrl: TEST_UNIPILE_BASE_URL,
      apiKey: "test-key",
      httpPostImpl: () => ({
        status: 429,
        bodyText: JSON.stringify({
          message: "Provider rate limit",
        }),
      }),
    },
  );

  assert.equal(result.status, "blocked");
  assert.equal(result.provider, "unipile");
  assert.equal(result.responseStatus, 429);
  assert.match(result.reason ?? "", /send_connection_request through Unipile failed \(HTTP 429\): Provider rate limit/i);
});

test("runLinkedinSendWithUnipile reacts to a LinkedIn post through Unipile", () => {
  const seenRequests = [];
  const result = runLinkedinSendWithUnipile(
    {
      action: "like_post",
      channel: "linkedin",
      connector: "codex:unipile",
      senderAccount: {
        providerAccountId: "provider-linkedin-1",
      },
      publicTarget: {
        url: "https://www.linkedin.com/posts/unipile_nocode-automation-solopreneurs-activity-7332661864792854528-hcGT",
        targetKind: "post",
      },
    },
    {
      baseUrl: TEST_UNIPILE_BASE_URL,
      apiKey: "test-key",
      httpGetImpl: (url) => {
        seenRequests.push({ method: "GET", url });
        return {
          status: 200,
          bodyText: JSON.stringify({
            object: "Post",
            social_id: "urn:li:activity:7332661864792854528",
            permissions: {
              can_react: true,
            },
          }),
        };
      },
      httpPostImpl: (url, _headers, bodyText) => {
        seenRequests.push({ method: "POST", url, body: JSON.parse(bodyText) });
        return {
          status: 201,
          bodyText: JSON.stringify({
            object: "Reaction",
            id: "reaction-1",
          }),
        };
      },
    },
  );

  assert.equal(result.status, "sent");
  assert.equal(result.provider, "unipile");
  assert.equal(result.responseStatus, 201);
  assert.equal(result.usedTargetUrl, "https://www.linkedin.com/posts/unipile_nocode-automation-solopreneurs-activity-7332661864792854528-hcGT");
  assert.equal(new URL(seenRequests[0]?.url ?? "").pathname, "/api/v1/posts/7332661864792854528");
  assert.equal(new URL(seenRequests[0]?.url ?? "").searchParams.get("account_id"), "provider-linkedin-1");
  assert.equal(new URL(seenRequests[1]?.url ?? "").pathname, "/api/v1/posts/reaction");
  assert.deepEqual(seenRequests[1]?.body, {
    account_id: "provider-linkedin-1",
    post_id: "urn:li:activity:7332661864792854528",
    reaction_type: "like",
  });
});

test("runLinkedinSendWithUnipile resolves and reacts to a LinkedIn comment through Unipile", () => {
  const seenRequests = [];
  const result = runLinkedinSendWithUnipile(
    {
      action: "create_comment_reaction",
      channel: "linkedin",
      connector: "codex:unipile",
      senderAccount: {
        providerAccountId: "provider-linkedin-1",
      },
      publicTarget: {
        url: "https://www.linkedin.com/posts/unipile_nocode-automation-solopreneurs-activity-7332661864792854528-hcGT",
        targetKind: "comment",
        summary: "Commented asking for an email contact for courier services.",
        snippet: "Asked for an email contact for a courier services business opportunity.",
      },
    },
    {
      baseUrl: TEST_UNIPILE_BASE_URL,
      apiKey: "test-key",
      httpGetImpl: (url) => {
        seenRequests.push({ method: "GET", url });
        if (new URL(url).pathname.endsWith("/comments")) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              object: "CommentList",
              items: [
                {
                  id: "comment-not-it",
                  text: "Great team in BNE!",
                },
                {
                  id: "comment-target-1",
                  text: "Kindly share mail ID need to connect for business opportunity with our company for courier services.",
                },
              ],
            }),
          };
        }
        return {
          status: 200,
          bodyText: JSON.stringify({
            object: "Post",
            social_id: "urn:li:activity:7332661864792854528",
            permissions: {
              can_react: true,
            },
          }),
        };
      },
      httpPostImpl: (url, _headers, bodyText) => {
        seenRequests.push({ method: "POST", url, body: JSON.parse(bodyText) });
        return {
          status: 201,
          bodyText: JSON.stringify({
            object: "Reaction",
            id: "reaction-1",
          }),
        };
      },
    },
  );

  assert.equal(result.status, "sent");
  assert.equal(result.commentId, "comment-target-1");
  assert.equal(new URL(seenRequests[1]?.url ?? "").pathname, "/api/v1/posts/urn%3Ali%3Aactivity%3A7332661864792854528/comments");
  assert.deepEqual(seenRequests[2]?.body, {
    account_id: "provider-linkedin-1",
    post_id: "urn:li:activity:7332661864792854528",
    reaction_type: "like",
    comment_id: "comment-target-1",
  });
});

test("runLinkedinSendWithUnipile leaves ambiguous comment reactions to connector handoff", () => {
  const result = runLinkedinSendWithUnipile(
    {
      action: "create_comment_reaction",
      channel: "linkedin",
      connector: "codex:unipile",
      senderAccount: {
        providerAccountId: "provider-linkedin-1",
      },
      publicTarget: {
        url: "https://www.linkedin.com/posts/unipile_nocode-automation-solopreneurs-activity-7332661864792854528-hcGT",
        targetKind: "comment",
        snippet: "Asked about courier services business opportunity.",
      },
    },
    {
      baseUrl: TEST_UNIPILE_BASE_URL,
      apiKey: "test-key",
      httpGetImpl: (url) => {
        if (new URL(url).pathname.endsWith("/comments")) {
          return {
            status: 200,
            bodyText: JSON.stringify({
              items: [
                { id: "comment-1", text: "Courier services business opportunity." },
                { id: "comment-2", text: "Courier services business opportunity." },
              ],
            }),
          };
        }
        return {
          status: 200,
          bodyText: JSON.stringify({
            social_id: "urn:li:activity:7332661864792854528",
            permissions: { can_react: true },
          }),
        };
      },
      httpPostImpl: () => {
        throw new Error("Ambiguous comment resolution must not post a reaction.");
      },
    },
  );

  assert.equal(result.status, "unsupported");
  assert.match(result.reason ?? "", /matched multiple LinkedIn comments/i);
});

test("runLinkedinSendWithUnipile makes missing deterministic config loud before HTTP", () => {
  let httpCalled = false;
  const result = runLinkedinSendWithUnipile(
    {
      action: "send_connection_request",
      channel: "linkedin",
      senderAccount: {
        providerAccountId: "provider-linkedin-1",
      },
      recipient: {
        providerId: "provider-jordan",
      },
    },
    {
      codexHome: "/tmp/nonexistent-exo-codex-home",
      httpPostImpl: () => {
        httpCalled = true;
        return {
          status: 200,
          bodyText: "{}",
        };
      },
    },
  );

  assert.equal(result.status, "blocked");
  assert.match(result.reason ?? "", /requires a configured Unipile base URL/i);
  assert.equal(httpCalled, false);
});

test("runLinkedinSendWithUnipile leaves non-connection sends to connector handoff", () => {
  let httpCalled = false;
  const result = runLinkedinSendWithUnipile(
    {
      action: "send_direct_message",
      channel: "linkedin",
      senderAccount: {
        providerAccountId: "provider-linkedin-1",
      },
      recipient: {
        providerId: "provider-jordan",
      },
    },
    {
      baseUrl: TEST_UNIPILE_BASE_URL,
      apiKey: "test-key",
      httpPostImpl: () => {
        httpCalled = true;
        return {
          status: 200,
          bodyText: "{}",
        };
      },
    },
  );

  assert.equal(result.status, "unsupported");
  assert.match(result.reason ?? "", /supports send_connection_request and resolvable public LinkedIn reactions/i);
  assert.equal(httpCalled, false);
});

test("applyLinkedinMaintenanceConnectorResult records profile reconciliation from MCP response payload", () => {
  let storedObservation = null;
  let storedUser = null;
  const result = applyLinkedinMaintenanceConnectorResult(
    {
      kind: "reconcile_connection_request_status",
      observationId: "observation-1",
    },
    {
      status: "completed",
      responseBody: {
        object: "UserProfile",
        first_name: "Jordan",
        last_name: "Example",
        public_identifier: "jordan-example",
        provider_id: "provider-jordan",
        network_distance: "FIRST_DEGREE",
        is_relationship: true,
        invitation: null,
      },
    },
    {
      findObservationById: () => buildObservation({
        kind: "connection_request_no_longer_pending",
      }),
      findUserById: () => buildUser({
        accounts: [
          {
            ...buildUser().accounts[0],
            inboundSync: {
              surfaces: [
                {
                  surfaceKey: "linkedin-sent-invitations",
                  enabled: true,
                  lastSyncedAt: "2026-06-06T10:00:00.000Z",
                  lastObservedAt: "2026-06-06T10:00:00.000Z",
                  lastRunStatus: "success",
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
      }),
      findObservationByDedupeKey: () => buildObservation({
        kind: "connection_request_no_longer_pending",
      }),
      listMotions: () => [],
      upsertObservation: (observation) => {
        storedObservation = observation;
      },
      updateUser: (user) => {
        storedUser = user;
      },
    },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.resolvedKind, "connection_request_accepted");
  assert.equal(storedObservation?.kind, "connection_request_accepted");
  assert.equal(storedObservation?.summary, "Jordan Example is now a LinkedIn connection.");
  assert.equal(
    storedUser?.accounts?.[0]?.inboundSync?.surfaces?.[0]?.lastReconcileReason,
    INBOUND_SURFACE_MIXED_BASELINE_REASON,
  );
});

test("runLinkedinMaintenanceWithUnipile blocks a reject without shared_secret", () => {
  const result = runLinkedinMaintenanceWithUnipile(
    {
      kind: "reject_connection_request",
      observationId: "observation-1",
    },
    {
      findObservationById: () => buildObservation({
        surfaceKey: "linkedin-received-invitations",
        kind: "connection_request_received",
      }),
      findUserById: () => buildUser(),
      baseUrl: TEST_UNIPILE_BASE_URL,
    },
  );

  assert.equal(result.status, "blocked");
  assert.match(result.reason ?? "", /requires a stored Unipile shared_secret/i);
});

test("runLinkedinMaintenanceWithUnipile accepts a received invite through Unipile", () => {
  let seenRequest = null;
  const result = runLinkedinMaintenanceWithUnipile(
    {
      kind: "accept_connection_request",
      observationId: "observation-1",
    },
    {
      findObservationById: () => buildObservation({
        surfaceKey: "linkedin-received-invitations",
        kind: "connection_request_accept_requested",
        providerSharedSecret: "secret-123",
      }),
      findUserById: () => buildUser(),
      baseUrl: TEST_UNIPILE_BASE_URL,
      httpPostImpl: (url, _headers, bodyText) => {
        seenRequest = {
          url,
          body: JSON.parse(bodyText),
        };
        return {
          status: 200,
          bodyText: JSON.stringify({
            object: "InvitationHandled",
            status: "ACCEPTED",
          }),
        };
      },
    },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.provider, "unipile");
  assert.equal(new URL(seenRequest?.url ?? "").pathname, "/api/v1/users/invite/received/invite-1");
  assert.deepEqual(seenRequest?.body, {
    provider: "LINKEDIN",
    account_id: "provider-linkedin-1",
    shared_secret: "secret-123",
    action: "accept",
  });
});

test("runLinkedinMaintenanceWithUnipile declines a received invite through Unipile", () => {
  let seenRequest = null;
  const result = runLinkedinMaintenanceWithUnipile(
    {
      kind: "reject_connection_request",
      observationId: "observation-1",
    },
    {
      findObservationById: () => buildObservation({
        surfaceKey: "linkedin-received-invitations",
        kind: "connection_request_received",
        providerSharedSecret: "secret-123",
      }),
      findUserById: () => buildUser(),
      baseUrl: TEST_UNIPILE_BASE_URL,
      httpPostImpl: (url, _headers, bodyText) => {
        seenRequest = {
          url,
          body: JSON.parse(bodyText),
        };
        return {
          status: 200,
          bodyText: JSON.stringify({
            object: "InvitationHandled",
            status: "DECLINED",
          }),
        };
      },
    },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.provider, "unipile");
  assert.equal(new URL(seenRequest?.url ?? "").pathname, "/api/v1/users/invite/received/invite-1");
  assert.deepEqual(seenRequest?.body, {
    provider: "LINKEDIN",
    account_id: "provider-linkedin-1",
    shared_secret: "secret-123",
    action: "decline",
  });
});

test("runLinkedinMaintenanceWithUnipile restores a disappeared sent invite when the profile still shows pending", () => {
  let seenUrl = null;
  let storedObservation = null;
  let storedUser = null;
  const result = runLinkedinMaintenanceWithUnipile(
    {
      kind: "reconcile_connection_request_status",
      observationId: "observation-1",
    },
    {
      findObservationById: () => buildObservation({
        kind: "connection_request_no_longer_pending",
      }),
      findUserById: () => buildUser({
        accounts: [
          {
            ...buildUser().accounts[0],
            inboundSync: {
              surfaces: [
                {
                  surfaceKey: "linkedin-sent-invitations",
                  enabled: true,
                  lastSyncedAt: "2026-06-06T10:00:00.000Z",
                  lastObservedAt: "2026-06-06T10:00:00.000Z",
                  lastRunStatus: "success",
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
      }),
      findObservationByDedupeKey: () => buildObservation({
        kind: "connection_request_no_longer_pending",
      }),
      listMotions: () => [],
      upsertObservation: (observation) => {
        storedObservation = observation;
      },
      updateUser: (user) => {
        storedUser = user;
      },
      baseUrl: TEST_UNIPILE_BASE_URL,
      httpGetImpl: (url) => {
        seenUrl = new URL(url);
        return {
          status: 200,
          bodyText: JSON.stringify({
            object: "UserProfile",
            provider_id: "provider-jordan",
            public_identifier: "jordan-example",
            first_name: "Jordan",
            last_name: "Example",
            headline: "VP Revenue Operations",
            network_distance: "THIRD_DEGREE",
            is_relationship: false,
            invitation: {
              type: "SENT",
              status: "PENDING",
            },
          }),
        };
      },
    },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.resolvedKind, "connection_request_pending");
  assert.equal(storedObservation?.kind, "connection_request_pending");
  assert.equal(storedObservation?.summary, "Jordan Example is still pending on LinkedIn.");
  assert.equal(storedObservation?.notes, "LinkedIn still shows the sent connection request as pending.");
  assert.equal(
    storedUser?.accounts?.[0]?.inboundSync?.surfaces?.[0]?.lastReconcileReason,
    INBOUND_SURFACE_MIXED_BASELINE_REASON,
  );
  assert.equal(
    storedUser?.accounts?.[0]?.inboundSync?.surfaces?.[0]?.lastExhaustionReason,
    INBOUND_SURFACE_MIXED_BASELINE_REASON,
  );
  assert.equal(seenUrl?.pathname, "/api/v1/users/jordan-example");
  assert.equal(seenUrl?.searchParams.get("account_id"), "provider-linkedin-1");
});

test("runLinkedinMaintenanceWithUnipile records accepted when profile state is first-degree", () => {
  let storedObservation = null;
  const result = runLinkedinMaintenanceWithUnipile(
    {
      kind: "reconcile_connection_request_status",
      observationId: "observation-1",
    },
    {
      findObservationById: () => buildObservation({
        kind: "connection_request_no_longer_pending",
      }),
      findUserById: () => buildUser(),
      findObservationByDedupeKey: () => buildObservation({
        kind: "connection_request_no_longer_pending",
      }),
      listMotions: () => [],
      upsertObservation: (observation) => {
        storedObservation = observation;
      },
      baseUrl: TEST_UNIPILE_BASE_URL,
      httpGetImpl: () => ({
        status: 200,
        bodyText: JSON.stringify({
          first_name: "Jordan",
          last_name: "Example",
          public_identifier: "jordan-example",
          provider_id: "provider-jordan",
          network_distance: "FIRST_DEGREE",
          is_relationship: true,
          invitation: null,
        }),
      }),
    },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.resolvedKind, "connection_request_accepted");
  assert.equal(storedObservation?.kind, "connection_request_accepted");
  assert.equal(storedObservation?.summary, "Jordan Example is now a LinkedIn connection.");
  assert.equal(storedObservation?.notes, "LinkedIn shows this person is now a 1st-degree connection.");
});

test("runLinkedinMaintenanceWithUnipile records not accepted when profile is not connected and no sent invite is pending", () => {
  let storedObservation = null;
  const result = runLinkedinMaintenanceWithUnipile(
    {
      kind: "reconcile_connection_request_status",
      observationId: "observation-1",
    },
    {
      findObservationById: () => buildObservation({
        kind: "connection_request_no_longer_pending",
      }),
      findUserById: () => buildUser(),
      findObservationByDedupeKey: () => buildObservation({
        kind: "connection_request_no_longer_pending",
      }),
      listMotions: () => [],
      upsertObservation: (observation) => {
        storedObservation = observation;
      },
      baseUrl: TEST_UNIPILE_BASE_URL,
      httpGetImpl: () => ({
        status: 200,
        bodyText: JSON.stringify({
          first_name: "Jordan",
          last_name: "Example",
          public_identifier: "jordan-example",
          provider_id: "provider-jordan",
          network_distance: "THIRD_DEGREE",
          is_relationship: false,
          invitation: null,
        }),
      }),
    },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.resolvedKind, "connection_request_not_accepted");
  assert.equal(storedObservation?.kind, "connection_request_not_accepted");
  assert.equal(storedObservation?.summary, "Jordan Example's connection request is not accepted on LinkedIn.");
  assert.equal(storedObservation?.notes, "LinkedIn shows this person is not a connection and has no pending sent request.");
});
