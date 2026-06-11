// @ts-check

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { buildAgentStatusReport } from "../core/build-agent-status.js";
import { buildAgentQueue } from "../core/build-agent-queue.js";
import { buildDailyView } from "../core/build-daily-view.js";
import { buildInboxView } from "../core/build-inbox-view.js";
import { buildInboundReviewView } from "../core/build-inbound-review-view.js";
import { buildMotionReport } from "../core/build-motion-report.js";
import { assignCompanyUser } from "../core/assign-company-user.js";
import { claimMotionProspectPacket } from "../core/claim-motion-prospect-packet.js";
import { claimMotionTargetAccountPacket } from "../core/claim-target-account-packet.js";
import { mergeInboundObservation, recordInboundObservation } from "../core/inbound-observations.js";
import { refreshMotion } from "../core/refresh-motion.js";
import {
  findCompanyById,
  findInboundObservationByDedupeKey,
  findInboundObservationById,
  findMotionById,
  findUserById,
  listAgentQueueProspectBranches,
  listBrowserProfiles,
  listCompanies,
  listInboundCues,
  listInboundObservations,
  listMotions,
  listOutboundCapacityAccounts,
  listPlannerProspectBranches,
  listUsers,
  updateCompany,
  updateMotion,
  upsertInboundObservation,
} from "../db/database.js";
import { getHomeStateDir } from "../db/paths.js";
import { pruneExpiredBrowserBackoffs } from "../lib/agent-host-state.js";
import { buildUserWorkspaceContext, filterWorkspaceObservationsForUser } from "../core/workspace-context.js";
import { buildWorkspaceModel } from "../../prototype/build-motion-workspace.mjs";

const DEFAULT_WORKSPACE_SERVER_HOST = "127.0.0.1";
const DEFAULT_WORKSPACE_SERVER_PORT = 4312;

/**
 * @param {{ userId: string, capability?: string | null, regenerateCommand: string, interactive?: { enabled?: boolean, actionEndpoint?: string, workerLabel?: string } | null }} input
 */
export function buildWorkspaceProjection(input) {
  const user = findUserById(input.userId);
  if (!user) {
    throw new Error(`User not found: ${input.userId}`);
  }

  const capability = input.capability ?? "linkedin";
  const motions = listMotions();
  const companies = listCompanies();
  const browserProfiles = listBrowserProfiles();
  const users = listUsers();
  const observations = listInboundObservations({
    userId: user.id,
  });
  const allObservations = listInboundObservations();
  const cues = listInboundCues({
    userId: user.id,
    status: "open",
  });
  const workspaceContext = buildUserWorkspaceContext(user, {
    rawObservations: observations,
    rawCues: cues,
  });
  const now = new Date().toISOString();
  const filteredAllObservations = filterWorkspaceObservationsForUser(
    allObservations,
    user,
    workspaceContext.effectivePolicy,
  );
  const stateDir = getHomeStateDir();
  const hostState = pruneExpiredBrowserBackoffs(readJsonIfExists(path.join(stateDir, "agent-host-state.json")), now);
  const lastPass = readJsonIfExists(path.join(stateDir, "agent-last-pass.json"));

  const inboundReview = buildInboundReviewView(workspaceContext.user, workspaceContext.observations, motions, companies);
  const inbox = buildInboxView(workspaceContext.user, workspaceContext.observations, motions, companies);
  const daily = buildDailyView(workspaceContext.user, motions, companies, browserProfiles, workspaceContext.observations, {
    now,
    rawUsers: users,
    rawCues: workspaceContext.cues,
    capacityAccounts: listOutboundCapacityAccounts({
      executionUserId: user.id,
    }),
    prospectBranches: listPlannerProspectBranches({
      executionUserId: user.id,
      now,
    }),
  });
  const reports = motions.map((motion) =>
    buildMotionReport(motion, companies, browserProfiles, users, {
      capability,
    }),
  );
  const agentQueue = buildAgentQueue({
    motions,
    companies,
    profiles: browserProfiles,
    users,
    observations: filteredAllObservations,
    cues: workspaceContext.cues,
    prospectBranches: listAgentQueueProspectBranches(),
    hostState,
  });
  const agentStatus = buildAgentStatusReport({
    stateDir,
    queue: agentQueue,
    hostState,
    users,
    lastPass,
    now,
  });

  return buildWorkspaceModel({
    user,
    observations: workspaceContext.observations,
    inboundReview,
    inbox,
    daily,
    agentQueue,
    agentStatus,
    reports,
    regenerateCommand: input.regenerateCommand,
    interactive: input.interactive ?? null,
  });
}

/**
 * @param {string} filePath
 */
function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} rawAction
 */
export function runWorkspaceAction(rawAction) {
  const action = normalizeWorkspaceAction(rawAction);

  switch (action.kind) {
    case "assign_company_user":
      return runAssignCompanyUserAction(action);
    case "claim_target_account_packet":
      return runClaimTargetAccountPacketAction(action);
    case "claim_motion_prospect_packet":
      return runClaimMotionProspectPacketAction(action);
    case "record_inbound_observation":
      return runRecordInboundObservationAction(action);
    case "refresh_motion":
      return runRefreshMotionAction(action);
    default:
      throw new Error(`Unsupported workspace action: ${String(action.kind)}`);
  }
}

