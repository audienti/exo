// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildGmailInboundSyncPayload, normalizeGmailInboundSyncCapture } from "../src/core/inbound-gmail-sync.js";

function rawUser() {
  return {
    id: "user-1",
    createdAt: "2026-06-04T16:00:00.000Z",
    updatedAt: "2026-06-04T16:00:00.000Z",
    label: "william-main",
    owner: "william",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00",
    },
    accounts: [
      {
        id: "gmail-account-1",
        createdAt: "2026-06-04T16:00:00.000Z",
        updatedAt: "2026-06-04T16:00:00.000Z",
        capability: "gmail",
        handle: "william@example.com",
        label: "William Gmail",
        sourceType: "harness-connection",
        browserProfileId: null,
        harnessConnectionId: "hc-1",
        providerAccountId: null,
        preferred: true,
        automationControls: {
          weeklyQuotas: {
            profileVisits: null,
            invitations: null,
            messages: null,
          },
        },
        notes: null,
        inboundSync: {
          surfaces: [],
        },
      },
    ],
    harnessConnections: [
      {
        id: "hc-1",
        createdAt: "2026-06-04T16:00:00.000Z",
        updatedAt: "2026-06-04T16:00:00.000Z",
        runtime: "codex",
        connector: "gmail",
        label: "Codex Gmail",
        status: "available",
        notes: null,
      },
    ],
    inboundIgnoreRules: [],
  };
}

test("buildGmailInboundSyncPayload preserves structured messages for downstream timeline and CRM sync", () => {
  const built = buildGmailInboundSyncPayload(rawUser(), {
    accountId: "gmail-account-1",
    capture: {
      mode: "quick",
      status: "success",
      checkedAt: "2026-06-04T16:20:00.000Z",
      itemCount: 1,
      error: null,
      threads: [
        {
          threadId: "thread-1",
          kind: "email_reply_received",
          observedAt: "2026-06-04T16:18:00.000Z",
          summary: "Lina replied with the procurement thread and pricing range.",
          subject: "Re: Halfmoon Hillcrest Fire Dept. RFP",
          fromName: "Lina Park",
          fromEmail: "lpark@govpointeoffice.us",
          actorTitle: "Procurement Support Department",
          actorCompanyName: "GovPointe Office",
          threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-1",
          sourceUrl: "https://mail.google.com/mail/u/0/#inbox/thread-1",
          motionId: null,
          companyId: null,
          prospectId: null,
          notes: "Procurement solicitation. Likely reject and suppress.",
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
              body: "External follow-up thread. Opportunity claims base year $75k-$150k and four-year total $200k-$375k.",
            },
          ],
        },
      ],
    },
  });

  const observation = built.payload.accounts[0].surfaces[0].observations[0];
  assert.equal(observation.subject, "Re: Halfmoon Hillcrest Fire Dept. RFP");
  assert.equal(observation.notes, "Procurement solicitation. Likely reject and suppress.");
  assert.equal(observation.messages.length, 2);
  assert.equal(observation.messages[0].direction, "outbound");
  assert.match(observation.messages[1].body, /Opportunity claims base year/);
});

test("normalizeGmailInboundSyncCapture coerces local datetimes into strict ISO strings", () => {
  const normalized = normalizeGmailInboundSyncCapture({
    mode: "quick",
    status: "success",
    checkedAt: "2026-06-04T16:20:00",
    itemCount: 1,
    error: null,
    threads: [
      {
        threadId: "thread-1",
        kind: "email_thread_updated",
        observedAt: "2026-06-04T16:18:00",
        summary: "Thread changed.",
        subject: "Re: Thread",
        fromName: "Lina Park",
        fromEmail: "lpark@govpointeoffice.us",
        actorTitle: null,
        actorCompanyName: "GovPointe Office",
        threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-1",
        sourceUrl: "https://mail.google.com/mail/u/0/#inbox/thread-1",
        motionId: null,
        companyId: null,
        prospectId: null,
        notes: null,
        messages: [
          {
            id: "msg-1",
            direction: "inbound",
            sentAt: "2026-06-04T16:17:00",
            fromName: "Lina Park",
            fromHandle: "lpark@govpointeoffice.us",
            body: "Wanted to follow up."
          }
        ]
      }
    ]
  });

  assert.equal(normalized.checkedAt, new Date("2026-06-04T16:20:00").toISOString());
  assert.equal(normalized.threads[0].observedAt, new Date("2026-06-04T16:18:00").toISOString());
  assert.equal(normalized.threads[0].messages[0].sentAt, new Date("2026-06-04T16:17:00").toISOString());
});

test("buildGmailInboundSyncPayload accepts local datetimes from Gmail capture output", () => {
  const built = buildGmailInboundSyncPayload(rawUser(), {
    accountId: "gmail-account-1",
    capture: {
      mode: "quick",
      status: "success",
      checkedAt: "2026-06-04T16:20:00",
      itemCount: 1,
      error: null,
      threads: [
        {
          threadId: "thread-1",
          kind: "email_thread_updated",
          observedAt: "2026-06-04T16:18:00",
          summary: "Thread changed.",
          subject: "Re: Thread",
          fromName: "Lina Park",
          fromEmail: "lpark@govpointeoffice.us",
          actorTitle: null,
          actorCompanyName: "GovPointe Office",
          threadUrl: "https://mail.google.com/mail/u/0/#inbox/thread-1",
          sourceUrl: "https://mail.google.com/mail/u/0/#inbox/thread-1",
          motionId: null,
          companyId: null,
          prospectId: null,
          notes: null,
          messages: [
            {
              id: "msg-1",
              direction: "inbound",
              sentAt: "2026-06-04T16:17:00",
              fromName: "Lina Park",
              fromHandle: "lpark@govpointeoffice.us",
              body: "Wanted to follow up."
            }
          ]
        }
      ]
    },
  });

  assert.equal(
    built.payload.accounts[0].surfaces[0].observations[0].messages[0].sentAt,
    new Date("2026-06-04T16:17:00").toISOString()
  );
});
