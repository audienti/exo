// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildExecutionViewModel } from "../src/core/build-execution-view.js";
import { renderExecutionPage, renderUserDetailPage } from "../src/artifacts/render-execution.js";

function rawUser() {
  return {
    id: "user-1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    label: "william-main",
    owner: "operator",
    notes: null,
    workingHours: {
      mode: "always",
      timezone: "America/New_York",
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      startLocalTime: "09:00",
      endLocalTime: "17:00",
    },
    accounts: [],
    harnessConnections: [],
  };
}

test("buildExecutionViewModel surfaces runtime-discovered unclaimed accounts for the UI", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-execution-view-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      '[plugins."gmail@openai-curated"]',
      "enabled = true",
      "",
      "[mcp_servers.unipile]",
      "enabled = true",
      "",
    ].join("\n"),
  );

  try {
    const model = buildExecutionViewModel({
      rawUsers: [rawUser()],
      rawMotions: [],
      rawCompanies: [],
      rawProfiles: [],
      runtimeAccountDiscovery: {
        runtime: "codex",
        codexHome,
      },
    });

    assert.equal(model.users.length, 1);
    assert.ok(model.users[0].unclaimedAccountCount >= 3);

    const linkedin = model.users[0].unclaimedAccounts.find((account) => account.capability === "linkedin");
    const gmail = model.users[0].unclaimedAccounts.find((account) => account.capability === "gmail" && account.connector === "gmail");
    const unipileGmail = model.users[0].unclaimedAccounts.find((account) => account.capability === "gmail" && account.connector === "unipile");

    assert.ok(linkedin);
    assert.equal(linkedin?.connector, "unipile");
    assert.equal(linkedin?.requiresHandle, false);

    assert.ok(gmail);
    assert.equal(gmail?.connector, "gmail");

    assert.ok(unipileGmail);
    assert.equal(unipileGmail?.connector, "unipile");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("renderUserDetailPage exposes the claim runtime account control", () => {
  const html = renderUserDetailPage(
    {
      id: "user-1",
      label: "william-main",
      owner: "operator",
      initials: "WM",
      accountCount: 0,
      harnessCount: 0,
      unclaimedAccountCount: 1,
      motionCount: 0,
      accounts: [],
      harness: [],
      assignedMotions: [],
      capabilityCoverage: [],
      working: "Always on",
      unclaimedAccounts: [
        {
          capability: "linkedin",
          handle: "williamflanagan",
          label: "William Flanagan",
          handleSourceType: null,
          kind: "linkedin",
          runtime: "codex",
          connector: "unipile",
          providerAccountId: "acct-linkedin",
          truth: "checked",
          status: "available",
          action: "ready_to_map",
          reason: "Resolved managed linkedin account williamflanagan through codex:unipile.",
          requiresHandle: false,
          identityState: "confirmed",
          title: "William Flanagan · williamflanagan",
          subtitle: "linkedin via codex · unipile",
          canClaim: true,
          claimArgs: {
            userId: "user-1",
            capability: "linkedin",
            runtime: "codex",
            connector: "unipile",
            providerAccountId: "acct-linkedin",
            label: "William Flanagan",
            handle: "williamflanagan",
            preferred: true,
          },
        },
      ],
    },
    { interactive: true },
  );

  assert.match(html, /Unclaimed accounts/);
  assert.match(html, /data-exo-writer="claimRuntimeAccount"/);
  assert.doesNotMatch(html, /placeholder="linkedin handle"/);
  assert.match(html, /William Flanagan/);
  assert.match(html, /linkedin via codex · unipile/);
  assert.match(html, /href="\/users\/user-1\/connections"/);
  assert.match(html, /Open connections/);
});

test("buildExecutionViewModel surfaces multiple unipile accounts as separate claim rows", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-execution-view-unipile-hints-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.unipile]",
      "enabled = true",
      "",
    ].join("\n"),
  );

  try {
    const model = buildExecutionViewModel({
      rawUsers: [rawUser()],
      rawMotions: [],
      rawCompanies: [],
      rawProfiles: [],
      runtimeAccountDiscovery: {
        runtime: "codex",
        codexHome,
        runtimeAccountHints: [
          {
            runtime: "codex",
            connector: "unipile",
            capability: "gmail",
            providerAccountId: "acct-mail-1",
            handle: "operator-linkedin@example.com",
            label: "William Flanagan",
          },
          {
            runtime: "codex",
            connector: "unipile",
            capability: "gmail",
            providerAccountId: "acct-mail-2",
            handle: "secondary-gmail@example.com",
            label: "William Flanagan Knit",
          },
          {
            runtime: "codex",
            connector: "unipile",
            capability: "linkedin",
            providerAccountId: "acct-linkedin-1",
            handle: "williamflanagan",
            label: "William Flanagan",
          },
        ],
      },
    });

    assert.equal(model.users.length, 1);
    assert.equal(model.users[0].unclaimedAccountCount, 3);

    const gmailHandles = model.users[0].unclaimedAccounts
      .filter((account) => account.connector === "unipile" && account.capability === "gmail")
      .map((account) => account.handle)
      .sort();
    const linkedin = model.users[0].unclaimedAccounts.find((account) =>
      account.connector === "unipile" && account.capability === "linkedin"
    );

    assert.deepEqual(gmailHandles, ["operator-linkedin@example.com", "secondary-gmail@example.com"]);
    assert.equal(linkedin?.handle, "williamflanagan");
    assert.equal(linkedin?.canClaim, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("execution roster no longer renders workspace settings controls", () => {
  const model = buildExecutionViewModel({
    rawUsers: [rawUser()],
    rawMotions: [],
    rawCompanies: [],
    rawProfiles: [],
  });

  const html = renderExecutionPage(model, { interactive: true });
  assert.doesNotMatch(html, /Workspace enrichment/i);
  assert.doesNotMatch(html, /data-exo-writer="toggleWorkspaceEnrichmentProvider"/);
  assert.doesNotMatch(html, /data-exo-writer="setWorkspacePhoneEnrichmentPolicy"/);
});
