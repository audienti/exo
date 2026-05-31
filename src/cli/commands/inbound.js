#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import path from "node:path";
import { buildInboundCueListView, buildInboundCueDedupeKey, recordInboundCue, resolveInboundCue } from "../../core/inbound-cues.js";
import {
  buildInboundObservationListView,
  mergeInboundObservation,
  parseInboundObservations,
  recordInboundObservation
} from "../../core/inbound-observations.js";
import { buildLiveGmailInboundSyncPayload } from "../../core/inbound-gmail-live-sync.js";
import { buildLiveInboundSyncPayload } from "../../core/inbound-live-sync.js";
import { buildLiveLinkedinInboundSyncPayload } from "../../core/inbound-linkedin-live-sync.js";
import { buildGmailInboundSyncPayload } from "../../core/inbound-gmail-sync.js";
import { buildLinkedinInboundSyncPayload } from "../../core/inbound-linkedin-sync.js";
import { buildInboundSyncRefreshSummary, prepareUserInboundSyncRun } from "../../core/inbound-sync-run.js";
import {
  buildUserInboundSyncPlan,
  buildUserInboundSyncView,
  recordUserInboundSyncRun,
  setUserInboundSyncPolicy
} from "../../core/user-inbound-sync.js";
import {
  findInboundCueByDedupeKey,
  findInboundCueById,
  findInboundObservationByDedupeKey,
  findInboundObservationById,
  listBrowserProfiles,
  listInboundCues,
  listUsers,
  findUserById,
  listCompanies,
  listInboundObservations,
  listMotions,
  updateUser,
  upsertInboundCue,
  upsertInboundObservation
} from "../../db/database.js";
import {
  renderInboundCueList,
  renderInboundReview,
  renderInboundObservationDetail,
  renderInboundObservationList,
  renderInboundSurfaceCatalog,
  renderInboundSurfaceDetail,
  renderInboundSyncPlan,
  renderInboundSyncRun,
  renderUserInboundSync
} from "../../artifacts/render-inbound.js";
import { buildInboundReviewView } from "../../core/build-inbound-review-view.js";
import { classifyUserWorkingHours } from "../../core/working-hours.js";
import { browserProfileCapabilitySchema } from "../../schema/browser-profile.js";
import {
  inboundCueKindSchema,
  inboundCueStatusSchema,
  inboundObservationKindSchema,
  inboundSyncPlanModeSchema,
  inboundSyncRunPayloadSchema,
  inboundSyncRunStatusSchema
} from "../../schema/inbound.js";
import { findInboundSurfaceDefinition, listInboundSurfaceCatalog } from "../../lib/inbound-surface-catalog.js";

