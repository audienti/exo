#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import path from "node:path";
import { addCompany } from "../../core/add-company.js";
import { assignMotionProfile } from "../../core/assign-motion-profile.js";
import { assignMotionUser } from "../../core/assign-motion-user.js";
import { cloneMotionDefinition } from "../../core/clone-motion.js";
import { buildMotionActionBrief, buildMotionActionView } from "../../core/build-motion-action-view.js";
import { buildMotionDiscoveryBrief } from "../../core/build-motion-discovery-brief.js";
import { buildMotionIntake } from "../../core/build-motion-intake.js";
import { buildMotionPacketBrief } from "../../core/build-motion-packet-brief.js";
import { defineMotion } from "../../core/define-motion.js";
import { buildMotionDraftBrief, buildMotionDraftView } from "../../core/build-motion-draft-view.js";
import { buildMotionProspectView } from "../../core/build-motion-prospect-view.js";
import { evaluateMotionTargeting } from "../../core/evaluate-motion-targeting.js";
import { linkCompanyToMotion } from "../../core/link-company-to-motion.js";
import { recordMotionProspect } from "../../core/record-prospect.js";
import { refreshMotion } from "../../core/refresh-motion.js";
import { removeMotionGoverned } from "../../core/remove-motion.js";
import { setMotionTargetAccountQueue } from "../../core/set-target-account-queue.js";
import { startMotion } from "../../core/start-motion.js";
import { transitionMotionStatus } from "../../core/transition-motion-status.js";
import { updateMotionDefinition } from "../../core/update-motion.js";
import {
  findCompanyById,
  findCompanyByIdentity,
  findBrowserProfileById,
  findMotionById,
  findUserById,
  insertCompany,
  insertMotion,
  listBrowserProfiles,
  listCompanies,
  listInboundObservations,
  listMotions,
  listUsers,
  updateCompany,
  updateMotion
} from "../../db/database.js";
import { normalizeStringList } from "../../lib/collections.js";
import { loadDoNotContactEntries } from "../../lib/dnc.js";
import { buildMotionQueueSummary } from "../../lib/motion-queue.js";
import {
  renderMotionActionBrief,
  renderMotionActionList,
  renderMotionDraftCases,
  renderMotionDraftBrief,
  renderMotionPacketBrief,
  renderMotionPacketSummary,
  renderMotionProspectList,
  renderMotionStartResult,
  renderMotionSummary,
  renderMotionTargetingSummary,
  renderMotionWritingBrief
} from "../../artifacts/render-motion.js";
import { buildMotionPacketSummary } from "../../lib/motion-packets.js";
import { browserProfileSchema } from "../../schema/browser-profile.js";
import { companySchema } from "../../schema/company.js";
import { motionSchema } from "../../schema/motion.js";

/**
 * @param {string} motionId
 * @param {{ company?: string | null | undefined, prospect?: string | null | undefined }} options
 */
function loadMotionWritingObservations(motionId, options) {
  return listInboundObservations({
    motionId,
    companyId: options.company ?? undefined,
    prospectId: options.prospect ?? undefined,
  });
}

/**
 * @param {import("commander").Command} program
 */
