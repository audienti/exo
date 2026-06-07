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
  renderNextMoveAlert,
  renderShell,
  stateDot,
} from "../lib/exo-ui-components.js";

/**
 * @param {ReturnType<import("../core/build-person-view.js").buildPersonView>} person
 * @param {{
 *   interactive?: boolean,
 *   userId?: string | null,
 *   motions?: Array<{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }>,
 *   transitionMotionId?: string | null
 * }} [meta]
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
  const headline = knownTitle ?? knownCompany ?? "Inbound contact";

  const matched = person.matchedProspect
    ? `<div class="pd-matched">${iconSvg("check", 14)} This person is a tracked prospect on ` +
      `<strong>${escapeHtml(person.matchedProspect.motionName ?? "a motion")}</strong>. ` +
      `<a class="pd-matched-link" href="/prospects/${escapeAttr(encodeURIComponent(person.matchedProspect.prospectId))}">Open prospect ${iconSvg("chevronR", 12)}</a>` +
      `</div>`
    : "";
  const claimedElsewhere = !person.matchedProspect && person.claimState === "claimed_elsewhere"
    ? `<div class="pd-matched">${iconSvg("alert", 14)} This person is already claimed in another workspace. Do not add them again here.</div>`
    : "";
  const reviewHref = person.latestMessage?.href ?? person.timeline.find((entry) => entry.href)?.href ?? null;
  const canPromote = Boolean(person.hasDurableIdentity);
  const unresolvedNote = !canPromote
    ? `<div class="pd-matched">${iconSvg("alert", 14)} Exo does not have a durable identity for this contact yet. Review the thread before you decide whether to ignore it or capture it properly.</div>`
    : "";
  const canClaimHere = canPromote && person.claimState !== "claimed_elsewhere";
  const canComposeHere = canClaimHere && Boolean(person.suggestedSurface);
  const railSegments = [
    person.connection ? stateDot(person.connection.state, person.connection.label) : "",
    renderCompanyMeta(person, knownCompany),
    renderWorkspaceMeta(person),
    person.email ? `<span class="surface-ref">${iconSvg("mail", 11)}${escapeHtml(person.email)}</span>` : "",
    renderObservationMeta(person),
    renderSeenMeta("clock", "first", relativeDays(person.firstSeen)),
    renderSeenMeta("eye", "last", relativeDays(person.lastSeen)),
  ].filter(Boolean);

  const head =
    `<div class="pd-head">` +
    avatar({ src: id.avatarUrl, name: id.name, size: 56 }) +
    `<div class="pd-id">` +
    `<h1 class="pd-name">${escapeHtml(id.name)}</h1>` +
    `<div class="pd-title">${escapeHtml(headline)}</div>` +
    `</div>` +
    `<div class="pd-actions">` +
    (id.linkedinUrl ? btn({ variant: "secondary", size: "sm", icon: "link", label: "View profile", href: id.linkedinUrl }) : "") +
    (!id.linkedinUrl && reviewHref ? btn({ variant: "secondary", size: "sm", icon: "link", label: "Open thread", href: reviewHref }) : "") +
    (meta.interactive && person.connection?.key === "invite-received" ? renderInviteDecisionButtons(person) : "") +
    (person.matchedProspect
      ? btn({ variant: "primary", size: "sm", icon: "arrowR", label: "Open prospect", href: `/prospects/${person.matchedProspect.prospectId}` })
      : meta.interactive
        ? renderIgnoreButton(person) +
          (canClaimHere
            ? renderPromoteButton(person, meta) +
              (canComposeHere
                ? `<a class="btn btn-primary btn-sm" href="#compose-${escapeAttr(person.id)}">${iconSvg("mail", 14)}<span>${escapeHtml(composeLabel(person))}</span></a>`
                : "")
            : "")
        : (canClaimHere ? renderPromoteButton(person, meta) : "")) +
    `</div>` +
    (railSegments.length ? `<div class="pd-rail">${railSegments.join(`<i class="pd-div"></i>`)}</div>` : "") +
    `</div>`;

  const timeline = renderPersonTimeline(person);

  const why = renderNextMoveAlert({
    label: "Next move",
    lead: buildNextMoveTitle(person, firstName),
    detail: buildNextMoveBody(person, firstName, canPromote, canComposeHere),
  });

  const composePanel = meta.interactive && !person.matchedProspect && canComposeHere ? renderPersonComposePanel(person, meta) : "";
  const claimPanel = meta.interactive && !person.matchedProspect && canClaimHere ? renderClaimPanel(person, meta) : "";
  const body = `<div class="dom-wrap" id="person-top">${matched}${claimedElsewhere}${unresolvedNote}${head}${why}${timeline}</div>${claimPanel}${composePanel}`;

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
  const label = `${iconSvg("userPlus", 14)}<span>${escapeHtml(claimButtonLabel(person))}</span>`;
  if (!meta.interactive) {
    return `<button class="btn btn-secondary btn-sm" type="button" title="Claim into the local transition backlog (no message)">${label}</button>`;
  }
  if (claimMotionChoices(meta).length > 1) {
    return `<a class="btn btn-secondary btn-sm" href="#claim-${escapeAttr(person.id)}" title="Claim this person and pick the motion that should govern them">${label}</a>`;
  }
  const args = JSON.stringify({ observationId: person.id, userId: meta.userId ?? null });
  return `<span data-exo-writer="promoteInboundPerson" data-exo-args="${escapeAttr(args)}"><button class="btn btn-secondary btn-sm" type="button" title="Claim into the local transition backlog (no message)">${label}</button></span>`;
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
    person.timeline.map((entry) => entry.isMessage ? renderPersonTimelineMessage(entry) : renderPersonTimelineEvent(entry, person)).join("") +
    `</ol>`
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
 * @param {any} person
 */
