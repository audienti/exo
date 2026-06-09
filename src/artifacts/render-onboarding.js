// @ts-check

import {
  btn,
  card,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  liveActionBtn,
  renderShell,
  sectionHead,
  stateDot,
} from "../lib/exo-ui-components.js";

const UNIPILE_HOME_URL = "https://www.unipile.com/";
const UNIPILE_DOCS_URL = "https://developer.unipile.com/docs/getting-started";
const HUBSPOT_CRM_URL = "https://www.hubspot.com/products/crm";
const CHATGPT_PRICING_URL = "https://chatgpt.com/pricing/";

/**
 * @param {ReturnType<import("../core/onboarding.js").buildOnboardingState>} onboarding
 * @param {{ interactive?: boolean }} [meta]
 */
export function renderOnboardingPage(onboarding, meta = {}) {
  const body =
    `<div class="op-wrap feed onboarding-feed">` +
    renderIntro(onboarding) +
    renderScopeSection(onboarding) +
    renderUserSection(onboarding) +
    renderMotionSection(onboarding) +
    renderRequirementsSection(onboarding) +
    renderDiscoverySection(onboarding) +
    `</div>`;

  return renderShell({
    title: "Exo - Onboarding",
    activeId: "users",
    sectionLabel: "Onboarding",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    extraCss: ONBOARDING_CSS,
  });
}

/**
 * @param {ReturnType<import("../core/onboarding.js").buildOnboardingState>} onboarding
 */
function renderIntro(onboarding) {
  const chips = [
    stateDot(onboarding.progress.installScopeChosen ? "ready" : "draft", onboarding.progress.installScopeChosen ? "scope chosen" : "pick scope"),
    stateDot(onboarding.progress.executionUserChosen ? "ready" : "draft", onboarding.progress.executionUserChosen ? "user set" : "name user"),
    stateDot(onboarding.progress.executionAccountMapped ? "ready" : "waiting", onboarding.progress.executionAccountMapped ? "managed account ready" : "map account"),
    stateDot(onboarding.progress.firstMotionDefined ? "ready" : onboarding.progress.executionAccountMapped ? "waiting" : "draft", onboarding.progress.firstMotionDefined ? "motion ready" : "define motion"),
  ].join("");

  return (
    `<div class="op-intro onboarding-intro">` +
    `<div>` +
    `<h1>Onboarding</h1>` +
    `<p class="op-line">${escapeHtml(onboarding.next.reason)}</p>` +
    `</div>` +
    `<div class="onboarding-progress">${chips}</div>` +
    `</div>` +
    card({
      stakes: "high",
      className: "next-move onboarding-next",
      children:
        `<div class="nm-flag">${iconSvg("flag", 13)} NEXT STEP</div>` +
        `<div class="onboarding-next-body">` +
        `<div class="nm-title">${escapeHtml(onboarding.next.headline)}</div>` +
        `<div class="nm-sub">${escapeHtml(onboarding.next.prompt)}</div>` +
        `</div>`,
    })
  );
}

/**
 * @param {ReturnType<import("../core/onboarding.js").buildOnboardingState>} onboarding
 */
