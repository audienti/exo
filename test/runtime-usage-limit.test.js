// @ts-check

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyRuntimeUsageLimitFailure,
  formatUsageLimitResumeLabel,
} from "../src/lib/runtime-usage-limit.js";

const NOW = new Date("2026-06-09T16:41:00");

test("classifies the Codex out-of-messages error and parses a 24h reset clock", () => {
  const result = classifyRuntimeUsageLimitFailure(
    "Codex task failed: Command failed: codex exec ... stderr=You're out of Codex messages. Your rate limit resets on 19:12.",
    { now: NOW },
  );
  assert.equal(result.limited, true);
  assert.ok(result.resetAt);
  const reset = new Date(result.resetAt);
  assert.equal(reset.getHours(), 19);
  assert.equal(reset.getMinutes(), 12);
  assert.ok(reset.getTime() > NOW.getTime());
});

test("classifies a usage-limit error with a 12h reset clock", () => {
  const result = classifyRuntimeUsageLimitFailure(
    "Codex task failed: spawnSync codex ... stderr=ERROR: You've hit your usage limit. Try again at 7:12 PM.",
    { now: NOW },
  );
  assert.equal(result.limited, true);
  const reset = new Date(result.resetAt ?? 0);
  assert.equal(reset.getHours(), 19);
  assert.equal(reset.getMinutes(), 12);
});

test("rolls a reset clock that already passed today over to tomorrow", () => {
  const result = classifyRuntimeUsageLimitFailure(
    "codex: usage limit reached. Try again at 9:00 AM.",
    { now: NOW },
  );
  assert.equal(result.limited, true);
  const reset = new Date(result.resetAt ?? 0);
  assert.equal(reset.getHours(), 9);
  assert.equal(reset.getDate(), NOW.getDate() + 1);
});

test("parses duration-style resets", () => {
  const result = classifyRuntimeUsageLimitFailure(
    "Codex task failed: rate limit reached, try again in 2 hours 13 minutes.",
    { now: NOW },
  );
  assert.equal(result.limited, true);
  assert.equal(result.resetAt, new Date(NOW.getTime() + (2 * 60 + 13) * 60 * 1000).toISOString());
});

test("classifies 429 and quota errors only when the runtime is referenced", () => {
  assert.equal(
    classifyRuntimeUsageLimitFailure("Codex task failed: stream error: 429 Too Many Requests").limited,
    true,
  );
  assert.equal(
    classifyRuntimeUsageLimitFailure("openai api error: quota exceeded for this billing period").limited,
    true,
  );
  assert.equal(
    classifyRuntimeUsageLimitFailure("HTTP 429 from some-unrelated-service").limited,
    false,
  );
});

test("leaves a missing reset time null so the caller applies its default backoff", () => {
  const result = classifyRuntimeUsageLimitFailure("Codex task failed: You're out of Codex messages.");
  assert.equal(result.limited, true);
  assert.equal(result.resetAt, null);
});

test("does not classify browser timeouts or LinkedIn invitation quotas as runtime limits", () => {
  assert.equal(
    classifyRuntimeUsageLimitFailure(
      "playwriter_send_failed: TimeoutError: locator.click: Timeout 10000ms exceeded.",
    ).limited,
    false,
  );
  assert.equal(
    classifyRuntimeUsageLimitFailure(
      "Send blocked: the weekly invitation limit for this LinkedIn account was reached.",
    ).limited,
    false,
  );
  assert.equal(classifyRuntimeUsageLimitFailure(null).limited, false);
  assert.equal(classifyRuntimeUsageLimitFailure("").limited, false);
});

test("formats resume labels relative to now", () => {
  const sameDay = new Date(NOW.getTime());
  sameDay.setHours(19, 12, 0, 0);
  const label = formatUsageLimitResumeLabel(sameDay.toISOString(), { now: NOW });
  assert.ok(label);
  assert.match(label, /7:12/);
  assert.doesNotMatch(label, /tomorrow/i);

  const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  nextDay.setHours(9, 0, 0, 0);
  const tomorrowLabel = formatUsageLimitResumeLabel(nextDay.toISOString(), { now: NOW });
  assert.ok(tomorrowLabel);
  assert.match(tomorrowLabel, /tomorrow/i);

  assert.equal(formatUsageLimitResumeLabel(null), null);
  assert.equal(formatUsageLimitResumeLabel("not-a-date"), null);
});
