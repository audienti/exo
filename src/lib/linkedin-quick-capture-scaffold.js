// @ts-check

import { fileURLToPath } from "node:url";

export const LINKEDIN_QUICK_CAPTURE_SCAFFOLD_VERSION = "exo-linkedin-quick-capture-v1";
export const LINKEDIN_QUICK_CAPTURE_SCAFFOLD_MODULE_PATH = fileURLToPath(import.meta.url);

/**
 * @param {{ limit?: number | null }} [input]
 */
export function buildLinkedinQuickCaptureScaffold(input = {}) {
  const limit = normalizePositiveInteger(input.limit, 20);

  return {
    version: LINKEDIN_QUICK_CAPTURE_SCAFFOLD_VERSION,
    modulePath: LINKEDIN_QUICK_CAPTURE_SCAFFOLD_MODULE_PATH,
    runtime: "browser_page_evaluate",
    mode: "snapshot_extractor",
    bootstrapSymbol: "__exoLinkedinQuickCapture",
    entrypoints: {
      bootstrapSourceBuilder: "buildLinkedinQuickCaptureBootstrapSource",
      evaluateSourceBuilder: "buildLinkedinQuickCaptureEvaluateSource"
    },
    usage: [
      "Use this scaffold before inventing a larger ad hoc LinkedIn DOM script.",
      "Load buildLinkedinQuickCaptureBootstrapSource() into the page context once, then call buildLinkedinQuickCaptureEvaluateSource(...) per surface snapshot.",
      "Pass the attached surfaceHints.<surface> object into the scaffold call as hint so selectors and pagination roots stay governed.",
      "Use this scaffold only for read-only DOM extraction. Continue to use surfaceHints, captureGuide, outputGuide, and Exo CLI for pagination policy, writeback, and verification."
    ],
    helperSummary: [
      "Normalizes text, absolute URLs, and LinkedIn public-id extraction.",
      "Finds finite-scroll or list roots from surface hints instead of hard-coding one container.",
      "Extracts normalized snapshot rows for sent invitations, messaging inbox, and profile views.",
      "Returns DOM snapshot metadata only. Exhaustion and reconcile semantics stay outside the scaffold."
    ],
    supportedSurfaces: {
      sentInvitations: {
        snapshotKind: "pending_invitation_rows",
        hintKey: "surfaceHints.sentInvitations",
        rowStrategy: "withdraw_control_or_profile_anchor_row"
      },
      messagingInbox: {
        snapshotKind: "conversation_rows",
        hintKey: "surfaceHints.messagingInbox",
        rowStrategy: "conversation_listitem_row"
      },
      profileViews: {
        snapshotKind: "viewer_rows",
        hintKey: "surfaceHints.profileViews",
        rowStrategy: "finite_scroll_profile_view_row"
      }
    },
    suggestedItemLimit: limit
  };
}

export function buildLinkedinQuickCaptureBootstrapSource() {
  return `(${installLinkedinQuickCapture.toString()})();`;
}

/**
 * @param {{
 *   surfaceKey: "sentInvitations" | "messagingInbox" | "profileViews",
 *   requestedMode?: string | null,
 *   limit?: number | null,
 *   hint?: unknown
 * }} input
 */
export function buildLinkedinQuickCaptureEvaluateSource(input) {
  return `(() => {
    const install = ${installLinkedinQuickCapture.toString()};
    const capture = install();
    return capture.captureSurface(${JSON.stringify({
      surfaceKey: input.surfaceKey,
      requestedMode: input.requestedMode ?? null,
      limit: normalizePositiveInteger(input.limit, 20),
      hint: input.hint ?? null
    })});
  })();`;
}

