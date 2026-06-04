// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { renderProspectDetailPage } from "../src/artifacts/render-prospects.js";

function buildProspect(overrides = {}) {
  return {
    id: "prospect-1",
    name: "Lina Park",
    initials: "LP",
    avatarUrl: null,
    title: "Procurement Support Department",
    companyId: "company-1",
    companyName: "Unknown company",
    companyIndustry: "",
    companyLinkedinUrl: null,
    linkedinProfileUrl: null,
    motionId: "motion-1",
    motionName: "transition-inbound-backlog",
    signal: "Transitioned from inbox threads — in-flight before Exo.",
    signalTruth: "partial",
    fit: "moderate",
    branch: "connection-requested",
    branchLabel: "Sent / pending",
    actionIntents: { schedule: null, recordTouch: null },
    owner: "william-main",
    ageLabel: "today",
    premise: null,
    whyRelevant: "Transitioned from inbox threads — in-flight before Exo.",
    nextAction: "Review this inbound person and choose the next move.",
    primaryChannel: "email",
    hasEmailFallback: true,
    channels: ["email"],
    buyingCommitteeRole: "Other",
    decisionAuthority: "Unknown",
    recipientPremium: null,
    recipientOpenProfile: null,
    connectionDegree: null,
    sameCompany: [],
    drafts: [],
    touches: [],
    timelineNotes: [],
    firstSeenAt: null,
    selectedAt: null,
    ...overrides,
  };
}

test("prospect detail prefers the active email draft surface over branch-based LinkedIn compose", () => {
  const html = renderProspectDetailPage(buildProspect({
    drafts: [{
      id: "draft-1",
      surface: "email",
      channel: "email",
      subject: "Re: Halfmoon Hillcrest Fire Dept.",
      body: "Lina,\n\nThanks for sending this over.",
      status: "approved",
      authoredBy: "operator",
      editedByOperator: true,
      createdAt: "2026-06-04T17:14:29.676Z",
      updatedAt: "2026-06-04T17:14:29.676Z",
      approvedAt: "2026-06-04T17:14:29.676Z",
      sentAt: null,
      notes: null,
    }],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Compose message/);
  assert.match(html, /Email · Lina Park/);
  assert.doesNotMatch(html, /Compose request/);
  assert.doesNotMatch(html, /Connection request note · Lina Park/);
});

test("prospect detail still falls back to connection-request compose when no active draft exists", () => {
  const html = renderProspectDetailPage(buildProspect(), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Compose request/);
  assert.match(html, /Connection request note · Lina Park/);
});

test("prospect detail header does not keep showing a stale blocked agent badge after blockers clear", () => {
  const html = renderProspectDetailPage(buildProspect({
    drafts: [{
      id: "draft-1",
      surface: "email",
      channel: "email",
      subject: "Re: Halfmoon Hillcrest Fire Dept.",
      body: "Lina,\n\nThanks for sending this over.",
      status: "approved",
      authoredBy: "operator",
      editedByOperator: true,
      createdAt: "2026-06-04T17:14:29.676Z",
      updatedAt: "2026-06-04T17:14:29.676Z",
      approvedAt: "2026-06-04T17:14:29.676Z",
      sentAt: null,
      notes: null,
    }],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
    agentRuntime: {
      lock: null,
      scheduler: null,
      routine: { sendMode: "verify" },
      lastPass: {
        status: "blocked",
        reason: "Lina Park has no LinkedIn profile URL to message.",
      },
      queueCount: 2,
      blockerCount: 0,
    },
  });

  assert.match(html, /Agent work queued/);
  assert.match(html, /2 queued tasks waiting to run/);
  assert.doesNotMatch(html, /Agent is blocked/);
  assert.doesNotMatch(html, /has no LinkedIn profile URL to message/);
});

test("prospect timeline shows blocked outbound replies as blocked instead of sent", () => {
  const html = renderProspectDetailPage(buildProspect({
    primaryChannel: "linkedin",
    channels: ["linkedin"],
    handledNotification: {
      state: "reply_unavailable",
      detail: "the governed LinkedIn thread is read-only and reply is disabled.",
    },
    touches: [{
      surface: "inbound_reply",
      direction: "outbound",
      outcome: "blocked",
      occurredAt: "2026-06-04T18:02:29.000Z",
      summary: "Could not send the governed LinkedIn reply because the thread is read-only and reply is disabled.",
    }],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /tl-item tl-msg tl-bad/);
  assert.match(html, /tl-status-blocked/);
  assert.match(html, />Blocked</);
  assert.match(html, /Reply unavailable\./);
  assert.match(html, /read-only and reply is disabled/);
  assert.doesNotMatch(html, /Compose request/);
});
