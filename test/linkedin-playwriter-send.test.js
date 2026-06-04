// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { buildLinkedinPlaywriterSendScript } from "../src/lib/linkedin-playwriter-send.js";

test("buildLinkedinPlaywriterSendScript emits a bounded connection-request flow", () => {
  const script = buildLinkedinPlaywriterSendScript({
    handoff: {
      action: "send_connection_request",
      surface: "connection_request",
      recipient: {
        profileUrl: "https://www.linkedin.com/in/tarasmykhalyshyn",
      },
      message: "Taras, BillEase joining LenderLink caught my eye.",
    },
    outputPath: "/tmp/exo-linkedin-send.json",
  });

  assert.match(script, /gotoRecipientProfile/);
  assert.match(script, /waitForPrimaryProfileActions/);
  assert.match(script, /openConnectFlow/);
  assert.match(script, /Add a note/);
  assert.match(script, /ready_to_send/);
  assert.match(script, /Pending|Sent/);
  assert.match(script, /__EXO_LINKEDIN_PLAYWRITER_SEND__/);
  assert.match(script, /exo-linkedin-send\.json/);
});

test("buildLinkedinPlaywriterSendScript emits a bounded direct-message flow", () => {
  const script = buildLinkedinPlaywriterSendScript({
    handoff: {
      action: "send_direct_message",
      surface: "follow_up_direct_message",
      recipient: {
        profileUrl: "https://www.linkedin.com/in/example-person",
      },
      message: "Picking this back up because we connected and then let it sit.",
    },
    outputPath: "/tmp/exo-linkedin-dm.json",
  });

  assert.match(script, /openMessageComposer/);
  assert.match(script, /openMessageViaComposeLink/);
  assert.match(script, /activateComposeShellIfNeeded/);
  assert.match(script, /msg-overlay-bubble-header__control--new-convo-btn/);
  assert.match(script, /\/messaging\/compose/);
  assert.match(script, /msg-form__contenteditable/);
  assert.match(script, /dismissComposerTypeahead/);
  assert.match(script, /focusComposer/);
  assert.match(script, /writeContentEditableComposer/);
  assert.match(script, /keyboard\.insertText\(part\)/);
  assert.match(script, /keyboard\.press\('Shift\+Enter'\)/);
  assert.match(script, /ready_to_send/);
  assert.match(script, /linkedin_direct_message_send_unconfirmed/);
  assert.match(script, /__EXO_LINKEDIN_PLAYWRITER_SEND__/);
});

test("buildLinkedinPlaywriterSendScript can be marked dry-run explicitly", () => {
  const script = buildLinkedinPlaywriterSendScript({
    handoff: {
      action: "send_connection_request",
      recipient: {
        profileUrl: "https://www.linkedin.com/in/example",
      },
      message: "Short note",
    },
    outputPath: "/tmp/exo-linkedin-send-dry-run.json",
    dryRun: true,
  });

  assert.match(script, /const dryRun = true/);
  assert.match(script, /status: 'ready_to_send'/);
});
