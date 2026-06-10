// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const dbModuleUrl = pathToFileURL(path.join(repoRoot, "src", "db", "database.js")).href;
const actionResultModuleUrl = pathToFileURL(path.join(repoRoot, "src", "core", "record-action-result.js")).href;
const agentQueueModuleUrl = pathToFileURL(path.join(repoRoot, "src", "core", "build-agent-queue.js")).href;
const draftModuleUrl = pathToFileURL(path.join(repoRoot, "src", "core", "set-prospect-draft.js")).href;

test("normalized tracer gate preserves concurrent due send and sibling draft writes", async () => {
  const previousStateDir = process.env.EXO_STATE_DIR;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-normalized-tracer-"));
  process.env.EXO_STATE_DIR = stateDir;

  try {
    const motion = cliJson(stateDir, [
      "motion",
      "add",
      "--url",
      "https://example.com/normalized-tracer",
      "--premise",
      "This offer matters when normalized execution rows must survive concurrent agent lanes.",
      "--audience",
      "Revenue operators",
      "--signal",
      "company::Is execution state at risk of clobbering under concurrent lane writes?",
    ]);
    cliJson(stateDir, ["motion", "restart", motion.id]);
    const company = cliJson(stateDir, [
      "companies",
      "add",
      "--name",
      "Tracer Systems",
      "--domain",
      "tracer.example",
      "--motion",
      motion.id,
    ]);
    const sendProspect = cliJson(stateDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Sally Send",
      "--title",
      "VP Revenue",
      "--linkedin-profile-url",
      "https://www.linkedin.com/in/sally-send",
      "--why-relevant",
      "Owns the send branch for the tracer gate.",
    ]).prospects[0];
    const siblingProspect = cliJson(stateDir, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Riley Research",
      "--title",
      "Director of Growth",
      "--linkedin-profile-url",
      "https://www.linkedin.com/in/riley-research",
      "--why-relevant",
      "Sibling branch that receives a concurrent research draft.",
    ]).prospects[1];

    cliJson(stateDir, [
      "companies",
      "cadence",
      "set",
      company.id,
      "--motion",
      motion.id,
      "--prospect",
      sendProspect.id,
      "--current-step",
      "connection-request",
      "--next-action",
      "Send the approved connection request.",
      "--next-action-due-at",
      "2026-06-10T12:00:00.000Z",
    ]);
    cliJson(stateDir, [
      "companies",
      "prospects",
      "draft",
      "approve",
      company.id,
      "--motion",
      motion.id,
      "--prospect",
      sendProspect.id,
      "--surface",
      "connection_request",
      "--body",
      "Sally, noticed the execution-state work.",
    ]);

    const {
      getLocalDatabase,
      listAgentQueueProspectBranches,
      listCompanies,
      listMotions,
    } = await import(dbModuleUrl);
    const { buildAgentQueue } = await import(agentQueueModuleUrl);
    const prospectBranches = listAgentQueueProspectBranches({ motionId: motion.id });
    const queue = buildAgentQueue({
      motions: listMotions(),
      companies: listCompanies(),
      users: [],
      observations: [],
      cues: [],
      prospectBranches,
    });

    assert.ok(
      queue.tasks.some((task) => task.kind === "send_message" && task.prospectId === sendProspect.id),
      "agent queue selected the due send from normalized prospect branches"
    );

    await Promise.all([
      runNodeModule(stateDir, `
        import { recordActionResult } from ${JSON.stringify(actionResultModuleUrl)};
        recordActionResult({
          actionKey: "connection_request",
          resultKey: "sent",
          motionId: ${JSON.stringify(motion.id)},
          companyId: ${JSON.stringify(company.id)},
          prospectId: ${JSON.stringify(sendProspect.id)},
          occurredAt: "2026-06-10T12:30:00.000Z"
        });
      `),
      runNodeModule(stateDir, `
        import { findCompanyById, findMotionById } from ${JSON.stringify(dbModuleUrl)};
        import { setMotionProspectDraft } from ${JSON.stringify(draftModuleUrl)};
        const motion = findMotionById(${JSON.stringify(motion.id)});
        const company = findCompanyById(${JSON.stringify(company.id)});
        setMotionProspectDraft(motion, company, {
          prospectId: ${JSON.stringify(siblingProspect.id)},
          surface: "connection_request",
          status: "ready",
          body: "Riley, sharing a concise research-backed note."
        });
      `),
    ]);

    const database = getLocalDatabase();
    const sentDraft = database
      .prepare("SELECT status, sent_at FROM prospect_drafts WHERE prospect_id = ? AND surface = 'connection_request'")
      .get(sendProspect.id);
    const siblingDraft = database
      .prepare("SELECT status, payload_json FROM prospect_drafts WHERE prospect_id = ? AND surface = 'connection_request'")
      .get(siblingProspect.id);
    const sendCadence = database
      .prepare("SELECT cadence_last_touch_outcome, cadence_last_touch_at FROM prospects WHERE id = ?")
      .get(sendProspect.id);
    const touch = database
      .prepare(`
        SELECT *
        FROM activity_events
        WHERE prospect_id = ?
          AND surface = 'connection_request'
          AND outcome = 'sent'
      `)
      .get(sendProspect.id);

    assert.equal(sentDraft.status, "sent");
    assert.ok(sentDraft.sent_at, "send draft was marked sent");
    assert.equal(siblingDraft.status, "ready");
    assert.equal(JSON.parse(siblingDraft.payload_json).body, "Riley, sharing a concise research-backed note.");
    assert.equal(sendCadence.cadence_last_touch_outcome, "sent");
    assert.equal(sendCadence.cadence_last_touch_at, "2026-06-10T12:30:00.000Z");
    assert.ok(touch, "send touch landed as a permanent activity event");
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

/**
 * @param {string} stateDir
 * @param {string[]} args
 */
function cliJson(stateDir, args) {
  return JSON.parse(
    execFileSync(process.execPath, [cliPath, ...args, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: stateDir },
      encoding: "utf8",
    })
  );
}

/**
 * @param {string} stateDir
 * @param {string} script
 */
async function runNodeModule(stateDir, script) {
  await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    env: { ...process.env, EXO_STATE_DIR: stateDir },
    encoding: "utf8",
  });
}
