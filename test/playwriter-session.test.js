// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildPlaywriterTargetUrl,
  ensurePlaywriterSession,
  pageProbeNeedsFreshSession,
  parsePlaywriterSessionId,
  parsePlaywriterSessionList,
  resolvePlaywriterProfileBinding,
  shouldRetryTransientPlaywriterPageProbe,
} from "../src/lib/playwriter-session.js";

test("parsePlaywriterSessionList reads the tabular session output", () => {
  const records = parsePlaywriterSessionList(`
ID  BROWSER  PROFILE                 EXT                            STATE KEYS
------------------------------------------------------------------------------
1   Chrome   wflanagan@audienti.com  profile:116287799130733858842  page
2   Chrome   other@example.com       profile:999                    -
`);

  assert.deepEqual(records, [
    {
      sessionId: "1",
      browser: "Chrome",
      profile: "wflanagan@audienti.com",
      browserKey: "profile:116287799130733858842",
      stateKeys: "page",
    },
    {
      sessionId: "2",
      browser: "Chrome",
      profile: "other@example.com",
      browserKey: "profile:999",
      stateKeys: "-",
    },
  ]);
});

test("parsePlaywriterSessionId handles both plain and verbose session output", () => {
  assert.equal(parsePlaywriterSessionId("1\n"), "1");
  assert.equal(parsePlaywriterSessionId("Session 7 created\n"), "7");
  assert.equal(parsePlaywriterSessionId("no session\n"), null);
});

test("resolvePlaywriterProfileBinding derives the browser key from Chrome profile files", () => {
  const { chromeUserDataDir } = writeChromeProfileFixture();

  const binding = resolvePlaywriterProfileBinding({
    profileDirectory: "Profile 4",
    chromeUserDataDir,
  });

  assert.equal(binding.userName, "wflanagan@audienti.com");
  assert.equal(binding.gaiaId, "116287799130733858842");
  assert.equal(binding.browserKey, "profile:116287799130733858842");
  assert.deepEqual(binding.accountEmails, ["wflanagan@audienti.com"]);
});

test("buildPlaywriterTargetUrl maps supported retrieval capabilities", () => {
  assert.equal(buildPlaywriterTargetUrl({ capability: "gmail" }), "https://mail.google.com/mail/u/0/#inbox");
  assert.equal(buildPlaywriterTargetUrl({ capability: "linkedin" }), "https://www.linkedin.com/feed/");
});

test("shouldRetryTransientPlaywriterPageProbe matches transport flake but not structural window gaps", () => {
  assert.equal(
    shouldRetryTransientPlaywriterPageProbe({ error: "Error: fetch failed" }),
    true,
  );
  assert.equal(
    shouldRetryTransientPlaywriterPageProbe({ error: "socket hang up while probing page" }),
    true,
  );
  assert.equal(
    shouldRetryTransientPlaywriterPageProbe({ error: "no current window" }),
    false,
  );
});

test("pageProbeNeedsFreshSession matches relay races that invalidate the just-created session", () => {
  assert.equal(
    pageProbeNeedsFreshSession({ error: "Error: 404 {\"text\":\"Session 2 not found. Run 'playwriter session new' first.\"}" }),
    true,
  );
  assert.equal(
    pageProbeNeedsFreshSession({ error: "Error: fetch failed" }),
    false,
  );
});

test("ensurePlaywriterSession recycles a stale reused session before returning", () => {
  const { chromeUserDataDir, tempRoot } = writeChromeProfileFixture();
  const statePath = path.join(tempRoot, "playwriter-state.json");
  fs.writeFileSync(statePath, JSON.stringify({
    currentSessionId: "26",
    staleProbeCount: 0,
    createdFresh: false,
  }));

  const playwriterBin = path.join(tempRoot, "fake-playwriter.js");
  fs.writeFileSync(playwriterBin, `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.EXO_FAKE_PLAYWRITER_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const profile = "wflanagan@audienti.com";
const browserKey = "profile:116287799130733858842";
function save() {
  fs.writeFileSync(statePath, JSON.stringify(state));
}
function printList() {
  const currentSessionId = state.currentSessionId;
  const rows = currentSessionId
    ? [currentSessionId, "Chrome", profile, browserKey, "page"].join("  ")
    : "";
  process.stdout.write([
    "ID  BROWSER  PROFILE                 EXT                            STATE KEYS",
    "------------------------------------------------------------------------------",
    rows,
    "",
  ].join("\\n"));
}
if (args[0] === "session" && args[1] === "list") {
  printList();
  process.exit(0);
}
if (args[0] === "session" && args[1] === "delete") {
  if (state.currentSessionId === args[2]) {
    state.currentSessionId = null;
  }
  save();
  process.stdout.write("deleted\\n");
  process.exit(0);
}
if (args[0] === "session" && args[1] === "new") {
  state.currentSessionId = "27";
  state.createdFresh = true;
  save();
  process.stdout.write("Session 27 created\\n");
  process.exit(0);
}
if (args[0] === "-s") {
  const sessionId = args[1];
  if (sessionId === "26") {
    state.staleProbeCount += 1;
    save();
    process.stderr.write("Error: fetch failed\\n");
    process.exit(1);
  }
  if (sessionId === "27") {
    process.stdout.write("page-ok:https://www.linkedin.com/feed/\\n");
    process.exit(0);
  }
}
process.stderr.write("unexpected args: " + JSON.stringify(args) + "\\n");
process.exit(1);
`);
  fs.chmodSync(playwriterBin, 0o755);

  const previousStatePath = process.env.EXO_FAKE_PLAYWRITER_STATE;
  process.env.EXO_FAKE_PLAYWRITER_STATE = statePath;
  const session = ensurePlaywriterSession({
    profileDirectory: "Profile 4",
    chromeUserDataDir,
    playwriterBin,
    capability: "linkedin",
    targetUrl: "https://www.linkedin.com/feed/",
    expectedHandle: "wflanagan@audienti.com",
  });
  if (previousStatePath === undefined) {
    delete process.env.EXO_FAKE_PLAYWRITER_STATE;
  } else {
    process.env.EXO_FAKE_PLAYWRITER_STATE = previousStatePath;
  }

  const finalState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(session.ok, true);
  assert.equal(session.reused, false);
  assert.equal(session.sessionId, "27");
  assert.equal(finalState.staleProbeCount >= 1, true);
  assert.equal(finalState.createdFresh, true);
});

