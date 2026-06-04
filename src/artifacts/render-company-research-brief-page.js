// @ts-check

import { renderCompanyResearchBrief } from "./render-company.js";
import { btn, emptyState, escapeHtml, iconSvg, renderShell, stateDot } from "../lib/exo-ui-components.js";

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
.rb-sub{font-size:13px;color:var(--text-2);margin-top:4px;max-width:780px;line-height:1.55}
.rb-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;flex:none}
.rb-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}
.rb-callout{display:flex;align-items:flex-start;gap:9px;font-size:12.5px;line-height:1.55;color:var(--text-2);
  background:color-mix(in srgb,var(--accent) 8%,var(--bg-2));border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);
  border-left:2px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:10px;padding:12px 14px;margin-bottom:16px}
.rb-callout .ic{color:var(--accent);flex:none;margin-top:1px}
.rb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-bottom:18px}
.rb-card{background:var(--bg-1);border:1px solid var(--border);border-radius:13px;padding:14px 16px}
.rb-card h2{font-size:13px;font-weight:700;margin-bottom:8px}
.rb-card ul{margin:0;padding-left:18px;color:var(--text-2);font-size:12.5px;line-height:1.55}
.rb-card li+li{margin-top:6px}
.rb-details{background:var(--bg-1);border:1px solid var(--border);border-radius:13px;overflow:hidden}
.rb-details summary{cursor:pointer;list-style:none;padding:13px 16px;font-size:12.5px;font-weight:700}
.rb-details summary::-webkit-details-marker{display:none}
.rb-details summary:hover{background:var(--bg-2)}
.rb-details[open] summary{border-bottom:1px solid var(--border)}
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
  const callout = queued || canQueue
    ? "This company-research packet runs from Agent queue. You should not have to claim it manually."
    : "This account is no longer waiting at the company-research stage.";
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
    `<p class="rb-sub">This is the governed company-research packet for ${escapeHtml(brief.company.name)} inside ${escapeHtml(brief.motion.name)}. The agent uses this brief while it works the account.</p>` +
    `<div class="rb-status">${status}</div>` +
    `</div>` +
    `<div class="rb-actions">` +
    ((canQueue || queued)
      ? btn({ variant: "primary", icon: "cpu", label: "Open queue", href: queueHref })
      : "") +
    btn({ variant: "secondary", icon: "building", label: "Open company", href: companyHref }) +
    btn({ variant: "ghost", icon: "layers", label: "Open motion", href: motionHref }) +
    `</div>` +
    `</div>` +
    `<div class="rb-callout">${iconSvg("arrowR", 14)}<span>${escapeHtml(callout)}</span></div>` +
    `<div class="rb-grid">` +
    renderListCard("What the agent checks", brief.researchPath.slice(0, 3)) +
    renderListCard("What gets written back", [
      "Canonical website and LinkedIn company page if they need correction.",
      "Only the strongest recent company-level signal matches.",
      "Enough context to move this company into prospect selection.",
    ]) +
    renderListCard("When this is done", brief.completionCriteria.slice(0, 3)) +
    `</div>` +
    `<details class="rb-details"><summary>View governed brief details</summary><div class="rb-pre">${escapeHtml(briefText)}</div></details>` +
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
 * @param {string} title
 * @param {string[]} items
 */
function renderListCard(title, items) {
  if (!items.length) {
    return `<div class="rb-card"><h2>${escapeHtml(title)}</h2>${emptyState({ icon: "flag", message: "Nothing queued here yet." })}</div>`;
  }
  return (
    `<div class="rb-card">` +
    `<h2>${escapeHtml(title)}</h2>` +
    `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` +
    `</div>`
  );
}
