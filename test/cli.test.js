// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const offerHtml = [
  "<html>",
  "<head>",
  "<title>Actico Risk Platform</title>",
  '<meta name="description" content="Credit and risk decisioning for regulated lenders." />',
  "</head>",
  "<body>ok</body>",
  "</html>"
].join("");
const offerUrl = `data:text/html,${encodeURIComponent(offerHtml)}`;
const generatedMotionNamePattern = /^[a-z]+-[a-z]+-[a-z]+$/;

/**
 * @param {string} profilePath
 * @param {{ cookieHosts?: string[], historyUrls?: string[] }} input
 */
function seedBrowserEvidence(profilePath, input) {
  const cookiesDb = new DatabaseSync(path.join(profilePath, "Cookies"));
  cookiesDb.exec("CREATE TABLE cookies (host_key TEXT);");
  for (const host of input.cookieHosts ?? []) {
    cookiesDb.prepare("INSERT INTO cookies (host_key) VALUES (?)").run(host);
  }
  cookiesDb.close();

  const historyDb = new DatabaseSync(path.join(profilePath, "History"));
  historyDb.exec("CREATE TABLE urls (url TEXT);");
  for (const url of input.historyUrls ?? []) {
    historyDb.prepare("INSERT INTO urls (url) VALUES (?)").run(url);
  }
  historyDb.close();
}

