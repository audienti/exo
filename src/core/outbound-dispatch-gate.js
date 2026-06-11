// @ts-check

const LINKEDIN_ACTIONS = new Set([
  "send_connection_request",
  "send_direct_message",
  "in_mail_message",
  "create_post_comment",
  "create_comment_comment",
  "like_post",
  "create_comment_reaction",
]);
const ACTIVE_DISPOSITION = new Set([null, undefined, "", "active"]);
const OWNER_TOUCH_OUTCOMES = new Set(["pending", "sent", "accepted", "opened-no-reply"]);
const COUNTED_TOUCH_OUTCOMES = new Set(["pending", "sent", "accepted", "opened-no-reply"]);
const DEFAULT_CONNECTION_REQUEST_DAILY_CAP = 25;
const DEFAULT_TARGET_WINDOW = {
  weekdays: ["mon", "tue", "wed", "thu", "fri"],
  startLocalTime: "09:00",
  endLocalTime: "17:00",
};
const DEFAULT_LINKEDIN_SPACING = {
  minDelayMs: 90_000,
  maxDelayMs: 240_000,
};
const PERIOD_MS = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

/**
 * @param {{
 *   now?: string | null,
 *   motion: any,
 *   account: any,
 *   prospect: any,
 *   draft?: any,
 *   action?: string | null,
 *   senderAccount?: any,
 *   branches?: Array<{ motion: any, account: any, prospect: any }>,
 *   history?: Array<Record<string, any>>,
 * }} input
 */
export function evaluateOutboundDispatchGate(input) {
  const now = normalizeIso(input.now) ?? new Date().toISOString();
  const action = normalizeAction(input.action, input.draft);
  const surface = normalizeString(input.draft?.surface ?? input.prospect?.surface);
  const senderAccount = input.senderAccount ?? null;
  const targetTimezone = resolveTargetTimezone(input);
  const base = {
    status: "allow",
    decision: "allow",
    reasonCode: "allowed",
    reason: "Outbound dispatch is allowed by the current gate contract.",
    action,
    surface,
    accountId: normalizeString(senderAccount?.accountId ?? senderAccount?.id),
    providerAccountId: normalizeString(senderAccount?.providerAccountId),
    senderHandle: normalizeString(senderAccount?.handle),
    targetTimezone,
    waitingReason: null,
    blockReason: null,
    nextDueAt: null,
    limits: null,
    owner: null,
    spacing: null,
    postDispatchDelayMs: null,
  };

  if (!isActiveDisposition(input.account?.disposition)) {
    return block(base, "inactive_account", `${input.account?.companyName ?? "This account"} is not active for outbound dispatch.`);
  }
  if (!isActiveDisposition(input.prospect?.disposition)) {
    return block(base, "inactive_prospect", `${input.prospect?.name ?? "This prospect"} is not active for outbound dispatch.`);
  }

  const owner = findStaleCrossMotionOwner(input);
  if (owner) {
    return {
      ...block(
        base,
        "stale_cross_motion_owner",
        `${input.prospect?.name ?? "This person"} is already active in ${owner.motionName ?? owner.motionId}.`,
      ),
      owner,
    };
  }

  if (!LINKEDIN_ACTIONS.has(action)) {
    return base;
  }

  const history = normalizeDispatchHistory([
    ...(input.history ?? []),
    ...collectHistoryFromBranches(input.branches ?? []),
  ], senderAccount);

  const warmupDecision = evaluateWarmupLimit({
    base,
    action,
    history,
    senderAccount,
    now,
  });
  if (warmupDecision) return warmupDecision;

  const pacingDecision = evaluateRollingCaps({
    base,
    action,
    history,
    senderAccount,
    now,
  });
  if (pacingDecision) return pacingDecision;

  const windowDecision = evaluateTargetSendWindow({
    base,
    action,
    surface,
    targetTimezone,
    prospect: input.prospect,
    account: input.account,
    senderAccount,
    now,
  });
  if (windowDecision) return windowDecision;

  const spacing = resolveLinkedinSpacing(senderAccount, action);
  const selectedDelayMs = deterministicDelayMs({
    minDelayMs: spacing.minDelayMs,
    maxDelayMs: spacing.maxDelayMs,
    seed: `${input.motion?.id ?? ""}:${input.account?.companyId ?? ""}:${input.prospect?.id ?? ""}:${action}:${surface ?? ""}`,
  });
  const lastSend = latestHistoryEvent(history, (event) => LINKEDIN_ACTIONS.has(event.action));
  if (lastSend?.occurredAt) {
    const nextDueAt = addMs(lastSend.occurredAt, selectedDelayMs);
    if (nextDueAt > now) {
      return wait(base, "randomized_spacing", "LinkedIn spacing keeps this outbound action from firing immediately.", nextDueAt, {
        spacing: {
          minDelayMs: spacing.minDelayMs,
          maxDelayMs: spacing.maxDelayMs,
          selectedDelayMs,
          lastSentAt: lastSend.occurredAt,
        },
      });
    }
  }

  return {
    ...base,
    spacing: {
      minDelayMs: spacing.minDelayMs,
      maxDelayMs: spacing.maxDelayMs,
      selectedDelayMs,
    },
    postDispatchDelayMs: selectedDelayMs,
  };
}

