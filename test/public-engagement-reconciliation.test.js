// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_SEAM_STATES,
} from "../src/core/capability-seam-contract.js";
import {
  PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER,
  reconcilePublicEngagementMutation,
  reconcilePublicEngagementTruthSurface,
} from "../src/core/public-engagement-reconciliation.js";
import { buildSeamRegistryRow } from "./support/capability-seam-fixtures.js";

const timestamp = "2026-06-13T12:00:00.000Z";

const publicEngagementActions = [
  {
    actionKey: "like_post",
    proofSurfaces: ["linkedin-catch-up-updates"],
    stateKeys: ["action.post.like"],
    externalState: "post_reaction_created",
  },
  {
    actionKey: "unlike_post",
    proofSurfaces: ["linkedin-catch-up-updates"],
    stateKeys: ["action.post.un_like"],
    externalState: "post_reaction_removed",
  },
  {
    actionKey: "create_post_comment",
    proofSurfaces: ["linkedin-comment-replies", "linkedin-catch-up-updates"],
    stateKeys: ["action.post.comment"],
    externalState: "post_comment_created",
  },
  {
    actionKey: "share_post",
    proofSurfaces: ["linkedin-catch-up-updates"],
    stateKeys: ["action.post.share"],
    externalState: "post_shared",
  },
  {
    actionKey: "create_comment_comment",
    proofSurfaces: ["linkedin-comment-replies"],
    stateKeys: ["action.post.comment.reply.outbound"],
    externalState: "comment_reply_created",
  },
  {
    actionKey: "create_comment_reaction",
    proofSurfaces: ["linkedin-comment-replies"],
    stateKeys: ["action.post.comment.react.outbound"],
    externalState: "comment_reaction_created",
  },
];

test("public engagement mutations start as explicit pending proof for every action category", () => {
  for (const action of publicEngagementActions) {
    const result = reconcilePublicEngagementMutation({
      row: buildPublicEngagementActionRow(action),
      actionKey: action.actionKey,
      resultKey: "sent",
      surface: action.actionKey,
      checkedAt: timestamp,
    });

    assert.equal(result.capabilityKey, action.actionKey);
    assert.equal(result.owner, PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER);
    assert.equal(result.state, CAPABILITY_SEAM_STATES.PENDING_PROOF);
    assert.equal(result.quiet, false);
    assert.equal(result.checked, false);
    assert.equal(result.requiresAction, true);
    assert.deepEqual(result.proofSurfaces, action.proofSurfaces);
    assert.deepEqual(result.missingProofSurfaces, []);
    assert.equal(result.reason, "public_engagement_external_proof_pending");
    assert.equal(result.debt.actionKey, action.actionKey);
    assert.equal(result.debt.externalState, action.externalState);
  }
});

test("public engagement mutations mark disabled proof surfaces as missing proof", () => {
  const action = publicEngagementActions.find((item) => item.actionKey === "create_post_comment");
  assert.ok(action);

  const result = reconcilePublicEngagementMutation({
    row: buildPublicEngagementActionRow(action),
    actionKey: action.actionKey,
    resultKey: "sent",
    surface: "public_comment",
    unsupportedProofSurfaces: action.proofSurfaces,
    checkedAt: timestamp,
  });

  assert.equal(result.state, CAPABILITY_SEAM_STATES.MISSING_PROOF);
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.requiresAction, true);
  assert.deepEqual(result.missingProofSurfaces, [
    "linkedin-comment-replies",
    "linkedin-catch-up-updates",
  ]);
  assert.equal(result.reason, "public_engagement_proof_surface_unsupported");
  assert.equal(result.debt.surfaceStatus, "unsupported");
});