export function registerInbound(program) {
  const inbound = program
    .command("inbound")
    .description("Inspect governed inbound truth surfaces, sync policy, and sync-state memory.")
    .addHelpText(
      "after",
      `
Canonical inbound interface:
  exo inbound review <user-id>
  exo inbound surfaces
  exo inbound surface <surface-key>
  exo inbound cues add <user-id> --capability gmail --surface gmail-inbox-threads --kind unread_message_badge --observed-at <iso> --summary "Saw something worth checking"
  exo inbound cues list <user-id> --json
  exo inbound sync show <user-id>
  exo inbound sync plan <user-id> --mode quick
  exo inbound sync live <user-id> --apply --refresh --json
  exo inbound sync linkedin <user-id> --account <account-id> --input ./linkedin-capture.json --apply --refresh --json
  exo inbound sync linkedin-live <user-id> --account <account-id> --runtime codex --apply --refresh --json
  exo inbound sync gmail <user-id> --account <account-id> --input ./gmail-capture.json --apply --refresh --json
  exo inbound sync gmail-live <user-id> --account <account-id> --apply --refresh --json
  exo inbound sync run <user-id> --input ./inbound-sync.json --refresh --json
  exo inbound sync set <user-id> --account <account-id> --enable-surface linkedin-sent-invitations
  exo inbound sync record <user-id> --account <account-id> --surface linkedin-sent-invitations --status success
  exo inbound observations list <user-id>
  exo inbound observations add <user-id> --account <account-id> --surface linkedin-messaging-inbox --kind inbound_reply_received --observed-at 2026-05-28T14:00:00.000Z --summary "Prospect replied in LinkedIn"

Rules:
  - Start with the canonical truth surfaces, not the LinkedIn notifications bell.
  - Notification dots and unread badges are ambient cues, not canonical truth. Record them as cues or trigger a sync; do not treat them as observations by themselves.
  - Sync policy lives on connected user accounts because that is where channel ownership already lives.
  - Sync policy and observation storage exist now. Gmail has a first live retrieval path through supported runtime adapters, including runtime:gmail harness connections and trusted Chrome profiles plus runtime:chrome harnesses. LinkedIn quick-mode surfaces also have a first live retrieval path through a trusted Chrome profile plus a supported runtime:chrome harness, but broader live retrieval still does not.
  - Use inbound sync plan when another agent needs the actual run contract for quick, normal, or full inbound passes.
  - Use inbound sync live when Exo itself should run one governed quick-mode inbound pass across every enabled Gmail and LinkedIn account that already has live retrieval support.
  - Use inbound sync linkedin when another agent already inspected LinkedIn quick-mode surfaces and needs Exo to build or apply the governed writeback payload.
  - Use inbound sync linkedin-live when Exo itself should inspect LinkedIn quick-mode surfaces through a trusted Chrome profile plus a supported runtime:chrome harness.
  - Use inbound sync gmail when another agent already inspected Gmail and needs Exo to build or apply the governed writeback payload.
  - Use inbound sync gmail-live when Exo itself should inspect Gmail through either a supported runtime:gmail harness-backed account or a trusted Chrome profile plus a supported runtime:chrome harness.
  - Use inbound sync run when another agent already inspected the live surfaces and needs one governed writeback path for the whole pass.
  - Use inbound review when you need the management surface: what was checked, what needs a decision, what is stale, and what still needs itemization.
`
    );

  inbound
    .command("review")
    .description("Show the concrete inbound review queue plus surface-by-surface state for one execution user.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Filter to one connected account")
    .option("--capability <capability>", "Filter to one capability like linkedin or gmail")
    .option("--motion <motion-id>", "Filter to one motion")
    .option("--company <company-id>", "Filter to one company")
    .option("--prospect <prospect-id>", "Filter to one prospect")
    .option("--limit <count>", "Maximum observations to consider for the review queue")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const capability = options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null;
      const observations = listInboundObservations({
        userId,
        accountId: options.account ?? null,
        capability,
        motionId: options.motion ?? null,
        companyId: options.company ?? null,
        prospectId: options.prospect ?? null,
        limit: options.limit !== undefined ? Number.parseInt(options.limit, 10) : null
      });

      const result = buildInboundReviewView(rawUser, observations, listMotions(), listCompanies(), {
        accountId: options.account ?? null,
        capability
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInboundReview(result));
    });

  inbound
    .command("surfaces")
    .description("List the canonical inbound truth surfaces Exo knows how to reason about.")
    .option("--capability <capability>", "Filter to one capability like linkedin or gmail")
    .option("--json", "Emit machine-readable JSON")
    .action((options) => {
      const capability = options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null;
      const result = {
        surfaces: listInboundSurfaceCatalog({ capability })
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInboundSurfaceCatalog(result));
    });

  inbound
    .command("surface")
    .description("Show one canonical inbound truth surface in detail.")
    .argument("<surface-key>", "Inbound surface key")
    .option("--json", "Emit machine-readable JSON")
    .action((surfaceKey, options) => {
      const surface = findInboundSurfaceDefinition(surfaceKey);
      if (!surface) {
        console.error(`Inbound surface not found: ${surfaceKey}`);
        process.exitCode = 1;
        return;
      }

      const result = { surface };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInboundSurfaceDetail(result));
    });

  const cues = inbound
    .command("cues")
    .description("Record or inspect ambient inbound cues that suggest sync is worth doing without claiming canonical truth.");

  cues
    .command("add")
    .description("Record one ambient inbound cue and optionally trigger a governed live sync when the window is open.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Connected account identifier")
    .option("--capability <capability>", "Capability such as linkedin or gmail; used when --account is omitted")
    .requiredOption("--surface <surface-key>", "Canonical surface this cue points toward")
    .requiredOption("--kind <kind>", "Cue kind such as unread_message_badge or invite_badge")
    .requiredOption("--observed-at <iso-datetime>", "When the cue was seen")
    .requiredOption("--summary <text>", "Short summary of what the agent saw")
    .option("--source <source>", "action_glance | manual_hint | runtime_capture")
    .option("--motion <motion-id>", "Optional linked motion")
    .option("--company <company-id>", "Optional linked company")
    .option("--prospect <prospect-id>", "Optional linked prospect")
    .option("--notes <notes>", "Optional notes")
    .option("--auto-sync", "If working hours are open and the account is live-supported, run a quick live sync immediately")
    .option("--refresh", "When auto-sync succeeds, return refreshed inbox/daily/next summaries")
    .option("--json", "Emit machine-readable JSON")
    .action(async (userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      let cue;
      try {
        const cueInput = {
          accountId: options.account ?? null,
          capability: options.capability ?? null,
          surfaceKey: options.surface,
          kind: options.kind,
          source: options.source ?? null,
          observedAt: options.observedAt,
          summary: options.summary,
          motionId: options.motion ?? null,
          companyId: options.company ?? null,
          prospectId: options.prospect ?? null,
          notes: options.notes ?? null
        };
        const draftCue = recordInboundCue(rawUser, cueInput);
        const existingCue = findInboundCueByDedupeKey(
          buildInboundCueDedupeKey(
            draftCue.accountId,
            draftCue.surfaceKey,
            inboundCueKindSchema.parse(options.kind)
          )
        );
        cue = existingCue
          ? recordInboundCue(rawUser, cueInput, { existingCue })
          : draftCue;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const storedCue = upsertInboundCue(cue);
      const response = {
        cue: storedCue,
        autoSync: null,
        applied: null
      };

      if (options.autoSync) {
        const workingHours = classifyUserWorkingHours(rawUser, new Date().toISOString());
        if (!workingHours.openNow) {
          response.autoSync = {
            status: "deferred",
            reason: workingHours.summary,
            nextOpenAt: workingHours.nextOpenAt
          };
        } else {
          try {
            const live = await buildLiveInboundSyncPayload(rawUser, listBrowserProfiles(), {
              accountId: storedCue.accountId,
              mode: "quick"
            });
            response.autoSync = {
              status: "captured",
              reason: `Ran a quick live inbound sync for ${storedCue.capability}.`,
              nextOpenAt: workingHours.nextOpenAt
            };
            response.applied = applyInboundSyncRunPayload(rawUser, live.payload, { refresh: Boolean(options.refresh) });
          } catch (error) {
            response.autoSync = {
              status: "failed",
              reason: error instanceof Error ? error.message : String(error),
              nextOpenAt: workingHours.nextOpenAt
            };
          }
        }
      }

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      if (response.applied) {
        console.log(renderInboundSyncRun(response.applied));
        return;
      }

      console.log(renderInboundCueList(buildInboundCueListView([storedCue], { userId })));
    });

  cues
    .command("list")
    .description("List ambient inbound cues for one execution user.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Filter to one connected account")
    .option("--capability <capability>", "Filter to one capability like linkedin or gmail")
    .option("--status <status>", "open | resolved | dismissed")
    .option("--motion <motion-id>", "Filter to one motion")
    .option("--company <company-id>", "Filter to one company")
    .option("--prospect <prospect-id>", "Filter to one prospect")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const result = buildInboundCueListView(
        listInboundCues({
          userId,
          accountId: options.account ?? null,
          capability: options.capability ?? null,
          status: options.status ? inboundCueStatusSchema.parse(options.status) : null,
          motionId: options.motion ?? null,
          companyId: options.company ?? null,
          prospectId: options.prospect ?? null
        }),
        { userId }
      );

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInboundCueList(result));
    });

  cues
    .command("resolve")
    .description("Resolve or dismiss one ambient inbound cue after the operator checked the real truth surface.")
    .argument("<user-id>", "Execution user identifier")
    .requiredOption("--cue <cue-id>", "Cue identifier")
    .option("--status <status>", "resolved | dismissed")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      if (!findUserById(userId)) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const rawCue = findInboundCueById(options.cue);
      if (!rawCue) {
        console.error(`Inbound cue not found: ${options.cue}`);
        process.exitCode = 1;
        return;
      }

      try {
        const cue = resolveInboundCue(rawCue, {
          status: options.status ?? "resolved"
        });
        upsertInboundCue(cue);

        if (options.json) {
          console.log(JSON.stringify({ cue }, null, 2));
          return;
        }

        console.log(renderInboundCueList(buildInboundCueListView([cue], { userId })));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  const sync = inbound
    .command("sync")
    .description("Inspect or update inbound sync policy and sync-state memory for connected user accounts.");

  sync
    .command("show")
    .description("Show inbound sync coverage and last-run state for one execution user.")
    .argument("<user-id>", "Execution user identifier")
    .option("--capability <capability>", "Filter to one capability like linkedin or gmail")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const capability = options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null;
      const result = buildUserInboundSyncView(rawUser, { capability });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderUserInboundSync(result));
    });

  sync
    .command("plan")
    .description("Build the agent-facing run contract for a quick, normal, or full inbound sync pass.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Filter to one connected account")
    .option("--capability <capability>", "Filter to one capability like linkedin or gmail")
    .option("--mode <mode>", "quick | normal | full")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const capability = options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null;
      const mode = options.mode ? inboundSyncPlanModeSchema.parse(options.mode) : "quick";
      const result = buildUserInboundSyncPlan(rawUser, {
        accountId: options.account ?? null,
        capability,
        mode
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInboundSyncPlan(result));
    });

  sync
    .command("live")
    .description("Inspect every enabled live-supported inbound account for one user, then optionally apply one governed quick-mode writeback.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Only inspect one connected account")
    .option("--capability <capability>", "Only inspect one capability like linkedin or gmail")
    .option("--mode <mode>", "Currently quick only")
    .option("--runtime <runtime>", "Preferred runtime override when multiple supported harnesses exist, such as codex or claude")
    .option("--limit <count>", "Maximum relevant items to inspect per live surface")
    .option("--since <iso-datetime>", "Only keep Gmail threads whose newest relevant message is at or after this time")
    .option("--apply", "Apply the combined payload through exo inbound sync run semantics")
    .option("--refresh", "Return a fresh inbox/daily/next summary after writeback; implies --apply")
    .option("--json", "Emit machine-readable JSON")
    .action(async (userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      let result;
      try {
        result = await buildLiveInboundSyncPayload(rawUser, listBrowserProfiles(), {
          accountId: options.account ?? null,
          capability: options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null,
          mode: options.mode ?? "quick",
          runtime: options.runtime ?? null,
          limit: options.limit !== undefined ? Number.parseInt(options.limit, 10) : null,
          since: options.since ?? null
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const response = {
        ...result,
        applied: null
      };

      if (options.apply || options.refresh) {
        try {
          response.applied = applyInboundSyncRunPayload(rawUser, result.payload, { refresh: Boolean(options.refresh) });
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
          return;
        }
      }

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      if (response.applied) {
        console.log(renderInboundSyncRun(response.applied));
        return;
      }

      console.log(JSON.stringify(response, null, 2));
    });

  sync
    .command("linkedin")
    .description("Turn one LinkedIn quick-mode capture into a governed sync payload and optionally apply it.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Connected LinkedIn account identifier; inferred when only one LinkedIn account exists")
    .requiredOption("--input <path>", "Path to a LinkedIn capture JSON file, or - to read JSON from stdin")
    .option("--apply", "Apply the generated payload through exo inbound sync run semantics")
    .option("--refresh", "Return a fresh inbox/daily/next summary after writeback; implies --apply")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      let built;
      try {
        built = buildLinkedinInboundSyncPayload(rawUser, {
          accountId: options.account ?? null,
          capture: loadJsonInput(options.input)
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const result = {
        capture: built.capture,
        payload: built.payload,
        applied: null
      };

      if (options.apply || options.refresh) {
        try {
          result.applied = applyInboundSyncRunPayload(rawUser, built.payload, { refresh: Boolean(options.refresh) });
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
          return;
        }
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.applied) {
        console.log(renderInboundSyncRun(result.applied));
        return;
      }

      console.log(JSON.stringify(result.payload, null, 2));
    });

  sync
    .command("linkedin-live")
    .description("Inspect LinkedIn quick-mode surfaces through the resolved trusted Chrome profile and supported runtime:chrome harness.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Connected LinkedIn account identifier; inferred when only one LinkedIn account exists")
    .option("--runtime <runtime>", "Browser-control runtime to use when multiple supported harnesses exist, such as codex or claude")
    .option("--connector <connector>", "Browser-control connector; currently chrome only")
    .option("--limit <count>", "Maximum relevant items to inspect per LinkedIn surface")
    .option("--apply", "Apply the generated payload through exo inbound sync run semantics")
    .option("--refresh", "Return a fresh inbox/daily/next summary after writeback; implies --apply")
    .option("--json", "Emit machine-readable JSON")
    .action(async (userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      let result;
      try {
        result = await buildLiveLinkedinInboundSyncPayload(rawUser, listBrowserProfiles(), {
          accountId: options.account ?? null,
          runtime: options.runtime ?? null,
          connector: options.connector ?? null,
          limit: options.limit !== undefined ? Number.parseInt(options.limit, 10) : null
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const response = {
        probe: result.probe,
        capture: result.capture,
        payload: result.payload,
        applied: null
      };

      if (options.apply || options.refresh) {
        try {
          response.applied = applyInboundSyncRunPayload(rawUser, result.payload, { refresh: Boolean(options.refresh) });
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
          return;
        }
      }

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      if (response.applied) {
        console.log(renderInboundSyncRun(response.applied));
        return;
      }

      console.log(JSON.stringify(response, null, 2));
    });

  sync
    .command("gmail")
    .description("Turn one Gmail inbox capture into a governed sync payload and optionally apply it.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Connected Gmail account identifier; inferred when only one Gmail account exists")
    .requiredOption("--input <path>", "Path to a Gmail capture JSON file, or - to read JSON from stdin")
    .option("--apply", "Apply the generated payload through exo inbound sync run semantics")
    .option("--refresh", "Return a fresh inbox/daily/next summary after writeback; implies --apply")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      let built;
      try {
        built = buildGmailInboundSyncPayload(rawUser, {
          accountId: options.account ?? null,
          capture: loadJsonInput(options.input)
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const result = {
        capture: built.capture,
        payload: built.payload,
        applied: null
      };

      if (options.apply || options.refresh) {
        try {
          result.applied = applyInboundSyncRunPayload(rawUser, built.payload, { refresh: Boolean(options.refresh) });
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
          return;
        }
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.applied) {
        console.log(renderInboundSyncRun(result.applied));
        return;
      }

      console.log(JSON.stringify(result.payload, null, 2));
    });

  sync
    .command("gmail-live")
    .description("Inspect Gmail through the resolved supported runtime, build a governed sync payload, and optionally apply it.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Connected Gmail account identifier; inferred when only one Gmail account exists")
    .option("--runtime <runtime>", "Live retrieval runtime to use when multiple supported harnesses exist, such as codex or claude")
    .option("--connector <connector>", "Harness connector to use, such as gmail or chrome")
    .option("--limit <count>", "Maximum inbox threads to inspect from live Gmail")
    .option("--since <iso-datetime>", "Only keep threads whose newest relevant message is at or after this time")
    .option("--apply", "Apply the generated payload through exo inbound sync run semantics")
    .option("--refresh", "Return a fresh inbox/daily/next summary after writeback; implies --apply")
    .option("--json", "Emit machine-readable JSON")
    .action(async (userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      let result;
      try {
        result = await buildLiveGmailInboundSyncPayload(rawUser, listBrowserProfiles(), {
          accountId: options.account ?? null,
          runtime: options.runtime ?? null,
          connector: options.connector ?? null,
          limit: options.limit !== undefined ? Number.parseInt(options.limit, 10) : null,
          since: options.since ?? null
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const response = {
        probe: result.probe,
        capture: result.capture,
        payload: result.payload,
        applied: null
      };

      if (options.apply || options.refresh) {
        try {
          response.applied = applyInboundSyncRunPayload(rawUser, result.payload, { refresh: Boolean(options.refresh) });
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
          return;
        }
      }

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      if (response.applied) {
        console.log(renderInboundSyncRun(response.applied));
        return;
      }

      console.log(JSON.stringify(response, null, 2));
    });

  sync
    .command("run")
    .description("Write back one governed inbound sync pass from a JSON payload captured by another agent.")
    .argument("<user-id>", "Execution user identifier")
    .requiredOption("--input <path>", "Path to a JSON payload file, or - to read JSON from stdin")
    .option("--refresh", "Return a fresh inbox/daily/next summary after writeback")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      let payload;
      try {
        payload = inboundSyncRunPayloadSchema.parse(loadJsonInput(options.input));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      let prepared;
      try {
        prepared = prepareUserInboundSyncRun(rawUser, payload, {
          rawMotions: listMotions()
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const result = applyPreparedInboundSyncRun(userId, prepared, { refresh: Boolean(options.refresh) });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInboundSyncRun(result));
    });

  sync
    .command("set")
    .description("Enable or disable inbound surfaces for one connected user account.")
    .argument("<user-id>", "Execution user identifier")
    .requiredOption("--account <account-id>", "Connected account identifier from exo inbound sync show")
    .option("--enable-surface <surface-key>", "Enable one inbound surface", collect, [])
    .option("--disable-surface <surface-key>", "Disable one inbound surface", collect, [])
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const updated = setUserInboundSyncPolicy(rawUser, {
        accountId: options.account,
        enableSurfaceKeys: options.enableSurface,
        disableSurfaceKeys: options.disableSurface
      });
      updateUser(updated);

      const result = buildUserInboundSyncView(updated);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderUserInboundSync(result));
    });

  sync
    .command("record")
    .description("Record the last observed sync result for one inbound surface on one connected account.")
    .argument("<user-id>", "Execution user identifier")
    .requiredOption("--account <account-id>", "Connected account identifier from exo inbound sync show")
    .requiredOption("--surface <surface-key>", "Inbound surface key")
    .requiredOption("--status <status>", "never | success | warning | failed")
    .option("--observed-at <iso-datetime>", "Newest observed item timestamp")
    .option("--item-count <count>", "Number of items observed during the sync")
    .option("--error <message>", "Error or warning detail for failed/warning runs")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const updated = recordUserInboundSyncRun(rawUser, {
        accountId: options.account,
        surfaceKey: options.surface,
        status: inboundSyncRunStatusSchema.parse(options.status),
        observedAt: options.observedAt ?? null,
        itemCount: options.itemCount !== undefined ? Number.parseInt(options.itemCount, 10) : null,
        error: options.error ?? null
      });
      updateUser(updated);

      const result = buildUserInboundSyncView(updated);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderUserInboundSync(result));
    });

  const observations = inbound
    .command("observations")
    .description("Inspect or record normalized inbound observations that future sync runs and inbox views will build on.");

  observations
    .command("list")
    .description("List normalized inbound observations for one execution user.")
    .argument("<user-id>", "Execution user identifier")
    .option("--account <account-id>", "Filter to one connected account")
    .option("--capability <capability>", "Filter to one capability like linkedin or gmail")
    .option("--surface <surface-key>", "Filter to one inbound surface")
    .option("--motion <motion-id>", "Filter to one motion")
    .option("--company <company-id>", "Filter to one company")
    .option("--prospect <prospect-id>", "Filter to one prospect")
    .option("--limit <count>", "Maximum observations to return")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const user = {
        id: rawUser.id,
        label: rawUser.label,
        owner: rawUser.owner ?? null
      };
      const observations = parseInboundObservations(
        listInboundObservations({
          userId,
          accountId: options.account ?? null,
          capability: options.capability ? browserProfileCapabilitySchema.parse(options.capability) : null,
          surfaceKey: options.surface ?? null,
          motionId: options.motion ?? null,
          companyId: options.company ?? null,
          prospectId: options.prospect ?? null,
          limit: options.limit !== undefined ? Number.parseInt(options.limit, 10) : null
        })
      );
      const result = buildInboundObservationListView({ user, observations });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInboundObservationList(result));
    });

  observations
    .command("show")
    .description("Show one normalized inbound observation in detail.")
    .argument("<observation-id>", "Inbound observation identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((observationId, options) => {
      const rawObservation = findInboundObservationById(observationId);
      if (!rawObservation) {
        console.error(`Inbound observation not found: ${observationId}`);
        process.exitCode = 1;
        return;
      }

      const observation = parseInboundObservations([rawObservation])[0];
      const result = { observation };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInboundObservationDetail(result));
    });

  observations
    .command("add")
    .description("Record one normalized inbound observation for a connected user account.")
    .argument("<user-id>", "Execution user identifier")
    .requiredOption("--account <account-id>", "Connected account identifier from exo inbound sync show")
    .requiredOption("--surface <surface-key>", "Inbound surface key")
    .requiredOption("--kind <kind>", "Normalized observation kind")
    .requiredOption("--observed-at <iso-datetime>", "When the inbound event actually happened or was first visible")
    .requiredOption("--summary <summary>", "Short operator-usable summary")
    .option("--external-id <external-id>", "Stable external id for dedupe, such as a thread id or invite id")
    .option("--actor-name <name>", "Actor or participant name")
    .option("--actor-title <title>", "Actor title")
    .option("--actor-company <company-name>", "Actor company name")
    .option("--actor-handle <handle>", "Actor handle or email")
    .option("--actor-profile-url <url>", "Actor profile URL")
    .option("--thread-url <url>", "Conversation or thread URL")
    .option("--source-url <url>", "Canonical source URL for the observation")
    .option("--motion <motion-id>", "Related motion id if already known")
    .option("--company <company-id>", "Related company id if already known")
    .option("--prospect <prospect-id>", "Related prospect id if already known")
    .option("--notes <notes>", "Optional notes")
    .option("--json", "Emit machine-readable JSON")
    .action((userId, options) => {
      const rawUser = findUserById(userId);
      if (!rawUser) {
        console.error(`User not found: ${userId}`);
        process.exitCode = 1;
        return;
      }

      const observation = recordInboundObservation(rawUser, {
        accountId: options.account,
        surfaceKey: options.surface,
        kind: inboundObservationKindSchema.parse(options.kind),
        observedAt: options.observedAt,
        summary: options.summary,
        externalId: options.externalId ?? null,
        actorName: options.actorName ?? null,
        actorTitle: options.actorTitle ?? null,
        actorCompanyName: options.actorCompany ?? null,
        actorHandle: options.actorHandle ?? null,
        actorProfileUrl: options.actorProfileUrl ?? null,
        threadUrl: options.threadUrl ?? null,
        sourceUrl: options.sourceUrl ?? null,
        motionId: options.motion ?? null,
        companyId: options.company ?? null,
        prospectId: options.prospect ?? null,
        notes: options.notes ?? null
      }, {
        rawMotions: listMotions()
      });
      const existing = findInboundObservationByDedupeKey(observation.dedupeKey);
      const merged = mergeInboundObservation(existing, observation);
      upsertInboundObservation(merged);

      const result = { observation: merged };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderInboundObservationDetail(result));
    });
}

