// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLiveLinkedinInboundSyncPayload } from "../src/core/inbound-linkedin-live-sync.js";

const timestamp = "2026-05-31T13:00:00.000Z";

async function buildCodexLinkedinHandoffResult() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-live-agent-handoff-"));
  const codexHome = path.join(tempDir, ".codex");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      '[plugins."chrome@openai-bundled"]',
      "enabled = true",
      ""
    ].join("\n")
  );

  const previousCodexHome = process.env.CODEX_HOME;
  const previousCodexShell = process.env.CODEX_SHELL;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_SHELL = "1";

  try {
    return await buildLiveLinkedinInboundSyncPayload(
      {
        id: "user-1",
        createdAt: timestamp,
        updatedAt: timestamp,
        label: "hint-contract-user",
        owner: "william",
        accounts: [
          {
            id: "account-1",
            createdAt: timestamp,
            updatedAt: timestamp,
            capability: "linkedin",
            handle: "hint-contract-user",
            sourceType: "browser-profile",
            browserProfileId: "profile-1",
            preferred: true
          }
        ],
        harnessConnections: []
      },
      [
        {
          id: "profile-1",
          createdAt: timestamp,
          updatedAt: timestamp,
          label: "hint-contract-profile",
          browser: "chrome",
          browserCommand: null,
          userDataDir: path.join(tempDir, "Chrome"),
          profileDirectory: "Profile 4",
          profilePath: path.join(tempDir, "Chrome", "Profile 4"),
          detectedProfileName: "LinkedIn Main",
          capabilities: ["linkedin"],
          verifiedCapabilities: ["linkedin"],
          identity: {
            owner: "william",
            workspace: "omalab",
            scope: "work",
            accounts: [
              { capability: "linkedin", handle: "hint-contract-user" }
            ]
          },
          notes: null,
          status: "ready",
          lastTestedAt: timestamp,
          lastTestResult: {
            status: "ready",
            summary: "LinkedIn capability verified.",
            checks: [],
            capabilityChecks: [],
            warnings: []
          }
        }
      ],
      {
        runtime: "codex"
      }
    );
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }

    if (previousCodexShell === undefined) {
      delete process.env.CODEX_SHELL;
    } else {
      process.env.CODEX_SHELL = previousCodexShell;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("codex live handoff includes structured LinkedIn messaging inbox hints distilled from legacy retrieval logic", async () => {
  const result = await buildCodexLinkedinHandoffResult();
  const messagingInbox = result.transport.captureRequest.surfaceHints.messagingInbox;

  assert.equal(result.transport.kind, "agent_handoff");
  assert.match(result.transport.captureRequest.prompt, /structured surfaceHints/i);
  assert.equal(messagingInbox.surface, "linkedin-messaging-inbox");
  assert.deepEqual(messagingInbox.entryHints.startUrls, [
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/messaging/"
  ]);
  assert.equal(
    messagingInbox.readyHints.conversationRowsSelector,
    "li.msg-conversation-listitem:not(.msg-conversation-card--occluded)"
  );
  assert.equal(
    messagingInbox.readyHints.conversationLinkSelector,
    ".msg-conversation-listitem__link.msg-conversations-container__convo-item-link"
  );
  assert.ok(messagingInbox.fallbackHints.overlayExpandButtonPhrases.includes("open the list of conversations"));
  assert.ok(messagingInbox.fallbackHints.openThreadStrategies.includes("reselect_thread_then_reopen"));
  assert.ok(
    messagingInbox.failureHints.failClosedReasons.includes(
      "Only toast or shell chrome is visible and no usable LinkedIn conversation list rendered."
    )
  );
  assert.ok(messagingInbox.extractionHints.threadNodeKeys.includes("messengerConversationsBySyncToken"));
  assert.ok(messagingInbox.extractionHints.messageNodeKeys.includes("messengerMessagesByConversation"));
});

test("codex live handoff includes structured LinkedIn sent invitations hints with pagination and reconciliation rules", async () => {
  const result = await buildCodexLinkedinHandoffResult();
  const sentInvitations = result.transport.captureRequest.surfaceHints.sentInvitations;

  assert.equal(result.transport.kind, "agent_handoff");
  assert.equal(sentInvitations.surface, "linkedin-sent-invitations");
  assert.deepEqual(sentInvitations.entryHints.startUrls, [
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/mynetwork/",
    "https://www.linkedin.com/mynetwork/invitation-manager/sent/"
  ]);
  assert.ok(sentInvitations.entryHints.sentTabTexts.includes("sent"));
  assert.ok(sentInvitations.readyHints.finiteScrollSelectors.includes(".scaffold-finite-scroll__content"));
  assert.ok(sentInvitations.readyHints.managerUrlPatterns.includes("/mynetwork/invitation-manager/sent"));
  assert.ok(sentInvitations.paginationHints.loadMoreTriggerText.includes("load more"));
  assert.equal(sentInvitations.paginationHints.quickMode.strategy, "top_slice_with_gap_accounting");
  assert.equal(sentInvitations.paginationHints.reconcileMode.strategy, "paginate_until_terminal_zero_row");
  assert.equal(sentInvitations.paginationHints.reconcileMode.completeSignal, "terminal_zero_row_pagination_seen");
  assert.ok(sentInvitations.paginationHints.reconcileMode.triggers.includes("visible_total_exceeds_itemized_rows"));
  assert.ok(sentInvitations.paginationHints.reconcileMode.advanceOrder.includes("click_load_more"));
  assert.ok(sentInvitations.failureHints.incompleteReasons.includes("LinkedIn exposed a total pending count larger than the itemized sent rows."));
  assert.ok(sentInvitations.extractionHints.identityFields.includes("profile_platform_id"));
  assert.ok(sentInvitations.extractionHints.identityFields.includes("inviter_action_type"));
});

test("codex live handoff includes structured LinkedIn profile views hints with quick versus reconcile capture rules", async () => {
  const result = await buildCodexLinkedinHandoffResult();
  const profileViews = result.transport.captureRequest.surfaceHints.profileViews;

  assert.equal(result.transport.kind, "agent_handoff");
  assert.equal(profileViews.surface, "linkedin-profile-views");
  assert.deepEqual(profileViews.entryHints.startUrls, [
    "https://www.linkedin.com/feed/",
    "https://www.linkedin.com/analytics/profile-views/"
  ]);
  assert.ok(profileViews.readyHints.finiteScrollSelectors.includes(".scaffold-finite-scroll__content"));
  assert.ok(profileViews.paginationHints.loadMoreTriggerText.includes("load more"));
  assert.equal(profileViews.paginationHints.quickMode.strategy, "top_slice_with_gap_accounting");
  assert.equal(profileViews.paginationHints.reconcileMode.strategy, "paginate_until_surface_stalls_or_cap");
  assert.ok(profileViews.paginationHints.reconcileMode.advanceOrder.includes("click_load_more"));
  assert.ok(profileViews.extractionHints.sourceFamilies.includes("voyager_wvmp"));
  assert.ok(profileViews.extractionHints.sourceFamilies.includes("dom_wvmp"));
  assert.ok(profileViews.extractionHints.viewerFields.includes("relative_viewed_text"));
  assert.ok(profileViews.failureHints.warningCases.includes("Anonymous or company-only viewers remain low-confidence attention signals even when itemized."));
});
