// @ts-check

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * Convert a LinkedIn-visible relative time label like "Viewed 2mo ago" or
 * "Sent 3 weeks ago" into an absolute ISO timestamp anchored to the moment the
 * row was observed.
 *
 * @param {string | null | undefined} text
 * @param {string | null | undefined} observedAt
 * @returns {string | null}
 */
export function deriveLinkedinRelativeEventAt(text, observedAt) {
  const observedDate = new Date(observedAt ?? "");
  if (!text || Number.isNaN(observedDate.getTime())) {
    return null;
  }

  const lowered = text.toLowerCase();
  let offsetMs = null;
  if (/\btoday\b/.test(lowered)) {
    offsetMs = 0;
  } else if (/\b(yesterday|last day)\b/.test(lowered)) {
    offsetMs = DAY_MS;
  } else if (/\blast week\b/.test(lowered)) {
    offsetMs = WEEK_MS;
  } else if (/\blast month\b/.test(lowered)) {
    offsetMs = MONTH_MS;
  } else {
    const match = lowered.match(/\b(\d+)\s*(minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d|week|weeks|wk|wks|w|month|months|mo|mos|year|years|yr|yrs|y)\s+ago\b/);
    if (match) {
      const count = Number.parseInt(match[1], 10);
      const unit = match[2];
      const unitMs = unit === "minute" || unit === "minutes" || unit === "min" || unit === "mins" || unit === "m"
        ? MINUTE_MS
        : unit === "hour" || unit === "hours" || unit === "hr" || unit === "hrs" || unit === "h"
          ? HOUR_MS
          : unit === "day" || unit === "days" || unit === "d"
            ? DAY_MS
            : unit === "week" || unit === "weeks" || unit === "wk" || unit === "wks" || unit === "w"
              ? WEEK_MS
              : unit === "month" || unit === "months" || unit === "mo" || unit === "mos"
                ? MONTH_MS
                : YEAR_MS;
      offsetMs = count * unitMs;
    }
  }

  if (offsetMs === null) {
    return null;
  }

  return new Date(observedDate.getTime() - offsetMs).toISOString();
}
