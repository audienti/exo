// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { offerUrl, runCliJson } from "./support/live-runtime.js";

function flattenLaneItems(lanes) {
  return (lanes ?? []).flatMap((lane) => lane.items ?? []);
}

test("report workspace exposes the unified agent queue separately from blockers and backlog", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-workspace-runtime-"));

  try {
    const user = runCliJson(tempDir, [
      "users",
      "add",
      "--label",
      "workspace-agent-user",
      "--owner",
      "william",
      "--json",
    ]);

    const motion = runCliJson(tempDir, [
      "motion",
      "add",
      "--url",
      offerUrl,
      "--premise",
      "This offer matters when the workspace must show the real agent execution queue.",
      "--audience",
      "Revenue leaders",
      "--signal",
      "company::Is there recent evidence this company widened product or GTM scope?",
      "--json",
    ]);
    runCliJson(tempDir, ["motion", "restart", motion.id, "--json"]);

    const company = runCliJson(tempDir, [
      "companies",
      "add",
      "--name",
      "Workspace Queue Target",
      "--domain",
      "workspace-queue.example",
      "--motion",
      motion.id,
      "--json",
    ]);

    const dueProspect = runCliJson(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Due Prospect",
      "--title",
      "VP Revenue",
      "--buying-committee-role",
      "primary_business_owner",
      "--decision-authority",
      "influences",
      "--why-relevant",
      "Owns the first branch that should draft immediately.",
      "--linkedin-profile-url",
      "https://linkedin.com/in/due-prospect",
      "--json",
    ]).prospects.find((prospect) => prospect.name === "Due Prospect");

    const waitingProspect = runCliJson(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Wait Prospect",
      "--title",
      "VP Sales",
      "--buying-committee-role",
      "primary_business_owner",
      "--decision-authority",
      "influences",
      "--why-relevant",
      "This branch should stay queued until a future checkpoint.",
      "--linkedin-profile-url",
      "https://linkedin.com/in/wait-prospect",
      "--json",
    ]).prospects.find((prospect) => prospect.name === "Wait Prospect");

    assert.ok(dueProspect, "expected the due prospect to be returned from the add command");
    assert.ok(waitingProspect, "expected the waiting prospect to be returned from the add command");

    runCliJson(tempDir, [
      "companies",
      "cadence",
      "set",
      company.id,
      "--motion",
      motion.id,
      "--prospect",
      waitingProspect.id,
      "--current-step",
      "connection-request",
      "--next-action",
      "Send first touch",
      "--next-action-due-at",
      "2099-06-01T00:00:00.000Z",
      "--json",
    ]);

    const report = runCliJson(tempDir, [
      "report",
      "workspace",
      "--user",
      user.id,
      "--json",
    ]);

    assert.ok(report.agentQueue, "workspace report should expose the agent queue");
    assert.ok(report.blockedQueue, "workspace report should expose operator blockers separately");
    assert.ok(report.executionBacklog, "workspace report should expose packet/backlog pressure separately");

    assert.equal(report.agentQueue.tasks.length, 2);
    assert.equal(report.agentQueue.waiting.length, 1);
    assert.equal(report.agentQueue.items.length, 2);
    assert.equal(report.agentQueue.waitingItems.length, 1);

    assert.equal(report.agentQueue.tasks[0].kind, "prospect_research");
    assert.equal(report.agentQueue.tasks[0].prospectName, dueProspect.name);
    assert.equal(report.agentQueue.items[0].taskKind, "prospect_research");
    assert.equal(report.agentQueue.tasks[1].kind, "company_discovery");
    assert.equal(report.agentQueue.items[1].taskKind, "company_discovery");

    assert.equal(report.agentQueue.waiting[0].kind, "write_draft");
    assert.equal(report.agentQueue.waiting[0].prospectName, waitingProspect.name);
    assert.equal(report.agentQueue.waiting[0].waitingReason, "not_due_yet");
    assert.equal(report.agentQueue.waitingItems[0].taskKind, "write_draft");

    assert.equal(report.blockedQueue.itemCount, 0);
    assert.equal(report.executionBacklog.packetCount, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("report workspace keeps draft motions out of the default focus when active work exists", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-workspace-focus-active-"));

  try {
    const user = runCliJson(tempDir, [
      "users",
      "add",
      "--label",
      "workspace-focus-user",
      "--owner",
      "william",
      "--json",
    ]);

    const activeMotion = runCliJson(tempDir, [
      "motion",
      "add",
      "--url",
      offerUrl,
      "--premise",
      "This offer matters when the workspace should focus the motion that owns the live queue.",
      "--audience",
      "Revenue leaders",
      "--signal",
      "company::Is there recent evidence this company widened product or GTM scope?",
      "--json",
    ]);
    runCliJson(tempDir, ["motion", "restart", activeMotion.id, "--json"]);

    const draftOfferUrl = "data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3EDraft%20Focus%20Fixture%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3Edraft%3C%2Fbody%3E%3C%2Fhtml%3E";
    const draftMotion = runCliJson(tempDir, [
      "motion",
      "add",
      "--url",
      draftOfferUrl,
      "--premise",
      "This offer matters when a richer draft should still stay out of the default operator focus.",
      "--audience",
      "Revenue leaders",
      "--audience",
      "Revenue operations",
      "--signal",
      "company::Is there recent evidence this company widened product or GTM scope?",
      "--signal",
      "person::Is there recent evidence a new revenue leader joined this company?",
      "--json",
    ]);

    const company = runCliJson(tempDir, [
      "companies",
      "add",
      "--name",
      "Workspace Focus Co",
      "--domain",
      "workspace-focus.example",
      "--motion",
      activeMotion.id,
      "--json",
    ]);

    const prospect = runCliJson(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      activeMotion.id,
      "--name",
      "Focus Prospect",
      "--title",
      "VP Revenue",
      "--buying-committee-role",
      "primary_business_owner",
      "--decision-authority",
      "influences",
      "--why-relevant",
      "Creates the due branch that should anchor the workspace focus.",
      "--linkedin-profile-url",
      "https://linkedin.com/in/focus-prospect",
      "--json",
    ]).prospects[0];

    assert.ok(prospect, "expected the active motion to own a due prospect");

    const report = runCliJson(tempDir, [
      "report",
      "workspace",
      "--user",
      user.id,
      "--json",
    ]);

    assert.ok(report.operatorSummary.focusMotion, "expected a focused motion in the operator summary");
    assert.equal(report.operatorSummary.focusMotion.id, activeMotion.id);
    assert.equal(report.operatorSummary.focusMotion.status, "active");
    assert.notEqual(report.operatorSummary.focusMotion.id, draftMotion.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("report workspace keeps a replied prospect in reply-accepted after the outbound reply is sent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-workspace-reply-lane-"));

  try {
    const user = runCliJson(tempDir, [
      "users",
      "add",
      "--label",
      "workspace-reply-user",
      "--owner",
      "william",
      "--json",
    ]);

    const motion = runCliJson(tempDir, [
      "motion",
      "add",
      "--url",
      offerUrl,
      "--premise",
      "This offer matters when an inbound conversation should stay out of the sent-pending lane after we reply.",
      "--audience",
      "Owners",
      "--signal",
      "company::Did the relationship already move into a live conversation?",
      "--json",
    ]);
    runCliJson(tempDir, ["motion", "restart", motion.id, "--json"]);

    const company = runCliJson(tempDir, [
      "companies",
      "add",
      "--name",
      "Reply Lane Co",
      "--domain",
      "reply-lane.example",
      "--motion",
      motion.id,
      "--json",
    ]);

    const prospect = runCliJson(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Marv White",
      "--title",
      "Director of Procurement",
      "--buying-committee-role",
      "primary_business_owner",
      "--decision-authority",
      "influences",
      "--fit-confidence",
      "high",
      "--why-relevant",
      "Transitioned from messaging inbox and already replied in-thread.",
      "--linkedin-profile-url",
      "https://www.linkedin.com/in/marv-white/",
      "--json",
    ]).prospects[0];

    runCliJson(tempDir, [
      "companies",
      "touches",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--prospect",
      prospect.id,
      "--surface",
      "inbound_reply",
      "--direction",
      "inbound",
      "--outcome",
      "replied",
      "--occurred-at",
      "2025-10-10T09:55:39.000Z",
      "--summary",
      "Marv White replied on LinkedIn.",
      "--json",
    ]);

    runCliJson(tempDir, [
      "companies",
      "touches",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--prospect",
      prospect.id,
      "--surface",
      "inbound_reply",
      "--direction",
      "outbound",
      "--outcome",
      "sent",
      "--occurred-at",
      "2026-06-07T00:09:49.284Z",
      "--summary",
      "Sent the governed LinkedIn reply.",
      "--json",
    ]);

    const report = runCliJson(tempDir, [
      "report",
      "workspace",
      "--user",
      user.id,
      "--json",
    ]);

    const item = flattenLaneItems(report.engagementLanes).find((candidate) => candidate.prospectId === prospect.id);
    assert.ok(item, "expected the replied prospect in the workspace engagement lanes");
    assert.equal(item.engagementLane?.key, "reply-accepted");
    assert.equal(
      report.engagementLanes.find((lane) => lane.key === "reply-accepted")?.items.some((candidate) => candidate.prospectId === prospect.id),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("report workspace does not fabricate a pin-owner blocker when a singleton managed user auto-resolves", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-workspace-blocked-assignment-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.unipile]",
      "enabled = true",
      "",
    ].join("\n"),
  );

  try {
    const user = runCliJson(tempDir, [
      "users",
      "add",
      "--label",
      "workspace-managed-user",
      "--owner",
      "william",
      "--json",
    ]);

    runCliJson(
      tempDir,
      [
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "workspace-managed-linkedin",
        "--runtime",
        "codex",
        "--connector",
        "unipile",
        "--provider-account-id",
        "acct-linkedin-1",
        "--preferred",
        "--max-connection-requests",
        "125",
        "--json",
      ],
      {
        CODEX_HOME: codexHome,
      },
    );

    const motion = runCliJson(
      tempDir,
      [
        "motion",
        "add",
        "--url",
        offerUrl,
        "--premise",
        "This offer matters when a ready outbound branch is blocked only by missing explicit execution assignment.",
        "--audience",
        "Revenue leaders",
        "--signal",
        "company::Is there recent evidence this company widened product or GTM scope?",
        "--json",
      ],
      {
        CODEX_HOME: codexHome,
      },
    );

    runCliJson(tempDir, ["motion", "restart", motion.id, "--json"], {
      CODEX_HOME: codexHome,
    });

    const company = runCliJson(tempDir, [
      "companies",
      "add",
      "--name",
      "Ready But Unassigned",
      "--domain",
      "ready-unassigned.example",
      "--website-url",
      "https://ready-unassigned.example",
      "--linkedin-company-url",
      "https://www.linkedin.com/company/ready-unassigned",
      "--motion",
      motion.id,
      "--json",
    ]);

    const signalMatch = runCliJson(tempDir, [
      "companies",
      "signal-matches",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--signal",
      motion.signals[0].id,
      "--summary",
      "The company just widened its GTM scope and needs a live vendor-accountability branch now.",
      "--confidence",
      "high",
      "--json",
    ]);

    const prospect = runCliJson(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Terry Ready",
      "--title",
      "Chief Revenue Officer",
      "--buying-committee-role",
      "primary_business_owner",
      "--decision-authority",
      "buys",
      "--fit-confidence",
      "high",
      "--signal-match",
      signalMatch.signalMatches[0].id,
      "--why-relevant",
      "Best owner for the already-ready executive branch.",
      "--linkedin-profile-url",
      "https://www.linkedin.com/in/terry-ready",
      "--json",
    ]).prospects[0];

    runCliJson(tempDir, [
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
      "--next-action",
      "Send the first connection request now.",
      "--json",
    ]);

    const report = runCliJson(tempDir, [
      "report",
      "workspace",
      "--user",
      user.id,
      "--json",
    ], {
      CODEX_HOME: codexHome,
    });

    const reportedCompany = report.motionDetails
      .flatMap((detail) => detail.companies ?? [])
      .find((item) => item.companyId === company.id);
    assert.equal(reportedCompany?.executionIdentity?.status, "pinned-ready");
    assert.equal(reportedCompany?.executionIdentity?.resolutionSource, "auto-singleton-user");
    assert.equal(report.blockedQueue.itemCount, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
