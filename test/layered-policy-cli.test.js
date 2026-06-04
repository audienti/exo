// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildNodeTestEnv } from "../scripts/node-test-runtime.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const { executeActionIntent } = await import("../src/core/execute-action-intent.js");

/**
 * @param {string[]} args
 * @param {{ cwd: string, env: Record<string, string> }} runtime
 */
function cli(args, runtime) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: runtime.cwd,
    env: buildNodeTestEnv(runtime.env),
    encoding: "utf8",
  });
}

/**
 * @param {string[]} args
 * @param {{ cwd: string, env: Record<string, string> }} runtime
 */
function cliJson(args, runtime) {
  return JSON.parse(cli([...args, "--json"], runtime));
}

/**
 * @param {Record<string, string>} env
 * @param {() => Promise<any>} fn
 */
async function withProcessEnv(env, fn) {
  const previous = {
    EXO_STATE_DIR: process.env.EXO_STATE_DIR,
    EXO_HOME_STATE_DIR: process.env.EXO_HOME_STATE_DIR,
  };

  process.env.EXO_STATE_DIR = env.EXO_STATE_DIR;
  process.env.EXO_HOME_STATE_DIR = env.EXO_HOME_STATE_DIR;
  try {
    return await fn();
  } finally {
    if (previous.EXO_STATE_DIR == null) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previous.EXO_STATE_DIR;
    }

    if (previous.EXO_HOME_STATE_DIR == null) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previous.EXO_HOME_STATE_DIR;
    }
  }
}

test("exo policy add/list persists global and local overlays in the layered paths", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-layered-policy-cli-"));
  const homeStateDir = path.join(tempRoot, "home-state");
  const projectDir = path.join(tempRoot, "project-a");
  const localStateDir = path.join(projectDir, ".exo");
  fs.mkdirSync(projectDir, { recursive: true });

  const runtime = {
    cwd: projectDir,
    env: {
      ...process.env,
      EXO_STATE_DIR: localStateDir,
      EXO_HOME_STATE_DIR: homeStateDir,
    },
  };

  try {
    const globalResult = cliJson([
      "policy",
      "add",
      "--scope", "global",
      "--kind", "ignore_identity",
      "--actor-handle", "person@example.com",
      "--reason", "Never show this sender again.",
    ], runtime);
    const localResult = cliJson([
      "policy",
      "add",
      "--scope", "local",
      "--kind", "hide_surface",
      "--capability", "linkedin",
      "--surface", "linkedin-received-invitations",
      "--reason", "Hide inbound invites in this repo.",
    ], runtime);
    const effective = cliJson([
      "policy",
      "list",
      "--scope", "effective",
    ], runtime);

    assert.equal(globalResult.event.kind, "ignore_identity");
    assert.equal(localResult.event.kind, "hide_surface");
    assert.equal(effective.events.length, 2);
    assert.equal(effective.effective.global.ignoredIdentities.length, 1);
    assert.equal(effective.effective.effective.hiddenSurfaces.length, 1);
    assert.equal(fs.existsSync(path.join(homeStateDir, "policy.jsonl")), true);
    assert.equal(fs.existsSync(path.join(projectDir, "exo-policy.jsonl")), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("a global ignore written in one layered project hides the same inbound person in another project review", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-layered-ignore-"));
  const homeStateDir = path.join(tempRoot, "home-state");
  const projectADir = path.join(tempRoot, "project-a");
  const projectBDir = path.join(tempRoot, "project-b");
  const runtimeA = {
    cwd: projectADir,
    env: {
      ...process.env,
      EXO_STATE_DIR: path.join(projectADir, ".exo"),
      EXO_HOME_STATE_DIR: homeStateDir,
    },
  };
  const runtimeB = {
    cwd: projectBDir,
    env: {
      ...process.env,
      EXO_STATE_DIR: path.join(projectBDir, ".exo"),
      EXO_HOME_STATE_DIR: homeStateDir,
    },
  };

  fs.mkdirSync(projectADir, { recursive: true });
  fs.mkdirSync(projectBDir, { recursive: true });

  try {
    const user = cliJson(["users", "add", "--label", "layered-user", "--owner", "Operator"], runtimeA);
    const userWithAccount = cliJson([
      "users", "accounts", "add", user.id,
      "--capability", "linkedin",
      "--handle", "operator-linkedin",
      "--runtime", "codex",
      "--connector", "chrome",
      "--preferred",
    ], runtimeA);
    const linkedinAccount = userWithAccount.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount, "linkedin account exists");

    const observation = cliJson([
      "inbound", "observations", "add", user.id,
      "--account", linkedinAccount.id,
      "--surface", "linkedin-received-invitations",
      "--kind", "connection_request_received",
      "--observed-at", "2026-06-04T18:20:00.000Z",
      "--summary", "Alicia Buyer sent a new invite.",
      "--external-id", "invite-1",
      "--actor-name", "Alicia Buyer",
      "--actor-handle", "alicia@buyer.example",
      "--actor-profile-url", "https://www.linkedin.com/in/alicia-buyer/",
      "--actor-linkedin-public-id", "alicia-buyer",
      "--actor-linkedin-member-id", "489864114",
      "--thread-url", "https://www.linkedin.com/messaging/thread/1",
    ], runtimeA).observation;

    const beforeIgnore = cliJson(["inbound", "review", user.id], runtimeB);
    assert.equal(beforeIgnore.counts.reviewItemCount, 1);

    await withProcessEnv(runtimeA.env, async () => {
      const result = await executeActionIntent({
        writer: "ignoreInboundObservation",
        args: {
          observationId: observation.id,
        },
      });
      assert.equal(result.ok, true);
    });

    const afterIgnore = cliJson(["inbound", "review", user.id], runtimeB);
    assert.equal(afterIgnore.counts.reviewItemCount, 0);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
