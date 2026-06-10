// @ts-check
//
// Render the Prospects surface (Exo UI Build Spec — canonical people inventory)
// as static HTML.
//
// One self-contained page:
//   - a CSS-only segmented control: All (dense table) / By company (groups)
//   - anchored per-person detail sections (identity header, key-fact tiles,
//     surfacing signal, the premise they're evidence for, recommended next
//     step, colleagues at the same company)
//
// Field vocabulary mirrors Audienti v10's prospects surface (fit, signal,
// branch, assignee, age, same-company targets) mapped onto Exo's schema.

import {
  avatar,
  btn,
  countChip,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  ownerTag,
  renderMotionChoiceOption,
  renderNextMoveAlert,
  renderShell,
  stateDot,
  truthTag,
} from "../lib/exo-ui-components.js";
import { isSendableDraftStatus } from "../lib/draft-policy.js";
import { describePrivateInboundResponse } from "../core/private-inbound-message-classification.js";
import { selectNextDraftSurface } from "../core/select-next-draft-surface.js";

/**
 * @param {ReturnType<import("../core/build-prospects-view.js").buildProspectsViewModel>} model
 * @param {{ user?: { label?: string } | null, generatedAt?: string, regenerateCommand?: string }} [meta]
 * @returns {string}
 */
export function renderProspectsPage(model, meta = {}) {
  // Interactive mode routes each person to a real detail page (/prospects/:id),
  // so the list shows only the list. Static export stays self-contained: the
  // detail sections are anchored below the list.
  const detailSections = meta.interactive
    ? ""
    : `<div class="pd-sections">${model.details.map((p) => renderPersonDetail(p, meta)).join("")}</div>`;

  const body =
    `<input type="radio" name="pr-view" id="pr-all" class="seg-toggle" checked>` +
    `<input type="radio" name="pr-view" id="pr-company" class="seg-toggle">` +
    `<div class="dom-wrap" id="prospects-top">` +
    renderIntro(model) +
    `<div class="pr-all-view">${renderTable(model.all, meta)}</div>` +
    `<div class="pr-company-view">${renderGroups(model.groups, meta)}</div>` +
    `</div>` +
    detailSections +
    `<div class="dom-wrap">${renderFooter(meta)}</div>`;

  return renderShell({
    title: `Exo — Prospects${meta.user?.label ? ` · ${meta.user.label}` : ""}`,
    activeId: "prospects",
    sectionLabel: "Prospects",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    agentRuntime: meta.agentRuntime ?? null,
    search: meta.interactive
      ? {
          action: "/prospects",
          query: model.search?.query ?? meta.searchQuery ?? "",
          placeholder: "Search prospects, company, signal…",
          ariaLabel: "Search prospects",
          clearHref: "/prospects",
        }
      : null,
  });
}

/**
 * Render one prospect as its own routed detail page (interactive UI).
 *
 * @param {any} person
 * @param {{ user?: { label?: string } | null, generatedAt?: string, regenerateCommand?: string, interactive?: boolean }} [meta]
 * @returns {string}
 */
export function renderProspectDetailPage(person, meta = {}) {
  const body =
    `<div class="dom-wrap" id="prospects-top">` +
    renderPersonDetail(person, { ...meta, asPage: true }) +
    `</div>`;
  return renderShell({
    title: `Exo — ${person.name}`,
    activeId: "prospects",
    sectionLabel: "Prospects",
    detailLabel: person.name,
    body,
    interactive: meta.interactive,
    detail: true,
    agentRuntime: meta.agentRuntime ?? null,
    sectionHref: meta.interactive ? `/prospects${prospectsSearchSuffix(meta)}` : null,
  });
}

/**
 * @param {string} id
 * @param {{ interactive?: boolean }} meta
 */
function personHref(id, meta) {
  return meta.interactive
    ? `/prospects/${encodeURIComponent(id)}${prospectsSearchSuffix(meta)}`
    : `#p-${id}`;
}

/** @param {{ interactive?: boolean }} meta */
function prospectsHomeHref(meta) {
  return meta.interactive ? `/prospects${prospectsSearchSuffix(meta)}` : "#prospects-top";
}

/**
 * @param {string} motionId
 * @param {{ interactive?: boolean }} meta
 */
function motionHref(motionId, meta) {
  return meta.interactive ? `/motions/${encodeURIComponent(motionId)}` : `../motions.html#m-${motionId}`;
}

