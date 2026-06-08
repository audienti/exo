// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { renderConnectionsPage } from "../src/artifacts/render-connections.js";
import { buildConnectionsViewModel } from "../src/core/build-connections-view.js";
import { buildDailyView } from "../src/core/build-daily-view.js";
import { buildInboundReviewView } from "../src/core/build-inbound-review-view.js";

const now = "2026-06-05T16:00:00.000Z";

function baseReviewItem(overrides = {}) {
  return {
    id: "obs-1",
    observedAt: "2026-06-04T16:20:00.000Z",
    eventAt: "2026-06-04T16:20:00.000Z",
    recordedAt: "2026-06-04T16:20:00.000Z",
    ageDays: 1,
    kind: "connection_request_pending",
    surfaceKey: "linkedin-sent-invitations",
    actorName: "Parm Uppal",
    actorTitle: "Chief Revenue Officer",
    actorCompanyName: "Chainguard",
    actorProfileUrl: "https://www.linkedin.com/in/parm-uppal/",
    actorLinkedinPublicId: "parm-uppal",
    actorLinkedinMemberId: "member-parm",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
    summary: "Parm Uppal is still pending on LinkedIn.",
    previewLabel: "Engagement",
    previewSubject: null,
    previewText: "Parm Uppal is still pending on LinkedIn.",
    category: "sent_invite",
    priority: "low",
    state: "waiting",
    whyItMatters: "The invite is still pending.",
    recommendedAction: "Keep the branch patient for now.",
    decisionOptions: ["wait"],
    account: {
      id: "account-1",
      capability: "linkedin",
    },
    motion: {
      id: "motion-1",
      name: "harsh-spare-mongoose",
    },
    company: {
      id: "company-1",
      name: "Chainguard",
    },
    prospect: {
      id: "prospect-1",
      name: "Parm Uppal",
      title: "Chief Revenue Officer",
    },
    ...overrides,
  };
}

function baseTruthAccount() {
  return {
    accountId: "account-1",
    surfaces: [
      {
        key: "linkedin-sent-invitations",
        label: "Sent Invitations",
        lastRunStatus: "success",
        lastSyncedAt: "2026-06-04T16:30:00.000Z",
        lastObservedAt: "2026-06-04T16:30:00.000Z",
        lastItemCount: 1,
        meta: {},
      },
      {
        key: "linkedin-profile-views",
        label: "Profile Views",
        lastRunStatus: "success",
        lastSyncedAt: "2026-06-04T16:30:00.000Z",
        lastObservedAt: "2026-06-04T16:30:00.000Z",
        lastItemCount: 1,
        meta: {},
      },
    ],
  };
}

function rawProspect({
  id,
  name,
  title,
  linkedinProfileUrl,
  lastTouchOutcome = null,
  nextAction = "Send the first connection request.",
  nextActionDueAt = "2026-06-05T15:00:00.000Z",
} = {}) {
  return {
    id,
    name,
    title,
    linkedinProfileUrl,
    avatarSourceUrl: null,
    avatarUrl: null,
    email: null,
    buyingCommitteeRole: "other",
    decisionAuthority: "unknown",
    fitConfidence: "moderate",
    whyRelevant: `${name} is in scope for this motion.`,
    sourceUrl: linkedinProfileUrl,
    observedAt: "2026-06-04T12:00:00.000Z",
    profileViewedAt: null,
    roleTruth: {},
    triggerWindow: {},
    identityTells: {},
    linkedinProfileSnapshot: {},
    liveSignal: {},
    contactPoints: [],
    contactEnrichmentState: {},
    queueState: {
      status: "selected",
      source: "manual",
      updatedAt: "2026-06-04T12:00:00.000Z",
      notes: null,
    },
    packetState: null,
    notes: null,
    signalMatchIds: [],
    touches: [],
    cadenceState: {
      status: "ready",
      currentStep: "connection-request",
      lastTouchChannel: lastTouchOutcome ? "connection-request" : null,
      lastTouchOutcome,
      lastTouchAt: lastTouchOutcome ? "2026-06-04T12:00:00.000Z" : null,
      nextAction,
      nextActionDueAt,
      blockedChannels: [],
      requireNewHook: false,
      notes: null,
      updatedAt: "2026-06-04T12:00:00.000Z",
    },
    drafts: [],
    timelineNotes: [],
  };
}

