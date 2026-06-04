// @ts-check
//
// Render the internal Person show page (interactive Exo UI).
//
// Works for ANY person Exo has seen — not just tracked prospects. Shows merged
// identity, the surfaces they appeared on, the inbound observation timeline,
// and a "promote to prospect" affordance. If the person is already a tracked
// prospect, a banner routes to their richer prospect show page.

import {
  avatar,
  btn,
  escapeAttr,
  escapeHtml,
  iconSvg,
  renderShell,
  stateDot,
} from "../lib/exo-ui-components.js";

/**
 * @param {ReturnType<import("../core/build-person-view.js").buildPersonView>} person
 * @param {{ interactive?: boolean, userId?: string | null }} [meta]
 * @returns {string}
 */
export function renderPersonPage(person, meta = {}) {
  if (!person) {
    return renderShell({
      title: "Exo — Person not found",
      activeId: "connections",
      sectionLabel: "Connections",
      detailLabel: "Not found",
      body: `<div class="dom-wrap"><div class="op-intro"><div><h1>Person not found</h1></div></div></div>`,
      interactive: meta.interactive,
      agentRuntime: meta.agentRuntime ?? null,
    });
  }

  const id = person.identity;
  const firstName = (id.name ?? "").split(/\s+/)[0] || "This person";
  const knownCompany = person.matchedCompany?.name ?? id.company ?? person.matchedProspect?.companyName ?? null;
  const knownTitle = id.title ?? null;
  const headline = [knownTitle, knownCompany].filter(Boolean).join(" · ") || "Inbound contact";

  const matched = person.matchedProspect
    ? `<div class="pd-matched">${iconSvg("check", 14)} This person is a tracked prospect on ` +
      `<strong>${escapeHtml(person.matchedProspect.motionName ?? "a motion")}</strong>. ` +
      `<a class="pd-matched-link" href="/prospects/${escapeAttr(encodeURIComponent(person.matchedProspect.prospectId))}">Open prospect ${iconSvg("chevronR", 12)}</a>` +
      `</div>`
    : "";
  const reviewHref = person.latestMessage?.href ?? person.timeline.find((entry) => entry.href)?.href ?? null;
  const canPromote = Boolean(person.hasDurableIdentity);
  const unresolvedNote = !canPromote
    ? `<div class="pd-matched">${iconSvg("alert", 14)} Exo does not have a durable identity for this contact yet. Review the thread before you decide whether to ignore it or capture it properly.</div>`
    : "";

  const head =
    `<div class="pd-head">` +
    avatar({ src: id.avatarUrl, name: id.name, size: 56 }) +
    `<div class="pd-id">` +
    `<h1 class="pd-name">${escapeHtml(id.name)}</h1>` +
    `<div class="pd-title">${escapeHtml(headline)}</div>` +
    `<div class="pd-meta">` +
    (person.connection ? stateDot(person.connection.state, person.connection.label) : "") +
    `<i class="pd-div"></i>` +
    `<span class="pd-co-link">${iconSvg(person.source === "email" ? "mail" : "link", 13)}${escapeHtml(sourceLabel(person.source))}</span>` +
    (person.email ? `<i class="pd-div"></i><span class="surface-ref">${escapeHtml(person.email)}</span>` : "") +
    `</div>` +
    `</div>` +
    `<div class="pd-actions">` +
    (id.linkedinUrl ? btn({ variant: "secondary", size: "sm", icon: "link", label: "View profile", href: id.linkedinUrl }) : "") +
    (!id.linkedinUrl && reviewHref ? btn({ variant: "secondary", size: "sm", icon: "link", label: "Open thread", href: reviewHref }) : "") +
    (person.matchedProspect
      ? btn({ variant: "primary", size: "sm", icon: "arrowR", label: "Open prospect", href: `/prospects/${person.matchedProspect.prospectId}` })
      : meta.interactive
        ? renderIgnoreButton(person) +
          (canPromote
            ? `<a class="btn btn-secondary btn-sm" href="#addmotion-${escapeAttr(person.id)}">${iconSvg("layers", 14)}<span>Add to motion</span></a>` +
              `<a class="btn btn-primary btn-sm" href="#compose-${escapeAttr(person.id)}">${iconSvg("mail", 14)}<span>${escapeHtml(composeLabel(person.connection))}</span></a>`
            : "")
        : renderPromoteButton(person, meta)) +
    `</div>` +
    `</div>`;

  const tiles =
    `<div class="md-stats">` +
    `<div class="md-tile"><b>${person.counts.observations}</b><em>Observations</em></div>` +
    `<div class="md-tile"><b>${person.counts.surfaces}</b><em>Sources</em></div>` +
    `<div class="md-tile"><b>${escapeHtml(relativeDays(person.firstSeen) ?? "—")}</b><em>First seen</em></div>` +
    `<div class="md-tile"><b>${escapeHtml(relativeDays(person.lastSeen) ?? "—")}</b><em>Last seen</em></div>` +
    `<div class="md-tile">${stateDot(person.connection?.state ?? "identified", person.connection?.label ?? "inbound")}<em>Status</em></div>` +
    `</div>`;
  const identityFacts =
    `<div class="pd-facts">` +
    renderIdentityFact("Title/headline", knownTitle ?? "Unknown title") +
    renderIdentityFact("Company", knownCompany ?? "Unknown company", person.matchedCompany?.companyId ? `/companies/${person.matchedCompany.companyId}` : null) +
    `</div>`;

  const timeline = renderPersonTimeline(person);
  const replyContext = shouldRenderStatusReplyContext(person) ? renderReplyContext(person.latestMessage) : "";

  const why =
    `<div class="md-section">Status &amp; next move</div>` +
    `<div class="signal-card pd-signal">` +
    `<div class="sig-top"><span class="sig-idx">${iconSvg("flag", 12)}</span>` +
    `<p class="sig-q">${escapeHtml(person.connection?.label ?? "Inbound contact")}</p></div>` +
    `<p class="sig-why">${escapeHtml(person.connection?.nextMove ?? "")} ` +
    (person.matchedProspect
      ? `Already tracked — open the prospect page for the full prospect context.`
      : canPromote
        ? `Sending a message here will add ${escapeHtml(firstName)} as a tracked prospect and queue it for the agent.`
        : `Exo still does not know who this is in a durable way. Open the thread first. Do not create a tracked prospect from a placeholder identity.`) +
    `</p>` +
    replyContext +
    `</div>`;

  const composePanel = meta.interactive && !person.matchedProspect && canPromote ? renderPersonComposePanel(person, meta) : "";
  const addMotionPanel = meta.interactive && !person.matchedProspect && canPromote ? renderAddMotionPanel(person, meta) : "";
  const body = `<div class="dom-wrap" id="person-top">${matched}${unresolvedNote}${head}${tiles}${identityFacts}${why}${timeline}</div>${composePanel}${addMotionPanel}`;

  return renderShell({
    title: `Exo — ${id.name}`,
    activeId: "connections",
    sectionLabel: "Connections",
    detailLabel: id.name,
    body,
    interactive: meta.interactive,
    detail: true,
    agentRuntime: meta.agentRuntime ?? null,
  });
}

