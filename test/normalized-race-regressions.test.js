// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  findCompanyById,
  findMotionAccountByMotionAndCompany,
  findMotionById,
  findOrCreateCompany,
  getLocalDatabase,
  insertUser,
  listActivityEvents,
  listDueProspectBranches,
  resolvePersonIdentity,
  setProspectDisposition,
  upsertEmployment,
  upsertMotionAccount,
  upsertProspect,
} from "../src/db/database.js";
import {
  buildCompanyView,
  buildExecutionUser,
  buildProspect,
  buildTargetAccount,
  seedMotionView,
  withIsolatedExoState,
} from "./support/normalized-fixtures.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const dbModuleUrl = pathToFileURL(path.join(repoRoot, "src", "db", "database.js")).href;
const accountClaimModuleUrl = pathToFileURL(path.join(repoRoot, "src", "core", "claim-target-account-packet.js")).href;
const draftModuleUrl = pathToFileURL(path.join(repoRoot, "src", "core", "set-prospect-draft.js")).href;
const touchModuleUrl = pathToFileURL(path.join(repoRoot, "src", "core", "record-prospect-touch.js")).href;

test("concurrent draft and touch writes on the same normalized motion both persist", async () => {
  await withIsolatedExoState(async ({ stateDir }) => {
    const motion = seedMotionView({
      id: "motion-concurrent-write",
      name: "concurrent-write-motion",
      offer: { sourceUrl: "https://example.com/concurrent-write" },
      targetMap: {
        status: "ready",
        accounts: [
          buildTargetAccount({
            companyId: "company-concurrent-write",
            companyName: "Concurrent Write Co",
            domain: "concurrent-write.example",
            websiteUrl: "https://concurrent-write.example",
            prospects: [
              buildProspect({
                id: "prospect-concurrent-write",
                name: "Dana Durable",
                title: "VP Revenue",
                linkedinProfileUrl: "https://www.linkedin.com/in/dana-durable/",
                sourceUrl: "https://www.linkedin.com/in/dana-durable/",
                whyRelevant: "Exercises concurrent draft and touch writes.",
              }),
            ],
          }),
        ],
      },
    });
    const company = buildCompanyView(findCompanyById("company-concurrent-write"), { motionIds: [motion.id] });

    await Promise.all([
      runNodeModule(stateDir, `
        import { findCompanyById, findMotionById } from ${JSON.stringify(dbModuleUrl)};
        import { setMotionProspectDraft } from ${JSON.stringify(draftModuleUrl)};
        const motion = findMotionById(${JSON.stringify(motion.id)});
        const company = ${JSON.stringify(company)};
        setMotionProspectDraft(motion, company, {
          prospectId: "prospect-concurrent-write",
          surface: "email",
          subject: "Concurrent fixture",
          status: "ready",
          body: "Dana, this draft should survive beside the touch row."
        });
      `),
      runNodeModule(stateDir, `
        import { findCompanyById, findMotionById } from ${JSON.stringify(dbModuleUrl)};
        import { recordMotionProspectTouch } from ${JSON.stringify(touchModuleUrl)};
        const motion = findMotionById(${JSON.stringify(motion.id)});
        const company = ${JSON.stringify(company)};
        recordMotionProspectTouch(motion, company, {
          prospectId: "prospect-concurrent-write",
          surface: "profile_view",
          direction: "outbound",
          outcome: "sent",
          occurredAt: "2026-06-10T12:00:00.000Z",
          summary: "Viewed Dana's profile."
        });
      `),
    ]);

    const database = getLocalDatabase();
    const draft = database
      .prepare("SELECT status, payload_json FROM prospect_drafts WHERE prospect_id = ? AND surface = 'email'")
      .get("prospect-concurrent-write");
    const touch = database
      .prepare(`
        SELECT *
        FROM activity_events
        WHERE prospect_id = ?
          AND surface = 'profile_view'
          AND outcome = 'sent'
      `)
      .get("prospect-concurrent-write");
    const cadence = database
      .prepare("SELECT cadence_last_touch_outcome, cadence_last_touch_at FROM prospects WHERE id = ?")
      .get("prospect-concurrent-write");

    assert.equal(draft.status, "ready");
    assert.equal(JSON.parse(draft.payload_json).subject, "Concurrent fixture");
    assert.equal(JSON.parse(draft.payload_json).body, "Dana, this draft should survive beside the touch row.");
    assert.ok(touch, "profile-view touch persisted as an activity event");
    assert.equal(cadence.cadence_last_touch_outcome, "sent");
    assert.equal(cadence.cadence_last_touch_at, "2026-06-10T12:00:00.000Z");
  }, { prefix: "exo-normalized-race-" });
});