/**
 * @param {{ userId: string, capability?: string | null, host?: string | null, port?: number | null, workerLabel?: string | null }} input
 */
export async function startWorkspaceServer(input) {
  const capability = input.capability ?? "linkedin";
  const host = input.host ?? DEFAULT_WORKSPACE_SERVER_HOST;
  const requestedPort = input.port ?? DEFAULT_WORKSPACE_SERVER_PORT;
  const workerLabel = input.workerLabel ?? "codex-workspace";

  /** @type {http.Server} */
  let server;

  server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${requestedPort}`}`);

    try {
      if (request.method === "GET" && (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html")) {
        const port = resolveServerPort(server, requestedPort);
        const projection = buildWorkspaceProjection({
          userId: input.userId,
          capability,
          regenerateCommand: `exo report workspace --user ${input.userId} --serve ${port}`,
          interactive: {
            enabled: true,
            actionEndpoint: "/api/action",
            workerLabel,
          },
        });
        respondHtml(response, projection.html);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/workspace.json") {
        const port = resolveServerPort(server, requestedPort);
        const projection = buildWorkspaceProjection({
          userId: input.userId,
          capability,
          regenerateCommand: `exo report workspace --user ${input.userId} --serve ${port}`,
          interactive: {
            enabled: true,
            actionEndpoint: "/api/action",
            workerLabel,
          },
        });
        respondJson(response, 200, projection.data);
        return;
      }

      if (request.method === "OPTIONS" && requestUrl.pathname === "/api/action") {
        respondNoContent(response);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/action") {
        const body = await readJsonBody(request);
        const result = await runWorkspaceAction(body);
        respondJson(response, 200, {
          ok: true,
          ...result,
        });
        return;
      }

      respondJson(response, 404, {
        ok: false,
        error: `Not found: ${request.method} ${requestUrl.pathname}`,
      });
    } catch (error) {
      respondJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, resolve);
  });

  const port = resolveServerPort(server, requestedPort);
  return {
    server,
    host,
    port,
    url: `http://${host}:${port}/`,
  };
}

/**
 * @param {http.Server} server
 * @param {number} fallbackPort
 */
function resolveServerPort(server, fallbackPort) {
  const address = server.address();
  return typeof address === "object" && address && typeof address.port === "number"
    ? address.port
    : fallbackPort;
}

/**
 * @param {unknown} rawAction
 */
function normalizeWorkspaceAction(rawAction) {
  if (!rawAction || typeof rawAction !== "object") {
    throw new Error("Workspace action payload must be an object.");
  }

  return /** @type {{ kind?: string }} */ (rawAction);
}

/**
 * @param {{ companyId?: string, userId?: string, reason?: string, browserCapability?: string }} action
 */
function runAssignCompanyUserAction(action) {
  if (!action.companyId || !action.userId) {
    throw new Error("assign_company_user requires companyId and userId.");
  }

  const rawCompany = findCompanyById(action.companyId);
  if (!rawCompany) {
    throw new Error(`Company not found: ${action.companyId}`);
  }

  const rawUser = findUserById(action.userId);
  if (!rawUser) {
    throw new Error(`User not found: ${action.userId}`);
  }

  const updated = assignCompanyUser(rawCompany, rawUser, listBrowserProfiles(), {
    assignedBy: "workspace-ui",
    reason: action.reason ?? "Make ready outbound branches executable",
    browserCapability: action.browserCapability ?? "linkedin",
  });
  updateCompany(updated);

  return {
    message: `Pinned ${updated.name} to ${updated.engagementUserAssignment?.label ?? "the selected user"}.`,
  };
}

/**
 * @param {{ companyId?: string, motionId?: string, workerLabel?: string, notes?: string }} action
 */
function runClaimTargetAccountPacketAction(action) {
  if (!action.companyId || !action.motionId || !action.workerLabel) {
    throw new Error("claim_target_account_packet requires companyId, motionId, and workerLabel.");
  }

  const rawCompany = findCompanyById(action.companyId);
  if (!rawCompany) {
    throw new Error(`Company not found: ${action.companyId}`);
  }

  const rawMotion = findMotionById(action.motionId);
  if (!rawMotion) {
    throw new Error(`Motion not found: ${action.motionId}`);
  }

  const storedMotion = claimMotionTargetAccountPacket(rawMotion, rawCompany, {
    workerLabel: action.workerLabel,
    notes: action.notes ?? null,
  });

  return {
    message: `Claimed ${rawCompany.name}'s account packet on ${storedMotion.name}.`,
  };
}

/**
 * @param {{ companyId?: string, motionId?: string, prospectId?: string, workerLabel?: string, notes?: string }} action
 */