test("disabled public engagement truth surfaces are unsupported for autonomous checking", () => {
  for (const surfaceKey of ["linkedin-comment-replies", "linkedin-catch-up-updates"]) {
    const result = reconcilePublicEngagementTruthSurface({
      row: buildPublicEngagementSurfaceRow(surfaceKey),
      checkedAt: timestamp,
    });

    assert.equal(result.capabilityKey, surfaceKey);
    assert.equal(result.owner, PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER);
    assert.equal(result.state, CAPABILITY_SEAM_STATES.UNSUPPORTED);
    assert.equal(result.quiet, false);
    assert.equal(result.checked, false);
    assert.equal(result.supported, false);
    assert.equal(result.requiresAction, false);
    assert.deepEqual(result.proofSurfaces, [surfaceKey]);
    assert.deepEqual(result.missingProofSurfaces, []);
    assert.equal(result.reason, "autonomous_public_engagement_capture_unsupported");
    assert.equal(result.debt.surfaceKey, surfaceKey);
  }
});

test("public engagement reconciliation is quiet only when an explicit proof fact exists", () => {
  const action = publicEngagementActions.find((item) => item.actionKey === "like_post");
  assert.ok(action);
  const row = buildPublicEngagementActionRow(action);

  const noProof = reconcilePublicEngagementMutation({
    row,
    actionKey: action.actionKey,
    resultKey: "sent",
    surface: action.actionKey,
  });
  assert.equal(noProof.quiet, false);
  assert.equal(noProof.checked, false);

  const unrelatedProof = reconcilePublicEngagementMutation({
    row,
    actionKey: action.actionKey,
    resultKey: "sent",
    surface: action.actionKey,
    proofFacts: [{
      actionKey: "create_comment_reaction",
      surfaceKey: "linkedin-comment-replies",
      proofId: "comment-reaction-1",
      observedAt: timestamp,
    }],
  });
  assert.equal(unrelatedProof.quiet, false);
  assert.equal(unrelatedProof.checked, false);

  const explicitProof = {
    actionKey: action.actionKey,
    surfaceKey: "linkedin-catch-up-updates",
    proofId: "post-reaction-1",
    observedAt: timestamp,
  };
  const reconciled = reconcilePublicEngagementMutation({
    row,
    actionKey: action.actionKey,
    resultKey: "sent",
    surface: action.actionKey,
    proofFacts: [explicitProof],
    checkedAt: timestamp,
  });

  assert.equal(reconciled.state, CAPABILITY_SEAM_STATES.RECONCILED);
  assert.equal(reconciled.quiet, true);
  assert.equal(reconciled.checked, true);
  assert.equal(reconciled.requiresAction, false);
  assert.deepEqual(reconciled.evidence, [explicitProof]);
  assert.equal(reconciled.reason, "public_engagement_explicit_proof_observed");
});

/**
 * @param {{
 *   actionKey: string,
 *   proofSurfaces: string[],
 *   stateKeys: string[],
 * }} action
 */
function buildPublicEngagementActionRow(action) {
  return buildSeamRegistryRow({
    id: `action:${action.actionKey}`,
    kind: "mutation_action",
    service: "linkedin",
    capabilityKey: action.actionKey,
    label: action.actionKey,
    actionKey: action.actionKey,
    reconcile: { owner: PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER },
    proofSurfaces: action.proofSurfaces,
    stateKeys: action.stateKeys,
    reconciliationStrategy: "public-engagement-proof-reconciliation",
    mutationDebtPolicy: "pending or missing external proof until public engagement capture is supported",
  });
}

/**
 * @param {string} surfaceKey
 */
function buildPublicEngagementSurfaceRow(surfaceKey) {
  return buildSeamRegistryRow({
    id: `surface:${surfaceKey}`,
    kind: "inbound_truth_surface",
    service: "linkedin",
    capabilityKey: surfaceKey,
    label: surfaceKey,
    surfaceKey,
    reconcile: { owner: PUBLIC_ENGAGEMENT_RECONCILIATION_OWNER },
    proofSurfaces: [surfaceKey],
    stateKeys: surfaceKey === "linkedin-comment-replies"
      ? ["public_reply_received", "comment_thread_updated"]
      : ["catch_up_update_detected", "public_engagement_opportunity"],
    syncStrategy: "browser-capture-unsupported-autonomous-capture",
    reconciliationStrategy: "public-engagement-proof-reconciliation",
    mutationDebtPolicy: "surface-observations-can-confirm-or-clear-related-mutation-debt",
  });
}