function renderScopeSection(onboarding) {
  const current = card({
    className: "onboarding-current",
    children:
      `<div class="onboarding-meta-label">Current store layout</div>` +
      `<div class="onboarding-path"><span>Local</span><code>${escapeHtml(onboarding.install.localStateDir)}</code></div>` +
      `<div class="onboarding-path"><span>Home</span><code>${escapeHtml(onboarding.install.homeStateDir)}</code></div>` +
      `<div class="onboarding-path"><span>Source</span><code>${escapeHtml(onboarding.install.source)}</code></div>`,
  });

  if (!onboarding.install.question) {
    return (
      `<section class="op-sec onboarding-sec">` +
      sectionHead({ icon: "layers", title: "Install scope", sub: onboarding.install.choice ?? "configured" }) +
      current +
      card({
        className: "onboarding-current",
        children:
          `<div class="compose-label">Other install mode</div>` +
          `<p class="motion-intake-helper">This workspace is currently in <code>${escapeHtml(onboarding.install.choice ?? "configured")}</code>. If you want layered storage instead, switch to <code>${escapeHtml(onboarding.install.choice === "global-install" ? "local-folder" : "global-install")}</code> with <code>exo onboarding --scope ${escapeHtml(onboarding.install.choice === "global-install" ? "local-folder" : "global-install")} --apply --json</code>.</p>`,
      }) +
      `</section>`
    );
  }

  const options = onboarding.install.question.options.map((option) =>
    card({
      className: "onboarding-option",
      children:
        `<div class="onboarding-option-top">` +
        `<div>` +
        `<div class="compose-label">${escapeHtml(option.label)}</div>` +
        `<p class="motion-intake-helper">${escapeHtml(option.description)}</p>` +
        `</div>` +
        liveActionBtn({
          writer: "setWorkspaceInstallScope",
          args: { scope: option.value },
          variant: option.value === "local-folder" ? "secondary" : "primary",
          size: "sm",
          icon: option.value === "local-folder" ? "home" : "layers",
          label: option.value === "local-folder" ? "Use local folder" : "Use global install",
        }) +
        `</div>` +
        `<div class="onboarding-path"><span>Local</span><code>${escapeHtml(option.localStateDir)}</code></div>` +
        `<div class="onboarding-path"><span>Home</span><code>${escapeHtml(option.homeStateDir)}</code></div>`,
    })
  ).join("");

  return (
    `<section class="op-sec onboarding-sec">` +
    sectionHead({ icon: "layers", title: "Install scope", sub: onboarding.install.question.prompt }) +
    current +
    `<div class="onboarding-grid">${options}</div>` +
    `</section>`
  );
}

/**
 * @param {ReturnType<import("../core/onboarding.js").buildOnboardingState>} onboarding
 */
function renderUserSection(onboarding) {
  if (onboarding.status === "needs-scope") {
    return "";
  }

  if (onboarding.status === "needs-user") {
    return (
      `<section class="op-sec onboarding-sec">` +
      sectionHead({ icon: "userPlus", title: "First outreach user", sub: "Create the first governed execution identity." }) +
      `<div class="exo-action onboarding-form" data-exo-writer="completeOnboardingUser" data-exo-args="${escapeAttr(JSON.stringify({ runtime: "codex" }))}" data-exo-fields="label:label">` +
      `<label class="compose-field motion-intake-field">` +
      `<span class="compose-label">User label</span>` +
      `<p class="motion-intake-helper">${escapeHtml(onboarding.user.nextQuestion?.prompt ?? "Who is the first user we're managing in Exo?")}</p>` +
      `<input class="compose-input" type="text" name="label" placeholder="william-main" autocomplete="off" />` +
      `</label>` +
      `<div class="compose-actions motion-intake-actions">` +
      `<button class="btn btn-primary btn-sm" type="button"><span>Create user and map accounts</span></button>` +
      `</div>` +
      `</div>` +
      `</section>`
    );
  }

  if (onboarding.status === "needs-account-mapping") {
    const focusUser = onboarding.user.focusUser;
    return (
      `<section class="op-sec onboarding-sec">` +
      sectionHead({ icon: "link", title: "Managed account mapping", sub: focusUser ? `Continue onboarding for ${focusUser.label}.` : "Continue onboarding." }) +
      card({
        className: "onboarding-option",
        children:
          `<div class="onboarding-option-top">` +
          `<div>` +
          `<div class="compose-label">${escapeHtml(focusUser?.label ?? "Execution user")}</div>` +
          `<p class="motion-intake-helper">Exo created the user, but it still needs one managed account before launch. Chrome or stored profile clues do not clear this step.</p>` +
          `</div>` +
          liveActionBtn({
            writer: "completeOnboardingUser",
            args: { userId: focusUser?.id ?? null, runtime: "codex" },
            variant: "primary",
            size: "sm",
            icon: "refresh",
            label: "Try mapping managed accounts",
          }) +
          `</div>` +
          `<div class="onboarding-path"><span>Accounts</span><code>${escapeHtml(String(focusUser?.accountCount ?? 0))}</code></div>`,
      }) +
      `</section>`
    );
  }

  return "";
}

