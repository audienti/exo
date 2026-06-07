// @ts-check

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodexCliCommand } from "../lib/codex-cli.js";
import { deriveLinkedinCompanyName } from "../lib/linkedin-headline.js";
import { deriveLinkedinRelativeEventAt } from "../lib/linkedin-relative-time.js";
import { buildLinkedinQuickSurfaceHints } from "../lib/live-surface-hints.js";
import { buildLinkedinQuickCaptureScaffold } from "../lib/linkedin-quick-capture-scaffold.js";
import { readUnipileConfig } from "../lib/unipile-config.js";
import { linkedinInboundSyncCaptureSchema } from "../schema/linkedin-capture.js";
import { userSchema } from "../schema/user.js";
import {
  buildLinkedinInboundSyncPayload,
  normalizeLinkedinCaptureSurfaceKeys,
  resolveLinkedinAccount
} from "./inbound-linkedin-sync.js";
import {
  buildAgentHandoffTransport,
  buildDirectLiveTransport,
  shouldUseCodexAgentHandoff
} from "./live-agent-handoff.js";
import { probeUserHarnessConnections } from "./probe-user-harness-connections.js";

const DEFAULT_LINKEDIN_ITEM_LIMIT = 20;
const DEFAULT_LINKEDIN_PROXY_PAGE_SIZE = 50;
const LINKEDIN_COLLECTION_MAX_PAGE_SIZE = 100;
const LINKEDIN_FOLLOWERS_MAX_PAGE_SIZE = 100;
const LINKEDIN_PROFILE_VIEWS_QUERY_ID = "voyagerPremiumDashAnalyticsObject.c31102e906e7098910f44e0cecaa5b5c";
const LINKEDIN_FOLLOWING_QUERY_ID = "voyagerSearchDashClusters.843215f2a3455f1bed85762a45d71be8";
const UNIPILE_HTTP_TIMEOUT_MS = normalizePositiveInteger(
  process.env.EXO_UNIPILE_HTTP_TIMEOUT_MS ? Number.parseInt(process.env.EXO_UNIPILE_HTTP_TIMEOUT_MS, 10) : null,
  30000,
  "EXO_UNIPILE_HTTP_TIMEOUT_MS",
);
const UNIPILE_HTTP_CONNECT_TIMEOUT_SECONDS = Math.max(1, Math.min(10, Math.ceil(UNIPILE_HTTP_TIMEOUT_MS / 1000)));
const UNIPILE_HTTP_MAX_TIME_SECONDS = Math.max(1, Math.ceil(UNIPILE_HTTP_TIMEOUT_MS / 1000));

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
    continuationStartedAt: {
      type: ["string", "null"],
      format: "date-time"
    },
    nextCursor: {
      type: ["string", "null"]
    },
    nextStartOffset: {
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
            required: ["invitationId", "kind", "observedAt", "eventAt", "summary", "providerSharedSecret", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              invitationId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["connection_request_pending", "connection_request_accepted", "connection_request_withdrawn"]
              },
              observedAt: { type: "string", format: "date-time" },
              eventAt: { type: ["string", "null"], format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              providerSharedSecret: { type: ["string", "null"] },
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
            required: ["invitationId", "kind", "observedAt", "summary", "providerSharedSecret", ...Object.keys(linkedinActorFieldsSchema)],
            properties: {
              invitationId: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: ["connection_request_received", "connection_request_accepted", "connection_request_declined"]
              },
              observedAt: { type: "string", format: "date-time" },
              summary: { type: "string", minLength: 1, maxLength: 280 },
              providerSharedSecret: { type: ["string", "null"] },
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
 *   surfaceKeys?: string[] | null,
 *   limit?: number | null,
 *   maxPages?: number | null,
 *   pageSize?: number | null,
 *   resumeCursor?: string | null,
 *   resumeStartOffset?: number | null,
 *   codexCli?: string | null,
 *   codexHome?: string | null,
 *   claudeCli?: string | null
 *   unipileHttpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null
 *   unipileHttpPostImpl?: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null
 * }} [options]
 */
export async function buildLiveLinkedinInboundSyncPayload(rawUser, rawProfiles, options = {}) {
  const user = userSchema.parse(rawUser);
  const account = resolveLinkedinAccount(user, normalizeNullableString(options.accountId));
  const mode = options.mode ?? "quick";
  const requestedSurfaceKeys = normalizeLinkedinCaptureSurfaceKeys(options.surfaceKeys ?? null);
  const liveSource = resolveLinkedinLiveSource(user, account, {
    runtime: options.runtime ?? null,
    connector: options.connector ?? null,
    codexHome: options.codexHome ?? null,
    claudeCli: options.claudeCli ?? null
  });
  const profile = liveSource.profile;
  const harnessConnection = liveSource.harnessConnection;
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LINKEDIN_ITEM_LIMIT, "limit");
  const maxPages = normalizeOptionalPositiveInteger(options.maxPages, "maxPages");
  const pageSize = normalizeOptionalPositiveInteger(options.pageSize, "pageSize");
  const resumeCursor = normalizeNullableString(options.resumeCursor) ?? null;
  const resumeStartOffset = normalizeOptionalNonNegativeInteger(options.resumeStartOffset, "resumeStartOffset");

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
      maxPages,
      pageSize,
      resumeCursor,
      resumeStartOffset,
      surfaceKeys: requestedSurfaceKeys,
      codexHome: options.codexHome ?? normalizeNullableString(process.env.CODEX_HOME) ?? null,
      httpGetImpl: options.unipileHttpGetImpl ?? null,
      httpPostImpl: options.unipileHttpPostImpl ?? null,
    });
    if (directUnipileCapture) {
      rawCapture = directUnipileCapture;
    } else {
      const shouldUseAgentHandoff = shouldUseCodexAgentHandoff({
        runtime,
        codexCli: options.codexCli ?? null
      }) || ["codex", "claude"].includes(runtime);
      if (shouldUseAgentHandoff) {
        const surfaceHints = buildLinkedinQuickSurfaceHints({ limit });
        const outputGuide = buildLinkedinCaptureOutputGuide({ mode, limit });
        const captureScaffold = buildLinkedinQuickCaptureScaffold({ limit });

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
          profile: null,
          probe,
          transport: buildAgentHandoffTransport({
            capability: "linkedin",
            runtime,
            connector,
            source: liveSource.source,
            captureTransportMode: "connector_native_only",
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
            profileSelection: null
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
          codexCli: resolveCodexCliCommand({ codexCli: options.codexCli ?? null }),
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
    surfaceKeys: requestedSurfaceKeys,
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
    profile: null,
    probe,
    transport,
    capture: built.capture,
    payload: built.payload
  };
}

/**
 * @param {import("../schema/user.js").userSchema._type} user
 * @param {import("../schema/user.js").userConnectedAccountSchema._type} account
 * @param {{ runtime?: string | null, connector?: string | null, codexHome?: string | null, claudeCli?: string | null }} input
 */
function resolveLinkedinLiveSource(user, account, input) {
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
  if (resolvedConnector !== "unipile") {
    throw new Error(
      `LinkedIn live sync now requires a managed Unipile account. Account ${account.id} resolves through ${harnessConnection.runtime}:${harnessConnection.connector}.`
    );
  }
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
 *   maxPages: number | null,
 *   pageSize: number | null,
 *   resumeCursor: string | null,
 *   resumeStartOffset: number | null,
 *   surfaceKeys: string[],
 *   codexHome: string | null,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null
 *   httpPostImpl: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null
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

  const { apiKey, baseUrl, v2ApiKey, v2BaseUrl } = readUnipileConfig(input.codexHome);
  if (!apiKey) {
    return null;
  }

  return captureLinkedinQuickSurfacesThroughUnipile({
    apiKey,
    baseUrl,
    v2ApiKey,
    v2BaseUrl,
    providerAccountId,
    mode: input.mode,
    limit: input.limit,
    maxPages: input.maxPages,
    pageSize: input.pageSize,
    resumeCursor: input.resumeCursor,
    resumeStartOffset: input.resumeStartOffset,
    surfaceKeys: input.surfaceKeys,
    httpGetImpl: input.httpGetImpl,
    httpPostImpl: input.httpPostImpl,
  });
}

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   v2ApiKey: string | null,
 *   v2BaseUrl: string,
 *   providerAccountId: string,
 *   mode: string,
 *   limit: number,
 *   maxPages: number | null,
 *   pageSize: number | null,
 *   resumeCursor: string | null,
 *   resumeStartOffset: number | null,
 *   surfaceKeys: string[],
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null
 *   httpPostImpl: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null
 * }} input
 */
