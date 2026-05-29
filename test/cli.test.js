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

test("motion intake returns the next one-at-a-time setup question before launch and becomes ready when the required specifics exist", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-intake-"));

  try {
    const firstQuestion = JSON.parse(
      execFileSync("node", [cliPath, "motion", "intake", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(firstQuestion.status, "needs-question");
    assert.equal(firstQuestion.nextQuestion.key, "url");

    const urlQuestion = JSON.parse(
      execFileSync("node", [cliPath, "motion", "intake", "--url", offerUrl, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(urlQuestion.nextQuestion.key, "premise");

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

    const existingQuestion = JSON.parse(
      execFileSync("node", [cliPath, "motion", "intake", "--url", offerUrl, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(existingQuestion.nextQuestion.key, "existing-strategy");
    assert.equal(existingQuestion.existingMotions.length, 1);

    const ready = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "intake",
          "--url",
          "https://example.com/another-offer",
          "--premise",
          "This offer matters when lenders widen risk and decisioning complexity.",
          "--audience",
          "Risk leaders",
          "--signal",
          "company::Is there recent evidence that this company launched a new lending workflow?",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    assert.equal(ready.readyToLaunch, true);
    assert.equal(ready.status, "ready-to-launch");
    assert.match(ready.launchCommandHint, /exo motion start/);
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

    assert.equal(versionRow.user_version, 7);

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

test("execution users can own mixed profile-backed and harness-backed accounts, and company assignment resolves per capability", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-user-assignment-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const linkedinDirectory = "Profile 4";
  const gmailDirectory = "Profile 9";
  const linkedinPath = path.join(userDataDir, linkedinDirectory);
  const gmailPath = path.join(userDataDir, gmailDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(linkedinPath, { recursive: true });
  fs.mkdirSync(gmailPath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [linkedinDirectory]: { name: "LinkedIn Main" },
          [gmailDirectory]: { name: "Email Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(linkedinPath, "Preferences"), JSON.stringify({ profile: { name: "LinkedIn Main" } }));
  fs.writeFileSync(path.join(gmailPath, "Preferences"), JSON.stringify({ profile: { name: "Email Main" } }));
  seedBrowserEvidence(linkedinPath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/sales/home"]
  });
  seedBrowserEvidence(gmailPath, {
    cookieHosts: ["mail.google.com"],
    historyUrls: ["https://mail.google.com/mail/u/0/#inbox"]
  });

  try {
    const linkedinProfile = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "add",
          "--browser",
          "chrome",
          "--label",
          "linkedin-profile",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          linkedinDirectory,
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

    const gmailProfile = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "add",
          "--browser",
          "chrome",
          "--label",
          "gmail-profile",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          gmailDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "gmail",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir }, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "users", "add", "--label", "william-main", "--owner", "william", "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const afterLinkedin = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "william@linkedin",
          "--profile",
          linkedinProfile.id,
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(afterLinkedin.accounts.length, 1);
    assert.equal(afterLinkedin.accounts[0].sourceType, "browser-profile");

    const afterGmail = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "gmail",
          "--handle",
          "william@audienti.com",
          "--runtime",
          "codex",
          "--connector",
          "gmail",
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(afterGmail.harnessConnections.length, 1);
    assert.equal(afterGmail.harnessConnections[0].runtime, "codex");
    assert.equal(afterGmail.harnessConnections[0].connector, "gmail");
    assert.equal(afterGmail.accounts.length, 2);

    const resolvedLinkedin = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "users", "resolve", user.id, "--capability", "linkedin", "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(resolvedLinkedin.resolved.sourceType, "browser-profile");
    assert.equal(resolvedLinkedin.resolved.browserProfile.id, linkedinProfile.id);

    const resolvedGmail = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "users", "resolve", user.id, "--capability", "gmail", "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(resolvedGmail.resolved.sourceType, "harness-connection");
    assert.equal(resolvedGmail.resolved.harnessConnection.runtime, "codex");
    assert.equal(resolvedGmail.resolved.harnessConnection.connector, "gmail");

    const company = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "companies", "add", "--name", "Chainguard", "--domain", "chainguard.dev", "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const assigned = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "user",
          "assign",
          company.id,
          "--user",
          user.id,
          "--reason",
          "Use one human identity across LinkedIn and email.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    assert.equal(assigned.engagementUserAssignment.userId, user.id);
    assert.equal(assigned.engagementUserAssignment.label, "william-main");
    assert.equal(assigned.engagementProfileAssignment.profileId, linkedinProfile.id);

    const shownAssignment = JSON.parse(
      execFileSync("node", [cliPath, "companies", "user", "show", company.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(shownAssignment.assignment.userId, user.id);

    const companyLinkedinResolution = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "users", "resolve", "--company", company.id, "--capability", "linkedin", "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(companyLinkedinResolution.resolved.browserProfile.id, linkedinProfile.id);

    const stickyLinkedinProfile = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "profiles", "resolve", "--company", company.id, "--capability", "linkedin", "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(stickyLinkedinProfile.resolutionMode, "company-user-assignment");
    assert.equal(stickyLinkedinProfile.resolved.id, linkedinProfile.id);

    const stickyGmailProfile = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "profiles", "resolve", "--company", company.id, "--capability", "gmail", "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(stickyGmailProfile.resolved, null);
    assert.equal(stickyGmailProfile.resolutionMode, "blocked-by-company-user-assignment");
    assert.match(stickyGmailProfile.blocker, /harness connection/i);

    assert.equal(gmailProfile.verifiedCapabilities.includes("gmail"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound surfaces, per-account sync policy, and sync-state memory persist on connected user accounts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-sync-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const linkedinDirectory = "Profile 4";
  const linkedinPath = path.join(userDataDir, linkedinDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(linkedinPath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [linkedinDirectory]: { name: "LinkedIn Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(linkedinPath, "Preferences"), JSON.stringify({ profile: { name: "LinkedIn Main" } }));
  seedBrowserEvidence(linkedinPath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
    const inboundSurfaces = JSON.parse(
      execFileSync("node", [cliPath, "inbound", "surfaces", "--capability", "linkedin", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(inboundSurfaces.surfaces.length, 8);
    assert.equal(inboundSurfaces.surfaces[0].truthLevel, "authoritative");
    assert.equal(inboundSurfaces.surfaces.some((surface) => surface.key === "linkedin-followers-list"), true);
    assert.equal(inboundSurfaces.surfaces.some((surface) => surface.key === "linkedin-catch-up-updates"), true);

    const inboundSurface = JSON.parse(
      execFileSync("node", [cliPath, "inbound", "surface", "linkedin-profile-views", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(inboundSurface.surface.capability, "linkedin");
    assert.match(inboundSurface.surface.summary, /attention/i);

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
          "linkedin-profile",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          linkedinDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "william-main", "--owner", "william", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    const withLinkedin = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "william@linkedin",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const withGmail = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "gmail",
          "--handle",
          "william@audienti.com",
          "--runtime",
          "codex",
          "--connector",
          "gmail",
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const linkedinAccountId = withGmail.accounts.find((account) => account.capability === "linkedin").id;
    const gmailAccountId = withGmail.accounts.find((account) => account.capability === "gmail").id;

    const inboundBefore = JSON.parse(
      execFileSync("node", [cliPath, "inbound", "sync", "show", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(inboundBefore.accounts.length, 2);
    const linkedinBefore = inboundBefore.accounts.find((account) => account.accountId === linkedinAccountId);
    const gmailBefore = inboundBefore.accounts.find((account) => account.accountId === gmailAccountId);
    assert.equal(linkedinBefore.enabledSurfaceCount, 7);
    assert.equal(gmailBefore.enabledSurfaceCount, 1);
    assert.equal(
      linkedinBefore.surfaces.find((surface) => surface.key === "linkedin-catch-up-updates").enabled,
      false
    );
    assert.equal(linkedinBefore.surfaces.find((surface) => surface.key === "linkedin-profile-views").lastRunStatus, "never");

    const inboundAfterSet = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "sync",
          "set",
          user.id,
          "--account",
          linkedinAccountId,
          "--disable-surface",
          "linkedin-comment-replies",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const linkedinAfterSet = inboundAfterSet.accounts.find((account) => account.accountId === linkedinAccountId);
    assert.equal(linkedinAfterSet.enabledSurfaceCount, 6);
    assert.equal(
      linkedinAfterSet.surfaces.find((surface) => surface.key === "linkedin-comment-replies").enabled,
      false
    );

    const inboundAfterRecord = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "sync",
          "record",
          user.id,
          "--account",
          linkedinAccountId,
          "--surface",
          "linkedin-profile-views",
          "--status",
          "success",
          "--observed-at",
          "2026-05-28T13:00:00.000Z",
          "--item-count",
          "4",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const linkedinAfterRecord = inboundAfterRecord.accounts.find((account) => account.accountId === linkedinAccountId);
    const profileViews = linkedinAfterRecord.surfaces.find((surface) => surface.key === "linkedin-profile-views");
    assert.equal(profileViews.lastRunStatus, "success");
    assert.equal(profileViews.lastObservedAt, "2026-05-28T13:00:00.000Z");
    assert.equal(profileViews.lastItemCount, 4);
    assert.ok(profileViews.lastSyncedAt);

    const inboundFailedGmail = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "sync",
          "record",
          user.id,
          "--account",
          gmailAccountId,
          "--surface",
          "gmail-inbox-threads",
          "--status",
          "failed",
          "--error",
          "Connector timeout",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const gmailAfterFail = inboundFailedGmail.accounts.find((account) => account.accountId === gmailAccountId);
    const gmailThreads = gmailAfterFail.surfaces.find((surface) => surface.key === "gmail-inbox-threads");
    assert.equal(gmailThreads.lastRunStatus, "failed");
    assert.equal(gmailThreads.lastError, "Connector timeout");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound observations can be written back as normalized state without live retrieval", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-observations-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const linkedinDirectory = "Profile 4";
  const linkedinPath = path.join(userDataDir, linkedinDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(linkedinPath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [linkedinDirectory]: { name: "LinkedIn Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(linkedinPath, "Preferences"), JSON.stringify({ profile: { name: "LinkedIn Main" } }));
  seedBrowserEvidence(linkedinPath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
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
          "linkedin-profile",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          linkedinDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "william-main", "--owner", "william", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    const withLinkedin = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "william@linkedin",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    const firstObservation = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "observations",
          "add",
          user.id,
          "--account",
          linkedinAccountId,
          "--surface",
          "linkedin-messaging-inbox",
          "--kind",
          "inbound_reply_received",
          "--observed-at",
          "2026-05-28T14:00:00.000Z",
          "--external-id",
          "thread-123",
          "--actor-name",
          "Parm Uppal",
          "--actor-title",
          "Chief Revenue Officer",
          "--actor-company",
          "Chainguard",
          "--actor-profile-url",
          "https://www.linkedin.com/in/parm-uppal/",
          "--thread-url",
          "https://www.linkedin.com/messaging/thread/123/",
          "--summary",
          "Parm replied in the LinkedIn inbox.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(firstObservation.observation.kind, "inbound_reply_received");

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "sync",
        "record",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-profile-views",
        "--status",
        "success",
        "--observed-at",
        "2026-05-28T13:00:00.000Z",
        "--item-count",
        "1",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "observations",
        "add",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-messaging-inbox",
        "--kind",
        "inbound_reply_received",
        "--observed-at",
        "2026-05-28T14:05:00.000Z",
        "--external-id",
        "thread-123",
        "--actor-name",
        "Parm Uppal",
        "--summary",
        "Parm replied again with a follow-up question.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "observations",
        "add",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-catch-up-updates",
        "--kind",
        "public_engagement_opportunity",
        "--observed-at",
        "2026-05-28T15:00:00.000Z",
        "--external-id",
        "catchup-456",
        "--actor-name",
        "Tina Wheeler",
        "--source-url",
        "https://www.linkedin.com/feed/update/urn:li:activity:456/",
        "--summary",
        "Tracked voice posted about outbound quality and trust.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const allObservations = JSON.parse(
      execFileSync("node", [cliPath, "inbound", "observations", "list", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );
    assert.equal(allObservations.counts.observationCount, 2);
    assert.equal(allObservations.counts.surfaceCount, 2);
    assert.equal(allObservations.observations[0].surfaceKey, "linkedin-catch-up-updates");

    const inboxOnly = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "observations",
          "list",
          user.id,
          "--surface",
          "linkedin-messaging-inbox",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(inboxOnly.counts.observationCount, 1);
    assert.equal(inboxOnly.observations[0].summary, "Parm replied again with a follow-up question.");
    assert.equal(inboxOnly.observations[0].actorName, "Parm Uppal");

    const shownObservation = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "inbound", "observations", "show", inboxOnly.observations[0].id, "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    assert.equal(shownObservation.observation.threadUrl, "https://www.linkedin.com/messaging/thread/123/");
    assert.equal(shownObservation.observation.actorCompanyName, "Chainguard");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbox ranks inbound observations into an operator-facing triage view with next-step hints", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbox-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const linkedinDirectory = "Profile 4";
  const linkedinPath = path.join(userDataDir, linkedinDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(linkedinPath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [linkedinDirectory]: { name: "LinkedIn Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(linkedinPath, "Preferences"), JSON.stringify({ profile: { name: "LinkedIn Main" } }));
  seedBrowserEvidence(linkedinPath, {
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
          "--premise",
          "This offer matters when outbound quality needs to improve.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is there current GTM complexity that makes relevance matter more?",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "companies", "add", "--name", "Chainguard", "--domain", "chainguard.dev", "--motion", motion.id, "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const prospectResult = JSON.parse(
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
          "Parm Uppal",
          "--title",
          "Chief Revenue Officer",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--why-relevant",
          "Primary buying owner for the motion.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const prospect = prospectResult.prospects[0];

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
          "linkedin-profile",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          linkedinDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "william-main", "--owner", "william", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    const withLinkedin = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "william@linkedin",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "observations",
        "add",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-profile-views",
        "--kind",
        "profile_view_after_touch",
        "--observed-at",
        "2026-05-28T13:00:00.000Z",
        "--actor-name",
        "Parm Uppal",
        "--summary",
        "Parm viewed our profile after the connection request.",
        "--motion",
        motion.id,
        "--company",
        company.id,
        "--prospect",
        prospect.id,
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "observations",
        "add",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-messaging-inbox",
        "--kind",
        "inbound_reply_received",
        "--observed-at",
        "2026-05-28T14:00:00.000Z",
        "--actor-name",
        "Parm Uppal",
        "--summary",
        "Parm replied in the LinkedIn inbox.",
        "--motion",
        motion.id,
        "--company",
        company.id,
        "--prospect",
        prospect.id,
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const inbox = JSON.parse(
      execFileSync("node", [cliPath, "inbox", "--user", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(inbox.counts.itemCount, 2);
    assert.equal(inbox.items[0].kind, "inbound_reply_received");
    assert.equal(inbox.items[0].priority, "high");
    assert.match(inbox.items[0].recommendedAction, /reply/i);
    assert.equal(inbox.items[0].motion.name, motion.name);
    assert.equal(inbox.items[0].company.name, "Chainguard");
    assert.equal(inbox.items[0].prospect.name, "Parm Uppal");

    assert.equal(inbox.items[1].kind, "profile_view_after_touch");
    assert.equal(inbox.items[1].priority, "medium");
    assert.match(inbox.items[1].whyItMatters, /attention/i);
    assert.equal(inbox.surfaces.enabledSurfaceCount, 7);
    const profileViewSurface = inbox.surfaces.accounts[0].surfaces.find((surface) => surface.key === "linkedin-profile-views");
    assert.ok(profileViewSurface);
    assert.match(profileViewSurface.summary, /Profile Views/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("inbound review shows decision-ready items, stale sent invites, and itemization gaps", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-inbound-review-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const linkedinDirectory = "Profile 4";
  const linkedinPath = path.join(userDataDir, linkedinDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(linkedinPath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [linkedinDirectory]: { name: "LinkedIn Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(linkedinPath, "Preferences"), JSON.stringify({ profile: { name: "LinkedIn Main" } }));
  seedBrowserEvidence(linkedinPath, {
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
          "--premise",
          "This offer matters when a rep needs a real inbound review surface.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is there enough pipeline motion to justify outbound work?",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "companies", "add", "--name", "Chainguard", "--domain", "chainguard.dev", "--motion", motion.id, "--json"],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const prospectResult = JSON.parse(
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
          "Parm Uppal",
          "--title",
          "Chief Revenue Officer",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--why-relevant",
          "Primary buying owner for the motion.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const prospect = prospectResult.prospects[0];

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
          "linkedin-profile",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          linkedinDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "william-main", "--owner", "william", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    const withLinkedin = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "william@linkedin",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "sync",
        "record",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-sent-invitations",
        "--status",
        "success",
        "--observed-at",
        "2026-04-20T13:00:00.000Z",
        "--item-count",
        "1",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "sync",
        "record",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-received-invitations",
        "--status",
        "success",
        "--observed-at",
        "2026-05-28T13:00:00.000Z",
        "--item-count",
        "1",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "sync",
        "record",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-comment-replies",
        "--status",
        "success",
        "--observed-at",
        "2026-05-28T14:00:00.000Z",
        "--item-count",
        "2",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "observations",
        "add",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-sent-invitations",
        "--kind",
        "connection_request_pending",
        "--observed-at",
        "2026-04-20T13:00:00.000Z",
        "--actor-name",
        "Parm Uppal",
        "--summary",
        "Parm Uppal's connection request is still pending.",
        "--motion",
        motion.id,
        "--company",
        company.id,
        "--prospect",
        prospect.id,
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "observations",
        "add",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-received-invitations",
        "--kind",
        "connection_request_received",
        "--observed-at",
        "2026-05-28T13:00:00.000Z",
        "--actor-name",
        "Alicia Buyer",
        "--summary",
        "Alicia Buyer sent us a new inbound connection request.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const review = JSON.parse(
      execFileSync("node", [cliPath, "inbound", "review", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(review.counts.reviewItemCount, 2);
    assert.equal(review.counts.decisionItemCount, 2);
    assert.equal(review.counts.itemizationGapCount, 1);

    const incomingInvite = review.reviewItems.find((item) => item.kind === "connection_request_received");
    assert.equal(incomingInvite.state, "needs_decision");
    assert.deepEqual(incomingInvite.decisionOptions, ["accept", "decline"]);

    const staleSentInvite = review.reviewItems.find((item) => item.kind === "connection_request_pending");
    assert.equal(staleSentInvite.state, "stale_withdraw_review");
    assert.match(staleSentInvite.recommendedAction, /withdraw/i);

    const commentReplyGap = review.itemizationGaps.find((gap) => gap.surfaceKey === "linkedin-comment-replies");
    assert.ok(commentReplyGap);
    assert.equal(commentReplyGap.itemCount, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily and next surface inbound review decisions before idle outbound work", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-daily-inbound-review-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const linkedinDirectory = "Profile 4";
  const linkedinPath = path.join(userDataDir, linkedinDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(linkedinPath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [linkedinDirectory]: { name: "LinkedIn Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(linkedinPath, "Preferences"), JSON.stringify({ profile: { name: "LinkedIn Main" } }));
  seedBrowserEvidence(linkedinPath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
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
          "linkedin-profile",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          linkedinDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "william-main", "--owner", "william", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    const withLinkedin = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "william@linkedin",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    for (const surfaceKey of [
      "linkedin-sent-invitations",
      "linkedin-received-invitations",
      "linkedin-messaging-inbox",
      "linkedin-profile-views",
      "linkedin-following-list"
    ]) {
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "sync",
          "record",
          user.id,
          "--account",
          linkedinAccountId,
          "--surface",
          surfaceKey,
          "--status",
          "success",
          "--observed-at",
          "2026-05-28T13:00:00.000Z",
          "--item-count",
          surfaceKey === "linkedin-received-invitations" ? "1" : "0",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      );
    }

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "observations",
        "add",
        user.id,
        "--account",
        linkedinAccountId,
        "--surface",
        "linkedin-received-invitations",
        "--kind",
        "connection_request_received",
        "--observed-at",
        "2026-05-28T13:00:00.000Z",
        "--actor-name",
        "Alicia Buyer",
        "--summary",
        "Alicia Buyer sent us a new inbound connection request.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const daily = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(daily.items[0].source.type, "inbound_review");
    assert.equal(daily.items[0].source.kind, "needs_decision");
    assert.equal(daily.items[0].cadenceEffect, "inbound_review_needed");
    assert.equal(daily.items[0].guidance.key, "review_inbound_item");
    assert.match(daily.items[0].recommendedAction, /accept or decline/i);

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(next.source, "daily");
    assert.equal(next.status.effect, "inbound_review_needed");
    assert.equal(next.guidance.key, "review_inbound_item");
    assert.match(next.nextMove, /accept or decline/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily and next surface inbound itemization gaps when sync counts items without observations", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-daily-inbound-gap-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const linkedinDirectory = "Profile 4";
  const linkedinPath = path.join(userDataDir, linkedinDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(linkedinPath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [linkedinDirectory]: { name: "LinkedIn Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(linkedinPath, "Preferences"), JSON.stringify({ profile: { name: "LinkedIn Main" } }));
  seedBrowserEvidence(linkedinPath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  try {
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
          "linkedin-profile",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          linkedinDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "william-main", "--owner", "william", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    const withLinkedin = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "william@linkedin",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const linkedinAccountId = withLinkedin.accounts.find((account) => account.capability === "linkedin").id;

    for (const surfaceKey of [
      "linkedin-sent-invitations",
      "linkedin-received-invitations",
      "linkedin-messaging-inbox",
      "linkedin-profile-views",
      "linkedin-following-list"
    ]) {
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "sync",
          "record",
          user.id,
          "--account",
          linkedinAccountId,
          "--surface",
          surfaceKey,
          "--status",
          "success",
          "--observed-at",
          "2026-05-28T13:00:00.000Z",
          "--item-count",
          surfaceKey === "linkedin-received-invitations" ? "2" : "0",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      );
    }

    const daily = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(daily.items[0].source.type, "inbound_itemization_gap");
    assert.equal(daily.items[0].source.kind, "linkedin-received-invitations");
    assert.equal(daily.items[0].cadenceEffect, "inbound_itemization_needed");
    assert.equal(daily.items[0].guidance.key, "itemize_inbound_surface");
    assert.match(daily.items[0].recommendedAction, /write each concrete item back/i);

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(next.source, "daily");
    assert.equal(next.status.effect, "inbound_itemization_needed");
    assert.equal(next.guidance.key, "itemize_inbound_surface");
    assert.match(next.nextMove, /write each concrete item back/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily reconciles cadence with inbound observations into due, waiting, and overridden agenda items", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-daily-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/daily",
          "--premise",
          "This offer matters when a GTM leader needs signal-led outreach.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company scaling GTM headcount or product surface?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: tempDir }
    });

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Daily Systems",
          "--domain",
          "daily.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "Daily User", "--owner", "William", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    const userWithAccount = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "daily-user",
          "--runtime",
          "codex",
          "--connector",
          "chrome",
          "--preferred",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const linkedinAccount = userWithAccount.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "user",
        "assign",
        company.id,
        "--user",
        user.id,
        "--reason",
        "Run the daily agenda through one execution user",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const replyProspect = JSON.parse(
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
          "Ana Reply",
          "--title",
          "CRO",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--why-relevant",
          "Owns the commercial motion",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    ).prospects[0];

    const waitingProspect = JSON.parse(
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
          "Ben Wait",
          "--title",
          "VP Sales Development",
          "--buying-committee-role",
          "operator_champion",
          "--decision-authority",
          "influences",
          "--fit-confidence",
          "moderate",
          "--why-relevant",
          "Owns the SDR execution branch",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    ).prospects[1];

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
        replyProspect.id,
        "--current-step",
        "connection-request",
        "--next-action",
        "Send the planned follow-up message",
        "--next-action-due-at",
        "2026-05-28T12:00:00.000Z",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

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
        waitingProspect.id,
        "--current-step",
        "connection-request",
        "--next-action",
        "Send the planned connection request",
        "--next-action-due-at",
        "2026-06-01T12:00:00.000Z",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "observations",
        "add",
        user.id,
        "--account",
        linkedinAccount.id,
        "--surface",
        "linkedin-messaging-inbox",
        "--kind",
        "inbound_reply_received",
        "--motion",
        motion.id,
        "--company",
        company.id,
        "--prospect",
        replyProspect.id,
        "--observed-at",
        "2026-05-28T13:00:00.000Z",
        "--summary",
        "Ana replied in LinkedIn",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const daily = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.equal(daily.counts.itemCount, 2);
    assert.equal(daily.counts.replyPriorityCount, 1);
    assert.equal(daily.counts.actionPriorityCount, 0);
    assert.equal(daily.counts.waitPriorityCount, 1);
    assert.equal(daily.counts.dueNowCount, 1);
    assert.equal(daily.counts.waitingCount, 1);
    assert.equal(daily.counts.overriddenByInboundCount, 1);
    assert.equal(daily.items[0].prospect.name, "Ana Reply");
    assert.equal(daily.items[0].state, "due_now");
    assert.equal(daily.items[0].priority, "reply");
    assert.equal(daily.items[0].cadenceEffect, "overridden_by_inbound");
    assert.match(daily.items[0].recommendedAction, /reply/i);
    assert.equal(daily.items[0].source.kind, "inbound_reply_received");
    assert.equal(daily.items[0].guidance.key, "reply_to_inbound");
    assert.match(daily.items[0].guidance.docPath, /docs\/planner\/reply_to_inbound\.md$/);
    assert.match(daily.items[0].guidance.taskPrompt, /Inspect the live inbound thread/i);
    assert.equal(daily.items[1].prospect.name, "Ben Wait");
    assert.equal(daily.items[1].state, "waiting_until");
    assert.equal(daily.items[1].priority, "wait");
    assert.equal(daily.items[1].cadenceEffect, "none");
    assert.match(daily.items[1].recommendedAction, /wait|hold/i);
    assert.equal(daily.items[1].guidance.key, "wait_for_due_checkpoint");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily surfaces a parallel support action while a live outbound branch waits on an external trigger", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-daily-support-action-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/daily-support",
          "--premise",
          "This offer matters when GTM leaders need signal-led outreach.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company broadening its GTM story or product surface?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: tempDir }
    });

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Support Systems",
          "--domain",
          "support.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "Support User", "--owner", "William", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    const userWithAccount = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "support-user",
          "--runtime",
          "codex",
          "--connector",
          "chrome",
          "--preferred",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const linkedinAccount = userWithAccount.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);
    const syncedAt = new Date().toISOString();

    for (const surfaceKey of [
      "linkedin-sent-invitations",
      "linkedin-received-invitations",
      "linkedin-messaging-inbox",
      "linkedin-profile-views",
      "linkedin-following-list"
    ]) {
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "sync",
          "record",
          user.id,
          "--account",
          linkedinAccount.id,
          "--surface",
          surfaceKey,
          "--status",
          "success",
          "--observed-at",
          syncedAt,
          "--item-count",
          "0",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      );
    }

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "user",
        "assign",
        company.id,
        "--user",
        user.id,
        "--reason",
        "Drive the daily through one execution user",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const prospect = JSON.parse(
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
          "Paula Pending",
          "--title",
          "Chief Revenue Officer",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--why-relevant",
          "Owns the executive outbound branch",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    ).prospects[0];

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
        prospect.id,
        "--current-step",
        "connection-request",
        "--last-touch-channel",
        "connection-request",
        "--last-touch-outcome",
        "sent",
        "--last-touch-at",
        "2026-05-27T11:46:51.000Z",
        "--next-action",
        "Wait for acceptance before escalating.",
        "--next-action-due-at",
        "2026-05-30T11:46:51.000Z",
        "--notes",
        "Primary owner path is ready but unsent; wait for operator before launch.",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const daily = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.equal(daily.counts.itemCount, 1);
    assert.equal(daily.counts.actionPriorityCount, 1);
    assert.equal(daily.counts.waitPriorityCount, 0);
    assert.equal(daily.counts.dueNowCount, 1);
    assert.equal(daily.items[0].prospect.name, "Paula Pending");
    assert.equal(daily.items[0].state, "due_now");
    assert.equal(daily.items[0].priority, "action");
    assert.equal(daily.items[0].cadenceEffect, "supporting_waiting_branch");
    assert.equal(daily.items[0].source.type, "parallel_support_action");
    assert.equal(daily.items[0].guidance.key, "find_contact_points");
    assert.match(daily.items[0].recommendedAction, /verified direct email/i);
    assert.match(daily.items[0].guidance.taskPrompt, /First, check owned evidence/i);
    assert.match(daily.items[0].guidance.taskPrompt, /Second, use Google searches and browser-based public-web work/i);
    assert.match(daily.items[0].guidance.taskPrompt, /email permutations/i);
    assert.match(daily.items[0].guidance.taskPrompt, /prospects update .* --prospect /i);
    assert.equal(daily.items[0].waitingBranch.kind, "wait_for_connection_response");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily surfaces a sync action before trustable silence when enabled inbound surfaces were never checked", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-daily-sync-needed-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/daily-sync-needed",
          "--premise",
          "This offer matters when operators need a governed GTM planner.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company actively working live outbound branches?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: tempDir }
    });

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Sync Needed Co",
          "--domain",
          "sync-needed.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "Sync Needed User", "--owner", "William", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    execFileSync(
      "node",
      [
        cliPath,
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "sync-needed-user",
        "--runtime",
        "codex",
        "--connector",
        "chrome",
        "--preferred",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "user",
        "assign",
        company.id,
        "--user",
        user.id,
        "--reason",
        "Make inbound sync freshness part of the planner.",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const daily = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.equal(daily.counts.itemCount, 1);
    assert.equal(daily.counts.actionPriorityCount, 1);
    assert.equal(daily.items[0].prospect.name, "Inbound sync");
    assert.equal(daily.items[0].state, "due_now");
    assert.equal(daily.items[0].priority, "action");
    assert.equal(daily.items[0].cadenceEffect, "sync_needed");
    assert.equal(daily.items[0].source.type, "inbound_sync");
    assert.match(daily.items[0].recommendedAction, /run a quick inbound sync/i);
    assert.equal(daily.items[0].guidance.key, "sync_inbound_surfaces");
    assert.match(daily.items[0].guidance.taskPrompt, /write back every meaningful change/i);

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.ok(["daily", "motion"].includes(next.source));
    assert.equal(next.status.kind, "due_now");
    assert.equal(next.status.priority, "action");
    assert.equal(next.status.effect, "sync_needed");
    assert.equal(next.guidance.key, "sync_inbound_surfaces");
    assert.match(next.nextMove, /run a quick inbound sync/i);
    assert.equal(next.context.source.type, "inbound_sync");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily and next expand motion inventory instead of idling when a live branch is waiting and no better branch exists", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-daily-expand-inventory-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/daily-expand-inventory",
          "--premise",
          "This offer matters when GTM teams need a full day of signal-led outbound work.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company visibly scaling pipeline generation or GTM surface area?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: tempDir }
    });

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Inventory Systems",
          "--domain",
          "inventory.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "Inventory User", "--owner", "William", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    const userWithAccount = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "inventory-user",
          "--runtime",
          "codex",
          "--connector",
          "chrome",
          "--preferred",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const linkedinAccount = userWithAccount.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);
    const syncedAt = new Date().toISOString();

    for (const surfaceKey of [
      "linkedin-sent-invitations",
      "linkedin-received-invitations",
      "linkedin-messaging-inbox",
      "linkedin-profile-views",
      "linkedin-following-list"
    ]) {
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "sync",
          "record",
          user.id,
          "--account",
          linkedinAccount.id,
          "--surface",
          surfaceKey,
          "--status",
          "success",
          "--observed-at",
          syncedAt,
          "--item-count",
          "0",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      );
    }

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "user",
        "assign",
        company.id,
        "--user",
        user.id,
        "--reason",
        "Keep planner work routed through one execution user",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const prospect = JSON.parse(
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
          "Ivy Waiting",
          "--title",
          "Chief Revenue Officer",
          "--email",
          "ivy.waiting@inventory.example",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--why-relevant",
          "Owns the current primary outbound branch",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    ).prospects[0];

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
        prospect.id,
        "--current-step",
        "connection-request",
        "--last-touch-channel",
        "connection-request",
        "--last-touch-outcome",
        "sent",
        "--last-touch-at",
        "2026-05-27T11:46:51.000Z",
        "--next-action",
        "Wait for acceptance before escalating.",
        "--next-action-due-at",
        "2026-05-30T11:46:51.000Z",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const daily = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.equal(daily.counts.itemCount, 1);
    assert.equal(daily.items[0].state, "due_now");
    assert.equal(daily.items[0].priority, "action");
    assert.equal(daily.items[0].cadenceEffect, "supporting_waiting_branch");
    assert.equal(daily.items[0].source.kind, "parallel_motion_inventory");
    assert.equal(daily.items[0].guidance.key, "expand_motion_inventory");
    assert.match(daily.items[0].recommendedAction, /build more ready first-touch inventory/i);

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--motion", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.ok(["daily", "motion"].includes(next.source));
    assert.equal(next.status.kind, "due_now");
    assert.equal(next.status.priority, "action");
    assert.equal(next.status.effect, "supporting_waiting_branch");
    assert.equal(next.guidance.key, "expand_motion_inventory");
    assert.match(next.nextMove, /build more ready first-touch inventory/i);
    assert.equal(next.context.source.kind, "parallel_motion_inventory");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily and next surface connection-request quota gaps and invitation deficits before generic inventory work", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-daily-capacity-deficit-"));
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
          [profileDirectory]: { name: "Quota Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: "Quota Main" } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com", "mail.google.com"],
    historyUrls: ["https://www.linkedin.com/feed/", "https://mail.google.com/mail/u/0/#inbox"]
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
          "https://example.com/daily-capacity-deficit",
          "--premise",
          "This offer matters when outbound teams need enough inventory to fill daily connection-request capacity.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company visibly scaling pipeline generation or GTM surface area?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: tempDir }
    });

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Quota Systems",
          "--domain",
          "quota.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
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
          "quota-main",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          profileDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--capability",
          "gmail",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir }, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "quota-user", "--owner", "William", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    const userWithLinkedin = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "quota-user",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const linkedinAccount = userWithLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const userWithGmail = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "gmail",
          "--handle",
          "quota-user",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const gmailAccount = userWithGmail.accounts.find((account) => account.capability === "gmail");
    assert.ok(gmailAccount);

    const syncedAt = new Date().toISOString();
    for (const [accountId, surfaceKeys] of [
      [
        linkedinAccount.id,
        [
          "linkedin-sent-invitations",
          "linkedin-received-invitations",
          "linkedin-messaging-inbox",
          "linkedin-profile-views",
          "linkedin-following-list"
        ]
      ],
      [
        gmailAccount.id,
        ["gmail-inbox-threads"]
      ]
    ]) {
      for (const surfaceKey of surfaceKeys) {
        execFileSync(
          "node",
          [
            cliPath,
            "inbound",
            "sync",
            "record",
            user.id,
            "--account",
            accountId,
            "--surface",
            surfaceKey,
            "--status",
            "success",
            "--observed-at",
            syncedAt,
            "--item-count",
            "0",
            "--json"
          ],
          { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
        );
      }
    }

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "user",
        "assign",
        company.id,
        "--user",
        user.id,
        "--reason",
        "Keep planner work routed through one execution user",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const prospect = JSON.parse(
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
          "Quinn Waiting",
          "--title",
          "Chief Revenue Officer",
          "--email",
          "quinn.waiting@quota.example",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--why-relevant",
          "Owns the current primary outbound branch",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    ).prospects[0];

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
        prospect.id,
        "--specific-to-them",
        "Quinn owns the branch.",
        "--shared-problem",
        "Pipeline creation needs consistent executive access.",
        "--why-now",
        "The team needs enough quality first touches every day.",
        "--legitimate-wedge",
        "A pacing-aware outbound system is missing.",
        "--compression-line",
        "Daily capacity is only real if the motion can fill it.",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

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
        prospect.id,
        "--why-now",
        "The current motion is inventory-thin.",
        "--angle",
        "Connect outbound pacing to motion throughput.",
        "--reply-path",
        "Quinn should see why weak inventory ruins daily capacity.",
        "--primary-channel",
        "connection-request",
        "--fallback-channel",
        "email",
        "--fallback-trigger",
        "Use email only if LinkedIn is blocked or the branch later needs escalation.",
        "--first-move",
        "Send a short connection request.",
        "--first-message-goal",
        "Validate whether Quinn owns outbound pacing.",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

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
        prospect.id,
        "--current-step",
        "connection-request",
        "--last-touch-channel",
        "connection-request",
        "--last-touch-outcome",
        "sent",
        "--last-touch-at",
        "2026-05-28T11:46:51.000Z",
        "--next-action",
        "Wait for acceptance before escalating.",
        "--next-action-due-at",
        "2026-05-30T11:46:51.000Z",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const beforeQuotaDaily = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.equal(beforeQuotaDaily.capacity.linkedin.status, "needs_configuration");
    assert.equal(beforeQuotaDaily.items[0].cadenceEffect, "capacity_configuration_needed");
    assert.equal(beforeQuotaDaily.items[0].source.kind, "configure_connection_request_quota");
    assert.equal(beforeQuotaDaily.items[0].guidance.key, "configure_connection_request_quota");
    assert.match(beforeQuotaDaily.items[0].recommendedAction, /set a durable linkedin connection-request quota/i);

    execFileSync(
      "node",
      [
        cliPath,
        "profiles",
        "claim",
        profile.id,
        "--max-connection-requests",
        "125",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const afterQuotaDaily = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.equal(afterQuotaDaily.capacity.linkedin.status, "configured");
    assert.equal(afterQuotaDaily.capacity.linkedin.quota.weeklyInvitations, 125);
    assert.equal(afterQuotaDaily.capacity.linkedin.quota.dailyInvitationsTarget, 25);
    assert.equal(afterQuotaDaily.capacity.linkedin.execution.sentToday, 0);
    assert.equal(afterQuotaDaily.capacity.linkedin.execution.pendingInvitations, 1);
    assert.equal(afterQuotaDaily.capacity.linkedin.execution.readyConnectionRequests, 0);
    assert.equal(afterQuotaDaily.capacity.linkedin.execution.remainingInvitationsToday, 25);
    assert.equal(afterQuotaDaily.capacity.linkedin.execution.inventoryShortfall, 25);
    assert.equal(afterQuotaDaily.items[0].cadenceEffect, "capacity_deficit");
    assert.equal(afterQuotaDaily.items[0].source.kind, "seed_motion_targets");
    assert.equal(afterQuotaDaily.items[0].guidance.key, "seed_motion_targets");
    assert.match(afterQuotaDaily.items[0].recommendedAction, /seed more known companies or people directly into the active motion/i);

    const afterQuotaNext = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--motion", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.ok(["daily", "motion"].includes(afterQuotaNext.source));
    assert.equal(afterQuotaNext.status.effect, "capacity_deficit");
    assert.equal(afterQuotaNext.guidance.key, "seed_motion_targets");
    assert.equal(afterQuotaNext.context.source.kind, "seed_motion_targets");
    assert.match(afterQuotaNext.nextMove, /seed more known companies or people directly into the active motion/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion queue exposes discovered and queued research inventory and daily uses it to explain the deficit", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-queue-"));
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
          [profileDirectory]: { name: "Queue Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: "Queue Main" } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com", "mail.google.com"],
    historyUrls: ["https://www.linkedin.com/feed/", "https://mail.google.com/mail/u/0/#inbox"]
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
          "https://example.com/motion-queue",
          "--premise",
          "This offer matters when outbound teams need a governed queue to fill connection-request capacity.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company visibly scaling pipeline generation or GTM surface area?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: tempDir }
    });

    const activeCompany = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Queue Active",
          "--domain",
          "queue-active.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const backlogCompany = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Queue Backlog",
          "--domain",
          "queue-backlog.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
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
          "queue-main",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          profileDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--capability",
          "gmail",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir }, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "queue-user", "--owner", "William", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    const userWithLinkedin = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "queue-user",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const linkedinAccount = userWithLinkedin.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    const userWithGmail = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "gmail",
          "--handle",
          "queue-user",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const gmailAccount = userWithGmail.accounts.find((account) => account.capability === "gmail");
    assert.ok(gmailAccount);

    const syncedAt = new Date().toISOString();
    for (const [accountId, surfaceKeys] of [
      [
        linkedinAccount.id,
        [
          "linkedin-sent-invitations",
          "linkedin-received-invitations",
          "linkedin-messaging-inbox",
          "linkedin-profile-views",
          "linkedin-following-list"
        ]
      ],
      [
        gmailAccount.id,
        ["gmail-inbox-threads"]
      ]
    ]) {
      for (const surfaceKey of surfaceKeys) {
        execFileSync(
          "node",
          [
            cliPath,
            "inbound",
            "sync",
            "record",
            user.id,
            "--account",
            accountId,
            "--surface",
            surfaceKey,
            "--status",
            "success",
            "--observed-at",
            syncedAt,
            "--item-count",
            "0",
            "--json"
          ],
          { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
        );
      }
    }

    for (const company of [activeCompany, backlogCompany]) {
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "user",
          "assign",
          company.id,
          "--user",
          user.id,
          "--reason",
          "Keep queue work routed through one execution user",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      );
    }

    const prospect = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "add",
          activeCompany.id,
          "--motion",
          motion.id,
          "--name",
          "Quinn Waiting",
          "--title",
          "Chief Revenue Officer",
          "--email",
          "quinn.waiting@queue-active.example",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--why-relevant",
          "Owns the current primary outbound branch",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    ).prospects[0];

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "through-line",
        "set",
        activeCompany.id,
        "--motion",
        motion.id,
        "--prospect",
        prospect.id,
        "--specific-to-them",
        "Quinn owns the branch.",
        "--shared-problem",
        "Pipeline creation needs consistent executive access.",
        "--why-now",
        "The team needs a real inventory queue.",
        "--legitimate-wedge",
        "The backlog is invisible today.",
        "--compression-line",
        "Queue state is how pacing turns into throughput.",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );
    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "opening-plan",
        "set",
        activeCompany.id,
        "--motion",
        motion.id,
        "--prospect",
        prospect.id,
        "--why-now",
        "The current motion is inventory-thin.",
        "--angle",
        "Connect queue visibility to outbound pacing.",
        "--reply-path",
        "Quinn should see why queue blindness kills throughput.",
        "--primary-channel",
        "connection-request",
        "--fallback-channel",
        "email",
        "--fallback-trigger",
        "Use email only if LinkedIn is blocked or the branch later needs escalation.",
        "--first-move",
        "Send a short connection request.",
        "--first-message-goal",
        "Validate whether Quinn owns outbound pacing.",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );
    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "cadence",
        "set",
        activeCompany.id,
        "--motion",
        motion.id,
        "--prospect",
        prospect.id,
        "--current-step",
        "connection-request",
        "--last-touch-channel",
        "connection-request",
        "--last-touch-outcome",
        "sent",
        "--last-touch-at",
        "2026-05-28T11:46:51.000Z",
        "--next-action",
        "Wait for acceptance before escalating.",
        "--next-action-due-at",
        "2026-05-30T11:46:51.000Z",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "profiles",
        "claim",
        profile.id,
        "--max-connection-requests",
        "125",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const beforeQueueShow = JSON.parse(
      execFileSync("node", [cliPath, "companies", "queue", "show", backlogCompany.id, "--motion", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(beforeQueueShow.queue.status, "discovered");

    const targetingBeforeSet = JSON.parse(
      execFileSync("node", [cliPath, "motion", "target", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(targetingBeforeSet.queue.companyStatusCounts.discovered, 1);

    const queuedAccount = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "queue",
          "set",
          backlogCompany.id,
          "--motion",
          motion.id,
          "--status",
          "queued_for_research",
          "--notes",
          "Parallel research packet claimed this company.",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(queuedAccount.account.queueState.status, "queued_for_research");
    assert.equal(queuedAccount.account.queueState.source, "manual");

    const afterQueueShow = JSON.parse(
      execFileSync("node", [cliPath, "companies", "queue", "show", backlogCompany.id, "--motion", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(afterQueueShow.queue.status, "queued_for_research");

    const daily = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(daily.capacity.linkedin.execution.queue.companyStatusCounts.queued_for_research, 1);
    assert.equal(daily.items[0].source.kind, "claim_company_research_packets");
    assert.equal(daily.items[0].guidance.key, "claim_company_research_packets");
    assert.match(daily.items[0].recommendedAction, /claim 1 company-research packet/i);

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--motion", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(next.guidance.key, "claim_company_research_packets");
    assert.equal(next.context.source.kind, "claim_company_research_packets");
    assert.match(next.nextMove, /claim 1 company-research packet/i);

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "claim",
        backlogCompany.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-research-1",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );
    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "complete",
        backlogCompany.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-research-1",
        "--next-status",
        "researched",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const dailyAfterResearch = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(dailyAfterResearch.items[0].source.kind, "claim_prospect_selection_packets");
    assert.equal(dailyAfterResearch.items[0].guidance.key, "claim_prospect_selection_packets");
    assert.match(dailyAfterResearch.items[0].recommendedAction, /claim 1 prospect-selection packet/i);

    const nextAfterResearch = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--motion", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(nextAfterResearch.guidance.key, "claim_prospect_selection_packets");
    assert.equal(nextAfterResearch.context.source.kind, "claim_prospect_selection_packets");
    assert.match(nextAfterResearch.nextMove, /claim 1 prospect-selection packet/i);

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "claim",
        backlogCompany.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-select-1",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const selectedProspect = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "add",
          backlogCompany.id,
          "--motion",
          motion.id,
          "--name",
          "Packeted Prospect",
          "--title",
          "VP Revenue Operations",
          "--why-relevant",
          "Best-fit first operator branch for the motion.",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const selectedProspectId = selectedProspect.prospects[0].id;

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "complete",
        backlogCompany.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-select-1",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const dailyAfterSelection = JSON.parse(
      execFileSync("node", [cliPath, "daily", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(dailyAfterSelection.items[0].source.kind, "claim_prospect_research_packets");
    assert.equal(dailyAfterSelection.items[0].guidance.key, "claim_prospect_research_packets");
    assert.match(dailyAfterSelection.items[0].recommendedAction, /claim 1 prospect-research packet/i);

    const nextAfterSelection = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--motion", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(nextAfterSelection.guidance.key, "claim_prospect_research_packets");
    assert.equal(nextAfterSelection.context.source.kind, "claim_prospect_research_packets");
    assert.match(nextAfterSelection.nextMove, /claim 1 prospect-research packet/i);
    assert.equal(selectedProspectId.length > 0, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion packets let a worker claim and complete a company research packet", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-packets-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/motion-packets",
          "--premise",
          "This offer matters when GTM teams need safe packetized queue work.",
          "--audience",
          "Revenue operators",
          "--signal",
          "company::Is there clear evidence this team needs more governed outbound execution?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Packet Queue Co",
          "--domain",
          "packet-queue.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const initialPackets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(initialPackets.counts.packetCount, 1);
    assert.equal(initialPackets.counts.claimableCount, 1);
    assert.equal(initialPackets.counts.claimedCount, 0);
    assert.equal(initialPackets.items[0].companyId, company.id);
    assert.equal(initialPackets.items[0].claimState, "claimable");
    assert.equal(initialPackets.items[0].queueStatus, "discovered");

    const claimed = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "queue",
          "claim",
          company.id,
          "--motion",
          motion.id,
          "--worker",
          "codex-queue-1",
          "--notes",
          "Claimed for parallel company research.",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(claimed.account.queueState.status, "queued_for_research");
    assert.equal(claimed.account.packetState.kind, "company_research");
    assert.equal(claimed.account.packetState.status, "claimed");
    assert.equal(claimed.account.packetState.workerLabel, "codex-queue-1");

    const claimedPackets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--status", "claimed", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(claimedPackets.counts.packetCount, 1);
    assert.equal(claimedPackets.counts.claimedCount, 1);
    assert.equal(claimedPackets.items[0].claimState, "claimed");
    assert.equal(claimedPackets.items[0].workerLabel, "codex-queue-1");

    const completed = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "queue",
          "complete",
          company.id,
          "--motion",
          motion.id,
          "--worker",
          "codex-queue-1",
          "--next-status",
          "researched",
          "--notes",
          "Research pass completed and handed off.",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(completed.account.queueState.status, "researched");
    assert.equal(completed.account.packetState.status, "completed");
    assert.ok(completed.account.packetState.completedAt);

    const finalPackets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(finalPackets.counts.packetCount, 1);
    assert.equal(finalPackets.items.length, 1);
    assert.equal(finalPackets.items[0].packetKind, "prospect_selection");
    assert.equal(finalPackets.items[0].claimState, "claimable");
    assert.equal(finalPackets.items[0].queueStatus, "researched");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion packet-brief turns packet state into a worker contract with stable packet ids", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-packet-brief-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/motion-packet-brief",
          "--premise",
          "This offer matters when packetized targeting work needs explicit worker contracts.",
          "--audience",
          "Revenue operators",
          "--signal",
          "company::Is there clear evidence this team needs more governed outbound execution?",
          "--stakeholder-count",
          "2",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Packet Brief Co",
          "--domain",
          "packet-brief.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const companyPackets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(companyPackets.items[0].packetId, `company_research:${company.id}`);

    const companyBrief = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "packet-brief", motion.id, "--packet", companyPackets.items[0].packetId, "--json"],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(companyBrief.packet.id, `company_research:${company.id}`);
    assert.equal(companyBrief.packet.kind, "company_research");
    assert.match(companyBrief.summary, /Research Packet Brief Co against the motion premise/i);
    assert.equal(companyBrief.writeback.claimCommand.includes(`exo companies queue claim ${company.id}`), true);
    assert.equal(
      companyBrief.writeback.supportingCommands.some((command) => command.includes("exo companies signal-matches add")),
      true
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "claim",
        company.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-research-1",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "complete",
        company.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-research-1",
        "--next-status",
        "researched",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const selectionPackets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(selectionPackets.items[0].packetId, `prospect_selection:${company.id}`);

    const selectionBrief = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "packet-brief", motion.id, "--packet", selectionPackets.items[0].packetId, "--json"],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(selectionBrief.packet.kind, "prospect_selection");
    assert.equal(selectionBrief.inputs.stakeholderTargetCount, 2);
    assert.equal(
      selectionBrief.writeback.supportingCommands.some((command) => command.includes("exo companies prospects add")),
      true
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "claim",
        company.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-select-1",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const prospectAdded = JSON.parse(
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
          "Jamie Operator",
          "--title",
          "VP Revenue Operations",
          "--why-relevant",
          "Primary owner for the packetized GTM problem.",
          "--buying-committee-role",
          "operator_champion",
          "--decision-authority",
          "influences",
          "--fit-confidence",
          "high",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "complete",
        company.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-select-1",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const researchPackets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(
      researchPackets.items[0].packetId,
      `prospect_research:${company.id}:${prospectAdded.prospects[0].id}`
    );

    const researchBrief = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "packet-brief", motion.id, "--packet", researchPackets.items[0].packetId, "--json"],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(researchBrief.packet.kind, "prospect_research");
    assert.equal(researchBrief.packet.prospectId, prospectAdded.prospects[0].id);
    assert.equal(researchBrief.inputs.prospect.name, "Jamie Operator");
    assert.equal(
      researchBrief.writeback.supportingCommands.some((command) => command.includes("exo companies through-line set")),
      true
    );
    assert.equal(
      researchBrief.writeback.completeCommands.some((command) => command.includes("exo companies prospects complete")),
      true
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion discover links existing companies and creates new queued companies as packet-ready backlog", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-discover-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/motion-discover",
          "--premise",
          "This offer matters when pipeline teams need upstream discovery feeding the queue.",
          "--audience",
          "Revenue operators",
          "--signal",
          "company::Is there current evidence this company needs more disciplined outbound execution?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const existingCompany = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Existing Discover Co",
          "--domain",
          "existing-discover.example",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const linked = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "discover",
          motion.id,
          "--company",
          existingCompany.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(linked.createdCompany, false);
    assert.equal(linked.linkedCompany, true);
    assert.equal(linked.company.id, existingCompany.id);
    assert.equal(linked.queue.status, "discovered");
    assert.equal(linked.packet.claimState, "claimable");

    const createdAndQueued = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "discover",
          motion.id,
          "--name",
          "New Queued Discover Co",
          "--domain",
          "new-queued-discover.example",
          "--queue-status",
          "queued_for_research",
          "--queue-notes",
          "Ready for a worker to pick up immediately.",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(createdAndQueued.createdCompany, true);
    assert.equal(createdAndQueued.linkedCompany, true);
    assert.equal(createdAndQueued.queue.status, "queued_for_research");
    assert.equal(createdAndQueued.packet.claimState, "claimable");

    const packets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(packets.counts.packetCount, 2);
    assert.equal(packets.counts.claimableCount, 2);
    assert.equal(packets.items.some((item) => item.companyId === existingCompany.id), true);
    assert.equal(
      packets.items.some((item) => item.companyId === createdAndQueued.company.id && item.queueStatus === "queued_for_research"),
      true
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("motion seed supports direct company seeding and person-first seeding into motion-owned target state", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-seed-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/motion-seed",
          "--premise",
          "This offer matters when the operator already knows the right company or person and needs direct motion seeding.",
          "--audience",
          "Revenue operators",
          "--signal",
          "company::Is there current evidence this company needs more disciplined outbound execution?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const existingCompany = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Direct Seed Co",
          "--domain",
          "direct-seed.example",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const companySeed = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "seed",
          motion.id,
          "--company",
          existingCompany.id,
          "--queue-status",
          "queued_for_research",
          "--queue-notes",
          "Seeded directly for immediate research.",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(companySeed.createdCompany, false);
    assert.equal(companySeed.linkedCompany, true);
    assert.equal(companySeed.company.id, existingCompany.id);
    assert.equal(companySeed.queue.status, "queued_for_research");
    assert.equal(companySeed.packet.packetKind, "company_research");

    const personSeed = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "seed",
          motion.id,
          "--company-name",
          "Person First Seed Co",
          "--domain",
          "person-first-seed.example",
          "--person-name",
          "Alex Rivera",
          "--person-title",
          "Chief Revenue Officer",
          "--why-relevant",
          "Known best-fit executive target for the motion hypothesis.",
          "--linkedin-profile-url",
          "https://www.linkedin.com/in/alex-rivera-example",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(personSeed.createdCompany, true);
    assert.equal(personSeed.linkedCompany, true);
    assert.equal(personSeed.company.name, "Person First Seed Co");
    assert.equal(personSeed.account.companyId, personSeed.company.id);
    assert.equal(personSeed.account.queueState.status, "selected");
    assert.equal(personSeed.prospect.name, "Alex Rivera");
    assert.equal(personSeed.prospect.title, "Chief Revenue Officer");
    assert.equal(personSeed.prospect.whyRelevant, "Known best-fit executive target for the motion hypothesis.");
    assert.equal(personSeed.prospect.linkedinProfileUrl, "https://www.linkedin.com/in/alex-rivera-example");
    assert.equal(personSeed.prospect.queueState.status, "selected");

    const packets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(packets.counts.packetCount, 2);
    assert.equal(packets.items.some((item) => item.companyId === existingCompany.id && item.packetKind === "company_research"), true);
    assert.equal(packets.items.some((item) => item.prospectName === "Alex Rivera" && item.packetKind === "prospect_research"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("prospect-selection packets stay claimable through researched accounts and survive prospect writeback until completion", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-prospect-selection-packets-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/prospect-selection-packets",
          "--premise",
          "This offer matters when researched accounts need safe stakeholder selection packets.",
          "--audience",
          "Revenue operators",
          "--signal",
          "company::Is there current evidence this company needs more disciplined outbound execution?",
          "--stakeholder-count",
          "2",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "discover",
          motion.id,
          "--name",
          "Prospect Packet Co",
          "--domain",
          "prospect-packet.example",
          "--queue-status",
          "queued_for_research",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    ).company;

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "claim",
        company.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-research-1",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "queue",
        "complete",
        company.id,
        "--motion",
        motion.id,
        "--worker",
        "codex-research-1",
        "--next-status",
        "researched",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const claimableProspectPacket = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(claimableProspectPacket.counts.packetCount, 1);
    assert.equal(claimableProspectPacket.items[0].packetKind, "prospect_selection");
    assert.equal(claimableProspectPacket.items[0].claimState, "claimable");
    assert.equal(claimableProspectPacket.items[0].queueStatus, "researched");
    assert.equal(claimableProspectPacket.items[0].targetProspectCount, 2);

    const claimedProspectPacket = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "queue",
          "claim",
          company.id,
          "--motion",
          motion.id,
          "--worker",
          "codex-select-1",
          "--notes",
          "Selecting the first stakeholders now.",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(claimedProspectPacket.account.packetState.kind, "prospect_selection");
    assert.equal(claimedProspectPacket.account.packetState.status, "claimed");
    assert.equal(claimedProspectPacket.account.packetState.workerLabel, "codex-select-1");
    assert.equal(claimedProspectPacket.account.queueState.status, "researched");

    const firstProspect = JSON.parse(
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
          "Selena Stakeholder",
          "--title",
          "VP Revenue Operations",
          "--why-relevant",
          "Best-fit operator for the first outbound branch.",
          "--buying-committee-role",
          "operator_champion",
          "--decision-authority",
          "influences",
          "--fit-confidence",
          "high",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(firstProspect.account.prospects.length, 1);

    const stillClaimedPackets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--status", "claimed", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(stillClaimedPackets.counts.packetCount, 1);
    assert.equal(stillClaimedPackets.items[0].packetKind, "prospect_selection");
    assert.equal(stillClaimedPackets.items[0].claimState, "claimed");
    assert.equal(stillClaimedPackets.items[0].queueStatus, "selected");
    assert.equal(stillClaimedPackets.items[0].prospectCount, 1);

    const completedProspectPacket = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "queue",
          "complete",
          company.id,
          "--motion",
          motion.id,
          "--worker",
          "codex-select-1",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(completedProspectPacket.account.packetState.kind, "prospect_selection");
    assert.equal(completedProspectPacket.account.packetState.status, "completed");
    assert.equal(completedProspectPacket.account.queueState.status, "selected");

    const finalPackets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(finalPackets.counts.packetCount, 1);
    assert.equal(finalPackets.items[0].packetKind, "prospect_research");
    assert.equal(finalPackets.items[0].claimState, "claimable");
    assert.equal(finalPackets.items[0].prospectName, "Selena Stakeholder");

    const claimedProspectResearch = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "claim",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          firstProspect.prospects[0].id,
          "--worker",
          "codex-prospect-1",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(claimedProspectResearch.prospect.packetState.kind, "prospect_research");
    assert.equal(claimedProspectResearch.prospect.packetState.status, "claimed");
    assert.equal(claimedProspectResearch.prospect.packetState.workerLabel, "codex-prospect-1");

    const completedProspectResearch = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "complete",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          firstProspect.prospects[0].id,
          "--worker",
          "codex-prospect-1",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    assert.equal(completedProspectResearch.prospect.packetState.kind, "prospect_research");
    assert.equal(completedProspectResearch.prospect.packetState.status, "completed");
    assert.equal(completedProspectResearch.prospect.queueState.status, "selected");

    const recycledPackets = JSON.parse(
      execFileSync("node", [cliPath, "motion", "packets", motion.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );
    assert.equal(recycledPackets.counts.packetCount, 1);
    assert.equal(recycledPackets.items[0].packetKind, "prospect_research");
    assert.equal(recycledPackets.items[0].claimState, "claimable");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("next prefers a due-now daily item over the broader motion path", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-next-daily-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/next-daily",
          "--premise",
          "This offer matters when revenue teams need signal-led outreach.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company visibly scaling outbound or GTM headcount?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: tempDir }
    });

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Next Daily Co",
          "--domain",
          "next-daily.example",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "Next User", "--owner", "William", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    const userWithAccount = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "next-user",
          "--runtime",
          "codex",
          "--connector",
          "chrome",
          "--preferred",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    const linkedinAccount = userWithAccount.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "user",
        "assign",
        company.id,
        "--user",
        user.id,
        "--reason",
        "Drive next resolution through one operator identity",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const prospect = JSON.parse(
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
          "Nora Reply",
          "--title",
          "CRO",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--why-relevant",
          "Owns the commercial motion",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    ).prospects[0];

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
        prospect.id,
        "--current-step",
        "connection-request",
        "--next-action",
        "Send the planned follow-up",
        "--next-action-due-at",
        "2026-05-28T12:00:00.000Z",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "inbound",
        "observations",
        "add",
        user.id,
        "--account",
        linkedinAccount.id,
        "--surface",
        "linkedin-messaging-inbox",
        "--kind",
        "inbound_reply_received",
        "--motion",
        motion.id,
        "--company",
        company.id,
        "--prospect",
        prospect.id,
        "--observed-at",
        "2026-05-28T13:00:00.000Z",
        "--summary",
        "Nora replied in LinkedIn",
        "--json"
      ],
      { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
    );

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.ok(["daily", "motion"].includes(next.source));
    assert.match(next.nextMove, /reply/i);
    assert.equal(next.context.motion.name, motion.name);
    assert.equal(next.context.company.name, "Next Daily Co");
    assert.equal(next.context.prospect.name, "Nora Reply");
    assert.equal(next.status.kind, "due_now");
    assert.equal(next.status.priority, "reply");
    assert.equal(next.status.effect, "overridden_by_inbound");
    assert.equal(next.guidance.key, "reply_to_inbound");
    assert.match(next.guidance.docPath, /docs\/planner\/reply_to_inbound\.md$/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("next falls back to the focus motion path when no due daily item exists", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-next-motion-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/next-motion",
          "--premise",
          "This offer matters when outbound teams need better GTM signal.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company visibly scaling GTM or outbound coverage?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );
    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: tempDir }
    });

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.equal(next.source, "motion");
    assert.equal(next.context.motion.name, motion.name);
    assert.match(next.nextMove, /link target companies|company/i);
    assert.match(next.why, /motion/i);
    assert.equal(next.status.kind, "needs-company-targeting");
    assert.equal(next.status.priority, "action");
    assert.equal(next.guidance.key, "clear_motion_blocker");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("next surfaces a parallel support action while the live connection-request branch waits on an external trigger", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-next-live-branch-"));
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
          [profileDirectory]: { name: "Live Branch LinkedIn" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: "Live Branch LinkedIn" } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/sales/home"]
  });

  try {
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
          "live-branch-linkedin",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          profileDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    );

    execFileSync(
      "node",
      [
        cliPath,
        "profiles",
        "claim",
        profile.id,
        "--max-connection-requests",
        "0",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const user = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "users", "add", "--label", "Live Branch User", "--owner", "William", "--json"],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    );

    const userWithAccount = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "live-branch-user",
          "--profile",
          profile.id,
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    );
    const linkedinAccount = userWithAccount.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);
    const syncedAt = new Date().toISOString();

    for (const surfaceKey of [
      "linkedin-sent-invitations",
      "linkedin-received-invitations",
      "linkedin-messaging-inbox",
      "linkedin-profile-views",
      "linkedin-following-list"
    ]) {
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "sync",
          "record",
          user.id,
          "--account",
          linkedinAccount.id,
          "--surface",
          surfaceKey,
          "--status",
          "success",
          "--observed-at",
          syncedAt,
          "--item-count",
          "0",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      );
    }

    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/live-branch",
          "--premise",
          "This offer matters when GTM leaders need sharper, signal-led outreach.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company visibly widening its GTM surface or message complexity?",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    );
    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: tempDir,
      encoding: "utf8"
    });

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
          "--motion",
          motion.id,
          "--website-url",
          "https://www.chainguard.dev",
          "--linkedin-company-url",
          "https://www.linkedin.com/company/chainguard",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "user",
        "assign",
        company.id,
        "--user",
        user.id,
        "--reason",
        "Use one human identity for the live branch regression.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const signalMatchResult = JSON.parse(
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
          "Chainguard visibly expanded its GTM story and distribution surface.",
          "--confidence",
          "high",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    );
    const signalMatchId = signalMatchResult.signalMatches[0].id;

    const prospect = JSON.parse(
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
          "Parm Uppal",
          "--title",
          "Chief Revenue Officer",
          "--linkedin-profile-url",
          "https://www.linkedin.com/in/parm-uppal",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--signal-match",
          signalMatchId,
          "--why-relevant",
          "Owns the executive outbound quality bar.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    ).prospects[0];

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
        prospect.id,
        "--signal-match",
        signalMatchId,
        "--specific-to-them",
        "Parm owns the GTM narrative quality bar while the company story broadens.",
        "--shared-problem",
        "Broader product and channel expansion makes generic outbound easier to spot and ignore.",
        "--why-now",
        "The current expansion wave makes message discipline urgent now.",
        "--legitimate-wedge",
        "Lead with the narrative-quality tension instead of a generic sales pitch.",
        "--compression-line",
        "As CRO, Parm has to protect message quality while Chainguard's story gets bigger.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        prospect.id,
        "--signal-match",
        signalMatchId,
        "--why-now",
        "The current expansion wave makes executive-message quality more visible.",
        "--angle",
        "Executive outbound gets weaker when the story broadens faster than the narrative discipline.",
        "--reply-path",
        "Lead with a specific narrative-quality tension a CRO would plausibly react to.",
        "--primary-channel",
        "connection-request",
        "--fallback-channel",
        "none",
        "--fallback-trigger",
        "No fallback is stored yet.",
        "--first-move",
        "Send the first connection request.",
        "--first-message-goal",
        "Start a conversation about message quality under expansion pressure.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        prospect.id,
        "--current-step",
        "connection-request",
        "--last-touch-channel",
        "connection-request",
        "--last-touch-outcome",
        "sent",
        "--last-touch-at",
        "2026-05-27T11:46:51.000Z",
        "--next-action",
        "Wait for acceptance before escalating.",
        "--next-action-due-at",
        "2026-05-30T11:46:51.000Z",
        "--notes",
        "Primary owner path is ready but unsent; wait for operator before launch.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const targeting = JSON.parse(
      execFileSync("node", [cliPath, "motion", "target", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      }).toString()
    );
    assert.equal(targeting.readyToEngage, true);
    assert.ok(targeting.nextActions.some((step) => /direct-email fallback/i.test(step)));

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--motion", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      }).toString()
    );

    assert.ok(["daily", "motion"].includes(next.source));
    assert.equal(next.context.motion.name, motion.name);
    assert.equal(next.context.company.name, "Chainguard");
    assert.equal(next.context.prospect.name, "Parm Uppal");
    assert.equal(next.status.priority, "action");
    assert.equal(next.status.effect, "supporting_waiting_branch");
    assert.match(next.nextMove, /verified direct email|usable contact points/i);
    assert.equal(next.guidance.key, "find_contact_points");
    assert.match(next.guidance.taskPrompt, /verified direct email/i);
    assert.match(next.guidance.taskPrompt, /inspect the current runtime for direct MCP servers and direct CLIs/i);
    assert.match(next.guidance.taskPrompt, /First, check owned evidence/i);
    assert.match(next.guidance.taskPrompt, /Second, use Google searches and browser-based public-web work/i);
    assert.match(next.guidance.taskPrompt, /Third, if you still need provider help, inspect the current runtime for direct MCP servers and direct CLIs/i);
    assert.match(next.guidance.taskPrompt, /Only after those direct paths are exhausted should you fall back to consumer Composio discovery/i);
    assert.match(next.guidance.taskPrompt, /Zerobounce only for validation, not for discovery/i);
    assert.match(next.guidance.taskPrompt, /First, check owned evidence/i);
    assert.match(next.guidance.taskPrompt, /Second, use Google searches and browser-based public-web work/i);
    assert.match(next.guidance.taskPrompt, /prospects update .* --prospect /i);
    assert.equal(next.context.source.type, "parallel_support_action");
    assert.equal(next.context.waitingBranch.kind, "wait_for_connection_response");
    assert.match(next.context.waitingBranch.nextMove, /accept or reply to the connection request/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("next falls back to the operator path when motions exist but none are active", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-next-no-active-"));

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          "https://example.com/draft-only",
          "--premise",
          "This offer matters when GTM teams need sharper signal.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is the company visibly scaling GTM?",
          "--json"
        ],
        { cwd: repoRoot, env: { ...process.env, EXO_STATE_DIR: tempDir } }
      ).toString()
    );

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--json"], {
        cwd: repoRoot,
        env: { ...process.env, EXO_STATE_DIR: tempDir }
      }).toString()
    );

    assert.equal(next.source, "operator-call");
    assert.match(next.headline, /Activate .* before trying to use cross-motion execution/i);
    assert.match(next.nextMove, /Draft, paused, and archived motions should not enter the shared execution agenda/i);
    assert.equal(next.context.motion.id, motion.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("next switches parallel support work to a held reserve prospect when primary contact enrichment is already exhausted", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-next-reserve-enrichment-"));

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
          "This offer matters when GTM leaders need signal-led outreach under expansion pressure.",
          "--audience",
          "Cybersecurity revenue leaders",
          "--stakeholder-count",
          "2",
          "--signal-json",
          JSON.stringify({
            question: "Is there recent evidence this company is broadening its GTM story or product surface?",
            scope: "company",
            whyItMatters: "Broader scope raises message-discipline pressure.",
            status: "ready"
          }),
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: tempDir,
      encoding: "utf8"
    });

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
          "--website-url",
          "https://www.chainguard.dev",
          "--linkedin-company-url",
          "https://www.linkedin.com/company/chainguard-dev/",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "Reserve User", "--owner", "William", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      }).toString()
    );

    const userWithAccount = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "users",
          "accounts",
          "add",
          user.id,
          "--capability",
          "linkedin",
          "--handle",
          "reserve-user",
          "--runtime",
          "codex",
          "--connector",
          "chrome",
          "--preferred",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    );
    const linkedinAccount = userWithAccount.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);
    const syncedAt = new Date().toISOString();

    for (const surfaceKey of [
      "linkedin-sent-invitations",
      "linkedin-received-invitations",
      "linkedin-messaging-inbox",
      "linkedin-profile-views",
      "linkedin-following-list"
    ]) {
      execFileSync(
        "node",
        [
          cliPath,
          "inbound",
          "sync",
          "record",
          user.id,
          "--account",
          linkedinAccount.id,
          "--surface",
          surfaceKey,
          "--status",
          "success",
          "--observed-at",
          syncedAt,
          "--item-count",
          "0",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      );
    }

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "user",
        "assign",
        company.id,
        "--user",
        user.id,
        "--reason",
        "Drive the reserve-path daily agenda through one execution user",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const signalMatch = JSON.parse(
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
          "Broadened its commercial and product story during the current expansion wave.",
          "--source-url",
          "https://www.chainguard.dev/unchained/example",
          "--observed-at",
          "2026-05-20T00:00:00.000Z",
          "--confidence",
          "high",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const signalMatchId = signalMatch.signalMatches[0].id;

    const parm = JSON.parse(
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
          "Parm Uppal",
          "--title",
          "Chief Revenue Officer",
          "--linkedin-profile-url",
          "https://www.linkedin.com/in/parm-uppal",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--signal-match",
          signalMatchId,
          "--notes",
          "2026-05-28 contact-enrichment pass: no Gmail hits and no HubSpot records. Public evidence was not strong enough to treat as verified fallback data.",
          "--why-relevant",
          "Owns the executive outbound quality bar.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    ).prospects[0];

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
        parm.id,
        "--signal-match",
        signalMatchId,
        "--specific-to-them",
        "Parm owns the GTM narrative quality bar while the company story broadens.",
        "--shared-problem",
        "Broader product and channel expansion makes generic outbound easier to spot and ignore.",
        "--why-now",
        "The current expansion wave makes message discipline urgent now.",
        "--legitimate-wedge",
        "Lead with the narrative-quality tension instead of a generic sales pitch.",
        "--compression-line",
        "As CRO, Parm has to protect message quality while the story gets bigger.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        parm.id,
        "--signal-match",
        signalMatchId,
        "--why-now",
        "The current expansion wave makes executive-message quality more visible.",
        "--angle",
        "Executive outbound gets weaker when the story broadens faster than the narrative discipline.",
        "--reply-path",
        "Lead with a specific narrative-quality tension a CRO would plausibly react to.",
        "--primary-channel",
        "connection-request",
        "--fallback-channel",
        "none",
        "--fallback-trigger",
        "No fallback is stored yet.",
        "--first-move",
        "Send the first connection request.",
        "--first-message-goal",
        "Start a conversation about message quality under expansion pressure.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        parm.id,
        "--current-step",
        "connection-request",
        "--last-touch-channel",
        "connection-request",
        "--last-touch-outcome",
        "sent",
        "--last-touch-at",
        "2026-05-27T11:46:51.000Z",
        "--next-action",
        "Wait for acceptance before escalating.",
        "--next-action-due-at",
        "2026-05-30T11:46:51.000Z",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const ryan = JSON.parse(
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
          "Ryan Carlson",
          "--title",
          "President",
          "--linkedin-profile-url",
          "https://www.linkedin.com/in/ryan-carlson",
          "--buying-committee-role",
          "executive_sponsor",
          "--decision-authority",
          "sponsors",
          "--fit-confidence",
          "high",
          "--signal-match",
          signalMatchId,
          "--why-relevant",
          "Strong executive sponsor if the CRO branch stalls.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    ).prospects[1];

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
        ryan.id,
        "--signal-match",
        signalMatchId,
        "--specific-to-them",
        "Ryan carries the broader market story.",
        "--shared-problem",
        "The market story has to stay credible as the company broadens its footprint.",
        "--why-now",
        "Expansion raises the cost of generic executive outreach.",
        "--legitimate-wedge",
        "Use the narrative-quality tension rather than a tactical pitch.",
        "--compression-line",
        "Ryan is the reserve executive path if the CRO branch stalls.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        ryan.id,
        "--signal-match",
        signalMatchId,
        "--why-now",
        "The broader story has to land cleanly with senior buyers.",
        "--angle",
        "Keep the sponsor path ready without cutting across the CRO branch.",
        "--reply-path",
        "Approach Ryan as the executive narrator, not the first owner.",
        "--primary-channel",
        "inmail",
        "--fallback-channel",
        "none",
        "--fallback-trigger",
        "Only use this path if the CRO branch stalls.",
        "--first-move",
        "Hold a sponsor-ready message in reserve.",
        "--first-message-goal",
        "Keep the executive path ready if the primary branch needs escalation.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        ryan.id,
        "--current-step",
        "inmail",
        "--next-action",
        "Hold the reserve path unless the primary branch stalls.",
        "--notes",
        "Sponsor path is ready but intentionally held behind the primary CRO path.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--motion", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      }).toString()
    );

    assert.ok(["daily", "motion"].includes(next.source));
    assert.equal(next.status.priority, "action");
    assert.equal(next.status.effect, "supporting_waiting_branch");
    assert.equal(next.context.prospect.name, "Ryan Carlson");
    assert.equal(next.context.source.kind, "parallel_same_account_reserve_enrichment");
    assert.match(next.nextMove, /Ryan Carlson/);
    assert.match(next.nextMove, /verified direct email/i);
    assert.equal(next.guidance.key, "find_contact_points");
    assert.equal(next.context.waitingBranch.kind, "wait_for_connection_response");
    assert.match(next.context.waitingBranch.nextMove, /accept or reply to the connection request/i);
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

test("next does not surface a held reserve branch as due after fallback enrichment is complete", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-held-reserve-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const profileDirectory = "Profile 4";
  const profilePath = path.join(userDataDir, profileDirectory);

  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: {
            name: "Reserve User"
          }
        }
      }
    })
  );
  fs.writeFileSync(
    path.join(profilePath, "Preferences"),
    JSON.stringify({
      profile: {
        name: "Reserve User"
      }
    })
  );
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
          "--premise",
          "This offer matters when GTM leaders need signal-led outreach under expansion pressure.",
          "--audience",
          "Cybersecurity revenue leaders",
          "--stakeholder-count",
          "2",
          "--signal-json",
          JSON.stringify({
            question: "Is there recent evidence this company is broadening its GTM story or product surface?",
            scope: "company",
            whyItMatters: "Broader scope raises message-discipline pressure.",
            status: "ready"
          }),
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    execFileSync("node", [cliPath, "motion", "restart", motion.id, "--json"], {
      cwd: tempDir,
      encoding: "utf8"
    });

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
          "--website-url",
          "https://www.chainguard.dev",
          "--linkedin-company-url",
          "https://www.linkedin.com/company/chainguard-dev/",
          "--motion",
          motion.id,
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );

    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "Reserve User", "--owner", "William", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      }).toString()
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
          "reserve-user",
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
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    execFileSync(
      "node",
      [
        cliPath,
        "profiles",
        "claim",
        profile.id,
        "--max-connection-requests",
        "0",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "reserve-user",
        "--profile",
        profile.id,
        "--preferred",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "user",
        "assign",
        company.id,
        "--user",
        user.id,
        "--reason",
        "Drive the reserve-path daily agenda through one execution user",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "profile",
        "assign",
        company.id,
        "--profile",
        profile.id,
        "--reason",
        "Keep the reserve-path fixture on one trusted browser identity",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const signalMatch = JSON.parse(
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
          "Broadened its commercial and product story during the current expansion wave.",
          "--source-url",
          "https://www.chainguard.dev/unchained/example",
          "--observed-at",
          "2026-05-20T00:00:00.000Z",
          "--confidence",
          "high",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      )
    );
    const signalMatchId = signalMatch.signalMatches[0].id;

    const parm = JSON.parse(
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
          "Parm Uppal",
          "--title",
          "Chief Revenue Officer",
          "--linkedin-profile-url",
          "https://www.linkedin.com/in/parmuppal",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--signal-match",
          signalMatchId,
          "--why-relevant",
          "Owns the executive outbound quality bar.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    ).prospects[0];

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
        parm.id,
        "--signal-match",
        signalMatchId,
        "--specific-to-them",
        "Parm owns the GTM narrative quality bar while the company story broadens.",
        "--shared-problem",
        "Broader product and channel expansion makes generic outbound easier to spot and ignore.",
        "--why-now",
        "The current expansion wave makes message discipline urgent now.",
        "--legitimate-wedge",
        "Lead with the narrative-quality tension instead of a generic sales pitch.",
        "--compression-line",
        "As CRO, Parm has to protect message quality while the story gets bigger.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        parm.id,
        "--signal-match",
        signalMatchId,
        "--why-now",
        "The current expansion wave makes executive-message quality more visible.",
        "--angle",
        "Executive outbound gets weaker when the story broadens faster than the narrative discipline.",
        "--reply-path",
        "Lead with a specific narrative-quality tension a CRO would plausibly react to.",
        "--primary-channel",
        "connection-request",
        "--fallback-channel",
        "email",
        "--fallback-trigger",
        "Use direct email only if the connection branch stalls.",
        "--first-move",
        "Send the first connection request.",
        "--first-message-goal",
        "Start a conversation about message quality under expansion pressure.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        parm.id,
        "--current-step",
        "connection-request",
        "--last-touch-channel",
        "connection-request",
        "--last-touch-outcome",
        "sent",
        "--last-touch-at",
        "2026-05-27T11:46:51.000Z",
        "--next-action",
        "Wait for acceptance before escalating.",
        "--next-action-due-at",
        "2026-05-30T11:46:51.000Z",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const ryan = JSON.parse(
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
          "Ryan Carlson",
          "--title",
          "President",
          "--linkedin-profile-url",
          "https://www.linkedin.com/in/ryancarlson",
          "--buying-committee-role",
          "executive_sponsor",
          "--decision-authority",
          "sponsors",
          "--fit-confidence",
          "high",
          "--signal-match",
          signalMatchId,
          "--why-relevant",
          "Strong executive sponsor if the CRO branch stalls.",
          "--json"
        ],
        { cwd: tempDir, encoding: "utf8" }
      ).toString()
    ).prospects[1];

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
        ryan.id,
        "--signal-match",
        signalMatchId,
        "--specific-to-them",
        "Ryan carries the broader market story.",
        "--shared-problem",
        "The market story has to stay credible as the company broadens its footprint.",
        "--why-now",
        "Expansion raises the cost of generic executive outreach.",
        "--legitimate-wedge",
        "Use the narrative-quality tension rather than a tactical pitch.",
        "--compression-line",
        "Ryan is the reserve executive path if the CRO branch stalls.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        ryan.id,
        "--signal-match",
        signalMatchId,
        "--why-now",
        "The broader story has to land cleanly with senior buyers.",
        "--angle",
        "Keep the sponsor path ready without cutting across the CRO branch.",
        "--reply-path",
        "Approach Ryan as the executive narrator, not the first owner.",
        "--primary-channel",
        "inmail",
        "--fallback-channel",
        "none",
        "--fallback-trigger",
        "Only use this path if the CRO branch stalls.",
        "--first-move",
        "Hold a sponsor-ready message in reserve.",
        "--first-message-goal",
        "Keep the executive path ready if the primary branch needs escalation.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

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
        ryan.id,
        "--current-step",
        "inmail",
        "--next-action",
        "Keep the sponsor-ready InMail on hold unless the CRO branch needs executive escalation.",
        "--notes",
        "Sponsor path is ready but intentionally held behind the primary CRO path.",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "prospects",
        "update",
        company.id,
        "--motion",
        motion.id,
        "--prospect",
        parm.id,
        "--email",
        "parm.uppal@chainguard.dev",
        "--contact-point",
        JSON.stringify({
          id: "email:parm.uppal@chainguard.dev",
          kind: "email",
          value: "parm.uppal@chainguard.dev",
          label: "Verified direct email",
          matchStatus: "same_person_verified",
          verificationStatus: "verified",
          confidence: "high",
          source: "icypeas",
          usableForOutreach: true,
          usableForResearch: true,
          usableForWarmup: false
        }),
        "--enrichment-status",
        "complete",
        "--best-direct-channel",
        "linkedin",
        "--best-direct-channel",
        "email",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "prospects",
        "update",
        company.id,
        "--motion",
        motion.id,
        "--prospect",
        ryan.id,
        "--email",
        "ryan.carlson@chainguard.dev",
        "--contact-point",
        JSON.stringify({
          id: "email:ryan.carlson@chainguard.dev",
          kind: "email",
          value: "ryan.carlson@chainguard.dev",
          label: "Verified direct email",
          matchStatus: "same_person_verified",
          verificationStatus: "verified",
          confidence: "high",
          source: "provider-convergence",
          usableForOutreach: true,
          usableForResearch: true,
          usableForWarmup: false
        }),
        "--enrichment-status",
        "complete",
        "--best-direct-channel",
        "linkedin",
        "--best-direct-channel",
        "email",
        "--json"
      ],
      { cwd: tempDir, encoding: "utf8" }
    );

    const next = JSON.parse(
      execFileSync("node", [cliPath, "next", "--user", user.id, "--motion", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      }).toString()
    );

    assert.ok(["daily", "motion"].includes(next.source));
    assert.equal(next.status.priority, "action");
    assert.equal(next.status.effect, "supporting_waiting_branch");
    assert.equal(next.context.prospect.name, "Parm Uppal");
    assert.equal(next.context.source.kind, "parallel_motion_inventory");
    assert.equal(next.guidance.key, "expand_motion_inventory");
    assert.match(next.nextMove, /build more ready first-touch inventory/i);
    assert.equal(next.context.waitingBranch.kind, "wait_for_connection_response");
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

    const updatedPrimaryProspectResult = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "update",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          primaryProspectId,
          "--email",
          "minh.verified@example.com",
          "--source-url",
          "https://speakerhub.example/minh-le",
          "--observed-at",
          "2026-05-28T10:00:00.000Z",
          "--notes",
          "Verified direct email from a public speaker bio.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(updatedPrimaryProspectResult.prospects.length, 1);
    assert.equal(updatedPrimaryProspectResult.prospect.id, primaryProspectId);
    assert.equal(updatedPrimaryProspectResult.prospect.email, "minh.verified@example.com");
    assert.equal(updatedPrimaryProspectResult.prospect.sourceUrl, "https://speakerhub.example/minh-le");
    assert.equal(updatedPrimaryProspectResult.prospect.observedAt, "2026-05-28T10:00:00.000Z");
    assert.equal(updatedPrimaryProspectResult.prospect.notes, "Verified direct email from a public speaker bio.");
    assert.equal(updatedPrimaryProspectResult.prospect.contactPoints.length, 1);
    assert.equal(updatedPrimaryProspectResult.prospect.contactPoints[0].kind, "email");
    assert.equal(updatedPrimaryProspectResult.prospect.contactPoints[0].value, "minh.verified@example.com");

    const enrichedContactPointResult = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "update",
          company.id,
          "--motion",
          motion.id,
          "--prospect",
          primaryProspectId,
          "--contact-point",
          JSON.stringify({
            kind: "x_profile",
            value: "https://x.com/minhle_risk",
            matchStatus: "same_person_probable",
            verificationStatus: "observed",
            confidence: "moderate",
            source: "public-web",
            sourceUrl: "https://x.com/minhle_risk",
            observedAt: "2026-05-28T11:00:00.000Z",
            usableForResearch: true,
            usableForWarmup: true,
            evidence: [
              {
                type: "bio-reference",
                summary: "Profile references BillEase risk and lending operations.",
                sourceUrl: "https://x.com/minhle_risk",
                observedAt: "2026-05-28T11:00:00.000Z"
              }
            ]
          }),
          "--contact-point",
          JSON.stringify({
            kind: "phone",
            value: "+63-917-555-0101",
            matchStatus: "same_person_possible",
            verificationStatus: "inferred",
            confidence: "low",
            source: "public-speaker-bio",
            sourceUrl: "https://speakerhub.example/minh-le",
            observedAt: "2026-05-28T11:05:00.000Z",
            usableForResearch: true,
            usableForOutreach: false
          }),
          "--enrichment-status",
          "exhausted",
          "--source-tried",
          "gmail",
          "--source-tried",
          "public-web",
          "--source-tried",
          "icypeas",
          "--missing-channel",
          "phone_verified",
          "--best-direct-channel",
          "linkedin",
          "--best-direct-channel",
          "email",
          "--last-enriched-at",
          "2026-05-28T11:10:00.000Z",
          "--enrichment-notes",
          "Verified direct email found. Phone remains weak and should not be used for outreach yet.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(enrichedContactPointResult.prospect.contactPoints.length, 3);
    assert.equal(enrichedContactPointResult.prospect.contactEnrichmentState.status, "exhausted");
    assert.deepEqual(enrichedContactPointResult.prospect.contactEnrichmentState.sourcesTried, ["gmail", "public-web", "icypeas"]);
    assert.deepEqual(enrichedContactPointResult.prospect.contactEnrichmentState.bestDirectChannels, ["linkedin", "email"]);
    assert.equal(
      enrichedContactPointResult.prospect.contactPoints.find((point) => point.kind === "x_profile")?.value,
      "https://x.com/minhle_risk"
    );
    assert.equal(
      enrichedContactPointResult.prospect.contactPoints.find((point) => point.kind === "phone")?.verificationStatus,
      "inferred"
    );

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
    assert.equal(prospects.prospects[0].email, "minh.verified@example.com");
    assert.equal(prospects.prospects[0].contactPoints.length, 3);
    assert.equal(prospects.prospects[0].contactEnrichmentState.status, "exhausted");
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
    assert.equal(shownMotion.targetMap.accounts[0].prospects[0].email, "minh.verified@example.com");
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

test("report motion renders one unified view across setup, readiness, company progress, and prospects", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-motion-report-"));
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
          [profileDirectory]: { name: "Audienti Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: "Audienti Main" } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/sales/home"]
  });

  try {
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
          "audienti-profile",
          "--user-data-dir",
          userDataDir,
          "--profile-directory",
          profileDirectory,
          "--browser-command",
          browserCommand,
          "--capability",
          "linkedin",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const claimedProfile = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "profiles",
          "claim",
          profile.id,
          "--label",
          "audienti-main",
          "--workspace",
          "audienti",
          "--account",
          "linkedin:wflanagan@audienti.com",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

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
          "This offer matters when security leaders need more credible outbound.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is there recent evidence that this company widened product or GTM scope?",
          "--title",
          "Chief Revenue Officer",
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
          "--website-url",
          "https://www.chainguard.dev",
          "--linkedin-company-url",
          "https://www.linkedin.com/company/chainguard-dev/",
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
      [cliPath, "companies", "profile", "assign", company.id, "--profile", claimedProfile.id, "--json"],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const signalMatchesResult = JSON.parse(
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
          "Expanded GTM surface through a fresh product and partner push.",
          "--source-url",
          "https://www.chainguard.dev/news",
          "--observed-at",
          "2026-05-20T00:00:00.000Z",
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
    const signalMatchId = signalMatchesResult.signalMatches[0].id;

    const prospectResult = JSON.parse(
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
          "Parm Uppal",
          "--title",
          "Chief Revenue Officer",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--signal-match",
          signalMatchId,
          "--why-relevant",
          "Primary owner for credible GTM execution.",
          "--active-channel",
          "linkedin",
          "--activity-type",
          "own-post",
          "--live-signal-summary",
          "Recent post suggests active LinkedIn use.",
          "--live-signal-url",
          "https://www.linkedin.com/posts/parm-example",
          "--live-signal-observed-at",
          "2026-05-24T00:00:00.000Z",
          "--freshness-band",
          "15-30-days",
          "--hook-strength",
          "high",
          "--engagement-rationale",
          "Fresh posting supports a legitimate warmup.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    const prospectId = prospectResult.prospects[0].id;

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
        prospectId,
        "--signal-match",
        signalMatchId,
        "--specific-to-them",
        "Parm now owns GTM credibility.",
        "--shared-problem",
        "Generic outbound burns trust.",
        "--why-now",
        "Broader GTM scope creates pressure now.",
        "--legitimate-wedge",
        "Show a credible path to relevance.",
        "--compression-line",
        "Parm needs credible outbound now that GTM scope is wider.",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

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
        prospectId,
        "--signal-match",
        signalMatchId,
        "--why-now",
        "Fresh GTM expansion raises the cost of generic outreach.",
        "--angle",
        "Credible, signal-led outbound.",
        "--reply-path",
        "Ground the message in Parm's current GTM credibility problem.",
        "--primary-channel",
        "connection-request",
        "--fallback-channel",
        "email",
        "--fallback-trigger",
        "Use email only if LinkedIn stalls.",
        "--first-move",
        "Connection request",
        "--first-message-goal",
        "Start a reply, not a pitch.",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

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
        prospectId,
        "--current-step",
        "connection-request",
        "--next-action",
        "Send the first touch",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const reportJson = JSON.parse(
      execFileSync("node", [cliPath, "report", "motion", motion.id, "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(reportJson.motion.id, motion.id);
    assert.equal(reportJson.targeting.overallStage, "targeting-ready");
    assert.equal(reportJson.prospects.counts.prospectCount, 1);
    assert.equal(reportJson.prospects.prospects[0].name, "Parm Uppal");

    const reportText = execFileSync("node", [cliPath, "report", "motion", motion.id], {
      cwd: tempDir,
      encoding: "utf8"
    });
    assert.match(reportText, /Motion Report:/);
    assert.match(reportText, /Readiness/);
    assert.match(reportText, /Company Progress/);
    assert.match(reportText, /Prospect Progress/);
    assert.match(reportText, /Parm Uppal/);
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

test("canonical action catalog and motion action briefs expose executable Audienti actions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-actions-"));

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
          "This offer matters when security GTM teams need sharper executive outreach.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is there recent evidence that this company expanded its product or go-to-market surface?",
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
          "--motion",
          motion.id,
          "--website-url",
          "https://www.chainguard.dev",
          "--linkedin-company-url",
          "https://www.linkedin.com/company/chainguard",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const signalMatchResult = JSON.parse(
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
          "Chainguard expanded its market story through a visible product-and-marketplace push.",
          "--source-url",
          "https://www.chainguard.dev/unchained/everything-we-announced-at-chainguard-assemble-2026",
          "--observed-at",
          "2026-03-17T00:00:00.000Z",
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
    const signalMatchId = signalMatchResult.signalMatches[0].id;

    const prospectResult = JSON.parse(
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
          "Parm Uppal",
          "--title",
          "Chief Revenue Officer",
          "--linkedin-profile-url",
          "https://www.linkedin.com/in/parm-uppal",
          "--email",
          "parm@example.com",
          "--buying-committee-role",
          "primary_business_owner",
          "--decision-authority",
          "buys",
          "--fit-confidence",
          "high",
          "--signal-match",
          signalMatchId,
          "--role-summary",
          "Owns the revenue narrative and outbound quality bar as Chainguard widens its GTM surface.",
          "--trigger-summary",
          "Recent product and distribution expansion raises the cost of generic outbound.",
          "--identity-summary",
          "Reads like a GTM operator who cares about sharp market narrative, not volume theater.",
          "--active-channel",
          "linkedin",
          "--activity-type",
          "own-post",
          "--live-signal-summary",
          "Recent LinkedIn post shows active public GTM commentary.",
          "--live-signal-url",
          "https://www.linkedin.com/posts/example",
          "--live-signal-observed-at",
          "2026-05-10T00:00:00.000Z",
          "--freshness-band",
          "0-14-days",
          "--hook-strength",
          "high",
          "--engagement-rationale",
          "Recent public posting is a legitimate warmup surface before a private ask.",
          "--why-relevant",
          "Best-fit owner for the narrative quality and executive-attention angle.",
          "--json"
        ],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    const prospectId = prospectResult.prospects[0].id;

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
        prospectId,
        "--signal-match",
        signalMatchId,
        "--specific-to-them",
        "Parm owns how Chainguard sounds when the GTM story gets broader.",
        "--shared-problem",
        "Broader product and channel expansion makes generic outbound easier to spot and ignore.",
        "--why-now",
        "The recent expansion wave raises the cost of sloppy executive outreach now, not later.",
        "--legitimate-wedge",
        "Offer a concrete observation about outbound quality under expansion pressure instead of a generic sales pitch.",
        "--compression-line",
        "As CRO, Parm now has to protect message quality while Chainguard's story gets bigger.",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

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
        prospectId,
        "--signal-match",
        signalMatchId,
        "--why-now",
        "The recent product-and-distribution push makes message discipline more visible.",
        "--angle",
        "Executive outbound gets weaker when the story broadens faster than the narrative discipline.",
        "--reply-path",
        "Lead with a specific narrative-quality tension that a CRO would plausibly want to react to.",
        "--primary-channel",
        "connection-request",
        "--fallback-channel",
        "email",
        "--fallback-trigger",
        "Use email if LinkedIn stays cold or unavailable.",
        "--preflight-action",
        "View the prospect profile",
        "--preflight-action",
        "Engage one recent relevant LinkedIn post only if the interaction is natural",
        "--first-move",
        "Warm up on the recent post, then send a connection request.",
        "--first-message-goal",
        "Start a conversation about executive outbound quality under expansion pressure.",
        "--talking-point",
        "Reference the recent expansion wave and the resulting pressure on narrative precision.",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

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
        prospectId,
        "--current-step",
        "connection-request",
        "--next-action",
        "Warm up on the recent post, then send the first connection request.",
        "--next-action-due-at",
        "2026-05-27T14:00:00.000Z",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const actionCatalog = JSON.parse(
      execFileSync("node", [cliPath, "actions", "list", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.ok(actionCatalog.actions.some((action) => action.key === "connection_request"));
    assert.ok(actionCatalog.actions.some((action) => action.key === "profile_view"));
    assert.ok(actionCatalog.actions.some((action) => action.key === "send_direct_message"));
    assert.ok(actionCatalog.actions.some((action) => action.key === "create_post_comment"));

    const shownAction = JSON.parse(
      execFileSync("node", [cliPath, "actions", "show", "send_direct_message", "--json"], {
        cwd: tempDir,
        encoding: "utf8"
      })
    );

    assert.equal(shownAction.action.key, "send_direct_message");
    assert.equal(shownAction.action.platform, "linkedin");
    assert.ok(shownAction.action.fields.includes("text"));
    assert.ok(shownAction.action.knowledgeRefs.some((ref) => /action-catalog\.md$/i.test(ref.path)));

    const motionActions = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "actions", motion.id, "--prospect", prospectId, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    const profileViewAction = motionActions.actions.find((action) => action.key === "profile_view");
    const connectionRequestAction = motionActions.actions.find((action) => action.key === "connection_request");
    const directMessageAction = motionActions.actions.find((action) => action.key === "send_direct_message");
    const emailAction = motionActions.actions.find((action) => action.key === "send_email");
    const postCommentAction = motionActions.actions.find((action) => action.key === "create_post_comment");

    assert.equal(profileViewAction.available, true);
    assert.equal(connectionRequestAction.available, true);
    assert.equal(connectionRequestAction.draftSurface.key, "connection_request");
    assert.equal(directMessageAction.available, false);
    assert.match(directMessageAction.reason, /accepted connection|inbound/i);
    assert.equal(emailAction.available, true);
    assert.equal(postCommentAction.available, true);
    assert.equal(postCommentAction.draftSurface.key, "public_comment");

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
        prospectId,
        "--surface",
        "profile_view",
        "--direction",
        "outbound",
        "--outcome",
        "sent",
        "--occurred-at",
        "2026-05-26T18:00:00.000Z",
        "--summary",
        "Viewed the LinkedIn profile before outreach.",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const motionActionsAfterView = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "actions", motion.id, "--prospect", prospectId, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    const profileViewAfter = motionActionsAfterView.actions.find((action) => action.key === "profile_view");
    assert.equal(profileViewAfter.available, false);
    assert.match(profileViewAfter.reason, /already viewed|already recorded/i);

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
        prospectId,
        "--surface",
        "follow",
        "--direction",
        "outbound",
        "--outcome",
        "blocked",
        "--occurred-at",
        "2026-05-26T18:05:00.000Z",
        "--summary",
        "LinkedIn rejected the follow attempt.",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const motionActionsAfterBlockedFollow = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "actions", motion.id, "--prospect", prospectId, "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    const followAfterBlocked = motionActionsAfterBlockedFollow.actions.find((action) => action.key === "follow");
    assert.equal(followAfterBlocked.available, false);
    assert.equal(followAfterBlocked.status, "blocked");
    assert.match(followAfterBlocked.reason, /rejected a follow attempt|rejected 1 follow attempt/i);

    const actionBrief = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "motion", "action-brief", motion.id, "--prospect", prospectId, "--action", "connection_request", "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );

    assert.equal(actionBrief.action.key, "connection_request");
    assert.equal(actionBrief.action.available, true);
    assert.equal(actionBrief.action.draftSurface.key, "connection_request");
    assert.ok(actionBrief.action.executionHints.affordances.length > 0);
    assert.ok(actionBrief.action.executionHints.fallbacks.some((hint) => /direct invite flow/i.test(hint)));
    assert.ok(actionBrief.execution.steps.some((step) => /native chrome|browser harness/i.test(step)));
    assert.ok(actionBrief.execution.contextualHints.some((hint) => /blocked Follow attempt|Follow attempts/i.test(hint)));
    assert.ok(actionBrief.execution.writeback.command.includes("exo companies touches add"));
    assert.ok(actionBrief.execution.knowledgeRefs.some((ref) => /action-catalog\.md$/i.test(ref.path)));
    assert.ok(actionBrief.execution.knowledgeRefs.some((ref) => /docs\/linkedin\/connection_request\.md$/i.test(ref.path)));

    const actionDetail = JSON.parse(
      execFileSync(
        "node",
        [cliPath, "actions", "show", "connection_request", "--json"],
        {
          cwd: tempDir,
          encoding: "utf8"
        }
      )
    );
    assert.ok(actionDetail.action.executionHints.successProofs.some((hint) => /Pending control|Pending/i.test(hint)));
    assert.ok(actionDetail.action.knowledgeRefs.some((ref) => /docs\/linkedin\/connection_request\.md$/i.test(ref.path)));
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
  assert.match(topLevelHelp, /Use exo motion intake when an agent should ask one setup question at a time/);
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
  assert.match(companiesHelp, /exo companies user show <company-id>/);
  assert.match(companiesHelp, /exo companies user assign <company-id> --user <user-id>/);
  assert.match(companiesHelp, /Keep the noun consistent/);

  const usersHelp = execFileSync("node", [cliPath, "users", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(usersHelp, /exo users add --label william-main --owner william/);
  assert.match(usersHelp, /exo users harness add <user-id> --runtime codex --connector chrome --status available/);
  assert.match(usersHelp, /exo users accounts add <user-id> --capability linkedin/);
  assert.match(usersHelp, /exo users resolve <user-id> --capability gmail --json/);

  const actionsHelp = execFileSync("node", [cliPath, "actions", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(actionsHelp, /exo actions list/);
  assert.match(actionsHelp, /exo actions show <action-key>/);

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
  assert.match(motionRootHelp, /exo motion intake/);
  assert.match(motionRootHelp, /exo motion clone/);
  assert.match(motionRootHelp, /exo motion update/);
  assert.match(motionRootHelp, /exo motion prospects/);
  assert.match(motionRootHelp, /exo motion drafts/);
  assert.match(motionRootHelp, /exo motion draft-brief/);
  assert.match(motionRootHelp, /exo motion actions/);
  assert.match(motionRootHelp, /exo motion action-brief/);
  assert.match(motionRootHelp, /exo motion pause/);
  assert.match(motionRootHelp, /exo motion resume/);
  assert.match(motionRootHelp, /exo motion archive/);
  assert.match(motionRootHelp, /exo motion restart/);
  assert.match(motionRootHelp, /exo motion refresh/);

  const reportHelp = execFileSync("node", [cliPath, "report", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(reportHelp, /exo report motion <motion-id>/);

  const inboundHelp = execFileSync("node", [cliPath, "inbound", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(inboundHelp, /exo inbound surfaces/);
  assert.match(inboundHelp, /exo inbound sync show <user-id>/);
  assert.match(inboundHelp, /exo inbound observations list <user-id>/);

  const inboxHelp = execFileSync("node", [cliPath, "inbox", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(inboxHelp, /exo inbox --user <user-id>/);
  assert.match(inboxHelp, /triage surface/i);

  const dailyHelp = execFileSync("node", [cliPath, "daily", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(dailyHelp, /exo daily --user <user-id>/);
  assert.match(dailyHelp, /planner surface/i);

  const nextHelp = execFileSync("node", [cliPath, "next", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(nextHelp, /exo next/);
  assert.match(nextHelp, /strongest governed next move/i);
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
    about.currentCapabilities.some((item) => item.command === "exo companies add/list/find/show/update/motions/research-brief/signal-matches show/add/prospects show/add/update/claim/complete/through-line show/set/opening-plan show/set/cadence show/set/touches show/add/profile show/assign/user show/assign"),
    "expected companies surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo motion intake/start/add/seed/discover/target/packets/packet-brief/prospects/actions/action-brief/drafts/draft-brief/clone/update/pause/resume/archive/restart/refresh/list/show/remove"),
    "expected motion write surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo report motion"),
    "expected unified motion report surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo actions list/show"),
    "expected canonical action catalog surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo inbound surfaces/surface/sync show/set/record/observations list/show/add"),
    "expected inbound read\/write surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo inbox"),
    "expected inbox surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo daily"),
    "expected daily planner surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo next"),
    "expected next shorthand surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo profiles discover/add/claim/list/show/capabilities/resolve/test/remove"),
    "expected profile capability command surface to be listed in current capabilities"
  );
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo users add/list/show/harness add/accounts add/resolve"),
    "expected execution-user surface to be listed in current capabilities"
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
    about.agentUsage.bootstrapSequence.includes("exo users list --json"),
    "expected bootstrap sequence to include execution-user discovery"
  );
  assert.ok(
    about.agentUsage.bootstrapSequence.includes("exo inbound surfaces --json"),
    "expected bootstrap sequence to include inbound surface discovery"
  );
  assert.ok(
    about.agentUsage.bootstrapSequence.includes("exo inbound observations list <user-id> --json"),
    "expected bootstrap sequence to include inbound observation inspection"
  );
  assert.ok(
    about.agentUsage.bootstrapSequence.includes("exo inbox --user <user-id> --json"),
    "expected bootstrap sequence to include inbox inspection"
  );
  assert.ok(
    about.agentUsage.bootstrapSequence.includes("exo daily --user <user-id> --json"),
    "expected bootstrap sequence to include daily agenda inspection"
  );
  assert.ok(
    about.agentUsage.bootstrapSequence.includes("exo next --json"),
    "expected bootstrap sequence to include next-move shorthand"
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
    about.browserProfileRules.some((item) => /inbound sync policy/i.test(item)),
    "expected browser profile rules to mention inbound sync policy"
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
    about.docs.some((item) => item.path === "docs/inbound-sync.md"),
    "expected inbound sync doc to be listed"
  );
  assert.ok(
    about.docs.some((item) => item.path === "docs/inbox.md"),
    "expected inbox doc to be listed"
  );
  assert.ok(
    about.docs.some((item) => item.path === "docs/daily.md"),
    "expected daily doc to be listed"
  );
  assert.ok(
    about.docs.some((item) => item.path === "docs/next.md"),
    "expected next doc to be listed"
  );
  assert.ok(
    [
      "continue-motion",
      "activate-motion",
      "create-motion",
      "prepare-browser-work",
      "manage-companies"
    ].includes(about.agentUsage.recommendedPath.mode),
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
