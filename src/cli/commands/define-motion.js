#!/usr/bin/env node
// @ts-check

import { defineMotion } from "../../core/define-motion.js";
import { insertMotion } from "../../db/database.js";
import { normalizeStringList } from "../../lib/collections.js";
import { loadDoNotContactEntries } from "../../lib/dnc.js";
import { renderMotionSummary } from "../../artifacts/render-motion.js";

/**
 * @param {import("commander").Command} program
 */
export function registerDefineMotion(program) {
  program
    .command("define-motion")
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

