// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { renderMotionsPage } from "../src/artifacts/render-motions.js";
import { buildMotionsViewModel } from "../src/core/build-motions-view.js";

const motionId = "motion-1";
const companyId = "company-1";
const offerUrl = "https://example.com/offer";

test("interactive motions page keeps the motion list visible and moves new-motion intake into a drawer", () => {
  const model = buildMotionsViewModel({
    motionSummaries: [
      {
        id: motionId,
        name: "signal-steady-hawk",
        status: "active",
        overallStage: "needs-company-research",
        companyCount: 1,
        prospectCount: 0,
        dueNowCount: 0,
      },
    ],
    motionDetails: [
      {
        motionId,
        motionName: "signal-steady-hawk",
        motionStatus: "active",
        overallStage: "needs-company-research",
        offer: {
          title: "Offer fixture",
          url: offerUrl,
          summary: "Fixture summary",
        },
        premise: {
          statement: "This offer matters when operators need a governed UI launch path.",
          status: "defined",
          source: "operator",
        },
        strategyState: { tone: "warning" },
        signals: [
          {
            question: "Is there recent evidence this team widened GTM scope?",
            scope: "company",
            companyCount: 0,
          },
        ],
        audiences: [
          {
            name: "Revenue leaders",
            rolesLine: "CRO, VP Sales",
            matchedCount: 0,
          },
        ],
        companies: [],
        backlogCompanies: [
          {
            companyId,
            companyName: "BacklogCo",
            domain: "backlogco.example",
            prospectCount: 0,
            stage: "needs-company-research",
            queueStatus: "discovered",
          },
        ],
        people: [],
        plan: {
          nextSteps: [],
          dueNowCount: 0,
          readyToSendCount: 0,
        },
      },
    ],
  });

  const html = renderMotionsPage(model, { interactive: true });
  const listIndex = html.indexOf('class="motion-cards"');
  const intakeIndex = html.indexOf('data-motion-intake');
  assert.ok(listIndex >= 0, "motion list should render");
  assert.ok(intakeIndex > listIndex, "drawer markup should render after the list");
  assert.match(html, /href="#motion-new"/);
  assert.match(html, /<div class="compose-title">New motion<\/div>/);
  assert.match(html, /What are we promoting\? Give me the offer URL first\./);
  assert.match(html, /What is the premise\? In one sentence, why should this offer matter right now\?/);
  assert.match(html, /Who should care first\? Name the primary audience or ICP you want to target\./);
  assert.match(html, /What recent evidence would make this motion talkable\? Add one or more signal questions\./);
  assert.match(html, /Enter one question per line\./);
  assert.match(html, /This URL already has a motion\. Do you want to continue it, clone it, or create a new one\?/);
  assert.match(html, /data-exo-writer="startMotionFromIntake"/);
  assert.match(html, /<script type="application\/json" data-motion-intake-seed>\{/);
  assert.doesNotMatch(html, /data-motion-intake-seed>.*&quot;/);
  assert.doesNotMatch(html, /Start a motion the same way Exo asks for it in chat\./);
  assert.doesNotMatch(html, /Governed intake/);
  assert.doesNotMatch(html, /Current question/);
  assert.doesNotMatch(html, /Exo only starts the motion when the required definition is present\./);
  assert.match(html, /name="url"/);
  assert.match(html, /name="premise"/);
  assert.match(html, /name="audience"/);
  assert.match(html, /name="signal"/);
});
