// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { buildPlannerGuidance } from "../src/lib/planner-guidance.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function runCli(cwd, args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd,
    env: { ...process.env, EXO_STATE_DIR: path.join(cwd, ".exo") },
    encoding: "utf8",
  });
}

test("workspace enrichment policy flows into planner guidance and live research briefs", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "exo-enrichment-policy-cli-"));
  const previousCwd = process.cwd();

  fs.writeFileSync(
    path.join(cwd, "exo.toml"),
    [
      "[workspace.enrichment.email]",
      'providers = ["icypeas", "findymail"]',
      'validators = ["zerobounce"]',
      "",
      "[workspace.enrichment.phone]",
      'providers = ["prospeo"]',
      "mobile_only = true",
      "prefer_whatsapp_capable = false",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const motion = JSON.parse(
      runCli(cwd, [
        "motion",
        "add",
        "--url",
        "https://example.com/policy",
        "--premise",
        "This offer matters when GTM teams need governed contact enrichment.",
        "--audience",
        "Revenue leaders",
        "--signal",
        "company::Is there recent evidence the company is expanding outbound coverage?",
        "--json",
      ]),
    );

    const company = JSON.parse(
      runCli(cwd, [
        "companies",
        "add",
        "--name",
        "PolicyCo",
        "--domain",
        "policyco.example",
        "--motion",
        motion.id,
        "--json",
      ]),
    );

    runCli(cwd, [
      "companies",
      "prospects",
      "add",
      company.id,
      "--motion",
      motion.id,
      "--name",
      "Parker Policy",
      "--title",
      "VP Revenue Operations",
      "--why-relevant",
      "Owns the fallback-channel motion.",
      "--json",
    ]);

    const researchBrief = JSON.parse(
      runCli(cwd, ["companies", "research-brief", company.id, "--json"]),
    );
    const packets = JSON.parse(
      runCli(cwd, ["motion", "packets", motion.id, "--json"]),
    );
    const researchPacket = packets.items.find((item) => item.packetKind === "prospect_research");
    assert.ok(researchPacket, "expected a prospect research packet");

    const packetBrief = JSON.parse(
      runCli(cwd, ["motion", "packet-brief", motion.id, "--packet", researchPacket.packetId, "--json"]),
    );

    process.chdir(cwd);
    const guidance = buildPlannerGuidance("find_contact_points", {
      prospectName: "Parker Policy",
      companyName: "PolicyCo",
    });

    assert.match(guidance.taskPrompt, /direct email provider order .*icypeas, findymail/i);
    assert.match(guidance.taskPrompt, /validation providers enabled .*zerobounce/i);
    assert.match(guidance.taskPrompt, /direct phone provider order .*prospeo/i);
    assert.match(guidance.taskPrompt, /do not prefer WhatsApp-capable evidence/i);

    assert.ok(
      researchBrief.researchPath.some((step) => /icypeas, findymail/i.test(step)),
      "expected company research brief to mention configured email providers",
    );
    assert.ok(
      researchBrief.researchPath.some((step) => /prospeo/i.test(step)),
      "expected company research brief to mention configured phone provider",
    );
    assert.ok(
      researchBrief.stateWritebacks.some((step) => /--avatar-source-url <avatar-source-url>/i.test(step)),
      "expected company research brief to require landing prospect avatar identity when profile-backed research is used",
    );
    assert.match(packetBrief.inputs.execution.runtimeEnrichmentRule, /icypeas, findymail/i);
    assert.match(packetBrief.inputs.execution.runtimeEnrichmentRule, /zerobounce/i);
    assert.match(packetBrief.inputs.execution.runtimeEnrichmentRule, /prospeo/i);
    assert.match(packetBrief.inputs.execution.runtimeEnrichmentRule, /Do not prioritize WhatsApp-capable evidence/i);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