async function captureLinkedinQuickSurfacesThroughUnipile(input) {
  const mode = normalizeNullableString(input.mode)?.toLowerCase() === "full" ? "full" : "quick";
  const requestedSurfaceKeys = new Set(input.surfaceKeys);
  /** @type {Map<string, Promise<null | {
   *   providerId: string | null,
   *   publicIdentifier: string | null,
   *   headline: string | null,
   *   companyName: string | null,
   *   companyId: string | null,
   *   companyPublicIdentifier: string | null,
   *   companyProfileUrl: string | null,
   *   companyPictureUrl: string | null,
   *   profileUrl: string | null,
   *   pictureUrl: string | null,
   * }>>} */
  const profileCache = new Map();
  /** @type {Map<string, Promise<null | {
   *   name: string | null,
   *   domain: string | null,
   *   websiteUrl: string | null,
   *   linkedinCompanyUrl: string | null,
   *   logoSourceUrl: string | null,
   * }>>} */
  const companyCache = new Map();
  const [sentInvitations, receivedInvitations, messagingInbox, profileViews, followersList, followingList] = await Promise.all([
    requestedSurfaceKeys.has("linkedin-sent-invitations")
      ? captureUnipileSentInvitationsSurface({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          providerAccountId: input.providerAccountId,
          mode,
          limit: input.limit,
          maxPages: input.maxPages,
          pageSize: input.pageSize,
          resumeCursor: input.resumeCursor,
          httpGetImpl: input.httpGetImpl,
          profileCache,
          companyCache
        })
      : Promise.resolve(buildSkippedLinkedinSurface(mode)),
    requestedSurfaceKeys.has("linkedin-received-invitations")
      ? captureUnipileReceivedInvitationsSurface({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          providerAccountId: input.providerAccountId,
          mode,
          limit: input.limit,
          httpGetImpl: input.httpGetImpl,
          profileCache,
          companyCache
        })
      : Promise.resolve(buildSkippedLinkedinSurface(mode)),
    requestedSurfaceKeys.has("linkedin-messaging-inbox")
      ? captureUnipileMessagingInboxSurface({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          providerAccountId: input.providerAccountId,
          mode,
          limit: input.limit,
          httpGetImpl: input.httpGetImpl,
          profileCache,
          companyCache
        })
      : Promise.resolve(buildSkippedLinkedinSurface(mode)),
    requestedSurfaceKeys.has("linkedin-profile-views")
      ? captureUnipileProfileViewsSurface({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          v2ApiKey: input.v2ApiKey,
          v2BaseUrl: input.v2BaseUrl,
          providerAccountId: input.providerAccountId,
          mode,
          limit: input.limit,
          maxPages: input.maxPages,
          pageSize: input.pageSize,
          resumeStartOffset: input.resumeStartOffset,
          httpPostImpl: input.httpPostImpl,
          profileCache,
          companyCache,
          httpGetImpl: input.httpGetImpl
        })
      : Promise.resolve(buildSkippedLinkedinSurface(mode)),
    requestedSurfaceKeys.has("linkedin-followers-list")
      ? captureUnipileFollowersSurface({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          providerAccountId: input.providerAccountId,
          mode,
          limit: input.limit,
          maxPages: input.maxPages,
          pageSize: input.pageSize,
          resumeCursor: input.resumeCursor,
          httpGetImpl: input.httpGetImpl,
          profileCache,
          companyCache
        })
      : Promise.resolve(buildSkippedLinkedinSurface(mode)),
    requestedSurfaceKeys.has("linkedin-following-list")
      ? captureUnipileFollowingSurface({
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          v2ApiKey: input.v2ApiKey,
          v2BaseUrl: input.v2BaseUrl,
          providerAccountId: input.providerAccountId,
          mode,
          limit: input.limit,
          maxPages: input.maxPages,
          pageSize: input.pageSize,
          resumeStartOffset: input.resumeStartOffset,
          httpPostImpl: input.httpPostImpl,
          profileCache,
          companyCache,
          httpGetImpl: input.httpGetImpl
        })
      : Promise.resolve(buildSkippedLinkedinSurface(mode))
  ]);

  return linkedinInboundSyncCaptureSchema.parse({
    mode,
    sentInvitations,
    receivedInvitations,
    messagingInbox,
    profileViews,
    followersList,
    followingList
  });
}

/**
 * @param {{ apiKey: string, baseUrl: string, providerAccountId: string, mode: "quick" | "full", limit: number, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null, profileCache: Map<string, Promise<null | { providerId: string | null, publicIdentifier: string | null, headline: string | null, companyName: string | null, profileUrl: string | null, pictureUrl: string | null }>> }} input
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
    maxPageSize: LINKEDIN_COLLECTION_MAX_PAGE_SIZE,
    partialError: "Unipile returned more pending sent invitations than this quick pass itemized.",
    httpGetImpl: input.httpGetImpl,
    mapItem: (item, fallbackObservedAt) => {
      const invitationId = normalizeNullableString(item?.id);
      if (!invitationId) {
        return null;
      }

      const actorName = normalizeNullableString(item?.invited_user) ?? "Unknown LinkedIn user";
      const actorHandle = normalizeNullableString(item?.invited_user_public_id) ?? null;
      const actorTitle = normalizeNullableString(item?.invited_user_description) ?? null;
      const actorLinkedinMemberId = normalizeNullableString(item?.invited_user_id) ?? null;
      return enrichUnipileLinkedinActorIdentity({
        providerAccountId: input.providerAccountId,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        httpGetImpl: input.httpGetImpl,
        profileCache: input.profileCache,
        companyCache: input.companyCache,
        actorTitle,
        actorCompanyName: normalizeNullableString(item?.invited_user_company_name)
          ?? normalizeNullableString(item?.company_name)
          ?? deriveLinkedinCompanyName(actorTitle),
        actorHandle,
        actorProfileUrl: buildLinkedinProfileUrlFromPublicId(actorHandle),
        actorLinkedinPublicId: actorHandle,
        actorLinkedinMemberId,
        actorAvatarSourceUrl: null,
      }).then((actor) => ({
        invitationId,
        kind: "connection_request_pending",
        observedAt: coerceIsoDatetime(item?.parsed_datetime ?? item?.date, fallbackObservedAt),
        eventAt: coerceIsoDatetime(item?.parsed_datetime ?? item?.date, fallbackObservedAt),
        summary: `${actorName} is still pending on LinkedIn.`,
        providerSharedSecret: normalizeNullableString(item?.specifics?.shared_secret) ?? null,
        actorName,
        actorTitle: actor.actorTitle,
        actorCompanyName: actor.actorCompanyName,
        actorHandle: actor.actorHandle,
        actorProfileUrl: actor.actorProfileUrl,
        actorLinkedinPublicId: actor.actorLinkedinPublicId,
        actorLinkedinMemberId: actor.actorLinkedinMemberId,
        actorAvatarSourceUrl: actor.actorAvatarSourceUrl,
        actorCompanyProfile: actor.actorCompanyProfile,
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/sent/",
        motionId: null,
        companyId: null,
        prospectId: null,
        notes: normalizeNullableString(item?.invitation_text) ?? null
      }));
    }
  });
}

/**
 * @param {{ apiKey: string, baseUrl: string, providerAccountId: string, mode: "quick" | "full", limit: number, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null, profileCache: Map<string, Promise<null | { providerId: string | null, publicIdentifier: string | null, headline: string | null, companyName: string | null, profileUrl: string | null, pictureUrl: string | null }>> }} input
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
    maxPageSize: LINKEDIN_COLLECTION_MAX_PAGE_SIZE,
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
      const actorTitle = normalizeNullableString(inviter.inviter_description) ?? null;
      const actorLinkedinMemberId = normalizeNullableString(inviter.inviter_id) ?? null;
      return enrichUnipileLinkedinActorIdentity({
        providerAccountId: input.providerAccountId,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        httpGetImpl: input.httpGetImpl,
        profileCache: input.profileCache,
        companyCache: input.companyCache,
        actorTitle,
        actorCompanyName: normalizeNullableString(inviter.company_name)
          ?? normalizeNullableString(item?.company_name)
          ?? deriveLinkedinCompanyName(actorTitle),
        actorHandle,
        actorProfileUrl: buildLinkedinProfileUrlFromPublicId(actorHandle),
        actorLinkedinPublicId: actorHandle,
        actorLinkedinMemberId,
        actorAvatarSourceUrl: null,
      }).then((actor) => ({
        invitationId,
        kind: "connection_request_received",
        observedAt: coerceIsoDatetime(item?.parsed_datetime ?? item?.date, fallbackObservedAt),
        summary: `${actorName} sent a new inbound LinkedIn connection request.`,
        providerSharedSecret: normalizeNullableString(item?.specifics?.shared_secret) ?? null,
        actorName,
        actorTitle: actor.actorTitle,
        actorCompanyName: actor.actorCompanyName,
        actorHandle: actor.actorHandle,
        actorProfileUrl: actor.actorProfileUrl,
        actorLinkedinPublicId: actor.actorLinkedinPublicId,
        actorLinkedinMemberId: actor.actorLinkedinMemberId,
        actorAvatarSourceUrl: actor.actorAvatarSourceUrl,
        actorCompanyProfile: actor.actorCompanyProfile,
        sourceUrl: "https://www.linkedin.com/mynetwork/invitation-manager/",
        motionId: null,
        companyId: null,
        prospectId: null,
        notes: normalizeNullableString(item?.invitation_text) ?? null
      }));
    }
  });
}

/**
 * @param {{ apiKey: string, baseUrl: string, providerAccountId: string, mode: "quick" | "full", limit: number, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null, profileCache: Map<string, Promise<null | { providerId: string | null, publicIdentifier: string | null, headline: string | null, companyName: string | null, profileUrl: string | null, pictureUrl: string | null }>> }} input
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
    maxPageSize: LINKEDIN_COLLECTION_MAX_PAGE_SIZE,
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
        profileCache: input.profileCache,
        companyCache: input.companyCache,
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
        actorCompanyProfile: attendee?.companyProfile ?? null,
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
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   v2ApiKey: string | null,
 *   v2BaseUrl: string,
 *   providerAccountId: string,
 *   mode: "quick" | "full",
 *   limit: number,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpPostImpl: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null
 *   profileCache: Map<string, Promise<null | { providerId: string | null, publicIdentifier: string | null, headline: string | null, companyName: string | null, profileUrl: string | null, pictureUrl: string | null }>>
 * }} input
 */
