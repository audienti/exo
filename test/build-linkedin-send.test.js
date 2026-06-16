// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildLinkedinSendHandoff } from "../src/core/build-linkedin-send.js";
import {
  buildCompanyView,
  buildExecutionUser,
  buildMotionView,
  buildProspect,
  buildTargetAccount,
  fixtureNow,
} from "./support/normalized-fixtures.js";

test("buildLinkedinSendHandoff accepts persisted public-engagement selections stored with url", () => {
  const prospect = buildProspect({
    id: "prospect-1",
    name: "Amit Grover",
    title: "Sr. Director - Procurement",
    linkedinProfileUrl: "https://in.linkedin.com/in/amit-grover-0a407a24a",
    profileViewedAt: fixtureNow,
    linkedinProfileSnapshot: {
      capturedAt: fixtureNow,
      profileUrl: "https://in.linkedin.com/in/amit-grover-0a407a24a",
      recentPosts: [],
    },
    publicEngagementSelection: {
      url: "https://www.linkedin.com/posts/aramex-australia_aramexau30-employer-activity-7132480227909218304-nyg0",
      targetKind: "comment",
      activityType: "comment",
      postedAt: null,
      freshnessBand: "stale",
      summary: "Commented on an Aramex Australia post asking for an email contact.",
      snippet: "Asked for an email contact.",
      businessRelevance: "moderate",
      recommendedAction: "reaction",
      rationale: "The comment supports procurement relevance but is stale.",
      selectionReason: "This comment is clearly work-relevant, so Exo should tee up a checked in-thread reply.",
      selectedAt: fixtureNow,
    },
  });
  const motion = buildMotionView({
    id: "motion-1",
    name: "Motion",
    targetMap: {
      status: "pending",
      accounts: [
        buildTargetAccount({
          companyId: "company-1",
          companyName: "Coforge",
          prospects: [prospect],
        }),
      ],
      segments: [],
    },
  });
  const company = buildCompanyView({
    id: "company-1",
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
    name: "Coforge",
    domain: "coforge.com",
    websiteUrl: "https://www.coforge.com",
    linkedinCompanyUrl: "https://www.linkedin.com/company/coforge-tech",
    motionIds: ["motion-1"],
    engagementUserAssignment: {
      userId: "user-1",
      label: "Operator",
      owner: "operator",
      accountRefs: ["linkedin:operator-linkedin"],
      assignedAt: fixtureNow,
      assignedBy: "test",
      reason: "Use governed connector",
      sticky: true,
    },
  });
  const users = [
    buildExecutionUser("user-1", {
      label: "Operator",
      owner: "operator",
      accounts: [
        {
          id: "account-1",
          createdAt: fixtureNow,
          updatedAt: fixtureNow,
          capability: "linkedin",
          handle: "operator-linkedin",
          label: null,
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "hc-1",
          providerAccountId: "provider-1",
          preferred: true,
          notes: null,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: 125,
              messages: null,
            },
          },
          metadata: null,
          inboundSync: {
            surfaces: [],
          },
        },
      ],
      harnessConnections: [
        {
          id: "hc-1",
          createdAt: fixtureNow,
          updatedAt: fixtureNow,
          runtime: "codex",
          connector: "unipile",
          label: "Codex Unipile",
          status: "available",
          notes: null,
        },
      ],
    }),
  ];

  const handoff = buildLinkedinSendHandoff(company, motion, [], users, {
    prospectId: "prospect-1",
    surface: "create_comment_reaction",
    runtime: "codex",
    branches: [],
    now: fixtureNow,
  });

  assert.equal(handoff.status, "ready");
  assert.equal(handoff.action, "create_comment_reaction");
  assert.equal(
    handoff.publicTarget?.url,
    "https://www.linkedin.com/posts/aramex-australia_aramexau30-employer-activity-7132480227909218304-nyg0",
  );
  assert.equal(handoff.publicTarget?.snippet, "Asked for an email contact.");
});

