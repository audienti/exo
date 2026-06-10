// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { buildLinkedinInboundSyncPayload } from "../src/core/inbound-linkedin-sync.js";
import { buildInboxView } from "../src/core/build-inbox-view.js";
import { buildInboundReviewView } from "../src/core/build-inbound-review-view.js";
import { recordInboundObservation } from "../src/core/inbound-observations.js";
import { prepareUserInboundSyncRun } from "../src/core/inbound-sync-run.js";
import { buildBizBridgeImageProxyUrl } from "../src/lib/image-proxy.js";
import { loadJsonCassette, writeJsonCassette } from "./support/cassettes.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const timestamp = "2026-05-31T16:50:13.000Z";

/**
 * @param {string} profilePath
 * @param {{ cookieHosts?: string[], historyUrls?: string[] }} input
 */
function seedBrowserEvidence(profilePath, input) {
  const cookiesDb = new DatabaseSync(path.join(profilePath, "Cookies"));
  cookiesDb.exec("CREATE TABLE cookies (host_key TEXT);");
  for (const host of input.cookieHosts ?? []) {
    cookiesDb.prepare("INSERT INTO cookies (host_key) VALUES (?)").run(host);
  }
  cookiesDb.close();

  const historyDb = new DatabaseSync(path.join(profilePath, "History"));
  historyDb.exec("CREATE TABLE urls (url TEXT);");
  for (const url of input.historyUrls ?? []) {
    historyDb.prepare("INSERT INTO urls (url) VALUES (?)").run(url);
  }
  historyDb.close();
}

/**
 * @param {string} tempDir
 * @param {{
 *   profileDirectory?: string,
 *   profileName?: string,
 *   cookieHosts?: string[],
 *   historyUrls?: string[]
 * }} [options]
 */
function setupReadyChromeProfile(tempDir, options = {}) {
  const userDataDir = path.join(tempDir, "Chrome");
  const profileDirectory = options.profileDirectory ?? "Profile 4";
  const profileName = options.profileName ?? "LinkedIn Main";
  const profilePath = path.join(userDataDir, profileDirectory);
  const browserCommand = path.join(tempDir, `fake-chrome-${profileDirectory.replace(/\s+/g, "-").toLowerCase()}`);

  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(browserCommand, 0o755);
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: { name: profileName }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: profileName } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: options.cookieHosts ?? [".linkedin.com"],
    historyUrls: options.historyUrls ?? ["https://www.linkedin.com/feed/"]
  });

  return {
    userDataDir,
    profileDirectory,
    profilePath,
    profileName,
    browserCommand
  };
}

/**
 * @param {string} tempDir
 * @param {string[]} args
 */
function runCli(tempDir, args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, EXO_STATE_DIR: tempDir },
    encoding: "utf8"
  });
}

/**
 * @template T
 * @param {() => T} callback
 * @returns {T}
 */
function withIsolatedExoState(callback) {
  const previousStateDir = process.env.EXO_STATE_DIR;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-core-"));
  process.env.EXO_STATE_DIR = stateDir;

  try {
    return callback();
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

test("linkedin capture payload preserves visible totals and reconcile metadata for partial sent-invitation surfaces", () => {
  const result = buildLinkedinInboundSyncPayload(
    {
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "william-main",
      owner: "William",
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "william-main",
          sourceType: "browser-profile",
          browserProfileId: "profile-1",
          preferred: true
        }
      ],
      harnessConnections: []
    },
    {
      accountId: "linkedin-account-1",
      capture: {
        mode: "quick",
        sentInvitations: {
          status: "warning",
          checkedAt: timestamp,
          itemCount: 10,
          visibleTotalCount: 74,
          captureCompleteness: "partial_visible_slice",
          requestedMode: "quick",
          actualMode: "quick",
          reconcileRequired: true,
          reconcileReason: "visible_total_exceeds_itemized_rows",
          error: "LinkedIn showed a larger pending queue than the visible top slice.",
          items: [
            {
              invitationId: "invite-1",
              kind: "connection_request_pending",
              observedAt: timestamp,
              actorName: "Jordan Cipolla",
              actorTitle: null,
              actorCompanyName: null,
              actorHandle: null,
              actorProfileUrl: "https://www.linkedin.com/in/jordan-cipolla/",
              sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
              motionId: null,
              companyId: null,
              prospectId: null,
              notes: null,
              summary: "Jordan Cipolla is still pending."
            }
          ]
        },
        receivedInvitations: {
          status: "success",
          checkedAt: timestamp,
          itemCount: 0,
          visibleTotalCount: 0,
          captureCompleteness: "complete",
          requestedMode: "quick",
          actualMode: "quick",
          reconcileRequired: false,
          reconcileReason: null,
          error: null,
          items: []
        },
        messagingInbox: {
          status: "success",
          checkedAt: timestamp,
          itemCount: 0,
          visibleTotalCount: 0,
          captureCompleteness: "complete",
          requestedMode: "quick",
          actualMode: "quick",
          reconcileRequired: false,
          reconcileReason: null,
          error: null,
          items: []
        },
        profileViews: {
          status: "success",
          checkedAt: timestamp,
          itemCount: 0,
          visibleTotalCount: 0,
          captureCompleteness: "complete",
          requestedMode: "quick",
          actualMode: "quick",
          reconcileRequired: false,
          reconcileReason: null,
          error: null,
          items: []
        },
        followersList: {
          status: "success",
          checkedAt: timestamp,
          itemCount: 0,
          visibleTotalCount: 0,
          captureCompleteness: "complete",
          requestedMode: "quick",
          actualMode: "quick",
          reconcileRequired: false,
          reconcileReason: null,
          error: null,
          items: []
        },
        followingList: {
          status: "success",
          checkedAt: timestamp,
          itemCount: 0,
          visibleTotalCount: 0,
          captureCompleteness: "complete",
          requestedMode: "quick",
          actualMode: "quick",
          reconcileRequired: false,
          reconcileReason: null,
          error: null,
          items: []
        }
      }
    }
  );

  const sentInvitations = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
  assert.ok(sentInvitations);
  assert.equal(sentInvitations.itemCount, 10);
  assert.equal(sentInvitations.visibleTotalCount, 74);
  assert.equal(sentInvitations.captureCompleteness, "partial_visible_slice");
  assert.equal(sentInvitations.requestedMode, "quick");
  assert.equal(sentInvitations.actualMode, "quick");
  assert.equal(sentInvitations.reconcileRequired, true);
  assert.equal(sentInvitations.reconcileReason, "visible_total_exceeds_itemized_rows");
});

