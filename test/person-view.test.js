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
  assert.equal(person?.composeDraft?.body, "");
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
  assert.doesNotMatch(html, /Thanks for sending this over\.|Thanks for the note\./);
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

test("buildPersonView uses the actual viewed time for LinkedIn profile-view observations", () => {
  const person = buildPersonView({
    observationId: "view-1",
    rawObservations: [
      rawObservation({
        id: "view-1",
        dedupeKey: "view-1",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-profile-views",
        kind: "profile_view_received",
        observedAt: "2026-06-04T16:20:00.000Z",
        recordedAt: "2026-06-04T16:20:00.000Z",
        eventAt: null,
        actorName: "Nina Prospect",
        actorTitle: "Director of Demand Generation",
        actorCompanyName: "BuyerCo",
        actorHandle: "nina-prospect",
        actorProfileUrl: "https://www.linkedin.com/in/nina-prospect/",
        actorLinkedinPublicId: "nina-prospect",
        actorLinkedinMemberId: "member-nina",
        sourceUrl: "https://www.linkedin.com/analytics/profile-views/",
        subject: null,
        summary: "Nina Prospect appeared in your LinkedIn profile viewers. Viewed 2mo ago.",
        notes: null,
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  assert.ok(person);
  assert.equal(person?.firstSeen, "2026-04-05T16:20:00.000Z");
  assert.equal(person?.lastSeen, "2026-04-05T16:20:00.000Z");
  assert.equal(person?.timeline[0]?.observedAt, "2026-04-05T16:20:00.000Z");
});

test("renderPersonPage distinguishes follower and profile-view signals without treating them as connection truth", () => {
  const person = buildPersonView({
    observationId: "view-follow-1",
    rawObservations: [
      rawObservation({
        id: "view-follow-1",
        dedupeKey: "view-follow-1",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-profile-views",
        kind: "profile_view_received",
        observedAt: "2026-06-04T16:20:00.000Z",
        recordedAt: "2026-06-04T16:20:00.000Z",
        eventAt: null,
        actorName: "Muhammad Haseeb",
        actorTitle: "Founder of KARITIX | Helping SaaS Companies to Scale with Marketing That Performs",
        actorCompanyName: null,
        actorHandle: "muhammad-haseeb",
        actorProfileUrl: "https://www.linkedin.com/in/muhammad-haseeb/",
        actorLinkedinPublicId: "muhammad-haseeb",
        actorLinkedinMemberId: "member-muhammad",
        sourceUrl: "https://www.linkedin.com/analytics/profile-views/",
        summary: "Muhammad Haseeb appeared in your LinkedIn profile viewers. Viewed 3w ago.",
        notes: "LinkedIn viewer label: 1st",
        messages: [],
      }),
      rawObservation({
        id: "follow-1",
        dedupeKey: "follow-1",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-followers-list",
        kind: "follower_added",
        observedAt: "2026-06-05T16:20:00.000Z",
        recordedAt: "2026-06-05T16:20:00.000Z",
        eventAt: null,
        actorName: "Muhammad Haseeb",
        actorTitle: "Founder of KARITIX | Helping SaaS Companies to Scale with Marketing That Performs",
        actorCompanyName: null,
        actorHandle: "muhammad-haseeb",
        actorProfileUrl: "https://www.linkedin.com/in/muhammad-haseeb/",
        actorLinkedinPublicId: "muhammad-haseeb",
        actorLinkedinMemberId: "member-muhammad",
        sourceUrl: "https://www.linkedin.com/mynetwork/network-manager/people-follow/followers/",
        summary: "Muhammad Haseeb is present in the LinkedIn follower list.",
        notes: null,
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.match(html, /They follow you/);
  assert.match(html, /Profile view/);
  assert.match(html, /KARITIX/);
  assert.match(html, /Draft connection note/);
  assert.doesNotMatch(html, /They showed interest/);
});

test("renderPersonPage keeps invitation identity context compact instead of repeating fact cards", () => {
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

  assert.match(html, /Helping B2B Businesses to Generate Leads/);
  assert.match(html, /Company not captured yet/);
  assert.match(html, /Global intake/);
  assert.match(html, /1 observation across 1 source/);
  assert.doesNotMatch(html, /Title\/headline/);
  assert.match(html, /No invitation note was included with this request\./);
});

test("renderPersonPage exposes accept and reject actions for inbound LinkedIn invites", () => {
  const person = buildPersonView({
    observationId: "invite-actions",
    rawObservations: [
      rawObservation({
        id: "invite-actions",
        dedupeKey: "invite-actions",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-received-invitations",
        kind: "connection_request_received",
        actorName: "Rizwan I.",
        actorTitle: "Business Developer",
        actorCompanyName: "Integriti",
        actorHandle: "rizwan-i",
        actorProfileUrl: "https://www.linkedin.com/in/rizwan-i/",
        actorLinkedinPublicId: "rizwan-i",
        actorLinkedinMemberId: "member-rizwan",
        threadUrl: null,
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
        subject: null,
        summary: "Rizwan I. sent a new inbound LinkedIn connection request.",
        notes: null,
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.match(html, /Accept or decline the invite/);
  assert.match(html, /data-exo-writer="recordInboundObservation"/);
  assert.match(html, /nextKind&quot;:&quot;connection_request_accepted&quot;/);
  assert.match(html, /nextKind&quot;:&quot;connection_request_decline_requested&quot;/);
  assert.match(html, />Accept</);
  assert.match(html, />Reject</);
  assert.match(html, /data-exo-return="1"/);
});

test("buildPersonView merges same-person LinkedIn observations across surfaces and prefers the human public profile", () => {
  const person = buildPersonView({
    observationId: "invite-brad",
    rawObservations: [
      rawObservation({
        id: "invite-brad",
        dedupeKey: "invite-brad",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-sent-invitations",
        kind: "connection_request_pending",
        observedAt: "2026-05-15T10:43:42.626Z",
        eventAt: "2026-05-15T10:43:42.626Z",
        actorName: "Brad Rollin",
        actorTitle: "Vice President, Field Marketing and Demand Generation, North America",
        actorCompanyName: null,
        actorHandle: "bradrollin",
        actorProfileUrl: "https://www.linkedin.com/in/bradrollin/",
        actorLinkedinPublicId: "bradrollin",
        actorLinkedinMemberId: "urn:li:member:10469049",
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
        summary: "Brad Rollin is still pending on LinkedIn.",
        notes: null,
        messages: [],
      }),
      rawObservation({
        id: "follow-brad",
        dedupeKey: "follow-brad",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-following-list",
        kind: "follow_state_confirmed",
        observedAt: "2026-06-05T11:50:25.141Z",
        actorName: "Brad Rollin",
        actorTitle: "Vice President, Field Marketing and Demand Generation, North America",
        actorCompanyName: null,
        actorHandle: "ACoAAACfvrkBzOInq5OtCT377ye-A7e3AUoLH84",
        actorProfileUrl: "https://www.linkedin.com/in/ACoAAACfvrkBzOInq5OtCT377ye-A7e3AUoLH84",
        actorLinkedinPublicId: "ACoAAACfvrkBzOInq5OtCT377ye-A7e3AUoLH84",
        actorLinkedinMemberId: "urn:li:member:10469049",
        actorAvatarUrl: "https://example.com/brad.jpg",
        sourceUrl: "https://www.linkedin.com/in/ACoAAACfvrkBzOInq5OtCT377ye-A7e3AUoLH84",
        summary: "Brad Rollin is still present in the LinkedIn following list.",
        notes: null,
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  assert.ok(person);
  assert.equal(person?.counts.observations, 2);
  assert.equal(person?.identity.publicId, "bradrollin");
  assert.equal(person?.identity.linkedinUrl, "https://www.linkedin.com/in/bradrollin/");
  assert.equal(person?.identity.avatarUrl, "https://example.com/brad.jpg");
});

test("renderPersonPage treats a pending sent invite as waiting state, not a compose decision", () => {
  const observedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const sentLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(observedAt));
  const person = buildPersonView({
    observationId: "pending-invite",
    rawObservations: [
      rawObservation({
        id: "pending-invite",
        dedupeKey: "pending-invite",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-sent-invitations",
        kind: "connection_request_pending",
        observedAt,
        eventAt: observedAt,
        actorName: "Brad Rollin",
        actorTitle: "Vice President, Field Marketing and Demand Generation, North America",
        actorCompanyName: null,
        actorHandle: "bradrollin",
        actorProfileUrl: "https://www.linkedin.com/in/bradrollin/",
        actorLinkedinPublicId: "bradrollin",
        actorLinkedinMemberId: "member-brad",
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
        summary: "Brad Rollin is still pending on LinkedIn.",
        notes: "Short note with invite.",
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  assert.ok(person);
  assert.equal(person?.suggestedSurface, null);
  assert.equal(person?.connection?.key, "invite-sent");

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.match(html, /No decision is needed while it is still pending\./);
  assert.match(html, new RegExp(`Sent ${sentLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
  assert.match(html, /Claim it only if you want to attach it to a workspace before it accepts\./);
  assert.match(html, /Workspace/);
  assert.match(html, /Global intake/);
  assert.match(html, /Short note with invite\./);
  assert.match(html, /data-exo-writer="promoteInboundPerson"/);
  assert.doesNotMatch(html, /class="exo-action" data-exo-writer="promoteInboundPerson"/);
  assert.doesNotMatch(html, /Send — add &amp; queue/);
});

test("renderPersonPage exposes a motion picker when the workspace has multiple claim destinations", () => {
  const observedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const person = buildPersonView({
    observationId: "pending-invite-multi-motion",
    rawObservations: [
      rawObservation({
        id: "pending-invite-multi-motion",
        dedupeKey: "pending-invite-multi-motion",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-sent-invitations",
        kind: "connection_request_pending",
        observedAt,
        eventAt: observedAt,
        actorName: "Mona Motion",
        actorTitle: "VP Revenue",
        actorCompanyName: "Motion Co",
        actorHandle: "mona-motion",
        actorProfileUrl: "https://www.linkedin.com/in/mona-motion/",
        actorLinkedinPublicId: "mona-motion",
        actorLinkedinMemberId: "member-mona",
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
        summary: "Mona Motion is still pending on LinkedIn.",
        notes: "Invite note for the motion chooser.",
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  const html = renderPersonPage(person, {
    interactive: true,
    userId: "user-1",
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

  assert.match(html, /data-exo-writer="claimInboundPersonToMotion"/);
  assert.match(html, /Destination motion/);
  assert.match(html, /Status/);
  assert.match(html, /Active/);
  assert.match(html, /Draft/);
  assert.match(html, /Paused/);
  assert.match(html, /Transition backlog/);
  assert.match(html, /Knit/);
  assert.match(html, /Offer/);
  assert.match(html, /Premise/);
  assert.match(html, /governed outbound work instead of a pile of disconnected prospecting tasks/);
  assert.match(html, /harsh-spare-mongoose/);
  assert.match(html, /rational-coarse-wren/);
  assert.doesNotMatch(html, /data-exo-writer="promoteInboundPerson"/);
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

  assert.match(html, /1 observation across 1 source/);
  assert.doesNotMatch(html, /Surfaces/);
  assert.doesNotMatch(html, /LinkedIn contact/);
  assert.match(html, /Nassau Street Partners/);
  assert.equal(person?.connection?.label, "LinkedIn message · they messaged you");
  assert.equal(person?.composeDraft?.body, "");
  assert.match(html, /LinkedIn message · they messaged you/);
  assert.doesNotMatch(html, /they replied/);
  assert.doesNotMatch(html, /Saw your note\. Thanks for reaching out\./);
});

test("renderPersonPage collapses redundant status chrome on active reply pages", () => {
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

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.match(html, /Next move/);
  assert.match(html, /class="next-alert"/);
  assert.match(html, /Reply to Matt/);
  assert.match(html, /Connected · they replied/);
  assert.doesNotMatch(html, /Status &amp; next move/);
  assert.doesNotMatch(html, /LinkedIn contact/);
  assert.doesNotMatch(html, /Title\/headline/);
  assert.doesNotMatch(html, /<em>Observations<\/em>/);
  assert.doesNotMatch(html, /<em>Sources<\/em>/);
  assert.match(html, /1 observation across 1 source/);
  assert.doesNotMatch(html, /status-thread-preview/);
  assert.doesNotMatch(html, /signal-card pd-signal pd-next-card/);
});

test("renderPersonPage says when a follower is already connected on LinkedIn", () => {
  const person = buildPersonView({
    observationId: "linkedin-reply-follower",
    rawObservations: [
      rawObservation({
        id: "linkedin-reply-follower",
        dedupeKey: "linkedin-reply-follower",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-messaging-inbox",
        kind: "inbound_reply_received",
        actorName: "Matt Pierce",
        actorTitle: "Business Intelligence, Revenue Operations, and Business Transformation Professional",
        actorCompanyName: "Valet Living",
        actorHandle: "mpiercekc",
        actorProfileUrl: "https://www.linkedin.com/in/mpiercekc/",
        actorLinkedinPublicId: "mpiercekc",
        actorLinkedinMemberId: "member-matt",
        threadUrl: "https://www.linkedin.com/messaging/thread/example/",
        sourceUrl: "https://www.linkedin.com/messaging/thread/example/",
        summary: "Matt Pierce has unread LinkedIn message activity.",
        messages: [
          {
            id: "msg-matt-outbound",
            direction: "outbound",
            sentAt: "2026-06-04T16:05:59.952Z",
            fromName: "You",
            fromHandle: null,
            body: "Who in your organization deals with external vendors that are critical to your business operations?",
          },
          {
            id: "msg-matt-inbound",
            direction: "inbound",
            sentAt: "2026-06-04T20:27:55.273Z",
            fromName: "Matt Pierce",
            fromHandle: null,
            body: "Hey - at Valet Living, it would probably be the CTO, Robert Cassagrande.",
          },
        ],
      }),
      rawObservation({
        id: "linkedin-follower-matt",
        dedupeKey: "linkedin-follower-matt",
        capability: "linkedin",
        platform: "linkedin",
        surfaceKey: "linkedin-followers-list",
        kind: "follower_confirmed",
        observedAt: "2026-06-05T16:20:00.000Z",
        recordedAt: "2026-06-05T16:20:00.000Z",
        eventAt: null,
        actorName: "Matt Pierce",
        actorTitle: "Business Intelligence, Revenue Operations, and Business Transformation Professional",
        actorCompanyName: "Valet Living",
        actorHandle: "mpiercekc",
        actorProfileUrl: "https://www.linkedin.com/in/mpiercekc/",
        actorLinkedinPublicId: "mpiercekc",
        actorLinkedinMemberId: "member-matt",
        sourceUrl: "https://www.linkedin.com/mynetwork/network-manager/people-follow/followers/",
        summary: "Matt Pierce is present in the LinkedIn follower list.",
        notes: null,
        messages: [],
      }),
    ],
    rawMotions: [],
  });

  const html = renderPersonPage(person, { interactive: true, userId: "user-1" });

  assert.match(html, /Connected · they replied/);
  assert.match(html, /Matt Pierce is present in the LinkedIn follower list\./);
  assert.match(html, /Already connected on LinkedIn\./);
});

test("buildPersonView leaves the inbound compose body empty until the live writer fills it", () => {
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
  assert.equal(person?.composeDraft?.body, "");
  assert.doesNotMatch(person?.composeDraft?.body ?? "", /Saw your note\. Thanks for reaching out\.|Thanks for the note\./);
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
  assert.equal(person?.connection?.label, "Connected · they replied");
  assert.equal(person?.composeDraft?.body, "");
  assert.doesNotMatch(person?.composeDraft?.body ?? "", /We're going to pass on this one|Thanks for the note\./i);
});

test("renderPersonPage links the canonical company when the inbound person resolves by canonical company name", () => {
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