async function captureUnipileProfileViewsSurface(input) {
  return captureUnipileLinkedinProxyCollectionSurface({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    v2ApiKey: input.v2ApiKey,
    v2BaseUrl: input.v2BaseUrl,
    providerAccountId: input.providerAccountId,
    routeLabel: "profile views capture",
    mode: input.mode,
    limit: input.limit,
    pageSize: input.mode === "full"
      ? DEFAULT_LINKEDIN_PROXY_PAGE_SIZE
      : Math.max(1, input.limit),
    partialError: "Unipile returned more LinkedIn profile views than this quick pass itemized.",
    httpPostImpl: input.httpPostImpl,
    buildRequest: (start, count) => ({
      url: "https://www.linkedin.com/voyager/api/graphql",
      queryParams: {
        queryId: LINKEDIN_PROFILE_VIEWS_QUERY_ID,
        variables: `(start:${start},count:${count},query:(),analyticsEntityUrn:(activityUrn:urn%3Ali%3Adummy%3A-1),surfaceType:WVMP)`
      }
    }),
    extractItems: (parsed) => extractLinkedinProxyPayload(parsed)?.premiumDashAnalyticsObjectByAnalyticsEntity?.elements ?? null,
    resolveVisibleTotalCount: (parsed) => {
      const total = Number(extractLinkedinProxyPayload(parsed)?.premiumDashAnalyticsObjectByAnalyticsEntity?.paging?.total);
      return Number.isFinite(total) && total > 0 ? total : null;
    },
    mapItem: async (item, fallbackObservedAt) => {
      const entityLockup = item?.content?.analyticsEntityLockup?.entityLockup ?? null;
      const actorName = normalizeNullableString(entityLockup?.title?.text) ?? "Unknown LinkedIn user";
      const actorTitle = normalizeNullableString(item?.content?.ctaItem?.actionData?.entityProfile?.headline)
        ?? normalizeNullableString(entityLockup?.subtitle?.text)
        ?? null;
      const actorProfileUrl = normalizeLinkedinProfileUrl(
        normalizeNullableString(entityLockup?.navigationUrl)
        ?? buildLinkedinProfileUrlFromPublicId(
          normalizeNullableString(item?.content?.ctaItem?.actionData?.entityProfile?.publicIdentifier) ?? null
        )
      );
      const actorHandle = normalizeNullableString(item?.content?.ctaItem?.actionData?.entityProfile?.publicIdentifier)
        ?? extractLinkedinPublicId(actorProfileUrl);
      const actorLinkedinMemberId = normalizeNullableString(item?.content?.ctaItem?.actionData?.entityProfile?.entityUrn)
        ?? normalizeNullableString(entityLockup?.image?.attributes?.[0]?.detailData?.profilePicture?.entityUrn)
        ?? null;
      const actor = await enrichUnipileLinkedinActorIdentity({
        providerAccountId: input.providerAccountId,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        httpGetImpl: input.httpGetImpl,
        profileCache: input.profileCache,
        companyCache: input.companyCache,
        actorTitle,
        actorCompanyName: null,
        actorHandle,
        actorProfileUrl,
        actorLinkedinPublicId: actorHandle,
        actorLinkedinMemberId,
        actorAvatarSourceUrl: extractLinkedinImageUrl(entityLockup?.image),
      });
      const caption = normalizeNullableString(entityLockup?.caption?.text) ?? null;
      const eventAt = deriveLinkedinRelativeEventAt(caption, fallbackObservedAt);
      const viewIdBase = actor.actorProfileUrl ?? `${actorName}:${caption ?? fallbackObservedAt}`;
      return {
        viewId: `${viewIdBase}::${eventAt ?? fallbackObservedAt}`,
        kind: "profile_view_received",
        observedAt: fallbackObservedAt,
        eventAt,
        summary: caption
          ? `${actorName} appeared in your LinkedIn profile viewers. ${caption}.`
          : `${actorName} appeared in your LinkedIn profile viewers.`,
        actorName,
        actorTitle: actor.actorTitle,
        actorCompanyName: actor.actorCompanyName,
        actorHandle: actor.actorHandle,
        actorProfileUrl: actor.actorProfileUrl,
        actorLinkedinPublicId: actor.actorLinkedinPublicId,
        actorLinkedinMemberId: actor.actorLinkedinMemberId,
        actorAvatarSourceUrl: actor.actorAvatarSourceUrl,
        actorCompanyProfile: actor.actorCompanyProfile,
        sourceUrl: actor.actorProfileUrl,
        motionId: null,
        companyId: null,
        prospectId: null,
        notes: normalizeNullableString(entityLockup?.label?.text)
          ? `LinkedIn viewer label: ${normalizeNullableString(entityLockup?.label?.text)}`
          : null
      };
    }
  });
}