function installLinkedinQuickCapture() {
  const symbol = "__exoLinkedinQuickCapture";
  if (window[symbol]) {
    return window[symbol];
  }

  function normalizeText(value) {
    return typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : "";
  }

  function absoluteUrl(value) {
    if (!value || typeof value !== "string") {
      return null;
    }

    try {
      return new URL(value, window.location.href).toString();
    } catch (_error) {
      return null;
    }
  }

  function pickFirst(root, selectors) {
    if (!root || !Array.isArray(selectors)) {
      return null;
    }

    for (const selector of selectors) {
      if (typeof selector !== "string" || !selector.trim()) {
        continue;
      }

      const match = root.querySelector(selector);
      if (match) {
        return match;
      }
    }

    return null;
  }

  function pickAll(root, selectors) {
    if (!root || !Array.isArray(selectors)) {
      return [];
    }

    for (const selector of selectors) {
      if (typeof selector !== "string" || !selector.trim()) {
        continue;
      }

      const matches = Array.from(root.querySelectorAll(selector));
      if (matches.length) {
        return matches;
      }
    }

    return [];
  }

  function extractPublicIdFromUrl(url) {
    if (!url) {
      return null;
    }

    const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
    return match ? match[1] : null;
  }

  function findRoot(hint, fallbackSelectors) {
    const hintedSelectors = [
      ...(hint?.readyHints?.finiteScrollSelectors ?? []),
      ...(hint?.readyHints?.conversationListScrollSelectors ?? []),
      ...(hint?.readyHints?.domFallbackRootSelectors ?? [])
    ];
    return pickFirst(document, hintedSelectors) || pickFirst(document, fallbackSelectors) || document.body;
  }

  function extractVisibleTotalCount(root) {
    const text = normalizeText(root?.innerText || document.body?.innerText || "");
    const matches = Array.from(text.matchAll(/\\b(\\d{1,3}(?:,\\d{3})*|\\d+)\\b/g))
      .map((match) => Number.parseInt(match[1].replaceAll(",", ""), 10))
      .filter((value) => Number.isFinite(value) && value > 0);

    return matches.length ? Math.max(...matches) : null;
  }

  function extractActorFromRow(row) {
    const profileAnchor = row.querySelector('a[href*="/in/"]');
    const profileUrl = absoluteUrl(profileAnchor?.getAttribute("href") ?? null);
    const actorName = normalizeText(
      profileAnchor?.textContent
        || row.querySelector("strong, h3, h4, [aria-label]")?.textContent
        || ""
    ) || null;
    const summaryText = normalizeText(row.innerText || "");
    const lines = summaryText.split(/\\n+/).map(normalizeText).filter(Boolean);

    return {
      actorName,
      actorProfileUrl: profileUrl,
      actorLinkedinPublicId: extractPublicIdFromUrl(profileUrl),
      actorTitle: lines[1] ?? null,
      actorCompanyName: lines[2] ?? null,
      actorAvatarSourceUrl: absoluteUrl(row.querySelector("img")?.getAttribute("src") ?? null),
      rowText: summaryText
    };
  }

  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter((row) => {
      const key = row.rowKey || row.profileUrl || row.threadUrl || row.summary;
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function captureSentInvitations(input) {
    const root = findRoot(input.hint, [
      ".scaffold-finite-scroll__content",
      ".scaffold-finite-scroll",
      "main[role='main']",
      "main"
    ]);
    const withdrawButtons = Array.from(root.querySelectorAll("button, a"))
      .filter((node) => /withdraw/i.test(normalizeText(node.textContent || node.getAttribute("aria-label") || "")));
    const rows = withdrawButtons.map((button) => {
      const row = button.closest("li, article, div");
      return row && row !== root ? row : null;
    }).filter(Boolean);

    return {
      surfaceKey: "sentInvitations",
      capturedAt: new Date().toISOString(),
      visibleTotalCount: extractVisibleTotalCount(root),
      rowCount: rows.length,
      rows: uniqueRows(rows.slice(0, input.limit || 20).map((row, index) => {
        const actor = extractActorFromRow(row);
        const summary = actor.rowText || `Pending sent invitation ${index + 1}`;
        return {
          rowKey: actor.actorProfileUrl || actor.actorLinkedinPublicId || `sent-row-${index + 1}`,
          invitationId: actor.actorProfileUrl || actor.actorLinkedinPublicId || `sent-row-${index + 1}`,
          summary,
          profileUrl: actor.actorProfileUrl,
          actorName: actor.actorName,
          actorTitle: actor.actorTitle,
          actorCompanyName: actor.actorCompanyName,
          actorLinkedinPublicId: actor.actorLinkedinPublicId,
          actorAvatarSourceUrl: actor.actorAvatarSourceUrl,
          availableAction: "withdraw"
        };
      }))
    };
  }

  function captureMessagingInbox(input) {
    const root = findRoot(input.hint, [
      ".msg-conversations-container__conversations-list",
      ".msg-conversations-container",
      "main[role='main']",
      "main"
    ]);
    const rowSelectors = [
      input.hint?.readyHints?.conversationRowsSelector,
      "li.msg-conversation-listitem",
      ".msg-conversation-card"
    ].filter(Boolean);
    const rows = pickAll(root, rowSelectors);

    return {
      surfaceKey: "messagingInbox",
      capturedAt: new Date().toISOString(),
      visibleTotalCount: rows.length,
      rowCount: rows.length,
      rows: uniqueRows(rows.slice(0, input.limit || 20).map((row, index) => {
        const actor = extractActorFromRow(row);
        const link = absoluteUrl(row.querySelector("a[href*='/messaging/']")?.getAttribute("href") ?? null);
        return {
          rowKey: link || actor.actorProfileUrl || `thread-${index + 1}`,
          threadId: link || actor.actorProfileUrl || `thread-${index + 1}`,
          summary: actor.rowText || `Conversation ${index + 1}`,
          threadUrl: link,
          actorName: actor.actorName,
          actorTitle: actor.actorTitle,
          actorCompanyName: actor.actorCompanyName,
          actorLinkedinPublicId: actor.actorLinkedinPublicId,
          actorAvatarSourceUrl: actor.actorAvatarSourceUrl
        };
      }))
    };
  }

  function captureProfileViews(input) {
    const root = findRoot(input.hint, [
      ".scaffold-finite-scroll__content",
      ".scaffold-finite-scroll",
      "main[role='main']",
      "main"
    ]);
    const rows = pickAll(root, [
      "li",
      "article",
      "[data-view-name='profile-view-browse-map'] [data-view-name]",
      "[class*='profile-views'] li"
    ]).filter((row) => row.querySelector('a[href*="/in/"], img'));

    return {
      surfaceKey: "profileViews",
      capturedAt: new Date().toISOString(),
      visibleTotalCount: extractVisibleTotalCount(root),
      rowCount: rows.length,
      rows: uniqueRows(rows.slice(0, input.limit || 20).map((row, index) => {
        const actor = extractActorFromRow(row);
        return {
          rowKey: actor.actorProfileUrl || actor.actorLinkedinPublicId || `viewer-${index + 1}`,
          viewId: actor.actorProfileUrl || actor.actorLinkedinPublicId || `viewer-${index + 1}`,
          summary: actor.rowText || `Profile viewer ${index + 1}`,
          actorName: actor.actorName,
          actorTitle: actor.actorTitle,
          actorCompanyName: actor.actorCompanyName,
          actorProfileUrl: actor.actorProfileUrl,
          actorLinkedinPublicId: actor.actorLinkedinPublicId,
          actorAvatarSourceUrl: actor.actorAvatarSourceUrl
        };
      }))
    };
  }

  function captureSurface(input) {
    const normalized = {
      surfaceKey: input?.surfaceKey ?? null,
      requestedMode: input?.requestedMode ?? null,
      limit: Number.isInteger(input?.limit) && input.limit > 0 ? input.limit : 20,
      hint: input?.hint ?? null
    };

    if (normalized.surfaceKey === "sentInvitations") {
      return captureSentInvitations(normalized);
    }
    if (normalized.surfaceKey === "messagingInbox") {
      return captureMessagingInbox(normalized);
    }
    if (normalized.surfaceKey === "profileViews") {
      return captureProfileViews(normalized);
    }

    return {
      surfaceKey: normalized.surfaceKey,
      capturedAt: new Date().toISOString(),
      unsupported: true,
      reason: "This scaffold currently supports sentInvitations, messagingInbox, and profileViews only."
    };
  }

  const api = {
    version: "exo-linkedin-quick-capture-v1",
    captureSurface
  };
  window[symbol] = api;
  return api;
}

/**
 * @param {number | null | undefined} value
 * @param {number} fallback
 */
function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.trunc(parsed);
}
