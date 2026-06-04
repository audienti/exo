// @ts-check

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deriveLinkedinCompanyName } from "../lib/linkedin-headline.js";
import { buildLinkedinQuickSurfaceHints } from "../lib/live-surface-hints.js";
import { buildLinkedinQuickCaptureScaffold } from "../lib/linkedin-quick-capture-scaffold.js";
import { readUnipileConfig } from "../lib/unipile-config.js";
import { browserProfileSchema } from "../schema/browser-profile.js";
import { linkedinInboundSyncCaptureSchema } from "../schema/linkedin-capture.js";
import { userSchema } from "../schema/user.js";
import { buildLinkedinInboundSyncPayload, resolveLinkedinAccount } from "./inbound-linkedin-sync.js";
import {
  buildAgentHandoffTransport,
  buildChromeProfileSelection,
  buildCodexAgentHandoffTransport,
  buildDirectLiveTransport,
  shouldUseCodexAgentHandoff
} from "./live-agent-handoff.js";
import { probeUserHarnessConnections } from "./probe-user-harness-connections.js";
import { resolveRuntimeHarnessConnection } from "./runtime-harness-resolution.js";

const DEFAULT_LINKEDIN_ITEM_LIMIT = 20;

const linkedinActorFieldsSchema = {
  actorName: { type: ["string", "null"] },
  actorTitle: { type: ["string", "null"] },
  actorCompanyName: { type: ["string", "null"] },
  actorHandle: { type: ["string", "null"] },
  actorProfileUrl: { type: ["string", "null"], format: "uri" },
  actorLinkedinPublicId: { type: ["string", "null"] },
  actorLinkedinMemberId: { type: ["string", "null"] },
  actorAvatarSourceUrl: { type: ["string", "null"], format: "uri" },
  sourceUrl: { type: ["string", "null"], format: "uri" },
  motionId: { type: ["string", "null"] },
  companyId: { type: ["string", "null"] },
  prospectId: { type: ["string", "null"] },
  notes: { type: ["string", "null"] }
};

const linkedinSurfaceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "checkedAt",
    "itemCount",
    "visibleTotalCount",
    "captureCompleteness",
    "requestedMode",
    "actualMode",
    "reconcileRequired",
    "reconcileReason",
    "exhaustionStatus",
    "exhaustionReason",
    "paginationAttempted",
    "terminalSignalSeen",
    "stalledPassCount",
    "error",
    "items"
  ],
  properties: {
    status: {
      type: "string",
      enum: ["success", "warning", "failed"]
    },
    checkedAt: {
      type: ["string", "null"],
      format: "date-time"
    },
    itemCount: {
      type: ["integer", "null"],
      minimum: 0
    },
    visibleTotalCount: {
      type: ["integer", "null"],
      minimum: 0
    },
    captureCompleteness: {
      type: ["string", "null"],
      enum: ["complete", "partial_visible_slice", "failed", null]
    },
    requestedMode: {
      type: ["string", "null"],
      enum: ["quick", "normal", "full", null]
    },
    actualMode: {
      type: ["string", "null"],
      enum: ["quick", "normal", "full", null]
    },
    reconcileRequired: {
      type: ["boolean", "null"]
    },
    reconcileReason: {
      type: ["string", "null"]
    },
    exhaustionStatus: {
      type: ["string", "null"],
      enum: ["complete", "incomplete", "blocked", null]
    },
    exhaustionReason: {
      type: ["string", "null"]
    },
    paginationAttempted: {
      type: ["boolean", "null"]
    },
    terminalSignalSeen: {
      type: ["boolean", "null"]
    },
    stalledPassCount: {
      type: ["integer", "null"],
      minimum: 0
    },
    error: {
      type: ["string", "null"]
    },
    items: {
      type: "array"
    }
  }
};

const linkedinLiveCaptureOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "sentInvitations",
    "receivedInvitations",
    "messagingInbox",
    "profileViews",
    "followersList",
    "followingList"
  ],
  properties: {
    mode: {
      type: "string",
      enum: ["quick", "full"]
    },
    sentInvitations: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["invitationId", "kind", "observedAt", "eventAt", "summary", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              invitationId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["connection_request_pending", "connection_request_accepted", "connection_request_withdrawn"]
              },
              observedAt: { type: "string", format: "date-time" },
              eventAt: { type: ["string", "null"], format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    },
    receivedInvitations: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["invitationId", "kind", "observedAt", "summary", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              invitationId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["connection_request_received", "connection_request_accepted", "connection_request_declined"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    },
    messagingInbox: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["threadId", "kind", "observedAt", "summary", "threadUrl", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              threadId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["message_received", "thread_updated", "inbound_reply_received"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              threadUrl: { type: ["string", "null"], format: "uri" },
              subject: { type: ["string", "null"] },
              messages: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["direction", "sentAt", "fromName", "fromHandle", "body"],
                  properties: {
                    id: { type: ["string", "null"] },
                    direction: {
                      type: "string",
                      enum: ["inbound", "outbound", "unknown"]
                    },
                    sentAt: { type: ["string", "null"], format: "date-time" },
                    fromName: { type: ["string", "null"] },
                    fromHandle: { type: ["string", "null"] },
                    body: { type: "string", minLength: 1 }
                  }
                }
              },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    },
    profileViews: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["viewId", "kind", "observedAt", "eventAt", "summary", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              viewId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["profile_view_after_touch", "profile_view_received"]
              },
              observedAt: { type: "string", format: "date-time" },
              eventAt: { type: ["string", "null"], format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    },
    followersList: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["entryId", "kind", "observedAt", "summary", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              entryId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["follower_added", "follower_confirmed"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    },
    followingList: {
      ...linkedinSurfaceSchema,
      properties: {
        ...linkedinSurfaceSchema.properties,
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["entryId", "kind", "observedAt", "summary", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              entryId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["follow_state_changed", "follow_state_confirmed"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              ...linkedinActorFieldsSchema
            }
          }
        }
      }
    }
  }
};

/**
 * @param {unknown} rawUser
 * @param {unknown[]} rawProfiles
 * @param {{
 *   accountId?: string | null,
 *   mode?: import("../schema/inbound.js").inboundSyncPlanModeSchema._type | null,
 *   runtime?: string | null,
 *   connector?: string | null,
 *   limit?: number | null,
 *   codexCli?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null
 *   unipileHttpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null
 * }} [options]
 */
