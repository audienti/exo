// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { DEFAULT_UI_STATUS_TIMEOUT_MS, probeUiStatus } from "../src/cli/ui-lock.js";

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