/**
 * @param {Record<string, any>} base
 * @param {string} reasonCode
 * @param {string} reason
 */
function block(base, reasonCode, reason) {
  return {
    ...base,
    status: "block",
    decision: "block",
    reasonCode,
    reason,
    blockReason: reasonCode,
  };
}

/**
 * @param {Record<string, any>} base
 * @param {string} reasonCode
 * @param {string} reason
 * @param {string | null} nextDueAt
 * @param {Record<string, any>} [extra]
 */
function wait(base, reasonCode, reason, nextDueAt, extra = {}) {
  return {
    ...base,
    ...extra,
    status: "wait",
    decision: "wait",
    reasonCode,
    reason,
    waitingReason: reasonCode,
    nextDueAt,
  };
}

/**
 * @param {{
 *   base: Record<string, any>,
 *   action: string,
 *   history: Array<Record<string, any>>,
 *   senderAccount: any,
 *   now: string,
 * }} input
 */
function evaluateWarmupLimit(input) {
  if (input.action !== "send_connection_request") return null;
  const limit = resolveWarmupDailyConnectionLimit(input.senderAccount);
  if (!Number.isInteger(limit) || limit < 1) return null;
  const counted = countEventsSince(input.history, input.action, input.now, PERIOD_MS.day);
  if (counted.length < limit) return null;
  return wait(
    input.base,
    "warmup_daily_cap",
    `Warm-up pacing has already used ${counted.length}/${limit} connection requests in the last 24 hours.`,
    nextDueAfterPeriod(counted, PERIOD_MS.day),
    {
      limits: {
        kind: "warmup",
        period: "day",
        action: input.action,
        limit,
        count: counted.length,
      },
    },
  );
}

/**
 * @param {{
 *   base: Record<string, any>,
 *   action: string,
 *   history: Array<Record<string, any>>,
 *   senderAccount: any,
 *   now: string,
 * }} input
 */
function evaluateRollingCaps(input) {
  for (const cap of resolveRollingCaps(input.action, input.senderAccount)) {
    if (!Number.isInteger(cap.limit) || cap.limit < 1) continue;
    const counted = countEventsSince(input.history, input.action, input.now, PERIOD_MS[cap.period]);
    if (counted.length < cap.limit) continue;
    return wait(
      input.base,
      `pacing_${cap.periodlyName}_cap`,
      `${cap.label} has already used ${counted.length}/${cap.limit} ${cap.actionLabel} in the rolling ${cap.period}.`,
      nextDueAfterPeriod(counted, PERIOD_MS[cap.period]),
      {
        limits: {
          kind: "rolling",
          period: cap.period,
          action: input.action,
          limit: cap.limit,
          count: counted.length,
        },
      },
    );
  }
  return null;
}

/**
 * @param {{
 *   base: Record<string, any>,
 *   action: string,
 *   surface: string | null,
 *   targetTimezone: string | null,
 *   prospect: any,
 *   account: any,
 *   senderAccount: any,
 *   now: string,
 * }} input
 */
