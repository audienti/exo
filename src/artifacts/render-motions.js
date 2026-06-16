// @ts-check
//
// Render the Motions surface (Exo UI Build Spec centerpiece) as static HTML.
//
// One self-contained page: a list of motion cards that anchor-link to each
// motion's full detail rendered below, in the strict spec order
// (offer → premise → signals → audiences → matches → plan).

import {
  avatar,
  btn,
  countChip,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  liveActionBtn,
  ownerTag,
  readinessBar,
  renderShell,
  scopeBadge,
  segTabs,
  stateDot,
  truthTag,
} from "../lib/exo-ui-components.js";
import { buildExactGmailPickerModel, renderExactGmailPicker } from "./render-assignment-controls.js";
import { MOTION_INTAKE_PROMPTS } from "../core/build-motion-intake.js";
import { isTransitionMotion } from "../core/ensure-transition-motion.js";
import {
  buildAccountDispositionActionIntent,
  buildPacketReviewActionIntent,
  buildProspectDispositionActionIntent,
} from "../core/build-action-intents.js";

/**
 * @param {{ motions: any[], details: any[] }} model
 * @param {{ user?: { label?: string, gmailOptions?: Array<{ ref?: string | null, handle?: string | null, label?: string | null }> | null } | null, generatedAt?: string, regenerateCommand?: string }} [meta]
 * @returns {string}
 */
export function renderMotionsPage(model, meta = {}) {
  // Interactive mode routes each motion to /motions/:id; static export keeps the
  // anchored detail sections so the file stays self-contained.
  const detailSections = meta.interactive
    ? ""
    : model.details.map((detail) => renderDetail(detail, meta)).join("");

  const body =
    `<div class="dom-wrap" id="motions-top">` +
    renderIntro(model, meta) +
    renderList(model.motions, meta) +
    detailSections +
    (meta.interactive ? renderMotionIntakePanel(model, meta) : "") +
    renderFooter(meta) +
    `</div>`;

  return renderShell({
    title: `Exo — Motions${meta.user?.label ? ` · ${meta.user.label}` : ""}`,
    activeId: "motions",
    sectionLabel: "Motions",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    agentRuntime: meta.agentRuntime ?? null,
    extraJs: meta.interactive ? renderMotionIntakeScript() : "",
  });
}

/**
 * Render one motion as its own routed detail page (interactive UI).
 *
 * @param {any} motion
 * @param {{ user?: { label?: string, gmailOptions?: Array<{ ref?: string | null, handle?: string | null, label?: string | null }> | null } | null, generatedAt?: string, regenerateCommand?: string, interactive?: boolean }} [meta]
 * @returns {string}
 */
export function renderMotionDetailPage(motion, meta = {}) {
  const body = `<div class="dom-wrap" id="motions-top">${renderOperationalDetail(motion, { ...meta, asPage: true })}</div>`;
  return renderShell({
    title: `Exo — ${motion.name}`,
    activeId: "motions",
    sectionLabel: "Motions",
    detailLabel: motion.name,
    body,
    interactive: meta.interactive,
    detail: true,
    agentRuntime: meta.agentRuntime ?? null,
  });
}

/**
 * Render the motion configuration/settings page (interactive UI).
 *
 * @param {any} motion
 * @param {{ user?: { id?: string | null, label?: string | null, gmailOptions?: Array<{ ref?: string | null, handle?: string | null, label?: string | null }> | null } | null, generatedAt?: string, regenerateCommand?: string, interactive?: boolean }} [meta]
 * @returns {string}
 */