export async function buildLiveLinkedinInboundSyncPayload(rawUser, rawProfiles, options = {}) {
  const user = userSchema.parse(rawUser);
  const profiles = rawProfiles.map((profile) => browserProfileSchema.parse(profile));
  const account = resolveLinkedinAccount(user, normalizeNullableString(options.accountId));
  const mode = options.mode ?? "quick";
  const liveSource = resolveLinkedinLiveSource(user, profiles, account, {
    runtime: options.runtime ?? null,
    connector: options.connector ?? null,
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });
  const profile = liveSource.profile;
  const harnessConnection = liveSource.harnessConnection;
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LINKEDIN_ITEM_LIMIT, "limit");

  const probe = liveSource.probe ?? buildStoredHarnessProbe(user, harnessConnection, {
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });

  const runtime = harnessConnection.runtime.trim().toLowerCase();
  const connector = harnessConnection.connector.trim().toLowerCase();
  const transportBase = {
    runtime,
    connector,
    source: liveSource.source
  };

  /** @type {unknown} */
  let rawCapture;
  let transport = buildDirectLiveTransport(transportBase);
  if (probe.detectedStatus !== "available") {
    rawCapture = buildFailedLinkedinCapture(
      mode,
      `${harnessConnection.runtime}:${harnessConnection.connector} is not available for LinkedIn live sync: ${probe.reason}`
    );
  } else {
    const prompt = buildLinkedinLiveCapturePrompt({
      connector,
      handle: account.handle,
      profile,
      limit,
      mode
    });
    const directUnipileCapture = await maybeCaptureLinkedinQuickSurfacesThroughUnipile({
      account,
      connector,
      mode,
      limit,
      codexHome: options.codexHome ?? normalizeNullableString(process.env.CODEX_HOME) ?? null,
      httpGetImpl: options.unipileHttpGetImpl ?? null
    });
    if (directUnipileCapture) {
      rawCapture = directUnipileCapture;
    } else {
      const shouldUseAgentHandoff = shouldUseCodexAgentHandoff({
        runtime,
        codexCli: options.codexCli ?? null
      }) || (profile === null && ["codex", "claude"].includes(runtime));
      if (shouldUseAgentHandoff) {
        const surfaceHints = buildLinkedinQuickSurfaceHints({ limit });
        const outputGuide = buildLinkedinCaptureOutputGuide({ mode, limit });
        const captureScaffold = buildLinkedinQuickCaptureScaffold({ limit });
        const handoffBuilder = profile === null ? buildAgentHandoffTransport : buildCodexAgentHandoffTransport;

        return {
          user: {
            id: user.id,
            label: user.label,
            owner: user.owner
          },
          account: {
            id: account.id,
            handle: account.handle,
            capability: account.capability,
            sourceType: account.sourceType,
            browserProfileId: account.browserProfileId,
            harnessConnectionId: account.harnessConnectionId
          },
          profile: profile
            ? {
                id: profile.id,
                label: profile.label,
                browser: profile.browser,
                profileDirectory: profile.profileDirectory,
                profilePath: profile.profilePath,
                detectedProfileName: profile.detectedProfileName,
                identityAccounts: profile.identity.accounts
              }
            : null,
          probe,
          transport: handoffBuilder({
            capability: "linkedin",
            runtime,
            connector,
            source: liveSource.source,
            captureTransportMode: profile ? "browser_native_only" : "connector_native_only",
            prompt: buildLinkedinLiveCapturePrompt({
              connector,
              handle: account.handle,
              profile,
              limit,
              mode,
              mentionStructuredHints: true
            }),
            outputSchema: linkedinLiveCaptureOutputSchema,
            outputGuide,
            captureScaffold,
            buildPayloadCommand: `exo inbound sync linkedin ${user.id} --account ${account.id} --input - --json`,
            applyCommand: `exo inbound sync run ${user.id} --input <combined-inbound-sync.json> --refresh --json`,
            verificationCommands: [
              `exo inbound sync show ${user.id} --json`,
              `exo inbound observations list ${user.id} --capability linkedin --surface linkedin-sent-invitations --json`,
              `exo next --user ${user.id} --json`
            ],
            surfaceHints,
            profileSelection: profile
              ? buildChromeProfileSelection({
                  capability: "linkedin",
                  expectedHandle: account.handle,
                  profile
                })
              : null
          }),
          capture: null,
          payload: null
        };
      }

      try {
        rawCapture = await captureLinkedinQuickSurfaces({
          runtime,
          connector,
          handle: account.handle,
          profile,
          limit,
          codexCli: options.codexCli ?? normalizeNullableString(process.env.EXO_CODEX_CLI) ?? "codex",
          codexHome: options.codexHome ?? normalizeNullableString(process.env.CODEX_HOME) ?? null,
          claudeCli: options.claudeCli ?? normalizeNullableString(process.env.EXO_CLAUDE_CLI) ?? "claude",
          prompt
        });
      } catch (error) {
        rawCapture = buildFailedLinkedinCapture(mode, error instanceof Error ? error.message : String(error));
      }
    }
  }

  const built = buildLinkedinInboundSyncPayload(user, {
    accountId: account.id,
    capture: rawCapture
  });

  return {
    user: {
      id: user.id,
      label: user.label,
      owner: user.owner
    },
    account: {
      id: account.id,
      handle: account.handle,
      capability: account.capability,
      sourceType: account.sourceType,
      browserProfileId: account.browserProfileId,
      harnessConnectionId: account.harnessConnectionId
    },
    profile: profile
      ? {
          id: profile.id,
          label: profile.label,
          browser: profile.browser,
          profileDirectory: profile.profileDirectory,
          profilePath: profile.profilePath,
          detectedProfileName: profile.detectedProfileName,
          identityAccounts: profile.identity.accounts
        }
      : null,
    probe,
    transport,
    capture: built.capture,
    payload: built.payload
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {{ runtime?: string | null, connector?: string | null, codexHome?: string | null, claudeCli?: string | null }} input
 */
function resolveLinkedinLiveSource(user, profiles, account, input) {
  if (account.sourceType === "browser-profile") {
    throw new Error("Profile-backed LinkedIn accounts are no longer supported for live sync. Map a managed connector account instead.");
  }

  return {
    profile: null,
    harnessConnection: requireLinkedinHarnessConnection(user, account, input),
    probe: null,
    source: "stored_harness_connection"
  };
}

/**
 * @param {import("../schema/browser-profile.js").browserProfileSchema._type[]} profiles
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 */
function resolveLinkedinBrowserProfile(profiles, account) {
  if (account.sourceType !== "browser-profile") {
    throw new Error(`LinkedIn live sync currently requires a browser-profile-backed LinkedIn account. Account ${account.id} is ${account.sourceType}.`);
  }

  const profile = profiles.find((candidate) => candidate.id === account.browserProfileId) ?? null;
  if (!profile) {
    throw new Error(`Browser profile not found for LinkedIn account ${account.id}.`);
  }

  if (profile.browser !== "chrome") {
    throw new Error(`LinkedIn live sync currently supports Chrome-backed profiles only. ${profile.label} is ${profile.browser}.`);
  }

  if (profile.status !== "ready" || !profile.verifiedCapabilities.includes("linkedin")) {
    throw new Error(`LinkedIn live sync requires a trusted Chrome profile with verified linkedin capability. ${profile.label} is ${profile.status}.`);
  }

  return profile;
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {{ runtime?: string | null, connector?: string | null }} input
 */
function resolveLinkedinBrowserHarnessConnection(user, input) {
  const runtimeFilter = normalizeNullableString(input.runtime)?.toLowerCase() ?? null;
  const connectorFilter = normalizeNullableString(input.connector)?.toLowerCase() ?? "chrome";

  if (connectorFilter !== "chrome") {
    throw new Error(`LinkedIn live sync currently supports runtime:chrome harness connections only. Received connector ${connectorFilter}.`);
  }

  return resolveRuntimeHarnessConnection(user, {
    runtime: runtimeFilter,
    connector: connectorFilter,
    codexHome: input.codexHome ?? null,
    claudeCli: input.claudeCli ?? null,
    multipleMessage: (choices) =>
      `Multiple supported LinkedIn browser harnesses exist for ${user.label} (${choices.join(", ")}). Pass --runtime explicitly.`
  });
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {{ runtime?: string | null, connector?: string | null }} input
 */
function requireLinkedinHarnessConnection(user, account, input) {
  if (account.sourceType !== "harness-connection") {
    throw new Error(`LinkedIn account ${account.id} does not resolve through a harness connection.`);
  }

  const harnessConnection = user.harnessConnections.find((candidate) => candidate.id === account.harnessConnectionId) ?? null;
  if (!harnessConnection) {
    throw new Error(`Harness connection not found for LinkedIn account ${account.id}.`);
  }

  const connectorFilter = normalizeNullableString(input.connector)?.toLowerCase() ?? null;
  const resolvedConnector = harnessConnection.connector.trim().toLowerCase();
  if (connectorFilter && resolvedConnector !== connectorFilter) {
    throw new Error(`LinkedIn account ${account.id} resolves through ${harnessConnection.runtime}:${harnessConnection.connector}, not ${harnessConnection.runtime}:${connectorFilter}.`);
  }

  const runtime = harnessConnection.runtime.trim().toLowerCase();
  const runtimeFilter = normalizeNullableString(input.runtime)?.toLowerCase() ?? null;
  if (runtimeFilter && runtime !== runtimeFilter) {
    throw new Error(`LinkedIn account ${account.id} resolves through ${harnessConnection.runtime}:${harnessConnection.connector}, not ${runtimeFilter}:${resolvedConnector}.`);
  }

  if (!["codex", "claude"].includes(runtime)) {
    throw new Error(`LinkedIn live sync currently supports codex:${resolvedConnector} or claude:${resolvedConnector}, found ${harnessConnection.runtime}:${harnessConnection.connector}.`);
  }

  return harnessConnection;
}

/**
 * @param {{
 *   runtime: string,
 *   connector: string,
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type | null,
 *   limit: number,
 *   codexCli: string,
 *   codexHome: string | null,
 *   claudeCli: string
 * }} input
 */
async function captureLinkedinQuickSurfaces(input) {
  if (input.runtime === "codex") {
    return captureLinkedinQuickSurfacesThroughCodex(input);
  }

  if (input.runtime === "claude") {
    return captureLinkedinQuickSurfacesThroughClaude(input);
  }

  throw new Error(`LinkedIn live sync is not implemented for runtime ${input.runtime}.`);
}

/**
 * @param {{
 *   connector: string,
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type | null,
 *   limit: number,
 *   codexCli: string,
 *   codexHome: string | null,
 *   prompt: string
 * }} input
 */
async function captureLinkedinQuickSurfacesThroughCodex(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-linkedin-live-"));
  const schemaPath = path.join(tempDir, "linkedin-capture.schema.json");
  const outputPath = path.join(tempDir, "linkedin-capture.json");
  fs.writeFileSync(schemaPath, JSON.stringify(linkedinLiveCaptureOutputSchema, null, 2));

  try {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--ignore-rules",
      "--ephemeral",
      "--color",
      "never",
      "-C",
      tempDir,
      "--output-schema",
      schemaPath,
      "-o",
      outputPath,
      input.prompt
    ];
    const env = {
      ...process.env
    };
    if (input.codexHome) {
      env.CODEX_HOME = input.codexHome;
    }

    await execFileAsync(input.codexCli, args, {
      cwd: tempDir,
      env,
      maxBuffer: 10 * 1024 * 1024
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Codex LinkedIn capture did not produce an output file.");
    }

    const parsed = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    return linkedinInboundSyncCaptureSchema.parse(parsed);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   connector: string,
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type | null,
 *   limit: number,
 *   claudeCli: string
 *   prompt: string
 * }} input
 */
async function captureLinkedinQuickSurfacesThroughClaude(input) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "exo-linkedin-live-claude-"));
  const schema = JSON.stringify(linkedinLiveCaptureOutputSchema);
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    schema,
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    input.prompt
  ];

  try {
    const { stdout } = await execFileAsync(input.claudeCli, args, {
      cwd: tempDir,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });

    let parsed;
    try {
      parsed = JSON.parse(String(stdout));
    } catch (error) {
      throw new Error(`Claude LinkedIn capture returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const capture = parsed?.structured_output;
    if (!capture) {
      throw new Error("Claude LinkedIn capture did not return structured_output.");
    }

    return linkedinInboundSyncCaptureSchema.parse(capture);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{
 *   account: import("../schema/user.js").userConnectedAccountSchema._type,
 *   connector: string,
 *   mode: string,
 *   limit: number,
 *   codexHome: string | null,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null
 * }} input
 */
async function maybeCaptureLinkedinQuickSurfacesThroughUnipile(input) {
  if (input.connector !== "unipile") {
    return null;
  }

  const providerAccountId = normalizeNullableString(input.account.providerAccountId);
  if (!providerAccountId) {
    return null;
  }

  const { apiKey, baseUrl } = readUnipileConfig(input.codexHome);
  if (!apiKey) {
    return null;
  }

  return captureLinkedinQuickSurfacesThroughUnipile({
    apiKey,
    baseUrl,
    providerAccountId,
    mode: input.mode,
    limit: input.limit,
    httpGetImpl: input.httpGetImpl
  });
}

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   providerAccountId: string,
 *   mode: string,
 *   limit: number,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null
 * }} input
 */
async function captureLinkedinQuickSurfacesThroughUnipile(input) {
  const mode = normalizeNullableString(input.mode)?.toLowerCase() === "full" ? "full" : "quick";
  const [sentInvitations, receivedInvitations, messagingInbox, followersList, followingList] = await Promise.all([
    captureUnipileSentInvitationsSurface({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerAccountId: input.providerAccountId,
      mode,
      limit: input.limit,
      httpGetImpl: input.httpGetImpl
    }),
    captureUnipileReceivedInvitationsSurface({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerAccountId: input.providerAccountId,
      mode,
      limit: input.limit,
      httpGetImpl: input.httpGetImpl
    }),
    captureUnipileMessagingInboxSurface({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerAccountId: input.providerAccountId,
      mode,
      limit: input.limit,
      httpGetImpl: input.httpGetImpl
    }),
    captureUnipileFollowersSurface({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerAccountId: input.providerAccountId,
      mode,
      limit: input.limit,
      httpGetImpl: input.httpGetImpl
    }),
    captureUnipileFollowingSurface({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerAccountId: input.providerAccountId,
      mode,
      limit: input.limit,
      httpGetImpl: input.httpGetImpl
    })
  ]);

  return linkedinInboundSyncCaptureSchema.parse({
    mode,
    sentInvitations,
    receivedInvitations,
    messagingInbox,
    profileViews: buildUnsupportedLinkedinSurface(
      mode,
      "Unipile does not expose a direct LinkedIn profile views route for Exo live sync."
    ),
    followersList,
    followingList
  });
}

/**
 * @param {{ apiKey: string, baseUrl: string, providerAccountId: string, mode: "quick" | "full", limit: number, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null }} input
 */
async function captureUnipileSentInvitationsSurface(input) {
  return captureUnipileLinkedinCollectionSurface({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    pathname: "/api/v1/users/invite/sent",
    routeLabel: "sent invitation capture",
    providerAccountId: input.providerAccountId,
    mode: input.mode,
    limit: input.limit,
    maxPageSize: 250,
    partialError: "Unipile returned more pending sent invitations than this quick pass itemized.",
    httpGetImpl: input.httpGetImpl,
    mapItem: (item, fallbackObservedAt) => {
      const invitationId = normalizeNullableString(item?.id);
      if (!invitationId) {
        return null;
      }

      const actorName = normalizeNullableString(item?.invited_user) ?? "Unknown LinkedIn user";
      const actorHandle = normalizeNullableString(item?.invited_user_public_id) ?? null;
      return {
        invitationId,
        kind: "connection_request_pending",
        observedAt: coerceIsoDatetime(item?.parsed_datetime ?? item?.date, fallbackObservedAt),
        eventAt: coerceIsoDatetime(item?.parsed_datetime ?? item?.date, fallbackObservedAt),
        summary: `${actorName} is still pending on LinkedIn.`,
        actorName,
        actorTitle: normalizeNullableString(item?.invited_user_description) ?? null,
        actorCompanyName: deriveLinkedinCompanyName(normalizeNullableString(item?.invited_user_description) ?? null),
        actorHandle,
        actorProfileUrl: buildLinkedinProfileUrlFromPublicId(actorHandle),
        actorLinkedinPublicId: actorHandle,
        actorLinkedinMemberId: normalizeNullableString(item?.invited_user_id) ?? null,
        actorAvatarSourceUrl: null,
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
        motionId: null,
        companyId: null,
        prospectId: null,
        notes: normalizeNullableString(item?.invitation_text) ?? null
      };
    }
  });
}

/**
 * @param {{ apiKey: string, baseUrl: string, providerAccountId: string, mode: "quick" | "full", limit: number, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null }} input
 */
async function captureUnipileReceivedInvitationsSurface(input) {
  return captureUnipileLinkedinCollectionSurface({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    pathname: "/api/v1/users/invite/received",
    routeLabel: "received invitation capture",
    providerAccountId: input.providerAccountId,
    mode: input.mode,
    limit: input.limit,
    maxPageSize: 100,
    partialError: "Unipile returned more received LinkedIn invitations than this quick pass itemized.",
    httpGetImpl: input.httpGetImpl,
    mapItem: (item, fallbackObservedAt) => {
      const invitationId = normalizeNullableString(item?.id);
      if (!invitationId) {
        return null;
      }

      const inviter = item?.inviter ?? {};
      const actorName = normalizeNullableString(inviter.inviter_name) ?? "Unknown LinkedIn user";
      const actorHandle = normalizeNullableString(inviter.inviter_public_identifier) ?? null;
      return {
        invitationId,
        kind: "connection_request_received",
        observedAt: coerceIsoDatetime(item?.parsed_datetime ?? item?.date, fallbackObservedAt),
        summary: `${actorName} sent a new inbound LinkedIn connection request.`,
        actorName,
        actorTitle: normalizeNullableString(inviter.inviter_description) ?? null,
        actorCompanyName: deriveLinkedinCompanyName(normalizeNullableString(inviter.inviter_description) ?? null),
        actorHandle,
        actorProfileUrl: buildLinkedinProfileUrlFromPublicId(actorHandle),
        actorLinkedinPublicId: actorHandle,
        actorLinkedinMemberId: normalizeNullableString(inviter.inviter_id) ?? null,
        actorAvatarSourceUrl: null,
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
        motionId: null,
        companyId: null,
        prospectId: null,
        notes: normalizeNullableString(item?.invitation_text) ?? null
      };
    }
  });
}

/**
 * @param {{ apiKey: string, baseUrl: string, providerAccountId: string, mode: "quick" | "full", limit: number, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null }} input
 */
async function captureUnipileMessagingInboxSurface(input) {
  /** @type {Map<string, Promise<null | {
   *   name: string | null,
   *   occupation: string | null,
   *   companyName: string | null,
   *   publicIdentifier: string | null,
   *   profileUrl: string | null,
   *   pictureUrl: string | null,
   *   providerId: string | null,
   * }>>} */
  const attendeeCache = new Map();
  /** @type {Map<string, Promise<Array<{
   *   id: string | null,
   *   direction: "inbound" | "outbound" | "unknown",
   *   sentAt: string | null,
   *   fromName: string | null,
   *   fromHandle: string | null,
   *   body: string,
   * }>>>} */
  const threadMessageCache = new Map();
  return captureUnipileLinkedinCollectionSurface({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    pathname: "/api/v1/chats",
    routeLabel: "messaging inbox capture",
    providerAccountId: input.providerAccountId,
    mode: input.mode,
    limit: input.limit,
    maxPageSize: 100,
    partialError: "Unipile returned more unread LinkedIn chats than this quick pass itemized.",
    httpGetImpl: input.httpGetImpl,
    extraQuery: {
      unread: "true"
    },
    mapItem: async (item, fallbackObservedAt) => {
      const threadId = normalizeNullableString(item?.id);
      if (!threadId) {
        return null;
      }

      const attendeeProviderId = normalizeNullableString(item?.attendee_provider_id) ?? null;
      const attendee = await resolveUnipileChatAttendee({
        attendeeProviderId,
        providerAccountId: input.providerAccountId,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        httpGetImpl: input.httpGetImpl,
        cache: attendeeCache,
      });
      const actorName = attendee?.name ?? "Unknown LinkedIn user";
      const actorTitle = attendee?.occupation ?? null;
      const actorCompanyName = attendee?.companyName ?? deriveLinkedinCompanyName(actorTitle);
      const unreadCountValue = Number(item?.unread_count);
      const unreadCount = Number.isFinite(unreadCountValue) ? unreadCountValue : null;
      const threadProviderId = normalizeNullableString(item?.provider_id) ?? normalizeNullableString(item?.chat_provider_id) ?? null;
      const subject = normalizeNullableString(item?.subject) ?? normalizeNullableString(item?.name) ?? null;
      const messages = await resolveUnipileThreadMessages({
        threadId,
        actorName,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        httpGetImpl: input.httpGetImpl,
        cache: threadMessageCache,
      });
      return {
        threadId,
        kind: unreadCount && unreadCount > 0 ? "inbound_reply_received" : "thread_updated",
        observedAt: coerceIsoDatetime(item?.timestamp, fallbackObservedAt),
        summary: unreadCount && unreadCount > 0
          ? `${actorName} has unread LinkedIn message activity.`
          : `${actorName}'s LinkedIn thread moved.`,
        threadUrl: buildLinkedinThreadUrl(threadProviderId),
        actorName,
        actorTitle,
        actorCompanyName,
        actorHandle: attendee?.publicIdentifier ?? null,
        actorProfileUrl: attendee?.profileUrl ?? null,
        actorLinkedinPublicId: attendee?.publicIdentifier ?? null,
        actorLinkedinMemberId: attendee?.providerId ?? attendeeProviderId,
        actorAvatarSourceUrl: attendee?.pictureUrl ?? null,
        sourceUrl: buildLinkedinThreadUrl(threadProviderId),
        subject,
        motionId: null,
        companyId: null,
        prospectId: null,
        messages,
        notes: subject && normalizeNullableString(subject) !== normalizeNullableString(actorName)
          ? `LinkedIn thread subject: ${subject}`
          : null
      };
    }
  });
}

