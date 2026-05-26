// @ts-check

import { z } from "zod";

const stringArray = z.array(z.string().trim().min(1)).default([]);

export const suppressionPolicySchema = z.object({
  excludedAccounts: stringArray,
  excludedDomains: stringArray,
  excludedContacts: stringArray,
  doNotContactEntries: stringArray,
  doNotContactSources: stringArray,
  crmCustomerSuppressionEnabled: z.boolean().default(false),
  crmOpportunitySuppressionEnabled: z.boolean().default(false)
});

