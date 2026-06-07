#!/usr/bin/env node
// @ts-check

import { ensureTransitionMotion, findTransitionMotion } from "../../core/ensure-transition-motion.js";
import { inboundObservationsShareIdentity } from "../../core/inbound-observations.js";
import { rehomeProspect } from "../../core/rehome-prospect.js";
import { runTransitionPromote } from "../../core/run-transition-promote.js";
import {
  findInboundObservationById,
  findMotionById,
  listCompanies,
  listInboundObservations,
  listMotions,
  updateCompany,
  updateMotion,
  upsertInboundObservation,
} from "../../db/database.js";

/**
 * @param {import("commander").Command} program
 */
export function registerTransition(program) {
  const transition = program
    .command("transition")
    .description("Migrate in-flight relationships from prior tooling into Exo as tracked prospects.")
    .addHelpText(
      "after",
      `
Canonical transition interface:
  exo transition start --user <user-id>
  exo transition promote <observation-id> --user <user-id>
  exo transition promote-all --user <user-id> --surface linkedin-sent-invitations

Rules:
  - Promote means "claim into this workspace's catch-all transition motion." Re-home into real motions later.
  - Promote carries the in-flight state: a sent invite becomes a prospect awaiting accept, a reply becomes an active conversation, etc.
  - A company is resolved or created (best-effort) so the person is always trackable.
`
    );

  transition
    .command("start")
    .description("Create (or show) the catch-all transition motion that absorbs migrated relationships.")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options) => {
      const motion = await ensureTransitionMotion();
      const payload = { motion: { id: motion.id, name: motion.name, status: motion.status } };
      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      console.log(`Transition motion ready: ${motion.name} (${motion.id})`);
    });

  transition
    .command("promote")
    .description("Claim one inbound person (by observation id) into this workspace's transition motion as a prospect.")
    .argument("<observation-id>", "Inbound observation identifier for the person")
    .option("--user <user-id>", "Execution user identifier (scopes the observation set)")
    .option("--json", "Emit machine-readable JSON")
    .action(async (observationId, options) => {
      const seed = findInboundObservationById(observationId);
      if (!seed) {
        console.error(`Inbound observation not found: ${observationId}`);
        process.exitCode = 1;
        return;
      }

      const motion = await resolveTargetMotion();
      if (!motion) {
        return;
      }

      const result = await runTransitionPromote({ observationId: seed.id, userId: options.user ?? seed.userId, motionId: motion.id });
      emit(result, options.json);
    });

  transition
    .command("promote-all")
    .description("Bulk-claim every inbound person on a surface into this workspace's transition motion.")
    .requiredOption("--user <user-id>", "Execution user identifier")
    .option("--surface <surface-key>", "Only promote people on this surface, e.g. linkedin-sent-invitations")
    .option("--limit <n>", "Maximum number of people to promote")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options) => {
      const motion = await resolveTargetMotion();
      if (!motion) {
        return;
      }

      const observations = listInboundObservations({ userId: options.user }).filter(
        (observation) => !options.surface || observation.surfaceKey === options.surface,
      );

      // De-duplicate by identity: promote one person once even if they have
      // several observations on the surface.
      const seeds = [];
      const claimed = [];
      for (const observation of observations) {
        if (observation.prospectId) continue; // already tracked
        if (claimed.some((other) => inboundObservationsShareIdentity(observation, other))) continue;
        claimed.push(observation);
        seeds.push(observation);
      }
      const limited = options.limit ? seeds.slice(0, Number(options.limit)) : seeds;

      const results = [];
      for (const seed of limited) {
        try {
          results.push(await runTransitionPromote({ observationId: seed.id, userId: options.user, motionId: motion.id }));
        } catch (error) {
          results.push({ ok: false, observationId: seed.id, error: error instanceof Error ? error.message : String(error) });
        }
      }

      const promoted = results.filter((r) => r.ok !== false).length;
      if (options.json) {
        console.log(JSON.stringify({ motion: { id: motion.id, name: motion.name }, promoted, total: limited.length, results }, null, 2));
        return;
      }
      console.log(`Promoted ${promoted}/${limited.length} people into ${motion.name}.`);
      for (const r of results) {
        console.log(`  ${r.ok === false ? `✗ ${r.error}` : `✓ ${r.message}`}`);
      }
    });

  transition
    .command("rehome")
    .description("Move a triaged prospect out of the transition motion into a real motion (carries cadence, touches, drafts).")
    .argument("<prospect-id>", "Prospect identifier")
    .requiredOption("--to-motion <motion-id>", "Destination motion")
    .option("--from-motion <motion-id>", "Source motion (defaults to the transition motion)")
    .option("--user <user-id>", "Execution user identifier (scopes observation relinking)")
    .option("--json", "Emit machine-readable JSON")
    .action((prospectId, options) => {
      const fromMotion = options.fromMotion ? findMotionById(options.fromMotion) : findTransitionMotion();
      if (!fromMotion) {
        console.error("No source motion. Pass --from-motion or run `exo transition start` first.");
        process.exitCode = 1;
        return;
      }
      const toMotion = findMotionById(options.toMotion);
      if (!toMotion) {
        console.error(`Destination motion not found: ${options.toMotion}`);
        process.exitCode = 1;
        return;
      }

      try {
        const all = listInboundObservations({ userId: options.user });
        const related = all.filter((observation) => observation.prospectId === prospectId);
        const result = rehomeProspect({
          rawFromMotion: fromMotion,
          rawToMotion: toMotion,
          rawCompanies: listCompanies(),
          prospectId,
          relatedObservations: related,
        });
        updateCompany(result.company);
        updateMotion(result.fromMotion);
        updateMotion(result.toMotion);
        for (const observation of result.observations) {
          upsertInboundObservation(observation);
        }
        if (options.json) {
          console.log(JSON.stringify({ prospectId: result.prospectId, message: result.message }, null, 2));
          return;
        }
        console.log(result.message);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}

/**
 */
async function resolveTargetMotion() {
  return ensureTransitionMotion();
}

/**
 * @param {any} result
 * @param {boolean} json
 */
function emit(result, json) {
  if (json) {
    console.log(JSON.stringify({ prospectId: result.prospectId, message: result.message, carriedState: result.carriedState }, null, 2));
    return;
  }
  console.log(result.message);
}
