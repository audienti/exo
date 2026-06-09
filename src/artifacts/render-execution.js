// @ts-check
//
// Render the Execution surface (Exo UI Build Spec) as static HTML.
//
// A roster of execution users; each opens to assigned motions, connected
// accounts, and capability coverage. Ownership and transport stay separate
// from GTM objects.

import {
  avatar,
  btn,
  countChip,
  emptyState,
  escapeAttr,
  escapeHtml,
  iconSvg,
  readinessBar,
  renderShell,
  stateDot,
  truthTag,
} from "../lib/exo-ui-components.js";

/**
 * @param {ReturnType<import("../core/build-execution-view.js").buildExecutionViewModel>} model
 * @param {{ user?: { label?: string } | null, generatedAt?: string, regenerateCommand?: string }} [meta]
 * @returns {string}
 */
export function renderExecutionPage(model, meta = {}) {
  // Interactive mode routes each user to /users/:id; static export keeps the
  // anchored detail sections so the file stays self-contained.
  const detailSections = meta.interactive
    ? ""
    : `<div class="exec-sections">${model.users.map((u) => renderUserDetail(u, meta)).join("")}</div>`;

  const body =
    `<div class="dom-wrap" id="execution-top">` +
    renderIntro(model) +
    renderRoster(model.users, meta) +
    `</div>` +
    detailSections +
    `<div class="dom-wrap">${renderFooter(meta)}</div>`;

  return renderShell({
    title: `Exo — Users${meta.user?.label ? ` · ${meta.user.label}` : ""}`,
    activeId: "execution",
    sectionLabel: "Users",
    detailLabel: null,
    body,
    interactive: meta.interactive,
    agentRuntime: meta.agentRuntime ?? null,
  });
}

/**
 * Render one user as its own routed detail page (interactive UI).
 *
 * @param {any} user
 * @param {{ user?: { label?: string } | null, generatedAt?: string, regenerateCommand?: string, interactive?: boolean }} [meta]
 * @returns {string}
 */
