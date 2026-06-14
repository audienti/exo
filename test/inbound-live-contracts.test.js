// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadJsonCassette, writeJsonCassette } from "./support/cassettes.js";
import {
  offerUrl,
  cliPath,
  runCliJson,
  runCliText,
  writeFakeCodexCaptureScript,
  createLinkedProspectContext,
  uniqueTestLabel
} from "./support/live-runtime.js";

test("inbound sync gmail turns one Gmail capture cassette into governed writeback and can apply it", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-gmail-cassette-"));

  try {
    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when outbound operators need governed inbox truth.",
      signal: "company::Is there active revenue complexity that makes a reply operationally important?",
      prospectName: "Alicia Buyer",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the operational workflow pain that makes the inbound email relevant.",
      email: "alicia@buyer.example"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-user", "--owner", "william", "--json"]);
    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "gmail-user@example.com",
      "--runtime",
      "codex",
      "--connector",
      "gmail",
      "--preferred",
      "--json"
    ]);
    const gmailAccountId = withGmail.accounts.find((account) => account.capability === "gmail").id;

    const capturePath = writeJsonCassette(
      tempDir,
      "gmail-capture.json",
      "inbound/gmail/inbox-reply-success.json"
    );

    const result = runCliJson(tempDir, [
      "inbound",
      "sync",
      "gmail",
      user.id,
      "--account",
      gmailAccountId,
      "--input",
      capturePath,
      "--apply",
      "--refresh",
      "--json"
    ]);

    assert.equal(result.capture.status, "success");
    assert.equal(result.capture.threadCount, 1);
    assert.equal(result.applied.refreshed.inbox.itemCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.counts.observationCount, 1);
    assert.equal(observations.observations[0].kind, "email_reply_received");
    assert.equal(observations.observations[0].motionId, motion.id);
    assert.equal(observations.observations[0].companyId, company.id);
    assert.equal(observations.observations[0].prospectId, prospect.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync gmail-live uses a Codex cassette and applies governed writeback", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-gmail-live-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), ['[plugins."gmail@openai-curated"]', "enabled = true", ""].join("\n"));
  writeFakeCodexCaptureScript(fakeCodexPath, loadJsonCassette("inbound/gmail-live/codex-success.json"));

  try {
    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when outbound operators need governed inbox truth.",
      signal: "company::Is there active revenue complexity that makes a reply operationally important?",
      prospectName: "Alicia Buyer",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the operational workflow pain that makes the inbound email relevant.",
      email: "alicia@buyer.example"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-live-user", "--owner", "william", "--json"]);
    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "gmail-live-user@example.com",
      "--runtime",
      "codex",
      "--connector",
      "gmail",
      "--preferred",
      "--json"
    ]);
    const gmailAccountId = withGmail.accounts.find((account) => account.capability === "gmail").id;

    const result = runCliJson(tempDir, [
      "inbound",
      "sync",
      "gmail-live",
      user.id,
      "--account",
      gmailAccountId,
      "--limit",
      "10",
      "--since",
      "2026-05-30T00:00:00.000Z",
      "--apply",
      "--refresh",
      "--json"
    ], {
      CODEX_HOME: codexHome,
      EXO_CODEX_CLI: fakeCodexPath
    });

    assert.equal(result.capture.status, "success");
    assert.equal(result.applied.refreshed.inbox.itemCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.observations[0].motionId, motion.id);
    assert.equal(observations.observations[0].companyId, company.id);
    assert.equal(observations.observations[0].prospectId, prospect.id);
    assert.equal(observations.observations[0].actorHandle, "alicia@buyer.example");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin turns one quick capture cassette into governed writeback and can apply it", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-cassette-"));

  try {
    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when inbound LinkedIn truth has to land on the right branch automatically.",
      signal: "company::Is there active GTM pressure that makes inbound connection requests important?",
      prospectName: "Alicia Buyer",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the workflow pain that makes the inbound connection request worth routing immediately.",
      linkedinProfileUrl: "https://www.linkedin.com/in/alicia-buyer/"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-user", "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--preferred",
      "--json"
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const capturePath = writeJsonCassette(
      tempDir,
      "linkedin-capture.json",
      "inbound/linkedin/quick-invite-success.json"
    );

    const result = runCliJson(tempDir, [
      "inbound",
      "sync",
      "linkedin",
      user.id,
      "--account",
      linkedinAccountId,
      "--input",
      capturePath,
      "--apply",
      "--refresh",
      "--json"
    ]);

    assert.equal(result.capture.mode, "quick");
    assert.equal(result.capture.sectionCount, 6);
    assert.equal(result.applied.refreshed.inbox.itemCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    assert.equal(observations.observations[0].kind, "connection_request_received");
    assert.equal(observations.observations[0].motionId, null);
    assert.equal(observations.observations[0].companyId, null);
    assert.equal(observations.observations[0].prospectId, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync live returns a mixed-runtime landing plan when one account still needs agent capture", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-live-cassette-"));
  const codexHome = path.join(tempDir, ".codex");
  const fakeCodexPath = path.join(tempDir, "fake-codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), [
    '[plugins."gmail@openai-curated"]',
    "enabled = true",
    "",
    "[mcp_servers.unipile]",
    "enabled = true",
    ""
  ].join("\n"));
  writeFakeCodexCaptureScript(fakeCodexPath, loadJsonCassette("inbound/gmail-live/codex-success.json"));

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", uniqueTestLabel(tempDir, "combined-live-user"), "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "combined-live-user",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--preferred",
      "--json"
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const withGmail = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "combined-live-user@buyer.example",
      "--runtime",
      "codex",
      "--connector",
      "gmail",
      "--preferred",
      "--json"
    ]);
    const gmailAccountId = withGmail.accounts.find((account) => account.capability === "gmail").id;

    const result = runCliJson(tempDir, [
      "inbound",
      "sync",
      "live",
      user.id,
      "--agent-handoff",
      "--json"
    ], {
      CODEX_HOME: codexHome,
      EXO_CODEX_CLI: fakeCodexPath
    });

    assert.equal(result.mode, "quick");
    assert.equal(result.accounts.length, 2);
    assert.equal(result.transportStatus, "agent_capture_required");
    assert.equal(result.canApply, false);
    assert.equal(result.payload, null);
    assert.equal(result.accounts.find((account) => account.account.id === linkedinAccountId).probe.runtime, "codex");
    assert.equal(result.accounts.find((account) => account.account.id === gmailAccountId).probe.runtime, "codex");
    assert.equal(result.accounts.find((account) => account.account.id === gmailAccountId).capture.status, "success");
    assert.equal(result.accounts.find((account) => account.account.id === linkedinAccountId).transport.kind, "agent_handoff");
    assert.equal(result.accounts.find((account) => account.account.id === linkedinAccountId).payload, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound sync linkedin accepts a full reconciliation capture and lands disappearance deltas", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-linkedin-full-cassette-"));

  try {
    const { motion, company, prospect } = createLinkedProspectContext(tempDir, {
      premise: "This offer matters when Exo must reconcile a full pending-invite backlog without losing deltas.",
      signal: "company::Is there active GTM pressure that makes pending-invite reconciliation operationally important?",
      prospectName: "Jordan Cipolla",
      prospectTitle: "VP Revenue Operations",
      whyRelevant: "Owns the live workflow that makes invite disappearance materially important.",
      linkedinProfileUrl: "https://www.linkedin.com/in/jordan-cipolla/"
    });

    const user = runCliJson(tempDir, ["users", "add", "--label", "linkedin-full-user", "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "linkedin-full-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--preferred",
      "--json"
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const firstCapturePath = path.join(tempDir, "linkedin-full-first.json");
    fs.writeFileSync(firstCapturePath, JSON.stringify({
      mode: "full",
      sentInvitations: {
        status: "success",
        checkedAt: "2026-05-31T15:00:00.000Z",
        itemCount: 1,
        visibleTotalCount: 1,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: [
          {
            invitationId: "invite-1",
            kind: "connection_request_pending",
            observedAt: "2026-05-31T15:00:00.000Z",
            summary: "Jordan Cipolla's connection request is still pending.",
            actorName: "Jordan Cipolla",
            actorTitle: null,
            actorCompanyName: null,
            actorHandle: null,
            actorProfileUrl: "https://www.linkedin.com/in/jordan-cipolla/",
            sourceUrl: null,
            motionId: null,
            companyId: null,
            prospectId: null,
            notes: null
          }
        ]
      },
      receivedInvitations: {
        status: "success",
        checkedAt: "2026-05-31T15:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      },
      messagingInbox: {
        status: "success",
        checkedAt: "2026-05-31T15:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      },
      profileViews: {
        status: "success",
        checkedAt: "2026-05-31T15:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      },
      followersList: {
        status: "success",
        checkedAt: "2026-05-31T15:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      },
      followingList: {
        status: "success",
        checkedAt: "2026-05-31T15:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      }
    }, null, 2));

    const firstResult = runCliJson(tempDir, [
      "inbound",
      "sync",
      "linkedin",
      user.id,
      "--account",
      linkedinAccountId,
      "--input",
      firstCapturePath,
      "--apply",
      "--json"
    ]);

    assert.equal(firstResult.capture.mode, "full");
    assert.equal(firstResult.applied.counts.observationCount, 1);

    const secondCapturePath = path.join(tempDir, "linkedin-full-second.json");
    fs.writeFileSync(secondCapturePath, JSON.stringify({
      mode: "full",
      sentInvitations: {
        status: "success",
        checkedAt: "2026-05-31T16:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      },
      receivedInvitations: {
        status: "success",
        checkedAt: "2026-05-31T16:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      },
      messagingInbox: {
        status: "success",
        checkedAt: "2026-05-31T16:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      },
      profileViews: {
        status: "success",
        checkedAt: "2026-05-31T16:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      },
      followersList: {
        status: "success",
        checkedAt: "2026-05-31T16:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      },
      followingList: {
        status: "success",
        checkedAt: "2026-05-31T16:00:00.000Z",
        itemCount: 0,
        visibleTotalCount: 0,
        captureCompleteness: "complete",
        requestedMode: "full",
        actualMode: "full",
        reconcileRequired: false,
        reconcileReason: null,
        error: null,
        items: []
      }
    }, null, 2));

    const secondResult = runCliJson(tempDir, [
      "inbound",
      "sync",
      "linkedin",
      user.id,
      "--account",
      linkedinAccountId,
      "--input",
      secondCapturePath,
      "--apply",
      "--refresh",
      "--json"
    ]);

    assert.equal(secondResult.capture.mode, "full");
    assert.equal(secondResult.applied.counts.observationCount, 1);

    const observations = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]);
    const delta = observations.observations.find((observation) => observation.kind === "connection_request_no_longer_pending");
    assert.ok(delta);
    assert.equal(delta.actorName, "Jordan Cipolla");
    assert.equal(delta.motionId, motion.id);
    assert.equal(delta.companyId, company.id);
    assert.equal(delta.prospectId, prospect.id);
    assert.match(delta.summary, /no longer present/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