/** @param {any} model */
function renderIntro(model) {
  const searchMeta = model.search?.active
    ? `<div class="op-meta">` +
      countChip(model.counts.prospects, "blue", "matches") +
      countChip(model.search.totalProspects ?? model.counts.prospects, "neutral", "total") +
      `<span class="surface-ref">${iconSvg("search", 11)}${escapeHtml(model.search.query)}</span>` +
      `</div>`
    : "";
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Prospects</h1>` +
    `<p class="op-line">Prospect targeting across the workspace — ${model.counts.prospects} people at ${model.counts.companies} companies.</p>` +
    searchMeta +
    `</div>` +
    `<div class="seg">` +
    `<label for="pr-all">All</label>` +
    `<label for="pr-company">By company</label>` +
    `</div>` +
    `</div>`
  );
}

/**
 * @param {any[]} all
 * @param {{ interactive?: boolean }} meta
 */
function renderTable(all, meta) {
  if (!all.length) {
    return emptyState({
      icon: "users",
      message: meta.searchQuery
        ? `No prospects match "${meta.searchQuery}".`
        : "No prospects selected yet.",
    });
  }
  const head =
    `<div class="pr-head"><span>Name</span><span>Title</span><span>Company</span><span>Signal</span>` +
    `<span>Branch</span><span>Channels</span><span>Owner</span><span>Age</span></div>`;
  const rows = all
    .map(
      (p) =>
        `<div class="pr-row">` +
        `<a class="pr-name" href="${escapeAttr(personHref(p.id, meta))}">${avatar({ src: p.avatarUrl, initials: p.initials, name: p.name, size: 26 })}${escapeHtml(p.name)}</a>` +
        `<span class="pr-title">${escapeHtml(p.title ?? "—")}</span>` +
        `<a class="pr-co" href="${escapeAttr(personHref(p.id, meta))}">${escapeHtml(p.companyName)}</a>` +
        `<span class="pr-signal" title="${escapeAttr(p.signal)}">${escapeHtml(p.signal)}</span>` +
        `<span>${stateDot(p.branch, p.branchLabel ?? undefined)}</span>` +
        `<span class="pr-channels">${channelIcons(p.channels, { clickable: true })}</span>` +
        `<span>${ownerTag({ ownerName: p.owner })}</span>` +
        `<span class="pr-age">${escapeHtml(p.ageLabel ?? "—")}</span>` +
        `</div>`,
    )
    .join("");
  return `<div class="pr-table">${head}${rows}</div>`;
}

/**
 * Compact icon row of channels we believe we can reach the prospect on.
 * Mirrors the Audienti enterprise-list affordance — at-a-glance "do we have
 * LinkedIn, email, phone for this person?". Empty (with a soft dash) when
 * nothing's known so the column still occupies its grid slot.
 *
 * @param {Array<{ key: string, label: string, value: string, href: string, openInNewTab?: boolean }> | undefined} channels
 * @param {{ clickable?: boolean }} [options]
 */
function channelIcons(channels, options = {}) {
  if (!channels || !channels.length) {
    return `<span class="pr-channels-empty" title="No reach channels known">—</span>`;
  }
  /** @type {Record<string, { icon: string, label: string }>} */
  const meta = {
    linkedin: { icon: "linkedin", label: "LinkedIn profile" },
    email: { icon: "mail", label: "Email" },
    phone: { icon: "phone", label: "Phone" },
  };
  return channels
    .map((channel) => {
      const m = meta[channel.key];
      if (!m) return "";
      const label = `${channel.label}: ${channel.value}${channel.openInNewTab ? " (opens in new tab)" : ""}`;
      const title = channel.value;
      if (options.clickable && channel.href) {
        const externalAttrs = channel.openInNewTab ? ` target="_blank" rel="noopener noreferrer"` : "";
        return (
          `<a class="pr-channel pr-channel-${escapeAttr(channel.key)}"` +
          ` href="${escapeAttr(channel.href)}"${externalAttrs}` +
          ` title="${escapeAttr(title)}" aria-label="${escapeAttr(label)}">` +
          `${iconSvg(m.icon, 13)}` +
          `</a>`
        );
      }
      return (
        `<span class="pr-channel pr-channel-${escapeAttr(channel.key)}"` +
        ` title="${escapeAttr(title)}" aria-label="${escapeAttr(label)}">` +
        `${iconSvg(m.icon, 13)}` +
        `</span>`
      );
    })
    .join("");
}

/**
 * @param {any[]} groups
 * @param {{ interactive?: boolean }} meta
 */
function renderGroups(groups, meta) {
  if (!groups.length) {
    return emptyState({
      icon: "building",
      message: meta.searchQuery
        ? `No companies match "${meta.searchQuery}".`
        : "No companies with prospects yet.",
    });
  }
  return (
    `<div class="pr-groups">` +
    groups
      .map(
        (g) =>
          `<div class="pr-group">` +
          `<div class="pr-group-head">` +
          iconSvg("building", 15) +
          (meta.interactive && g.companyId
            ? `<a class="pgh-name pgh-link" href="/companies/${escapeAttr(encodeURIComponent(g.companyId))}">${escapeHtml(g.companyName)}</a>`
            : `<span class="pgh-name">${escapeHtml(g.companyName)}</span>`) +
          `<span class="pgh-sub">${escapeHtml([g.industry, g.motionName].filter(Boolean).join(" · "))}</span>` +
          `<span class="pgh-count">${g.prospects.length}</span>` +
          (meta.interactive && g.companyId
            ? `<a class="pgh-go" href="/companies/${escapeAttr(encodeURIComponent(g.companyId))}">Open record ${iconSvg("chevronR", 12)}</a>`
            : g.companyLinkedinUrl
              ? `<a class="pgh-go" href="${escapeAttr(g.companyLinkedinUrl)}" target="_blank" rel="noreferrer">Open ${iconSvg("chevronR", 12)}</a>`
              : "") +
          `</div>` +
          g.prospects
            .map(
              (p) =>
                `<a class="pr-grow" href="${escapeAttr(personHref(p.id, meta))}">` +
                avatar({ src: p.avatarUrl, initials: p.initials, name: p.name, size: 28 }) +
                `<div class="pr-grow-id"><span class="pr-grow-name">${escapeHtml(p.name)}</span><span class="pr-grow-sub">${escapeHtml(p.title ?? "")}</span></div>` +
                `<span class="pr-grow-signal" title="${escapeAttr(p.signal)}">${escapeHtml(p.signal)}</span>` +
                stateDot(p.branch, p.branchLabel ?? undefined) +
                `<span class="pr-grow-channels">${channelIcons(p.channels)}</span>` +
                ownerTag({ ownerName: p.owner }) +
                iconSvg("chevronR", 13, "pr-grow-go") +
                `</a>`,
            )
            .join("") +
          `</div>`,
      )
      .join("") +
    `</div>`
  );
}

/**
 * @param {any} p
 * @param {{ interactive?: boolean, asPage?: boolean }} [meta]
 */
function renderPersonDetail(p, meta = {}) {
  const composeSurface = composeSurfaceFor(p);
  const replyUnavailable = p.handledNotification?.state === "reply_unavailable";
  const stageBranch = stageBranchFor(p);
  const baseStageIdx = branchStageIndex(stageBranch);
  const stageIdx = reconcileStageIndex(stageBranch, p.connectionDegree);
  const degreeOverride = p.connectionDegree != null && stageIdx !== baseStageIdx;
  const pipelineStages = pipelineStagesFor(p, composeSurface);
  const next = nextMoveForStage(stageIdx, p, composeSurface);
  const backLink = meta.asPage
    ? ""
    : `<a class="pd-back" href="${escapeAttr(prospectsHomeHref(meta))}">${iconSvg("chevron", 12)} All prospects</a>`;
  const railSegments = [
    renderProspectCompanyMeta(p, meta),
    renderProspectFitMeta(p.fit),
    renderProspectDegreeMeta(p.connectionDegree),
    renderProspectOwnerMeta(p, meta),
    renderProspectProfileMeta(p),
  ].filter(Boolean);

  const head =
    `<div class="pd-head">` +
    avatar({ src: p.avatarUrl, initials: p.initials, name: p.name, size: 56 }) +
    `<div class="pd-id">` +
    backLink +
    `<h1 class="pd-name">${escapeHtml(p.name)}</h1>` +
    `<div class="pd-title">${escapeHtml(p.title ?? "")}</div>` +
    `</div>` +
    `<div class="pd-actions">` +
    // Why-we're-here context (surfacing signal + premise) lives in a slide-over
    // so the main column stays focused on the engagement timeline.
    `<a class="btn btn-secondary btn-sm" href="#context-${escapeAttr(p.id)}" title="Why this prospect — surfacing signal and premise">${iconSvg("target", 14)}<span>Context</span></a>` +
    (p.linkedinProfileUrl ? btn({ variant: "secondary", size: "sm", icon: "link", label: "View profile", href: p.linkedinProfileUrl }) : "") +
    (meta.interactive && meta.transitionMotionId && p.motionId === meta.transitionMotionId
      ? `<a class="btn btn-secondary btn-sm" href="#rehome-${escapeAttr(p.id)}">${iconSvg("layers", 14)}<span>Re-home</span></a>`
      : "") +
    (meta.interactive
      ? (replyUnavailable ? "" : `<a class="btn btn-primary btn-sm" href="#compose-${escapeAttr(p.id)}">${iconSvg("mail", 14)}<span>${escapeHtml(composeTriggerLabel(p))}</span></a>`)
      : btn({ variant: "primary", size: "sm", icon: "spark", label: "Draft opener" })) +
    `</div>` +
    (railSegments.length ? `<div class="pd-rail">${railSegments.join(`<i class="pd-div"></i>`)}</div>` : "") +
    `</div>`;

  // The funnel: where they are right now (replaces the redundant tile row).
  // When the captured connection degree disagrees with the recorded branch, the
  // degree wins and we say so — that's the dispute-resolution rule.
  const degreeNote = degreeOverride
    ? `<p class="pl-degree">${iconSvg("check", 11)}LinkedIn shows a <strong>${escapeHtml(degreeLabel(p.connectionDegree))}-degree</strong> connection — ` +
      (p.connectionDegree === 1
        ? `treating the request as <strong>accepted</strong>, overriding the recorded stage.`
        : `the request is <strong>not accepted yet</strong>, so they stay in the connection-request-sent queue.`) +
      `</p>`
    : "";
  const pipeline = renderPipeline(stageIdx, pipelineStages) +
    renderNextMoveAlert({
      label: "Next move",
      lead: next.lead,
      detail: next.detail,
      meta: p.ageLabel ? `${p.ageLabel} in pipeline` : null,
    }) +
    degreeNote;
  const handledNotification = replyUnavailable
    ? `<div class="cap-note">${iconSvg("alert", 14)}<div><strong>Reply unavailable.</strong> ${escapeHtml(p.handledNotification?.detail ?? p.handledNotification?.message ?? "The governed reply path is unavailable.")}</div></div>`
    : "";

  const colleagues = p.sameCompany?.length
    ? `<div class="md-section">Others at ${escapeHtml(p.companyName)} <span>${p.sameCompany.length}</span></div>` +
      `<div class="md-list">` +
      p.sameCompany
        .map(
          (c) =>
            `<a class="md-co is-link" href="${escapeAttr(personHref(c.id, meta))}">` +
            avatar({ src: c.avatarUrl, initials: c.initials, name: c.name, size: 30 }) +
            `<div class="md-co-id"><span class="md-co-name">${escapeHtml(c.name)}</span><span class="md-co-sub">${escapeHtml(c.title ?? "")}</span></div>` +
            stateDot(c.branch, c.branchLabel ?? undefined) +
            ownerTag({ ownerName: c.owner }) +
            iconSvg("chevronR", 13, "md-co-go") +
            `</a>`,
        )
        .join("") +
      `</div>`
    : "";

  const timeline = renderTimeline(p, meta);

  return (
    `<section class="dom-wrap person-detail" id="p-${escapeAttr(p.id)}">${head}${pipeline}${handledNotification}${timeline}${colleagues}</section>` +
    renderContextPanel(p, meta) +
    (meta.interactive ? renderTimelineNotePanel(p, meta) : "") +
    (meta.interactive ? renderComposePanel(p, meta) : "") +
    (meta.interactive ? renderRehomePanel(p, meta) : "") +
    (meta.interactive && !p.owner ? renderAssignPanel(p, meta) : "")
  );
}

/**
 * @param {{ interactive?: boolean, searchQuery?: string | null }} meta
 * @returns {string}
 */
function prospectsSearchSuffix(meta) {
  if (!meta.interactive) return "";
  const query = typeof meta.searchQuery === "string" ? meta.searchQuery.trim() : "";
  return query ? `?q=${encodeURIComponent(query)}` : "";
}

/**
 * Context slide-over: why this prospect is here — the surfacing signal and the
 * premise they're evidence for. Opened from the header so the main column can
 * stay focused on the engagement timeline.
 * @param {any} p
 * @param {{ interactive?: boolean }} meta
 */
function renderContextPanel(p, meta = {}) {
  const firstName = (p.name ?? "").split(/\s+/)[0] || "This prospect";
  const premise = p.premise?.statement
    ? `<div class="compose-field"><span class="compose-label">${iconSvg("target", 11)} Premise this prospect is evidence for</span>` +
      `<p class="ctx-premise">${escapeHtml(p.premise.statement)}</p>` +
      `<a class="pd-motion-link" href="${escapeAttr(motionHref(p.motionId, meta))}">` +
      stateDot(p.premise.motionStatus ?? "active", p.premise.motionName) +
      `<span class="pml-meta">open motion</span>${iconSvg("chevronR", 13)}</a>` +
      `</div>`
    : "";
  return (
    `<div class="compose-panel" id="context-${escapeAttr(p.id)}">` +
    `<a class="compose-backdrop" href="#p-${escapeAttr(p.id)}" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    `<div class="compose-head">${iconSvg("target", 18)}` +
    `<div><div class="compose-title">Why this prospect</div>` +
    `<div class="compose-sub">${escapeHtml(p.name)}${p.companyName ? ` · ${escapeHtml(p.companyName)}` : ""}</div></div>` +
    `<a class="compose-close" href="#p-${escapeAttr(p.id)}" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<div class="compose-field"><span class="compose-label">Surfacing signal</span>` +
    `<div class="signal-card pd-signal">` +
    `<div class="sig-top"><span class="sig-idx">S</span><p class="sig-q">${escapeHtml(p.signal)}</p>${truthTag(p.signalTruth)}</div>` +
    (p.signalRationale ? `<p class="sig-why">${escapeHtml(p.signalRationale)}</p>` : "") +
    `<p class="sig-meta">This is the evidence that surfaced ${escapeHtml(firstName)} into ${escapeHtml(p.motionName ?? "this motion")}${p.ageLabel ? ` — first seen ${escapeHtml(p.ageLabel)} ago` : ""}.</p>` +
    `</div></div>` +
    premise +
    `</div>` +
    `</div>`
  );
}

/** The funnel stages, in order. */
const PIPELINE = [
  { key: "identified", label: "Identified" },
  { key: "requested", label: "Request sent" },
  { key: "connected", label: "Connected" },
  { key: "conversation", label: "In conversation" },
  { key: "meeting", label: "Meeting" },
];

/** @param {string} branch */
function branchStageIndex(branch) {
  switch (branch) {
    case "connection-requested":
      return 1;
    case "connected":
      return 2;
    case "reply-accepted":
      return 3;
    default:
      return 0; // identified / pre-connect / ready / waiting / blocked
  }
}

