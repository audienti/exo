// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { renderPersonPage } from "../src/artifacts/render-person.js";
import { buildPersonView } from "../src/core/build-person-view.js";

function rawObservation(overrides = {}) {
  return {
    id: "obs-1",
    dedupeKey: "obs-1",
    userId: "user-1",
    accountId: "account-1",
    capability: "gmail",
    platform: "gmail",
    surfaceKey: "gmail-inbox-threads",
    kind: "email_reply_received",
    truthLevel: "authoritative",
    observedAt: "2026-06-04T16:20:00.000Z",
    recordedAt: "2026-06-04T16:20:00.000Z",
    eventAt: null,
    externalId: "thread-1",
    actorName: "Lina Park",
    actorTitle: "Procurement Support Department",
    actorCompanyName: "GovPointe Office",
    actorHandle: "lpark@govpointeoffice.us",
    actorProfileUrl: null,
    actorLinkedinPublicId: null,
    actorLinkedinMemberId: null,
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-1",
    sourceUrl: "https://mail.google.com/mail/u/0/#inbox/thread-1",
    subject: "Re: Halfmoon Hillcrest Fire Dept. RFP",
    summary: "Repeated follow-up on a public-safety recruitment and website RFP.",
    motionId: null,
    companyId: null,
    prospectId: null,
    notes: "Subject: Re: Halfmoon Hillcrest Fire Dept. RFP\n\nExternal follow-up thread. Opportunity claims base year $75k-$150k and four-year total $200k-$375k. No reply from William visible in this thread.",
    messages: [
      {
        id: "msg-1",
        direction: "outbound",
        sentAt: "2026-06-04T15:55:00.000Z",
        fromName: "William Flanagan",
        fromHandle: "william@example.com",
        body: "Could you send over the current RFP details?",
      },
      {
        id: "msg-2",
        direction: "inbound",
        sentAt: "2026-06-04T16:18:00.000Z",
        fromName: "Lina Park",
        fromHandle: "lpark@govpointeoffice.us",
        body: "External follow-up thread. Opportunity claims base year $75k-$150k and four-year total $200k-$375k. No reply from William visible in this thread.",
      },
    ],
    ...overrides,
  };
}

