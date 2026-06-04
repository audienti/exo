// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { resolveScopedExecutionAssignment } from "../src/core/resolve-scoped-execution-assignment.js";

function companyFixture() {
  return {
    id: "company-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    name: "Acme",
    domain: "acme.example",
    websiteUrl: "https://acme.example",
    linkedinCompanyUrl: "https://www.linkedin.com/company/acme/",
    logoSourceUrl: null,
    logoUrl: null,
    notes: null,
    tags: [],
    motionIds: [],
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
  };
}

function profileFixture() {
  return {
    id: "profile-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "workspace-main",
    browser: "chrome",
    browserCommand: null,
    userDataDir: "/Users/example/Library/Application Support/Google/Chrome",
    profileDirectory: "Profile 4",
    profilePath: "/Users/example/Library/Application Support/Google/Chrome/Profile 4",
    detectedProfileName: null,
    capabilities: ["generic-web", "linkedin"],
    verifiedCapabilities: ["linkedin"],
    identity: {
      owner: "operator",
      workspace: "workspace",
      scope: "work",
      accounts: [{ capability: "linkedin", handle: "operator-linkedin" }],
    },
    automationControls: {
      weeklyQuotas: {
        profileVisits: null,
        invitations: null,
        messages: null,
      },
    },
    notes: null,
    status: "ready",
    lastTestedAt: null,
    lastTestResult: null,
    lastAuthProbedAt: null,
    lastAuthProbeResult: null,
  };
}

function userFixture() {
  return {
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
        id: "account-1",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "linkedin",
        handle: "operator-linkedin",
        label: null,
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        harnessConnectionId: null,
        preferred: true,
        notes: null,
        inboundSync: {
          surfaces: [],
        },
      },
    ],
    harnessConnections: [],
  };
}

function managedHarnessFixture() {
  return {
    id: "harness-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    runtime: "codex",
    connector: "unipile",
    label: null,
    status: "available",
    notes: null,
  };
}

function managedAccountFixture(overrides = {}) {
  return {
    id: overrides.id ?? "account-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    capability: overrides.capability ?? "linkedin",
    handle: overrides.handle ?? "operator-linkedin",
    label: overrides.label ?? null,
    sourceType: "harness-connection",
    browserProfileId: null,
    harnessConnectionId: "harness-1",
    providerAccountId: overrides.providerAccountId ?? null,
    preferred: overrides.preferred ?? false,
    notes: null,
    automationControls: {
      weeklyQuotas: {
        profileVisits: null,
        invitations: null,
        messages: null,
      },
    },
    inboundSync: {
      surfaces: [],
    },
  };
}

test("resolveScopedExecutionAssignment does not auto-scope a singleton browser-profile-only user", () => {
  const resolution = resolveScopedExecutionAssignment({
    rawCompany: companyFixture(),
    rawProfiles: [profileFixture()],
    rawUsers: [userFixture()],
    capability: "linkedin",
  });

  assert.equal(resolution.source, "none");
  assert.equal(resolution.assignedUser, null);
  assert.equal(resolution.resolvedAccount, null);
});

test("resolveScopedExecutionAssignment does not guess when more than one ready managed linkedin user exists", () => {
  const secondUser = {
    ...userFixture(),
    id: "user-2",
    label: "Operator Two",
    accounts: [managedAccountFixture({ id: "account-2", handle: "operator-two-linkedin", providerAccountId: "acct-linkedin-2", preferred: true })],
    harnessConnections: [managedHarnessFixture()],
  };
  const firstUser = {
    ...userFixture(),
    accounts: [managedAccountFixture({ providerAccountId: "acct-linkedin-1", preferred: true })],
    harnessConnections: [managedHarnessFixture()],
  };

  const resolution = resolveScopedExecutionAssignment({
    rawCompany: companyFixture(),
    rawProfiles: [],
    rawUsers: [firstUser, secondUser],
    capability: "linkedin",
  });

  assert.equal(resolution.source, "none");
  assert.equal(resolution.assignedUser, null);
  assert.equal(resolution.resolvedAccount, null);
});

