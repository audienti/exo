// @ts-check
//
// Render the Company detail page (interactive Exo UI) — the canonical record for
// one company: identity + transport assignment, motions it's targeted in, and
// the tracked prospects at the company.

import {
  avatar,
  btn,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  liveActionBtn,
  ownerTag,
  renderShell,
  stateDot,
} from "../lib/exo-ui-components.js";
import { buildExactGmailPickerModel, renderExactGmailPicker } from "./render-assignment-controls.js";

/**
 * @param {ReturnType<import("../core/build-company-view.js").buildCompanyViewModel>} model
 * @param {{ interactive?: boolean, user?: { id?: string | null, label?: string | null, gmailOptions?: Array<{ ref?: string | null, handle?: string | null, label?: string | null }> | null } | null }} [meta]
 * @returns {string}
 */
export function renderCompanyDetailPage(model, meta = {}) {
  const motionHref = (id) => (meta.interactive ? `/motions/${encodeURIComponent(id)}` : `#m-${id}`);
  const prospectHref = (id) => (meta.interactive ? `/prospects/${encodeURIComponent(id)}` : `#p-${id}`);
  const researchBriefHref = (motionId) =>
    meta.interactive ? `/companies/${encodeURIComponent(model.id)}/research-brief/${encodeURIComponent(motionId)}` : null;
  const queueHref = meta.interactive ? "/queue" : null;
  const currentUserId = meta.user?.id ?? null;
  const currentUserLabel = meta.user?.label ?? null;
  const currentUserAssigned = Boolean(currentUserId) && model.ownerUserId === currentUserId;
  const assignment = {
    accountRefs: model.accountRefs,
  };
  const gmailPicker = buildExactGmailPickerModel(meta.user ?? null, assignment);
  const gmailPickerHtml = renderExactGmailPicker(gmailPicker, {
    helper: "Pick one exact inbox when this company should send or reconcile email from a specific mailbox. Leave it blank to keep Gmail unresolved at company scope.",
  });
  const needsScopedGmailPin = currentUserAssigned && gmailPicker.showPicker && !gmailPicker.selectedRef;

  const links =
    (model.websiteUrl
      ? `<a class="co-link" href="${escapeAttr(model.websiteUrl)}" target="_blank" rel="noreferrer">${iconSvg("link", 12)}${escapeHtml(model.domain ?? "Website")}</a>`
      : model.domain
        ? `<span class="co-link is-static">${iconSvg("building", 12)}${escapeHtml(model.domain)}</span>`
        : "") +
    (model.linkedinCompanyUrl
      ? `<a class="co-link" href="${escapeAttr(model.linkedinCompanyUrl)}" target="_blank" rel="noreferrer">${iconSvg("link", 12)}LinkedIn</a>`
      : "");

  const head =
    `<div class="co-head">` +
    avatar({ src: model.logoUrl, initials: initialsOf(model.name), name: model.name, size: 56, accent: "#3b82f6" }) +
    `<div class="co-id">` +
    `<h1 class="co-name">${escapeHtml(model.name)}</h1>` +
    `<div class="co-meta">${links}${ownerTag({ ownerName: model.ownerLabel })}</div>` +
    `</div>` +
    `</div>`;

  const assignmentSummary = model.ownerLabel
    ? `${model.ownerLabel} is assigned to this company.`
    : "No user is assigned to this company yet.";
  const assignmentDetail = model.ownerLabel
    ? `Execution will inherit ${model.accountRefs.length ? model.accountRefs.join(", ") : "the assigned user's mapped accounts"}.`
    : "Assign one user here so company-scoped work can resolve one governed execution identity.";
  const assignmentButton = meta.interactive && currentUserId && (!currentUserAssigned || gmailPicker.showPicker)
    ? liveActionBtn({
        writer: "assignCompanyUser",
        args: {
          companyId: model.id,
          userId: currentUserId,
          reason: "Keep one execution identity for this company",
        },
        variant: "primary",
        icon: "check",
        label: currentUserAssigned
          ? "Save owner settings"
          : (currentUserLabel ? `Assign ${currentUserLabel}` : "Assign current user"),
        title: currentUserAssigned
          ? "Save the current company owner and any exact Gmail inbox pin."
          : "Assign the current workspace user to this company so execution can resolve one governed identity.",
        fields: gmailPicker.showPicker ? "accountRef:accountRef?" : null,
      })
    : "";
  const assignmentFooter = currentUserAssigned
    ? `<p class="premise-note">${escapeHtml(
        needsScopedGmailPin
          ? "This company is already assigned to the current workspace user. Pick one exact Gmail inbox before email work should trust this scope."
          : "This company is already assigned to the current workspace user."
      )}</p>`
    : currentUserLabel
      ? `<p class="premise-note">Current workspace user: ${escapeHtml(currentUserLabel)}.</p>`
      : `<p class="premise-note">Open the UI as a governed execution user to assign this company here.</p>`;
  const assignmentSection =
    `<div class="offer-card">` +
    `<div class="offer-head">` +
    `<span class="def-cap">${iconSvg("userPlus", 12)}Execution · who can work this company</span>` +
    `</div>` +
    `<div class="offer-title">${escapeHtml(model.ownerLabel ?? "Unassigned")}</div>` +
    `<p class="offer-summary">${escapeHtml(assignmentSummary)}</p>` +
    `<p class="offer-summary">${escapeHtml(assignmentDetail)}</p>` +
    `<div class="premise-meta">${ownerTag({ ownerName: model.ownerLabel ?? null })}</div>` +
    assignmentFooter +
    gmailPickerHtml +
    (assignmentButton ? `<div class="compose-actions">${assignmentButton}</div>` : "") +
    `</div>`;

  const motionsSection =
    `<div class="md-section">Targeted in <span>${model.counts.motions}</span></div>` +
    (model.motions.length
      ? `<div class="co-motions">` +
        model.motions
          .map(
            (m) =>
              `<a class="co-motion" href="${escapeAttr(motionHref(m.id))}">` +
              stateDot(mapState(m.status), m.name) +
              iconSvg("chevronR", 13, "co-motion-go") +
              `</a>`,
          )
          .join("") +
        `</div>`
      : emptyState({ icon: "layers", message: "Not targeted in any motion yet." }));

  const researchSection =
    `<div class="md-section">Start research <span>${model.counts.motions}</span></div>` +
    (model.motions.length
      ? `<div class="md-list">` +
        model.motions
          .map((m) => {
            const briefHref = researchBriefHref(m.id);
            const autonomousResearch = m.queueStatus === "discovered"
              || m.queueStatus === "queued_for_research"
              || (m.packetKind === "company_research" && m.packetStatus === "claimed");
            const queued = m.packetKind === "company_research" && m.packetStatus === "claimed";
            return (
              `<div class="md-co">` +
              iconSvg("flag", 14, "md-co-ic") +
              `<div class="md-co-id"><span class="md-co-name">${escapeHtml(m.name)}</span><span class="md-co-sub">Governed research brief for this motion</span></div>` +
              stateDot(mapState(m.status), m.status) +
              (autonomousResearch
                ? `<span class="match-sig">${iconSvg("cpu", 11)}Agent queue${queued && m.packetWorkerLabel ? ` · ${escapeHtml(m.packetWorkerLabel)}` : ""}</span>`
                : "") +
              (autonomousResearch && queueHref
                ? btn({ variant: "primary", size: "sm", icon: "cpu", label: "Open queue", href: queueHref })
                : "") +
              (briefHref
                ? btn({ variant: "ghost", size: "sm", icon: "flag", label: "Open brief", href: briefHref })
                : "") +
              `</div>`
            );
          })
          .join("") +
        `</div>`
      : emptyState({ icon: "flag", message: "Link this company to a motion before starting research." }));

  const prospectsSection =
    `<div class="md-section">Prospects <span>${model.counts.prospects}</span></div>` +
    (model.prospects.length
      ? `<div class="md-list">` +
        model.prospects
          .map(
            (p) =>
              `<a class="md-co is-link" href="${escapeAttr(prospectHref(p.id))}">` +
              avatar({ src: p.avatarUrl, initials: p.initials, name: p.name, size: 30 }) +
              `<div class="md-co-id"><span class="md-co-name">${escapeHtml(p.name)}</span><span class="md-co-sub">${escapeHtml(p.title ?? "")}</span></div>` +
              (p.connectionDegree === 1 ? `<span class="deg-chip deg-1">${iconSvg("link", 11)}1st</span>` : "") +
              stateDot(p.branch, p.branchLabel ?? undefined) +
              ownerTag({ ownerName: p.owner }) +
              iconSvg("chevronR", 13, "md-co-go") +
              `</a>`,
          )
          .join("") +
        `</div>`
      : emptyState({ icon: "users", message: "No tracked prospects at this company yet." }));

  const body = `<div class="dom-wrap company-detail" id="co-${escapeAttr(model.id)}">${head}${assignmentSection}${researchSection}${motionsSection}${prospectsSection}</div>`;

  return renderShell({
    title: `Exo — ${model.name}`,
    activeId: "prospects",
    sectionLabel: "Prospects",
    detailLabel: model.name,
    body,
    interactive: meta.interactive,
    detail: true,
    agentRuntime: meta.agentRuntime ?? null,
  });
}

/** @param {string} name */
function initialsOf(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** @param {string} status */
function mapState(status) {
  return status === "active" ? "active" : status === "paused" ? "paused" : status === "archived" ? "archived" : "draft";
}
