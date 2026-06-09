// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderOnboardingPage } from "../src/artifacts/render-onboarding.js";
import { buildOnboardingState } from "../src/core/onboarding.js";

function baseUser(overrides = {}) {
  return {
    id: "user-1",
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    label: "operator-main",
    ...overrides,
  };
}

function withCodexHome(t, configLines) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-onboarding-ui-"));
  const codexHome = path.join(tempDir, ".codex");
  const previousCodexHome = process.env.CODEX_HOME;

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "config.toml"), `${configLines.join("\n")}\n`);
  process.env.CODEX_HOME = codexHome;

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousCodexHome == null) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  });

  return tempDir;
}

test("onboarding page explains the managed-account gate and recommended services", (t) => {
  const tempDir = withCodexHome(t, [
    '[plugins."gmail@openai-curated"]',
    "enabled = true",
    "",
    '[plugins."hubspot@openai-curated"]',
    "enabled = true",
    "",
    "[mcp_servers.unipile]",
    "enabled = true",
  ]);

  const onboarding = buildOnboardingState({
    rawUsers: [baseUser()],
    rawProfiles: [],
    rawMotions: [],
    rawCompanies: [],
  }, {
    cwd: tempDir,
    env: process.env,
  });

  const html = renderOnboardingPage(onboarding, { interactive: true });
  assert.match(html, /Chrome or stored profile clues do not clear this step\./);
  assert.match(html, /Gmail, HubSpot, or Unipile can clear onboarding\./);
  assert.match(html, /Without a managed account, Exo stays in onboarding\./);
  assert.match(html, /Exo can look broken when the underlying ChatGPT plan has hit its rate limits\./);
  assert.match(html, /Free and Go plans will usually hit limits quickly during setup or sustained operator use\./);
  assert.match(html, /Plus can work for lighter use, but Pro is the recommended plan for sustained Exo operation\./);
  assert.match(html, /Unipile is visible in this runtime, but no governed LinkedIn account is mapped yet\./);
  assert.match(html, /href="https:\/\/www\.unipile\.com\/"/);
  assert.match(html, /href="https:\/\/developer\.unipile\.com\/docs\/getting-started"/);
  assert.match(html, /href="https:\/\/www\.hubspot\.com\/products\/crm"/);
  assert.match(html, /href="https:\/\/chatgpt\.com\/pricing\/"/);
});

test("onboarding page keeps LinkedIn blocked when only Gmail is mapped", (t) => {
  const tempDir = withCodexHome(t, [
    '[plugins."gmail@openai-curated"]',
    "enabled = true",
  ]);

  const onboarding = buildOnboardingState({
    rawUsers: [baseUser({
      accounts: [
        {
          id: "gmail-account",
          createdAt: "2026-06-09T00:00:00.000Z",
          updatedAt: "2026-06-09T00:00:00.000Z",
          capability: "gmail",
          handle: "operator@example.com",
          sourceType: "harness-connection",
          harnessConnectionId: "gmail-harness",
          providerAccountId: "acct-gmail-1",
          preferred: true,
        },
      ],
      harnessConnections: [
        {
          id: "gmail-harness",
          createdAt: "2026-06-09T00:00:00.000Z",
          updatedAt: "2026-06-09T00:00:00.000Z",
          runtime: "codex",
          connector: "gmail",
          status: "available",
        },
      ],
    })],
    rawProfiles: [],
    rawMotions: [],
    rawCompanies: [],
  }, {
    cwd: tempDir,
    env: process.env,
  });

  assert.deepEqual(onboarding.user.focusUser?.managedCapabilities, ["gmail"]);

  const html = renderOnboardingPage(onboarding, { interactive: true });
  assert.match(html, /A governed Gmail account is mapped\./);
  assert.match(html, /Skipping Unipile does not break Gmail if a mailbox is mapped here\./);
  assert.match(html, /LinkedIn work still needs one governed account\. Chrome alone does not count\./);
  assert.match(html, /Add Unipile if you want governed LinkedIn execution\./);
});
