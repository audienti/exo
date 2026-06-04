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
  "<title>Actico Risk Platform</title>",
  '<meta name="description" content="Credit and risk decisioning for regulated lenders." />',
  "</head>",
  "<body>ok</body>",
  "</html>"
].join("");
const offerUrl = `data:text/html,${encodeURIComponent(offerHtml)}`;

test("queued draft writeback refuses a connection-request surface once cadence moved to direct-message", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-draft-guard-"));
  const env = { ...process.env, EXO_STATE_DIR: tempDir };

  try {
    const motion = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "motion",
          "add",
          "--url",
          offerUrl,
          "--premise",
          "This offer matters when GTM operators need governed outbound state.",
          "--audience",
          "Revenue leaders",
          "--signal",
          "company::Is there evidence the story changed recently?",
          "--json",
        ],
        { cwd: repoRoot, env, encoding: "utf8" },
      ),
    );

    const company = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "add",
          "--name",
          "Semgrep",
          "--domain",
          "semgrep.dev",
          "--motion",
          motion.id,
          "--json",
        ],
        { cwd: repoRoot, env, encoding: "utf8" },
      ),
    );

    const added = JSON.parse(
      execFileSync(
        "node",
        [
          cliPath,
          "companies",
          "prospects",
          "add",
          company.id,
          "--motion",
          motion.id,
          "--name",
          "Garrett Souza",
          "--title",
          "VP, Worldwide Sales",
          "--why-relevant",
          "Already reachable as a first-degree message path.",
          "--json",
        ],
        { cwd: repoRoot, env, encoding: "utf8" },
      ),
    );
    const prospectId = added.prospects[0]?.id;
    assert.equal(typeof prospectId, "string");

    execFileSync(
      "node",
      [
        cliPath,
        "companies",
        "cadence",
        "set",
        company.id,
        "--motion",
        motion.id,
        "--prospect",
        prospectId,
        "--current-step",
        "direct-message",
        "--next-action",
        "Send a short LinkedIn direct message when capacity allows.",
        "--json",
      ],
      { cwd: repoRoot, env, encoding: "utf8" },
    );

    assert.throws(
      () =>
        execFileSync(
          "node",
          [
            cliPath,
            "companies",
            "prospects",
            "draft",
            "set",
            company.id,
            "--motion",
            motion.id,
            "--prospect",
            prospectId,
            "--surface",
            "connection_request",
            "--status",
            "queued",
            "--body",
            "Bad draft",
          ],
          { cwd: repoRoot, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      /Cadence is not currently ready for a connection-request branch\./,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
