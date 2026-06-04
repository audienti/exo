// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readWorkspaceSettings, resolveWorkspaceLinkedinConnectionRequestTarget } from "../src/lib/workspace-settings.js";

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