/**
 * @param {{ apiKey: string, baseUrl: string, providerAccountId: string, mode: "quick" | "full", limit: number, maxPages?: number | null, pageSize?: number | null, resumeCursor?: string | null, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null, profileCache: Map<string, Promise<null | { providerId: string | null, publicIdentifier: string | null, headline: string | null, companyName: string | null, profileUrl: string | null, pictureUrl: string | null }>> }} input
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
    maxPages: input.maxPages ?? null,
    pageSize: input.pageSize ?? null,
    resumeCursor: input.resumeCursor ?? null,
    maxPageSize: LINKEDIN_FOLLOWERS_MAX_PAGE_SIZE,
    partialError: "Unipile returned more LinkedIn followers than this quick pass itemized.",
    acceptTrailingEmptyCursor: true,
    httpGetImpl: input.httpGetImpl,
    mapItem: async (item, fallbackObservedAt) => {
      const entryId = normalizeNullableString(item?.id);
      if (!entryId) {
        return null;
      }

      const actorProfileUrl = normalizeNullableString(item?.profile_url) ?? null;
      const actorHandle = extractLinkedinPublicId(actorProfileUrl);
      const actorName = normalizeNullableString(item?.name) ?? "Unknown LinkedIn user";
      const actorTitle = normalizeNullableString(item?.headline) ?? null;
      const actorLinkedinMemberId = normalizeNullableString(item?.id) ?? normalizeNullableString(item?.urn) ?? null;
      const actor = await enrichUnipileLinkedinActorIdentity({
        providerAccountId: input.providerAccountId,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        httpGetImpl: input.httpGetImpl,
        profileCache: input.profileCache,
        companyCache: input.companyCache,
        actorTitle,
        actorCompanyName: normalizeNullableString(item?.company_name)
          ?? deriveLinkedinCompanyName(actorTitle),
        actorHandle,
        actorProfileUrl,
        actorLinkedinPublicId: actorHandle,
        actorLinkedinMemberId,
        actorAvatarSourceUrl: normalizeNullableString(item?.profile_picture_url_large) ?? normalizeNullableString(item?.profile_picture_url) ?? null,
      });
      return {
        entryId,
        kind: "follower_confirmed",
        observedAt: fallbackObservedAt,
        summary: `${actorName} is present in the LinkedIn follower list.`,
        actorName,
        actorTitle: actor.actorTitle,
        actorCompanyName: actor.actorCompanyName,
        actorHandle: actor.actorHandle,
        actorProfileUrl: actor.actorProfileUrl,
        actorLinkedinPublicId: actor.actorLinkedinPublicId,
        actorLinkedinMemberId: actor.actorLinkedinMemberId,
        actorAvatarSourceUrl: actor.actorAvatarSourceUrl,
        actorCompanyProfile: actor.actorCompanyProfile,
        sourceUrl: actor.actorProfileUrl,
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
 *   v2ApiKey: string | null,
 *   v2BaseUrl: string,
 *   providerAccountId: string,
 *   mode: "quick" | "full",
 *   limit: number,
 *   maxPages?: number | null,
 *   pageSize?: number | null,
 *   resumeStartOffset?: number | null,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   httpPostImpl: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null
 *   profileCache: Map<string, Promise<null | { providerId: string | null, publicIdentifier: string | null, headline: string | null, companyName: string | null, profileUrl: string | null, pictureUrl: string | null }>>
 * }} input
 */
async function captureUnipileFollowingSurface(input) {
  return captureUnipileLinkedinProxyCollectionSurface({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    v2ApiKey: input.v2ApiKey,
    v2BaseUrl: input.v2BaseUrl,
    providerAccountId: input.providerAccountId,
    routeLabel: "following capture",
    mode: input.mode,
    limit: input.limit,
    maxPages: input.maxPages ?? null,
    pageSize: input.mode === "full"
      ? normalizePositiveInteger(input.pageSize ?? DEFAULT_LINKEDIN_PROXY_PAGE_SIZE, DEFAULT_LINKEDIN_PROXY_PAGE_SIZE, "following page size")
      : Math.max(1, input.limit),
    resumeStartOffset: input.resumeStartOffset ?? null,
    partialError: "Unipile returned more followed LinkedIn accounts than this quick pass itemized.",
    httpPostImpl: input.httpPostImpl,
    buildRequest: (start, count) => ({
      url: "https://www.linkedin.com/voyager/api/graphql",
      queryParams: {
        queryId: LINKEDIN_FOLLOWING_QUERY_ID,
        variables: `(start:${start},count:${count},origin:CurationHub,query:(flagshipSearchIntent:MYNETWORK_CURATION_HUB,includeFiltersInResponse:true,queryParameters:List((key:resultType,value:List(PEOPLE_FOLLOW)))))`
      }
    }),
    extractItems: (parsed) => extractLinkedinProxyPayload(parsed)?.searchDashClustersByAll?.elements?.[0]?.items ?? null,
    resolveVisibleTotalCount: (parsed) => {
      const payload = extractLinkedinProxyPayload(parsed)?.searchDashClustersByAll ?? null;
      const total = Number(payload?.paging?.total ?? payload?.metadata?.totalResultCount);
      return Number.isFinite(total) && total > 0 ? total : null;
    },
    mapItem: async (item, fallbackObservedAt) => {
      const entityResult = item?.item?.entityResult ?? item?.entityResult ?? null;
      const actorProfileUrl = normalizeLinkedinProfileUrl(
        normalizeNullableString(entityResult?.navigationUrl)
        ?? normalizeNullableString(entityResult?.navigationContext?.url)
      );
      const actorHandle = extractLinkedinPublicId(actorProfileUrl);
      const followAction = entityResult?.primaryActions
        ?.map((action) => action?.actionDetails?.followAction ?? null)
        .find(Boolean) ?? null;
      const entryId = normalizeNullableString(followAction?.entityUrn)
        ?? normalizeNullableString(entityResult?.trackingUrn)
        ?? actorProfileUrl;
      if (!entryId) {
        return null;
      }

      const actorName = normalizeNullableString(entityResult?.title?.text) ?? "Unknown LinkedIn user";
      const actorTitle = normalizeNullableString(entityResult?.primarySubtitle?.text) ?? null;
      const actorLinkedinMemberId = normalizeNullableString(entityResult?.trackingUrn)
        ?? normalizeNullableString(followAction?.entityUrn)
        ?? null;
      const actor = await enrichUnipileLinkedinActorIdentity({
        providerAccountId: input.providerAccountId,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        httpGetImpl: input.httpGetImpl,
        profileCache: input.profileCache,
        companyCache: input.companyCache,
        actorTitle,
        actorCompanyName: normalizeNullableString(entityResult?.companyName)
          ?? normalizeNullableString(item?.company_name)
          ?? deriveLinkedinCompanyName(actorTitle),
        actorHandle,
        actorProfileUrl,
        actorLinkedinPublicId: actorHandle,
        actorLinkedinMemberId,
        actorAvatarSourceUrl: extractLinkedinImageUrl(entityResult?.image),
      });
      return {
        entryId,
        kind: "follow_state_confirmed",
        observedAt: fallbackObservedAt,
        summary: `${actorName} is still present in the LinkedIn following list.`,
        actorName,
        actorTitle: actor.actorTitle,
        actorCompanyName: actor.actorCompanyName,
        actorHandle: actor.actorHandle,
        actorProfileUrl: actor.actorProfileUrl,
        actorLinkedinPublicId: actor.actorLinkedinPublicId,
        actorLinkedinMemberId: actor.actorLinkedinMemberId,
        actorAvatarSourceUrl: actor.actorAvatarSourceUrl,
        actorCompanyProfile: actor.actorCompanyProfile,
        sourceUrl: actor.actorProfileUrl,
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
 *   maxPages?: number | null,
 *   pageSize?: number | null,
 *   resumeCursor?: string | null,
 *   maxPageSize: number,
 *   partialError: string,
 *   acceptTrailingEmptyCursor?: boolean,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   extraQuery?: Record<string, string> | null,
 *   mapItem: (item: any, fallbackObservedAt: string) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null
 * }} input
 */
async function captureUnipileLinkedinCollectionSurface(input) {
  const targetCount = input.mode === "full" ? Number.POSITIVE_INFINITY : input.limit;
  const maxPages = input.mode === "full" ? normalizeOptionalPositiveInteger(input.maxPages ?? null, "maxPages") : null;
  const pageSize = input.mode === "full"
    ? Math.max(1, Math.min(input.pageSize ?? input.maxPageSize, input.maxPageSize))
    : Math.max(1, Math.min(input.limit, input.maxPageSize));
  const items = [];
  let cursor = input.resumeCursor ?? null;
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
    const paginationAttempted = pageCount > 1 || Boolean(input.resumeCursor);
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
        paginationAttempted,
        terminalSignalSeen: true,
        stalledPassCount: 0,
        nextCursor: null,
        nextStartOffset: null,
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
        nextCursor,
        nextStartOffset: null,
        error: input.partialError,
        items
      };
    }

    if (!rawItems.length) {
      if (input.acceptTrailingEmptyCursor && items.length > 0) {
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
          exhaustionReason: "provider_empty_cursor_tail",
          paginationAttempted,
          terminalSignalSeen: true,
          stalledPassCount: 0,
          nextCursor: null,
          nextStartOffset: null,
          error: null,
          items
        };
      }
      return buildFailedSurface(
        `Unipile ${input.routeLabel} returned an empty page while advertising another cursor.`,
        checkedAt,
        input.mode
      );
    }

    if (maxPages !== null && pageCount >= maxPages) {
      return {
        status: "warning",
        checkedAt,
        itemCount: items.length,
        visibleTotalCount: null,
        captureCompleteness: "partial_visible_slice",
        requestedMode: input.mode,
        actualMode: input.mode,
        reconcileRequired: true,
        reconcileReason: "page_budget_stopped_early",
        exhaustionStatus: "incomplete",
        exhaustionReason: "page_budget_stopped_early",
        paginationAttempted,
        terminalSignalSeen: false,
        stalledPassCount: 0,
        nextCursor,
        nextStartOffset: null,
        error: "Full reconciliation stopped at the configured page budget and should resume from the next cursor.",
        items
      };
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
    paginationAttempted: pageCount > 1 || Boolean(input.resumeCursor),
    terminalSignalSeen: true,
    stalledPassCount: 0,
    nextCursor: null,
    nextStartOffset: null,
    error: null,
    items
  };
}

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   v2ApiKey: string | null,
 *   v2BaseUrl: string,
 *   providerAccountId: string,
 *   routeLabel: string,
 *   mode: "quick" | "full",
 *   limit: number,
 *   maxPages?: number | null,
 *   pageSize: number,
 *   resumeStartOffset?: number | null,
 *   partialError: string,
 *   httpPostImpl: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null,
 *   buildRequest: (start: number, count: number) => { url: string, queryParams: Record<string, string | null> },
 *   extractItems: (parsed: any) => any[] | null,
 *   resolveVisibleTotalCount?: ((parsed: any) => number | null) | null,
 *   mapItem: (item: any, fallbackObservedAt: string) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null
 * }} input
 */
