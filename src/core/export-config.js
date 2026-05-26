// @ts-check

import { listBrowserProfiles, listCompanies, listMotions } from "../db/database.js";
import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { configBundleSchema } from "../schema/config-bundle.js";
import { motionSchema } from "../schema/motion.js";

export const EXO_VERSION = "0.1.0";

export function exportConfigBundle() {
  const motions = listMotions().map((item) => motionSchema.parse(item));
  const browserProfiles = listBrowserProfiles().map((item) => browserProfileSchema.parse(item));
  const companies = listCompanies().map((item) => companySchema.parse(item));

  return configBundleSchema.parse({
    kind: "exo-config",
    schemaVersion: "1",
    exportedAt: new Date().toISOString(),
    exoVersion: EXO_VERSION,
    motions,
    browserProfiles,
    companies
  });
}
