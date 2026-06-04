// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { TRANSITION_MOTION_MARKER_URL } from "../src/core/ensure-transition-motion.js";
import { renderMotionDetailPage } from "../src/artifacts/render-motions.js";
import { buildMotionsViewModel } from "../src/core/build-motions-view.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const offerHtml = [
  "<html>",
  "<head>",
  "<title>Motion Detail Surface</title>",
  '<meta name="description" content="Signal-first motion detail regression fixture." />',
  "</head>",
  "<body>ok</body>",
  "</html>",
].join("");
const offerUrl = `data:text/html,${encodeURIComponent(offerHtml)}`;

/**
 * @param {string} stateDir
 * @param {string[]} args
 */
function runCli(stateDir, args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, EXO_STATE_DIR: stateDir },
    encoding: "utf8",
  });
}

test("motion detail surface data flows through motion and workspace reports", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-detail-"));
  const workspacePath = path.join(stateDir, "workspace.html");

  try {
    const user = JSON.parse(runCli(stateDir, ["users", "add", "--label", "Workspace User", "--json"]));
    const motion = JSON.parse(
      runCli(stateDir, [
        "motion",
        "add",
        "--url",
        offerUrl,
        "--premise",
        "This offer matters when operators need a premise-led motion view instead of a codename-led shell.",
        "--audience",
        "Revenue leaders",
        "--signal",
        "company::Is there recent evidence this company is widening pipeline pressure?",
        "--signal",
        "person::Is there recent evidence a new revenue leader now owns that pressure?",
        "--stakeholder-count",
        "1",
        "--json",
      ]),
    );

    const company = JSON.parse(
      runCli(stateDir, [
        "companies",
        "add",
        "--name",
        "SignalCo",
        "--domain",
        "signalco.example",
        "--website-url",
        "https://signalco.example",
        "--linkedin-company-url",
        "https://www.linkedin.com/company/signalco/",
        "--motion",
        motion.id,
        "--json",
      ]),
    );
    const backlogCompany = JSON.parse(
      runCli(stateDir, [
        "motion",
        "discover",
        motion.id,
        "--name",
        "BacklogCo",
        "--domain",
        "backlogco.example",
        "--website-url",
        "https://backlogco.example",
        "--linkedin-company-url",
        "https://www.linkedin.com/company/backlogco/",
        "--queue-status",
        "queued_for_research",
        "--json",
      ]),
    );

    const companyMatch = JSON.parse(
      runCli(stateDir, [
        "companies",
        "signal-matches",
        "add",
        company.id,
        "--motion",
        motion.id,
        "--signal",
        motion.signals[0].id,
        "--summary",
        "Launched a new category page tied directly to pipeline expansion.",
        "--source-url",
        "https://signalco.example/news/pipeline-expansion",
        "--observed-at",
        "2026-05-31T10:00:00.000Z",
        "--confidence",
        "high",
        "--json",
      ]),
    );

    const personMatch = JSON.parse(
      runCli(stateDir, [
        "companies",
        "signal-matches",
        "add",
        company.id,
        "--motion",
        motion.id,
        "--signal",
        motion.signals[1].id,
        "--summary",
        "A new VP Sales stepped into the role this month.",
        "--person-name",
        "Riley Stone",
        "--person-title",
        "VP Sales",
        "--source-url",
        "https://www.linkedin.com/in/riley-stone",
        "--observed-at",
        "2026-05-31T11:00:00.000Z",
        "--confidence",
        "moderate",
        "--json",
      ]),
    );

    JSON.parse(
      runCli(stateDir, [
        "companies",
        "prospects",
        "add",
        company.id,
        "--motion",
        motion.id,
        "--name",
        "Riley Stone",
        "--title",
        "VP Sales",
        "--linkedin-profile-url",
        "https://www.linkedin.com/in/riley-stone",
        "--buying-committee-role",
        "primary_business_owner",
        "--decision-authority",
        "buys",
        "--fit-confidence",
        "high",
        "--why-relevant",
        "Owns the commercial pressure from the new expansion push.",
        "--signal-match",
        companyMatch.signalMatches[0].id,
        "--signal-match",
        personMatch.signalMatches[1].id,
        "--json",
      ]),
    );

    const motionReport = JSON.parse(runCli(stateDir, ["report", "motion", motion.id, "--json"]));
    assert.equal(motionReport.motion.offer.sourceUrl, offerUrl);
    assert.equal(motionReport.motion.offerThesis.sourceTitle, "Motion Detail Surface");
    assert.equal(motionReport.motion.setup.signals[0].question, "Is there recent evidence this company is widening pipeline pressure?");
    assert.equal(motionReport.matches.companies.length, 2);
    const matchedCompany = motionReport.matches.companies.find((item) => item.companyId === company.id);
    const queuedBacklogCompany = motionReport.matches.companies.find((item) => item.companyId === backlogCompany.company.id);
    assert.equal(matchedCompany?.matchedSignals.length, 2);
    assert.equal(queuedBacklogCompany?.matchedSignals.length, 0);
    assert.equal(motionReport.matches.people.length, 1);

    const workspaceJson = JSON.parse(runCli(stateDir, ["report", "workspace", "--user", user.id, "--json"]));
    assert.equal(workspaceJson.motionDetails.length, 1);
    assert.equal(workspaceJson.motionDetails[0].offer.title, "Motion Detail Surface");
    assert.equal(workspaceJson.motionDetails[0].signals[0].matchLabel, "1 company lit");
    assert.equal(workspaceJson.motionDetails[0].people[0].name, "Riley Stone");
    assert.equal(workspaceJson.motionDetails[0].backlogCompanies.length, 1);
    assert.equal(workspaceJson.motionDetails[0].backlogCompanies[0].companyName, backlogCompany.company.name);

    runCli(stateDir, ["report", "workspace", "--user", user.id, "--out", workspacePath]);
    const html = fs.readFileSync(workspacePath, "utf8");
    assert.match(html, new RegExp(`data-open-motion-detail="${motion.id}"`));
    assert.match(html, new RegExp(`data-motion-detail="${motion.id}"`));
    assert.match(html, /What this motion is for/);
    assert.match(html, /Why this offer matters here/);
    assert.match(html, /Matched companies/);
    assert.match(html, /Research backlog/);
    assert.match(html, /BacklogCo/);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("transition backlog renders as a transition holding motion instead of failed", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-transition-motion-detail-"));

  try {
    const user = JSON.parse(runCli(stateDir, ["users", "add", "--label", "Transition User", "--json"]));
    const motion = JSON.parse(
      runCli(stateDir, [
        "motion",
        "add",
        "--url",
        TRANSITION_MOTION_MARKER_URL,
        "--name",
        "transition-inbound-backlog",
        "--premise",
        "Continue and reconcile relationships started before Exo, then re-home them into real motions once they are understood.",
        "--json",
      ]),
    );

    const company = JSON.parse(
      runCli(stateDir, [
        "companies",
        "add",
        "--name",
        "CarryoverCo",
        "--domain",
        "carryover.example",
        "--website-url",
        "https://carryover.example",
        "--linkedin-company-url",
        "https://www.linkedin.com/company/carryover/",
        "--motion",
        motion.id,
        "--json",
      ]),
    );

    JSON.parse(
      runCli(stateDir, [
        "companies",
        "prospects",
        "add",
        company.id,
        "--motion",
        motion.id,
        "--name",
        "Casey Holder",
        "--title",
        "VP Revenue",
        "--linkedin-profile-url",
        "https://www.linkedin.com/in/casey-holder",
        "--buying-committee-role",
        "primary_business_owner",
        "--decision-authority",
        "buys",
        "--fit-confidence",
        "moderate",
        "--why-relevant",
        "Inherited from a live inbound thread that still needs routing.",
        "--json",
      ]),
    );

    const workspaceJson = JSON.parse(runCli(stateDir, ["report", "workspace", "--user", user.id, "--json"]));
    assert.equal(workspaceJson.motionDetails.length, 1);
    assert.equal(workspaceJson.motionDetails[0].truth, "transition");
    assert.equal(workspaceJson.motionDetails[0].strategyState.label, "transition backlog");
    assert.match(
      workspaceJson.motionDetails[0].premise.note,
      /holding motion keeps inherited relationships moving/i,
    );
    assert.match(
      workspaceJson.motionDetails[0].blocker,
      /reconcile these in-flight relationships and re-home them into real motions/i,
    );
    assert.match(
      workspaceJson.motionDetails[0].plan.nextSteps[0].text,
      /re-home understood relationships into real motions once the offer and owner are clear/i,
    );

    const model = buildMotionsViewModel({
      motionSummaries: workspaceJson.motionSummaries,
      motionDetails: workspaceJson.motionDetails,
    });
    const html = renderMotionDetailPage(model.details[0], { interactive: true });
    assert.match(html, /TRANSITION/);
    assert.doesNotMatch(html, />FAILED</);
    assert.doesNotMatch(html, /Define at least one audience hypothesis before targeting\./);
    assert.doesNotMatch(html, /Define at least one motion signal before targeting\./);
    assert.match(html, /Reconcile these in-flight relationships and re-home them into real motions\./);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
