// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { offerUrl, runCliJson, runCliText } from "./support/live-runtime.js";

test("unscoped inbound observations do not auto-bind to a matching local prospect", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-no-implicit-bind-"));

  try {
    const motion = runCliJson(tempDir, [
      "motion",
      "add",
      "--url",
      offerUrl,
      "--premise",
      "This offer matters when global inbound must not auto-attach to the current folder.",
      "--audience",
      "Revenue leaders",
      "--signal",
      "company::Does the current GTM path need strict inbound claim boundaries?",
      "--json",
    ]);
    const company = runCliJson(tempDir, [
      "companies",
      "add",
      "--name",
      "Claim Boundary Co",
      "--domain",
      "claim-boundary.example",
      "--motion",
      motion.id,
      "--json",
    ]);
    runCliJson(tempDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Paula Prospect",
      "--title",
      "VP Revenue",
      "--linkedin-profile-url",
      "https://www.linkedin.com/in/paula-prospect/",
      "--why-relevant",
      "Already tracked in the local motion.",
      "--json",
    ]);
    const user = runCliJson(tempDir, ["users", "add", "--label", "claim-user", "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "claim-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--preferred",
      "--json",
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const added = runCliJson(tempDir, [
      "inbound",
      "observations",
      "add",
      user.id,
      "--account",
      linkedinAccountId,
      "--surface",
      "linkedin-received-invitations",
      "--kind",
      "connection_request_received",
      "--observed-at",
      "2026-06-05T12:00:00.000Z",
      "--summary",
      "Paula Prospect sent an inbound invite.",
      "--external-id",
      "invite-paula-1",
      "--actor-name",
      "Paula Prospect",
      "--actor-profile-url",
      "https://www.linkedin.com/in/paula-prospect/",
      "--actor-linkedin-public-id",
      "paula-prospect",
      "--actor-linkedin-member-id",
      "member-paula",
      "--json",
    ]);

    assert.equal(added.observation.motionId, null);
    assert.equal(added.observation.companyId, null);
    assert.equal(added.observation.prospectId, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("once a workspace claims an inbound person, future observations for that identity inherit the same local context", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sticky-claim-"));

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "sticky-user", "--owner", "william", "--json"]);
    const withLinkedin = runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "sticky-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--preferred",
      "--json",
    ]);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const first = runCliJson(tempDir, [
      "inbound",
      "observations",
      "add",
      user.id,
      "--account",
      linkedinAccountId,
      "--surface",
      "linkedin-received-invitations",
      "--kind",
      "connection_request_received",
      "--observed-at",
      "2026-06-05T12:00:00.000Z",
      "--summary",
      "Rita Sticky sent an inbound invite.",
      "--external-id",
      "invite-rita-1",
      "--actor-name",
      "Rita Sticky",
      "--actor-company",
      "Sticky Systems",
      "--actor-profile-url",
      "https://www.linkedin.com/in/rita-sticky/",
      "--actor-linkedin-public-id",
      "rita-sticky",
      "--actor-linkedin-member-id",
      "member-rita",
      "--json",
    ]).observation;

    runCliJson(tempDir, ["transition", "promote", first.id, "--user", user.id, "--json"]);

    const afterClaim = runCliJson(tempDir, ["inbound", "observations", "list", user.id, "--json"]).observations;
    const claimedInvite = afterClaim.find((observation) => observation.id === first.id);
    assert.ok(claimedInvite?.motionId);
    assert.ok(claimedInvite?.companyId);
    assert.ok(claimedInvite?.prospectId);

    const second = runCliJson(tempDir, [
      "inbound",
      "observations",
      "add",
      user.id,
      "--account",
      linkedinAccountId,
      "--surface",
      "linkedin-messaging-inbox",
      "--kind",
      "message_received",
      "--observed-at",
      "2026-06-05T12:10:00.000Z",
      "--summary",
      "Rita Sticky sent a new LinkedIn message.",
      "--external-id",
      "thread-rita-1",
      "--actor-name",
      "Rita Sticky",
      "--actor-company",
      "Sticky Systems",
      "--actor-profile-url",
      "https://www.linkedin.com/in/rita-sticky/",
      "--actor-linkedin-public-id",
      "rita-sticky",
      "--actor-linkedin-member-id",
      "member-rita",
      "--thread-url",
      "https://www.linkedin.com/messaging/thread/rita-1/",
      "--json",
    ]).observation;

    assert.equal(second.motionId, claimedInvite.motionId);
    assert.equal(second.companyId, claimedInvite.companyId);
    assert.equal(second.prospectId, claimedInvite.prospectId);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("a second layered workspace sees claimed inbound as foreign and cannot promote it again", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-layered-inbound-claim-"));
  const homeStateDir = path.join(tempRoot, "home-state");
  const projectADir = path.join(tempRoot, "project-a");
  const projectBDir = path.join(tempRoot, "project-b");
  const projectAEnv = {
    EXO_STATE_DIR: path.join(projectADir, ".exo"),
    EXO_HOME_STATE_DIR: homeStateDir,
  };
  const projectBEnv = {
    EXO_STATE_DIR: path.join(projectBDir, ".exo"),
    EXO_HOME_STATE_DIR: homeStateDir,
  };
  fs.mkdirSync(projectADir, { recursive: true });
  fs.mkdirSync(projectBDir, { recursive: true });

  try {
    const user = runCliJson(projectADir, ["users", "add", "--label", "layered-claim-user", "--owner", "william", "--json"], projectAEnv);
    const withLinkedin = runCliJson(projectADir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "layered-claim-user",
      "--runtime",
      "codex",
      "--connector",
      "chrome",
      "--preferred",
      "--json",
    ], projectAEnv);
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const observation = runCliJson(projectADir, [
      "inbound",
      "observations",
      "add",
      user.id,
      "--account",
      linkedinAccountId,
      "--surface",
      "linkedin-received-invitations",
      "--kind",
      "connection_request_received",
      "--observed-at",
      "2026-06-05T12:00:00.000Z",
      "--summary",
      "Nadia Layered sent an inbound invite.",
      "--external-id",
      "invite-nadia-1",
      "--actor-name",
      "Nadia Layered",
      "--actor-company",
      "Layered Systems",
      "--actor-profile-url",
      "https://www.linkedin.com/in/nadia-layered/",
      "--actor-linkedin-public-id",
      "nadia-layered",
      "--actor-linkedin-member-id",
      "member-nadia",
      "--json",
    ], projectAEnv).observation;

    runCliJson(projectADir, ["transition", "promote", observation.id, "--user", user.id, "--json"], projectAEnv);

    const reviewFromB = runCliJson(projectBDir, ["inbound", "review", user.id, "--json"], projectBEnv);
    assert.equal(reviewFromB.reviewItems.length, 1);
    assert.equal(reviewFromB.reviewItems[0].state, "claimed_elsewhere");
    assert.equal(reviewFromB.counts.decisionItemCount, 0);

    assert.throws(
      () => runCliText(projectBDir, ["transition", "promote", observation.id, "--user", user.id, "--json"], projectBEnv),
      /already claimed in another workspace/i,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
