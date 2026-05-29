// @ts-check

import { companySchema } from "../schema/company.js";
import { updateCompanyRecord } from "./update-company.js";

/**
 * @param {unknown} rawCompany
 * @param {string} motionId
 */
export function linkCompanyToMotion(rawCompany, motionId) {
  const company = companySchema.parse(rawCompany);
  if (company.motionIds.includes(motionId)) {
    return company;
  }

  return updateCompanyRecord(company, {
    motionIds: [...company.motionIds, motionId]
  });
}
