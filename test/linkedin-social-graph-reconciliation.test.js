// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_SEAM_STATES,
} from "../src/core/capability-seam-contract.js";
import {
  LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER,
  reconcileLinkedinSocialGraphMutation,
  reconcileLinkedinSocialGraphSurface,
} from "../src/core/linkedin-social-graph-reconciliation.js";
import { buildSeamRegistryRow } from "./support/capability-seam-fixtures.js";

const timestamp = "2026-06-13T14:30:00.000Z";

test("complete follower and following observations are quiet itemized syncs without repeated broad polling", () => {
  let connectorCallCount = 0;
  const cases = [
    {
      surfaceKey: "linkedin-followers-list",
      observations: [
        buildObservation({
          kind: "follower_confirmed",
          externalId: "follower-1",
          actorName: "Grace Follower",
          actorProfileUrl: "https://www.linkedin.com/in/grace-follower/",
        }),
      ],
    },
    {
      surfaceKey: "linkedin-following-list",
      observations: [
        buildObservation({
          kind: "follow_state_confirmed",
          externalId: "following-1",
          actorName: "Harper Followed",
          actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
        }),
      ],
    },
  ];

  for (const item of cases) {
    const result = reconcileLinkedinSocialGraphSurface({
      row: buildSocialGraphSurfaceRow(item.surfaceKey),
      surface: buildSurface({
        surfaceKey: item.surfaceKey,
        itemCount: item.observations.length,
        visibleTotalCount: item.observations.length,
        observations: item.observations,
      }),
      checkedAt: timestamp,
      liveConnectorProbe: () => {
        connectorCallCount += 1;
        throw new Error("live connector calls are not part of pure reconciliation");
      },
    });

    assert.equal(result.capabilityKey, item.surfaceKey);
    assert.equal(result.owner, LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER);
    assert.equal(result.state, CAPABILITY_SEAM_STATES.QUIET);
    assert.equal(result.quiet, true);
    assert.equal(result.checked, true);
    assert.equal(result.requiresAction, false);
    assert.equal(result.reason, "linkedin_social_graph_complete_itemized_sync");
    assert.equal(result.debt.coverage, "complete_itemized_sync");
    assert.equal(result.debt.nextSync.mode, "cadenced");
    assert.equal(result.debt.nextSync.repeatedBroadPollingRequired, false);
    assert.equal(result.evidence.length, 1);
  }

  assert.equal(connectorCallCount, 0);
});

test("partial itemization gaps resume from continuation instead of broad polling", () => {
  const result = reconcileLinkedinSocialGraphSurface({
    row: buildSocialGraphSurfaceRow("linkedin-following-list"),
    surface: buildSurface({
      surfaceKey: "linkedin-following-list",
      status: "warning",
      itemCount: 1,
      visibleTotalCount: 3,
      captureCompleteness: "partial",
      nextStartOffset: 1,
      observations: [
        buildObservation({
          kind: "follow_state_confirmed",
          actorName: "Harper Followed",
          actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
        }),
      ],
    }),
    checkedAt: timestamp,
  });

  assert.equal(result.state, CAPABILITY_SEAM_STATES.STALE);
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.requiresAction, true);
  assert.equal(result.reason, "linkedin_social_graph_partial_itemization_gap");
  assert.equal(result.debt.coverage, "partial_itemization_gap");
  assert.equal(result.debt.itemizationGapCount, 2);
  assert.equal(result.debt.nextSync.mode, "resume_itemization");
  assert.equal(result.debt.nextSync.nextStartOffset, 1);
  assert.equal(result.debt.nextSync.repeatedBroadPollingRequired, false);
});

test("follow mutation stays pending until following-list proof names the profile", () => {
  const row = buildSocialGraphActionRow("follow");
  const target = {
    linkedinPublicId: "ada-target",
    linkedinProfileUrl: "https://www.linkedin.com/in/ada-target/",
  };

  const pending = reconcileLinkedinSocialGraphMutation({
    row,
    actionKey: "follow",
    resultKey: "sent",
    target,
    followingSurface: buildSurface({
      surfaceKey: "linkedin-following-list",
      itemCount: 1,
      visibleTotalCount: 1,
      observations: [
        buildObservation({
          kind: "follow_state_confirmed",
          actorName: "Someone Else",
          actorProfileUrl: "https://www.linkedin.com/in/someone-else/",
        }),
      ],
    }),
    checkedAt: timestamp,
  });

  assert.equal(pending.state, CAPABILITY_SEAM_STATES.PENDING_PROOF);
  assert.equal(pending.quiet, false);
  assert.equal(pending.checked, false);
  assert.equal(pending.reason, "linkedin_follow_pending_following_list_proof");
  assert.equal(pending.debt.externalState, "followed");
  assert.deepEqual(pending.evidence, []);

  const reconciled = reconcileLinkedinSocialGraphMutation({
    row,
    actionKey: "follow",
    resultKey: "sent",
    target,
    followingSurface: buildSurface({
      surfaceKey: "linkedin-following-list",
      itemCount: 1,
      visibleTotalCount: 1,
      observations: [
        buildObservation({
          kind: "follow_state_confirmed",
          actorName: "Ada Target",
          actorProfileUrl: "https://www.linkedin.com/in/ada-target/",
        }),
      ],
    }),
    checkedAt: timestamp,
  });

  assert.equal(reconciled.state, CAPABILITY_SEAM_STATES.RECONCILED);
  assert.equal(reconciled.quiet, true);
  assert.equal(reconciled.checked, true);
  assert.equal(reconciled.reason, "linkedin_following_list_proof_observed");
  assert.equal(reconciled.debt.externalState, "followed");
  assert.equal(reconciled.evidence[0].actorProfileUrl, "https://www.linkedin.com/in/ada-target/");
});

