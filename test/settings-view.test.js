// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderSettingsPage } from "../src/artifacts/render-settings.js";
import { buildSettingsViewModel } from "../src/core/build-settings-view.js";

test("settings view exposes workspace enrichment controls on the dedicated settings page", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-settings-view-"));
  const codexHome = path.join(tempDir, ".codex");

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "[mcp_servers.icypeas]",
      "enabled = true",
      "",
      "[mcp_servers.prospeo]",
      "enabled = false",
      "",
      "[mcp_servers.zerobounce]",
      "enabled = true",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(tempDir, "exo.toml"),
    [
      "[workspace.enrichment.email]",
      'providers = ["icypeas", "findymail"]',
      'validators = ["zerobounce"]',
      "",
      "[workspace.enrichment.phone]",
      'providers = ["icypeas", "prospeo"]',
      "mobile_only = true",
      "prefer_whatsapp_capable = true",
      "",
    ].join("\n"),
  );

  try {
    const model = buildSettingsViewModel({
      settingsCwd: tempDir,
      runtimeAccountDiscovery: {
        runtime: "codex",
        codexHome,
      },
    });

    assert.deepEqual(
      model.workspacePolicy.emailProviders.filter((provider) => provider.enabled).map((provider) => provider.key),
      ["icypeas", "findymail"],
    );
    assert.equal(
      model.workspacePolicy.emailProviders.find((provider) => provider.key === "icypeas")?.status,
      "available",
    );
    assert.equal(
      model.workspacePolicy.phoneProviders.find((provider) => provider.key === "prospeo")?.status,
      "unavailable",
    );
    assert.equal(model.workspacePolicy.phone.preferWhatsappCapable, true);

    const html = renderSettingsPage(model, { interactive: true });
    assert.match(html, /<h1>Settings<\/h1>/);
    assert.match(html, /Workspace enrichment/);
    assert.match(html, /href="\/settings"/);
    assert.match(html, /data-exo-writer="toggleWorkspaceEnrichmentProvider"/);
    assert.match(html, /data-exo-writer="setWorkspacePhoneEnrichmentPolicy"/);
    assert.match(html, /runtime checked/i);
    assert.match(html, /runtime not surfaced/i);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
