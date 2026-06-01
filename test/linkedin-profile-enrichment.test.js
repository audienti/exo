// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildBizBridgeImageProxyUrl } from "../src/lib/image-proxy.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

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

test("companies prospects enrich-linkedin-profile stores one governed profile snapshot, recent posts, and promoted live-signal context", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-linkedin-profile-enrichment-"));

  try {
    const motion = JSON.parse(runCli(tempDir, [
      "motion",
      "add",
      "--url",
      "https://example.com/credit-risk-kernel",
      "--premise",
      "This offer matters when credit-risk operators are widening live decisioning and merchant complexity.",
      "--audience",
      "Risk leaders",
      "--signal",
      "company::Is there recent evidence that the company widened credit, merchant, or GTM surface area?",
      "--json"
    ]));

    const company = JSON.parse(runCli(tempDir, [
      "companies",
      "add",
      "--name",
      "BillEase",
      "--domain",
      "billease.ph",
      "--website-url",
      "https://billease.ph",
      "--motion",
      motion.id,
      "--json"
    ]));

    const prospectResult = JSON.parse(runCli(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Minh Le",
      "--title",
      "Head of Risk",
      "--why-relevant",
      "Primary operator for lending controls and decisioning quality.",
      "--json"
    ]));

    const prospectId = prospectResult.prospects[0].id;
    const payloadPath = path.join(tempDir, "linkedin-profile.json");
    fs.writeFileSync(payloadPath, JSON.stringify({
      capturedAt: "2026-05-31T12:53:34.000Z",
      profileUrl: "https://www.linkedin.com/in/minh-le-risk/",
      publicId: "minh-le-risk",
      memberId: "489864114",
      displayName: "Minh Le",
      currentRoleTitle: "Head of Risk",
      currentCompanyName: "BillEase",
      headline: "Head of Risk at BillEase",
      location: "Metro Manila, Philippines",
      about: "Risk leader focused on portfolio quality, credit controls, and lending operations.",
      followerCount: 1823,
      connectionCount: 500,
      avatarSourceUrl: "https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example",
      recentPosts: [
        {
          activityType: "own-post",
          url: "https://www.linkedin.com/posts/minh-le-risk_credit-controls-growth-activity-7300000000000000000-example",
          postedAt: "2026-05-24T14:00:00.000Z",
          summary: "Posted about tightening credit controls while merchant acceptance expands.",
          snippet: "As merchant reach widens, control discipline has to get sharper, not looser."
        },
        {
          activityType: "comment",
          url: "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001/",
          postedAt: "2026-05-18T14:00:00.000Z",
          summary: "Commented on the need for better risk instrumentation during growth.",
          snippet: "Growth only helps if the instrumentation keeps pace with exposure."
        }
      ]
    }, null, 2));

    const enriched = JSON.parse(runCli(tempDir, [
      "companies",
      "prospects",
      "enrich-linkedin-profile",
      company.id,
      "--motion",
      motion.id,
      "--prospect",
      prospectId,
      "--input",
      payloadPath,
      "--json"
    ]));

    assert.equal(enriched.prospect.id, prospectId);
    assert.equal(enriched.prospect.linkedinProfileUrl, "https://www.linkedin.com/in/minh-le-risk/");
    assert.equal(enriched.prospect.avatarSourceUrl, "https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example");
    assert.equal(
      enriched.prospect.avatarUrl,
      buildBizBridgeImageProxyUrl("https://media.licdn.com/dms/image/v2/D5603AQFMinhExample/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1710000000000?e=1753920000&v=beta&t=example")
    );
    assert.equal(enriched.prospect.identityTells.headline, "Head of Risk at BillEase");
    assert.equal(enriched.prospect.linkedinProfileSnapshot.displayName, "Minh Le");
    assert.equal(enriched.prospect.linkedinProfileSnapshot.currentCompanyName, "BillEase");
    assert.equal(enriched.prospect.linkedinProfileSnapshot.recentPosts.length, 2);
    assert.equal(enriched.prospect.liveSignal.channel, "linkedin");
    assert.equal(enriched.prospect.liveSignal.activityType, "own-post");
    assert.equal(enriched.prospect.liveSignal.url, "https://www.linkedin.com/posts/minh-le-risk_credit-controls-growth-activity-7300000000000000000-example");
    assert.equal(enriched.prospect.liveSignal.freshnessBand, "0-14-days");
    assert.ok(
      enriched.prospect.contactPoints.some((point) => point.kind === "linkedin_public_id" && point.value === "minh-le-risk")
    );
    assert.ok(
      enriched.prospect.contactPoints.some((point) => point.kind === "linkedin_member_id" && point.value === "489864114")
    );

    const motionProspects = JSON.parse(runCli(tempDir, [
      "motion",
      "prospects",
      motion.id,
      "--prospect",
      prospectId,
      "--json"
    ]));

    assert.equal(motionProspects.prospect.linkedinProfileSnapshot.about, "Risk leader focused on portfolio quality, credit controls, and lending operations.");
    assert.equal(motionProspects.prospect.linkedinProfileSnapshot.recentPosts[0].summary, "Posted about tightening credit controls while merchant acceptance expands.");
    assert.equal(motionProspects.writingBrief.prospect.linkedinProfileSnapshot.currentCompanyName, "BillEase");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