test("unfollow mutation reconciles only after complete following-list absence proof", () => {
  const row = buildSocialGraphActionRow("unfollow");
  const target = {
    linkedinPublicId: "harper-followed",
    linkedinProfileUrl: "https://www.linkedin.com/in/harper-followed/",
  };

  const stillPresent = reconcileLinkedinSocialGraphMutation({
    row,
    actionKey: "unfollow",
    resultKey: "sent",
    target,
    followingSurface: buildSurface({
      surfaceKey: "linkedin-following-list",
      observations: [
        buildObservation({
          kind: "follow_state_confirmed",
          actorName: "Harper Followed",
          actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
        }),
      ],
    }),
    checkedAt: timestamp,
  });

  assert.equal(stillPresent.state, CAPABILITY_SEAM_STATES.PENDING_PROOF);
  assert.equal(stillPresent.reason, "linkedin_unfollow_still_present_on_following_list");
  assert.equal(stillPresent.debt.externalState, "unfollowed");
  assert.equal(stillPresent.evidence[0].actorProfileUrl, "https://www.linkedin.com/in/harper-followed/");

  const absentButPartial = reconcileLinkedinSocialGraphMutation({
    row,
    actionKey: "unfollow",
    resultKey: "sent",
    target,
    followingSurface: buildSurface({
      surfaceKey: "linkedin-following-list",
      status: "warning",
      itemCount: 0,
      visibleTotalCount: 2,
      captureCompleteness: "partial",
      observations: [],
    }),
    checkedAt: timestamp,
  });

  assert.equal(absentButPartial.state, CAPABILITY_SEAM_STATES.PENDING_PROOF);
  assert.equal(absentButPartial.reason, "linkedin_unfollow_requires_complete_following_list_absence_proof");

  const reconciled = reconcileLinkedinSocialGraphMutation({
    row,
    actionKey: "unfollow",
    resultKey: "sent",
    target,
    followingSurface: buildSurface({
      surfaceKey: "linkedin-following-list",
      itemCount: 0,
      visibleTotalCount: 0,
      observations: [],
    }),
    checkedAt: timestamp,
  });

  assert.equal(reconciled.state, CAPABILITY_SEAM_STATES.RECONCILED);
  assert.equal(reconciled.quiet, true);
  assert.equal(reconciled.checked, true);
  assert.equal(reconciled.reason, "linkedin_unfollow_absence_proof_observed");
  assert.equal(reconciled.debt.externalState, "unfollowed");
});

test("profile-view observations after a local touch reconcile profile-view debt", () => {
  const row = buildSocialGraphActionRow("profile_view");
  const target = {
    linkedinPublicId: "parm-uppal",
    linkedinProfileUrl: "https://www.linkedin.com/in/parm-uppal/",
  };

  const result = reconcileLinkedinSocialGraphMutation({
    row,
    actionKey: "profile_view",
    resultKey: "sent",
    target,
    touchedAt: "2026-06-04T12:00:00.000Z",
    profileViewSurface: buildSurface({
      surfaceKey: "linkedin-profile-views",
      itemCount: 1,
      visibleTotalCount: 1,
      observations: [
        buildObservation({
          kind: "profile_view_after_touch",
          externalId: "view-1",
          actorName: "Parm Uppal",
          actorProfileUrl: "https://www.linkedin.com/in/parm-uppal/",
          eventAt: "2026-06-04T17:45:00.000Z",
          observedAt: "2026-06-04T18:10:00.000Z",
        }),
      ],
    }),
    checkedAt: timestamp,
  });

  assert.equal(result.state, CAPABILITY_SEAM_STATES.RECONCILED);
  assert.equal(result.reason, "linkedin_profile_view_after_touch_observed");
  assert.equal(result.quiet, true);
  assert.equal(result.checked, true);
  assert.equal(result.debt.externalState, "profile_view_after_touch");
  assert.equal(result.evidence[0].externalId, "view-1");
});

