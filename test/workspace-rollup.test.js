// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildWorkspaceRollup } from "../src/core/build-workspace-rollup.js";
import { renderWorkspaceRollupPage } from "../src/artifacts/render-workspace-rollup.js";

test("workspace rollup renders reconciliation pressure with row-gap details", () => {
  const model = buildWorkspaceRollup({
    operatorSummary: {},
    decisionQueue: { items: [] },
    agentQueue: { items: [] },
    blockedQueue: { items: [] },
    motionSummaries: [],
    truthAccounts: [],
    reviewItems: [],
    itemizationGaps: [
      {
        label: "Following List",
        handle: "williamflanagan",
        itemCount: 398,
        observationCount: 20,
        missingObservationCount: 378,
        reconcileReason: "bounded_capture_stopped_early",
        exhaustionReason: "bounded_capture_stopped_early",
        summary: "Following List reported 398 items in the last sync, but only 20 individual observations were written back.",
        recommendedAction: "Rerun Following List and write the remaining 378 concrete items back as individual observations so Exo can tell the operator what to review.",
      },
      {
        label: "Followers",
        handle: "williamflanagan",
        itemCount: 10,
        observationCount: 10,
        missingObservationCount: 0,
        reconcileReason: "page_budget_stopped_early",
        exhaustionReason: "page_budget_stopped_early",
        summary: "Followers wrote back 10 itemized observations, but the last full reconciliation stopped at the configured page budget.",
        recommendedAction: "Rerun Followers in full mode and reconcile until the surface is exhausted.",
      },
    ],
    executionUsers: [],
  });

  assert.equal(model.reconciliation.gapCount, 2);
  assert.equal(model.reconciliation.missingCount, 378);
  assert.equal(model.reconciliation.items[0]?.label, "Following List");
  assert.equal(model.reconciliation.items[0]?.reason, "quick-pass bounded");
  assert.equal(model.reconciliation.items[1]?.reason, "page-budgeted full reconcile");

  const html = renderWorkspaceRollupPage(model, {
    interactive: true,
    user: { label: "william-main" },
    generatedAt: "2026-06-06T21:31:34.065Z",
    regenerateCommand: "exo ui",
  });

  assert.match(html, /Reconciliation pressure/);
  assert.match(html, /Following List/);
  assert.match(html, /quick-pass bounded/);
  assert.match(html, /page-budgeted full reconcile/);
  assert.match(html, /378<em>missing rows<\/em>/);
  assert.match(html, /20<em>written back<\/em>/);
  assert.match(html, /Rerun Following List and write the remaining 378 concrete items back/);
});
