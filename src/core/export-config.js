// @ts-check

import { listBrowserProfiles, listCompanies, listMotions, listUsers } from "../db/database.js";
import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { configBundleSchema, configMotionSchema } from "../schema/config-bundle.js";
import { userSchema } from "../schema/user.js";
import { EXO_VERSION } from "../lib/exo-version.js";

export function exportConfigBundle() {
  const motions = listMotions().map((item) => configMotionSchema.parse(item));
  const browserProfiles = listBrowserProfiles().map((item) => browserProfileSchema.parse(item));
  const companies = listCompanies().map((item) => companySchema.parse(item));
  const users = listUsers().map((item) => userSchema.parse(item));

  return configBundleSchema.parse({
    kind: "exo-config",
    schemaVersion: "1",
    exportedAt: new Date().toISOString(),
    exoVersion: EXO_VERSION,
    motions,
    browserProfiles,
    companies,
    users
  });
}
