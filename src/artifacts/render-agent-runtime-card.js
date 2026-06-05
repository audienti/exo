// @ts-check

import {
  avatar,
  btn,
  card,
  escapeHtml,
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
  const chips = [
    runtime.cadenceLabel ? `<span class="surface-ref">${iconSvg("clock", 12)}${escapeHtml(runtime.cadenceLabel)}</span>` : null,
    runtime.sendMode ? `<span class="cap-ref">${iconSvg("cpu", 12)}${escapeHtml(runtime.sendMode)} mode</span>` : null,
    runtime.lastPassSummary ? `<span class="surface-ref">${iconSvg("spark", 12)}${escapeHtml(runtime.lastPassSummary)}</span>` : null,
  ]
    .filter(Boolean)
    .join("");

  const actions = [];
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
      (chips ? `<div class="nm-chips">${chips}</div>` : "") +
      `</div>` +
      `<div class="nm-actions">${actions.join("")}</div>` +
      `</div>`,
  });
}
