// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { DEFAULT_UI_STATUS_TIMEOUT_MS, probeUiStatus } from "../src/cli/ui-lock.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "src", "cli", "index.js");

/**
 * @param {number} delayMs
 */
async function startStatusServer(delayMs) {
  const server = http.createServer(async (request, response) => {
    if (request.url === "/status") {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, delayMs }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
  };
}

async function reserveClosedPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function writeUiLockFixture(stateDir, port) {
  fs.writeFileSync(
    path.join(stateDir, "ui.lock"),
    JSON.stringify({
      version: 1,
      service: "exo-ui",
      pid: process.pid,
      host: "127.0.0.1",
      port,
      url: `http://127.0.0.1:${port}/`,
      userId: "user-123",
      startedAt: "2026-06-09T12:00:00.000Z",
    }, null, 2),
    "utf8",
  );
}

test("probeUiStatus tolerates a modestly slow status route by default", async (t) => {
  const { server, url } = await startStatusServer(2000);
  t.after(() => server.close());

  const status = await probeUiStatus(url);
  assert.deepEqual(status, { ok: true, delayMs: 2000 });
  assert.equal(DEFAULT_UI_STATUS_TIMEOUT_MS, 5000);
});

test("probeUiStatus still honors an explicit tighter timeout", async (t) => {
  const { server, url } = await startStatusServer(200);
  t.after(() => server.close());

  const status = await probeUiStatus(url, { timeoutMs: 50 });
  assert.equal(status, null);
});

test("ui-status reports a degraded live lock without clearing it", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-lock-degraded-"));
  const port = await reserveClosedPort();
  writeUiLockFixture(stateDir, port);

  const output = execFileSync(
    "node",
    [cliPath, "ui-status", "--json"],
    {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: stateDir },
      encoding: "utf8",
    },
  );

  const status = JSON.parse(output);
  assert.equal(status.status, "degraded");
  assert.equal(status.running, false);
  assert.equal(status.pidAlive, true);
  assert.equal(status.probeOk, false);
  assert.equal(status.port, port);
  assert.ok(fs.existsSync(path.join(stateDir, "ui.lock")));
});

test("exo ui refuses to reuse a degraded live lock on the same port", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-ui-lock-occupied-"));
  const port = await reserveClosedPort();
  writeUiLockFixture(stateDir, port);

  const result = spawnSync(
    "node",
    [cliPath, "ui", "--port", String(port)],
    {
      cwd: repoRoot,
      env: { ...process.env, EXO_STATE_DIR: stateDir },
      encoding: "utf8",
      timeout: 2000,
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /still holds port .* but \/status could not be reached/i,
  );
  assert.ok(fs.existsSync(path.join(stateDir, "ui.lock")));
});
