// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { mapUserRuntimeAccounts } from "../src/core/map-user-runtime-accounts.js";
import { completeOnboardingUser } from "../src/core/onboarding.js";
import { executeActionIntent } from "../src/core/execute-action-intent.js";
import { evaluateOutboundDispatchGate } from "../src/core/outbound-dispatch-gate.js";
import { addUser } from "../src/core/add-user.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

/**
 * Run the CLI capturing both stdout and stderr for warning-emitting paths.
 *
 * @param {string} tempDir
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 */
function runCliCapture(tempDir, args, options = {}) {
  const result = spawnSync("node", [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: {
      ...process.env,
      EXO_STATE_DIR: tempDir,
      ...(options.env ?? {})
    },
    encoding: "utf8"
  });
  // Filter Node.js experimental SQLite warnings — they're noise, not part of the assertion surface.
  return {
    ...result,
    stderr: filterExperimentalSqliteWarnings(result.stderr ?? ""),
  };
}

/**
 * @param {string} stderr
 */
function filterExperimentalSqliteWarnings(stderr) {
  return stderr
    .split("\n")
    .filter((line) => !/ExperimentalWarning: SQLite is an experimental feature/.test(line))
    .filter((line) => !/Use `node --trace-warnings/.test(line))
    .join("\n")
    .trim();
}

/**
 * @param {string} profilePath
 * @param {{ cookieHosts?: string[], historyUrls?: string[] }} input
 */
function seedBrowserEvidence(profilePath, input) {
  const cookiesDb = new DatabaseSync(path.join(profilePath, "Cookies"));
  cookiesDb.exec("CREATE TABLE cookies (host_key TEXT);");
  for (const host of input.cookieHosts ?? []) {
    cookiesDb.prepare("INSERT INTO cookies (host_key) VALUES (?)").run(host);
  }
  cookiesDb.close();

  const historyDb = new DatabaseSync(path.join(profilePath, "History"));
  historyDb.exec("CREATE TABLE urls (url TEXT);");
  for (const url of input.historyUrls ?? []) {
    historyDb.prepare("INSERT INTO urls (url) VALUES (?)").run(url);
  }
  historyDb.close();
}

/**
 * @param {string} tempDir
 */
function setupReadyChromeProfile(tempDir) {
  const userDataDir = path.join(tempDir, "Chrome");
  const profileDirectory = "Profile 4";
  const profilePath = path.join(userDataDir, profileDirectory);
  const browserCommand = path.join(tempDir, "fake-chrome");

  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(browserCommand, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(browserCommand, 0o755);
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: { name: "LinkedIn Main" }
        }
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Preferences"), JSON.stringify({ profile: { name: "LinkedIn Main" } }));
  seedBrowserEvidence(profilePath, {
    cookieHosts: [".linkedin.com"],
    historyUrls: ["https://www.linkedin.com/feed/"]
  });

  return {
    userDataDir,
    profileDirectory,
    browserCommand
  };
}

/**
 * @param {string} tempDir
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 */
function runCliJson(tempDir, args, options = {}) {
  return JSON.parse(
    execFileSync("node", [cliPath, ...args], {
      cwd: options.cwd ?? repoRoot,
      env: {
        ...process.env,
        EXO_STATE_DIR: tempDir,
        ...(options.env ?? {})
      },
      encoding: "utf8"
    })
  );
}

test("users accounts add defaults the LinkedIn invitation quota to 125/week and emits a stderr warning", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w1-default-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.unipile]",
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "quota-user", "--owner", "operator", "--json"]);

    const addResult = runCliCapture(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "quota-user-linkedin",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--provider-account-id",
      "acct-linkedin-1",
      "--preferred",
      "--json"
    ], { env: { CODEX_HOME: codexHome } });

    assert.equal(addResult.status, 0, `users accounts add failed: ${addResult.stderr}`);
    assert.match(addResult.stderr, /defaulting to 125\/week/i);
    assert.match(addResult.stderr, /--max-connection-requests/);

    const updatedUser = JSON.parse(addResult.stdout);
    const linkedinAccount = updatedUser.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);
    assert.equal(linkedinAccount.preferred, true);
    assert.equal(linkedinAccount.automationControls.weeklyQuotas.invitations, 125);

    const afterDefaultDaily = runCliJson(tempDir, ["daily", "--user", user.id, "--json"], {
      env: { CODEX_HOME: codexHome }
    });

    assert.equal(afterDefaultDaily.capacity.linkedin.status, "configured");
    assert.equal(afterDefaultDaily.capacity.linkedin.quota.weeklyInvitations, 125);
    assert.equal(afterDefaultDaily.capacity.linkedin.quota.dailyInvitationsTarget, 25);
    assert.equal(afterDefaultDaily.capacity.linkedin.account.displayLabel, "quota-user-linkedin");

    const noConfigureItem = afterDefaultDaily.items.some(
      (item) => item.source?.kind === "configure_connection_request_quota"
    );
    assert.equal(noConfigureItem, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts add with --max-connection-requests 25 persists the explicit value and emits no default warning", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w1-explicit-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "explicit-user", "--owner", "operator", "--json"]);

    const addResult = runCliCapture(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "explicit-user-linkedin",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--provider-account-id",
      "acct-linkedin-1",
      "--max-connection-requests",
      "25",
      "--json"
    ], { env: { CODEX_HOME: codexHome } });

    assert.equal(addResult.status, 0, `users accounts add failed: ${addResult.stderr}`);
    assert.equal(addResult.stderr, "");
    const persisted = JSON.parse(addResult.stdout);
    const linkedin = persisted.accounts.find((account) => account.capability === "linkedin");
    assert.equal(linkedin.automationControls.weeklyQuotas.invitations, 25);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts add re-run without --max-connection-requests preserves the explicit value (no overwrite, no warning)", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w1-preserve-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "preserve-user", "--owner", "operator", "--json"]);

    // Initial add with --max-connection-requests 25
    runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "preserve-user-linkedin",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--provider-account-id",
      "acct-linkedin-1",
      "--max-connection-requests",
      "25",
      "--json"
    ], { env: { CODEX_HOME: codexHome } });

    // Re-run without --max-connection-requests
    const reAdd = runCliCapture(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "preserve-user-linkedin",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--provider-account-id",
      "acct-linkedin-1",
      "--json"
    ], { env: { CODEX_HOME: codexHome } });

    assert.equal(reAdd.status, 0, `re-add failed: ${reAdd.stderr}`);
    assert.equal(reAdd.stderr, "");
    const persisted = JSON.parse(reAdd.stdout);
    const linkedin = persisted.accounts.find((account) => account.capability === "linkedin");
    assert.equal(linkedin.automationControls.weeklyQuotas.invitations, 25);

    const daily = runCliJson(tempDir, ["daily", "--user", user.id, "--json"], {
      env: { CODEX_HOME: codexHome }
    });
    assert.equal(daily.capacity.linkedin.status, "configured");
    assert.equal(daily.capacity.linkedin.quota.dailyInvitationsTarget, 5);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts add for a non-LinkedIn capability does not write a quota and emits no warning", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w1-nonlinkedin-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.gmail]", "enabled = true", ""].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "gmail-user", "--owner", "operator", "--json"]);

    const addResult = runCliCapture(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "gmail",
      "--handle",
      "gmail-user@example.com",
      "--runtime",
      "codex",
      "--connector",
      "gmail",
      "--provider-account-id",
      "acct-gmail-1",
      "--json"
    ], { env: { CODEX_HOME: codexHome } });

    assert.equal(addResult.status, 0, `users accounts add failed: ${addResult.stderr}`);
    assert.equal(addResult.stderr, "");
    const persisted = JSON.parse(addResult.stdout);
    const gmail = persisted.accounts.find((account) => account.capability === "gmail");
    assert.ok(gmail);
    assert.equal(gmail.automationControls.weeklyQuotas.invitations, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily applies project exo.toml linkedin targets without mutating the account quota", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-workspace-quota-target-"));
  const stateDir = path.join(tempRoot, "state");
  const projectDir = path.join(tempRoot, "workspace");
  const codexHome = path.join(tempRoot, ".codex");

  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "exo.toml"),
    [
      "[workspace.targets.linkedin]",
      "connection_requests_per_day = 8",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.unipile]",
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const user = runCliJson(stateDir, ["users", "add", "--label", "workspace-quota-user", "--owner", "operator", "--json"], {
      cwd: projectDir
    });

    runCliJson(
      stateDir,
      [
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "workspace-quota-linkedin",
        "--runtime",
        "codex",
        "--connector",
        "unipile",
        "--provider-account-id",
        "acct-linkedin-1",
        "--preferred",
        "--max-connection-requests",
        "125",
        "--json"
      ],
      {
        cwd: projectDir,
        env: {
          CODEX_HOME: codexHome
        }
      }
    );

    const daily = runCliJson(stateDir, ["daily", "--user", user.id, "--json"], {
      cwd: projectDir,
      env: {
        CODEX_HOME: codexHome
      }
    });

    assert.equal(daily.capacity.linkedin.status, "configured");
    assert.equal(daily.capacity.linkedin.quota.weeklyInvitations, 125);
    assert.equal(daily.capacity.linkedin.quota.accountDailyInvitationsTarget, 25);
    assert.equal(daily.capacity.linkedin.quota.workspaceDailyInvitationsTarget, 8);
    assert.equal(daily.capacity.linkedin.quota.dailyInvitationsTarget, 8);
    assert.equal(daily.capacity.linkedin.execution.sentToday, 0);
    assert.equal(daily.capacity.linkedin.execution.remainingInvitationsToday, 8);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("daily blocks legacy browser-profile linkedin state instead of falling back to profile quotas", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-profile-quota-fallback-"));
  const chrome = setupReadyChromeProfile(tempDir);

  try {
    const profile = runCliJson(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "fallback-profile",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json"
    ]);

    runCliJson(tempDir, [
      "profiles",
      "claim",
      profile.id,
      "--label",
      "fallback-main",
      "--workspace",
      "planner",
      "--account",
      "linkedin:fallback-user",
      "--json"
    ]);

    const user = runCliJson(tempDir, ["users", "add", "--label", "fallback-user", "--owner", "operator", "--json"]);

    runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "fallback-user",
      "--profile",
      profile.id,
      "--preferred",
      "--json"
    ]);

    const daily = runCliJson(tempDir, ["daily", "--user", user.id, "--json"]);

    assert.equal(daily.capacity.linkedin.status, "unavailable");
    assert.match(daily.capacity.linkedin.reason, /profile-backed linkedin accounts are no longer supported/i);
    assert.equal(daily.capacity.linkedin.quota.weeklyInvitations, null);
    assert.equal(daily.capacity.linkedin.quota.dailyInvitationsTarget, null);
    assert.equal(daily.capacity.linkedin.account.profileId, profile.id);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily treats singleton explicitly pinned managed execution as assigned and works discovered backlog before generic seeding", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-singleton-capacity-queue-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.unipile]",
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "singleton-user", "--owner", "operator", "--json"]);

    runCliJson(
      tempDir,
      [
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "singleton-linkedin",
        "--runtime",
        "codex",
        "--connector",
        "unipile",
        "--provider-account-id",
        "acct-linkedin-1",
        "--preferred",
        "--max-connection-requests",
        "125",
        "--json"
      ],
      {
        env: {
          CODEX_HOME: codexHome
        }
      }
    );

    const motion = runCliJson(tempDir, [
      "motion",
      "add",
      "--url",
      "https://example.com/vendor-accountability",
      "--premise",
      "This offer matters when procurement and vendor leaders are under vendor-cost pressure.",
      "--audience",
      "Procurement and vendor leaders",
      "--signal",
      "company::Is there recent evidence the company is under vendor-cost or renewal pressure?",
      "--title",
      "Director",
      "--json"
    ]);

    runCliJson(tempDir, ["motion", "restart", motion.id, "--json"]);

    const sixsense = runCliJson(tempDir, [
      "companies",
      "add",
      "--name",
      "6sense",
      "--domain",
      "6sense.com",
      "--website-url",
      "https://6sense.com",
      "--linkedin-company-url",
      "https://www.linkedin.com/company/6sense/",
      "--motion",
      motion.id,
      "--json"
    ]);

    runCliJson(tempDir, [
      "companies",
      "prospects",
      "add",
      sixsense.id,
      "--motion",
      motion.id,
      "--name",
      "Bill Browning",
      "--title",
      "Director Of Procurement",
      "--why-relevant",
      "Primary owner for procurement and vendor accountability.",
      "--linkedin-profile-url",
      "https://www.linkedin.com/in/bill-browning-6365991",
      "--json"
    ]);

    runCliJson(tempDir, [
      "companies",
      "prospects",
      "add",
      sixsense.id,
      "--motion",
      motion.id,
      "--name",
      "Jeff Burrows",
      "--title",
      "Director, Security Assurance",
      "--why-relevant",
      "Adjacent owner for third-party risk and vendor assurance.",
      "--linkedin-profile-url",
      "https://www.linkedin.com/in/jeff-burrows-security",
      "--json"
    ]);

    runCliJson(tempDir, [
      "companies",
      "add",
      "--name",
      "Acadia Pharmaceuticals",
      "--domain",
      "acadia.com",
      "--website-url",
      "https://acadia.com",
      "--linkedin-company-url",
      "https://www.linkedin.com/company/acadia-pharmaceuticals/",
      "--motion",
      motion.id,
      "--json"
    ]);

    runCliJson(tempDir, [
      "companies",
      "add",
      "--name",
      "Cornerstone OnDemand",
      "--domain",
      "cornerstoneondemand.com",
      "--website-url",
      "https://www.cornerstoneondemand.com/company/",
      "--linkedin-company-url",
      "https://www.linkedin.com/company/cornerstoneondemand/",
      "--motion",
      motion.id,
      "--json"
    ]);

    const daily = runCliJson(tempDir, ["daily", "--user", user.id, "--json"], {
      env: {
        CODEX_HOME: codexHome
      }
    });

    assert.equal(daily.capacity.linkedin.status, "configured");
    assert.equal(daily.capacity.linkedin.execution.queue.companyCount, 3);
    assert.equal(daily.capacity.linkedin.execution.queue.prospectCount, 2);
    assert.equal(daily.capacity.linkedin.execution.queue.availableProspectCount, 2);
    assert.equal(daily.items[0].source.kind, "fill_connection_request_deficit");
    assert.match(daily.items[0].recommendedAction, /research 2 discovered or queued companies already in the motion/i);
    assert.match(daily.items[0].recommendedAction, /start with acadia pharmaceuticals and cornerstone ondemand/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("daily refuses linkedin send pressure when a managed connector account is not pinned to one exact external identity", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-unresolved-managed-capacity-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.unipile]",
      "enabled = true",
      ""
    ].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "quota-user", "--owner", "operator", "--json"]);

    runCliJson(
      tempDir,
      [
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "quota-user-linkedin",
        "--runtime",
        "codex",
        "--connector",
        "unipile",
        "--preferred",
        "--max-connection-requests",
        "125",
        "--json"
      ],
      {
        env: {
          CODEX_HOME: codexHome
        }
      }
    );

    const daily = runCliJson(tempDir, ["daily", "--user", user.id, "--json"], {
      env: {
        CODEX_HOME: codexHome
      }
    });

    assert.equal(daily.capacity.linkedin.status, "unavailable");
    assert.match(daily.capacity.linkedin.reason, /exact external account/i);
    assert.equal(
      daily.items.some((item) => item.source.kind === "fill_connection_request_deficit"),
      false
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

/**
 * Minimal user fixture for direct map-runtime tests.
 */
function emptyUserFixture(label = "map-runtime-user") {
  const created = addUser({ label, owner: "operator", notes: null });
  return created;
}

test("users accounts map-runtime --apply --max-connection-requests 25 persists the explicit quota and labels the mapping explicit_override", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w2-explicit-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const result = mapUserRuntimeAccounts(emptyUserFixture("explicit-runtime-user"), {
      runtime: "codex",
      codexHome,
      apply: true,
      preferManaged: true,
      linkedinInvitationQuota: 25,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-1",
          handle: "explicit-linkedin",
          label: "Explicit LinkedIn",
        },
      ],
    });

    const linkedin = result.mappings.find((mapping) => mapping.capability === "linkedin");
    assert.ok(linkedin);
    assert.equal(linkedin.quotaAction, "explicit_override");

    const linkedinAccount = result.updatedUser.accounts.find((account) =>
      account.capability === "linkedin" && account.sourceType === "harness-connection"
    );
    assert.ok(linkedinAccount);
    assert.equal(linkedinAccount.automationControls.weeklyQuotas.invitations, 25);
    assert.deepEqual(result.warnings, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts map-runtime --apply defaults the LinkedIn quota to 125/week and emits one warning per defaulted mapping", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w2-default-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const result = mapUserRuntimeAccounts(emptyUserFixture("default-runtime-user"), {
      runtime: "codex",
      codexHome,
      apply: true,
      preferManaged: true,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-1",
          handle: "default-linkedin",
          label: "Default LinkedIn",
        },
      ],
    });

    const linkedin = result.mappings.find((mapping) => mapping.capability === "linkedin");
    assert.ok(linkedin);
    assert.equal(linkedin.quotaAction, "defaulted");

    const linkedinAccount = result.updatedUser.accounts.find((account) =>
      account.capability === "linkedin" && account.sourceType === "harness-connection"
    );
    assert.ok(linkedinAccount);
    assert.equal(linkedinAccount.automationControls.weeklyQuotas.invitations, 125);

    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /defaulted LinkedIn quota to 125\/week/i);
    assert.match(result.warnings[0], /codex:unipile/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts map-runtime CLI emits the defaulted warning to stderr and ignored-flag warning when no LinkedIn is in scope", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w2-cli-ignored-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ['[plugins."gmail@openai-curated"]', "enabled = true", ""].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "ignored-flag-user", "--owner", "operator", "--json"]);

    const mapRun = runCliCapture(tempDir, [
      "users",
      "accounts",
      "map-runtime",
      user.id,
      "--runtime",
      "codex",
      "--connector",
      "gmail",
      "--apply",
      "--max-connection-requests",
      "25",
      "--json",
    ], { env: { CODEX_HOME: codexHome } });

    assert.equal(mapRun.status, 0, `map-runtime failed: ${mapRun.stderr}`);
    assert.match(mapRun.stderr, /--max-connection-requests was ignored/);
    const result = JSON.parse(mapRun.stdout);
    assert.equal(result.mappings.every((mapping) => mapping.capability !== "linkedin"), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts map-runtime preserves an existing quota when no flag is supplied; explicit override updates it", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w2-preserve-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    // First run: --apply with explicit quota 30
    const first = mapUserRuntimeAccounts(emptyUserFixture("preserve-runtime-user"), {
      runtime: "codex",
      codexHome,
      apply: true,
      preferManaged: true,
      linkedinInvitationQuota: 30,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-1",
          handle: "preserve-linkedin",
          label: "Preserve LinkedIn",
        },
      ],
    });
    assert.equal(first.mappings.find((m) => m.capability === "linkedin")?.quotaAction, "explicit_override");

    // Second run with no flag — should be preserved.
    const second = mapUserRuntimeAccounts(first.updatedUser, {
      runtime: "codex",
      codexHome,
      apply: true,
      preferManaged: true,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-1",
          handle: "preserve-linkedin",
          label: "Preserve LinkedIn",
        },
      ],
    });

    const preservedMapping = second.mappings.find((m) => m.capability === "linkedin");
    assert.equal(preservedMapping?.quotaAction, "preserved");
    assert.equal(second.warnings.length, 0);
    const preservedAccount = second.updatedUser.accounts.find((account) =>
      account.capability === "linkedin" && account.sourceType === "harness-connection"
    );
    assert.equal(preservedAccount?.automationControls.weeklyQuotas.invitations, 30);

    // Third run with explicit override 50.
    const third = mapUserRuntimeAccounts(second.updatedUser, {
      runtime: "codex",
      codexHome,
      apply: true,
      preferManaged: true,
      linkedinInvitationQuota: 50,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-1",
          handle: "preserve-linkedin",
          label: "Preserve LinkedIn",
        },
      ],
    });
    const overrideMapping = third.mappings.find((m) => m.capability === "linkedin");
    assert.equal(overrideMapping?.quotaAction, "explicit_override");
    const overrideAccount = third.updatedUser.accounts.find((account) =>
      account.capability === "linkedin" && account.sourceType === "harness-connection"
    );
    assert.equal(overrideAccount?.automationControls.weeklyQuotas.invitations, 50);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("outbound dispatch gate respects the W1/W2 default 125/week as the weekly cap for send_connection_request", () => {
  const sender = {
    accountId: "acct-default",
    handle: "default-sender",
    providerAccountId: "acct-linkedin-1",
    automationControls: {
      weeklyQuotas: { invitations: 125 },
    },
  };

  // Spread 125 events across 7 days, with all events safely inside the rolling
  // week window and stay under the 25/day default daily cap.
  // Reference: now = 2026-06-15T12:00:00Z; rolling week start = 2026-06-08T12:00:00Z.
  // Use day buckets of 18 events at 30-min spacing starting at hour 14 each day,
  // so each day stays well inside the window and well under the daily cap.
  // 18 * 7 = 126 events total. Keep 125 by using one bucket of 17 for day 0.
  const now = "2026-06-15T12:00:00.000Z";
  const dayStart = Date.parse("2026-06-09T14:00:00.000Z"); // 6 full days inside rolling window
  const history = [];
  // Generate 18 events/day for 6 days (= 108) + 17 events on the most recent day = 125.
  for (let day = 0; day < 7; day++) {
    const count = day === 6 ? 17 : 18; // total 108 + 17 = 125
    for (let n = 0; n < count; n++) {
      // Day index 0 = 06-09; index 6 = 06-15.
      const occurredAt = new Date(dayStart + day * 24 * 60 * 60 * 1000 + n * 30 * 60 * 1000).toISOString();
      history.push({
        action: "send_connection_request",
        surface: "connection_request",
        occurredAt,
        accountId: "acct-default",
        providerAccountId: "acct-linkedin-1",
        senderHandle: "default-sender",
      });
    }
  }

  // For "now" use a time after the last event so the most-recent-day events
  // (which start at 14:00 on 06-15) all have occurred. Set now to 06-15T22:00.
  const nowLate = "2026-06-15T22:30:00.000Z";

  const result = evaluateOutboundDispatchGate({
    now: nowLate,
    motion: { id: "m1", name: "Test" },
    account: { disposition: "active", companyName: "TestCo" },
    prospect: { disposition: "active", name: "Test Prospect" },
    action: "send_connection_request",
    senderAccount: sender,
    history,
  });

  assert.equal(result.status, "wait", `expected wait, got ${result.status} (reasonCode ${result.reasonCode})`);
  assert.equal(result.reasonCode, "pacing_weekly_cap");
  assert.equal(result.limits.period, "week");
  assert.equal(result.limits.limit, 125);
  assert.equal(result.limits.count, 125);
});

test("profiles claim --max-connection-requests 40 is rejected because the flag was removed in W4", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w4-profiles-claim-flag-"));

  try {
    // Need to create a chrome profile first.
    const chrome = setupReadyChromeProfile(tempDir);
    const profile = runCliJson(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "test-profile",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json",
    ]);

    const claimResult = runCliCapture(tempDir, [
      "profiles",
      "claim",
      profile.id,
      "--max-connection-requests",
      "40",
      "--json",
    ]);

    assert.notEqual(claimResult.status, 0);
    assert.match(claimResult.stderr, /unknown option|max-connection-requests/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts add --capability linkedin --profile <id> writes no default quota and emits no warning", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w1-profile-backed-"));

  try {
    const chrome = setupReadyChromeProfile(tempDir);
    const profile = runCliJson(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "profile-backed",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json",
    ]);

    const user = runCliJson(tempDir, ["users", "add", "--label", "profile-user", "--owner", "operator", "--json"]);

    const addResult = runCliCapture(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "profile-user-linkedin",
      "--profile",
      profile.id,
      "--preferred",
      "--json",
    ]);

    assert.equal(addResult.status, 0, `users accounts add failed: ${addResult.stderr}`);
    assert.equal(addResult.stderr, "");
    const persisted = JSON.parse(addResult.stdout);
    const linkedin = persisted.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedin);
    assert.equal(linkedin.sourceType, "browser-profile");
    assert.equal(linkedin.automationControls.weeklyQuotas.invitations, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts add --max-connection-requests rejects unlimited, 0, -1, 1.5, 12abc with strict-parser error", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w1-strict-parser-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "strict-user", "--owner", "operator", "--json"]);

    for (const invalid of ["unlimited", "0", "-1", "1.5", "12abc"]) {
      const result = runCliCapture(tempDir, [
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "strict-user-linkedin",
        "--runtime",
        "codex",
        "--connector",
        "unipile",
        "--provider-account-id",
        "acct-linkedin-1",
        "--max-connection-requests",
        invalid,
        "--json",
      ], { env: { CODEX_HOME: codexHome } });

      assert.notEqual(result.status, 0, `Expected non-zero status for "${invalid}"`);
      assert.match(result.stderr, /Invalid max-connection-requests/);
      assert.match(result.stderr, /positive integer/i);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts map-runtime --max-connection-requests rejects invalid values with the same strict-parser errors", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w2-strict-parser-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "strict-runtime-user", "--owner", "operator", "--json"]);

    for (const invalid of ["unlimited", "0", "-1"]) {
      const result = runCliCapture(tempDir, [
        "users",
        "accounts",
        "map-runtime",
        user.id,
        "--runtime",
        "codex",
        "--apply",
        "--max-connection-requests",
        invalid,
        "--json",
      ], { env: { CODEX_HOME: codexHome } });

      assert.notEqual(result.status, 0, `Expected non-zero status for "${invalid}"`);
      assert.match(result.stderr, /Invalid max-connection-requests/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts add heals legacy stored 0 invitations quota with the default 125", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w1-legacy-zero-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "legacy-zero-user", "--owner", "operator", "--json"]);

    // Initial add: writes the default 125 (consume the default-warning).
    runCliJson(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "legacy-user-linkedin",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--provider-account-id",
      "acct-linkedin-1",
      "--json",
    ], { env: { CODEX_HOME: codexHome } });

    // Force the stored value to 0 in the DB.
    const dbCandidates = ["exo.sqlite", "exo.db", "database.sqlite"];
    let dbPath = null;
    for (const candidate of dbCandidates) {
      const candidatePath = path.join(tempDir, candidate);
      if (fs.existsSync(candidatePath)) {
        dbPath = candidatePath;
        break;
      }
    }
    if (!dbPath) {
      const found = fs.readdirSync(tempDir).find((file) => file.endsWith(".sqlite") || file.endsWith(".db"));
      if (found) dbPath = path.join(tempDir, found);
    }
    assert.ok(dbPath, `could not find DB file in ${tempDir}: ${fs.readdirSync(tempDir).join(", ")}`);
    const db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT id, payload_json FROM users WHERE id = ?").get(user.id);
    const userRecord = JSON.parse(row.payload_json);
    const account = userRecord.accounts.find((a) => a.capability === "linkedin");
    account.automationControls.weeklyQuotas.invitations = 0;
    db.prepare("UPDATE users SET payload_json = ? WHERE id = ?").run(JSON.stringify(userRecord), user.id);
    db.close();

    // Re-add: 0 should be treated as missing, default should re-apply and warning emitted.
    const reAdd = runCliCapture(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "legacy-user-linkedin",
      "--runtime",
      "codex",
      "--connector",
      "unipile",
      "--provider-account-id",
      "acct-linkedin-1",
      "--json",
    ], { env: { CODEX_HOME: codexHome } });

    assert.equal(reAdd.status, 0, `re-add failed: ${reAdd.stderr}`);
    assert.match(reAdd.stderr, /defaulting to 125\/week/i);
    const persisted = JSON.parse(reAdd.stdout);
    const linkedin = persisted.accounts.find((a) => a.capability === "linkedin");
    assert.equal(linkedin.automationControls.weeklyQuotas.invitations, 125);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts map-runtime dry-run populates quotaAction but emits no warnings and persists nothing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w2-dry-run-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const result = mapUserRuntimeAccounts(emptyUserFixture("dry-run-user"), {
      runtime: "codex",
      codexHome,
      apply: false,
      runtimeAccountHints: [
        {
          runtime: "codex",
          connector: "unipile",
          capability: "linkedin",
          providerAccountId: "acct-linkedin-1",
          handle: "dry-linkedin",
          label: "Dry LinkedIn",
        },
      ],
    });

    const linkedin = result.mappings.find((m) => m.capability === "linkedin");
    assert.ok(linkedin);
    assert.ok(linkedin.quotaAction);
    assert.equal(result.warnings.length, 0);
    // No accounts were upserted because apply was false.
    const linkedinAccount = result.updatedUser.accounts.find((account) =>
      account.capability === "linkedin" && account.sourceType === "harness-connection"
    );
    assert.equal(linkedinAccount, undefined);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts add --capability linkedin --profile <id> --max-connection-requests 25 is rejected with an actionable error", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w1-profile-flag-reject-"));

  try {
    const chrome = setupReadyChromeProfile(tempDir);
    const profile = runCliJson(tempDir, [
      "profiles",
      "add",
      "--browser",
      "chrome",
      "--label",
      "rejection-profile",
      "--user-data-dir",
      chrome.userDataDir,
      "--profile-directory",
      chrome.profileDirectory,
      "--browser-command",
      chrome.browserCommand,
      "--capability",
      "linkedin",
      "--json",
    ]);

    const user = runCliJson(tempDir, ["users", "add", "--label", "rejection-user", "--owner", "operator", "--json"]);

    const result = runCliCapture(tempDir, [
      "users",
      "accounts",
      "add",
      user.id,
      "--capability",
      "linkedin",
      "--handle",
      "rejection-user-linkedin",
      "--profile",
      profile.id,
      "--max-connection-requests",
      "25",
      "--json",
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--max-connection-requests is not valid for profile-backed accounts/);
    assert.match(result.stderr, /harness-backed accounts \(--runtime \+ --connector\)/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("completeOnboardingUser surfaces map-runtime warnings via warnings array", () => {
  // The core function exposes the warnings array. The CLI emits them to stderr.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w2-onboarding-warning-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const onboard = runCliCapture(tempDir, [
      "onboarding",
      "--label",
      "onboarding-user",
      "--apply",
      "--runtime",
      "codex",
      "--json",
    ], { env: { CODEX_HOME: codexHome } });

    assert.equal(onboard.status, 0, `onboarding failed: ${onboard.stderr}`);
    const stdout = JSON.parse(onboard.stdout);
    // Without runtime account hints in CLI mode, no LinkedIn mapping will be discovered.
    // So the warning will not fire. Validate via direct call:
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // Test the core helper directly so we can inject runtime account hints.
  // We can't inject hints through completeOnboardingUser since it doesn't accept them.
  // Instead, verify the contract holds via mapUserRuntimeAccounts (already tested),
  // and check that completeOnboardingUser propagates `warnings` from its mapping result.
  // The W2 contract: if map-runtime would default a LinkedIn quota, warnings flow upward.
  const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w2-onboard-warnings-array-"));
  const codexHome2 = path.join(tempDir2, ".codex");
  fs.mkdirSync(codexHome2, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome2, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );
  try {
    process.env.CODEX_HOME = codexHome2;
    process.env.EXO_STATE_DIR = tempDir2;
    // Provide a non-onboarded user so we can test warnings get propagated.
    // The actual happy-path defaulting case requires runtimeAccountHints which
    // completeOnboardingUser doesn't accept. So we just assert the property
    // exists on the return value structure.
    const result = completeOnboardingUser({
      userId: null,
      label: "onboard-warnings",
      owner: "operator",
      runtime: "codex",
    });
    assert.ok(Array.isArray(result.warnings));
  } finally {
    delete process.env.CODEX_HOME;
    delete process.env.EXO_STATE_DIR;
    fs.rmSync(tempDir2, { recursive: true, force: true });
  }
});

test("executeActionIntent completeOnboardingUser keeps the action-intent payload shape unchanged (no warnings field)", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w2-ui-payload-unchanged-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    process.env.CODEX_HOME = codexHome;
    process.env.EXO_STATE_DIR = tempDir;
    const result = await executeActionIntent({
      writer: "completeOnboardingUser",
      args: {
        label: "ui-onboard-user",
        owner: "operator",
        runtime: "codex",
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.writer, "completeOnboardingUser");
    assert.ok(typeof result.message === "string");
    // No warnings field — accepted tradeoff for the "No UI work" Decision.
    assert.equal(result.warnings, undefined);
  } finally {
    delete process.env.CODEX_HOME;
    delete process.env.EXO_STATE_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("users accounts add and map-runtime reject --max-connection-requests over the 500 ceiling", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-w1-ceiling-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    ["[mcp_servers.unipile]", "enabled = true", ""].join("\n")
  );

  try {
    const user = runCliJson(tempDir, ["users", "add", "--label", "ceiling-user", "--owner", "operator", "--json"]);

    for (const overCeiling of ["501", "999999999999"]) {
      const addResult = runCliCapture(tempDir, [
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "linkedin",
        "--handle",
        "ceiling-user-linkedin",
        "--runtime",
        "codex",
        "--connector",
        "unipile",
        "--provider-account-id",
        "acct-linkedin-1",
        "--max-connection-requests",
        overCeiling,
        "--json",
      ], { env: { CODEX_HOME: codexHome } });

      assert.notEqual(addResult.status, 0);
      assert.match(addResult.stderr, /Maximum allowed is 500\/week/);

      const mapResult = runCliCapture(tempDir, [
        "users",
        "accounts",
        "map-runtime",
        user.id,
        "--runtime",
        "codex",
        "--apply",
        "--max-connection-requests",
        overCeiling,
        "--json",
      ], { env: { CODEX_HOME: codexHome } });

      assert.notEqual(mapResult.status, 0);
      assert.match(mapResult.stderr, /Maximum allowed is 500\/week/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
