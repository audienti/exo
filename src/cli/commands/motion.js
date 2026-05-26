#!/usr/bin/env node
// @ts-check

import { defineMotion } from "../../core/define-motion.js";
import { insertMotion, findMotionById, listMotions } from "../../db/database.js";
import { normalizeStringList } from "../../lib/collections.js";
import { loadDoNotContactEntries } from "../../lib/dnc.js";
import { renderMotionSummary } from "../../artifacts/render-motion.js";
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
  exo motion add
  exo motion list
  exo motion show

Use this noun-first form instead of the older top-level motion commands.
`
    );

  motion
    .command("add")
    .description("Create a new offer-driven motion from a product URL and targeting profile.")
    .requiredOption("--url <url>", "Product or offer URL")
    .option("--notes <notes>", "Offer notes")
    .option("--geo <value>", "Geolocation filter", collect, [])
    .option("--icp <value>", "ICP type", collect, [])
    .option("--industry <value>", "Industry or sub-industry", collect, [])
    .option("--company-type <value>", "Company type", collect, [])
    .option("--company-shape <value>", "Company shape", collect, [])
    .option("--company-size <value>", "Company size band", collect, [])
    .option("--title <value>", "Target title", collect, [])
    .option("--role-family <value>", "Target role family", collect, [])
    .option("--segment <value>", "Segment variant", collect, [])
    .option("--exclude-account <value>", "Excluded account", collect, [])
    .option("--exclude-domain <value>", "Excluded domain", collect, [])
    .option("--exclude-contact <value>", "Excluded contact", collect, [])
    .option("--dnc-file <path>", "Path to a simple do-not-contact file")
    .option("--json", "Emit machine-readable JSON")
    .addHelpText(
      "after",
      `
What this command does:
  - Fetches a lightweight page snapshot from the offer URL.
  - Stores targeting and suppression policy as first-class Exo objects.
  - Seeds pending offer-thesis, signal-set, target-map, stakeholder-map, and motion-plan state.

Input tips:
  - Repeat list flags or pass comma-separated values. Both work.
  - Use explicit excludes and DNC input up front. Do not defer suppression.
  - Use --json when another agent needs the full motion object.

Examples:
  exo motion add --url https://example.com/product --geo "United States" --title "Chief Risk Officer"
  exo motion add --url https://example.com/product --industry banking,lending --segment traditional-fi --json
  exo motion add --url https://example.com/product --exclude-domain customer.com --dnc-file ./dnc.csv
`
    )
    .action(async (options) => {
      const dncEntries = loadDoNotContactEntries(options.dncFile);

      const motion = await defineMotion({
        url: options.url,
        offerNotes: options.notes ?? null,
        targetingProfile: {
          geolocations: normalizeStringList(options.geo),
          icpTypes: normalizeStringList(options.icp),
          industries: normalizeStringList(options.industry),
          companyTypes: normalizeStringList(options.companyType),
          companyShapes: normalizeStringList(options.companyShape),
          companySizes: normalizeStringList(options.companySize),
          targetTitles: normalizeStringList(options.title),
          roleFamilies: normalizeStringList(options.roleFamily),
          segmentVariants: normalizeStringList(options.segment)
        },
        suppressionPolicy: {
          excludedAccounts: normalizeStringList(options.excludeAccount),
          excludedDomains: normalizeStringList(options.excludeDomain),
          excludedContacts: normalizeStringList(options.excludeContact),
          doNotContactEntries: dncEntries,
          doNotContactSources: options.dncFile ? [options.dncFile] : [],
          crmCustomerSuppressionEnabled: false,
          crmOpportunitySuppressionEnabled: false
        }
      });

      insertMotion(motion);

      if (options.json) {
        console.log(JSON.stringify(motion, null, 2));
        return;
      }

      console.log(renderMotionSummary(motion));
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
        console.log(`${item.id}  ${item.status}  ${item.offer.sourceUrl}`);
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
}

/**
 * @param {string} value
 * @param {string[]} previous
 * @returns {string[]}
 */
function collect(value, previous) {
  previous.push(value);
  return previous;
}
