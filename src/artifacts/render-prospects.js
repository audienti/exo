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
  fitChip,
  iconSvg,
  ownerTag,
  renderShell,
  stateDot,
  truthTag,
} from "../lib/exo-ui-components.js";
import { isSendableDraftStatus } from "../lib/draft-policy.js";

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
  });
}

/**
 * @param {string} id
 * @param {{ interactive?: boolean }} meta
 */
function personHref(id, meta) {
  return meta.interactive ? `/prospects/${encodeURIComponent(id)}` : `#p-${id}`;
}

/** @param {{ interactive?: boolean }} meta */
function prospectsHomeHref(meta) {
  return meta.interactive ? "/prospects" : "#prospects-top";
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
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Prospects</h1>` +
    `<p class="op-line">Prospect targeting across the workspace — ${model.counts.prospects} people at ${model.counts.companies} companies.</p>` +
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
    return emptyState({ icon: "users", message: "No prospects selected yet." });
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
        `<span class="pr-channels">${channelIcons(p.channels)}</span>` +
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
 * @param {string[] | undefined} channels
 */
function channelIcons(channels) {
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
    .map((key) => {
      const m = meta[key];
      if (!m) return "";
      return `<span class="pr-channel pr-channel-${escapeAttr(key)}" title="${escapeAttr(m.label)}" aria-label="${escapeAttr(m.label)}">${iconSvg(m.icon, 13)}</span>`;
    })
    .join("");
}

/**
 * @param {any[]} groups
 * @param {{ interactive?: boolean }} meta
 */
function renderGroups(groups, meta) {
  if (!groups.length) {
    return emptyState({ icon: "building", message: "No companies with prospects yet." });
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
  const baseStageIdx = branchStageIndex(p.branch);
  const stageIdx = reconcileStageIndex(p.branch, p.connectionDegree);
  const degreeOverride = p.connectionDegree != null && stageIdx !== baseStageIdx;
  const pipelineStages = pipelineStagesFor(p, composeSurface);
  const currentStageLabel = pipelineStages[stageIdx]?.label ?? PIPELINE[stageIdx]?.label ?? "Current";
  const next = nextStepForStage(stageIdx, p, composeSurface);
  const backLink = meta.asPage
    ? ""
    : `<a class="pd-back" href="${escapeAttr(prospectsHomeHref(meta))}">${iconSvg("chevron", 12)} All prospects</a>`;

  // Company chip → the internal company record (the canonical page); falls back
  // to the company's LinkedIn page when we're static, or inert if neither.
  const companyChip =
    meta.interactive && p.companyId
      ? `<a class="pd-co-link" href="/companies/${escapeAttr(encodeURIComponent(p.companyId))}">${iconSvg("building", 13)}${escapeHtml(p.companyName)}</a>`
      : p.companyLinkedinUrl
        ? `<a class="pd-co-link" href="${escapeAttr(p.companyLinkedinUrl)}" target="_blank" rel="noreferrer">${iconSvg("building", 13)}${escapeHtml(p.companyName)}</a>`
        : `<span class="pd-co-link" style="cursor:default">${iconSvg("building", 13)}${escapeHtml(p.companyName)}</span>`;

  // Owner, or an inline "Assign" affordance when unassigned.
  const ownerEl =
    p.owner
      ? ownerTag({ ownerName: p.owner })
      : meta.interactive && p.companyId
        ? `<a class="pd-assign" href="#assign-${escapeAttr(p.id)}">${iconSvg("userPlus", 12)}Assign</a>`
        : ownerTag({ ownerName: null });

  const fitEl = p.fit
    ? `<span title="Fit confidence set when this prospect was selected (high / moderate / low). Not the legacy Audienti numeric fit score.">${fitChip(p.fit)}</span>`
    : "";

  // Connection degree — the authoritative truth for connection status.
  const degreeEl =
    p.connectionDegree != null
      ? `<span class="deg-chip deg-${p.connectionDegree}" title="LinkedIn network distance. 1st-degree means you are connected (a connection request was accepted); 2nd/3rd means not yet.">${iconSvg("link", 11)}${degreeLabel(p.connectionDegree)}</span>`
      : "";

  const head =
    `<div class="pd-head">` +
    avatar({ src: p.avatarUrl, initials: p.initials, name: p.name, size: 56 }) +
    `<div class="pd-id">` +
    backLink +
    `<h1 class="pd-name">${escapeHtml(p.name)}</h1>` +
    `<div class="pd-title">${escapeHtml(p.title ?? "")}</div>` +
    `<div class="pd-meta">` +
    companyChip +
    `<i class="pd-div"></i>` +
    fitEl +
    degreeEl +
    ownerEl +
    (p.recipientOpenProfile ? `<span class="op-chip">${iconSvg("mail", 11)}Open Profile</span>` : p.recipientPremium ? `<span class="op-chip">Premium</span>` : "") +
    `</div>` +
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
    `<p class="pl-now"><strong>${escapeHtml(currentStageLabel)}.</strong> ${escapeHtml(next.text)}` +
    (p.ageLabel ? ` <span style="color:var(--text-4)">· ${escapeHtml(p.ageLabel)} in pipeline</span>` : "") +
    `</p>` +
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
    `<p class="sig-why">This is the evidence that surfaced ${escapeHtml(firstName)} into ${escapeHtml(p.motionName ?? "this motion")}${p.ageLabel ? ` — first seen ${escapeHtml(p.ageLabel)} ago` : ""}.</p>` +
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

/** @param {number} degree */
function degreeLabel(degree) {
  return degree === 1 ? "1st" : degree === 2 ? "2nd" : degree === 3 ? "3rd" : "";
}

/**
 * @param {number} idx
 * @param {any} p
 */
function nextStepForStage(idx, p, composeSurface = null) {
  if (composeSurface === "email" && idx <= 1) {
    return { text: "An email reply is queued and ready for the agent to send through the governed Gmail path." };
  }
  switch (idx) {
    case 1:
      return { text: "Connection request sent — awaiting their accept. The agent follows up automatically once they accept." };
    case 2:
      return { text: "Connected — send the first message." };
    case 3:
      return { text: "In conversation — continue the thread and steer toward a meeting." };
    case 4:
      return { text: "Meeting stage — confirm and prep." };
    default:
      return { text: p.owner ? "Send the first connection request." : "Assign an owner, then send the first connection request." };
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
    return [
      PIPELINE[0],
      { key: "email-queued", label: "Email queued" },
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

/**
 * Merge touches + draft lifecycle + the genesis (surfacing) event into one
 * descending-by-time list. Message-bearing entries carry their body + a status
 * so a queued message reads as the message itself, updating to "Sent" once it
 * lands; other entries (accept, profile view, surfaced) stay compact.
 * @param {any} p
 */
function timelineEvents(p) {
  const events = [];
  for (const t of p.touches ?? []) {
    if (!t.occurredAt) continue;
    const meta = TOUCH_SURFACE[t.surface] ?? { label: humanizeSurface(t.surface), icon: "activity" };
    if (MESSAGE_SURFACES.has(t.surface) && (t.body || t.summary)) {
      const status = messageStatusFromTouch(t);
      events.push({
        type: "message",
        at: t.occurredAt,
        surfaceLabel: meta.label,
        status,
        body: t.body || t.summary,
        href: t.sourceUrl ?? null,
        byline: t.direction === "inbound" ? "From them" : null,
      });
    } else {
      events.push({
        type: "event",
        at: t.occurredAt,
        icon: meta.icon,
        tone: touchTone(t),
        title: meta.label,
        outcome: t.outcome,
        detail: t.summary,
        href: t.sourceUrl ?? null,
      });
    }
  }
  for (const d of p.drafts ?? []) {
    if (d.status === "discarded") continue;
    // A sent draft is already recorded as a touch — don't double-count it.
    if (d.status === "sent") continue;
    const meta = TOUCH_SURFACE[d.surface] ?? { label: humanizeSurface(d.surface) };
    events.push({
      type: "message",
      at: d.approvedAt ?? d.updatedAt ?? d.createdAt,
      surfaceLabel: meta.label,
      status: DRAFT_STATUS[d.status] ?? "drafted",
      body: d.body || "",
      emptyNote: d.body ? null : "Plain connection request — no note.",
      byline: d.authoredBy === "operator" ? "You drafted" : d.editedByOperator ? "Agent draft · you edited" : "Agent draft",
    });
  }
  for (const n of p.timelineNotes ?? []) {
    if (!n.createdAt || !n.body) continue;
    events.push({
      type: n.kind === "steer" ? "steer" : "note",
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
    (e.href ? `<a class="tl-link" href="${escapeAttr(e.href)}" target="_blank" rel="noreferrer">${iconSvg("link", 11)}Open</a>` : "") +
    `</div></li>`
  );
}

/** @param {any} e */
function renderTimelineNote(e) {
  const isSteer = e.type === "steer";
  // We persist the authoring user's id on the note, but the raw UUID is noise
  // in the timeline. Suppress it until we have a human-readable author label
  // to show in its place.
  return (
    `<li class="tl-item ${isSteer ? "tl-steer" : "tl-note"}">` +
    `<span class="tl-dot">${iconSvg(isSteer ? "cpu" : "flag", 12)}</span>` +
    `<div class="tl-body">` +
    `<div class="tl-head"><span class="tl-title">${isSteer ? "Steer" : "Note"}</span>` +
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
 * @param {{ transitionMotionId?: string|null, motions?: Array<{id:string,name:string}>, userId?: string|null }} meta
 */
function renderRehomePanel(p, meta) {
  const inTransition = meta.transitionMotionId && p.motionId === meta.transitionMotionId;
  if (!inTransition) return "";
  const targets = (meta.motions ?? []).filter((m) => m.id !== meta.transitionMotionId);
  const panelId = `rehome-${p.id}`;
  const options = targets.length
    ? targets
        .map(
          (m, i) =>
            `<label class="rehome-opt"><input type="radio" name="rehome-motion" value="${escapeAttr(m.id)}"${i === 0 ? " checked" : ""}><span>${escapeHtml(m.name)}</span></label>`,
        )
        .join("")
    : `<div class="compose-empty">No other motions yet — create one to re-home into.</div>`;
  const args = JSON.stringify({ prospectId: p.id, userId: meta.userId ?? null });

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
    `<div class="compose-actions">` +
    (targets.length
      ? `<div class="exo-action" data-exo-writer="rehomeProspect" data-exo-args="${escapeAttr(args)}" data-exo-radio="rehome-motion:toMotionId">` +
        `<button class="btn btn-primary btn-sm" type="button">${iconSvg("arrowR", 14)}<span>Re-home</span></button></div>`
      : "") +
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
  const draftedSurface = resolveDraftedComposeSurface(p);
  if (draftedSurface) return draftedSurface;
  const stageIdx = reconcileStageIndex(p.branch, p.connectionDegree);
  return STAGE_SURFACE[stageIdx] ?? BRANCH_SURFACE[p.branch] ?? "post_accept_message";
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
    ? p.drafts.filter((draft) => draft && draft.status !== "sent" && draft.status !== "discarded")
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
 * @param {any} draft
 * @returns {number}
 */
function draftTimestamp(draft) {
  const iso = draft?.approvedAt ?? draft?.updatedAt ?? draft?.createdAt ?? null;
  const timestamp = Date.parse(String(iso ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
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
  const draft = (p.drafts ?? []).find((d) => d.surface === surface && d.status !== "sent" && d.status !== "discarded") ?? null;
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
      `<div class="cap-note">${iconSvg("alert", 14)}<div><strong>No note available.</strong> ${escapeHtml(meta.assignedIdentity ?? "This identity")} is on a free LinkedIn tier, which can't attach a note to a connection request. Pin a <strong>Premium</strong> or <strong>Sales Navigator</strong> identity to enable notes.</div></div>` +
      `<p class="compose-empty">A note-less connection request will be queued.</p>` +
      `<div class="compose-actions">` +
      `<div class="exo-action" data-exo-writer="approveProspectDraft" data-exo-args="${escapeAttr(blockedArgs)}">` +
      `<button class="btn btn-primary btn-sm" type="button">${iconSvg("userPlus", 14)}<span>Queue note-less request</span></button></div>` +
      `<a class="btn btn-ghost btn-sm" href="#p-${escapeAttr(p.id)}">Cancel</a>` +
      `</div></div></div>`
    );
  }

  const byline = draft
    ? `<span class="compose-byline">${iconSvg("spark", 12)} Drafted by ${escapeHtml(draft.authoredBy)}${draft.editedByOperator ? " · edited" : ""} · ${escapeHtml(draft.status)}</span>`
    : `<span class="compose-empty">Queued for the agent to draft. Write your own below if you don't want to wait.</span>`;

  const subjectField = sm.subject
    ? `<div class="compose-field"><span class="compose-label">Subject</span>` +
      `<input class="compose-input" name="subject" value="${escapeAttr(draft?.subject ?? "")}" placeholder="Subject line"></div>`
    : "";

  const unknownNotice = noteUnknown
    ? `<div class="cap-note">${iconSvg("alert", 14)}<div>No identity pinned yet — notes require a <strong>Premium</strong> or <strong>Sales Navigator</strong> identity. Pin one before sending.</div></div>`
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
