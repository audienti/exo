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

test("define-motion seeds a motion and list-motions sees it in the same workspace", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-cli-"));

  try {
    const defineOutput = execFileSync(
      "node",
      [
        cliPath,
        "define-motion",
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

    const listOutput = execFileSync("node", [cliPath, "list-motions"], {
      cwd: tempDir,
      encoding: "utf8"
    });

    assert.match(listOutput, new RegExp(motion.id));
    assert.match(listOutput, /draft/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
