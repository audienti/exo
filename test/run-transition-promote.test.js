// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { addUser } from "../src/core/add-user.js";
import { insertUser, updateUser, upsertInboundObservation } from "../src/db/database.js";
import { runTransitionPromote } from "../src/core/run-transition-promote.js";

function buildObservation(overrides = {}) {
  return {
    id: "obs-email-promote",
    dedupeKey: "obs-email-promote",
    userId: "user-1",
    accountId: "account-1",
    capability: "gmail",
    platform: "gmail",
    surfaceKey: "gmail-inbox-threads",
    kind: "email_thread_updated",
    truthLevel: "authoritative",
    observedAt: "2026-06-12T11:56:11.000Z",
    recordedAt: "2026-06-12T11:56:11.000Z",
    eventAt: null,
    externalId: "thread-email-promote",
    actorName: "Matt M",
    actorTitle: null,
    actorCompanyName: null,
    actorHandle: "matthew@coldcrafthqlabs.com",
    actorProfileUrl: null,
    actorLinkedinPublicId: null,
    actorLinkedinMemberId: null,
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: "https://mail.google.com/mail/#all/thread-email-promote",
    sourceUrl: "https://mail.google.com/mail/#all/thread-email-promote",
    subject: "William, want 20?",
    summary: "Matt offered to send a free sample list of 20 verified ICP contacts.",
    motionId: null,
    companyId: null,
    prospectId: null,
    personId: null,
    providerSharedSecret: null,
    notes: null,
    messages: [
      {
        id: "msg-1",
        direction: "inbound",
        sentAt: "2026-06-12T11:56:11.000Z",
        fromName: "Matt M",
        fromHandle: "matthew@coldcrafthqlabs.com",
        body: "Mind if I send the sample?",
      },
    ],
    ...overrides,
  };
}

test("runTransitionPromote blocks email-only inbound people until LinkedIn is resolved", async () => {
  await withIsolatedExoState(async () => {
    const rawUser = addUser({ label: "Operator", owner: "operator" });
    insertUser({
      ...rawUser,
      id: "user-1",
    });
    updateUser({
      ...rawUser,
      id: "user-1",
      accounts: [
        {
          id: "account-linkedin-1",
          createdAt: "2026-06-12T11:00:00.000Z",
          updatedAt: "2026-06-12T11:00:00.000Z",
          capability: "linkedin",
          handle: "operator-linkedin",
          label: null,
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "harness-unipile-1",
          providerAccountId: "provider-linkedin-1",
          preferred: true,
          notes: null,
          inboundSync: {
            surfaces: [],
          },
        },
      ],
      harnessConnections: [
        {
          id: "harness-unipile-1",
          createdAt: "2026-06-12T11:00:00.000Z",
          updatedAt: "2026-06-12T11:00:00.000Z",
          runtime: "codex",
          connector: "unipile",
          label: null,
          status: "available",
          notes: null,
        },
      ],
    });
    upsertInboundObservation(buildObservation());

    await assert.rejects(
      () => runTransitionPromote({ observationId: "obs-email-promote" }),
      /resolving Matt M's LinkedIn identity in background/i,
    );
  });
});

/**
 * @template T
 * @param {() => Promise<T> | T} callback
 * @returns {Promise<T>}
 */
async function withIsolatedExoState(callback) {
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-run-transition-promote-"));
  process.env.EXO_STATE_DIR = stateDir;
  delete process.env.EXO_HOME_STATE_DIR;

  try {
    return await callback();
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir === undefined) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}