test("linkedin capture payload maps followers captures into the governed followers surface", () => {
  const result = buildLinkedinInboundSyncPayload(
    {
      id: "user-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      label: "william-main",
      owner: "William",
      accounts: [
        {
          id: "linkedin-account-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          capability: "linkedin",
          handle: "william-main",
          sourceType: "browser-profile",
          browserProfileId: "profile-1",
          preferred: true
        }
      ],
      harnessConnections: []
    },
    {
      accountId: "linkedin-account-1",
      capture: {
        mode: "quick",
        sentInvitations: { status: "success", checkedAt: timestamp, itemCount: 0, error: null, items: [] },
        receivedInvitations: { status: "success", checkedAt: timestamp, itemCount: 0, error: null, items: [] },
        messagingInbox: { status: "success", checkedAt: timestamp, itemCount: 0, error: null, items: [] },
        profileViews: { status: "success", checkedAt: timestamp, itemCount: 0, error: null, items: [] },
        followersList: {
          status: "success",
          checkedAt: timestamp,
          itemCount: 1,
          visibleTotalCount: 1,
          captureCompleteness: "complete",
          requestedMode: "quick",
          actualMode: "quick",
          reconcileRequired: false,
          reconcileReason: null,
          error: null,
          items: [
            {
              entryId: "follower-1",
              kind: "follower_confirmed",
              observedAt: timestamp,
              actorName: "Grace Follower",
              actorTitle: "CRO",
              actorCompanyName: "Follower Co",
              actorHandle: null,
              actorProfileUrl: "https://www.linkedin.com/in/grace-follower/",
              actorLinkedinPublicId: "grace-follower",
              actorLinkedinMemberId: null,
              actorAvatarSourceUrl: null,
              sourceUrl: "https://www.linkedin.com/mynetwork/network-manager/people-follow/followers/",
              motionId: null,
              companyId: null,
              prospectId: null,
              notes: null,
              summary: "Grace Follower currently follows this profile."
            }
          ]
        },
        followingList: { status: "success", checkedAt: timestamp, itemCount: 0, error: null, items: [] }
      }
    }
  );

  const followers = result.payload.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-followers-list");
  assert.ok(followers);
  assert.equal(followers.itemCount, 1);
  assert.equal(followers.observations[0].kind, "follower_confirmed");
  assert.equal(followers.observations[0].externalId, "follower-1");
  assert.equal(followers.observations[0].actorProfileUrl, "https://www.linkedin.com/in/grace-follower/");
});

test("full authoritative sent-invitation reconciliation can complete after terminal exhaustion even when the visible count badge is slightly higher", () => {
  const rawUser = {
    id: "user-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    label: "william-main",
    owner: "William",
    accounts: [
      {
        id: "linkedin-account-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        capability: "linkedin",
        handle: "william-main",
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        preferred: true
      }
    ],
    harnessConnections: []
  };

  const result = buildLinkedinInboundSyncPayload(rawUser, {
    accountId: "linkedin-account-1",
    capture: {
      mode: "full",
      sentInvitations: {
        status: "success",
        checkedAt: timestamp,
        itemCount: 1,
        visibleTotalCount: 2,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        exhaustionStatus: "complete",
        exhaustionReason: "terminal_zero_row_pagination_seen",
        paginationAttempted: true,
        terminalSignalSeen: true,
        stalledPassCount: 2,
        error: null,
        items: [
          {
            invitationId: "invite-1",
            kind: "connection_request_pending",
            observedAt: timestamp,
            actorName: "Jordan Cipolla",
            actorTitle: null,
            actorCompanyName: null,
            actorHandle: null,
            actorProfileUrl: "https://www.linkedin.com/in/jordan-cipolla/",
            sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
            motionId: null,
            companyId: null,
            prospectId: null,
            notes: null,
            summary: "Jordan Cipolla is still pending."
          }
        ]
      },
      receivedInvitations: {
        status: "success",
        checkedAt: timestamp,
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        exhaustionStatus: "complete",
        exhaustionReason: "terminal_zero_row_pagination_seen",
        paginationAttempted: true,
        terminalSignalSeen: true,
        stalledPassCount: 1,
        error: null,
        items: []
      },
      messagingInbox: {
        status: "success",
        checkedAt: timestamp,
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        exhaustionStatus: "complete",
        exhaustionReason: "terminal_zero_row_pagination_seen",
        paginationAttempted: true,
        terminalSignalSeen: true,
        stalledPassCount: 1,
        error: null,
        items: []
      },
      profileViews: {
        status: "success",
        checkedAt: timestamp,
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        exhaustionStatus: "complete",
        exhaustionReason: "terminal_zero_row_pagination_seen",
        paginationAttempted: true,
        terminalSignalSeen: true,
        stalledPassCount: 1,
        error: null,
        items: []
      },
      followersList: {
        status: "success",
        checkedAt: timestamp,
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        exhaustionStatus: "complete",
        exhaustionReason: "terminal_zero_row_pagination_seen",
        paginationAttempted: true,
        terminalSignalSeen: true,
        stalledPassCount: 1,
        error: null,
        items: []
      },
      followingList: {
        status: "success",
        checkedAt: timestamp,
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        exhaustionStatus: "complete",
        exhaustionReason: "terminal_zero_row_pagination_seen",
        paginationAttempted: true,
        terminalSignalSeen: true,
        stalledPassCount: 1,
        error: null,
        items: []
      }
    }
  });

  const prepared = withIsolatedExoState(() => prepareUserInboundSyncRun(rawUser, result.payload, {
    rawMotions: [],
    rawExistingObservations: []
  }));

  const sentInvitations = prepared.accounts[0].surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
  assert.ok(sentInvitations);
  assert.equal(sentInvitations.captureCompleteness, "complete");
  assert.equal(sentInvitations.exhaustionStatus, "complete");
  assert.equal(sentInvitations.itemizationGapCount, 0);
  assert.equal(sentInvitations.countDiscrepancyCount, 1);

  const storedSurface = prepared.updatedUser.accounts[0].inboundSync.surfaces.find((surface) => surface.surfaceKey === "linkedin-sent-invitations");
  assert.ok(storedSurface);
  assert.equal(storedSurface.lastItemizationGapCount, 0);
  assert.equal(storedSurface.lastCountDiscrepancyCount, 1);
  assert.equal(storedSurface.lastTerminalSignalSeen, true);
});

