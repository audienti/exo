// @ts-check
//
// Render the Operator landing view (Exo UI Build Spec) as a static HTML page.
//
// Inputs are produced by src/core/build-operator-view.js. All visual primitives
// come from src/lib/exo-ui-components.js so other surfaces (Motions, Prospects,
// etc.) can reuse the same design system.

import {
  actionTag,
  avatar,
  btn,
  card,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  liveActionBtn,
  ownerTag,
  renderShell,
  sectionHead,
  stateDot,
  truthTag,
} from "../lib/exo-ui-components.js";

/**
 * @param {import("../core/build-operator-view.js").OperatorViewModel} model
 * @param {{ interactive?: boolean }} [meta]
 * @returns {string}
 */
export function renderOperatorPage(model, meta = {}) {
  const sections = [
    renderSection(
      "dec",
      "queue",
      "Action queue",
      model.counts.decisions,
      "amber",
      "One queue of operator work across inbound review and due-now planner actions.",
      renderDecisions(model.decisions, meta, { hasPromoted: Boolean(model.nextMove) }),
    ),
  ];
  if (model.counts.blocked > 0) {
    sections.push(renderSection("blk", "alert", "Blocked", model.counts.blocked, "red", null, renderBlocked(model.blocked, meta)));
  }
  if (model.counts.stale > 0) {
    sections.push(renderSection("stale", "eye", "Stale or incomplete", model.counts.stale, "amber", null, renderStale(model.stale)));
  }
  const body =
    `<div class="op-wrap feed">` +
    renderIntro(model) +
    renderNextMove(model.nextMove, meta) +
    sections.join("") +
    renderFooter(model) +
    `</div>`;

  return renderShell({
    title: `Exo — Operator · ${model.user.label}`,
    activeId: "operator",
    sectionLabel: "Operator",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    agentRuntime: model.agentRuntime
      ? { ...(meta.agentRuntime ?? {}), queueCount: model.agentRuntime.queueCount }
      : meta.agentRuntime ?? null,
  });
}