/**
 * @param {ReturnType<import("../core/onboarding.js").buildOnboardingState>} onboarding
 */
function renderMotionSection(onboarding) {
  if (onboarding.status === "needs-scope" || onboarding.status === "needs-user" || onboarding.status === "needs-account-mapping") {
    return "";
  }

  if (onboarding.status === "needs-motion") {
    const focusUser = onboarding.user.focusUser;
    return (
      `<section class="op-sec onboarding-sec">` +
      sectionHead({ icon: "spark", title: "First motion", sub: focusUser ? `Define the first governed motion for ${focusUser.label}.` : "Define the first governed motion." }) +
      `<div class="onboarding-grid">` +
      card({
        className: "onboarding-option",
        children:
          `<div class="compose-label">Motion concepts</div>` +
          `<div class="onboarding-list-row"><b>Offer</b><span>${escapeHtml(onboarding.motion.intake.definitions.find((entry) => entry.key === "offer")?.body ?? "")}</span></div>` +
          `<div class="onboarding-list-row"><b>Premise</b><span>${escapeHtml(onboarding.motion.intake.definitions.find((entry) => entry.key === "premise")?.body ?? "")}</span></div>` +
          `<div class="onboarding-list-row"><b>Signals</b><span>${escapeHtml(onboarding.motion.intake.definitions.find((entry) => entry.key === "signals")?.body ?? "")}</span></div>`,
      }) +
      `<div class="exo-action onboarding-form" data-exo-writer="startMotionFromIntake" data-exo-args="${escapeAttr(JSON.stringify({
        userId: focusUser?.id ?? null,
        kickoffAgentPass: true,
        sendMode: "verify",
        redirectTo: "/operator",
      }))}" data-exo-fields="url:url,premise:premise,audience:audience,signal:signal">` +
      `<label class="compose-field motion-intake-field">` +
      `<span class="compose-label">Offer URL</span>` +
      `<p class="motion-intake-helper">${escapeHtml(onboarding.motion.intake.nextQuestion?.key === "url" ? onboarding.motion.intake.nextQuestion.prompt : "What are we promoting? Give me the offer URL first.")}</p>` +
      `<input class="compose-input" type="url" name="url" placeholder="https://example.com/offer" autocomplete="off" />` +
      `</label>` +
      `<label class="compose-field motion-intake-field">` +
      `<span class="compose-label">Premise</span>` +
      `<p class="motion-intake-helper">${escapeHtml(onboarding.motion.intake.definitions.find((entry) => entry.key === "premise")?.body ?? "")}</p>` +
      `<textarea class="compose-body motion-intake-textarea" name="premise" placeholder="This offer matters when ..."></textarea>` +
      `</label>` +
      `<label class="compose-field motion-intake-field">` +
      `<span class="compose-label">Primary audience</span>` +
      `<p class="motion-intake-helper">Who should care first? Name the primary audience or ICP you want to target.</p>` +
      `<input class="compose-input" type="text" name="audience" placeholder="Primary ICP or audience" autocomplete="off" />` +
      `</label>` +
      `<label class="compose-field motion-intake-field">` +
      `<span class="compose-label">Signal questions</span>` +
      `<p class="motion-intake-helper">${escapeHtml(onboarding.motion.intake.definitions.find((entry) => entry.key === "signals")?.body ?? "")} Enter one question per line.</p>` +
      `<textarea class="compose-body motion-intake-textarea motion-intake-textarea-signals" name="signal" placeholder="company::Is there recent evidence the team widened GTM scope?&#10;company::Is there recent evidence the team is adding outbound capacity?"></textarea>` +
      `</label>` +
      `<div class="compose-actions motion-intake-actions">` +
      `<button class="btn btn-primary btn-sm" type="button"><span>Start first pass in review only</span></button>` +
      `</div>` +
      `</div>` +
      `</div>` +
      `</section>`
    );
  }

  return (
    `<section class="op-sec onboarding-sec">` +
    sectionHead({ icon: "check", title: "Ready", sub: "The workspace now has an execution-capable user and a governed motion." }) +
    card({
      className: "onboarding-option",
      children:
        `<div class="onboarding-option-top">` +
        `<div>` +
        `<div class="compose-label">Onboarding complete</div>` +
        `<p class="motion-intake-helper">Exo can now serve the live operator workspace. Missing LinkedIn, Gmail, or HubSpot accounts still block those exact capabilities.</p>` +
        `</div>` +
        btn({
          variant: "primary",
          size: "sm",
          icon: "arrowR",
          label: "Open operator workspace",
          href: "/operator",
        }) +
        `</div>`,
    }) +
    `</section>`
  );
}

