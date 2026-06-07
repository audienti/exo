// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readWorkspaceSettings,
  resolveWorkspaceEnrichmentPolicy,
  resolveWorkspaceLinkedinConnectionRequestTarget,
  toggleWorkspaceEnrichmentProvider,
  updateWorkspacePhoneEnrichmentPolicy,
} from "../src/lib/workspace-settings.js";

test("readWorkspaceSettings returns defaults when exo.toml is absent", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "exo-workspace-settings-empty-"));

  try {
    const settings = readWorkspaceSettings({ cwd });
    assert.equal(settings.exists, false);
    assert.equal(settings.path, path.join(cwd, "exo.toml"));
    assert.equal(resolveWorkspaceLinkedinConnectionRequestTarget(settings), null);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("readWorkspaceSettings parses project linkedin connection request target from exo.toml", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "exo-workspace-settings-"));
  fs.writeFileSync(
    path.join(cwd, "exo.toml"),
    [
      "[workspace.targets.linkedin]",
      "connection_requests_per_day = 8",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const settings = readWorkspaceSettings({ cwd });
    assert.equal(settings.exists, true);
    assert.equal(settings.workspace.targets.linkedin.connectionRequestsPerDay, 8);
    assert.equal(resolveWorkspaceLinkedinConnectionRequestTarget(settings), 8);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("readWorkspaceSettings parses enrichment provider arrays and phone rules from exo.toml", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "exo-workspace-settings-enrichment-"));
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
    const settings = readWorkspaceSettings({ cwd });
    const policy = resolveWorkspaceEnrichmentPolicy(settings);
    assert.deepEqual(policy.email.providers, ["icypeas", "findymail"]);
    assert.deepEqual(policy.email.validators, ["zerobounce"]);
    assert.deepEqual(policy.phone.providers, ["prospeo"]);
    assert.equal(policy.phone.mobileOnly, true);
    assert.equal(policy.phone.preferWhatsappCapable, false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("workspace enrichment toggles preserve existing settings and write project exo.toml", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "exo-workspace-settings-write-"));
  fs.writeFileSync(
    path.join(cwd, "exo.toml"),
    [
      "[workspace.targets.linkedin]",
      "connection_requests_per_day = 8",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    toggleWorkspaceEnrichmentProvider({ cwd, lane: "email", provider: "findymail", enabled: false });
    toggleWorkspaceEnrichmentProvider({ cwd, lane: "phone", provider: "leadmagic", enabled: false });
    updateWorkspacePhoneEnrichmentPolicy({ cwd, preferWhatsappCapable: false });

    const saved = readWorkspaceSettings({ cwd });
    assert.equal(resolveWorkspaceLinkedinConnectionRequestTarget(saved), 8);
    assert.deepEqual(saved.workspace.enrichment.email.providers, ["icypeas", "leadmagic", "prospeo"]);
    assert.deepEqual(saved.workspace.enrichment.phone.providers, ["icypeas", "prospeo"]);
    assert.equal(saved.workspace.enrichment.phone.mobileOnly, true);
    assert.equal(saved.workspace.enrichment.phone.preferWhatsappCapable, false);

    const rawToml = fs.readFileSync(path.join(cwd, "exo.toml"), "utf8");
    assert.match(rawToml, /\[workspace\.targets\.linkedin\]/);
    assert.match(rawToml, /connection_requests_per_day = 8/);
    assert.match(rawToml, /\[workspace\.enrichment\.email\]/);
    assert.match(rawToml, /providers = \["icypeas", "leadmagic", "prospeo"\]/);
    assert.match(rawToml, /\[workspace\.enrichment\.phone\]/);
    assert.match(rawToml, /prefer_whatsapp_capable = false/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