export function renderMotionSettingsPage(motion, meta = {}) {
  const body = `<div class="dom-wrap" id="motion-settings-top">${renderSettingsDetail(motion, { ...meta, asPage: true, settingsPage: true })}</div>`;
  return renderShell({
    title: `Exo — ${motion.name} settings`,
    activeId: "motions",
    sectionLabel: "Motions",
    detailLabel: `${motion.name} settings`,
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
function motionDetailHref(id, meta) {
  return meta.interactive ? `/motions/${encodeURIComponent(id)}` : `#m-${id}`;
}

/**
 * @param {string} id
 * @param {{ interactive?: boolean }} meta
 */
function prospectHref(id, meta) {
  return meta.interactive ? `/prospects/${encodeURIComponent(id)}` : `../prospects.html#p-${id}`;
}

/**
 * @param {string} id
 * @param {{ interactive?: boolean }} meta
 */
function companyHref(id, meta) {
  return meta.interactive ? `/companies/${encodeURIComponent(id)}` : `#co-${id}`;
}

/**
 * @param {string} companyId
 * @param {string} motionId
 * @param {{ interactive?: boolean }} meta
 */
function researchBriefHref(companyId, motionId, meta) {
  if (!meta.interactive) return null;
  return `/companies/${encodeURIComponent(companyId)}/research-brief/${encodeURIComponent(motionId)}`;
}

/**
 * @param {{ motions: any[] }} model
 * @param {{ interactive?: boolean }} [meta]
 */
function renderIntro(model, meta = {}) {
  const action = meta.interactive
    ? btn({ variant: "primary", size: "md", icon: "spark", label: "New motion", href: "#motion-new" })
    : "";
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Motions</h1>` +
    `<p class="op-line">Your active GTM motions. Open one to see its offer, premise, signals, matched evidence, and recent activity.</p>` +
    `</div>` +
    `<div class="op-intro-actions">` +
    `<div class="op-stat"><span><b>${model.motions.length}</b> motions</span></div>` +
    action +
    `</div>` +
    `</div>`
  );
}

/**
 * @param {{ motions: any[] }} model
 * @param {{ user?: { id?: string | null } | null, users?: Array<{ id: string, label: string }> }} [meta]
 */
function renderMotionIntakePanel(model, meta = {}) {
  const seed = {
    motions: model.motions.map((motion) => ({
      id: motion.id,
      name: motion.name,
      state: motion.state,
      sourceUrl: motion.sourceUrl ?? null,
      premiseStatus: motion.premiseStatus ?? "unchecked",
      audienceCount: motion.audienceCount ?? 0,
      signalCount: motion.signalCount ?? 0,
    })),
  };
  const users = meta.users ?? [];
  const currentUserId = meta.user?.id ?? null;

  return (
    `<div class="compose-panel" id="motion-new">` +
    `<a class="compose-backdrop" href="#motions-top" aria-label="Close"></a>` +
    `<div class="compose-sheet">` +
    `<div class="compose-head">${iconSvg("spark", 18)}` +
    `<div><div class="compose-title">New motion</div>` +
    `<div class="compose-sub">Create a real motion or open the transition backlog container for ongoing interface-driven relationships.</div></div>` +
    `<a class="compose-close" href="#motions-top" aria-label="Close">${iconSvg("x", 14)}</a>` +
    `</div>` +
    `<div class="motion-intake-card motion-intake-panel exo-action" data-motion-intake data-motion-intake-form data-exo-writer="startMotionFromIntake" data-exo-args="{}" data-exo-fields="mode:mode?,userId:userId?,url:url?,existingStrategy:existingStrategy?,sourceMotionId:sourceMotionId?,premise:premise?,audience:audience?,signal:signal?">` +
    `<div class="motion-intake-thread">` +
    renderMotionIntakeModeStep() +
    renderMotionIntakeUserStep(users, currentUserId) +
    renderMotionIntakeStep("url", "Offer URL", MOTION_INTAKE_PROMPTS.url, `<input class="compose-input" type="url" name="url" placeholder="https://example.com/offer" autocomplete="off" />`) +
    renderMotionIntakeStrategyStep() +
    renderMotionIntakeSourceStep() +
    renderMotionIntakeStep("premise", "Premise", MOTION_INTAKE_PROMPTS.premise, `<textarea class="compose-body motion-intake-textarea" name="premise" placeholder="This offer matters when ..."></textarea>`) +
    renderMotionIntakeStep("audience", "Primary audience", MOTION_INTAKE_PROMPTS.audience, `<input class="compose-input" type="text" name="audience" placeholder="Primary ICP or audience" autocomplete="off" />`) +
    renderMotionIntakeStep(
      "signal",
      "Signal questions",
      `${MOTION_INTAKE_PROMPTS.signals} Enter one question per line.`,
      `<textarea class="compose-body motion-intake-textarea motion-intake-textarea-signals" name="signal" placeholder="company::Is there recent evidence that the team widened GTM scope?&#10;company::Is there recent evidence that the team is adding outbound capacity?"></textarea>`,
    ) +
    `</div>` +
    `<input type="hidden" name="mode" value="motion" />` +
    `<input type="hidden" name="existingStrategy" value="" />` +
    `<input type="hidden" name="sourceMotionId" value="" />` +
    `<script type="application/json" data-motion-intake-seed>${serializeJsonScript(seed)}</script>` +
    `<div class="compose-actions motion-intake-actions">` +
    `<button class="btn btn-primary btn-sm motion-intake-submit" type="button" data-motion-intake-submit disabled><span>Start motion</span></button>` +
    `<a class="btn btn-ghost btn-sm" href="#motions-top">Cancel</a>` +
    `</div>` +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

/**
 * @param {string} key
 * @param {string} label
 * @param {string} prompt
 * @param {string} fieldHtml
 */
function renderMotionIntakeStep(key, label, prompt, fieldHtml) {
  return (
    `<section class="motion-intake-step" data-intake-step="${escapeAttr(key)}">` +
    `<label class="compose-field motion-intake-field">` +
    `<span class="compose-label">${escapeHtml(label)}</span>` +
    `<p class="motion-intake-helper">${escapeHtml(prompt)}</p>` +
    fieldHtml +
    `</label>` +
    `</section>`
  );
}

function renderMotionIntakeModeStep() {
  return (
    `<section class="motion-intake-step" data-intake-step="mode">` +
    `<div class="compose-field motion-intake-field">` +
    `<span class="compose-label">Work type</span>` +
    `<p class="motion-intake-helper">Decide whether this is a real offer-led motion or a holding container for ongoing interface-driven relationships.</p>` +
    `<div class="motion-intake-options">` +
    motionStrategyOption("motion", "Real motion", "Offer-led motion with premise, audience, and signal questions.") +
    motionStrategyOption("transition", "Transition backlog", "Container for existing ongoing relationships until you re-home them into a real motion.") +
    `</div>` +
    `</div>` +
    `</section>`
  );
}

/**
 * @param {Array<{ id: string, label: string }>} users
 * @param {string | null} currentUserId
 */
function renderMotionIntakeUserStep(users, currentUserId) {
  const options = users.length
    ? users
      .map((user) => {
        const selected = user.id === currentUserId ? " selected" : "";
        return `<option value="${escapeAttr(user.id)}"${selected}>${escapeHtml(user.label)}</option>`;
      })
      .join("")
    : `<option value="">No execution users available</option>`;
  const helper = users.length
    ? MOTION_INTAKE_PROMPTS.launchUser
    : "Add an execution user first. Exo cannot launch or open governed work without one.";

  return renderMotionIntakeStep(
    "user",
    "Launch user",
    helper,
    `<select class="compose-input motion-intake-select" name="userId">${options}</select>`,
  );
}

function renderMotionIntakeStrategyStep() {
  return (
    `<section class="motion-intake-step" data-intake-step="existing-strategy" hidden>` +
    `<div class="compose-field motion-intake-field">` +
    `<span class="compose-label">Existing motion</span>` +
    `<p class="motion-intake-helper">${escapeHtml(MOTION_INTAKE_PROMPTS.existingStrategy)}</p>` +
    `<div class="motion-intake-options">` +
    motionStrategyOption("continue", "Continue it", "Use the existing motion as the governed object.") +
    motionStrategyOption("clone", "Clone it", "Duplicate the existing motion into a new one.") +
    motionStrategyOption("new", "Start fresh", "Keep the URL and define a new motion from scratch.") +
    `</div>` +
    `</div>` +
    `</section>`
  );
}

function renderMotionIntakeSourceStep() {
  return (
    `<section class="motion-intake-step" data-intake-step="source-motion" hidden>` +
    `<div class="compose-field motion-intake-field">` +
    `<span class="compose-label">Source motion</span>` +
    `<p class="motion-intake-helper">${escapeHtml(MOTION_INTAKE_PROMPTS.sourceMotion)}</p>` +
    `<div class="motion-intake-options motion-intake-matches" data-intake-existing-list></div>` +
    `</div>` +
    `</section>`
  );
}

/**
 * @param {string} value
 * @param {string} label
 * @param {string} description
 */
function motionStrategyOption(value, label, description) {
  return (
    `<label class="motion-intake-option">` +
    `<input type="radio" name="${value === "motion" || value === "transition" ? "mode-choice" : "existing-strategy-choice"}" value="${escapeAttr(value)}"${value === "motion" ? " checked" : ""} />` +
    `<span>` +
    `<strong>${escapeHtml(label)}</strong>` +
    `<em>${escapeHtml(description)}</em>` +
    `</span>` +
    `</label>`
  );
}

/**
 * @param {unknown} value
 */
function serializeJsonScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * @param {any[]} motions
 * @param {{ interactive?: boolean, user?: { id?: string | null, label?: string | null } | null }} meta
 */
function renderList(motions, meta) {
  if (!motions.length) {
    return emptyState({ icon: "layers", message: "No motions yet — start one to begin targeting." });
  }
  return (
    `<div class="motion-cards">` +
    motions
      .map(
        (m) =>
          `<article class="motion-card">` +
          `<a class="mc-link" href="${escapeAttr(motionDetailHref(m.id, meta))}">` +
          `<div class="mc-top">${stateDot(m.state)}${truthTag(m.truth)}` +
          `<span class="mc-ready-tag">${escapeHtml(formatMotionStageBadge(m))}</span></div>` +
          `<div class="mc-name">${escapeHtml(m.name)}</div>` +
          // Offer — what this motion is for, in one line.
          (m.offerTitle
            ? `<div class="mc-offer"><span class="mc-cap">${iconSvg("spark", 10)}Offer</span><span class="mc-offer-t">${escapeHtml(m.offerTitle)}</span></div>`
            : "") +
          // Premise — the load-bearing claim, emphasized.
          `<div class="mc-premise">` +
          `<div class="mc-cap mc-cap-pr">${iconSvg("target", 10)}Premise${m.premise ? truthTag(m.premiseTruth) : ""}</div>` +
          `<p class="mc-premise-t">${escapeHtml(m.premise ?? "No premise authored yet.")}</p>` +
          `</div>` +
          renderMotionCardActivity(m.activity) +
          `<div class="mc-stats">` +
          `<span><b>${m.signalCount}</b> signals</span>` +
          `<span><b>${m.companyCount}</b> companies</span>` +
          `<span><b>${m.prospectCount}</b> prospects</span>` +
          `<span><b>${m.actionCount}</b> due</span>` +
          `</div>` +
          (m.blocker
            ? `<div class="mc-blk">${iconSvg("alert", 11)}${escapeHtml(m.blocker)}</div>`
            : `<div class="mc-go">Open ${iconSvg("chevronR", 12)}</div>`) +
          `</a>` +
          renderMotionCardActions(m, meta) +
          `</article>`,
      )
      .join("") +
    `</div>`
  );
}

/**
 * @param {any} motion
 * @param {{ interactive?: boolean, user?: { id?: string | null, label?: string | null } | null }} meta
 */
function renderMotionCardActions(motion, meta) {
  const currentUserId = meta.user?.id ?? null;
  const currentUserLabel = meta.user?.label ?? null;
  const assignAction = meta.interactive && motion.blockerKind === "launch-owner-unassigned" && currentUserId
    ? liveActionBtn({
        writer: "assignMotionUser",
        args: {
          motionId: motion.id,
          userId: currentUserId,
          reason: "Keep one execution identity for this motion",
        },
        variant: "primary",
        icon: "check",
        label: currentUserLabel ? `Assign ${currentUserLabel}` : "Assign current user",
        title: "Assign the current workspace user so this motion can launch through one governed execution identity.",
      })
    : "";
  const openAction = btn({
    variant: assignAction ? "ghost" : "secondary",
    size: "sm",
    icon: "layers",
    label: "Open motion",
    href: motionDetailHref(motion.id, meta),
  });
  return `<div class="mc-actions">${assignAction}${openAction}</div>`;
}

function renderMotionIntakeScript() {
  return `
(function(){
  var root = document.querySelector('[data-motion-intake]');
  if (!root) return;
  var seedEl = root.querySelector('[data-motion-intake-seed]');
  if (!seedEl) return;
  var seed = { motions: [] };
  try { seed = JSON.parse(seedEl.textContent || '{}'); } catch (_) { return; }

  var form = root.matches('[data-motion-intake-form]') ? root : root.querySelector('[data-motion-intake-form]');
  var submit = root.querySelector('[data-motion-intake-submit]');
  if (!form || !submit) return;

  var fields = {
    mode: form.querySelector('[name="mode"]'),
    userId: form.querySelector('[name="userId"]'),
    url: form.querySelector('[name="url"]'),
    premise: form.querySelector('[name="premise"]'),
    audience: form.querySelector('[name="audience"]'),
    signal: form.querySelector('[name="signal"]'),
    existingStrategy: form.querySelector('[name="existingStrategy"]'),
    sourceMotionId: form.querySelector('[name="sourceMotionId"]')
  };
  var modeRadios = Array.prototype.slice.call(root.querySelectorAll('input[name="mode-choice"]'));
  var strategyStep = root.querySelector('[data-intake-step="existing-strategy"]');
  var sourceStep = root.querySelector('[data-intake-step="source-motion"]');
  var sourceList = root.querySelector('[data-intake-existing-list]');
  var strategyRadios = Array.prototype.slice.call(root.querySelectorAll('input[name="existing-strategy-choice"]'));
  var orderedSteps = ['mode', 'user', 'url', 'existing-strategy', 'source-motion', 'premise', 'audience', 'signal'];

  function normalize(value) {
    return String(value || '').trim();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function matchesForUrl(url) {
    var value = normalize(url);
    if (!value) return [];
    return (seed.motions || []).filter(function(motion){
      return normalize(motion.sourceUrl) === value;
    });
  }

  function selectedStrategy() {
    var picked = strategyRadios.find(function(radio){ return radio.checked; });
    return picked ? picked.value : '';
  }

  function selectedMode() {
    var picked = modeRadios.find(function(radio){ return radio.checked; });
    return picked ? picked.value : 'motion';
  }

  function needsFreshDefinition(matchCount, strategy) {
    return matchCount === 0 || strategy === 'new';
  }

  function setStepClass(key, className, enabled) {
    var step = root.querySelector('[data-intake-step="' + key + '"]');
    if (!step) return;
    step.classList.toggle(className, Boolean(enabled));
  }

  function renderSourceChoices(matches) {
    var signature = matches.map(function(motion){ return motion.id; }).join('|');
    if (sourceList.dataset.signature === signature) return;
    sourceList.dataset.signature = signature;
    sourceList.innerHTML = matches.map(function(motion){
      return '' +
        '<label class="motion-intake-option motion-intake-match">' +
          '<input type="radio" name="source-motion-choice" value="' + escapeHtml(motion.id) + '">' +
          '<span>' +
            '<strong>' + escapeHtml(motion.name) + '</strong>' +
            '<em>' + escapeHtml(motion.state) + ' · ' + escapeHtml(motion.audienceCount) + ' audiences · ' + escapeHtml(motion.signalCount) + ' signals</em>' +
          '</span>' +
        '</label>';
    }).join('');
  }

  function sync() {
    var mode = selectedMode();
    var userId = normalize(fields.userId && fields.userId.value);
    var url = normalize(fields.url && fields.url.value);
    var motionMode = mode !== 'transition';
    var matches = motionMode ? matchesForUrl(url) : [];
    var strategy = motionMode ? selectedStrategy() : '';
    var freshDefinition = motionMode ? needsFreshDefinition(matches.length, strategy) : false;
    var currentStep = 'user';
    var ready = false;

    if (fields.mode) fields.mode.value = mode;
    if (fields.existingStrategy) fields.existingStrategy.value = strategy;
    if (strategyStep) strategyStep.hidden = !motionMode || matches.length === 0;

    if (!motionMode || matches.length === 0) {
      strategyRadios.forEach(function(radio){ radio.checked = false; });
      if (fields.existingStrategy) fields.existingStrategy.value = '';
    }

    if (motionMode && matches.length > 0 && (strategy === 'continue' || strategy === 'clone')) {
      if (matches.length === 1) {
        if (fields.sourceMotionId) fields.sourceMotionId.value = matches[0].id;
        if (sourceStep) sourceStep.hidden = true;
      } else {
        renderSourceChoices(matches);
        if (sourceStep) sourceStep.hidden = false;
        var chosen = sourceList.querySelector('input[name="source-motion-choice"]:checked');
        if (fields.sourceMotionId) fields.sourceMotionId.value = chosen ? chosen.value : '';
      }
    } else {
      if (fields.sourceMotionId) fields.sourceMotionId.value = '';
      if (sourceStep) sourceStep.hidden = true;
    }

    ['url', 'premise', 'audience', 'signal'].forEach(function(key){
      var step = root.querySelector('[data-intake-step="' + key + '"]');
      if (!step) return;
      if (key === 'url') {
        step.hidden = !motionMode;
        return;
      }
      step.hidden = !motionMode || !freshDefinition;
    });

    if (!userId) {
      currentStep = 'user';
    } else if (!motionMode) {
      ready = true;
    } else if (!url) {
      currentStep = 'url';
    } else if (matches.length > 0 && !strategy) {
      currentStep = 'existing-strategy';
    } else if ((strategy === 'continue' || strategy === 'clone') && matches.length > 1 && !normalize(fields.sourceMotionId && fields.sourceMotionId.value)) {
      currentStep = 'source-motion';
    } else if (freshDefinition && !normalize(fields.premise && fields.premise.value)) {
      currentStep = 'premise';
    } else if (freshDefinition && !normalize(fields.audience && fields.audience.value)) {
      currentStep = 'audience';
    } else if (freshDefinition && !normalize(fields.signal && fields.signal.value)) {
      currentStep = 'signal';
    } else {
      ready = true;
    }

    orderedSteps.forEach(function(key){
      setStepClass(key, 'is-current', false);
      setStepClass(key, 'is-complete', false);
    });

    setStepClass('mode', 'is-complete', Boolean(mode));
    setStepClass('user', 'is-complete', Boolean(userId));
    setStepClass('url', 'is-complete', motionMode ? Boolean(url) : false);
    setStepClass('existing-strategy', 'is-complete', !motionMode || matches.length === 0 || Boolean(strategy));
    setStepClass('source-motion', 'is-complete', !motionMode || matches.length <= 1 || strategy === 'new' || Boolean(normalize(fields.sourceMotionId && fields.sourceMotionId.value)));
    setStepClass('premise', 'is-complete', motionMode && freshDefinition ? Boolean(normalize(fields.premise && fields.premise.value)) : false);
    setStepClass('audience', 'is-complete', motionMode && freshDefinition ? Boolean(normalize(fields.audience && fields.audience.value)) : false);
    setStepClass('signal', 'is-complete', motionMode && freshDefinition ? Boolean(normalize(fields.signal && fields.signal.value)) : false);

    if (!ready) {
      setStepClass(currentStep, 'is-current', true);
    }

    submit.disabled = !ready;
    var label = !motionMode
      ? 'Open transition backlog'
      : strategy === 'continue'
        ? 'Open motion'
        : strategy === 'clone'
          ? 'Clone motion'
          : 'Start motion';
    var span = submit.querySelector('span');
    if (span) span.textContent = label;
  }

  modeRadios.forEach(function(radio){
    radio.addEventListener('change', sync);
  });
  strategyRadios.forEach(function(radio){
    radio.addEventListener('change', sync);
  });
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  root.addEventListener('change', function(event){
    var target = event.target;
    if (target && target.matches && target.matches('input[name="source-motion-choice"]')) {
      sync();
    }
  });

  sync();
})();
`;
}

/**
 * @param {any} m
 * @param {{ interactive?: boolean, asPage?: boolean }} [meta]
 */
function renderDetail(m, meta = {}) {
  return (
    `<section class="dom-wrap motion-detail" id="m-${escapeAttr(m.id)}">` +
    renderHead(m, meta) +
    renderOffer(m.offer) +
    renderPremise(m.premise) +
    renderSignals(m.signals) +
    renderAudiences(m.audiences) +
    renderMatches(m, meta) +
    renderPacketReviews(m, meta) +
    renderActivity(m.activity) +
    renderPlan(m) +
    `</section>`
  );
}

/**
 * Operational motion page: audience first, then evidence and people.
 *
 * @param {any} m
 * @param {{ interactive?: boolean, asPage?: boolean }} [meta]
 */
function renderOperationalDetail(m, meta = {}) {
  return (
    `<section class="dom-wrap motion-detail" id="m-${escapeAttr(m.id)}">` +
    renderHead(m, meta) +
    renderAudiences(m.audiences) +
    renderOperationalWorkspaceTabs(m, meta) +
    `</section>`
  );
}

/**
 * @param {any} m
 * @param {{ interactive?: boolean, asPage?: boolean }} [meta]
 */
function renderOperationalWorkspaceTabs(m, meta = {}) {
  const tabsetId = `motion-workviews-${m.id}`;
  const activeKey = defaultOperationalTabKey(m);
  const tabs = [
    {
      key: "companies",
      label: "Companies",
      count: m.companies.length,
      countTone: m.companies.length ? "blue" : "neutral",
    },
    {
      key: "backlog",
      label: "Backlog",
      count: m.backlogCompanies.length,
      countTone: m.backlogCompanies.length ? "amber" : "neutral",
    },
    {
      key: "people",
      label: "People",
      count: m.people.length,
      countTone: m.people.length ? "blue" : "neutral",
    },
    {
      key: "activity",
      label: "Activity",
      count: totalActivityEntries(m.activity),
      countTone: totalActivityEntries(m.activity) ? "blue" : "neutral",
    },
    {
      key: "execution",
      label: "Execution",
      count: (m.plan?.actionsRun ?? 0) + (m.reviewPackets?.length ?? 0),
      countTone: (m.plan?.actionsRun ?? 0) + (m.reviewPackets?.length ?? 0) ? "amber" : "neutral",
    },
  ].map((tab) => ({
    target: operationalTabTarget(m.id, tab.key),
    panelId: operationalTabPanelId(m.id, tab.key),
    active: tab.key === activeKey,
    ...tab,
  }));

  return (
    segTabs({
      tabsetId,
      ariaLabel: "Motion work views",
      className: "motion-workviews-tabs",
      tabs,
    }) +
    `<div class="motion-workspace-stack">` +
    renderOperationalTabPanel({
      motionId: m.id,
      key: "companies",
      active: activeKey === "companies",
      body: renderMatchedCompanies(m, meta, { includeEvidenceRule: true }),
    }) +
    renderOperationalTabPanel({
      motionId: m.id,
      key: "backlog",
      active: activeKey === "backlog",
      body: renderBacklogCompanies(m, meta),
    }) +
    renderOperationalTabPanel({
      motionId: m.id,
      key: "people",
      active: activeKey === "people",
      body: renderMatchedPeople(m, meta),
    }) +
    renderOperationalTabPanel({
      motionId: m.id,
      key: "activity",
      active: activeKey === "activity",
      body: renderActivity(m.activity),
    }) +
    renderOperationalTabPanel({
      motionId: m.id,
      key: "execution",
      active: activeKey === "execution",
      body: renderPlan(m) + renderPacketReviews(m, meta),
    }) +
    `</div>`
  );
}

/**
 * @param {string} motionId
 * @param {string} key
 */
function operationalTabTarget(motionId, key) {
  return `motion-${motionId}-${key}`;
}

/**
 * @param {string} motionId
 * @param {string} key
 */
function operationalTabPanelId(motionId, key) {
  return `motion-${motionId}-panel-${key}`;
}

/**
 * @param {{ motionId: string, key: string, active: boolean, body: string }} input
 */
function renderOperationalTabPanel(input) {
  const target = operationalTabTarget(input.motionId, input.key);
  const panelId = operationalTabPanelId(input.motionId, input.key);
  return (
    `<section class="motion-workspace-pane" id="${escapeAttr(panelId)}" role="tabpanel"` +
    ` aria-labelledby="${escapeAttr(`motion-workviews-${input.motionId}-tab-${target}`)}"` +
    ` data-tab-panel="${escapeAttr(target)}"${input.active ? "" : " hidden"}>` +
    input.body +
    `</section>`
  );
}

/** @param {any} m */
function defaultOperationalTabKey(m) {
  if (totalActivityEntries(m.activity) > 0) return "activity";
  if ((m.backlogCompanies?.length ?? 0) > 0) return "backlog";
  if ((m.people?.length ?? 0) > 0) return "people";
  if ((m.companies?.length ?? 0) > 0) return "companies";
  return "execution";
}

/**
 * Settings/config page for the motion definition.
 *
 * @param {any} m
 * @param {{ interactive?: boolean, asPage?: boolean, settingsPage?: boolean }} [meta]
 */
function renderSettingsDetail(m, meta = {}) {
  const tabsetId = `motion-settings-${m.id}`;
  return (
    `<section class="dom-wrap motion-detail motion-settings" id="m-${escapeAttr(m.id)}-settings">` +
    renderHead(m, meta) +
    renderSettingsTabs(tabsetId) +
    `<div class="settings-stack">` +
    `<section class="settings-pane" id="premise" role="tabpanel" aria-labelledby="${escapeAttr(tabsetId)}-tab-premise" data-tab-panel="premise">${renderPremise(m.premise)}</section>` +
    `<section class="settings-pane" id="offer" role="tabpanel" aria-labelledby="${escapeAttr(tabsetId)}-tab-offer" data-tab-panel="offer" hidden>${renderOffer(m.offer)}</section>` +
    `<section class="settings-pane" id="signals" role="tabpanel" aria-labelledby="${escapeAttr(tabsetId)}-tab-signals" data-tab-panel="signals" hidden>${renderSignals(m.signals, { motionId: m.id, editable: Boolean(meta.interactive) })}</section>` +
    `<section class="settings-pane" id="execution" role="tabpanel" aria-labelledby="${escapeAttr(tabsetId)}-tab-execution" data-tab-panel="execution" hidden>${renderExecutionSettings(m, meta)}</section>` +
    `</div>` +
    `</section>`
  );
}

/**
 * @param {any} m
 * @param {{ interactive?: boolean, asPage?: boolean }} [meta]
 */
function renderHead(m, meta = {}) {
  // The routed detail page gets "back" from the breadcrumb; only the anchored
  // (static) layout needs the inline back link.
  const backLink = meta.asPage
    ? ""
    : `<a class="mh-back" href="${escapeAttr(meta.interactive ? "/motions" : "#motions-top")}">${iconSvg("chevron", 12)} All motions</a>`;
  const settingsHref = meta.interactive ? `/motions/${encodeURIComponent(m.id)}/settings` : null;
  const motionHref = meta.interactive ? `/motions/${encodeURIComponent(m.id)}` : null;
  const deleteAction = meta.settingsPage ? renderDeleteMotionAction(m, meta) : "";
  const setLiveAction = meta.interactive && m.state !== "active" && !m.blocker
    ? liveActionBtn({
        writer: "restartMotion",
        args: { motionId: m.id },
        variant: "primary",
        icon: "check",
        label: "Set live",
        title: "Mark this motion active so it becomes the live working motion.",
      })
    : "";
  const actions = meta.settingsPage
    ? [
        setLiveAction,
        deleteAction,
        motionHref ? btn({ variant: "primary", size: "sm", icon: "layers", label: "Open motion", href: motionHref }) : "",
      ].filter(Boolean).join("")
    : [
        setLiveAction,
        settingsHref ? btn({ variant: "secondary", size: "sm", icon: "sliders", label: "Settings", href: settingsHref }) : "",
        btn({ variant: "secondary", size: "sm", icon: "refresh", label: "Sync via agent", disabled: true, title: "Re-targeting and capture run from the agent, not the UI." }),
      ].filter(Boolean).join("");
  return (
    `<div class="motion-head">` +
    `<div class="mh-left">` +
    backLink +
    `<div class="mh-eyebrow">${iconSvg("layers", 13)}<span class="mh-tag">${meta.settingsPage ? "SETTINGS" : "MOTION"}</span>${stateDot(m.state)}${truthTag(m.truth)}</div>` +
    `<h1 class="mh-name">${escapeHtml(m.name)}</h1>` +
    `</div>` +
    `<div class="mh-actions">${actions}</div>` +
    `</div>`
  );
}

/**
 * @param {any} motion
 * @param {{ interactive?: boolean }} [meta]
 */
function renderDeleteMotionAction(motion, meta = {}) {
  if (!meta.interactive) {
    return "";
  }

  const sourceUrl = motion.offer?.url ?? motion.offer?.sourceUrl ?? motion.sourceUrl ?? null;
  if (isTransitionMotion({ name: motion.name, sourceUrl })) {
    return "";
  }

  return liveActionBtn({
    writer: "deleteMotion",
    args: { motionId: motion.id },
    variant: "danger",
    icon: "x",
    label: "Delete motion",
    title: "Delete this motion. Any prospects in it move into transition backlog first.",
  });
}

/**
 * @param {string} tabsetId
 */
function renderSettingsTabs(tabsetId) {
  return segTabs({
    tabsetId,
    ariaLabel: "Motion settings",
    className: "settings-tabs",
    tabs: [
      { target: "premise", label: "Premise", panelId: "premise", active: true },
      { target: "offer", label: "Offer", panelId: "offer" },
      { target: "signals", label: "Signals", panelId: "signals" },
      { target: "execution", label: "Execution", panelId: "execution" },
    ],
  });
}

/** @param {any} offer */
function renderOffer(offer) {
  const thesis = [
    ["Problem", offer.problem],
    ["Felt by", offer.feltBy],
    ["Triggers", offer.triggers],
  ]
    .filter(([, val]) => val)
    .map(
      ([cap, val]) =>
        `<div class="ot-cell"><span class="ot-cap">${escapeHtml(cap)}</span><span class="ot-val">${escapeHtml(val)}</span></div>`,
    )
    .join("");

  return (
    `<div class="offer-card">` +
    `<div class="offer-head">` +
    `<span class="def-cap">${iconSvg("spark", 12)}Offer · what this motion is for</span>` +
    (offer.url
      ? `<a class="offer-url" href="${escapeAttr(offer.url)}" target="_blank" rel="noreferrer">${iconSvg("link", 12)}${escapeHtml(offer.urlLabel ?? offer.url)}</a>`
      : "") +
    `</div>` +
    `<div class="offer-title">${escapeHtml(offer.title)}</div>` +
    (offer.summary ? `<p class="offer-summary">${escapeHtml(offer.summary)}</p>` : "") +
    (thesis ? `<div class="offer-thesis">${thesis}</div>` : "") +
    `</div>`
  );
}

/** @param {any} premise */
function renderPremise(premise) {
  return (
    `<div class="premise-hero">` +
    `<div class="premise-flag">${iconSvg("target", 13)}PREMISE · WHY THIS OFFER MATTERS HERE</div>` +
    `<p class="premise-statement">${escapeHtml(premise.statement)}</p>` +
    (premise.note ? `<p class="premise-note">${escapeHtml(premise.note)}</p>` : "") +
    `<div class="premise-meta">` +
    `<span class="pm-item"><span class="pm-cap">Status</span>${truthTag(premise.truth)}</span>` +
    `<i class="pm-div"></i>` +
    `<span class="pm-item"><span class="pm-cap">Source</span><span class="pm-src">${escapeHtml(premise.source)}</span></span>` +
    `</div>` +
    `</div>`
  );
}

/**
 * @param {any[]} signals
 * @param {{ motionId?: string, editable?: boolean }} [options]
 */
function renderSignals(signals, options = {}) {
  const head =
    `<div class="md-section sig-section">Signals <span>${signals.length}</span>` +
    `<em class="sig-section-q">What would tell us this premise is live here?</em></div>`;
  const editor = options.editable && options.motionId ? renderSignalComposer(options.motionId) : "";
  if (!signals.length) {
    return head + editor + emptyState({ icon: "activity", message: "No signals authored yet." });
  }
  const body = signals
    .map(
      (sig) =>
        `<div class="signal-card">` +
        `<div class="sig-top">` +
        `<span class="sig-idx">S${sig.index}</span>` +
        `<p class="sig-q">${escapeHtml(sig.question)}</p>` +
        scopeBadge(sig.scope) +
        `</div>` +
        `<p class="sig-why">${escapeHtml(sig.whyItMatters)}</p>` +
        `<div class="sig-rule"><span class="sig-rule-cap">CHECK</span><code>${escapeHtml(sig.matchRule)}</code></div>` +
        `<div class="sig-foot">` +
        `<span class="sig-methods">${sig.methods.map((mth) => `<span class="method-chip">${escapeHtml(mth)}</span>`).join("")}</span>` +
        `<span class="sig-foot-right">` +
        `<span class="sig-window">${iconSvg("clock", 11)}${escapeHtml(sig.window)}</span>` +
        truthTag(sig.truth) +
        `<span class="sig-matched">${escapeHtml(sig.matchLabel)}</span>` +
        (options.editable && options.motionId && sig.id
          ? liveActionBtn({
              writer: "removeMotionSignal",
              args: { motionId: options.motionId, signalId: sig.id },
              variant: "ghost",
              size: "sm",
              icon: "x",
              label: "Remove signal",
              title: "Remove this signal question and any stored evidence attached to it.",
            })
          : "") +
        `</span>` +
        `</div>` +
        `</div>`,
    )
    .join("");
  return head + editor + `<div class="signal-grid">${body}</div>`;
}

/**
 * @param {string} motionId
 */
function renderSignalComposer(motionId) {
  return (
    `<div class="motion-intake-step exo-action" data-exo-writer="addMotionSignals" data-exo-args="${escapeAttr(JSON.stringify({ motionId }))}" data-exo-fields="signal:signal">` +
    `<label class="compose-field motion-intake-field">` +
    `<span class="compose-label">Add signal questions</span>` +
    `<p class="motion-intake-helper">Enter one question per line. Use scope::question when the signal should be person-level or both.</p>` +
    `<textarea class="compose-body motion-intake-textarea motion-intake-textarea-signals" name="signal" placeholder="company::Is there recent evidence the team widened GTM scope?&#10;person::Is there recent evidence a new RevOps leader just joined?"></textarea>` +
    `</label>` +
    `<div class="compose-actions">` +
    `<button class="btn btn-primary btn-sm" type="button">${iconSvg("spark", 14)}<span>Add questions</span></button>` +
    `</div>` +
    `</div>`
  );
}

/**
 * @param {any} motion
 * @param {{ interactive?: boolean, user?: { id?: string | null, label?: string | null } | null }} [meta]
 */
function renderExecutionSettings(motion, meta = {}) {
  const assignment = motion.executionAssignment ?? null;
  const sourceUrl = motion.offer?.url ?? motion.offer?.sourceUrl ?? motion.sourceUrl ?? null;
  const transitionMotion = isTransitionMotion({ name: motion.name, sourceUrl });
  const currentUserId = meta.user?.id ?? null;
  const currentUserLabel = meta.user?.label ?? null;
  const currentUserAssigned = Boolean(currentUserId) && assignment?.userId === currentUserId;
  const gmailPicker = buildExactGmailPickerModel(meta.user ?? null, assignment);
  const gmailPickerHtml = renderExactGmailPicker(gmailPicker, {
    helper: "Pick one exact inbox when this motion should send or reconcile email from a specific mailbox. Leave it blank to keep Gmail unresolved at motion scope.",
  });
  const needsScopedGmailPin = currentUserAssigned && gmailPicker.showPicker && !gmailPicker.selectedRef;
  const assignmentSummary = assignment
    ? `${assignment.label} is assigned to this motion.`
    : "No user is assigned to this motion yet.";
  const assignmentDetail = assignment
    ? `Launch will inherit ${Array.isArray(assignment.accountRefs) && assignment.accountRefs.length ? assignment.accountRefs.join(", ") : "the assigned user's mapped accounts"}.`
    : "Assign one user here so Exo can resolve one governed launch path.";
  const button = meta.interactive && currentUserId && (!currentUserAssigned || gmailPicker.showPicker)
    ? liveActionBtn({
        writer: "assignMotionUser",
        args: {
          motionId: motion.id,
          userId: currentUserId,
          reason: "Keep one execution identity for this motion",
        },
        variant: "primary",
        icon: "check",
        label: currentUserAssigned
          ? "Save launch settings"
          : (currentUserLabel ? `Assign ${currentUserLabel}` : "Assign current user"),
        title: currentUserAssigned
          ? "Save the current motion owner and any exact Gmail inbox pin."
          : "Assign the current workspace user to this motion so launch can resolve one governed execution identity.",
        fields: gmailPicker.showPicker ? "accountRef:accountRef?" : null,
      })
    : "";
  const footer = currentUserAssigned
    ? `<p class="premise-note">${escapeHtml(
        needsScopedGmailPin
          ? "This motion is already assigned to the current workspace user. Pick one exact Gmail inbox before email work should trust this scope."
          : "This motion is already assigned to the current workspace user."
      )}</p>`
    : currentUserLabel
      ? `<p class="premise-note">Current workspace user: ${escapeHtml(currentUserLabel)}.</p>`
      : `<p class="premise-note">Open the UI as a governed execution user to assign this motion here.</p>`;
  const deleteCard = transitionMotion
    ? ""
    : (
      `<div class="offer-card">` +
      `<div class="offer-head">` +
      `<span class="def-cap">${iconSvg("x", 12)}Delete · remove this motion from Exo</span>` +
      `</div>` +
      `<div class="offer-title">Delete motion</div>` +
      `<p class="offer-summary">Prospects will move into the transition backlog.</p>` +
      `<p class="offer-summary">Reassign them to a real motion there or ignore them going forward.</p>` +
      `<p class="premise-note">Use the Delete motion button at the top of this page.</p>` +
      `</div>`
    );

  return (
    `<div class="offer-card">` +
    `<div class="offer-head">` +
    `<span class="def-cap">${iconSvg("userPlus", 12)}Execution · who can launch this motion</span>` +
    `</div>` +
    `<div class="offer-title">${escapeHtml(assignment?.label ?? "Unassigned")}</div>` +
    `<p class="offer-summary">${escapeHtml(assignmentSummary)}</p>` +
    `<p class="offer-summary">${escapeHtml(assignmentDetail)}</p>` +
    `<div class="premise-meta">` +
    ownerTag({ ownerName: assignment?.label ?? null, initials: assignment?.label?.slice(0, 1)?.toUpperCase() ?? null }) +
    `</div>` +
    footer +
    gmailPickerHtml +
    (button ? `<div class="compose-actions">${button}</div>` : "") +
    `</div>` +
    deleteCard
  );
}

/** @param {any[]} audiences */
function renderAudiences(audiences) {
  const head = `<div class="md-section">Audience hypotheses <span>${audiences.length}</span></div>`;
  if (!audiences.length) {
    return head + emptyState({ icon: "users", message: "No audience hypotheses yet." });
  }
  const body = audiences
    .map(
      (h) =>
        `<div class="hyp-card">` +
        `<span class="hyp-idx">H${h.index}</span>` +
        `<div class="hyp-body">` +
        `<div class="hyp-stmt">${escapeHtml(h.statement)}</div>` +
        (h.roles ? `<div class="hyp-roles">${escapeHtml(h.roles)}</div>` : "") +
        `</div>` +
        countChip(h.matched, "blue", "matched") +
        `</div>`,
    )
    .join("");
  return head + `<div class="hyp-list">${body}</div>`;
}

/**
 * @param {any} m
 * @param {{ interactive?: boolean }} [meta]
 */
function renderMatches(m, meta = {}) {
  return (
    renderMatchedCompanies(m, meta, { includeEvidenceRule: true }) +
    renderBacklogCompanies(m, meta) +
    renderMatchedPeople(m, meta)
  );
}

/**
 * @param {any} m
 * @param {{ interactive?: boolean }} [meta]
 * @param {{ includeEvidenceRule?: boolean }} [options]
 */
function renderMatchedCompanies(m, meta = {}, options = {}) {
  const head = `<div class="md-section">Matched companies <span>${m.companies.length}</span></div>`;
  const body = m.companies.length
    ? `<div class="md-list">` +
      m.companies
        .map(
          (c) =>
            `<div class="md-co">` +
            iconSvg("building", 15, "md-co-ic") +
            `<div class="md-co-id">` +
            `<a class="md-co-name" href="${escapeAttr(companyHref(c.id, meta))}">${escapeHtml(c.name)}</a>` +
            `<span class="md-co-sub">${escapeHtml(c.industry)}</span>` +
            `</div>` +
            (c.matchedSignalIndexes.length
              ? `<span class="match-sig"${c.topMatch ? ` title="${escapeAttr(c.topMatch)}"` : ""}>matched ${escapeHtml(c.matchedSignalIndexes.join(", "))}</span>`
              : "") +
            `<span class="md-co-meta">${c.prospectCount} people</span>` +
            stateDot(c.enrichment, `${c.enrichmentLabel}`) +
            renderAccountLifecycleActions(c, m.id, meta) +
            `<a class="md-co-go" href="${escapeAttr(companyHref(c.id, meta))}" aria-label="Open ${escapeAttr(c.name)}">${iconSvg("chevronR", 13)}</a>` +
            `</div>`,
        )
        .join("") +
      `</div>`
    : emptyState({ icon: "building", message: "No companies have lit a signal yet." });

  return (
    (options.includeEvidenceRule
      ? `<div class="evidence-rule">${iconSvg("arrowR", 13)}Below: where these signals actually fired — evidence generated by the motion.</div>`
      : "") +
    head +
    body
  );
}

/**
 * @param {any} m
 * @param {{ interactive?: boolean }} [meta]
 */
function renderBacklogCompanies(m, meta = {}) {
  const head = `<div class="md-section">Research backlog <span>${m.backlogCompanies.length}</span></div>`;
  const body = m.backlogCompanies.length
    ? `<div class="md-list">` +
      m.backlogCompanies
        .map((c) => {
          const startHref = researchBriefHref(c.id, m.id, meta);
          const companyLink = companyHref(c.id, meta);
          const queueHref = meta.interactive ? "/queue" : null;
          const facts = [
            `<span class="match-sig">${iconSvg("refresh", 11)}${escapeHtml(titleizeQueueStage(c.stage))}</span>`,
            `<span class="md-co-meta">${c.prospectCount} people</span>`,
            stateDot(c.enrichment, c.enrichmentLabel),
          ].join("");
          const actions = [
            renderAccountLifecycleActions(c, m.id, meta),
            queueHref ? btn({ variant: "primary", size: "sm", icon: "cpu", label: "Open queue", href: queueHref }) : "",
            startHref ? btn({ variant: "ghost", size: "sm", icon: "flag", label: "Open brief", href: startHref }) : "",
          ].join("");
          return (
            `<div class="md-co md-co-backlog">` +
            iconSvg("building", 15, "md-co-ic") +
            `<div class="md-co-id">` +
            `<a class="md-co-name" href="${escapeAttr(companyLink)}">${escapeHtml(c.name)}</a>` +
            `<span class="md-co-sub">${escapeHtml(c.industry)}</span>` +
            `</div>` +
            `<div class="md-co-tail">` +
            `<div class="md-co-facts">${facts}</div>` +
            `<div class="md-co-actions">${actions}</div>` +
            `</div>` +
            `</div>`
          );
        })
        .join("") +
      `</div>`
    : emptyState({ icon: "building", message: "No research backlog is exposed right now." });

  return head + body;
}

/**
 * @param {any} m
 * @param {{ interactive?: boolean }} [meta]
 */
function renderMatchedPeople(m, meta = {}) {
  const head = `<div class="md-section">Matched people <span>${m.people.length}</span></div>`;
  const body = m.people.length
    ? `<div class="md-list">` +
      m.people
        .map((p) => {
          const facts = [
            p.signal
              ? `<span class="match-sig" title="${escapeAttr(p.signal)}">${iconSvg("activity", 11)}${escapeHtml(truncate(p.signal, 40))}</span>`
              : "",
            stateDot(p.branch, p.branchLabel ?? undefined),
            ownerTag({ ownerName: p.owner }),
          ].join("");
          const actions = [
            renderMotionProspectLifecycleActions(p, m.id, meta),
            `<a class="md-co-go" href="${escapeAttr(prospectHref(p.id, meta))}" aria-label="Open ${escapeAttr(p.name)}">${iconSvg("chevronR", 13)}</a>`,
          ].join("");
          return (
            `<div class="md-co md-co-person">` +
            avatar({ src: p.avatarUrl, initials: p.initials, name: p.name, size: 30 }) +
            `<div class="md-co-id">` +
            `<a class="md-co-name" href="${escapeAttr(prospectHref(p.id, meta))}">${escapeHtml(p.name)}</a>` +
            `<span class="md-co-sub">${escapeHtml([p.title, p.company].filter(Boolean).join(" · "))}</span>` +
            `</div>` +
            `<div class="md-co-tail">` +
            `<div class="md-co-facts">${facts}</div>` +
            `<div class="md-co-actions">${actions}</div>` +
            `</div>` +
            `</div>`
          );
        })
        .join("") +
      `</div>`
    : emptyState({ icon: "users", message: "No people have lit a signal yet." });

  return head + body;
}

/**
 * @param {any} company
 * @param {string} motionId
 * @param {{ interactive?: boolean }} meta
 */
function renderAccountLifecycleActions(company, motionId, meta = {}) {
  if (!meta.interactive || !company.id) return "";
  const disposition = normalizeDisposition(company.disposition);
  const active = disposition === "active";
  const buttons = active
    ? [
        renderAccountDispositionButton({ motionId, companyId: company.id, disposition: "nurture", label: "Nurture", icon: "clock", variant: "secondary" }),
        renderAccountDispositionButton({ motionId, companyId: company.id, disposition: "no_longer_target", label: "No longer target", icon: "x", variant: "danger" }),
        renderAccountDispositionButton({ motionId, companyId: company.id, disposition: "exhausted", label: "Exhausted", icon: "flag", variant: "ghost" }),
      ].join("")
    : renderAccountDispositionButton({ motionId, companyId: company.id, disposition: "active", label: "Reactivate", icon: "check", variant: "primary" });
  return (
    `<span class="lifecycle-inline" data-exo-field-scope>` +
    (active ? `<input class="compose-input lifecycle-reason lifecycle-reason-compact" name="lifecycleReason" placeholder="Reason" autocomplete="off" hidden aria-hidden="true" />` : "") +
    buttons +
    `</span>`
  );
}

/**
 * @param {{
 *   motionId: string,
 *   companyId: string,
 *   disposition: "active" | "nurture" | "no_longer_target" | "exhausted",
 *   label: string,
 *   icon: string,
 *   variant: "primary" | "secondary" | "ghost" | "danger",
 * }} input
 */
function renderAccountDispositionButton(input) {
  const intent = buildAccountDispositionActionIntent({
    motionId: input.motionId,
    companyId: input.companyId,
    disposition: input.disposition,
  });
  return liveActionBtn({
    writer: intent.writer,
    args: intent.args,
    variant: input.variant,
    size: "sm",
    icon: input.icon,
    label: input.label,
    title: intent.command,
    fields: input.disposition === "active" ? null : "lifecycleReason:reason",
    revealField: input.disposition === "active" ? null : { name: "lifecycleReason", placeholder: "Reason" },
  });
}

/**
 * @param {any} prospect
 * @param {string} motionId
 * @param {{ interactive?: boolean }} meta
 */
function renderMotionProspectLifecycleActions(prospect, motionId, meta = {}) {
  if (!meta.interactive || !prospect.companyId || !prospect.id) return "";
  const disposition = normalizeDisposition(prospect.disposition);
  const active = disposition === "active" && normalizeDisposition(prospect.accountDisposition) === "active";
  const buttons = active
    ? [
        renderMotionProspectDispositionButton({ motionId, companyId: prospect.companyId, prospectId: prospect.id, disposition: "nurture", label: "Nurture", icon: "clock", variant: "secondary" }),
        renderMotionProspectDispositionButton({ motionId, companyId: prospect.companyId, prospectId: prospect.id, disposition: "not_a_fit", label: "Not a fit", icon: "x", variant: "danger" }),
        renderMotionProspectDispositionButton({ motionId, companyId: prospect.companyId, prospectId: prospect.id, disposition: "exhausted", label: "Exhausted", icon: "flag", variant: "ghost" }),
      ].join("")
    : renderMotionProspectDispositionButton({ motionId, companyId: prospect.companyId, prospectId: prospect.id, disposition: "active", label: "Reactivate", icon: "check", variant: "primary" });
  return (
    `<span class="lifecycle-inline" data-exo-field-scope>` +
    (active ? `<input class="compose-input lifecycle-reason lifecycle-reason-compact" name="lifecycleReason" placeholder="Reason" autocomplete="off" hidden aria-hidden="true" />` : "") +
    buttons +
    `</span>`
  );
}

/**
 * @param {{
 *   motionId: string,
 *   companyId: string,
 *   prospectId: string,
 *   disposition: "active" | "nurture" | "not_a_fit" | "exhausted",
 *   label: string,
 *   icon: string,
 *   variant: "primary" | "secondary" | "ghost" | "danger",
 * }} input
 */
function renderMotionProspectDispositionButton(input) {
  const intent = buildProspectDispositionActionIntent({
    motionId: input.motionId,
    companyId: input.companyId,
    prospectId: input.prospectId,
    disposition: input.disposition,
  });
  return liveActionBtn({
    writer: intent.writer,
    args: intent.args,
    variant: input.variant,
    size: "sm",
    icon: input.icon,
    label: input.label,
    title: intent.command,
    fields: input.disposition === "active" ? null : "lifecycleReason:reason",
    revealField: input.disposition === "active" ? null : { name: "lifecycleReason", placeholder: "Reason" },
  });
}

/**
 * @param {any} m
 * @param {{ interactive?: boolean }} meta
 */
function renderPacketReviews(m, meta = {}) {
  if (!m.reviewPackets?.length) return "";
  const rows = m.reviewPackets
    .map((packet) => renderPacketReviewRow(packet, m.id, meta))
    .join("");
  return `<div class="md-section">Packet review <span>${m.reviewPackets.length}</span></div><div class="md-list">${rows}</div>`;
}

/**
 * @param {any} packet
 * @param {string} motionId
 * @param {{ interactive?: boolean }} meta
 */
function renderPacketReviewRow(packet, motionId, meta = {}) {
  const subject = packet.prospectName
    ? `${packet.prospectName} · ${packet.companyName}`
    : packet.companyName;
  const proposal = packet.proposal?.action
    ? `<span class="match-sig">${iconSvg("flag", 11)}${escapeHtml(packet.proposal.action.replaceAll("_", " "))}</span>`
    : "";
  return (
    `<div class="md-co packet-review-row" data-exo-field-scope>` +
    iconSvg("flag", 15, "md-co-ic") +
    `<div class="md-co-id">` +
    `<span class="md-co-name">${escapeHtml(subject)}</span>` +
    `<span class="md-co-sub">${escapeHtml(packet.packetLabel)} · ${escapeHtml(packet.packetId)}</span>` +
    `</div>` +
    proposal +
    (packet.notes ? `<span class="md-co-meta">${escapeHtml(packet.notes)}</span>` : "") +
    renderPacketReviewActions(packet, motionId, meta) +
    `</div>`
  );
}

/**
 * @param {any} packet
 * @param {string} motionId
 * @param {{ interactive?: boolean }} meta
 */
function renderPacketReviewActions(packet, motionId, meta = {}) {
  if (!meta.interactive) return "";
  const terminalOutcome = packet.packetKind === "prospect_research" ? "not_a_fit" : "no_longer_target";
  const accept = buildPacketReviewActionIntent({ motionId, packetId: packet.packetId, action: "accepted" });
  const nurture = buildPacketReviewActionIntent({ motionId, packetId: packet.packetId, action: "amended", outcome: "nurture" });
  const terminal = buildPacketReviewActionIntent({ motionId, packetId: packet.packetId, action: "amended", outcome: terminalOutcome });
  const exhausted = buildPacketReviewActionIntent({ motionId, packetId: packet.packetId, action: "amended", outcome: "exhausted" });
  const returned = buildPacketReviewActionIntent({ motionId, packetId: packet.packetId, action: "returned" });
  return (
    `<span class="packet-review-actions">` +
    `<input class="compose-input lifecycle-reason lifecycle-reason-compact" name="packetReviewReason" placeholder="Reason or return note" autocomplete="off" hidden aria-hidden="true" />` +
    liveActionBtn({ writer: accept.writer, args: accept.args, variant: "primary", size: "sm", icon: "check", label: "Accept", title: accept.command }) +
    `<span class="lifecycle-sep">Amend</span>` +
    liveActionBtn({ writer: nurture.writer, args: nurture.args, variant: "secondary", size: "sm", icon: "clock", label: "Nurture", title: nurture.command, fields: "packetReviewReason:reason", revealField: { name: "packetReviewReason", placeholder: "Reason" } }) +
    liveActionBtn({ writer: terminal.writer, args: terminal.args, variant: "danger", size: "sm", icon: "x", label: terminalOutcome === "not_a_fit" ? "Not a fit" : "No longer target", title: terminal.command, fields: "packetReviewReason:reason", revealField: { name: "packetReviewReason", placeholder: "Reason" } }) +
    liveActionBtn({ writer: exhausted.writer, args: exhausted.args, variant: "ghost", size: "sm", icon: "flag", label: "Exhausted", title: exhausted.command, fields: "packetReviewReason:reason", revealField: { name: "packetReviewReason", placeholder: "Reason" } }) +
    liveActionBtn({ writer: returned.writer, args: returned.args, variant: "ghost", size: "sm", icon: "refresh", label: "Return", title: returned.command, fields: "packetReviewReason:notes", revealField: { name: "packetReviewReason", placeholder: "Return note" } }) +
    `</span>`
  );
}

/** @param {unknown} value */
function normalizeDisposition(value) {
  const normalized = String(value ?? "active").trim();
  return normalized || "active";
}

/** @param {any} m */
function renderPlan(m) {
  const head = `<div class="md-section">Motion plan &amp; execution</div>`;
  const gap = m.blocker ? `<div class="rel-gap">${iconSvg("alert", 13)}${escapeHtml(m.blocker)}</div>` : "";
  const note = renderPlanNote(m);
  const steps = m.plan.nextSteps.length
    ? `<div class="plan-list">` +
      m.plan.nextSteps
        .map(
          (ns) =>
            `<div class="plan-row">${iconSvg("arrowR", 14, "plan-ic")}<span class="plan-text">${escapeHtml(ns.text)}</span>` +
            (ns.tag ? countChip(ns.tag, ns.tone) : "") +
            `</div>`,
        )
        .join("") +
      `</div>`
    : "";
  const packetLabel = m.plan.prospectCount > 0
    ? `${m.plan.readyToSend} / ${m.plan.prospectCount}`
    : "0";
  const tiles =
    `<div class="md-stats plan-stats">` +
    `<div class="md-tile"><b>${m.plan.actionsRun}</b><em>Due now</em></div>` +
    `<div class="md-tile"><b>${m.plan.readyToSend}</b><em>Ready now</em></div>` +
    `<div class="md-tile"><b>${m.plan.drafts}</b><em>Message-ready</em></div>` +
    `<div class="md-tile md-tile-stage"><b>${escapeHtml(m.plan.stageLabel ?? "Unknown stage")}</b><span class="md-ready">${readinessBar(m.plan.readiness)}<em>${escapeHtml(formatStageLoopPosition(m.plan.stagePosition, m.plan.stageTotal))}</em></span><em>Motion stage</em></div>` +
    `<div class="md-tile"><b>${escapeHtml(packetLabel)}</b><em>Prospect packets</em></div>` +
    `</div>`;
  const facts = renderPlanFacts(m.plan);
  return head + gap + note + steps + tiles + facts;
}

/** @param {any} m */
function renderPlanNote(m) {
  const lines = [
    describeStageProgress(m.plan),
    describeStageConstraint(m),
    describePacketReadiness(m.plan),
  ].filter(Boolean);
  if (!lines.length) return "";
  return (
    `<div class="plan-note">` +
    lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") +
    `</div>`
  );
}

/** @param {any} plan */
function renderPlanFacts(plan) {
  const facts = [];
  if (plan.drafts > 0) facts.push(`${plan.drafts} message-ready`);
  if (plan.recentPostReadyCount > 0) facts.push(`${plan.recentPostReadyCount} recent-activity hooks`);
  if (plan.emailFallbackCount > 0) facts.push(`${plan.emailFallbackCount} email fallbacks`);
  if (plan.waitingCount > 0) facts.push(`${plan.waitingCount} waiting`);
  if (plan.reviewCount > 0) facts.push(`${plan.reviewCount} review`);
  if (!facts.length) return "";
  return `<div class="plan-facts">${facts.map((fact) => `<span class="match-sig">${escapeHtml(fact)}</span>`).join("")}</div>`;
}

/** @param {any} plan */
function describeStageProgress(plan) {
  const stageLabel = plan.stageLabel ?? "Unknown stage";
  if (plan.stagePosition && plan.stageTotal) {
    return `Current stage: ${stageLabel} (${plan.stagePosition} of ${plan.stageTotal} in the targeting loop).`;
  }
  return `Current stage: ${stageLabel}.`;
}

/** @param {any} m */
function describeStageConstraint(m) {
  const backlogCount = m.backlogCompanies?.length ?? 0;
  switch (m.plan.stage) {
    case "needs-company-research":
      return backlogCount > 0
        ? `Why it is still here: ${backlogCount} backlog ${backlogCount === 1 ? "company still needs work" : "companies still need work"} before Exo can move to ${nextStageLabel(m.plan.stage)}.`
        : `Why it is still here: company research still needs to clear before Exo can move to ${nextStageLabel(m.plan.stage)}.`;
    case "needs-prospect-selection":
      return `Why it is still here: company research is in place, but more people still need to be selected before Exo can move to ${nextStageLabel(m.plan.stage)}.`;
    case "needs-cadence":
      return `Why it is still here: people are selected, but more branches still need cadence or launch setup before Exo can move to ${nextStageLabel(m.plan.stage)}.`;
    case "targeting-ready":
      return "What this means: targeting is in place and execution can focus on ready branches.";
    default:
      return "This stage reflects where the motion sits in the targeting loop, not a literal percent complete score.";
  }
}

/** @param {any} plan */
function describePacketReadiness(plan) {
  if ((plan.prospectCount ?? 0) <= 0) {
    return "No prospect packets are ready yet because this motion does not have matched people in branch.";
  }
  if (plan.packet === "ready") {
    return `All ${plan.prospectCount} prospect packets are ready to send.`;
  }
  if (plan.packet === "partial") {
    return `Prospect packets are partial because ${plan.readyToSend} of ${plan.prospectCount} people are ready.`;
  }
  return `No prospect packets are ready yet because ${plan.readyToSend} of ${plan.prospectCount} people are ready.`;
}

/** @param {any} activity */
function renderMotionCardActivity(activity) {
  const phase = motionActivityPhase(activity);
  return (
    `<div class="mc-activity mc-activity-${escapeAttr(phase)}">` +
    `<div class="mc-cap">${iconSvg("activity", 10)}Activity</div>` +
    `<div class="mc-activity-t">${escapeHtml(motionActivityHeadline(activity))}</div>` +
    `<p class="mc-activity-note">${escapeHtml(motionActivityNote(activity))}</p>` +
    `</div>`
  );
}

/** @param {any} activity */
function renderActivity(activity) {
  const totalEntries = totalActivityEntries(activity);
  const head = `<div class="md-section">Motion activity <span>${escapeHtml(String(totalEntries))}</span></div>`;
  if (!activity || (!activity.touchCount && !activity.stagedDraftCount)) {
    return head + emptyState({ icon: "activity", message: "No touches or staged drafts are recorded on this motion yet." });
  }

  const note = (
    `<div class="activity-note">` +
    iconSvg("activity", 13) +
    `<div>${escapeHtml(motionActivityLongNote(activity))}</div>` +
    `</div>`
  );
  const tiles =
    `<div class="md-stats">` +
    `<div class="md-tile"><b>${activity.touchCount}</b><em>Touches</em></div>` +
    `<div class="md-tile"><b>${activity.inboundTouchCount}</b><em>Inbound</em></div>` +
    `<div class="md-tile"><b>${activity.outboundTouchCount}</b><em>Outbound</em></div>` +
    `<div class="md-tile"><b>${activity.stagedDraftCount}</b><em>Staged drafts</em></div>` +
    `</div>`;
  const recentWindow = activity.events?.length && totalEntries > activity.events.length
    ? `<p class="activity-subnote">Showing latest ${activity.events.length} of ${totalEntries} recorded items.</p>`
    : "";
  const timeline = activity.events?.length
    ? `<div class="motion-activity-timeline"><ol class="tl">${activity.events.map(renderActivityEvent).join("")}</ol></div>`
    : "";
  return head + note + tiles + recentWindow + timeline;
}

/** @param {any} event */
function renderActivityEvent(event) {
  const rowTone = event.tone === "bad"
    ? "tl-bad"
    : event.tone === "in"
      ? "tl-in"
      : event.tone === "out"
        ? "tl-out"
        : "tl-sys";
  return (
    `<li class="tl-item ${escapeAttr(rowTone)}">` +
    `<span class="tl-dot">${iconSvg(event.kind === "draft" ? "spark" : "activity", 12)}</span>` +
    `<div class="tl-body">` +
    `<div class="tl-head">` +
    `<span class="tl-title">${escapeHtml(event.title)}</span>` +
    `<span class="tl-status ${activityStatusClass(event.status)}">${escapeHtml(activityStatusLabel(event.status))}</span>` +
    `<span class="tl-time">${escapeHtml(formatActivityStamp(event.at))}</span>` +
    `</div>` +
    (event.detail ? `<p class="tl-detail">${escapeHtml(event.detail)}</p>` : "") +
    `</div>` +
    `</li>`
  );
}

/** @param {any} activity */
function motionActivityPhase(activity) {
  if ((activity?.touchCount ?? 0) > 0) return "live";
  if ((activity?.stagedDraftCount ?? 0) > 0) return "staged";
  return "empty";
}

/** @param {any} activity */
function motionActivityHeadline(activity) {
  if ((activity?.touchCount ?? 0) > 0) {
    return `${activity.touchCount} recorded touch${activity.touchCount === 1 ? "" : "es"}`;
  }
  if ((activity?.stagedDraftCount ?? 0) > 0) {
    return `${activity.stagedDraftCount} staged draft${activity.stagedDraftCount === 1 ? "" : "s"}`;
  }
  return "No activity recorded";
}

/** @param {any} activity */
function motionActivityNote(activity) {
  if ((activity?.touchCount ?? 0) > 0) {
    const parts = [];
    if (activity.inboundTouchCount) parts.push(`${activity.inboundTouchCount} inbound`);
    if (activity.outboundTouchCount) parts.push(`${activity.outboundTouchCount} outbound`);
    if (activity.stagedDraftCount) parts.push(`${activity.stagedDraftCount} staged draft${activity.stagedDraftCount === 1 ? "" : "s"}`);
    if (activity.latestAt) parts.push(`last ${formatActivityStamp(activity.latestAt)}`);
    return parts.join(" · ");
  }
  if ((activity?.stagedDraftCount ?? 0) > 0) {
    return `Planning exists, but no touch is recorded as sent or received${activity.latestAt ? ` · last ${formatActivityStamp(activity.latestAt)}` : ""}.`;
  }
  return "No touches or staged drafts are recorded on this motion yet.";
}

/** @param {any} activity */
function motionActivityLongNote(activity) {
  if ((activity?.touchCount ?? 0) > 0) {
    return `This motion has live recorded history: ${motionActivityNote(activity)}.`;
  }
  return `Exo has staged work here, but live engagement has not started yet: ${motionActivityNote(activity)}`;
}

/** @param {{ stageLabel?: string | null, stagePosition?: number | null, stageTotal?: number | null }} motion */
function formatMotionStageBadge(motion) {
  const label = motion.stageLabel ?? "Unknown stage";
  const position = formatStageLoopPosition(motion.stagePosition, motion.stageTotal);
  return position ? `${label} · ${position}` : label;
}

/**
 * @param {number | null | undefined} position
 * @param {number | null | undefined} total
 */
function formatStageLoopPosition(position, total) {
  if (position && total) return `${position} of ${total}`;
  return null;
}

/** @param {string | null | undefined} stage */
function nextStageLabel(stage) {
  switch (stage) {
    case "needs-motion-definition":
      return "Company targeting";
    case "needs-company-targeting":
      return "Company identity";
    case "needs-company-identity":
      return "Company research";
    case "needs-company-research":
      return "Prospect selection";
    case "needs-prospect-selection":
      return "Cadence setup";
    case "needs-cadence":
      return "Targeting ready";
    default:
      return "the next stage";
  }
}

/** @param {any} activity */
function totalActivityEntries(activity) {
  return Number(activity?.totalEventCount ?? ((activity?.touchCount ?? 0) + (activity?.stagedDraftCount ?? 0)));
}

/** @param {string | null | undefined} status */
function activityStatusClass(status) {
  if (status === "blocked") return "tl-status-blocked";
  if (status === "received") return "tl-status-received";
  if (status === "queued") return "tl-status-queued";
  if (status === "ready") return "tl-status-ready";
  if (status === "drafting") return "tl-status-drafting";
  return "tl-status-sent";
}

/** @param {string | null | undefined} status */
function activityStatusLabel(status) {
  if (!status) return "event";
  return String(status).replace(/_/g, " ");
}

/** @param {string | null | undefined} value */
function formatActivityStamp(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
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

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/**
 * @param {string} stage
 */
function titleizeQueueStage(stage) {
  switch (stage) {
    case "needs-company-identity":
      return "Needs company identity";
    case "needs-company-research":
      return "Needs company research";
    default:
      return stage.replaceAll("-", " ");
  }
}