test("motion add seeds a motion, motion refresh updates it, and motion list sees it in the same workspace", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-cli-"));

  try {
    const defineOutput = execFileSync(
      "node",
      [
        cliPath,
        "motion", "add",
        "--url",
        offerUrl,
        "--premise",
        "This offer matters when regulated lenders enter more complex credit-decision environments.",
        "--audience",
        "Traditional FI risk owners",
        "--audience",
        "BNPL modernization leaders",
        "--signal",
        "company::Is there recent evidence that this company expanded into a more complex lending segment?",
        "--signal",
        "person::Is there recent evidence that a senior risk owner was hired or promoted at this company?",
        "--geo",
        "United States",
        "--industry",
        "banking,lending",
        "--title",
        "Chief Risk Officer",
        "--segment",
        "traditional-fi",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const motion = JSON.parse(defineOutput);
    assert.equal(motion.offer.sourceUrl, offerUrl);
    assert.match(motion.name, generatedMotionNamePattern);
    assert.equal(motion.offerThesis.sourceTitle, "Actico Risk Platform");
    assert.equal(
      motion.offerThesis.sourceDescription,
      "Credit and risk decisioning for regulated lenders."
    );
    assert.equal(
      motion.premise.statement,
      "This offer matters when regulated lenders enter more complex credit-decision environments."
    );
    assert.equal(motion.premise.status, "defined");
    assert.equal(motion.audienceHypotheses.length, 2);
    assert.equal(motion.audienceHypotheses[0].name, "Traditional FI risk owners");
    assert.equal(motion.audienceHypotheses[1].name, "BNPL modernization leaders");
    assert.equal(motion.signals.length, 2);
    assert.equal(motion.signals[0].scope, "company");
    assert.equal(motion.signals[1].scope, "person");
    assert.deepEqual(motion.targetingProfile.industries, ["banking", "lending"]);
    assert.match(motion.nextSteps[0], /premise/i);
    assert.ok(
      motion.nextSteps.some((step) => /audience hypotheses/i.test(step)),
      "expected next steps to mention audience hypotheses"
    );
    assert.ok(
      motion.nextSteps.some((step) => /motion signals/i.test(step)),
      "expected next steps to mention motion signals"
    );
    assert.ok(fs.existsSync(path.join(tempDir, ".exo", "exo.db")));

    await new Promise((resolve) => setTimeout(resolve, 20));

    const refreshOutput = execFileSync("node", [cliPath, "motion", "refresh", motion.id, "--json"], {
      cwd: tempDir,
      encoding: "utf8"
    });
    const refreshed = JSON.parse(refreshOutput);
    assert.equal(refreshed.id, motion.id);
    assert.equal(refreshed.name, motion.name);
    assert.equal(refreshed.offer.sourceUrl, motion.offer.sourceUrl);
    assert.equal(refreshed.premise.statement, motion.premise.statement);
    assert.deepEqual(refreshed.audienceHypotheses, motion.audienceHypotheses);
    assert.deepEqual(refreshed.signals, motion.signals);
    assert.notEqual(refreshed.updatedAt, motion.updatedAt);

    const listOutput = execFileSync("node", [cliPath, "motion", "list"], {
      cwd: tempDir,
      encoding: "utf8"
    });

    assert.match(listOutput, new RegExp(motion.name));
    assert.match(listOutput, new RegExp(motion.id));
    assert.match(listOutput, /draft/);
    assert.match(listOutput, /created:/);
    assert.match(listOutput, /updated:/);

    const showOutput = execFileSync("node", [cliPath, "motion", "show", motion.id], {
      cwd: tempDir,
      encoding: "utf8"
    });
    assert.match(showOutput, /Created:/);
    assert.match(showOutput, /Updated:/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion lifecycle commands transition status cleanly and targeting respects paused and archived motions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-lifecycle-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--premise",
          "This offer matters when regulated lenders enter more complex credit-decision environments.",
          "--audience",
          "Traditional FI risk owners",
          "--signal",
          "company::Is there recent evidence that this company expanded into a more complex lending segment?",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const paused = JSON.parse(
      execFileSync("node", [cliPath, "motion", "pause", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(paused.action, "pause");
    assert.equal(paused.changed, true);
    assert.equal(paused.motion.status, "paused");
    assert.notEqual(paused.motion.updatedAt, motion.updatedAt);

    const pausedTargeting = JSON.parse(
      execFileSync("node", [cliPath, "motion", "target", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(pausedTargeting.overallStage, "paused");
    assert.equal(pausedTargeting.motionPreflight.status, "blocked");
    assert.ok(pausedTargeting.motionPreflight.blockers.some((blocker) => /paused/i.test(blocker)));
    assert.ok(pausedTargeting.nextActions.some((step) => /motion resume/i.test(step)));

    const resumed = JSON.parse(
      execFileSync("node", [cliPath, "motion", "resume", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(resumed.action, "resume");
    assert.equal(resumed.changed, true);
    assert.equal(resumed.motion.status, "active");

    const archived = JSON.parse(
      execFileSync("node", [cliPath, "motion", "archive", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(archived.action, "archive");
    assert.equal(archived.changed, true);
    assert.equal(archived.motion.status, "archived");

    const archivedTargeting = JSON.parse(
      execFileSync("node", [cliPath, "motion", "target", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(archivedTargeting.overallStage, "archived");
    assert.equal(archivedTargeting.motionPreflight.status, "blocked");
    assert.ok(archivedTargeting.motionPreflight.blockers.some((blocker) => /archived/i.test(blocker)));
    assert.ok(archivedTargeting.nextActions.some((step) => /motion restart/i.test(step)));

    const restarted = JSON.parse(
      execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(restarted.action, "restart");
    assert.equal(restarted.changed, true);
    assert.equal(restarted.motion.status, "active");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion add accepts structured config input for premise, audience hypotheses, and signals", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-config-"));
  const configPath = path.join(tempDir, "motion.json");

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        url: offerUrl,
        offerNotes: "Actico-style motion for lender complexity.",
        premise: {
          statement: "This offer matters when lenders move into more operationally complex credit-decision environments.",
          notes: "Test whether the premise resonates more with incumbents than fintechs.",
          source: "operator"
        },
        audienceHypotheses: [
          {
            name: "Traditional FI risk owners",
            companyCriteria: ["Regulated lenders", "Incumbent financial institutions"],
            roleCriteria: ["Chief Risk Officer", "VP Risk"],
            confidence: "moderate"
          },
          "BNPL modernization leaders"
        ],
        signals: [
          {
            question: "Is there recent evidence that this company expanded into a more complex lending segment?",
            scope: "company",
            whyItMatters: "Segment expansion usually increases policy and decisioning complexity.",
            matchRule: "Match when public site, hiring, or news shows move into more complex credit products.",
            observationMethods: [
              {
                surface: "google",
                query: "site:example.com lending expansion"
              }
            ],
            status: "ready"
          },
          "person::Is there recent evidence that a senior risk owner was hired or promoted at this company?"
        ],
        targetingProfile: {
          geolocations: ["United States"],
          industries: ["banking", "lending"],
          targetTitles: ["Chief Risk Officer"]
        }
      },
      null,
      2
    )
  );

  try {
    const output = execFileSync(
      "node",
      [cliPath, "motion", "add", "--config", configPath, "--json"],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const motion = JSON.parse(output);
    assert.match(motion.name, generatedMotionNamePattern);
    assert.equal(motion.offer.offerNotes, "Actico-style motion for lender complexity.");
    assert.equal(motion.premise.status, "defined");
    assert.equal(motion.audienceHypotheses.length, 2);
    assert.equal(motion.signals.length, 2);
    assert.equal(motion.signals[0].status, "ready");
    assert.equal(motion.signals[0].observationMethods[0].surface, "google");
    assert.equal(motion.signals[1].scope, "person");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion start checks URL reuse before creating, continuing, or cloning motions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-start-"));

  try {
    const created = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "start",
          "--url",
          offerUrl,
          "--premise",
          "This offer matters when lenders enter more complex credit-decision environments.",
          "--audience",
          "Traditional FI risk owners",
          "--signal",
          "company::Is there recent evidence that this company expanded into a more complex lending segment?",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(created.status, "created");
    assert.equal(created.motion.offer.sourceUrl, offerUrl);
    assert.match(created.motion.name, generatedMotionNamePattern);

    const decision = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "start", "--url", offerUrl, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(decision.status, "decision-required");
    assert.equal(decision.existingMotions.length, 1);
    assert.equal(decision.existingMotions[0].id, created.motion.id);

    const continued = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "start", "--url", offerUrl, "--existing", "continue", "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(continued.status, "continued");
    assert.equal(continued.motion.id, created.motion.id);

    const cloned = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "start",
          "--url",
          offerUrl,
          "--existing",
          "clone",
          "--audience",
          "BNPL modernization leaders",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(cloned.status, "cloned");
    assert.notEqual(cloned.motion.id, created.motion.id);
    assert.equal(cloned.motion.offer.sourceUrl, created.motion.offer.sourceUrl);
    assert.equal(cloned.motion.audienceHypotheses[0].name, "BNPL modernization leaders");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion add preserves commas inside a signal sentence instead of splitting it into multiple signals", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-signal-commas-"));

  try {
    const signalQuestion =
      "company::Is there recent evidence that this company expanded underwriting, changed credit policy, or launched BNPL?";

    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--signal",
          signalQuestion,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(motion.signals.length, 1);
    assert.equal(motion.signals[0].scope, "company");
    assert.equal(
      motion.signals[0].question,
      "Is there recent evidence that this company expanded underwriting, changed credit policy, or launched BNPL?"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion update writes premise, audience, signals, and targeting directly into an existing motion", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-update-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const updated = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "update",
          motion.id,
          "--premise",
          "This offer matters when regulated lenders enter more complex credit-decision environments.",
          "--audience",
          "Traditional FI risk owners",
          "--audience",
          "BNPL modernization leaders",
          "--signal",
          "company::Is there recent evidence that this company expanded into a more complex lending segment?",
        "--title",
        "Chief Risk Officer",
        "--title",
        "VP Risk",
        "--segment",
        "traditional-fi",
        "--stakeholder-count",
        "2",
        "--json"
      ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(updated.id, motion.id);
    assert.equal(updated.name, motion.name);
    assert.equal(updated.premise.status, "defined");
    assert.equal(updated.audienceHypotheses.length, 2);
    assert.equal(updated.audienceHypotheses[0].name, "Traditional FI risk owners");
    assert.equal(updated.audienceHypotheses[1].name, "BNPL modernization leaders");
    assert.equal(updated.signals.length, 1);
    assert.equal(updated.signals[0].scope, "company");
    assert.deepEqual(updated.targetingProfile.targetTitles, ["Chief Risk Officer", "VP Risk"]);
    assert.deepEqual(updated.targetingProfile.segmentVariants, ["traditional-fi"]);
    assert.equal(updated.targetingProfile.stakeholderTargetCount, 2);

    const shown = JSON.parse(
      execFileSync("node", [cliPath, "motion", "show", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(shown.premise.statement, updated.premise.statement);
    assert.deepEqual(shown.targetingProfile.targetTitles, ["Chief Risk Officer", "VP Risk"]);
    assert.equal(shown.targetingProfile.stakeholderTargetCount, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion update accepts structured audience and signal JSON without using config import", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-update-structured-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const audienceJson = JSON.stringify({
      name: "Fraud and analytics leaders",
      companyCriteria: ["BNPL operators", "High-velocity consumer lenders"],
      roleCriteria: ["Head of Fraud", "VP Risk Analytics"],
      notes: "Secondary audience if credit-risk ownership is fragmented.",
      confidence: "moderate"
    });
    const signalJson = JSON.stringify({
      question: "Is there recent evidence that this company is reorganizing fraud, risk, and underwriting ownership?",
      scope: "company",
      whyItMatters: "Ownership fragmentation is a strong proxy for decisioning pain.",
      matchRule: "Match when public hiring, org design, or leadership changes imply a reshuffle.",
      observationMethods: [
        {
          surface: "google",
          query: "site:example.com fraud underwriting risk leadership"
        }
      ],
      status: "ready"
    });

    const updated = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "update",
          motion.id,
          "--audience-json",
          audienceJson,
          "--signal-json",
          signalJson,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(updated.audienceHypotheses.length, 1);
    assert.equal(updated.audienceHypotheses[0].name, "Fraud and analytics leaders");
    assert.deepEqual(updated.audienceHypotheses[0].companyCriteria, ["BNPL operators", "High-velocity consumer lenders"]);
    assert.deepEqual(updated.audienceHypotheses[0].roleCriteria, ["Head of Fraud", "VP Risk Analytics"]);
    assert.equal(updated.audienceHypotheses[0].confidence, "moderate");
    assert.equal(updated.signals.length, 1);
    assert.equal(updated.signals[0].status, "ready");
    assert.equal(updated.signals[0].observationMethods[0].surface, "google");
    assert.equal(updated.signals[0].whyItMatters, "Ownership fragmentation is a strong proxy for decisioning pain.");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion clone forks an existing motion into a new retargeted draft", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-clone-"));

  try {
    const sourceMotion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--premise",
          "This offer matters when regulated lenders enter more complex credit-decision environments.",
          "--audience",
          "Traditional FI risk owners",
          "--signal",
          "company::Is there recent evidence that this company expanded into a more complex lending segment?",
          "--title",
          "Chief Risk Officer",
          "--segment",
          "traditional-fi",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const clonedMotion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "clone",
          sourceMotion.id,
          "--audience",
          "BNPL modernization leaders",
          "--title",
          "GM Lending",
          "--segment",
          "bnpl",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.notEqual(clonedMotion.id, sourceMotion.id);
    assert.notEqual(clonedMotion.name, sourceMotion.name);
    assert.match(clonedMotion.name, generatedMotionNamePattern);
    assert.equal(clonedMotion.status, "draft");
    assert.equal(clonedMotion.offer.sourceUrl, sourceMotion.offer.sourceUrl);
    assert.equal(clonedMotion.premise.statement, sourceMotion.premise.statement);
    assert.equal(clonedMotion.audienceHypotheses.length, 1);
    assert.equal(clonedMotion.audienceHypotheses[0].name, "BNPL modernization leaders");
    assert.deepEqual(clonedMotion.targetingProfile.targetTitles, ["GM Lending"]);
    assert.deepEqual(clonedMotion.targetingProfile.segmentVariants, ["bnpl"]);
    assert.equal(clonedMotion.targetMap.status, "pending");
    assert.deepEqual(clonedMotion.targetMap.accounts, []);
    assert.deepEqual(clonedMotion.stakeholderMap.stakeholders, []);
    assert.deepEqual(clonedMotion.motionPlan.variants, []);

    const sourceShown = JSON.parse(
      execFileSync("node", [cliPath, "motion", "show", sourceMotion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(sourceShown.audienceHypotheses[0].name, "Traditional FI risk owners");
    assert.deepEqual(sourceShown.targetingProfile.targetTitles, ["Chief Risk Officer"]);
    assert.deepEqual(sourceShown.targetingProfile.segmentVariants, ["traditional-fi"]);

    const listed = JSON.parse(
      execFileSync("node", [cliPath, "motion", "list", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(listed.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("database migrations upgrade legacy motion payloads before motion list and show run", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-migrate-"));
  const stateDir = path.join(tempDir, ".exo");
  const dbPath = path.join(stateDir, "exo.db");
  const legacyMotionId = "be872300-11cb-4abf-bb11-f96c89b0f3d8";

  fs.mkdirSync(stateDir, { recursive: true });

  const database = new DatabaseSync(dbPath);
  database.exec(`
    CREATE TABLE motions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      source_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);

  const legacyMotion = {
    id: legacyMotionId,
    createdAt: "2026-05-26T12:00:00.000Z",
    updatedAt: "2026-05-26T12:00:00.000Z",
    status: "draft",
    offer: {
      sourceUrl: "https://example.com",
      offerNotes: null
    },
    targetingProfile: {
      geolocations: ["United States"],
      icpTypes: [],
      industries: ["banking"],
      companyTypes: [],
      companyShapes: [],
      companySizes: [],
      targetTitles: ["Chief Risk Officer"],
      roleFamilies: [],
      segmentVariants: []
    },
    suppressionPolicy: {
      excludedAccounts: [],
      excludedDomains: [],
      excludedContacts: [],
      doNotContactEntries: [],
      doNotContactSources: [],
      crmCustomerSuppressionEnabled: false,
      crmOpportunitySuppressionEnabled: false
    },
    offerThesis: {
      sourceUrl: "https://example.com",
      sourceTitle: "Example Product",
      sourceDescription: "Legacy motion payload without premise",
      sourceSummary: "Example Product — Legacy motion payload without premise",
      offerNotes: null,
      problemThesis: null,
      buyerImpactThesis: null,
      likelyTriggerThesis: null,
      likelyRoleThesis: null,
      likelySegmentThesis: null,
      status: "needs_inference"
    },
    signalSet: {
      status: "pending",
      items: []
    },
    targetMap: {
      status: "pending",
      accounts: [],
      segments: []
    },
    stakeholderMap: {
      status: "pending",
      stakeholders: []
    },
    motionPlan: {
      status: "pending",
      variants: []
    },
    nextSteps: ["legacy step"]
  };

  database
    .prepare(`
      INSERT INTO motions (id, status, source_url, created_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      legacyMotion.id,
      legacyMotion.status,
      legacyMotion.offer.sourceUrl,
      legacyMotion.createdAt,
      legacyMotion.updatedAt,
      JSON.stringify(legacyMotion, null, 2)
    );
  database.close();

  try {
    const listed = JSON.parse(
      execFileSync("node", [cliPath, "motion", "list", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, legacyMotionId);
    assert.match(listed[0].name, generatedMotionNamePattern);
    assert.notEqual(listed[0].name, "Example Motion");
    assert.equal(listed[0].premise.status, "missing");
    assert.deepEqual(listed[0].signals, []);

    const shown = JSON.parse(
      execFileSync("node", [cliPath, "motion", "show", legacyMotionId, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(shown.id, legacyMotionId);
    assert.match(shown.name, generatedMotionNamePattern);
    assert.equal(shown.premise.status, "missing");
    assert.ok(
      shown.nextSteps.some((step) => /premise/i.test(step)),
      "expected migrated motion to recompute next steps"
    );

    const migratedDb = new DatabaseSync(dbPath);
    const versionRow = migratedDb.prepare("PRAGMA user_version").get();
    const migratedRow = migratedDb.prepare("SELECT payload_json FROM motions WHERE id = ?").get(legacyMotionId);
    migratedDb.close();

    assert.equal(versionRow.user_version, 5);

    const migratedPayload = JSON.parse(migratedRow.payload_json);
    assert.match(migratedPayload.name, generatedMotionNamePattern);
    assert.equal(migratedPayload.premise.status, "missing");
    assert.ok(Array.isArray(migratedPayload.audienceHypotheses));
    assert.ok(Array.isArray(migratedPayload.signals));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("profiles add/list/capabilities/test persists a browser profile with a passing local check", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-profiles-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const profileDirectory = "Profile 7";
  const profilePath = path.join(userDataDir, profileDirectory);

  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: {
            name: "Work LinkedIn"
          }
        }
      }
    })
  );
  fs.writeFileSync(
    path.join(profilePath, "Preferences"),
    JSON.stringify({
      profile: {
        name: "Work LinkedIn"
      }
    })
  );
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: [
      "https://www.linkedin.com/feed/",
      "https://www.linkedin.com/sales/home"
    ]
  });

  try {
    const addOutput = execFileSync(
      "node",
      [
        cliPath,
        "profiles",
        "add",
        "--browser",
        "chrome",
        "--label",
        "work-linkedin",
        "--user-data-dir",
        userDataDir,
        "--profile-directory",
        profileDirectory,
        "--browser-command",
        "/bin/echo",
        "--capability",
        "linkedin",
        "--capability",
        "sales-navigator",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const profile = JSON.parse(addOutput);
    assert.equal(profile.status, "ready");
    assert.equal(profile.detectedProfileName, "Work LinkedIn");
    assert.equal(profile.profilePath, profilePath);
    assert.deepEqual(profile.capabilities, ["linkedin", "sales-navigator"]);
    assert.deepEqual(profile.verifiedCapabilities, ["linkedin", "sales-navigator"]);

    const listOutput = execFileSync("node", [cliPath, "profiles", "list"], {
      cwd: tempDir,
      encoding: "utf8"
    });
    assert.match(listOutput, new RegExp(profile.id));
    assert.match(listOutput, /work-linkedin/);
    assert.match(listOutput, /declared:\[linkedin, sales-navigator\]/);
    assert.match(listOutput, /verified:\[linkedin, sales-navigator\]/);

    const capabilitiesOutput = execFileSync(
      "node",
      [cliPath, "profiles", "capabilities", "--json"],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );
    const capabilities = JSON.parse(capabilitiesOutput);
    assert.deepEqual(capabilities.supportedCapabilities, [
      "generic-web",
      "linkedin",
      "sales-navigator",
      "gmail",
      "hubspot"
    ]);
    assert.equal(capabilities.profiles.length, 1);
    assert.deepEqual(capabilities.profiles[0].declaredCapabilities, ["linkedin", "sales-navigator"]);
    assert.deepEqual(capabilities.profiles[0].verifiedCapabilities, ["linkedin", "sales-navigator"]);
    assert.equal(capabilities.coverage.linkedin.length, 1);
    assert.equal(capabilities.coverage.gmail.length, 0);

    const singleCapabilityOutput = execFileSync(
      "node",
      [cliPath, "profiles", "capabilities", profile.id, "--json"],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );
    const singleCapability = JSON.parse(singleCapabilityOutput);
    assert.equal(singleCapability.profile.id, profile.id);
    assert.deepEqual(singleCapability.profile.declaredCapabilities, ["linkedin", "sales-navigator"]);
    assert.deepEqual(singleCapability.profile.verifiedCapabilities, ["linkedin", "sales-navigator"]);

    const resolveOutput = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "profiles", "resolve", "--capability", "sales-navigator", "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    assert.equal(resolveOutput.capability, "sales-navigator");
    assert.equal(resolveOutput.resolved.id, profile.id);
    assert.equal(resolveOutput.resolved.browser, "chrome");
    assert.equal(resolveOutput.candidates.length, 1);

    const testOutput = execFileSync("node", [cliPath, "profiles", "test", profile.id, "--json"], {
      cwd: tempDir,
      encoding: "utf8"
    });
    const retested = JSON.parse(testOutput);
    assert.equal(retested.status, "ready");
    assert.equal(retested.lastTestResult.status, "ready");
    assert.equal(retested.detectedProfileName, "Work LinkedIn");
    assert.deepEqual(retested.verifiedCapabilities, ["linkedin", "sales-navigator"]);

    const removeOutput = execFileSync("node", [cliPath, "profiles", "remove", profile.id], {
      cwd: tempDir,
      encoding: "utf8"
    });
    assert.match(removeOutput, /Removed browser profile/);

    const emptyListOutput = execFileSync("node", [cliPath, "profiles", "list"], {
      cwd: tempDir,
      encoding: "utf8"
    });
    assert.match(emptyListOutput, /No browser profiles found/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("profiles discover scans local browser roots before registration and annotates existing registrations", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-profiles-discover-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const profileDirectory = "Profile 4";
  const profilePath = path.join(userDataDir, profileDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: {
            name: "Growth LinkedIn"
          }
        }
      }
    })
  );
  fs.writeFileSync(
    path.join(profilePath, "Preferences"),
    JSON.stringify({
      profile: {
        name: "Growth LinkedIn"
      }
    })
  );
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/sales/home"]
  });

  try {
    const discovered = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "discover",
          "--browser",
          "chrome",
          "--user-data-dir",
          userDataDir,
          "--browser-command",
          browserCommand,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.deepEqual(discovered.browsersScanned, ["chrome"]);
    assert.equal(discovered.candidates.length, 1);
    assert.equal(discovered.candidates[0].profileDirectory, profileDirectory);
    assert.equal(discovered.candidates[0].detectedProfileName, "Growth LinkedIn");
    assert.equal(discovered.candidates[0].registered, false);
    assert.deepEqual(discovered.candidates[0].observedCapabilities, [
      "generic-web",
      "linkedin",
      "sales-navigator"
    ]);
    assert.equal(
      discovered.candidates[0].capabilityChecks.find((check) => check.capability === "gmail")?.verified,
      false
    );

    const profile = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "add",
          "--browser",
          "chrome",
          "--label",
          "growth-linkedin",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          profileDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--capability",
          "sales-navigator",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const rediscovered = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "discover",
          "--browser",
          "chrome",
          "--user-data-dir",
          userDataDir,
          "--browser-command",
          browserCommand,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(rediscovered.candidates.length, 1);
    assert.equal(rediscovered.candidates[0].registered, true);
    assert.equal(rediscovered.candidates[0].registeredProfileId, profile.id);
    assert.deepEqual(rediscovered.candidates[0].declaredCapabilities, ["linkedin", "sales-navigator"]);
    assert.deepEqual(rediscovered.candidates[0].verifiedCapabilities, ["linkedin", "sales-navigator"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("claimed browser identities can be pinned to a company and sticky resolution honors that assignment", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-profile-assignment-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const firstDirectory = "Profile 4";
  const secondDirectory = "Profile 7";
  const firstPath = path.join(userDataDir, firstDirectory);
  const secondPath = path.join(userDataDir, secondDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(firstPath, { recursive: true });
  fs.mkdirSync(secondPath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [firstDirectory]: { name: "Audienti Main" },
          [secondDirectory]: { name: "Knitit Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(firstPath, "Preferences"), JSON.stringify({ profile: { name: "Audienti Main" } }));
  fs.writeFileSync(path.join(secondPath, "Preferences"), JSON.stringify({ profile: { name: "Knitit Main" } }));
  seedBrowserEvidence(firstPath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/sales/home", "https://mail.google.com/mail/u/0/#inbox"]
  });
  seedBrowserEvidence(secondPath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const firstProfile = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "add",
          "--browser",
          "chrome",
          "--label",
          "chrome-profile-4",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          firstDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--capability",
          "sales-navigator",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const secondProfile = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "add",
          "--browser",
          "chrome",
          "--label",
          "chrome-profile-7",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          secondDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const claimed = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "claim",
          firstProfile.id,
          "--label",
          "audienti-main",
          "--owner",
          "william",
          "--workspace",
          "audienti",
          "--scope",
          "work",
          "--account",
          "linkedin:wflanagan@audienti.com",
          "--account",
          "gmail:wflanagan@audienti.com",
          "--max-profile-visits",
          "75",
          "--max-connection-requests",
          "40",
          "--max-inmail-messages",
          "20",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    assert.equal(claimed.label, "audienti-main");
    assert.equal(claimed.identity.workspace, "audienti");
    assert.equal(claimed.identity.owner, "william");
    assert.equal(claimed.identity.scope, "work");
    assert.deepEqual(claimed.identity.accounts, [
      { capability: "linkedin", handle: "wflanagan@audienti.com" },
      { capability: "gmail", handle: "wflanagan@audienti.com" }
    ]);
    assert.deepEqual(claimed.automationControls.weeklyQuotas, {
      profileVisits: 75,
      invitations: 40,
      messages: 20
    });

    const company = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "companies", "add", "--name", "BillEase", "--domain", "billease.ph", "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const assigned = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "profile",
          "assign",
          company.id,
          "--profile",
          claimed.id,
          "--by",
          "william",
          "--reason",
          "Use one identity consistently for outreach.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    assert.equal(assigned.engagementProfileAssignment.profileId, claimed.id);
    assert.equal(assigned.engagementProfileAssignment.label, "audienti-main");
    assert.equal(assigned.engagementProfileAssignment.workspace, "audienti");
    assert.deepEqual(assigned.engagementProfileAssignment.accountRefs, [
      "linkedin:wflanagan@audienti.com",
      "gmail:wflanagan@audienti.com"
    ]);

    const companyProfile = JSON.parse(
      execFileSync("node", [cliPath, "companies", "profile", "show", company.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(companyProfile.assignment.profileId, claimed.id);
    assert.equal(companyProfile.profile.id, claimed.id);
    assert.equal(companyProfile.profile.automationControls.weeklyQuotas.messages, 20);

    const stickyResolve = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "resolve",
          "--capability",
          "linkedin",
          "--company",
          company.id,
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(stickyResolve.resolutionMode, "company-assignment");
    assert.equal(stickyResolve.resolved.id, claimed.id);
    assert.equal(stickyResolve.assignedProfile.id, claimed.id);
    assert.equal(stickyResolve.candidates.length, 2);

    const blockedResolve = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "resolve",
          "--capability",
          "hubspot",
          "--company",
          company.id,
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(blockedResolve.resolutionMode, "blocked-by-company-assignment");
    assert.equal(blockedResolve.resolved, null);
    assert.match(blockedResolve.blocker, /pinned to audienti-main/i);
    assert.equal(secondProfile.verifiedCapabilities.includes("hubspot"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("companies add/list/find/show/motions persists canonical company records", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-companies-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--geo",
          "United States",
          "--title",
          "CRO",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Chainguard",
          "--domain",
          "chainguard.dev",
          "--tag",
          "enterprise-security",
          "--motion",
          motion.id,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(company.name, "Chainguard");
    assert.equal(company.domain, "chainguard.dev");
    assert.deepEqual(company.motionIds, [motion.id]);

    const listOutput = execFileSync("node", [cliPath, "companies", "list"], {
      cwd: tempDir,
      encoding: "utf8"
    });
    assert.match(listOutput, new RegExp(company.id));
    assert.match(listOutput, /Chainguard/);

    const findOutput = JSON.parse(
      execFileSync("node", [cliPath, "companies", "find", "chainguard", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(findOutput.length, 1);
    assert.equal(findOutput[0].id, company.id);

    const showOutput = JSON.parse(
      execFileSync("node", [cliPath, "companies", "show", company.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(showOutput.name, "Chainguard");

    const motionsOutput = JSON.parse(
      execFileSync("node", [cliPath, "companies", "motions", company.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(motionsOutput.company.id, company.id);
    assert.equal(motionsOutput.motions.length, 1);
    assert.equal(motionsOutput.motions[0].id, motion.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("companies update stores canonical website identity and research brief turns motion signals into governed company research instructions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-company-research-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--premise",
          "This offer matters when BNPL operators expand into more complex merchant and lending flows.",
          "--audience",
          "Risk and decisioning leaders",
          "--signal-json",
          JSON.stringify({
            question: "Is there recent evidence that this company expanded merchant acceptance, lending complexity, or checkout coverage?",
            scope: "company",
            whyItMatters: "Expansion into broader merchant or lending flows usually creates more decisioning complexity.",
            matchRule: "Match when company site, merchant announcements, or recent news show expansion that can be mentioned naturally in outreach.",
            observationMethods: [
              { surface: "company-site", notes: "Check newsroom and merchant pages first." },
              { surface: "google", query: "merchant expansion checkout lending" },
              { surface: "news", notes: "Prefer recent company or financing coverage." }
            ],
            status: "ready"
          }),
          "--signal-json",
          JSON.stringify({
            question: "Is there recent evidence that a director-plus risk or analytics leader changed roles at this company?",
            scope: "person",
            whyItMatters: "Leadership shifts can create fresh openness to decisioning change.",
            status: "ready"
          }),
          "--title",
          "Head of Risk",
          "--title",
          "Director of Fraud",
          "--stakeholder-count",
          "2",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "BillEase",
          "--domain",
          "billease.ph",
          "--motion",
          motion.id,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const updated = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "update",
          company.id,
          "--website-url",
          "https://billease.ph",
          "--linkedin-company-url",
          "https://www.linkedin.com/company/billease",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(updated.websiteUrl, "https://billease.ph");
    assert.equal(updated.linkedinCompanyUrl, "https://www.linkedin.com/company/billease");

    const brief = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "companies", "research-brief", company.id, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(brief.company.id, company.id);
    assert.equal(brief.company.websiteUrl, "https://billease.ph");
    assert.equal(brief.motion.id, motion.id);
    assert.equal(brief.signalChecklist.length, 1);
    assert.equal(brief.personSignalChecklist.length, 1);
    assert.equal(brief.signalRecency.preferredWindowDays, 180);
    assert.equal(brief.signalRecency.maximumWindowDays, 365);
    assert.equal(brief.prospectPlan.minimumCount, 2);
    assert.equal(brief.prospectPlan.targetCount, 2);
    assert.equal(brief.prospectPlan.seniorityFloor, "director");
    assert.deepEqual(brief.prospectPlan.preferredTitles, ["Head of Risk", "Director of Fraud"]);
    assert.ok(
      brief.researchPath.some((step) => /company site first/i.test(step)),
      "expected research path to prefer the company site first"
    );
    assert.ok(
      brief.researchPath.some((step) => /best-fit owner/i.test(step)),
      "expected research path to mention best-fit owner fallback"
    );
    assert.ok(
      brief.completionCriteria.some((criterion) => /website is stored/i.test(criterion)),
      "expected completion criteria to require stored website identity"
    );
    assert.ok(
      brief.stateWritebacks.some((writeback) => /prospects add/i.test(writeback)),
      "expected research brief to include prospect writeback guidance"
    );
    assert.ok(
      brief.stateWritebacks.some((writeback) => /opening-plan set/i.test(writeback)),
      "expected research brief to include opening-plan writeback guidance"
    );
    assert.equal(brief.signalChecklist[0].observationPlan[0].surface, "company-site");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("companies signal-matches add/show persists motion-specific company and person evidence for later writing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-signal-match-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--premise",
          "This offer matters when lenders expand into more complex checkout and underwriting surfaces.",
          "--signal-json",
          JSON.stringify({
            question: "Is there recent evidence that this company expanded merchant acceptance or checkout coverage?",
            scope: "company",
            whyItMatters: "Merchant and checkout expansion usually increases decisioning complexity.",
            status: "ready"
          }),
          "--signal-json",
          JSON.stringify({
            question: "Is there recent evidence that a director-plus risk leader changed roles at this company?",
            scope: "person",
            whyItMatters: "Leadership change can create a live reason to talk.",
            status: "ready"
          }),
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "BillEase",
          "--domain",
          "billease.ph",
          "--website-url",
          "https://billease.ph",
          "--motion",
          motion.id,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const recordedCompanyMatch = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "signal-matches",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--signal",
          motion.signals[0].id,
          "--summary",
          "Expanded in-store merchant acceptance through a new POS integration.",
          "--source-url",
          "https://billease.ph/news/pos-integration",
          "--observed-at",
          "2026-05-01T00:00:00.000Z",
          "--confidence",
          "high",
          "--evidence-snippet",
          "BillEase announced POS integration for merchant checkout flows.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(recordedCompanyMatch.signalMatches.length, 1);
    assert.equal(recordedCompanyMatch.signalMatches[0].subject.type, "company");
    assert.equal(recordedCompanyMatch.signalMatches[0].confidence, "high");

    const recordedPersonMatch = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "signal-matches",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--signal",
          motion.signals[1].id,
          "--summary",
          "Minh Le surfaced as Head of Risk during the current research pass.",
          "--person-name",
          "Minh Le",
          "--person-title",
          "Head of Risk",
          "--source-url",
          "https://www.linkedin.com/in/minh-le",
          "--observed-at",
          "2026-05-02T00:00:00.000Z",
          "--confidence",
          "moderate",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(recordedPersonMatch.signalMatches.length, 2);
    assert.equal(recordedPersonMatch.signalMatches[1].subject.type, "person");
    assert.equal(recordedPersonMatch.signalMatches[1].subject.personName, "Minh Le");
    assert.equal(recordedPersonMatch.signalMatches[1].subject.personTitle, "Head of Risk");

    const matches = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "companies", "signal-matches", "show", company.id, "--motion", motion.id, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(matches.signalMatches.length, 2);
    assert.equal(matches.account.companyId, company.id);
    assert.equal(matches.signalMatches[0].signalId, motion.signals[0].id);
    assert.equal(matches.signalMatches[1].signalId, motion.signals[1].id);

    const shownMotion = JSON.parse(
      execFileSync("node", [cliPath, "motion", "show", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(shownMotion.targetMap.status, "ready");
    assert.equal(shownMotion.targetMap.accounts.length, 1);
    assert.equal(shownMotion.targetMap.accounts[0].companyId, company.id);
    assert.equal(shownMotion.targetMap.accounts[0].signalMatches.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("companies persist prospects plus prospect-specific through-lines, opening plans, and cadence state on the motion-owned target account", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-prospects-opening-plan-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--premise",
          "This offer matters when BNPL operators widen merchant and credit-decision complexity.",
          "--audience",
          "Philippine BNPL risk leaders",
          "--stakeholder-count",
          "2",
          "--signal-json",
          JSON.stringify({
            question: "Is there recent evidence that this company expanded merchant acceptance or decisioning data sources?",
            scope: "company",
            whyItMatters: "Broader merchant reach and richer data increase decisioning complexity.",
            status: "ready"
          }),
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "BillEase",
          "--domain",
          "billease.ph",
          "--website-url",
          "https://billease.ph",
          "--motion",
          motion.id,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "update",
        company.id,
        "--linkedin-company-url",
        "https://www.linkedin.com/company/billease/",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const recordedSignalMatch = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "signal-matches",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--signal",
          motion.signals[0].id,
          "--summary",
          "Joined a cross-lender intelligence network that sharpens credit decisions across a wider acceptance surface.",
          "--source-url",
          "https://technode.global/2026/05/21/billease-lenderlink",
          "--observed-at",
          "2026-05-21T00:00:00.000Z",
          "--confidence",
          "high",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const signalMatchId = recordedSignalMatch.signalMatches[0].id;

    const primaryProspectResult = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--name",
          "Minh Le",
          "--title",
          "Head of Risk",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "influences",
          "--fit-confidence",
          "high",
          "--signal-match",
          signalMatchId,
          "--role-description",
          "Leads risk and credit policy across BillEase lending surfaces.",
          "--role-summary",
          "Owns the control implications of wider merchant and borrower data coverage.",
          "--operating-mode",
          "leading",
          "--scope",
          "company-wide risk",
          "--role-evidence",
          "Current role description references risk leadership, policy ownership, and direct operator accountability.",
          "--trigger-summary",
          "BillEase is broadening decisioning complexity through new data and merchant surfaces.",
          "--tenure-band",
          "6-to-24-months",
          "--why-now-anchor",
          "LenderLink creates a current reason to revisit decisioning ownership.",
          "--person-trigger",
          "Current research surfaced Minh as the visible risk owner.",
          "--company-trigger",
          "Joined a cross-lender intelligence network.",
          "--identity-summary",
          "Presents as the operating risk owner rather than a generic executive sponsor.",
          "--headline",
          "Head of Risk",
          "--about-quote",
          "Risk leader focused on portfolio quality, portfolio performance, and control.",
          "--framework",
          "Risk governance",
          "--self-image-verb",
          "leading",
          "--why-relevant",
          "Best-fit owner for the data-sharing and decisioning-complexity story.",
          "--source-url",
          "https://www.linkedin.com/in/minh-le",
          "--active-channel",
          "linkedin",
          "--activity-type",
          "own-post",
          "--live-signal-summary",
          "Recent post on merchant-risk growth suggests active LinkedIn use.",
          "--live-signal-url",
          "https://www.linkedin.com/posts/minh-example",
          "--live-signal-observed-at",
          "2026-05-24T00:00:00.000Z",
          "--freshness-band",
          "15-30-days",
          "--hook-strength",
          "high",
          "--engagement-rationale",
          "Recent public posting is positive evidence this channel is live enough for legitimate engagement.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const primaryProspectId = primaryProspectResult.prospects[0].id;
    assert.equal(primaryProspectResult.prospects[0].roleTruth.currentRoleDescription, "Leads risk and credit policy across BillEase lending surfaces.");
    assert.equal(primaryProspectResult.prospects[0].roleTruth.operatingMode, "leading");
    assert.equal(primaryProspectResult.prospects[0].triggerWindow.tenureBand, "6-to-24-months");
    assert.equal(primaryProspectResult.prospects[0].identityTells.headline, "Head of Risk");
    assert.deepEqual(primaryProspectResult.prospects[0].roleTruth.evidence, [
      "Current role description references risk leadership, policy ownership, and direct operator accountability."
    ]);
    assert.deepEqual(primaryProspectResult.prospects[0].identityTells.aboutQuotes, [
      "Risk leader focused on portfolio quality, portfolio performance, and control."
    ]);
    assert.equal(primaryProspectResult.prospects[0].liveSignal.channel, "linkedin");
    assert.equal(primaryProspectResult.prospects[0].liveSignal.freshnessBand, "15-30-days");

    const enrichedPrimaryProspectResult = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--name",
          "Minh Le",
          "--title",
          "Head of Risk",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "influences",
          "--fit-confidence",
          "high",
          "--signal-match",
          signalMatchId,
          "--email",
          "minh@example.com",
          "--profile-viewed-at",
          "2026-05-26T16:00:00.000Z",
          "--active-channel",
          "linkedin",
          "--activity-type",
          "own-post",
          "--live-signal-summary",
          "Recent post on merchant-risk growth suggests active LinkedIn use.",
          "--live-signal-url",
          "https://www.linkedin.com/posts/minh-example",
          "--live-signal-observed-at",
          "2026-05-24T00:00:00.000Z",
          "--engagement-rationale",
          "Recent public posting is positive evidence this channel is live enough for legitimate engagement.",
          "--why-relevant",
          "Best-fit owner for the data-sharing and decisioning-complexity story.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(enrichedPrimaryProspectResult.prospects.length, 1);
    assert.equal(enrichedPrimaryProspectResult.prospects[0].id, primaryProspectId);
    assert.equal(enrichedPrimaryProspectResult.prospects[0].email, "minh@example.com");
    assert.equal(enrichedPrimaryProspectResult.prospects[0].liveSignal.channel, "linkedin");
    assert.match(enrichedPrimaryProspectResult.prospects[0].liveSignal.summary, /active linkedin use/i);

    const secondProspectResult = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--name",
          "Jared Barreda",
          "--title",
          "Head of Collections Analytics",
          "--buying-committee-role",
          "operator_champion",
          "--decision-authority",
          "influences",
          "--fit-confidence",
          "moderate",
          "--signal-match",
          signalMatchId,
          "--why-relevant",
          "Expanded merchant and borrower coverage creates monitoring and segmentation pressure downstream.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(secondProspectResult.prospects.length, 2);
    const secondProspectId = secondProspectResult.prospects[1].id;

    assert.throws(
      () => execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--name",
          "Garret Go",
          "--title",
          "Chief Financial Officer",
          "--why-relevant",
          "Potential sponsor once the primary owner is clear."
        ],
        {
          cwd: tempDir,
          encoding: "utf8",
          stdio: "pipe"
        }
      ),
      /Prospect limit reached/
    );

    const prospects = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "companies", "prospects", "show", company.id, "--motion", motion.id, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(prospects.motion.prospectTargetCount, 2);
    assert.equal(prospects.prospects.length, 2);
    assert.equal(prospects.prospects[0].signalMatchIds[0], signalMatchId);
    assert.equal(prospects.prospects[0].email, "minh@example.com");
    assert.equal(prospects.prospects[0].profileViewedAt, "2026-05-26T16:00:00.000Z");
    assert.equal(prospects.prospects[0].roleTruth.currentRoleDescription, "Leads risk and credit policy across BillEase lending surfaces.");
    assert.equal(prospects.prospects[0].triggerWindow.summary, "BillEase is broadening decisioning complexity through new data and merchant surfaces.");
    assert.equal(prospects.prospects[0].identityTells.aboutQuotes[0], "Risk leader focused on portfolio quality, portfolio performance, and control.");
    assert.equal(prospects.prospects[0].liveSignal.channel, "linkedin");

    const motionProspectsBeforePlanning = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "prospects", motion.id, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(motionProspectsBeforePlanning.counts.prospectCount, 2);
    assert.equal(motionProspectsBeforePlanning.counts.messageTestReadyCount, 0);
    assert.equal(motionProspectsBeforePlanning.counts.recentPostReadyCount, 1);
    assert.equal(motionProspectsBeforePlanning.prospects[0].recentPost.engageable, true);

    const throughLineResult = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "through-line",
          "set",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          primaryProspectId,
          "--signal-match",
          signalMatchId,
          "--specific-to-them",
          "As Head of Risk, Minh is likely absorbing the control consequences of wider merchant and borrower data coverage.",
          "--shared-problem",
          "Decisioning complexity rises when merchant expansion and new data sources widen the credit surface.",
          "--why-now",
          "BillEase is broadening credit-decision complexity through new data and merchant surfaces.",
          "--legitimate-wedge",
          "Use the LenderLink shift to give Minh a concrete reason to clarify ownership of decisioning modernization rather than answer a generic pitch.",
          "--compression-line",
          "Minh owns risk while BillEase widens merchant and data complexity, so LenderLink makes a decisioning-control conversation timely now.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(throughLineResult.throughLine.status, "ready");
    assert.equal(throughLineResult.prospect.id, primaryProspectId);
    assert.deepEqual(throughLineResult.throughLine.signalMatchIds, [signalMatchId]);
    assert.match(throughLineResult.throughLine.legitimateWedge, /clarify ownership of decisioning modernization/i);

    const openingPlanResult = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "opening-plan",
          "set",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          primaryProspectId,
          "--supporting-prospect",
          secondProspectId,
          "--signal-match",
          signalMatchId,
          "--why-now",
          "BillEase is broadening credit-decision complexity through new data and merchant surfaces.",
          "--angle",
          "Controlled expansion needs tighter risk and decisioning control.",
          "--reply-path",
          "Use the LenderLink shift to give Minh a concrete reason to clarify ownership of decisioning modernization rather than answer a generic pitch.",
          "--primary-channel",
          "connection-request",
          "--fallback-channel",
          "email",
          "--fallback-trigger",
          "Use email if LinkedIn is blocked or there is no reply after the first LinkedIn touch.",
          "--preflight-action",
          "View the prospect profile",
          "--preflight-action",
          "Engage the most recent relevant LinkedIn post only if the interaction is natural.",
          "--first-move",
          "LinkedIn connect plus short note anchored on the LenderLink shift.",
          "--first-message-goal",
          "Confirm whether Minh owns risk and decisioning modernization priorities.",
          "--talking-point",
          "Use LenderLink as the why-now spine.",
          "--talking-point",
          "Use merchant-surface expansion as supporting pressure.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(openingPlanResult.openingPlan.status, "ready");
    assert.equal(openingPlanResult.prospect.id, primaryProspectId);
    assert.deepEqual(openingPlanResult.openingPlan.supportingProspectIds, [secondProspectId]);
    assert.deepEqual(openingPlanResult.openingPlan.signalMatchIds, [signalMatchId]);
    assert.match(openingPlanResult.openingPlan.replyPath, /clarify ownership of decisioning modernization/i);
    assert.equal(openingPlanResult.openingPlan.primaryChannel, "connection-request");
    assert.equal(openingPlanResult.openingPlan.fallbackChannel, "email");
    assert.match(openingPlanResult.openingPlan.fallbackTrigger, /no reply after the first LinkedIn touch/i);
    assert.equal(openingPlanResult.openingPlan.preflightActions.length, 2);
    assert.equal(openingPlanResult.openingPlan.talkingPoints.length, 2);

    const cadenceResult = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "cadence",
          "set",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          primaryProspectId,
          "--current-step",
          "connection-request",
          "--last-touch-channel",
          "connection-request",
          "--last-touch-outcome",
          "sent",
          "--last-touch-at",
          "2026-05-26T17:00:00.000Z",
          "--next-action",
          "Wait for reply before escalating to email.",
          "--next-action-due-at",
          "2026-05-30T17:00:00.000Z",
          "--blocked-channel",
          "inmail",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(cadenceResult.cadence.status, "ready");
    assert.equal(cadenceResult.cadence.currentStep, "connection-request");
    assert.equal(cadenceResult.cadence.lastTouchOutcome, "sent");
    assert.equal(cadenceResult.cadence.blockedChannels[0], "inmail");

    const firstTouch = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "touches",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          primaryProspectId,
          "--surface",
          "connection_request",
          "--direction",
          "inbound",
          "--outcome",
          "accepted",
          "--occurred-at",
          "2026-05-28T17:00:00.000Z",
          "--summary",
          "Accepted the initial connection request.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    assert.equal(firstTouch.touches.length, 1);
    assert.equal(firstTouch.touches[0].surface, "connection_request");

    const secondTouch = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "touches",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          primaryProspectId,
          "--surface",
          "post_accept_message",
          "--direction",
          "outbound",
          "--outcome",
          "sent",
          "--occurred-at",
          "2026-05-29T17:00:00.000Z",
          "--summary",
          "Sent the first direct message after acceptance.",
          "--body",
          "Short direct message draft that was actually sent.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    assert.equal(secondTouch.touches.length, 2);

    const thirdTouch = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "touches",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          primaryProspectId,
          "--surface",
          "public_comment",
          "--direction",
          "outbound",
          "--outcome",
          "sent",
          "--occurred-at",
          "2026-05-30T17:00:00.000Z",
          "--summary",
          "Left a public comment on the recent LinkedIn post.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    assert.equal(thirdTouch.touches.length, 3);

    const motionProspectBrief = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "prospects", motion.id, "--prospect", primaryProspectId, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(motionProspectBrief.writingBrief.messageTestReady, true);
    assert.equal(motionProspectBrief.writingBrief.recentPost.engageable, true);
    assert.equal(motionProspectBrief.writingBrief.touches.length, 3);
    assert.equal(motionProspectBrief.writingBrief.signalMatches.length, 1);

    const motionDraftCases = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "drafts", motion.id, "--prospect", primaryProspectId, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const connectionRequestCard = motionDraftCases.surfaces.find((surface) => surface.key === "connection_request");
    const firstDirectMessageCard = motionDraftCases.surfaces.find((surface) => surface.key === "post_accept_message");
    const followUpCard = motionDraftCases.surfaces.find((surface) => surface.key === "follow_up_direct_message");
    const emailCard = motionDraftCases.surfaces.find((surface) => surface.key === "email");
    const publicCommentCard = motionDraftCases.surfaces.find((surface) => surface.key === "public_comment");
    const commentReplyCard = motionDraftCases.surfaces.find((surface) => surface.key === "comment_reply");

    assert.equal(connectionRequestCard.available, false);
    assert.match(connectionRequestCard.missingReason, /already recorded/i);
    assert.equal(firstDirectMessageCard.available, true);
    assert.equal(followUpCard.available, true);
    assert.equal(emailCard.available, true);
    assert.equal(publicCommentCard.available, true);
    assert.equal(commentReplyCard.available, true);
    assert.equal(firstDirectMessageCard.priorTouches.length, 3);

    const motionDraftBrief = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "draft-brief", motion.id, "--prospect", primaryProspectId, "--surface", "public_comment", "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(motionDraftBrief.surface.key, "public_comment");
    assert.equal(motionDraftBrief.surface.available, true);
    assert.match(motionDraftBrief.draftRequest.task, /unsent public comment draft/i);
    assert.ok(
      motionDraftBrief.draftRequest.rules.some((rule) => /do not pitch/i.test(rule)),
      "expected public-comment draft brief to include the no-pitch rule"
    );
    assert.ok(
      motionDraftBrief.draftRequest.sourceOfTruth.some((rule) => /prior touches/i.test(rule)),
      "expected draft brief to remind the chat to respect prior touches"
    );

    const shownMotion = JSON.parse(
      execFileSync("node", [cliPath, "motion", "show", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(shownMotion.targetMap.accounts.length, 1);
    assert.equal(shownMotion.targetMap.accounts[0].prospects.length, 2);
    assert.equal(shownMotion.targetMap.accounts[0].prospects[0].email, "minh@example.com");
    assert.equal(shownMotion.targetMap.accounts[0].prospects[0].liveSignal.channel, "linkedin");
    assert.equal(shownMotion.targetMap.accounts[0].prospects[0].touches.length, 3);
    assert.equal(shownMotion.targetMap.accounts[0].prospects[0].throughLine.status, "ready");
    assert.equal(shownMotion.targetMap.accounts[0].prospects[0].openingPlan.status, "ready");
    assert.equal(shownMotion.targetMap.accounts[0].prospects[0].cadenceState.status, "ready");
    assert.equal(shownMotion.stakeholderMap.status, "ready");
    assert.equal(shownMotion.stakeholderMap.stakeholders.length, 2);
    assert.equal(shownMotion.motionPlan.status, "ready");
    assert.equal(shownMotion.motionPlan.variants.length, 1);
    assert.match(shownMotion.targetMap.accounts[0].prospects[0].openingPlan.replyPath, /generic pitch/i);
    assert.equal(shownMotion.targetMap.accounts[0].prospects[0].openingPlan.primaryChannel, "connection-request");
    assert.ok(
      shownMotion.nextSteps.some((step) => /remaining chosen prospects/i.test(step)),
      "expected next steps to acknowledge that the second prospect still needs planning state before launch"
    );
    assert.ok(
      shownMotion.nextSteps.some((step) => /opening plans/i.test(step)),
      "expected next steps to surface the remaining opening-plan work for the second prospect"
    );

    const targeting = JSON.parse(
      execFileSync("node", [cliPath, "motion", "target", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(targeting.overallStage, "needs-through-line");
    assert.equal(targeting.readyToTarget, false);
    assert.equal(targeting.readyToEngage, false);
    assert.equal(targeting.browserGate.status, "blocked");
    assert.equal(targeting.companyLoop.companyCount, 1);
    assert.equal(targeting.companyLoop.items[0].stage, "needs-through-line");
    assert.equal(targeting.companyLoop.items[0].signalMatchCount, 1);
    assert.equal(targeting.companyLoop.items[0].prospectCount, 2);
    assert.equal(targeting.companyLoop.items[0].readyThroughLineCount, 1);
    assert.equal(targeting.companyLoop.items[0].readyOpeningPlanCount, 1);
    assert.equal(targeting.companyLoop.items[0].readyCadenceCount, 1);
    assert.ok(
      targeting.nextActions.some((step) => /trusted browser profile/i.test(step)),
      "expected targeting loop to surface the missing trusted browser gate"
    );
    assert.ok(
      targeting.nextActions.some((step) => /remaining prospect through-lines/i.test(step)),
      "expected targeting loop to point at the missing through-line work"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion remove deletes the motion and unlinks linked companies", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-remove-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--premise",
          "This offer matters when regulated lenders enter more complex credit-decision environments.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Actico Target",
          "--domain",
          "actico-target.example",
          "--motion",
          motion.id,
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const removeOutput = JSON.parse(
      execFileSync("node", [cliPath, "motion", "remove", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(removeOutput.removedMotion.id, motion.id);
    assert.equal(removeOutput.updatedCompanies.length, 1);
    assert.equal(removeOutput.updatedCompanies[0].id, company.id);
    assert.deepEqual(removeOutput.updatedCompanies[0].motionIds, []);

    const motionsAfter = JSON.parse(
      execFileSync("node", [cliPath, "motion", "list", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(motionsAfter.length, 0);

    const companyAfter = JSON.parse(
      execFileSync("node", [cliPath, "companies", "show", company.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.deepEqual(companyAfter.motionIds, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("config export/import round-trips motions, companies, and browser profiles", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-config-"));
  const sourceDir = path.join(tempRoot, "source");
  const targetDir = path.join(tempRoot, "target");
  const bundlePath = path.join(tempRoot, "exo-config.json");
  const userDataDir = path.join(tempRoot, "Chrome");
  const profileDirectory = "Profile 8";
  const profilePath = path.join(userDataDir, profileDirectory);

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: {
            name: "Alpha SDR"
          }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: "Alpha SDR" } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--geo",
          "Canada",
          "--title",
          "VP Sales Development",
          "--json"
        ],
        {
          cwd: sourceDir,
          encoding: "utf8"
        }
      )
    );

    execFileSync(
      "node",
      [
        cliPath,
        "profiles",
        "add",
        "--browser",
        "chrome",
        "--label",
        "alpha-linkedin",
        "--user-data-dir",
        userDataDir,
        "--profile-directory",
        profileDirectory,
        "--browser-command",
        "/bin/echo",
        "--capability",
        "linkedin",
        "--json"
      ],
      {
        cwd: sourceDir,
        encoding: "utf8"
      }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "add",
        "--name",
        "Procore",
        "--domain",
        "procore.com",
        "--motion",
        motion.id,
        "--json"
      ],
      {
        cwd: sourceDir,
        encoding: "utf8"
      }
    );

    const exported = JSON.parse(
      execFileSync("node", [cliPath, "config", "export", "--json"], {
        cwd: sourceDir,
        encoding: "utf8"
      })
    );
    assert.equal(exported.kind, "exo-config");
    assert.equal(exported.motions.length, 1);
    assert.equal(exported.companies.length, 1);
    assert.equal(exported.browserProfiles.length, 1);

    const exportOutput = execFileSync(
      "node",
      [cliPath, "config", "export", "--out", bundlePath],
      {
        cwd: sourceDir,
        encoding: "utf8"
      }
    );
    assert.match(exportOutput, /Exo Config Export/);
    assert.ok(fs.existsSync(bundlePath));

    const imported = JSON.parse(
      execFileSync("node", [cliPath, "config", "import", bundlePath, "--json"], {
        cwd: targetDir,
        encoding: "utf8"
      })
    );
    assert.equal(imported.counts.motions.inserted, 1);
    assert.equal(imported.counts.companies.inserted, 1);
    assert.equal(imported.counts.browserProfiles.inserted, 1);

    const targetMotions = JSON.parse(
      execFileSync("node", [cliPath, "motion", "list", "--json"], {
        cwd: targetDir,
        encoding: "utf8"
      })
    );
    assert.equal(targetMotions.length, 1);

    const targetProfiles = JSON.parse(
      execFileSync("node", [cliPath, "profiles", "list", "--json"], {
        cwd: targetDir,
        encoding: "utf8"
      })
    );
    assert.equal(targetProfiles.length, 1);
    assert.equal(targetProfiles[0].status, "ready");
    assert.deepEqual(targetProfiles[0].verifiedCapabilities, ["linkedin"]);

    const targetCompanies = JSON.parse(
      execFileSync("node", [cliPath, "companies", "list", "--json"], {
        cwd: targetDir,
        encoding: "utf8"
      })
    );
    assert.equal(targetCompanies.length, 1);
    assert.equal(targetCompanies[0].name, "Procore");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("CLI help explains agent-safe usage and profile gating", () => {
  const topLevelHelp = execFileSync("node", [cliPath, "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(topLevelHelp, /Prefer --json when Claude\/Codex is calling Exo/);
  assert.match(topLevelHelp, /Register and test a browser profile before any browser-backed work/);
  assert.match(topLevelHelp, /Current state location:/);

  const profilesHelp = execFileSync("node", [cliPath, "profiles", "add", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(profilesHelp, /Default paths are currently macOS-oriented/);
  assert.match(profilesHelp, /This command immediately runs a local profile verification pass/);

  const profileRootHelp = execFileSync("node", [cliPath, "profiles", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(profileRootHelp, /exo profiles discover --json/);
  assert.match(profileRootHelp, /exo profiles claim <profile-id> --label audienti-main/);
  assert.match(profileRootHelp, /exo profiles capabilities --json/);
  assert.match(profileRootHelp, /exo profiles resolve --capability linkedin --json/);

  const profileClaimHelp = execFileSync("node", [cliPath, "profiles", "claim", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(profileClaimHelp, /max-connection-requests/);
  assert.match(profileClaimHelp, /max-inmail-messages/);
  assert.match(profileClaimHelp, /weekly quotas/);

  const configHelp = execFileSync("node", [cliPath, "config", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(configHelp, /exo config export/);
  assert.match(configHelp, /Browser profiles are re-tested on import/);

  const companiesHelp = execFileSync("node", [cliPath, "companies", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(companiesHelp, /exo companies show <company-id>/);
  assert.match(companiesHelp, /exo companies update <company-id>/);
  assert.match(companiesHelp, /exo companies research-brief <company-id>/);
  assert.match(companiesHelp, /exo companies signal-matches show <company-id>/);
  assert.match(companiesHelp, /exo companies signal-matches add <company-id>/);
  assert.match(companiesHelp, /exo companies prospects show <company-id>/);
  assert.match(companiesHelp, /exo companies prospects add <company-id>/);
  assert.match(companiesHelp, /exo companies through-line show <company-id>/);
  assert.match(companiesHelp, /exo companies through-line set <company-id>/);
  assert.match(companiesHelp, /exo companies opening-plan show <company-id>/);
  assert.match(companiesHelp, /exo companies opening-plan set <company-id>/);
  assert.match(companiesHelp, /exo companies cadence show <company-id>/);
  assert.match(companiesHelp, /exo companies cadence set <company-id>/);
  assert.match(companiesHelp, /exo companies touches show <company-id>/);
  assert.match(companiesHelp, /exo companies touches add <company-id>/);
  assert.match(companiesHelp, /exo companies profile show <company-id>/);
  assert.match(companiesHelp, /exo companies profile assign <company-id> --profile <profile-id>/);
  assert.match(companiesHelp, /Keep the noun consistent/);

  const motionHelp = execFileSync("node", [cliPath, "motion", "add", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(motionHelp, /Use explicit excludes and DNC input up front/);
  assert.match(motionHelp, /Use --json when another agent needs the full motion object/);
  assert.match(motionHelp, /Use --premise to capture the prediction you are testing/);
  assert.match(motionHelp, /Use --config for richer structured motion seeds/);

  const motionRootHelp = execFileSync("node", [cliPath, "motion", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(motionRootHelp, /exo motion clone/);
  assert.match(motionRootHelp, /exo motion update/);
  assert.match(motionRootHelp, /exo motion prospects/);
  assert.match(motionRootHelp, /exo motion drafts/);
  assert.match(motionRootHelp, /exo motion draft-brief/);
  assert.match(motionRootHelp, /exo motion pause/);
  assert.match(motionRootHelp, /exo motion resume/);
  assert.match(motionRootHelp, /exo motion archive/);
  assert.match(motionRootHelp, /exo motion restart/);
  assert.match(motionRootHelp, /exo motion refresh/);
});

test("what-is-this returns machine-readable orientation for agents", () => {
  const output = execFileSync("node", [cliPath, "what-is-this", "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  const about = JSON.parse(output);
  assert.equal(about.name, "Exo");
  assert.equal(about.agentUsage.preferJson, true);
  assert.match(about.identity.oneLiner, /GTM operating kernel/i);
  assert.match(about.identity.oneLiner, /system of record/i);
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo what-is-this"),
    "expected identity command to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo config export/import"),
    "expected config portability surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo companies add/list/find/show/update/motions/research-brief/signal-matches show/add/prospects show/add/through-line show/set/opening-plan show/set/cadence show/set/touches show/add/profile show/assign"),
    "expected companies surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo motion start/add/target/prospects/drafts/draft-brief/clone/update/pause/resume/archive/restart/refresh/list/show/remove"),
    "expected motion write surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo profiles discover/add/claim/list/show/capabilities/resolve/test/remove"),
    "expected profile capability command surface to be listed in current capabilities"
  );
  assert.ok(
    about.agentUsage.bootstrapSequence.includes("exo companies list --json"),
    "expected bootstrap sequence to include company discovery"
  );
  assert.ok(
    about.agentUsage.bootstrapSequence.includes("exo profiles discover --json"),
    "expected bootstrap sequence to include profile discovery"
  );
  assert.ok(
    about.agentUsage.bootstrapSequence.includes("exo profiles capabilities --json"),
    "expected bootstrap sequence to include capability discovery"
  );
  assert.ok(
    about.agentUsage.bootstrapSequence.includes("exo profiles resolve --capability linkedin --json"),
    "expected bootstrap sequence to include profile resolution"
  );
  assert.ok(
    about.browserProfileRules.some((item) => /fail closed/i.test(item)),
    "expected browser profile rules to mention fail-closed behavior"
  );
  assert.ok(
    about.operatingRules.some((item) => /system of record/i.test(item)),
    "expected operating rules to explicitly treat Exo as the system of record"
  );
  assert.match(
    about.operatorInterface.principle,
    /system of record/i,
    "expected operator interface principle to explicitly mention system of record behavior"
  );
  if (about.stateSummary.motions.count > 0) {
    assert.ok(
      typeof about.stateSummary.motions.focusMotionName === "string" &&
        about.stateSummary.motions.focusMotionName.length > 0,
      "expected a focus motion name when motions exist"
    );
  } else {
    assert.equal(about.stateSummary.motions.focusMotionName, null);
  }
  assert.match(
    about.operatorInterface.principle,
    /operator interface/i,
    "expected operator interface guidance to be present"
  );
  assert.match(
    about.operatorInterface.currentCall.nextMove,
    /motion|browser|company/i,
    "expected operator interface to provide a next move"
  );
  assert.ok(
    ["continue-motion", "create-motion", "prepare-browser-work", "manage-companies"].includes(
      about.agentUsage.recommendedPath.mode
    ),
    "expected a recommended path mode"
  );
});

test("multiple agent processes can share one Exo state store through EXO_STATE_DIR", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-concurrency-"));
  const sharedStateDir = path.join(tempDir, "shared-state");
  const workerA = path.join(tempDir, "worker-a");
  const workerB = path.join(tempDir, "worker-b");
  fs.mkdirSync(workerA, { recursive: true });
  fs.mkdirSync(workerB, { recursive: true });

  const run = (cwd, index) =>
    new Promise((resolve, reject) => {
      execFile(
        "node",
        [
          cliPath,
          "motion", "add",
          "--url",
          offerUrl,
          "--geo",
          `Region-${index}`,
          "--title",
          `Role-${index}`,
          "--json"
        ],
        {
          cwd,
          env: {
            ...process.env,
            EXO_STATE_DIR: sharedStateDir
          },
          encoding: "utf8"
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
            return;
          }

          resolve(JSON.parse(stdout));
        }
      );
    });

  try {
    const motions = await Promise.all([
      run(workerA, 1),
      run(workerB, 2),
      run(workerA, 3),
      run(workerB, 4)
    ]);

    const listed = execFileSync("node", [cliPath, "motion", "list", "--json"], {
      cwd: workerA,
      env: {
        ...process.env,
        EXO_STATE_DIR: sharedStateDir
      },
      encoding: "utf8"
    });

    const allMotions = JSON.parse(listed);
    assert.equal(allMotions.length, 4);
    for (const motion of motions) {
      assert.ok(
        allMotions.some((listedMotion) => listedMotion.id === motion.id),
        `expected shared store to contain motion ${motion.id}`
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
