// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPABILITY_SEAM_STATES,
  buildCapabilitySeamResult,
} from "../src/core/capability-seam-contract.js";
import { buildSeamRegistryRow } from "./support/capability-seam-fixtures.js";

test("buildCapabilitySeamResult makes missing proof explicit", () => {
  const row = buildSeamRegistryRow();
  const result = buildCapabilitySeamResult({
    row,
    state: CAPABILITY_SEAM_STATES.MISSING_PROOF,
    reason: "gmail_sent_mail_surface_missing",
  });

  assert.equal(result.capabilityKey, "send_email");
  assert.equal(result.state, "missing_proof");
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.supported, true);
  assert.equal(result.requiresAction, true);
  assert.deepEqual(result.proofSurfaces, ["gmail-sent-mail", "gmail-inbox-threads"]);
  assert.deepEqual(result.missingProofSurfaces, ["gmail-sent-mail", "gmail-inbox-threads"]);
});

test("buildCapabilitySeamResult keeps unsupported seams separate from checked quiet state", () => {
  const row = buildSeamRegistryRow({
    capabilityKey: "linkedin-comment-replies",
    reconcile: { owner: "src/core/public-engagement-reconciliation.js" },
    proofSurfaces: ["linkedin-comment-replies"],
    stateKeys: ["public_reply_received", "comment_thread_updated"],
    reconciliationStrategy: "public-engagement-proof-reconciliation",
  });

  const result = buildCapabilitySeamResult({
    row,
    state: CAPABILITY_SEAM_STATES.UNSUPPORTED,
    reason: "autonomous_public_capture_not_wired",
  });

  assert.equal(result.state, "unsupported");
  assert.equal(result.quiet, false);
  assert.equal(result.checked, false);
  assert.equal(result.supported, false);
  assert.equal(result.requiresAction, false);
  assert.deepEqual(result.missingProofSurfaces, []);
});

test("buildCapabilitySeamResult normalizes quiet and reconciled states as checked", () => {
  const quiet = buildCapabilitySeamResult({
    row: buildSeamRegistryRow({ capabilityKey: "gmail-inbox-threads" }),
    state: CAPABILITY_SEAM_STATES.QUIET,
    reason: "fresh_thread_sync_no_actionable_changes",
  });
  const reconciled = buildCapabilitySeamResult({
    row: buildSeamRegistryRow(),
    state: CAPABILITY_SEAM_STATES.RECONCILED,
    reason: "sent_mail_proof_observed",
    evidence: [{ surface: "gmail-sent-mail", externalId: "msg-1" }],
  });

  assert.equal(quiet.quiet, true);
  assert.equal(quiet.checked, true);
  assert.equal(quiet.requiresAction, false);

  assert.equal(reconciled.quiet, true);
  assert.equal(reconciled.checked, true);
  assert.equal(reconciled.requiresAction, false);
  assert.deepEqual(reconciled.evidence, [{ surface: "gmail-sent-mail", externalId: "msg-1" }]);
});

test("buildCapabilitySeamResult rejects unknown states and incomplete registry rows", () => {
  assert.throws(
    () => buildCapabilitySeamResult({
      row: buildSeamRegistryRow(),
      state: "checked",
      reason: "checked_is_not_a_seam_state",
    }),
    /Unknown capability seam state/,
  );

  assert.throws(
    () => buildCapabilitySeamResult({
      row: buildSeamRegistryRow({ proofSurfaces: [] }),
      state: CAPABILITY_SEAM_STATES.PENDING_PROOF,
      reason: "proof_needed",
    }),
    /must include proof surfaces/,
  );
});
