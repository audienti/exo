// @ts-check

import { companySchema } from "../schema/company.js";
import { motionSchema } from "../schema/motion.js";
import { buildMotionQueueSummary, withDerivedTargetAccountQueueState } from "../lib/motion-queue.js";
import { MINIMUM_AVAILABLE_PROSPECTS } from "./evaluate-motion-targeting.js";

const CONSERVATIVE_DISCOVERY_YIELD_CAP = 2;

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 */
export function buildMotionDiscoveryDemand(rawMotion, rawCompanies) {
  const motion = motionSchema.parse(rawMotion);
  const companies = normalizeLinkedMotionCompanies(motion, rawCompanies);
  const queue = buildMotionQueueSummary(motion, companies);
  const stakeholderTargetCount = normalizeStakeholderTargetCount(motion.targetingProfile?.stakeholderTargetCount);
  const projectedAvailableProspectCount = estimateProjectedAvailableProspects(motion, companies, stakeholderTargetCount);
  const deficitAfterBacklog = Math.max(MINIMUM_AVAILABLE_PROSPECTS - projectedAvailableProspectCount, 0);
  const autonomousEligible = isEligibleForAutonomousDiscovery(motion);
  const expectedProspectYieldPerCompany = normalizeDiscoveryYieldPerCompany(stakeholderTargetCount);
  const targetCompanyCount = deficitAfterBacklog > 0
    ? Math.max(1, Math.ceil(deficitAfterBacklog / expectedProspectYieldPerCompany))
    : 0;

  return {
    motion,
    companies,
    queue,
    minimumAvailableProspects: MINIMUM_AVAILABLE_PROSPECTS,
    linkedCompanyCount: companies.length,
    stakeholderTargetCount,
    expectedProspectYieldPerCompany,
    availableProspectCount: queue.availableProspectCount ?? 0,
    projectedAvailableProspectCount,
    deficitAfterBacklog,
    targetCompanyCount,
    autonomousEligible,
    needsDiscovery: targetCompanyCount > 0,
  };
}

/**
 * @param {unknown} rawMotion
 * @param {unknown[]} rawCompanies
 * @param {{ companyCount?: number | null | undefined }} [options]
 */