function evaluateTargetSendWindow(input) {
  if (!input.targetTimezone || isSendWindowExempt(input.surface)) {
    return null;
  }
  const window = resolveTargetWindow(input.prospect, input.account, input.senderAccount);
  const status = classifyTargetWindow(input.now, input.targetTimezone, window);
  if (status.openNow) return null;
  return wait(
    input.base,
    "outside_target_send_window",
    `Target-local send window is closed in ${input.targetTimezone}.`,
    status.nextOpenAt,
    {
      targetTimezone: input.targetTimezone,
      sendWindow: window,
    },
  );
}

/**
 * @param {string | null | undefined} explicit
 * @param {any} draft
 */
function normalizeAction(explicit, draft) {
  const normalized = normalizeString(explicit);
  if (normalized) return normalized;
  switch (draft?.surface) {
    case "connection_request":
      return "send_connection_request";
    case "in_mail_message":
      return "in_mail_message";
    case "email":
      return "send_email";
    case "public_comment":
      return "create_post_comment";
    case "comment_reply":
      return "create_comment_comment";
    case "like_post":
      return "like_post";
    case "create_comment_reaction":
      return "create_comment_reaction";
    default:
      return "send_direct_message";
  }
}

/**
 * @param {unknown} disposition
 */
function isActiveDisposition(disposition) {
  return ACTIVE_DISPOSITION.has(disposition);
}

/**
 * @param {{ motion: any, account: any, prospect: any, branches?: Array<{ motion: any, account: any, prospect: any }> }} input
 */
function findStaleCrossMotionOwner(input) {
  const identityKeys = prospectIdentityKeys(input.prospect);
  if (!identityKeys.length) return null;
  for (const branch of input.branches ?? []) {
    if (!branch?.prospect || branch.prospect.id === input.prospect?.id) continue;
    if (branch.motion?.id === input.motion?.id) continue;
    if (!isActiveDisposition(branch.account?.disposition) || !isActiveDisposition(branch.prospect?.disposition)) continue;
    if (!sharesIdentity(identityKeys, prospectIdentityKeys(branch.prospect))) continue;
    const touch = latestOwnerTouch(branch.prospect);
    if (!touch) continue;
    return {
      motionId: branch.motion?.id ?? null,
      motionName: branch.motion?.name ?? null,
      companyId: branch.account?.companyId ?? null,
      companyName: branch.account?.companyName ?? null,
      prospectId: branch.prospect?.id ?? null,
      prospectName: branch.prospect?.name ?? null,
      surface: touch.surface ?? null,
      outcome: touch.outcome ?? null,
      occurredAt: touch.occurredAt ?? null,
    };
  }
  return null;
}

/** @param {any} prospect */
function latestOwnerTouch(prospect) {
  return (prospect?.touches ?? [])
    .filter((touch) =>
      touch?.direction === "outbound"
      && OWNER_TOUCH_OUTCOMES.has(String(touch.outcome ?? ""))
      && normalizeIso(touch.occurredAt)
    )
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))[0] ?? null;
}

/** @param {any} prospect */
function prospectIdentityKeys(prospect) {
  return [
    prospect?.personId ? `person:${prospect.personId}` : null,
    normalizeLinkedinUrl(prospect?.linkedinProfileUrl ?? prospect?.linkedinProfileSnapshot?.profileUrl)
      ? `linkedin:${normalizeLinkedinUrl(prospect?.linkedinProfileUrl ?? prospect?.linkedinProfileSnapshot?.profileUrl)}`
      : null,
    normalizeString(prospect?.email) ? `email:${normalizeString(prospect.email)?.toLowerCase()}` : null,
  ].filter(Boolean);
}

/**
 * @param {string[]} left
 * @param {string[]} right
 */
function sharesIdentity(left, right) {
  const seen = new Set(left);
  return right.some((key) => seen.has(key));
}

/**
 * @param {Array<{ motion: any, account: any, prospect: any }>} branches
 */