function renderPersonTimelineEvent(entry, person) {
  const relationshipDetail = timelineRelationshipDetail(entry, person);
  return (
    `<li class="tl-item tl-sys">` +
    `<span class="tl-dot">${iconSvg("activity", 12)}</span>` +
    `<div class="tl-body">` +
    `<div class="tl-head">` +
    `<span class="tl-title">${escapeHtml(entry.surfaceLabel)}</span>` +
    `<span class="tl-time">${escapeHtml(relativeDays(entry.observedAt) ?? "")}</span>` +
    `</div>` +
    `<p class="tl-detail">${escapeHtml(entry.summary)}</p>` +
    (entry.detail && entry.detail !== entry.summary ? `<p class="tl-detail">${escapeHtml(entry.detail)}</p>` : "") +
    (relationshipDetail ? `<p class="tl-detail">${escapeHtml(relationshipDetail)}</p>` : "") +
    (entry.href ? `<a class="tl-link" href="${escapeAttr(entry.href)}" target="_blank" rel="noreferrer">${iconSvg("link", 11)}Open</a>` : "") +
    `</div></li>`
  );
}

/**
 * @param {any} entry
 * @param {any} person
 * @returns {string}
 */
function timelineRelationshipDetail(entry, person) {
  if (!entry || !person?.connection) {
    return "";
  }
  if ((entry.kind === "follower_confirmed" || entry.kind === "follower_added") && person.connection.state === "connected") {
    return "Already connected on LinkedIn.";
  }
  return "";
}

const PERSON_SURFACE_META = {
  connection_request: { label: "Connection request note", channel: "LinkedIn", subject: false },
  post_accept_message: { label: "First message", channel: "LinkedIn", subject: false },
  inbound_reply: { label: "Reply", channel: "LinkedIn", subject: false },
  email: { label: "Email", channel: "Email", subject: true },
  in_mail_message: { label: "InMail", channel: "LinkedIn", subject: true },
};

