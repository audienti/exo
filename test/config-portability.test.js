// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { exportConfigBundle } from "../src/core/export-config.js";
import { importConfigBundle } from "../src/core/import-config.js";
import { rehydrateMotion } from "../src/core/rehydrate-motion.js";
import { getLocalDatabase, findMotionById } from "../src/db/database.js";
import { configBundleSchema } from "../src/schema/config-bundle.js";
import {
  buildMotionView,
  buildProspect,
  buildTargetAccount,
  fixtureNow,
  seedMotionView,
  withIsolatedExoState,
} from "./support/normalized-fixtures.js";

test("config export emits motion core without normalized execution state", () => {
  withIsolatedExoState(() => {
    seedMotionView({
      id: "motion-export-core-only",
      name: "export-core-only",
      offer: { sourceUrl: "https://example.com/export-core-only" },
      targetMap: {
        status: "ready",
        accounts: [
          buildTargetAccount({
            companyId: "company-export-leak",
            companyName: "Export Leak Co",
            prospects: [
              buildProspect({
                id: "prospect-export-leak",
                name: "Pat Portable",
                title: "VP Sales",
                linkedinProfileUrl: "https://www.linkedin.com/in/pat-portable/",
                sourceUrl: "https://www.linkedin.com/in/pat-portable/",
                whyRelevant: "Should not be exported in config bundles.",
                touches: [
                  {
                    id: "touch-export-leak",
                    surface: "email",
                    direction: "outbound",
                    outcome: "sent",
                    occurredAt: fixtureNow,
                    summary: "Sent a portable config regression touch.",
                  },
                ],
                drafts: [
                  {
                    id: "draft-export-leak",
                    surface: "email",
                    channel: "email",
                    subject: "Portable config",
                    body: "This draft should stay out of config export.",
                    status: "ready",
                    authoredBy: "agent",
                    editedByOperator: false,
                    approvedByOperator: false,
                    createdAt: fixtureNow,
                    updatedAt: fixtureNow,
                    approvedAt: null,
                    sentAt: null,
                    notes: null,
                  },
                ],
              }),
            ],
          }),
        ],
      },
    });

    const exported = exportConfigBundle();
    const encoded = JSON.stringify(exported);

    assert.equal(exported.motions.length, 1);
    assert.equal("targetMap" in exported.motions[0], false);
    assert.equal(encoded.includes("prospect-export-leak"), false);
    assert.equal(encoded.includes("touch-export-leak"), false);
    assert.equal(encoded.includes("draft-export-leak"), false);
  }, { prefix: "exo-config-export-core-" });
});

test("config import strips legacy targetMap execution state before writing rows", () => {
  withIsolatedExoState(() => {
    const legacyMotion = buildMotionView({
      id: "motion-import-core-only",
      name: "import-core-only",
      offer: { sourceUrl: "https://example.com/import-core-only" },
      targetMap: {
        status: "ready",
        accounts: [
          buildTargetAccount({
            companyId: "company-import-leak",
            companyName: "Import Leak Co",
            prospects: [
              buildProspect({
                id: "prospect-import-leak",
                name: "Ivy Import",
                title: "Chief Revenue Officer",
                linkedinProfileUrl: "https://www.linkedin.com/in/ivy-import/",
                sourceUrl: "https://www.linkedin.com/in/ivy-import/",
                whyRelevant: "Legacy execution state must not seed normalized rows.",
              }),
            ],
          }),
        ],
      },
    });
    const bundle = buildConfigBundle([legacyMotion]);

    const parsed = configBundleSchema.parse(bundle);
    assert.equal("targetMap" in parsed.motions[0], false);

    const result = importConfigBundle(bundle);
    const imported = findMotionById(legacyMotion.id);

    assert.equal(result.counts.motions.inserted, 1);
    assert.ok(imported);
    assert.equal(imported.targetMap.accounts.length, 0);
    assert.equal(tableCount("motion_accounts"), 0);
    assert.equal(tableCount("prospects"), 0);
    assert.equal(tableCount("prospect_drafts"), 0);
    assert.equal(tableCount("activity_events"), 0);
    assert.equal(tableCount("signal_matches"), 0);
  }, { prefix: "exo-config-import-core-" });
});