function collectHistoryFromBranches(branches) {
  const history = [];
  for (const branch of branches) {
    for (const touch of branch?.prospect?.touches ?? []) {
      if (touch?.direction !== "outbound") continue;
      if (!COUNTED_TOUCH_OUTCOMES.has(String(touch.outcome ?? ""))) continue;
      const occurredAt = normalizeIso(touch.occurredAt);
      if (!occurredAt) continue;
      history.push({
        action: normalizeAction(touch.action ?? null, { surface: touch.surface }),
        surface: normalizeString(touch.surface),
        occurredAt,
        accountId: normalizeString(touch.accountId ?? touch.senderAccountId ?? touch.sender?.accountId ?? touch.metadata?.accountId),
        providerAccountId: normalizeString(touch.providerAccountId ?? touch.senderProviderAccountId ?? touch.sender?.providerAccountId ?? touch.metadata?.providerAccountId),
        senderHandle: normalizeString(touch.senderHandle ?? touch.sender?.handle ?? touch.metadata?.senderHandle),
      });
    }
  }
  return history;
}

/**
 * @param {Array<Record<string, any>>} rawHistory
 * @param {any} senderAccount
 */
function normalizeDispatchHistory(rawHistory, senderAccount) {
  return rawHistory
    .map((event) => ({
      action: normalizeAction(event?.action ?? null, { surface: event?.surface }),
      surface: normalizeString(event?.surface),
      occurredAt: normalizeIso(event?.occurredAt),
      accountId: normalizeString(event?.accountId ?? event?.senderAccountId),
      providerAccountId: normalizeString(event?.providerAccountId ?? event?.senderProviderAccountId),
      senderHandle: normalizeString(event?.senderHandle ?? event?.handle),
    }))
    .filter((event) => event.occurredAt)
    .filter((event) => historyMatchesSender(event, senderAccount));
}

/**
 * @param {Record<string, any>} event
 * @param {any} senderAccount
 */
function historyMatchesSender(event, senderAccount) {
  const senderIds = [
    normalizeString(senderAccount?.accountId ?? senderAccount?.id),
    normalizeString(senderAccount?.providerAccountId),
    normalizeString(senderAccount?.handle),
  ].filter(Boolean);
  const eventIds = [
    event.accountId,
    event.providerAccountId,
    event.senderHandle,
  ].filter(Boolean);
  if (!senderIds.length || !eventIds.length) {
    return true;
  }
  return eventIds.some((id) => senderIds.includes(id));
}

/**
 * @param {Array<Record<string, any>>} history
 * @param {string} action
 * @param {string} now
 * @param {number} periodMs
 */
function countEventsSince(history, action, now, periodMs) {
  const cutoff = new Date(Date.parse(now) - periodMs).toISOString();
  return history
    .filter((event) => event.action === action && event.occurredAt >= cutoff && event.occurredAt <= now)
    .sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));
}

/**
 * @param {Array<Record<string, any>>} counted
 * @param {number} periodMs
 */
function nextDueAfterPeriod(counted, periodMs) {
  const oldest = counted[0]?.occurredAt ?? null;
  return oldest ? addMs(oldest, periodMs) : null;
}

/**
 * @param {string} action
 * @param {any} senderAccount
 */
function resolveRollingCaps(action, senderAccount) {
  const policy = senderAccount?.metadata?.dispatchPolicy ?? {};
  const explicit = policy?.limits ?? {};
  if (action === "send_connection_request") {
    return [
      cap("hour", resolveLimit(explicit, ["send_connection_request.hour", "connectionRequests.hour", "hourlyConnectionRequests"]), "Connection request pacing", "connection requests"),
      cap("day", resolveLimit(explicit, ["send_connection_request.day", "connectionRequests.day", "dailyConnectionRequests"]) ?? DEFAULT_CONNECTION_REQUEST_DAILY_CAP, "Connection request pacing", "connection requests"),
      cap("week", resolveLimit(explicit, ["send_connection_request.week", "connectionRequests.week", "weeklyConnectionRequests"]) ?? finiteNumber(senderAccount?.automationControls?.weeklyQuotas?.invitations), "Connection request pacing", "connection requests"),
    ];
  }
  if (action === "send_direct_message" || action === "in_mail_message") {
    return [
      cap("hour", resolveLimit(explicit, [`${action}.hour`, "messages.hour", "hourlyMessages"]), "Message pacing", "messages"),
      cap("day", resolveLimit(explicit, [`${action}.day`, "messages.day", "dailyMessages"]), "Message pacing", "messages"),
      cap("week", resolveLimit(explicit, [`${action}.week`, "messages.week", "weeklyMessages"]) ?? finiteNumber(senderAccount?.automationControls?.weeklyQuotas?.messages), "Message pacing", "messages"),
    ];
  }
  return [
    cap("hour", resolveLimit(explicit, [`${action}.hour`, "publicEngagement.hour"]), "LinkedIn action pacing", "actions"),
    cap("day", resolveLimit(explicit, [`${action}.day`, "publicEngagement.day"]), "LinkedIn action pacing", "actions"),
    cap("week", resolveLimit(explicit, [`${action}.week`, "publicEngagement.week"]), "LinkedIn action pacing", "actions"),
  ];
}