function rawMotionWithWaitingBranch() {
  return {
    id: "motion-1",
    name: "harsh-spare-mongoose",
    createdAt: "2026-06-04T12:00:00.000Z",
    updatedAt: "2026-06-04T12:00:00.000Z",
    status: "active",
    offer: {
      sourceUrl: "https://www.knitit.ai/",
      offerNotes: null,
    },
    premise: {
      statement: "This offer matters when outbound branches need governed patience.",
      notes: null,
      source: "operator",
      status: "defined",
    },
    targetingProfile: {
      geolocations: [],
      icpTypes: [],
      industries: [],
      companyTypes: [],
      companyShapes: [],
      companySizes: [],
      targetTitles: [],
      roleFamilies: [],
      segmentVariants: [],
      stakeholderTargetCount: 2,
    },
    suppressionPolicy: {
      excludedAccounts: [],
      excludedDomains: [],
      excludedContacts: [],
      doNotContactEntries: [],
      doNotContactSources: [],
      crmCustomerSuppressionEnabled: false,
      crmOpportunitySuppressionEnabled: false,
    },
    offerThesis: {
      sourceUrl: "https://www.knitit.ai/",
      sourceTitle: null,
      sourceDescription: null,
      sourceSummary: "Governed outbound patience.",
      offerNotes: null,
      problemThesis: null,
      buyerImpactThesis: null,
      likelyTriggerThesis: null,
      likelyRoleThesis: null,
      likelySegmentThesis: null,
      status: "seeded",
    },
    audienceHypotheses: [],
    signals: [],
    targetMap: {
      status: "ready",
      segments: [],
      accounts: [
        {
          companyId: "company-1",
          companyName: "Chainguard",
          domain: "chainguard.dev",
          websiteUrl: "https://www.chainguard.dev/",
          linkedinCompanyUrl: null,
          companyLogoSourceUrl: null,
          companyLogoUrl: null,
          signalMatches: [],
          prospects: [
            rawProspect({
              id: "prospect-1",
              name: "Parm Uppal",
              title: "Chief Revenue Officer",
              linkedinProfileUrl: "https://www.linkedin.com/in/parm-uppal/",
              lastTouchOutcome: "sent",
              nextAction: "Wait for Parm to accept or reply.",
              nextActionDueAt: "2026-06-06T15:00:00.000Z",
            }),
            rawProspect({
              id: "prospect-2",
              name: "Casey Reserve",
              title: "VP Revenue Operations",
              linkedinProfileUrl: "https://www.linkedin.com/in/casey-reserve/",
            }),
          ],
          queueState: {
            status: "selected",
            source: "manual",
            updatedAt: "2026-06-04T12:00:00.000Z",
            notes: null,
          },
          packetState: null,
          lastResearchAt: null,
          notes: null,
        },
      ],
    },
    stakeholderMap: {
      status: "pending",
      stakeholders: [],
    },
    motionPlan: {
      status: "pending",
      variants: [],
    },
    nextSteps: [],
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
  };
}

function rawCompany() {
  return {
    id: "company-1",
    createdAt: "2026-06-04T12:00:00.000Z",
    updatedAt: "2026-06-04T12:00:00.000Z",
    name: "Chainguard",
    domain: "chainguard.dev",
    websiteUrl: "https://www.chainguard.dev/",
    linkedinCompanyUrl: null,
    logoSourceUrl: null,
    logoUrl: null,
    notes: null,
    tags: [],
    motionIds: ["motion-1"],
    engagementProfileAssignment: null,
    engagementUserAssignment: {
      userId: "user-1",
      label: "william-main",
      owner: null,
      accountRefs: [],
      assignedAt: "2026-06-04T12:00:00.000Z",
      assignedBy: null,
      reason: "Operator owns this company.",
      sticky: true,
    },
  };
}

test("connections sent rows pull in the viewed-after-invite signal", () => {
  const sent = baseReviewItem();
  const profileView = baseReviewItem({
    id: "obs-2",
    kind: "profile_view_after_touch",
    surfaceKey: "linkedin-profile-views",
    summary: "Parm Uppal appeared in your LinkedIn profile viewers. Viewed 2mo ago.",
    observedAt: "2026-06-04T18:10:00.000Z",
    eventAt: null,
    state: "attention_signal",
    category: "signal",
    priority: "low",
    recommendedAction: "Keep the invite patient and move on.",
  });

  const model = buildConnectionsViewModel({
    reviewItems: [sent, profileView],
    truthAccounts: [baseTruthAccount()],
  });
  const sentTab = model.tabs.find((tab) => tab.key === "sent");

  assert.ok(sentTab);
  assert.equal(sentTab.people.length, 1);
  assert.equal(sentTab.people[0].attention?.label, "Viewed your profile after the invite");
  assert.equal(sentTab.people[0].attention?.occurredAt, "2026-04-05T18:10:00.000Z");

  const html = renderConnectionsPage(model, {
    user: { label: "william-main" },
    generatedAt: now,
  });
  assert.match(html, /Viewed your profile after the invite/);
});