function collect(value, previous) {
  previous.push(value);
  return previous;
}

function loadJsonInput(filePath) {
  if (filePath === "-") {
    if (process.stdin.isTTY) {
      throw new Error("Expected JSON on stdin, but stdin is a terminal. Pipe input or pass --input <path>.");
    }
    const stdin = fs.readFileSync(0, "utf8");
    return JSON.parse(stdin);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

function applyInboundSyncRunPayload(rawUser, payload, options = {}) {
  const prepared = prepareUserInboundSyncRun(rawUser, payload, {
    rawMotions: listMotions()
  });
  return applyPreparedInboundSyncRun(prepared.user.id, prepared, options);
}

function applyPreparedInboundSyncRun(userId, prepared, options = {}) {
  let createdObservationCount = 0;
  let updatedObservationCount = 0;
  let resolvedCueCount = 0;
  const storedObservations = prepared.observations.map((observation) => {
    const existing = findInboundObservationByDedupeKey(observation.dedupeKey);
    const merged = mergeInboundObservation(existing, observation);
    upsertInboundObservation(merged);
    if (existing) {
      updatedObservationCount += 1;
    } else {
      createdObservationCount += 1;
    }
    return merged;
  });
  for (const account of prepared.accounts) {
    const resolvedSurfaceKeys = account.surfaces
      .filter((surface) => surface.status !== "failed")
      .map((surface) => surface.surfaceKey);
    if (!resolvedSurfaceKeys.length) {
      continue;
    }

    const openCues = listInboundCues({
      userId,
      accountId: account.accountId,
      status: "open"
    });
    for (const rawCue of openCues) {
      if (!resolvedSurfaceKeys.includes(rawCue.surfaceKey)) {
        continue;
      }

      const resolvedCue = resolveInboundCue(rawCue, {
        status: "resolved"
      });
      upsertInboundCue(resolvedCue);
      resolvedCueCount += 1;
    }
  }
  updateUser(prepared.updatedUser);

  const result = {
    user: prepared.user,
    processedAt: prepared.processedAt,
    mode: prepared.mode,
    counts: {
      ...prepared.counts,
      createdObservationCount,
      updatedObservationCount,
      resolvedCueCount
    },
    followUpCommands: prepared.followUpCommands,
    accounts: prepared.accounts,
    observations: storedObservations,
    refreshed: null
  };

  if (options.refresh) {
    const refreshedUser = findUserById(userId);
    const refreshedObservations = listInboundObservations({ userId });
    result.refreshed = buildInboundSyncRefreshSummary({
      rawUser: refreshedUser,
      rawUsers: listUsers(),
      rawMotions: listMotions(),
      rawCompanies: listCompanies(),
      rawProfiles: listBrowserProfiles(),
      rawObservations: refreshedObservations,
      rawCues: listInboundCues({
        userId,
        status: "open"
      })
    });
  }

  return result;
}
