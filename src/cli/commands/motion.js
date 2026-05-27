#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import path from "node:path";
import { cloneMotionDefinition } from "../../core/clone-motion.js";
import { buildMotionActionBrief, buildMotionActionView } from "../../core/build-motion-action-view.js";
import { buildMotionIntake } from "../../core/build-motion-intake.js";
import { defineMotion } from "../../core/define-motion.js";
import { buildMotionDraftBrief, buildMotionDraftView } from "../../core/build-motion-draft-view.js";
import { buildMotionProspectView } from "../../core/build-motion-prospect-view.js";
import { evaluateMotionTargeting } from "../../core/evaluate-motion-targeting.js";
import { refreshMotion } from "../../core/refresh-motion.js";
import { startMotion } from "../../core/start-motion.js";
import { transitionMotionStatus } from "../../core/transition-motion-status.js";
import { updateMotionDefinition } from "../../core/update-motion.js";
import {
  deleteMotion,
  findCompanyById,
  findMotionById,
  insertMotion,
  listBrowserProfiles,
  listCompanies,
  listMotions,
  listUsers,
  updateCompany,
  updateMotion
} from "../../db/database.js";
import { normalizeStringList } from "../../lib/collections.js";
import { loadDoNotContactEntries } from "../../lib/dnc.js";
import {
  renderMotionActionBrief,
  renderMotionActionList,
  renderMotionDraftCases,
  renderMotionDraftBrief,
  renderMotionProspectList,
  renderMotionStartResult,
  renderMotionSummary,
  renderMotionTargetingSummary,
  renderMotionWritingBrief
} from "../../artifacts/render-motion.js";
import { companySchema } from "../../schema/company.js";
import { motionSchema } from "../../schema/motion.js";

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
  exo motion target
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
  exo motion remove
`
    );

  addMotionSeedOptions(
    motion
      .command("intake")
      .description("Inspect partial new-motion input and return the next question the agent should ask before launch.")
      .option("--existing <strategy>", "continue | clone | new")
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
      try {
        input = buildMotionDefinitionInput(options);
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

      if (result.status === "created" || result.status === "cloned") {
        result.motion = insertMotion(result.motion);
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
  - Evaluates whether a trusted browser identity exists for engagement.
  - Walks the linked companies through the targeting loop: company identity, signal matches, prospects, through-lines, opening plans, and cadence.
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
        result = buildMotionProspectView(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect ?? null
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
        const prospectView = buildMotionProspectView(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect
        });
        const rawCompany = prospectView.writingBrief
          ? findCompanyById(prospectView.writingBrief.company.id)
          : null;
        const result = buildMotionActionView(
          raw,
          {
            companyId: options.company ?? null,
            prospectId: options.prospect,
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
        const prospectView = buildMotionProspectView(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect
        });
        const rawCompany = prospectView.writingBrief
          ? findCompanyById(prospectView.writingBrief.company.id)
          : null;
        const result = buildMotionActionBrief(
          raw,
          {
            companyId: options.company ?? null,
            prospectId: options.prospect,
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
  - Reads the stored through-line, opening plan, cadence, signal matches, recent-post state, and prior touches.
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
        result = buildMotionDraftView(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect,
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
        result = buildMotionDraftBrief(raw, {
          companyId: options.company ?? null,
          prospectId: options.prospect,
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
    .action((motionId, options) => {
      const raw = findMotionById(motionId);

      if (!raw) {
        console.error(`Motion not found: ${motionId}`);
        process.exitCode = 1;
        return;
      }

      const motion = motionSchema.parse(raw);
      const now = new Date().toISOString();
      const updatedCompanies = listCompanies()
        .map((item) => companySchema.parse(item))
        .filter((company) => company.motionIds.includes(motionId))
        .map((company) => {
          const updatedCompany = companySchema.parse({
            ...company,
            updatedAt: now,
            motionIds: company.motionIds.filter((id) => id !== motionId)
          });
          updateCompany(updatedCompany);
          return updatedCompany;
        });

      deleteMotion(motionId);

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              removedMotion: motion,
              updatedCompanies
            },
            null,
            2
          )
        );
        return;
      }

      console.log(
        `Removed motion ${motion.name} (${motion.id}) and unlinked ${updatedCompanies.length} compan${updatedCompanies.length === 1 ? "y" : "ies"}.`
      );
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
