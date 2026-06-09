// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");
const offerHtml = [
  "<html>",
  "<head>",
  "<title>Setup Intake Fixture</title>",
  '<meta name="description" content="Setup intake fixture." />',
  "</head>",
  "<body>ok</body>",
  "</html>",
].join("");
const offerUrl = `data:text/html,${encodeURIComponent(offerHtml)}`;

test("setup intake routes a chat-described new motion without scraping the UI", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-setup-intake-motion-"));

  try {
    const user = JSON.parse(
      execFileSync("node", [cliPath, "users", "add", "--label", "operator-main", "--json"], {
        cwd: tempDir,
        encoding: "utf8",
      }),
    );
    execFileSync(
      "node",
      [
        cliPath,
        "users",
        "accounts",
        "add",
        user.id,
        "--capability",
        "gmail",
        "--handle",
        "operator@example.com",
        "--runtime",
        "codex",
        "--connector",
        "gmail",
        "--preferred",
        "--json",
      ],
      {
        cwd: tempDir,
        encoding: "utf8",
      },
    );

    const result = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "setup",
          "intake",
          "--message",
          `We need a new motion for ${offerUrl}`,
          "--json",
        ],
        {
          cwd: tempDir,
          encoding: "utf8",
        },
      ),
    );

    assert.equal(result.detectedIntent.kind, "new-motion");
    assert.equal(result.nextQuestion?.key, "premise");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setup intake detects a new user directly from chat language", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-setup-intake-user-"));

  try {
    const result = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "setup",
          "intake",
          "--message",
          "Add a new user named Sarah Chen.",
          "--json",
        ],
        {
          cwd: tempDir,
          encoding: "utf8",
        },
      ),
    );

    assert.equal(result.detectedIntent.kind, "new-user");
    assert.equal(result.extracted.userLabel, "Sarah Chen");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
