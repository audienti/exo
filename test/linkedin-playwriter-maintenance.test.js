// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildLinkedinPlaywriterMaintenanceScript } from "../src/lib/linkedin-playwriter-maintenance.js";

test("buildLinkedinPlaywriterMaintenanceScript emits a bounded withdraw flow", () => {
  const script = buildLinkedinPlaywriterMaintenanceScript({
    task: {
      kind: "withdraw_connection",
      recipientUrl: "https://www.linkedin.com/in/example-person",
      prospectName: "Example Person",
    },
    outputPath: "/tmp/exo-linkedin-maintenance-withdraw.json",
  });

  assert.match(script, /performWithdrawConnection/);
  assert.match(script, /withdrawInvitationFactories/);
  assert.match(script, /withdrawConfirmationFactories/);
  assert.match(script, /linkedin_withdraw_connection_blocked/);
  assert.match(script, /Invitation withdrawn/);
  assert.match(script, /__EXO_LINKEDIN_PLAYWRITER_MAINTENANCE__/);
});

test("buildLinkedinPlaywriterMaintenanceScript emits a bounded reject flow", () => {
  const script = buildLinkedinPlaywriterMaintenanceScript({
    task: {
      kind: "reject_connection_request",
      recipientUrl: "https://www.linkedin.com/in/example-person",
      prospectName: "Example Person",
    },
    outputPath: "/tmp/exo-linkedin-maintenance-reject.json",
  });

  assert.match(script, /performRejectConnectionRequest/);
  assert.match(script, /ignoreFactories/);
  assert.match(script, /linkedin_reject_connection_request_blocked/);
  assert.match(script, /Invitation ignored|Invitation declined/);
  assert.match(script, /__EXO_LINKEDIN_PLAYWRITER_MAINTENANCE__/);
});

test("buildLinkedinPlaywriterMaintenanceScript emits a bounded unfollow flow", () => {
  const script = buildLinkedinPlaywriterMaintenanceScript({
    task: {
      kind: "unfollow_profile",
      recipientUrl: "https://www.linkedin.com/in/example-person",
      prospectName: "Example Person",
    },
    outputPath: "/tmp/exo-linkedin-maintenance-unfollow.json",
  });

  assert.match(script, /performUnfollowProfile/);
  assert.match(script, /followingFactories/);
  assert.match(script, /unfollowFactories/);
  assert.match(script, /alreadySatisfied/);
  assert.match(script, /linkedin_unfollow_blocked/);
  assert.match(script, /__EXO_LINKEDIN_PLAYWRITER_MAINTENANCE__/);
});