/**
 * @param {ReturnType<import("../core/onboarding.js").buildOnboardingState>} onboarding
 */
function renderRequirementsSection(onboarding) {
  const runtimeConnectors = new Set(
    onboarding.user.discoveredSources.runtimeConnectors.map((entry) => String(entry.connector).trim().toLowerCase()),
  );
  const managedCapabilities = new Set(onboarding.user.focusUser?.managedCapabilities ?? []);
  const hasManagedAccount = onboarding.progress.executionAccountMapped;
  const hasManagedLinkedin = managedCapabilities.has("linkedin");
  const hasManagedGmail = managedCapabilities.has("gmail");
  const hasManagedHubspot = managedCapabilities.has("hubspot");
  const hasUnipile = runtimeConnectors.has("unipile");
  const hasGmailConnector = runtimeConnectors.has("gmail") || runtimeConnectors.has("unipile");
  const hasHubspotConnector = runtimeConnectors.has("hubspot");
  const canClearOnboarding = hasUnipile || hasGmailConnector || hasHubspotConnector;

  const launchGateCard = renderGuidanceCard({
    label: "Launch gate",
    tone: hasManagedAccount ? "ready" : "waiting",
    toneLabel: hasManagedAccount ? "clear" : "required",
    helper: hasManagedAccount
      ? "One managed account is mapped. Exo can open the operator workspace now."
      : canClearOnboarding
        ? "Map one managed account onto the execution user. Gmail, HubSpot, or Unipile can clear onboarding. Chrome or stored profile clues do not."
        : "Exo needs one managed account before launch. Connect a managed service first, then map one exact account.",
    points: hasManagedAccount
      ? [
          "The workspace can leave onboarding.",
          hasManagedLinkedin
            ? "LinkedIn has a governed account path."
            : "LinkedIn work still needs one governed account. Chrome alone does not count.",
          hasManagedGmail
            ? "Gmail has a governed account path."
            : "Gmail truth stays off until a mailbox is mapped.",
        ]
      : [
          "Without a managed account, Exo stays in onboarding.",
          "You can still choose install scope, create the user, and author motion state.",
          "The operator workspace does not become a governed live surface yet.",
        ],
  });

  const linkedinCard = renderGuidanceCard({
    label: "LinkedIn",
    tone: hasManagedLinkedin ? "ready" : hasUnipile ? "waiting" : "draft",
    toneLabel: hasManagedLinkedin ? "mapped" : hasUnipile ? "recommended" : "missing",
    helper: hasManagedLinkedin
      ? "A governed LinkedIn account is mapped."
      : hasUnipile
        ? "Unipile is visible in this runtime, but no governed LinkedIn account is mapped yet."
        : "Add Unipile if you want governed LinkedIn execution.",
    points: hasManagedLinkedin
      ? [
          "Exo can resolve one exact LinkedIn account before launch.",
          "Browser state can still be transport. It is not the governed identity.",
          "LinkedIn launch is no longer blocked on account mapping.",
        ]
      : hasUnipile
        ? [
            "Exo can still store motions, companies, and local research while account mapping is incomplete.",
            "LinkedIn launch stays blocked until one exact LinkedIn account is mapped.",
            "Map the exact LinkedIn account you want Exo to govern before launch.",
          ]
        : [
            "Exo can still store motions, companies, and local research without LinkedIn wired in.",
            "LinkedIn launch stays blocked because Chrome or stored profiles do not count as governed accounts.",
            "Add Unipile, then map one exact LinkedIn account before launch.",
          ],
    actions: [
      btn({ variant: "secondary", size: "sm", icon: "link", label: "Unipile", href: UNIPILE_HOME_URL }),
      btn({ variant: "ghost", size: "sm", icon: "link", label: "Getting started", href: UNIPILE_DOCS_URL }),
    ],
  });

  const gmailCard = renderGuidanceCard({
    label: "Gmail",
    tone: hasManagedGmail ? "ready" : hasGmailConnector ? "waiting" : "draft",
    toneLabel: hasManagedGmail ? "mapped" : hasGmailConnector ? "available" : "optional",
    helper: hasManagedGmail
      ? "A governed Gmail account is mapped."
      : hasGmailConnector
        ? "A Gmail path is visible in this runtime, but no mailbox is mapped yet."
        : "Connect the Gmail app in Codex if you want live inbox truth.",
    points: hasManagedGmail
      ? [
          "Exo can use live inbox truth and email-backed writeback.",
          "Email work can land in the same governed loop as motion state.",
          "Skipping Unipile does not break Gmail if a mailbox is mapped here.",
        ]
      : [
          "Without Gmail, Exo can still plan motions and store notes.",
          "Gmail live inbox sync and email-backed writeback stay unavailable.",
          "A Gmail mapping can clear onboarding even if LinkedIn is still missing.",
        ],
  });

  const hubspotCard = renderGuidanceCard({
    label: "HubSpot",
    tone: hasManagedHubspot ? "ready" : hasHubspotConnector ? "waiting" : "draft",
    toneLabel: hasManagedHubspot ? "mapped" : hasHubspotConnector ? "available" : "optional",
    helper: hasManagedHubspot
      ? "HubSpot is mapped."
      : hasHubspotConnector
        ? "HubSpot is visible in this runtime. It is optional."
        : "HubSpot is optional.",
    points: hasManagedHubspot
      ? [
          "Exo can use CRM context and governed writeback in the same path.",
          "This does not replace Gmail or LinkedIn. It adds CRM context.",
          "Missing HubSpot does not block launch once another managed account is mapped.",
        ]
      : [
          "Skip it if you only need motion setup and messaging.",
          "Add it if you want CRM context and writeback in Exo.",
          "HubSpot by itself is not required for the first live launch.",
        ],
    actions: [
      btn({ variant: "ghost", size: "sm", icon: "link", label: "HubSpot CRM", href: HUBSPOT_CRM_URL }),
    ],
  });

  const runtimeCapacityCard = renderGuidanceCard({
    label: "ChatGPT plan",
    tone: "waiting",
    toneLabel: "recommended",
    helper: "ChatGPT runtime capacity matters. Exo can look broken when the underlying ChatGPT plan has hit its rate limits.",
    points: [
      "Exo cannot verify the operator's ChatGPT plan automatically from this workspace.",
      "Free and Go plans will usually hit limits quickly during setup or sustained operator use.",
      "Plus can work for lighter use, but Pro is the recommended plan for sustained Exo operation.",
      "If the runtime stops mid-flow, check ChatGPT plan limits before debugging Exo.",
    ],
    actions: [
      btn({ variant: "ghost", size: "sm", icon: "link", label: "ChatGPT pricing", href: CHATGPT_PRICING_URL }),
    ],
  });

  return (
    `<section class="op-sec onboarding-sec">` +
    sectionHead({ icon: "flag", title: "Before launch", sub: "What Exo needs, what still works, and what stays blocked." }) +
    `<div class="onboarding-grid">${launchGateCard}${linkedinCard}${gmailCard}${hubspotCard}${runtimeCapacityCard}</div>` +
    `</section>`
  );
}