/** @param {import("../core/build-operator-view.js").OperatorViewModel} model */
function renderIntro(model) {
  const c = model.counts;
  const summaryParts = ["What needs action"];
  if (c.blocked > 0) summaryParts.push("what is blocked");
  if (c.stale > 0) summaryParts.push("what still needs review");
  let summaryLine = "What needs action right now.";
  if (summaryParts.length === 2) {
    summaryLine = `${summaryParts[0]} and ${summaryParts[1]}.`;
  } else if (summaryParts.length > 2) {
    summaryLine = `${summaryParts.slice(0, -1).join(", ")}, and ${summaryParts.at(-1)}.`;
  }
  const stats = [
    `<span><b>${c.decisions}</b> queued</span>`,
    c.blocked > 0 ? `<span><b>${c.blocked}</b> blocked</span>` : "",
    c.stale > 0 ? `<span><b>${c.stale}</b> stale</span>` : "",
  ].filter(Boolean);
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Operator</h1>` +
    `<p class="op-line">${summaryLine}</p>` +
    `</div>` +
    `<div class="op-stat">` +
    stats.join("<i></i>") +
    `</div>` +
    `</div>`
  );
}

/**
 * A person's name links to their prospect show page when they're a tracked
 * prospect, otherwise to the internal person page (interactive UI only).
 *
 * @param {string} name
 * @param {string | null | undefined} prospectId
 * @param {string | null | undefined} personId  inbound observation id
 * @param {{ interactive?: boolean }} meta
 * @param {string} cls
 */
function personName(name, prospectId, personId, meta, cls) {
  const href = personHref(prospectId, personId, meta);
  if (href) {
    return `<a class="${cls} person-link" href="${escapeAttr(href)}">${escapeHtml(name)}</a>`;
  }
  return `<div class="${cls}">${escapeHtml(name)}</div>`;
}

/**
 * @param {string | null | undefined} prospectId
 * @param {string | null | undefined} personId
 * @param {{ interactive?: boolean }} meta
 * @returns {string | null}
 */
function personHref(prospectId, personId, meta) {
  if (!meta.interactive) return null;
  if (prospectId) return withReturn(`/prospects/${encodeURIComponent(prospectId)}`, meta);
  if (personId) return withReturn(`/people/${encodeURIComponent(personId)}`, meta);
  return null;
}

/**
 * @param {string} companyId
 * @param {{ interactive?: boolean }} meta
 * @returns {string | null}
 */
function companyHref(companyId, meta) {
  if (!meta.interactive) return null;
  return `/companies/${encodeURIComponent(companyId)}`;
}

/**
 * Preserve the originating surface on interactive internal links so detail-page
 * actions can route the operator back to the right lane after a mutation.
 *
 * @param {string} href
 * @param {{ interactive?: boolean, returnTo?: string | null }} meta
 * @returns {string}
 */
function withReturn(href, meta) {
  if (!meta.interactive) return href;
  const returnTo = meta.returnTo ?? "/operator";
  if (!returnTo || !href.startsWith("/")) return href;
  try {
    const url = new URL(href, "http://exo.local");
    if (!url.searchParams.has("return")) {
      url.searchParams.set("return", returnTo);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

/**
 * Where a Reply/Send action goes: a tracked prospect opens their compose panel
 * directly (the panel is a :target, so the hash auto-opens it); an untracked
 * inbound person goes to their person page (to promote first). Falls back to the
 * external href (e.g. LinkedIn) only when not interactive.
 *
 * @param {string | null | undefined} prospectId
 * @param {string | null | undefined} personId
 * @param {string | null | undefined} fallbackHref
 * @param {{ interactive?: boolean }} meta
 * @returns {string | undefined}
 */
function composeHref(prospectId, personId, fallbackHref, meta) {
  // Carry where the operator launched from so the compose submit can return
  // there instead of reloading the detail page in place.
  const ret = `return=${encodeURIComponent(meta.returnTo ?? "/operator")}`;
  if (meta.interactive && prospectId) {
    return `/prospects/${encodeURIComponent(prospectId)}?${ret}#compose-${encodeURIComponent(prospectId)}`;
  }
  if (meta.interactive && personId) {
    // Opens the person page with the compose panel open (which promotes-on-send).
    return `/people/${encodeURIComponent(personId)}?${ret}#compose-${encodeURIComponent(personId)}`;
  }
  return fallbackHref ?? undefined;
}

/**
 * @param {string | null | undefined} prospectId
 * @param {string | null | undefined} personId
 * @param {string | null | undefined} fallbackHref
 * @param {{ interactive?: boolean }} meta
 * @returns {string | undefined}
 */
function detailHref(prospectId, personId, fallbackHref, meta) {
  const internalHref = personHref(prospectId, personId, meta);
  if (internalHref) {
    return internalHref;
  }
  return fallbackHref ? withReturn(fallbackHref, meta) : undefined;
}

/**
 * @param {import("../core/build-operator-view.js").OperatorNextMove | null} nm
 * @param {{ interactive?: boolean }} [meta]
 */
