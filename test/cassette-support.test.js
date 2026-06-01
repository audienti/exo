// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { loadJsonCassette } from "./support/cassettes.js";

test("loadJsonCassette substitutes placeholders recursively without mutating later loads", () => {
  const first = loadJsonCassette("examples/template-sync.json", {
    ACCOUNT_ID: "account-1",
    INVITE_ID: "invite-1",
    ACTOR_NAME: "Jordan Cipolla"
  });

  assert.equal(first.accounts[0].accountId, "account-1");
  assert.equal(first.accounts[0].surfaces[0].observations[0].externalId, "invite-1");
  assert.equal(first.accounts[0].surfaces[0].observations[0].actorName, "Jordan Cipolla");
  assert.equal(first.accounts[0].surfaces[0].observations[0].summary, "Jordan Cipolla is still pending.");

  first.accounts[0].accountId = "mutated";

  const second = loadJsonCassette("examples/template-sync.json", {
    ACCOUNT_ID: "account-2",
    INVITE_ID: "invite-2",
    ACTOR_NAME: "Alicia Buyer"
  });

  assert.equal(second.accounts[0].accountId, "account-2");
  assert.equal(second.accounts[0].surfaces[0].observations[0].externalId, "invite-2");
  assert.equal(second.accounts[0].surfaces[0].observations[0].summary, "Alicia Buyer is still pending.");
});