test("concurrent motion core updates produce exactly one optimistic version conflict", async () => {
  await withIsolatedExoState(async ({ stateDir }) => {
    const motion = seedMotionView({
      id: "motion-version-race",
      name: "version-race-motion",
      offer: { sourceUrl: "https://example.com/version-race" },
    });
    const barrierDir = path.join(stateDir, "version-barrier");
    const outputs = await Promise.all([
      runCoreUpdateRaceProcess(stateDir, barrierDir, motion.id, "worker-a", "paused"),
      runCoreUpdateRaceProcess(stateDir, barrierDir, motion.id, "worker-b", "archived"),
    ]);
    const results = outputs.map(parseJsonOutput);
    const successes = results.filter((result) => result.ok);
    const conflicts = results.filter((result) => !result.ok && result.name === "MotionVersionConflictError");

    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);

    const stored = findMotionById(motion.id);
    assert.ok(stored);
    assert.equal(stored.version, 2);
    assert.equal(stored.status, successes[0].status);
  }, { prefix: "exo-motion-version-race-" });
});

test("two-process account packet claim contention lets only one worker win", async () => {
  await withIsolatedExoState(async ({ stateDir }) => {
    const motion = seedMotionView({
      id: "motion-claim-race",
      name: "claim-race-motion",
      offer: { sourceUrl: "https://example.com/claim-race" },
      targetMap: {
        status: "ready",
        accounts: [
          buildTargetAccount({
            companyId: "company-claim-race",
            companyName: "Claim Race Co",
            queueState: {
              status: "discovered",
              source: "manual",
              updatedAt: "2026-06-10T08:00:00.000Z",
              notes: null,
            },
          }),
        ],
      },
    });
    const motionAccount = findMotionAccountByMotionAndCompany(motion.id, "company-claim-race");
    assert.ok(motionAccount);

    const barrierDir = path.join(stateDir, "claim-barrier");
    const outputs = await Promise.all([
      runAccountClaimRaceProcess(stateDir, barrierDir, motionAccount.id, "worker-a"),
      runAccountClaimRaceProcess(stateDir, barrierDir, motionAccount.id, "worker-b"),
    ]);
    const results = outputs.map(parseJsonOutput);
    const winners = results.filter((result) => result.claimed);

    assert.equal(winners.length, 1);

    const stored = findMotionAccountByMotionAndCompany(motion.id, "company-claim-race");
    assert.equal(stored.packetStatus, "claimed");
    assert.equal(stored.packetClaimedBy, winners[0].workerLabel);
  }, { prefix: "exo-account-claim-race-" });
});

test("two-process account packet wrapper contention reports one winner and one loser", async () => {
  await withIsolatedExoState(async ({ stateDir }) => {
    const motion = seedMotionView({
      id: "motion-wrapper-claim-race",
      name: "wrapper-claim-race-motion",
      offer: { sourceUrl: "https://example.com/wrapper-claim-race" },
      targetMap: {
        status: "ready",
        accounts: [
          buildTargetAccount({
            companyId: "company-wrapper-claim-race",
            companyName: "Wrapper Claim Race Co",
            domain: "wrapper-claim-race.example",
            websiteUrl: "https://wrapper-claim-race.example",
            queueState: {
              status: "discovered",
              source: "manual",
              updatedAt: "2026-06-10T08:00:00.000Z",
              notes: null,
            },
          }),
        ],
      },
    });
    const company = buildCompanyView(findCompanyById("company-wrapper-claim-race"), { motionIds: [motion.id] });
    const barrierDir = path.join(stateDir, "wrapper-claim-barrier");
    const outputs = await Promise.all([
      runAccountWrapperClaimRaceProcess(stateDir, barrierDir, motion.id, company, "worker-a"),
      runAccountWrapperClaimRaceProcess(stateDir, barrierDir, motion.id, company, "worker-b"),
    ]);
    const results = outputs.map(parseJsonOutput);
    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);

    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.match(losers[0].message, /already claimed/i);

    const stored = findMotionAccountByMotionAndCompany(motion.id, company.id);
    assert.equal(stored.packetStatus, "claimed");
    assert.equal(stored.packetClaimedBy, winners[0].workerLabel);
  }, { prefix: "exo-account-wrapper-claim-race-" });
});