export function registerMotion(program) {
  const motion = program
    .command("motion")
    .description("Manage offer-driven Exo motions.")
    .addHelpText(
      "after",
      `
Canonical motion interface:
  exo motion intake
  exo motion start
  exo motion add
  exo motion seed
  exo motion discover
  exo motion target
  exo motion packets
  exo motion packet-brief
  exo motion prospects
  exo motion actions
  exo motion action-brief
  exo motion drafts
  exo motion draft-brief
  exo motion clone
  exo motion update
  exo motion pause
  exo motion resume
  exo motion archive
  exo motion restart
  exo motion refresh
  exo motion list
  exo motion show
  exo motion profile show/assign
  exo motion user show/assign
  exo motion remove
`
    );

  const motionProfile = motion
    .command("profile")
    .description("Inspect or assign the sticky browser profile default for a motion.");

  const motionUser = motion
    .command("user")
    .description("Inspect or assign the sticky execution-user default for a motion.");

  addMotionSeedOptions(
    motion
      .command("intake")
      .description("Inspect partial new-motion input and return the next question the agent should ask before launch.")
      .option("--existing <strategy>", "continue | clone | new")
      .option("--user <user-id>", "Execution user to assign before launch")
      .option("--from <motion-id>", "Existing motion id to continue or clone when multiple motions share the same URL")
  )
    .addHelpText(
      "after",
      `
What this command does:
  - Looks at the specifics already known for a new motion.
  - Checks whether the URL already exists in Exo.
  - Returns the next missing required or useful question the agent should ask.
  - Does not create or modify the motion.

Use this when:
  - the operator said "set up a new motion"
  - you want to ask one question at a time instead of dumping a whole questionnaire
  - you want a governed point where the agent knows whether it is ready to launch exo motion start

Examples:
  exo motion intake --json
  exo motion intake --url https://example.com/product --json
  exo motion intake --url https://example.com/product --premise "This matters when ..." --audience "Primary ICP" --json
`
    )
    .action((options) => {
      let input;
      let existingStrategy;
      try {
        input = buildMotionDefinitionInput(options, { requireUrl: false });
        existingStrategy = normalizeExistingStrategy(options.existing);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const result = buildMotionIntake(
        {
          ...input,
          launchUserId: options.user ?? null,
          existingStrategy,
          sourceMotionId: options.from ?? null
        },
        listMotions()
      );

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Motion Intake: ${result.status}`);
      if (result.nextQuestion) {
        console.log(`Next Question: ${result.nextQuestion.prompt}`);
      }
      if (result.launchCommandHint) {
        console.log(`Launch Command: ${result.launchCommandHint}`);
      }
      if (result.existingMotions.length) {
        console.log("");
        console.log("Existing URL Matches");
        for (const existingMotion of result.existingMotions) {
          console.log(
            `  ${existingMotion.name}  ${existingMotion.id}  ${existingMotion.status}  premise:${existingMotion.premiseStatus}  audiences:${existingMotion.audienceCount}  signals:${existingMotion.signalCount}`
          );
        }
      }
    });

  addMotionSeedOptions(
    motion
      .command("start")
      .description("Start an outreach motion from an offer URL, checking for existing motions on the same URL before creating anything new.")
      .option("--existing <strategy>", "continue | clone | new")
      .option("--user <user-id>", "Execution user to assign before launch")
      .option("--from <motion-id>", "Existing motion id to continue or clone when multiple motions share the same URL")
  )
    .addHelpText(
      "after",
      `
What this command does:
  - Fetches a lightweight page snapshot from the offer URL so the operator and agent can confirm what is being promoted.
  - Checks whether Exo already has one or more motions for the same URL.
  - If the URL is new, creates a fresh motion using the same seed inputs as exo motion add.
  - If the URL already exists, returns a decision-required result unless you explicitly pass --existing continue|clone|new.

Decision rules:
  - continue: reuse one existing motion for this URL
  - clone: branch one existing motion into a fresh draft
  - new: create a fresh motion from the same URL without reusing the existing one
  - if multiple motions share the URL, pass --from <motion-id> with continue or clone

Examples:
  exo motion start --url https://example.com/product --premise "This offer matters when ..." --audience "Primary ICP" --signal "company::Is there recent evidence that ...?" --json
  exo motion start --url https://example.com/product --existing continue --json
  exo motion start --url https://example.com/product --existing clone --from <motion-id> --audience "Secondary ICP" --json
`
    )
    .action(async (options) => {
      let input;
      let launchUser = null;
      try {
        input = buildMotionDefinitionInput(options);
        if (options.user) {
          launchUser = findUserById(options.user);
          if (!launchUser) {
            throw new Error(`User not found: ${options.user}`);
          }
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      let result;
      try {
        result = await startMotion({
          ...input,
          existingStrategy: normalizeExistingStrategy(options.existing),
          sourceMotionId: options.from ?? null
        }, listMotions());
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      if (result.status === "continued" && launchUser) {
        const maybeAssigned = assignLaunchUserIfNeeded(result.motion, launchUser, {
          assignedBy: "exo-cli",
          reason: "Keep one execution identity for this motion",
        });
        result.motion = maybeAssigned.changed ? updateMotion(maybeAssigned.motion) : maybeAssigned.motion;
      }

      if (result.status === "created" || result.status === "cloned") {
        const motion = launchUser
          ? assignMotionUser(result.motion, launchUser, listBrowserProfiles(), {
              assignedBy: "exo-cli",
              reason: "Keep one execution identity for this motion",
            })
          : result.motion;
        result.motion = insertMotion(motion);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderMotionStartResult(result));
    });

  addMotionSeedOptions(
    motion
      .command("add")
    .description("Create a new offer-driven motion from a product URL, premise, audience hypotheses, and targeting profile.")
  )
    .addHelpText(
      "after",
      `
What this command does:
  - Fetches a lightweight page snapshot from the offer URL.
  - Stores premise, audience hypotheses, targeting, and suppression policy as first-class Exo objects.
  - Seeds pending offer-thesis, target-map, stakeholder-map, and motion-plan state around custom motion signals.

Input tips:
  - Use --premise to capture the prediction you are testing.
  - Exo auto-generates a three-word codename like boring-absurd-meerkat.
  - Use --name only if you need a custom override.
  - Use --audience to name the candidate ICP / audience hypotheses you want to compare.
  - Use --signal for talkable motion-specific signals. Format is scope::question or just question.
  - Use --audience-json or --signal-json when the agent needs richer structured reasoning without going through a config file.
  - Use --config for richer structured motion seeds when flags become too cramped.
  - Use --stakeholder-count to cap how many people the agent should carry into the first outreach plan. Default is 3.
  - Repeat list flags or pass comma-separated values for list-like targeting fields.
  - Audience and signal sentences are preserved as full strings; commas inside them are not split.
  - Use explicit excludes and DNC input up front. Do not defer suppression.
  - Use --json when another agent needs the full motion object.

Examples:
  exo motion add --url https://example.com/product --premise "This offer matters when lenders are entering more complex credit-decision environments." --audience "Traditional FI risk owners" --signal "company::Is there recent evidence that this company expanded into a more complex lending segment?"
  exo motion add --name "midwest-risk-q3" --url https://example.com/product --premise "This offer matters when lenders are entering more complex credit-decision environments."
  exo motion add --url https://example.com/product --industry banking,lending --segment traditional-fi --signal "person::Is there recent evidence that a senior risk owner was hired or promoted at this company?" --json
  exo motion add --config ./actico.motion.json --json
  exo motion add --url https://example.com/product --exclude-domain customer.com --dnc-file ./dnc.csv
`
    )
    .action(async (options) => {
      let input;
      try {
        input = buildMotionDefinitionInput(options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const motion = await defineMotion(input);

      const storedMotion = insertMotion(motion);

      if (options.json) {
        console.log(JSON.stringify(storedMotion, null, 2));
        return;
      }

      console.log(renderMotionSummary(storedMotion));
    });

  motion
    .command("seed")
    .description("Seed a motion directly with a target company or target person when the operator already knows the target.")
    .argument("<motion-id>", "Motion identifier")
    .option("--company <company-id>", "Existing canonical company identifier")
    .option("--company-name <name>", "Company name when creating or reusing a canonical company by identity")
    .option("--domain <domain>", "Company domain when creating or reusing by identity")
    .option("--website-url <url>", "Company website URL when creating a new canonical company")
    .option("--linkedin-company-url <url>", "LinkedIn company URL when creating a new canonical company")
    .option("--logo-source-url <url>", "Source image URL for the company logo when creating a new canonical company")
    .option("--tag <tag>", "Company tag when creating a new canonical company", collect, [])
    .option("--company-notes <notes>", "Canonical company notes when creating a new canonical company")
    .option("--queue-status <status>", "Initial company queue state for company-only seeding: discovered or queued_for_research")
    .option("--queue-notes <notes>", "Queue notes when company-only seeding immediately queues the company for research")
    .option("--person-name <name>", "Target person name for person-first seeding")
    .option("--person-title <title>", "Target person title for person-first seeding")
    .option("--why-relevant <text>", "Short reason this person matters for the motion")
    .option("--linkedin-profile-url <url>", "LinkedIn profile URL for the target person")
    .option("--avatar-source-url <url>", "Source image URL for the target person's avatar")
    .option("--email <email>", "Direct email for the target person when known")
    .option("--buying-committee-role <role>", "Buying committee role for the target person")
    .option("--decision-authority <authority>", "Decision authority: buys, blocks, sponsors, influences, observes, unknown")
    .option("--fit-confidence <level>", "Prospect fit confidence: low, moderate, high, or unknown")
    .option("--source-url <url>", "Source URL for this seeded target evidence")
    .option("--observed-at <datetime>", "Observed timestamp in ISO-8601 format")
    .option("--profile-viewed-at <datetime>", "When the profile was actually viewed in ISO-8601 format")
    .option("--notes <notes>", "Prospect notes for person-first seeding")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Seeds a motion directly when the operator already knows the account or person worth targeting.
  - Supports company-first seeding into the motion backlog.
  - Supports person-first seeding by resolving or creating the related canonical company, then storing the person directly on the motion-owned target account.
  - Keeps seeded targets inside the normal motion queue and prospect path instead of creating sidecar state.

Examples:
  exo motion seed <motion-id> --company <company-id> --json
  exo motion seed <motion-id> --company-name Chainguard --domain chainguard.dev --queue-status queued_for_research --json
  exo motion seed <motion-id> --person-name "Parm Uppal" --person-title "Chief Revenue Officer" --company-name Chainguard --domain chainguard.dev --why-relevant "Known best-fit CRO target for the motion premise." --linkedin-profile-url https://www.linkedin.com/in/example --json

Rules:
  - Pass either --company or --company-name for the company context.
  - Person-first seeding requires --person-name, --person-title, and --why-relevant.
  - Company-only seeding can optionally queue the company for research immediately.
  - Person-first seeding creates or reuses the company context first, then writes the person into motion-owned prospect state.
`
    )
    .action((motionId, options) => {
      const rawMotion = findMotionById(motionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const queueStatus = normalizeMotionDiscoveryQueueStatus(options.queueStatus);
      if (options.queueStatus && !queueStatus) {
        console.error(`Invalid seed queue status: ${options.queueStatus}`);
        process.exitCode = 1;
        return;
      }

      const personName = normalizeNullableCliString(options.personName);
      const personTitle = normalizeNullableCliString(options.personTitle);
      const whyRelevant = normalizeNullableCliString(options.whyRelevant);
      const companySelector = buildMotionSeedCompanySelector(options);

      if (companySelector.error) {
        console.error(companySelector.error);
        process.exitCode = 1;
        return;
      }

      if (options.queueNotes && queueStatus !== "queued_for_research") {
        console.error("--queue-notes is only supported when --queue-status queued_for_research is used.");
        process.exitCode = 1;
        return;
      }

      const isPersonSeed = Boolean(personName || personTitle || whyRelevant);
      if (isPersonSeed && (!personName || !personTitle || !whyRelevant)) {
        console.error("Person-first seeding requires --person-name, --person-title, and --why-relevant.");
        process.exitCode = 1;
        return;
      }

      if (isPersonSeed && options.queueStatus) {
        console.error("--queue-status only applies to company-only seeding. Person-first seeding derives its company and prospect queue state from the stored target.");
        process.exitCode = 1;
        return;
      }

      if (isPersonSeed && options.queueNotes) {
        console.error("--queue-notes only applies to company-only seeding.");
        process.exitCode = 1;
        return;
      }

      let company;
      let createdCompany;
      let linkedCompany;
      try {
        ({ company, createdCompany, linkedCompany } = resolveMotionSeedCompany(motionId, companySelector));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      if (isPersonSeed) {
        try {
          const updatedMotion = recordMotionProspect(rawMotion, company, {
            name: personName,
            title: personTitle,
            whyRelevant,
            linkedinProfileUrl: normalizeNullableCliString(options.linkedinProfileUrl),
            avatarSourceUrl: normalizeNullableCliString(options.avatarSourceUrl),
            email: normalizeNullableCliString(options.email),
            buyingCommitteeRole: options.buyingCommitteeRole,
            decisionAuthority: options.decisionAuthority,
            fitConfidence: options.fitConfidence,
            sourceUrl: normalizeNullableCliString(options.sourceUrl),
            observedAt: normalizeNullableCliString(options.observedAt),
            profileViewedAt: normalizeNullableCliString(options.profileViewedAt),
            notes: normalizeNullableCliString(options.notes)
          });
          const storedMotion = updateMotion(updatedMotion);
          const account = storedMotion.targetMap.accounts.find((item) => item.companyId === company.id) ?? null;
          const prospect = account?.prospects.find((item) =>
            item.name === personName
            && item.title === personTitle
            && (
              !options.linkedinProfileUrl
              || item.linkedinProfileUrl === normalizeNullableCliString(options.linkedinProfileUrl)
            )
          ) ?? null;

          const result = {
            motion: {
              id: storedMotion.id,
              name: storedMotion.name,
              status: storedMotion.status
            },
            company,
            createdCompany,
            linkedCompany,
            account,
            prospect
          };

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          console.log(
            [
              `Motion Seed: ${storedMotion.name}`,
              `Company: ${company.name}`,
              `Created Company: ${createdCompany ? "yes" : "no"}`,
              `Linked To Motion: ${linkedCompany ? "yes" : "already linked"}`,
              `Person: ${prospect?.name ?? personName}`,
              `Title: ${prospect?.title ?? personTitle}`,
              `Prospect Queue: ${prospect?.queueState?.status ?? "selected"}`,
              `Account Queue: ${account?.queueState?.status ?? "selected"}`
            ].join("\n")
          );
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
        return;
      }

      let storedMotion = motionSchema.parse(rawMotion);
      if (queueStatus === "queued_for_research") {
        storedMotion = updateMotion(setMotionTargetAccountQueue(storedMotion, company, {
          status: queueStatus,
          notes: options.queueNotes ?? null
        }));
      }

      const queueSummary = buildMotionQueueSummary(storedMotion, [company], { companyId: company.id });
      const packetSummary = buildMotionPacketSummary(storedMotion, [company], { companyId: company.id });
      const queueItem = queueSummary.items[0] ?? null;
      const packet = packetSummary.items[0] ?? null;
      const result = {
        motion: {
          id: storedMotion.id,
          name: storedMotion.name,
          status: storedMotion.status
        },
        company,
        createdCompany,
        linkedCompany,
        queue: queueItem ? {
          status: queueItem.queueStatus,
          source: queueItem.queueSource,
          signalMatchCount: queueItem.signalMatchCount,
          prospectCount: queueItem.prospectCount,
          readyToSendCount: queueItem.readyToSendCount
        } : null,
        packet
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(
        [
          `Motion Seed: ${storedMotion.name}`,
          `Company: ${company.name}`,
          `Created Company: ${createdCompany ? "yes" : "no"}`,
          `Linked To Motion: ${linkedCompany ? "yes" : "already linked"}`,
          `Queue Status: ${result.queue?.status ?? "discovered"}`,
          `Queue Source: ${result.queue?.source ?? "derived"}`,
          `Packet: ${packet ? `${packet.packetKind} [${packet.claimState}]` : "none"}`
        ].join("\n")
      );
    });

  motion
    .command("discover")
    .description("Create or link a discovered company into a motion backlog so workers can research it.")
    .argument("<motion-id>", "Motion identifier")
    .option("--company <company-id>", "Existing canonical company identifier to link into this motion")
    .option("--name <name>", "Create or reuse a canonical company by name")
    .option("--domain <domain>", "Company domain when creating or reusing by identity")
    .option("--website-url <url>", "Company website URL when creating a new canonical company")
    .option("--linkedin-company-url <url>", "LinkedIn company URL when creating a new canonical company")
    .option("--logo-source-url <url>", "Source image URL for the company logo when creating a new canonical company")
    .option("--tag <tag>", "Company tag when creating a new canonical company", collect, [])
    .option("--notes <notes>", "Canonical company notes when creating a new canonical company")
    .option("--queue-status <status>", "Initial queue state: discovered or queued_for_research")
    .option("--queue-notes <notes>", "Queue notes when immediately queuing the company for research")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Links an existing canonical company into a motion, or creates a new canonical company and links it immediately.
  - Seeds the upstream motion backlog so company-research packets can exist.
  - Optionally puts the company straight into queued_for_research so a worker can claim it next.

Examples:
  exo motion discover <motion-id> --company <company-id> --json
  exo motion discover <motion-id> --company <company-id> --queue-status queued_for_research --queue-notes "Ready for parallel research" --json
  exo motion discover <motion-id> --name Chainguard --domain chainguard.dev --queue-status discovered --json
`
    )
    .action((motionId, options) => {
      const rawMotion = findMotionById(motionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const queueStatus = normalizeMotionDiscoveryQueueStatus(options.queueStatus);
      if (options.queueStatus && !queueStatus) {
        console.error(`Invalid discovery queue status: ${options.queueStatus}`);
        process.exitCode = 1;
        return;
      }

      const hasCompanyId = typeof options.company === "string" && options.company.trim().length > 0;
      const hasCompanyName = typeof options.name === "string" && options.name.trim().length > 0;
      if ((hasCompanyId && hasCompanyName) || (!hasCompanyId && !hasCompanyName)) {
        console.error("Pass exactly one of --company or --name.");
        process.exitCode = 1;
        return;
      }

      if (options.queueNotes && queueStatus !== "queued_for_research") {
        console.error("--queue-notes is only supported when --queue-status queued_for_research is used.");
        process.exitCode = 1;
        return;
      }

      let company;
      let createdCompany;
      let linkedCompany;
      try {
        ({ company, createdCompany, linkedCompany } = resolveMotionSeedCompany(motionId, {
          companyId: hasCompanyId ? options.company : null,
          companyName: hasCompanyName ? options.name : null,
          domain: options.domain ?? null,
          websiteUrl: options.websiteUrl ?? null,
          linkedinCompanyUrl: options.linkedinCompanyUrl ?? null,
          logoSourceUrl: options.logoSourceUrl ?? null,
          tags: normalizeStringList(options.tag),
          notes: options.notes ?? null
        }));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      let storedMotion = motionSchema.parse(rawMotion);
      if (queueStatus === "queued_for_research") {
        storedMotion = updateMotion(setMotionTargetAccountQueue(storedMotion, company, {
          status: queueStatus,
          notes: options.queueNotes ?? null
        }));
      }

      const queueSummary = buildMotionQueueSummary(storedMotion, [company], { companyId: company.id });
      const packetSummary = buildMotionPacketSummary(storedMotion, [company], { companyId: company.id });
      const queueItem = queueSummary.items[0] ?? null;
      const packet = packetSummary.items[0] ?? null;
      const result = {
        motion: {
          id: storedMotion.id,
          name: storedMotion.name,
          status: storedMotion.status
        },
        company,
        createdCompany,
        linkedCompany,
        queue: queueItem ? {
          status: queueItem.queueStatus,
          source: queueItem.queueSource,
          signalMatchCount: queueItem.signalMatchCount,
          prospectCount: queueItem.prospectCount,
          readyToSendCount: queueItem.readyToSendCount
        } : null,
        packet
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(
        [
          `Motion Discovery Intake: ${storedMotion.name}`,
          `Company: ${company.name}`,
          `Created Company: ${createdCompany ? "yes" : "no"}`,
          `Linked To Motion: ${linkedCompany ? "yes" : "already linked"}`,
          `Queue Status: ${result.queue?.status ?? "discovered"}`,
          `Queue Source: ${result.queue?.source ?? "derived"}`,
          `Packet: ${packet ? `${packet.packetKind} [${packet.claimState}]` : "none"}`
        ].join("\n")
      );
    });

  motion
    .command("discovery-brief")
    .description("Build the governed brief for autonomous company discovery on one motion.")
    .argument("<motion-id>", "Motion identifier")
    .option("--companies <count>", "Minimum company count for this discovery pass")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Explains why the motion does or does not need more upstream company discovery.
  - Packages the motion premise, targeting profile, signal questions, and current inventory pressure into one bounded brief.
  - Gives the governed writeback path for landing newly discovered companies into backlog.

Examples:
  exo motion discovery-brief <motion-id> --json
  exo motion discovery-brief <motion-id> --companies 12 --json
`
    )
    .action((motionId, options) => {
      const rawMotion = findMotionById(motionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const parsedCount = parsePositiveInteger(options.companies);
      if (options.companies && parsedCount == null) {
        console.error(`Invalid company count: ${options.companies}`);
        process.exitCode = 1;
        return;
      }

      const brief = buildMotionDiscoveryBrief(rawMotion, listCompanies(), {
        companyCount: parsedCount,
      });

      if (options.json) {
        console.log(JSON.stringify(brief, null, 2));
        return;
      }

      console.log(
        [
          `Motion Discovery Brief: ${brief.motion.name}`,
          `Summary: ${brief.summary}`,
          `Minimum Companies: ${brief.inputs.inventory.targetCompanyCount}`,
          `Available Prospects: ${brief.inputs.inventory.availableProspectCount}/${brief.inputs.inventory.minimumAvailableProspects}`,
          `Projected Prospects After Current Backlog: ${brief.inputs.inventory.projectedAvailableProspectCount}`,
          `Needs Discovery: ${brief.inputs.inventory.needsDiscovery ? "yes" : "no"}`,
        ].join("\n")
      );
    });

  motion
    .command("target")
    .description("Evaluate one motion's targeting loop from preflight through company and prospect readiness.")
    .argument("<motion-id>", "Motion identifier")
    .option("--capability <capability>", "Browser capability required for engagement readiness. Defaults to linkedin.")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Checks the motion preflight: offer URL, premise, audience hypotheses, and signals.
  - Evaluates whether a governed connector path exists for engagement.
  - Walks the linked companies through the targeting loop: company identity, signal matches, prospects, and cadence.
  - Stops at targeting-ready. It does not draft or send messages.

Use this when:
  - you want one governed answer to "how far did this motion get?"
  - you want to know the next missing step before launch
  - you want to see whether the motion is ready to target or ready to engage

Examples:
  exo motion target <motion-id>
  exo motion target <motion-id> --json
  exo motion target <motion-id> --capability linkedin --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const result = evaluateMotionTargeting(raw, listCompanies(), listBrowserProfiles(), listUsers(), {
        capability: options.capability
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderMotionTargetingSummary(result));
    });

  motion
    .command("packets")
    .description("Show motion work packets that can be claimed or are currently claimed by a worker.")
    .argument("<motion-id>", "Motion identifier")
    .option("--company <company-id>", "Filter to one targeted company")
    .option("--status <status>", "Packet claim state: claimable or claimed")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Shows the motion work packets the motion currently exposes, including company research, prospect selection, and prospect research.
  - Tells you which packets are still claimable and which are already claimed.
  - Makes parallel backlog work visible before you open a browser or start research.

Examples:
  exo motion packets <motion-id>
  exo motion packets <motion-id> --status claimable --json
  exo motion packets <motion-id> --company <company-id> --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const status = normalizePacketClaimState(options.status);
      if (options.status && !status) {
        console.error(`Invalid packet status: ${options.status}`);
        process.exitCode = 1;
        return;
      }

      if (options.company) {
        const rawCompany = findCompanyById(options.company);
        if (!rawCompany) {
          console.error(`Company not found: ${options.company}`);
          process.exitCode = 1;
          return;
        }
      }

      const result = buildMotionPacketSummary(raw, listCompanies(), {
        companyId: options.company ?? null,
        status
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderMotionPacketSummary(result));
    });

  motion
    .command("packet-brief")
    .description("Show one packet as a concrete worker brief with scope, done-when, and writeback contract.")
    .argument("<motion-id>", "Motion identifier")
    .requiredOption("--packet <packet-id>", "Packet identifier from exo motion packets")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Turns one active motion packet into a concrete worker brief.
  - Gives the scope, the real inputs, the done-when checks, and the exact writeback commands.
  - Makes packetized delegation usable instead of forcing the operator to infer the contract from raw queue state.

Examples:
  exo motion packet-brief <motion-id> --packet company_research:<company-id>
  exo motion packet-brief <motion-id> --packet prospect_research:<company-id>:<prospect-id> --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      try {
        const result = buildMotionPacketBrief(raw, listCompanies(), options.packet);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(renderMotionPacketBrief(result));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  motion
    .command("prospects")
    .description("Show the targeted prospects stored on one motion, including recent-post warmup and writing-test readiness.")
    .argument("<motion-id>", "Motion identifier")
    .option("--company <company-id>", "Filter to one targeted company")
    .option("--prospect <prospect-id>", "Show one targeted prospect in writing-brief detail")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Flattens the motion's targeted prospects across all linked target accounts.
  - Shows whether each prospect has enough stored state to test a message outside Exo.
  - Shows whether there is a recent-post warmup worth using, instead of forcing the operator to infer that from a raw live-signal blob.
  - Does not generate or send messages. It exposes the stored writing inputs the agent should use.

Examples:
  exo motion prospects <motion-id>
  exo motion prospects <motion-id> --company <company-id> --json
  exo motion prospects <motion-id> --prospect <prospect-id>
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      let result;
      try {
        const rawObservations = loadMotionWritingObservations(motionId, options);
        result = buildMotionProspectView(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect ?? null,
          rawObservations,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (options.prospect) {
        console.log(renderMotionWritingBrief(result));
        return;
      }

      console.log(renderMotionProspectList(result));
    });

  motion
    .command("actions")
    .description("Show the canonical Audienti-style actions for one targeted prospect, including current availability.")
    .argument("<motion-id>", "Motion identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .option("--company <company-id>", "Filter to one targeted company")
    .option("--available-only", "Show only currently-available actions")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Loads the canonical GTM action catalog against one targeted prospect.
  - Tells you which actions are available, blocked, already done, or still unsupported.
  - Keeps action type separate from writing stage, so direct-message and comment actions still point back to the right draft surface.
  - Does not perform anything. It is the readiness and execution-planning layer.

Examples:
  exo motion actions <motion-id> --prospect <prospect-id>
  exo motion actions <motion-id> --prospect <prospect-id> --available-only --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      try {
        const rawObservations = loadMotionWritingObservations(motionId, options);
        const prospectView = buildMotionProspectView(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect,
          rawObservations,
        });
        const rawCompany = prospectView.writingBrief
          ? findCompanyById(prospectView.writingBrief.company.id)
          : null;
        const result = buildMotionActionView(
          raw,
          {
            companyId: options.company ?? null,
            prospectId: options.prospect,
            rawObservations,
            includeUnavailable: !options.availableOnly
          },
          rawCompany
        );

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(renderMotionActionList(result));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  motion
    .command("action-brief")
    .description("Show one compact execution brief for one canonical prospect action.")
    .argument("<motion-id>", "Motion identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .requiredOption("--action <action-key>", "Canonical action key")
    .option("--company <company-id>", "Filter to one targeted company")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Loads one canonical action against one targeted prospect.
  - Returns readiness, the matching draft surface when one exists, execution hints, and the writeback command.
  - Gives the chat enough structure to execute the action outside Exo and then persist the real outcome back.

Examples:
  exo motion action-brief <motion-id> --prospect <prospect-id> --action connection_request --json
  exo motion action-brief <motion-id> --prospect <prospect-id> --action profile_view
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      try {
        const rawObservations = loadMotionWritingObservations(motionId, options);
        const prospectView = buildMotionProspectView(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect,
          rawObservations,
        });
        const rawCompany = prospectView.writingBrief
          ? findCompanyById(prospectView.writingBrief.company.id)
          : null;
        const result = buildMotionActionBrief(
          raw,
          {
            companyId: options.company ?? null,
            prospectId: options.prospect,
            rawObservations,
            action: options.action
          },
          rawCompany
        );

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(renderMotionActionBrief(result));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  motion
    .command("drafts")
    .description("Show Audienti-style draft cases for one targeted prospect without generating or sending the message text.")
    .argument("<motion-id>", "Motion identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .option("--company <company-id>", "Filter to one targeted company")
    .option("--surface <surface>", "Draft surface: connection_request, post_accept_message, follow_up_direct_message, email, inbound_reply, public_comment, or comment_reply")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Maps one targeted prospect into the same high-level touch surfaces Audienti uses.
  - Reads the stored cadence, signal matches, recent-post state, and prior touches.
  - Returns draft cases the agent can write from locally.
  - Does not generate or send the actual message text.

Examples:
  exo motion drafts <motion-id> --prospect <prospect-id>
  exo motion drafts <motion-id> --prospect <prospect-id> --surface connection_request --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      let result;
      try {
        const rawObservations = loadMotionWritingObservations(motionId, options);
        result = buildMotionDraftView(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect,
          rawObservations,
          surface: options.surface ?? null
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderMotionDraftCases(result));
    });

  motion
    .command("draft-brief")
    .description("Show one compact single-surface draft brief the chat can write from locally without sending anything.")
    .argument("<motion-id>", "Motion identifier")
    .requiredOption("--prospect <prospect-id>", "Prospect identifier")
    .requiredOption("--surface <surface>", "Draft surface: connection_request, post_accept_message, follow_up_direct_message, email, inbound_reply, public_comment, or comment_reply")
    .option("--company <company-id>", "Filter to one targeted company")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Pulls one stored prospect plus one stored draft surface into a compact writing brief.
  - Gives the chat a smaller payload than exo motion drafts when you already know which surface you want.
  - Still does not generate or send the message text.

Use this when:
  - you want the chat to write one draft now
  - you want one narrow source-of-truth payload for a single surface
  - you do not want to wade through every other surface on the prospect

Examples:
  exo motion draft-brief <motion-id> --prospect <prospect-id> --surface connection_request
  exo motion draft-brief <motion-id> --prospect <prospect-id> --surface public_comment --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      let result;
      try {
        const rawObservations = loadMotionWritingObservations(motionId, options);
        result = buildMotionDraftBrief(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect,
          rawObservations,
          surface: options.surface
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderMotionDraftBrief(result));
    });

  motion
    .command("clone")
    .description("Clone an existing motion into a new draft, optionally retargeted to a new audience or targeting profile.")
    .argument("<motion-id>", "Source motion identifier")
    .option("--config <path>", "Path to a JSON motion patch file")
    .option("--name <name>", "Optional custom motion name")
    .option("--notes <notes>", "Offer notes")
    .option("--premise <text>", "Operator premise to store on the cloned motion")
    .option("--premise-notes <notes>", "Optional notes about the premise")
    .option("--audience <value>", "Audience hypothesis name; repeat for multiple", collect)
    .option("--audience-json <json>", "Structured audience hypothesis as JSON; repeat for multiple", collect)
    .option(
      "--signal <value>",
      "Signal definition as question text or scope::question, for example company::Is there recent evidence that this company launched a new offering?",
      collect
    )
    .option("--signal-json <json>", "Structured signal definition as JSON; repeat for multiple", collect)
    .option("--geo <value>", "Geolocation filter", collect)
    .option("--icp <value>", "ICP type", collect)
    .option("--industry <value>", "Industry or sub-industry", collect)
    .option("--company-type <value>", "Company type", collect)
    .option("--company-shape <value>", "Company shape", collect)
    .option("--company-size <value>", "Company size band", collect)
    .option("--title <value>", "Target title", collect)
    .option("--role-family <value>", "Target role family", collect)
    .option("--segment <value>", "Segment variant", collect)
    .option("--stakeholder-count <number>", "Maximum number of stakeholders to carry into the first outreach pass")
    .option("--exclude-account <value>", "Excluded account", collect)
    .option("--exclude-domain <value>", "Excluded domain", collect)
    .option("--exclude-contact <value>", "Excluded contact", collect)
    .option("--dnc-file <path>", "Path to a simple do-not-contact file")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Creates a new motion from an existing one instead of forcing you to rebuild the setup from scratch.
  - Gives the clone a fresh id and a fresh generated codename unless you explicitly override the name.
  - Carries over the useful upstream state, then lets you retarget the clone with new audience hypotheses, signals, or targeting.
  - Resets target-map, stakeholder-map, and motion-plan execution state so the clone starts clean.

Use this when:
  - the premise is still right but the audience hypothesis may differ
  - you want a variant for a different segment, title set, or geography
  - you want to branch a motion before testing a more aggressive retargeting change

Examples:
  exo motion clone <motion-id> --audience "BNPL modernization leaders" --segment bnpl --title "GM Lending" --json
  exo motion clone <motion-id> --name "bnpl-risk-q3" --geo "United Kingdom" --industry lending --json
  exo motion clone <motion-id> --config ./motion-clone-patch.json --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const patch = buildMotionPatchFromOptions(options);
      const clonedMotion = cloneMotionDefinition(raw, patch);
      const storedMotion = insertMotion(clonedMotion);

      if (options.json) {
        console.log(JSON.stringify(storedMotion, null, 2));
        return;
      }

      console.log(renderMotionSummary(storedMotion));
    });

  motion
    .command("update")
    .description("Update an existing motion's premise, audience hypotheses, signals, targeting, or suppression state.")
    .argument("<motion-id>", "Motion identifier")
    .option("--config <path>", "Path to a JSON motion patch file")
    .option("--name <name>", "Optional custom motion name")
    .option("--notes <notes>", "Offer notes")
    .option("--premise <text>", "Operator premise to store on this motion")
    .option("--premise-notes <notes>", "Optional notes about the premise")
    .option("--audience <value>", "Audience hypothesis name; repeat for multiple", collect)
    .option("--audience-json <json>", "Structured audience hypothesis as JSON; repeat for multiple", collect)
    .option(
      "--signal <value>",
      "Signal definition as question text or scope::question, for example company::Is there recent evidence that this company launched a new offering?"
      ,
      collect
    )
    .option("--signal-json <json>", "Structured signal definition as JSON; repeat for multiple", collect)
    .option("--geo <value>", "Geolocation filter", collect)
    .option("--icp <value>", "ICP type", collect)
    .option("--industry <value>", "Industry or sub-industry", collect)
    .option("--company-type <value>", "Company type", collect)
    .option("--company-shape <value>", "Company shape", collect)
    .option("--company-size <value>", "Company size band", collect)
    .option("--title <value>", "Target title", collect)
    .option("--role-family <value>", "Target role family", collect)
    .option("--segment <value>", "Segment variant", collect)
    .option("--stakeholder-count <number>", "Maximum number of stakeholders to carry into the first outreach pass")
    .option("--exclude-account <value>", "Excluded account", collect)
    .option("--exclude-domain <value>", "Excluded domain", collect)
    .option("--exclude-contact <value>", "Excluded contact", collect)
    .option("--dnc-file <path>", "Path to a simple do-not-contact file")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Updates the stored motion directly instead of forcing agents through export/import.
  - Replaces the specific slices you provide: premise, audiences, signals, targeting, or suppression.
  - Preserves slices you do not mention.

Update rules:
  - If you pass --audience, the motion's audience hypothesis set is replaced with exactly the values you pass, plus any audience hypotheses from --config.
  - If you pass --signal, the motion's signal set is replaced with exactly the values you pass, plus any signals from --config.
  - If you pass --title, --geo, --segment, or similar targeting flags, only those targeting fields are replaced.
  - Omitted fields are preserved.
  - This command edits the motion object. It does not refresh the source URL; use exo motion refresh for that.

Examples:
  exo motion update <motion-id> --audience "Traditional FI risk owners" --title "Chief Risk Officer" --segment traditional-fi --json
  exo motion update <motion-id> --premise "This offer matters when regulated lenders enter more complex credit-decision environments." --signal "company::Is there recent evidence that this company expanded into a more complex lending segment?" --json
  exo motion update <motion-id> --config ./motion-patch.json --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const patch = buildMotionPatchFromOptions(options);
      const updatedMotion = updateMotionDefinition(raw, patch);
      const storedMotion = updateMotion(updatedMotion);

      if (options.json) {
        console.log(JSON.stringify(storedMotion, null, 2));
        return;
      }

      console.log(renderMotionSummary(storedMotion));
    });

  registerMotionLifecycleCommand(motion, {
    name: "pause",
    description: "Pause a motion without deleting any of its state.",
    successVerb: "Paused",
    unchangedVerb: "already paused",
    helpText: `
Use this when the motion should stop being worked for now but keep all existing research and targeting state.

Examples:
  exo motion pause <motion-id>
  exo motion pause <motion-id> --json
`
  });

  registerMotionLifecycleCommand(motion, {
    name: "resume",
    description: "Resume a paused motion and mark it active again.",
    successVerb: "Resumed",
    unchangedVerb: "already active",
    helpText: `
Use this when a paused motion should become the live working motion again.

Examples:
  exo motion resume <motion-id>
  exo motion resume <motion-id> --json
`
  });

  registerMotionLifecycleCommand(motion, {
    name: "archive",
    description: "Archive a motion while keeping it readable and reusable later.",
    successVerb: "Archived",
    unchangedVerb: "already archived",
    helpText: `
Use this when the motion should stop being an active working object but should remain in history.

Examples:
  exo motion archive <motion-id>
  exo motion archive <motion-id> --json
`
  });

  registerMotionLifecycleCommand(motion, {
    name: "restart",
    description: "Restart a draft, paused, or archived motion and mark it active.",
    successVerb: "Restarted",
    unchangedVerb: "already active",
    helpText: `
Use this when an older motion should become active again without cloning or rebuilding it.

Examples:
  exo motion restart <motion-id>
  exo motion restart <motion-id> --json
`
  });

  motion
    .command("refresh")
    .description("Refresh a stored motion from its source URL and persisted targeting inputs.")
    .argument("<motion-id>", "Motion identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Re-fetches the source page snapshot for the motion URL.
  - Rebuilds the seeded offer-thesis summary.
  - Recomputes the next-step list from the stored premise, audience hypotheses, signals, targeting, and suppression inputs.

Examples:
  exo motion refresh <motion-id>
  exo motion refresh <motion-id> --json
`
    )
    .action(async (motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const refreshed = await refreshMotion(raw);
      const storedMotion = updateMotion(refreshed);

      if (options.json) {
        console.log(JSON.stringify(storedMotion, null, 2));
        return;
      }

      console.log(renderMotionSummary(storedMotion));
    });

  motion
    .command("list")
    .description("List stored motions.")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Use this command first when a shell or agent needs to discover existing motion ids.

Examples:
  exo motion list
  exo motion list --json
`
    )
    .action((options) => {
      const motions = listMotions().map((item) => motionSchema.parse(item));

      if (options.json) {
        console.log(JSON.stringify(motions, null, 2));
        return;
      }

      if (!motions.length) {
        console.log("No motions found.");
        return;
      }

      for (const item of motions) {
        console.log(`${item.name}  ${item.id}  ${item.status}  created:${item.createdAt}  updated:${item.updatedAt}  ${item.offer.sourceUrl}`);
      }
    });

  motion
    .command("show")
    .description("Show a stored motion.")
    .argument("<motion-id>", "Motion identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Use this command when a human needs a readable summary or an agent needs the full stored motion object.

Examples:
  exo motion show <motion-id>
  exo motion show <motion-id> --json
`
    )
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const motion = motionSchema.parse(raw);

      if (options.json) {
        console.log(JSON.stringify(motion, null, 2));
        return;
      }

      console.log(renderMotionSummary(motion));
    });

  motionProfile
    .command("assign")
    .description("Assign one registered browser profile to a motion as the default execution identity.")
    .argument("<motion-id>", "Motion identifier")
    .requiredOption("--profile <profile-id>", "Browser profile identifier")
    .option("--by <actor>", "Who made the assignment")
    .option("--reason <reason>", "Why this profile is being assigned")
    .option("--json", "Emit machine-readable JSON")
    .action((motionId, options) => {
      const rawMotion = findMotionById(motionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const rawProfile = findBrowserProfileById(options.profile);
      if (!rawProfile) {
        console.error(`Browser profile not found: ${options.profile}`);
        process.exitCode = 1;
        return;
      }

      const profile = browserProfileSchema.parse(rawProfile);
      if (profile.status !== "ready") {
        console.error(`Browser profile is not ready: ${profile.id} (${profile.status})`);
        process.exitCode = 1;
        return;
      }

      let updated;
      try {
        updated = assignMotionProfile(rawMotion, rawProfile, {
          assignedBy: options.by ?? null,
          reason: options.reason ?? null
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }
      updateMotion(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(`Motion ${updated.name} is now assigned to profile ${updated.engagementProfileAssignment?.label ?? profile.label}.`);
    });

  motionProfile
    .command("show")
    .description("Show the sticky browser profile default for a motion.")
    .argument("<motion-id>", "Motion identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((motionId, options) => {
      const rawMotion = findMotionById(motionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const motionRecord = motionSchema.parse(rawMotion);
      const profile = motionRecord.engagementProfileAssignment
        ? findBrowserProfileById(motionRecord.engagementProfileAssignment.profileId)
        : null;
      const result = {
        motion: {
          id: motionRecord.id,
          name: motionRecord.name,
          status: motionRecord.status
        },
        assignment: motionRecord.engagementProfileAssignment,
        profile
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.assignment) {
        console.log(`No sticky browser profile assignment for motion ${motionRecord.name}.`);
        return;
      }

      console.log(`Motion ${motionRecord.name} is assigned to ${result.assignment.label} (${result.assignment.browser} / ${result.assignment.profileDirectory}).`);
    });

  motionUser
    .command("assign")
    .description("Assign one execution user to a motion so linked companies inherit the same default identity.")
    .argument("<motion-id>", "Motion identifier")
    .requiredOption("--user <user-id>", "Execution user identifier")
    .option("--account <capability:handle>", "Assign one exact account ref for this motion assignment; repeat for multiple capabilities", collect, [])
    .option("--by <actor>", "Who made the assignment")
    .option("--reason <reason>", "Why this user is being assigned")
    .option("--json", "Emit machine-readable JSON")
    .action((motionId, options) => {
      const rawMotion = findMotionById(motionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const rawUser = findUserById(options.user);
      if (!rawUser) {
        console.error(`User not found: ${options.user}`);
        process.exitCode = 1;
        return;
      }

      let updated;
      try {
        updated = assignMotionUser(rawMotion, rawUser, listBrowserProfiles(), {
          assignedBy: options.by ?? null,
          reason: options.reason ?? null,
          accountRefs: normalizeStringList(options.account)
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }
      updateMotion(updated);

      if (options.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(`Motion ${updated.name} is now assigned to user ${updated.engagementUserAssignment?.label ?? options.user}.`);
    });

  motionUser
    .command("show")
    .description("Show the sticky execution-user default for a motion.")
    .argument("<motion-id>", "Motion identifier")
    .option("--json", "Emit machine-readable JSON")
    .action((motionId, options) => {
      const rawMotion = findMotionById(motionId);
      if (!rawMotion) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const motionRecord = motionSchema.parse(rawMotion);
      const user = motionRecord.engagementUserAssignment
        ? findUserById(motionRecord.engagementUserAssignment.userId)
        : null;
      const result = {
        motion: {
          id: motionRecord.id,
          name: motionRecord.name,
          status: motionRecord.status
        },
        assignment: motionRecord.engagementUserAssignment,
        user
      };

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.assignment) {
        console.log(`No sticky execution user assignment for motion ${motionRecord.name}.`);
        return;
      }

      console.log(`Motion ${motionRecord.name} is assigned to user ${result.assignment.label}.`);
    });

  motion
    .command("remove")
    .description("Remove a stored motion and unlink it from canonical companies.")
    .argument("<motion-id>", "Motion identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
Use this when a motion should no longer exist at all, not when it should merely stop being the focus.

Examples:
  exo motion remove <motion-id>
  exo motion remove <motion-id> --json
`
    )
    .action(async (motionId, options) => {
      try {
        const result = await removeMotionGoverned({ motionId });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
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
 * @param {string} value
 * @param {string[]} previous
 * @returns {string[]}
 */
function collect(value, previous) {
  if (!previous) {
    return [value];
  }
  previous.push(value);
  return previous;
}

/**
 * @param {import("commander").Command} motion
 * @param {{
 *   name: "pause" | "resume" | "archive" | "restart",
 *   description: string,
 *   successVerb: string,
 *   unchangedVerb: string,
 *   helpText: string
 * }} input
 */
function registerMotionLifecycleCommand(motion, input) {
  motion
    .command(input.name)
    .description(input.description)
    .argument("<motion-id>", "Motion identifier")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText("after", input.helpText)
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      let result;
      try {
        result = transitionMotionStatus(raw, input.name);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
      }

      const storedMotion = result.changed ? updateMotion(result.motion) : result.motion;

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              action: input.name,
              changed: result.changed,
              motion: storedMotion
            },
            null,
            2
          )
        );
        return;
      }

      if (result.changed) {
        console.log(`${input.successVerb} motion ${storedMotion.name} (${storedMotion.id}).`);
      } else {
        console.log(`Motion ${storedMotion.name} (${storedMotion.id}) is ${input.unchangedVerb}.`);
      }
      console.log("");
      console.log(renderMotionSummary(storedMotion));
    });
}

