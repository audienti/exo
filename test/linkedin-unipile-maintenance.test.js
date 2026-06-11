// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { runLinkedinMaintenanceWithUnipile } from "../src/lib/linkedin-unipile-maintenance.js";

const timestamp = "2026-06-06T12:00:00.000Z";

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
    },
  );

  assert.equal(result.status, "blocked");
  assert.match(result.reason ?? "", /requires a stored Unipile shared_secret/i);
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
});
