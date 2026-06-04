// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { offerUrl, runCliJson } from "./support/live-runtime.js";

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

    assert.equal(report.agentQueue.tasks.length, 1);
    assert.equal(report.agentQueue.waiting.length, 1);
    assert.equal(report.agentQueue.items.length, 1);
    assert.equal(report.agentQueue.waitingItems.length, 1);

    assert.equal(report.agentQueue.tasks[0].kind, "write_draft");
    assert.equal(report.agentQueue.tasks[0].prospectName, dueProspect.name);
    assert.equal(report.agentQueue.items[0].taskKind, "write_draft");

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
