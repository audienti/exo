// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

test("report connections itemizes follower and following observations that were already written back", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-report-connections-"));
  const followersPayloadPath = path.join(tempDir, "followers.json");
  const followingPayloadPath = path.join(tempDir, "following.json");

  try {
    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "connections-user", "--owner", "William", "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      })
    );

    const updatedUser = JSON.parse(
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
          "connections-user",
          "--runtime",
          "codex",
          "--connector",
          "unipile",
          "--preferred",
          "--json",
        ],
        {
          cwd: tempDir,
          encoding: "utf8",
        }
      )
    );
    const linkedinAccount = updatedUser.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount, "expected a governed LinkedIn account");

    fs.writeFileSync(followersPayloadPath, JSON.stringify({
      mode: "full",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-followers-list",
              status: "success",
              observedAt: "2026-05-31T15:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "full",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              observations: [
                {
                  kind: "follower_confirmed",
                  externalId: "follower-1",
                  observedAt: "2026-05-31T15:00:00.000Z",
                  actorName: "Grace Follower",
                  actorProfileUrl: "https://www.linkedin.com/in/grace-follower/",
                  summary: "Grace Follower currently follows this profile.",
                },
              ],
            },
          ],
        },
      ],
    }, null, 2));

    fs.writeFileSync(followingPayloadPath, JSON.stringify({
      mode: "quick",
      accounts: [
        {
          accountId: linkedinAccount.id,
          surfaces: [
            {
              surfaceKey: "linkedin-following-list",
              status: "success",
              observedAt: "2026-05-31T15:00:00.000Z",
              itemCount: 1,
              visibleTotalCount: 1,
              captureCompleteness: "complete",
              requestedMode: "quick",
              actualMode: "full",
              reconcileRequired: false,
              reconcileReason: null,
              observations: [
                {
                  kind: "follow_state_confirmed",
                  externalId: "following-1",
                  observedAt: "2026-05-31T15:00:00.000Z",
                  actorName: "Harper Followed",
                  actorProfileUrl: "https://www.linkedin.com/in/harper-followed/",
                  summary: "Harper Followed is currently on the live following list.",
                },
              ],
            },
          ],
        },
      ],
    }, null, 2));

    execFileSync("node", [cliPath, "inbound", "sync", "run", user.id, "--input", followersPayloadPath, "--json"], {
      cwd: tempDir,
      encoding: "utf8",
    });
    execFileSync("node", [cliPath, "inbound", "sync", "run", user.id, "--input", followingPayloadPath, "--json"], {
      cwd: tempDir,
      encoding: "utf8",
    });

    const report = JSON.parse(
      execFileSync("node", [cliPath, "report", "connections", "--user", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      })
    );

    const followersTab = report.tabs.find((tab) => tab.key === "followers");
    const followingTab = report.tabs.find((tab) => tab.key === "following");

    assert.ok(followersTab);
    assert.ok(followingTab);
    assert.equal(followersTab.count, 1);
    assert.equal(followersTab.people[0].name, "Grace Follower");
    assert.equal(followingTab.count, 1);
    assert.equal(followingTab.people[0].name, "Harper Followed");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
