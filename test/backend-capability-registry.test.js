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