/**
 * @param {string | undefined} filePath
 * @returns {{
 *   name?: string,
 *   url?: string,
 *   offer?: { sourceUrl?: string, offerNotes?: string | null },
 *   offerNotes?: string | null,
 *   premise?: { statement?: string | null, notes?: string | null, source?: "operator" | "inferred" | "mixed" },
 *   audienceHypotheses?: Array<string | {
 *     id?: string,
 *     name: string,
 *     companyCriteria?: string[],
 *     roleCriteria?: string[],
 *     notes?: string | null,
 *     confidence?: "low" | "moderate" | "high" | "unknown"
 *   }>,
 *   signals?: Array<string | {
 *     id?: string,
 *     name?: string,
 *     question: string,
 *     scope?: "company" | "person" | "both",
 *     whyItMatters?: string | null,
 *     matchRule?: string | null,
 *     audienceIds?: string[],
 *     observationMethods?: Array<{
 *       surface: "google" | "sales-navigator" | "linkedin" | "company-site" | "news" | "manual" | "other",
 *       query?: string | null,
 *       notes?: string | null
 *     }>,
 *     status?: "draft" | "ready"
 *   }>,
 *   targetingProfile?: {
 *     geolocations?: string[],
 *     icpTypes?: string[],
 *     industries?: string[],
 *     companyTypes?: string[],
 *     companyShapes?: string[],
 *     companySizes?: string[],
 *     targetTitles?: string[],
 *     roleFamilies?: string[],
 *     segmentVariants?: string[],
 *     stakeholderTargetCount?: number
 *   },
 *   suppressionPolicy?: {
 *     excludedAccounts?: string[],
 *     excludedDomains?: string[],
 *     excludedContacts?: string[],
 *     doNotContactEntries?: string[],
 *     doNotContactSources?: string[],
 *     crmCustomerSuppressionEnabled?: boolean,
 *     crmOpportunitySuppressionEnabled?: boolean
 *   }
 * }}
 */