async function captureUnipileLinkedinProxyCollectionSurface(input) {
  const targetCount = input.mode === "full" ? Number.POSITIVE_INFINITY : input.limit;
  const maxPages = input.mode === "full" ? normalizeOptionalPositiveInteger(input.maxPages ?? null, "maxPages") : null;
  const requestedPageSize = input.mode === "full"
    ? Math.max(1, input.pageSize)
    : Math.max(1, Math.min(input.limit, input.pageSize));
  const items = [];
  let start = input.resumeStartOffset ?? 0;
  let pageCount = 0;
  let visibleTotalCount = null;

  while (items.length < targetCount) {
    const response = await fetchUnipileLinkedinProxyJson({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      v2ApiKey: input.v2ApiKey,
      v2BaseUrl: input.v2BaseUrl,
      providerAccountId: input.providerAccountId,
      request: input.buildRequest(start, requestedPageSize),
      httpPostImpl: input.httpPostImpl
    });
    const checkedAt = new Date().toISOString();
    if (!response.ok) {
      return buildFailedSurface(
        response.error ?? formatUnipileRouteFailure(input.routeLabel, response.status, response.parsed),
        checkedAt,
        input.mode,
        isUnipileUnsupportedSurfaceFailure(response.status, response.parsed)
          ? "connector_surface_unsupported"
          : "transport_or_surface_failure"
      );
    }

    const rawItems = input.extractItems(response.parsed);
    if (!Array.isArray(rawItems)) {
      return buildFailedSurface(
        `Unipile ${input.routeLabel} returned an invalid payload without an items array.`,
        checkedAt,
        input.mode
      );
    }

    pageCount += 1;
    const resolvedVisibleTotal = input.resolveVisibleTotalCount?.(response.parsed) ?? null;
    if (resolvedVisibleTotal !== null) {
      visibleTotalCount = resolvedVisibleTotal;
    }

    for (const rawItem of rawItems) {
      if (items.length >= targetCount) {
        break;
      }
      const mapped = await input.mapItem(rawItem, checkedAt);
      if (mapped) {
        items.push(mapped);
      }
    }

    const paginationAttempted = pageCount > 1 || start > 0;
    const exhaustedByTotal = visibleTotalCount !== null && (start + items.length) >= visibleTotalCount;
    const exhaustedByShortPage = rawItems.length < requestedPageSize;
    if (exhaustedByTotal || exhaustedByShortPage) {
      return {
        status: "success",
        checkedAt,
        itemCount: items.length,
        visibleTotalCount: visibleTotalCount ?? items.length,
        captureCompleteness: "complete",
        requestedMode: input.mode,
        actualMode: input.mode,
        reconcileRequired: false,
        reconcileReason: null,
        exhaustionStatus: "complete",
        exhaustionReason: exhaustedByTotal ? "reported_total_exhausted" : "short_page_exhausted",
        paginationAttempted,
        terminalSignalSeen: true,
        stalledPassCount: 0,
        nextCursor: null,
        nextStartOffset: null,
        error: null,
        items
      };
    }

    if (input.mode !== "full" && items.length >= input.limit) {
      return {
        status: "warning",
        checkedAt,
        itemCount: items.length,
        visibleTotalCount,
        captureCompleteness: "partial_visible_slice",
        requestedMode: input.mode,
        actualMode: input.mode,
        reconcileRequired: true,
        reconcileReason: "bounded_capture_stopped_early",
        exhaustionStatus: "incomplete",
        exhaustionReason: "bounded_capture_stopped_early",
        paginationAttempted: rawItems.length > 0,
        terminalSignalSeen: false,
        stalledPassCount: 0,
        nextCursor: null,
        nextStartOffset: start + rawItems.length,
        error: input.partialError,
        items
      };
    }

    if (!rawItems.length) {
      return buildFailedSurface(
        `Unipile ${input.routeLabel} returned an empty page before the live surface was exhausted.`,
        checkedAt,
        input.mode
      );
    }

    if (maxPages !== null && pageCount >= maxPages) {
      return {
        status: "warning",
        checkedAt,
        itemCount: items.length,
        visibleTotalCount,
        captureCompleteness: "partial_visible_slice",
        requestedMode: input.mode,
        actualMode: input.mode,
        reconcileRequired: true,
        reconcileReason: "page_budget_stopped_early",
        exhaustionStatus: "incomplete",
        exhaustionReason: "page_budget_stopped_early",
        paginationAttempted,
        terminalSignalSeen: false,
        stalledPassCount: 0,
        nextCursor: null,
        nextStartOffset: start + rawItems.length,
        error: "Full reconciliation stopped at the configured page budget and should resume from the next offset.",
        items
      };
    }

    start += rawItems.length;
  }

  return {
    status: "success",
    checkedAt: new Date().toISOString(),
    itemCount: items.length,
    visibleTotalCount: visibleTotalCount ?? items.length,
    captureCompleteness: "complete",
    requestedMode: input.mode,
    actualMode: input.mode,
    reconcileRequired: false,
    reconcileReason: null,
    exhaustionStatus: "complete",
    exhaustionReason: "capture_limit_exhausted",
    paginationAttempted: pageCount > 1 || (input.resumeStartOffset ?? 0) > 0,
    terminalSignalSeen: true,
    stalledPassCount: 0,
    nextCursor: null,
    nextStartOffset: null,
    error: null,
    items
  };
}

/**
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   v2ApiKey: string | null,
 *   v2BaseUrl: string,
 *   providerAccountId: string,
 *   request: { url: string, queryParams: Record<string, string | null> },
 *   httpPostImpl: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null,
 * }} input
 */
async function fetchUnipileLinkedinProxyJson(input) {
  const useV2Proxy = /^acc_/.test(input.providerAccountId) && Boolean(input.v2ApiKey);
  if (useV2Proxy) {
    const proxyUrl = `${input.v2BaseUrl.replace(/\/+$/g, "")}/${encodeURIComponent(input.providerAccountId)}/linkedin`;
    return fetchUnipileJsonPost({
      url: proxyUrl,
      apiKey: input.v2ApiKey ?? "",
      bodyText: JSON.stringify({
        method: "GET",
        url: input.request.url,
        query_params: input.request.queryParams,
        bypass_url_encoding: true
      }),
      httpPostImpl: input.httpPostImpl
    });
  }

  return fetchUnipileJsonPost({
    url: `${input.baseUrl.replace(/\/+$/g, "")}/api/v1/linkedin`,
    apiKey: input.apiKey,
    bodyText: JSON.stringify({
      account_id: input.providerAccountId,
      request_url: buildLinkedinProxyRequestUrl(input.request.url, input.request.queryParams)
    }),
    httpPostImpl: input.httpPostImpl
  });
}

/**
 * @param {any} parsed
 */
function extractLinkedinProxyPayload(parsed) {
  return parsed?.data?.data ?? parsed?.data ?? null;
}

/**
 * @param {string} url
 * @param {Record<string, string | null>} queryParams
 */
function buildLinkedinProxyRequestUrl(url, queryParams) {
  const entries = Object.entries(queryParams).filter(([, value]) => value !== null);
  if (!entries.length) {
    return url;
  }
  const query = entries.map(([key, value]) => `${encodeURIComponent(key)}=${String(value)}`).join("&");
  return `${url}?${query}`;
}