test("full authoritative inbound sync cannot claim success when exhaustion is incomplete", () => {
  const rawUser = {
    id: "user-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    label: "william-main",
    owner: "William",
    accounts: [
      {
        id: "linkedin-account-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        capability: "linkedin",
        handle: "william-main",
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        preferred: true
      }
    ],
    harnessConnections: []
  };

  assert.throws(
    () => withIsolatedExoState(() => prepareUserInboundSyncRun(rawUser, {
      mode: "full",
      accounts: [
        {
          accountId: "linkedin-account-1",
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              status: "success",
              observedAt: timestamp,
              itemCount: 10,
              visibleTotalCount: 74,
              captureCompleteness: "partial_visible_slice",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: true,
              reconcileReason: "bounded_capture_stopped_early",
              exhaustionStatus: "incomplete",
              exhaustionReason: "bounded_capture_stopped_early",
              paginationAttempted: true,
              terminalSignalSeen: false,
              stalledPassCount: 0,
              error: null,
              observations: [
                {
                  kind: "connection_request_pending",
                  observedAt: timestamp,
                  summary: "Jordan Cipolla is still pending.",
                  externalId: "invite-1",
                  actorName: "Jordan Cipolla",
                  actorTitle: null,
                  actorCompanyName: null,
                  actorHandle: null,
                  actorProfileUrl: "https://www.linkedin.com/in/jordan-cipolla/",
                  actorLinkedinPublicId: null,
                  actorLinkedinMemberId: null,
                  actorAvatarSourceUrl: null,
                  threadUrl: null,
                  sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
                  motionId: null,
                  companyId: null,
                  prospectId: null,
                  notes: null
                }
              ]
            }
          ]
        }
      ]
    }, {
      rawMotions: [],
      rawExistingObservations: []
    })),
    /must use warning status when exhaustion is incomplete/i
  );
});

