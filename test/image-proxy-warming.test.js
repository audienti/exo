// @ts-check

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBizBridgeImageProxyUrl,
  warmImageProxy,
  warmImageProxies,
} from "../src/lib/image-proxy.js";

/**
 * Run `fn` with image warming forcibly enabled and `fetch` mocked, restoring
 * both afterward. The test runner disables warming globally, so we re-enable it
 * just for these assertions.
 *
 * @param {(calls: string[]) => Promise<void>} fn
 */
async function withMockedFetch(fn) {
  const priorDisable = process.env.EXO_DISABLE_IMAGE_WARMING;
  const priorFetch = globalThis.fetch;
  process.env.EXO_DISABLE_IMAGE_WARMING = "0";
  /** @type {string[]} */
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      async arrayBuffer() {
        return new ArrayBuffer(0);
      },
    };
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorDisable === undefined) {
      delete process.env.EXO_DISABLE_IMAGE_WARMING;
    } else {
      process.env.EXO_DISABLE_IMAGE_WARMING = priorDisable;
    }
  }
}

test("warmImageProxy GETs a proxied URL so the proxy caches it while the source is valid", async () => {
  await withMockedFetch(async (calls) => {
    const proxyUrl = buildBizBridgeImageProxyUrl("https://media.licdn.com/dms/image/abc/profile.jpg");
    const result = await warmImageProxy(proxyUrl);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(calls, [proxyUrl]);
  });
});

test("warmImageProxy never touches an arbitrary (non-proxy) source host", async () => {
  await withMockedFetch(async (calls) => {
    const result = await warmImageProxy("https://media.licdn.com/dms/image/abc/profile.jpg");
    assert.equal(result.skipped, true);
    assert.equal(calls.length, 0);
  });
});

test("warmImageProxies de-duplicates and warms each distinct proxied URL once", async () => {
  await withMockedFetch(async (calls) => {
    const a = buildBizBridgeImageProxyUrl("https://example.com/a.jpg");
    const b = buildBizBridgeImageProxyUrl("https://example.com/b.jpg");
    const result = await warmImageProxies([a, b, a, null, "", "https://example.com/raw.jpg"]);
    assert.equal(result.total, 2);
    assert.equal(result.warmed, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(new Set(calls), new Set([a, b]));
  });
});

test("warming is a no-op when EXO_DISABLE_IMAGE_WARMING is set (test-runner default)", async () => {
  const prior = process.env.EXO_DISABLE_IMAGE_WARMING;
  const priorFetch = globalThis.fetch;
  process.env.EXO_DISABLE_IMAGE_WARMING = "1";
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, async arrayBuffer() { return new ArrayBuffer(0); } };
  };
  try {
    const proxyUrl = buildBizBridgeImageProxyUrl("https://example.com/x.jpg");
    const one = await warmImageProxy(proxyUrl);
    const many = await warmImageProxies([proxyUrl]);
    assert.equal(one.skipped, true);
    assert.equal(many.skipped, true);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = priorFetch;
    if (prior === undefined) {
      delete process.env.EXO_DISABLE_IMAGE_WARMING;
    } else {
      process.env.EXO_DISABLE_IMAGE_WARMING = prior;
    }
  }
});
