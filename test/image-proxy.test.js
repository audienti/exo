// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const offerHtml = [
  "<html>",
  "<head>",
  "<title>Image Proxy Motion</title>",
  '<meta name="description" content="Identity-first operator workspace test fixture." />',
  "</head>",
  "<body>ok</body>",
  "</html>"
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
    encoding: "utf8"
  });
}

/**
 * @param {Array<{ items?: unknown[] }>} lanes
 */
function flattenLaneItems(lanes) {
  return lanes.flatMap((lane) => Array.isArray(lane.items) ? lane.items : []);
}

test("companies and prospects store proxied media fields and expose them through motion and workspace reports", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-image-proxy-"));
  const initialLogoSourceUrl = "https://cdn.example.com/chainguard-logo.png";
  const updatedLogoSourceUrl = "https://cdn.example.com/chainguard-logo-v2.png";
  const initialAvatarSourceUrl = "https://cdn.example.com/parm-uppal.png";
  const updatedAvatarSourceUrl = "https://cdn.example.com/parm-uppal-v2.png";
  const expectedUpdatedLogoUrl = `https://imageproxy.bizzbridge.com/200x200/${updatedLogoSourceUrl}`;
  const expectedUpdatedAvatarUrl = `https://imageproxy.bizzbridge.com/200x200/${updatedAvatarSourceUrl}`;

  try {
    const motion = JSON.parse(
      runCli(stateDir, [
        "motion",
        "add",
        "--url",
        offerUrl,
        "--premise",
        "This offer matters when operator views need canonical proxied identity media.",
        "--audience",
        "Revenue operators",
        "--signal",
        "company::Does the account have enough canonical identity stored to support operator views?",
        "--stakeholder-count",
        "1",
        "--json"
      ])
    );

    const user = JSON.parse(runCli(stateDir, ["users", "add", "--label", "Workspace User", "--json"]));

    const company = JSON.parse(
      runCli(stateDir, [
        "companies",
        "add",
        "--name",
        "Chainguard",
        "--domain",
        "chainguard.dev",
        "--website-url",
        "https://www.chainguard.dev",
        "--linkedin-company-url",
        "https://www.linkedin.com/company/chainguard-dev/",
        "--logo-source-url",
        initialLogoSourceUrl,
        "--motion",
        motion.id,
        "--json"
      ])
    );

    const updatedCompany = JSON.parse(
      runCli(stateDir, [
        "companies",
        "update",
        company.id,
        "--logo-source-url",
        updatedLogoSourceUrl,
        "--json"
      ])
    );

    assert.equal(updatedCompany.logoSourceUrl, updatedLogoSourceUrl);
    assert.equal(updatedCompany.logoUrl, expectedUpdatedLogoUrl);

    const prospectResult = JSON.parse(
      runCli(stateDir, [
        "companies",
        "prospects",
        "add",
        company.id,
        "--motion",
        motion.id,
        "--name",
        "Parm Uppal",
        "--title",
        "Chief Revenue Officer",
        "--linkedin-profile-url",
        "https://www.linkedin.com/in/parmuppal",
        "--buying-committee-role",
        "primary_business_owner",
        "--decision-authority",
        "buys",
        "--fit-confidence",
        "high",
        "--why-relevant",
        "Owns the outbound quality bar.",
        "--avatar-source-url",
        initialAvatarSourceUrl,
        "--json"
      ])
    );

    const prospect = prospectResult.prospects[0];
    const updatedProspectResult = JSON.parse(
      runCli(stateDir, [
        "companies",
        "prospects",
        "update",
        company.id,
        "--motion",
        motion.id,
        "--prospect",
        prospect.id,
        "--avatar-source-url",
        updatedAvatarSourceUrl,
        "--json"
      ])
    );

    const updatedProspect = updatedProspectResult.prospect;
    assert.equal(updatedProspect.avatarSourceUrl, updatedAvatarSourceUrl);
    assert.equal(updatedProspect.avatarUrl, expectedUpdatedAvatarUrl);

    const motionReport = JSON.parse(runCli(stateDir, ["report", "motion", motion.id, "--json"]));
    assert.equal(motionReport.targeting.companyLoop.items[0].logoSourceUrl, updatedLogoSourceUrl);
    assert.equal(motionReport.targeting.companyLoop.items[0].logoUrl, expectedUpdatedLogoUrl);
    assert.equal(motionReport.prospects.prospects[0].companyLogoSourceUrl, updatedLogoSourceUrl);
    assert.equal(motionReport.prospects.prospects[0].companyLogoUrl, expectedUpdatedLogoUrl);
    assert.equal(motionReport.prospects.prospects[0].avatarSourceUrl, updatedAvatarSourceUrl);
    assert.equal(motionReport.prospects.prospects[0].avatarUrl, expectedUpdatedAvatarUrl);

    const workspaceReport = JSON.parse(runCli(stateDir, ["report", "workspace", "--user", user.id, "--json"]));
    const workspaceCompanies = flattenLaneItems(workspaceReport.companyLanes);
    const workspaceProspects = flattenLaneItems(workspaceReport.engagementLanes);
    assert.equal(workspaceCompanies[0].logoSourceUrl, updatedLogoSourceUrl);
    assert.equal(workspaceCompanies[0].logoUrl, expectedUpdatedLogoUrl);
    assert.equal(workspaceProspects[0].companyLogoUrl, expectedUpdatedLogoUrl);
    assert.equal(workspaceProspects[0].avatarUrl, expectedUpdatedAvatarUrl);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("motion discover and person-first seed proxy canonical company logos and prospect avatars on creation", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-image-proxy-seed-"));
  const discoveredLogoSourceUrl = "https://cdn.example.com/discovered-company-logo.png";
  const seededLogoSourceUrl = "https://cdn.example.com/seeded-company-logo.png";
  const seededAvatarSourceUrl = "https://cdn.example.com/seeded-prospect-avatar.png";
  const expectedDiscoveredLogoUrl = `https://imageproxy.bizzbridge.com/200x200/${discoveredLogoSourceUrl}`;
  const expectedSeededLogoUrl = `https://imageproxy.bizzbridge.com/200x200/${seededLogoSourceUrl}`;
  const expectedSeededAvatarUrl = `https://imageproxy.bizzbridge.com/200x200/${seededAvatarSourceUrl}`;

  try {
    const motion = JSON.parse(
      runCli(stateDir, [
        "motion",
        "add",
        "--url",
        offerUrl,
        "--premise",
        "This offer matters when seeded targets need image-backed identity on day one.",
        "--audience",
        "Outbound operators",
        "--signal",
        "company::Is there enough identity stored to orient the operator immediately?",
        "--stakeholder-count",
        "1",
        "--json"
      ])
    );

    const discovery = JSON.parse(
      runCli(stateDir, [
        "motion",
        "discover",
        motion.id,
        "--name",
        "Vanta",
        "--domain",
        "vanta.com",
        "--website-url",
        "https://www.vanta.com",
        "--linkedin-company-url",
        "https://www.linkedin.com/company/vanta-compliance/",
        "--logo-source-url",
        discoveredLogoSourceUrl,
        "--json"
      ])
    );

    assert.equal(discovery.company.logoSourceUrl, discoveredLogoSourceUrl);
    assert.equal(discovery.company.logoUrl, expectedDiscoveredLogoUrl);

    const seedResult = JSON.parse(
      runCli(stateDir, [
        "motion",
        "seed",
        motion.id,
        "--company-name",
        "Wiz",
        "--domain",
        "wiz.io",
        "--website-url",
        "https://www.wiz.io",
        "--linkedin-company-url",
        "https://www.linkedin.com/company/wizsecurity/",
        "--logo-source-url",
        seededLogoSourceUrl,
        "--person-name",
        "Avery Stone",
        "--person-title",
        "Chief Information Security Officer",
        "--why-relevant",
        "Owns the security platform change surface.",
        "--linkedin-profile-url",
        "https://www.linkedin.com/in/avery-stone",
        "--avatar-source-url",
        seededAvatarSourceUrl,
        "--json"
      ])
    );

    assert.equal(seedResult.company.logoSourceUrl, seededLogoSourceUrl);
    assert.equal(seedResult.company.logoUrl, expectedSeededLogoUrl);
    assert.equal(seedResult.account.companyLogoSourceUrl, seededLogoSourceUrl);
    assert.equal(seedResult.account.companyLogoUrl, expectedSeededLogoUrl);
    assert.equal(seedResult.prospect.avatarSourceUrl, seededAvatarSourceUrl);
    assert.equal(seedResult.prospect.avatarUrl, expectedSeededAvatarUrl);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