test("connections views rows fall back to the viewed label when stored eventAt is missing", () => {
  const profileView = baseReviewItem({
    id: "obs-view-only",
    kind: "profile_view_received",
    surfaceKey: "linkedin-profile-views",
    summary: "Nina Prospect appeared in your LinkedIn profile viewers. Viewed 2mo ago.",
    actorName: "Nina Prospect",
    actorTitle: "Director of Demand Generation",
    actorCompanyName: "BuyerCo",
    actorProfileUrl: "https://www.linkedin.com/in/nina-prospect/",
    actorLinkedinPublicId: "nina-prospect",
    actorLinkedinMemberId: "member-nina",
    observedAt: "2026-06-04T16:20:00.000Z",
    eventAt: null,
    category: "visibility",
    state: "informational",
    recommendedAction: "Consider whether to connect.",
  });

  const model = buildConnectionsViewModel({
    reviewItems: [profileView],
    truthAccounts: [baseTruthAccount()],
  });
  const viewsTab = model.tabs.find((tab) => tab.key === "views");

  assert.ok(viewsTab);
  assert.equal(viewsTab.people.length, 1);
  assert.equal(viewsTab.people[0].observedAtMs, Date.parse("2026-04-05T16:20:00.000Z"));
});

test("connections does not invent a gap when the surface is fully reconciled but the tab intentionally shows a subset", () => {
  const sent = baseReviewItem({
    id: "obs-sent-subset",
    kind: "connection_request_pending",
    surfaceKey: "linkedin-sent-invitations",
    summary: "Parm Uppal is still pending on LinkedIn.",
  });
  const view = baseReviewItem({
    id: "obs-view-subset",
    kind: "profile_view_received",
    surfaceKey: "linkedin-profile-views",
    actorName: "Lauren Garner",
    actorTitle: "VP Demand Generation",
    actorCompanyName: "BuyerCo",
    actorProfileUrl: "https://www.linkedin.com/in/lauren-garner/",
    actorLinkedinPublicId: "lauren-garner",
    actorLinkedinMemberId: "member-lauren",
    summary: "Lauren Garner appeared in your LinkedIn profile viewers. Viewed 20h ago.",
  });
  const model = buildConnectionsViewModel({
    observations: [sent, view],
    truthAccounts: [{
      accountId: "account-1",
      surfaces: [
        {
          key: "linkedin-sent-invitations",
          label: "Sent Invitations",
          lastRunStatus: "success",
          lastSyncedAt: "2026-06-05T16:30:00.000Z",
          lastObservedAt: "2026-06-05T16:30:00.000Z",
          lastItemCount: 89,
          lastVisibleTotalCount: 89,
          lastObservationCount: 89,
          lastItemizationGapCount: 0,
          lastCountDiscrepancyCount: 0,
          meta: {},
        },
        {
          key: "linkedin-profile-views",
          label: "Profile Views",
          lastRunStatus: "success",
          lastSyncedAt: "2026-06-05T16:30:00.000Z",
          lastObservedAt: "2026-06-05T16:30:00.000Z",
          lastItemCount: 101,
          lastVisibleTotalCount: 101,
          lastObservationCount: 101,
          lastItemizationGapCount: 0,
          lastCountDiscrepancyCount: 0,
          meta: {},
        },
      ],
    }],
  });

  const sentTab = model.tabs.find((tab) => tab.key === "sent");
  const viewsTab = model.tabs.find((tab) => tab.key === "views");

  assert.equal(sentTab?.gap, null);
  assert.equal(viewsTab?.gap, null);
});

