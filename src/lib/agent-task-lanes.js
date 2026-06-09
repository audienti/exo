// @ts-check
//
// Execution lanes split the agent queue by the resource a task occupies, so
// one host can run two workers concurrently without contention:
//
//   transport — work that goes through the user's connector/browser identity
//               (inbound sync, sends, invite cleanup). Strictly serial: one
//               LinkedIn/Gmail session per identity, and rate/anti-bot limits
//               make parallel transport work unsafe.
//   research  — native compute work (discovery, research packets, prospect
//               selection, drafting). No connector session required, so it
//               can safely run while the transport lane grinds through sync
//               slices or sends.
//
// Unknown task kinds default to the transport lane: serial execution is the
// safe assumption for anything new until it is explicitly classified.

export const AGENT_EXECUTION_LANES = /** @type {const} */ (["transport", "research"]);

const TASK_LANE_BY_KIND = {
  run_inbound_sync: "transport",
  send_message: "transport",
  reject_connection_request: "transport",
  withdraw_connection: "transport",
  company_discovery: "research",
  company_research: "research",
  prospect_selection: "research",
  prospect_research: "research",
  write_draft: "research",
};

/**
 * @param {string | null | undefined} taskKind
 * @returns {"transport" | "research"}
 */
export function getTaskExecutionLane(taskKind) {
  return TASK_LANE_BY_KIND[String(taskKind ?? "")] ?? "transport";
}

/**
 * @param {unknown} value
 * @returns {"transport" | "research" | null}
 */
export function normalizeAgentExecutionLane(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return AGENT_EXECUTION_LANES.includes(/** @type {any} */ (normalized))
    ? /** @type {"transport" | "research"} */ (normalized)
    : null;
}