function renderNextMove(nm, meta = {}) {
  if (!nm) {
    return card({
      stakes: "high",
      className: "next-move",
      children:
        `<div class="nm-flag">${iconSvg("flag", 13)} NEXT MOVE</div>` +
        `<div class="row-note">No operator decision is waiting right now.</div>`,
    });
  }

  const chips = [
    nm.motionName ? stateDot(nm.motionStatus ?? "active", nm.motionName) : null,
    nm.actionStatus ? actionTag(nm.actionStatus, nm.why ?? undefined) : null,
    truthTag(nm.truth, nm.truthAt ?? null),
    nm.surface ? `<span class="surface-ref">${iconSvg("inbox", 12)}${escapeHtml(nm.surface)}</span>` : null,
  ]
    .filter(Boolean)
    .join("");

  const action = renderOperatorActionSet(
    nm.actions ?? [],
    {
      label: nm.action,
      mode: nm.actionMode,
      href: nm.actionHref,
      writer: nm.actionWriter,
      args: nm.actionArgs ?? null,
      variant: "primary",
      icon: nm.actionMode === "compose" ? "arrowR" : "check",
    },
    {
      prospectId: nm.prospectId,
      personId: nm.personId,
      size: "md",
      meta,
    },
  );

  const subjectLine = nm.subject
    ? personName(nm.subject, nm.prospectId, nm.personId, meta, "nm-title") +
      (nm.subtitle ? `<div class="nm-sub">${escapeHtml(nm.subtitle)}</div>` : "") +
      `<div class="row-summary" style="margin-top:9px">${escapeHtml(nm.title)}</div>`
    : `<div class="nm-title">${escapeHtml(nm.title)}</div>` +
      (nm.subtitle ? `<div class="nm-sub">${escapeHtml(nm.subtitle)}</div>` : "");
  const backlog = (nm.backlogCompanies ?? []).length
    ? `<div class="nm-chips">` +
      (nm.backlogCompanies ?? [])
        .map((company) => {
          const href = meta.interactive ? (company.href ?? companyHref(company.id, meta)) : null;
          const label = `${company.name}`;
          return href
            ? `<a class="surface-ref" href="${escapeAttr(href)}">${iconSvg("building", 12)}${escapeHtml(label)}</a>`
            : `<span class="surface-ref">${iconSvg("building", 12)}${escapeHtml(label)}</span>`;
        })
        .join("") +
      `</div>`
    : "";

  return card({
    stakes: "high",
    className: "next-move",
    children:
      `<div class="nm-flag">${iconSvg("flag", 13)} NEXT MOVE</div>` +
      `<div class="nm-body">` +
      avatar({ src: nm.avatarUrl, name: nm.subject ?? "Next move", initials: nm.subject ? initials(nm.subject) : "NM", size: 48, accent: "#3b82f6" }) +
      `<div class="nm-main">` +
      subjectLine +
      (nm.why ? `<div class="row-note">${escapeHtml(nm.why)}</div>` : "") +
      renderPreview(nm.previewLabel, nm.previewSubject, nm.previewText) +
      (chips ? `<div class="nm-chips">${chips}</div>` : "") +
      backlog +
      `</div>` +
      `<div class="nm-actions">${action}</div>` +
      `</div>`,
  });
}

/**
 * @param {string} key
 * @param {string} icon
 * @param {string} title
 * @param {number | null} count
 * @param {"neutral" | "amber" | "blue" | "red" | null} tone
 * @param {string | null} sub
 * @param {string} bodyHtml
 */
function renderSection(key, icon, title, count, tone, sub, bodyHtml) {
  return (
    `<section class="op-sec" data-sec="${escapeAttr(key)}">` +
    sectionHead({
      icon,
      title,
      count: count != null ? count : null,
      countTone: (tone ?? undefined),
      sub: sub ?? null,
    }) +
    `<div class="sec-body">${bodyHtml}</div>` +
    `</section>`
  );
}

/**
 * @param {string | null | undefined} label
 * @param {string | null | undefined} subject
 * @param {string | null | undefined} text
 */
function renderPreview(label, subject, text) {
  if (!text) return "";
  return (
    `<div class="op-preview">` +
    (label ? `<div class="op-preview-cap">${escapeHtml(label)}</div>` : "") +
    (subject ? `<div class="op-preview-subject">Subject · ${escapeHtml(subject)}</div>` : "") +
    `<blockquote class="tl-message op-preview-quote" title="${escapeAttr(text)}">${escapeHtml(text)}</blockquote>` +
    `</div>`
  );
}