/**
 * @param {"hour" | "day" | "week"} period
 * @param {number | null} limit
 * @param {string} label
 * @param {string} actionLabel
 */
function cap(period, limit, label, actionLabel) {
  return {
    period,
    periodlyName: period === "day" ? "daily" : period === "week" ? "weekly" : "hourly",
    limit,
    label,
    actionLabel,
  };
}

/**
 * @param {Record<string, any>} explicit
 * @param {string[]} paths
 */
function resolveLimit(explicit, paths) {
  for (const path of paths) {
    const value = getPath(explicit, path);
    const finite = finiteNumber(value);
    if (finite !== null) return finite;
  }
  return null;
}

/**
 * @param {Record<string, any>} object
 * @param {string} path
 */
function getPath(object, path) {
  return path.split(".").reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, object);
}

/** @param {any} senderAccount */
function resolveWarmupDailyConnectionLimit(senderAccount) {
  const warmup = senderAccount?.metadata?.dispatchPolicy?.warmup ?? senderAccount?.metadata?.warmup ?? {};
  return resolveLimit(warmup, [
    "dailyConnectionRequests",
    "dailyConnectionRequestLimit",
    "maxDailyConnectionRequests",
  ]);
}

/**
 * @param {{
 *   prospect: any,
 *   account: any,
 *   senderAccount: any,
 * }} input
 */
function resolveTargetTimezone(input) {
  return normalizeString(input.prospect?.targetTimezone)
    ?? normalizeString(input.prospect?.targetTimeZone)
    ?? normalizeString(input.prospect?.timezone)
    ?? normalizeString(input.prospect?.locationTimezone)
    ?? normalizeString(input.prospect?.metadata?.targetTimezone)
    ?? normalizeString(input.prospect?.metadata?.timezone)
    ?? normalizeString(input.prospect?.linkedinProfileSnapshot?.targetTimezone)
    ?? normalizeString(input.prospect?.linkedinProfileSnapshot?.timezone)
    ?? normalizeString(input.prospect?.linkedinProfileSnapshot?.locationTimezone)
    ?? normalizeString(input.account?.targetTimezone)
    ?? normalizeString(input.account?.targetTimeZone)
    ?? normalizeString(input.account?.metadata?.targetTimezone)
    ?? normalizeString(input.senderAccount?.metadata?.dispatchPolicy?.defaultTargetTimezone)
    ?? null;
}

/**
 * @param {any} prospect
 * @param {any} account
 * @param {any} senderAccount
 */
function resolveTargetWindow(prospect, account, senderAccount) {
  const candidate = prospect?.sendWindow
    ?? prospect?.metadata?.sendWindow
    ?? account?.sendWindow
    ?? account?.metadata?.sendWindow
    ?? senderAccount?.metadata?.dispatchPolicy?.targetSendWindow
    ?? {};
  return {
    weekdays: Array.isArray(candidate.weekdays) && candidate.weekdays.length
      ? candidate.weekdays.map((value) => String(value).slice(0, 3).toLowerCase())
      : DEFAULT_TARGET_WINDOW.weekdays,
    startLocalTime: normalizeLocalTime(candidate.startLocalTime) ?? DEFAULT_TARGET_WINDOW.startLocalTime,
    endLocalTime: normalizeLocalTime(candidate.endLocalTime) ?? DEFAULT_TARGET_WINDOW.endLocalTime,
  };
}

/** @param {string | null} surface */
function isSendWindowExempt(surface) {
  return surface === "inbound_reply" || surface === "comment_reply";
}

