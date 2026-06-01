// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildLiveLinkedinInboundSyncPayload } from "../src/core/inbound-linkedin-live-sync.js";

const timestamp = "2026-05-31T13:00:00.000Z";

async function buildCodexLinkedinHandoffResult(options = {}) {
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
  const previousCodexCli = process.env.EXO_CODEX_CLI;
  process.env.CODEX_HOME = codexHome;
  process.env.CODEX_SHELL = "1";
  if (options.codexCliEnv === null) {
    delete process.env.EXO_CODEX_CLI;
  } else if (options.codexCliEnv !== undefined) {
    process.env.EXO_CODEX_CLI = options.codexCliEnv;
  }

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

    if (previousCodexCli === undefined) {
      delete process.env.EXO_CODEX_CLI;
    } else {
      process.env.EXO_CODEX_CLI = previousCodexCli;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("codex live handoff includes structured LinkedIn messaging inbox hints distilled from legacy retrieval logic", async () => {
  const result = await buildCodexLinkedinHandoffResult();
  const messagingInbox = result.transport.captureRequest.surfaceHints.messagingInbox;
  const profileSelection = result.transport.captureRequest.profileSelection;

  assert.equal(result.transport.kind, "agent_handoff");
  assert.equal(result.transport.captureRequest.executionMode, "native_tools_only");
  assert.equal(result.transport.captureRequest.captureTransportMode, "browser_native_only");
  assert.equal(result.transport.captureRequest.shellFallbackAllowed, false);
  assert.equal(result.transport.captureRequest.exoCliWritebackRequired, true);
  assert.equal(result.transport.captureRequest.contractVersion, "exo-live-agent-handoff-v2");
  assert.equal(result.transport.captureRequest.coldStartReady, true);
  assert.equal(result.transport.captureRequest.noRepoRediscoveryRequired, true);
  assert.ok(result.transport.captureRequest.disallowedFallbacks.includes("EXO_CODEX_CLI"));
  assert.match(result.transport.captureRequest.prompt, /structured surfaceHints/i);
  assert.match(result.transport.captureRequest.prompt, /captureGuide/i);
  assert.match(result.transport.captureRequest.prompt, /captureScaffold/i);
  assert.match(result.transport.captureRequest.prompt, /profileSelection/i);
  assert.match(result.transport.captureRequest.prompt, /Use captureGuide\.writebackRules and verificationCommands/i);
  assert.match(result.transport.captureRequest.prompt, /start from captureScaffold/i);
  assert.match(result.transport.captureRequest.prompt, /Do not look for an Exo website, Exo app route, admin surface, browser-history breadcrumb, or sync UI/i);
  assert.match(result.transport.captureRequest.prompt, /There is no browser-side Exo control surface to discover/i);
  assert.match(result.transport.captureRequest.prompt, /Do not infer exo next, inbox, daily, or review from browser inspection alone/i);
  assert.equal(result.transport.captureRequest.captureGuide.purpose, "Use native browser or connector tools for live capture, then land the governed result through Exo CLI.");
  assert.equal(result.transport.captureRequest.captureGuide.selfContained.coldStartReady, true);
  assert.equal(result.transport.captureRequest.captureGuide.selfContained.noRepoRediscoveryRequired, true);
  assert.equal(result.transport.captureRequest.captureGuide.selfContained.rawNetworkBodiesRequired, false);
  assert.equal(result.transport.captureRequest.captureGuide.contractInputs.captureScaffold, "If browser-side JavaScript is needed, use captureScaffold before inventing a larger ad hoc extractor.");
  assert.equal(result.transport.captureRequest.captureGuide.contractInputs.surfaceHints, "Use surfaceHints as the canonical retrieval playbook.");
  assert.equal(result.transport.captureRequest.captureGuide.contractInputs.profileSelection, "Use profileSelection as the binding contract.");
  assert.ok(result.transport.captureRequest.captureGuide.captureRules.some((line) => /Do not shell out through codex exec, EXO_CODEX_CLI/i.test(line)));
  assert.ok(result.transport.captureRequest.captureGuide.captureRules.some((line) => /Do not preserve raw HTML, DOM dumps, screenshots, or network bodies/i.test(line)));
  assert.ok(result.transport.captureRequest.captureGuide.writebackRules.some((line) => /buildPayloadCommand via stdin/i.test(line)));
  assert.ok(result.transport.captureRequest.captureGuide.writebackRules.some((line) => /applyCommand via stdin/i.test(line)));
  assert.match(result.transport.captureRequest.captureGuide.rediscoveryPolicy, /Do not reopen repo source files, CLI help, or prior chat history/i);
  assert.match(result.transport.captureRequest.captureGuide.verificationPolicy, /report their literal outputs instead of inferring Exo state/i);
  assert.equal(result.transport.captureRequest.captureScaffold.version, "exo-linkedin-quick-capture-v1");
  assert.match(result.transport.captureRequest.captureScaffold.modulePath, /src\/lib\/linkedin-quick-capture-scaffold\.js$/);
  assert.equal(result.transport.captureRequest.captureScaffold.runtime, "browser_page_evaluate");
  assert.equal(result.transport.captureRequest.captureScaffold.mode, "snapshot_extractor");
  assert.equal(result.transport.captureRequest.captureScaffold.bootstrapSymbol, "__exoLinkedinQuickCapture");
  assert.equal(result.transport.captureRequest.captureScaffold.entrypoints.bootstrapSourceBuilder, "buildLinkedinQuickCaptureBootstrapSource");
  assert.equal(result.transport.captureRequest.captureScaffold.entrypoints.evaluateSourceBuilder, "buildLinkedinQuickCaptureEvaluateSource");
  assert.ok(result.transport.captureRequest.captureScaffold.usage.some((line) => /before inventing a larger ad hoc LinkedIn DOM script/i.test(line)));
  assert.equal(result.transport.captureRequest.captureScaffold.supportedSurfaces.sentInvitations.rowStrategy, "withdraw_control_or_profile_anchor_row");
  assert.equal(result.transport.captureRequest.captureScaffold.supportedSurfaces.messagingInbox.rowStrategy, "conversation_listitem_row");
  assert.equal(result.transport.captureRequest.captureScaffold.supportedSurfaces.profileViews.rowStrategy, "finite_scroll_profile_view_row");
  assert.deepEqual(result.transport.captureRequest.outputGuide.surfaces, [
    "sent_invitations",
    "received_invitations",
    "messaging_inbox",
    "profile_views",
    "following_list"
  ]);
  assert.equal(result.transport.captureRequest.outputGuide.modePolicy.requestedMode, "quick");
  assert.match(result.transport.captureRequest.outputGuide.surfaceStateRules.exhaustionStatus, /disappearance or silence is trustworthy/i);
  assert.ok(result.transport.captureRequest.outputGuide.actorIdentityRules.some((line) => /actorLinkedinMemberId/i.test(line)));
  assert.ok(result.transport.captureRequest.outputGuide.ignoreRules.some((line) => /materially change operator action/i.test(line)));
  assert.equal(result.transport.captureRequest.buildPayloadInputMode, "normalized_capture_json_stdin");
  assert.equal(result.transport.captureRequest.rawNetworkBodiesRequired, false);
  assert.match(result.transport.captureRequest.buildPayloadStdinContract, /captured JSON object that matches outputSchema/i);
  assert.equal(result.transport.captureRequest.applyInputMode, "combined_inbound_sync_json_stdin");
  assert.match(result.transport.captureRequest.applyStdinContract, /merge the returned payload\.accounts arrays/i);
  assert.match(result.transport.captureRequest.applyCommand, /exo inbound sync run user-1 --input <combined-inbound-sync\.json> --refresh --json/);
  assert.ok(Array.isArray(result.transport.captureRequest.executionChecklist));
  assert.ok(result.transport.captureRequest.executionChecklist.some((line) => /captureGuide, surfaceHints, profileSelection, and captureScaffold/i.test(line)));
  assert.ok(result.transport.captureRequest.executionChecklist.some((line) => /buildPayloadCommand via stdin/i.test(line)));
  assert.ok(Array.isArray(result.transport.captureRequest.verificationCommands));
  assert.ok(result.transport.captureRequest.verificationCommands.some((command) => /exo inbound sync show user-1 --json/.test(command)));
  assert.ok(result.transport.captureRequest.verificationCommands.some((command) => /linkedin-sent-invitations/.test(command)));
  assert.ok(result.transport.captureRequest.verificationCommands.some((command) => /exo next --user user-1 --json/.test(command)));
  assert.equal(profileSelection.strategy, "resolved_browser_profile_only");
  assert.equal(profileSelection.expectedHandle, "hint-contract-user");
  assert.equal(profileSelection.displayNameMismatchAllowed, true);
  assert.equal(profileSelection.expectedProfile.profileDirectory, "Profile 4");
  assert.equal(profileSelection.expectedProfile.detectedProfileName, "LinkedIn Main");
  assert.ok(profileSelection.expectedProfile.acceptableSessionLabels.includes("hint-contract-profile"));
  assert.ok(profileSelection.expectedProfile.acceptableSessionLabels.includes("Profile 4"));
  assert.ok(!profileSelection.expectedProfile.acceptableSessionLabels.includes("LinkedIn Main"));
  assert.ok(profileSelection.rules.some((rule) => /display-name drift/i.test(rule)));
  assert.ok(profileSelection.rules.some((rule) => /connector session label/i.test(rule) || /display name/i.test(rule)));
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

test("codex shell handoff ignores EXO_CODEX_CLI and stays on the native capture contract", async () => {
  const result = await buildCodexLinkedinHandoffResult({
    codexCliEnv: "/tmp/fake-codex-should-be-ignored"
  });

  assert.equal(result.transport.kind, "agent_handoff");
  assert.equal(result.transport.captureRequest.executionMode, "native_tools_only");
  assert.equal(result.transport.captureRequest.captureTransportMode, "browser_native_only");
  assert.equal(result.transport.captureRequest.shellFallbackAllowed, false);
  assert.equal(result.transport.captureRequest.exoCliWritebackRequired, true);
  assert.equal(result.transport.captureRequest.coldStartReady, true);
  assert.ok(result.transport.captureRequest.disallowedFallbacks.includes("codex_exec"));
  assert.match(result.transport.reason, /native agent tools/i);
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