/**
 * Reconcile pipeline stage against the authoritative LinkedIn connection
 * degree. A 1st-degree connection means the request was accepted (connected,
 * stage ≥ 2); a 2nd/3rd-degree means it has NOT been accepted yet, so the
 * stage cannot be past "Request sent" — they stay in the sent queue.
 *
 * @param {string} branch
 * @param {number | null | undefined} degree
 */
function reconcileStageIndex(branch, degree) {
  const base = branchStageIndex(branch);
  if (degree === 1) return Math.max(base, 2);
  if (degree === 2 || degree === 3) return Math.min(base, 1);
  return base;
}

/**
 * @param {any} prospect
 * @returns {string}
 */
function stageBranchFor(prospect) {
  return isWaitingOnEmailReply(prospect) ? "connection-requested" : prospect?.branch;
}

/** @param {number} degree */
function degreeLabel(degree) {
  return degree === 1 ? "1st" : degree === 2 ? "2nd" : degree === 3 ? "3rd" : "";
}

/**
 * @param {any} p
 * @param {{ interactive?: boolean }} meta
 * @returns {string}
 */
function renderProspectCompanyMeta(p, meta) {
  const href = meta.interactive && p.companyId
    ? `/companies/${escapeAttr(encodeURIComponent(p.companyId))}`
    : p.companyLinkedinUrl ?? null;
  const inner = `${iconSvg("building", 11)}${escapeHtml(p.companyName)}`;
  if (!href) {
    return `<span class="surface-ref">${inner}</span>`;
  }
  const external = href.startsWith("http");
  return `<a class="surface-ref pd-meta-link" href="${escapeAttr(href)}"${external ? ` target="_blank" rel="noreferrer"` : ""}>${inner}</a>`;
}

/**
 * @param {string | null | undefined} fit
 * @returns {string}
 */
function renderProspectFitMeta(fit) {
  const label = fitLabel(fit);
  return label ? `<span class="surface-ref">${iconSvg("target", 11)}${escapeHtml(`${label} fit`)}</span>` : "";
}

/**
 * @param {number | null | undefined} degree
 * @returns {string}
 */
function renderProspectDegreeMeta(degree) {
  if (degree == null) {
    return "";
  }
  const label = degree === 1 ? "1st-degree connection" : `${degreeLabel(degree)}-degree away`;
  return `<span class="surface-ref">${iconSvg("link", 11)}${escapeHtml(label)}</span>`;
}

/**
 * @param {any} p
 * @param {{ interactive?: boolean }} meta
 * @returns {string}
 */
function renderProspectOwnerMeta(p, meta) {
  if (p.owner) {
    return `<span class="surface-ref">${iconSvg("users", 11)}${escapeHtml(p.owner)}</span>`;
  }
  if (meta.interactive && p.companyId) {
    return `<a class="surface-ref pd-meta-link" href="#assign-${escapeAttr(p.id)}">${iconSvg("userPlus", 11)}Assign owner</a>`;
  }
  return `<span class="surface-ref">${iconSvg("users", 11)}Unassigned</span>`;
}

/**
 * @param {any} p
 * @returns {string}
 */
function renderProspectProfileMeta(p) {
  if (p.recipientOpenProfile) {
    return `<span class="surface-ref">${iconSvg("link", 11)}Open profile</span>`;
  }
  if (p.recipientPremium) {
    return `<span class="surface-ref">${iconSvg("check", 11)}Premium</span>`;
  }
  return "";
}

/**
 * @param {string | null | undefined} fit
 * @returns {string}
 */
function fitLabel(fit) {
  switch (fit) {
    case "high":
      return "High";
    case "moderate":
      return "Moderate";
    case "low":
      return "Low";
    case "no-fit":
      return "No fit";
    default:
      return "";
  }
}

/**
 * @param {number} idx
 * @param {any} p
 */
function nextMoveForStage(idx, p, composeSurface = null) {
  if (composeSurface === "inbound_reply") {
    const responseState = privateThreadResponseState(p, composeSurface);
    if (responseState === "sent") {
      return {
        lead: "Wait for the reply",
        detail: "You already replied on this thread. Stay with the conversation until they answer or the branch changes.",
      };
    }
    if (responseState === "queued") {
      return {
        lead: "Reply queued for send",
        detail: "The agent will send it on its next pass.",
      };
    }
    if (responseState === "ready") {
      return {
        lead: "Review the drafted reply",
        detail: "Edit it if needed, then queue it for send.",
      };
    }
    return {
      lead: "Agent is drafting the response",
      detail: "Wait for the governed draft to land, or write your own below if you need to move now.",
    };
  }
  if (composeSurface === "email" && idx <= 1) {
    const responseState = privateThreadResponseState(p, composeSurface);
    const draftState = draftStateForSurface(p, composeSurface);
    if (responseState === "sent") {
      return {
        lead: "Wait for the email reply",
        detail: "The last email is already on the thread. Stay with it until they answer or the branch changes.",
      };
    }
    if (draftState === "queued") {
      return {
        lead: "Email queued for send",
        detail: "The agent will send it on its next pass.",
      };
    }
    if (draftState === "ready") {
      return {
        lead: "Review the drafted email",
        detail: "Edit it if needed, then queue it for send.",
      };
    }
    if (draftState === "drafting") {
      return {
        lead: "Agent is drafting the email",
        detail: "Wait for the governed draft to land, or write your own below if you need to move now.",
      };
    }
    if (isWaitingOnEmailReply(p)) {
      return {
        lead: "Wait for the email reply",
        detail: "The last email is out. Stay on this thread until they answer or the branch changes.",
      };
    }
    return {
      lead: "Review the queued email reply",
      detail: "The agent can send it through the governed Gmail path.",
    };
  }
  switch (idx) {
    case 1:
      return {
        lead: "Wait on the pending request",
        detail: "The agent follows up automatically after they accept.",
      };
    case 2:
      return {
        lead: "Send the first message",
        detail: "Use the timeline below to keep the opener anchored in context.",
      };
    case 3:
      return {
        lead: "Continue the conversation",
        detail: "Steer the thread toward a meeting.",
      };
    case 4:
      return {
        lead: "Confirm and prep the meeting",
        detail: null,
      };
    default:
      return p.owner
        ? {
            lead: "Send the first connection request",
            detail: null,
          }
        : {
            lead: "Assign an owner",
            detail: "Then send the first connection request.",
          };
  }
}

/** @param {number} stageIdx */
function renderPipeline(stageIdx, stages = PIPELINE) {
  return (
    `<div class="pipeline">` +
    stages.map((stage, i) => {
      const cls = i < stageIdx ? "pl-step reached" : i === stageIdx ? "pl-step reached current" : "pl-step";
      const dot = i < stageIdx ? iconSvg("check", 12) : i === stageIdx ? "<i></i>" : "";
      return `<div class="${cls}"><div class="pl-dot">${dot}</div><div class="pl-label">${escapeHtml(stage.label)}</div></div>`;
    }).join("") +
    `</div>`
  );
}

/**
 * @param {any} p
 * @param {string | null} composeSurface
 * @returns {Array<{ key: string, label: string }>}
 */
function pipelineStagesFor(p, composeSurface) {
  if (composeSurface === "email" && !p.linkedinProfileUrl) {
    const emailStageLabel = isWaitingOnEmailReply(p) ? "Email sent" : "Email queued";
    return [
      PIPELINE[0],
      { key: "email-queued", label: emailStageLabel },
      PIPELINE[2],
      PIPELINE[3],
      PIPELINE[4],
    ];
  }
  return PIPELINE;
}

// ---------------------------------------------------------------------------
// Engagement timeline — the real chronological record of every touch (outbound,
// inbound, system) plus draft lifecycle, newest first. Sourced from the stored
// prospect record (touches + drafts), not the projection.
// ---------------------------------------------------------------------------

/** surface → display label + icon */
const TOUCH_SURFACE = {
  connection_request: { label: "Connection request", icon: "userPlus" },
  accept_connection: { label: "Connection accepted", icon: "check" },
  decline_connection: { label: "Connection declined", icon: "x" },
  withdraw_connection: { label: "Connection withdrawn", icon: "x" },
  post_accept_message: { label: "First message", icon: "mail" },
  follow_up_direct_message: { label: "Follow-up message", icon: "mail" },
  inbound_reply: { label: "Reply", icon: "mail" },
  email: { label: "Email", icon: "mail" },
  in_mail_message: { label: "InMail", icon: "mail" },
  public_comment: { label: "Comment", icon: "activity" },
  comment_reply: { label: "Comment reply", icon: "activity" },
  profile_view: { label: "Profile view", icon: "eye" },
  follow: { label: "Followed", icon: "userPlus" },
  unfollow: { label: "Unfollowed", icon: "x" },
  like_post: { label: "Liked a post", icon: "activity" },
  unlike_post: { label: "Unliked a post", icon: "activity" },
  share_post: { label: "Shared a post", icon: "activity" },
  create_comment_reaction: { label: "Reacted", icon: "activity" },
  voicemail_outreach: { label: "Voicemail", icon: "activity" },
  video_outreach: { label: "Video outreach", icon: "activity" },
};

/** outcome → short chip label */
const OUTCOME_LABEL = {
  accepted: "accepted",
  replied: "replied",
  sent: "sent",
  pending: "pending",
  ignored: "no reply",
  "opened-no-reply": "opened",
  blocked: "blocked",
  nurture: "nurture",
};