/**
 * @param {{ apiKey: string, baseUrl: string, providerAccountId: string, mode: "quick" | "full", limit: number, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null }} input
 */
async function captureUnipileFollowersSurface(input) {
  return captureUnipileLinkedinCollectionSurface({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    pathname: "/api/v1/users/followers",
    routeLabel: "followers capture",
    providerAccountId: input.providerAccountId,
    mode: input.mode,
    limit: input.limit,
    maxPageSize: 250,
    partialError: "Unipile returned more LinkedIn followers than this quick pass itemized.",
    httpGetImpl: input.httpGetImpl,
    mapItem: (item, fallbackObservedAt) => {
      const entryId = normalizeNullableString(item?.id);
      if (!entryId) {
        return null;
      }

      const actorProfileUrl = normalizeNullableString(item?.profile_url) ?? null;
      const actorHandle = extractLinkedinPublicId(actorProfileUrl);
      const actorName = normalizeNullableString(item?.name) ?? "Unknown LinkedIn user";
      return {
        entryId,
        kind: "follower_confirmed",
        observedAt: fallbackObservedAt,
        summary: `${actorName} is present in the LinkedIn follower list.`,
        actorName,
        actorTitle: normalizeNullableString(item?.headline) ?? null,
        actorCompanyName: deriveLinkedinCompanyName(normalizeNullableString(item?.headline) ?? null),
        actorHandle,
        actorProfileUrl,
        actorLinkedinPublicId: actorHandle,
        actorLinkedinMemberId: normalizeNullableString(item?.id) ?? normalizeNullableString(item?.urn) ?? null,
        actorAvatarSourceUrl: normalizeNullableString(item?.profile_picture_url_large) ?? normalizeNullableString(item?.profile_picture_url) ?? null,
        sourceUrl: actorProfileUrl,
        motionId: null,
        companyId: null,
        prospectId: null,
        notes: null
      };
    }
  });
}

