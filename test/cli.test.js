// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const offerHtml = [
  "<html>",
  "<head>",
  "<title>Actico Risk Platform</title>",
  '<meta name="description" content="Credit and risk decisioning for regulated lenders." />',
  "</head>",
  "<body>ok</body>",
  "</html>"
].join("");
const offerUrl = `data:text/html,${encodeURIComponent(offerHtml)}`;

test("motion add seeds a motion and motion list sees it in the same workspace", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-cli-"));

  try {
    const defineOutput = execFileSync(
      "node",
      [
        cliPath,
        "motion", "add",
        "--url",
        offerUrl,
        "--geo",
        "United States",
        "--industry",
        "banking,lending",
        "--title",
        "Chief Risk Officer",
        "--segment",
        "traditional-fi",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const motion = JSON.parse(defineOutput);
    assert.equal(motion.offer.sourceUrl, offerUrl);
    assert.equal(motion.offerThesis.sourceTitle, "Actico Risk Platform");
    assert.equal(
      motion.offerThesis.sourceDescription,
      "Credit and risk decisioning for regulated lenders."
    );
    assert.deepEqual(motion.targetingProfile.industries, ["banking", "lending"]);
    assert.ok(fs.existsSync(path.join(tempDir, ".exo", "exo.db")));

    const listOutput = execFileSync("node", [cliPath, "motion", "list"], {
      cwd: tempDir,
      encoding: "utf8"
    });

    assert.match(listOutput, new RegExp(motion.id));
    assert.match(listOutput, /draft/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("profiles add/list/test persists a browser profile with a passing local check", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-profiles-"));
  const userDataDir = path.join(tempDir, "Chrome");
  const profileDirectory = "Profile 7";
  const profilePath = path.join(userDataDir, profileDirectory);

  fs.mkdirSync(profilePath, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          [profileDirectory]: {
            name: "Work LinkedIn"
          }
        }
      }
    })
  );
  fs.writeFileSync(
    path.join(profilePath, "Preferences"),
    JSON.stringify({
      profile: {
        name: "Work LinkedIn"
      }
    })
  );
  fs.writeFileSync(path.join(profilePath, "Cookies"), "");
  fs.writeFileSync(path.join(profilePath, "History"), "");

  try {
    const addOutput = execFileSync(
      "node",
      [
        cliPath,
        "profiles",
        "add",
        "--browser",
        "chrome",
        "--label",
        "work-linkedin",
        "--user-data-dir",
        userDataDir,
        "--profile-directory",
        profileDirectory,
        "--browser-command",
        "/bin/echo",
        "--capability",
        "linkedin",
        "--capability",
        "sales-navigator",
        "--json"
      ],
      {
        cwd: tempDir,
        encoding: "utf8"
      }
    );

    const profile = JSON.parse(addOutput);
    assert.equal(profile.status, "ready");
    assert.equal(profile.detectedProfileName, "Work LinkedIn");
    assert.equal(profile.profilePath, profilePath);
    assert.deepEqual(profile.capabilities, ["linkedin", "sales-navigator"]);

    const listOutput = execFileSync("node", [cliPath, "profiles", "list"], {
      cwd: tempDir,
      encoding: "utf8"
    });
    assert.match(listOutput, new RegExp(profile.id));
    assert.match(listOutput, /work-linkedin/);

    const testOutput = execFileSync("node", [cliPath, "profiles", "test", profile.id, "--json"], {
      cwd: tempDir,
      encoding: "utf8"
    });
    const retested = JSON.parse(testOutput);
    assert.equal(retested.status, "ready");
    assert.equal(retested.lastTestResult.status, "ready");
    assert.equal(retested.detectedProfileName, "Work LinkedIn");

    const removeOutput = execFileSync("node", [cliPath, "profiles", "remove", profile.id], {
      cwd: tempDir,
      encoding: "utf8"
    });
    assert.match(removeOutput, /Removed browser profile/);

    const emptyListOutput = execFileSync("node", [cliPath, "profiles", "list"], {
      cwd: tempDir,
      encoding: "utf8"
    });
    assert.match(emptyListOutput, /No browser profiles found/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI help explains agent-safe usage and profile gating", () => {
  const topLevelHelp = execFileSync("node", [cliPath, "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(topLevelHelp, /Prefer --json when Claude\/Codex is calling Exo/);
  assert.match(topLevelHelp, /Register and test a browser profile before any browser-backed work/);
  assert.match(topLevelHelp, /Current state location:/);

  const profilesHelp = execFileSync("node", [cliPath, "profiles", "add", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(profilesHelp, /Default paths are currently macOS-oriented/);
  assert.match(profilesHelp, /This command immediately runs a local profile verification pass/);

  const motionHelp = execFileSync("node", [cliPath, "motion", "add", "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.match(motionHelp, /Use explicit excludes and DNC input up front/);
  assert.match(motionHelp, /Use --json when another agent needs the full motion object/);
});

test("what-is-this returns machine-readable orientation for agents", () => {
  const output = execFileSync("node", [cliPath, "what-is-this", "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  const about = JSON.parse(output);
  assert.equal(about.name, "Exo");
  assert.equal(about.agentUsage.preferJson, true);
  assert.match(about.identity.oneLiner, /GTM operating kernel/i);
  assert.ok(
    about.currentCapabilities.some((item) => item.command === "exo what-is-this"),
    "expected identity command to be listed in current capabilities"
  );
  assert.ok(
    about.browserProfileRules.some((item) => /fail closed/i.test(item)),
    "expected browser profile rules to mention fail-closed behavior"
  );
});

test("multiple agent processes can share one Exo state store through EXO_STATE_DIR", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-concurrency-"));
  const sharedStateDir = path.join(tempDir, "shared-state");
  const workerA = path.join(tempDir, "worker-a");
  const workerB = path.join(tempDir, "worker-b");
  fs.mkdirSync(workerA, { recursive: true });
  fs.mkdirSync(workerB, { recursive: true });

  const run = (cwd, index) =>
    new Promise((resolve, reject) => {
      execFile(
        "node",
        [
          cliPath,
          "motion", "add",
          "--url",
          offerUrl,
          "--geo",
          `Region-${index}`,
          "--title",
          `Role-${index}`,
          "--json"
        ],
        {
          cwd,
          env: {
            ...process.env,
            EXO_STATE_DIR: sharedStateDir
          },
          encoding: "utf8"
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
            return;
          }

          resolve(JSON.parse(stdout));
        }
      );
    });

  try {
    const motions = await Promise.all([
      run(workerA, 1),
      run(workerB, 2),
      run(workerA, 3),
      run(workerB, 4)
    ]);

    const listed = execFileSync("node", [cliPath, "motion", "list", "--json"], {
      cwd: workerA,
      env: {
        ...process.env,
        EXO_STATE_DIR: sharedStateDir
      },
      encoding: "utf8"
    });

    const allMotions = JSON.parse(listed);
    assert.equal(allMotions.length, 4);
    for (const motion of motions) {
      assert.ok(
        allMotions.some((listedMotion) => listedMotion.id === motion.id),
        `expected shared store to contain motion ${motion.id}`
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
