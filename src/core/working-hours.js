// @ts-check

import { userSchema, userWorkingHoursModeSchema, userWorkingHoursSchema } from "../schema/user.js";

const WEEKDAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * @param {unknown} rawUser
 * @param {{
 *   mode?: import("../schema/user.js").userWorkingHoursModeSchema._type | null,
 *   timezone?: string | null,
 *   weekdays?: string[] | null,
 *   startLocalTime?: string | null,
 *   endLocalTime?: string | null
 * }} input
 */
export function setUserWorkingHours(rawUser, input) {
  const user = userSchema.parse(rawUser);
  const now = new Date().toISOString();
  const nextMode = input.mode
    ? userWorkingHoursModeSchema.parse(input.mode)
    : input.timezone || input.weekdays || input.startLocalTime || input.endLocalTime
      ? "scheduled"
      : user.workingHours.mode;
  const nextWeekdays = input.weekdays && input.weekdays.length
    ? normalizeWeekdays(input.weekdays)
    : user.workingHours.weekdays;

  return userSchema.parse({
    ...user,
    updatedAt: now,
    workingHours: userWorkingHoursSchema.parse({
      ...user.workingHours,
      mode: nextMode,
      timezone: normalizeString(input.timezone) ?? user.workingHours.timezone,
      weekdays: nextWeekdays,
      startLocalTime: normalizeString(input.startLocalTime) ?? user.workingHours.startLocalTime,
      endLocalTime: normalizeString(input.endLocalTime) ?? user.workingHours.endLocalTime
    })
  });
}

/**
 * @param {unknown} rawUser
 * @param {{ now?: string | null }} [options]
 */
export function buildUserWorkingHoursView(rawUser, options = {}) {
  const user = userSchema.parse(rawUser);
  const now = options.now ?? new Date().toISOString();
  const status = classifyWorkingHoursWindow(user.workingHours, now);

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    inspectedAt: now,
    workingHours: user.workingHours,
    status
  };
}

/**
 * @param {unknown} rawUser
 * @param {string} now
 */
export function classifyUserWorkingHours(rawUser, now) {
  const user = userSchema.parse(rawUser);
  return classifyWorkingHoursWindow(user.workingHours, now);
}

/**
 * @param {import("../schema/user.js").userWorkingHoursSchema._type} workingHours
 * @param {string} now
 */
export function classifyWorkingHoursWindow(workingHours, now) {
  const normalized = userWorkingHoursSchema.parse(workingHours);
  const nowDate = new Date(now);

  if (normalized.mode === "always") {
    return {
      mode: normalized.mode,
      openNow: true,
      nextOpenAt: nowDate.toISOString(),
      summary: "Working hours are always open for this execution user."
    };
  }

  const localNow = getLocalDateTimeParts(nowDate, normalized.timezone);
  const currentMinutes = localNow.hour * 60 + localNow.minute;
  const startMinutes = parseLocalTime(normalized.startLocalTime);
  const endMinutes = parseLocalTime(normalized.endLocalTime);
  const weekdayAllowed = normalized.weekdays.includes(localNow.weekday);

  if (weekdayAllowed && currentMinutes >= startMinutes && currentMinutes < endMinutes) {
    return {
      mode: normalized.mode,
      openNow: true,
      nextOpenAt: nowDate.toISOString(),
      summary: `Inside working hours for ${normalized.timezone} (${normalized.startLocalTime}-${normalized.endLocalTime}).`
    };
  }

  const nextOpenAt = findNextOpenAt(normalized, localNow);
  return {
    mode: normalized.mode,
    openNow: false,
    nextOpenAt,
    summary: nextOpenAt
      ? `Outside working hours for ${normalized.timezone}. The next open window starts at ${nextOpenAt}.`
      : `Outside working hours for ${normalized.timezone}, and no next open window could be derived.`
  };
}

/**
 * @param {string[]} weekdays
 */
function normalizeWeekdays(weekdays) {
  const seen = new Set(
    weekdays
      .map((weekday) => normalizeString(weekday)?.toLowerCase() ?? "")
      .filter(Boolean)
  );

  return WEEKDAY_ORDER.filter((weekday) => seen.has(weekday));
}

/**
 * @param {string | null | undefined} value
 */
function normalizeString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {string} localTime
 */
function parseLocalTime(localTime) {
  const [hours, minutes] = localTime.split(":").map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

/**
 * @param {Date} date
 * @param {string} timeZone
 */
function getLocalDateTimeParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const byType = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number.parseInt(byType.year, 10),
    month: Number.parseInt(byType.month, 10),
    day: Number.parseInt(byType.day, 10),
    hour: Number.parseInt(byType.hour, 10),
    minute: Number.parseInt(byType.minute, 10),
    weekday: normalizeWeekday(byType.weekday)
  };
}