test("connections auto-queues itemization-gap repair instead of telling the operator to reconcile it", () => {
  const firstView = baseReviewItem({
    id: "obs-view-1",
    kind: "profile_view_received",
    surfaceKey: "linkedin-profile-views",
    actorName: "Lauren Garner",
    actorTitle: "VP Demand Generation",
    actorCompanyName: "BuyerCo",
    actorProfileUrl: "https://www.linkedin.com/in/lauren-garner/",
    actorLinkedinPublicId: "lauren-garner",
    actorLinkedinMemberId: "member-lauren",
    summary: "Lauren Garner appeared in your LinkedIn profile viewers. Viewed 20h ago.",
  });
  const secondView = baseReviewItem({
    id: "obs-view-2",
    kind: "profile_view_received",
    surfaceKey: "linkedin-profile-views",
    actorName: "Nina Prospect",
    actorTitle: "Director of Demand Generation",
    actorCompanyName: "BuyerCo",
    actorProfileUrl: "https://www.linkedin.com/in/nina-prospect/",
    actorLinkedinPublicId: "nina-prospect",
    actorLinkedinMemberId: "member-nina",
    summary: "Nina Prospect appeared in your LinkedIn profile viewers. Viewed 18h ago.",
  });
  const truthAccounts = [{
    accountId: "account-1",
    surfaces: [
      {
        key: "linkedin-profile-views",
        label: "Profile Views",
        lastRunStatus: "success",
        lastSyncedAt: "2026-06-05T16:30:00.000Z",
        lastObservedAt: "2026-06-05T16:30:00.000Z",
        lastItemCount: 5,
        meta: {},
      },
    ],
  }];
  const model = buildConnectionsViewModel({
    observations: [firstView, secondView],
    truthAccounts,
    agentQueue: {
      tasks: [
        {
          kind: "run_inbound_sync",
          reason: "itemization_gap",
          surface: "linkedin-profile-views",
          surfaceKeys: ["linkedin-profile-views"],
          mode: "full",
        },
      ],
    },
  });

  const html = renderConnectionsPage(model, {
    user: { label: "william-main" },
    generatedAt: now,
    interactive: true,
    agentRuntime: {
      lock: { active: false },
      scheduler: { running: false },
    },
  });

  assert.match(html, /Resync queued/);
  assert.match(html, /Exo already queued a full resync for this surface/i);
  assert.match(html, /data-exo-writer="runAgentQueuePass"/);
  assert.match(html, /data-exo-autostart-key=/);
  assert.doesNotMatch(html, /reconcile to trust this surface/i);
  assert.doesNotMatch(html, /Sync via agent/);
});

test("connections marks queued repair as in progress while the agent pass is active", () => {
  const profileView = baseReviewItem({
    id: "obs-view-running",
    kind: "profile_view_received",
    surfaceKey: "linkedin-profile-views",
    actorName: "Lauren Garner",
    actorTitle: "VP Demand Generation",
    actorCompanyName: "BuyerCo",
    actorProfileUrl: "https://www.linkedin.com/in/lauren-garner/",
    actorLinkedinPublicId: "lauren-garner",
    actorLinkedinMemberId: "member-lauren",
    summary: "Lauren Garner appeared in your LinkedIn profile viewers. Viewed 20h ago.",
  });
  const model = buildConnectionsViewModel({
    observations: [profileView],
    truthAccounts: [{
      accountId: "account-1",
      surfaces: [
        {
          key: "linkedin-profile-views",
          label: "Profile Views",
          lastRunStatus: "success",
          lastSyncedAt: "2026-06-05T16:30:00.000Z",
          lastObservedAt: "2026-06-05T16:30:00.000Z",
          lastItemCount: 2,
          meta: {},
        },
      ],
    }],
    agentQueue: {
      tasks: [
        {
          kind: "run_inbound_sync",
          reason: "itemization_gap",
          surface: "linkedin-profile-views",
          surfaceKeys: ["linkedin-profile-views"],
          mode: "full",
        },
      ],
    },
  });

  const html = renderConnectionsPage(model, {
    user: { label: "william-main" },
    generatedAt: now,
    interactive: true,
    agentRuntime: {
      lock: { active: true, pid: 4242 },
      scheduler: { running: false },
    },
  });

  assert.match(html, /Resyncing/);
  assert.match(html, /Exo is running a full resync for this surface/i);
  assert.doesNotMatch(html, /data-exo-autostart-key=/);
});