/**
 * @param {import("../core/build-operator-view.js").OperatorDecisionCard[]} decisions
 * @param {{ interactive?: boolean }} [meta]
 * @param {{ hasPromoted?: boolean }} [options]
 */
function renderDecisions(decisions, meta = {}, options = {}) {
  if (!decisions.length) {
    if (options.hasPromoted) {
      return emptyState({ icon: "flag", message: "The first queued action is promoted above." });
    }
    return emptyState({ icon: "check", message: "No operator work is queued right now." });
  }
  return decisions.map((d) => renderDecisionCard(d, meta)).join("");
}

/**
 * @param {import("../core/build-operator-view.js").OperatorDecisionCard} d
 * @param {{ interactive?: boolean }} [meta]
 */
function renderDecisionCard(d, meta = {}) {
  const personId = Object.prototype.hasOwnProperty.call(d, "personId")
    ? d.personId
    : d.id;
  const chips = [
    d.motionName ? stateDot("active", d.motionName) : null,
    truthTag(d.truth, d.truthAt ?? null),
    d.surface ? `<span class="surface-ref">${iconSvg("inbox", 11)}${escapeHtml(d.surface)}</span>` : null,
    ownerTag({ ownerName: null }),
  ]
    .filter(Boolean)
    .join("");
  const actions = renderOperatorActionSet(
    d.actions ?? [],
    {
      label: d.primaryActionLabel,
      mode: d.primaryActionMode,
      href: d.primaryHref,
      writer: null,
      args: null,
      variant: "primary",
      icon: d.actionStatus === "due now" ? "arrowR" : "check",
    },
    {
      prospectId: d.prospectId,
      personId,
      size: "sm",
      meta,
    },
  );

  return card({
    stakes: d.stakes ?? null,
    className: "dec-card",
    children:
      `<div class="row-top">` +
      avatar({ src: d.avatarUrl, initials: d.initials, name: d.person, size: 34 }) +
      `<div class="row-id">` +
      personName(d.person, d.prospectId, personId, meta, "row-name") +
      `<div class="row-role">${escapeHtml(d.roleLine ?? [d.role, d.company].filter(Boolean).join(" · "))}</div>` +
      `</div>` +
      actionTag(d.actionStatus, d.why ?? undefined) +
      `</div>` +
      `<p class="row-summary">${escapeHtml(d.summary)}</p>` +
      (d.why ? `<div class="row-note">${escapeHtml(d.why)}</div>` : "") +
      renderPreview(d.previewLabel, d.previewSubject, d.previewText) +
      `<div class="row-chips">${chips}</div>` +
      `<div class="row-actions">${actions}</div>`,
  });
}

/**
 * @param {import("../core/build-operator-view.js").OperatorBlockedCard[]} blocked
 * @param {{ interactive?: boolean, returnTo?: string | null }} [meta]
 */
function renderBlocked(blocked, meta = {}) {
  if (!blocked.length) {
    return emptyState({ icon: "check", message: "Nothing blocked." });
  }
  return blocked.map((item) => renderBlockedCard(item, meta)).join("");
}

/**
 * @param {import("../core/build-operator-view.js").OperatorBlockedCard} b
 * @param {{ interactive?: boolean, returnTo?: string | null }} [meta]
 */
