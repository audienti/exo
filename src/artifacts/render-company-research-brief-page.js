// @ts-check

import { renderCompanyResearchBrief } from "./render-company.js";
import { btn, escapeHtml, iconSvg, renderShell, stateDot } from "../lib/exo-ui-components.js";

const RESEARCH_BRIEF_CSS = `
.research-brief{max-width:980px;scroll-margin-top:18px}
.rb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}
.rb-meta{flex:1;min-width:0}
.rb-back{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-4);
  display:inline-flex;align-items:center;gap:5px;margin-bottom:9px}
.rb-back:hover{color:var(--text-2)}
.rb-kicker{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10px;font-weight:700;
  letter-spacing:.14em;color:var(--accent);margin-bottom:11px}
.rb-title{font-size:23px;font-weight:700;letter-spacing:-.02em;color:var(--text)}
.rb-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;flex:none}
.rb-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}
.rb-facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.rb-fact{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2);background:var(--bg-1);
  border:1px solid var(--border);border-radius:999px;padding:7px 10px}
.rb-card{background:var(--bg-1);border:1px solid var(--border);border-radius:13px;padding:14px 16px}
.rb-card h2{font-size:13px;font-weight:700;margin-bottom:8px}
.rb-card p{margin:0;color:var(--text-2);font-size:12.5px;line-height:1.55}
.rb-details{background:var(--bg-1);border:1px solid var(--border);border-radius:13px;overflow:hidden;margin-top:18px}
.rb-details-head{padding:13px 16px;font-size:12.5px;font-weight:700;border-bottom:1px solid var(--border)}
.rb-pre{padding:16px 18px;overflow:auto;white-space:pre-wrap;font-family:var(--mono);font-size:11.5px;line-height:1.6;color:var(--text-2)}
`;

/**
 * @param {{
 *   brief: ReturnType<import("../core/build-company-research-brief.js").buildCompanyResearchBrief>,
 *   packet?: {
 *     claimState?: "claimable" | "claimed" | null,
 *     queueStatus?: string | null,
 *     workerLabel?: string | null
 *   } | null,
 *   interactive?: boolean
 * }} input
 */
export function renderCompanyResearchBriefPage(input) {
  const { brief } = input;
  const packet = input.packet ?? null;
  const briefText = renderCompanyResearchBrief(brief);
  const companyHref = `/companies/${encodeURIComponent(brief.company.id)}`;
  const motionHref = `/motions/${encodeURIComponent(brief.motion.id)}`;
  const queueHref = "/queue";
  const canQueue = packet?.claimState === "claimable";
  const queued = packet?.claimState === "claimed";
  const status = queued
    ? stateDot("waiting", `Queued for agent${packet?.workerLabel ? ` · ${packet.workerLabel}` : ""}`)
    : canQueue
      ? stateDot("identified", "Agent queue ready")
      : stateDot("ready", "Research complete");

  const body =
    `<div class="dom-wrap research-brief">` +
    `<div class="rb-head">` +
    `<div class="rb-meta">` +
    `<a class="rb-back" href="${companyHref}">${iconSvg("chevronR", 12)}Back to company</a>` +
    `<div class="rb-kicker">${iconSvg("flag", 13)} COMPANY RESEARCH BRIEF</div>` +
    `<h1 class="rb-title">${escapeHtml(brief.company.name)}</h1>` +
    `<div class="rb-status">${status}</div>` +
    `<div class="rb-facts">` +
    renderFactChip("Motion", brief.motion.name) +
    renderFactChip("Domain", brief.company.domain ?? null) +
    renderFactChip("Website", brief.company.websiteUrl ?? null) +
    `</div>` +
    `</div>` +
    `<div class="rb-actions">` +
    ((canQueue || queued)
      ? btn({ variant: "primary", icon: "cpu", label: "Open queue", href: queueHref })
      : "") +
    btn({ variant: "secondary", icon: "building", label: "Open company", href: companyHref }) +
    btn({ variant: "ghost", icon: "layers", label: "Open motion", href: motionHref }) +
    `</div>` +
    `</div>` +
    `<div class="rb-card">` +
    `<h2>Premise</h2>` +
    `<p>${escapeHtml(brief.motion.premise ?? "No premise stored.")}</p>` +
    `</div>` +
    `<div class="rb-details">` +
    `<div class="rb-details-head">Brief details</div>` +
    `<div class="rb-pre">${escapeHtml(briefText)}</div>` +
    `</div>` +
    `</div>`;

  return renderShell({
    title: `Exo — ${brief.company.name} Research Brief`,
    activeId: "motions",
    sectionLabel: "Motions",
    detailLabel: `${brief.company.name} research`,
    body,
    extraCss: RESEARCH_BRIEF_CSS,
    interactive: input.interactive,
    detail: true,
    agentRuntime: input.agentRuntime ?? null,
  });
}

/**
 * @param {string} label
 * @param {string | null | undefined} value
 */
function renderFactChip(label, value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return "";
  }
  return `<span class="rb-fact"><b>${escapeHtml(label)}:</b><span>${escapeHtml(normalized)}</span></span>`;
}