/**
 * @param {{ apiKey: string, baseUrl: string, providerAccountId: string, mode: "quick" | "full", limit: number, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null }} input
 */
async function captureUnipileFollowingSurface(input) {
  return captureUnipileLinkedinCollectionSurface({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    pathname: "/api/v1/users/following",
    routeLabel: "following capture",
    providerAccountId: input.providerAccountId,
    mode: input.mode,
    limit: input.limit,
    maxPageSize: 250,
    partialError: "Unipile returned more followed LinkedIn accounts than this quick pass itemized.",
    httpGetImpl: input.httpGetImpl,
    mapItem: (item, fallbackObservedAt) => {
      const entryId = normalizeNullableString(item?.connection_urn)
        ?? normalizeNullableString(item?.member_id)
        ?? normalizeNullableString(item?.public_identifier);
      if (!entryId) {
        return null;
      }

      const actorName = joinNonEmptyParts([
        normalizeNullableString(item?.first_name),
        normalizeNullableString(item?.last_name)
      ]) ?? "Unknown LinkedIn user";
      const actorHandle = normalizeNullableString(item?.public_identifier) ?? null;
      const actorProfileUrl = normalizeNullableString(item?.public_profile_url) ?? buildLinkedinProfileUrlFromPublicId(actorHandle);
      return {
        entryId,
        kind: "follow_state_confirmed",
        observedAt: coerceIsoDatetime(item?.created_at, fallbackObservedAt),
        summary: `${actorName} is still present in the LinkedIn following list.`,
        actorName,
        actorTitle: normalizeNullableString(item?.headline) ?? null,
        actorCompanyName: deriveLinkedinCompanyName(normalizeNullableString(item?.headline) ?? null),
        actorHandle,
        actorProfileUrl,
        actorLinkedinPublicId: actorHandle,
        actorLinkedinMemberId: normalizeNullableString(item?.member_id) ?? null,
        actorAvatarSourceUrl: normalizeNullableString(item?.profile_picture_url) ?? null,
        sourceUrl: actorProfileUrl,
        motionId: null,
        companyId: null,
        prospectId: null,
        notes: null
      };
    }
  });
}

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   pathname: string,
 *   routeLabel: string,
 *   providerAccountId: string,
 *   mode: "quick" | "full",
 *   limit: number,
 *   maxPageSize: number,
 *   partialError: string,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   extraQuery?: Record<string, string> | null,
 *   mapItem: (item: any, fallbackObservedAt: string) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null
 * }} input
 */
