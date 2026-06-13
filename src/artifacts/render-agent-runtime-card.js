// @ts-check

import {
  avatar,
  btn,
  card,
  escapeHtml,
  formatOperatorSendModeLabel,
  iconSvg,
  liveActionBtn,
} from "../lib/exo-ui-components.js";

/**
 * @param {import("../core/build-operator-view.js").OperatorAgentRuntime | null | undefined} runtime
 * @param {{ interactive?: boolean }} [meta]
 * @param {{ surface?: "operator" | "queue" }} [options]
 * @returns {string}
 */
export function renderAgentRuntimeCard(runtime, meta = {}, options = {}) {
  if (!runtime) return "";
  const surface = options.surface ?? "operator";
  const showMeta = options.showMeta ?? surface !== "queue";
  const showActions = options.showActions ?? surface !== "queue";
  const chips = showMeta ? renderAgentRuntimeMeta(runtime) : "";
  const facts = Array.isArray(runtime.statusFacts) && runtime.statusFacts.length
    ? `<div class="nm-chips">${runtime.statusFacts.map((fact) => `<span class="surface-ref">${escapeHtml(fact)}</span>`).join("")}</div>`
    : "";
  const nextAction = runtime.nextAction
    ? `<div class="nm-sub">Next action: ${escapeHtml(runtime.nextAction)}</div>`
    : "";

  const actions = [];
  if (showActions) {
    if (runtime.canRunNow) {
      actions.push(
        liveActionBtn({
          writer: "runAgentQueuePass",
          args: {},
          variant: "primary",
          size: "md",
          icon: "cpu",
          label: runtime.runLabel ?? "Run agent now",
        }),
      );
    } else if (runtime.state === "running") {
      actions.push(`<span class="surface-ref">${iconSvg("clock", 12)}Background pass in progress</span>`);
    }
    if (surface === "operator" && meta.interactive) {
      actions.push(btn({ variant: "secondary", size: "md", icon: "queue", label: "Open queue", href: "/queue" }));
    }
  }

  return card({
    stakes: runtime.state === "off" && runtime.queueCount > 0 ? "high" : "medium",
    className: "next-move agent-runtime",
    children:
      `<div class="nm-flag">${iconSvg("cpu", 13)} AGENT</div>` +
      `<div class="nm-body">` +
      avatar({
        name: "Agent runtime",
        initials: "AG",
        size: 48,
        accent: runtime.state === "off" ? "#f59e0b" : "#3b82f6",
      }) +
      `<div class="nm-main">` +
      `<div class="nm-title">${escapeHtml(runtime.headline)}</div>` +
      `<div class="nm-sub">${escapeHtml(runtime.detail)}</div>` +
      chips +
      facts +
      nextAction +
      `</div>` +
      (actions.length ? `<div class="nm-actions">${actions.join("")}</div>` : "") +
      `</div>`,
  });
}

/**
 * One-line collapsed disclosure for surfaces where the runtime is context
 * rather than the main event (the queue page). Headline + detail stay in the
 * summary; status facts and the next action expand on demand. The bar opens
 * itself when the agent needs attention so problems are never hidden.
 *
 * @param {import("../core/build-operator-view.js").OperatorAgentRuntime | null | undefined} runtime
 * @param {{ side?: string | null, forceOpen?: boolean, embedded?: boolean }} [options]
 * @returns {string}
 */
export function renderAgentRuntimeBar(runtime, options = {}) {
  if (!runtime) return "";
  const needsAttention = runtime.state === "off";
  const open = needsAttention || options.forceOpen ? " open" : "";
  const className = options.embedded ? "agent-bar agent-bar-embedded" : "agent-bar";
  const facts = Array.isArray(runtime.statusFacts) && runtime.statusFacts.length
    ? `<div class="nm-chips">${runtime.statusFacts.map((fact) => `<span class="surface-ref">${escapeHtml(fact)}</span>`).join("")}</div>`
    : "";
  const nextAction = runtime.nextAction
    ? `<div class="nm-sub">Next action: ${escapeHtml(runtime.nextAction)}</div>`
    : "";
  const body = facts || nextAction ? `<div class="ab-body">${facts}${nextAction}</div>` : "";

  return (
    `<details class="${className}"${open}>` +
    `<summary>` +
    avatar({
      name: "Agent runtime",
      initials: "AG",
      size: 26,
      accent: needsAttention ? "#f59e0b" : "#3b82f6",
    }) +
    `<span class="ab-title">${escapeHtml(runtime.headline)}</span>` +
    `<span class="ab-detail">${escapeHtml(runtime.detail)}</span>` +
    (options.side ? `<span class="ab-side">${options.side}</span>` : "") +
    iconSvg("chevron", 14, "ab-chev") +
    `</summary>` +
    body +
    `</details>`
  );
}

/**
 * @param {import("../core/build-operator-view.js").OperatorAgentRuntime | null | undefined} runtime
 * @param {{ className?: string, iconSize?: number }} [options]
 * @returns {string}
 */
export function renderAgentRuntimeMeta(runtime, options = {}) {
  if (!runtime) return "";
  const className = options.className ?? "nm-chips";
  const iconSize = Number.isFinite(options.iconSize) ? Number(options.iconSize) : 12;
  const chips = [
    runtime.cadenceLabel ? `<span class="surface-ref">${iconSvg("clock", iconSize)}${escapeHtml(runtime.cadenceLabel)}</span>` : null,
    runtime.sendMode ? `<span class="cap-ref">${iconSvg("cpu", iconSize)}${escapeHtml(formatOperatorSendModeLabel(runtime.sendMode))}</span>` : null,
    runtime.lastPassSummary ? `<span class="surface-ref">${iconSvg("spark", iconSize)}${escapeHtml(runtime.lastPassSummary)}</span>` : null,
  ]
    .filter(Boolean)
    .join("");
  return chips ? `<div class="${className}">${chips}</div>` : "";
}