test("buildPersonView lifts stored thread messages into the latest inbound message context", () => {
  const person = buildPersonView({
    observationId: "obs-1",
    rawObservations: [rawObservation()],
    rawMotions: [],
  });

  assert.ok(person);
  assert.equal(person?.latestMessage?.surfaceLabel, "Email reply");
  assert.equal(person?.latestMessage?.subject, "Re: Halfmoon Hillcrest Fire Dept. RFP");
  assert.match(person?.latestMessage?.detail ?? "", /External follow-up thread/i);
  assert.equal(person?.latestMessage?.direction, "inbound");
  assert.equal(person?.timeline[0]?.detail, "External follow-up thread. Opportunity claims base year $75k-$150k and four-year total $200k-$375k. No reply from William visible in this thread.");
  assert.equal(person?.timeline[1]?.direction, "outbound");
  assert.equal(person?.timeline[0]?.isMessage, true);
  assert.equal(person?.connection?.label, "In conversation · they replied");
  assert.equal(person?.composeDraft?.subject, "Re: Halfmoon Hillcrest Fire Dept. RFP");
  assert.match(person?.composeDraft?.body ?? "", /We're going to pass on this one/i);
});

test("renderPersonPage shows the actual inbound message context in status and timeline", () => {
  const person = buildPersonView({
    observationId: "obs-1",
    rawObservations: [rawObservation()],
    rawMotions: [],
  });

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.doesNotMatch(html, /What you&#39;re replying to|What you're replying to/);
  assert.match(html, /Email reply|Email thread/);
  assert.match(html, /Re: Halfmoon Hillcrest Fire Dept\. RFP/);
  assert.match(html, /External follow-up thread\./);
  assert.match(html, /Could you send over the current RFP details\?/);
  assert.match(html, /Received/);
  assert.match(html, /Sent/);
  assert.match(html, /Open thread/);
  assert.match(html, /tl-message/);
  assert.match(html, /Ignore sender/);
  assert.match(html, /data-exo-writer="ignoreInboundObservation"/);
  assert.doesNotMatch(html, /class="exo-action" data-exo-writer="ignoreInboundObservation"/);
  assert.match(html, /Thanks for sending this over\./);
});

test("renderPersonPage suppresses the duplicate status preview for one- and two-message threads", () => {
  const person = buildPersonView({
    observationId: "obs-1",
    rawObservations: [rawObservation()],
    rawMotions: [],
  });

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.doesNotMatch(html, /status-thread-preview/);
});

test("renderPersonPage blocks promote-and-queue when the inbound identity is still a placeholder", () => {
  const person = buildPersonView({
    observationId: "obs-unknown",
    rawObservations: [
      rawObservation({
        id: "obs-unknown",
        dedupeKey: "obs-unknown",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-messaging-inbox",
        kind: "message_received",
        actorName: "Unknown LinkedIn user",
        actorTitle: null,
        actorCompanyName: null,
        actorHandle: null,
        actorProfileUrl: null,
        actorLinkedinPublicId: null,
        threadUrl: "https://www.linkedin.com/messaging/thread/example/",
        sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
        subject: null,
        summary: "Unknown LinkedIn user has unread LinkedIn message activity.",
        notes: null,
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  assert.ok(person);
  assert.equal(person?.hasDurableIdentity, false);

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.match(html, /does not have a durable identity for this contact yet/i);
  assert.match(html, /Do not create a tracked prospect from a placeholder identity\./i);
  assert.match(html, />Open thread</);
  assert.match(html, /Ignore sender/);
  assert.doesNotMatch(html, /Send — add &amp; queue/);
  assert.doesNotMatch(html, />Add to motion</);
});

test("buildPersonView treats a received LinkedIn invitation note as inbound message history", () => {
  const note = "Would love to connect about public-sector procurement workflows.";
  const person = buildPersonView({
    observationId: "invite-1",
    rawObservations: [
      rawObservation({
        id: "invite-1",
        dedupeKey: "invite-1",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-received-invitations",
        kind: "connection_request_received",
        actorName: "Manju Pal",
        actorTitle: "Helping B2B Businesses to Generate Leads",
        actorCompanyName: null,
        actorHandle: "manju-pal-b324a622a",
        actorProfileUrl: "https://www.linkedin.com/in/manju-pal-b324a622a/",
        actorLinkedinPublicId: "manju-pal-b324a622a",
        actorLinkedinMemberId: "member-1",
        threadUrl: null,
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
        subject: null,
        summary: "Manju Pal sent a new inbound LinkedIn connection request.",
        notes: note,
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  assert.ok(person);
  assert.equal(person?.latestMessage?.surfaceLabel, "Received invitation");
  assert.equal(person?.latestMessage?.detail, note);
  assert.equal(person?.latestMessage?.direction, "inbound");
  assert.equal(person?.timeline[0]?.isMessage, true);
});

test("renderPersonPage shows explicit title and company facts for received LinkedIn invitations", () => {
  const person = buildPersonView({
    observationId: "invite-unknown-company",
    rawObservations: [
      rawObservation({
        id: "invite-unknown-company",
        dedupeKey: "invite-unknown-company",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-received-invitations",
        kind: "connection_request_received",
        actorName: "Manju Pal",
        actorTitle: "Helping B2B Businesses to Generate Leads",
        actorCompanyName: null,
        actorHandle: "manju-pal-b324a622a",
        actorProfileUrl: "https://www.linkedin.com/in/manju-pal-b324a622a/",
        actorLinkedinPublicId: "manju-pal-b324a622a",
        actorLinkedinMemberId: "member-1",
        threadUrl: null,
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
        subject: null,
        summary: "Manju Pal sent a new inbound LinkedIn connection request.",
        notes: null,
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.match(html, /Title\/headline/);
  assert.match(html, /Helping B2B Businesses to Generate Leads/);
  assert.match(html, /Company/);
  assert.match(html, /Unknown company/);
  assert.match(html, /No invitation note was included with this request\./);
});

test("renderPersonPage derives company from a LinkedIn headline and avoids the surfaces label", () => {
  const person = buildPersonView({
    observationId: "linkedin-reply-1",
    rawObservations: [
      rawObservation({
        id: "linkedin-reply-1",
        dedupeKey: "linkedin-reply-1",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-messaging-inbox",
        kind: "inbound_reply_received",
        actorName: "Zoe Jupp",
        actorTitle: "Head of Strategic Partnerships @ Nassau Street Partners | Bachelor of Psychological Science",
        actorCompanyName: null,
        actorHandle: "zoe-jupp",
        actorProfileUrl: "https://www.linkedin.com/in/zoe-jupp/",
        actorLinkedinPublicId: "zoe-jupp",
        actorLinkedinMemberId: "member-zoe",
        threadUrl: "https://www.linkedin.com/messaging/thread/example/",
        sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
        subject: "Strategic partnership fit",
        summary: "Zoe Jupp has unread LinkedIn message activity.",
        notes: "LinkedIn thread subject: Strategic partnership fit",
        messages: [
          {
            id: "msg-zoe-1",
            direction: "inbound",
            sentAt: "2026-06-04T16:18:00.000Z",
            fromName: "Zoe Jupp",
            fromHandle: null,
            body: "Would be good to compare notes on partnerships.",
          },
        ],
      }),
    ],
    rawMotions: [],
  });

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.match(html, /Sources/);
  assert.doesNotMatch(html, /Surfaces/);
  assert.match(html, /Nassau Street Partners/);
  assert.equal(person?.connection?.label, "Inbound message · they messaged you");
  assert.equal(person?.composeDraft?.body, "Happy to compare notes on partnerships.");
  assert.match(html, /Inbound message · they messaged you/);
  assert.doesNotMatch(html, /they replied/);
  assert.doesNotMatch(html, /Saw your note\. Thanks for reaching out\./);
});

test("buildPersonView uses a short neutral fallback when LinkedIn context is generic", () => {
  const person = buildPersonView({
    observationId: "linkedin-reply-generic",
    rawObservations: [
      rawObservation({
        id: "linkedin-reply-generic",
        dedupeKey: "linkedin-reply-generic",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-messaging-inbox",
        kind: "message_received",
        actorName: "Avery Generic",
        actorTitle: "Founder",
        actorCompanyName: "Signal Foundry",
        actorHandle: "avery-generic",
        actorProfileUrl: "https://www.linkedin.com/in/avery-generic/",
        actorLinkedinPublicId: "avery-generic",
        actorLinkedinMemberId: "member-avery",
        threadUrl: "https://www.linkedin.com/messaging/thread/example/",
        sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
        subject: null,
        summary: "Avery Generic has unread LinkedIn message activity.",
        notes: null,
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  assert.ok(person);
  assert.equal(person?.composeDraft?.body, "Thanks for the note.");
  assert.doesNotMatch(person?.composeDraft?.body ?? "", /Saw your note\. Thanks for reaching out\./);
});

test("buildPersonView does not misclassify an active LinkedIn reply as a cold solicitation", () => {
  const person = buildPersonView({
    observationId: "linkedin-reply-vendor",
    rawObservations: [
      rawObservation({
        id: "linkedin-reply-vendor",
        dedupeKey: "linkedin-reply-vendor",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-messaging-inbox",
        kind: "inbound_reply_received",
        actorName: "Matt Pierce",
        actorTitle: "Business Intelligence, Revenue Operations, and Business Transformation Professional",
        actorCompanyName: null,
        actorHandle: "mpiercekc",
        actorProfileUrl: "https://www.linkedin.com/in/mpiercekc/",
        actorLinkedinPublicId: "mpiercekc",
        actorLinkedinMemberId: "member-matt",
        threadUrl: "https://www.linkedin.com/messaging/thread/example/",
        sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
        summary: "Matt Pierce has unread LinkedIn message activity.",
        messages: [
          {
            id: "msg-matt-1",
            direction: "outbound",
            sentAt: "2026-06-04T16:05:59.952Z",
            fromName: "You",
            fromHandle: null,
            body: "Who in your organization deals with external vendors that are critical to your business operations?",
          },
          {
            id: "msg-matt-2",
            direction: "inbound",
            sentAt: "2026-06-04T20:27:55.273Z",
            fromName: "Matt Pierce",
            fromHandle: null,
            body: "Hey - at Valet Living, it would probably be the CTO, Robert Cassagrande. I'm new to the company, so don't really know him, but he likely manages outsourced vendor relationships.",
          },
        ],
      }),
    ],
    rawMotions: [],
  });

  assert.ok(person);
  assert.equal(person?.connection?.label, "In conversation · they replied");
  assert.equal(person?.composeDraft?.body, "Thanks for the note.");
  assert.doesNotMatch(person?.composeDraft?.body ?? "", /We're going to pass on this one/i);
});

test("renderPersonPage links the canonical company when the inbound person is resolved to one", () => {
  const person = buildPersonView({
    observationId: "linkedin-reply-company-linked",
    rawObservations: [
      rawObservation({
        id: "linkedin-reply-company-linked",
        dedupeKey: "linkedin-reply-company-linked",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-messaging-inbox",
        kind: "inbound_reply_received",
        actorName: "Pawan Choudhary",
        actorTitle: "Founder & CEO @ LeadsCampaign",
        actorCompanyName: "LeadsCampaign",
        actorHandle: "pawanchoudharyy",
        actorProfileUrl: "https://www.linkedin.com/in/pawanchoudharyy/",
        actorLinkedinPublicId: "pawanchoudharyy",
        actorLinkedinMemberId: "member-pawan",
        companyId: "company-leadscampaign",
        threadUrl: "https://www.linkedin.com/messaging/thread/example/",
        sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
        summary: "Pawan Choudhary has unread LinkedIn message activity.",
        messages: [
          {
            id: "msg-pawan-1",
            direction: "inbound",
            sentAt: "2026-06-04T16:18:00.000Z",
            fromName: "Pawan Choudhary",
            fromHandle: null,
            body: "Would you like me to get started?",
          },
        ],
      }),
    ],
    rawMotions: [],
    rawCompanies: [
      {
        id: "company-leadscampaign",
        createdAt: "2026-06-04T16:00:00.000Z",
        updatedAt: "2026-06-04T16:00:00.000Z",
        name: "LeadsCampaign",
        domain: null,
        websiteUrl: null,
        linkedinCompanyUrl: null,
        logoSourceUrl: null,
        logoUrl: null,
        notes: null,
        tags: [],
        motionIds: [],
        engagementProfileAssignment: null,
        engagementUserAssignment: null,
      },
    ],
  });

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.match(html, /LeadsCampaign/);
  assert.match(html, /href="\/companies\/company-leadscampaign"/);
});