export function renderUserDetailPage(user, meta = {}) {
  const body = `<div class="dom-wrap" id="execution-top">${renderUserDetail(user, { ...meta, asPage: true })}</div>`;
  return renderShell({
    title: `Exo — ${user.label}`,
    activeId: "execution",
    sectionLabel: "Users",
    detailLabel: user.label,
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
function userHref(id, meta) {
  return meta.interactive ? `/users/${encodeURIComponent(id)}` : `#u-${id}`;
}

/**
 * @param {string} motionId
 * @param {{ interactive?: boolean }} meta
 */
function execMotionHref(motionId, meta) {
  return meta.interactive ? `/motions/${encodeURIComponent(motionId)}` : `../motions.html#m-${motionId}`;
}

/**
 * @param {string} userId
 * @param {{ interactive?: boolean }} meta
 */
function userConnectionsHref(userId, meta) {
  return meta.interactive ? `/users/${encodeURIComponent(userId)}/connections` : `#u-${userId}-connections`;
}

/** @param {any} model */
function renderIntro(model) {
  return (
    `<div class="op-intro">` +
    `<div>` +
    `<h1>Users</h1>` +
    `<p class="op-line">The people who own the work, and which transport identity is real. Open a user to see their motions and connected accounts.</p>` +
    `</div>` +
    `<div class="op-stat"><span><b>${model.counts.executionCapable}</b> execution-ready</span><i></i><span><b>${model.counts.users}</b> users</span></div>` +
    `</div>`
  );
}

/**
 * @param {any[]} users
 * @param {{ interactive?: boolean }} meta
 */
function renderRoster(users, meta) {
  if (!users.length) {
    return emptyState({ icon: "users", message: "No execution users yet." });
  }
  return (
    `<div class="user-cards">` +
    users
      .map(
        (u) =>
          `<a class="user-card" href="${escapeAttr(userHref(u.id, meta))}">` +
          avatar({ initials: u.initials, name: u.label, size: 40, accent: "#3b82f6" }) +
          `<div class="uc-id"><span class="uc-name">${escapeHtml(u.label)}</span><span class="uc-sub">${escapeHtml(u.owner ?? "execution user")}</span></div>` +
          `<div class="uc-meta"><span><b>${u.motionCount}</b> motions</span><span><b>${u.accountCount}</b> accounts</span></div>` +
          iconSvg("chevronR", 15, "uc-go") +
          `</a>`,
      )
      .join("") +
    `</div>`
  );
}

/**
 * @param {any} u
 * @param {{ interactive?: boolean, asPage?: boolean }} [meta]
 */
function renderUserDetail(u, meta = {}) {
  const backLink = meta.asPage
    ? ""
    : `<a class="exec-back" href="${escapeAttr(meta.interactive ? "/users" : "#execution-top")}">${iconSvg("chevron", 12)} All users</a>`;
  const head =
    `<div class="op-intro">` +
    `<div>` +
    backLink +
    `<h1>${escapeHtml(u.label)}</h1>` +
    `<p class="op-line">${escapeHtml(u.owner ?? "execution user")}${u.working ? ` · <span class="exec-working">${iconSvg("clock", 11)}${escapeHtml(u.working)}</span>` : ""}</p>` +
    (meta.interactive
      ? `<p class="op-line">${btn({ variant: "secondary", size: "sm", icon: "link", label: "Open connections", href: userConnectionsHref(u.id, meta) })}</p>`
      : "") +
    `</div>` +
    `</div>`;

  const motionsPanel =
    `<div class="exec-card">` +
    `<div class="ws-panel-head">${iconSvg("layers", 15)}<h3>Assigned motions</h3><span class="ws-head-right">${countChip(u.assignedMotions.length)}</span></div>` +
    (u.assignedMotions.length
      ? u.assignedMotions
          .map(
            (m) =>
              `<a class="exec-mrow" href="${escapeAttr(execMotionHref(m.id, meta))}">` +
              stateDot(m.state) +
              `<span class="exec-mname">${escapeHtml(m.name)}</span>` +
              `<span class="exec-mready">${readinessBar(m.readiness)}</span>` +
              `<span class="exec-mmeta">${m.prospectCount} prospects</span>` +
              `</a>`,
          )
          .join("")
      : emptyState({ icon: "layers", message: "No motions assigned." })) +
    `</div>`;

  const accountsPanel =
    `<div class="exec-card">` +
    `<div class="ws-panel-head">${iconSvg("link", 15)}<h3>Connected accounts</h3><span class="ws-head-right">${countChip(u.accounts.length)}</span></div>` +
    (u.accounts.length
      ? u.accounts
          .map(
            (a) => {
              const accountTitle = a.label && a.label !== a.handle ? a.label : a.handle;
              const accountMeta = a.label && a.label !== a.handle
                ? `${a.handle} · ${a.capability}${a.preferred ? " · preferred" : ""}`
                : `${a.capability}${a.preferred ? " · preferred" : ""}`;
              return (
                `<div class="exec-acct">` +
                iconSvg(a.kind === "gmail" ? "mail" : a.kind === "linkedin" ? "linkedin" : "cpu", 15, "wa-ic") +
                `<div class="wa-id"><span class="wa-handle">${escapeHtml(accountTitle)}</span><span class="wa-cap">${escapeHtml(accountMeta)}</span></div>` +
                truthTag(a.truth) +
                `</div>`
              );
            }
          )
          .join("") +
        (u.harness.length
          ? u.harness
              .map(
                (h) =>
                  `<div class="exec-acct">` +
                  iconSvg("cpu", 15, "wa-ic") +
                  `<div class="wa-id"><span class="wa-handle">${escapeHtml(h.runtime)} · ${escapeHtml(h.connector)}</span><span class="wa-cap">runtime harness</span></div>` +
                  truthTag(h.truth) +
                  `</div>`,
              )
              .join("")
          : "")
      : emptyState({ icon: "link", message: "No connected accounts." })) +
    `</div>`;

  const unclaimedPanel =
    `<div class="exec-card">` +
    `<div class="ws-panel-head">${iconSvg("refresh", 15)}<h3>Unclaimed accounts</h3><span class="ws-head-right">${countChip(u.unclaimedAccounts.length)}</span></div>` +
    (u.unclaimedAccounts.length
      ? u.unclaimedAccounts.map((account) => renderUnclaimedAccount(account, u)).join("")
      : emptyState({ icon: "refresh", message: "No unclaimed runtime accounts." })) +
    `</div>`;

  const coverage =
    `<div class="md-section">Capability coverage <span>${u.capabilityCoverage.length}</span></div>` +
    (u.capabilityCoverage.length
      ? `<div class="cap-cover">` +
        u.capabilityCoverage
          .map((c) => `<span class="cap-pill">${escapeHtml(c.capability)}${truthTag(c.truth)}</span>`)
          .join("") +
        `</div>`
      : emptyState({ icon: "cpu", message: "No verified capabilities yet." }));

  return (
    `<section class="dom-wrap exec-detail" id="u-${escapeAttr(u.id)}">` +
    head +
    `<div class="exec-two">${motionsPanel}${accountsPanel}</div>` +
    unclaimedPanel +
    coverage +
    `</section>`
  );
}

/**
 * @param {any} account
 * @param {any} user
 */
function renderUnclaimedAccount(account, user) {
  const title = account.title ?? `${account.capability} via ${account.runtime} · ${account.connector}`;
  const reuseNote = account.handle && account.handleSourceType === "browser-profile"
    ? `Will reuse the browser-backed handle ${account.handle}.`
    : account.subtitle ?? account.reason;

  return (
    `<div class="exec-claim-row">` +
    iconSvg(account.kind === "gmail" ? "mail" : account.kind === "linkedin" ? "linkedin" : "cpu", 15, "wa-ic") +
    `<div class="exec-claim-meta">` +
    `<span class="wa-handle">${escapeHtml(title)}</span>` +
    `<span class="wa-cap">${escapeHtml(reuseNote)}</span>` +
    `</div>` +
    truthTag(account.truth) +
    renderClaimControl(account, user) +
    `</div>`
  );
}

/**
 * @param {any} account
 * @param {any} user
 */
function renderClaimControl(account, user) {
  if (!account.canClaim || !account.claimArgs) {
    return `<span class="exec-claim-state">${escapeHtml(renderClaimStateLabel(account))}</span>`;
  }

  if (!account.requiresHandle) {
    return actionBtn({
      writer: "claimRuntimeAccount",
      args: account.claimArgs,
      label: "Claim",
      icon: "check",
    });
  }

  const fieldName = claimFieldName(user.id, account.capability, account.runtime, account.connector, account.providerAccountId ?? null);
  return (
    `<span class="exec-claim-host" data-exo-writer="claimRuntimeAccount" data-exo-args="${escapeAttr(JSON.stringify(account.claimArgs))}" data-exo-fields="${escapeAttr(`${fieldName}:handle`)}">` +
    `<input class="compose-input exec-claim-input" name="${escapeAttr(fieldName)}" type="text" placeholder="${escapeAttr(`${account.capability} handle`)}" />` +
    btn({ variant: "secondary", size: "sm", icon: "check", label: "Claim" }) +
    `</span>`
  );
}

/** @param {any} account */
function renderClaimStateLabel(account) {
  if (account.action === "session_unavailable") return "session required";
  if (account.action === "identity_unresolved") return "identity blocked";
  if (account.action === "handle_mismatch") return "mismatch";
  return account.status;
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

/**
 * @param {string} userId
 * @param {string} capability
 * @param {string} runtime
 * @param {string} connector
 * @param {string | null} providerAccountId
 */
function claimFieldName(userId, capability, runtime, connector, providerAccountId) {
  const suffix = providerAccountId ? `-${providerAccountId}` : "";
  return `claim-${userId}-${capability}-${runtime}-${connector}${suffix}`.replace(/[^a-zA-Z0-9_-]+/g, "-");
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
