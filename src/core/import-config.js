// @ts-check

import {
  findBrowserProfileById,
  findBrowserProfileByPath,
  findCompanyById,
  findCompanyByIdentity,
  findMotionById,
  insertBrowserProfile,
  insertCompany,
  insertMotion,
  updateBrowserProfile,
  updateCompany,
  updateMotion
} from "../db/database.js";
import { browserProfileSchema } from "../schema/browser-profile.js";
import { companySchema } from "../schema/company.js";
import { configBundleSchema } from "../schema/config-bundle.js";
import { motionSchema } from "../schema/motion.js";
import { retestBrowserProfile } from "./retest-browser-profile.js";

/**
 * @param {unknown} rawConfigBundle
 */
export function importConfigBundle(rawConfigBundle) {
  const bundle = configBundleSchema.parse(rawConfigBundle);

  let insertedMotions = 0;
  let updatedMotions = 0;
  let insertedBrowserProfiles = 0;
  let updatedBrowserProfiles = 0;
  let insertedCompanies = 0;
  let updatedCompanies = 0;

  for (const rawMotion of bundle.motions) {
    const motion = motionSchema.parse(rawMotion);

    if (findMotionById(motion.id)) {
      updateMotion(motion);
      updatedMotions += 1;
      continue;
    }

    insertMotion(motion);
    insertedMotions += 1;
  }

  for (const rawProfile of bundle.browserProfiles) {
    const profile = browserProfileSchema.parse(rawProfile);
    const existingByPath = findBrowserProfileByPath(profile.profilePath);
    const retestedProfile = retestBrowserProfile(
      existingByPath
        ? {
            ...profile,
            id: browserProfileSchema.parse(existingByPath).id
          }
        : profile
    );

    if (findBrowserProfileById(retestedProfile.id)) {
      updateBrowserProfile(retestedProfile);
      updatedBrowserProfiles += 1;
      continue;
    }

    insertBrowserProfile(retestedProfile);
    insertedBrowserProfiles += 1;
  }

  for (const rawCompany of bundle.companies) {
    const company = companySchema.parse(rawCompany);
    const existingByIdentity = findCompanyByIdentity(company.name, company.domain);

    if (findCompanyById(company.id)) {
      updateCompany(company);
      updatedCompanies += 1;
      continue;
    }

    if (existingByIdentity) {
      const localCompany = companySchema.parse(existingByIdentity);
      updateCompany(
        companySchema.parse({
          ...company,
          id: localCompany.id,
          createdAt: localCompany.createdAt
        })
      );
      updatedCompanies += 1;
      continue;
    }

    insertCompany(company);
    insertedCompanies += 1;
  }

  return {
    importedAt: new Date().toISOString(),
    source: {
      exportedAt: bundle.exportedAt,
      exoVersion: bundle.exoVersion,
      schemaVersion: bundle.schemaVersion
    },
    counts: {
      motions: {
        inserted: insertedMotions,
        updated: updatedMotions,
        total: bundle.motions.length
      },
      browserProfiles: {
        inserted: insertedBrowserProfiles,
        updated: updatedBrowserProfiles,
        total: bundle.browserProfiles.length
      },
      companies: {
        inserted: insertedCompanies,
        updated: updatedCompanies,
        total: bundle.companies.length
      }
    }
  };
}
