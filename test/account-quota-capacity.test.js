// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

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

test("daily uses governed harness-account quotas for linkedin pacing and preserves the preferred account on update", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-account-quota-capacity-"));
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
        "--provider-account-id",
        "acct-linkedin-1",
        "--preferred",
        "--json"
      ],
      {
        env: {
          CODEX_HOME: codexHome
        }
      }
    );

    const beforeQuotaDaily = runCliJson(tempDir, ["daily", "--user", user.id, "--json"], {
      env: {
        CODEX_HOME: codexHome
      }
    });

    assert.equal(beforeQuotaDaily.capacity.linkedin.status, "needs_configuration");
    assert.equal(beforeQuotaDaily.items[0].cadenceEffect, "capacity_configuration_needed");
    assert.equal(beforeQuotaDaily.items[0].source.kind, "configure_connection_request_quota");
    assert.equal(beforeQuotaDaily.items[0].guidance.key, "configure_connection_request_quota");
    assert.match(beforeQuotaDaily.items[0].recommendedAction, /set a durable linkedin connection-request quota/i);
    assert.match(beforeQuotaDaily.items[0].guidance.writeback[0], /exo users accounts add/);
    assert.match(beforeQuotaDaily.items[0].guidance.writeback[0], /--runtime codex --connector unipile/);
    assert.match(beforeQuotaDaily.items[0].guidance.writeback[0], /--provider-account-id acct-linkedin-1/);
    assert.match(beforeQuotaDaily.items[0].guidance.writeback[0], /--preferred --max-connection-requests <weekly-count> --json/);

    const updatedUser = runCliJson(
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
        "--provider-account-id",
        "acct-linkedin-1",
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

    const linkedinAccount = updatedUser.accounts.find((account) => account.capability === "linkedin");
    assert.ok(linkedinAccount);
    assert.equal(linkedinAccount.preferred, true);
    assert.equal(linkedinAccount.automationControls.weeklyQuotas.invitations, 125);

    const afterQuotaDaily = runCliJson(tempDir, ["daily", "--user", user.id, "--json"], {
      env: {
        CODEX_HOME: codexHome
      }
    });

    assert.equal(afterQuotaDaily.capacity.linkedin.status, "configured");
    assert.equal(afterQuotaDaily.capacity.linkedin.quota.weeklyInvitations, 125);
    assert.equal(afterQuotaDaily.capacity.linkedin.quota.dailyInvitationsTarget, 25);
    assert.equal(afterQuotaDaily.capacity.linkedin.account.displayLabel, "quota-user-linkedin");
    assert.equal(afterQuotaDaily.capacity.linkedin.execution.sentToday, 0);
    assert.equal(afterQuotaDaily.capacity.linkedin.execution.pendingInvitations, 0);
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
      "--max-connection-requests",
      "125",
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