function loadMotionSeedConfig(filePath) {
  if (!filePath) {
    return {};
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

/**
 * @param {import("commander").Command} command
 */
function addMotionSeedOptions(command) {
  return command
    .option("--config <path>", "Path to a JSON motion seed file")
    .option("--name <name>", "Optional custom motion name")
    .option("--url <url>", "Product or offer URL")
    .option("--notes <notes>", "Offer notes")
    .option("--premise <text>", "Operator premise to test in this motion")
    .option("--premise-notes <notes>", "Optional notes about the premise")
    .option("--audience <value>", "Audience hypothesis name; repeat for multiple", collect, [])
    .option("--audience-json <json>", "Structured audience hypothesis as JSON; repeat for multiple", collect, [])
    .option(
      "--signal <value>",
      "Signal definition as question text or scope::question, for example company::Is there recent evidence that this company launched a new offering?",
      collect,
      []
    )
    .option("--signal-json <json>", "Structured signal definition as JSON; repeat for multiple", collect, [])
    .option("--geo <value>", "Geolocation filter", collect, [])
    .option("--icp <value>", "ICP type", collect, [])
    .option("--industry <value>", "Industry or sub-industry", collect, [])
    .option("--company-type <value>", "Company type", collect, [])
    .option("--company-shape <value>", "Company shape", collect, [])
    .option("--company-size <value>", "Company size band", collect, [])
    .option("--title <value>", "Target title", collect, [])
    .option("--role-family <value>", "Target role family", collect, [])
    .option("--segment <value>", "Segment variant", collect, [])
    .option("--stakeholder-count <number>", "Maximum number of stakeholders to carry into the first outreach pass")
    .option("--exclude-account <value>", "Excluded account", collect, [])
    .option("--exclude-domain <value>", "Excluded domain", collect, [])
    .option("--exclude-contact <value>", "Excluded contact", collect, [])
    .option("--dnc-file <path>", "Path to a simple do-not-contact file")
    .option("--json", "Emit machine-readable JSON");
}

/**
 * @param {Record<string, any>} options
 * @param {{ requireUrl?: boolean }} [settings]
 * @returns {Parameters<typeof defineMotion>[0]}
 */
function buildMotionDefinitionInput(options, settings = {}) {
  const configInput = loadMotionSeedConfig(options.config);
  const dncEntries = loadDoNotContactEntries(options.dncFile);
  const url = options.url ?? configInput.url ?? configInput.offer?.sourceUrl;

  if (settings.requireUrl !== false && !url) {
    throw new Error("Motion URL is required. Pass --url or include url in --config.");
  }

  return {
    url: url ?? null,
    name: options.name ?? configInput.name ?? null,
    offerNotes: options.notes ?? configInput.offerNotes ?? configInput.offer?.offerNotes ?? null,
    premise: {
      ...configInput.premise,
      statement: options.premise ?? configInput.premise?.statement ?? null,
      notes: options.premiseNotes ?? configInput.premise?.notes ?? null
    },
    audienceHypotheses: buildAudienceInputs(configInput, options),
    signals: buildSignalInputs(configInput, options),
    targetingProfile: {
      geolocations: mergeStringInputs(configInput.targetingProfile?.geolocations, options.geo),
      icpTypes: mergeStringInputs(configInput.targetingProfile?.icpTypes, options.icp),
      industries: mergeStringInputs(configInput.targetingProfile?.industries, options.industry),
      companyTypes: mergeStringInputs(configInput.targetingProfile?.companyTypes, options.companyType),
      companyShapes: mergeStringInputs(configInput.targetingProfile?.companyShapes, options.companyShape),
      companySizes: mergeStringInputs(configInput.targetingProfile?.companySizes, options.companySize),
      targetTitles: mergeStringInputs(configInput.targetingProfile?.targetTitles, options.title),
      roleFamilies: mergeStringInputs(configInput.targetingProfile?.roleFamilies, options.roleFamily),
      segmentVariants: mergeStringInputs(configInput.targetingProfile?.segmentVariants, options.segment),
      stakeholderTargetCount: options.stakeholderCount ?? configInput.targetingProfile?.stakeholderTargetCount
    },
    suppressionPolicy: {
      excludedAccounts: mergeStringInputs(configInput.suppressionPolicy?.excludedAccounts, options.excludeAccount),
      excludedDomains: mergeStringInputs(configInput.suppressionPolicy?.excludedDomains, options.excludeDomain),
      excludedContacts: mergeStringInputs(configInput.suppressionPolicy?.excludedContacts, options.excludeContact),
      doNotContactEntries: [
        ...(configInput.suppressionPolicy?.doNotContactEntries ?? []),
        ...dncEntries
      ],
      doNotContactSources: [
        ...(configInput.suppressionPolicy?.doNotContactSources ?? []),
        ...(options.dncFile ? [options.dncFile] : [])
      ],
      crmCustomerSuppressionEnabled: configInput.suppressionPolicy?.crmCustomerSuppressionEnabled ?? false,
      crmOpportunitySuppressionEnabled:
        configInput.suppressionPolicy?.crmOpportunitySuppressionEnabled ?? false
    }
  };
}

/**
 * @param {string | undefined} value
 * @returns {"continue" | "clone" | "new" | null}
 */
function normalizeExistingStrategy(value) {
  if (value === undefined) {
    return null;
  }

  if (value === "continue" || value === "clone" || value === "new") {
    return value;
  }

  throw new Error(`Invalid --existing strategy: ${value}`);
}

/**
 * @param {import("../../schema/motion.js").motionSchema._type} rawMotion
 * @param {import("../../schema/user.js").userSchema._type} rawUser
 * @param {{ assignedBy?: string | null, reason?: string | null, force?: boolean }} [options]
 */
function assignLaunchUserIfNeeded(rawMotion, rawUser, options = {}) {
  const assignedUserId = rawMotion.engagementUserAssignment?.userId ?? null;
  if (assignedUserId === rawUser.id) {
    return { motion: rawMotion, changed: false };
  }
  if (assignedUserId && !options.force) {
    return { motion: rawMotion, changed: false };
  }
  return {
    motion: assignMotionUser(rawMotion, rawUser, listBrowserProfiles(), {
      assignedBy: options.assignedBy ?? null,
      reason: options.reason ?? null,
    }),
    changed: true,
  };
}

/**
 * @param {string | undefined} value
 * @returns {"claimable" | "claimed" | null}
 */
function normalizePacketClaimState(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "claimable" || normalized === "claimed") {
    return normalized;
  }

  return null;
}

/**
 * @param {string | undefined} value
 * @returns {"discovered" | "queued_for_research" | null}
 */
function normalizeMotionDiscoveryQueueStatus(value) {
  if (!value) {
    return "discovered";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "discovered" || normalized === "queued_for_research") {
    return normalized;
  }

  return null;
}

/**
 * @param {Record<string, any>} options
 */
function buildMotionSeedCompanySelector(options) {
  const companyId = normalizeNullableCliString(options.company);
  const companyName = normalizeNullableCliString(options.companyName);
  const hasCompanyId = Boolean(companyId);
  const hasCompanyName = Boolean(companyName);

  if ((hasCompanyId && hasCompanyName) || (!hasCompanyId && !hasCompanyName)) {
    return {
      error: "Pass exactly one of --company or --company-name."
    };
  }

  return {
    error: null,
    companyId,
    companyName,
    domain: normalizeNullableCliString(options.domain),
    websiteUrl: normalizeNullableCliString(options.websiteUrl),
    linkedinCompanyUrl: normalizeNullableCliString(options.linkedinCompanyUrl),
    logoSourceUrl: normalizeNullableCliString(options.logoSourceUrl),
    tags: normalizeStringList(options.tag),
    notes: normalizeNullableCliString(options.companyNotes)
  };
}

/**
 * @param {string} motionId
 * @param {{
 *   companyId?: string | null | undefined,
 *   companyName?: string | null | undefined,
 *   domain?: string | null | undefined,
 *   websiteUrl?: string | null | undefined,
 *   linkedinCompanyUrl?: string | null | undefined,
 *   logoSourceUrl?: string | null | undefined,
 *   tags?: string[] | null | undefined,
 *   notes?: string | null | undefined
 * }} input
 */
function resolveMotionSeedCompany(motionId, input) {
  if (input.companyId) {
    const rawCompany = findCompanyById(input.companyId);
    if (!rawCompany) {
      throw new Error(`Company not found: ${input.companyId}`);
    }

    const updatedCompany = linkCompanyToMotion(rawCompany, motionId);
    const company = companySchema.parse(updatedCompany);
    const alreadyLinked = companySchema.parse(rawCompany).motionIds.includes(motionId);
    if (!alreadyLinked) {
      updateCompany(company);
    }

    return {
      company,
      createdCompany: false,
      linkedCompany: !alreadyLinked
    };
  }

  if (!input.companyName) {
    throw new Error("Company name is required when --company is not used.");
  }

  const existing = findCompanyByIdentity(input.companyName, input.domain ?? null);
  if (existing) {
    const updatedCompany = linkCompanyToMotion(existing, motionId);
    const company = companySchema.parse(updatedCompany);
    const alreadyLinked = companySchema.parse(existing).motionIds.includes(motionId);
    if (!alreadyLinked) {
      updateCompany(company);
    }

    return {
      company,
      createdCompany: false,
      linkedCompany: !alreadyLinked
    };
  }

  const company = addCompany({
    name: input.companyName,
    domain: input.domain ?? null,
    websiteUrl: input.websiteUrl ?? null,
    linkedinCompanyUrl: input.linkedinCompanyUrl ?? null,
    logoSourceUrl: input.logoSourceUrl ?? null,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
    motionIds: [motionId]
  });
  insertCompany(company);

  return {
    company,
    createdCompany: true,
    linkedCompany: true
  };
}

/**
 * @param {unknown} value
 */
function normalizeNullableCliString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {unknown} value
 */
function parsePositiveInteger(value) {
  if (typeof value !== "string" || !value.trim().length) {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * @param {string[] | undefined} baseValues
 * @param {string[] | undefined} cliValues
 * @returns {string[]}
 */
function mergeStringInputs(baseValues, cliValues) {
  return normalizeStringList([...(baseValues ?? []), ...(cliValues ?? [])]);
}

/**
 * @param {ReturnType<typeof loadMotionSeedConfig>} configInput
 * @param {Record<string, any>} options
 */
function buildAudienceInputs(configInput, options) {
  return [
    ...(configInput.audienceHypotheses ?? []),
    ...parseStructuredItems(options.audienceJson, "audience"),
    ...normalizeTextItems(options.audience)
  ];
}

/**
 * @param {ReturnType<typeof loadMotionSeedConfig>} configInput
 * @param {Record<string, any>} options
 */
function buildSignalInputs(configInput, options) {
  return [
    ...(configInput.signals ?? []),
    ...parseStructuredItems(options.signalJson, "signal"),
    ...normalizeTextItems(options.signal)
  ];
}

/**
 * @param {string[] | undefined} values
 * @returns {string[]}
 */
function normalizeTextItems(values) {
  if (!values) {
    return [];
  }

  return [...new Set(
    values
      .map((value) => value.trim())
      .filter(Boolean)
  )];
}

/**
 * @param {string[] | undefined} values
 * @param {string} label
 * @returns {Record<string, any>[]}
 */
function parseStructuredItems(values, label) {
  if (!values) {
    return [];
  }

  return values.map((value) => {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${label} JSON must decode to an object`);
      }
      return parsed;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ${label} JSON: ${reason}`);
    }
  });
}

/**
 * @param {Record<string, any>} options
 * @returns {Parameters<typeof updateMotionDefinition>[1]}
 */
function buildMotionPatchFromOptions(options) {
  const configInput = loadMotionSeedConfig(options.config);
  const configTargeting = configInput.targetingProfile ?? {};
  const configSuppression = configInput.suppressionPolicy ?? {};
  const dncEntries = loadDoNotContactEntries(options.dncFile);

  /** @type {Parameters<typeof updateMotionDefinition>[1]} */
  const patch = {};

  if (options.name !== undefined || hasOwn(configInput, "name")) {
    patch.name = options.name ?? configInput.name ?? null;
  }

  if (
    options.notes !== undefined ||
    hasOwn(configInput, "offerNotes") ||
    hasOwn(configInput.offer ?? {}, "offerNotes")
  ) {
    patch.offerNotes = options.notes ?? configInput.offerNotes ?? configInput.offer?.offerNotes ?? null;
  }

  if (
    options.premise !== undefined ||
    options.premiseNotes !== undefined ||
    hasOwn(configInput, "premise")
  ) {
    patch.premise = {
      statement: options.premise ?? configInput.premise?.statement,
      notes: options.premiseNotes ?? configInput.premise?.notes,
      source: configInput.premise?.source
    };
  }

  if (
    options.audience !== undefined ||
    options.audienceJson !== undefined ||
    hasOwn(configInput, "audienceHypotheses")
  ) {
    patch.audienceHypotheses = buildAudienceInputs(configInput, options);
  }

  if (
    options.signal !== undefined ||
    options.signalJson !== undefined ||
    hasOwn(configInput, "signals")
  ) {
    patch.signals = buildSignalInputs(configInput, options);
  }

  const targetingPatch = buildTargetingPatch(configTargeting, options);
  if (Object.keys(targetingPatch).length) {
    patch.targetingProfile = targetingPatch;
  }

  const suppressionPatch = buildSuppressionPatch(configSuppression, options, dncEntries);
  if (Object.keys(suppressionPatch).length) {
    patch.suppressionPolicy = suppressionPatch;
  }

  return patch;
}

/**
 * @param {NonNullable<ReturnType<typeof loadMotionSeedConfig>["targetingProfile"]>} configTargeting
 * @param {Record<string, any>} options
 */
function buildTargetingPatch(configTargeting, options) {
  /** @type {Partial<ReturnType<typeof import("../../schema/targeting-profile.js").targetingProfileSchema.parse>>} */
  const targetingPatch = {};

  if (options.geo !== undefined || hasOwn(configTargeting, "geolocations")) {
    targetingPatch.geolocations = mergeStringInputs(configTargeting.geolocations, options.geo);
  }
  if (options.icp !== undefined || hasOwn(configTargeting, "icpTypes")) {
    targetingPatch.icpTypes = mergeStringInputs(configTargeting.icpTypes, options.icp);
  }
  if (options.industry !== undefined || hasOwn(configTargeting, "industries")) {
    targetingPatch.industries = mergeStringInputs(configTargeting.industries, options.industry);
  }
  if (options.companyType !== undefined || hasOwn(configTargeting, "companyTypes")) {
    targetingPatch.companyTypes = mergeStringInputs(configTargeting.companyTypes, options.companyType);
  }
  if (options.companyShape !== undefined || hasOwn(configTargeting, "companyShapes")) {
    targetingPatch.companyShapes = mergeStringInputs(configTargeting.companyShapes, options.companyShape);
  }
  if (options.companySize !== undefined || hasOwn(configTargeting, "companySizes")) {
    targetingPatch.companySizes = mergeStringInputs(configTargeting.companySizes, options.companySize);
  }
  if (options.title !== undefined || hasOwn(configTargeting, "targetTitles")) {
    targetingPatch.targetTitles = mergeStringInputs(configTargeting.targetTitles, options.title);
  }
  if (options.roleFamily !== undefined || hasOwn(configTargeting, "roleFamilies")) {
    targetingPatch.roleFamilies = mergeStringInputs(configTargeting.roleFamilies, options.roleFamily);
  }
  if (options.segment !== undefined || hasOwn(configTargeting, "segmentVariants")) {
    targetingPatch.segmentVariants = mergeStringInputs(configTargeting.segmentVariants, options.segment);
  }
  if (options.stakeholderCount !== undefined || hasOwn(configTargeting, "stakeholderTargetCount")) {
    targetingPatch.stakeholderTargetCount = options.stakeholderCount ?? configTargeting.stakeholderTargetCount;
  }

  return targetingPatch;
}

/**
 * @param {NonNullable<ReturnType<typeof loadMotionSeedConfig>["suppressionPolicy"]>} configSuppression
 * @param {Record<string, any>} options
 * @param {string[]} dncEntries
 */
function buildSuppressionPatch(configSuppression, options, dncEntries) {
  /** @type {Partial<ReturnType<typeof import("../../schema/suppression-policy.js").suppressionPolicySchema.parse>>} */
  const suppressionPatch = {};

  if (options.excludeAccount !== undefined || hasOwn(configSuppression, "excludedAccounts")) {
    suppressionPatch.excludedAccounts = mergeStringInputs(configSuppression.excludedAccounts, options.excludeAccount);
  }
  if (options.excludeDomain !== undefined || hasOwn(configSuppression, "excludedDomains")) {
    suppressionPatch.excludedDomains = mergeStringInputs(configSuppression.excludedDomains, options.excludeDomain);
  }
  if (options.excludeContact !== undefined || hasOwn(configSuppression, "excludedContacts")) {
    suppressionPatch.excludedContacts = mergeStringInputs(configSuppression.excludedContacts, options.excludeContact);
  }
  if (
    options.dncFile !== undefined ||
    hasOwn(configSuppression, "doNotContactEntries") ||
    hasOwn(configSuppression, "doNotContactSources")
  ) {
    suppressionPatch.doNotContactEntries = [
      ...(configSuppression.doNotContactEntries ?? []),
      ...dncEntries
    ];
    suppressionPatch.doNotContactSources = [
      ...(configSuppression.doNotContactSources ?? []),
      ...(options.dncFile ? [options.dncFile] : [])
    ];
  }
  if (hasOwn(configSuppression, "crmCustomerSuppressionEnabled")) {
    suppressionPatch.crmCustomerSuppressionEnabled = configSuppression.crmCustomerSuppressionEnabled;
  }
  if (hasOwn(configSuppression, "crmOpportunitySuppressionEnabled")) {
    suppressionPatch.crmOpportunitySuppressionEnabled = configSuppression.crmOpportunitySuppressionEnabled;
  }

  return suppressionPatch;
}

/**
 * @param {object} value
 * @param {string} key
 * @returns {boolean}
 */
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