/**
 * @param {ReturnType<import("../core/onboarding.js").buildOnboardingState>} onboarding
 */
function renderDiscoverySection(onboarding) {
  const runtimeRows = onboarding.user.discoveredSources.runtimeConnectors.map((entry) =>
    `<div class="onboarding-list-row"><b>${escapeHtml(`${entry.runtime}:${entry.connector}`)}</b><span>${escapeHtml(entry.reason)}</span></div>`
  ).join("");
  const profileRows = onboarding.user.discoveredSources.profileAccounts.map((entry) =>
    `<div class="onboarding-list-row"><b>${escapeHtml(`${entry.capability}:${entry.handle}`)}</b><span>${escapeHtml(`from ${entry.profileLabel}`)}</span></div>`
  ).join("");

  return (
    `<section class="op-sec onboarding-sec">` +
    sectionHead({ icon: "eye", title: "What Exo can already see", sub: "Cheap discovery only. No live send path is assumed until a managed account is mapped." }) +
    `<div class="onboarding-grid">` +
    card({
      className: "onboarding-option",
      children:
        `<div class="compose-label">Runtime connectors</div>` +
        (runtimeRows || emptyState({ icon: "cpu", message: "No callable runtime connectors were discovered yet." })),
    }) +
    card({
      className: "onboarding-option",
      children:
        `<div class="compose-label">Stored profile clues</div>` +
        (profileRows || emptyState({ icon: "users", message: "No stored profile identities were discovered in local Exo state." })),
    }) +
    `</div>` +
    `</section>`
  );
}

