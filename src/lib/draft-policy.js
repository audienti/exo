// @ts-check

export const AUTO_SEND_DRAFT_SURFACES = new Set([
  "connection_request",
  "post_accept_message",
  "follow_up_direct_message",
]);

export const SENDABLE_DRAFT_STATUSES = new Set(["approved", "queued"]);

/** @param {string | null | undefined} surface */
export function isAutoSendDraftSurface(surface) {
  return AUTO_SEND_DRAFT_SURFACES.has(String(surface ?? ""));
}

/** @param {string | null | undefined} status */
export function isSendableDraftStatus(status) {
  return SENDABLE_DRAFT_STATUSES.has(String(status ?? ""));
}

/** @param {string | null | undefined} surface */
export function draftWritebackStatusForSurface(surface) {
  return isAutoSendDraftSurface(surface) ? "queued" : "ready";
}

/**
 * Some detached Codex passes may return a structured draft envelope instead of
 * the plain outbound body. That envelope is useful for diagnostics, but it is
 * not safe to store or send verbatim.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStructuredDraftEnvelope(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return false;
  const parsed = tryParseJson(trimmed);
  if (!parsed || typeof parsed !== "object") return false;
  return Boolean(
    typeof parsed.motionId === "string"
    || typeof parsed.surfaceKey === "string"
    || (parsed.draft && typeof parsed.draft === "object")
  );
}

/**
 * Best-effort extraction of the actual outbound copy from a plain string,
 * schema object, or accidentally persisted structured draft envelope.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function extractUsableDraftBody(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) return null;
    if (!trimmed.startsWith("{")) return trimmed;
    const parsed = tryParseJson(trimmed);
    if (!parsed || typeof parsed !== "object") return trimmed;
    return extractUsableDraftBodyFromObject(parsed) ?? trimmed;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  return extractUsableDraftBodyFromObject(value);
}

/**
 * @param {Record<string, any>} value
 * @returns {string | null}
 */
function extractUsableDraftBodyFromObject(value) {
  if (typeof value.text === "string" && value.text.trim().length) {
    return value.text.trim();
  }

  if (typeof value.body === "string") {
    const nested = extractUsableDraftBody(value.body);
    if (nested) return nested;
  }

  if (value.draft && typeof value.draft === "object") {
    if (typeof value.draft.text === "string" && value.draft.text.trim().length) {
      return value.draft.text.trim();
    }
    if (typeof value.draft.body === "string") {
      const nested = extractUsableDraftBody(value.draft.body);
      if (nested) return nested;
    }
  }

  return null;
}

/**
 * @param {string} text
 * @returns {Record<string, any> | null}
 */
function tryParseJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