function renderBlockedCard(b, meta = {}) {
  const status =
    b.blockType === "assignment"
      ? "blocked · assignment"
      : b.blockType === "capability"
        ? "blocked · capability"
        : "failed";
  const iconName = b.blockType === "failed" ? "refresh" : b.blockType === "assignment" ? "userPlus" : "mail";
  const href = b.resolveMode === "compose"
    ? composeHref(b.prospectId, b.personId, b.resolveHref, meta)
    : b.resolveMode === "detail"
      ? detailHref(b.prospectId, b.personId, b.resolveHref, meta)
      : undefined;
  // When the blocker carries typed actions (one per company that needs an owner
  // pinned), render them as live exo-writer buttons so the client dispatcher
  // can POST to /act and update governed state. Without typed actions, fall
  // back to a real link when the blocker already knows where review happens.
  // Otherwise render a disabled placeholder so the surface does not lie.
  const resolve = (b.actions ?? []).length
    ? b.actions
        .slice(0, 3)
        .map((act, idx) =>
          actionBtn({
            writer: act.writer,
            args: act.args,
            variant: idx === 0 ? "secondary" : "ghost",
            icon: iconName,
            label: act.label,
          }),
        )
        .join("")
    : href
      ? btn({ variant: "secondary", size: "sm", icon: iconName, label: b.resolveLabel, href })
      : btn({ variant: "secondary", size: "sm", icon: iconName, label: b.resolveLabel, disabled: true });

  return card({
    stakes: "block",
    className: "blk-card",
    children:
      `<div class="row-top">` +
      avatar({ initials: initials(b.subject), name: b.subject, size: 30, accent: "#ef4444" }) +
      `<div class="row-id">` +
      `<div class="row-name">${escapeHtml(b.subject)}</div>` +
      `<div class="row-role">${escapeHtml(b.channel)}</div>` +
      `</div>` +
      actionTag(status) +
      `</div>` +
      `<p class="row-summary"><strong class="blk-reason">${escapeHtml(b.reason)}.</strong> ${escapeHtml(b.detail)}</p>` +
      `<div class="row-actions">${resolve}${ownerTag({ ownerName: null })}</div>`,
  });
}

/** @param {import("../core/build-operator-view.js").OperatorStaleRow[]} stale */
function renderStale(stale) {
  if (!stale.length) {
    return emptyState({ icon: "eye", message: "All surfaces fresh." });
  }
  return (
    `<div class="stale-list">` +
    stale
      .map(
        (s) =>
          `<div class="stale-row">` +
          iconSvg("eye", 15, "stale-ic") +
          `<div class="stale-main">` +
          `<div class="stale-top">` +
          `<span class="stale-subject">${escapeHtml(s.subject)}</span>` +
          truthTag(s.truth, s.lastChecked ?? null) +
          `</div>` +
          `<p class="stale-detail">${escapeHtml(s.detail)}</p>` +
          `</div>` +
          `<span class="surface-ref">${iconSvg("cpu", 11)}Handled by agent queue</span>` +
          `</div>`,
      )
      .join("") +
    `</div>`
  );
}

/** @param {import("../core/build-operator-view.js").OperatorViewModel} model */
function renderFooter(model) {
  const stamp = new Date(model.generatedAt).toISOString();
  return (
    `<div class="gen-footer">` +
    `Generated ${escapeHtml(stamp)} · regenerate with <code>${escapeHtml(model.regenerateCommand)}</code>` +
    `</div>`
  );
}

/**
 * Wrap a button in a live `[data-exo-args]` host so the shared client
 * dispatcher (EXO_CLIENT_JS) POSTs the typed intent to /act on click.
 * Mirrors the helper in render-connections.js so blockers can fire writers
 * without duplicating dispatcher logic.
 *
 * @param {{ writer: string, args: Record<string, any>, variant: "primary" | "secondary" | "ghost" | "danger", label: string, icon?: string }} opts
 */
function actionBtn(opts) {
  const inner =
    `<button class="btn btn-${opts.variant} btn-sm" type="button">` +
    (opts.icon ? iconSvg(opts.icon, 14) : "") +
    `<span>${escapeHtml(opts.label)}</span></button>`;
  return `<span class="exo-action exo-action-flat" data-exo-writer="${escapeAttr(opts.writer)}" data-exo-args="${escapeAttr(JSON.stringify(opts.args))}">${inner}</span>`;
}