/**
 * @param {"quick" | "full"} mode
 */
function buildSkippedLinkedinSurface(mode) {
  return {
    status: "success",
    checkedAt: null,
    itemCount: 0,
    visibleTotalCount: 0,
    captureCompleteness: "complete",
    requestedMode: mode,
    actualMode: mode,
    reconcileRequired: false,
    reconcileReason: null,
    exhaustionStatus: "complete",
    exhaustionReason: "surface_not_requested",
    paginationAttempted: false,
    terminalSignalSeen: true,
    stalledPassCount: 0,
    error: null,
    items: []
  };
}

/**
 * Resolve a canonical company profile for a LinkedIn actor by using the live
 * Unipile identity path Exo already trusts during inbound sync capture.
 *
 * @param {{
 *   providerAccountId: string | null | undefined,
 *   apiKey?: string | null | undefined,
 *   baseUrl?: string | null | undefined,
 *   codexHome?: string | null | undefined,
 *   httpGetImpl?: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null | undefined,
 *   actorTitle?: string | null | undefined,
 *   actorCompanyName?: string | null | undefined,
 *   actorHandle?: string | null | undefined,
 *   actorProfileUrl?: string | null | undefined,
 *   actorLinkedinPublicId?: string | null | undefined,
 *   actorLinkedinMemberId?: string | null | undefined,
 *   actorAvatarSourceUrl?: string | null | undefined,
 * }} input
 */
export async function resolveLinkedinActorCompanyProfile(input) {
  if (!normalizeNullableString(input.providerAccountId)) {
    return null;
  }

  const unipileConfig = readUnipileConfig(input.codexHome ?? null);
  const apiKey = normalizeNullableString(input.apiKey) ?? unipileConfig.apiKey;
  if (!apiKey) {
    return null;
  }

  const enrichment = await enrichUnipileLinkedinActorIdentity({
    providerAccountId: input.providerAccountId,
    apiKey,
    baseUrl: normalizeNullableString(input.baseUrl) ?? unipileConfig.baseUrl,
    httpGetImpl: input.httpGetImpl ?? null,
    profileCache: new Map(),
    companyCache: new Map(),
    actorTitle: normalizeNullableString(input.actorTitle) ?? null,
    actorCompanyName: normalizeNullableString(input.actorCompanyName) ?? null,
    actorHandle: normalizeNullableString(input.actorHandle) ?? null,
    actorProfileUrl: normalizeLinkedinProfileUrl(input.actorProfileUrl ?? null),
    actorLinkedinPublicId: normalizeNullableString(input.actorLinkedinPublicId) ?? null,
    actorLinkedinMemberId: normalizeNullableString(input.actorLinkedinMemberId) ?? null,
    actorAvatarSourceUrl: normalizeNullableString(input.actorAvatarSourceUrl) ?? null,
  });

  return enrichment?.actorCompanyProfile ?? null;
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
 *   profileCache: Map<string, Promise<null | {
 *     providerId: string | null,
 *     publicIdentifier: string | null,
 *     headline: string | null,
 *     companyName: string | null,
 *     companyId: string | null,
 *     companyPublicIdentifier: string | null,
 *     companyProfileUrl: string | null,
 *     companyPictureUrl: string | null,
 *     profileUrl: string | null,
 *     pictureUrl: string | null,
 *   }>>,
 *   companyCache: Map<string, Promise<null | {
 *     name: string | null,
 *     domain: string | null,
 *     websiteUrl: string | null,
 *     linkedinCompanyUrl: string | null,
 *     logoSourceUrl: string | null,
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
      providerIds: [providerId, normalizeNullableString(specifics?.public_identifier) ?? null],
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      httpGetImpl: input.httpGetImpl,
      cache: input.profileCache,
    });
    const companyProfile = await resolveUnipileLinkedinCompanyProfile({
      providerAccountId: input.providerAccountId,
      companyIdentifiers: [
        profile?.companyId,
        profile?.companyPublicIdentifier,
      ],
      companyName: profile?.companyName ?? normalizeNullableString(specifics?.company_name) ?? null,
      companyProfileUrl: profile?.companyProfileUrl ?? normalizeNullableString(specifics?.company_url) ?? null,
      companyLogoSourceUrl: profile?.companyPictureUrl ?? null,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      httpGetImpl: input.httpGetImpl,
      cache: input.companyCache,
    });
    const publicIdentifier = profile?.publicIdentifier ?? normalizeNullableString(specifics?.public_identifier) ?? null;
    const occupation = profile?.headline
      ?? normalizeNullableString(specifics?.occupation)
      ?? normalizeNullableString(specifics?.description)
      ?? null;
    return {
      name: normalizeNullableString(response.parsed?.name) ?? null,
      occupation,
      companyName: profile?.companyName ?? companyProfile?.name ?? normalizeNullableString(specifics?.company_name) ?? null,
      companyProfile,
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
 *   providerIds: Array<string | null | undefined>,
 *   apiKey: string,
 *   baseUrl: string,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   cache: Map<string, Promise<null | {
 *     providerId: string | null,
 *     publicIdentifier: string | null,
 *     headline: string | null,
 *     companyName: string | null,
 *     companyId: string | null,
 *     companyPublicIdentifier: string | null,
 *     companyProfileUrl: string | null,
 *     companyPictureUrl: string | null,
 *     profileUrl: string | null,
 *     pictureUrl: string | null,
 *   }>>,
 * }} input
 */
