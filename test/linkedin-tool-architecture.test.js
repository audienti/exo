// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { buildLinkedinInboundSyncPayload } from "../src/core/inbound-linkedin-sync.js";
import { findInboundSurfaceDefinition, findInboundSurfaceDefinitionByToolMethodId } from "../src/lib/inbound-surface-catalog.js";
import {
  ensureLinkedinToolMethodsRegistered,
  LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
  LINKEDIN_SYNC_SENT_INVITATIONS_METHOD
} from "../src/lib/linkedin-tool-methods.js";
import { executeToolMethodSync, findToolMethodRegistration } from "../src/lib/tool-registry.js";

const timestamp = "2026-06-03T12:00:00.000Z";

test("planner surfaces point to the registered invitation sync tool methods", () => {
  ensureLinkedinToolMethodsRegistered();

  const sentRegistration = findToolMethodRegistration(LINKEDIN_SYNC_SENT_INVITATIONS_METHOD);
  const receivedRegistration = findToolMethodRegistration(LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD);
  const sentSurface = findInboundSurfaceDefinition("linkedin-sent-invitations");
  const receivedSurface = findInboundSurfaceDefinition("linkedin-received-invitations");

  assert.ok(sentRegistration);
  assert.ok(receivedRegistration);
  assert.equal(sentRegistration.metadata.lifecycleHooksRequired, true);
  assert.equal(receivedRegistration.metadata.lifecycleHooksRequired, true);
  assert.equal(sentSurface?.toolMethodId, LINKEDIN_SYNC_SENT_INVITATIONS_METHOD);
  assert.equal(receivedSurface?.toolMethodId, LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD);
  assert.equal(findInboundSurfaceDefinitionByToolMethodId(LINKEDIN_SYNC_SENT_INVITATIONS_METHOD)?.key, "linkedin-sent-invitations");
  assert.equal(findInboundSurfaceDefinitionByToolMethodId(LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD)?.key, "linkedin-received-invitations");
});

test("registered LinkedIn invitation tools normalize legacy capture into canonical invitation results", () => {
  ensureLinkedinToolMethodsRegistered();

  const sent = executeToolMethodSync(
    LINKEDIN_SYNC_SENT_INVITATIONS_METHOD,
    { runtime: "legacy_capture", connector: "legacy_capture", mode: "development" },
    {
      mode: "quick",
      legacyCapture: {
        status: "warning",
        checkedAt: timestamp,
        itemCount: 1,
        visibleTotalCount: 4,
        captureCompleteness: "partial_visible_slice",
        requestedMode: "quick",
        actualMode: "quick",
        reconcileRequired: true,
        reconcileReason: "visible_total_exceeds_itemized_rows",
        error: "LinkedIn showed a larger pending queue than the visible top slice.",
        items: [
          {
            invitationId: "invite-1",
            kind: "connection_request_pending",
            observedAt: timestamp,
            eventAt: "2026-06-02T12:00:00.000Z",
            summary: "Jordan Cipolla is still in the sent invitations queue.",
            actorName: "Jordan Cipolla",
            actorProfileUrl: "https://www.linkedin.com/in/jordan-cipolla/",
            actorLinkedinPublicId: "jordan-cipolla",
            actorLinkedinMemberId: "member-1"
          }
        ]
      }
    }
  );

  assert.equal(sent.surface, "invitations");
  assert.equal(sent.status, "warning");
  assert.equal(sent.captureCompleteness, "partial_visible_slice");
  assert.equal(sent.items[0].direction, "sent");
  assert.equal(sent.items[0].state, "pending");
  assert.equal(sent.items[0].identity.sourceItemId, "invite-1");
  assert.equal(sent.items[0].actor.publicId, "jordan-cipolla");
  assert.deepEqual(sent.items[0].actionsSupported, ["withdrawConnectionRequest"]);
});

test("linkedin inbound sync payload accepts canonical tool result batches for invitation surfaces", () => {
  ensureLinkedinToolMethodsRegistered();

  const received = executeToolMethodSync(
    LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
    { runtime: "legacy_capture", connector: "legacy_capture", mode: "development" },
    {
      mode: "quick",
      legacyCapture: {
        status: "success",
        checkedAt: timestamp,
        itemCount: 1,
        visibleTotalCount: 1,
        captureCompleteness: "complete",
        requestedMode: "quick",
        actualMode: "quick",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: [
          {
            invitationId: "invite-2",
            kind: "connection_request_received",
            observedAt: timestamp,
            summary: "Alicia Buyer sent us a new inbound connection request.",
            actorName: "Alicia Buyer",
            actorProfileUrl: "https://www.linkedin.com/in/alicia-buyer/",
            actorLinkedinPublicId: "alicia-buyer",
            actorLinkedinMemberId: "member-2"
          }
        ]
      }
    }
  );

  const sent = executeToolMethodSync(
    LINKEDIN_SYNC_SENT_INVITATIONS_METHOD,
    { runtime: "legacy_capture", connector: "legacy_capture", mode: "development" },
    {
      mode: "quick",
      legacyCapture: {
        status: "success",
        checkedAt: timestamp,
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "quick",
        actualMode: "quick",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      }
    }
  );

  const built = buildLinkedinInboundSyncPayload(
    {
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "william-main",
      owner: "William",
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "william-main",
          sourceType: "browser-profile",
          browserProfileId: "profile-1",
          preferred: true
        }
      ],
      harnessConnections: []
    },
    {
      accountId: "linkedin-account-1",
      capture: {
        mode: "quick",
        results: [
          {
            toolMethodId: LINKEDIN_SYNC_SENT_INVITATIONS_METHOD,
            output: sent
          },
          {
            toolMethodId: LINKEDIN_SYNC_RECEIVED_INVITATIONS_METHOD,
            output: received
          }
        ]
      }
    }
  );

  assert.equal(built.capture.sectionCount, 2);
  assert.equal(built.payload.accounts[0].surfaces.length, 2);

  const receivedSurface = built.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-received-invitations");
  assert.ok(receivedSurface);
  assert.equal(receivedSurface.status, "success");
  assert.equal(receivedSurface.itemCount, 1);
  assert.equal(receivedSurface.observations[0].kind, "connection_request_received");
  assert.equal(receivedSurface.observations[0].externalId, "invite-2");
});
