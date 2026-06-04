// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { resolveUserConnection } from "../src/core/resolve-user-connection.js";

function baseUser() {
  return {
    id: "user-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "william-main",
    owner: "operator",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00",
    },
    accounts: [],
    harnessConnections: [],
  };
}

function harnessConnection() {
  return {
    id: "harness-unipile",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    runtime: "codex",
    connector: "unipile",
    label: null,
    status: "available",
    notes: null,
  };
}

function managedLinkedinAccount(overrides = {}) {
  return {
    id: overrides.id ?? "account-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    capability: "linkedin",
    handle: overrides.handle ?? "williamflanagan",
    label: overrides.label ?? "William Flanagan",
    sourceType: "harness-connection",
    browserProfileId: null,
    harnessConnectionId: "harness-unipile",
    providerAccountId: overrides.providerAccountId ?? null,
    preferred: overrides.preferred ?? false,
    automationControls: {
      weeklyQuotas: {
        profileVisits: null,
        invitations: null,
        messages: null,
      },
    },
    notes: null,
    inboundSync: {
      surfaces: [],
    },
  };
}

function browserProfile() {
  return {
    id: "profile-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "LinkedIn Main",
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
      accounts: [{ capability: "linkedin", handle: "william-browser" }],
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

function browserLinkedinAccount(overrides = {}) {
  return {
    id: overrides.id ?? "browser-account-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    capability: "linkedin",
    handle: overrides.handle ?? "william-browser",
    label: overrides.label ?? "William Browser",
    sourceType: "browser-profile",
    browserProfileId: "profile-1",
    harnessConnectionId: null,
    providerAccountId: null,
    preferred: overrides.preferred ?? false,
    automationControls: {
      weeklyQuotas: {
        profileVisits: null,
        invitations: null,
        messages: null,
      },
    },
    notes: null,
    inboundSync: {
      surfaces: [],
    },
  };
}

test("resolveUserConnection blocks a managed connector account that is not pinned to one exact external identity", () => {
  const user = {
    ...baseUser(),
    accounts: [
      managedLinkedinAccount({
        preferred: true,
        providerAccountId: null,
      }),
    ],
    harnessConnections: [harnessConnection()],
  };

  const result = resolveUserConnection(user, [], { capability: "linkedin" });

  assert.equal(result.resolved, null);
  assert.equal(result.resolutionStatus, "identity_unresolved");
  assert.match(result.reason, /exact external account/i);
});

test("resolveUserConnection blocks multiple managed accounts until one exact account is selected", () => {
  const user = {
    ...baseUser(),
    accounts: [
      managedLinkedinAccount({
        id: "account-1",
        handle: "williamflanagan",
        providerAccountId: "acct-linkedin-1",
      }),
      managedLinkedinAccount({
        id: "account-2",
        handle: "knit-operator",
        label: "Knit Operator",
        providerAccountId: "acct-linkedin-2",
      }),
    ],
    harnessConnections: [harnessConnection()],
  };

  const result = resolveUserConnection(user, [], { capability: "linkedin" });

  assert.equal(result.resolved, null);
  assert.equal(result.resolutionStatus, "identity_ambiguous");
  assert.match(result.reason, /multiple managed linkedin accounts/i);
});

test("resolveUserConnection resolves the preferred managed account when one exact account is selected", () => {
  const user = {
    ...baseUser(),
    accounts: [
      managedLinkedinAccount({
        id: "account-1",
        handle: "williamflanagan",
        providerAccountId: "acct-linkedin-1",
        preferred: true,
      }),
      managedLinkedinAccount({
        id: "account-2",
        handle: "knit-operator",
        label: "Knit Operator",
        providerAccountId: "acct-linkedin-2",
      }),
    ],
    harnessConnections: [harnessConnection()],
  };

  const result = resolveUserConnection(user, [], { capability: "linkedin" });

  assert.equal(result.resolutionStatus, "resolved");
  assert.equal(result.resolved?.handle, "williamflanagan");
  assert.equal(result.resolved?.providerAccountId, "acct-linkedin-1");
});

test("resolveUserConnection does not fall back to a browser profile when managed connector identity is unresolved", () => {
  const user = {
    ...baseUser(),
    accounts: [
      browserLinkedinAccount({
        preferred: true,
      }),
      managedLinkedinAccount({
        id: "account-2",
        handle: "williamflanagan",
        providerAccountId: null,
      }),
    ],
    harnessConnections: [harnessConnection()],
  };

  const result = resolveUserConnection(user, [browserProfile()], { capability: "linkedin" });

  assert.equal(result.resolutionStatus, "identity_unresolved");
  assert.equal(result.resolved, null);
  assert.equal(result.sourceType, "harness-connection");
  assert.match(result.reason, /exact external account/i);
});
