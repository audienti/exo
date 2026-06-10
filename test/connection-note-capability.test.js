// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  accountCanAttachConnectionNote,
  connectionNoteCapabilityForAccount,
  resolveConnectionNoteCapability,
} from "../src/core/connection-note-capability.js";

test("verified premium accounts can attach notes", () => {
  assert.equal(
    connectionNoteCapabilityForAccount({
      capability: "linkedin",
      metadata: { premiumFeatures: ["sales_navigator"] },
    }),
    true,
  );
  assert.equal(
    connectionNoteCapabilityForAccount({
      capability: "linkedin",
      metadata: { isPremium: true },
    }),
    true,
  );
  assert.equal(
    accountCanAttachConnectionNote({
      capability: "linkedin",
      metadata: { premiumFeatures: ["sales-navigator"] },
    }),
    true,
  );
});

test("a verified free account reports false, not unknown", () => {
  assert.equal(
    connectionNoteCapabilityForAccount({
      capability: "linkedin",
      metadata: { premiumFeatures: [], publicIdentifier: "ali-umair" },
    }),
    false,
  );
  assert.equal(
    connectionNoteCapabilityForAccount({
      capability: "linkedin",
      metadata: { isPremium: false },
    }),
    false,
  );
});

test("an unverified tier reports unknown instead of asserting free", () => {
  assert.equal(
    connectionNoteCapabilityForAccount({
      capability: "linkedin",
      metadata: null,
    }),
    null,
  );
  assert.equal(
    connectionNoteCapabilityForAccount({
      capability: "linkedin",
      metadata: { accountType: "LINKEDIN" },
    }),
    null,
  );
  assert.equal(
    accountCanAttachConnectionNote({ capability: "linkedin", metadata: null }),
    false,
  );
});

test("resolveConnectionNoteCapability treats plain account refs as unverified, premium refs as proof", () => {
  assert.equal(
    resolveConnectionNoteCapability({ accountRefs: ["linkedin:williamflanagan"] }),
    null,
  );
  assert.equal(
    resolveConnectionNoteCapability({ accountRefs: ["sales-navigator:williamflanagan"] }),
    true,
  );
  assert.equal(resolveConnectionNoteCapability({}), null);
  assert.equal(
    resolveConnectionNoteCapability({
      resolvedAccount: { capability: "linkedin", metadata: { premiumFeatures: ["sales_navigator"] } },
    }),
    true,
  );
  assert.equal(
    resolveConnectionNoteCapability({
      resolvedAccount: { capability: "linkedin", metadata: { premiumFeatures: [] } },
    }),
    false,
  );
  assert.equal(
    resolveConnectionNoteCapability({
      resolvedAccount: { capability: "linkedin", metadata: null },
    }),
    null,
  );
});
