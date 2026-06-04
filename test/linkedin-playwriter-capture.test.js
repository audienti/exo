// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLinkedinPlaywriterSurfaceScript,
  buildLinkedinSurfaceCaptureFromSnapshot,
  parsePlaywriterMarkerJson,
  summarizeLinkedinSurfaceCaptures,
} from "../src/lib/linkedin-playwriter-capture.js";
import { buildLinkedinQuickSurfaceHints } from "../src/lib/live-surface-hints.js";

test("parsePlaywriterMarkerJson extracts the marked JSON payload from console output", () => {
  const parsed = parsePlaywriterMarkerJson(
    "Console output:\n[log] __EXO_LINKEDIN_PLAYWRITER_JSON__{\"ok\":true,\"count\":2}\n",
    "__EXO_LINKEDIN_PLAYWRITER_JSON__",
  );

  assert.deepEqual(parsed, { ok: true, count: 2 });
});

test("buildLinkedinSurfaceCaptureFromSnapshot turns a bounded visible slice into a warning capture", () => {
  const capture = buildLinkedinSurfaceCaptureFromSnapshot({
    surfaceKey: "followersList",
    mode: "quick",
    rawResult: {
      pageUrl: "https://www.linkedin.com/mynetwork/network-manager/people-follow/followers/",
      pageTitle: "Followers | LinkedIn",
      readySelector: "main",
      snapshot: {
        capturedAt: "2026-06-03T03:50:00.000Z",
        rowCount: 5,
        rows: [
          {
            entryId: "entry-1",
            summary: "Alicia Buyer follows the account.",
            actorName: "Alicia Buyer",
            actorProfileUrl: "https://www.linkedin.com/in/alicia-buyer/",
            actorLinkedinPublicId: "alicia-buyer",
          },
          {
            entryId: "entry-2",
            summary: "Jordan Seller follows the account.",
            actorName: "Jordan Seller",
            actorProfileUrl: "https://www.linkedin.com/in/jordan-seller/",
            actorLinkedinPublicId: "jordan-seller",
          },
        ],
      },
    },
  });

  assert.equal(capture.status, "warning");
  assert.equal(capture.visibleTotalCount, 5);
  assert.equal(capture.itemCount, 2);
  assert.equal(capture.captureCompleteness, "partial_visible_slice");
  assert.equal(capture.error, "Visible surface total exceeded the bounded itemized slice.");
  assert.equal(capture.items[0].kind, "follower_confirmed");
  assert.equal(capture.items[0].actorHandle, "alicia-buyer");
});

test("buildLinkedinSurfaceCaptureFromSnapshot derives sent invitation eventAt when relative time exists", () => {
  const capture = buildLinkedinSurfaceCaptureFromSnapshot({
    surfaceKey: "sentInvitations",
    mode: "quick",
    rawResult: {
      pageUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
      pageTitle: "Sent invitations | LinkedIn",
      readySelector: "main",
      snapshot: {
        capturedAt: "2026-06-03T03:50:00.000Z",
        rowCount: 1,
        rows: [
          {
            invitationId: "invite-1",
            summary: "Alicia Buyer Sent 3 weeks ago",
            actorName: "Alicia Buyer",
            actorProfileUrl: "https://www.linkedin.com/in/alicia-buyer/",
          },
        ],
      },
    },
  });

  assert.equal(capture.status, "success");
  assert.equal(capture.items[0].kind, "connection_request_pending");
  assert.equal(capture.items[0].eventAt, "2026-05-13T03:50:00.000Z");
});

test("buildLinkedinSurfaceCaptureFromSnapshot strips sent-invitation control labels out of actor and summary fields", () => {
  const capture = buildLinkedinSurfaceCaptureFromSnapshot({
    surfaceKey: "sentInvitations",
    mode: "quick",
    rawResult: {
      pageUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
      pageTitle: "Sent invitations | LinkedIn",
      readySelector: "main",
      snapshot: {
        capturedAt: "2026-06-03T09:10:43.847Z",
        rowCount: 1,
        rows: [
          {
            invitationId: "invite-control-only",
            summary: "Withdraw",
            actorName: "Withdraw invitation sent to Kashyap S.",
          },
        ],
      },
    },
  });

  assert.equal(capture.status, "success");
  assert.equal(capture.items[0].actorName, "Kashyap S.");
  assert.equal(
    capture.items[0].summary,
    "Kashyap S. is still in the sent invitations queue.",
  );
});

