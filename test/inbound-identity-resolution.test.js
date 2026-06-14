// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyInboundIdentityResolutionResult,
  buildInboundIdentityResolutionCompanyProfile,
  computeInboundIdentityResolutionDueAt,
  resolveManagedLinkedinAccount,
} from "../src/core/inbound-identity-resolution.js";

function buildObservation(overrides = {}) {
  return {
    id: "obs-1",
    dedupeKey: "obs-1",
    userId: "user-1",
    accountId: "gmail-account-1",
    capability: "gmail",
    platform: "gmail",
    surfaceKey: "gmail-inbox-threads",
    kind: "email_reply_received",
    truthLevel: "authoritative",
    observedAt: "2026-06-12T12:00:00.000Z",
    recordedAt: "2026-06-12T12:00:00.000Z",
    eventAt: null,
    externalId: "thread-1",
    actorName: "Matt M",
    actorTitle: null,
    actorCompanyName: null,
    actorHandle: "matthew@coldcrafthqlabs.com",
    actorProfileUrl: null,
    actorLinkedinPublicId: null,
    actorLinkedinMemberId: null,
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: "https://mail.google.com/mail/u/0/#thread-1",
    sourceUrl: "https://mail.google.com/mail/u/0/#thread-1",
    subject: "William, want 20?",
    summary: "Matt offered a sample list by email.",
    motionId: null,
    companyId: null,
    prospectId: null,
    personId: null,
    providerSharedSecret: null,
    actorCompanyProfile: null,
    identityResolutionStatus: null,
    identityResolutionCheckedAt: null,
    identityResolutionReason: null,
    notes: null,
    messages: [],
    ...overrides,
  };
}

test("resolveManagedLinkedinAccount prefers the available codex unipile account", () => {
  const account = resolveManagedLinkedinAccount({
    id: "user-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "Operator",
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
        id: "linkedin-wrong",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "linkedin",
        handle: "wrong-linkedin",
        label: null,
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-other",
        providerAccountId: "provider-other",
        preferred: false,
        notes: null,
        inboundSync: { surfaces: [] },
      },
      {
        id: "linkedin-right",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "linkedin",
        handle: "right-linkedin",
        label: null,
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-unipile",
        providerAccountId: "provider-right",
        preferred: true,
        notes: null,
        inboundSync: { surfaces: [] },
      },
    ],
    harnessConnections: [
      {
        id: "harness-other",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        runtime: "claude",
        connector: "unipile",
        label: null,
        status: "available",
        notes: null,
      },
      {
        id: "harness-unipile",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        runtime: "codex",
        connector: "unipile",
        label: null,
        status: "available",
        notes: null,
      },
    ],
  }, {
    runtime: "codex",
    connector: "unipile",
    availableOnly: true,
  });

  assert.equal(account?.id, "linkedin-right");
});

test("computeInboundIdentityResolutionDueAt backs off recent no-match retries", () => {
  assert.equal(
    computeInboundIdentityResolutionDueAt(buildObservation({
      identityResolutionStatus: "no_match",
      identityResolutionCheckedAt: "2026-06-12T14:00:00.000Z",
      identityResolutionReason: "Multiple plausible matches.",
    }), "2026-06-12T15:00:00.000Z"),
    "2026-06-12T20:00:00.000Z",
  );
});

test("applyInboundIdentityResolutionResult writes LinkedIn identity and canonical company hints back onto related observations", () => {
  const applied = applyInboundIdentityResolutionResult({
    seedObservation: buildObservation(),
    relatedObservations: [
      buildObservation(),
      buildObservation({
        id: "obs-2",
        dedupeKey: "obs-2",
        externalId: "thread-2",
        observedAt: "2026-06-12T12:10:00.000Z",
        recordedAt: "2026-06-12T12:10:00.000Z",
      }),
    ],
    rawCompanies: [],
    resolution: {
      status: "resolved",
      checkedAt: "2026-06-12T12:15:00.000Z",
      reason: "Matched sender name and company domain to one LinkedIn profile.",
      actorName: "Matt M",
      actorTitle: "Founder",
      actorCompanyName: "ColdCraft HQ Labs",
      linkedinProfileUrl: "https://www.linkedin.com/in/matt-m-example/",
      linkedinPublicId: "matt-m-example",
      linkedinMemberId: "member-123",
      companyDomain: "coldcrafthqlabs.com",
      companyWebsiteUrl: "https://coldcrafthqlabs.com",
      linkedinCompanyUrl: "https://www.linkedin.com/company/coldcrafthq/",
    },
    companyProfile: buildInboundIdentityResolutionCompanyProfile({
      actorCompanyName: "ColdCraft HQ Labs",
      companyDomain: "coldcrafthqlabs.com",
      companyWebsiteUrl: "https://coldcrafthqlabs.com",
      linkedinCompanyUrl: "https://www.linkedin.com/company/coldcrafthq/",
    }),
  });

  assert.equal(applied.updatedObservations.length, 2);
  assert.equal(applied.updatedObservations[0].actorLinkedinPublicId, "matt-m-example");
  assert.equal(applied.updatedObservations[0].identityResolutionStatus, "resolved");
  assert.equal(applied.updatedObservations[0].actorCompanyProfile?.domain, "coldcrafthqlabs.com");
  assert.equal(applied.companiesToCreate.length, 1);
  assert.equal(applied.companiesToCreate[0].name, "ColdCraft HQ Labs");
  assert.equal(applied.updatedObservations[0].companyId, applied.companiesToCreate[0].id);
});