/**
 * @param {{
 *   label: string,
 *   tone: "ready" | "waiting" | "draft",
 *   toneLabel: string,
 *   helper: string,
 *   points: string[],
 *   actions?: string[] | null,
 * }} opts
 */
function renderGuidanceCard(opts) {
  const actions = Array.isArray(opts.actions) && opts.actions.length
    ? `<div class="onboarding-actions">${opts.actions.join("")}</div>`
    : "";

  return card({
    className: "onboarding-option",
    children:
      `<div class="onboarding-card-status">` +
      `<div class="compose-label">${escapeHtml(opts.label)}</div>` +
      stateDot(opts.tone, opts.toneLabel) +
      `</div>` +
      `<p class="motion-intake-helper">${escapeHtml(opts.helper)}</p>` +
      `<ul class="onboarding-points">${opts.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` +
      actions,
  });
}

const ONBOARDING_CSS = `
.onboarding-feed{gap:18px}
.onboarding-intro{align-items:flex-start}
.onboarding-progress{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:420px}
.onboarding-sec{display:flex;flex-direction:column;gap:14px}
.onboarding-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.onboarding-option,.onboarding-current{display:flex;flex-direction:column;gap:12px}
.onboarding-card-status{display:flex;gap:12px;justify-content:space-between;align-items:center}
.onboarding-option-top{display:flex;gap:16px;justify-content:space-between;align-items:flex-start}
.onboarding-meta-label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.onboarding-path{display:flex;justify-content:space-between;gap:12px;align-items:center;font-size:13px;color:var(--ink-2)}
.onboarding-path span{color:var(--ink-3);text-transform:uppercase;letter-spacing:.08em;font-size:11px}
.onboarding-path code{font-family:var(--font-mono);font-size:12px;background:var(--bg-2);padding:4px 8px;border-radius:10px;overflow-wrap:anywhere}
.onboarding-form{display:flex;flex-direction:column;gap:14px}
.onboarding-points{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px;color:var(--ink-2)}
.onboarding-actions{display:flex;gap:8px;flex-wrap:wrap}
.onboarding-list-row{display:flex;flex-direction:column;gap:4px;padding:10px 0;border-top:1px solid var(--line)}
.onboarding-list-row:first-of-type{border-top:0;padding-top:0}
.onboarding-next .nm-sub{margin-top:8px}
`;