test("buildLinkedinSurfaceCaptureFromSnapshot truncates overlong summaries to the Exo contract limit", () => {
  const capture = buildLinkedinSurfaceCaptureFromSnapshot({
    surfaceKey: "messagingInbox",
    mode: "quick",
    rawResult: {
      pageUrl: "https://www.linkedin.com/messaging/",
      pageTitle: "Messaging | LinkedIn",
      readySelector: "main",
      snapshot: {
        capturedAt: "2026-06-03T03:50:00.000Z",
        rowCount: 1,
        rows: [
          {
            threadId: "thread-1",
            summary: "x".repeat(400),
          },
        ],
      },
    },
  });

  assert.equal(capture.items[0].summary.length, 280);
  assert.match(capture.items[0].summary, /\.\.\.$/);
});

test("buildLinkedinSurfaceCaptureFromSnapshot preserves received invitation notes", () => {
  const capture = buildLinkedinSurfaceCaptureFromSnapshot({
    surfaceKey: "receivedInvitations",
    mode: "quick",
    rawResult: {
      pageUrl: "https://www.linkedin.com/mynetwork/invitation-manager/received/",
      pageTitle: "Received invitations | LinkedIn",
      readySelector: "main",
      snapshot: {
        capturedAt: "2026-06-03T03:50:00.000Z",
        rowCount: 1,
        rows: [
          {
            invitationId: "invite-1",
            summary: "Alicia Buyer sent a connection request.",
            actorName: "Alicia Buyer",
            actorProfileUrl: "https://www.linkedin.com/in/alicia-buyer/",
            invitationNote: "Would love to connect about governed inbound workflows.",
          },
        ],
      },
    },
  });

  assert.equal(capture.status, "success");
  assert.equal(capture.items[0].kind, "connection_request_received");
  assert.equal(capture.items[0].notes, "Would love to connect about governed inbound workflows.");
});

test("summarizeLinkedinSurfaceCaptures reports warning when any surface failed but some succeeded", () => {
  const summary = summarizeLinkedinSurfaceCaptures({
    sentInvitations: {
      status: "success",
      checkedAt: "2026-06-03T03:50:00.000Z",
      itemCount: 2,
      error: null,
    },
    receivedInvitations: {
      status: "failed",
      checkedAt: "2026-06-03T03:51:00.000Z",
      itemCount: 0,
      error: "received surface did not render",
    },
    messagingInbox: {
      status: "success",
      checkedAt: "2026-06-03T03:52:00.000Z",
      itemCount: 1,
      error: null,
    },
    profileViews: {
      status: "success",
      checkedAt: "2026-06-03T03:53:00.000Z",
      itemCount: 0,
      error: null,
    },
    followersList: {
      status: "warning",
      checkedAt: "2026-06-03T03:54:00.000Z",
      itemCount: 3,
      error: null,
    },
    followingList: {
      status: "success",
      checkedAt: "2026-06-03T03:55:00.000Z",
      itemCount: 4,
      error: null,
    },
  });

  assert.equal(summary.status, "warning");
  assert.equal(summary.checkedAt, "2026-06-03T03:55:00.000Z");
  assert.equal(summary.itemCount, 10);
  assert.match(summary.error ?? "", /receivedInvitations: received surface did not render/);
});

test("buildLinkedinPlaywriterSurfaceScript uses page.evaluate rather than inline script injection", () => {
  const hints = buildLinkedinQuickSurfaceHints({ limit: 3 });
  const script = buildLinkedinPlaywriterSurfaceScript({
    surfaceKey: "followingList",
    hint: hints.followingList,
    targetUrl: hints.followingList.entryHints.directFollowingUrl,
    mode: "quick",
    limit: 3,
    timeoutMs: 45000,
    outputPath: "/tmp/exo-linkedin-following.json",
  });

  assert.match(script, /page\.evaluate/);
  assert.doesNotMatch(script, /addScriptTag/);
  assert.match(script, /writeFileSync/);
  assert.match(script, /exo-linkedin-following\.json/);
  assert.match(script, /__EXO_LINKEDIN_PLAYWRITER_JSON__/);
});

test("buildLinkedinPlaywriterSurfaceScript waits for invitation-row signals before snapshotting sent invitations", () => {
  const hints = buildLinkedinQuickSurfaceHints({ limit: 20 });
  const script = buildLinkedinPlaywriterSurfaceScript({
    surfaceKey: "sentInvitations",
    hint: hints.sentInvitations,
    targetUrl: hints.sentInvitations.entryHints.sentManagerUrls[0],
    mode: "full",
    limit: 20,
    timeoutMs: 45000,
    outputPath: "/tmp/exo-linkedin-sent.json",
  });

  assert.match(script, /minimumSignalCount/);
  assert.match(script, /minimumStablePolls/);
  assert.match(script, /minimumElapsedMs/);
  assert.match(script, /withdraw/);
  assert.match(script, /readySignalCount/);
});