async function resolveUnipileLinkedinUserProfile(input) {
  const candidates = buildUnipileLinkedinUserLookupCandidates(input.providerIds);
  if (!candidates.length) {
    return null;
  }

  for (const providerId of candidates) {
    const cached = input.cache.get(providerId);
    const lookup = cached ?? (async () => {
      const response = await fetchUnipileJsonPage({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        pathname: `/api/v1/users/${encodeURIComponent(providerId)}`,
        query: {
          account_id: input.providerAccountId,
          linkedin_sections: ["experience"],
        },
        httpGetImpl: input.httpGetImpl,
      });
      if (!response.ok) {
        return null;
      }

      const publicIdentifier = normalizeNullableString(response.parsed?.public_identifier)
        ?? normalizeNullableString(response.parsed?.username)
        ?? null;
      const headline = normalizeNullableString(response.parsed?.headline) ?? null;
      const currentExperience = findCurrentUnipileWorkExperience(response.parsed?.work_experience);
      const companyProfileUrl = normalizeLinkedinCompanyUrl(
        normalizeNullableString(currentExperience?.company_url)
        ?? normalizeNullableString(response.parsed?.company?.profile_url)
        ?? normalizeNullableString(response.parsed?.company_url)
        ?? normalizeNullableString(response.parsed?.current_company_url)
        ?? buildLinkedinCompanyUrlFromPublicId(
          normalizeNullableString(response.parsed?.company?.public_identifier)
          ?? extractLinkedinCompanyPublicId(normalizeNullableString(currentExperience?.company_url) ?? null)
        )
      );
      return {
        providerId: normalizeNullableString(response.parsed?.provider_id) ?? providerId,
        publicIdentifier,
        headline,
        companyName: normalizeNullableString(response.parsed?.current_company_name)
          ?? normalizeNullableString(response.parsed?.company_name)
          ?? normalizeNullableString(currentExperience?.company)
          ?? normalizeNullableString(response.parsed?.company?.name)
          ?? deriveLinkedinCompanyName(headline),
        companyId: normalizeNullableString(response.parsed?.current_company_id)
          ?? normalizeNullableString(response.parsed?.company_id)
          ?? normalizeNullableString(currentExperience?.company_id)
          ?? normalizeNullableString(response.parsed?.company?.id)
          ?? null,
        companyPublicIdentifier: normalizeNullableString(response.parsed?.company?.public_identifier)
          ?? extractLinkedinCompanyPublicId(companyProfileUrl)
          ?? null,
        companyProfileUrl,
        companyPictureUrl: normalizeNullableString(currentExperience?.company_picture_url)
          ?? normalizeNullableString(response.parsed?.company?.logo)
          ?? normalizeNullableString(response.parsed?.company?.logo_url)
          ?? normalizeNullableString(response.parsed?.company_logo_url)
          ?? null,
        profileUrl: normalizeLinkedinProfileUrl(
          normalizeNullableString(response.parsed?.public_profile_url)
          ?? normalizeNullableString(response.parsed?.profile_url)
          ?? buildLinkedinProfileUrlFromPublicId(publicIdentifier)
        ),
        pictureUrl: normalizeNullableString(response.parsed?.profile_picture_url)
          ?? normalizeNullableString(response.parsed?.profile_picture_url_large)
          ?? null,
      };
    })();
    if (!cached) {
      input.cache.set(providerId, lookup);
    }
    const resolved = await lookup;
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

/**
 * @param {{
 *   providerAccountId: string,
 *   companyIdentifiers: Array<string | null | undefined>,
 *   companyName: string | null,
 *   companyProfileUrl: string | null,
 *   companyLogoSourceUrl: string | null,
 *   apiKey: string,
 *   baseUrl: string,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   cache: Map<string, Promise<null | {
 *     name: string | null,
 *     domain: string | null,
 *     websiteUrl: string | null,
 *     linkedinCompanyUrl: string | null,
 *     logoSourceUrl: string | null,
 *   }>>,
 * }} input
 */
async function resolveUnipileLinkedinCompanyProfile(input) {
  const candidates = buildUnipileLinkedinCompanyLookupCandidates(
    input.companyIdentifiers,
    input.companyProfileUrl,
  );
  const fallbackCompany = buildFallbackUnipileCompanyProfile(input);
  if (!candidates.length) {
    return fallbackCompany;
  }

  for (const companyIdentifier of candidates) {
    const cached = input.cache.get(companyIdentifier);
    const lookup = cached ?? (async () => {
      const response = await fetchUnipileJsonPage({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        pathname: `/api/v1/linkedin/company/${encodeURIComponent(companyIdentifier)}`,
        query: {
          account_id: input.providerAccountId,
        },
        httpGetImpl: input.httpGetImpl,
      });
      if (!response.ok) {
        return fallbackCompany;
      }

      const linkedinCompanyUrl = normalizeLinkedinCompanyUrl(
        normalizeNullableString(response.parsed?.profile_url)
        ?? buildLinkedinCompanyUrlFromPublicId(normalizeNullableString(response.parsed?.public_identifier))
        ?? input.companyProfileUrl
      );
      const websiteUrl = normalizeNullableString(response.parsed?.website)
        ?? normalizeNullableString(response.parsed?.company_url)
        ?? fallbackCompany?.websiteUrl
        ?? null;
      return buildNormalizedUnipileCompanyProfile({
        name: normalizeNullableString(response.parsed?.name) ?? input.companyName,
        domain: domainFromUrl(websiteUrl) ?? fallbackCompany?.domain ?? null,
        websiteUrl,
        linkedinCompanyUrl,
        logoSourceUrl: normalizeNullableString(response.parsed?.logo)
          ?? normalizeNullableString(response.parsed?.logo_url)
          ?? input.companyLogoSourceUrl
          ?? fallbackCompany?.logoSourceUrl
          ?? null,
      });
    })();
    if (!cached) {
      input.cache.set(companyIdentifier, lookup);
    }
    const resolved = await lookup;
    if (resolved) {
      return resolved;
    }
  }

  return fallbackCompany;
}

/**
 * @param {{
 *   providerAccountId: string,
 *   apiKey: string,
 *   baseUrl: string,
 *   httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null,
 *   profileCache: Map<string, Promise<null | {
 *     providerId: string | null,
 *     publicIdentifier: string | null,
 *     headline: string | null,
 *     companyName: string | null,
 *     companyId: string | null,
 *     companyPublicIdentifier: string | null,
 *     companyProfileUrl: string | null,
 *     companyPictureUrl: string | null,
 *     profileUrl: string | null,
 *     pictureUrl: string | null,
 *   }>>,
 *   companyCache: Map<string, Promise<null | {
 *     name: string | null,
 *     domain: string | null,
 *     websiteUrl: string | null,
 *     linkedinCompanyUrl: string | null,
 *     logoSourceUrl: string | null,
 *   }>>,
 *   actorTitle: string | null,
 *   actorCompanyName: string | null,
 *   actorHandle: string | null,
 *   actorProfileUrl: string | null,
 *   actorLinkedinPublicId: string | null,
 *   actorLinkedinMemberId: string | null,
 *   actorAvatarSourceUrl: string | null,
 * }} input
 */
async function enrichUnipileLinkedinActorIdentity(input) {
  const profile = await resolveUnipileLinkedinUserProfile({
    providerAccountId: input.providerAccountId,
    providerIds: [
      input.actorLinkedinMemberId,
      normalizeLinkedinMemberLookupId(input.actorLinkedinMemberId),
      input.actorLinkedinPublicId,
      input.actorHandle,
      extractLinkedinPublicId(input.actorProfileUrl),
    ],
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    httpGetImpl: input.httpGetImpl,
    cache: input.profileCache,
  });
  const companyProfile = await resolveUnipileLinkedinCompanyProfile({
    providerAccountId: input.providerAccountId,
    companyIdentifiers: [
      profile?.companyId,
      profile?.companyPublicIdentifier,
    ],
    companyName: normalizeNullableString(input.actorCompanyName) ?? profile?.companyName ?? null,
    companyProfileUrl: profile?.companyProfileUrl ?? null,
    companyLogoSourceUrl: profile?.companyPictureUrl ?? null,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    httpGetImpl: input.httpGetImpl,
    cache: input.companyCache,
  });
  const actorTitle = input.actorTitle ?? profile?.headline ?? null;
  const actorHandle = input.actorHandle ?? profile?.publicIdentifier ?? extractLinkedinPublicId(input.actorProfileUrl) ?? null;
  const actorProfileUrl = normalizeLinkedinProfileUrl(
    input.actorProfileUrl
    ?? profile?.profileUrl
    ?? buildLinkedinProfileUrlFromPublicId(actorHandle)
  );
  return {
    actorTitle,
    actorCompanyName: normalizeNullableString(input.actorCompanyName)
      ?? profile?.companyName
      ?? companyProfile?.name
      ?? deriveLinkedinCompanyName(actorTitle),
    actorHandle,
    actorProfileUrl,
    actorLinkedinPublicId: input.actorLinkedinPublicId ?? profile?.publicIdentifier ?? actorHandle,
    actorLinkedinMemberId: input.actorLinkedinMemberId ?? profile?.providerId ?? null,
    actorAvatarSourceUrl: input.actorAvatarSourceUrl ?? profile?.pictureUrl ?? null,
    actorCompanyProfile: companyProfile,
  };
}

/**
 * @param {Array<string | null | undefined>} providerIds
 */
function buildUnipileLinkedinUserLookupCandidates(providerIds) {
  const unique = new Set();
  for (const rawProviderId of providerIds) {
    const normalized = normalizeNullableString(rawProviderId);
    if (!normalized || unique.has(normalized)) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

/**
 * @param {Array<string | null | undefined>} companyIdentifiers
 * @param {string | null | undefined} companyProfileUrl
 */
function buildUnipileLinkedinCompanyLookupCandidates(companyIdentifiers, companyProfileUrl) {
  const unique = new Set();
  for (const rawIdentifier of companyIdentifiers) {
    const normalized = normalizeNullableString(rawIdentifier);
    if (!normalized || unique.has(normalized)) {
      continue;
    }
    unique.add(normalized);
  }

  const companyPublicId = extractLinkedinCompanyPublicId(companyProfileUrl);
  if (companyPublicId && !unique.has(companyPublicId)) {
    unique.add(companyPublicId);
  }

  return [...unique];
}

/**
 * @param {string | null | undefined} memberId
 */
function normalizeLinkedinMemberLookupId(memberId) {
  const normalized = normalizeNullableString(memberId);
  if (!normalized) {
    return null;
  }
  const urnMatch = normalized.match(/^urn:li:member:(.+)$/i);
  if (urnMatch?.[1]) {
    return normalizeNullableString(urnMatch[1]);
  }
  const fsdProfileMatch = normalized.match(/^urn:li:fsd_profile:(.+)$/i);
  if (fsdProfileMatch?.[1]) {
    return normalizeNullableString(fsdProfileMatch[1]);
  }
  return null;
}

/**
 * @param {any} workExperience
 */
function findCurrentUnipileWorkExperience(workExperience) {
  if (!Array.isArray(workExperience)) {
    return null;
  }
  return workExperience.find((entry) => entry?.current === true) ?? workExperience[0] ?? null;
}

/**
 * @param {{
 *   companyName: string | null,
 *   companyProfileUrl: string | null,
 *   companyLogoSourceUrl: string | null,
 * }} input
 */
function buildFallbackUnipileCompanyProfile(input) {
  return buildNormalizedUnipileCompanyProfile({
    name: input.companyName,
    domain: null,
    websiteUrl: null,
    linkedinCompanyUrl: input.companyProfileUrl,
    logoSourceUrl: input.companyLogoSourceUrl,
  });
}

/**
 * @param {{
 *   name: string | null,
 *   domain: string | null,
 *   websiteUrl: string | null,
 *   linkedinCompanyUrl: string | null,
 *   logoSourceUrl: string | null,
 * }} input
 */
function buildNormalizedUnipileCompanyProfile(input) {
  const websiteUrl = normalizeNullableUrl(input.websiteUrl);
  const websiteDomain = domainFromUrl(websiteUrl);
  const inputDomain = normalizeNullableString(input.domain);
  const normalized = {
    name: normalizeNullableString(input.name),
    domain: shouldReplaceDomainWithWebsiteDomain(inputDomain, websiteDomain)
      ? websiteDomain
      : (inputDomain ?? websiteDomain),
    websiteUrl,
    linkedinCompanyUrl: normalizeLinkedinCompanyUrl(input.linkedinCompanyUrl),
    logoSourceUrl: normalizeNullableUrl(input.logoSourceUrl),
  };
  if (
    !normalized.name
    && !normalized.domain
    && !normalized.websiteUrl
    && !normalized.linkedinCompanyUrl
    && !normalized.logoSourceUrl
  ) {
    return null;
  }
  return normalized;
}

/**
 * @param {string | null} inputDomain
 * @param {string | null} websiteDomain
 */
function shouldReplaceDomainWithWebsiteDomain(inputDomain, websiteDomain) {
  if (!websiteDomain) {
    return false;
  }
  if (!inputDomain) {
    return true;
  }
  return inputDomain.toLowerCase() === "linkedin.com" && websiteDomain.toLowerCase() !== "linkedin.com";
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
 * @param {{ apiKey: string, baseUrl: string, pathname: string, query: Record<string, string | string[] | null>, httpGetImpl: ((url: string, headers: Record<string, string>) => { status: number, bodyText: string } | null) | null }} input
 */
async function fetchUnipileJsonPage(input) {
  const url = new URL(input.pathname, input.baseUrl);
  for (const [key, value] of Object.entries(input.query)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== null) {
          url.searchParams.append(key, entry);
        }
      }
      continue;
    }
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
      "--connect-timeout",
      String(UNIPILE_HTTP_CONNECT_TIMEOUT_SECONDS),
      "--max-time",
      String(UNIPILE_HTTP_MAX_TIME_SECONDS),
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
      timeout: UNIPILE_HTTP_TIMEOUT_MS,
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
 * @param {{ url: string, apiKey: string, bodyText: string, httpPostImpl: ((url: string, headers: Record<string, string>, bodyText: string) => { status: number, bodyText: string } | null) | null }} input
 */
async function fetchUnipileJsonPost(input) {
  try {
    if (input.httpPostImpl) {
      const response = input.httpPostImpl(input.url, {
        accept: "application/json",
        "content-type": "application/json",
        "X-API-KEY": input.apiKey
      }, input.bodyText);
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
      "--connect-timeout",
      String(UNIPILE_HTTP_CONNECT_TIMEOUT_SECONDS),
      "--max-time",
      String(UNIPILE_HTTP_MAX_TIME_SECONDS),
      "-X",
      "POST",
      "-H",
      "accept: application/json",
      "-H",
      "content-type: application/json",
      "-H",
      `X-API-KEY: ${input.apiKey}`,
      "--data",
      input.bodyText,
      "-w",
      "\n__EXO_STATUS__:%{http_code}",
      input.url,
    ], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: UNIPILE_HTTP_TIMEOUT_MS,
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
 * @param {string | null | undefined} publicId
 */
function buildLinkedinCompanyUrlFromPublicId(publicId) {
  const normalized = normalizeNullableString(publicId);
  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return `https://www.linkedin.com/company/${normalized.replace(/^\/+|\/+$/g, "")}/`;
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
 * @param {string | null | undefined} companyUrl
 */
function extractLinkedinCompanyPublicId(companyUrl) {
  const normalized = normalizeNullableString(companyUrl);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/linkedin\.com\/company\/([^/?#]+)/i);
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
 * @param {string | null | undefined} rawUrl
 */
function normalizeLinkedinProfileUrl(rawUrl) {
  const normalized = normalizeNullableString(rawUrl);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return normalized;
  }
}

/**
 * @param {string | null | undefined} rawUrl
 */
function normalizeLinkedinCompanyUrl(rawUrl) {
  const normalized = normalizeNullableString(rawUrl);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return null;
  }
}

/**
 * @param {string | null | undefined} rawUrl
 */
function normalizeNullableUrl(rawUrl) {
  const normalized = normalizeNullableString(rawUrl);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    const redirectTarget = extractLinkedinRedirectTarget(url);
    if (redirectTarget) {
      return redirectTarget;
    }
    // Keep the original string shape when it is already valid.
    return normalized;
  } catch (_error) {
    return null;
  }
}

/**
 * @param {URL} url
 * @returns {string | null}
 */
function extractLinkedinRedirectTarget(url) {
  if (!/(\.|^)linkedin\.com$/i.test(url.hostname)) {
    return null;
  }
  if (!/\/redir\//i.test(url.pathname)) {
    return null;
  }
  const target = normalizeNullableString(url.searchParams.get("url"));
  if (!target) {
    return null;
  }

  try {
    return new URL(target).toString();
  } catch {
    return null;
  }
}

/**
 * @param {string | null | undefined} rawUrl
 */
function domainFromUrl(rawUrl) {
  const normalized = normalizeNullableString(rawUrl);
  if (!normalized) {
    return null;
  }

  try {
    return normalizeNullableString(new URL(normalized).hostname.replace(/^www\./i, ""));
  } catch {
    return null;
  }
}

/**
 * @param {any} image
 */
function extractLinkedinImageUrl(image) {
  const attributes = Array.isArray(image?.attributes) ? image.attributes : [];
  for (const attribute of attributes) {
    const detailData = attribute?.detailData ?? {};
    const vectorImage = detailData?.profilePicture?.profilePicture?.displayImageReferenceResolutionResult?.vectorImage
      ?? detailData?.profilePicture?.displayImageReferenceResolutionResult?.vectorImage
      ?? detailData?.vectorImage
      ?? null;
    const rootUrl = normalizeNullableString(vectorImage?.rootUrl);
    const artifacts = Array.isArray(vectorImage?.artifacts) ? vectorImage.artifacts : [];
    const bestArtifact = [...artifacts]
      .filter((artifact) => normalizeNullableString(artifact?.fileIdentifyingUrlPathSegment))
      .sort((left, right) => Number(right?.width ?? 0) - Number(left?.width ?? 0))[0] ?? null;
    const pathSegment = normalizeNullableString(bestArtifact?.fileIdentifyingUrlPathSegment);
    if (rootUrl && pathSegment) {
      return `${rootUrl}${pathSegment}`;
    }
  }

  return null;
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
      visibleTotalCount: "Set visibleTotalCount to the full count reported by the connector or visibly shown by LinkedIn for that surface when one exists; otherwise use itemCount when the surface is fully exhausted or null when no trustworthy total is available.",
      exhaustionStatus: "Set exhaustionStatus to complete only when the live surface was exhausted enough that disappearance or silence is trustworthy. Use incomplete for bounded quick-pass or early-stop captures. Use blocked only for structural failures such as identity mismatch, authwall, or a page that never rendered the required surface.",
      captureCompleteness: "Set captureCompleteness to complete when exhaustionStatus is complete, partial_visible_slice when you stopped at the bounded quick-pass limit before full reconciliation, and failed only when the surface could not be checked.",
      reconcileFields: "Set requestedMode and actualMode for every surface. Set reconcileRequired true whenever the reported total is larger than the itemized rows and exhaustionStatus is not complete, or whenever surfaceHints say the operator still needs a full reconciliation. Use a short snake_case reconcileReason such as visible_total_exceeds_itemized_rows or bounded_capture_stopped_early.",
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
 * @param {number | null | undefined} value
 * @param {string} label
 */
function normalizeOptionalPositiveInteger(value, label) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

/**
 * @param {number | null | undefined} value
 * @param {string} label
 */
function normalizeOptionalNonNegativeInteger(value, label) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
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