/**
 * The "Add as prospect" button carries a live promote intent (interactive UI):
 * clicking it promotes this inbound person into the transition motion, carrying
 * their in-flight state, then reloads to show the tracked-prospect banner.
 *
 * @param {any} person
 * @param {{ interactive?: boolean, userId?: string | null }} meta
 */
function renderPromoteButton(person, meta) {
  const label = `<button class="btn btn-secondary btn-sm" type="button" title="Add as a tracked prospect (no message)">${iconSvg("userPlus", 14)}<span>Add as prospect</span></button>`;
  if (!meta.interactive) {
    return label;
  }
  const args = JSON.stringify({ observationId: person.id, userId: meta.userId ?? null });
  return `<span class="exo-action" data-exo-writer="promoteInboundPerson" data-exo-args="${escapeAttr(args)}">${label}</span>`;
}

/**
 * @param {any} person
 */
function renderPersonTimeline(person) {
  const head = `<div class="md-section">Inbound activity <span>${person.timeline.length}</span></div>`;
  if (!person.timeline.length) {
    return head + `<div class="empty-state"><div class="empty-copy">No inbound activity recorded yet.</div></div>`;
  }

  return (
    head +
    `<ol class="tl">` +
    person.timeline.map((entry) => entry.isMessage ? renderPersonTimelineMessage(entry) : renderPersonTimelineEvent(entry)).join("") +
    `</ol>`
  );
}

