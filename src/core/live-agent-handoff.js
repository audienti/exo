// @ts-check

/**
 * @param {{
 *   runtime: string,
 *   codexCli?: string | null
 * }} input
 */
export function shouldUseCodexAgentHandoff(input) {
  const runtime = normalizeNullableString(input.runtime)?.toLowerCase() ?? null;
  const explicitCodexCli = normalizeNullableString(input.codexCli)
    ?? normalizeNullableString(process.env.EXO_CODEX_CLI)
    ?? null;

  return runtime === "codex"
    && process.env.CODEX_SHELL === "1"
    && !explicitCodexCli;
}

/**
 * @param {{ runtime: string, connector: string, source: string }} input
 */
export function buildDirectLiveTransport(input) {
  return {
    kind: "direct_runtime",
    runtime: input.runtime,
    connector: input.connector,
    source: input.source
  };
}

/**
 * @param {{
 *   capability: string,
 *   runtime: string,
 *   connector: string,
 *   source: string,
 *   prompt: string,
 *   outputSchema: unknown,
 *   buildPayloadCommand: string,
 *   surfaceHints?: unknown
 * }} input
 */
export function buildCodexAgentHandoffTransport(input) {
  return {
    kind: "agent_handoff",
    runtime: input.runtime,
    connector: input.connector,
    source: input.source,
    status: "capture_required",
    reason: `Codex desktop should inspect ${input.capability} live surfaces through native agent tools instead of shelling out to codex exec.`,
    captureRequest: {
      capability: input.capability,
      prompt: input.prompt,
      outputSchema: input.outputSchema,
      buildPayloadCommand: input.buildPayloadCommand,
      surfaceHints: input.surfaceHints ?? null
    }
  };
}

/**
 * @param {{
 *   userId: string,
 *   accounts: Array<{
 *     account: { id: string, capability: string },
 *     transport: { kind: string, captureRequest?: { buildPayloadCommand?: string | null } | null }
 *   }>
 * }} input
 */
export function buildInboundLiveLandingPlan(input) {
  const handoffAccounts = input.accounts.filter((account) => account.transport.kind === "agent_handoff");
  if (!handoffAccounts.length) {
    return null;
  }

  return {
    status: "capture_required",
    accountCount: handoffAccounts.length,
    accountIds: handoffAccounts.map((account) => account.account.id),
    capabilities: handoffAccounts.map((account) => account.account.capability),
    buildPayloadCommands: handoffAccounts
      .map((account) => account.transport.captureRequest?.buildPayloadCommand ?? null)
      .filter(Boolean),
    applyCommand: `exo inbound sync run ${input.userId} --input <combined-inbound-sync.json> --refresh --json`,
    nextStep: "Use native agent tools to gather each requested live capture, turn each capture into a governed account payload, merge the payload accounts into one inbound sync JSON object, then land that combined writeback through exo inbound sync run."
  };
}

/**
 * @param {unknown} value
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