test("inactive owner disposition releases a held cross-motion prospect back into due scans", () => {
  withIsolatedExoState(() => {
    const executionUserId = "user-cross-motion-release";
    insertUser(buildExecutionUser(executionUserId));
    const ownerMotion = seedMotionView({
      id: "motion-cross-owner",
      name: "cross-owner-motion",
      offer: { sourceUrl: "https://example.com/cross-owner" },
    });
    const heldMotion = seedMotionView({
      id: "motion-cross-held",
      name: "cross-held-motion",
      offer: { sourceUrl: "https://example.com/cross-held" },
    });
    const person = resolvePersonIdentity({
      id: "person-cross-motion",
      name: "Morgan Multi",
      contactPoints: [{ kind: "linkedin_public_id", value: "morgan-multi" }],
    }).person;
    const owner = seedProspectBranch({
      motionId: ownerMotion.id,
      companyId: "company-cross-owner",
      companyName: "Cross Owner Co",
      person,
      prospectId: "prospect-cross-owner",
      executionUserId,
      queueStatus: "selected",
      disposition: "active",
      dueAt: "2026-06-10T09:00:00.000Z",
    });
    const held = seedProspectBranch({
      motionId: heldMotion.id,
      companyId: "company-cross-held",
      companyName: "Cross Held Co",
      person,
      prospectId: "prospect-cross-held",
      executionUserId,
      queueStatus: "held_cross_motion",
      disposition: "active",
      dueAt: "2026-06-10T09:00:00.000Z",
      queueState: {
        status: "held_cross_motion",
        source: "manual",
        updatedAt: "2026-06-10T09:00:00.000Z",
        notes: "Held by the owner branch.",
        crossMotionOwner: {
          motionId: ownerMotion.id,
          prospectId: owner.prospect.id,
          companyId: owner.company.id,
        },
      },
    });

    setProspectDisposition(owner.prospect.id, {
      disposition: "nurture",
      actor: "operator",
      reason: "Owner branch moved out of active outbound.",
      at: "2026-06-10T12:00:00.000Z",
    });

    const database = getLocalDatabase();
    const ownerRow = database.prepare("SELECT disposition, queue_status FROM prospects WHERE id = ?").get(owner.prospect.id);
    const heldRow = database.prepare("SELECT queue_status, payload_json FROM prospects WHERE id = ?").get(held.prospect.id);
    const heldPayload = JSON.parse(heldRow.payload_json);
    const releaseEvent = listActivityEvents({ prospectId: held.prospect.id }).find((event) =>
      event.payload?.type === "cross_motion_hold_released"
    );
    const dueBranches = listDueProspectBranches({
      executionUserId,
      now: "2026-06-10T12:05:00.000Z",
      limit: 10,
    });

    assert.equal(ownerRow.disposition, "nurture");
    assert.equal(ownerRow.queue_status, "selected");
    assert.equal(heldRow.queue_status, "selected");
    assert.equal(heldPayload.queueState.status, "selected");
    assert.equal(heldPayload.queueState.crossMotionOwner, undefined);
    assert.ok(releaseEvent, "held branch release system event was written");
    assert.deepEqual(dueBranches.map((branch) => branch.prospect.id), [held.prospect.id]);
  }, { prefix: "exo-cross-motion-release-" });
});

/**
 * @param {string} stateDir
 * @param {string} script
 */
async function runNodeModule(stateDir, script) {
  const result = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    env: { ...process.env, EXO_STATE_DIR: stateDir },
    encoding: "utf8",
  });
  return result.stdout;
}

/**
 * @param {string} stateDir
 * @param {string} barrierDir
 * @param {string} motionId
 * @param {string} workerLabel
 * @param {"paused" | "archived"} status
 */
function runCoreUpdateRaceProcess(stateDir, barrierDir, motionId, workerLabel, status) {
  return runNodeModule(stateDir, `
    import fs from "node:fs";
    import path from "node:path";
    import { setTimeout as sleep } from "node:timers/promises";
    import { findMotionById, updateMotion } from ${JSON.stringify(dbModuleUrl)};
    const motion = findMotionById(${JSON.stringify(motionId)});
    await waitForBarrier(${JSON.stringify(barrierDir)}, ${JSON.stringify(workerLabel)}, 2);
    try {
      const stored = updateMotion({
        ...motion,
        status: ${JSON.stringify(status)},
        updatedAt: ${JSON.stringify(status === "paused" ? "2026-06-10T12:10:00.000Z" : "2026-06-10T12:11:00.000Z")}
      });
      console.log(JSON.stringify({ ok: true, workerLabel: ${JSON.stringify(workerLabel)}, status: stored.status, version: stored.version }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, workerLabel: ${JSON.stringify(workerLabel)}, name: error.name, message: error.message }));
    }
    async function waitForBarrier(dir, label, expected) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, label + ".ready"), "1");
      while (fs.readdirSync(dir).filter((name) => name.endsWith(".ready")).length < expected) {
        await sleep(10);
      }
    }
  `);
}

/**
 * @param {string} stateDir
 * @param {string} barrierDir
 * @param {string} motionAccountId
 * @param {string} workerLabel
 */
