// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resetResolveUserConnectionCachesForTest, resolveUserConnection } from "../src/core/resolve-user-connection.js";

test.beforeEach(() => {
  resetResolveUserConnectionCachesForTest();
});

test.afterEach(() => {
  resetResolveUserConnectionCachesForTest();
});

test("resolveUserConnection backfills LinkedIn premium metadata from shared runtime hints for an existing managed account", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-resolve-user-connection-"));
  const stateDir = path.join(tempDir, ".exo");
  const automationTmpDir = path.join(stateDir, "automation-tmp", "codex-task-test");
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(automationTmpDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "runtime-account-hints.json"),
    JSON.stringify({
      syncedAt: "2026-06-06T18:00:00.000Z",
      accounts: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin",
          handle: "williamflanagan",
          label: "William Flanagan",
          metadata: {
            accountType: "LINKEDIN",
          },
        },
      ],
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(automationTmpDir, "inbound-linkedin-linkedin-managed.json"),
    JSON.stringify({
      accountVerification: {
        connectedAccount: {
          accountId: "acct-linkedin",
          type: "LINKEDIN",
          name: "William Flanagan",
          publicIdentifier: "williamflanagan",
          premiumFeatures: ["sales_navigator"],
        },
      },
    }, null, 2),
  );

  process.env.EXO_STATE_DIR = stateDir;
  process.env.EXO_HOME_STATE_DIR = stateDir;

  try {
    const result = resolveUserConnection({
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
      accounts: [
        {
          id: "linkedin-managed",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          capability: "linkedin",
          handle: "williamflanagan",
          label: "William Flanagan",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-unipile",
          providerAccountId: "acct-linkedin",
          preferred: true,
          metadata: null,
          notes: null,
          inboundSync: {
            surfaces: [],
          },
        },
      ],
      harnessConnections: [
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
      inboundIgnoreRules: [],
    }, [], { capability: "linkedin" });

    assert.equal(result.resolutionStatus, "resolved");
    assert.equal(result.resolved?.connectionNoteCapable, true);
    assert.deepEqual(result.resolved?.metadata?.premiumFeatures, ["sales_navigator"]);
  } finally {
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveUserConnection prefers provider-matched LinkedIn evidence with premium signals over newer failed captures", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-resolve-user-connection-"));
  const stateDir = path.join(tempDir, ".exo");
  const failedCaptureDir = path.join(stateDir, "automation-tmp", "codex-task-z-failed");
  const capturedAccountDir = path.join(stateDir, "automation-tmp", "codex-task-a-captured");
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;

  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(failedCaptureDir, { recursive: true });
  fs.mkdirSync(capturedAccountDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "runtime-account-hints.json"),
    JSON.stringify({
      syncedAt: "2026-06-06T18:00:00.000Z",
      accounts: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-fallback",
          handle: "williamflanagan",
          label: "William Flanagan",
          metadata: {
            accountType: "LINKEDIN",
          },
        },
      ],
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(failedCaptureDir, "inbound-linkedin-linkedin-managed-fallback.json"),
    JSON.stringify({
      status: "failed",
      account_identity: {
        state: "failed",
      },
      surfaces: {},
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(capturedAccountDir, "inbound-linkedin-linkedin-managed-fallback.json"),
    JSON.stringify({
      account: {
        state: "verified",
        provider: "LINKEDIN",
        account_id: "acct-linkedin-fallback",
        public_identifier: "williamflanagan",
        name: "William Flanagan",
      },
      surfaces: {
        messaging_inbox: {
          state: "captured",
          items: [
            {
              folder: ["INBOX", "INBOX_LINKEDIN_SALES_NAVIGATOR"],
            },
          ],
        },
      },
    }, null, 2),
  );

  process.env.EXO_STATE_DIR = stateDir;
  process.env.EXO_HOME_STATE_DIR = stateDir;

  try {
    const result = resolveUserConnection({
      id: "user-2",
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
      accounts: [
        {
          id: "linkedin-managed-fallback",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          capability: "linkedin",
          handle: "williamflanagan",
          label: "William Flanagan",
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-unipile",
          providerAccountId: "acct-linkedin-fallback",
          preferred: true,
          metadata: null,
          notes: null,
          inboundSync: {
            surfaces: [],
          },
        },
      ],
      harnessConnections: [
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
      inboundIgnoreRules: [],
    }, [], { capability: "linkedin" });

    assert.equal(result.resolutionStatus, "resolved");
    assert.equal(result.resolved?.connectionNoteCapable, true);
    assert.deepEqual(result.resolved?.metadata?.premiumFeatures, ["sales_navigator"]);
    assert.equal(result.resolved?.metadata?.publicIdentifier, "williamflanagan");
  } finally {
    if (previousStateDir == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveUserConnection canonicalizes duplicate same-mailbox Gmail accounts onto the Gmail connector path", () => {
  const result = resolveUserConnection({
    id: "user-3",
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
    accounts: [
      {
        id: "gmail-unipile",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "gmail",
        handle: "william@example.com",
        label: "William Gmail via Unipile",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-unipile",
        providerAccountId: "acct-unipile-mail",
        preferred: true,
        metadata: null,
        notes: null,
        inboundSync: {
          surfaces: [],
        },
      },
      {
        id: "gmail-real",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        capability: "gmail",
        handle: "william@example.com",
        label: "William Gmail",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-gmail",
        providerAccountId: "acct-gmail-mail",
        preferred: false,
        metadata: null,
        notes: null,
        inboundSync: {
          surfaces: [],
        },
      },
    ],
    harnessConnections: [
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
      {
        id: "harness-gmail",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        runtime: "codex",
        connector: "gmail",
        label: null,
        status: "available",
        notes: null,
      },
    ],
    inboundIgnoreRules: [],
  }, [], { capability: "gmail" });

  assert.equal(result.resolutionStatus, "resolved");
  assert.equal(result.resolved?.accountId, "gmail-real");
  assert.equal(result.resolved?.harnessConnection?.connector, "gmail");
  assert.equal(result.candidates.length, 1);
});