test("profile-view visible-total gaps and contradictions are not quiet", () => {
  const gap = reconcileLinkedinSocialGraphSurface({
    row: buildSocialGraphSurfaceRow("linkedin-profile-views"),
    surface: buildSurface({
      surfaceKey: "linkedin-profile-views",
      itemCount: 1,
      visibleTotalCount: 4,
      observations: [
        buildObservation({
          kind: "profile_view_received",
          actorName: "Nina Prospect",
          actorProfileUrl: "https://www.linkedin.com/in/nina-prospect/",
        }),
      ],
    }),
    checkedAt: timestamp,
  });

  assert.equal(gap.state, CAPABILITY_SEAM_STATES.STALE);
  assert.equal(gap.quiet, false);
  assert.equal(gap.checked, false);
  assert.equal(gap.reason, "linkedin_social_graph_partial_itemization_gap");
  assert.equal(gap.debt.coverage, "partial_itemization_gap");
  assert.equal(gap.debt.itemizationGapCount, 3);

  const contradiction = reconcileLinkedinSocialGraphSurface({
    row: buildSocialGraphSurfaceRow("linkedin-profile-views"),
    surface: buildSurface({
      surfaceKey: "linkedin-profile-views",
      itemCount: 3,
      visibleTotalCount: 1,
      observations: [
        buildObservation({ kind: "profile_view_received", actorName: "One" }),
        buildObservation({ kind: "profile_view_received", actorName: "Two" }),
        buildObservation({ kind: "profile_view_received", actorName: "Three" }),
      ],
    }),
    checkedAt: timestamp,
  });

  assert.equal(contradiction.state, CAPABILITY_SEAM_STATES.CONTRADICTED);
  assert.equal(contradiction.quiet, false);
  assert.equal(contradiction.checked, false);
  assert.equal(contradiction.requiresAction, true);
  assert.equal(contradiction.reason, "linkedin_social_graph_visible_total_contradiction");
  assert.equal(contradiction.debt.coverage, "visible_total_contradiction");
  assert.equal(contradiction.debt.countDiscrepancyCount, 2);
});

/**
 * @param {string} surfaceKey
 */
function buildSocialGraphSurfaceRow(surfaceKey) {
  return buildSeamRegistryRow({
    id: `surface:${surfaceKey}`,
    kind: "inbound_surface",
    service: "linkedin",
    capabilityKey: surfaceKey,
    label: surfaceKey,
    surfaceKey,
    reconcile: { owner: LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER },
    proofSurfaces: [surfaceKey],
    stateKeys: stateKeysForSurface(surfaceKey),
    syncStrategy: "connector-itemized-truth-sync",
    reconciliationStrategy: "linkedin-social-graph-reconciliation",
    mutationDebtPolicy: "surface-observations-can-confirm-or-clear-related-mutation-debt",
  });
}

/**
 * @param {"follow" | "unfollow" | "profile_view"} actionKey
 */
function buildSocialGraphActionRow(actionKey) {
  return buildSeamRegistryRow({
    id: `action:${actionKey}`,
    kind: "mutation_action",
    service: "linkedin",
    capabilityKey: actionKey,
    label: actionKey,
    actionKey,
    reconcile: { owner: LINKEDIN_SOCIAL_GRAPH_RECONCILIATION_OWNER },
    proofSurfaces: actionKey === "profile_view"
      ? ["linkedin-profile-views"]
      : ["linkedin-following-list"],
    stateKeys: actionKey === "profile_view"
      ? ["action.profile.view"]
      : [`action.profile.${actionKey}`],
    syncStrategy: "not-applicable-mutation-starts-at-writeback",
    reconciliationStrategy: actionKey === "profile_view"
      ? "profile-view-attention-proof"
      : "linkedin-following-list-proof",
    mutationDebtPolicy: actionKey === "profile_view"
      ? "local writeback plus profile-view proof when the surface observes attention after touch"
      : `pending external proof until linkedin-following-list confirms ${actionKey === "follow" ? "followed" : "removed"} state`,
  });
}

/**
 * @param {Record<string, any>} overrides
 */
function buildSurface(overrides) {
  return {
    surfaceKey: "linkedin-following-list",
    status: "success",
    observedAt: timestamp,
    checkedAt: timestamp,
    itemCount: overrides.observations?.length ?? 0,
    visibleTotalCount: overrides.observations?.length ?? 0,
    captureCompleteness: "complete",
    exhaustionStatus: "complete",
    requestedMode: "quick",
    actualMode: "full",
    reconcileRequired: false,
    reconcileReason: null,
    observations: [],
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} overrides
 */
function buildObservation(overrides = {}) {
  return {
    id: overrides.externalId ?? "obs-1",
    kind: "follow_state_confirmed",
    externalId: overrides.externalId ?? "obs-1",
    observedAt: timestamp,
    eventAt: null,
    actorName: "Harper Followed",
    actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
    actorLinkedinPublicId: null,
    actorLinkedinMemberId: null,
    summary: "Observed in a local fixture.",
    ...overrides,
  };
}

/**
 * @param {string} surfaceKey
 */
function stateKeysForSurface(surfaceKey) {
  switch (surfaceKey) {
    case "linkedin-followers-list":
      return ["follower_added", "follower_removed", "follower_confirmed"];
    case "linkedin-following-list":
      return ["follow_state_changed", "follow_state_removed", "follow_state_confirmed"];
    case "linkedin-profile-views":
      return ["profile_view_after_touch", "profile_view_received"];
    default:
      return [surfaceKey];
  }
}