/**
 * @param {string} now
 * @param {string} timezone
 * @param {{ weekdays: string[], startLocalTime: string, endLocalTime: string }} window
 */
function classifyTargetWindow(now, timezone, window) {
  const nowDate = new Date(now);
  const parts = localParts(nowDate, timezone);
  const localMinutes = parts.hour * 60 + parts.minute;
  const start = localTimeToMinutes(window.startLocalTime);
  const end = localTimeToMinutes(window.endLocalTime);
  const openNow = window.weekdays.includes(parts.weekday) && localMinutes >= start && localMinutes < end;
  if (openNow) {
    return { openNow: true, nextOpenAt: nowDate.toISOString() };
  }
  return {
    openNow: false,
    nextOpenAt: findNextOpenAt(nowDate, timezone, window),
  };
}

/**
 * @param {Date} date
 * @param {string} timezone
 */
function localParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const byType = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: String(byType.weekday ?? "").slice(0, 3).toLowerCase(),
    hour: Number.parseInt(byType.hour ?? "0", 10),
    minute: Number.parseInt(byType.minute ?? "0", 10),
  };
}

/**
 * @param {Date} from
 * @param {string} timezone
 * @param {{ weekdays: string[], startLocalTime: string, endLocalTime: string }} window
 */
function findNextOpenAt(from, timezone, window) {
  const startAt = new Date(from.getTime() + 60 * 1000);
  const stepMs = 5 * 60 * 1000;
  for (let elapsedMs = 0; elapsedMs <= 8 * 24 * 60 * 60 * 1000; elapsedMs += stepMs) {
    const candidate = new Date(startAt.getTime() + elapsedMs);
    const parts = localParts(candidate, timezone);
    const minutes = parts.hour * 60 + parts.minute;
    if (
      window.weekdays.includes(parts.weekday)
      && minutes >= localTimeToMinutes(window.startLocalTime)
      && minutes < localTimeToMinutes(window.endLocalTime)
    ) {
      return candidate.toISOString();
    }
  }
  return null;
}

/**
 * @param {any} senderAccount
 * @param {string} action
 */
function resolveLinkedinSpacing(senderAccount, action) {
  const policy = senderAccount?.metadata?.dispatchPolicy?.spacing ?? {};
  const actionPolicy = policy[action] ?? policy.linkedin ?? policy;
  const minDelayMs = finiteNumber(actionPolicy.minDelayMs) ?? DEFAULT_LINKEDIN_SPACING.minDelayMs;
  const maxDelayMs = finiteNumber(actionPolicy.maxDelayMs) ?? DEFAULT_LINKEDIN_SPACING.maxDelayMs;
  return {
    minDelayMs: Math.max(0, minDelayMs),
    maxDelayMs: Math.max(minDelayMs, maxDelayMs),
  };
}

/**
 * @param {{ minDelayMs: number, maxDelayMs: number, seed: string }} input
 */
function deterministicDelayMs(input) {
  if (input.maxDelayMs <= input.minDelayMs) return input.minDelayMs;
  let hash = 0;
  for (const char of input.seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const span = input.maxDelayMs - input.minDelayMs;
  return input.minDelayMs + (hash % (span + 1));
}

/**
 * @param {Array<Record<string, any>>} history
 * @param {(event: Record<string, any>) => boolean} predicate
 */
function latestHistoryEvent(history, predicate) {
  return history
    .filter(predicate)
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))[0] ?? null;
}

/**
 * @param {string} iso
 * @param {number} ms
 */
function addMs(iso, ms) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

/** @param {unknown} value */
function finiteNumber(value) {
  if (value === null || value === undefined || value === "unlimited") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

/** @param {unknown} value */
function normalizeString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/** @param {unknown} value */
function normalizeIso(value) {
  const string = normalizeString(value);
  if (!string) return null;
  const date = new Date(string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** @param {unknown} value */
function normalizeLocalTime(value) {
  const normalized = normalizeString(value);
  return normalized && /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : null;
}

/** @param {string} value */
function localTimeToMinutes(value) {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}

/** @param {unknown} value */
function normalizeLinkedinUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return normalized
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/g, "")
    .toLowerCase();
}
