// @ts-check

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { insertMotion } from "../../src/db/database.js";
import { motionViewSchema } from "../../src/schema/motion.js";
import { prospectSchema, targetAccountSchema } from "../../src/schema/target-account.js";

export const fixtureNow = "2026-06-10T08:00:00.000Z";

/**
 * @template T
 * @param {({ stateDir }: { stateDir: string }) => T} callback
 * @param {{ prefix?: string }} [options]
 * @returns {T}
 */
export function withIsolatedExoState(callback, options = {}) {
  const previousStateDir = process.env.EXO_STATE_DIR;
  const previousHomeStateDir = process.env.EXO_HOME_STATE_DIR;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix ?? "exo-test-"));
  process.env.EXO_STATE_DIR = stateDir;
  delete process.env.EXO_HOME_STATE_DIR;

  const cleanup = () => {
    if (previousStateDir === undefined) {
      delete process.env.EXO_STATE_DIR;
    } else {
      process.env.EXO_STATE_DIR = previousStateDir;
    }
    if (previousHomeStateDir === undefined) {
      delete process.env.EXO_HOME_STATE_DIR;
    } else {
      process.env.EXO_HOME_STATE_DIR = previousHomeStateDir;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  };

  try {
    const result = callback({ stateDir });
    if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
      return /** @type {T} */ (result.finally(cleanup));
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * @param {Record<string, any>} [overrides]
 */
export function buildMotionView(overrides = {}) {
  const sourceUrl = overrides.offer?.sourceUrl ?? "https://hydrate.example";
  const view = mergePlainObjects({
    id: "motion-hydrate",
    name: "hydrate-motion",
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
    status: "active",
    offer: {
      sourceUrl,
      offerNotes: "Offer notes",
    },
    premise: {
      statement: "Hydration matters when rows replace blobs.",
      notes: null,
      source: "operator",
      status: "defined",
    },
    targetingProfile: {},
    suppressionPolicy: {},
    offerThesis: {
      sourceUrl,
      sourceTitle: "Hydrate",
      sourceDescription: "Hydrated motion test",
      sourceSummary: "Hydrated motion test",
      offerNotes: "Offer notes",
      problemThesis: null,
      buyerImpactThesis: null,
      likelyTriggerThesis: null,
      likelyRoleThesis: null,
      likelySegmentThesis: null,
      status: "seeded",
    },
    audienceHypotheses: [],
    signals: [],
    targetMap: {
      status: "pending",
      accounts: [],
      segments: [],
    },
    stakeholderMap: {
      status: "pending",
      stakeholders: [],
    },
    motionPlan: {
      status: "pending",
      variants: [],
    },
    nextSteps: [],
    engagementProfileAssignment: null,
    engagementUserAssignment: null,
  }, overrides);

  return motionViewSchema.parse(view);
}

/**
 * @param {Record<string, any>} [view]
 */
export function seedMotionView(view = {}) {
  return insertMotion(buildMotionView(view));
}

/**
 * @param {Record<string, any>} [overrides]
 */
export function buildTargetAccount(overrides = {}) {
  return targetAccountSchema.parse(mergePlainObjects({
    companyId: "company-fixture",
    companyName: "Fixture Co",
    domain: "fixture.example",
    websiteUrl: "https://fixture.example",
    linkedinCompanyUrl: null,
    companyLogoSourceUrl: null,
    companyLogoUrl: null,
    signalMatches: [],
    prospects: [],
    queueState: {
      status: "selected",
      source: "manual",
      updatedAt: fixtureNow,
      notes: null,
    },
    disposition: "active",
    packetStatus: null,
    packetState: null,
    lastResearchAt: null,
    notes: null,
  }, overrides));
}

/**
 * @param {Record<string, any>} company
 * @param {{ motionIds?: string[] }} [options]
 */
export function buildCompanyView(company, options = {}) {
  return {
    ...company,
    logoSourceUrl: company.logoSourceUrl ?? null,
    logoUrl: company.logoUrl ?? null,
    notes: company.notes ?? null,
    tags: company.tags ?? [],
    motionIds: company.motionIds ?? options.motionIds ?? [],
    engagementProfileAssignment: company.engagementProfileAssignment ?? null,
    engagementUserAssignment: company.engagementUserAssignment ?? null,
  };
}

/**
 * @param {string} id
 * @param {Record<string, any>} [overrides]
 */
export function buildExecutionUser(id, overrides = {}) {
  return mergePlainObjects({
    id,
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
    label: "Fixture User",
    owner: "operator",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00",
    },
    accounts: [],
    harnessConnections: [],
  }, overrides);
}

/**
 * @param {Record<string, any>} [overrides]
 */
export function buildProspect(overrides = {}) {
  return prospectSchema.parse(mergePlainObjects({
    id: "prospect-fixture",
    name: "Pat Prospect",
    title: "VP Revenue",
    linkedinProfileUrl: "https://www.linkedin.com/in/pat-prospect/",
    avatarSourceUrl: null,
    avatarUrl: null,
    email: null,
    buyingCommitteeRole: "other",
    decisionAuthority: "unknown",
    fitConfidence: "moderate",
    whyRelevant: "In scope for the normalized fixture.",
    sourceUrl: "https://www.linkedin.com/in/pat-prospect/",
    observedAt: fixtureNow,
    profileViewedAt: null,
    roleTruth: {},
    triggerWindow: {},
    identityTells: {},
    linkedinProfileSnapshot: {},
    liveSignal: {},
    publicEngagementSelection: null,
    contactPoints: [],
    contactEnrichmentState: {},
    queueState: {
      status: "selected",
      source: "manual",
      updatedAt: fixtureNow,
      notes: null,
    },
    disposition: "active",
    packetStatus: null,
    packetState: null,
    notes: null,
    signalMatchIds: [],
    touches: [],
    cadenceState: {},
    drafts: [],
    timelineNotes: [],
  }, overrides));
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {Record<string, any>} base
 * @param {Record<string, any>} overrides
 */
function mergePlainObjects(base, overrides) {
  const output = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergePlainObjects(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}