test("buildLinkedinSendHandoff exposes deterministic Unipile send identifiers for connection requests", () => {
  const prospect = buildProspect({
    id: "prospect-connection-1",
    name: "Jordan Example",
    title: "VP Revenue Operations",
    linkedinProfileUrl: "https://www.linkedin.com/in/jordan-example/",
    profileViewedAt: fixtureNow,
    linkedinProfileSnapshot: {
      capturedAt: fixtureNow,
      profileUrl: "https://www.linkedin.com/in/jordan-example/",
      publicId: "jordan-example",
      memberId: "provider-jordan",
      recentPosts: [],
    },
    drafts: [
      {
        id: "draft-connection-1",
        surface: "connection_request",
        channel: "linkedin",
        subject: null,
        body: "Jordan, worth connecting given your RevOps work.",
        status: "approved",
        authoredBy: "operator",
        editedByOperator: true,
        approvedByOperator: true,
        createdAt: fixtureNow,
        updatedAt: fixtureNow,
        approvedAt: fixtureNow,
        sentAt: null,
        notes: null,
      },
    ],
  });
  const motion = buildMotionView({
    id: "motion-connection-1",
    name: "Connection Motion",
    targetMap: {
      status: "pending",
      accounts: [
        buildTargetAccount({
          companyId: "company-connection-1",
          companyName: "BuyerCo",
          prospects: [prospect],
        }),
      ],
      segments: [],
    },
  });
  const company = buildCompanyView({
    id: "company-connection-1",
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
    name: "BuyerCo",
    domain: "buyer.example",
    websiteUrl: "https://buyer.example",
    linkedinCompanyUrl: "https://www.linkedin.com/company/buyerco",
    motionIds: ["motion-connection-1"],
    engagementUserAssignment: {
      userId: "user-connection-1",
      label: "Operator",
      owner: "operator",
      accountRefs: ["linkedin:operator-linkedin"],
      assignedAt: fixtureNow,
      assignedBy: "test",
      reason: "Use governed connector",
      sticky: true,
    },
  });
  const users = [
    buildExecutionUser("user-connection-1", {
      label: "Operator",
      owner: "operator",
      accounts: [
        {
          id: "account-connection-1",
          createdAt: fixtureNow,
          updatedAt: fixtureNow,
          capability: "linkedin",
          handle: "operator-linkedin",
          label: null,
          sourceType: "harness-connection",
          browserProfileId: null,
          harnessConnectionId: "hc-connection-1",
          providerAccountId: "provider-linkedin-1",
          preferred: true,
          notes: null,
          automationControls: {
            weeklyQuotas: {
              profileVisits: null,
              invitations: 125,
              messages: null,
            },
          },
          metadata: null,
          inboundSync: {
            surfaces: [],
          },
        },
      ],
      harnessConnections: [
        {
          id: "hc-connection-1",
          createdAt: fixtureNow,
          updatedAt: fixtureNow,
          runtime: "codex",
          connector: "unipile",
          label: "Codex Unipile",
          status: "available",
          notes: null,
        },
      ],
    }),
  ];

  const handoff = buildLinkedinSendHandoff(company, motion, [], users, {
    prospectId: "prospect-connection-1",
    surface: "connection_request",
    runtime: "codex",
    branches: [],
    now: "2026-06-10T15:00:00.000Z",
  });

  assert.equal(handoff.status, "ready");
  assert.equal(handoff.action, "send_connection_request");
  assert.equal(handoff.connector, "codex:unipile");
  assert.equal(handoff.senderAccount?.providerAccountId, "provider-linkedin-1");
  assert.equal(handoff.senderAccount?.accountId, "account-connection-1");
  assert.equal(handoff.recipient?.providerId, "provider-jordan");
  assert.equal(handoff.recipient?.publicId, "jordan-example");
  assert.equal(handoff.recipient?.profileUrl, "https://www.linkedin.com/in/jordan-example/");
  assert.equal(handoff.message, "Jordan, worth connecting given your RevOps work.");
  assert.equal(handoff.executionPolicy.writeBackOnlyAfterRealSend, true);
});