/**
 * When the timeline is only a message or two, repeating the same latest inbound
 * block in both the status card and activity list wastes space. Keep the
 * preview only when it adds context beyond the first visible timeline row.
 *
 * @param {any} person
 * @returns {boolean}
 */
function shouldRenderStatusReplyContext(person) {
  if (!person?.latestMessage) return false;
  const timeline = Array.isArray(person.timeline) ? person.timeline : [];
  const messageCount = timeline.filter((entry) => entry?.isMessage).length;
  if (messageCount > 2) return true;
  return !sameTimelineEntry(timeline[0], person.latestMessage);
}

/**
 * @param {any} left
 * @param {any} right
 * @returns {boolean}
 */
function sameTimelineEntry(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  return Boolean(left.id && right.id && left.id === right.id);
}

/**
 * @param {any} entry
 */
function renderReplyContext(entry) {
  return (
    `<div class="tl-item tl-msg tl-in status-thread-preview">` +
    `<span class="tl-dot">${iconSvg(entry.channel === "email" ? "mail" : "activity", 12)}</span>` +
    `<div class="tl-body">` +
    `<div class="tl-head">` +
    `<span class="tl-title">${escapeHtml(entry.surfaceLabel)}</span>` +
    `<span class="tl-status ${escapeHtml(messageStatusClass(entry.direction))}">${escapeHtml(messageStatusLabel(entry.direction))}</span>` +
    `<span class="tl-time">${escapeHtml(relativeDays(entry.observedAt) ?? "")}</span>` +
    `</div>` +
    renderMessageByline(entry) +
    (entry.subject ? `<div class="tl-byline">Subject · ${escapeHtml(entry.subject)}</div>` : "") +
    `<blockquote class="tl-message">${escapeHtml(entry.detail ?? entry.summary)}</blockquote>` +
    (entry.showSummary && entry.summary ? `<p class="tl-detail">${escapeHtml(entry.summary)}</p>` : "") +
    (entry.href ? `<a class="tl-link" href="${escapeAttr(entry.href)}" target="_blank" rel="noreferrer">${iconSvg("link", 11)}Open thread</a>` : "") +
    `</div></div>`
  );
}

/**
 * @param {any} entry
 */
function renderPersonTimelineMessage(entry) {
  return (
    `<li class="tl-item tl-msg tl-in">` +
    `<span class="tl-dot">${iconSvg(entry.channel === "email" ? "mail" : "activity", 12)}</span>` +
    `<div class="tl-body">` +
    `<div class="tl-head">` +
    `<span class="tl-title">${escapeHtml(entry.surfaceLabel)}</span>` +
    `<span class="tl-status ${escapeHtml(messageStatusClass(entry.direction))}">${escapeHtml(messageStatusLabel(entry.direction))}</span>` +
    `<span class="tl-time">${escapeHtml(relativeDays(entry.observedAt) ?? "")}</span>` +
    `</div>` +
    renderMessageByline(entry) +
    (entry.subject ? `<div class="tl-byline">Subject · ${escapeHtml(entry.subject)}</div>` : "") +
    `<blockquote class="tl-message">${escapeHtml(entry.detail ?? entry.summary)}</blockquote>` +
    (entry.showSummary && entry.summary ? `<p class="tl-detail">${escapeHtml(entry.summary)}</p>` : "") +
    (entry.href ? `<a class="tl-link" href="${escapeAttr(entry.href)}" target="_blank" rel="noreferrer">${iconSvg("link", 11)}Open thread</a>` : "") +
    `</div></li>`
  );
}

/**
 * @param {any} entry
 */
function renderPersonTimelineEvent(entry) {
  return (
    `<li class="tl-item tl-sys">` +
    `<span class="tl-dot">${iconSvg("activity", 12)}</span>` +
    `<div class="tl-body">` +
    `<div class="tl-head">` +
    `<span class="tl-title">${escapeHtml(entry.surfaceLabel)}</span>` +
    `<span class="tl-time">${escapeHtml(relativeDays(entry.observedAt) ?? "")}</span>` +
    `</div>` +
    `<p class="tl-detail">${escapeHtml(entry.summary)}</p>` +
    (entry.href ? `<a class="tl-link" href="${escapeAttr(entry.href)}" target="_blank" rel="noreferrer">${iconSvg("link", 11)}Open</a>` : "") +
    `</div></li>`
  );
}