test("connections hides private-mode aggregate profile-view rows and keeps viewer labels on named viewers", () => {
  const aggregateView = baseReviewItem({
    id: "obs-private",
    kind: "profile_view_received",
    surfaceKey: "linkedin-profile-views",
    actorName: "92 LinkedIn members",
    actorTitle: null,
    actorCompanyName: null,
    actorHandle: null,
    actorProfileUrl: null,
    actorLinkedinPublicId: null,
    actorLinkedinMemberId: null,
    summary: "92 LinkedIn members appeared in your LinkedIn profile viewers. These people viewed your profile in Private mode.",
    observedAt: "2026-06-05T15:11:00.426Z",
    eventAt: null,
    notes: null,
  });
  const namedView = baseReviewItem({
    id: "obs-viewer",
    kind: "profile_view_received",
    surfaceKey: "linkedin-profile-views",
    actorName: "Nina Prospect",
    actorTitle: "Director of Demand Generation",
    actorCompanyName: "BuyerCo",
    actorProfileUrl: "https://www.linkedin.com/in/nina-prospect/",
    actorLinkedinPublicId: "nina-prospect",
    actorLinkedinMemberId: "member-nina",
    summary: "Nina Prospect appeared in your LinkedIn profile viewers. Viewed 2mo ago.",
    observedAt: "2026-06-04T16:20:00.000Z",
    eventAt: null,
    notes: "LinkedIn viewer label: 1st",
  });

  const model = buildConnectionsViewModel({
    observations: [aggregateView, namedView],
    truthAccounts: [baseTruthAccount()],
  });
  const viewsTab = model.tabs.find((tab) => tab.key === "views");
  const html = renderConnectionsPage(model, {
    user: { label: "william-main" },
    generatedAt: now,
  });

  assert.ok(viewsTab);
  assert.equal(viewsTab.people.length, 1);
  assert.equal(viewsTab.people[0].note, "Viewer label: 1st");
  assert.match(html, /Viewer label: 1st/);
  assert.doesNotMatch(html, /92 LinkedIn members/);
});

test("connections shows synced follower and following rows even when they are baseline confirmed observations", () => {
  const follower = baseReviewItem({
    id: "obs-follower",
    kind: "follower_confirmed",
    surfaceKey: "linkedin-followers-list",
    actorName: "Grace Follower",
    actorTitle: "VP Growth",
    actorCompanyName: "BuyerCo",
    actorProfileUrl: "https://www.linkedin.com/in/grace-follower/",
    actorLinkedinPublicId: "grace-follower",
    actorLinkedinMemberId: "member-grace",
    summary: "Grace Follower is present in the LinkedIn follower list.",
  });
  const following = baseReviewItem({
    id: "obs-following",
    kind: "follow_state_confirmed",
    surfaceKey: "linkedin-following-list",
    actorName: "Harper Followed",
    actorTitle: "VP Revenue Operations",
    actorCompanyName: "BuyerCo",
    actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
    actorLinkedinPublicId: "harper-followed",
    actorLinkedinMemberId: "member-harper",
    summary: "Harper Followed is currently on the live following list.",
  });
  const truthAccounts = [{
    accountId: "account-1",
    surfaces: [
      {
        key: "linkedin-followers-list",
        label: "Followers",
        lastRunStatus: "success",
        lastSyncedAt: "2026-06-05T16:30:00.000Z",
        lastObservedAt: "2026-06-05T16:30:00.000Z",
        lastItemCount: 1,
        meta: {},
      },
      {
        key: "linkedin-following-list",
        label: "Following",
        lastRunStatus: "success",
        lastSyncedAt: "2026-06-05T16:30:00.000Z",
        lastObservedAt: "2026-06-05T16:30:00.000Z",
        lastItemCount: 1,
        meta: {},
      },
    ],
  }];

  const model = buildConnectionsViewModel({
    observations: [follower, following],
    truthAccounts,
  });

  const followersTab = model.tabs.find((tab) => tab.key === "followers");
  const followingTab = model.tabs.find((tab) => tab.key === "following");

  assert.ok(followersTab);
  assert.ok(followingTab);
  assert.equal(followersTab.people.length, 1);
  assert.equal(followingTab.people.length, 1);
  assert.equal(followersTab.people[0].name, "Grace Follower");
  assert.equal(followingTab.people[0].name, "Harper Followed");
});

