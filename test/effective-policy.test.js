// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyViewPolicyToUser,
  compileEffectivePolicy,
  filterInboundCuesForPolicy,
  filterInboundObservationsForPolicy,
  matchesObservationAgainstPolicy,
} from "../src/core/policy-ledger.js";

const baseUser = {
  id: "user-1",
  createdAt: "2026-06-04T18:00:00.000Z",
  updatedAt: "2026-06-04T18:00:00.000Z",
  label: "operator",
  owner: "operator",
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
      id: "account-linkedin",
      createdAt: "2026-06-04T18:00:00.000Z",
      updatedAt: "2026-06-04T18:00:00.000Z",
      capability: "linkedin",
      handle: "operator-linkedin",
      label: "Operator LinkedIn",
      sourceType: "harness-connection",
      browserProfileId: null,
      harnessConnectionId: "hc-1",
      providerAccountId: "acct-linkedin-1",
      preferred: true,
      automationControls: {
        weeklyQuotas: { profileVisits: null, invitations: null, messages: null },
      },
      notes: null,
      inboundSync: {
        surfaces: [
          {
            surfaceKey: "linkedin-received-invitations",
            enabled: true,
            lastSyncedAt: null,
            lastObservedAt: null,
            lastRunStatus: "never",
            lastItemCount: null,
            lastVisibleTotalCount: null,
            lastCaptureCompleteness: null,
            lastRequestedMode: null,
            lastActualMode: null,
            lastReconcileRequired: null,
            lastReconcileReason: null,
            lastExhaustionStatus: null,
            lastExhaustionReason: null,
            lastPaginationAttempted: null,
            lastTerminalSignalSeen: null,
            lastStalledPassCount: null,
            lastObservationCount: null,
            lastItemizationGapCount: null,
            lastCountDiscrepancyCount: null,
            lastError: null,
          },
        ],
      },
    },
  ],
  harnessConnections: [
    {
      id: "hc-1",
      createdAt: "2026-06-04T18:00:00.000Z",
      updatedAt: "2026-06-04T18:00:00.000Z",
      runtime: "codex",
      connector: "chrome",
      label: null,
      status: "available",
      notes: null,
    },
  ],
  inboundIgnoreRules: [],
};

const matchingObservation = {
  id: "obs-1",
  dedupeKey: "account-linkedin:linkedin-received-invitations:invite-1",
  userId: "user-1",
  accountId: "account-linkedin",
  capability: "linkedin",
  platform: "linkedin",
  surfaceKey: "linkedin-received-invitations",
  kind: "connection_request_received",
  truthLevel: "authoritative",
  observedAt: "2026-06-04T18:00:00.000Z",
  recordedAt: "2026-06-04T18:00:00.000Z",
  eventAt: null,
  externalId: "invite-1",
  actorName: "Alicia Buyer",
  actorTitle: "VP Revenue Operations",
  actorCompanyName: "BuyerCo",
  actorHandle: "alicia@buyer.example",
  actorProfileUrl: "https://www.linkedin.com/in/alicia-buyer/",
  actorLinkedinPublicId: "alicia-buyer",
  actorLinkedinMemberId: "489864114",
  actorAvatarSourceUrl: null,
  actorAvatarUrl: null,
  threadUrl: "https://www.linkedin.com/messaging/thread/1",
  sourceUrl: "https://www.linkedin.com/in/alicia-buyer/",
  subject: null,
  summary: "Alicia Buyer sent a new invite.",
  motionId: null,
  companyId: null,
  prospectId: null,
  notes: null,
  messages: [],
};

const gmailUser = {
  ...baseUser,
  accounts: [
    {
      id: "account-gmail",
      createdAt: "2026-06-04T18:00:00.000Z",
      updatedAt: "2026-06-04T18:00:00.000Z",
      capability: "gmail",
      handle: "operator@example.com",
      label: "Operator Gmail",
      sourceType: "harness-connection",
      browserProfileId: null,
      harnessConnectionId: "hc-gmail-1",
      providerAccountId: "acct-gmail-1",
      preferred: true,
      automationControls: {
        weeklyQuotas: { profileVisits: null, invitations: null, messages: null },
      },
      notes: null,
      inboundSync: {
        surfaces: [
          {
            surfaceKey: "gmail-inbox-threads",
            enabled: true,
            lastSyncedAt: null,
            lastObservedAt: null,
            lastRunStatus: "never",
            lastItemCount: null,
            lastVisibleTotalCount: null,
            lastCaptureCompleteness: null,
            lastRequestedMode: null,
            lastActualMode: null,
            lastReconcileRequired: null,
            lastReconcileReason: null,
            lastExhaustionStatus: null,
            lastExhaustionReason: null,
            lastPaginationAttempted: null,
            lastTerminalSignalSeen: null,
            lastStalledPassCount: null,
            lastObservationCount: null,
            lastItemizationGapCount: null,
            lastCountDiscrepancyCount: null,
            lastError: null,
          },
        ],
      },
    },
  ],
  harnessConnections: [
    {
      id: "hc-gmail-1",
      createdAt: "2026-06-04T18:00:00.000Z",
      updatedAt: "2026-06-04T18:00:00.000Z",
      runtime: "codex",
      connector: "gmail",
      label: null,
      status: "available",
      notes: null,
    },
  ],
};