const PERSON_SURFACE_META = {
  connection_request: { label: "Connection request note", channel: "LinkedIn", subject: false },
  post_accept_message: { label: "First message", channel: "LinkedIn", subject: false },
  inbound_reply: { label: "Reply", channel: "LinkedIn", subject: false },
  email: { label: "Email", channel: "Email", subject: true },
  in_mail_message: { label: "InMail", channel: "LinkedIn", subject: true },
};

/** @param {{ key?: string } | null | undefined} connection */
function composeLabel(connection) {
  return connection && (connection.key === "connected" || connection.key === "in-conversation" || connection.key === "inbound-message") ? "Send message" : "Compose";
}

/**
 * Compose panel for an inbound (not-yet-tracked) person. Sending promotes them
 * to a prospect AND queues the message in one step — so "Send message" actually
 * sends, instead of dead-ending on a profile page.
 *
 * @param {any} person
 * @param {{ userId?: string|null }} meta
 */
function renderPersonComposePanel(person, meta) {
  const surface = person.suggestedSurface ?? "connection_request";
  const sm = PERSON_SURFACE_META[surface] ?? PERSON_SURFACE_META.connection_request;
  const panelId = `compose-${person.id}`;
  const args = JSON.stringify({ observationId: person.id, userId: meta.userId ?? null, surface });
  const draft = person.composeDraft ?? { subject: null, body: "" };
  const subjectField = sm.subject
    ? `<div class="compose-field"><span class="compose-label">Subject</span><input class="compose-input" name="subject" value="${escapeAttr(draft.subject ?? "")}" placeholder="Subject line"></div>`
    : "";
  const latestContext = person.latestMessage
    ? `<div class="compose-field"><span class="compose-label">Latest inbound context</span>` +
      `<blockquote class="tl-message">${escapeHtml(person.latestMessage.detail ?? person.latestMessage.summary ?? "")}</blockquote>` +
      (person.latestMessage.subject ? `<div class="tl-byline">Subject · ${escapeHtml(person.latestMessage.subject)}</div>` : "") +
      (person.latestMessage.href ? `<a class="tl-link" href="${escapeAttr(person.latestMessage.href)}" target="_blank" rel="noreferrer">${iconSvg("link", 11)}Open thread</a>` : "") +
      `</div>`
    : "";

  return (
    `<div class="compose-panel" id="${escapeAttr(panelId)}">` +
    `<a class="compose-backdrop" href="#person-top" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    `<div class="compose-head">${iconSvg("mail", 18)}` +
    `<div><div class="compose-title">${escapeHtml(sm.label)} · ${escapeHtml(person.identity.name)}</div>` +
    `<div class="compose-sub">${escapeHtml(person.connection?.label ?? "Inbound contact")}</div></div>` +
    `<a class="compose-close" href="#person-top" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<span class="compose-chan">${iconSvg(sm.channel === "Email" ? "mail" : "link", 11)}${escapeHtml(sm.channel)}</span>` +
    `<div class="cap-note ok">${iconSvg("userPlus", 14)}<div>Sending adds <strong>${escapeHtml(person.identity.name)}</strong> as a tracked prospect and queues the message for the agent.</div></div>` +
    latestContext +
    subjectField +
    `<div class="compose-field"><span class="compose-label">${surface === "connection_request" ? "Note" : "Message"}</span>` +
    `<textarea class="compose-body" name="body" placeholder="Write the message…">${escapeHtml(draft.body ?? "")}</textarea></div>` +
    `<div class="compose-actions">` +
    `<div class="exo-action" data-exo-writer="promoteAndApproveDraft" data-exo-args="${escapeAttr(args)}" data-exo-compose="${escapeAttr(panelId)}" data-exo-return="1">` +
    `<button class="btn btn-primary btn-sm" type="button">${iconSvg("arrowR", 14)}<span>Send — add &amp; queue</span></button></div>` +
    `<a class="btn btn-ghost btn-sm" href="#person-top">Cancel</a>` +
    `</div>` +
    `</div></div>`
  );
}

/**
 * @param {any} person
 */
function renderIgnoreButton(person) {
  const args = JSON.stringify({
    observationId: person.id,
    reason: "Operator rejected this inbound solicitation and wants future mail from the sender ignored.",
  });
  const inner = btn({ variant: "danger", size: "sm", icon: "x", label: "Ignore sender" });
  return `<span data-exo-writer="ignoreInboundObservation" data-exo-args="${escapeAttr(args)}" data-exo-return="1">${inner}</span>`;
}

/**
 * @param {string} label
 * @param {string} value
 * @param {string | null} [href]
 */
function renderIdentityFact(label, value, href = null) {
  const renderedValue = href
    ? `<a class="pd-fact-v pd-fact-link" href="${escapeAttr(href)}">${escapeHtml(value)}</a>`
    : `<span class="pd-fact-v">${escapeHtml(value)}</span>`;
  return (
    `<div class="pd-fact">` +
    `<span class="pd-fact-k">${escapeHtml(label)}</span>` +
    renderedValue +
    `</div>`
  );
}

/**
 * @param {{ fromName?: string | null, fromHandle?: string | null }} entry
 */
function renderMessageByline(entry) {
  const line = [entry.fromName, entry.fromHandle].filter(Boolean).join(" · ");
  return line ? `<div class="tl-byline">${escapeHtml(line)}</div>` : "";
}

/**
 * @param {"inbound"|"outbound"|"unknown"|undefined|null} direction
 */
function messageStatusLabel(direction) {
  if (direction === "outbound") {
    return "Sent";
  }
  if (direction === "inbound") {
    return "Received";
  }
  return "Recorded";
}

/**
 * @param {"inbound"|"outbound"|"unknown"|undefined|null} direction
 */
function messageStatusClass(direction) {
  if (direction === "outbound") {
    return "tl-status-sent";
  }
  if (direction === "inbound") {
    return "tl-status-received";
  }
  return "tl-status-queued";
}

/**
 * "Add to motion" picker — promote this inbound person into a chosen motion
 * (the Transition backlog is the default first option).
 * @param {any} person
 * @param {{ userId?: string|null, motions?: Array<{id:string,name:string}>, transitionMotionId?: string|null }} meta
 */
function renderAddMotionPanel(person, meta) {
  const panelId = `addmotion-${person.id}`;
  const motions = meta.motions ?? [];
  const args = JSON.stringify({ observationId: person.id, userId: meta.userId ?? null });
  const options = motions.length
    ? motions
        .map(
          (m, i) =>
            `<label class="rehome-opt"><input type="radio" name="addmotion-motion" value="${escapeAttr(m.id)}"${i === 0 ? " checked" : ""}><span>${escapeHtml(m.name)}${m.id === meta.transitionMotionId ? " · transition backlog" : ""}</span></label>`,
        )
        .join("")
    : `<div class="compose-empty">No motions yet — run \`exo transition start\` to create the backlog motion.</div>`;

  return (
    `<div class="compose-panel" id="${escapeAttr(panelId)}">` +
    `<a class="compose-backdrop" href="#person-top" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    `<div class="compose-head">${iconSvg("layers", 18)}` +
    `<div><div class="compose-title">Add ${escapeHtml(person.identity.name)} to a motion</div>` +
    `<div class="compose-sub">Tracks them as a prospect, carrying their in-flight state.</div></div>` +
    `<a class="compose-close" href="#person-top" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<div class="compose-field"><span class="compose-label">Motion</span><div class="rehome-list">${options}</div></div>` +
    `<div class="compose-actions">` +
    (motions.length
      ? `<div class="exo-action" data-exo-writer="promoteInboundPerson" data-exo-args="${escapeAttr(args)}" data-exo-radio="addmotion-motion:motionId">` +
        `<button class="btn btn-primary btn-sm" type="button">${iconSvg("userPlus", 14)}<span>Add to motion</span></button></div>`
      : "") +
    `<a class="btn btn-ghost btn-sm" href="#person-top">Cancel</a>` +
    `</div>` +
    `</div></div>`
  );
}

/** @param {string} source */
function sourceLabel(source) {
  if (source === "linkedin") return "LinkedIn contact";
  if (source === "email") return "Email contact";
  return "Inbound contact";
}

/** @param {string | null | undefined} iso */
function relativeDays(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const days = Math.max(0, Math.round((Date.now() - target.getTime()) / 86_400_000));
  if (days === 0) return "today";
  return `${days}d`;
}
