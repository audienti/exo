// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { renderCompanyDetailPage } from "../src/artifacts/render-company-detail.js";
import { renderCompanyResearchBriefPage } from "../src/artifacts/render-company-research-brief-page.js";
import { renderMotionDetailPage, renderMotionSettingsPage } from "../src/artifacts/render-motions.js";
import { buildCompanyViewModel } from "../src/core/build-company-view.js";
import { buildCompanyResearchBrief } from "../src/core/build-company-research-brief.js";
import { buildMotionsViewModel } from "../src/core/build-motions-view.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const offerHtml = [
  "<html>",
  "<head>",
  "<title>Research UI Fixture</title>",
  '<meta name="description" content="Research backlog UI test fixture." />',
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

test("company and motion surfaces expose a start research button and research brief page", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-company-research-ui-"));

  try {
    const user = JSON.parse(runCli(stateDir, ["users", "add", "--label", "Research UI User", "--json"]));
    const motion = JSON.parse(
      runCli(stateDir, [
        "motion",
        "add",
        "--url",
        offerUrl,
        "--premise",
        "This offer matters when operators need a governed place to begin company research.",
        "--audience",
        "Revenue leaders",
        "--signal",
        "company::Is there recent evidence this company is changing how pipeline is built?",
        "--json",
      ]),
    );

    const company = JSON.parse(
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
        "discovered",
        "--json",
      ]),
    ).company;
    const motionWithBacklog = JSON.parse(runCli(stateDir, ["motion", "show", motion.id, "--json"]));

    const companyModel = buildCompanyViewModel({
      company,
      prospects: [],
      motions: [motionWithBacklog],
    });
    const userMeta = {
      id: user.id,
      label: user.label,
      gmailOptions: [
        { ref: "gmail:research@audienti.com", handle: "research@audienti.com", label: "research@audienti.com" },
        { ref: "gmail:research@knitit.ai", handle: "research@knitit.ai", label: "research@knitit.ai (unipile)" },
      ],
    };
    const companyHtml = renderCompanyDetailPage(companyModel, { interactive: true, user: userMeta });
    assert.match(companyHtml, /who can work this company/i);
    assert.match(companyHtml, /No user is assigned to this company yet\./);
    assert.match(companyHtml, /Exact Gmail inbox/i);
    assert.match(companyHtml, /data-exo-writer="assignCompanyUser"/);
    assert.match(companyHtml, /data-exo-fields="accountRef:accountRef\?"/);
    assert.match(companyHtml, /Open queue/);
    assert.match(companyHtml, /Open brief/);
    assert.match(companyHtml, new RegExp(`href="\\/companies\\/${company.id}\\/research-brief\\/${motion.id}"`));

    const motionsModel = buildMotionsViewModel({
      motionSummaries: [
        {
          id: motion.id,
          name: motion.name,
          status: motion.status,
          overallStage: "needs-company-research",
          companyCount: 1,
          prospectCount: 0,
          dueNowCount: 0,
        },
      ],
      motionDetails: [
        {
          motionId: motion.id,
          motionName: motion.name,
          motionStatus: motion.status,
          overallStage: "needs-company-research",
          offer: {
            title: "Research UI Fixture",
            url: offerUrl,
            summary: "Fixture offer",
          },
          premise: {
            statement: motion.premise.statement,
            status: "defined",
            source: "operator",
          },
          strategyState: { tone: "warning" },
          signals: [
            {
              id: motion.signals[0].id,
              question: "Is there recent evidence this company is changing how pipeline is built?",
              scope: "company",
              companyCount: 0,
            },
          ],
          audiences: [
            {
              name: "Revenue leaders",
              rolesLine: "VP Sales, CRO",
              matchedCount: 1,
            },
          ],
          companies: [],
          backlogCompanies: [
            {
              companyId: company.id,
              companyName: company.name,
              domain: company.domain,
              prospectCount: 0,
              stage: "needs-company-research",
              queueStatus: "discovered",
            },
          ],
          people: [
            {
              companyId: company.id,
              companyName: company.name,
              prospectId: "prospect-1",
              name: "Alex Backlog",
              title: "VP Sales",
              ownerLabel: user.label,
              signalLabel: "New VP Sales role now owns pipeline design pressure.",
              signalQuestion: "Is there recent evidence a new revenue leader now owns that pressure?",
              branchState: {
                key: "ready",
                label: "Ready",
              },
            },
            {
              companyId: company.id,
              companyName: company.name,
              prospectId: "prospect-2",
              name: "Morgan Queue",
              title: "CRO",
              ownerLabel: user.label,
              signalLabel: "Pipeline design changes are now being owned by the CRO.",
              signalQuestion: "Is there recent evidence this company is changing how pipeline is built?",
              branchState: {
                key: "waiting",
                label: "Waiting",
              },
            },
          ],
          plan: {
            nextSteps: [],
            dueNowCount: 1,
            waitingCount: 1,
            readyToSendCount: 1,
            messageTestReadyCount: 2,
            companyCount: 1,
            prospectCount: 2,
          },
        },
      ],
    });
    const motionHtml = renderMotionDetailPage(motionsModel.details[0], { interactive: true });
    assert.match(motionHtml, new RegExp(`href="\\/motions\\/${motion.id}\\/settings"`));
    assert.match(motionHtml, /Audience hypotheses/);
    assert.match(motionHtml, new RegExp(`data-tabset="motion-workviews-${motion.id}"`));
    assert.match(motionHtml, new RegExp(`role="tab"[^>]*data-tab-target="motion-${motion.id}-companies"`));
    assert.match(motionHtml, new RegExp(`role="tab"[^>]*data-tab-target="motion-${motion.id}-backlog"`));
    assert.match(motionHtml, new RegExp(`role="tab"[^>]*data-tab-target="motion-${motion.id}-people"`));
    assert.match(motionHtml, new RegExp(`role="tab"[^>]*data-tab-target="motion-${motion.id}-activity"`));
    assert.match(motionHtml, new RegExp(`role="tab"[^>]*data-tab-target="motion-${motion.id}-execution"`));
    assert.match(motionHtml, new RegExp(`role="tabpanel"[^>]*data-tab-panel="motion-${motion.id}-backlog"`));
    assert.match(motionHtml, /Research backlog/);
    assert.match(motionHtml, /Open queue/);
    assert.match(motionHtml, /Open brief/);
    assert.match(motionHtml, new RegExp(`href="\\/companies\\/${company.id}\\/research-brief\\/${motion.id}"`));
    assert.match(motionHtml, /Message-ready/);
    assert.match(motionHtml, /Prospect packets/);
    assert.match(motionHtml, /Motion stage/);
    assert.match(motionHtml, /Company research/);
    assert.match(motionHtml, /4 of 7/);
    assert.match(motionHtml, /1 of 2 people are ready/);
    assert.doesNotMatch(motionHtml, /Stage readiness/);
    assert.doesNotMatch(motionHtml, /PREMISE · WHY THIS OFFER MATTERS HERE/);
    assert.doesNotMatch(motionHtml, /Set live/i);
    assert.doesNotMatch(motionHtml, /data-exo-writer="restartMotion"/);

    const settingsHtml = renderMotionSettingsPage(motionsModel.details[0], {
      interactive: true,
      user: userMeta,
    });
    assert.match(settingsHtml, /role="tablist"/);
    assert.match(settingsHtml, /role="tab"[^>]*data-tab-target="premise"/);
    assert.match(settingsHtml, /role="tab"[^>]*data-tab-target="offer"/);
    assert.match(settingsHtml, /role="tab"[^>]*data-tab-target="signals"/);
    assert.match(settingsHtml, /role="tab"[^>]*data-tab-target="execution"/);
    assert.match(settingsHtml, /role="tabpanel"[^>]*data-tab-panel="premise"/);
    assert.match(settingsHtml, /role="tabpanel"[^>]*data-tab-panel="offer" hidden/);
    assert.match(settingsHtml, /role="tabpanel"[^>]*data-tab-panel="signals" hidden/);
    assert.match(settingsHtml, /role="tabpanel"[^>]*data-tab-panel="execution" hidden/);
    assert.match(settingsHtml, /WHY THIS OFFER MATTERS HERE/);
    assert.match(settingsHtml, /what this motion is for/i);
    assert.match(settingsHtml, /Signals <span>1<\/span>/);
    assert.match(settingsHtml, /Add signal questions/i);
    assert.match(settingsHtml, /data-exo-writer="addMotionSignals"/);
    assert.match(settingsHtml, /data-exo-fields="signal:signal"/);
    assert.match(settingsHtml, /Remove signal/i);
    assert.match(settingsHtml, /data-exo-writer="removeMotionSignal"/);
    assert.match(settingsHtml, /who can launch this motion/i);
    assert.match(settingsHtml, /No user is assigned to this motion yet\./);
    assert.match(settingsHtml, /Exact Gmail inbox/i);
    assert.match(settingsHtml, /data-exo-writer="assignMotionUser"/);
    assert.match(settingsHtml, /data-exo-fields="accountRef:accountRef\?"/);
    assert.match(settingsHtml, /Delete motion/i);
    assert.match(settingsHtml, /data-exo-writer="deleteMotion"/);
    assert.match(settingsHtml, /Prospects will move into the transition backlog/i);
    assert.ok(settingsHtml.indexOf("Delete motion") < settingsHtml.indexOf('role="tablist"'));
    assert.doesNotMatch(settingsHtml, /Set live/i);
    assert.doesNotMatch(settingsHtml, /data-exo-writer="restartMotion"/);
    assert.match(settingsHtml, new RegExp(`href="\\/motions\\/${motion.id}"`));

    const brief = buildCompanyResearchBrief(company, motion);
    const briefHtml = renderCompanyResearchBriefPage({
      brief,
      packet: { claimState: "claimable", queueStatus: "discovered", workerLabel: null },
      interactive: true,
    });
    assert.match(briefHtml, /COMPANY RESEARCH BRIEF/);
    assert.match(briefHtml, /Back to company/);
    assert.match(briefHtml, /Open queue/);
    assert.match(briefHtml, /Agent queue/);
    assert.match(briefHtml, /Premise/);
    assert.match(briefHtml, /Brief details/);
    assert.match(briefHtml, new RegExp(`href="\\/companies\\/${company.id}"`));
    assert.match(briefHtml, new RegExp(`href="\\/motions\\/${motion.id}"`));
    assert.match(briefHtml, /Start on the company site at https:\/\/backlogco\.example/);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
