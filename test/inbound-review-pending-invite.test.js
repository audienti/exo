// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildInboundReviewView } from "../src/core/build-inbound-review-view.js";

const rawUser = {
  id: "user-1",
  createdAt: "2026-06-04T16:00:00.000Z",
  updatedAt: "2026-06-04T16:00:00.000Z",
  label: "william-main",
};

test("unclaimed pending sent invites stay in waiting instead of escalating to needs_claim", () => {
  const observation = {
    id: "obs-pending",
    dedupeKey: "obs-pending",
    userId: "user-1",
    accountId: "account-1",
    capability: "linkedin",
    platform: "linkedin",
    surfaceKey: "linkedin-sent-invitations",
    kind: "connection_request_pending",
    truthLevel: "authoritative",
    observedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    recordedAt: new Date().toISOString(),
    eventAt: null,
    externalId: "invite-1",
    actorName: "Brad Rollin",
    actorTitle: "Vice President, Field Marketing and Demand Generation, North America",
    actorCompanyName: null,
    actorHandle: "bradrollin",
    actorProfileUrl: "https://www.linkedin.com/in/bradrollin/",
    actorLinkedinPublicId: "bradrollin",
    actorLinkedinMemberId: "member-brad",
    actorAvatarSourceUrl: null,
    actorAvatarUrl: null,
    threadUrl: null,
    sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
    subject: null,
    summary: "Brad Rollin is still pending on LinkedIn.",
    motionId: null,
    companyId: null,
    prospectId: null,
    notes: null,
    messages: [],
  };

  const review = buildInboundReviewView(rawUser, [observation], [], []);
  const item = review.reviewItems[0];

  assert.equal(item.state, "waiting");
  assert.equal(item.category, "sent_invite");
  assert.deepEqual(item.decisionOptions, ["wait"]);
  assert.match(item.recommendedAction, /keep brad rollin's connection request patient for now/i);
});