function runAccountClaimRaceProcess(stateDir, barrierDir, motionAccountId, workerLabel) {
  return runNodeModule(stateDir, `
    import fs from "node:fs";
    import path from "node:path";
    import { setTimeout as sleep } from "node:timers/promises";
    import { claimMotionAccountPacket } from ${JSON.stringify(dbModuleUrl)};
    await waitForBarrier(${JSON.stringify(barrierDir)}, ${JSON.stringify(workerLabel)}, 2);
    const row = claimMotionAccountPacket(${JSON.stringify(motionAccountId)}, {
      workerLabel: ${JSON.stringify(workerLabel)},
      claimedAt: "2026-06-10T12:15:00.000Z"
    });
    console.log(JSON.stringify({ workerLabel: ${JSON.stringify(workerLabel)}, claimed: Boolean(row), packetClaimedBy: row?.packetClaimedBy ?? null }));
    async function waitForBarrier(dir, label, expected) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, label + ".ready"), "1");
      while (fs.readdirSync(dir).filter((name) => name.endsWith(".ready")).length < expected) {
        await sleep(10);
      }
    }
  `);
}

/**
 * @param {string} stateDir
 * @param {string} barrierDir
 * @param {string} motionId
 * @param {Record<string, any>} company
 * @param {string} workerLabel
 */
function runAccountWrapperClaimRaceProcess(stateDir, barrierDir, motionId, company, workerLabel) {
  return runNodeModule(stateDir, `
    import fs from "node:fs";
    import path from "node:path";
    import { setTimeout as sleep } from "node:timers/promises";
    import { findMotionById } from ${JSON.stringify(dbModuleUrl)};
    import { claimMotionTargetAccountPacket } from ${JSON.stringify(accountClaimModuleUrl)};
    const motion = findMotionById(${JSON.stringify(motionId)});
    const company = ${JSON.stringify(company)};
    await waitForBarrier(${JSON.stringify(barrierDir)}, ${JSON.stringify(workerLabel)}, 2);
    try {
      const stored = claimMotionTargetAccountPacket(motion, company, {
        workerLabel: ${JSON.stringify(workerLabel)},
        notes: "Claimed by wrapper race test."
      });
      const account = stored.targetMap.accounts.find((item) => item.companyId === company.id);
      console.log(JSON.stringify({
        ok: true,
        workerLabel: ${JSON.stringify(workerLabel)},
        packetWorkerLabel: account?.packetState?.workerLabel ?? null
      }));
    } catch (error) {
      console.log(JSON.stringify({
        ok: false,
        workerLabel: ${JSON.stringify(workerLabel)},
        name: error.name,
        message: error.message
      }));
    }
    async function waitForBarrier(dir, label, expected) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, label + ".ready"), "1");
      while (fs.readdirSync(dir).filter((name) => name.endsWith(".ready")).length < expected) {
        await sleep(10);
      }
    }
  `);
}

/**
 * @param {string} output
 */
function parseJsonOutput(output) {
  const line = output.trim().split(/\n/).at(-1);
  assert.ok(line, "child process returned JSON output");
  return JSON.parse(line);
}

/**
 * @param {{
 *   motionId: string,
 *   companyId: string,
 *   companyName: string,
 *   person: { id: string },
 *   prospectId: string,
 *   executionUserId: string,
 *   queueStatus: string,
 *   disposition: string,
 *   dueAt: string,
 *   queueState?: Record<string, unknown>
 * }} input
 */
function seedProspectBranch(input) {
  const company = findOrCreateCompany({
    id: input.companyId,
    name: input.companyName,
    domain: `${input.companyId}.example`,
  });
  const motionAccount = upsertMotionAccount({
    id: `motion-account-${input.motionId}-${input.companyId}`,
    motionId: input.motionId,
    companyId: company.id,
    executionUserId: input.executionUserId,
    queueStatus: "researched",
    disposition: "active",
  });
  upsertEmployment({
    personId: input.person.id,
    companyId: company.id,
    title: "VP Revenue",
    source: "test",
    observedAt: "2026-06-10T08:00:00.000Z",
  });
  const prospect = upsertProspect({
    id: input.prospectId,
    motionId: input.motionId,
    companyId: company.id,
    motionAccountId: motionAccount.id,
    personId: input.person.id,
    queueStatus: input.queueStatus,
    disposition: input.disposition,
    cadenceStatus: "ready",
    cadenceCurrentStep: "connection-request",
    cadenceNextActionDueAt: input.dueAt,
    payload: {
      name: "Morgan Multi",
      title: "VP Revenue",
      whyRelevant: "Shared person across two motions.",
      queueState: input.queueState ?? {
        status: input.queueStatus,
        source: "manual",
        updatedAt: "2026-06-10T09:00:00.000Z",
        notes: null,
      },
      cadenceState: {
        status: "ready",
        currentStep: "connection-request",
        nextAction: "Send the connection request.",
        nextActionDueAt: input.dueAt,
      },
    },
  });

  return { company, motionAccount, prospect };
}