test("config import updates playbooks without replacing local execution rows", () => {
  withIsolatedExoState(() => {
    const existing = seedMotionView({
      id: "motion-import-update-core",
      name: "import-update-core-before",
      offer: { sourceUrl: "https://example.com/import-update-core" },
      targetMap: {
        status: "ready",
        accounts: [
          buildTargetAccount({
            companyId: "company-local-execution",
            companyName: "Local Execution Co",
            prospects: [
              buildProspect({
                id: "prospect-local-execution",
                name: "Lena Local",
                title: "VP Revenue",
                linkedinProfileUrl: "https://www.linkedin.com/in/lena-local/",
                sourceUrl: "https://www.linkedin.com/in/lena-local/",
                whyRelevant: "Existing local execution state must survive config import.",
              }),
            ],
          }),
        ],
      },
    });
    const importedLegacyMotion = buildMotionView({
      id: existing.id,
      name: "import-update-core-after",
      offer: { sourceUrl: "https://example.com/import-update-core" },
      targetMap: {
        status: "ready",
        accounts: [
          buildTargetAccount({
            companyId: "company-imported-execution",
            companyName: "Imported Execution Co",
            prospects: [
              buildProspect({
                id: "prospect-imported-execution",
                name: "Imani Imported",
                title: "VP Sales",
                linkedinProfileUrl: "https://www.linkedin.com/in/imani-imported/",
                sourceUrl: "https://www.linkedin.com/in/imani-imported/",
                whyRelevant: "Imported execution state should be ignored.",
              }),
            ],
          }),
        ],
      },
    });

    const result = importConfigBundle(buildConfigBundle([importedLegacyMotion]));
    const stored = findMotionById(existing.id);

    assert.equal(result.counts.motions.updated, 1);
    assert.ok(stored);
    assert.equal(stored.name, "import-update-core-after");
    assert.deepEqual(
      stored.targetMap.accounts.flatMap((account) => account.prospects.map((prospect) => prospect.id)),
      ["prospect-local-execution"]
    );
    assert.equal(
      stored.targetMap.accounts.some((account) => account.companyId === "company-imported-execution"),
      false
    );
  }, { prefix: "exo-config-import-update-" });
});

test("rehydrateMotion does not repair legacy target-account stakeholders into prospects", () => {
  const rawMotion = buildMotionView({
    id: "motion-no-prospect-repair",
    name: "no-prospect-repair",
    offer: { sourceUrl: "https://example.com/no-prospect-repair" },
    targetMap: {
      status: "ready",
      accounts: [
        buildTargetAccount({
          companyId: "company-legacy-stakeholder",
          companyName: "Legacy Stakeholder Co",
        }),
      ],
    },
  });
  const legacyMotion = JSON.parse(JSON.stringify(rawMotion));
  delete legacyMotion.targetMap.accounts[0].prospects;
  legacyMotion.targetMap.accounts[0].stakeholders = [
    {
      id: "legacy-stakeholder-leak",
      name: "Stella Stakeholder",
      title: "VP Revenue",
      linkedinProfileUrl: "https://www.linkedin.com/in/stella-stakeholder/",
      email: null,
      roleType: "primary-owner",
      fitConfidence: "high",
      whyRelevant: "This old account shape must not be converted into a prospect.",
      sourceUrl: "https://www.linkedin.com/in/stella-stakeholder/",
      observedAt: fixtureNow,
      profileViewedAt: null,
      notes: null,
      signalMatchIds: [],
    },
  ];
  legacyMotion.targetMap.accounts[0].outreachPlan = {
    status: "ready",
    primaryStakeholderId: "legacy-stakeholder-leak",
  };

  const { motion } = rehydrateMotion(legacyMotion);
  const encoded = JSON.stringify(motion);

  assert.equal(motion.targetMap.accounts.length, 1);
  assert.equal(motion.targetMap.accounts[0].prospects.length, 0);
  assert.equal(encoded.includes("legacy-stakeholder-leak"), false);
});

/**
 * @param {unknown[]} motions
 */
function buildConfigBundle(motions) {
  return {
    kind: "exo-config",
    schemaVersion: "1",
    exportedAt: fixtureNow,
    exoVersion: "0.0.0-test",
    motions,
    browserProfiles: [],
    companies: [],
    users: [],
  };
}

/**
 * @param {string} tableName
 */
function tableCount(tableName) {
  return getLocalDatabase()
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get()
    .count;
}
