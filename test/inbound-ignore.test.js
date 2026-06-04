// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-ignore-"));
process.env.EXO_STATE_DIR = stateDir;

const { executeActionIntent } = await import("../src/core/execute-action-intent.js");
const { findUserById, listInboundObservations } = await import("../src/db/database.js");
const { addInboundIgnoreRule } = await import("../src/core/inbound-ignore-rules.js");
const { prepareUserInboundSyncRun } = await import("../src/core/inbound-sync-run.js");

/** @param {string[]} args */
function cli(args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, EXO_STATE_DIR: stateDir },
  }).toString();
}

/** @param {string[]} args */
function cliJson(args) {
  return JSON.parse(cli([...args, "--json"]));
}

test("ignoreInboundObservation writes a durable ignore rule, trashes the Gmail thread, and removes matching rows", async () => {
  const user = cliJson(["users", "add", "--label", "ignore-user", "--owner", "William"]);
  const userWithAccount = cliJson([
    "users", "accounts", "add", user.id,
    "--capability", "gmail",
    "--handle", "operator@example.com",
    "--runtime", "codex",
    "--connector", "gmail",
    "--preferred",
  ]);
  const gmailAccount = userWithAccount.accounts.find((account) => account.capability === "gmail");
  assert.ok(gmailAccount, "gmail account exists");

  const first = cliJson([
    "inbound", "observations", "add", user.id,
    "--account", gmailAccount.id,
    "--surface", "gmail-inbox-threads",
    "--kind", "email_thread_updated",
    "--observed-at", "2026-06-04T16:20:00.000Z",
    "--summary", "Repeated follow-up on an RFP thread.",
    "--actor-name", "Lina Park",
    "--actor-handle", "lpark@govpointeoffice.us",
    "--thread-url", "https://mail.google.com/mail/#all/thread-1",
    "--external-id", "thread-1",
    "--notes", "Subject: Re: Halfmoon Hillcrest Fire Dept. RFP\n\nExternal follow-up thread.",
  ]).observation;

  cliJson([
    "inbound", "observations", "add", user.id,
    "--account", gmailAccount.id,
    "--surface", "gmail-inbox-threads",
    "--kind", "email_thread_updated",
    "--observed-at", "2026-06-04T16:25:00.000Z",
    "--summary", "Second follow-up from the same sender.",
    "--actor-name", "Lina Park",
    "--actor-handle", "lpark@govpointeoffice.us",
    "--thread-url", "https://mail.google.com/mail/#all/thread-2",
    "--external-id", "thread-2",
    "--notes", "Subject: Re: Halfmoon Hillcrest Fire Dept. RFP\n\nAnother follow-up.",
  ]);

  const fakeCodexPath = path.join(stateDir, "fake-codex-gmail-delete.js");
  fs.writeFileSync(fakeCodexPath, `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
const outIndex = args.indexOf("-o");
if (outIndex === -1) process.exit(1);
const outputPath = args[outIndex + 1];
fs.writeFileSync(outputPath, JSON.stringify({ status: "deleted", disposedThreadId: "thread-1", detail: "Moved to trash." }), "utf8");
`, "utf8");
  fs.chmodSync(fakeCodexPath, 0o755);

  const previousCodexCli = process.env.EXO_CODEX_CLI;
  process.env.EXO_CODEX_CLI = fakeCodexPath;
  try {
    const result = await executeActionIntent({
      writer: "ignoreInboundObservation",
      args: { observationId: first.id },
    });
    assert.equal(result.ok, true);
    assert.match(result.message, /Ignoring Lina Park going forward/i);
  } finally {
    if (previousCodexCli == null) {
      delete process.env.EXO_CODEX_CLI;
    } else {
      process.env.EXO_CODEX_CLI = previousCodexCli;
    }
  }

  const updatedUser = findUserById(user.id);
  assert.ok(updatedUser?.inboundIgnoreRules?.some((rule) => rule.actorHandle === "lpark@govpointeoffice.us"));
  assert.equal(listInboundObservations({ userId: user.id }).length, 0);
});

test("prepareUserInboundSyncRun skips ignored inbound rows without creating an itemization gap", () => {
  const rawUser = {
    id: "user-1",
    createdAt: "2026-06-04T16:00:00.000Z",
    updatedAt: "2026-06-04T16:00:00.000Z",
    label: "ignore-sync-user",
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
        createdAt: "2026-06-04T16:00:00.000Z",
        updatedAt: "2026-06-04T16:00:00.000Z",
        capability: "gmail",
        handle: "operator@example.com",
        label: "Operator Gmail",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "conn-1",
        providerAccountId: null,
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
        id: "conn-1",
        createdAt: "2026-06-04T16:00:00.000Z",
        updatedAt: "2026-06-04T16:00:00.000Z",
        runtime: "codex",
        connector: "gmail",
        label: null,
        status: "available",
        notes: null,
      },
    ],
    inboundIgnoreRules: [],
  };

  const { updatedUser } = addInboundIgnoreRule(rawUser, {
    accountId: "account-1",
    capability: "gmail",
    actorHandle: "lpark@govpointeoffice.us",
    reason: "Ignore this sender",
  });

  const payload = {
    mode: "quick",
    accounts: [
      {
        accountId: "account-1",
        surfaces: [
          {
            surfaceKey: "gmail-inbox-threads",
            status: "success",
            observedAt: "2026-06-04T16:20:00.000Z",
            itemCount: 1,
            observations: [
              {
                kind: "email_thread_updated",
                observedAt: "2026-06-04T16:20:00.000Z",
                summary: "Repeated follow-up on an RFP thread.",
                externalId: "thread-1",
                actorName: "Lina Park",
                actorHandle: "lpark@govpointeoffice.us",
                threadUrl: "https://mail.google.com/mail/#all/thread-1",
                sourceUrl: "https://mail.google.com/mail/#all/thread-1",
                notes: "Subject: Re: Halfmoon Hillcrest Fire Dept. RFP\n\nExternal follow-up thread.",
              },
            ],
          },
        ],
      },
    ],
  };

  const result = prepareUserInboundSyncRun(updatedUser, payload, { rawMotions: [], rawExistingObservations: [] });
  assert.equal(result.counts.observationCount, 0);
  assert.equal(result.counts.itemizationGapCount, 0);
  assert.equal(result.accounts[0].surfaces[0].observationCount, 0);
  assert.equal(result.accounts[0].surfaces[0].itemizationGapCount, 0);
});