test("resolveScopedExecutionAssignment auto-scopes a singleton ready managed linkedin user", () => {
  const managedUser = {
    ...userFixture(),
    accounts: [managedAccountFixture({ providerAccountId: "acct-linkedin-1", preferred: true })],
    harnessConnections: [managedHarnessFixture()],
  };

  const resolution = resolveScopedExecutionAssignment({
    rawCompany: companyFixture(),
    rawProfiles: [],
    rawUsers: [managedUser],
    capability: "linkedin",
  });

  assert.equal(resolution.source, "auto-singleton-user");
  assert.equal(resolution.assignedUser?.id, "user-1");
  assert.equal(resolution.resolvedAccount?.status, "ready");
  assert.equal(resolution.resolvedAccount?.providerAccountId, "acct-linkedin-1");
  assert.equal(resolution.accountResolution?.status, "resolved");
});

test("resolveScopedExecutionAssignment auto-scopes a singleton managed linkedin user even when the exact external account is unresolved", () => {
  const managedUser = {
    ...userFixture(),
    accounts: [managedAccountFixture({ providerAccountId: null, preferred: true })],
    harnessConnections: [managedHarnessFixture()],
  };

  const resolution = resolveScopedExecutionAssignment({
    rawCompany: companyFixture(),
    rawProfiles: [],
    rawUsers: [managedUser],
    capability: "linkedin",
  });

  assert.equal(resolution.source, "auto-singleton-user");
  assert.equal(resolution.assignedUser?.id, "user-1");
  assert.equal(resolution.resolvedAccount, null);
  assert.equal(resolution.accountResolution?.status, "identity_unresolved");
  assert.equal(resolution.accountResolution?.sourceType, "harness-connection");
});

test("resolveScopedExecutionAssignment resolves the user first but keeps gmail account identity ambiguous when one user owns multiple exact inboxes", () => {
  const managedUser = {
    ...userFixture(),
    accounts: [
      managedAccountFixture({
        id: "gmail-1",
        capability: "gmail",
        handle: "william@audienti.com",
        providerAccountId: "acct-mail-1",
        preferred: false,
      }),
      managedAccountFixture({
        id: "gmail-2",
        capability: "gmail",
        handle: "william@knitit.ai",
        providerAccountId: "acct-mail-2",
        preferred: false,
      }),
      managedAccountFixture({
        id: "linkedin-1",
        capability: "linkedin",
        handle: "williamflanagan",
        providerAccountId: "acct-linkedin-1",
        preferred: true,
      }),
    ],
    harnessConnections: [managedHarnessFixture()],
  };

  const resolution = resolveScopedExecutionAssignment({
    rawCompany: companyFixture(),
    rawProfiles: [],
    rawUsers: [managedUser],
    capability: "gmail",
  });

  assert.equal(resolution.source, "auto-singleton-user");
  assert.equal(resolution.assignedUser?.id, "user-1");
  assert.equal(resolution.resolvedAccount, null);
  assert.equal(resolution.accountResolution?.status, "identity_ambiguous");
  assert.match(resolution.accountResolution?.reason ?? "", /multiple managed gmail accounts/i);
});

test("resolveScopedExecutionAssignment honors a company-level pinned gmail account ref for a multi-inbox user", () => {
  const managedUser = {
    ...userFixture(),
    accounts: [
      managedAccountFixture({
        id: "gmail-1",
        capability: "gmail",
        handle: "william@audienti.com",
        providerAccountId: "acct-mail-1",
      }),
      managedAccountFixture({
        id: "gmail-2",
        capability: "gmail",
        handle: "william@knitit.ai",
        providerAccountId: "acct-mail-2",
      }),
      managedAccountFixture({
        id: "linkedin-1",
        capability: "linkedin",
        handle: "williamflanagan",
        providerAccountId: "acct-linkedin-1",
        preferred: true,
      }),
    ],
    harnessConnections: [managedHarnessFixture()],
  };
  const company = {
    ...companyFixture(),
    engagementUserAssignment: {
      userId: "user-1",
      label: "Operator",
      owner: "operator",
      accountRefs: ["linkedin:williamflanagan", "gmail:william@knitit.ai"],
      assignedAt: "2026-06-01T00:00:00.000Z",
      assignedBy: "test",
      reason: "Pin the right inbox",
      sticky: true,
    },
  };

  const resolution = resolveScopedExecutionAssignment({
    rawCompany: company,
    rawProfiles: [],
    rawUsers: [managedUser],
    capability: "gmail",
  });

  assert.equal(resolution.source, "company-user");
  assert.equal(resolution.assignedUser?.id, "user-1");
  assert.equal(resolution.resolvedAccount?.handle, "william@knitit.ai");
  assert.equal(resolution.resolvedAccount?.providerAccountId, "acct-mail-2");
  assert.equal(resolution.accountResolution?.status, "resolved");
});