const gmailObservation = {
  id: "obs-gmail-1",
  dedupeKey: "account-gmail:gmail-inbox-threads:thread-1",
  userId: "user-1",
  accountId: "account-gmail",
  capability: "gmail",
  platform: "gmail",
  surfaceKey: "gmail-inbox-threads",
  kind: "email_thread_updated",
  truthLevel: "authoritative",
  observedAt: "2026-06-04T18:00:00.000Z",
  recordedAt: "2026-06-04T18:00:00.000Z",
  eventAt: null,
  externalId: "thread-1",
  actorName: "Lina Park",
  actorTitle: "Procurement Support Department",
  actorCompanyName: "GovPointe",
  actorHandle: "lpark@govpointeoffice.us",
  actorProfileUrl: null,
  actorLinkedinPublicId: null,
  actorLinkedinMemberId: null,
  actorAvatarSourceUrl: null,
  actorAvatarUrl: null,
  threadUrl: "https://mail.google.com/mail/#all/thread-1",
  sourceUrl: "https://mail.google.com/mail/#all/thread-1",
  subject: null,
  summary: "Repeated follow-up on an RFP thread.",
  motionId: null,
  companyId: null,
  prospectId: null,
  notes: "Subject: Re: Halfmoon Hillcrest Fire Dept. RFP",
  messages: [],
};

test("effective policy matches identities by email, LinkedIn ids, profile URL, and thread URL", () => {
  const effective = compileEffectivePolicy({
    globalEvents: [
      {
        id: "ignore-email",
        createdAt: "2026-06-04T18:00:00.000Z",
        kind: "ignore_identity",
        reason: "Ignore by email.",
        account: null,
        person: { actorHandle: "alicia@buyer.example" },
        surface: null,
      },
    ],
    localEvents: [],
  });
  assert.equal(matchesObservationAgainstPolicy(matchingObservation, baseUser, effective), true);

  for (const person of [
    { actorLinkedinMemberId: "489864114" },
    { actorLinkedinPublicId: "alicia-buyer" },
    { actorProfileUrl: "https://www.linkedin.com/in/alicia-buyer/" },
    { threadUrl: "https://www.linkedin.com/messaging/thread/1" },
  ]) {
    const variant = compileEffectivePolicy({
      globalEvents: [{
        id: `rule-${Object.keys(person)[0]}`,
        createdAt: "2026-06-04T18:00:00.000Z",
        kind: "ignore_identity",
        reason: "Ignore by stable identity.",
        account: null,
        person,
        surface: null,
      }],
      localEvents: [],
    });
    assert.equal(matchesObservationAgainstPolicy(matchingObservation, baseUser, variant), true);
  }
});

test("effective policy filters observations and cues and hides locally blocked surfaces", () => {
  const effective = compileEffectivePolicy({
    globalEvents: [
      {
        id: "ignore-email",
        createdAt: "2026-06-04T18:00:00.000Z",
        kind: "ignore_identity",
        reason: "Ignore by email.",
        account: null,
        person: { actorHandle: "alicia@buyer.example" },
        surface: null,
      },
    ],
    localEvents: [
      {
        id: "hide-surface",
        createdAt: "2026-06-04T18:01:00.000Z",
        kind: "hide_surface",
        reason: "Hide received invites in this project.",
        account: null,
        person: null,
        surface: {
          capability: "linkedin",
          surfaceKey: "linkedin-received-invitations",
        },
      },
    ],
  });

  const filteredObservations = filterInboundObservationsForPolicy([matchingObservation], baseUser, effective);
  const filteredCues = filterInboundCuesForPolicy([{
    id: "cue-1",
    dedupeKey: "cue-1",
    userId: "user-1",
    accountId: "account-linkedin",
    capability: "linkedin",
    platform: "linkedin",
    surfaceKey: "linkedin-received-invitations",
    kind: "invite_badge",
    source: "manual_hint",
    status: "open",
    observedAt: "2026-06-04T18:00:00.000Z",
    recordedAt: "2026-06-04T18:00:00.000Z",
    resolvedAt: null,
    summary: "Saw an invite badge.",
    motionId: null,
    companyId: null,
    prospectId: null,
    notes: null,
  }], baseUser, effective);
  const viewUser = applyViewPolicyToUser(baseUser, effective);

  assert.equal(filteredObservations.length, 0);
  assert.equal(filteredCues.length, 0);
  assert.equal(
    viewUser.accounts[0].inboundSync.surfaces.find((surface) => surface.surfaceKey === "linkedin-received-invitations")?.enabled,
    false,
  );
});

test("effective policy does not collapse Gmail thread URLs to the mailbox root", () => {
  const effective = compileEffectivePolicy({
    globalEvents: [
      {
        id: "ignore-generic-gmail-root",
        createdAt: "2026-06-04T18:00:00.000Z",
        kind: "ignore_identity",
        reason: "Ignore a different Gmail sender/thread.",
        account: {
          providerAccountId: "acct-gmail-1",
          capability: null,
          handle: null,
        },
        person: {
          actorHandle: "noreply@md.getsentry.com",
          threadUrl: "https://mail.google.com/mail",
        },
        surface: null,
      },
    ],
    localEvents: [],
  });

  assert.equal(matchesObservationAgainstPolicy(gmailObservation, gmailUser, effective), false);
  assert.deepEqual(filterInboundObservationsForPolicy([gmailObservation], gmailUser, effective), [gmailObservation]);

  const exactThreadPolicy = compileEffectivePolicy({
    globalEvents: [
      {
        id: "ignore-exact-gmail-thread",
        createdAt: "2026-06-04T18:00:00.000Z",
        kind: "ignore_identity",
        reason: "Ignore this exact Gmail thread.",
        account: {
          providerAccountId: "acct-gmail-1",
          capability: null,
          handle: null,
        },
        person: {
          actorHandle: "noreply@md.getsentry.com",
          threadUrl: "https://mail.google.com/mail/#all/thread-1",
        },
        surface: null,
      },
    ],
    localEvents: [],
  });

  assert.equal(matchesObservationAgainstPolicy(gmailObservation, gmailUser, exactThreadPolicy), true);
});