test("connections sent rows expose claim-to-motion and stale-withdraw controls on the list itself", () => {
  const staleSent = baseReviewItem({
    id: "obs-stale-sent",
    observedAt: "2026-05-01T16:20:00.000Z",
    eventAt: "2026-05-01T16:20:00.000Z",
    actorName: "Wendy Withdraw",
    actorTitle: "VP Revenue",
    actorCompanyName: "Withdraw Co",
    actorProfileUrl: "https://www.linkedin.com/in/wendy-withdraw/",
    actorLinkedinPublicId: "wendy-withdraw",
    actorLinkedinMemberId: "member-wendy",
    summary: "Wendy Withdraw is still pending on LinkedIn.",
    motion: null,
    company: null,
    prospect: null,
  });
  const freshSent = baseReviewItem({
    id: "obs-fresh-sent",
    observedAt: "2026-06-04T16:20:00.000Z",
    eventAt: "2026-06-04T16:20:00.000Z",
    actorName: "Fiona Fresh",
    actorTitle: "VP Operations",
    actorCompanyName: "Fresh Co",
    actorProfileUrl: "https://www.linkedin.com/in/fiona-fresh/",
    actorLinkedinPublicId: "fiona-fresh",
    actorLinkedinMemberId: "member-fiona",
    summary: "Fiona Fresh is still pending on LinkedIn.",
    motion: null,
    company: null,
    prospect: null,
  });

  const model = buildConnectionsViewModel({
    reviewItems: [freshSent, staleSent],
    truthAccounts: [baseTruthAccount()],
  });
  const sentTab = model.tabs.find((tab) => tab.key === "sent");

  assert.ok(sentTab);
  assert.equal(sentTab.people.length, 2);
  assert.equal(sentTab.people[0].name, "Wendy Withdraw");
  assert.equal(sentTab.people[0].sentGroup, "stale");
  assert.equal(sentTab.people[0].canClaim, true);
  assert.equal(sentTab.people[0].canWithdraw, true);
  assert.equal(sentTab.people[1].name, "Fiona Fresh");
  assert.equal(sentTab.people[1].sentGroup, "fresh");
  assert.equal(sentTab.people[1].canWithdraw, false);

  const html = renderConnectionsPage(model, {
    user: { label: "william-main" },
    generatedAt: now,
    interactive: true,
    userId: "user-1",
    claimMotions: [
      {
        id: "transition-1",
        name: "transition-inbound-backlog",
        offerLabel: "Transition backlog",
        premise: "Continue and reconcile relationships started before Exo, then re-home them into real motions once they are understood.",
      },
      {
        id: "motion-1",
        name: "harsh-spare-mongoose",
        offerLabel: "Knit",
        premise: "This offer matters when GTM teams need governed outbound work instead of disconnected one-off outreach.",
      },
    ],
  });

  assert.ok((html.match(/data-exo-writer="claimInboundPersonToMotion"/g) ?? []).length >= 2);
  assert.match(html, /data-exo-writer="recordInboundObservation"/);
  assert.match(html, /connection_request_withdraw_requested/);
  assert.match(html, /Destination motion/);
  assert.match(html, /Claim here/);
  assert.match(html, /Knit/);
  assert.match(html, /Premise/);
  assert.match(html, /governed outbound work instead of disconnected one-off outreach/);
  assert.match(html, /Stale/);
  assert.doesNotMatch(html, /data-exo-radio="claim-motion-/);
  assert.doesNotMatch(html, /<span>Profile<\/span>/);
});

test("daily waiting branches tell the operator to move on after a viewed-after-touch signal", () => {
  const rawUser = {
    id: "user-1",
    createdAt: "2026-06-04T12:00:00.000Z",
    updatedAt: "2026-06-04T12:00:00.000Z",
    label: "william-main",
  };
  const rawObservation = {
    id: "obs-1",
    dedupeKey: "obs-1",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    platform: "linkedin",
    surfaceKey: "linkedin-profile-views",
    kind: "profile_view_after_touch",
    truthLevel: "authoritative",
    observedAt: "2026-06-04T18:10:00.000Z",
    recordedAt: "2026-06-04T18:10:00.000Z",
    eventAt: "2026-06-04T17:45:00.000Z",
    externalId: "view-1",
    actorName: "Parm Uppal",
    actorTitle: "Chief Revenue Officer",
    actorCompanyName: "Chainguard",
    actorHandle: "parm-uppal",
    actorProfileUrl: "https://www.linkedin.com/in/parm-uppal/",
    actorLinkedinPublicId: "parm-uppal",
    actorLinkedinMemberId: "member-parm",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: null,
    sourceUrl: "https://www.linkedin.com/analytics/profile-views/",
    subject: null,
    summary: "Parm Uppal viewed our profile after the connection request.",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    notes: null,
    messages: [],
  };

  const daily = buildDailyView(
    rawUser,
    [rawMotionWithWaitingBranch()],
    [rawCompany()],
    [],
    [rawObservation],
    { now }
  );

  assert.equal(daily.items[0].source.type, "parallel_support_action");
  assert.equal(daily.items[0].prospect.name, "Casey Reserve");
  assert.equal(daily.items[0].waitingBranch.kind, "wait_for_connection_response");
  assert.match(daily.items[0].waitingBranch.nextMove, /Do not add another touch to Parm Uppal right now\./i);
  assert.match(daily.items[0].waitingBranch.nextMove, /move to the next ready branch/i);
  assert.match(daily.items[0].waitingBranch.why, /viewed your profile after the connection request/i);
});

test("inbound review treats viewed-after-touch as a patience signal, not a prompt to add another touch", () => {
  const rawUser = {
    id: "user-1",
    createdAt: "2026-06-04T12:00:00.000Z",
    updatedAt: "2026-06-04T12:00:00.000Z",
    label: "william-main",
  };
  const rawObservation = {
    id: "obs-1",
    dedupeKey: "obs-1",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    platform: "linkedin",
    surfaceKey: "linkedin-profile-views",
    kind: "profile_view_after_touch",
    truthLevel: "authoritative",
    observedAt: "2026-06-04T18:10:00.000Z",
    recordedAt: "2026-06-04T18:10:00.000Z",
    eventAt: "2026-06-04T17:45:00.000Z",
    externalId: "view-1",
    actorName: "Parm Uppal",
    actorTitle: "Chief Revenue Officer",
    actorCompanyName: "Chainguard",
    actorHandle: "parm-uppal",
    actorProfileUrl: "https://www.linkedin.com/in/parm-uppal/",
    actorLinkedinPublicId: "parm-uppal",
    actorLinkedinMemberId: "member-parm",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: null,
    sourceUrl: "https://www.linkedin.com/analytics/profile-views/",
    subject: null,
    summary: "Parm Uppal viewed our profile after the connection request.",
    motionId: "motion-1",
    companyId: "company-1",
    prospectId: "prospect-1",
    notes: null,
    messages: [],
  };

  const review = buildInboundReviewView(
    rawUser,
    [rawObservation],
    [rawMotionWithWaitingBranch()],
    [rawCompany()],
  );

  assert.equal(review.reviewItems[0].state, "attention_signal");
  assert.equal(review.reviewItems[0].priority, "low");
  assert.match(review.reviewItems[0].recommendedAction, /Do not add another touch/i);
  assert.match(review.reviewItems[0].recommendedAction, /move to the next ready branch/i);
});

test("inbound review leaves unclaimed profile views in the connections surface instead of escalating them into claim decisions", () => {
  const rawUser = {
    id: "user-1",
    createdAt: "2026-06-04T12:00:00.000Z",
    updatedAt: "2026-06-04T12:00:00.000Z",
    label: "william-main",
  };
  const rawObservation = {
    id: "obs-view-unclaimed",
    dedupeKey: "obs-view-unclaimed",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    platform: "linkedin",
    surfaceKey: "linkedin-profile-views",
    kind: "profile_view_received",
    truthLevel: "authoritative",
    observedAt: "2026-06-04T16:20:00.000Z",
    recordedAt: "2026-06-04T16:20:00.000Z",
    eventAt: null,
    externalId: "view-1",
    actorName: "Nina Prospect",
    actorTitle: "Director of Demand Generation",
    actorCompanyName: "BuyerCo",
    actorHandle: "nina-prospect",
    actorProfileUrl: "https://www.linkedin.com/in/nina-prospect/",
    actorLinkedinPublicId: "nina-prospect",
    actorLinkedinMemberId: "member-nina",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: null,
    sourceUrl: "https://www.linkedin.com/analytics/profile-views/",
    subject: null,
    summary: "Nina Prospect appeared in your LinkedIn profile viewers. Viewed 2mo ago.",
    motionId: null,
    companyId: null,
    prospectId: null,
    notes: "LinkedIn viewer label: 1st",
    messages: [],
  };

  const review = buildInboundReviewView(rawUser, [rawObservation], [], []);

  assert.equal(review.reviewItems[0].state, "attention_signal");
  assert.equal(review.reviewItems[0].category, "signal");
});