async function captureUnipileLinkedinCollectionSurface(input) {
  const targetCount = input.mode === "full" ? Number.POSITIVE_INFINITY : input.limit;
  const pageSize = input.mode === "full"
    ? input.maxPageSize
    : Math.max(1, Math.min(input.limit, input.maxPageSize));
  const items = [];
  let cursor = null;
  let pageCount = 0;

  while (items.length < targetCount) {
    const page = await fetchUnipileJsonPage({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      pathname: input.pathname,
      query: {
        account_id: input.providerAccountId,
        limit: String(pageSize),
        cursor,
        ...input.extraQuery
      },
      httpGetImpl: input.httpGetImpl
    });
    const checkedAt = new Date().toISOString();
    if (!page.ok) {
      return buildFailedSurface(
        page.error ?? formatUnipileRouteFailure(input.routeLabel, page.status, page.parsed),
        checkedAt,
        input.mode,
        isUnipileUnsupportedSurfaceFailure(page.status, page.parsed)
          ? "connector_surface_unsupported"
          : "transport_or_surface_failure"
      );
    }

    const rawItems = Array.isArray(page.parsed?.items) ? page.parsed.items : null;
    if (!rawItems) {
      return buildFailedSurface(
        `Unipile ${input.routeLabel} returned an invalid payload without an items array.`,
        checkedAt,
        input.mode
      );
    }

    pageCount += 1;
    for (const rawItem of rawItems) {
      if (items.length >= targetCount) {
        break;
      }
      const mapped = await input.mapItem(rawItem, checkedAt);
      if (mapped) {
        items.push(mapped);
      }
    }

    const nextCursor = normalizeUnipileCursor(page.parsed?.cursor);
    if (!nextCursor) {
      return {
        status: "success",
        checkedAt,
        itemCount: items.length,
        visibleTotalCount: items.length,
        captureCompleteness: "complete",
        requestedMode: input.mode,
        actualMode: input.mode,
        reconcileRequired: false,
        reconcileReason: null,
        exhaustionStatus: "complete",
        exhaustionReason: "api_cursor_exhausted",
        paginationAttempted: pageCount > 1,
        terminalSignalSeen: true,
        stalledPassCount: 0,
        error: null,
        items
      };
    }

    if (input.mode !== "full" && items.length >= input.limit) {
      return {
        status: "warning",
        checkedAt,
        itemCount: items.length,
        visibleTotalCount: null,
        captureCompleteness: "partial_visible_slice",
        requestedMode: input.mode,
        actualMode: input.mode,
        reconcileRequired: true,
        reconcileReason: "bounded_capture_stopped_early",
        exhaustionStatus: "incomplete",
        exhaustionReason: "bounded_capture_stopped_early",
        paginationAttempted: true,
        terminalSignalSeen: false,
        stalledPassCount: 0,
        error: input.partialError,
        items
      };
    }

    if (!rawItems.length) {
      return buildFailedSurface(
        `Unipile ${input.routeLabel} returned an empty page while advertising another cursor.`,
        checkedAt,
        input.mode
      );
    }

    cursor = nextCursor;
  }

  return {
    status: "success",
    checkedAt: new Date().toISOString(),
    itemCount: items.length,
    visibleTotalCount: items.length,
    captureCompleteness: "complete",
    requestedMode: input.mode,
    actualMode: input.mode,
    reconcileRequired: false,
    reconcileReason: null,
    exhaustionStatus: "complete",
    exhaustionReason: "capture_limit_exhausted",
    paginationAttempted: pageCount > 1,
    terminalSignalSeen: true,
    stalledPassCount: 0,
    error: null,
    items
  };
}

