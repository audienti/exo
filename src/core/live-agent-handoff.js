// @ts-check

/**
 * @param {{
 *   runtime: string,
 *   codexCli?: string | null
 * }} input
 */
export function shouldUseCodexAgentHandoff(input) {
  const runtime = normalizeNullableString(input.runtime)?.toLowerCase() ?? null;
  return runtime === "codex"
    && process.env.CODEX_SHELL === "1";
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
 *   outputGuide?: unknown,
 *   captureScaffold?: unknown,
 *   buildPayloadCommand: string,
 *   applyCommand?: string | null,
 *   verificationCommands?: string[] | null,
 *   surfaceHints?: unknown,
 *   profileSelection?: unknown
 * }} input
 */
export function buildCodexAgentHandoffTransport(input) {
  const verificationCommands = Array.isArray(input.verificationCommands)
    ? input.verificationCommands.filter((command) => typeof command === "string" && command.trim().length)
    : [];
  const applyCommand = normalizeNullableString(input.applyCommand);
  const captureGuide = buildDefaultCaptureGuide({
    buildPayloadCommand: input.buildPayloadCommand,
    applyCommand,
    hasCaptureScaffold: input.captureScaffold !== undefined && input.captureScaffold !== null,
    hasSurfaceHints: input.surfaceHints !== undefined && input.surfaceHints !== null,
    hasProfileSelection: input.profileSelection !== undefined && input.profileSelection !== null,
    verificationCommands
  });

  return {
    kind: "agent_handoff",
    runtime: input.runtime,
    connector: input.connector,
    source: input.source,
    status: "capture_required",
    reason: `Codex desktop should inspect ${input.capability} live surfaces through native agent tools instead of shelling out to codex exec.`,
    captureRequest: {
      contractVersion: "exo-live-agent-handoff-v2",
      coldStartReady: true,
      noRepoRediscoveryRequired: true,
      capability: input.capability,
      executionMode: "native_tools_only",
      captureTransportMode: "browser_native_only",
      shellFallbackAllowed: false,
      exoCliWritebackRequired: true,
      disallowedFallbacks: [
        "codex_exec",
        "EXO_CODEX_CLI",
        "shell_subprocess"
      ],
      prompt: input.prompt,
      captureGuide,
      outputSchema: input.outputSchema,
      outputGuide: input.outputGuide ?? null,
      captureScaffold: input.captureScaffold ?? null,
      buildPayloadCommand: input.buildPayloadCommand,
      buildPayloadInputMode: "normalized_capture_json_stdin",
      buildPayloadStdinContract: "Pass the captured JSON object that matches outputSchema directly to buildPayloadCommand via stdin. Do not pass raw HTML, DOM dumps, screenshots, or network bodies.",
      rawNetworkBodiesRequired: false,
      applyCommand,
      applyInputMode: applyCommand ? "combined_inbound_sync_json_stdin" : null,
      applyStdinContract: applyCommand
        ? "Run each buildPayloadCommand first. Then merge the returned payload.accounts arrays into one object shaped like { mode: <requested-mode>, accounts: [...] } and pass that combined object to applyCommand via stdin."
        : null,
      executionChecklist: buildDefaultExecutionChecklist({
        buildPayloadCommand: input.buildPayloadCommand,
        applyCommand,
        hasCaptureScaffold: input.captureScaffold !== undefined && input.captureScaffold !== null,
        hasSurfaceHints: input.surfaceHints !== undefined && input.surfaceHints !== null,
        hasProfileSelection: input.profileSelection !== undefined && input.profileSelection !== null
      }),
      verificationCommands,
      surfaceHints: input.surfaceHints ?? null,
      profileSelection: input.profileSelection ?? null
    }
  };
}

/**
 * @param {{
 *   capability: string,
 *   expectedHandle?: string | null,
 *   profile: {
 *     id: string,
 *     label: string,
 *     browser: string,
 *     profileDirectory: string,
 *     profilePath: string,
 *     detectedProfileName?: string | null,
 *     identity?: { accounts?: Array<{ capability: string, handle: string }> }
 *   }
 * }} input
 */
