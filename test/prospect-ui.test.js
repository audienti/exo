// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { renderProspectDetailPage, renderProspectsPage } from "../src/artifacts/render-prospects.js";

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
    signalHref: null,
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
    cadenceState: null,
    primaryChannel: "email",
    email: null,
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
    threadMessages: [],
    timelineObservations: [],
    handledNotification: null,
    agentQueueItems: [],
    capturedPublicActivity: [],
    publicEngagementSelection: null,
    timelineNotes: [],
    firstSeenAt: null,
    selectedAt: null,
    ...overrides,
  };
}

/**
 * @param {string} html
 * @param {string} label
 */
function assertCurrentPipelineStage(html, label) {
  assert.match(
    html,
    new RegExp(`pl-step reached current"><div class="pl-dot"><i></i></div><div class="pl-label">${label}</div>`),
  );
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

test("prospect detail re-home panel reuses the shared motion chooser cards", () => {
  const html = renderProspectDetailPage(buildProspect({
    motionId: "transition-1",
    motionName: "transition-inbound-backlog",
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "transition-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [
      {
        id: "transition-1",
        name: "transition-inbound-backlog",
        offerLabel: "Transition backlog",
        premise: "Continue and reconcile relationships started before Exo, then re-home them into real motions once they are understood.",
        status: "active",
        statusLabel: "Active",
      },
      {
        id: "motion-1",
        name: "harsh-spare-mongoose",
        offerLabel: "Knit",
        premise: "This offer matters when GTM teams need governed outbound work instead of a pile of disconnected prospecting tasks.",
        status: "draft",
        statusLabel: "Draft",
      },
      {
        id: "motion-2",
        name: "rational-coarse-wren",
        offerLabel: "Audienti",
        premise: "This offer matters when operators need one governed system of record for active GTM motions.",
        status: "paused",
        statusLabel: "Paused",
      },
    ],
  });

  assert.equal((html.match(/data-exo-writer="rehomeProspect"/g) ?? []).length, 2);
  assert.match(html, /Destination motion/);
  assert.match(html, /Status/);
  assert.match(html, /Offer/);
  assert.match(html, /Premise/);
  assert.match(html, /Re-home here/);
  assert.match(html, /Knit/);
  assert.match(html, /Audienti/);
  assert.match(html, /harsh-spare-mongoose/);
  assert.match(html, /rational-coarse-wren/);
  assert.match(html, /governed outbound work instead of a pile of disconnected prospecting tasks/);
  assert.doesNotMatch(html, /data-exo-radio="rehome-motion:/);
  assert.doesNotMatch(html, /Transition backlog/);
});

test("prospect detail exposes a visible assign-owner action when the owner is still missing", () => {
  const html = renderProspectDetailPage(buildProspect({
    owner: null,
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /<span>Assign owner<\/span>/);
  assert.match(html, /href="#assign-prospect-1"/);
});

test("prospect detail exposes governed lifecycle and packet review actions", () => {
  const html = renderProspectDetailPage(buildProspect({
    disposition: "active",
    accountDisposition: "active",
    packetStatus: "submitted",
    packetState: {
      kind: "prospect_research",
      status: "submitted",
      workerLabel: "packet-worker",
      claimedAt: "2026-06-11T10:00:00.000Z",
      completedAt: "2026-06-11T10:30:00.000Z",
      proposal: {
        kind: "prospect_research",
        action: "advance",
        nextStatus: null,
        disposition: null,
        reason: "Ready for branch review.",
        proposedAt: "2026-06-11T10:30:00.000Z",
      },
    },
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Lifecycle/);
  assert.match(html, /data-exo-writer="setProspectDisposition"/);
  assert.match(html, /data-exo-fields="lifecycleReason:reason"/);
  assert.match(html, /Nurture/);
  assert.match(html, /Not a fit/);
  assert.match(html, /Exhausted/);
  assert.match(html, /Packet review/);
  assert.match(html, /data-exo-writer="resolvePacketReview"/);
  assert.match(html, /Accept packet/);
  assert.match(html, /Return packet/);
  assert.match(html, /\.lifecycle-panel\{[^}]*max-width:none\}/s);
});

test("prospect detail shows email thread observations and waits on a sent email instead of inventing a queued draft", () => {
  const html = renderProspectDetailPage(buildProspect({
    branch: "waiting",
    branchLabel: "Email sent",
    primaryChannel: "email",
    email: "lpark@govpointeoffice.us",
    cadenceState: {
      status: "ready",
      currentStep: "value-add-email",
      lastTouchOutcome: "sent",
      lastTouchAt: "2026-06-05T00:24:16.523Z",
      nextAction: "Wait for an email reply before changing channels again.",
    },
    touches: [{
      surface: "email",
      direction: "outbound",
      outcome: "sent",
      occurredAt: "2026-06-05T00:24:16.523Z",
      summary: "Sent send email for Lina Park.",
    }],
    timelineObservations: [{
      id: "obs-email-thread",
      kind: "email_thread_updated",
      surfaceKey: "gmail-inbox-threads",
      observedAt: "2026-06-04T13:37:36.000Z",
      eventAt: null,
      summary: "Repeated follow-up on a public-safety recruitment/website RFP for Halfmoon Hillcrest Fire Dept.",
      sourceUrl: "https://mail.google.com/mail/#all/19e92da9d7e8fd05",
      threadUrl: "https://mail.google.com/mail/#all/19e92da9d7e8fd05",
      notes: "Subject: Re: William - Halfmoon Hillcrest Fire Dept.\n\nExternal follow-up thread. No reply from William visible in this thread.",
    }],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Email sent/);
  assert.match(html, /Wait for the email reply/);
  assert.match(html, /The last email is out\. Stay on this thread until they answer or the branch changes\./);
  assert.match(html, /Email thread updated/);
  assert.match(html, /External follow-up thread\. No reply from William visible in this thread\./);
  assert.match(html, /The last email was sent\. The agent will wait for a reply before drafting again\./);
  assert.doesNotMatch(html, /Sent send email for Lina Park\./);
  assert.doesNotMatch(html, /Review the queued email reply/);
});

test("prospect detail ignores a stale private-reply draft when the thread already shows the sent response", () => {
  const html = renderProspectDetailPage(buildProspect({
    name: "Sara Vargas",
    title: "Senior Research Scientist; Associate Professor",
    branch: "waiting",
    branchLabel: "Email thread active",
    primaryChannel: "email",
    email: "svargas@brownhealth.org",
    cadenceState: {
      status: "ready",
      currentStep: null,
      lastTouchOutcome: "pending",
      lastTouchAt: "2026-06-02T17:45:24.000Z",
      nextAction: "Review this inbound person and choose the next move.",
    },
    threadMessages: [
      {
        id: "msg-1",
        direction: "inbound",
        sentAt: "2026-06-02T19:11:54.000Z",
        fromName: "Sara Vargas",
        fromHandle: "svargas@brownhealth.org",
        body: "Would you be okay with me connecting the two of you?",
      },
      {
        id: "msg-2",
        direction: "outbound",
        sentAt: "2026-06-02T21:45:24.000Z",
        fromName: "William Flanagan",
        fromHandle: "wflanagan@audienti.com",
        body: "Sure, always happy to talk and advise. Thank you.",
      },
    ],
    drafts: [{
      id: "draft-1",
      surface: "email",
      channel: "email",
      subject: null,
      body: "Hi Sara,\n\nYes, please feel free to connect us.",
      status: "ready",
      authoredBy: "agent",
      editedByOperator: false,
      createdAt: "2026-06-07T11:01:17.319Z",
      updatedAt: "2026-06-07T11:01:17.319Z",
      approvedAt: null,
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

  assert.match(html, /Wait for the email reply/);
  assert.match(html, /Sure, always happy to talk and advise\. Thank you\./);
  assert.match(html, /The last email on this thread is already out\./);
  assert.doesNotMatch(html, /Review the drafted email/);
  assert.doesNotMatch(html, /Hi Sara,\s+Yes, please feel free to connect us\./i);
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

test("prospect detail keeps queued pre-connect warmup in next move and out of the engagement timeline", () => {
  const html = renderProspectDetailPage(buildProspect({
    branch: "identified",
    agentQueueItems: [{
      kind: "send_message",
      via: "public-engagement",
      surface: "like_post",
      recipientUrl: "https://www.linkedin.com/posts/lina-park",
      dueAt: "2026-06-04T17:14:29.676Z",
      postSendNextAction: "Wait 48 hours, then queue the connection-request draft for review.",
    }],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Pre-connect warmup queued/);
  assertCurrentPipelineStage(html, "Pre-connect");
  assert.match(html, /The agent will react to the stored post on its next pass\./);
  assert.match(html, /Wait 48 hours, then queue the connection-request draft for review\./);
  assert.match(html, /Engagement timeline <span>0<\/span>/);
  assert.doesNotMatch(html, /tl-title">Pre-connect warmup queued/);
  assert.doesNotMatch(html, /Compose request/);
  assert.doesNotMatch(html, /Send the first connection request\./);
});

test("prospect detail targets the public-comment compose surface when pre-connect draft work is queued", () => {
  const html = renderProspectDetailPage(buildProspect({
    branch: "identified",
    agentQueueItems: [{
      kind: "write_draft",
      reason: "public_engagement",
      surface: "public_comment",
      recipientUrl: "https://www.linkedin.com/posts/lina-park",
      dueAt: "2026-06-04T17:14:29.676Z",
      postSendNextAction: "Wait 48 hours, then queue the connection-request draft for review.",
    }],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Compose comment/);
  assert.match(html, /Comment · Lina Park/);
  assert.match(html, /Agent is drafting the pre-connect comment/);
  assert.match(html, /Review it when it lands, then queue it for send\./);
  assert.match(html, /Engagement timeline <span>0<\/span>/);
  assert.doesNotMatch(html, /tl-title">Pre-connect comment queued/);
  assert.doesNotMatch(html, /Compose request/);
});

test("prospect detail shows the selected public activity even when the original post timestamp is missing", () => {
  const html = renderProspectDetailPage(buildProspect({
    branch: "identified",
    profileViewedAt: "2026-06-04T17:14:29.676Z",
    capturedPublicActivity: [{
      activityType: "own-post",
      url: "https://www.linkedin.com/posts/lina-park",
      postedAt: null,
      targetKind: "post",
      recommendedAction: "reaction",
      summary: "Lina posted about procurement orchestration and vendor governance.",
      rationale: "Stored as the lightweight public-engagement target.",
    }],
    publicEngagementSelection: {
      url: "https://www.linkedin.com/posts/lina-park",
      selectedAt: "2026-06-04T17:14:29.676Z",
    },
    firstSeenAt: "2026-06-04T17:10:00.000Z",
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Selected LinkedIn post/);
  assert.match(html, /Lina posted about procurement orchestration and vendor governance\./);
});

test("prospect detail links to the surfacing signal and uses the shorter rationale label", () => {
  const html = renderProspectDetailPage(buildProspect({
    signal: "Generational recently promoted DealForce and a strategic alliance tied to David's remit.",
    signalHref: "https://www.linkedin.com/company/generational-group/",
    signalRationale: "This is role-linked evidence tied to current programs he owns.",
    firstSeenAt: "2026-06-04T17:10:00.000Z",
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Read signal/);
  assert.match(html, /https:\/\/www\.linkedin\.com\/company\/generational-group\//);
  assert.match(html, /<strong>Why:<\/strong> This is role-linked evidence tied to current programs he owns\./);
  assert.doesNotMatch(html, /Why this connects:/);
});

test("prospect detail hides a stale connection-request draft while pre-connect is the active governed branch", () => {
  const html = renderProspectDetailPage(buildProspect({
    branch: "identified",
    drafts: [{
      id: "draft-1",
      surface: "connection_request",
      channel: "linkedin",
      subject: null,
      body: "Lina, I'd like to connect.",
      status: "ready",
      authoredBy: "agent",
      editedByOperator: false,
      approvedByOperator: false,
      createdAt: "2026-06-04T17:14:29.676Z",
      updatedAt: "2026-06-04T17:14:29.676Z",
      approvedAt: null,
      sentAt: null,
      notes: null,
    }],
    agentQueueItems: [{
      kind: "send_message",
      via: "public-engagement",
      surface: "like_post",
      recipientUrl: "https://www.linkedin.com/posts/lina-park",
      dueAt: "2026-06-04T17:20:00.000Z",
      postSendNextAction: "Wait 48 hours, then queue the connection-request draft for review.",
    }],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Pre-connect warmup queued/);
  assert.doesNotMatch(html, /tl-title">Connection request/);
});

test("prospect detail keeps the connection-request note editor when the assigned LinkedIn account is Sales Navigator capable", () => {
  const html = renderProspectDetailPage(buildProspect(), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
    assignedIdentity: "william-main",
    connectionNoteCapable: true,
  });

  assert.match(html, /Connection request note · Lina Park/);
  assert.doesNotMatch(html, /No note available\./);
  assert.doesNotMatch(html, /Queue note-less request/);
});

test("prospect detail chooses reply compose when the prospect has unanswered inbound", () => {
  const html = renderProspectDetailPage(buildProspect({
    linkedinProfileUrl: "https://www.linkedin.com/in/lina-park/",
    branch: "connected",
    primaryChannel: "direct-message",
    cadenceState: {
      status: "ready",
      currentStep: "direct-message",
    },
    touches: [
      {
        surface: "post_accept_message",
        direction: "outbound",
        outcome: "sent",
        occurredAt: "2026-06-04T16:05:59.952Z",
        summary: "Sent the first direct message.",
      },
      {
        surface: "inbound_reply",
        direction: "inbound",
        outcome: "received",
        occurredAt: "2026-06-04T20:27:55.273Z",
        summary: "Lina replied and asked for more detail.",
      },
    ],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Reply · Lina Park/);
  assert.doesNotMatch(html, /First message · Lina Park/);
  assert.match(html, /Agent is drafting the response/);
  assert.match(html, /Wait for the governed draft to land/);
});

test("prospect detail does not reopen a stale queued follow-up when an inbound reply arrived", () => {
  const html = renderProspectDetailPage(buildProspect({
    linkedinProfileUrl: "https://www.linkedin.com/in/lina-park/",
    branch: "waiting",
    primaryChannel: "direct-message",
    cadenceState: {
      status: "ready",
      currentStep: "direct-message",
    },
    drafts: [{
      id: "draft-1",
      surface: "follow_up_direct_message",
      channel: "linkedin",
      subject: null,
      body: "Following up on this.",
      status: "approved",
      authoredBy: "operator",
      editedByOperator: true,
      createdAt: "2026-06-04T17:14:29.676Z",
      updatedAt: "2026-06-04T17:14:29.676Z",
      approvedAt: "2026-06-04T17:14:29.676Z",
      sentAt: null,
      notes: null,
    }],
    touches: [
      {
        surface: "post_accept_message",
        direction: "outbound",
        outcome: "sent",
        occurredAt: "2026-06-04T16:05:59.952Z",
        summary: "Sent the first direct message.",
      },
      {
        surface: "inbound_reply",
        direction: "inbound",
        outcome: "received",
        occurredAt: "2026-06-04T20:27:55.273Z",
        summary: "Lina replied and asked for more detail.",
      },
    ],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Reply · Lina Park/);
  assert.doesNotMatch(html, /Follow-up message · Lina Park/);
  assert.match(html, /Agent is drafting the response/);
  assert.match(html, /Wait for the governed draft to land/);
});

test("prospect detail shows a queued reply when the current inbound draft is already send-ready", () => {
  const html = renderProspectDetailPage(buildProspect({
    linkedinProfileUrl: "https://www.linkedin.com/in/lina-park/",
    branch: "connected",
    primaryChannel: "direct-message",
    cadenceState: {
      status: "ready",
      currentStep: "direct-message",
    },
    drafts: [{
      id: "draft-1",
      surface: "inbound_reply",
      channel: "linkedin",
      subject: null,
      body: "Queued reply copy.",
      status: "approved",
      authoredBy: "operator",
      editedByOperator: true,
      createdAt: "2026-06-04T21:00:00.000Z",
      updatedAt: "2026-06-04T21:00:00.000Z",
      approvedAt: "2026-06-04T21:00:00.000Z",
      sentAt: null,
      notes: null,
    }],
    touches: [
      {
        surface: "post_accept_message",
        direction: "outbound",
        outcome: "sent",
        occurredAt: "2026-06-04T16:05:59.952Z",
        summary: "Sent the first direct message.",
      },
      {
        surface: "inbound_reply",
        direction: "inbound",
        outcome: "received",
        occurredAt: "2026-06-04T20:27:55.273Z",
        summary: "Lina replied and asked for more detail.",
      },
    ],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Reply queued for send/);
  assert.match(html, /The agent will send it on its next pass/);
});

test("prospect detail uses a compact next-move row and metadata rail", () => {
  const html = renderProspectDetailPage(buildProspect({
    companyName: "6sense",
    fit: "high",
    owner: "william-main",
    branch: "identified",
    ageLabel: "today",
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /class="pd-rail"/);
  assert.match(html, /6sense/);
  assert.match(html, /High fit/);
  assert.match(html, /william-main/);
  assert.match(html, /class="next-alert"/);
  assert.match(html, /Next move/);
  assert.match(html, /Send the first connection request\./);
  assert.doesNotMatch(html, /<div class="pd-meta">/);
  assert.doesNotMatch(html, /<p class="pl-now">/);
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

test("prospect timeline recovers the sent reply body from the matching sent draft", () => {
  const html = renderProspectDetailPage(buildProspect({
    primaryChannel: "linkedin",
    channels: ["linkedin"],
    drafts: [{
      id: "draft-1",
      surface: "inbound_reply",
      channel: "linkedin",
      subject: null,
      body: "Hi Marv, thanks for reaching out. I'm not currently looking to retire, move on, or sell the business, so a call probably would not be useful right now.",
      status: "sent",
      authoredBy: "agent",
      editedByOperator: false,
      approvedByOperator: false,
      createdAt: "2026-06-06T23:11:14.056Z",
      updatedAt: "2026-06-07T00:09:49.332Z",
      approvedAt: "2026-06-06T23:15:40.414Z",
      sentAt: "2026-06-07T00:09:49.332Z",
      notes: null,
    }],
    touches: [
      {
        surface: "inbound_reply",
        direction: "inbound",
        outcome: "replied",
        occurredAt: "2025-10-10T09:55:39.000Z",
        summary: "Marv White has unread LinkedIn message activity.",
        body: "Hi William, are you thinking about retiring?",
      },
      {
        surface: "inbound_reply",
        direction: "outbound",
        outcome: "sent",
        occurredAt: "2026-06-07T00:09:49.284Z",
        summary: "Sent send direct message for Marv White.",
      },
    ],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /I&#39;m not currently looking to retire, move on, or sell the business/);
  assert.match(html, /tl-status-sent/);
  assert.doesNotMatch(html, /Sent send direct message for Marv White\./);
});

test("prospect timeline shows the full structured thread history and keeps later governed sends", () => {
  const html = renderProspectDetailPage(buildProspect({
    linkedinProfileUrl: "https://www.linkedin.com/in/mpiercekc/",
    threadMessages: [
      {
        id: "msg-1",
        direction: "outbound",
        sentAt: "2026-06-04T16:05:59.952Z",
        fromName: "You",
        fromHandle: null,
        body: "Hi Matt,\n\nGiven that you are focused on RevOps, I am looking for some advice.",
      },
      {
        id: "msg-2",
        direction: "inbound",
        sentAt: "2026-06-04T20:27:55.273Z",
        fromName: "Matt Pierce",
        fromHandle: null,
        body: "Hey - at Valet Living, it would probably be the CTO, Robert Cassagrande.",
      },
      {
        id: "msg-3",
        direction: "outbound",
        sentAt: "2026-06-05T13:43:57.399Z",
        fromName: "You",
        fromHandle: null,
        body: "Appreciate the pointer. Robert Cassagrande as CTO sounds right.",
      },
      {
        id: "msg-4",
        direction: "inbound",
        sentAt: "2026-06-05T14:25:09.250Z",
        fromName: "Matt Pierce",
        fromHandle: null,
        body: "I'd say just reach out to Rob directly.",
      },
      {
        id: "msg-5",
        direction: "outbound",
        sentAt: "2026-06-05T15:04:24.246Z",
        fromName: "You",
        fromHandle: null,
        body: "Got it, I'll reach out to Rob directly. Would it be okay if I mentioned you pointed me his way?",
      },
      {
        id: "msg-6",
        direction: "inbound",
        sentAt: "2026-06-05T15:07:07.056Z",
        fromName: "Matt Pierce",
        fromHandle: null,
        body: "Yes, that's fine.",
      },
    ],
    drafts: [{
      id: "draft-1",
      surface: "inbound_reply",
      channel: "linkedin",
      subject: null,
      body: "Perfect. I'll keep it tight and mention you pointed me his way. Appreciate the steer.",
      status: "sent",
      authoredBy: "agent",
      editedByOperator: false,
      approvedByOperator: false,
      createdAt: "2026-06-06T12:47:05.818Z",
      updatedAt: "2026-06-07T00:10:58.581Z",
      approvedAt: "2026-06-06T15:07:02.083Z",
      sentAt: "2026-06-07T00:10:58.581Z",
      notes: null,
    }],
    touches: [
      {
        surface: "inbound_reply",
        direction: "inbound",
        outcome: "replied",
        occurredAt: "2026-06-05T15:07:07.000Z",
        summary: "Matt Pierce has unread LinkedIn message activity.",
      },
      {
        surface: "inbound_reply",
        direction: "outbound",
        outcome: "sent",
        occurredAt: "2026-06-07T00:10:58.526Z",
        summary: "Sent send direct message for Matt Pierce.",
      },
    ],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.equal((html.match(/class="tl-message"/g) ?? []).length, 7);
  assert.match(html, /Given that you are focused on RevOps/);
  assert.match(html, /Robert Cassagrande/);
  assert.match(html, /Would it be okay if I mentioned you pointed me his way\?/);
  assert.match(html, /Yes, that&#39;s fine\./);
  assert.match(html, /Perfect\. I&#39;ll keep it tight and mention you pointed me his way\./);
  assert.doesNotMatch(html, /Matt Pierce has unread LinkedIn message activity\./);
  assert.doesNotMatch(html, /Sent send direct message for Matt Pierce\./);
});

test("prospect timeline suppresses later duplicate synthetic send touches once the real outbound body is recovered", () => {
  const html = renderProspectDetailPage(buildProspect({
    name: "Ainsley Fagerström",
    linkedinProfileUrl: "https://www.linkedin.com/in/ainsley-fagerstrom/",
    branch: "reply-accepted",
    branchLabel: "In conversation",
    primaryChannel: "linkedin",
    cadenceState: {
      status: "ready",
      currentStep: "direct-message",
      lastTouchOutcome: "sent",
      lastTouchAt: "2026-06-06T23:29:43.899Z",
      nextAction: "Wait for a LinkedIn reply before forcing a new branch.",
    },
    drafts: [{
      id: "draft-1",
      surface: "inbound_reply",
      channel: "linkedin",
      subject: null,
      body: "Thanks, Ainsley. Appreciate it. Send over a new time when you have one and I’ll make it work.",
      status: "sent",
      authoredBy: "agent",
      editedByOperator: false,
      approvedByOperator: false,
      createdAt: "2026-06-06T16:27:21.792Z",
      updatedAt: "2026-06-06T23:29:00.357Z",
      approvedAt: "2026-06-06T18:23:07.476Z",
      sentAt: "2026-06-06T23:29:00.357Z",
      notes: null,
    }],
    touches: [
      {
        surface: "inbound_reply",
        direction: "inbound",
        outcome: "replied",
        occurredAt: "2024-10-16T13:08:57.000Z",
        summary: "Ainsley Fagerström has unread LinkedIn message activity.",
        body: "Hey no worries at all!",
      },
      {
        surface: "inbound_reply",
        direction: "outbound",
        outcome: "sent",
        occurredAt: "2026-06-06T23:29:00.293Z",
        summary: "Sent send direct message for Ainsley Fagerström.",
      },
      {
        surface: "inbound_reply",
        direction: "outbound",
        outcome: "sent",
        occurredAt: "2026-06-06T23:29:43.899Z",
        summary: "Sent send direct message for Ainsley Fagerström.",
      },
    ],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Thanks, Ainsley\. Appreciate it\./);
  assert.doesNotMatch(html, /Sent send direct message for Ainsley Fagerström\./);
  assert.match(html, /Engagement timeline <span>2<\/span>/);
});

test("prospect timeline surfaces connected-state evidence from linked inbound observations", () => {
  const html = renderProspectDetailPage(buildProspect({
    name: "Matt Pierce",
    linkedinProfileUrl: "https://www.linkedin.com/in/mpiercekc/",
    branch: "connected",
    primaryChannel: "linkedin",
    channels: ["linkedin"],
    cadenceState: {
      status: "ready",
      currentStep: "direct-message",
    },
    threadMessages: [
      {
        id: "msg-1",
        direction: "outbound",
        sentAt: "2026-06-04T16:05:59.952Z",
        fromName: "You",
        fromHandle: null,
        body: "Hi Matt, quick question on who owns vendor relationships at Valet Living.",
      },
      {
        id: "msg-2",
        direction: "inbound",
        sentAt: "2026-06-04T20:27:55.273Z",
        fromName: "Matt Pierce",
        fromHandle: null,
        body: "That would probably be the CTO, Robert Cassagrande.",
      },
    ],
    timelineObservations: [
      {
        id: "obs-follow-matt",
        kind: "follower_confirmed",
        surfaceKey: "linkedin-followers-list",
        observedAt: "2026-06-05T16:20:00.000Z",
        eventAt: null,
        summary: "Matt Pierce is present in the LinkedIn follower list.",
        sourceUrl: "https://www.linkedin.com/mynetwork/network-manager/people-follow/followers/",
        threadUrl: null,
        notes: null,
      },
    ],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Connected on LinkedIn/);
  assert.match(html, /Already connected on LinkedIn\./);
  assert.match(html, /Matt Pierce is present in the LinkedIn follower list\./);
});

test("prospect timeline shows a connection request note from linked pending observations when no touch was written", () => {
  const html = renderProspectDetailPage(buildProspect({
    name: "Brad Rollin",
    linkedinProfileUrl: "https://www.linkedin.com/in/bradrollin/",
    branch: "connection-requested",
    primaryChannel: "linkedin",
    channels: ["linkedin"],
    timelineObservations: [
      {
        id: "obs-pending-brad",
        kind: "connection_request_pending",
        surfaceKey: "linkedin-sent-invitations",
        observedAt: "2026-05-15T10:43:42.626Z",
        eventAt: "2026-05-15T10:43:42.626Z",
        summary: "Brad Rollin is still pending on LinkedIn.",
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
        threadUrl: null,
        notes: "Short note with invite.",
      },
    ],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Connection request/);
  assert.match(html, /Short note with invite\./);
  assert.match(html, /tl-status-sent/);
});

test("prospect detail treats a pending invite observation as authoritative over a stale request draft", () => {
  const html = renderProspectDetailPage(buildProspect({
    name: "Abbas Aga",
    title: "Chief Executive Officer at Reluxe Collection",
    companyName: "Sleek Analytics",
    linkedinProfileUrl: "https://www.linkedin.com/in/abbas-aga/",
    branch: "identified",
    primaryChannel: "linkedin",
    channels: ["linkedin"],
    drafts: [{
      id: "draft-abbas-request",
      surface: "connection_request",
      channel: "linkedin",
      body: "Hi Abbas, saw the Sleek launch cadence this year and the June update around custom events, API, and payments. I like connecting with founders actively shipping GTM-heavy products.",
      status: "draft",
      authoredBy: "agent",
      createdAt: "2026-06-11T18:26:36.243Z",
      updatedAt: "2026-06-11T18:26:36.243Z",
      notes: null,
    }],
    timelineObservations: [{
      id: "obs-abbas-pending",
      kind: "connection_request_pending",
      surfaceKey: "linkedin-sent-invitations",
      observedAt: "2026-06-12T19:26:36.243Z",
      eventAt: "2026-06-08T14:52:52.348Z",
      summary: "Abbas Aga is still pending on LinkedIn.",
      sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
      threadUrl: null,
      notes: "LinkedIn still shows the sent connection request as pending.",
    }],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Wait on the pending request/);
  assert.doesNotMatch(html, /Send the first connection request/);
  assert.doesNotMatch(html, /Compose request/);
  assert.doesNotMatch(html, /Connection request note · Abbas Aga/);
  assert.match(html, /LinkedIn still shows the sent connection request as pending\./);
  assert.doesNotMatch(html, /Hi Abbas, saw the Sleek launch cadence/);
});

test("prospect detail keeps connected outreach available when a pending invite observation is only historical", () => {
  const html = renderProspectDetailPage(buildProspect({
    linkedinProfileUrl: "https://www.linkedin.com/in/lina-park/",
    branch: "connected",
    primaryChannel: "linkedin",
    channels: ["linkedin"],
    connectionDegree: 1,
    timelineObservations: [
      {
        id: "obs-pending-old",
        kind: "connection_request_pending",
        surfaceKey: "linkedin-sent-invitations",
        observedAt: "2026-06-01T10:00:00.000Z",
        eventAt: "2026-06-01T10:00:00.000Z",
        summary: "Lina Park was still pending on LinkedIn.",
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
        threadUrl: null,
        notes: "Older pending invite snapshot.",
      },
      {
        id: "obs-accepted-new",
        kind: "connection_request_accepted",
        surfaceKey: "linkedin-sent-invitations",
        observedAt: "2026-06-03T10:00:00.000Z",
        eventAt: "2026-06-03T10:00:00.000Z",
        summary: "Lina Park accepted the connection request.",
        sourceUrl: "https://www.linkedin.com/in/lina-park/",
        threadUrl: null,
        notes: null,
      },
    ],
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /Compose message/);
  assert.match(html, /First message · Lina Park/);
  assert.match(html, /Connected on LinkedIn/);
  assertCurrentPipelineStage(html, "Connected");
});

test("prospect detail caps a stale connected branch at request sent when LinkedIn still shows 2nd-degree", () => {
  const html = renderProspectDetailPage(buildProspect({
    linkedinProfileUrl: "https://www.linkedin.com/in/lina-park/",
    branch: "connected",
    primaryChannel: "linkedin",
    channels: ["linkedin"],
    connectionDegree: 2,
  }), {
    interactive: true,
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /LinkedIn shows a <strong>2nd-degree<\/strong> connection/);
  assert.match(html, /the request is <strong>not accepted yet<\/strong>/);
  assertCurrentPipelineStage(html, "Request sent");
  assert.match(html, /Wait on the pending request/);
});

test("prospects table renders clickable channel anchors with the underlying destination on hover", () => {
  const prospect = buildProspect({
    channels: [
      {
        key: "linkedin",
        label: "LinkedIn profile",
        value: "https://www.linkedin.com/in/lina-park/",
        href: "https://www.linkedin.com/in/lina-park/",
        openInNewTab: true,
      },
      {
        key: "email",
        label: "Email address",
        value: "lina.park@example.com",
        href: "mailto:lina.park@example.com",
        openInNewTab: false,
      },
    ],
  });

  const html = renderProspectsPage({
    counts: { prospects: 1, companies: 1 },
    all: [prospect],
    groups: [{
      companyId: prospect.companyId,
      companyName: prospect.companyName,
      industry: prospect.companyIndustry,
      motionName: prospect.motionName,
      companyLinkedinUrl: prospect.companyLinkedinUrl,
      prospects: [prospect],
    }],
    details: [prospect],
  }, {
    interactive: true,
  });

  assert.match(
    html,
    /href="https:\/\/www\.linkedin\.com\/in\/lina-park\/" target="_blank" rel="noopener noreferrer" title="https:\/\/www\.linkedin\.com\/in\/lina-park\/"/,
  );
  assert.match(
    html,
    /href="mailto:lina\.park@example\.com" title="lina\.park@example\.com"/,
  );
});

test("prospects page renders a real search form and preserves the active query in prospect links", () => {
  const prospect = buildProspect();
  const html = renderProspectsPage({
    counts: { prospects: 1, companies: 1 },
    search: {
      query: "lina",
      active: true,
      totalProspects: 3,
      totalCompanies: 2,
    },
    all: [prospect],
    groups: [{
      companyId: prospect.companyId,
      companyName: prospect.companyName,
      industry: prospect.companyIndustry,
      motionName: prospect.motionName,
      companyLinkedinUrl: prospect.companyLinkedinUrl,
      prospects: [prospect],
    }],
    details: [prospect],
  }, {
    interactive: true,
    searchQuery: "lina",
  });

  assert.match(html, /<form class="search-form" action="\/prospects" method="GET" role="search">/);
  assert.match(html, /<input class="search-input" type="search" name="q" value="lina"/);
  assert.match(html, /href="\/prospects\/prospect-1\?q=lina"/);
  assert.match(html, /href="\/prospects">Clear<\/a>/);
});

test("prospect detail preserves the search query on the back link", () => {
  const html = renderProspectDetailPage(buildProspect(), {
    interactive: true,
    searchQuery: "lina",
    userId: "user-1",
    transitionMotionId: "motion-1",
    users: [{ id: "user-1", label: "william-main" }],
    motions: [],
  });

  assert.match(html, /href="\/prospects\?q=lina"/);
});