function runClaimMotionProspectPacketAction(action) {
  if (!action.companyId || !action.motionId || !action.prospectId || !action.workerLabel) {
    throw new Error("claim_motion_prospect_packet requires companyId, motionId, prospectId, and workerLabel.");
  }

  const rawCompany = findCompanyById(action.companyId);
  if (!rawCompany) {
    throw new Error(`Company not found: ${action.companyId}`);
  }

  const rawMotion = findMotionById(action.motionId);
  if (!rawMotion) {
    throw new Error(`Motion not found: ${action.motionId}`);
  }

  const storedMotion = claimMotionProspectPacket(rawMotion, rawCompany, {
    prospectId: action.prospectId,
    workerLabel: action.workerLabel,
    notes: action.notes ?? null,
  });

  return {
    message: `Claimed the prospect packet on ${storedMotion.name}.`,
  };
}

/**
 * @param {{ motionId?: string }} action
 */
async function runRefreshMotionAction(action) {
  if (!action.motionId) {
    throw new Error("refresh_motion requires motionId.");
  }

  const rawMotion = findMotionById(action.motionId);
  if (!rawMotion) {
    throw new Error(`Motion not found: ${action.motionId}`);
  }

  const refreshed = await refreshMotion(rawMotion);
  const storedMotion = updateMotion(refreshed);

  return {
    message: `Refreshed ${storedMotion.name}.`,
  };
}

/**
 * @param {{ observationId?: string, nextKind?: string, summary?: string, notes?: string }} action
 */
function runRecordInboundObservationAction(action) {
  if (!action.observationId || !action.nextKind) {
    throw new Error("record_inbound_observation requires observationId and nextKind.");
  }

  if (!["connection_request_accepted", "connection_request_declined"].includes(action.nextKind)) {
    throw new Error(`Unsupported inbound observation transition: ${action.nextKind}`);
  }

  const rawExisting = findInboundObservationById(action.observationId);
  if (!rawExisting) {
    throw new Error(`Inbound observation not found: ${action.observationId}`);
  }

  if (!rawExisting.externalId) {
    throw new Error("Inbound observation cannot be transitioned because it has no stable external identity.");
  }

  const rawUser = findUserById(rawExisting.userId);
  if (!rawUser) {
    throw new Error(`User not found: ${rawExisting.userId}`);
  }

  const nextObservation = recordInboundObservation(rawUser, {
    accountId: rawExisting.accountId,
    surfaceKey: rawExisting.surfaceKey,
    kind: action.nextKind,
    observedAt: new Date().toISOString(),
    summary: action.summary ?? buildInboundObservationTransitionSummary(rawExisting.actorName, action.nextKind),
    externalId: rawExisting.externalId,
    actorName: rawExisting.actorName,
    actorTitle: rawExisting.actorTitle,
    actorCompanyName: rawExisting.actorCompanyName,
    actorHandle: rawExisting.actorHandle,
    actorProfileUrl: rawExisting.actorProfileUrl,
    actorLinkedinPublicId: rawExisting.actorLinkedinPublicId,
    actorLinkedinMemberId: rawExisting.actorLinkedinMemberId,
    actorAvatarSourceUrl: rawExisting.actorAvatarSourceUrl,
    threadUrl: rawExisting.threadUrl,
    sourceUrl: rawExisting.sourceUrl,
    motionId: rawExisting.motionId,
    companyId: rawExisting.companyId,
    prospectId: rawExisting.prospectId,
    notes: action.notes ?? `Recorded from the interactive workspace as ${humanizeInboundObservationKind(action.nextKind)}.`
  }, {
    rawMotions: listMotions(),
  });
  const existingForDedupe = findInboundObservationByDedupeKey(nextObservation.dedupeKey);
  const merged = mergeInboundObservation(existingForDedupe, nextObservation);
  upsertInboundObservation(merged);

  return {
    message: `Recorded ${rawExisting.actorName ?? "the inbound invite"} as ${humanizeInboundObservationKind(action.nextKind)} in Exo.`,
  };
}

/**
 * @param {string | null | undefined} actorName
 * @param {string} nextKind
 */
function buildInboundObservationTransitionSummary(actorName, nextKind) {
  const subject = actorName?.trim() || "This inbound invite";
  if (nextKind === "connection_request_accepted") {
    return `${subject} was marked accepted from the workspace.`;
  }

  return `${subject} was marked declined from the workspace.`;
}

/**
 * @param {string} kind
 */
function humanizeInboundObservationKind(kind) {
  return kind.replace(/^connection_request_/, "").replaceAll("_", " ");
}

/**
 * @param {http.IncomingMessage} request
 * @returns {Promise<unknown>}
 */
async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @param {http.ServerResponse} response
 * @param {string} html
 */
function respondHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(html);
}

/**
 * @param {http.ServerResponse} response
 */
function respondNoContent(response) {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end();
}

/**
 * @param {http.ServerResponse} response
 * @param {number} statusCode
 * @param {unknown} payload
 */
function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(payload, null, 2));
}