export function buildChromeProfileSelection(input) {
  const expectedLabels = [
    input.profile.label,
    input.profile.profileDirectory
  ].filter((value, index, values) => typeof value === "string" && value.length && values.indexOf(value) === index);
  const identityAccounts = Array.isArray(input.profile.identity?.accounts)
    ? input.profile.identity.accounts
    : [];

  return {
    strategy: "resolved_browser_profile_only",
    mismatchStatus: "profile_selection_mismatch",
    treatConnectorSessionLabelAsNonAuthoritative: true,
    requireSignedInIdentityMatch: true,
    capability: input.capability,
    expectedHandle: normalizeNullableString(input.expectedHandle),
    displayNameMismatchAllowed: true,
    expectedProfile: {
      id: input.profile.id,
      label: input.profile.label,
      browser: input.profile.browser,
      profileDirectory: input.profile.profileDirectory,
      profilePath: input.profile.profilePath,
      detectedProfileName: input.profile.detectedProfileName ?? null,
      acceptableSessionLabels: expectedLabels,
      identityAccounts
    },
    rules: [
      "Bind to the resolved Exo Chrome profile, not whichever extension session is merely alive.",
      "If the connector exposes another session label or signed-in identity, stop and return profile_selection_mismatch instead of exploring.",
      "Do not fail on Chrome profile display-name drift alone. The resolved Exo profile directory/path and the signed-in identity are the authority.",
      "Use the connector session label and any Chrome profile display name only as hints."
    ]
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
    contractVersion: "exo-live-landing-plan-v2",
    coldStartReady: true,
    noRepoRediscoveryRequired: true,
    accountCount: handoffAccounts.length,
    accountIds: handoffAccounts.map((account) => account.account.id),
    capabilities: handoffAccounts.map((account) => account.account.capability),
    buildPayloadCommands: handoffAccounts
      .map((account) => account.transport.captureRequest?.buildPayloadCommand ?? null)
      .filter(Boolean),
    applyCommand: `exo inbound sync run ${input.userId} --input <combined-inbound-sync.json> --refresh --json`,
    verificationCommands: [
      `exo inbound sync show ${input.userId} --json`,
      `exo inbox --user ${input.userId} --json`,
      `exo daily --user ${input.userId} --json`,
      `exo next --user ${input.userId} --json`
    ],
    nextStep: "Use native agent tools only for live capture. Then use the provided Exo CLI buildPayloadCommands and applyCommand for governed writeback. Do not treat browser-native capture as permission to skip Exo CLI landing."
  };
}

/**
 * @param {{
 *   buildPayloadCommand: string,
 *   applyCommand: string | null,
 *   hasCaptureScaffold: boolean,
 *   hasSurfaceHints: boolean,
 *   hasProfileSelection: boolean,
 *   verificationCommands: string[]
 * }} input
 */
function buildDefaultCaptureGuide(input) {
  return {
    purpose: "Use native browser or connector tools for live capture, then land the governed result through Exo CLI.",
    selfContained: {
      coldStartReady: true,
      noRepoRediscoveryRequired: true,
      rawNetworkBodiesRequired: false
    },
    contractInputs: {
      outputSchema: "Return one normalized JSON object that matches outputSchema exactly.",
      captureScaffold: input.hasCaptureScaffold ? "If browser-side JavaScript is needed, use captureScaffold before inventing a larger ad hoc extractor." : null,
      surfaceHints: input.hasSurfaceHints ? "Use surfaceHints as the canonical retrieval playbook." : null,
      profileSelection: input.hasProfileSelection ? "Use profileSelection as the binding contract." : null
    },
    captureRules: [
      "Use native browser or connector tools only for live capture.",
      "Do not shell out through codex exec, EXO_CODEX_CLI, or local subprocess shortcuts for browser capture.",
      "Do not preserve raw HTML, DOM dumps, screenshots, or network bodies for Exo writeback."
    ],
    writebackRules: [
      `Send the captured JSON object to buildPayloadCommand via stdin: ${input.buildPayloadCommand}`,
      input.applyCommand
        ? `After all account payloads are built, merge payload.accounts into one combined inbound sync object and send it to applyCommand via stdin: ${input.applyCommand}`
        : "No combined applyCommand is required for this handoff. The buildPayloadCommand is the governed writeback path for this task."
    ],
    rediscoveryPolicy: "Do not reopen repo source files, CLI help, or prior chat history to rediscover stdin shape, merge rules, or verification steps unless required contract fields are missing.",
    verificationPolicy: input.verificationCommands.length
      ? "After writeback, run verificationCommands and report their literal outputs instead of inferring Exo state from browser inspection."
      : "No verificationCommands were provided for this handoff."
  };
}

/**
 * @param {{
 *   buildPayloadCommand: string,
 *   applyCommand: string | null,
 *   hasCaptureScaffold: boolean,
 *   hasSurfaceHints: boolean,
 *   hasProfileSelection: boolean
 * }} input
 */
function buildDefaultExecutionChecklist(input) {
  return [
    "Use captureGuide, surfaceHints, profileSelection, and captureScaffold as the full cold-start contract for this handoff.",
    input.hasCaptureScaffold
      ? "If browser-side JavaScript is needed, start from captureScaffold instead of inventing a larger ad hoc extractor."
      : "No captureScaffold was attached to this handoff.",
    "Use native browser or connector tools only for the live capture transport.",
    "Return one captured JSON object that matches outputSchema.",
    `Send that captured JSON object to buildPayloadCommand via stdin: ${input.buildPayloadCommand}`,
    input.applyCommand
      ? `After all account payloads are built, merge payload.accounts into one combined inbound sync object and send it to applyCommand via stdin: ${input.applyCommand}`
      : "No combined applyCommand is required for this handoff. The buildPayloadCommand performs the governed writeback target for this task.",
    "After writeback, run the listed verificationCommands and report their literal outputs instead of inferring Exo state from browser inspection."
  ];
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