/**
 * @param {string} weekday
 */
function normalizeWeekday(weekday) {
  const lowered = weekday.slice(0, 3).toLowerCase();
  switch (lowered) {
    case "sun":
    case "mon":
    case "tue":
    case "wed":
    case "thu":
    case "fri":
    case "sat":
      return lowered;
    default:
      throw new Error(`Unsupported weekday value: ${weekday}`);
  }
}

/**
 * @param {import("../schema/user.js").userWorkingHoursSchema._type} workingHours
 * @param {{ year: number, month: number, day: number, hour: number, minute: number, weekday: string }} localNow
 */
function findNextOpenAt(workingHours, localNow) {
  const startMinutes = parseLocalTime(workingHours.startLocalTime);

  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const localDate = shiftLocalDate(localNow, dayOffset);
    const weekday = weekdayForLocalDate(localDate, workingHours.timezone);
    if (!workingHours.weekdays.includes(weekday)) {
      continue;
    }

    const isSameLocalDay = dayOffset === 0;
    const currentMinutes = localNow.hour * 60 + localNow.minute;
    if (isSameLocalDay && currentMinutes >= startMinutes) {
      continue;
    }

    return utcFromLocalDateTime({
      year: localDate.year,
      month: localDate.month,
      day: localDate.day,
      hour: Math.floor(startMinutes / 60),
      minute: startMinutes % 60
    }, workingHours.timezone);
  }

  return null;
}

/**
 * @param {{ year: number, month: number, day: number }} localDate
 * @param {string} timeZone
 */
function weekdayForLocalDate(localDate, timeZone) {
  const iso = utcFromLocalDateTime({
    ...localDate,
    hour: 12,
    minute: 0
  }, timeZone);
  if (!iso) {
    return "sun";
  }

  return getLocalDateTimeParts(new Date(iso), timeZone).weekday;
}

/**
 * @param {{ year: number, month: number, day: number }} localDate
 * @param {number} dayOffset
 */
function shiftLocalDate(localDate, dayOffset) {
  const shifted = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + dayOffset, 12, 0, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

/**
 * @param {{ year: number, month: number, day: number, hour: number, minute: number }} localDateTime
 * @param {string} timeZone
 */
function utcFromLocalDateTime(localDateTime, timeZone) {
  let guessMs = Date.UTC(
    localDateTime.year,
    localDateTime.month - 1,
    localDateTime.day,
    localDateTime.hour,
    localDateTime.minute,
    0,
    0
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMinutes = readTimeZoneOffsetMinutes(timeZone, new Date(guessMs));
    const candidateMs = Date.UTC(
      localDateTime.year,
      localDateTime.month - 1,
      localDateTime.day,
      localDateTime.hour,
      localDateTime.minute,
      0,
      0
    ) - offsetMinutes * 60 * 1000;
    const candidateParts = getLocalDateTimeParts(new Date(candidateMs), timeZone);

    if (
      candidateParts.year === localDateTime.year
      && candidateParts.month === localDateTime.month
      && candidateParts.day === localDateTime.day
      && candidateParts.hour === localDateTime.hour
      && candidateParts.minute === localDateTime.minute
    ) {
      return new Date(candidateMs).toISOString();
    }

    guessMs = candidateMs;
  }

  const baseMs = Date.UTC(
    localDateTime.year,
    localDateTime.month - 1,
    localDateTime.day,
    localDateTime.hour,
    localDateTime.minute,
    0,
    0
  );
  for (let deltaMinutes = -24 * 60; deltaMinutes <= 24 * 60; deltaMinutes += 15) {
    const candidateMs = baseMs + deltaMinutes * 60 * 1000;
    const candidateParts = getLocalDateTimeParts(new Date(candidateMs), timeZone);
    if (
      candidateParts.year === localDateTime.year
      && candidateParts.month === localDateTime.month
      && candidateParts.day === localDateTime.day
      && candidateParts.hour === localDateTime.hour
      && candidateParts.minute === localDateTime.minute
    ) {
      return new Date(candidateMs).toISOString();
    }
  }

  return null;
}

/**
 * @param {string} timeZone
 * @param {Date} date
 */
function readTimeZoneOffsetMinutes(timeZone, date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit"
  });
  const value = formatter
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT+0";

  const match = value.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  return sign * (hours * 60 + minutes);
}