test("daily suppresses new connection-request pressure until a partial live sent-invitations surface is fully reconciled", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-reconcile-contract-"));

  try {
    const motion = JSON.parse(runCli(tempDir, [
      "motion",
      "add",
      "--url",
      "https://example.com/reconcile-live-sent-backlog",
      "--premise",
      "This offer matters when a rep already has a large live sent-invitation backlog that Exo must reconcile before pushing more invites.",
      "--audience",
      "Revenue leaders",
      "--signal",
      "company::Is the company visibly scaling pipeline generation or GTM surface area?",
      "--json"
    ]));

    runCli(tempDir, ["motion", "restart", motion.id, "--json"]);

    const company = JSON.parse(runCli(tempDir, [
      "companies",
      "add",
      "--name",
      "Backlog Systems",
      "--domain",
      "backlog.example",
      "--motion",
      motion.id,
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "backlog-user", "--owner", "William", "--json"]));
    runCli(tempDir, [
      "users",
      "harness",
      "add",
      user.id,
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--status",
      "available",
      "--json"
    ]);
    const userWithLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "backlog-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--provider-account-id",
      "acct-linkedin-backlog-1",
      "--max-connection-requests",
      "125",
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = userWithLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    runCli(tempDir, [
      "companies",
      "user",
      "assign",
      company.id,
      "--user",
      user.id,
      "--reason",
      "Keep planner work routed through one execution user",
      "--json"
    ]);

    const prospect = JSON.parse(runCli(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Quinn Waiting",
      "--title",
      "Chief Revenue Officer",
      "--buying-committee-role",
      "primary_business_owner",
      "--decision-authority",
      "buys",
      "--fit-confidence",
      "high",
      "--why-relevant",
      "Owns the current primary outbound branch",
      "--linkedin-profile-url",
      "https://www.linkedin.com/in/quinn-waiting",
      "--json"
    ])).prospects[0];

    runCli(tempDir, [
      "companies",
      "cadence",
      "set",
      company.id,
      "--motion",
      motion.id,
      "--prospect",
      prospect.id,
      "--current-step",
      "connection-request",
      "--last-touch-channel",
      "connection-request",
      "--last-touch-outcome",
      "pending",
      "--last-touch-at",
      "2026-05-28T11:46:51.000Z",
      "--next-action",
      "Wait for acceptance before escalating.",
      "--next-action-due-at",
      "2026-05-30T11:46:51.000Z",
      "--json"
    ]);
    const observations = Array.from({ length: 10 }, (_item, index) => ({
      kind: "connection_request_pending",
      externalId: `invite-${index + 1}`,
      observedAt: timestamp,
      actorName: `Pending Invite ${index + 1}`,
      summary: `Pending Invite ${index + 1} is still pending.`,
      motionId: index === 0 ? motion.id : null,
      companyId: index === 0 ? company.id : null,
      prospectId: index === 0 ? prospect.id : null
    }));

    const syncRunPath = path.join(tempDir, "partial-sent-backlog-sync.json");
    const partialSentBacklogSync = loadJsonCassette("inbound/linkedin-sent-invitations/partial-visible-total.json", {
      ACCOUNT_ID: linkedinAccount.id
    });
    partialSentBacklogSync.accounts[0].surfaces[0].error = "LinkedIn showed more pending invites than the visible top slice Exo itemized.";
    partialSentBacklogSync.accounts[0].surfaces[0].observations = observations;
    fs.writeFileSync(syncRunPath, JSON.stringify(partialSentBacklogSync, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", syncRunPath, "--json"]);

    const syncView = JSON.parse(runCli(tempDir, ["inbound", "sync", "show", user.id, "--json"]));
    const linkedinSurface = syncView.accounts[0].surfaces.find((surface) => surface.key === "linkedin-sent-invitations");
    assert.ok(linkedinSurface);
    assert.equal(linkedinSurface.lastItemCount, 10);
    assert.equal(linkedinSurface.lastVisibleTotalCount, 74);
    assert.equal(linkedinSurface.lastCaptureCompleteness, "partial_visible_slice");
    assert.equal(linkedinSurface.lastRequestedMode, "quick");
    assert.equal(linkedinSurface.lastActualMode, "quick");
    assert.equal(linkedinSurface.lastReconcileRequired, true);
    assert.equal(linkedinSurface.lastReconcileReason, "visible_total_exceeds_itemized_rows");
    assert.equal(linkedinSurface.lastItemizationGapCount, 64);

    const review = JSON.parse(runCli(tempDir, ["inbound", "review", user.id, "--json"]));
    const sentInvitationGap = review.itemizationGaps.find((gap) => gap.surfaceKey === "linkedin-sent-invitations");
    assert.ok(sentInvitationGap);
    assert.equal(sentInvitationGap.itemCount, 74);
    assert.equal(sentInvitationGap.observationCount, 10);
    assert.equal(sentInvitationGap.missingObservationCount, 64);

    const daily = JSON.parse(runCli(tempDir, ["daily", "--user", user.id, "--json"]));
    assert.equal(daily.capacity.linkedin.status, "reconciliation_needed");
    assert.equal(daily.capacity.linkedin.execution.itemizedPendingInvitations, 10);
    assert.equal(daily.capacity.linkedin.execution.observedPendingInvitations, 74);
    assert.equal(daily.capacity.linkedin.execution.pendingInvitationVisibleTotalCount, 74);
    assert.equal(daily.capacity.linkedin.execution.pendingInvitationCaptureCompleteness, "partial_visible_slice");
    assert.equal(daily.capacity.linkedin.execution.pendingInvitationReconcileRequired, true);
    assert.equal(daily.capacity.linkedin.execution.pendingInvitationItemizationGapCount, 64);
    assert.equal(daily.capacity.linkedin.plannerItem, null);
    assert.ok(daily.items.every((item) => item.source.type !== "inbound_itemization_gap"));

    const queue = JSON.parse(runCli(tempDir, ["agent", "queue", "--json"]));
    const syncTask = [...queue.tasks, ...queue.waiting].find((task) =>
      task.kind === "run_inbound_sync"
      && task.reason === "itemization_gap"
      && task.accountId === linkedinAccount.id
    );
    assert.ok(syncTask);
    assert.equal(syncTask.mode, "full");
    assert.ok(["due_now", "waiting"].includes(syncTask.queueState));
    if (syncTask.queueState === "waiting") {
      assert.equal(syncTask.waitingReason, "outside_working_hours");
    } else {
      assert.equal(syncTask.waitingReason, null);
    }
    assert.ok(syncTask.surfaceKeys.includes("linkedin-sent-invitations"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("full sent-invitation reconciliation writes back disappearance deltas instead of only changing counts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sent-delta-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "delta-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "delta-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "delta-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const firstSyncPath = writeJsonCassette(
      tempDir,
      "sent-first-full.json",
      "inbound/linkedin-sent-invitations/full-first.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstSyncPath, "--json"]);

    const secondSyncPath = writeJsonCassette(
      tempDir,
      "sent-second-full.json",
      "inbound/linkedin-sent-invitations/full-second-empty.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondSyncPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-sent-invitations",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 1);
    assert.equal(observationList.observations[0].externalId, "invite-1");
    assert.equal(observationList.observations[0].kind, "connection_request_no_longer_pending");
    assert.match(observationList.observations[0].summary, /no longer present in the live pending invitations list/i);

    const review = JSON.parse(runCli(tempDir, ["inbound", "review", user.id, "--json"]));
    const disappearedInvite = review.reviewItems.find((item) => item.kind === "connection_request_no_longer_pending");
    assert.ok(disappearedInvite);
    assert.equal(disappearedInvite.state, "needs_claim");
    assert.match(disappearedInvite.recommendedAction, /claim jordan cipolla/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("full received-invitation reconciliation writes back disappearance deltas for inbound requests", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-received-delta-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "received-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "received-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "received-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const firstSyncPath = writeJsonCassette(
      tempDir,
      "received-first-full.json",
      "inbound/linkedin-received-invitations/full-first.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstSyncPath, "--json"]);

    const secondSyncPath = writeJsonCassette(
      tempDir,
      "received-second-full.json",
      "inbound/linkedin-received-invitations/full-second-empty.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondSyncPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-received-invitations",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 1);
    assert.equal(observationList.observations[0].externalId, "received-1");
    assert.equal(observationList.observations[0].kind, "connection_request_received_no_longer_pending");

    const review = JSON.parse(runCli(tempDir, ["inbound", "review", user.id, "--json"]));
    const disappearedInvite = review.reviewItems.find((item) => item.kind === "connection_request_received_no_longer_pending");
    assert.ok(disappearedInvite);
    assert.equal(disappearedInvite.state, "needs_claim");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("full followers reconciliation writes back follower removal deltas", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-followers-delta-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "followers-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "followers-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "followers-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    runCli(tempDir, [
      "inbound",
      "sync",
      "set",
      user.id,
      "--account",
      linkedinAccount.id,
      "--enable-surface",
      "linkedin-followers-list",
      "--json"
    ]);

    const firstSyncPath = writeJsonCassette(
      tempDir,
      "followers-first-full.json",
      "inbound/linkedin-followers-list/full-first.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstSyncPath, "--json"]);

    const secondSyncPath = writeJsonCassette(
      tempDir,
      "followers-second-full.json",
      "inbound/linkedin-followers-list/full-second-empty.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondSyncPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-followers-list",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 1);
    assert.equal(observationList.observations[0].externalId, "follower-1");
    assert.equal(observationList.observations[0].kind, "follower_removed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("full followers reconciliation promotes first-seen rows to follower_added after a complete baseline", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-followers-added-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "followers-added-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "followers-added-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "followers-added-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    runCli(tempDir, [
      "inbound",
      "sync",
      "set",
      user.id,
      "--account",
      linkedinAccount.id,
      "--enable-surface",
      "linkedin-followers-list",
      "--json"
    ]);

    const firstSyncPath = writeJsonCassette(
      tempDir,
      "followers-added-first-full.json",
      "inbound/linkedin-followers-list/full-first.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstSyncPath, "--json"]);

    const secondSyncPath = path.join(tempDir, "followers-added-second-full.json");
    fs.writeFileSync(secondSyncPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-followers-list",
              status: "success",
              observedAt: "2026-06-01T15:00:00.000Z",
              itemCount: 2,
              visibleTotalCount: 2,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "follower_confirmed",
                  externalId: "follower-1",
                  observedAt: "2026-06-01T15:00:00.000Z",
                  actorName: "Grace Follower",
                  actorProfileUrl: "https://www.linkedin.com/in/grace-follower/",
                  summary: "Grace Follower currently follows this profile."
                },
                {
                  kind: "follower_confirmed",
                  externalId: "follower-2",
                  observedAt: "2026-06-01T15:00:00.000Z",
                  actorName: "Jordan Newfollower",
                  actorProfileUrl: "https://www.linkedin.com/in/jordan-newfollower/",
                  summary: "Jordan Newfollower currently follows this profile."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondSyncPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-followers-list",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 2);
    const baselineFollower = observationList.observations.find((observation) => observation.externalId === "follower-1");
    const newFollower = observationList.observations.find((observation) => observation.externalId === "follower-2");
    assert.ok(baselineFollower);
    assert.ok(newFollower);
    assert.equal(baselineFollower.kind, "follower_confirmed");
    assert.equal(newFollower.kind, "follower_added");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("full following-list reconciliation writes back follow removal deltas", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-following-delta-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "following-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "following-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "following-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const firstSyncPath = writeJsonCassette(
      tempDir,
      "following-first-full.json",
      "inbound/linkedin-following-list/full-first.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstSyncPath, "--json"]);

    const secondSyncPath = writeJsonCassette(
      tempDir,
      "following-second-full.json",
      "inbound/linkedin-following-list/full-second-empty.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondSyncPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-following-list",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 1);
    assert.equal(observationList.observations[0].externalId, "following-1");
    assert.equal(observationList.observations[0].kind, "follow_state_removed");

    const review = JSON.parse(runCli(tempDir, ["inbound", "review", user.id, "--json"]));
    const disappearedFollow = review.reviewItems.find((item) => item.kind === "follow_state_removed");
    assert.ok(disappearedFollow);
    assert.equal(disappearedFollow.state, "visibility_signal");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("complete following-list reconciliation promotes first-seen rows to follow_state_changed after a complete baseline", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-following-changed-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "following-changed-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "following-changed-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "following-changed-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const firstSyncPath = writeJsonCassette(
      tempDir,
      "following-changed-first-full.json",
      "inbound/linkedin-following-list/full-first.json",
      { ACCOUNT_ID: linkedinAccount.id }
    );

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstSyncPath, "--json"]);

    const secondSyncPath = path.join(tempDir, "following-changed-second-full.json");
    fs.writeFileSync(secondSyncPath, JSON.stringify({
      mode: "quick",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-following-list",
              status: "success",
              observedAt: "2026-06-01T15:00:00.000Z",
              itemCount: 2,
              visibleTotalCount: 2,
              captureCompleteness: "complete",
              requestedMode: "quick",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "follow_state_confirmed",
                  externalId: "following-1",
                  observedAt: "2026-06-01T15:00:00.000Z",
                  actorName: "Harper Followed",
                  actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
                  summary: "Harper Followed is currently on the live following list."
                },
                {
                  kind: "follow_state_confirmed",
                  externalId: "following-2",
                  observedAt: "2026-06-01T15:00:00.000Z",
                  actorName: "Drew Followed",
                  actorProfileUrl: "https://www.linkedin.com/in/drew-followed/",
                  summary: "Drew Followed is currently on the live following list."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondSyncPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-following-list",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 2);
    const baselineFollow = observationList.observations.find((observation) => observation.externalId === "following-1");
    const newFollow = observationList.observations.find((observation) => observation.externalId === "following-2");
    assert.ok(baselineFollow);
    assert.ok(newFollow);
    assert.equal(baselineFollow.kind, "follow_state_confirmed");
    assert.equal(newFollow.kind, "follow_state_changed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("paginated following-list continuation carries earlier pages into the final full reconciliation", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-following-page-continuation-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "following-page-continuation-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "following-page-continuation-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "following-page-continuation-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const baselinePath = path.join(tempDir, "following-baseline-full.json");
    fs.writeFileSync(baselinePath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-following-list",
              status: "success",
              observedAt: "2026-06-01T15:00:00.000Z",
              itemCount: 2,
              visibleTotalCount: 2,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "follow_state_confirmed",
                  externalId: "following-1",
                  observedAt: "2026-06-01T15:00:00.000Z",
                  actorName: "Harper Followed",
                  actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
                  summary: "Harper Followed is currently on the live following list."
                },
                {
                  kind: "follow_state_confirmed",
                  externalId: "following-2",
                  observedAt: "2026-06-01T15:00:00.000Z",
                  actorName: "Drew Followed",
                  actorProfileUrl: "https://www.linkedin.com/in/drew-followed/",
                  summary: "Drew Followed is currently on the live following list."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));
    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", baselinePath, "--json"]);

    const firstPagePath = path.join(tempDir, "following-page-one.json");
    fs.writeFileSync(firstPagePath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-following-list",
              status: "warning",
              observedAt: "2026-06-02T15:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 2,
              captureCompleteness: "partial_visible_slice",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: true,
              reconcileReason: "page_budget_stopped_early",
              exhaustionStatus: "incomplete",
              exhaustionReason: "page_budget_stopped_early",
              nextStartOffset: 1,
              error: "Full reconciliation stopped at the configured page budget and should resume from the next offset.",
              observations: [
                {
                  kind: "follow_state_confirmed",
                  externalId: "following-1",
                  observedAt: "2026-06-02T15:00:00.000Z",
                  actorName: "Harper Followed",
                  actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
                  summary: "Harper Followed is currently on the live following list."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));
    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstPagePath, "--json"]);

    const resumedSurfaceState = JSON.parse(runCli(tempDir, ["inbound", "sync", "show", user.id, "--json"]));
    const followingSurface = resumedSurfaceState.accounts[0].surfaces.find((surface) => surface.key === "linkedin-following-list");
    assert.ok(followingSurface);
    assert.equal(followingSurface.nextStartOffset, 1);

    const secondPagePath = path.join(tempDir, "following-page-two.json");
    fs.writeFileSync(secondPagePath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-following-list",
              status: "success",
              observedAt: "2026-06-02T15:05:00.000Z",
              itemCount: 1,
              visibleTotalCount: 2,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              exhaustionStatus: "complete",
              exhaustionReason: "reported_total_exhausted",
              error: null,
              observations: [
                {
                  kind: "follow_state_confirmed",
                  externalId: "following-2",
                  observedAt: "2026-06-02T15:05:00.000Z",
                  actorName: "Drew Followed",
                  actorProfileUrl: "https://www.linkedin.com/in/drew-followed/",
                  summary: "Drew Followed is currently on the live following list."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));
    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondPagePath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-following-list",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 2);
    assert.ok(observationList.observations.some((observation) => observation.externalId === "following-1" && observation.kind === "follow_state_confirmed"));
    assert.ok(observationList.observations.some((observation) => observation.externalId === "following-2" && observation.kind === "follow_state_confirmed"));
    assert.equal(observationList.observations.some((observation) => observation.kind === "follow_state_removed"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("full sent-invitation reconciliation does not fabricate a disappearance when the current row matches a legacy observation by LinkedIn profile identity", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sent-alias-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "alias-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "alias-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "alias-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const firstSyncPath = path.join(tempDir, "sent-alias-first.json");
    fs.writeFileSync(firstSyncPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              status: "success",
              observedAt: "2026-05-31T15:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "connection_request_pending",
                  externalId: "legacy-parm-row-id",
                  observedAt: "2026-05-31T15:00:00.000Z",
                  actorName: "Parm Uppal",
                  actorHandle: "parmuppal",
                  actorProfileUrl: "https://www.linkedin.com/in/parmuppal/",
                  summary: "Parm Uppal is still pending."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstSyncPath, "--json"]);

    const secondSyncPath = path.join(tempDir, "sent-alias-second.json");
    fs.writeFileSync(secondSyncPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              status: "success",
              observedAt: "2026-05-31T16:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "connection_request_pending",
                  externalId: "sent:https://www.linkedin.com/in/parmuppal/",
                  observedAt: "2026-05-31T16:00:00.000Z",
                  actorName: "Parm Uppal",
                  actorHandle: "parmuppal",
                  actorProfileUrl: "https://www.linkedin.com/in/parmuppal/",
                  summary: "Parm Uppal is still pending in the live sent list."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondSyncPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-sent-invitations",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 1);
    assert.equal(observationList.observations[0].kind, "connection_request_pending");
    assert.equal(observationList.observations[0].actorProfileUrl, "https://www.linkedin.com/in/parmuppal/");
    assert.equal(observationList.observations[0].externalId, "sent:https://www.linkedin.com/in/parmuppal/");

    const review = JSON.parse(runCli(tempDir, ["inbound", "review", user.id, "--json"]));
    assert.equal(review.reviewItems.some((item) => item.kind === "connection_request_no_longer_pending"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("full sent-invitation reconciliation still matches the same person when the current LinkedIn row only exposes member identity", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sent-member-alias-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "member-alias-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "member-alias-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "member-alias-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const firstSyncPath = path.join(tempDir, "sent-member-first.json");
    fs.writeFileSync(firstSyncPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              status: "success",
              observedAt: "2026-05-31T15:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "connection_request_pending",
                  externalId: "legacy-member-row-id",
                  observedAt: "2026-05-31T15:00:00.000Z",
                  actorName: "Terminated Prospect",
                  actorHandle: "terminated-prospect",
                  actorProfileUrl: "https://www.linkedin.com/in/terminated-prospect/",
                  actorLinkedinPublicId: "terminated-prospect",
                  actorLinkedinMemberId: "489864113",
                  summary: "The pending invite is still visible under the older LinkedIn identity shape."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstSyncPath, "--json"]);

    const secondSyncPath = path.join(tempDir, "sent-member-second.json");
    fs.writeFileSync(secondSyncPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              status: "success",
              observedAt: "2026-05-31T16:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "connection_request_pending",
                  externalId: "invitee_member_id:489864113",
                  observedAt: "2026-05-31T16:00:00.000Z",
                  actorName: "Terminated Prospect",
                  actorHandle: null,
                  actorProfileUrl: null,
                  actorLinkedinPublicId: null,
                  actorLinkedinMemberId: "489864113",
                  summary: "The pending invite row lost its public profile link but still exposes the same member identity."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondSyncPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-sent-invitations",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 1);
    assert.equal(observationList.observations[0].kind, "connection_request_pending");
    assert.equal(observationList.observations[0].externalId, "invitee_member_id:489864113");
    assert.equal(observationList.observations[0].actorLinkedinMemberId, "489864113");
    assert.equal(observationList.observations[0].actorProfileUrl, "https://www.linkedin.com/in/terminated-prospect/");

    const review = JSON.parse(runCli(tempDir, ["inbound", "review", user.id, "--json"]));
    assert.equal(review.reviewItems.some((item) => item.kind === "connection_request_no_longer_pending"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("a fresh full pending reappearance clears an older sent-invite no-longer-pending artifact for the same person", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sent-reappeared-pending-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "reappeared-pending-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "reappeared-pending-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "reappeared-pending-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const firstSyncPath = path.join(tempDir, "sent-reappeared-first.json");
    fs.writeFileSync(firstSyncPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              status: "success",
              observedAt: "2026-05-31T15:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "connection_request_pending",
                  externalId: "legacy-parm-row-id",
                  observedAt: "2026-05-31T15:00:00.000Z",
                  actorName: "Parm Uppal",
                  actorProfileUrl: "https://www.linkedin.com/in/parmuppal/",
                  summary: "Parm Uppal is still pending."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", firstSyncPath, "--json"]);

    const secondSyncPath = path.join(tempDir, "sent-reappeared-second-empty.json");
    fs.writeFileSync(secondSyncPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              status: "success",
              observedAt: "2026-05-31T16:00:00.000Z",
              itemCount: 0,
              visibleTotalCount: 0,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: []
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", secondSyncPath, "--json"]);

    runCli(tempDir, [
      "inbound",
      "observations",
      "add",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-sent-invitations",
      "--kind",
      "connection_request_pending",
      "--external-id",
      "sent:https://www.linkedin.com/in/parmuppal/",
      "--observed-at",
      "2026-06-01T11:10:44.319Z",
      "--actor-name",
      "Parm Uppal",
      "--actor-profile-url",
      "https://www.linkedin.com/in/parmuppal/",
      "--summary",
      "Parm Uppal is still pending from a bounded visible-slice pass.",
      "--json"
    ]);

    const thirdSyncPath = path.join(tempDir, "sent-reappeared-third.json");
    fs.writeFileSync(thirdSyncPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              status: "success",
              observedAt: "2026-06-01T11:16:57.497Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "connection_request_pending",
                  externalId: "sent:https://www.linkedin.com/in/parmuppal/",
                  observedAt: "2026-06-01T11:16:57.497Z",
                  actorName: "Parm Uppal",
                  actorProfileUrl: "https://www.linkedin.com/in/parmuppal/",
                  summary: "Parm Uppal is still pending in the live sent list."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    const thirdResult = JSON.parse(runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", thirdSyncPath, "--json"]));
    assert.equal(thirdResult.counts.clearedSupersededObservationCount, 1);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-sent-invitations",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 1);
    assert.equal(observationList.observations[0].kind, "connection_request_pending");
    assert.equal(observationList.observations[0].externalId, "sent:https://www.linkedin.com/in/parmuppal/");

    const review = JSON.parse(runCli(tempDir, ["inbound", "review", user.id, "--json"]));
    assert.equal(review.reviewItems.some((item) => item.kind === "connection_request_no_longer_pending"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync run enriches a matched prospect with the latest LinkedIn profile and proxied avatar", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-prospect-enrichment-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });
  const avatarSourceUrl = "https://media.licdn.com/dms/image/v2/D5603AQF-avatar-example/profile-displayphoto-shrink_200_200/profile-displayphoto-shrink_200_200/0/1710000000000?e=1733356800&v=beta&t=example";

  try {
    const motion = JSON.parse(runCli(tempDir, [
      "motion",
      "add",
      "--url",
      "https://example.com/inbound-enrichment",
      "--premise",
      "This offer matters when inbound reality should keep prospect records current without a separate manual enrichment pass.",
      "--audience",
      "Revenue leaders",
      "--signal",
      "company::Is the company visibly dealing with live outbound and inbound workflow drift?",
      "--json"
    ]));

    const company = JSON.parse(runCli(tempDir, [
      "companies",
      "add",
      "--name",
      "Enrichment Systems",
      "--domain",
      "enrichment.example",
      "--motion",
      motion.id,
      "--json"
    ]));

    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "enrichment-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "enrichment-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "enrichment-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const prospect = JSON.parse(runCli(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Alicia Buyer",
      "--title",
      "VP Revenue Operations",
      "--why-relevant",
      "Owns the workflow that this inbound sync should update.",
      "--json"
    ])).prospects[0];

    const syncRunPath = path.join(tempDir, "prospect-enrichment-sync.json");
    fs.writeFileSync(syncRunPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-received-invitations",
              status: "success",
              observedAt: "2026-05-31T17:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "connection_request_received",
                  externalId: "received-alicia-1",
                  observedAt: "2026-05-31T17:00:00.000Z",
                  actorName: "Alicia Buyer",
                  actorTitle: "VP Revenue Operations",
                  actorCompanyName: "BuyerCo",
                  actorProfileUrl: "https://www.linkedin.com/in/alicia-buyer/",
                  actorLinkedinPublicId: "alicia-buyer",
                  actorLinkedinMemberId: "489864114",
                  actorAvatarSourceUrl: avatarSourceUrl,
                  motionId: motion.id,
                  companyId: company.id,
                  prospectId: prospect.id,
                  summary: "Alicia Buyer sent a new inbound connection request."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", syncRunPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-received-invitations",
      "--json"
    ]));
    assert.equal(observationList.counts.observationCount, 1);
    assert.equal(observationList.observations[0].actorAvatarSourceUrl, avatarSourceUrl);
    assert.equal(observationList.observations[0].actorAvatarUrl, buildBizBridgeImageProxyUrl(avatarSourceUrl));
    assert.equal(observationList.observations[0].actorLinkedinPublicId, "alicia-buyer");
    assert.equal(observationList.observations[0].actorLinkedinMemberId, "489864114");

    const refreshedMotion = JSON.parse(runCli(tempDir, ["motion", "show", motion.id, "--json"]));
    const enrichedProspect = refreshedMotion.targetMap.accounts[0].prospects.find((candidate) => candidate.id === prospect.id);
    assert.ok(enrichedProspect);
    assert.equal(enrichedProspect.linkedinProfileUrl, "https://www.linkedin.com/in/alicia-buyer/");
    assert.equal(enrichedProspect.avatarSourceUrl, avatarSourceUrl);
    assert.equal(enrichedProspect.avatarUrl, buildBizBridgeImageProxyUrl(avatarSourceUrl));
    assert.equal(enrichedProspect.title, "VP Revenue Operations");
    assert.equal(
      enrichedProspect.contactPoints.some((point) => point.kind === "linkedin_public_id" && point.value === "alicia-buyer"),
      true
    );
    assert.equal(
      enrichedProspect.contactPoints.some((point) => point.kind === "linkedin_member_id" && point.value === "489864114"),
      true
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync run auto-links and enriches a prospect by LinkedIn member and public identity aliases", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-prospect-alias-link-"));
  const chrome = setupReadyChromeProfile(tempDir, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });
  const avatarSourceUrl = "https://media.licdn.com/dms/image/v2/D5603AQF-avatar-alias/profile-displayphoto-shrink_200_200/profile-displayphoto-shrink_200_200/0/1710000001234?e=1733356800&v=beta&t=alias";

  try {
    const motion = JSON.parse(runCli(tempDir, [
      "motion",
      "add",
      "--url",
      "https://example.com/inbound-member-alias",
      "--premise",
      "This offer matters when LinkedIn identity aliases need to keep one governed prospect record stable across messy live surfaces.",
      "--audience",
      "Revenue leaders",
      "--signal",
      "company::Is live LinkedIn state creating identity drift that the operating kernel has to resolve correctly?",
      "--json"
    ]));

    const company = JSON.parse(runCli(tempDir, [
      "companies",
      "add",
      "--name",
      "Alias Systems",
      "--domain",
      "alias.example",
      "--motion",
      motion.id,
      "--json"
    ]));

    const profile = JSON.parse(runCli(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "alias-link-main",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]));

    const user = JSON.parse(runCli(tempDir, ["users", "add", "--label", "alias-link-user", "--owner", "William", "--json"]));
    const withLinkedin = JSON.parse(runCli(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "alias-link-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]));
    const linkedinAccount = withLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const prospect = JSON.parse(runCli(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Alicia Buyer",
      "--title",
      "VP Revenue Operations",
      "--why-relevant",
      "Owns the account-state transition that this alias-aware inbound sync should keep coherent.",
      "--contact-point",
      "{\"kind\":\"linkedin_public_id\",\"value\":\"alicia-buyer\",\"matchStatus\":\"same_person_verified\",\"verificationStatus\":\"observed\",\"confidence\":\"high\",\"source\":\"legacy-linkedin-sync\",\"usableForResearch\":true,\"usableForWarmup\":true,\"usableForOutreach\":true}",
      "--contact-point",
      "{\"kind\":\"linkedin_member_id\",\"value\":\"489864114\",\"matchStatus\":\"same_person_verified\",\"verificationStatus\":\"observed\",\"confidence\":\"high\",\"source\":\"legacy-linkedin-sync\",\"usableForResearch\":true}",
      "--json"
    ])).prospects[0];

    const syncRunPath = path.join(tempDir, "prospect-alias-link-sync.json");
    fs.writeFileSync(syncRunPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-sent-invitations",
              status: "success",
              observedAt: "2026-05-31T18:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              error: null,
              observations: [
                {
                  kind: "connection_request_pending",
                  externalId: "sent-alias-1",
                  observedAt: "2026-05-31T18:00:00.000Z",
                  actorName: "Alicia Buyer",
                  actorTitle: "VP Revenue Operations",
                  actorCompanyName: "Alias Systems",
                  actorProfileUrl: null,
                  actorLinkedinPublicId: "alicia-buyer",
                  actorLinkedinMemberId: "489864114",
                  actorAvatarSourceUrl: avatarSourceUrl,
                  summary: "Alicia Buyer is still pending on LinkedIn with only alias-level identity fields exposed."
                }
              ]
            }
          ]
        }
      ]
    }, null, 2));

    runCli(tempDir, ["inbound", "sync", "run", user.id, "--input", syncRunPath, "--json"]);

    const observationList = JSON.parse(runCli(tempDir, [
      "inbound",
      "observations",
      "list",
      user.id,
      "--account",
      linkedinAccount.id,
      "--surface",
      "linkedin-sent-invitations",
      "--json"
    ]));

    assert.equal(observationList.counts.observationCount, 1);
    assert.equal(observationList.observations[0].motionId, motion.id);
    assert.equal(observationList.observations[0].companyId, company.id);
    assert.equal(observationList.observations[0].prospectId, prospect.id);

    const refreshedMotion = JSON.parse(runCli(tempDir, ["motion", "show", motion.id, "--json"]));
    const enrichedProspect = refreshedMotion.targetMap.accounts[0].prospects.find((candidate) => candidate.id === prospect.id);
    assert.ok(enrichedProspect);
    assert.equal(enrichedProspect.avatarSourceUrl, avatarSourceUrl);
    assert.equal(enrichedProspect.avatarUrl, buildBizBridgeImageProxyUrl(avatarSourceUrl));
    assert.equal(
      enrichedProspect.contactPoints.some((point) => point.kind === "linkedin_public_id" && point.value === "alicia-buyer"),
      true
    );
    assert.equal(
      enrichedProspect.contactPoints.some((point) => point.kind === "linkedin_member_id" && point.value === "489864114"),
      true
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("thread update observations stay visible as medium-priority inbox deltas instead of informational noise", () => {
  const rawUser = {
    id: "user-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    label: "delta-user",
    owner: "William",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00"
    },
    accounts: [
      {
        id: "linkedin-account-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        capability: "linkedin",
        handle: "william-main",
        label: "LinkedIn",
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        harnessConnectionId: null,
        preferred: true,
        notes: null,
        inboundSync: {
          surfaces: []
        }
      },
      {
        id: "gmail-account-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        capability: "gmail",
        handle: "william@example.com",
        label: "Gmail",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "harness-1",
        preferred: false,
        notes: null,
        inboundSync: {
          surfaces: []
        }
      }
    ],
    harnessConnections: [
      {
        id: "harness-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        runtime: "codex",
        connector: "gmail",
        label: "codex:gmail",
        status: "available",
        notes: null
      }
    ]
  };

  const [linkedinObservation, gmailObservation] = withIsolatedExoState(() => [
    recordInboundObservation(rawUser, {
      accountId: "linkedin-account-1",
      surfaceKey: "linkedin-messaging-inbox",
      kind: "thread_updated",
      externalId: "thread-1",
      observedAt: "2026-05-31T16:00:00.000Z",
      actorName: "Muhammad Usama Sajjad",
      actorProfileUrl: "https://www.linkedin.com/in/muhammad-usama-sajjad/",
      threadUrl: "https://www.linkedin.com/messaging/thread/1/",
      summary: "Muhammad Usama Sajjad's LinkedIn thread moved even though the newest visible change was not a clear reply."
    }),
    recordInboundObservation(rawUser, {
      accountId: "gmail-account-1",
      surfaceKey: "gmail-inbox-threads",
      kind: "email_thread_updated",
      externalId: "gmail-thread-1",
      observedAt: "2026-05-31T16:05:00.000Z",
      actorName: "Pauline Baker",
      threadUrl: "https://mail.google.com/mail/u/0/#inbox/gmail-thread-1",
      sourceUrl: "https://mail.google.com/mail/u/0/#inbox/gmail-thread-1",
      summary: "Pauline Baker's Gmail thread changed, but the newest visible state was not a clear reply yet."
    })
  ]);

  const inbox = buildInboxView(rawUser, [linkedinObservation, gmailObservation], [], []);
  const review = buildInboundReviewView(rawUser, [linkedinObservation, gmailObservation], [], []);

  const linkedinItem = inbox.items.find((item) => item.kind === "thread_updated");
  assert.ok(linkedinItem);
  assert.equal(linkedinItem.priority, "medium");
  assert.equal(linkedinItem.status, "global-intake");
  assert.equal(linkedinItem.reviewState, "needs_claim");

  const gmailItem = inbox.items.find((item) => item.kind === "email_thread_updated");
  assert.ok(gmailItem);
  assert.equal(gmailItem.priority, "medium");
  assert.equal(gmailItem.status, "global-intake");
  assert.equal(gmailItem.reviewState, "needs_claim");

  const linkedinReviewItem = review.reviewItems.find((item) => item.kind === "thread_updated");
  assert.ok(linkedinReviewItem);
  assert.equal(linkedinReviewItem.priority, "medium");
  assert.equal(linkedinReviewItem.state, "needs_claim");

  const gmailReviewItem = review.reviewItems.find((item) => item.kind === "email_thread_updated");
  assert.ok(gmailReviewItem);
  assert.equal(gmailReviewItem.priority, "medium");
  assert.equal(gmailReviewItem.state, "needs_claim");
});

test("steady follower and following confirmations stay out of inbox and review while delta rows remain visible", () => {
  const rawUser = {
    id: "user-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    label: "william-main",
    owner: "William",
    accounts: [
      {
        id: "linkedin-account-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        capability: "linkedin",
        handle: "william-main",
        sourceType: "browser-profile",
        browserProfileId: "profile-1",
        preferred: true
      }
    ],
    harnessConnections: []
  };

  const [
    followerConfirmed,
    followerAdded,
    followConfirmed,
    followChanged
  ] = withIsolatedExoState(() => [
    recordInboundObservation(rawUser, {
      accountId: "linkedin-account-1",
      surfaceKey: "linkedin-followers-list",
      kind: "follower_confirmed",
      externalId: "follower-1",
      observedAt: "2026-06-05T11:00:00.000Z",
      actorName: "Grace Follower",
      actorProfileUrl: "https://www.linkedin.com/in/grace-follower/",
      summary: "Grace Follower is present in the LinkedIn follower list."
    }),
    recordInboundObservation(rawUser, {
      accountId: "linkedin-account-1",
      surfaceKey: "linkedin-followers-list",
      kind: "follower_added",
      externalId: "follower-2",
      observedAt: "2026-06-05T11:05:00.000Z",
      actorName: "Jordan Newfollower",
      actorProfileUrl: "https://www.linkedin.com/in/jordan-newfollower/",
      summary: "Jordan Newfollower newly appeared in the live followers list."
    }),
    recordInboundObservation(rawUser, {
      accountId: "linkedin-account-1",
      surfaceKey: "linkedin-following-list",
      kind: "follow_state_confirmed",
      externalId: "following-1",
      observedAt: "2026-06-05T11:10:00.000Z",
      actorName: "Harper Followed",
      actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
      summary: "Harper Followed is still present in the LinkedIn following list."
    }),
    recordInboundObservation(rawUser, {
      accountId: "linkedin-account-1",
      surfaceKey: "linkedin-following-list",
      kind: "follow_state_changed",
      externalId: "following-2",
      observedAt: "2026-06-05T11:15:00.000Z",
      actorName: "Drew Followed",
      actorProfileUrl: "https://www.linkedin.com/in/drew-followed/",
      summary: "Drew Followed newly appeared in the live following list."
    })
  ]);

  const inbox = buildInboxView(rawUser, [
    followerConfirmed,
    followerAdded,
    followConfirmed,
    followChanged
  ], [], []);
  const review = buildInboundReviewView(rawUser, [
    followerConfirmed,
    followerAdded,
    followConfirmed,
    followChanged
  ], [], []);

  assert.equal(inbox.items.some((item) => item.kind === "follower_confirmed"), false);
  assert.equal(inbox.items.some((item) => item.kind === "follow_state_confirmed"), false);
  assert.ok(inbox.items.find((item) => item.kind === "follower_added"));
  assert.ok(inbox.items.find((item) => item.kind === "follow_state_changed"));

  assert.equal(review.reviewItems.some((item) => item.kind === "follower_confirmed"), false);
  assert.equal(review.reviewItems.some((item) => item.kind === "follow_state_confirmed"), false);
  assert.ok(review.reviewItems.find((item) => item.kind === "follower_added"));
  assert.ok(review.reviewItems.find((item) => item.kind === "follow_state_changed"));
});