/**
 * @param {{
 *   attendeeProviderId: string | null,
 *   providerAccountId: string,
 *   apiKey: string,
 *   baseUrl: string,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   cache: Map<string, Promise<null | {
 *     name: string | null,
 *     occupation: string | null,
 *     companyName: string | null,
 *     publicIdentifier: string | null,
 *     profileUrl: string | null,
 *     pictureUrl: string | null,
 *     providerId: string | null,
 *   }>>,
 * }} input
 */
async function resolveUnipileChatAttendee(input) {
  if (!input.attendeeProviderId) {
    return null;
  }
  const cached = input.cache.get(input.attendeeProviderId);
  if (cached) {
    return cached;
  }
  const lookup = (async () => {
    const response = await fetchUnipileJsonPage({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      pathname: `/api/v1/chat_attendees/${encodeURIComponent(input.attendeeProviderId)}`,
      query: {},
      httpGetImpl: input.httpGetImpl,
    });
    if (!response.ok) {
      return null;
    }
    const specifics = response.parsed?.specifics ?? {};
    const providerId = normalizeNullableString(response.parsed?.provider_id) ?? input.attendeeProviderId;
    const profile = await resolveUnipileLinkedinUserProfile({
      providerAccountId: input.providerAccountId,
      providerId,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      httpGetImpl: input.httpGetImpl,
    });
    const publicIdentifier = profile?.publicIdentifier ?? normalizeNullableString(specifics?.public_identifier) ?? null;
    const occupation = profile?.headline
      ?? normalizeNullableString(specifics?.occupation)
      ?? normalizeNullableString(specifics?.description)
      ?? null;
    return {
      name: normalizeNullableString(response.parsed?.name) ?? null,
      occupation,
      companyName: profile?.companyName ?? normalizeNullableString(specifics?.company_name) ?? null,
      publicIdentifier,
      profileUrl: profile?.profileUrl
        ?? normalizeNullableString(response.parsed?.profile_url)
        ?? normalizeNullableString(specifics?.profile_url)
        ?? buildLinkedinProfileUrlFromPublicId(publicIdentifier),
      pictureUrl: profile?.pictureUrl
        ?? normalizeNullableString(response.parsed?.picture_url)
        ?? normalizeNullableString(response.parsed?.profile_picture_url)
        ?? null,
      providerId,
    };
  })();
  input.cache.set(input.attendeeProviderId, lookup);
  return lookup;
}

/**
 * @param {{
 *   providerAccountId: string,
 *   providerId: string | null,
 *   apiKey: string,
 *   baseUrl: string,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 * }} input
 */
async function resolveUnipileLinkedinUserProfile(input) {
  if (!input.providerId) {
    return null;
  }
  const response = await fetchUnipileJsonPage({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    pathname: `/api/v1/users/${encodeURIComponent(input.providerId)}`,
    query: {
      account_id: input.providerAccountId,
    },
    httpGetImpl: input.httpGetImpl,
  });
  if (!response.ok) {
    return null;
  }

  const publicIdentifier = normalizeNullableString(response.parsed?.public_identifier) ?? null;
  const headline = normalizeNullableString(response.parsed?.headline) ?? null;
  return {
    publicIdentifier,
    headline,
    companyName: deriveLinkedinCompanyName(headline),
    profileUrl: buildLinkedinProfileUrlFromPublicId(publicIdentifier),
    pictureUrl: normalizeNullableString(response.parsed?.profile_picture_url)
      ?? normalizeNullableString(response.parsed?.profile_picture_url_large)
      ?? null,
  };
}

/**
 * @param {{
 *   threadId: string,
 *   actorName: string,
 *   apiKey: string,
 *   baseUrl: string,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   cache: Map<string, Promise<Array<{
 *     id: string | null,
 *     direction: "inbound" | "outbound" | "unknown",
 *     sentAt: string | null,
 *     fromName: string | null,
 *     fromHandle: string | null,
 *     body: string,
 *   }>>>,
 * }} input
 */
async function resolveUnipileThreadMessages(input) {
  const cached = input.cache.get(input.threadId);
  if (cached) {
    return cached;
  }

  const lookup = (async () => {
    const response = await fetchUnipileJsonPage({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      pathname: `/api/v1/chats/${encodeURIComponent(input.threadId)}/messages`,
      query: {},
      httpGetImpl: input.httpGetImpl,
    });
    if (!response.ok) {
      return [];
    }

    const rawItems = Array.isArray(response.parsed?.items) ? response.parsed.items : [];
    return rawItems
      .map((item) => {
        const body = normalizeNullableString(item?.text) ?? normalizeNullableString(item?.original) ?? null;
        if (!body) {
          return null;
        }
        const direction = coerceUnipileMessageDirection(item);
        return {
          id: normalizeNullableString(item?.id) ?? null,
          direction,
          sentAt: coerceIsoDatetime(item?.timestamp ?? item?.date ?? item?.created_at, null),
          fromName: direction === "outbound" ? "You" : input.actorName,
          fromHandle: null,
          body,
        };
      })
      .filter(Boolean)
      .sort((left, right) => (Date.parse(left.sentAt ?? "") || 0) - (Date.parse(right.sentAt ?? "") || 0))
      .slice(-6);
  })();

  input.cache.set(input.threadId, lookup);
  return lookup;
}

/**
 * @param {any} item
 * @returns {"inbound" | "outbound" | "unknown"}
 */
function coerceUnipileMessageDirection(item) {
  if (item?.from_me === true || item?.is_sender === true || item?.is_sender === 1) {
    return "outbound";
  }
  if (item?.from_me === false || item?.is_sender === false || item?.is_sender === 0) {
    return "inbound";
  }
  return "unknown";
}

/**
 * @param {{ apiKey: string, baseUrl: string, pathname: string, query: Record<string, string | null>, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null }} input
 */
async function fetchUnipileJsonPage(input) {
  const url = new URL(input.pathname, input.baseUrl);
  for (const [key, value] of Object.entries(input.query)) {
    if (value !== null) {
      url.searchParams.set(key, value);
    }
  }

  try {
    if (input.httpGetImpl) {
      const response = input.httpGetImpl(url.toString(), {
        accept: "application/json",
        "X-API-KEY": input.apiKey
      });
      return {
        ok: !!response && response.status >= 200 && response.status < 300,
        status: response?.status ?? 0,
        parsed: safeJsonParse(response?.bodyText ?? ""),
        error: response ? null : "Unipile request failed before a response was returned."
      };
    }

    const raw = execFileSync("curl", [
      "-sS",
      "-L",
      "-H",
      "accept: application/json",
      "-H",
      `X-API-KEY: ${input.apiKey}`,
      "-w",
      "\n__EXO_STATUS__:%{http_code}",
      url.toString(),
    ], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    const marker = "\n__EXO_STATUS__:";
    const index = raw.lastIndexOf(marker);
    if (index === -1) {
      return {
        ok: false,
        status: 0,
        parsed: null,
        error: "Unipile request did not return an HTTP status marker."
      };
    }

    const bodyText = raw.slice(0, index);
    const status = Number(raw.slice(index + marker.length).trim());
    return {
      ok: Number.isFinite(status) && status >= 200 && status < 300,
      status: Number.isFinite(status) ? status : 0,
      parsed: safeJsonParse(bodyText),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      parsed: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * @param {"quick" | "full"} mode
 * @param {string} error
 */
function buildUnsupportedLinkedinSurface(mode, error) {
  return buildFailedSurface(error, new Date().toISOString(), mode, "connector_surface_unsupported");
}

/**
 * @param {string} routeLabel
 * @param {number} status
 * @param {any} parsed
 */
function formatUnipileRouteFailure(routeLabel, status, parsed) {
  const type = normalizeNullableString(parsed?.type);
  const title = normalizeNullableString(parsed?.title);
  const detail = normalizeNullableString(parsed?.detail);
  const suffix = [title, detail].filter(Boolean).join(": ");
  if (type && suffix) {
    return `Unipile ${routeLabel} failed with ${status} ${type}: ${suffix}.`;
  }
  if (type) {
    return `Unipile ${routeLabel} failed with ${status} ${type}.`;
  }
  if (suffix) {
    return `Unipile ${routeLabel} failed with ${status}: ${suffix}.`;
  }
  return `Unipile ${routeLabel} failed with status ${status}.`;
}

/**
 * @param {number} status
 * @param {any} parsed
 */
function isUnipileUnsupportedSurfaceFailure(status, parsed) {
  if (status !== 501) {
    return false;
  }

  const type = normalizeNullableString(parsed?.type)?.toLowerCase() ?? "";
  const title = normalizeNullableString(parsed?.title)?.toLowerCase() ?? "";
  const detail = normalizeNullableString(parsed?.detail)?.toLowerCase() ?? "";

  return type.includes("feature_not_implemented")
    || title.includes("not been implemented")
    || detail.includes("not been implemented");
}

/**
 * @param {unknown} raw
 */
function normalizeUnipileCursor(raw) {
  if (typeof raw === "string") {
    return normalizeNullableString(raw);
  }
  return null;
}

/**
 * @param {unknown} raw
 */
function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw));
  } catch (_error) {
    return null;
  }
}