test("ensurePlaywriterSession accepts a freshly created session without forcing a flaky page probe", () => {
  const { chromeUserDataDir, tempRoot } = writeChromeProfileFixture();
  const statePath = path.join(tempRoot, "playwriter-state.json");
  fs.writeFileSync(statePath, JSON.stringify({
    currentSessionId: null,
    createdFresh: false,
    probeCalls: 0,
  }));

  const playwriterBin = path.join(tempRoot, "fake-playwriter-fresh.js");
  fs.writeFileSync(playwriterBin, `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = process.env.EXO_FAKE_PLAYWRITER_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const profile = "wflanagan@audienti.com";
const browserKey = "profile:116287799130733858842";
function save() {
  fs.writeFileSync(statePath, JSON.stringify(state));
}
function printList() {
  const currentSessionId = state.currentSessionId;
  const rows = currentSessionId
    ? [currentSessionId, "Chrome", profile, browserKey, "page"].join("  ")
    : "";
  process.stdout.write([
    "ID  BROWSER  PROFILE                 EXT                            STATE KEYS",
    "------------------------------------------------------------------------------",
    rows,
    "",
  ].join("\\n"));
}
if (args[0] === "session" && args[1] === "list") {
  printList();
  process.exit(0);
}
if (args[0] === "session" && args[1] === "delete") {
  if (state.currentSessionId === args[2]) {
    state.currentSessionId = null;
  }
  save();
  process.stdout.write("deleted\\n");
  process.exit(0);
}
if (args[0] === "session" && args[1] === "new") {
  state.currentSessionId = "31";
  state.createdFresh = true;
  save();
  process.stdout.write("Session 31 created\\n");
  process.exit(0);
}
if (args[0] === "-s") {
  state.probeCalls += 1;
  save();
  process.stderr.write("Error: 404 {\\"text\\":\\"Session 31 not found. Run 'playwriter session new' first.\\"}\\n");
  process.exit(1);
}
process.stderr.write("unexpected args: " + JSON.stringify(args) + "\\n");
process.exit(1);
`);
  fs.chmodSync(playwriterBin, 0o755);

  const previousStatePath = process.env.EXO_FAKE_PLAYWRITER_STATE;
  process.env.EXO_FAKE_PLAYWRITER_STATE = statePath;
  const session = ensurePlaywriterSession({
    profileDirectory: "Profile 4",
    chromeUserDataDir,
    playwriterBin,
    capability: "linkedin",
    targetUrl: "https://www.linkedin.com/feed/",
    expectedHandle: "wflanagan@audienti.com",
  });
  if (previousStatePath === undefined) {
    delete process.env.EXO_FAKE_PLAYWRITER_STATE;
  } else {
    process.env.EXO_FAKE_PLAYWRITER_STATE = previousStatePath;
  }

  const finalState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(session.ok, true);
  assert.equal(session.reused, false);
  assert.equal(session.sessionId, "31");
  assert.equal(session.pageProbe?.deferred, true);
  assert.equal(finalState.createdFresh, true);
  assert.equal(finalState.probeCalls, 0);
});

function writeChromeProfileFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "exo-playwriter-binding-"));
  const chromeUserDataDir = path.join(tempRoot, "Chrome");
  const profileDir = path.join(chromeUserDataDir, "Profile 4");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(chromeUserDataDir, "Local State"),
    JSON.stringify({
      profile: {
        info_cache: {
          "Profile 4": {
            gaia_id: "116287799130733858842",
            user_name: "wflanagan@audienti.com",
          },
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(profileDir, "Preferences"),
    JSON.stringify({
      account_info: [
        {
          email: "wflanagan@audienti.com",
          gaia: "116287799130733858842",
        },
      ],
    }),
  );
  return { tempRoot, chromeUserDataDir, profileDir };
}