/** @param {any} person */
function composeLabel(person) {
  switch (person?.suggestedSurface) {
    case "connection_request":
      return "Draft connection note";
    case "post_accept_message":
      return "Send message";
    case "inbound_reply":
    case "email":
      return "Reply";
    default:
      return person?.connection && (person.connection.key === "connected" || person.connection.key === "in-conversation" || person.connection.key === "inbound-message")
        ? "Send message"
        : "Compose";
  }
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
  const surface = person.suggestedSurface ?? null;
  if (!surface) {
    return "";
  }
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
    `<div class="cap-note ok">${iconSvg("userPlus", 14)}<div>Sending claims <strong>${escapeHtml(person.identity.name)}</strong> into this workspace's transition backlog and queues the message for the agent.</div></div>` +
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
 * @param {{ userId?: string | null, motions?: Array<{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }> }} meta
 */
function renderClaimPanel(person, meta) {
  const motions = claimMotionChoices(meta);
  if (motions.length <= 1) {
    return "";
  }

  const panelId = `claim-${person.id}`;
  const options = motions
    .map(
      (motion, index) =>
        renderClaimMotionOption(person.id, motion, index === 0),
    )
    .join("");
  const args = JSON.stringify({ observationId: person.id, userId: meta.userId ?? null });

  return (
    `<div class="compose-panel" id="${escapeAttr(panelId)}">` +
    `<a class="compose-backdrop" href="#person-top" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    `<div class="compose-head">${iconSvg("layers", 18)}` +
    `<div><div class="compose-title">Claim ${escapeHtml(person.identity.name)}</div>` +
    `<div class="compose-sub">Attach this relationship to the motion that should govern it.</div></div>` +
    `<a class="compose-close" href="#person-top" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<div class="compose-field"><span class="compose-label">Destination motion</span><div class="rehome-list">${options}</div></div>` +
    `<div class="compose-actions">` +
    `<div class="exo-action" data-exo-writer="claimInboundPersonToMotion" data-exo-args="${escapeAttr(args)}" data-exo-radio="claim-motion-${escapeAttr(person.id)}:toMotionId" data-exo-return="1">` +
    `<button class="btn btn-primary btn-sm" type="button">${iconSvg("arrowR", 14)}<span>Claim</span></button></div>` +
    `<a class="btn btn-ghost btn-sm" href="#person-top">Cancel</a>` +
    `</div>` +
    `</div></div>`
  );
}

/**
 * @param {string} personId
 * @param {{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }} motion
 * @param {boolean} checked
 * @returns {string}
 */
function renderClaimMotionOption(personId, motion, checked) {
  const offerLabel = motion.offerLabel?.trim() || motion.name;
  const premise = motion.premise?.trim() || "No premise authored yet.";
  const showMotionName = motion.name.trim() && motion.name.trim() !== offerLabel;
  const statusLine = motion.status
    ? `<span class="rehome-detail"><span class="rehome-cap">Status</span>${stateDot(motion.status, motion.statusLabel ?? undefined)}</span>`
    : "";
  return (
    `<label class="rehome-opt">` +
    `<input type="radio" name="claim-motion-${escapeAttr(personId)}" value="${escapeAttr(motion.id)}"${checked ? " checked" : ""}>` +
    `<span class="rehome-copy">` +
    statusLine +
    `<span class="rehome-detail"><span class="rehome-cap">Offer</span><span class="rehome-offer">${escapeHtml(offerLabel)}</span></span>` +
    (showMotionName
      ? `<span class="rehome-detail"><span class="rehome-cap">Motion</span><span class="rehome-text rehome-code">${escapeHtml(motion.name)}</span></span>`
      : "") +
    `<span class="rehome-detail"><span class="rehome-cap">Premise</span><span class="rehome-text">${escapeHtml(premise)}</span></span>` +
    `</span>` +
    `</label>`
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
 * @param {any} person
 * @returns {string}
 */
function renderInviteDecisionButtons(person) {
  if (!person?.id) return "";
  const acceptArgs = JSON.stringify({
    observationId: person.id,
    nextKind: "connection_request_accepted",
  });
  const rejectArgs = JSON.stringify({
    observationId: person.id,
    nextKind: "connection_request_decline_requested",
  });
  return (
    `<span data-exo-writer="recordInboundObservation" data-exo-args="${escapeAttr(acceptArgs)}" data-exo-return="1">` +
    btn({ variant: "primary", size: "sm", icon: "check", label: "Accept" }) +
    `</span>` +
    `<span data-exo-writer="recordInboundObservation" data-exo-args="${escapeAttr(rejectArgs)}" data-exo-return="1">` +
    btn({ variant: "danger", size: "sm", icon: "x", label: "Reject" }) +
    `</span>`
  );
}

/**
 * @param {any} person
 * @returns {[string, string, string | null]}
 */
function workspaceIdentityFact(person) {
  if (person.matchedProspect) {
    return [
      "Workspace",
      `Tracked prospect · ${person.matchedProspect.motionName ?? "motion"}`,
      `/prospects/${encodeURIComponent(person.matchedProspect.prospectId)}`,
    ];
  }
  if (person.motionContext?.motionId) {
    return [
      "Workspace",
      person.motionContext.isTransition ? "Transition backlog" : `Claimed · ${person.motionContext.name ?? "motion"}`,
      `/motions/${encodeURIComponent(person.motionContext.motionId)}`,
    ];
  }
  if (person.claimState === "claimed_elsewhere") {
    return ["Workspace", "Claimed in another workspace", null];
  }
  return ["Workspace", "Global intake", null];
}

/**
 * @param {any} person
 * @param {string | null} knownCompany
 * @returns {string}
 */
function renderCompanyMeta(person, knownCompany) {
  const href = knownCompany && person.matchedCompany?.companyId ? `/companies/${encodeURIComponent(person.matchedCompany.companyId)}` : null;
  const externalHref = person.matchedCompany?.linkedinCompanyUrl ?? person.matchedCompany?.websiteUrl ?? null;
  const inner = `${iconSvg("building", 11)}${escapeHtml(knownCompany ?? "Company not captured yet")}`;
  if (href) {
    return `<a class="surface-ref pd-meta-link" href="${escapeAttr(href)}">${inner}</a>`;
  }
  return externalHref
    ? `<a class="surface-ref pd-meta-link" href="${escapeAttr(externalHref)}" target="_blank" rel="noreferrer">${inner}</a>`
    : `<span class="surface-ref">${inner}</span>`;
}

/**
 * @param {any} person
 * @returns {string}
 */
function renderWorkspaceMeta(person) {
  if (person.matchedProspect || person.claimState === "claimed_elsewhere") {
    return "";
  }
  const [, value, href] = workspaceIdentityFact(person);
  const inner = `${iconSvg("layers", 11)}${escapeHtml(value)}`;
  return href
    ? `<a class="surface-ref pd-meta-link" href="${escapeAttr(href)}">${inner}</a>`
    : `<span class="surface-ref">${inner}</span>`;
}

/**
 * @param {any} person
 * @returns {string}
 */
function renderObservationMeta(person) {
  const observationLabel = person.counts.observations === 1 ? "observation" : "observations";
  const sourceLabel = person.counts.surfaces === 1 ? "source" : "sources";
  return `<span class="surface-ref">${iconSvg("activity", 11)}${escapeHtml(`${person.counts.observations} ${observationLabel} across ${person.counts.surfaces} ${sourceLabel}`)}</span>`;
}

/**
 * @param {string} icon
 * @param {string} label
 * @param {string | null} value
 * @returns {string}
 */
function renderSeenMeta(icon, label, value) {
  if (!value) {
    return "";
  }
  return `<span class="surface-ref">${iconSvg(icon, 11)}${escapeHtml(`${label} ${value}`)}</span>`;
}

/**
 * @param {any} person
 */
function claimButtonLabel(person) {
  return person.connection?.key === "invite-sent" && person.connection?.isStale
    ? "Claim for withdraw"
    : "Claim to backlog";
}

/**
 * @param {{ motions?: Array<{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }> }} meta
 * @returns {Array<{ id: string, name: string, offerLabel?: string, premise?: string, status?: string | null, statusLabel?: string | null }>}
 */
function claimMotionChoices(meta) {
  return Array.isArray(meta?.motions) ? meta.motions : [];
}

/**
 * @param {any} person
 * @param {string} firstName
 * @param {boolean} canPromote
 * @param {boolean} canComposeHere
 */
function buildNextMoveBody(person, firstName, canPromote, canComposeHere) {
  if (person.connection?.key === "invite-received") {
    if (person.matchedProspect) {
      return "This relationship is already governed in Exo. Accept or reject the invite here, then continue on the prospect page.";
    }
    if (person.claimState === "claimed_elsewhere") {
      return "This relationship is already governed in another workspace. Accept or reject the invite there instead of creating a second local branch.";
    }
    if (!canPromote) {
      return "Exo still does not know who this is in a durable way. Open the thread first. Do not create a tracked prospect from a placeholder identity.";
    }
    return `Claim ${firstName} here only if this relationship belongs in this workspace.`;
  }

  if (person.matchedProspect) {
    return "This relationship is already governed in Exo. Open the prospect page for the full branch context.";
  }

  if (person.claimState === "claimed_elsewhere") {
    return "This person is already claimed in another workspace. Keep them visible here, but do not create a second local branch.";
  }

  if (!canPromote) {
    return "Exo still does not know who this is in a durable way. Open the thread first. Do not create a tracked prospect from a placeholder identity.";
  }

  if (person.connection?.key === "invite-sent") {
    const sentLabel = formatAbsoluteDate(person.connection?.sentAt ?? null);
    const outstanding = typeof person.connection?.ageDays === "number" ? `Outstanding ${person.connection.ageDays}d.` : "";
    const threshold = person.connection?.isStale
      ? "It crossed the withdraw threshold."
      : "No decision is needed while it is still pending.";
    const claimNote = person.connection?.isStale
      ? "Claim it only if you want Exo to govern the withdraw."
      : "Claim it only if you want to attach it to a workspace before it accepts.";
    return [
      person.connection?.nextMove ?? "",
      sentLabel ? `Sent ${sentLabel}.` : "",
      outstanding,
      threshold,
      claimNote,
    ].filter(Boolean).join(" ");
  }

  if (canComposeHere) {
    return "Use the timeline below for thread context.";
  }

  return `Claim ${firstName} here only if this relationship belongs in this workspace.`;
}

/**
 * @param {any} person
 * @param {string} firstName
 * @returns {string}
 */
function buildNextMoveTitle(person, firstName) {
  if (person.connection?.key === "invite-received") {
    return "Accept or decline the invite";
  }
  if (person.matchedProspect) {
    return "Open the tracked prospect";
  }
  if (person.claimState === "claimed_elsewhere") {
    return "Leave this in the other workspace";
  }
  if (!person.hasDurableIdentity) {
    return "Review the thread before claiming";
  }
  if (person.connection?.key === "in-conversation") {
    return hasQuestionCue(person.latestMessage?.detail) ? `Answer ${firstName}'s question` : `Reply to ${firstName}`;
  }
  if (person.connection?.key === "inbound-message") {
    return hasQuestionCue(person.latestMessage?.detail) ? `Review ${firstName}'s question` : `Review ${firstName}'s message`;
  }
  if (person.connection?.key === "invite-sent") {
    return person.connection?.isStale ? "Decide whether to withdraw the invite" : "Wait on the pending invite";
  }
  return person.connection?.nextMove ?? "Decide how to engage";
}

/**
 * @param {string | null | undefined} detail
 * @returns {boolean}
 */
function hasQuestionCue(detail) {
  if (!detail) return false;
  return detail.includes("?");
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

/** @param {string | null | undefined} iso */
function relativeDays(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const days = Math.max(0, Math.round((Date.now() - target.getTime()) / 86_400_000));
  if (days === 0) return "today";
  return `${days}d`;
}

/** @param {string | null | undefined} iso */
function formatAbsoluteDate(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(target);
}
