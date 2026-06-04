// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLinkedinQuickCaptureBootstrapSource,
  buildLinkedinQuickCaptureEvaluateSource,
  buildLinkedinQuickCaptureScaffold
} from "../src/lib/linkedin-quick-capture-scaffold.js";

test("linkedin quick capture scaffold exposes a reusable browser-evaluate contract", () => {
  const scaffold = buildLinkedinQuickCaptureScaffold({ limit: 12 });

  assert.equal(scaffold.version, "exo-linkedin-quick-capture-v2");
  assert.match(scaffold.modulePath, /src\/lib\/linkedin-quick-capture-scaffold\.js$/);
  assert.equal(scaffold.runtime, "browser_page_evaluate");
  assert.equal(scaffold.mode, "snapshot_extractor");
  assert.equal(scaffold.bootstrapSymbol, "__exoLinkedinQuickCapture");
  assert.equal(scaffold.suggestedItemLimit, 12);
  assert.ok(scaffold.usage.some((line) => /before inventing a larger ad hoc LinkedIn DOM script/i.test(line)));
  assert.equal(scaffold.supportedSurfaces.sentInvitations.hintKey, "surfaceHints.sentInvitations");
  assert.equal(scaffold.supportedSurfaces.receivedInvitations.hintKey, "surfaceHints.receivedInvitations");
  assert.equal(scaffold.supportedSurfaces.messagingInbox.hintKey, "surfaceHints.messagingInbox");
  assert.equal(scaffold.supportedSurfaces.profileViews.hintKey, "surfaceHints.profileViews");
  assert.equal(scaffold.supportedSurfaces.followersList.hintKey, "surfaceHints.followersList");
  assert.equal(scaffold.supportedSurfaces.followingList.hintKey, "surfaceHints.followingList");
});

test("linkedin quick capture scaffold source builders generate browser-evaluable source", () => {
  const bootstrapSource = buildLinkedinQuickCaptureBootstrapSource();
  const evaluateSource = buildLinkedinQuickCaptureEvaluateSource({
    surfaceKey: "sentInvitations",
    requestedMode: "quick",
    limit: 8,
    hint: {
      surface: "linkedin-sent-invitations"
    }
  });

  assert.match(bootstrapSource, /__exoLinkedinQuickCapture/);
  assert.match(bootstrapSource, /exo-linkedin-quick-capture-v2/);
  assert.match(bootstrapSource, /captureSentInvitations/);
  assert.match(bootstrapSource, /captureReceivedInvitations/);
  assert.match(bootstrapSource, /captureMessagingInbox/);
  assert.match(bootstrapSource, /captureProfileViews/);
  assert.match(bootstrapSource, /captureFollowersList/);
  assert.match(bootstrapSource, /captureFollowingList/);
  assert.match(bootstrapSource, /invitationNote/);
  assert.match(evaluateSource, /capture\.captureSurface/);
  assert.match(evaluateSource, /sentInvitations/);
  assert.match(evaluateSource, /requestedMode/);
});