/**
 * @param {unknown} raw
 * @param {string} fallback
 */
function coerceIsoDatetime(raw, fallback) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const value = raw > 1_000_000_000_000 ? raw : raw * 1000;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }

  const normalized = normalizeNullableString(typeof raw === "string" ? raw : null);
  if (!normalized) {
    return fallback;
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

/**
 * @param {string | null | undefined} publicId
 */
function buildLinkedinProfileUrlFromPublicId(publicId) {
  const normalized = normalizeNullableString(publicId);
  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return `https://www.linkedin.com/in/${normalized.replace(/^\/+|\/+$/g, "")}/`;
}

/**
 * @param {string | null | undefined} providerId
 */
function buildLinkedinThreadUrl(providerId) {
  const normalized = normalizeNullableString(providerId);
  if (!normalized) {
    return null;
  }
  return `https://www.linkedin.com/messaging/thread/${normalized}/`;
}

/**
 * @param {string | null | undefined} profileUrl
 */
function extractLinkedinPublicId(profileUrl) {
  const normalized = normalizeNullableString(profileUrl);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return normalizeNullableString(match?.[1] ?? null);
}

/**
 * @param {(string | null)[]} parts
 */
function joinNonEmptyParts(parts) {
  const filtered = parts.filter(Boolean);
  return filtered.length ? filtered.join(" ") : null;
}

/**
 * @param {{
 *   connector: string,
 *   handle: string,
 *   profile: import("../schema/browser-profile.js").browserProfileSchema._type | null,
 *   limit: number,
 *   mode?: string | null,
 *   mentionStructuredHints?: boolean
 * }} input
 */
function buildLinkedinLiveCapturePrompt(input) {
  const requestedMode = normalizeNullableString(input.mode)?.toLowerCase() === "full" ? "full" : "quick";
  const structuredHintsLine = input.mentionStructuredHints
    ? "Use the structured surfaceHints attached to this capture request as the canonical retrieval playbook, especially for the messaging inbox, sent invitations, profile views, and followers list when pagination or partial-capture behavior appears."
    : null;

  if (!input.profile) {
    return [
      `Use the native ${input.connector} connector available in this runtime to inspect one live LinkedIn account for Exo.`,
      `The intended LinkedIn handle is ${input.handle}.`,
      structuredHintsLine,
      "Use the structured captureGuide and captureScaffold attached to this capture request as the extraction, writeback, and verification contract.",
      "Do not open or rely on a browser session for this path. The connector is the interface surface.",
      "Before inspecting any LinkedIn surface, verify that the connected account identity matches the intended Exo handle. If the connector is bound to another LinkedIn account, return failed for every surface with a concrete account_selection_mismatch error.",
      "Use connector-native LinkedIn retrieval only. Do not improvise browser scraping, shell commands, local files, or web search.",
      "Native-tools only applies to the live connector capture transport. Use captureGuide.writebackRules and verificationCommands for the governed Exo landing path after capture.",
      "If connector-side scripting or mapping is needed, start from captureScaffold only when it genuinely helps. Do not invent a larger ad hoc extractor unless the attached contract fails.",
      "Do not look for an Exo website, Exo app route, admin surface, browser-history breadcrumb, or sync UI. Inspect LinkedIn through the connector and return normalized capture JSON only.",
      "Do not infer exo next, inbox, daily, or review from connector inspection alone. Those are Exo outputs after governed writeback, not connector judgments.",
      requestedMode === "full"
        ? "Requested mode is full. Use outputGuide.modePolicy and outputGuide.surfaceStateRules to fully reconcile each authoritative quick LinkedIn surface."
        : `Requested mode is quick. Inspect up to ${input.limit} items per LinkedIn surface unless outputGuide.modePolicy or the attached surfaceHints require reconcile escalation.`,
      "Inspect only the quick surfaces listed in outputGuide.surfaces.",
      "Return only JSON that matches outputSchema and obeys outputGuide.surfaceStateRules.",
      "Use outputGuide.actorIdentityRules for actor fields and outputGuide.ignoreRules for suppression."
    ].filter(Boolean).join("\n");
  }

  const identityAccounts = input.profile.identity.accounts.length
    ? input.profile.identity.accounts.map((account) => `${account.capability}:${account.handle}`).join(", ")
    : "none recorded in Exo";

  return [
    "Use the native Chrome/browser-control surface available in this runtime to inspect one live LinkedIn account for Exo.",
    `The intended LinkedIn handle is ${input.handle}.`,
    `The resolved Chrome profile is label ${input.profile.label}, directory ${input.profile.profileDirectory}, path ${input.profile.profilePath}.`,
    `The stored Chrome profile display-name metadata is ${input.profile.detectedProfileName ?? "unknown"}. Treat Chrome display-name drift as non-authoritative.`,
    `Recorded profile identity accounts: ${identityAccounts}.`,
    structuredHintsLine,
    "Use the structured profileSelection, captureGuide, and captureScaffold attached to this capture request as the binding, extraction, writeback, and verification contract.",
    "Do not fail on Chrome profile display-name mismatch alone. Only fail when the resolved profile directory/path or the signed-in LinkedIn identity do not match the intended Exo context.",
    "Before inspecting any LinkedIn surface, verify that the active signed-in LinkedIn identity matches the intended profile context. If the connector is attached to another Chrome session or a different signed-in identity, return failed for every surface with a concrete profile_selection_mismatch error.",
    "Do not require LinkedIn tabs to already be open. If the attached Chrome session does not already have the needed LinkedIn surface, open or navigate tabs in that same attached session to the canonical LinkedIn URLs required by outputGuide.surfaces and continue there.",
    "Native-tools only applies to the live browser capture transport. Use captureGuide.writebackRules and verificationCommands for the governed Exo landing path after capture.",
    "If browser-side JavaScript is needed, start from captureScaffold. Do not invent a larger ad hoc DOM extractor unless captureScaffold provably fails on the current surface.",
    "Do not look for an Exo website, Exo app route, admin surface, browser-history breadcrumb, or sync UI. Inspect LinkedIn directly and return normalized capture JSON only.",
    "Inspect LinkedIn directly, return the requested JSON, and stop. There is no browser-side Exo control surface to discover for this task.",
    "Do not infer exo next, inbox, daily, or review from browser inspection alone. Those are Exo outputs after governed writeback, not browser judgments.",
    "Do not use shell commands, local files, or web search.",
    requestedMode === "full"
      ? "Requested mode is full. Use outputGuide.modePolicy and outputGuide.surfaceStateRules to fully reconcile each authoritative quick LinkedIn surface."
      : `Requested mode is quick. Inspect up to ${input.limit} items per LinkedIn surface unless outputGuide.modePolicy or the attached surfaceHints require reconcile escalation.`,
    "Inspect only the quick surfaces listed in outputGuide.surfaces.",
    "Return only JSON that matches outputSchema and obeys outputGuide.surfaceStateRules.",
    "Use outputGuide.actorIdentityRules for actor fields and outputGuide.ignoreRules for suppression."
  ].filter(Boolean).join("\n");
}

/**
 * @param {{ mode: string, limit: number }} input
 */
function buildLinkedinCaptureOutputGuide(input) {
  const requestedMode = normalizeNullableString(input.mode)?.toLowerCase() === "full" ? "full" : "quick";

  return {
    surfaces: [
      "sent_invitations",
      "received_invitations",
      "messaging_inbox",
      "profile_views",
      "followers_list",
      "following_list"
    ],
    modePolicy: {
      requestedMode,
      quickMode: `Inspect up to ${input.limit} items per surface unless surfaceHints require reconcile escalation.`,
      fullMode: "Fully exhaust each authoritative quick surface enough that disappearance or silence is trustworthy."
    },
    surfaceStateRules: {
      status: "Set status to success when the surface was checked, warning when it was only partially checked or itemized, and failed when it could not be checked.",
      checkedAt: "Set checkedAt to when you finished that surface.",
      itemCount: "Set itemCount to the number of rows or concrete items you actually itemized. Use 0 on failed surfaces.",
      visibleTotalCount: "Set visibleTotalCount to the full count visibly shown by LinkedIn for that surface when the UI exposes one; otherwise use itemCount when the surface is fully exhausted or null when no trustworthy total is visible.",
      exhaustionStatus: "Set exhaustionStatus to complete only when the live surface was exhausted enough that disappearance or silence is trustworthy. Use incomplete for visible-slice-only or early-stop captures. Use blocked only for structural failures such as identity mismatch, authwall, or a page that never rendered the required surface.",
      captureCompleteness: "Set captureCompleteness to complete when exhaustionStatus is complete, partial_visible_slice when you stopped before full reconciliation, and failed only when the surface could not be checked.",
      reconcileFields: "Set requestedMode and actualMode for every surface. Set reconcileRequired true whenever the visible total is larger than the itemized rows and exhaustionStatus is not complete, or whenever surfaceHints say the operator still needs a full reconciliation. Use a short snake_case reconcileReason such as visible_total_exceeds_itemized_rows or bounded_capture_stopped_early.",
      paginationFields: "Set paginationAttempted true when you actually used the known scroll or load-more path. Set terminalSignalSeen true only when the surfaceHints completion rule was genuinely reached. Set stalledPassCount to how many terminal no-new-results passes you observed before stopping.",
      summaries: "Use clear operator-ready summaries under 280 characters.",
      earlyStopPolicy: "Do not mark a surface failed just because you stopped early. Early stop is incomplete reconciliation, not transport failure."
    },
    actorIdentityRules: [
      "Use actorProfileUrl whenever visible.",
      "Use actorLinkedinPublicId whenever the live surface exposes a stable vanity or public identifier.",
      "Use actorLinkedinMemberId whenever the live surface exposes the internal member id or equivalent stable LinkedIn profile id.",
      "Use actorAvatarSourceUrl whenever LinkedIn exposes a concrete avatar image URL for the person.",
      "Do not invent motionId, companyId, or prospectId. Set them to null unless you truly know them from the LinkedIn surface itself."
    ],
    ignoreRules: [
      "Ignore noisy suggestions, ads, or unrelated feed items.",
      "Only include items that materially change operator action."
    ]
  };
}

/**
 * @param {string} error
 */
function buildFailedLinkedinCapture(mode, error) {
  const checkedAt = new Date().toISOString();
  return {
    mode,
    sentInvitations: buildFailedSurface(error, checkedAt, mode),
    receivedInvitations: buildFailedSurface(error, checkedAt, mode),
    messagingInbox: buildFailedSurface(error, checkedAt, mode),
    profileViews: buildFailedSurface(error, checkedAt, mode),
    followersList: buildFailedSurface(error, checkedAt, mode),
    followingList: buildFailedSurface(error, checkedAt, mode)
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/user.js").userHarnessConnectionSchema._type} harnessConnection
 * @param {{ codexHome?: string | null, claudeCli?: string | null }} options
 */
function buildStoredHarnessProbe(user, harnessConnection, options) {
  const probeResult = probeUserHarnessConnections(user, {
    runtime: harnessConnection.runtime,
    connector: harnessConnection.connector,
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });
  return probeResult.probes.find((candidate) => candidate.connectionId === harnessConnection.id) ?? {
    connectionId: harnessConnection.id,
    runtime: harnessConnection.runtime,
    connector: harnessConnection.connector,
    label: harnessConnection.label,
    storedStatus: harnessConnection.status,
    detectedStatus: "unknown",
    willWriteback: false,
    supported: true,
    source: {
      kind: "runtime-probe",
      path: null
    },
    reason: `No probe result was produced for ${harnessConnection.runtime}:${harnessConnection.connector}.`,
    evidence: []
  };
}

/**
 * @param {string} error
 * @param {string} checkedAt
 * @param {"quick" | "full"} mode
 * @param {string} [exhaustionReason]
 */
function buildFailedSurface(error, checkedAt, mode, exhaustionReason = "transport_or_surface_failure") {
  return {
    status: "failed",
    checkedAt,
    itemCount: 0,
    visibleTotalCount: null,
    captureCompleteness: "failed",
    requestedMode: mode,
    actualMode: mode,
    reconcileRequired: false,
    reconcileReason: null,
    exhaustionStatus: "blocked",
    exhaustionReason,
    paginationAttempted: null,
    terminalSignalSeen: null,
    stalledPassCount: null,
    error,
    items: []
  };
}

/**
 * @param {string | null | undefined} value
 */
function normalizeNullableString(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * @param {number | null | undefined} value
 * @param {number} fallback
 * @param {string} label
 */
function normalizePositiveInteger(value, fallback, label) {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import("node:child_process").ExecFileOptions} options
 */
function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(buildExecErrorMessage(command, stdout, stderr, error)));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

/**
 * @param {string} command
 * @param {string | Buffer} stdout
 * @param {string | Buffer} stderr
 * @param {Error} error
 */
function buildExecErrorMessage(command, stdout, stderr, error) {
  const stderrText = bufferToTrimmedString(stderr);
  const stdoutText = bufferToTrimmedString(stdout);
  const detail = stderrText || stdoutText || error.message;
  return `${command} exec failed: ${detail}`;
}

/**
 * @param {string | Buffer} value
 */
function bufferToTrimmedString(value) {
  const text = String(value ?? "").trim();
  return text.length ? text : "";
}