/** @param {string} surface */
function humanizeSurface(surface) {
  return String(surface ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** @param {{ direction?: string, outcome?: string, surface?: string }} t */
function touchTone(t) {
  if (t.outcome === "accepted" || t.outcome === "replied") return "good";
  if (t.outcome === "blocked") return "bad";
  if (t.surface === "decline_connection" || t.surface === "withdraw_connection" || t.surface === "unfollow") return "bad";
  return t.direction === "inbound" ? "in" : t.direction === "system" ? "sys" : "out";
}

/** @param {string | null | undefined} iso */
function relTimeShort(iso) {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const ms = Date.now() - t.getTime();
  if (ms < -60000) return "scheduled";
  const m = Math.round(Math.max(0, ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

// Surfaces whose timeline entry IS a message — show the body + a lifecycle
// status (Draft → Queued → Sent), not just a one-line label.
const MESSAGE_SURFACES = new Set([
  "connection_request",
  "post_accept_message",
  "follow_up_direct_message",
  "email",
  "in_mail_message",
  "inbound_reply",
  "comment_reply",
]);

const DRAFT_STATUS = { drafting: "drafted", ready: "drafted", queued: "queued", approved: "queued", sent: "sent" };
const MESSAGE_STATUS_LABEL = { drafted: "Draft", queued: "Queued", sent: "Sent", blocked: "Blocked", received: "Received" };
const MESSAGE_STATUS_TONE = { drafted: "sys", queued: "out", sent: "good", blocked: "bad", received: "in" };

/** @param {{ direction?: string, outcome?: string }} t */
function messageStatusFromTouch(t) {
  if (t.direction === "inbound") return "received";
  if (t.outcome === "pending") return "queued";
  if (t.outcome === "blocked") return "blocked";
  return "sent";
}

/** @param {string | null | undefined} value */
function normalizeMessageText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/** @param {string | null | undefined} direction */
function normalizeMessageDirection(direction) {
  return direction === "outbound" ? "outbound" : direction === "inbound" ? "inbound" : "unknown";
}

/**
 * Older governed send writebacks sometimes recorded a placeholder summary
 * rather than the actual outbound body. Never treat that placeholder as the
 * message text.
 *
 * @param {string | null | undefined} value
 */
function isSyntheticSendSummary(value) {
  return /^sent send\b/i.test(normalizeMessageText(value) ?? "");
}

/**
 * @param {any} draft
 * @returns {number}
 */
function sentDraftTimestamp(draft) {
  const timestamp = Date.parse(draft?.sentAt ?? draft?.updatedAt ?? draft?.approvedAt ?? draft?.createdAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * @param {any} touch
 * @returns {number}
 */
function touchTimestamp(touch) {
  const timestamp = Date.parse(touch?.occurredAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * @param {any[]} touches
 * @returns {any[]}
 */
function sortTouchesChronologically(touches) {
  return [...(touches ?? [])].sort((a, b) => touchTimestamp(a) - touchTimestamp(b));
}

/**
 * @param {any} prospect
 * @param {{ direction?: string | null, fromHandle?: string | null }} message
 */
function threadMessageSurfaceLabel(prospect, message) {
  const handle = String(message?.fromHandle ?? "").trim();
  if (handle.includes("@") || (!prospect?.linkedinProfileUrl && prospect?.email)) {
    return "Email";
  }
  return "Reply";
}

/**
 * @param {any} prospect
 * @returns {Array<{ type: "message", at: string, surfaceLabel: string, status: "sent" | "received", body: string, byline: string | null }>}
 */
function buildThreadMessageEvents(prospect) {
  return (prospect?.threadMessages ?? [])
    .map((message) => {
      const body = normalizeMessageText(message?.body);
      const at = typeof message?.sentAt === "string" ? message.sentAt : null;
      const direction = normalizeMessageDirection(message?.direction);
      if (!body || !at || direction === "unknown") return null;
      return {
        type: "message",
        at,
        surfaceLabel: threadMessageSurfaceLabel(prospect, message),
        status: direction === "outbound" ? "sent" : "received",
        body,
        byline: direction === "outbound" ? "You" : "From them",
      };
    })
    .filter(Boolean);
}

/**
 * @param {string | null | undefined} notes
 * @returns {{ subject: string | null, body: string | null }}
 */
function parseObservationNotes(notes) {
  if (!notes || !notes.trim()) {
    return { subject: null, body: null };
  }

  const normalized = notes.trim();
  const subjectMatch = normalized.match(/^Subject:\s*(.+?)(?:\r?\n|$)/i);
  const subject = subjectMatch?.[1]?.trim() || null;
  const body = subjectMatch
    ? normalized.slice(subjectMatch[0].length).trim() || null
    : normalized;

  return { subject, body };
}

/**
 * @param {any} observation
 * @returns {string | null}
 */
function observationFallbackDetail(observation) {
  const notes = parseObservationNotes(observation?.notes);
  const subject = normalizeMessageText(notes.subject);
  return joinObservationDetails(
    subject ? `Subject: ${subject}` : null,
    notes.body,
    observation?.summary ?? null,
  );
}

/**
 * @param {any} observation
 * @returns {string | null}
 */
function observationEventAt(observation) {
  if (typeof observation?.eventAt === "string" && observation.eventAt.trim()) {
    return observation.eventAt;
  }
  if (typeof observation?.observedAt === "string" && observation.observedAt.trim()) {
    return observation.observedAt;
  }
  return null;
}

/** @param {any[]} touches */
function hasAcceptedConnectionTouch(touches) {
  return (touches ?? []).some((touch) =>
    touch?.surface === "accept_connection"
    || (touch?.surface === "connection_request" && touch?.outcome === "accepted"),
  );
}

/**
 * @param {any} prospect
 * @returns {boolean}
 */
function prospectConnectionConfirmed(prospect) {
  if (prospect?.connectionDegree === 1) return true;
  if (hasAcceptedConnectionTouch(prospect?.touches ?? [])) return true;
  if ((prospect?.timelineObservations ?? []).some((observation) => observation?.kind === "connection_request_accepted")) {
    return true;
  }
  const followerObserved = (prospect?.timelineObservations ?? []).some((observation) =>
    observation?.kind === "follower_added" || observation?.kind === "follower_confirmed",
  );
  if (!followerObserved) return false;
  if ((prospect?.threadMessages ?? []).some((message) => normalizeMessageDirection(message?.direction) !== "unknown")) {
    return true;
  }
  if ((prospect?.touches ?? []).some((touch) => touch?.surface === "post_accept_message")) {
    return true;
  }
  if (prospect?.branch === "connected") return true;
  return String(prospect?.cadenceState?.currentStep ?? "") === "direct-message";
}

/**
 * @param {any} prospect
 * @param {string} surface
 * @returns {boolean}
 */
function hasOutboundSurfaceTouch(prospect, surface) {
  return (prospect?.touches ?? []).some((touch) =>
    touch?.surface === surface
    && touch?.direction === "outbound"
    && (touch?.outcome === "sent" || touch?.outcome === "pending"),
  );
}

/**
 * @param {any} prospect
 * @returns {boolean}
 */
function isWaitingOnEmailReply(prospect) {
  return (
    String(prospect?.cadenceState?.currentStep ?? "") === "value-add-email"
    && prospect?.cadenceState?.lastTouchOutcome === "sent"
    && hasOutboundSurfaceTouch(prospect, "email")
  );
}

/**
 * @param {any} observation
 * @param {any[]} touches
 * @returns {boolean}
 */
function observationDuplicatesTouch(observation, touches) {
  switch (observation?.kind) {
    case "connection_request_pending":
      return (touches ?? []).some((touch) => touch?.surface === "connection_request");
    case "connection_request_accepted":
      return hasAcceptedConnectionTouch(touches);
    case "connection_request_declined":
      return (touches ?? []).some((touch) => touch?.surface === "decline_connection");
    case "connection_request_withdraw_requested":
    case "connection_request_withdrawn":
    case "connection_request_no_longer_pending":
      return (touches ?? []).some((touch) => touch?.surface === "withdraw_connection");
    default:
      return false;
  }
}

/**
 * @param {...(string | null | undefined)} parts
 * @returns {string | null}
 */
function joinObservationDetails(...parts) {
  const kept = parts
    .map((part) => normalizeMessageText(part))
    .filter(Boolean);
  return kept.length ? kept.join(" ") : null;
}

/**
 * @param {any} prospect
 * @param {any} observation
 * @returns {{ title: string, icon: string, tone: string, outcome?: string | null, detail?: string | null } | null}
 */
function observationEventPresentation(prospect, observation) {
  const notes = parseObservationNotes(observation?.notes);
  switch (observation?.kind) {
    case "email_reply_received":
      return {
        title: "Email reply",
        icon: "mail",
        tone: "in",
        detail: observationFallbackDetail(observation),
      };
    case "email_thread_updated":
      return {
        title: "Email thread updated",
        icon: "mail",
        tone: "in",
        detail: observationFallbackDetail(observation),
      };
    case "inbound_reply_received":
    case "message_received":
      return {
        title: "Reply",
        icon: "mail",
        tone: "in",
        detail: observationFallbackDetail(observation),
      };
    case "thread_updated":
      return {
        title: "LinkedIn thread updated",
        icon: "mail",
        tone: "in",
        detail: observationFallbackDetail(observation),
      };
    case "public_reply_received":
      return {
        title: "Comment reply",
        icon: "activity",
        tone: "in",
        detail: observationFallbackDetail(observation),
      };
    case "comment_thread_updated":
      return {
        title: "Comment thread updated",
        icon: "activity",
        tone: "in",
        detail: observationFallbackDetail(observation),
      };
    case "connection_request_pending":
      return {
        title: "Connection request",
        icon: "userPlus",
        tone: "out",
        outcome: "pending",
        detail: notes.body ?? observation.summary ?? null,
      };
    case "connection_request_received":
      return {
        title: "Invitation received",
        icon: "userPlus",
        tone: "in",
        detail: notes.body ?? observation.summary ?? null,
      };
    case "connection_request_accepted":
      return {
        title: "Connected on LinkedIn",
        icon: "check",
        tone: "good",
        outcome: "accepted",
        detail: observation?.surfaceKey === "linkedin-received-invitations"
          ? "You accepted their connection request."
          : "They accepted your connection request.",
      };
    case "connection_request_declined":
      return {
        title: "Connection request declined",
        icon: "x",
        tone: "bad",
        detail: observation.summary ?? null,
      };
    case "connection_request_withdraw_requested":
      return {
        title: "Connection withdrawal requested",
        icon: "x",
        tone: "bad",
        detail: observation.summary ?? null,
      };
    case "connection_request_withdrawn":
      return {
        title: "Connection request withdrawn",
        icon: "x",
        tone: "bad",
        detail: observation.summary ?? null,
      };
    case "connection_request_no_longer_pending":
      return {
        title: "Pending invite disappeared",
        icon: "activity",
        tone: "sys",
        detail: observation.summary ?? null,
      };
    case "connection_request_received_no_longer_pending":
      return {
        title: "Received invite disappeared",
        icon: "activity",
        tone: "sys",
        detail: observation.summary ?? null,
      };
    case "follower_added":
    case "follower_confirmed":
      return prospectConnectionConfirmed(prospect)
        ? {
            title: "Connected on LinkedIn",
            icon: "check",
            tone: "good",
            detail: joinObservationDetails("Already connected on LinkedIn.", observation.summary),
          }
        : {
            title: "Follower confirmed",
            icon: "userPlus",
            tone: "in",
            detail: observation.summary ?? null,
          };
    default:
      return null;
  }
}

/**
 * @param {any} prospect
 * @returns {any[]}
 */
function buildObservationEvents(prospect) {
  const observations = Array.isArray(prospect?.timelineObservations) ? prospect.timelineObservations : [];
  const touches = Array.isArray(prospect?.touches) ? prospect.touches : [];
  return observations.flatMap((observation) => {
    const at = observationEventAt(observation);
    if (!at || observationDuplicatesTouch(observation, touches)) {
      return [];
    }
    const href = observation?.threadUrl ?? observation?.sourceUrl ?? null;
    const notes = parseObservationNotes(observation?.notes);
    const noteBody = normalizeMessageText(notes.body);
    if (observation?.kind === "connection_request_pending" && noteBody) {
      return [{
        type: "message",
        at,
        surfaceLabel: "Connection request",
        status: "sent",
        body: noteBody,
        href,
        byline: "You",
      }];
    }
    if (observation?.kind === "connection_request_received" && noteBody) {
      return [{
        type: "message",
        at,
        surfaceLabel: "Invitation received",
        status: "received",
        body: noteBody,
        href,
        byline: "From them",
      }];
    }
    const presentation = observationEventPresentation(prospect, observation);
    if (!presentation) {
      return [];
    }
    return [{
      type: "event",
      at,
      icon: presentation.icon,
      tone: presentation.tone,
      title: presentation.title,
      outcome: presentation.outcome ?? null,
      detail: presentation.detail ?? null,
      href,
    }];
  });
}

/**
 * @param {any} touch
 * @param {string | null} touchBody
 * @param {any[]} threadMessages
 */
function touchDuplicatesThreadMessage(touch, touchBody, threadMessages) {
  const touchAt = Date.parse(touch?.occurredAt ?? "");
  const touchDirection = normalizeMessageDirection(touch?.direction);
  if (Number.isNaN(touchAt) || touchDirection === "unknown") return false;

  for (const message of threadMessages ?? []) {
    const messageAt = Date.parse(message?.sentAt ?? "");
    if (Number.isNaN(messageAt)) continue;
    if (Math.abs(messageAt - touchAt) > 120000) continue;
    if (normalizeMessageDirection(message?.direction) !== touchDirection) continue;

    const messageBody = normalizeMessageText(message?.body);
    if (touchBody && messageBody) {
      if (touchBody === messageBody) return true;
      continue;
    }
    if (!touchBody) return true;
  }
  return false;
}

/**
 * Sent drafts are terminal and no longer render as standalone timeline items,
 * but older send writebacks may have recorded only a generic touch summary.
 * Keep one sent-draft queue per surface so the timeline can recover the actual
 * outbound body for the matching sent touch.
 *
 * @param {any[]} drafts
 */
function buildSentDraftQueues(drafts) {
  /** @type {Map<string, Array<{ body: string | null }>>} */
  const queues = new Map();
  const sentDrafts = [...(drafts ?? [])]
    .filter((draft) => draft?.status === "sent" && MESSAGE_SURFACES.has(draft.surface))
    .sort((a, b) => sentDraftTimestamp(a) - sentDraftTimestamp(b));
  for (const draft of sentDrafts) {
    if (draft?.status !== "sent" || !MESSAGE_SURFACES.has(draft.surface)) continue;
    const queue = queues.get(draft.surface) ?? [];
    queue.push({
      body: normalizeMessageText(draft.body),
    });
    queues.set(draft.surface, queue);
  }
  return queues;
}

/**
 * @param {Map<string, Array<{ body: string | null }>>} sentDraftQueues
 * @param {string} surface
 */
function consumeSentDraft(sentDraftQueues, surface) {
  const queue = sentDraftQueues.get(surface);
  if (!queue?.length) return null;
  return queue.shift() ?? null;
}

/**
 * Suppress later placeholder-only sends when we already rendered the real
 * outbound message for the same surface in the same short window.
 *
 * @param {any} touch
 * @param {Array<{ surface: string, direction: string, outcome: string | null, at: string }>} renderedTouches
 */
function touchDuplicatesRenderedMessageTouch(touch, renderedTouches) {
  const touchAt = Date.parse(touch?.occurredAt ?? "");
  const touchDirection = normalizeMessageDirection(touch?.direction);
  if (Number.isNaN(touchAt) || touchDirection === "unknown") return false;

  for (const rendered of renderedTouches ?? []) {
    const renderedAt = Date.parse(rendered?.at ?? "");
    if (Number.isNaN(renderedAt)) continue;
    if (Math.abs(renderedAt - touchAt) > 120000) continue;
    if (rendered.surface !== touch.surface) continue;
    if (rendered.direction !== touchDirection) continue;
    if ((rendered.outcome ?? null) !== (touch?.outcome ?? null)) continue;
    return true;
  }
  return false;
}

/**
 * Merge touches + draft lifecycle + the genesis (surfacing) event into one
 * descending-by-time list. Message-bearing entries carry their body + a status
 * so a queued message reads as the message itself, updating to "Sent" once it
 * lands; other entries (accept, profile view, surfaced) stay compact.
 * @param {any} p
 */
function timelineEvents(p) {
  const events = [
    ...buildObservationEvents(p),
    ...buildThreadMessageEvents(p),
  ];
  const selectedTargetUrl = normalizeMessageText(p.publicEngagementSelection?.url ?? p.publicEngagementSelection?.targetUrl ?? null);
  for (const activity of p.capturedPublicActivity ?? []) {
    const targetUrl = normalizeMessageText(activity?.url);
    const postedAt = activity?.postedAt ?? null;
    if (!targetUrl || !postedAt) continue;
    const targetKind = activity?.targetKind === "comment" ? "comment" : "post";
    const recommendedAction = activity?.recommendedAction === "comment" ? "comment" : "reaction";
    const summary = normalizeMessageText(activity?.summary) ?? normalizeMessageText(activity?.snippet) ?? humanizeSurface(activity?.activityType ?? "public_activity");
    events.push({
      type: "event",
      at: postedAt,
      icon: targetKind === "comment" ? "mail" : "activity",
      tone: selectedTargetUrl && selectedTargetUrl === targetUrl ? "brand" : "sys",
      title: selectedTargetUrl && selectedTargetUrl === targetUrl
        ? `Selected LinkedIn ${targetKind}`
        : `Captured LinkedIn ${targetKind}`,
      detail: summary,
      rationale: activity?.rationale
        ?? (recommendedAction === "comment"
          ? "Stored as a comment-worthy public-engagement target."
          : "Stored as a lightweight public-engagement target."),
      href: targetUrl,
    });
  }
  const threadMessages = Array.isArray(p?.threadMessages) ? p.threadMessages : [];
  const sentDraftQueues = buildSentDraftQueues(p.drafts ?? []);
  /** @type {Array<{ surface: string, direction: string, outcome: string | null, at: string }>} */
  const renderedMessageTouches = [];
  for (const t of sortTouchesChronologically(p.touches ?? [])) {
    if (!t.occurredAt) continue;
    const meta = TOUCH_SURFACE[t.surface] ?? { label: humanizeSurface(t.surface), icon: "activity" };
    const matchedSentDraft = t.direction === "outbound" && t.outcome === "sent" && MESSAGE_SURFACES.has(t.surface)
      ? consumeSentDraft(sentDraftQueues, t.surface)
      : null;
    const syntheticSendSummary = isSyntheticSendSummary(t.summary);
    const touchBody = normalizeMessageText(t.body) ?? matchedSentDraft?.body ?? null;
    const messageBody = touchBody ?? (syntheticSendSummary ? null : normalizeMessageText(t.summary));
    if (MESSAGE_SURFACES.has(t.surface) && touchDuplicatesThreadMessage(t, touchBody, threadMessages)) {
      continue;
    }
    if (MESSAGE_SURFACES.has(t.surface) && syntheticSendSummary && !touchBody && touchDuplicatesRenderedMessageTouch(t, renderedMessageTouches)) {
      continue;
    }
    if (MESSAGE_SURFACES.has(t.surface) && messageBody) {
      const status = messageStatusFromTouch(t);
      events.push({
        type: "message",
        at: t.occurredAt,
        surfaceLabel: meta.label,
        status,
        body: messageBody,
        href: t.sourceUrl ?? null,
        byline: t.direction === "inbound" ? "From them" : null,
      });
      renderedMessageTouches.push({
        surface: t.surface,
        direction: normalizeMessageDirection(t.direction),
        outcome: t.outcome ?? null,
        at: t.occurredAt,
      });
    } else {
      events.push({
        type: "event",
        at: t.occurredAt,
        icon: meta.icon,
        tone: touchTone(t),
        title: meta.label,
        outcome: t.outcome,
        detail: syntheticSendSummary ? null : t.summary,
        href: t.sourceUrl ?? null,
      });
    }
  }
  for (const d of p.drafts ?? []) {
    if (d.status === "discarded") continue;
    // A sent draft is already recorded as a touch — don't double-count it.
    if (d.status === "sent") continue;
    const responseState = privateThreadResponseState(p, d.surface);
    if (responseState === "sent" || responseState === "blocked") continue;
    const meta = TOUCH_SURFACE[d.surface] ?? { label: humanizeSurface(d.surface) };
    events.push({
      type: "message",
      at: d.approvedAt ?? d.updatedAt ?? d.createdAt,
      surfaceLabel: meta.label,
      status: DRAFT_STATUS[d.status] ?? "drafted",
      body: d.body || "",
      emptyNote: d.body ? null : "Plain connection request — no note.",
      byline: d.authoredBy === "operator"
        ? "You drafted"
        : d.editedByOperator
          ? "Agent draft · you edited"
          : (d.approvedByOperator || d.status === "approved")
            ? "Agent draft · you approved"
            : "Agent draft",
    });
  }
  for (const n of p.timelineNotes ?? []) {
    if (!n.createdAt || !n.body) continue;
    events.push({
      type: n.kind === "steer" ? "steer" : n.kind === "system" ? "system" : "note",
      at: n.createdAt,
      body: n.body,
      author: n.author ?? null,
    });
  }
  if (p.firstSeenAt) {
    events.push({
      type: "event",
      at: p.firstSeenAt,
      icon: "activity",
      tone: "sys",
      title: `Surfaced into ${p.motionName ?? "this motion"}`,
      detail: p.signal && p.signal !== "No surfacing signal recorded." ? p.signal : "Selected as a prospect.",
      rationale: p.signalRationale ?? null,
    });
  }
  return events.filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** @param {any} e */
function renderTimelineMessage(e) {
  const tone = MESSAGE_STATUS_TONE[e.status] ?? "sys";
  return (
    `<li class="tl-item tl-msg tl-${tone}">` +
    `<span class="tl-dot">${iconSvg(e.status === "received" ? "mail" : "mail", 12)}</span>` +
    `<div class="tl-body">` +
    `<div class="tl-head">` +
    `<span class="tl-title">${escapeHtml(e.surfaceLabel)}</span>` +
    `<span class="tl-status tl-status-${e.status}">${escapeHtml(MESSAGE_STATUS_LABEL[e.status] ?? e.status)}</span>` +
    `<span class="tl-time">${escapeHtml(relTimeShort(e.at))}</span>` +
    `</div>` +
    (e.body
      ? `<blockquote class="tl-message">${escapeHtml(e.body)}</blockquote>`
      : `<p class="tl-detail">${escapeHtml(e.emptyNote ?? "")}</p>`) +
    (e.byline ? `<div class="tl-byline">${escapeHtml(e.byline)}</div>` : "") +
    `</div></li>`
  );
}

/** @param {any} e */
function renderTimelineEvent(e) {
  return (
    `<li class="tl-item tl-${e.tone}">` +
    `<span class="tl-dot">${iconSvg(e.icon, 12)}</span>` +
    `<div class="tl-body">` +
    `<div class="tl-head"><span class="tl-title">${escapeHtml(e.title)}</span>` +
    (e.outcome && OUTCOME_LABEL[e.outcome] ? `<span class="tl-outcome">${escapeHtml(OUTCOME_LABEL[e.outcome])}</span>` : "") +
    `<span class="tl-time">${escapeHtml(relTimeShort(e.at))}</span></div>` +
    (e.detail ? `<p class="tl-detail">${escapeHtml(e.detail)}</p>` : "") +
    (e.rationale ? `<p class="tl-detail tl-rationale"><strong>Why this connects:</strong> ${escapeHtml(e.rationale)}</p>` : "") +
    (e.href ? `<a class="tl-link" href="${escapeAttr(e.href)}" target="_blank" rel="noreferrer">${iconSvg("link", 11)}Open</a>` : "") +
    `</div></li>`
  );
}

/** @param {any} e */
function renderTimelineNote(e) {
  const isSteer = e.type === "steer";
  const isSystem = e.type === "system";
  // We persist the authoring user's id on the note, but the raw UUID is noise
  // in the timeline. Suppress it until we have a human-readable author label
  // to show in its place.
  return (
    `<li class="tl-item ${isSteer ? "tl-steer" : isSystem ? "tl-note" : "tl-note"}">` +
    `<span class="tl-dot">${iconSvg(isSteer ? "cpu" : isSystem ? "activity" : "flag", 12)}</span>` +
    `<div class="tl-body">` +
    `<div class="tl-head"><span class="tl-title">${isSteer ? "Steer" : isSystem ? "System" : "Note"}</span>` +
    (isSteer ? `<span class="tl-status tl-status-steer">agent directive</span>` : "") +
    `<span class="tl-time">${escapeHtml(relTimeShort(e.at))}</span></div>` +
    `<blockquote class="tl-notebody">${escapeHtml(e.body)}</blockquote>` +
    `</div></li>`
  );
}

/**
 * @param {any} p
 * @param {{ interactive?: boolean }} [meta]
 */
function renderTimeline(p, meta = {}) {
  const events = timelineEvents(p);
  const add = meta.interactive
    ? `<a class="tl-add" href="#tlnote-${escapeAttr(p.id)}">${iconSvg("flag", 12)}Add note / steer</a>`
    : "";
  const head = `<div class="md-section">Engagement timeline <span>${events.length}</span>${add}</div>`;
  if (!events.length) {
    return head + emptyState({ icon: "activity", message: "No engagement yet — add a note or steer to start the record." });
  }
  return (
    head +
    `<ol class="tl">` +
    events
      .map((e) =>
        e.type === "message"
          ? renderTimelineMessage(e)
          : e.type === "note" || e.type === "steer"
            ? renderTimelineNote(e)
            : renderTimelineEvent(e),
      )
      .join("") +
    `</ol>`
  );
}

/**
 * Add-to-timeline slide-over: a note (for the record) or a steer (directive the
 * agent reads before its next action).
 * @param {any} p
 * @param {{ userId?: string|null }} meta
 */
function renderTimelineNotePanel(p, meta = {}) {
  const panelId = `tlnote-${p.id}`;
  const base = { companyId: p.companyId, prospectId: p.id, motionId: p.motionId, author: meta.userId ?? null };
  const noteArgs = escapeAttr(JSON.stringify({ ...base, kind: "note" }));
  const steerArgs = escapeAttr(JSON.stringify({ ...base, kind: "steer" }));
  return (
    `<div class="compose-panel" id="${escapeAttr(panelId)}">` +
    `<a class="compose-backdrop" href="#p-${escapeAttr(p.id)}" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    `<div class="compose-head">${iconSvg("flag", 18)}` +
    `<div><div class="compose-title">Add to timeline</div>` +
    `<div class="compose-sub">A note for the record, or a steer the agent reads before its next action.</div></div>` +
    `<a class="compose-close" href="#p-${escapeAttr(p.id)}" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<div class="compose-field"><span class="compose-label">Note or steer</span>` +
    `<textarea class="compose-body" name="body" placeholder="Note: context for the record.&#10;Steer: tell the agent what to do or avoid — e.g. &quot;Keep it short, no pitch; reference their MobileAP rollout.&quot;"></textarea></div>` +
    `<div class="compose-actions">` +
    `<div class="exo-action" data-exo-writer="addProspectTimelineNote" data-exo-args="${noteArgs}" data-exo-compose="${escapeAttr(panelId)}">` +
    `<button class="btn btn-secondary btn-sm" type="button">${iconSvg("flag", 14)}<span>Add note</span></button></div>` +
    `<div class="exo-action" data-exo-writer="addProspectTimelineNote" data-exo-args="${steerArgs}" data-exo-compose="${escapeAttr(panelId)}">` +
    `<button class="btn btn-primary btn-sm" type="button">${iconSvg("cpu", 14)}<span>Add steer</span></button></div>` +
    `<a class="btn btn-ghost btn-sm" href="#p-${escapeAttr(p.id)}">Cancel</a>` +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

/**
 * Assign-owner picker — pins this prospect's company to a user.
 * @param {any} p
 * @param {{ users?: Array<{id:string,label:string}>, userId?: string|null }} meta
 */
function renderAssignPanel(p, meta) {
  const panelId = `assign-${p.id}`;
  const users = meta.users ?? [];
  const args = JSON.stringify({ companyId: p.companyId });
  const options = users.length
    ? users
        .map(
          (u, i) =>
            `<label class="rehome-opt"><input type="radio" name="assign-user" value="${escapeAttr(u.id)}"${u.id === meta.userId || (i === 0 && !meta.userId) ? " checked" : ""}><span>${escapeHtml(u.label)}</span></label>`,
        )
        .join("")
    : `<div class="compose-empty">No execution users yet.</div>`;
  return (
    `<div class="compose-panel" id="${escapeAttr(panelId)}">` +
    `<a class="compose-backdrop" href="#p-${escapeAttr(p.id)}" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    `<div class="compose-head">${iconSvg("userPlus", 18)}` +
    `<div><div class="compose-title">Assign ${escapeHtml(p.name)}</div>` +
    `<div class="compose-sub">Pins ${escapeHtml(p.companyName)} to an owner so the work is executable.</div></div>` +
    `<a class="compose-close" href="#p-${escapeAttr(p.id)}" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<div class="compose-field"><span class="compose-label">Owner</span><div class="rehome-list">${options}</div></div>` +
    `<div class="compose-actions">` +
    (users.length
      ? `<div class="exo-action" data-exo-writer="assignCompanyUser" data-exo-args="${escapeAttr(args)}" data-exo-radio="assign-user:userId">` +
        `<button class="btn btn-primary btn-sm" type="button">${iconSvg("check", 14)}<span>Assign</span></button></div>`
      : "") +
    `<a class="btn btn-ghost btn-sm" href="#p-${escapeAttr(p.id)}">Cancel</a>` +
    `</div></div></div>`
  );
}

/**
 * Re-home affordance — only for prospects sitting in the catch-all transition
 * motion. Picks a destination motion and moves them (carrying all state).
 * @param {any} p
 * @param {{ transitionMotionId?: string|null, motions?: Array<{id:string,name:string,offerLabel?:string,premise?:string,status?:string|null,statusLabel?:string|null}>, userId?: string|null }} meta
 */
function renderRehomePanel(p, meta) {
  const inTransition = meta.transitionMotionId && p.motionId === meta.transitionMotionId;
  if (!inTransition) return "";
  const targets = (meta.motions ?? []).filter((m) => m.id !== meta.transitionMotionId);
  const panelId = `rehome-${p.id}`;
  const options = targets.length
    ? targets
        .map(
          (m) =>
            renderMotionChoiceOption({
              motion: m,
              action: {
                writer: "rehomeProspect",
                args: { prospectId: p.id, userId: meta.userId ?? null, toMotionId: m.id },
                label: "Re-home here",
                icon: "arrowR",
                variant: "primary",
              },
            }),
        )
        .join("")
    : `<div class="compose-empty">No other motions yet — create one to re-home into.</div>`;

  return (
    `<div class="compose-panel" id="${escapeAttr(panelId)}">` +
    `<a class="compose-backdrop" href="#p-${escapeAttr(p.id)}" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    `<div class="compose-head">${iconSvg("layers", 18)}` +
    `<div><div class="compose-title">Re-home ${escapeHtml(p.name)}</div>` +
    `<div class="compose-sub">Move out of the transition backlog into a real motion (carries cadence, touches, drafts).</div></div>` +
    `<a class="compose-close" href="#p-${escapeAttr(p.id)}" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<div class="compose-field"><span class="compose-label">Destination motion</span><div class="rehome-list">${options}</div></div>` +
    `<div class="compose-actions compose-actions-end">` +
    `<a class="btn btn-ghost btn-sm" href="#p-${escapeAttr(p.id)}">Cancel</a>` +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

/** branch (record-state) → outreach surface for the compose panel */
const BRANCH_SURFACE = {
  identified: "connection_request",
  "pre-connect": "connection_request",
  ready: "connection_request",
  "connection-requested": "follow_up_direct_message",
  connected: "post_accept_message",
  "reply-accepted": "follow_up_direct_message",
  waiting: "follow_up_direct_message",
  blocked: "email",
};

const SURFACE_META = {
  connection_request: { label: "Connection request note", channel: "LinkedIn", subject: false },
  post_accept_message: { label: "First message", channel: "LinkedIn", subject: false },
  follow_up_direct_message: { label: "Follow-up message", channel: "LinkedIn", subject: false },
  inbound_reply: { label: "Reply", channel: "LinkedIn", subject: false },
  in_mail_message: { label: "InMail", channel: "LinkedIn", subject: true },
  email: { label: "Email", channel: "Email", subject: true },
};

/** Pipeline stage index → the outreach surface whose message comes next. */
const STAGE_SURFACE = [
  "connection_request", // identified — not connected yet
  "connection_request", // request sent — awaiting accept
  "post_accept_message", // connected — the first message
  "follow_up_direct_message", // in conversation
  "follow_up_direct_message", // meeting
];

/**
 * The outreach surface the compose panel should target, reconciled against the
 * authoritative connection degree (so a degree-1 "connected" prospect gets the
 * first post-accept message — and its draft — even if the recorded branch lags).
 * @param {any} p
 */
function composeSurfaceFor(p) {
  const nextSurface = selectNextDraftSurface(buildComposeSurfaceContext(p));
  if (nextSurface === "inbound_reply" || nextSurface === "comment_reply") return nextSurface;
  const draftedSurface = resolveDraftedComposeSurface(p);
  if (draftedSurface) return draftedSurface;
  if (isWaitingOnEmailReply(p)) return "email";
  if (nextSurface) return nextSurface;
  const stageIdx = reconcileStageIndex(stageBranchFor(p), p.connectionDegree);
  return STAGE_SURFACE[stageIdx] ?? BRANCH_SURFACE[p.branch] ?? "post_accept_message";
}

/**
 * The detail renderer only gets a shaped prospect record, so rebuild the small
 * subset of fields the shared draft-surface selector actually needs.
 *
 * @param {any} p
 */
function buildComposeSurfaceContext(p) {
  return {
    linkedinProfileUrl: p?.linkedinProfileUrl ?? null,
    email: p?.email ?? null,
    cadenceState: p?.cadenceState ?? null,
    touches: Array.isArray(p?.touches) ? p.touches : [],
    linkedinProfileSnapshot: {
      connectionDegree: p?.connectionDegree ?? null,
      isOpenProfile: p?.recipientOpenProfile ?? null,
    },
  };
}

/**
 * @param {any} p
 * @param {string} surface
 * @returns {"open" | "ready" | "queued" | "sent" | "blocked" | "not_private_inbound" | null}
 */
function privateThreadResponseState(p, surface) {
  const context = privateInboundResponseContext(p, surface);
  if (!context) {
    return null;
  }

  return describePrivateInboundResponse(
    {
      ...context.observation,
    },
    {
      drafts: Array.isArray(p?.drafts) ? p.drafts : [],
      touches: Array.isArray(p?.touches) ? p.touches : [],
      threadMessages: context.threadMessages,
    },
  ).state;
}

/**
 * @param {any} p
 * @param {string} surface
 * @returns {{ observation: { kind: string, capability: string, surfaceKey: string, observedAt: string }, threadMessages: any[] } | null}
 */
function privateInboundResponseContext(p, surface) {
  if (surface !== "email" && surface !== "inbound_reply") {
    return null;
  }

  const threadMessages = (p?.threadMessages ?? []).filter((message) => threadMessageMatchesSurface(p, message, surface));
  const latestInboundMessage = threadMessages
    .filter((message) => normalizeMessageDirection(message?.direction) === "inbound" && typeof message?.sentAt === "string")
    .sort((left, right) => String(left.sentAt).localeCompare(String(right.sentAt)))
    .at(-1);
  const observedAt = latestInboundMessage?.sentAt ?? latestInboundTouchAt(p, surface);
  if (!observedAt) {
    return null;
  }

  return {
    observation: {
      kind: surface === "email" ? "email_thread_updated" : "thread_updated",
      capability: surface === "email" ? "gmail" : "linkedin",
      surfaceKey: surface === "email" ? "gmail-inbox-threads" : "linkedin-messaging-inbox",
      observedAt,
    },
    threadMessages,
  };
}

/**
 * @param {any} p
 * @param {"email" | "inbound_reply"} surface
 * @returns {string | null}
 */
function latestInboundTouchAt(p, surface) {
  const touches = Array.isArray(p?.touches) ? p.touches : [];
  return touches
    .filter((touch) =>
      touch?.surface === surface
      && normalizeMessageDirection(touch?.direction) === "inbound"
      && typeof touch?.occurredAt === "string"
    )
    .sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)))
    .at(-1)?.occurredAt ?? null;
}

/**
 * @param {any} p
 * @param {any} message
 * @param {string} surface
 * @returns {boolean}
 */
function threadMessageMatchesSurface(p, message, surface) {
  const handle = String(message?.fromHandle ?? "").trim();
  const looksLikeEmail = handle.includes("@") || (!p?.linkedinProfileUrl && p?.email);
  if (surface === "email") {
    return looksLikeEmail;
  }
  if (surface === "inbound_reply") {
    return !looksLikeEmail;
  }
  return false;
}

/** @param {any} p */
function composeTriggerLabel(p) {
  return composeSurfaceFor(p) === "connection_request" ? "Compose request" : "Compose message";
}

/**
 * Prefer the actual active draft surface over stale branch heuristics. When a
 * send-ready email or LinkedIn draft already exists, the compose panel should
 * reopen that governed surface instead of inventing a different one from the
 * branch label alone.
 *
 * @param {any} p
 * @returns {string | null}
 */
function resolveDraftedComposeSurface(p) {
  const drafts = Array.isArray(p?.drafts)
    ? p.drafts.filter((draft) => (
      draft
      && draft.status !== "sent"
      && draft.status !== "discarded"
      && privateThreadResponseState(p, draft.surface) !== "sent"
      && privateThreadResponseState(p, draft.surface) !== "blocked"
    ))
    : [];
  if (!drafts.length) return null;

  const prioritized = drafts
    .slice()
    .sort((left, right) => {
      const sendableDelta = Number(isSendableDraftStatus(right?.status)) - Number(isSendableDraftStatus(left?.status));
      if (sendableDelta) return sendableDelta;
      return draftTimestamp(right) - draftTimestamp(left);
    });
  const surface = prioritized[0]?.surface;
  return typeof surface === "string" && surface.trim().length ? surface.trim() : null;
}

/**
 * @param {any} p
 * @param {string} surface
 * @returns {"none" | "ready" | "queued" | "drafting"}
 */
function draftStateForSurface(p, surface) {
  const privateResponseState = privateThreadResponseState(p, surface);
  if (privateResponseState === "sent" || privateResponseState === "blocked") {
    return "none";
  }
  if (privateResponseState === "queued") {
    return "queued";
  }
  if (privateResponseState === "ready") {
    return "ready";
  }

  const drafts = Array.isArray(p?.drafts)
    ? p.drafts.filter((draft) => (
      draft
      && draft.surface === surface
      && draft.status !== "sent"
      && draft.status !== "discarded"
    ))
    : [];
  if (!drafts.length) return "none";

  const prioritized = drafts
    .slice()
    .sort((left, right) => {
      const sendableDelta = Number(isSendableDraftStatus(right?.status)) - Number(isSendableDraftStatus(left?.status));
      if (sendableDelta) return sendableDelta;
      return draftTimestamp(right) - draftTimestamp(left);
    });
  const draft = prioritized[0] ?? null;
  if (!draft) return "none";
  if (isSendableDraftStatus(draft.status)) return "queued";
  if (draft.status === "ready") return "ready";
  return "drafting";
}

/**
 * @param {any} draft
 * @returns {number}
 */
function draftTimestamp(draft) {
  const iso = draft?.approvedAt ?? draft?.updatedAt ?? draft?.createdAt ?? null;
  const timestamp = Date.parse(String(iso ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * @param {any} prospect
 * @param {string} surface
 * @returns {string}
 */
function composeEmptyStateCopy(prospect, surface) {
  const privateResponseState = privateThreadResponseState(prospect, surface);
  if (surface === "inbound_reply" && privateResponseState === "sent") {
    return "You already replied on this thread. Wait for their next message before drafting again, or write your own below if you need to override that.";
  }
  if (surface === "email" && privateResponseState === "sent") {
    return "The last email on this thread is already out. Wait for their reply before drafting again, or write your own below if you need to override that.";
  }
  if (surface === "email" && isWaitingOnEmailReply(prospect)) {
    return "The last email was sent. The agent will wait for a reply before drafting again. Write your own below if you want to override that.";
  }
  return "Queued for the agent to draft. Write your own below if you don't want to wait.";
}

/**
 * The compose panel: pre-filled with the agent's draft (subject + body),
 * editable; Send approves it (queues for the agent to send).
 *
 * For a connection request, the note field is gated on whether the sending
 * identity can attach a note (Premium / Sales Navigator). Free identities get a
 * note-less invite.
 *
 * @param {any} p
 * @param {{ connectionNoteCapable?: boolean|null, assignedIdentity?: string|null }} meta
 */
function renderComposePanel(p, meta = {}) {
  const surface = composeSurfaceFor(p);
  const sm = SURFACE_META[surface] ?? SURFACE_META.post_accept_message;
  const privateResponseState = privateThreadResponseState(p, surface);
  const draft = privateResponseState === "sent" || privateResponseState === "blocked"
    ? null
    : (p.drafts ?? []).find((d) => d.surface === surface && d.status !== "sent" && d.status !== "discarded") ?? null;
  const args = JSON.stringify({ companyId: p.companyId, prospectId: p.id, motionId: p.motionId, surface });
  const panelId = `compose-${p.id}`;

  const isConnectionNote = surface === "connection_request";
  const noteCapable = meta.connectionNoteCapable; // true | false | null
  const noteBlocked = isConnectionNote && noteCapable === false;
  const noteUnknown = isConnectionNote && (noteCapable === null || noteCapable === undefined);

  const head =
    `<div class="compose-head">${iconSvg("mail", 18)}` +
    `<div><div class="compose-title">${escapeHtml(sm.label)} · ${escapeHtml(p.name)}</div>` +
    `<div class="compose-sub">${escapeHtml(p.title ?? "")}${p.companyName ? ` · ${escapeHtml(p.companyName)}` : ""}</div></div>` +
    `<a class="compose-close" href="#p-${escapeAttr(p.id)}" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<span class="compose-chan">${iconSvg(sm.channel === "Email" ? "mail" : "link", 11)}${escapeHtml(sm.channel)}</span>`;

  // Note-less connection request: no body, just queue a plain connect.
  if (noteBlocked) {
    const blockedArgs = JSON.stringify({ companyId: p.companyId, prospectId: p.id, motionId: p.motionId, surface, body: "" });
    return (
      `<div class="compose-panel" id="${escapeAttr(panelId)}">` +
      `<a class="compose-backdrop" href="#p-${escapeAttr(p.id)}" aria-label="Close"></a>` +
      `<div class="compose-sheet">${head}` +
      `<div class="cap-note">${iconSvg("alert", 14)}<div><strong>No note available.</strong> ${escapeHtml(meta.assignedIdentity ?? "The assigned identity")}, the LinkedIn account Exo sends this request from, is on the free LinkedIn tier, so LinkedIn drops notes on its connection requests. The recipient's own plan does not matter here. Assign a <strong>Premium</strong> or <strong>Sales Navigator</strong> sending identity to enable notes.</div></div>` +
      `<p class="compose-empty">A note-less connection request will be queued.</p>` +
      `<div class="compose-actions">` +
      `<div class="exo-action" data-exo-writer="approveProspectDraft" data-exo-args="${escapeAttr(blockedArgs)}">` +
      `<button class="btn btn-primary btn-sm" type="button">${iconSvg("userPlus", 14)}<span>Queue note-less request</span></button></div>` +
      `<a class="btn btn-ghost btn-sm" href="#p-${escapeAttr(p.id)}">Cancel</a>` +
      `</div></div></div>`
    );
  }

  const byline = draft
    ? `<span class="compose-byline">${iconSvg("spark", 12)} Drafted by ${escapeHtml(draft.authoredBy)}${draft.editedByOperator ? " · edited" : (draft.approvedByOperator || draft.status === "approved") ? " · approved" : ""} · ${escapeHtml(draft.status)}</span>`
    : `<span class="compose-empty">${escapeHtml(composeEmptyStateCopy(p, surface))}</span>`;

  const subjectField = sm.subject
    ? `<div class="compose-field"><span class="compose-label">Subject</span>` +
      `<input class="compose-input" name="subject" value="${escapeAttr(draft?.subject ?? "")}" placeholder="Subject line"></div>`
    : "";

  const unknownNotice = noteUnknown
    ? meta.assignedIdentity
      ? `<div class="cap-note">${iconSvg("alert", 14)}<div><strong>Note availability unverified.</strong> Exo has not confirmed whether ${escapeHtml(meta.assignedIdentity)}, the LinkedIn account it sends from, has <strong>Premium</strong> or <strong>Sales Navigator</strong>. Notes only go out when the sending account has one of those plans.</div></div>`
      : `<div class="cap-note">${iconSvg("alert", 14)}<div>No sending identity is assigned yet. Notes require <strong>Premium</strong> or <strong>Sales Navigator</strong> on the LinkedIn account Exo sends from. Assign one before sending.</div></div>`
    : "";

  // If they're Open Profile and our identity is Premium/Sales Navigator, a
  // direct message is free here — no connection request or InMail credit needed.
  const openProfileHint =
    isConnectionNote && p.recipientOpenProfile && noteCapable === true
      ? `<div class="cap-note ok">${iconSvg("check", 14)}<div><strong>Open Profile.</strong> You can send a free direct message here (your Premium / Sales Navigator identity) — no connection request or InMail credit required.</div></div>`
      : "";

  return (
    `<div class="compose-panel" id="${escapeAttr(panelId)}">` +
    `<a class="compose-backdrop" href="#p-${escapeAttr(p.id)}" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    head +
    openProfileHint +
    unknownNotice +
    subjectField +
    `<div class="compose-field"><span class="compose-label">${isConnectionNote ? "Note" : "Message"}</span>` +
    `<textarea class="compose-body" name="body" placeholder="The agent's draft will appear here…">${escapeHtml(draft?.body ?? "")}</textarea></div>` +
    `<div class="compose-meta">${byline}</div>` +
    `<div class="compose-actions">` +
    `<div class="exo-action" data-exo-writer="approveProspectDraft" data-exo-args="${escapeAttr(args)}" data-exo-compose="${escapeAttr(panelId)}">` +
    `<button class="btn btn-primary btn-sm" type="button" title="Approve this message — the agent sends it on its next run">${iconSvg("check", 14)}<span>Approve &amp; queue</span></button>` +
    `</div>` +
    `<a class="btn btn-ghost btn-sm" href="#p-${escapeAttr(p.id)}">Cancel</a>` +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

/**
 * Render the "Queue in Exo" affordance — each control carries the real Exo
 * writeback (cadence/touch) so the agent can execute the operator's decision.
 * @param {any} p
 */
function renderQueueActions(p) {
  const intents = [p.actionIntents?.schedule, p.actionIntents?.recordTouch].filter(Boolean);
  if (!intents.length) return "";
  const rows = intents
    .map((intent) => {
      const variant = intent.kind === "schedule" ? "primary" : "secondary";
      const icon = intent.kind === "schedule" ? "clock" : "check";
      return (
        `<div class="exo-action" data-exo-writer="${escapeAttr(intent.writer)}" data-exo-args="${escapeAttr(JSON.stringify(intent.args))}" data-exo-command="${escapeAttr(intent.command)}">` +
        `<button class="btn btn-${variant} btn-sm" type="button" title="${escapeAttr(intent.command)}">${iconSvg(icon, 14)}<span>${escapeHtml(intent.label)}</span></button>` +
        `<code class="exo-cmd">${escapeHtml(intent.command)}</code>` +
        `</div>`
      );
    })
    .join("");
  return `<div class="md-section">Queue in Exo</div><div class="exo-actions">${rows}</div>`;
}

/**
 * Recommended next step keyed on branch state (spec NEXT map).
 * @param {any} p
 */
function recommendedNext(p) {
  if (p.nextAction) {
    const tone = p.branch === "ready" ? "blue" : p.branch === "identified" ? "amber" : "neutral";
    return { text: p.nextAction, tone, tag: p.owner ? null : "needs owner" };
  }
  const NEXT = {
    identified: { text: "Assign an owner, then queue a connection request.", tone: "amber", tag: "needs owner" },
    "pre-connect": { text: "Warm the account before connecting — engage a recent post.", tone: "blue", tag: "pre-connect" },
    "connection-requested": { text: "Request pending — agent will follow up at capacity.", tone: "blue", tag: "agent-ready" },
    connected: { text: "Connected — draft the opening message for this premise.", tone: "blue", tag: "ready to draft" },
    "reply-accepted": { text: "In conversation — keep the thread moving toward a meeting.", tone: "blue", tag: "conversation" },
    ready: { text: "Prepped — send the first governed move.", tone: "blue", tag: "ready" },
    waiting: { text: "Held in reserve — waiting on a checkpoint.", tone: "neutral", tag: null },
  };
  return NEXT[p.branch] ?? { text: "Review and route this prospect.", tone: "neutral", tag: null };
}

/** @param {{ generatedAt?: string, regenerateCommand?: string }} meta */
function renderFooter(meta) {
  if (!meta.generatedAt && !meta.regenerateCommand) return "";
  const stamp = meta.generatedAt ? new Date(meta.generatedAt).toISOString() : "";
  return (
    `<div class="gen-footer">` +
    (stamp ? `Generated ${escapeHtml(stamp)}` : "") +
    (meta.regenerateCommand ? ` · regenerate with <code>${escapeHtml(meta.regenerateCommand)}</code>` : "") +
    `</div>`
  );
}
