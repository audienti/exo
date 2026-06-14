// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import { readUnipileConfig } from "../src/lib/unipile-config.js";

const OPT_IN_ENV = "EXO_UNIPILE_ACCOUNT_SMOKE";
const PROVIDER_ACCOUNT_ID_ENV = "EXO_UNIPILE_PROVIDER_ACCOUNT_ID";

// Opt-in command:
// EXO_UNIPILE_ACCOUNT_SMOKE=1 \
// UNIPILE_API_KEY=<key> \
// UNIPILE_DSN=https://<tenant>.unipile.com:<port> \
// EXO_UNIPILE_PROVIDER_ACCOUNT_ID=<provider-account-id> \
// npm test -- test/unipile-account-smoke.test.js

test("env-gated Unipile account smoke test finds the configured provider account id", async (t) => {
  const gate = buildSmokeGate();
  if (!gate.enabled) {
    t.skip(gate.reason);
    return;
  }

  const url = new URL("/api/v1/accounts", gate.baseUrl);
  url.searchParams.set("limit", "250");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "X-API-KEY": gate.apiKey,
    },
  });
  const bodyText = await response.text();

  assert.equal(
    response.ok,
    true,
    `GET ${url.toString()} returned ${response.status}: ${bodyText.slice(0, 500)}`,
  );

  const accountIds = extractAccountIds(JSON.parse(bodyText));
  assert.ok(
    accountIds.includes(gate.providerAccountId),
    `/api/v1/accounts did not include ${gate.providerAccountId}; found ${accountIds.join(", ") || "no account ids"}`,
  );
});

function buildSmokeGate() {
  if (process.env[OPT_IN_ENV] !== "1") {
    return {
      enabled: false,
      reason: `set ${OPT_IN_ENV}=1 plus live Unipile credentials to run this smoke test`,
    };
  }

  const explicitBaseUrl = normalizeNullableString(process.env.UNIPILE_DSN)
    ?? normalizeNullableString(process.env.UNIPILE_BASE_URL);
  const apiKey = normalizeNullableString(process.env.UNIPILE_API_KEY);
  const providerAccountId = normalizeNullableString(process.env[PROVIDER_ACCOUNT_ID_ENV]);

  if (!apiKey || !explicitBaseUrl || !providerAccountId) {
    return {
      enabled: false,
      reason: `set UNIPILE_API_KEY, UNIPILE_DSN or UNIPILE_BASE_URL, and ${PROVIDER_ACCOUNT_ID_ENV} to run this smoke test`,
    };
  }

  const config = readUnipileConfig(null);

  return {
    enabled: true,
    apiKey,
    baseUrl: config.baseUrl,
    providerAccountId,
  };
}

function extractAccountIds(payload) {
  const candidates = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.accounts)
      ? payload.accounts
      : Array.isArray(payload)
        ? payload
        : [];

  return candidates
    .map((account) => normalizeNullableString(account?.id ?? account?.account_id ?? account?.accountId))
    .filter((accountId) => accountId !== null);
}

function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
