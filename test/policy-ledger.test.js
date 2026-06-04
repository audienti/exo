// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendPolicyEvent,
  compileEffectivePolicy,
  listPolicyEvents,
} from "../src/core/policy-ledger.js";

test("policy ledger appends and reads global and local events in file order", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-policy-ledger-"));
  const statePaths = {
    localStateDir: path.join(tempDir, "local-state"),
    homeStateDir: path.join(tempDir, "home-state"),
    layered: true,
    singleStore: false,
    repoPolicyPath: path.join(tempDir, "repo", "exo-policy.jsonl"),
    homePolicyPath: path.join(tempDir, "home-state", "policy.jsonl"),
  };

  const first = appendPolicyEvent("global", {
    kind: "ignore_identity",
    reason: "Ignore this sender globally.",
    person: {
      actorHandle: "person@example.com",
    },
  }, { statePaths });
  const second = appendPolicyEvent("local", {
    kind: "hide_surface",
    reason: "Hide received invites in this project.",
    surface: {
      capability: "linkedin",
      surfaceKey: "linkedin-received-invitations",
    },
  }, { statePaths });

  const globalEvents = listPolicyEvents("global", { statePaths });
  const localEvents = listPolicyEvents("local", { statePaths });

  assert.equal(globalEvents.length, 1);
  assert.equal(localEvents.length, 1);
  assert.equal(globalEvents[0].id, first.id);
  assert.equal(localEvents[0].id, second.id);
  assert.equal(fs.readFileSync(statePaths.homePolicyPath, "utf8").trim().split("\n").length, 1);
  assert.equal(fs.readFileSync(statePaths.repoPolicyPath, "utf8").trim().split("\n").length, 1);
});

test("compileEffectivePolicy applies local reversal events without clearing global rules", () => {
  const effective = compileEffectivePolicy({
    globalEvents: [
      {
        id: "global-ignore",
        createdAt: "2026-06-04T18:00:00.000Z",
        kind: "ignore_identity",
        reason: "Ignore globally.",
        account: null,
        person: { actorHandle: "person@example.com" },
        surface: null,
      },
    ],
    localEvents: [
      {
        id: "local-hide",
        createdAt: "2026-06-04T18:01:00.000Z",
        kind: "hide_surface",
        reason: "Hide one surface in this project.",
        account: null,
        person: null,
        surface: {
          capability: "linkedin",
          surfaceKey: "linkedin-received-invitations",
        },
      },
      {
        id: "local-show",
        createdAt: "2026-06-04T18:02:00.000Z",
        kind: "show_surface",
        reason: "Show it again locally.",
        account: null,
        person: null,
        surface: {
          capability: "linkedin",
          surfaceKey: "linkedin-received-invitations",
        },
      },
    ],
  });

  assert.equal(effective.global.ignoredIdentities.length, 1);
  assert.equal(effective.local.hiddenSurfaces.length, 0);
  assert.equal(effective.counts.eventCount, 3);
});
