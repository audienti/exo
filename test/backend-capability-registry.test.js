// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { listActionCatalog } from "../src/lib/action-catalog.js";
import { listBackendCapabilityRegistry } from "../src/lib/backend-capability-registry.js";
import { listInboundSurfaceCatalog } from "../src/lib/inbound-surface-catalog.js";

test("backend capability registry covers every inbound surface", () => {
  const rows = listBackendCapabilityRegistry();
  const bySurface = new Map(
    rows
      .filter((row) => row.kind === "inbound_surface")
      .map((row) => [row.surfaceKey, row]),
  );

  for (const surface of listInboundSurfaceCatalog()) {
    const row = bySurface.get(surface.key);
    assert.ok(row, `missing registry row for inbound surface ${surface.key}`);
    assert.equal(row.service, surface.capability);
    assert.equal(row.capabilityKey, surface.key);
    assert.equal(row.sync.owner, "src/core/inbound-sync-run.js");
    assert.ok(row.reconcile.owner, `${surface.key} must name a reconciliation owner`);
    assert.ok(row.status.sync, `${surface.key} must have a sync status`);
    assert.ok(row.status.reconcile, `${surface.key} must have a reconcile status`);
    assert.ok(row.kanbanLane, `${surface.key} must have a kanban lane`);
  }
});

test("backend capability registry covers every mutation action", () => {
  const rows = listBackendCapabilityRegistry();
  const byAction = new Map(
    rows
      .filter((row) => row.kind === "mutation_action")
      .map((row) => [row.actionKey, row]),
  );

  for (const action of listActionCatalog()) {
    const row = byAction.get(action.key);
    assert.ok(row, `missing registry row for action ${action.key}`);
    assert.equal(row.service, action.requiredCapability);
    assert.equal(row.capabilityKey, action.key);
    assert.equal(row.mutate.owner, "src/core/record-action-result.js");
    assert.ok(row.status.mutate, `${action.key} must have a mutation status`);
    assert.ok(row.reconcile.owner, `${action.key} must name a reconciliation owner or future owner`);
    assert.ok(row.kanbanLane, `${action.key} must have a kanban lane`);
  }
});

test("backend capability registry rows expose complete seam metadata", () => {
  const rows = listBackendCapabilityRegistry();

  for (const row of rows) {
    assert.ok(Array.isArray(row.proofSurfaces), `${row.id} must expose proof surfaces`);
    assert.ok(row.proofSurfaces.length > 0, `${row.id} must name at least one proof surface`);
    assert.ok(row.proofSurfaces.every((value) => typeof value === "string" && value.length > 0), `${row.id} proof surfaces must be non-empty strings`);

    assert.ok(Array.isArray(row.stateKeys), `${row.id} must expose state keys`);
    assert.ok(row.stateKeys.length > 0, `${row.id} must name at least one state key`);
    assert.ok(row.stateKeys.every((value) => typeof value === "string" && value.length > 0), `${row.id} state keys must be non-empty strings`);

    assert.equal(typeof row.syncStrategy, "string", `${row.id} must expose a sync strategy`);
    assert.ok(row.syncStrategy.length > 0, `${row.id} sync strategy must be non-empty`);

    assert.equal(typeof row.reconciliationStrategy, "string", `${row.id} must expose a reconciliation strategy`);
    assert.ok(row.reconciliationStrategy.length > 0, `${row.id} reconciliation strategy must be non-empty`);

    assert.equal(typeof row.mutationDebtPolicy, "string", `${row.id} must expose a mutation debt policy`);
    assert.ok(row.mutationDebtPolicy.length > 0, `${row.id} mutation debt policy must be non-empty`);
  }
});

test("backend capability registry names proof paths for non-connection seams", () => {
  const rows = listBackendCapabilityRegistry();
  const byCapability = new Map(rows.map((row) => [row.capabilityKey, row]));

  assert.deepEqual(byCapability.get("gmail-inbox-threads")?.proofSurfaces, ["gmail-inbox-threads"]);
  assert.ok(byCapability.get("gmail-inbox-threads")?.stateKeys.includes("email_reply_received"));

  assert.ok(byCapability.get("send_email")?.proofSurfaces.includes("gmail-sent-mail"));
  assert.match(byCapability.get("send_email")?.mutationDebtPolicy ?? "", /pending/i);

  assert.ok(byCapability.get("send_direct_message")?.proofSurfaces.includes("linkedin-messaging-inbox"));
  assert.ok(byCapability.get("follow")?.proofSurfaces.includes("linkedin-following-list"));
  assert.ok(byCapability.get("like_post")?.proofSurfaces.includes("linkedin-catch-up-updates"));
  assert.ok(byCapability.get("agent-run-log")?.proofSurfaces.includes("agent-last-pass"));
});

test("backend capability registry exposes the high-risk connection request seam explicitly", () => {
  const rows = listBackendCapabilityRegistry();
  const sentInvitations = rows.find((row) => row.surfaceKey === "linkedin-sent-invitations");
  const connectionRequest = rows.find((row) => row.actionKey === "connection_request");

  assert.ok(sentInvitations);
  assert.equal(sentInvitations.status.sync, "wrong-risk");
  assert.equal(sentInvitations.reconcile.owner, "src/core/connection-request-reconciliation.js");
  assert.match(sentInvitations.gap, /54 reconciliation tasks/i);

  assert.ok(connectionRequest);
  assert.equal(connectionRequest.reconcile.owner, "src/core/connection-request-reconciliation.js");
  assert.equal(connectionRequest.status.mutate, "partial");
});
