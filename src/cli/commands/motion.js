#!/usr/bin/env node
// @ts-check

import fs from "node:fs";
import path from "node:path";
import { cloneMotionDefinition } from "../../core/clone-motion.js";
import { defineMotion } from "../../core/define-motion.js";
import { evaluateMotionTargeting } from "../../core/evaluate-motion-targeting.js";
import { refreshMotion } from "../../core/refresh-motion.js";
import { startMotion } from "../../core/start-motion.js";
import { updateMotionDefinition } from "../../core/update-motion.js";
import {
  deleteMotion,
  findMotionById,
  insertMotion,
  listBrowserProfiles,
  listCompanies,
  listMotions,
  updateCompany,
  updateMotion
} from "../../db/database.js";
import { normalizeStringList } from "../../lib/collections.js";
import { loadDoNotContactEntries } from "../../lib/dnc.js";
import { renderMotionStartResult, renderMotionSummary, renderMotionTargetingSummary } from "../../artifacts/render-motion.js";
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
  exo motion start
  exo motion add
  exo motion target
  exo motion clone
  exo motion update
  exo motion refresh
  exo motion list
  exo motion show
  exo motion remove
`
    );

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

      const result = evaluateMotionTargeting(raw, listCompanies(), listBrowserProfiles(), {
        capability: options.capability
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(renderMotionTargetingSummary(result));
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
        console.log(`${item.name}  ${item.id}  ${item.status}  ${item.offer.sourceUrl}`);
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
 * @returns {Parameters<typeof defineMotion>[0]}
 */
function buildMotionDefinitionInput(options) {
  const configInput = loadMotionSeedConfig(options.config);
  const dncEntries = loadDoNotContactEntries(options.dncFile);
  const url = options.url ?? configInput.url ?? configInput.offer?.sourceUrl;

  if (!url) {
    throw new Error("Motion URL is required. Pass --url or include url in --config.");
  }

  return {
    url,
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
