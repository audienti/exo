// @ts-check
//
// Classifies runtime CLI failures that mean the model subscription ran out of
// messages or hit a rate limit (Codex "You're out of messages", "usage limit
// reached", HTTP 429, and friends). The agent host uses this to pause queue
// draining until the limit resets instead of failing every queued task one by
// one and littering the operator view with red cards.
//
// Scope guard: a LinkedIn invitation quota or a Playwright timeout must NOT
// classify as a runtime usage limit. Signals therefore require explicit
// usage/rate-limit wording, and the generic ones additionally require the
// failure text to reference the runtime CLI (codex/claude) somewhere.

export const DEFAULT_RUNTIME_USAGE_LIMIT_BACKOFF_MS = 30 * 60 * 1000;

const EXPLICIT_SIGNALS = [
  /out of (?:codex |claude )?messages/i,
  /you(?:'| a)?re out of messages/i,
  /you'?ve hit your (?:usage|rate) limit/i,
  /(?:usage|rate) limit (?:reached|hit|exceeded)/i,
  /your (?:usage|rate) limit resets/i,
  /insufficient[_ ](?:quota|credits)/i,
];

const RUNTIME_SCOPED_SIGNALS = [
  /(?:usage|rate)[_ ]limit/i,
  /too many requests/i,
  /quota (?:exceeded|reached|exhausted)/i,
  /\b429\b/,
  /out of credits/i,
];

const RUNTIME_MARKERS = /\b(?:codex|claude|openai|anthropic)\b/i;

/**
 * @param {string | null | undefined} text  failure reason, CLI stderr, or both
 * @param {{ now?: Date | string | number }} [options]
 * @returns {{ limited: boolean, resetAt: string | null, signal: string | null }}
 */
export function classifyRuntimeUsageLimitFailure(text, options = {}) {
  const raw = typeof text === "string" ? text : "";
  if (!raw.trim()) {
    return { limited: false, resetAt: null, signal: null };
  }

  const explicit = EXPLICIT_SIGNALS.find((pattern) => pattern.test(raw)) ?? null;
  const scoped = !explicit && RUNTIME_MARKERS.test(raw)
    ? RUNTIME_SCOPED_SIGNALS.find((pattern) => pattern.test(raw)) ?? null
    : null;
  const matched = explicit ?? scoped;
  if (!matched) {
    return { limited: false, resetAt: null, signal: null };
  }

  const now = normalizeNow(options.now);
  return {
    limited: true,
    resetAt: extractResetAt(raw, now),
    signal: raw.match(matched)?.[0] ?? null,
  };
}

/**
 * Short local-time label for a resume timestamp: "7:12 PM" when it lands
 * today, "tomorrow 7:12 AM" when it rolls past midnight, otherwise the date.
 *
 * @param {string | null | undefined} unavailableUntil
 * @param {{ now?: Date | string | number }} [options]
 * @returns {string | null}
 */
export function formatUsageLimitResumeLabel(unavailableUntil, options = {}) {
  if (typeof unavailableUntil !== "string" || !unavailableUntil.trim()) return null;
  const until = new Date(unavailableUntil);
  if (Number.isNaN(until.getTime())) return null;
  const now = normalizeNow(options.now);
  const timeLabel = until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = until.getFullYear() === now.getFullYear()
    && until.getMonth() === now.getMonth()
    && until.getDate() === now.getDate();
  if (sameDay) return timeLabel;
  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = until.getFullYear() === tomorrow.getFullYear()
    && until.getMonth() === tomorrow.getMonth()
    && until.getDate() === tomorrow.getDate();
  if (isTomorrow) return `tomorrow ${timeLabel}`;
  return `${until.toLocaleDateString([], { month: "short", day: "numeric" })} ${timeLabel}`;
}

/**
 * @param {string} raw
 * @param {Date} now
 * @returns {string | null}
 */
function extractResetAt(raw, now) {
  // ISO timestamp embedded in the error.
  const isoMatch = raw.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\b/);
  if (isoMatch) {
    const parsed = new Date(isoMatch[1]);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
      return parsed.toISOString();
    }
  }

  // "try again in 3 hours 12 minutes" / "resets in 45 minutes" / "in 2h 5m".
  const durationMatch = raw.match(
    /(?:resets?|try again|available)[^.\n]{0,24}?\bin\s+(?:about\s+)?(?:(\d+)\s*h(?:ours?|rs?)?\b)?\s*(?:and\s+)?(?:(\d+)\s*m(?:in(?:utes?)?)?\b)?/i,
  );
  if (durationMatch && (durationMatch[1] || durationMatch[2])) {
    const hours = Number(durationMatch[1] ?? 0);
    const minutes = Number(durationMatch[2] ?? 0);
    const totalMs = (hours * 60 + minutes) * 60 * 1000;
    if (totalMs > 0) {
      return new Date(now.getTime() + totalMs).toISOString();
    }
  }

  // "resets at 7:12 PM" / "resets on 19:12" / "try again at 7pm".
  const clockMatch = raw.match(
    /(?:resets?|try again|available)[^.\n]{0,32}?\b(?:at|on)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );
  if (clockMatch) {
    let hours = Number(clockMatch[1]);
    const minutes = Number(clockMatch[2] ?? 0);
    const meridiem = clockMatch[3]?.toLowerCase() ?? null;
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    if (Number.isFinite(hours) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      const candidate = new Date(now.getTime());
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate.getTime() <= now.getTime()) {
        candidate.setDate(candidate.getDate() + 1);
      }
      return candidate.toISOString();
    }
  }

  return null;
}

/** @param {Date | string | number | undefined} value */
function normalizeNow(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}
