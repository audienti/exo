#!/usr/bin/env node
// @ts-check

import {
  buildInboundObservationListView,
  mergeInboundObservation,
  parseInboundObservations,
  recordInboundObservation
} from "../../core/inbound-observations.js";
import { buildUserInboundSyncView, recordUserInboundSyncRun, setUserInboundSyncPolicy } from "../../core/user-inbound-sync.js";
import {
  findInboundObservationByDedupeKey,
  findInboundObservationById,
  findUserById,
  listInboundObservations,
  updateUser,
  upsertInboundObservation
} from "../../db/database.js";
import {
  renderInboundObservationDetail,
  renderInboundObservationList,
  renderInboundSurfaceCatalog,
  renderInboundSurfaceDetail,
  renderUserInboundSync
} from "../../artifacts/render-inbound.js";
import { browserProfileCapabilitySchema } from "../../schema/browser-profile.js";
import { inboundObservationKindSchema, inboundSyncRunStatusSchema } from "../../schema/inbound.js";
import { findInboundSurfaceDefinition, listInboundSurfaceCatalog } from "../../lib/inbound-surface-catalog.js";

export function registerInbound(program) {
  const inbound = program
    .command("inbound")
    .description("Inspect governed inbound truth surfaces, sync policy, and sync-state memory.")
    .addHelpText(
      "after",
      `
Canonical inbound interface:
  exo inbound surfaces
  exo inbound surface <surface-key>
  exo inbound sync show <user-id>
  exo inbound sync set <user-id> --account <account-id> --enable-surface linkedin-sent-invitations
  exo inbound sync record <user-id> --account <account-id> --surface linkedin-sent-invitations --status success
  exo inbound observations list <user-id>
  exo inbound observations add <user-id> --account <account-id> --surface linkedin-messaging-inbox --kind inbound_reply_received --observed-at 2026-05-28T14:00:00.000Z --summary "Prospect replied in LinkedIn"

Rules:
  - Start with the canonical truth surfaces, not the LinkedIn notifications bell.
  - Sync policy lives on connected user accounts because that is where channel ownership already lives.
  - Sync policy and observation storage exist now. Live retrieval still does not.
`
    );

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
