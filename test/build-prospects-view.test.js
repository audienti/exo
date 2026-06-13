// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildProspectsViewModel } from "../src/core/build-prospects-view.js";

function buildRawProspect(overrides = {}) {
  return {
    prospectId: "prospect-1",
    name: "Lina Park",
    title: "Director of Procurement",
    companyId: "company-1",
    companyName: "ExampleCo",
    motionId: "motion-1",
    motionName: "motion-one",
    whyRelevant: "Relevant now.",
    signalMatches: [],
    cadenceState: { status: "ready", currentStep: "done" },
    contactPoints: [],
    touches: [],
    ...overrides,
  };
}

test("buildProspectsViewModel hides exhausted prospects with no channels and no touch history", () => {
  const hidden = buildRawProspect({
    prospectId: "hidden",
    name: "Hidden Prospect",
  });
  const reachable = buildRawProspect({
    prospectId: "reachable",
    name: "Reachable Prospect",
    email: "reachable@example.com",
  });
  const historical = buildRawProspect({
    prospectId: "historical",
    name: "Historical Prospect",
    touches: [{ occurredAt: "2026-06-05T12:00:00Z", outcome: "blocked" }],
  });

  const model = buildProspectsViewModel({
    prospectPrepLanes: [],
    engagementLanes: [{
      key: "exhausted",
      items: [
        { ...hidden, engagementLane: { key: "exhausted", label: "Exhausted" } },
        { ...reachable, engagementLane: { key: "exhausted", label: "Exhausted" } },
        { ...historical, engagementLane: { key: "exhausted", label: "Exhausted" } },
      ],
    }],
    motionDetails: [],
    now: "2026-06-05T13:00:00Z",
  });

  assert.deepEqual(
    model.all.map((prospect) => prospect.id),
    ["historical", "reachable"],
  );
  assert.equal(model.groups[0]?.prospects.length, 2);
  assert.deepEqual(
    model.details.find((prospect) => prospect.id === "reachable")?.sameCompany.map((prospect) => prospect.id).sort(),
    ["historical"],
  );
});

test("buildProspectsViewModel preserves channel destinations for hover and click affordances", () => {
  const model = buildProspectsViewModel({
    prospectPrepLanes: [{
      key: "selected",
      items: [buildRawProspect({
        prospectId: "reachable",
        name: "Reachable Prospect",
        linkedinProfileUrl: "https://www.linkedin.com/in/reachable-prospect/",
        email: "reachable@example.com",
        contactPoints: [{
          kind: "phone",
          value: "+1 (555) 010-1010",
          usableForOutreach: true,
          verificationStatus: "verified",
          confidence: "high",
        }],
      })],
    }],
    engagementLanes: [],
    motionDetails: [],
    now: "2026-06-05T13:00:00Z",
  });

  assert.deepEqual(model.all[0]?.channels, [
    {
      key: "linkedin",
      label: "LinkedIn profile",
      value: "https://www.linkedin.com/in/reachable-prospect/",
      href: "https://www.linkedin.com/in/reachable-prospect/",
      openInNewTab: true,
    },
    {
      key: "email",
      label: "Email address",
      value: "reachable@example.com",
      href: "mailto:reachable@example.com",
      openInNewTab: false,
    },
    {
      key: "phone",
      label: "Phone number",
      value: "+1 (555) 010-1010",
      href: "tel:+15550101010",
      openInNewTab: false,
    },
  ]);
});

test("buildProspectsViewModel normalizes reply-accepted to the operator-facing in-conversation label", () => {
  const model = buildProspectsViewModel({
    prospectPrepLanes: [],
    engagementLanes: [{
      key: "reply-accepted",
      items: [buildRawProspect({
        prospectId: "reply-prospect",
        name: "Reply Prospect",
        linkedinProfileUrl: "https://www.linkedin.com/in/reply-prospect/",
        engagementLane: { key: "reply-accepted", label: "Reply / accepted" },
        cadenceState: {
          status: "ready",
          currentStep: "direct-message",
          lastTouchOutcome: "sent",
          lastTouchAt: "2026-06-07T00:09:49.284Z",
          nextAction: "Wait for a LinkedIn reply before forcing a new branch.",
        },
        touches: [
          {
            surface: "inbound_reply",
            direction: "inbound",
            outcome: "replied",
            occurredAt: "2025-10-10T09:55:39.000Z",
          },
          {
            surface: "inbound_reply",
            direction: "outbound",
            outcome: "sent",
            occurredAt: "2026-06-07T00:09:49.284Z",
          },
        ],
      })],
    }],
    motionDetails: [],
    now: "2026-06-07T00:10:00Z",
  });

  assert.equal(model.details[0]?.branch, "reply-accepted");
  assert.equal(model.details[0]?.branchLabel, "In conversation");
});