export function buildMotionDiscoveryBrief(rawMotion, rawCompanies, options = {}) {
  const demand = buildMotionDiscoveryDemand(rawMotion, rawCompanies);
  const companySignals = demand.motion.signals
    .filter((signal) => signal.scope === "company" || signal.scope === "both")
    .map((signal) => ({
      id: signal.id,
      name: signal.name,
      question: signal.question,
      whyItMatters: signal.whyItMatters,
      matchRule: signal.matchRule,
      observationMethods: signal.observationMethods,
    }));
  const targetCompanyCount = Number.isInteger(options.companyCount) && Number(options.companyCount) > 0
    ? Number(options.companyCount)
    : (demand.targetCompanyCount > 0 ? demand.targetCompanyCount : 1);

  return {
    motion: {
      id: demand.motion.id,
      name: demand.motion.name,
      status: demand.motion.status,
      sourceUrl: demand.motion.offer.sourceUrl,
      premise: demand.motion.premise.statement,
    },
    summary: `Find at least ${targetCompanyCount} new compan${targetCompanyCount === 1 ? "y" : "ies"} that match the motion premise closely enough to justify governed backlog.`,
    scope: {
      kind: "company_discovery",
      focus: `${demand.motion.name} only. Add companies, not people, in this task.`,
      constraints: [
        "Use public web retrieval only. Do not use browser tools or live Sales Navigator.",
        "Add only companies that fit the premise, target profile, and signal questions well enough to merit downstream research.",
        "Do not manufacture prospects in this task. Stop at company backlog creation.",
        "Treat the requested company count as a floor, not a ceiling. If the same search sweep yields more strong-fit companies, land them before you stop.",
        "Avoid duplicate companies. Reuse canonical identity when it already exists in Exo.",
      ],
    },
    inputs: {
      inventory: {
        minimumAvailableProspects: MINIMUM_AVAILABLE_PROSPECTS,
        availableProspectCount: demand.availableProspectCount,
        projectedAvailableProspectCount: demand.projectedAvailableProspectCount,
        deficitAfterBacklog: demand.deficitAfterBacklog,
        linkedCompanyCount: demand.linkedCompanyCount,
        targetCompanyCount,
        expectedProspectYieldPerCompany: demand.expectedProspectYieldPerCompany,
        autonomousEligible: demand.autonomousEligible,
        needsDiscovery: demand.needsDiscovery,
      },
      targeting: {
        audienceHypotheses: demand.motion.audienceHypotheses.map((audience) => ({
          id: audience.id,
          name: audience.name,
          companyCriteria: audience.companyCriteria,
          roleCriteria: audience.roleCriteria,
          confidence: audience.confidence,
        })),
        targetTitles: demand.motion.targetingProfile.targetTitles,
        roleFamilies: demand.motion.targetingProfile.roleFamilies,
        industries: demand.motion.targetingProfile.industries,
        geolocations: demand.motion.targetingProfile.geolocations,
        stakeholderTargetCount: demand.stakeholderTargetCount,
      },
      signals: companySignals,
      existingBacklog: demand.companies.map((company) => ({
        id: company.id,
        name: company.name,
        domain: company.domain,
        queueStatus: demand.queue.items.find((item) => item.companyId === company.id)?.queueStatus ?? "discovered",
      })),
    },
    doneWhen: [
      `At least ${targetCompanyCount} new compan${targetCompanyCount === 1 ? "y is" : "ies are"} linked into the motion backlog, unless the public web genuinely cannot support that many matches.`,
      "Each added company has a real identity spine: name plus domain or canonical website when you can find it.",
      "Each added company is strong enough to justify downstream research. No filler accounts.",
      "New companies are queued so company-research packets can be claimed immediately after discovery.",
      "If the search space is exhausted before the target count is met, return that explicitly instead of inventing weak fits.",
    ],
    writeback: {
      supportingCommands: [
        `exo motion discover ${demand.motion.id} --name "Company Name" --domain company.com --website-url https://company.com --linkedin-company-url <linkedin-company-url> --queue-status queued_for_research --queue-notes "Discovered automatically from motion signals." --json`,
        `exo companies update <company-id> --website-url https://company.com --linkedin-company-url <linkedin-company-url> --json`,
      ],
    },
  };
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 */
function isEligibleForAutonomousDiscovery(motion) {
  return motion.status === "active"
    && motion.premise.status === "defined"
    && motion.audienceHypotheses.length > 0
    && motion.signals.length > 0;
}

/**
 * @param {number} stakeholderTargetCount
 */
function normalizeDiscoveryYieldPerCompany(stakeholderTargetCount) {
  return Math.max(1, Math.min(stakeholderTargetCount, CONSERVATIVE_DISCOVERY_YIELD_CAP));
}

/**
 * @param {unknown} value
 */
function normalizeStakeholderTargetCount(value) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 3;
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {unknown[]} rawCompanies
 */
function normalizeLinkedMotionCompanies(motion, rawCompanies) {
  return Array.isArray(rawCompanies)
    ? rawCompanies
      .map((company) => companySchema.parse(company))
      .filter((company) => Array.isArray(company.motionIds) && company.motionIds.includes(motion.id))
      .sort((left, right) => left.name.localeCompare(right.name))
    : [];
}

/**
 * @param {import("../schema/motion.js").motionSchema._type} motion
 * @param {import("../schema/company.js").companySchema._type[]} companies
 * @param {number} stakeholderTargetCount
 */
function estimateProjectedAvailableProspects(motion, companies, stakeholderTargetCount) {
  const accountsByCompanyId = new Map(
    (motion.targetMap?.accounts ?? [])
      .map((account) => withDerivedTargetAccountQueueState(account))
      .map((account) => [account.companyId, account]),
  );

  return companies.reduce((sum, company) => {
    const account = accountsByCompanyId.get(company.id) ?? null;
    return sum + estimateProjectedAccountProspects(account, stakeholderTargetCount);
  }, 0);
}

/**
 * @param {ReturnType<typeof withDerivedTargetAccountQueueState> | null} account
 * @param {number} stakeholderTargetCount
 */
function estimateProjectedAccountProspects(account, stakeholderTargetCount) {
  const queueStatus = account?.queueState?.status ?? "discovered";
  if (queueStatus === "suppressed" || queueStatus === "exhausted") {
    return 0;
  }

  const activeProspectCount = Array.isArray(account?.prospects)
    ? account.prospects.filter((prospect) => !["suppressed", "exhausted"].includes(prospect.queueState?.status ?? "")).length
    : 0;

  return Math.max(activeProspectCount, stakeholderTargetCount);
}
