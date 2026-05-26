// @ts-check

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @returns {string}
 */
export function renderMotionSummary(motion) {
  const lines = [
    `Motion: ${motion.id}`,
    `Status: ${motion.status}`,
    `URL: ${motion.offer.sourceUrl}`,
    `Created: ${motion.createdAt}`,
    "",
    "Targeting Profile",
    `  Geolocations: ${joinOrNone(motion.targetingProfile.geolocations)}`,
    `  ICP Types: ${joinOrNone(motion.targetingProfile.icpTypes)}`,
    `  Industries: ${joinOrNone(motion.targetingProfile.industries)}`,
    `  Company Types: ${joinOrNone(motion.targetingProfile.companyTypes)}`,
    `  Company Shapes: ${joinOrNone(motion.targetingProfile.companyShapes)}`,
    `  Company Sizes: ${joinOrNone(motion.targetingProfile.companySizes)}`,
    `  Target Titles: ${joinOrNone(motion.targetingProfile.targetTitles)}`,
    `  Role Families: ${joinOrNone(motion.targetingProfile.roleFamilies)}`,
    `  Segment Variants: ${joinOrNone(motion.targetingProfile.segmentVariants)}`,
    "",
    "Suppression Policy",
    `  Excluded Accounts: ${joinOrNone(motion.suppressionPolicy.excludedAccounts)}`,
    `  Excluded Domains: ${joinOrNone(motion.suppressionPolicy.excludedDomains)}`,
    `  Excluded Contacts: ${joinOrNone(motion.suppressionPolicy.excludedContacts)}`,
    `  DNC Entries: ${motion.suppressionPolicy.doNotContactEntries.length}`,
    `  DNC Sources: ${joinOrNone(motion.suppressionPolicy.doNotContactSources)}`,
    "",
    "Offer Thesis Seed",
    `  Source Title: ${motion.offerThesis.sourceTitle ?? "none"}`,
    `  Source Description: ${motion.offerThesis.sourceDescription ?? "none"}`,
    `  Source Summary: ${motion.offerThesis.sourceSummary}`,
    `  Status: ${motion.offerThesis.status}`,
    "",
    "Next Steps"
  ];

  for (const step of motion.nextSteps) {
    lines.push(`  - ${step}`);
  }

  return lines.join("\n");
}

/**
 * @param {string[]} values
 * @returns {string}
 */
function joinOrNone(values) {
  return values.length ? values.join(", ") : "none";
}