test("buildProspectsViewModel normalizes sent-pending to request sent", () => {
  const model = buildProspectsViewModel({
    prospectPrepLanes: [],
    engagementLanes: [{
      key: "sent-pending",
      items: [buildRawProspect({
        prospectId: "pending-prospect",
        name: "Pending Prospect",
        linkedinProfileUrl: "https://www.linkedin.com/in/pending-prospect/",
        engagementLane: { key: "sent-pending", label: "Sent / pending" },
        cadenceState: {
          status: "ready",
          currentStep: "connection-request",
          lastTouchOutcome: "pending",
          lastTouchAt: "2026-06-07T00:09:49.284Z",
          nextAction: "Wait for the connection request to resolve.",
        },
        touches: [
          {
            surface: "connection_request",
            direction: "outbound",
            outcome: "pending",
            occurredAt: "2026-06-07T00:09:49.284Z",
          },
        ],
      })],
    }],
    motionDetails: [],
    now: "2026-06-07T00:10:00Z",
  });

  assert.equal(model.details[0]?.branch, "connection-requested");
  assert.equal(model.details[0]?.branchLabel, "Request sent");
});

test("buildProspectsViewModel preserves an email-sent waiting label without collapsing it to sent-pending", () => {
  const model = buildProspectsViewModel({
    prospectPrepLanes: [],
    engagementLanes: [{
      key: "waiting",
      items: [buildRawProspect({
        prospectId: "email-prospect",
        name: "Email Prospect",
        email: "email.prospect@example.com",
        engagementLane: { key: "waiting", label: "Email sent" },
        cadenceState: {
          status: "ready",
          currentStep: "value-add-email",
          lastTouchOutcome: "sent",
          lastTouchAt: "2026-06-05T00:24:16.523Z",
          nextAction: "Wait for an email reply before changing channels again.",
        },
        touches: [
          {
            surface: "email",
            direction: "outbound",
            outcome: "sent",
            occurredAt: "2026-06-05T00:24:16.523Z",
          },
        ],
      })],
    }],
    motionDetails: [],
    now: "2026-06-07T00:10:00Z",
  });

  assert.equal(model.details[0]?.branch, "waiting");
  assert.equal(model.details[0]?.branchLabel, "Email sent");
});

test("buildProspectsViewModel filters prospects by case-insensitive multi-field search terms", () => {
  const model = buildProspectsViewModel({
    prospectPrepLanes: [{
      key: "selected",
      items: [
        buildRawProspect({
          prospectId: "prospect-1",
          name: "Lina Park",
          title: "Director of Procurement",
          companyName: "ExampleCo",
          signalMatches: [{ summary: "Recent buying-committee change." }],
        }),
        buildRawProspect({
          prospectId: "prospect-2",
          name: "Marco Diaz",
          title: "VP Finance",
          companyId: "company-2",
          companyName: "Northstar",
          signalMatches: [{ summary: "Risk tooling review underway." }],
        }),
      ],
    }],
    engagementLanes: [],
    motionDetails: [],
    query: "example procurement",
    now: "2026-06-05T13:00:00Z",
  });

  assert.deepEqual(model.all.map((prospect) => prospect.id), ["prospect-1"]);
  assert.equal(model.counts.prospects, 1);
  assert.equal(model.counts.companies, 1);
  assert.deepEqual(model.search, {
    query: "example procurement",
    active: true,
    totalProspects: 2,
    totalCompanies: 2,
  });
});

test("buildProspectsViewModel carries owner labels from motion people and backlog companies", () => {
  const model = buildProspectsViewModel({
    prospectPrepLanes: [{
      key: "selected",
      items: [buildRawProspect({
        prospectId: "prospect-1",
        name: "Anthony Rose",
        companyName: "The Pitch",
        motionName: "transition-inbound-backlog",
      })],
    }],
    engagementLanes: [],
    motionDetails: [{
      motionId: "motion-1",
      motionName: "transition-inbound-backlog",
      motionStatus: "active",
      premise: { statement: "Reconcile transition relationships.", status: "defined" },
      signals: [],
      companies: [],
      backlogCompanies: [{
        companyId: "company-1",
        companyName: "The Pitch",
        websiteUrl: "https://thepitch.uk/",
        executionIdentity: {
          user: {
            id: "user-1",
            label: "william-main",
          },
        },
      }],
      people: [{
        prospectId: "prospect-1",
        ownerLabel: "william-main",
      }],
    }],
    now: "2026-06-05T13:00:00Z",
  });

  assert.equal(model.details[0]?.owner, "william-main");
});
