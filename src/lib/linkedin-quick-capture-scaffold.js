// @ts-check

import { fileURLToPath } from "node:url";

export const LINKEDIN_QUICK_CAPTURE_SCAFFOLD_VERSION = "exo-linkedin-quick-capture-v2";
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
      "Extracts normalized snapshot rows for sent invitations, messaging inbox, profile views, and followers.",
      "Returns DOM snapshot metadata only. Exhaustion and reconcile semantics stay outside the scaffold."
    ],
    supportedSurfaces: {
      sentInvitations: {
        snapshotKind: "pending_invitation_rows",
        hintKey: "surfaceHints.sentInvitations",
        rowStrategy: "withdraw_control_or_profile_anchor_row"
      },
      receivedInvitations: {
        snapshotKind: "received_invitation_rows",
        hintKey: "surfaceHints.receivedInvitations",
        rowStrategy: "accept_or_ignore_control_row"
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
      },
      followersList: {
        snapshotKind: "follower_rows",
        hintKey: "surfaceHints.followersList",
        rowStrategy: "network_followers_list_row"
      },
      followingList: {
        snapshotKind: "following_rows",
        hintKey: "surfaceHints.followingList",
        rowStrategy: "network_following_list_row"
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
 *   surfaceKey: "sentInvitations" | "receivedInvitations" | "messagingInbox" | "profileViews" | "followersList" | "followingList",
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
  const version = "exo-linkedin-quick-capture-v2";
  if (window[symbol] && window[symbol].version === version) {
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

  function uniqueNodes(nodes) {
    const seen = new Set();
    return nodes.filter((node) => {
      if (!node || seen.has(node)) {
        return false;
      }
      seen.add(node);
      return true;
    });
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

  function isInvitationChromeLine(value) {
    const text = normalizeText(value);
    if (!text) {
      return false;
    }
    return /^invitation settings$/i.test(text)
      || /^manage invitations$/i.test(text)
      || /^received$/i.test(text)
      || /^sent$/i.test(text)
      || /^people \(\d+\)$/i.test(text);
  }

  function isInvitationRelativeLine(value) {
    const text = normalizeText(value);
    if (!text) {
      return false;
    }
    return /^sent\s+(today|yesterday|\d+\s+(?:hour|day|week|month|year)s?\s+ago)$/i.test(text);
  }

  function findLikelyInvitationNameFromLines(lines) {
    if (!Array.isArray(lines) || !lines.length) {
      return null;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = normalizeText(lines[index]);
      if (!line || isInvitationChromeLine(line) || isInvitationControlLabel(line) || isInvitationRelativeLine(line)) {
        continue;
      }
      const next = normalizeText(lines[index + 1] || "");
      const next2 = normalizeText(lines[index + 2] || "");
      if (isInvitationRelativeLine(next) || isInvitationRelativeLine(next2)) {
        return line;
      }
    }

    return lines.find((line) => {
      const text = normalizeText(line);
      return text && !isInvitationChromeLine(text) && !isInvitationControlLabel(text) && !isInvitationRelativeLine(text);
    }) || null;
  }

  function normalizeInvitationMetadataLine(value) {
    const line = normalizeText(value);
    if (!line || isInvitationChromeLine(line) || isInvitationControlLabel(line) || isInvitationRelativeLine(line)) {
      return null;
    }
    return line;
  }

  function extractActorFromRow(row) {
    const profileAnchor = row.querySelector('a[href*="/in/"]');
    const profileUrl = absoluteUrl(profileAnchor?.getAttribute("href") ?? null);
    const rawText = typeof row.innerText === "string"
      ? row.innerText
      : (row.textContent || "");
    const lines = rawText.split(/\n+/).map(normalizeText).filter(Boolean);
    const lineActorName = findLikelyInvitationNameFromLines(lines);
    const actorNameCandidates = [
      profileAnchor?.textContent,
      profileAnchor?.getAttribute("aria-label"),
      lineActorName,
      row.querySelector("strong, h3, h4, span[dir='ltr'], .t-16")?.textContent,
      row.querySelector("[aria-label]")?.getAttribute("aria-label"),
    ]
      .map((value) => normalizeText(value || ""))
      .filter((value) => value && !isInvitationChromeLine(value));
    const actorName = actorNameCandidates[0] || null;
    const summaryText = normalizeText(rawText || "");
    const actorNameLineIndex = actorName
      ? lines.findIndex((line) => normalizeText(line) === actorName)
      : -1;
    const actorTitle = actorNameLineIndex >= 0
      ? normalizeInvitationMetadataLine(lines[actorNameLineIndex + 1])
      : normalizeInvitationMetadataLine(lines[1]);
    const actorCompanyName = actorTitle
      ? normalizeInvitationMetadataLine(lines[(actorNameLineIndex >= 0 ? actorNameLineIndex : 0) + 2])
      : null;
    const invitationNote = extractInvitationNote(lines, {
      actorName,
      actorNameLineIndex,
      actorTitle,
      actorCompanyName,
    });

    return {
      actorName,
      actorProfileUrl: profileUrl,
      actorLinkedinPublicId: extractPublicIdFromUrl(profileUrl),
      actorTitle,
      actorCompanyName,
      invitationNote,
      actorAvatarSourceUrl: absoluteUrl(row.querySelector("img")?.getAttribute("src") ?? null),
      rowText: summaryText
    };
  }

  function extractInvitationNote(lines, actor) {
    const startIndex = actor.actorNameLineIndex >= 0 ? actor.actorNameLineIndex : 0;
    const ignored = new Set([
      actor.actorName,
      actor.actorTitle,
      actor.actorCompanyName,
    ].map((value) => normalizeText(value || "")).filter(Boolean));
    const noteLines = lines
      .slice(startIndex)
      .map((line) => normalizeText(line))
      .filter(Boolean)
      .filter((line) => !ignored.has(line))
      .filter((line) => !isInvitationChromeLine(line))
      .filter((line) => !isInvitationControlLabel(line))
      .filter((line) => !isInvitationRelativeLine(line));
    return noteLines.length ? noteLines.join("\n") : null;
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

  function isInvitationControlLabel(value) {
    const text = normalizeText(value);
    if (!text) {
      return false;
    }
    return /^(withdraw|accept|ignore)\b/i.test(text);
  }

  function resolveInvitationRow(control, root) {
    if (!control || !root) {
      return null;
    }

    const semanticRow = control.closest("li, article, section");
    if (semanticRow && semanticRow !== root) {
      return semanticRow;
    }

    const controlText = normalizeText(control.textContent || control.getAttribute("aria-label") || "");
    let fallback = null;
    let current = control.parentElement;
    while (current && current !== root) {
      const rowText = normalizeText(current.innerText || "");
      const hasProfileAnchor = !!current.querySelector('a[href*="/in/"]');
      const hasAvatar = !!current.querySelector("img");
      if (!fallback && (hasProfileAnchor || hasAvatar)) {
        fallback = current;
      }
      if (hasProfileAnchor && rowText && rowText !== controlText) {
        return current;
      }
      current = current.parentElement;
    }

    return fallback || control.closest("div");
  }

  function resolveInvitationRowFromProfileAnchor(anchor, root, controlPattern) {
    if (!anchor || !root) {
      return null;
    }

    const anchorText = normalizeText(anchor.textContent || anchor.getAttribute("aria-label") || "");
    let fallback = null;
    let current = anchor.parentElement;
    while (current && current !== root) {
      const controls = Array.from(current.querySelectorAll("button, a, span"));
      const hasMatchingControl = controls.some((node) => controlPattern.test(normalizeText(node.textContent || node.getAttribute("aria-label") || "")));
      if (hasMatchingControl) {
        const rowText = normalizeText(current.innerText || "");
        if (!fallback) {
          fallback = current;
        }
        if (rowText && rowText !== anchorText && current.matches("li, article, section")) {
          return current;
        }
      }
      current = current.parentElement;
    }

    return fallback;
  }

  function normalizeInvitationActorLabel(value) {
    const text = normalizeText(value);
    if (!text) {
      return null;
    }
    const sentMatch = text.match(/^withdraw invitation sent to (.+)$/i);
    if (sentMatch) {
      return normalizeText(sentMatch[1]) || null;
    }
    const receivedMatch = text.match(/^(?:accept|ignore)\s+(.+?)'s invitation$/i);
    if (receivedMatch) {
      return normalizeText(receivedMatch[1]) || null;
    }
    if (isInvitationControlLabel(text)) {
      return null;
    }
    return text;
  }

  function extractInvitationRelativePhrase(value) {
    const text = normalizeText(value);
    if (!text) {
      return null;
    }
    const match = text.match(/\bSent\s+(today|yesterday|\d+\s+(?:hour|day|week|month|year)s?\s+ago)\b/i);
    return match ? normalizeText(match[0]) : null;
  }

  function buildInvitationSummary(config, actorName, rowText, index) {
    const normalizedActorName = normalizeInvitationActorLabel(actorName);
    if (config.surfaceKey === "sentInvitations") {
      const relativePhrase = extractInvitationRelativePhrase(rowText);
      if (normalizedActorName && relativePhrase) {
        return `${normalizedActorName} ${relativePhrase}`;
      }
      if (normalizedActorName) {
        return `${normalizedActorName} is still in the sent invitations queue.`;
      }
    }
    if (config.surfaceKey === "receivedInvitations" && normalizedActorName) {
      return `${normalizedActorName} sent an inbound connection request.`;
    }
    return rowText || `${config.summaryPrefix} ${index + 1}`;
  }

  function captureInvitationRows(input, config) {
    const root = findRoot(input.hint, [
      ".scaffold-finite-scroll__content",
      ".scaffold-finite-scroll",
      "main[role='main']",
      "main"
    ]);
    const controlPattern = config.controlPattern;
    const profileAnchorRows = uniqueNodes(
      Array.from(root.querySelectorAll('a[href*="/in/"]'))
        .map((anchor) => resolveInvitationRowFromProfileAnchor(anchor, root, controlPattern))
        .filter(Boolean)
    );
    const matchedControls = Array.from(root.querySelectorAll("button, a, span"))
      .filter((node) => controlPattern.test(normalizeText(node.textContent || node.getAttribute("aria-label") || "")));
    const controlRows = uniqueNodes(matchedControls.map((control) => {
      const row = resolveInvitationRow(control, root);
      return row && row !== root ? row : null;
    }).filter(Boolean));
    const rows = uniqueNodes([...profileAnchorRows, ...controlRows]);

    return {
      surfaceKey: config.surfaceKey,
      capturedAt: new Date().toISOString(),
      visibleTotalCount: extractVisibleTotalCount(root),
      rowCount: rows.length,
      rows: uniqueRows(rows.slice(0, input.limit || 20).map((row, index) => {
        const actor = extractActorFromRow(row);
        const normalizedActorName = normalizeInvitationActorLabel(actor.actorName) ?? actor.actorName;
        const summary = buildInvitationSummary(config, normalizedActorName, actor.rowText, index);
        return {
          rowKey: actor.actorProfileUrl || actor.actorLinkedinPublicId || normalizedActorName || `${config.idPrefix}-${index + 1}`,
          invitationId: actor.actorProfileUrl || actor.actorLinkedinPublicId || normalizedActorName || `${config.idPrefix}-${index + 1}`,
          summary,
          actorProfileUrl: actor.actorProfileUrl,
          actorName: normalizedActorName,
          actorTitle: actor.actorTitle,
          actorCompanyName: actor.actorCompanyName,
          invitationNote: actor.invitationNote,
          actorLinkedinPublicId: actor.actorLinkedinPublicId,
          actorAvatarSourceUrl: actor.actorAvatarSourceUrl,
          availableAction: config.availableAction
        };
      }))
    };
  }

  function captureSentInvitations(input) {
    return captureInvitationRows(input, {
      surfaceKey: "sentInvitations",
      controlPattern: /withdraw/i,
      summaryPrefix: "Pending sent invitation",
      idPrefix: "sent-row",
      availableAction: "withdraw"
    });
  }

  function captureReceivedInvitations(input) {
    return captureInvitationRows(input, {
      surfaceKey: "receivedInvitations",
      controlPattern: /\b(accept|ignore)\b/i,
      summaryPrefix: "Received invitation",
      idPrefix: "received-row",
      availableAction: "accept_or_ignore"
    });
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

  function captureFollowersList(input) {
    return captureFollowList(input, {
      surfaceKey: "followersList",
      summaryPrefix: "Follower",
      idPrefix: "follower"
    });
  }

  function captureFollowingList(input) {
    return captureFollowList(input, {
      surfaceKey: "followingList",
      summaryPrefix: "Following",
      idPrefix: "following"
    });
  }

  function captureFollowList(input, config) {
    const root = findRoot(input.hint, [
      ".scaffold-finite-scroll__content",
      ".scaffold-finite-scroll",
      "main[role='main']",
      "main"
    ]);
    const rows = pickAll(root, [
      ...(input.hint?.readyHints?.rowSelectors ?? []),
      "li",
      "article",
      "[class*='follow-list'] li"
    ]).filter((row) => row.querySelector('a[href*="/in/"], img'));

    return {
      surfaceKey: config.surfaceKey,
      capturedAt: new Date().toISOString(),
      visibleTotalCount: extractVisibleTotalCount(root),
      rowCount: rows.length,
      rows: uniqueRows(rows.slice(0, input.limit || 20).map((row, index) => {
        const actor = extractActorFromRow(row);
        return {
          rowKey: actor.actorProfileUrl || actor.actorLinkedinPublicId || `${config.idPrefix}-${index + 1}`,
          entryId: actor.actorProfileUrl || actor.actorLinkedinPublicId || `${config.idPrefix}-${index + 1}`,
          summary: actor.rowText || `${config.summaryPrefix} ${index + 1}`,
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
    if (normalized.surfaceKey === "receivedInvitations") {
      return captureReceivedInvitations(normalized);
    }
    if (normalized.surfaceKey === "messagingInbox") {
      return captureMessagingInbox(normalized);
    }
    if (normalized.surfaceKey === "profileViews") {
      return captureProfileViews(normalized);
    }
    if (normalized.surfaceKey === "followersList") {
      return captureFollowersList(normalized);
    }
    if (normalized.surfaceKey === "followingList") {
      return captureFollowingList(normalized);
    }

    return {
      surfaceKey: normalized.surfaceKey,
      capturedAt: new Date().toISOString(),
      unsupported: true,
      reason: "This scaffold currently supports sentInvitations, receivedInvitations, messagingInbox, profileViews, followersList, and followingList only."
    };
  }

  const api = {
    version,
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