/**
 * @param {Array<{
 *   label: string,
 *   mode: "compose" | "detail",
 *   href: string | null,
 *   writer: string | null,
 *   args: Record<string, any> | null,
 *   variant: "primary" | "secondary" | "ghost" | "danger",
 *   icon: string | null,
 *   fields?: Array<{ name: string, argKey?: string, placeholder?: string, required?: boolean }>
 * }>} actions
 * @param {{
 *   label: string,
 *   mode: "compose" | "detail",
 *   href: string | null,
 *   writer: string | null,
 *   args: Record<string, any> | null,
 *   variant: "primary" | "secondary" | "ghost" | "danger",
 *   icon: string | null,
 *   fields?: Array<{ name: string, argKey?: string, placeholder?: string, required?: boolean }>
 * }} fallback
 * @param {{
 *   prospectId: string | null | undefined,
 *   personId: string | null | undefined,
 *   size: "sm" | "md",
 *   meta: { interactive?: boolean, returnTo?: string | null }
 * }} context
 */
function renderOperatorActionSet(actions, fallback, context) {
  const usable = Array.isArray(actions) ? actions.filter(Boolean) : [];
  if (usable.length > 0) {
    return usable.map((action) => renderOperatorAction(action, context)).join("");
  }
  return renderOperatorAction(fallback, context);
}

/**
 * @param {{
 *   label: string,
 *   mode: "compose" | "detail",
 *   href: string | null,
 *   writer: string | null,
 *   args: Record<string, any> | null,
 *   variant: "primary" | "secondary" | "ghost" | "danger",
 *   icon: string | null,
 *   fields?: Array<{ name: string, argKey?: string, placeholder?: string, required?: boolean }>
 * }} action
 * @param {{
 *   prospectId: string | null | undefined,
 *   personId: string | null | undefined,
 *   size: "sm" | "md",
 *   meta: { interactive?: boolean, returnTo?: string | null }
 * }} context
 */
function renderOperatorAction(action, context) {
  if (action.writer) {
    const fields = renderActionFields(action.fields);
    const fieldSpec = buildActionFieldSpec(action.fields);
    const inner =
      fields +
      `<button class="btn btn-${escapeAttr(action.variant)} btn-${escapeAttr(context.size)}" type="button">` +
      (action.icon ? iconSvg(action.icon, context.size === "sm" ? 14 : 16) : "") +
      `<span>${escapeHtml(action.label)}</span></button>`;
    const fieldAttr = fieldSpec ? ` data-exo-fields="${escapeAttr(fieldSpec)}"` : "";
    return (
      `<span class="exo-action exo-action-flat exo-action-inline" data-exo-writer="${escapeAttr(action.writer)}"` +
      ` data-exo-args="${escapeAttr(JSON.stringify(action.args ?? {}))}"${fieldAttr}>${inner}</span>`
    );
  }
  const href = action.mode === "compose"
    ? composeHref(context.prospectId, context.personId, action.href, context.meta)
    : detailHref(context.prospectId, context.personId, action.href, context.meta);
  return btn({
    variant: action.variant,
    size: context.size,
    icon: action.icon ?? undefined,
    label: action.label,
    href,
  });
}

/**
 * @param {Array<{ name: string, argKey?: string, placeholder?: string, required?: boolean }> | undefined} fields
 */
function renderActionFields(fields) {
  if (!fields?.length) return "";
  return fields
    .map((field) =>
      `<input class="compose-input exo-action-input" name="${escapeAttr(field.name)}"` +
      ` placeholder="${escapeAttr(field.placeholder ?? field.argKey ?? field.name)}" autocomplete="off" />`
    )
    .join("");
}

/**
 * @param {Array<{ name: string, argKey?: string, required?: boolean }> | undefined} fields
 */
function buildActionFieldSpec(fields) {
  if (!fields?.length) return "";
  return fields
    .map((field) => `${field.name}:${field.argKey ?? field.name}${field.required === false ? "?" : ""}`)
    .join(",");
}

/** @param {string | null | undefined} value */
function initials(value) {
  if (!value) return "?";
  return value
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
