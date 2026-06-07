// @ts-check

import {
  countChip,
  escapeAttr,
  escapeHtml,
  iconSvg,
  renderShell,
  truthTag,
} from "../lib/exo-ui-components.js";

/**
 * @param {ReturnType<import("../core/build-settings-view.js").buildSettingsViewModel>} model
 * @param {{ generatedAt?: string, regenerateCommand?: string, interactive?: boolean, agentRuntime?: any }} [meta]
 */
export function renderSettingsPage(model, meta = {}) {
  const body =
    `<div class="dom-wrap settings-page" id="settings-top">` +
    renderIntro(model.workspacePolicy ?? null) +
    renderWorkspaceEnrichmentPolicy(model.workspacePolicy ?? null) +
    `</div>`;

  return renderShell({
    title: "Exo — Settings",
    activeId: "settings",
    sectionLabel: "Settings",
    body,
    interactive: meta.interactive,
    agentRuntime: meta.agentRuntime ?? null,
  });
}

/** @param {any | null} policy */
function renderIntro(policy) {
  const activeCount = activeProviderCount(policy);
  const runtimeLabel = policy?.runtime ? policy.runtime : "none";
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Settings</h1>` +
    `<p class="op-line">Choose which enrichment providers Exo can use for direct email, validation, and mobile numbers.</p>` +
    `</div>` +
    `<div class="op-stat"><span><b>${activeCount}</b> providers on</span><i></i><span><b>${escapeHtml(runtimeLabel)}</b> runtime</span></div>` +
    `</div>`
  );
}

/** @param {any | null} policy */
function renderWorkspaceEnrichmentPolicy(policy) {
  if (!policy) {
    return "";
  }

  const emailPanel = renderProviderLane("Direct email", "email", policy.emailProviders ?? []);
  const validationPanel = renderProviderLane("Validation", "validation", policy.validators ?? []);
  const phonePanel = renderProviderLane("Mobile numbers", "phone", policy.phoneProviders ?? []);
  const phoneRules = renderPhonePolicyRules(policy.phone ?? {});
  const runtimeNote = policy.runtime ? `Runtime probe: ${policy.runtime}` : "Runtime probe unavailable.";
  const settingsNote = policy.path
    ? `<div class="exec-policy-foot"><span>${escapeHtml(runtimeNote)}</span><code>${escapeHtml(policy.path)}</code></div>`
    : `<div class="exec-policy-foot"><span>${escapeHtml(runtimeNote)}</span></div>`;

  return (
    `<div class="exec-card exec-policy-card">` +
    `<div class="ws-panel-head">${iconSvg("sliders", 15)}<h3>Workspace enrichment</h3><span class="ws-head-right">${countChip(activeProviderCount(policy), "blue", "active")}</span></div>` +
    `<p class="exec-policy-lead">Owned data and public web still come first. These toggles decide which direct providers the agent can use after that.</p>` +
    `<div class="exec-policy-grid">${emailPanel}${validationPanel}${phonePanel}</div>` +
    phoneRules +
    settingsNote +
    `</div>`
  );
}

/**
 * @param {string} title
 * @param {"email" | "phone" | "validation"} lane
 * @param {Array<any>} providers
 */
function renderProviderLane(title, lane, providers) {
  return (
    `<section class="exec-policy-lane exec-policy-lane-${escapeAttr(lane)}">` +
    `<div class="exec-policy-head"><h4>${escapeHtml(title)}</h4><span>${providers.filter((provider) => provider.enabled).length}/${providers.length} on</span></div>` +
    `<div class="exec-policy-rows">` +
    providers.map((provider) => renderProviderRow(provider)).join("") +
    `</div>` +
    `</section>`
  );
}

/** @param {any} provider */
function renderProviderRow(provider) {
  return (
    `<div class="exec-policy-row">` +
    `<div class="exec-policy-meta">` +
    `<div class="exec-policy-title">${escapeHtml(provider.label)}</div>` +
    `<div class="exec-policy-sub" title="${escapeAttr(provider.reason ?? provider.description ?? "")}">${escapeHtml(provider.runtimeLabel ?? "runtime unprobed")}</div>` +
    `</div>` +
    `<div class="exec-policy-actions">` +
    truthTag(provider.truth) +
    actionBtn({
      writer: "toggleWorkspaceEnrichmentProvider",
      args: provider.toggleArgs,
      label: provider.enabled ? "Disable" : "Enable",
      icon: provider.enabled ? "x" : "check",
    }) +
    `</div>` +
    `</div>`
  );
}

/** @param {{ mobileOnly?: boolean, preferWhatsappCapable?: boolean }} phone */
function renderPhonePolicyRules(phone) {
  const mobileOnly = Boolean(phone.mobileOnly);
  const whatsapp = Boolean(phone.preferWhatsappCapable);
  return (
    `<div class="exec-policy-rules">` +
    renderPhonePolicyToggle({
      title: "Mobile only",
      description: "Keep only verified mobile numbers.",
      enabled: mobileOnly,
      args: { field: "mobileOnly", value: !mobileOnly },
    }) +
    renderPhonePolicyToggle({
      title: "Prefer WhatsApp-capable",
      description: "Prefer numbers that can carry a WhatsApp branch.",
      enabled: whatsapp,
      args: { field: "preferWhatsappCapable", value: !whatsapp },
    }) +
    `</div>`
  );
}

/**
 * @param {{ title: string, description: string, enabled: boolean, args: Record<string, any> }} opts
 */
function renderPhonePolicyToggle(opts) {
  return (
    `<div class="exec-policy-toggle">` +
    `<div class="exec-policy-meta">` +
    `<div class="exec-policy-title">${escapeHtml(opts.title)}</div>` +
    `<div class="exec-policy-sub">${escapeHtml(opts.description)}</div>` +
    `</div>` +
    `<div class="exec-policy-actions">` +
    actionBtn({
      writer: "setWorkspacePhoneEnrichmentPolicy",
      args: opts.args,
      label: opts.enabled ? "Turn off" : "Turn on",
      icon: opts.enabled ? "x" : "check",
    }) +
    `</div>` +
    `</div>`
  );
}

/** @param {any | null} policy */
function activeProviderCount(policy) {
  if (!policy) {
    return 0;
  }
  return [
    ...(policy.emailProviders ?? []),
    ...(policy.validators ?? []),
    ...(policy.phoneProviders ?? []),
  ].filter((provider) => provider.enabled).length;
}

/**
 * @param {{ writer: string, args: Record<string, any>, label: string, icon?: string }} opts
 */
function actionBtn(opts) {
  const inner =
    `<button class="btn btn-secondary btn-sm" type="button">` +
    (opts.icon ? iconSvg(opts.icon, 14) : "") +
    `<span>${escapeHtml(opts.label)}</span></button>`;
  return `<span class="exec-claim-host" data-exo-writer="${escapeAttr(opts.writer)}" data-exo-args="${escapeAttr(JSON.stringify(opts.args))}">${inner}</span>`;
}
