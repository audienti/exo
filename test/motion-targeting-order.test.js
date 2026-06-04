// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const offerHtml = [
  "<html>",
  "<head>",
  "<title>Actico Risk Platform</title>",
  '<meta name="description" content="Credit and risk decisioning for regulated lenders." />',
  "</head>",
  "<body>ok</body>",
  "</html>"
].join("");
const offerUrl = `data:text/html,${encodeURIComponent(offerHtml)}`;

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
 */
function setupReadyChromeProfile(tempDir) {
  const userDataDir = path.join(tempDir, "Chrome");
  const profileDirectory = "Profile 4";
  const profilePath = path.join(userDataDir, profileDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(browserCommand, 0o755);
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: { name: "LinkedIn Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: "LinkedIn Main" } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  return {
    userDataDir,
    profileDirectory,
    browserCommand
  };
}

test("motion targeting prioritizes company research before cadence when stages are mixed", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-targeting-stage-order-"));
  const chrome = setupReadyChromeProfile(tempDir);

  try {
    const profile = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "add",
          "--browser",
          "chrome",
          "--label",
          "planner-profile",
          "--user-data-dir",
          chrome.userDataDir,
          "--profile-directory",
          chrome.profileDirectory,
          "--browser-command",
          chrome.browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    execFileSync(
      "node",
      [
        cliPath,
        "profiles",
        "claim",
        profile.id,
        "--label",
        "planner-main",
        "--workspace",
        "planner",
        "--account",
        "linkedin:planner@example.com",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const user = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "add",
          "--label",
          "operator-main",
          "--owner",
          "operator",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    execFileSync(
      "node",
      [
        cliPath,
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "planner@example.com",
        "--profile",
        profile.id,
        "--preferred",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--premise",
          "This offer matters when procurement and vendor-management leaders need better vendor accountability.",
          "--audience",
          "Procurement and vendor-management leaders",
          "--signal",
          "company::Is there recent evidence that this company is under vendor-cost or renewal pressure?",
          "--title",
          "Director",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const sixsense = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "6sense",
          "--domain",
          "6sense.com",
          "--website-url",
          "https://6sense.com",
          "--linkedin-company-url",
          "https://www.linkedin.com/company/6sense/",
          "--motion",
          motion.id,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    for (const company of [
      {
        name: "Acadia Pharmaceuticals",
        domain: "acadia.com",
        websiteUrl: "https://acadia.com",
        linkedinCompanyUrl: "https://www.linkedin.com/company/acadia-pharmaceuticals/"
      },
      {
        name: "Cornerstone OnDemand",
        domain: "cornerstoneondemand.com",
        websiteUrl: "https://www.cornerstoneondemand.com/company/",
        linkedinCompanyUrl: "https://www.linkedin.com/company/cornerstoneondemand/"
      }
    ]) {
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          company.name,
          "--domain",
          company.domain,
          "--website-url",
          company.websiteUrl,
          "--linkedin-company-url",
          company.linkedinCompanyUrl,
          "--motion",
          motion.id,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      );
    }

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "signal-matches",
        "add",
        sixsense.id,
        "--motion",
        motion.id,
        "--signal",
        motion.signals[0].id,
        "--summary",
        "Procurement ownership is already explicit, but the motion still needs more researched accounts.",
        "--source-url",
        "https://example.com/6sense",
        "--observed-at",
        "2026-05-20T00:00:00.000Z",
        "--confidence",
        "high",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    for (const prospect of [
      {
        name: "Bill Browning",
        title: "Director Of Procurement",
        whyRelevant: "Primary owner for vendor negotiations and procurement accountability."
      },
      {
        name: "Jeff Burrows",
        title: "Director, Security Assurance",
        whyRelevant: "Adjacent vendor-risk and assurance owner."
      }
    ]) {
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "add",
          sixsense.id,
          "--motion",
          motion.id,
          "--name",
          prospect.name,
          "--title",
          prospect.title,
          "--why-relevant",
          prospect.whyRelevant,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      );
    }

    const targeting = JSON.parse(
      execFileSync("node", [cliPath, "motion", "target", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(targeting.overallStage, "needs-company-research");
    assert.equal(targeting.companyLoop.companyCount, 3);
    assert.equal(targeting.queue.companyCount, 3);
    assert.equal(targeting.queue.prospectCount, 2);
    assert.equal(targeting.inventoryTarget.minimumAvailableProspects, 25);
    assert.equal(targeting.inventoryTarget.availableProspectCount, 2);
    assert.equal(targeting.inventoryTarget.shortfall, 23);
    assert.match(targeting.nextActions[0], /at least 25 available prospects/i);
    assert.match(targeting.nextActions[0], /start with the research backlog on acadia pharmaceuticals and cornerstone ondemand/i);
    assert.match(targeting.nextActions[1], /run the company research loop for Acadia Pharmaceuticals/i);
    assert.match(targeting.nextActions[2], /run the company research loop for Cornerstone OnDemand/i);
    assert.match(targeting.nextActions[3], /complete the remaining prospect cadence state for 6sense/i);

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
