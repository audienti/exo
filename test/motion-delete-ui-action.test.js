// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-delete-ui-action-"));
process.env.EXO_STATE_DIR = stateDir;

const { executeActionIntent } = await import("../src/core/execute-action-intent.js");
const {
  findCompanyById,
  findMotionById,
  listInboundObservations,
  listMotions,
} = await import("../src/db/database.js");
const { TRANSITION_MOTION_MARKER_URL } = await import("../src/core/ensure-transition-motion.js");

/**
 * @param {string[]} args
 */
function cliJson(args) {
  return JSON.parse(
    execFileSync("node", [cliPath, ...args, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: stateDir },
      encoding: "utf8",
    }),
  );
}

test("deleteMotion rehomes prospects into transition backlog before removing the motion", async () => {
  const user = cliJson(["users", "add", "--label", "Delete User"]);
  const userWithAccount = cliJson([
    "users",
    "accounts",
    "add",
    user.id,
    "--capability",
    "linkedin",
    "--handle",
    "delete-user",
    "--runtime",
    "codex",
    "--connector",
    "chrome",
    "--preferred",
  ]);
  const account = userWithAccount.accounts.find((item) => item.capability === "linkedin");
  assert.ok(account, "expected linked account for inbound observation setup");

  const motion = cliJson([
    "motion",
    "start",
    "--url",
    "data:text/html,%3Chtml%3E%3Chead%3E%3Ctitle%3EDelete%20Motion%20Fixture%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3Eok%3C%2Fbody%3E%3C%2Fhtml%3E",
    "--premise",
    "This offer matters when operators need governed deletion that does not strand active prospects.",
    "--audience",
    "Operators",
    "--signal",
    "company::Is there recent evidence this branch is only a temporary holding motion?",
  ]).motion;
  const company = cliJson([
    "companies",
    "add",
    "--name",
    "DeleteCo",
    "--domain",
    "deleteco.example",
    "--motion",
    motion.id,
  ]);
  const prospect = cliJson([
    "companies",
    "prospects",
    "add",
    company.id,
    "--motion",
    motion.id,
    "--name",
    "Dana Delete",
    "--title",
    "VP Revenue",
    "--linkedin-profile-url",
    "https://www.linkedin.com/in/dana-delete/",
    "--buying-committee-role",
    "primary_business_owner",
    "--decision-authority",
    "buys",
    "--fit-confidence",
    "high",
    "--why-relevant",
    "Needs to stay governed even if the draft motion disappears.",
  ]).prospects[0];

  cliJson([
    "inbound",
    "observations",
    "add",
    user.id,
    "--account",
    account.id,
    "--surface",
    "linkedin-messaging-inbox",
    "--kind",
    "message_received",
    "--observed-at",
    "2026-06-07T11:20:00.000Z",
    "--summary",
    "Dana Delete replied in LinkedIn messages.",
    "--actor-name",
    "Dana Delete",
    "--actor-profile-url",
    "https://www.linkedin.com/in/dana-delete/",
    "--motion",
    motion.id,
    "--company",
    company.id,
    "--prospect",
    prospect.id,
  ]);

  const result = await executeActionIntent({
    writer: "deleteMotion",
    args: { motionId: motion.id },
  });

  assert.equal(result.ok, true);
  assert.equal(result.writer, "deleteMotion");
  assert.equal(result.redirect, "/motions");
  assert.match(result.message, /Moved 1 prospect into transition backlog/i);

  assert.equal(findMotionById(motion.id), null);
  const transition = listMotions().find((item) => item.offer?.sourceUrl === TRANSITION_MOTION_MARKER_URL) ?? null;
  assert.ok(transition, "transition motion should exist after deleting a motion with prospects");
  assert.ok(
    (transition?.targetMap?.accounts ?? []).some((accountItem) =>
      (accountItem.prospects ?? []).some((prospectItem) => prospectItem.id === prospect.id),
    ),
    "prospect should be present on the transition backlog",
  );

  const updatedCompany = findCompanyById(company.id);
  assert.ok(updatedCompany, "company should still exist");
  assert.equal(updatedCompany?.motionIds.includes(motion.id), false);
  assert.equal(updatedCompany?.motionIds.includes(transition.id), true);

  const updatedObservation = listInboundObservations().find((item) => item.prospectId === prospect.id) ?? null;
  assert.ok(updatedObservation, "linked observation should still exist");
  assert.equal(updatedObservation?.motionId, transition.id);
});
