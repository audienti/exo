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
          `<p class="motion-intake-helper">Exo created the user, but it still needs a governed managed account path before the live workspace means anything.</p>` +
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

  return (
    `<section class="op-sec onboarding-sec">` +
    sectionHead({ icon: "check", title: "Ready", sub: "The workspace now has an execution-capable user." }) +
    card({
      className: "onboarding-option",
      children:
        `<div class="onboarding-option-top">` +
        `<div>` +
        `<div class="compose-label">Onboarding complete</div>` +
        `<p class="motion-intake-helper">Exo can now serve the live operator workspace instead of the bootstrap flow.</p>` +
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

const ONBOARDING_CSS = `
.onboarding-feed{gap:18px}
.onboarding-intro{align-items:flex-start}
.onboarding-progress{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:420px}
.onboarding-sec{display:flex;flex-direction:column;gap:14px}
.onboarding-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.onboarding-option,.onboarding-current{display:flex;flex-direction:column;gap:12px}
.onboarding-option-top{display:flex;gap:16px;justify-content:space-between;align-items:flex-start}
.onboarding-meta-label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.onboarding-path{display:flex;justify-content:space-between;gap:12px;align-items:center;font-size:13px;color:var(--ink-2)}
.onboarding-path span{color:var(--ink-3);text-transform:uppercase;letter-spacing:.08em;font-size:11px}
.onboarding-path code{font-family:var(--font-mono);font-size:12px;background:var(--bg-2);padding:4px 8px;border-radius:10px;overflow-wrap:anywhere}
.onboarding-form{display:flex;flex-direction:column;gap:14px}
.onboarding-list-row{display:flex;flex-direction:column;gap:4px;padding:10px 0;border-top:1px solid var(--line)}
.onboarding-list-row:first-of-type{border-top:0;padding-top:0}
.onboarding-next .nm-sub{margin-top:8px}
`;
